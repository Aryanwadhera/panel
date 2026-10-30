// The widget gallery. A shared widget is a recipe: plain settings for a built-in
// widget type, never code, so installing one can't run anything on the Pi.

import fs from 'node:fs';
import { request } from './lib/http.js';
import { types } from './widgets/index.js';

const REMOTE = 'https://raw.githubusercontent.com/Aryanwadhera/panel/main/gallery/index.json';
const LOCAL = new URL('../gallery/index.json', import.meta.url);
const MAX_BYTES = 64 * 1024;
const CACHE_MS = 3600e3;
const TOKEN = /^(bearer|query|basic|header(:[\w-]+)?)$/;

const text = (v, max) => String(v ?? '').trim().slice(0, max);

function cleanInput(i) {
  if (!i || typeof i !== 'object' || !/^\w+$/.test(i.key || '')) return null;
  return {
    key: i.key, label: text(i.label || i.key, 80), placeholder: text(i.placeholder, 120), default: text(i.default, 200),
    optional: !!i.optional, ...(TOKEN.test(i.token || '') ? { token: i.token } : {}),
  };
}

/** Keep only what a recipe may contain. Throws with a reason a person can act on. */
export function cleanRecipe(raw) {
  const def = types[raw?.type];
  if (!def || def.live) throw new Error('This isn’t a Panel widget');
  const known = new Map(def.fields.map((f) => [f.key, f]));
  const config = {};
  for (const [k, v] of Object.entries(raw.config || {})) {
    if (known.has(k) && !known.get(k).secret && ['string', 'number', 'boolean'].includes(typeof v)) config[k] = typeof v === 'string' ? v.slice(0, 4000) : v;
  }
  const name = text(raw.name || raw.title, 60);
  if (!name) throw new Error('This widget has no name');
  let host = null;
  try { host = new URL(config.url).host; } catch { /* not every widget calls out */ }
  return {
    id: text(raw.id, 60) || name, name, type: def.type, group: text(raw.group, 40) || 'Community',
    description: text(raw.description, 200), title: text(raw.title || name, 60),
    w: Math.min(6, Math.max(1, +raw.w || def.size.w)), h: Math.min(4, Math.max(1, +raw.h || def.size.h)),
    inputs: (Array.isArray(raw.inputs) ? raw.inputs : []).slice(0, 8).map(cleanInput).filter(Boolean),
    config, host,
  };
}

/** A pasted recipe, or a link to one. GitHub file pages are understood too. */
export async function resolveRecipe(source) {
  const s = String(source || '').trim();
  if (!s) throw new Error('Paste a link or a shared widget');
  if (s.startsWith('{')) {
    try { return cleanRecipe(JSON.parse(s)); } catch (err) { throw err instanceof SyntaxError ? new Error('That shared widget is incomplete. Copy it again.') : err; }
  }
  if (!/^https:\/\//i.test(s)) throw new Error('Paste an https link or a shared widget');
  const url = s.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//i, 'https://raw.githubusercontent.com/$1/');
  const res = await request(url, { timeout: 10000 });
  if (!res.ok) throw new Error(`That link responded ${res.status}`);
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new Error('That file is too big to be a widget');
  try { return cleanRecipe(JSON.parse(body)); } catch (err) { throw err instanceof SyntaxError ? new Error('That link isn’t a Panel widget') : err; }
}

/** The settings of a widget, minus anything private, ready to pass to a friend. */
export function shareRecipe(w) {
  const def = types[w.type];
  const config = {};
  for (const f of def.fields) if (!f.secret && w.config?.[f.key] !== undefined) config[f.key] = w.config[f.key];
  return { panel: 1, name: w.title, type: w.type, title: w.title, w: w.w, h: w.h, config };
}

let cache = { at: 0, items: null };

/** Newest list from GitHub, falling back to the copy that shipped with Panel. */
export async function loadGallery() {
  if (cache.items && Date.now() - cache.at < CACHE_MS) return cache.items;
  let raw;
  try {
    const res = await request(REMOTE, { timeout: 5000 });
    if (!res.ok) throw new Error(String(res.status));
    raw = await res.json();
  } catch {
    raw = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
  }
  const items = raw.flatMap((r) => { try { return [cleanRecipe(r)]; } catch { return []; } });
  cache = { at: Date.now(), items };
  return items;
}
