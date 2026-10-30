// Street maps for calendar events: turns an event's address into a point
// (OpenStreetMap Nominatim) and serves map tiles to the display.

import { request } from './http.js';

export const MAP_ZOOM = 16;
const GEOCODE_GAP = 1100; // Nominatim allows one request a second
const MAX_LOOKUPS = 5;
const MISS_TTL = 24 * 3600e3;
const MAX_TILES = 150;

const VIRTUAL = /https?:\/\/|\b(zoom|teams|meet|webex|hangouts|skype|online|virtual|remote|phone|tbd)\b/i;
const ROOM = /^(room|rm|floor|fl|suite|building|bldg|conference|desk|office)\b/i;

/** The text to look up, or null if a location isn't a street address or named place. */
export function addressOf(location) {
  const text = String(location || '').split('\n').map((l) => l.trim()).filter(Boolean).join(', ');
  if (text.length < 6 || VIRTUAL.test(text) || ROOM.test(text)) return null;
  const numbered = /\d/.test(text) && /\p{L}{2}/u.test(text);
  return numbered || text.includes(',') ? text : null;
}

async function nominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' })}`;
  const res = await request(url, { timeout: 10000 });
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
  const [hit] = await res.json();
  return hit ? { lat: +hit.lat, lon: +hit.lon } : null;
}

const places = new Map(); // address -> { point, at }

/**
 * Adds `map: { lat, lon }` to events that overlap the time before `until` and
 * haven't finished. Maps are a bonus, so a failed lookup never fails the calendar.
 */
export async function addMaps(events, { previous, until, now = new Date(), lookup = nominatim, gap = GEOCODE_GAP } = {}) {
  for (const e of previous?.events || []) {
    const address = e.map && addressOf(e.location);
    if (address && !places.has(address)) places.set(address, { point: e.map, at: Date.now() });
  }
  const pick = events.filter((e) => new Date(e.start) < until && new Date(e.end) > now);
  let lookups = 0;
  for (const e of pick) {
    const address = addressOf(e.location);
    if (!address) continue;
    let known = places.get(address);
    if (!known || (!known.point && Date.now() - known.at > MISS_TTL)) {
      if (lookups >= MAX_LOOKUPS) continue;
      if (lookups++) await new Promise((r) => setTimeout(r, gap));
      try {
        known = { point: await lookup(address), at: Date.now() };
      } catch (err) {
        console.warn(`[calendar] map lookup: ${err.message}`);
        return events;
      }
      places.set(address, known);
    }
    if (known.point) e.map = known.point;
  }
  return events;
}

const tiles = new Map(); // newest last

/** One PNG map tile, kept in memory because OpenStreetMap asks apps to cache. */
export async function mapTile(x, y) {
  const key = `${x}/${y}`;
  const cached = tiles.get(key);
  if (cached) {
    tiles.delete(key);
    tiles.set(key, cached);
    return cached;
  }
  const res = await request(`https://tile.openstreetmap.org/${MAP_ZOOM}/${key}.png`, { timeout: 15000 });
  if (!res.ok) throw new Error(`Map tile responded ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  tiles.set(key, body);
  if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
  return body;
}
