import { fetchJson, fetchText } from '../lib/http.js';
import { viewFields, pathFields, mapView, summarizeView } from '../lib/views.js';

export default {
  type: 'api',
  name: 'Custom API',
  description: 'Poll any JSON URL and show a value from it. Great for internal tools and public APIs.',
  size: { w: 1, h: 1 },
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://api.example.com/stats' },
    {
      key: 'headers', label: 'Headers', type: 'lines', secret: true,
      placeholder: 'Authorization: Bearer sk_live_…', help: 'Optional. One per line.',
    },
    { key: 'every', label: 'Check every', type: 'select', default: '5', options: [
      { value: '1', label: 'Minute' }, { value: '5', label: '5 minutes' }, { value: '15', label: '15 minutes' },
      { value: '60', label: 'Hour' },
    ] },
    ...viewFields,
    ...pathFields.map((f) => ({ ...f, advanced: false })),
    { key: 'includeInBrief', label: 'Include in daily brief', type: 'toggle', default: true },
  ],
  view: (c) => c.view || 'stat',
  interval: (c) => Math.max(1, +c.every || 5) * 60,

  async fetch(config, ctx) {
    if (!config.url) throw new Error('Add a URL');
    const headers = {};
    for (const line of String(config.headers || '').split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const view = config.view || 'stat';
    const body = view === 'text' && !config.textPath
      ? await fetchText(config.url, { headers }).then((t) => { try { return JSON.parse(t); } catch { return t; } })
      : await fetchJson(config.url, { headers });
    return mapView(view, body, config, ctx.previous);
  },

  summarize: (data, config) => (config.includeInBrief === false ? null : summarizeView(config.view || 'stat', data)),
};
