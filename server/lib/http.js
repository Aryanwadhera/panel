import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;
const UA = `Panel/${VERSION} (+https://github.com/Aryanwadhera/panel)`;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function host(url) {
  try { return new URL(url).host; } catch { return url; }
}

/** fetch() with a timeout and errors worded for a person, not a stack trace. */
export async function request(url, { timeout = 15000, headers = {}, method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method, body, redirect: 'follow',
      headers: { 'User-Agent': UA, ...headers },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error(`Timed out reaching ${host(url)}`);
    if (err instanceof TypeError && /invalid url/i.test(err.message + err.cause)) throw new Error('That URL doesn’t look right');
    throw new Error(`Couldn’t reach ${host(url)}`);
  }
  return res;
}

export async function fetchText(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`${host(url)} responded ${res.status}`);
  return res.text();
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  try { return JSON.parse(text); } catch { throw new Error(`${host(url)} didn’t return JSON`); }
}

/** Read "a.b[0].c" style paths out of a JSON value. */
export function getPath(obj, path) {
  if (!path) return obj;
  return String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
