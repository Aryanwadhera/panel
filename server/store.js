import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.PANEL_DATA || path.join(os.homedir(), '.panel'));

export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

function defaults() {
  return {
    version: 1,
    setupComplete: false,
    settings: {
      name: 'Panel',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      units: 'metric',
      clock24: false,
      location: null,
      theme: 'light',
      nightStart: '22:00',
      nightEnd: '07:00',
      grid: { cols: 4, rows: 3 },
      autoUpdate: false,
      audio: { airplay: true, speaker: null },
      ai: { apiKey: '', model: DEFAULT_MODEL },
    },
    widgets: [],
    sessions: [],
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(base[k]) && isObj(v) ? merge(base[k], v) : v;
  return out;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export const rid = (bytes = 6) => crypto.randomBytes(bytes).toString('base64url');

/**
 * config.json holds what the person set up (settings, widgets, paired devices).
 * state.json holds what widgets last fetched or were sent, so a restart
 * doesn't blank the screen.
 */
export class Store {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    this.configFile = path.join(DATA_DIR, 'config.json');
    this.stateFile = path.join(DATA_DIR, 'state.json');
    this.config = merge(defaults(), readJson(this.configFile, {}));
    this.state = readJson(this.stateFile, {});
    this.timers = {};
  }

  get settings() { return this.config.settings; }

  saveConfig() { this.#later('config', 100); }
  saveState() { this.#later('state', 1500); }

  #later(which, delay) {
    clearTimeout(this.timers[which]);
    this.timers[which] = setTimeout(() => this.#write(which), delay);
  }

  #write(which) {
    try {
      if (which === 'config') writeAtomic(this.configFile, this.config);
      else writeAtomic(this.stateFile, this.state);
    } catch (err) {
      console.error(`[store] could not write ${which}:`, err.message);
    }
  }

  flush() {
    for (const which of Object.keys(this.timers)) {
      clearTimeout(this.timers[which]);
      this.#write(which);
    }
  }

  widget(id) { return this.config.widgets.find((w) => w.id === id); }

  setData(id, patch) {
    this.state[id] = { ...this.state[id], ...patch };
    this.saveState();
    return this.state[id];
  }

  reset() {
    this.config = defaults();
    this.state = {};
    this.saveConfig();
    this.saveState();
  }
}
