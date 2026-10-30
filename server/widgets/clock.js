import { isValidTimeZone } from '../lib/time.js';

function parseZones(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.split('='))
    .map(([label, tz]) => (tz === undefined ? [label.split('/').pop().replace(/_/g, ' '), label] : [label, tz]))
    .map(([label, tz]) => ({ label: label.trim(), tz: tz.trim() }))
    .filter((z) => z.label && isValidTimeZone(z.tz))
    .slice(0, 4);
}

export default {
  type: 'clock',
  name: 'Clock',
  description: 'The time and date, with optional extra time zones.',
  size: { w: 1, h: 1 },
  fields: [
    { key: 'showSeconds', label: 'Show seconds', type: 'toggle', default: false },
    { key: 'showDate', label: 'Show date', type: 'toggle', default: true },
    {
      key: 'zones', label: 'Other time zones', type: 'lines',
      placeholder: 'London = Europe/London\nTokyo = Asia/Tokyo',
      help: 'One per line, as Label = time zone. Shown when the widget has room.',
    },
  ],
  display: (c) => ({ showSeconds: !!c.showSeconds, showDate: c.showDate !== false, zones: parseZones(c.zones) }),
};
