import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressOf, addMaps } from '../server/lib/map.js';

test('finds addresses and skips rooms and video calls', () => {
  assert.equal(addressOf('1600 Amphitheatre Pkwy, Mountain View, CA'), '1600 Amphitheatre Pkwy, Mountain View, CA');
  assert.equal(addressOf('Blue Bottle\n66 Mint St\nSan Francisco'), 'Blue Bottle, 66 Mint St, San Francisco');
  assert.equal(addressOf('Blue Bottle, San Francisco'), 'Blue Bottle, San Francisco');
  for (const no of ['', null, 'Zoom Meeting', 'https://meet.google.com/abc-defg', 'Microsoft Teams, online', 'Room 4B', 'Conference Room 2, Floor 3', 'Home']) {
    assert.equal(addressOf(no), null, String(no));
  }
});

test('looks up only today’s unfinished events, once per address', async () => {
  const now = new Date('2026-10-30T15:00:00Z');
  const until = new Date('2026-10-31T04:00:00Z');
  const ev = (location, start, end) => ({ location, start, end });
  const events = [
    ev('1 Past St, Boston', '2026-10-30T13:00:00Z', '2026-10-30T14:00:00Z'),
    ev('2 Today St, Boston', '2026-10-30T16:00:00Z', '2026-10-30T17:00:00Z'),
    ev('2 Today St, Boston', '2026-10-30T18:00:00Z', '2026-10-30T19:00:00Z'),
    ev('Room 4B', '2026-10-30T18:00:00Z', '2026-10-30T19:00:00Z'),
    ev('3 Nowhere St, Boston', '2026-10-30T20:00:00Z', '2026-10-30T21:00:00Z'),
    ev('4 Tomorrow St, Boston', '2026-10-31T16:00:00Z', '2026-10-31T17:00:00Z'),
  ];
  const asked = [];
  const lookup = async (q) => { asked.push(q); return q.startsWith('2') ? { lat: 42.3, lon: -71 } : null; };
  await addMaps(events, { until, now, lookup, gap: 0 });
  assert.deepEqual(asked, ['2 Today St, Boston', '3 Nowhere St, Boston']);
  assert.deepEqual(events.map((e) => !!e.map), [false, true, true, false, false, false]);
});

test('a lookup failure leaves the calendar working', async () => {
  const events = [{ location: '5 Offline St, Boston', start: '2026-10-30T16:00:00Z', end: '2026-10-30T17:00:00Z' }];
  const lookup = async () => { throw new Error('offline'); };
  await addMaps(events, { until: new Date('2026-10-31T04:00:00Z'), now: new Date('2026-10-30T15:00:00Z'), lookup });
  assert.equal(events[0].map, undefined);
});
