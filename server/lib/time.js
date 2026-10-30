// Time zone helpers built on Intl, so the panel can run in any zone
// regardless of what the Pi's system clock is set to.

const partsCache = new Map();

function formatter(tz) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { formatter(tz); return true; } catch { return false; }
}

/** Wall-clock fields of `date` as seen in `tz`. */
export function tzParts(date, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(date)) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

/** Offset of `tz` from UTC at `date`, in minutes. */
export function tzOffset(date, tz) {
  const p = tzParts(date, tz);
  const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return (asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** Convert a wall-clock time in `tz` to a real instant. */
export function zonedToUtc(y, m, d, h = 0, mi = 0, s = 0, tz = 'UTC') {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  if (tz === 'UTC') return new Date(guess);
  const off = tzOffset(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffset(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

/** Midnight (in `tz`) of the day `date` falls on, shifted by `days`. */
export function startOfDay(date, tz, days = 0) {
  const p = tzParts(date, tz);
  const u = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return zonedToUtc(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), 0, 0, 0, tz);
}

export function dateKey(date, tz) {
  const p = tzParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function fmtTime(date, tz, clock24) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: !clock24,
  }).format(date);
}

export function fmtDay(date, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
  }).format(date);
}
