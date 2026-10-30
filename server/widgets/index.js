import summary from './summary.js';
import clock from './clock.js';
import weather from './weather.js';
import calendar from './calendar.js';
import tasks from './tasks.js';
import webhook from './webhook.js';
import api from './api.js';
import headlines from './headlines.js';
import status from './status.js';
import countdown from './countdown.js';
import note from './note.js';
import nowplaying from './nowplaying.js';

const all = [summary, clock, weather, calendar, tasks, nowplaying, webhook, api, headlines, status, countdown, note];

export const types = Object.fromEntries(all.map((t) => [t.type, t]));

/** Metadata the manage app needs to draw the gallery and forms. */
export function catalog() {
  return all.map((t) => ({
    type: t.type,
    name: t.name,
    description: t.description,
    size: t.size,
    fields: t.fields,
    hookable: !!t.ingest,
    refreshable: !!t.fetch,
    templates: t.templates,
  }));
}

export function defaultConfig(type) {
  const out = {};
  for (const f of types[type]?.fields || []) if (f.default !== undefined) out[f.key] = f.default;
  return out;
}

export function viewOf(w) {
  const def = types[w.type];
  return typeof def?.view === 'function' ? def.view(w.config || {}) : w.type;
}

export function intervalOf(w) {
  const def = types[w.type];
  const i = typeof def?.interval === 'function' ? def.interval(w.config || {}) : def?.interval;
  return i || 0;
}
