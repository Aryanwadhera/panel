import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDisplayPower } from '../server/display.js';

test('createDisplayPower initial state is on', () => {
  const dp = createDisplayPower();
  assert.equal(dp.on, true);
  assert.equal(dp.state.on, true);
});

test('createDisplayPower set and toggle updates state and fires callback', async () => {
  const events = [];
  const dp = createDisplayPower({
    onChange: (on) => events.push(on),
  });

  const offRes = await dp.set(false);
  assert.equal(offRes, false);
  assert.equal(dp.on, false);
  assert.deepEqual(events, [false]);

  const onRes = await dp.set(true);
  assert.equal(onRes, true);
  assert.equal(dp.on, true);
  assert.deepEqual(events, [false, true]);

  const toggleRes = await dp.toggle();
  assert.equal(toggleRes, false);
  assert.equal(dp.on, false);
  assert.deepEqual(events, [false, true, false]);

  const toggleRes2 = await dp.toggle();
  assert.equal(toggleRes2, true);
  assert.equal(dp.on, true);
  assert.deepEqual(events, [false, true, false, true]);
});

test('display power HTTP routes and quick turn off URL', async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tmpData = path.join(os.tmpdir(), `panel-test-${Date.now()}`);
  fs.mkdirSync(tmpData, { recursive: true });

  const port = 8991;
  const proc = fork(path.join(root, 'server/index.js'), [], {
    env: { ...process.env, PORT: String(port), PANEL_DATA: tmpData, PANEL_NO_AUTH: '1' },
    stdio: 'pipe',
  });

  t.after(() => {
    proc.kill('SIGTERM');
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  });

  // Wait for server to start
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) { ready = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(ready, true, 'Server should start');

  // 1. Initial status has displayPower: true
  const stateRes = await fetch(`${base}/api/display/state`);
  const state = await stateRes.json();
  assert.equal(state.displayPower, true);

  // 2. GET /off returns HTML and turns display off
  const offHtmlRes = await fetch(`${base}/off`);
  assert.equal(offHtmlRes.status, 200);
  assert.equal(offHtmlRes.headers.get('content-type')?.includes('text/html'), true);
  const offHtml = await offHtmlRes.text();
  assert.match(offHtml, /Display is off/);
  assert.match(offHtml, /Turn display on/);
  assert.match(offHtml, /\/off<\/code>/);

  // Check state after /off
  const stateOffRes = await fetch(`${base}/api/display/power`);
  const stateOff = await stateOffRes.json();
  assert.equal(stateOff.on, false);
  assert.equal(stateOff.power, false);

  // 3. GET /off with Accept: application/json returns JSON
  const offJsonRes = await fetch(`${base}/off`, { headers: { Accept: 'application/json' } });
  assert.equal(offJsonRes.status, 200);
  const offJson = await offJsonRes.json();
  assert.deepEqual(offJson, { ok: true, on: false, power: false });

  // 4. POST /on turns display on
  const onRes = await fetch(`${base}/on`, { method: 'POST' });
  const onData = await onRes.json();
  assert.deepEqual(onData, { ok: true, on: true, power: true });

  // 5. GET /display/toggle toggles display
  const toggleRes = await fetch(`${base}/display/toggle`, { method: 'POST' });
  const toggleData = await toggleRes.json();
  assert.deepEqual(toggleData, { ok: true, on: false, power: false });

  // 6. POST /api/display/power allows explicit on/off and toggle
  const apiPowerRes = await fetch(`${base}/api/display/power`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: true }),
  });
  const apiPowerData = await apiPowerRes.json();
  assert.deepEqual(apiPowerData, { ok: true, on: true, power: true });

  // 7. GET /display?power=off turns off display
  await fetch(`${base}/display?power=off`);
  const checkOff = await (await fetch(`${base}/api/display/power`)).json();
  assert.equal(checkOff.on, false);
});
