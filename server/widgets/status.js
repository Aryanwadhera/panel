import { request } from '../lib/http.js';

function parseTargets(text) {
  return String(text || '').split('\n').map((line) => {
    const m = /^(.*?)\s*=\s*(https?:\/\/\S+)\s*$/.exec(line.trim()) || [null, null, line.trim()];
    const url = m[2];
    if (!/^https?:\/\//.test(url || '')) return null;
    let name = m[1];
    if (!name) { try { name = new URL(url).host; } catch { name = url; } }
    return { name, url };
  }).filter(Boolean).slice(0, 12);
}

export default {
  type: 'status',
  name: 'Uptime',
  description: 'Checks that your sites and services respond, every minute.',
  size: { w: 1, h: 1 },
  interval: 60,
  fields: [
    {
      key: 'targets', label: 'Sites to check', type: 'lines', required: true, secret: true,
      placeholder: 'Website = https://example.com\nAPI = https://api.example.com/health',
      help: 'One per line, as Name = URL. Anything under 400 counts as up.',
    },
  ],

  async fetch(config) {
    const targets = parseTargets(config.targets);
    if (!targets.length) throw new Error('Add a site to check');
    const checks = await Promise.all(targets.map(async ({ name, url }) => {
      const t0 = Date.now();
      try {
        const res = await request(url, { timeout: 10000 });
        res.body?.cancel?.().catch(() => {});
        return { name, ok: res.status < 400, code: res.status, ms: Date.now() - t0 };
      } catch (err) {
        return { name, ok: false, code: null, ms: null, error: err.message };
      }
    }));
    return { checks };
  },

  summarize(data) {
    if (!data?.checks) return null;
    const down = data.checks.filter((c) => !c.ok);
    return down.length ? `DOWN: ${down.map((c) => c.name).join(', ')}. Others are up.` : `All ${data.checks.length} monitored services are up.`;
  },
};
