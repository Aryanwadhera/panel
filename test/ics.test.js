import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, expandEvents } from '../server/lib/ics.js';
import { zonedToUtc } from '../server/lib/time.js';

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const tz = 'America/New_York';
const day = (y, m, d) => [zonedToUtc(y, m, d, 0, 0, 0, tz), zonedToUtc(y, m, d + 1, 0, 0, 0, tz)];

test('single timed event with TZID', () => {
  const ics = wrap(`BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Standup\r\nDTSTART;TZID=America/New_York:20261030T093000\r\nDTEND;TZID=America/New_York:20261030T100000\r\nEND:VEVENT`);
  const [e] = expandEvents(parseICS(ics, tz), ...day(2026, 10, 30), tz);
  assert.equal(e.title, 'Standup');
  assert.equal(e.start, '2026-10-30T13:30:00.000Z');
  assert.equal(e.end, '2026-10-30T14:00:00.000Z');
});

test('weekly repeat keeps wall-clock time across DST, honours EXDATE and overrides', () => {
  const ics = wrap([
    'BEGIN:VEVENT', 'UID:w', 'SUMMARY:Gym', 'DTSTART;TZID=America/New_York:20261001T070000', 'DTEND;TZID=America/New_York:20261001T080000',
    'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', 'EXDATE;TZID=America/New_York:20261105T070000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:w', 'SUMMARY:Gym (late)', 'RECURRENCE-ID;TZID=America/New_York:20261110T070000',
    'DTSTART;TZID=America/New_York:20261110T090000', 'DTEND;TZID=America/New_York:20261110T100000', 'END:VEVENT',
  ].join('\r\n'));
  const events = parseICS(ics, tz);
  const from = zonedToUtc(2026, 11, 1, 0, 0, 0, tz);
  const to = zonedToUtc(2026, 11, 13, 0, 0, 0, tz);
  const got = expandEvents(events, from, to, tz).map((e) => [e.title, e.start]);
  assert.deepEqual(got, [
    ['Gym', '2026-11-03T12:00:00.000Z'], // after DST ends: 7am EST = 12:00Z
    ['Gym (late)', '2026-11-10T14:00:00.000Z'],
    ['Gym', '2026-11-12T12:00:00.000Z'],
  ]);
});

test('all-day events and folded lines', () => {
  const ics = wrap('BEGIN:VEVENT\r\nUID:h\r\nSUMMARY:Long \r\n weekend\r\nDTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261102\r\nEND:VEVENT');
  const [e] = expandEvents(parseICS(ics, tz), ...day(2026, 10, 31), tz);
  assert.equal(e.title, 'Long weekend');
  assert.equal(e.allDay, true);
});

test('monthly by nth weekday with COUNT, UTC times', () => {
  const ics = wrap('BEGIN:VEVENT\r\nUID:m\r\nSUMMARY:Review\r\nDTSTART:20260101T150000Z\r\nDURATION:PT1H\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=12\r\nEND:VEVENT');
  const got = expandEvents(parseICS(ics, tz), new Date('2026-10-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'), tz);
  assert.deepEqual(got.map((e) => e.start), ['2026-10-30T15:00:00.000Z', '2026-11-27T15:00:00.000Z', '2026-12-25T15:00:00.000Z']);
  const capped = expandEvents(parseICS(ics.replace('COUNT=12', 'COUNT=10'), tz), new Date('2026-10-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'), tz);
  assert.equal(capped.length, 1);
});

test('cancelled events are hidden', () => {
  const ics = wrap('BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Nope\r\nSTATUS:CANCELLED\r\nDTSTART:20261030T150000Z\r\nEND:VEVENT');
  assert.equal(expandEvents(parseICS(ics, tz), ...day(2026, 10, 30), tz).length, 0);
});
