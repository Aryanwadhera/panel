// A small iCalendar reader: enough to show Google, Apple, Outlook and Fastmail
// calendars correctly, including repeating events, exceptions and time zones.

import { zonedToUtc, isValidTimeZone } from './time.js';

// Outlook / Exchange feeds use Windows zone names.
const WINDOWS_ZONES = {
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev',
  'Russian Standard Time': 'Europe/Moscow',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'UTC': 'UTC',
};

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescape(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

function parseLine(line) {
  // NAME;PARAM=a;PARAM="b:c":VALUE  (colons can appear inside quoted params)
  let i = 0, quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...rawParams] = head.split(';');
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function resolveZone(tzid, fallback) {
  if (!tzid) return fallback;
  if (isValidTimeZone(tzid)) return tzid;
  if (WINDOWS_ZONES[tzid]) return WINDOWS_ZONES[tzid];
  // Some feeds prefix zones like "/mozilla.org/20050126_1/America/New_York"
  const tail = tzid.split('/').slice(-2).join('/');
  return isValidTimeZone(tail) ? tail : fallback;
}

/**
 * A point in time as written in the feed: wall-clock fields plus the zone to
 * read them in. Keeping wall-clock fields lets repeats stay at 9:00 across DST.
 */
function parseDate(value, params, fallbackTz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (params.VALUE === 'DATE' || h === undefined) {
    return { allDay: true, y: +y, m: +mo, d: +d, h: 0, mi: 0, s: 0, tz: fallbackTz };
  }
  const tz = z ? 'UTC' : resolveZone(params.TZID, fallbackTz);
  return { allDay: false, y: +y, m: +mo, d: +d, h: +h, mi: +mi, s: +(s || 0), tz };
}

const toInstant = (p) => zonedToUtc(p.y, p.m, p.d, p.h, p.mi, p.s, p.tz);

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v || '');
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * 86400 + (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

function parseRule(v) {
  const r = {};
  for (const part of v.split(';')) {
    const [k, val] = part.split('=');
    if (k && val !== undefined) r[k.toUpperCase()] = val;
  }
  return r;
}

export function parseICS(text, fallbackTz = 'UTC') {
  const events = [];
  let ev = null;
  let depth = 0; // nesting inside VEVENT (VALARM etc.)
  for (const line of unfold(text)) {
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; depth = 0; continue; }
    if (line === 'END:VEVENT') { if (ev?.start) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }
    if (line.startsWith('END:')) { depth--; continue; }
    if (depth > 0) continue;
    const { name, params, value } = parseLine(line);
    switch (name) {
      case 'UID': ev.uid = value.trim(); break;
      case 'SUMMARY': ev.title = unescape(value); break;
      case 'LOCATION': ev.location = unescape(value); break;
      case 'STATUS': ev.status = value.trim().toUpperCase(); break;
      case 'DTSTART': ev.start = parseDate(value, params, fallbackTz); break;
      case 'DTEND': ev.end = parseDate(value, params, fallbackTz); break;
      case 'DURATION': ev.duration = parseDuration(value.trim()); break;
      case 'RRULE': ev.rrule = parseRule(value.trim()); break;
      case 'RECURRENCE-ID': ev.recurrenceId = parseDate(value, params, fallbackTz); break;
      case 'EXDATE':
        for (const v of value.split(',')) {
          const p = parseDate(v, params, fallbackTz);
          if (p) ev.exdates.push(p);
        }
        break;
    }
  }
  return events;
}

const keyOf = (p) => (p.allDay ? `${p.y}-${p.m}-${p.d}` : String(toInstant(p).getTime()));

function addDays(p, n) {
  const u = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return { ...p, y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() };
}
const dow = (p) => new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function nthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const d = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return d <= daysInMonth(y, m) ? d : null;
  }
  const last = daysInMonth(y, m);
  const lastDow = new Date(Date.UTC(y, m - 1, last)).getUTCDay();
  const d = last - ((lastDow - weekday + 7) % 7) + (n + 1) * 7;
  return d >= 1 ? d : null;
}

/** Yield wall-clock start points for a repeating event, in order. */
function* occurrences(start, rule) {
  const freq = rule.FREQ;
  const interval = Math.max(1, +rule.INTERVAL || 1);
  const byday = rule.BYDAY ? rule.BYDAY.split(',').map((s) => {
    const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(s.trim());
    return m ? { n: m[1] ? +m[1] : 0, day: DAYS.indexOf(m[2]) } : null;
  }).filter(Boolean) : null;
  const bymonthday = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const bymonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null;

  for (let i = 0; i < 100000; i++) {
    if (freq === 'DAILY') {
      const p = addDays(start, i * interval);
      if (byday && !byday.some((b) => b.day === dow(p))) continue;
      if (bymonth && !bymonth.includes(p.m)) continue;
      yield p;
    } else if (freq === 'WEEKLY') {
      const weekStart = addDays(start, -((dow(start) + 6) % 7) + i * 7 * interval);
      const days = byday ? byday.map((b) => b.day) : [dow(start)];
      const offsets = days.map((d) => (d + 6) % 7).sort((a, b) => a - b);
      for (const off of offsets) yield addDays(weekStart, off);
    } else if (freq === 'MONTHLY') {
      const total = start.m - 1 + i * interval;
      const y = start.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      let days = [];
      if (byday) {
        for (const b of byday) {
          if (b.n) { const d = nthWeekday(y, m, b.day, b.n); if (d) days.push(d); }
          else for (let d = 1; d <= daysInMonth(y, m); d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.day) days.push(d);
        }
      } else if (bymonthday) {
        days = bymonthday.map((d) => (d < 0 ? daysInMonth(y, m) + d + 1 : d));
      } else {
        days = [start.d];
      }
      for (const d of days.sort((a, b) => a - b)) if (d >= 1 && d <= daysInMonth(y, m)) yield { ...start, y, m, d };
    } else if (freq === 'YEARLY') {
      const y = start.y + i * interval;
      const months = bymonth || [start.m];
      for (const m of months) {
        if (byday && byday[0]?.n) {
          const d = nthWeekday(y, m, byday[0].day, byday[0].n);
          if (d) yield { ...start, y, m, d };
        } else if (start.d <= daysInMonth(y, m)) {
          yield { ...start, y, m, d: start.d };
        }
      }
    } else {
      yield start;
      return;
    }
  }
}

/**
 * Turn parsed events into concrete instances overlapping [from, to).
 * `tz` is the panel's zone, used to anchor all-day events.
 */
export function expandEvents(events, from, to, tz) {
  const out = [];
  const overrides = new Map();
  for (const ev of events) {
    if (ev.recurrenceId && ev.uid) overrides.set(`${ev.uid}|${keyOf(ev.recurrenceId)}`, ev);
  }

  const instance = (ev, startP) => {
    const allDay = startP.allDay;
    const anchor = allDay ? { ...startP, tz } : startP;
    const start = toInstant(anchor);
    let end;
    if (ev.end) {
      const base = toInstant(allDay ? { ...ev.start, tz } : ev.start);
      const endBase = toInstant(ev.end.allDay ? { ...ev.end, tz } : ev.end);
      end = new Date(start.getTime() + (endBase - base));
    } else if (ev.duration != null) {
      end = new Date(start.getTime() + ev.duration);
    } else {
      end = allDay ? toInstant({ ...addDays(startP, 1), tz }) : start;
    }
    return { start, end, allDay };
  };

  const push = (ev, inst) => {
    if (ev.status === 'CANCELLED') return;
    const overlaps = (inst.end > from && inst.start < to) || (inst.start >= from && inst.start < to);
    if (!overlaps) return;
    out.push({
      title: ev.title || 'Untitled',
      location: ev.location || '',
      start: inst.start.toISOString(),
      end: inst.end.toISOString(),
      allDay: inst.allDay,
    });
  };

  for (const ev of events) {
    if (ev.recurrenceId) {
      push(ev, instance(ev, ev.start));
      continue;
    }
    if (!ev.rrule) {
      push(ev, instance(ev, ev.start));
      continue;
    }
    const excluded = new Set(ev.exdates.map(keyOf));
    const count = ev.rrule.COUNT ? +ev.rrule.COUNT : Infinity;
    const until = ev.rrule.UNTIL ? parseDate(ev.rrule.UNTIL, {}, ev.start.tz) : null;
    const untilTime = until ? toInstant(until).getTime() + (until.allDay ? 86400000 - 1 : 0) : Infinity;
    const startTime = toInstant(ev.start).getTime();
    let n = 0;
    for (const p of occurrences(ev.start, ev.rrule)) {
      const t = toInstant(p).getTime();
      if (t < startTime) continue;
      if (t > untilTime || n >= count) break;
      n++;
      if (t >= to.getTime()) break;
      const key = keyOf(p);
      if (excluded.has(key) || overrides.has(`${ev.uid}|${key}`)) continue;
      push(ev, instance(ev, p));
    }
  }

  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : (b.allDay - a.allDay)));
}

