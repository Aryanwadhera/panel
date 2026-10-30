// Software updates. Panel is installed as a git checkout, so "is there an
// update?" means "is the branch we track ahead of us?". Installing is a
// fast-forward, a clean dependency install, and a restart, with an
// automatic rollback if any step fails.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);
const CHECK_EVERY = 6 * 3600e3;
const FIRST_CHECK_AFTER = 60e3;

export function createUpdater({ root, onChange, isQuietHour, autoUpdateEnabled }) {
  const git = async (...args) => (await exec('git', ['-C', root, ...args], { timeout: 60000 })).stdout.trim();
  const npm = (...args) => exec('npm', args, { cwd: root, timeout: 600000 });
  const managed = !!process.env.INVOCATION_ID; // running under systemd, which restarts us
  const localVersion = () => {
    try { return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
  };

  const state = {
    supported: null,     // null until we know whether this is a git checkout with an upstream
    managed,
    current: { version: localVersion(), commit: null },
    latest: null,        // { version, commit }
    available: false,
    behind: 0,
    changes: [],         // [{ commit, subject, date }]
    checkedAt: null,
    checking: false,
    phase: null,         // null | 'downloading' | 'installing' | 'restarting' | 'failed'
    error: null,
  };

  const publish = () => onChange({ ...state });

  async function detect() {
    try {
      state.current.commit = await git('rev-parse', '--short', 'HEAD');
      state.branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
      await git('rev-parse', '--abbrev-ref', '@{u}');
      state.supported = true;
    } catch {
      state.supported = false;
      state.error = 'Updates work for installs made with the installer (a git checkout with a remote).';
    }
    return state.supported;
  }

  async function check() {
    if (state.checking || state.phase === 'downloading' || state.phase === 'installing') return { ...state };
    if (state.supported === null) await detect();
    if (!state.supported) { publish(); return { ...state }; }
    state.checking = true;
    publish();
    try {
      await git('fetch', '--quiet', 'origin');
      const behind = +(await git('rev-list', '--count', 'HEAD..@{u}'));
      state.behind = behind;
      state.available = behind > 0;
      state.latest = { commit: await git('rev-parse', '--short', '@{u}'), version: state.current.version };
      try { state.latest.version = JSON.parse(await git('show', '@{u}:package.json')).version; } catch { /* keep current */ }
      state.changes = behind
        ? (await git('log', '--no-merges', '-n', '30', '--format=%h%x1f%s%x1f%cI', 'HEAD..@{u}'))
          .split('\n').filter(Boolean).map((line) => {
            const [commit, subject, date] = line.split('\x1f');
            return { commit, subject, date };
          })
        : [];
      state.error = null;
      if (state.phase === 'failed') state.phase = null; // a fresh check supersedes an old failure
    } catch (err) {
      state.error = /Could not resolve host|unable to access/i.test(err.stderr || err.message)
        ? 'Couldn’t reach GitHub. Check the panel’s internet connection.'
        : `Couldn’t check for updates: ${firstLine(err)}`;
    } finally {
      state.checking = false;
      state.checkedAt = new Date().toISOString();
      publish();
    }
    return { ...state };
  }

  /**
   * Checks that can fail fast run before this resolves, so the caller can
   * report them. The download and install then continue in the background
   * unless `wait` is set; progress is published as it happens.
   */
  async function apply({ wait = false } = {}) {
    if (state.phase === 'downloading' || state.phase === 'installing' || state.phase === 'restarting') return { ...state };
    if (state.supported === null) await detect();
    if (!state.supported) throw new Error(state.error);

    const dirty = await git('status', '--porcelain', '--untracked-files=no');
    if (dirty) {
      throw new Error(`Files in ${root} were edited by hand, so Panel won’t overwrite them. Run "git -C ${root} stash" on the Pi, then try again.`);
    }

    const before = await git('rev-parse', 'HEAD');
    state.error = null;
    state.phase = 'downloading';
    publish();
    const job = install(before).catch(() => {});
    if (wait) await job;
    return { ...state };
  }

  async function install(before) {
    try {
      await git('fetch', '--quiet', 'origin');
      await git('merge', '--ff-only', '--quiet', '@{u}');
      state.phase = 'installing';
      publish();
      // npm ci installs exactly what the lockfile says and never edits it,
      // so the checkout stays clean for the next update.
      await npm('ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error');
    } catch (err) {
      state.phase = 'failed';
      state.error = `Update failed, so nothing changed: ${firstLine(err)}`;
      try {
        await git('reset', '--hard', '--quiet', before);
        await npm('ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error');
      } catch { /* best effort: the old code is still running in memory */ }
      publish();
      throw new Error(state.error);
    }

    state.current = { version: localVersion(), commit: await git('rev-parse', '--short', 'HEAD') };
    state.available = false;
    state.behind = 0;
    state.changes = [];
    if (managed) {
      state.phase = 'restarting';
      publish();
      // systemd brings us straight back on the new code.
      setTimeout(() => process.exit(0), 600);
    } else {
      state.phase = null;
      state.error = 'Updated. Restart Panel to start using the new version.';
      publish();
    }
    return { ...state };
  }

  async function tick() {
    await check().catch(() => {});
    if (state.available && autoUpdateEnabled() && isQuietHour() && managed) {
      console.log(`[update] installing ${state.latest?.version} (${state.latest?.commit}) automatically`);
      await apply({ wait: true }).catch((err) => console.warn(`[update] ${err.message}`));
    }
  }

  return {
    get state() { return { ...state }; },
    check,
    apply,
    start() {
      detect().then(publish);
      setTimeout(tick, FIRST_CHECK_AFTER).unref();
      setInterval(tick, CHECK_EVERY).unref();
      // A quiet-hours window is 3 hours wide, so also look hourly at night.
      setInterval(() => { if (autoUpdateEnabled() && isQuietHour()) tick(); }, 3600e3).unref();
    },
  };
}

/** The most useful line of a git/npm failure, without log-file noise. */
function firstLine(err) {
  const lines = String(err.stderr || err.message || err).split('\n')
    .map((l) => l.replace(/^(npm (error|ERR!)|fatal:|error:)\s*/i, '').trim())
    .filter((l) => l && !/complete log of this run|^code E|^Command failed/i.test(l));
  return lines[0] || 'unknown error';
}
