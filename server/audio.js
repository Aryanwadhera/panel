// Sound: choose the speaker (Bluetooth, USB, headphone jack, HDMI), set the
// volume, pair Bluetooth speakers, and run an AirPlay receiver
// (shairport-sync) whose "now playing" metadata feeds the display.
//
// Everything goes through PipeWire's PulseAudio-compatible tools (pactl,
// paplay) and bluetoothctl. On a machine without them (a laptop running
// `npm run dev`), the Sound tab says so and nothing here runs.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import dgram from 'node:dgram';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseSinks, parseBtInfo, parseBtDevices, createPacketReader, chimeWav } from './lib/audio-parse.js';

const execAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
const ART_LEAD_MS = 3000;

// A system service doesn't get the user's session variables, which pactl
// needs to find PipeWire. Fill them in when we can.
const ENV = { ...process.env, LANG: 'C', LC_ALL: 'C' };
if (!ENV.XDG_RUNTIME_DIR && process.getuid) {
  const dir = `/run/user/${process.getuid()}`;
  if (fs.existsSync(dir)) ENV.XDG_RUNTIME_DIR = dir;
}

function has(cmd) {
  return (process.env.PATH || '').split(':').some((dir) => {
    try { fs.accessSync(path.join(dir, cmd), fs.constants.X_OK); return true; } catch { return false; }
  });
}

async function run(cmd, args, timeout = 15000) {
  try {
    const { stdout } = await execAsync(cmd, args, { env: ENV, timeout });
    return stdout;
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message).trim().split('\n').pop();
    throw new Error(msg || `${cmd} failed`);
  }
}

/** Drive an interactive bluetoothctl session (pairing needs an agent). */
function btSession() {
  const proc = spawn('bluetoothctl', [], { env: ENV });
  let out = '';
  proc.stdout.on('data', (d) => {
    // Strip colours and prompts; keep just the messages.
    out += d.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '\n');
  });
  proc.stderr.on('data', (d) => { out += d.toString(); });
  return {
    send(line) { if (proc.stdin.writable) proc.stdin.write(`${line}\n`); },
    async waitFor(re, ms) {
      const from = out.length;
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const m = re.exec(out.slice(from));
        if (m) return m;
        await sleep(150);
      }
      return null;
    },
    get output() { return out; },
    close() {
      this.send('quit');
      setTimeout(() => proc.kill(), 1500).unref();
    },
  };
}

export function createAudio({ store, dataDir, onChange, onNowPlaying }) {
  const fake = process.env.PANEL_FAKE_AIRPLAY === '1'; // listen for metadata without running shairport (development)
  const METADATA_PORT = +process.env.PANEL_AIRPLAY_METADATA_PORT || 5571;
  const caps = {
    sound: has('pactl'),
    bluetooth: has('bluetoothctl'),
    airplay: has('shairport-sync') || fake,
  };
  const settings = () => {
    store.settings.audio ||= { airplay: true, speaker: null };
    return store.settings.audio;
  };

  const state = {
    caps,
    outputs: [],
    output: null,
    volume: null,
    muted: false,
    bluetooth: { devices: [], nearby: [], scanning: false, busy: null, error: null },
    airplay: { enabled: false, running: false, name: '', error: null, version: null },
    error: null,
  };

  let publishTimer;
  const publish = () => {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => onChange(snapshot()), 100);
  };
  const snapshot = () => ({ ...state, nowPlaying: nowPlaying() });

  // ------------------------------------------------------------ outputs

  async function refreshOutputs() {
    if (!caps.sound) return;
    try {
      const [list, def] = await Promise.all([run('pactl', ['list', 'sinks']), run('pactl', ['get-default-sink'])]);
      state.outputs = parseSinks(list);
      state.output = def.trim();
      const current = state.outputs.find((o) => o.name === state.output);
      state.volume = current?.volume ?? null;
      state.muted = !!current?.muted;
      state.error = null;
    } catch (err) {
      state.error = /connection refused|connection failure/i.test(err.message)
        ? 'The Pi\u2019s sound system (PipeWire) isn\u2019t running. Rerun the installer, or reboot.'
        : err.message;
    }
  }

  async function setOutput(name) {
    await run('pactl', ['set-default-sink', name]);
    // Move anything already playing (like AirPlay) to the new speaker.
    const inputs = await run('pactl', ['list', 'short', 'sink-inputs']).catch(() => '');
    for (const line of inputs.split('\n')) {
      const id = line.split('\t')[0];
      if (/^\d+$/.test(id)) await run('pactl', ['move-sink-input', id, name]).catch(() => {});
    }
    await refreshOutputs();
    publish();
  }

  async function setVolume({ volume, muted }) {
    if (volume != null) await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${Math.max(0, Math.min(150, Math.round(volume)))}%`]);
    if (muted != null) await run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0']);
    await refreshOutputs();
    publish();
  }

  async function testSound() {
    const file = path.join(os.tmpdir(), 'panel-chime.wav');
    fs.writeFileSync(file, chimeWav());
    await run('paplay', [file], 10000);
  }

  // ------------------------------------------------------------ bluetooth

  let btQueue = Promise.resolve();
  const bt = (fn) => {
    const job = btQueue.then(fn, fn);
    btQueue = job.catch(() => {});
    return job;
  };

  async function btInfo(mac) {
    return parseBtInfo(await run('bluetoothctl', ['info', mac], 8000), mac);
  }

  async function refreshBluetooth() {
    if (!caps.bluetooth) return;
    try {
      const paired = parseBtDevices(await run('bluetoothctl', ['devices', 'Paired'], 8000).catch(() => run('bluetoothctl', ['paired-devices'], 8000)));
      state.bluetooth.devices = await Promise.all(paired.map((d) => btInfo(d.mac).catch(() => ({ ...d, paired: true }))));
      state.bluetooth.error = null;
    } catch (err) {
      state.bluetooth.error = /No default controller/i.test(err.message)
        ? 'This Pi has no Bluetooth, or it\u2019s turned off.'
        : err.message;
    }
  }

  const scan = (seconds = 12) => bt(async () => {
    state.bluetooth.scanning = true;
    state.bluetooth.error = null;
    publish();
    const s = btSession();
    try {
      s.send('power on');
      s.send('scan on');
      await sleep(seconds * 1000);
      s.send('scan off');
      if (/No default controller/i.test(s.output)) throw new Error('This Pi has no Bluetooth, or it\u2019s turned off.');
    } finally {
      s.close();
    }
    const all = parseBtDevices(await run('bluetoothctl', ['devices'], 8000));
    const pairedMacs = new Set(state.bluetooth.devices.map((d) => d.mac));
    const named = all.filter((d) => !pairedMacs.has(d.mac) && d.name.replace(/-/g, ':').toUpperCase() !== d.mac);
    const infos = await Promise.all(named.slice(0, 40).map((d) => btInfo(d.mac).catch(() => ({ ...d, audio: false }))));
    // Speakers and headphones first; other gadgets after.
    state.bluetooth.nearby = infos.sort((a, b) => b.audio - a.audio || a.name.localeCompare(b.name));
    state.bluetooth.scanning = false;
    publish();
    return state.bluetooth.nearby;
  }).finally(() => { state.bluetooth.scanning = false; publish(); });

  async function adoptSpeaker(mac) {
    // PipeWire adds the speaker a few seconds after it connects.
    const id = mac.replace(/:/g, '_');
    for (let i = 0; i < 20; i++) {
      await refreshOutputs();
      const sink = state.outputs.find((o) => o.name.includes(id));
      if (sink) { await setOutput(sink.name); return true; }
      await sleep(500);
    }
    return false;
  }

  const pair = (mac) => bt(async () => {
    if (!MAC.test(mac)) throw new Error('That isn\u2019t a Bluetooth address');
    state.bluetooth.busy = mac;
    publish();
    const s = btSession();
    try {
      s.send('power on');
      s.send('agent NoInputNoOutput');
      s.send('default-agent');
      // The speaker has to have been seen recently to pair.
      s.send('scan on');
      await s.waitFor(new RegExp(mac, 'i'), 8000);
      s.send('scan off');
      s.send(`pair ${mac}`);
      const paired = await s.waitFor(/Pairing successful|AlreadyExists|Failed to pair[^\n]*|not available/i, 30000);
      if (!paired) throw new Error('The speaker didn\u2019t answer. Make sure it\u2019s in pairing mode and close by.');
      if (/Failed|not available/i.test(paired[0])) throw new Error(`Couldn\u2019t pair: ${paired[0].replace(/^Failed to pair:?\s*/i, '') || 'the speaker refused'}. Put it in pairing mode and try again.`);
      s.send(`trust ${mac}`);
      s.send(`connect ${mac}`);
      const connected = await s.waitFor(/Connection successful|Failed to connect[^\n]*/i, 25000);
      if (!connected || /Failed/i.test(connected[0])) throw new Error('Paired, but couldn\u2019t connect. Try Connect in a moment.');
    } finally {
      s.close();
      state.bluetooth.busy = null;
    }
    settings().speaker = mac;
    store.saveConfig();
    await adoptSpeaker(mac);
    await refreshBluetooth();
    state.bluetooth.nearby = state.bluetooth.nearby.filter((d) => d.mac !== mac);
    publish();
  });

  const connect = (mac) => bt(async () => {
    state.bluetooth.busy = mac;
    publish();
    try {
      await run('bluetoothctl', ['connect', mac], 25000);
    } catch (err) {
      throw new Error(/not available/i.test(err.message) ? 'The speaker is off or out of range.' : `Couldn\u2019t connect: ${err.message}`);
    } finally {
      state.bluetooth.busy = null;
    }
    settings().speaker = mac;
    store.saveConfig();
    await adoptSpeaker(mac);
    await refreshBluetooth();
    publish();
  });

  const disconnect = (mac) => bt(async () => {
    await run('bluetoothctl', ['disconnect', mac], 15000).catch(() => {});
    if (settings().speaker === mac) { settings().speaker = null; store.saveConfig(); }
    await sleep(800);
    await Promise.all([refreshBluetooth(), refreshOutputs()]);
    publish();
  });

  const forget = (mac) => bt(async () => {
    await run('bluetoothctl', ['remove', mac], 15000).catch(() => {});
    if (settings().speaker === mac) { settings().speaker = null; store.saveConfig(); }
    await Promise.all([refreshBluetooth(), refreshOutputs()]);
    publish();
  });

  /** Bluetooth speakers drop off when switched off; reconnect when they're back. */
  async function keepSpeakerConnected() {
    const mac = settings().speaker;
    if (!caps.bluetooth || !mac || state.bluetooth.busy || state.bluetooth.scanning) return;
    try {
      const info = await btInfo(mac);
      if (info.connected) return;
      await run('bluetoothctl', ['connect', mac], 20000);
      console.log(`[audio] reconnected ${info.name}`);
      await adoptSpeaker(mac);
      await refreshBluetooth();
      publish();
    } catch { /* speaker is off; try again later */ }
  }

  // ------------------------------------------------------------ airplay

  const CONF = path.join(dataDir, 'airplay.conf');
  let child = null;
  let wanted = false;
  let restarts = 0;
  let stderrTail = [];
  let backend = 'alsa';

  async function detectShairport() {
    if (fake || !has('shairport-sync')) return;
    // `-V` prints the build's features, e.g. "4.1.1-OpenSSL-Avahi-ALSA-PA-soxr-metadata-sysconfdir:/etc"
    const v = await run('shairport-sync', ['-V'], 5000).catch(() => '');
    const features = v.trim().split('-');
    backend = features.includes('PA') ? 'pa' : features.some((f) => /^(pw|PipeWire)$/i.test(f)) ? 'pw' : 'alsa';
    state.airplay.version = /AirPlay2/i.test(v) ? 2 : 1;
    state.airplay.metadata = /metadata/i.test(v);
  }

  function writeConfig() {
    const name = (store.settings.name || 'Panel').replace(/["\\]/g, '');
    const conf = `// Written by Panel. Edits here are overwritten; change settings in Panel.
general = {
  name = "${name}";
  output_backend = "${backend}";
  volume_range_db = 50;
  interpolation = "basic";
  // Bluetooth timing wobbles. Don't let that trigger a resync, which cuts the
  // music out, and keep a bigger buffer so a Wi-Fi hiccup can't empty it.
  resync_threshold_in_seconds = 0;
  drift_tolerance_in_seconds = 0.05;
  audio_backend_buffer_desired_length_in_seconds = 0.5;
};
sessioncontrol = {
  session_timeout = 20;
};
metadata = {
  enabled = "yes";
  include_cover_art = "yes";
  socket_address = "127.0.0.1";
  socket_port = ${METADATA_PORT};
  socket_msglength = 65000;
};
pa = { application_name = "AirPlay"; };
alsa = { output_device = "default"; };
`;
    fs.writeFileSync(CONF, conf);
    state.airplay.name = name;
  }

  function spawnShairport() {
    if (!wanted || child || fake) return;
    stderrTail = [];
    child = spawn('shairport-sync', ['-c', CONF], { env: ENV });
    const startedAt = Date.now();
    state.airplay.running = true;
    state.airplay.error = null;
    child.stderr.on('data', (d) => { stderrTail = [...stderrTail, ...d.toString().split('\n').filter(Boolean)].slice(-10); });
    child.on('exit', (code) => {
      child = null;
      state.airplay.running = false;
      if (!wanted) return publish();
      if (Date.now() - startedAt > 60e3) restarts = 0;
      const last = stderrTail.filter((l) => !/warning/i.test(l)).pop() || `stopped (code ${code})`;
      state.airplay.error = /address already in use|port 5000/i.test(last)
        ? 'Another AirPlay receiver is already running on this Pi (try: sudo systemctl disable --now shairport-sync).'
        : `AirPlay stopped: ${last.replace(/^.*?error:\s*/i, '')}`;
      console.warn(`[airplay] ${state.airplay.error}`);
      setTimeout(spawnShairport, Math.min(60e3, 2000 * 2 ** restarts++)).unref();
      publish();
    });
    publish();
  }

  async function startAirplay() {
    if (!caps.airplay) return;
    wanted = true;
    state.airplay.enabled = true;
    try {
      writeConfig();
      listenForMetadata();
      spawnShairport();
      if (fake) state.airplay.running = true;
    } catch (err) {
      state.airplay.error = err.message;
    }
    publish();
    onNowPlaying(nowPlaying());
  }

  function stopAirplay() {
    wanted = false;
    state.airplay.enabled = false;
    state.airplay.running = false;
    child?.kill();
    setNowPlaying({ state: 'idle' });
    publish();
  }

  async function restartAirplay() {
    if (!wanted) return;
    writeConfig();
    if (child) child.kill(); // the exit handler respawns it with the new name
    else spawnShairport();
  }

  // ------------------------------------------------------------ now playing

  const np = {
    state: 'idle', title: '', artist: '', album: '', source: '',
    art: null, artType: null, artId: '', artAt: 0,
    duration: null, position: null, positionAt: null,
  };
  let idleTimer;

  function nowPlaying() {
    return {
      state: np.state,
      title: np.title, artist: np.artist, album: np.album, source: np.source,
      artUrl: np.art ? `/api/audio/art?v=${np.artId}` : null,
      duration: np.duration, position: np.position, positionAt: np.positionAt,
      airplay: { available: caps.airplay, enabled: settings().airplay !== false, name: state.airplay.name || store.settings.name },
    };
  }

  let npTimer;
  function setNowPlaying(patch) {
    Object.assign(np, patch);
    clearTimeout(idleTimer);
    if (np.state === 'idle') {
      // Keep the last track briefly so a skip doesn't flash "nothing playing".
      idleTimer = setTimeout(() => {
        Object.assign(np, { title: '', artist: '', album: '', source: '', art: null, duration: null, position: null });
        onNowPlaying(nowPlaying());
      }, 8000);
    }
    clearTimeout(npTimer);
    npTimer = setTimeout(() => onNowPlaying(nowPlaying()), 150);
  }

  const onItem = (type, code, data) => {
    const text = data.toString('utf8');
    if (type === 'core') {
      if (code === 'minm') {
        // A new song keeps the old cover until its own arrives, unless that
        // cover got here first: phones send the two in either order.
        const newSong = text !== np.title && Date.now() - np.artAt > ART_LEAD_MS;
        setNowPlaying({ title: text, ...(newSong ? { art: null, artType: null } : {}) });
      }
      else if (code === 'asar') setNowPlaying({ artist: text });
      else if (code === 'asal') setNowPlaying({ album: text });
      return;
    }
    if (type !== 'ssnc') return;
    switch (code) {
      case 'pbeg': case 'abeg': case 'prsm': case 'pres':
        setNowPlaying({ state: 'playing' });
        break;
      case 'pfls': case 'paus':
        if (np.state === 'playing') {
          const pos = np.position != null ? np.position + (Date.now() - np.positionAt) / 1000 : null;
          setNowPlaying({ state: 'paused', position: pos, positionAt: Date.now() });
        }
        break;
      case 'pend': case 'aend':
        setNowPlaying({ state: 'idle' });
        break;
      case 'snam':
        setNowPlaying({ source: text });
        break;
      case 'PICT': {
        const type = data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg' : data[0] === 0x89 && data[1] === 0x50 ? 'image/png' : null;
        // Named by content, so a browser cache can't serve an older song's cover.
        const artId = crypto.createHash('sha1').update(data).digest('hex').slice(0, 12);
        setNowPlaying({ art: data.length && type ? data : null, artType: type, artId, artAt: Date.now() });
        break;
      }
      case 'prgr': {
        // RTP frame numbers at 44.1 kHz: start/current/end
        const [start, cur, end] = text.split('/').map(Number);
        if ([start, cur, end].every(Number.isFinite)) {
          setNowPlaying({
            duration: ((end - start) >>> 0) / 44100,
            position: ((cur - start) >>> 0) / 44100,
            positionAt: Date.now(),
            state: np.state === 'paused' ? 'paused' : 'playing',
          });
        }
        break;
      }
    }
  };

  let socket = null;
  function listenForMetadata() {
    if (socket) return;
    socket = dgram.createSocket('udp4');
    const read = createPacketReader(onItem);
    socket.on('message', read);
    socket.on('error', (err) => {
      console.warn(`[airplay] metadata: ${err.message}`);
      socket.close();
      socket = null;
      setTimeout(listenForMetadata, 10e3).unref();
    });
    socket.bind(METADATA_PORT, '127.0.0.1');
    socket.unref();
  }

  // ------------------------------------------------------------ lifecycle

  return {
    get state() { return snapshot(); },
    nowPlaying,
    art: () => (np.art ? { body: np.art, type: np.artType } : null),

    async refresh() {
      await Promise.all([refreshOutputs(), refreshBluetooth()]);
      return snapshot();
    },
    setOutput, setVolume, testSound,
    scan, pair, connect, disconnect, forget,

    async setAirplay(enabled) {
      settings().airplay = !!enabled;
      store.saveConfig();
      if (enabled) await startAirplay(); else stopAirplay();
      return snapshot();
    },

    /** Call when the panel is renamed, so AirPlay shows the new name. */
    nameChanged() {
      if (wanted && state.airplay.name !== store.settings.name) restartAirplay().then(publish);
    },

    async start() {
      await detectShairport();
      if (caps.airplay && settings().airplay !== false) await startAirplay();
      await this.refresh().catch(() => {});
      if (caps.bluetooth) {
        setTimeout(keepSpeakerConnected, 15e3).unref();
        setInterval(keepSpeakerConnected, 45e3).unref();
      }
      publish();
    },

    stop() {
      wanted = false;
      child?.kill();
      socket?.close();
    },
  };
}
