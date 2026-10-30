import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSinks, parseBtInfo, parseBtDevices, createPacketReader, chimeWav } from '../server/lib/audio-parse.js';

const SINKS = `Sink #47
	State: SUSPENDED
	Name: alsa_output.platform-bcm2835_audio.stereo-fallback
	Description: Built-in Audio Stereo
	Mute: no
	Volume: front-left: 26214 /  40% / -23.88 dB,   front-right: 26214 /  40% / -23.88 dB
	Properties:
		device.api = "alsa"
		media.class = "Audio/Sink"

Sink #63
	State: RUNNING
	Name: bluez_output.F8_DF_15_A1_22_0C.1
	Description: JBL Flip 5
	Mute: yes
	Volume: front-left: 52428 /  80% / -5.81 dB,   front-right: 52428 /  80% / -5.81 dB
	Properties:
		device.api = "bluez5"

Sink #70
	State: IDLE
	Name: alsa_output.usb-Generic_USB_Audio-00.analog-stereo
	Description: USB Audio Analog Stereo
	Mute: no
	Volume: front-left: 65536 / 100% / 0.00 dB
	Properties:
		device.api = "alsa"
		device.bus = "usb"

Sink #71
	State: SUSPENDED
	Name: alsa_output.platform-fef00700.hdmi.hdmi-stereo
	Description: Built-in Audio Digital Stereo (HDMI)
	Mute: no
	Volume: front-left: 65536 / 100% / 0.00 dB
`;

test('pactl sinks', () => {
  const s = parseSinks(SINKS);
  assert.deepEqual(s.map((x) => x.kind), ['headphones', 'bluetooth', 'usb', 'hdmi']);
  assert.equal(s[1].description, 'JBL Flip 5');
  assert.equal(s[1].volume, 80);
  assert.equal(s[1].muted, true);
  assert.equal(s[1].state, 'running');
});

test('bluetoothctl output', () => {
  const info = `Device F8:DF:15:A1:22:0C (public)
	Name: JBL Flip 5
	Alias: JBL Flip 5
	Class: 0x00240414
	Icon: audio-card
	Paired: yes
	Trusted: yes
	Connected: no
	UUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)`;
  const d = parseBtInfo(info, 'F8:DF:15:A1:22:0C');
  assert.equal(d.name, 'JBL Flip 5');
  assert.equal(d.audio, true);
  assert.equal(d.paired, true);
  assert.equal(d.connected, false);
  assert.deepEqual(parseBtDevices('Device F8:DF:15:A1:22:0C JBL Flip 5\nDevice 11:22:33:44:55:66 Keyboard'), [
    { mac: 'F8:DF:15:A1:22:0C', name: 'JBL Flip 5' }, { mac: '11:22:33:44:55:66', name: 'Keyboard' },
  ]);
});

test('shairport metadata packets, including chunked cover art', () => {
  const pkt = (type, code, data = '') => Buffer.concat([Buffer.from(type + code, 'latin1'), Buffer.from(data)]);
  const art = Buffer.alloc(150000, 7);
  const chunks = [];
  for (let i = 0, n = Math.ceil(art.length / 60000); i < n; i++) {
    const head = Buffer.alloc(16);
    head.write('ssncchnk', 0, 'latin1');
    head.writeUInt32BE(i, 8);
    head.writeUInt32BE(n, 12);
    chunks.push(Buffer.concat([head, Buffer.from('ssncPICT', 'latin1'), art.subarray(i * 60000, (i + 1) * 60000)]));
  }
  const got = [];
  const read = createPacketReader((t, c, d) => got.push([t, c, d.length > 100 ? d.length : d.toString()]));
  read(pkt('ssnc', 'pbeg'));
  read(pkt('core', 'minm', 'Holocene'));
  // chunks can arrive out of order
  read(chunks[2]); read(chunks[0]); read(chunks[1]);
  read(pkt('core', 'asar', 'Bon Iver'));
  assert.deepEqual(got, [['ssnc', 'pbeg', ''], ['core', 'minm', 'Holocene'], ['ssnc', 'PICT', 150000], ['core', 'asar', 'Bon Iver']]);
});

test('chime is a valid wav', () => {
  const w = chimeWav();
  assert.equal(w.toString('latin1', 0, 4), 'RIFF');
  assert.equal(w.readUInt32LE(40), w.length - 44);
});
