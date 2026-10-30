import { request } from '../lib/http.js';
import { viewFields, pathFields, mapView, summarizeView } from '../lib/views.js';
import { dateKey } from '../lib/time.js';
import { TEMPLATES } from './api-templates.js';

const isAuth = (...v) => ({ key: 'auth', in: v });

/**
 * Replace {lat}, {lon}, {city}, {timezone}, {today} and {now} so one URL
 * works wherever the panel is. Values are URL-encoded inside URLs.
 */
export function fillVariables(text, settings, { encode = false } = {}) {
  if (!text) return text;
  const loc = settings.location || {};
  const vars = {
    lat: loc.lat ?? '', lon: loc.lon ?? '', city: loc.name ?? '',
    timezone: settings.timezone, today: dateKey(new Date(), settings.timezone),
    now: new Date().toISOString(),
  };
  return String(text).replace(/\{(lat|lon|city|timezone|today|now)\}/g, (_, k) => (encode ? encodeURIComponent(vars[k]) : String(vars[k])));
}

/** Turn the widget's settings into a fetch() call. */
export function buildRequest(config, settings) {
  if (!config.url) throw new Error('Add a URL');
  let url;
  try {
    url = new URL(fillVariables(config.url.trim(), settings, { encode: true }));
  } catch {
    throw new Error('That URL doesn’t look right');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https URLs work');

  const headers = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' };
  for (const line of String(config.headers || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const token = String(config.authToken || '').trim();
  switch (config.auth) {
    case 'bearer': if (token) headers.Authorization = `Bearer ${token}`; break;
    case 'header': if (token) headers[(config.authHeader || 'X-API-Key').trim()] = token; break;
    case 'basic': headers.Authorization = `Basic ${Buffer.from(`${config.authUser || ''}:${token}`).toString('base64')}`; break;
    case 'query': if (token) url.searchParams.set((config.authParam || 'api_key').trim(), token); break;
  }

  const method = config.method === 'POST' ? 'POST' : 'GET';
  let body;
  if (method === 'POST' && config.body) {
    body = fillVariables(config.body, settings);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = /^\s*[[{]/.test(body) ? 'application/json' : 'text/plain';
    }
  }
  return { url: url.toString(), method, headers, body };
}

/** Make the request and parse the response, with errors a person can act on. */
export async function callApi(config, settings) {
  const req = buildRequest(config, settings);
  const started = Date.now();
  const res = await request(req.url, { method: req.method, headers: req.headers, body: req.body, timeout: 20000 });
  const text = await res.text();
  const meta = { status: res.status, ms: Date.now() - started, type: (res.headers.get('content-type') || '').split(';')[0] };
  let body = text;
  try { body = JSON.parse(text); } catch { /* plain text is fine for text views */ }
  if (!res.ok) {
    const host = new URL(req.url).host;
    const detail = typeof body === 'object' ? body?.error?.message || body?.message || body?.error || '' : text.slice(0, 120);
    const hint = res.status === 401 || res.status === 403 ? ' Check the API key and auth settings.'
      : res.status === 404 ? ' Check the URL.' : res.status === 429 ? ' Too many requests; try checking less often.' : '';
    const err = new Error(`${host} responded ${res.status}${detail && typeof detail === 'string' ? `: ${detail.slice(0, 120)}` : ''}.${hint}`);
    err.meta = meta;
    err.body = body;
    throw err;
  }
  return { body, meta };
}

// A short-lived copy of the last response, so picking fields in the
// editor doesn't call the API again on every click.
const lastResponse = new Map();

export async function previewApi(id, config, settings, { reuse = false } = {}) {
  const key = JSON.stringify(buildRequest(config, settings));
  const cached = lastResponse.get(id);
  let response;
  if (reuse && cached && cached.key === key && Date.now() - cached.at < 120e3) {
    response = cached.response;
  } else {
    try {
      response = { ok: true, ...(await callApi(config, settings)) };
    } catch (err) {
      response = { ok: false, error: err.message, meta: err.meta || null, body: err.body ?? null };
    }
    lastResponse.set(id, { key, at: Date.now(), response });
  }
  let mapped = null;
  let mapError = null;
  if (response.ok) {
    try { mapped = mapView(config.view || 'stat', response.body, config, null); } catch (err) { mapError = err.message; }
  }
  return { ...response, body: trim(response.body), mapped, mapError };
}

/** Keep the preview small enough to send to a phone. */
function trim(v, depth = 0) {
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (Array.isArray(v)) return depth > 8 ? '[…]' : v.slice(0, 20).map((x) => trim(x, depth + 1));
  if (v && typeof v === 'object') {
    if (depth > 8) return '{…}';
    return Object.fromEntries(Object.entries(v).slice(0, 80).map(([k, x]) => [k, trim(x, depth + 1)]));
  }
  return v;
}

export default {
  type: 'api',
  name: 'Pull data',
  description: 'Panel fetches a number, list or message from any API.',
  size: { w: 1, h: 1 },
  templates: TEMPLATES,
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://api.example.com/stats',
      help: 'You can use {lat}, {lon}, {city}, {today} and {timezone}. They fill in from the panel’s settings.' },
    { key: 'method', label: 'Method', type: 'select', default: 'GET', half: true, options: [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }] },
    { key: 'every', label: 'Check every', type: 'select', default: '5', half: true, options: [
      { value: '1', label: 'Minute' }, { value: '5', label: '5 minutes' }, { value: '15', label: '15 minutes' },
      { value: '60', label: 'Hour' }, { value: '360', label: '6 hours' },
    ] },
    { key: 'body', label: 'Request body', type: 'code', placeholder: '{"query": "{ viewer { name } }"}', showIf: { key: 'method', in: ['POST'] } },
    { key: 'auth', label: 'Authentication', type: 'select', default: 'none', options: [
      { value: 'none', label: 'None' },
      { value: 'bearer', label: 'Bearer token' },
      { value: 'header', label: 'API key in a header' },
      { value: 'query', label: 'API key in the URL' },
      { value: 'basic', label: 'Username and password' },
    ] },
    { key: 'authHeader', label: 'Header name', type: 'text', placeholder: 'X-API-Key', showIf: isAuth('header') },
    { key: 'authParam', label: 'Parameter name', type: 'text', placeholder: 'api_key', showIf: isAuth('query') },
    { key: 'authUser', label: 'Username', type: 'text', showIf: isAuth('basic') },
    { key: 'authToken', label: 'Token or key', type: 'text', secret: true, showIf: isAuth('bearer', 'header', 'query', 'basic'),
      help: 'Stored only on your panel and never shown again. Use a read-only key where the service offers one.' },
    { key: 'headers', label: 'Extra headers', type: 'lines', secret: true, placeholder: 'Notion-Version: 2022-06-28', help: 'Optional. One per line.', advanced: true },
    ...viewFields,
    ...pathFields.map((f) => ({ ...f, advanced: false })),
    { key: 'includeInBrief', label: 'Include in daily brief', type: 'toggle', default: true },
  ],
  view: (c) => c.view || 'stat',
  interval: (c) => Math.max(1, +c.every || 5) * 60,

  async fetch(config, ctx) {
    const { body } = await callApi(config, ctx.settings);
    return mapView(config.view || 'stat', body, config, ctx.previous);
  },

  summarize: (data, config) => (config.includeInBrief === false ? null : summarizeView(config.view || 'stat', data)),
};
