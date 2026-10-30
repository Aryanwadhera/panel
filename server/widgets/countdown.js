import { dateKey } from '../lib/time.js';

function daysUntil(date, tz) {
  const today = Date.parse(dateKey(new Date(), tz));
  return Math.round((Date.parse(date) - today) / 86400000);
}

export default {
  type: 'countdown',
  name: 'Countdown',
  description: 'Days until something you’re looking forward to.',
  size: { w: 1, h: 1 },
  fields: [
    { key: 'label', label: 'What’s happening', type: 'text', required: true, placeholder: 'Lisbon trip' },
    { key: 'date', label: 'Date', type: 'date', required: true },
  ],
  display: (c) => ({ label: c.label || '', date: c.date || '' }),
  summarize(_data, c, ctx) {
    if (!c.date) return null;
    const n = daysUntil(c.date, ctx.settings.timezone);
    if (n < 0) return null;
    return n === 0 ? `${c.label} is today.` : `${n} day${n > 1 ? 's' : ''} until ${c.label} (${c.date}).`;
  },
};
