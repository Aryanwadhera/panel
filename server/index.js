import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

import { Store, DATA_DIR, rid } from './store.js';
import { createHub } from './events.js';
import { createAuth, isLocal } from './auth.js';
import { Scheduler } from './scheduler.js';
import { types, catalog, defaultConfig, viewOf } from './widgets/index.js';
import { buildPrompt } from './widgets/summary.js';
import { previewApi } from './widgets/api.js';
import { SAMPLES } from './lib/views.js';
import { HttpError, VERSION, fetchJson } from './lib/http.js';
import { isValidTimeZone, tzParts } from './lib/time.js';
import { complete, listModels } from './lib/openrouter.js';
import { mapTile } from './lib/map.js';
import { createFocus } from './focus.js';
import { createPhotos } from './photos.js';
import { loadGallery, resolveRecipe, shareRecipe } from './gallery.js';
import { createUpdater } from './updater.js';
import { createAudio } from './audio.js';
import { createDisplayPower } from './display.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const BOOT_ID = rid(4);
const MASK = '••••';

const store = new Store();
const hub = createHub();
const auth = createAuth(store, () => broadcastState());
const scheduler = new Scheduler(store, (id) => hub.send('widget', publicWidget(store.widget(id))));
let displaySize = null;
const audio = createAudio({
  store,
  dataDir: DATA_DIR,
  onChange: (s) => hub.send('audio', s),
  onNowPlaying: () => {
    for (const w of store.config.widgets) if (w.type === 'nowplaying') hub.send('widget', publicWidget(w));
  },
});
scheduler.liveData = () => audio.nowPlaying();
const photos = createPhotos(DATA_DIR);
const focus = createFocus({ store, onChange: (f) => hub.send('focus', f) });
const LIVE = { nowplaying: () => audio.nowPlaying(), photos: () => ({ photos: photos.list() }) };
const updater = createUpdater({
  root: ROOT,
  onChange: (u) => hub.send('update', u),
  autoUpdateEnabled: () => !!store.settings.autoUpdate,
  // Install automatic updates between 3 and 6 AM, panel time.
  isQuietHour: () => { const h = tzParts(new Date(), store.settings.timezone).h; return h >= 3 && h < 6; },
});
const displayPower = createDisplayPower({
  onChange: (on) => hub.send('display:power', { on }),
});

// ---------------------------------------------------------------- serializers

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function system() {
  const suffix = PORT === 80 ? '' : `:${PORT}`;
  const hostname = os.hostname().split('.')[0];
  const ips = lanAddresses();
  return {
    version: VERSION,
    hostname,
    ips,
    port: PORT,
    urls: {
      name: `http://${hostname}.local${suffix}`,
      ip: ips[0] ? `http://${ips[0]}${suffix}` : null,
    },
  };
}

function publicSettings() {
  const s = store.settings;
  return {
    name: s.name, timezone: s.timezone, units: s.units, clock24: s.clock24,
    theme: s.theme, nightStart: s.nightStart, nightEnd: s.nightEnd, grid: s.grid,
    location: s.location ? { name: s.location.name } : null,
    aiReady: !!s.ai.apiKey,
    focus: s.focus,
  };
}

function publicWidget(w) {
  if (!w) return null;
  const def = types[w.type];
  const st = store.state[w.id] || {};
  return {
    id: w.id, type: w.type, view: viewOf(w),
    title: w.title, w: w.w, h: w.h,
    props: def?.display?.(w.config || {}) ?? {},
    data: def?.live ? LIVE[w.type]() : st.data ?? null,
    updatedAt: st.updatedAt ?? null,
    error: st.error ?? null,
  };
}

const masked = (v) => (v ? `${MASK}${String(v).slice(-4)}` : '');

function adminWidget(w) {
  const def = types[w.type];
  const config = { ...w.config };
  for (const f of def?.fields || []) if (f.secret && config[f.key]) config[f.key] = masked(config[f.key]);
  return { ...publicWidget(w), config, token: def?.ingest ? w.token : undefined };
}

let qrCache = { text: '', svg: '' };
async function qrSvg(text) {
  if (qrCache.text !== text) {
    qrCache = { text, svg: await QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#0000' } }) };
  }
  return qrCache.svg;
}

async function snapshot() {
  const sys = system();
  const p = auth.pairing();
  const base = sys.urls.ip || sys.urls.name;
  return {
    bootId: BOOT_ID,
    setupComplete: store.config.setupComplete,
    settings: publicSettings(),
    widgets: store.config.widgets.filter((w) => !w.draft).map(publicWidget),
    focus: focus.current,
    system: sys,
    displayPower: displayPower.on,
    pairing: p ? {
      code: p.code,
      expires: Number.isFinite(p.expires) ? p.expires : null,
      qr: await qrSvg(`${base}/?code=${p.code}`),
    } : null,
  };
}

async function broadcastState() {
  hub.send('state', await snapshot());
}

// ---------------------------------------------------------------- http utils

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  const type = req.headers['content-type'] || '';
  const trimmed = raw.trim();
  // Check for JSON first: `curl -d '{...}'` labels JSON as a form post.
  if (type.includes('json') || /^[[{]/.test(trimmed)) {
    try { return JSON.parse(trimmed); } catch { throw new HttpError(400, 'Body is not valid JSON'); }
  }
  if (/^-?\d[\d.,]*$/.test(trimmed)) return Number(trimmed.replace(/,/g, ''));
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return { text: trimmed };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function serveFile(res, file) {
  const resolved = path.resolve(WEB, file);
  if (!resolved.startsWith(WEB + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(resolved, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------------------------------------------------------------- routing

const routes = [];
function route(method, pattern, handler, { open = false } = {}) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, handler, open });
}

function findWidget(id) {
  const w = store.widget(id);
  if (!w) throw new HttpError(404, 'No such widget');
  return w;
}

function clampSize(w, h) {
  const { cols, rows } = store.settings.grid;
  return {
    w: Math.min(cols, Math.max(1, Math.round(+w) || 1)),
    h: Math.min(rows, Math.max(1, Math.round(+h) || 1)),
  };
}

function cleanConfig(type, incoming = {}, existing = {}) {
  const def = types[type];
  const out = { ...existing };
  for (const f of def.fields) {
    if (!(f.key in incoming) || f.type === 'tasks') continue;
    let v = incoming[f.key];
    if (f.secret && typeof v === 'string' && v.startsWith(MASK)) continue; // unchanged
    if (f.type === 'toggle') v = !!v;
    else if (f.type === 'number') v = v === '' || v == null ? null : Number(v);
    else if (f.type === 'location') v = v && Number.isFinite(+v.lat) ? { name: String(v.name || '').slice(0, 80), lat: +v.lat, lon: +v.lon } : null;
    else if (v != null) v = String(v).slice(0, 4000);
    out[f.key] = v;
  }
  return out;
}

function changed() {
  store.saveConfig();
  broadcastState();
}

// Public

route('GET', '/api/status', (req) => ({
  name: store.settings.name,
  authed: auth.authed(req),
  setupComplete: store.config.setupComplete,
  version: VERSION,
  bootId: BOOT_ID,
}), { open: true });

route('POST', '/api/pair/request', (req) => {
  const p = auth.request();
  // The CLI on the Pi itself is allowed to read the code (`panel pair`).
  return isLocal(req) ? { ok: true, code: p.code } : { ok: true };
}, { open: true });

route('POST', '/api/pair/confirm', async (req, res) => {
  const body = await readBody(req, 10_000);
  const r = auth.confirm(body.code, req);
  if (r.error) {
    const messages = {
      invalid: 'That code didn’t match. Check the screen and try again.',
      expired: 'That code expired. We’ve put a fresh one on the screen.',
      'too-many': 'Too many tries. There’s a new code on the screen.',
    };
    if (r.error === 'expired') auth.request();
    throw new HttpError(400, messages[r.error]);
  }
  send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie(r.token) });
}, { open: true });

route('POST', '/api/pair/dismiss', () => {
  auth.dismiss();
  return { ok: true };
});

route('POST', '/api/logout', (req, res) => {
  const s = auth.session(req);
  if (s) {
    store.config.sessions = store.config.sessions.filter((x) => x !== s);
    store.saveConfig();
  }
  send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie('', 0) });
}, { open: true });

// Webhooks authenticate with the widget's own token instead of a session.
route('POST', '/hook/:id', async (req, res, { id }, url) => {
  const w = store.widget(id);
  const def = w && types[w.type];
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-panel-token'] || url.searchParams.get('token') || '';
  const ok = w && given.length === w.token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(w.token));
  if (!ok) throw new HttpError(404, 'Unknown webhook or wrong token');
  if (!def.ingest) throw new HttpError(400, `${def.name} widgets don't accept webhooks`);
  const body = await readBody(req);
  const data = def.ingest(body, store.state[id]?.data, w.config || {});
  store.setData(id, { data, updatedAt: new Date().toISOString(), error: null });
  hub.send('widget', publicWidget(w));
  if (body?.focus) {
    const f = typeof body.focus === 'object' ? body.focus : { title: body.focus };
    focus.alert({ title: f.title || w.title, text: f.text, seconds: Math.min(600, Math.max(5, +f.seconds || 30)) });
  }
  return { ok: true };
}, { open: true });

// Display

route('GET', '/api/display/state', () => snapshot());

route('GET', '/api/stream', async (req, res) => {
  hub.attach(req, res, await snapshot());
});

route('POST', '/api/display/hello', async (req) => {
  const { width, height } = await readBody(req, 1000);
  if (isLocal(req) && width > 0 && height > 0) displaySize = { width: +width, height: +height };
  return { ok: true };
});

// Manage

route('GET', '/api/admin/bootstrap', (req) => {
  const me = auth.session(req);
  const s = store.settings;
  return {
    setupComplete: store.config.setupComplete,
    settings: { ...publicSettings(), location: s.location, autoUpdate: !!s.autoUpdate, ai: { apiKey: masked(s.ai.apiKey), model: s.ai.model } },
    widgets: store.config.widgets.filter((w) => !w.draft).map(adminWidget),
    catalog: catalog(),
    samples: SAMPLES,
    sessions: store.config.sessions.map((x) => ({ id: x.id, name: x.name, createdAt: x.createdAt, lastSeen: x.lastSeen, current: x === me })),
    system: { ...system(), displaySize, dataDir: DATA_DIR, managed: !!process.env.INVOCATION_ID, local: isLocal(req) },
    update: updater.state,
    focus: focus.current,
    displayPower: displayPower.on,
  };
});

route('PUT', '/api/settings', async (req) => {
  const b = await readBody(req);
  const s = store.settings;
  let refetch = false;
  if (b.name !== undefined) s.name = String(b.name).trim().slice(0, 40) || 'Panel';
  if (b.name !== undefined) audio.nameChanged();
  if (b.timezone !== undefined) {
    if (!isValidTimeZone(b.timezone)) throw new HttpError(400, 'Unknown time zone');
    refetch ||= s.timezone !== b.timezone;
    s.timezone = b.timezone;
  }
  if (b.units !== undefined) { refetch ||= s.units !== b.units; s.units = b.units === 'imperial' ? 'imperial' : 'metric'; }
  if (b.clock24 !== undefined) s.clock24 = !!b.clock24;
  if (b.autoUpdate !== undefined) s.autoUpdate = !!b.autoUpdate;
  if (b.focus) {
    if (b.focus.enabled !== undefined) s.focus.enabled = !!b.focus.enabled;
    if (b.focus.minutes !== undefined) s.focus.minutes = Math.min(60, Math.max(1, +b.focus.minutes || 5));
    focus.tick();
  }
  if (b.theme !== undefined && ['light', 'dark', 'auto'].includes(b.theme)) s.theme = b.theme;
  for (const k of ['nightStart', 'nightEnd']) if (/^\d{2}:\d{2}$/.test(b[k] || '')) s[k] = b[k];
  if (b.location !== undefined) {
    s.location = b.location && Number.isFinite(+b.location.lat)
      ? { name: String(b.location.name || '').slice(0, 80), lat: +b.location.lat, lon: +b.location.lon }
      : null;
    refetch = true;
  }
  if (b.grid) {
    s.grid = {
      cols: Math.min(6, Math.max(1, +b.grid.cols || s.grid.cols)),
      rows: Math.min(4, Math.max(1, +b.grid.rows || s.grid.rows)),
    };
    for (const w of store.config.widgets) Object.assign(w, clampSize(w.w, w.h));
  }
  if (b.ai) {
    if (typeof b.ai.apiKey === 'string' && !b.ai.apiKey.startsWith(MASK)) { s.ai.apiKey = b.ai.apiKey.trim(); refetch = true; }
    if (typeof b.ai.model === 'string' && b.ai.model.trim()) { refetch ||= s.ai.model !== b.ai.model.trim(); s.ai.model = b.ai.model.trim(); }
  }
  if (refetch) scheduler.invalidateAll();
  changed();
  return { ok: true };
});

route('POST', '/api/setup/complete', () => {
  store.config.setupComplete = true;
  changed();
  return { ok: true };
});

route('POST', '/api/widgets', async (req) => {
  const b = await readBody(req);
  const def = types[b.type];
  if (!def) throw new HttpError(400, 'Unknown widget type');
  const size = clampSize(b.w ?? def.size.w, b.h ?? def.size.h);
  const w = {
    id: rid(6),
    type: def.type,
    title: String(b.title || def.defaultTitle || def.name).slice(0, 60),
    ...size,
    config: cleanConfig(def.type, b.config, defaultConfig(def.type)),
    token: rid(18),
    // Widgets added from the gallery stay hidden until saved, so an editor
    // closed halfway (or a phone that went to sleep) leaves nothing behind.
    ...(b.draft ? { draft: true, createdAt: Date.now() } : {}),
  };
  store.config.widgets.push(w);
  if (b.data && def.ingest) store.setData(w.id, { data: def.ingest(b.data, null, w.config), updatedAt: new Date().toISOString() });
  changed();
  if (!w.draft) scheduler.run(w);
  return adminWidget(w);
});

route('PUT', '/api/widgets/order', async (req) => {
  const { ids } = await readBody(req);
  if (!Array.isArray(ids)) throw new HttpError(400, 'Expected ids');
  const rank = new Map(ids.map((id, i) => [id, i]));
  store.config.widgets.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  changed();
  return { ok: true };
});

route('PUT', '/api/widgets/:id', async (req, res, { id }) => {
  const w = findWidget(id);
  const b = await readBody(req);
  const publishing = !!(b.publish && w.draft);
  if (publishing) delete w.draft;
  if (b.title !== undefined) w.title = String(b.title).trim().slice(0, 60) || types[w.type].name;
  if (b.w !== undefined || b.h !== undefined) Object.assign(w, clampSize(b.w ?? w.w, b.h ?? w.h));
  if (b.config) {
    const before = JSON.stringify(w.config);
    w.config = cleanConfig(w.type, b.config, w.config);
    if (before !== JSON.stringify(w.config)) {
      // A different view makes old pushed data meaningless.
      if (JSON.parse(before).view !== w.config.view && types[w.type].ingest) delete store.state[id];
      scheduler.invalidate(id);
      scheduler.run(w);
    }
  }
  if (publishing && !scheduler.running.has(id)) scheduler.run(w);
  changed();
  return adminWidget(w);
});

route('DELETE', '/api/widgets/:id', (req, res, { id }) => {
  findWidget(id);
  store.config.widgets = store.config.widgets.filter((w) => w.id !== id);
  delete store.state[id];
  store.saveState();
  changed();
  return { ok: true };
});

route('POST', '/api/widgets/:id/refresh', async (req, res, { id }) => {
  const w = findWidget(id);
  await scheduler.run(w);
  return adminWidget(w);
});

route('POST', '/api/widgets/:id/action', async (req, res, { id }) => {
  const w = findWidget(id);
  const def = types[w.type];
  if (!def.ingest) throw new HttpError(400, 'This widget doesn’t take actions');
  const body = await readBody(req);
  const data = def.ingest(body, store.state[id]?.data, w.config || {});
  store.setData(id, { data, updatedAt: new Date().toISOString(), error: null });
  hub.send('widget', publicWidget(w));
  return adminWidget(w);
});

// Try an API widget's request with unsaved settings, for the field picker.
route('POST', '/api/widgets/:id/preview', async (req, res, { id }) => {
  const w = findWidget(id);
  if (w.type !== 'api') throw new HttpError(400, 'Only API widgets can be previewed');
  const b = await readBody(req);
  const config = cleanConfig('api', b.config || {}, w.config); // masked secrets fall back to the saved ones
  try {
    return await previewApi(id, config, store.settings, { reuse: !!b.reuse });
  } catch (err) {
    return { ok: false, error: err.message, meta: null, body: null, mapped: null };
  }
});

route('POST', '/api/widgets/:id/token', (req, res, { id }) => {
  const w = findWidget(id);
  w.token = rid(18);
  store.saveConfig();
  return adminWidget(w);
});

route('GET', '/api/widgets/:id/context', (req, res, { id }) => {
  const w = findWidget(id);
  const ctx = scheduler.context(w);
  const { system: sys, user } = buildPrompt(w.config || {}, ctx, scheduler.gatherContext(id));
  return { system: sys, user };
});

route('DELETE', '/api/sessions/:id', (req, res, { id }) => {
  store.config.sessions = store.config.sessions.filter((s) => s.id !== id);
  store.saveConfig();
  return { ok: true };
});

route('GET', '/api/geocode', async (req, res, params, url) => {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return [];
  const d = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '8', language: 'en', format: 'json' })}`);
  return (d.results || []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude, lon: r.longitude, timezone: r.timezone,
  }));
});

route('GET', '/api/map/:x/:y', async (req, res, { x, y }) => {
  if (!/^\d{1,6}$/.test(x) || !/^\d{1,6}$/.test(y)) throw new HttpError(400, 'Not a map tile');
  const png = await mapTile(+x, +y).catch((err) => { throw new HttpError(502, err.message); });
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=604800' });
  res.end(png);
});

// Photo frame

route('POST', '/api/photos', async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_PHOTO_BYTES) throw new HttpError(413, 'That photo is too big');
    chunks.push(chunk);
  }
  let name;
  try { name = photos.add(Buffer.concat(chunks)); } catch (err) { throw new HttpError(400, err.message); }
  broadcastState();
  return { name };
});

route('GET', '/api/photos/:name', (req, res, { name }) => {
  const photo = photos.read(name);
  if (!photo) return send(res, 404, 'No such photo');
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=31536000, immutable' });
  res.end(photo.body);
});

route('DELETE', '/api/photos/:name', (req, res, { name }) => {
  photos.remove(name);
  broadcastState();
  return { ok: true };
});

// Focus mode

route('POST', '/api/focus/dismiss', () => {
  focus.dismiss();
  return { ok: true };
});

route('POST', '/api/focus/test', () => {
  focus.alert({ title: 'This is focus mode', text: 'Dismiss it from your phone, or it clears by itself.', seconds: 15 });
  return { ok: true };
});

// Widget gallery

route('GET', '/api/gallery', () => loadGallery());

route('POST', '/api/gallery/resolve', async (req) => {
  const { source } = await readBody(req, 100_000);
  return resolveRecipe(source).catch((err) => { throw new HttpError(400, err.message); });
});

route('GET', '/api/widgets/:id/share', (req, res, { id }) => shareRecipe(findWidget(id)));

route('GET', '/api/ai/models', () => listModels());

route('POST', '/api/ai/test', async (req) => {
  const b = await readBody(req);
  const apiKey = typeof b.apiKey === 'string' && b.apiKey && !b.apiKey.startsWith(MASK) ? b.apiKey.trim() : store.settings.ai.apiKey;
  if (!apiKey) throw new HttpError(400, 'Paste an OpenRouter key first');
  const out = await complete({
    apiKey, model: b.model || store.settings.ai.model, maxTokens: 20,
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
  }).catch((err) => { throw new HttpError(400, err.message); });
  return { ok: true, reply: out.text, model: out.model };
});

route('POST', '/api/display/reload', () => {
  hub.send('reload');
  return { ok: true };
});

route('GET', '/api/display/power', () => ({ ok: true, on: displayPower.on, power: displayPower.on }), { open: true });

route('POST', '/api/display/power', async (req) => {
  const b = await readBody(req);
  let target;
  if (b.power === 'toggle' || b.action === 'toggle' || b.toggle) {
    target = !displayPower.on;
  } else {
    target = b.power !== undefined ? !!b.power : (b.on !== undefined ? !!b.on : false);
  }
  const on = await displayPower.set(target);
  return { ok: true, on, power: on };
}, { open: true });

route('POST', '/api/display/off', async () => {
  const on = await displayPower.set(false);
  return { ok: true, on, power: on };
}, { open: true });

route('POST', '/api/display/on', async () => {
  const on = await displayPower.set(true);
  return { ok: true, on, power: on };
}, { open: true });

route('POST', '/api/display/toggle', async () => {
  const on = await displayPower.toggle();
  return { ok: true, on, power: on };
}, { open: true });

// Sound

const MAC_PARAM = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;
const audioCall = async (fn) => {
  try { await fn(); } catch (err) { throw new HttpError(400, err.message); }
  return audio.state;
};

route('GET', '/api/audio', () => audio.refresh());

route('PUT', '/api/audio/output', async (req) => {
  const { name } = await readBody(req);
  return audioCall(() => audio.setOutput(String(name)));
});

route('PUT', '/api/audio/volume', async (req) => {
  const { volume, muted } = await readBody(req);
  return audioCall(() => audio.setVolume({ volume: volume == null ? null : +volume, muted: muted == null ? null : !!muted }));
});

route('POST', '/api/audio/test', () => audioCall(() => audio.testSound()));

route('POST', '/api/audio/bluetooth/scan', () => audioCall(() => audio.scan()));

route('POST', '/api/audio/bluetooth/:mac/:action', async (req, res, { mac, action }) => {
  if (!MAC_PARAM.test(mac)) throw new HttpError(400, 'Not a Bluetooth address');
  const fn = { pair: audio.pair, connect: audio.connect, disconnect: audio.disconnect, forget: audio.forget }[action];
  if (!fn) throw new HttpError(404, 'Unknown action');
  return audioCall(() => fn(mac.toUpperCase()));
});

route('PUT', '/api/audio/airplay', async (req) => {
  const { enabled } = await readBody(req);
  return audio.setAirplay(!!enabled);
});

route('GET', '/api/audio/art', (req, res) => {
  const art = audio.art();
  if (!art) return send(res, 404, 'No artwork');
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': art.type, 'Cache-Control': 'private, max-age=86400' });
  res.end(art.body);
});

// System

route('GET', '/api/system/update', () => updater.state);

route('POST', '/api/system/check-update', () => updater.check());

route('POST', '/api/system/update', async () => {
  // Resolves once the pre-flight checks pass; progress then arrives over the event stream.
  try {
    return await updater.apply();
  } catch (err) {
    throw new HttpError(409, err.message);
  }
});

route('POST', '/api/system/reset', async (req) => {
  const { confirm } = await readBody(req);
  if (confirm !== 'reset') throw new HttpError(400, 'Type reset to confirm');
  store.reset();
  photos.clear();
  store.flush();
  auth.request();
  hub.send('reload');
  // Under systemd, start clean so sound and AirPlay pick up the defaults too.
  if (process.env.INVOCATION_ID) setTimeout(() => process.exit(0), 300);
  return { ok: true };
});

route('POST', '/api/system/restart', () => {
  if (!process.env.INVOCATION_ID) throw new HttpError(400, 'Panel isn’t running as a service, so it can’t restart itself.');
  setTimeout(() => process.exit(0), 300);
  return { ok: true };
});

// ---------------------------------------------------------------- server

function powerHtml({ on, sys }) {
  const name = sys?.hostname || 'Panel';
  const url = sys?.urls?.name || 'http://panel.local';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f3f3f1" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0b0b0b" media="(prefers-color-scheme: dark)">
  <title>Display is ${on ? 'on' : 'off'} · ${name}</title>
  <link rel="icon" href="/favicon.svg">
  <link rel="stylesheet" href="/assets/base.css">
  <link rel="stylesheet" href="/assets/manage.css">
  <style>
    body { display: grid; place-items: center; min-height: 100vh; padding: 24px; margin: 0; background: var(--bg); }
    .power-card { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 36px 28px; width: 100%; max-width: 360px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.04); }
    .power-icon { width: 56px; height: 56px; border-radius: 50%; background: var(--fill); display: grid; place-items: center; margin: 0 auto 20px; color: var(--ink); }
    .power-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="power-card">
    <div class="brand" style="justify-content: center; margin-bottom: 24px;"><span class="brand-mark"></span>Panel</div>
    <div class="power-icon">
      ${on
        ? '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>'
        : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
      }
    </div>
    <h1 style="font-size: 21px; font-weight: 600; margin: 0 0 8px;">Display is ${on ? 'on' : 'off'}</h1>
    <p class="lede" style="font-size: 14.5px; color: var(--ink-2); margin: 0 auto;">The screen on your Panel is now ${on ? 'turned on' : 'turned off'}.</p>
    <div class="power-actions">
      <a href="${on ? '/off' : '/on'}" class="btn primary" style="justify-content: center; text-decoration: none;">Turn display ${on ? 'off' : 'on'}</a>
      <a href="/" class="btn ghost" style="justify-content: center; text-decoration: none;">Open Panel</a>
    </div>
    <p class="small muted" style="margin-top: 24px;">Turn off anytime: <code style="padding: 2px 6px; background: var(--fill); border-radius: 4px;">${url}/off</code></p>
  </div>
</body>
</html>`;
}

const OFF_PATHS = new Set(['/off', '/display/off', '/screen/off']);
const ON_PATHS = new Set(['/on', '/display/on', '/screen/on']);
const TOGGLE_PATHS = new Set(['/toggle', '/display/toggle', '/screen/toggle']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://panel');
  const p = url.pathname;

  // CORS so webhooks and display control can come from browser-based tools too.
  if (p.startsWith('/hook/') || OFF_PATHS.has(p) || ON_PATHS.has(p) || TOGGLE_PATHS.has(p) || p.startsWith('/api/display/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Panel-Token');
    if (req.method === 'OPTIONS') return send(res, 204, '');
  }

  try {
    // Quick display power routes via URL (e.g. /off, /on, /toggle)
    if (OFF_PATHS.has(p) || ON_PATHS.has(p) || TOGGLE_PATHS.has(p)) {
      if (OFF_PATHS.has(p)) await displayPower.set(false);
      else if (ON_PATHS.has(p)) await displayPower.set(true);
      else await displayPower.toggle();

      const wantsJson = (req.headers.accept || '').includes('application/json') || req.method === 'POST';
      if (wantsJson) {
        return send(res, 200, { ok: true, on: displayPower.on, power: displayPower.on });
      }
      return send(res, 200, powerHtml({ on: displayPower.on, sys: system() }), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (req.method === 'GET' && !p.startsWith('/api/')) {
      if (p === '/display') {
        const qp = url.searchParams.get('power') || url.searchParams.get('display');
        if (qp === 'off') await displayPower.set(false);
        else if (qp === 'on') await displayPower.set(true);
        else if (qp === 'toggle') await displayPower.toggle();
        return serveFile(res, 'display.html');
      }
      if (p === '/' || p === '/manage') {
        const qp = url.searchParams.get('power') || url.searchParams.get('display');
        if (qp === 'off') await displayPower.set(false);
        else if (qp === 'on') await displayPower.set(true);
        else if (qp === 'toggle') await displayPower.toggle();
        return serveFile(res, 'manage.html');
      }
      if (p.startsWith('/assets/')) return serveFile(res, p.slice(1));
      if (p === '/favicon.svg' || p === '/favicon.ico') return serveFile(res, 'assets/favicon.svg');
      if (p === '/health') return send(res, 200, 'ok');
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(p);
      if (!m) continue;
      if (!r.open && !auth.authed(req)) throw new HttpError(401, 'Pair this device first');
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.handler(req, res, params, url);
      if (!res.headersSent && out !== undefined) send(res, 200, out);
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: err.message || 'Something went wrong' });
  }
});

server.listen(PORT, HOST, () => {
  const sys = system();
  console.log(`Panel ${VERSION} is running.`);
  console.log(`  Display  http://localhost:${PORT}/display`);
  console.log(`  Manage   ${sys.urls.name}${sys.urls.ip ? `  or  ${sys.urls.ip}` : ''}`);
  console.log(`  Data     ${DATA_DIR}`);
  scheduler.start();
  updater.start();
  setInterval(() => focus.tick(), 5000).unref();
  // Forget drafts nobody finished setting up.
  setInterval(() => {
    const stale = store.config.widgets.filter((w) => w.draft && Date.now() - (w.createdAt || 0) > 30 * 60e3);
    if (!stale.length) return;
    store.config.widgets = store.config.widgets.filter((w) => !stale.includes(w));
    for (const w of stale) delete store.state[w.id];
    store.saveConfig();
    store.saveState();
  }, 5 * 60e3).unref();
  audio.start().catch((err) => console.warn(`[audio] ${err.message}`));
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    audio.stop();
    store.flush();
    process.exit(0);
  });
}
process.on('exit', () => store.flush());
