import { fetchText } from '../lib/http.js';
import { parseICS, expandEvents } from '../lib/ics.js';
import { startOfDay, dateKey } from '../lib/time.js';

export default {
  type: 'calendar',
  name: 'Calendar',
  description: 'Today’s agenda from Google, Apple or Outlook calendars.',
  size: { w: 2, h: 2 },
  interval: 10 * 60,
  fields: [
    {
      key: 'urls', label: 'Calendar links', type: 'lines', secret: true, required: true,
      placeholder: 'https://calendar.google.com/calendar/ical/.../basic.ics',
      help: 'One private iCal (.ics) link per line. Google: Settings → your calendar → “Secret address in iCal format”. Apple: Calendar → Share → Public calendar. Outlook: Settings → Shared calendars → Publish.',
    },
    { key: 'days', label: 'Look ahead', type: 'select', default: '3', options: [
      { value: '1', label: 'Today only' }, { value: '3', label: '3 days' }, { value: '7', label: 'A week' },
    ] },
    { key: 'showLocation', label: 'Show locations', type: 'toggle', default: true },
  ],
  display: (c) => ({ showLocation: c.showLocation !== false }),

  async fetch(config, ctx) {
    const urls = String(config.urls || '').split('\n').map((u) => u.trim().replace(/^webcal:\/\//i, 'https://')).filter(Boolean);
    if (!urls.length) throw new Error('Add a calendar link');
    const tz = ctx.settings.timezone;
    const now = new Date();
    const from = startOfDay(now, tz);
    const to = startOfDay(now, tz, Math.max(1, +config.days || 3));
    const results = await Promise.allSettled(urls.map((u) => fetchText(u, { timeout: 20000 })));
    const events = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') return errors.push(r.reason.message);
      if (!/BEGIN:VCALENDAR/.test(r.value)) return errors.push('One link isn’t an iCal feed');
      for (const e of expandEvents(parseICS(r.value, tz), from, to, tz)) events.push({ ...e, cal: i });
    });
    if (errors.length === urls.length) throw new Error(errors[0]);
    events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : b.allDay - a.allDay));
    return { events: events.slice(0, 60), warning: errors[0] || null };
  },

  summarize(data, config, ctx) {
    if (!data?.events) return null;
    const tz = ctx.settings.timezone;
    const now = new Date();
    const today = dateKey(now, tz);
    const tomorrow = dateKey(startOfDay(now, tz, 1), tz);
    const line = (e) => {
      const time = e.allDay ? 'all day' : `${ctx.fmtTime(new Date(e.start))}–${ctx.fmtTime(new Date(e.end))}`;
      const live = !e.allDay && new Date(e.start) <= now && new Date(e.end) > now ? ' [happening now]' : '';
      return `- ${time}: ${e.title}${e.location ? ` @ ${e.location}` : ''}${live}`;
    };
    const todays = data.events.filter((e) => dateKey(new Date(e.start), tz) === today || (e.allDay && e.start <= now.toISOString() && e.end > now.toISOString()));
    const upcoming = todays.filter((e) => e.allDay || new Date(e.end) > now);
    const done = todays.length - upcoming.length;
    const tmr = data.events.filter((e) => dateKey(new Date(e.start), tz) === tomorrow);
    let s = upcoming.length ? `Still to come today:\n${upcoming.map(line).join('\n')}` : 'Nothing else on the calendar today.';
    if (done) s += `\n(${done} earlier event${done > 1 ? 's' : ''} already finished.)`;
    if (tmr.length) s += `\nTomorrow:\n${tmr.slice(0, 4).map(line).join('\n')}`;
    return s;
  },
};
