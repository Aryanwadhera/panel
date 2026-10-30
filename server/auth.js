// Pairing: the panel shows a six-digit code on screen, you type it on your
// phone or laptop, and that browser is remembered. Being able to see the
// screen is the proof that you're allowed to manage it.

import crypto from 'node:crypto';
import { rid } from './store.js';

const COOKIE = 'panel_session';
const CODE_TTL = 5 * 60e3;
const MAX_ATTEMPTS = 5;

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function deviceName(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${browser} on ${os}` : os;
}

/**
 * Requests from the Pi itself are trusted, so the kiosk and the `panel` CLI
 * work without pairing. Anything relayed through a proxy or tunnel is not.
 */
export function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  const proxied = req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['cf-connecting-ip'] || req.headers['x-real-ip'];
  return loop && !proxied;
}

export function createAuth(store, onPairingChange) {
  let pairing = null; // { code, expires, attempts }

  const onboarding = () => !store.config.sessions.length;

  function current() {
    if (pairing && !onboarding() && pairing.expires < Date.now()) {
      pairing = null;
      onPairingChange();
    }
    if (!pairing && onboarding()) pairing = fresh();
    return pairing;
  }

  function fresh() {
    return {
      code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'),
      expires: onboarding() ? Infinity : Date.now() + CODE_TTL,
      attempts: 0,
    };
  }

  setInterval(current, 10e3).unref();

  return {
    COOKIE,
    session(req) {
      const token = cookies(req)[COOKIE];
      if (!token) return null;
      const h = hash(token);
      const s = store.config.sessions.find((x) => x.hash === h);
      if (s && Date.now() - (s.lastSeen || 0) > 3600e3) {
        s.lastSeen = Date.now();
        store.saveConfig();
      }
      return s || null;
    },

    authed(req) {
      return process.env.PANEL_NO_AUTH === '1' || isLocal(req) || !!this.session(req);
    },

    /** The code currently on screen, if any. */
    pairing: () => current(),

    request() {
      const p = current();
      if (!p || p.expires < Date.now()) pairing = fresh();
      onPairingChange();
      return pairing;
    },

    /** Hide the on-screen code (a paired browser opened a pairing link). */
    dismiss() {
      if (pairing && !onboarding()) {
        pairing = null;
        onPairingChange();
      }
    },

    /** Returns a session token on success, or an error string. */
    confirm(code, req) {
      const p = current();
      if (!p) return { error: 'expired' };
      const clean = String(code || '').replace(/\D/g, '');
      const ok = clean.length === 6 && crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(p.code));
      if (!ok) {
        p.attempts++;
        if (p.attempts >= MAX_ATTEMPTS) {
          pairing = onboarding() ? fresh() : null;
          onPairingChange();
          return { error: 'too-many' };
        }
        return { error: 'invalid' };
      }
      const token = crypto.randomBytes(32).toString('base64url');
      store.config.sessions.push({
        id: rid(6), hash: hash(token), name: deviceName(req.headers['user-agent']),
        createdAt: Date.now(), lastSeen: Date.now(),
      });
      store.saveConfig();
      pairing = null;
      onPairingChange();
      return { token };
    },

    cookie(token, maxAge = 400 * 86400) {
      return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
    },
  };
}
