import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, createFocus } from '../server/focus.js';
import { briefDue } from '../server/widgets/summary.js';
import { cleanRecipe, resolveRecipe, shareRecipe } from '../server/gallery.js';

const settings = { focus: { enabled: true, minutes: 5 } };
const now = Date.parse('2026-10-30T15:00:00Z');
const cal = (e) => ({ widgets: [{ id: 'c', type: 'calendar' }], state: { c: { data: { events: [e] } } }, settings, now });

test('an event takes focus only in the minutes before it starts', () => {
  const ev = (mins) => ({ title: 'Standup', start: new Date(now + mins * 60e3).toISOString() });
  assert.equal(candidates(cal(ev(4)))[0]?.kind, 'event');
  assert.equal(candidates(cal(ev(10))).length, 0);
  assert.equal(candidates(cal(ev(-5))).length, 0);
  assert.equal(candidates(cal({ ...ev(4), allDay: true })).length, 0);
  assert.equal(candidates({ ...cal(ev(4)), settings: { focus: { enabled: false } } }).length, 0);
});

test('leave time comes before the event, and a dismissed item stays away', () => {
  const start = new Date(now + 30 * 60e3).toISOString();
  const leaveBy = new Date(now - 60e3).toISOString();
  const event = { title: 'Dinner', start, travel: { minutes: 25, leaveBy } };
  assert.equal(candidates(cal(event))[0].kind, 'leave');
  const seen = [];
  const f = createFocus({ store: { config: { widgets: cal(event).widgets }, state: cal(event).state, settings }, onChange: (c) => seen.push(c?.kind ?? null) });
  f.tick(now);
  f.dismiss(now);
  f.tick(now + 5000);
  assert.deepEqual(seen, ['leave', null]);
});

test('an outage shows for a minute, then gets out of the way', () => {
  const widgets = [{ id: 's', type: 'status' }];
  const state = { s: { data: { checks: [{ name: 'Shop', ok: false, code: 500 }] } } };
  const seen = [];
  const f = createFocus({ store: { config: { widgets }, state, settings }, onChange: (c) => seen.push(c?.title ?? null) });
  f.tick(now);
  f.tick(now + 61e3);
  assert.deepEqual(seen, ['Shop is down', null]);
});

test('the brief runs on its timetable', () => {
  const tz = 'UTC';
  const at = (s) => Date.parse(`2026-10-30T${s}:00Z`);
  const daily = { every: '1440', at: '07:00' };
  assert.equal(briefDue(daily, at('06:59'), at('07:00'), tz), true);
  assert.equal(briefDue(daily, at('07:00'), at('15:00'), tz), false);
  assert.equal(briefDue({ every: '720', at: '07:00' }, at('07:00'), at('19:00'), tz), true);
  assert.equal(briefDue({ every: '720', at: '07:00' }, at('19:00'), at('23:00'), tz), false);
  assert.equal(briefDue({ every: '60', at: '07:00' }, at('14:59'), at('15:00'), tz), true);
  assert.equal(briefDue({ every: '60', at: '07:00' }, at('15:00'), at('15:30'), tz), false);
});

test('shared widgets carry settings only, never secrets', async () => {
  const w = { title: 'Revenue', type: 'api', w: 1, h: 1, config: { url: 'https://x.dev/a', authToken: 'sk-secret', headers: 'X: y', view: 'stat' } };
  const shared = shareRecipe(w);
  assert.equal(JSON.stringify(shared).includes('sk-secret'), false);
  assert.equal(shared.config.headers, undefined);
  const r = await resolveRecipe(JSON.stringify({ ...shared, config: { ...shared.config, authToken: 'planted', evil: 'x' } }));
  assert.equal(r.host, 'x.dev');
  assert.equal(r.config.authToken, undefined);
  assert.equal(r.config.evil, undefined);
  assert.throws(() => cleanRecipe({ name: 'x', type: 'nope' }));
  assert.throws(() => cleanRecipe({ name: 'x', type: 'photos' }));
  await assert.rejects(resolveRecipe('http://insecure.dev/w.json'));
});
