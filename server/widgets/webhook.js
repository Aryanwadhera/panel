import { viewFields, pathFields, mapView, summarizeView } from '../lib/views.js';

export default {
  type: 'webhook',
  name: 'Push data',
  description: 'Another app sends numbers, lists or alerts here with a webhook.',
  size: { w: 1, h: 1 },
  fields: [
    ...viewFields,
    ...pathFields,
    { key: 'includeInBrief', label: 'Include in daily brief', type: 'toggle', default: true },
  ],
  view: (c) => c.view || 'stat',
  ingest: (body, prev, config) => mapView(config.view || 'stat', body, config, prev),
  summarize: (data, config) => (config.includeInBrief === false ? null : summarizeView(config.view || 'stat', data)),
};
