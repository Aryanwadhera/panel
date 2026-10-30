export default {
  type: 'note',
  name: 'Note',
  description: 'A line of text: a reminder, a quote, the Wi‑Fi password.',
  size: { w: 1, h: 1 },
  fields: [
    { key: 'text', label: 'Text', type: 'textarea', required: true, placeholder: 'Guest Wi‑Fi: tidepool / ocean-glass-42' },
    { key: 'includeInBrief', label: 'Include in daily brief', type: 'toggle', default: false },
  ],
  display: (c) => ({ text: c.text || '' }),
  summarize: (_d, c) => (c.includeInBrief && c.text ? c.text : null),
};
