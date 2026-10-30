// Parsers for the text that pactl, bluetoothctl and shairport-sync print.
// Kept separate from the code that runs them so they can be tested anywhere.

/** `pactl list sinks` → [{ name, description, kind, state, volume, muted }] */
export function parseSinks(text) {
  const sinks = [];
  for (const block of String(text).split(/^Sink #/m).slice(1)) {
    const get = (key) => new RegExp(`^\\s*${key}: (.*)$`, 'm').exec(block)?.[1].trim();
    const prop = (key) => new RegExp(`^\\s*${key.replace(/\./g, '\\.')} = "(.*)"$`, 'm').exec(block)?.[1];
    const name = get('Name');
    if (!name || name === 'auto_null') continue;
    const volume = /(\d+)%/.exec(get('Volume') || '');
    sinks.push({
      name,
      description: get('Description') || name,
      kind: sinkKind(name, prop('device.api'), prop('device.bus'), get('Description') || ''),
      state: (get('State') || '').toLowerCase(),
      volume: volume ? +volume[1] : null,
      muted: get('Mute') === 'yes',
    });
  }
  return sinks;
}

function sinkKind(name, api, bus, description) {
  const s = `${name} ${description}`.toLowerCase();
  if (api === 'bluez5' || s.startsWith('bluez')) return 'bluetooth';
  if (/hdmi/.test(s)) return 'hdmi';
  if (bus === 'usb' || /usb/.test(s)) return 'usb';
  if (/headphone|analog|bcm2835|stereo-fallback/.test(s)) return 'headphones';
  return 'other';
}

/** `bluetoothctl info <mac>` → device details */
export function parseBtInfo(text, mac) {
  const get = (key) => new RegExp(`^\\s*${key}: (.*)$`, 'm').exec(text)?.[1].trim();
  const uuids = [...String(text).matchAll(/^\s*UUID: (.*?)\s*\(/gm)].map((m) => m[1]);
  const icon = get('Icon') || '';
  return {
    mac,
    name: get('Alias') || get('Name') || mac,
    icon,
    audio: /^audio-/.test(icon) || uuids.some((u) => /Audio Sink|Advanced Audio|Headset|Handsfree/i.test(u)),
    paired: get('Paired') === 'yes',
    trusted: get('Trusted') === 'yes',
    connected: get('Connected') === 'yes',
  };
}

/** `bluetoothctl devices` → [{ mac, name }] */
export function parseBtDevices(text) {
  return [...String(text).matchAll(/^Device ([0-9A-F:]{17}) (.*)$/gim)]
    .map((m) => ({ mac: m[1].toUpperCase(), name: m[2].trim() }));
}

/**
 * shairport-sync sends metadata as UDP packets: a 4-byte type ("core",
 * "ssnc"), a 4-byte code ("minm" = title, "PICT" = cover art…) and the data.
 * Items too big for one packet (cover art) arrive as "ssnc" "chnk" packets:
 * chunk index and count (uint32, big-endian), the real type and code, then
 * a slice of the data. Calls onItem(type, code, Buffer) once per whole item.
 */
export function createPacketReader(onItem) {
  const pending = new Map();
  return (msg) => {
    if (msg.length < 8) return;
    const type = msg.toString('latin1', 0, 4);
    const code = msg.toString('latin1', 4, 8);
    if (type !== 'ssnc' || code !== 'chnk') return onItem(type, code, msg.subarray(8));
    if (msg.length < 24) return;
    const index = msg.readUInt32BE(8);
    const total = msg.readUInt32BE(12);
    const key = msg.toString('latin1', 16, 24);
    if (!total || index >= total || total > 2000) return;
    let item = pending.get(key);
    // Start over if the count changed or a previous, incomplete item went stale.
    if (!item || item.total !== total || Date.now() - item.at > 5000) {
      item = { total, parts: new Array(total), received: 0, at: Date.now() };
      pending.set(key, item);
    }
    if (!item.parts[index]) {
      item.parts[index] = Buffer.from(msg.subarray(24));
      item.received++;
    }
    if (item.received === total) {
      pending.delete(key);
      onItem(key.slice(0, 4), key.slice(4), Buffer.concat(item.parts));
    }
  };
}

/** Minimal WAV encoder for the test chime. */
export function chimeWav() {
  const rate = 44100;
  const notes = [[659.25, 0, 0.5], [880, 0.16, 0.9]]; // E5 then A5, overlapping
  const length = Math.floor(rate * 1.1);
  const samples = new Float32Array(length);
  for (const [freq, start, dur] of notes) {
    const s0 = Math.floor(start * rate);
    for (let i = 0; i < dur * rate && s0 + i < length; i++) {
      const t = i / rate;
      const env = Math.min(1, t * 200) * Math.exp(-t * 5);
      samples[s0 + i] += 0.32 * env * (Math.sin(2 * Math.PI * freq * t) + 0.2 * Math.sin(4 * Math.PI * freq * t));
    }
  }
  const buf = Buffer.alloc(44 + length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}
