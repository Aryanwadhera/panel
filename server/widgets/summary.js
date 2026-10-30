import { complete } from '../lib/openrouter.js';
import { tzParts } from '../lib/time.js';

const STYLES = {
  brief: 'Write exactly two short sentences.',
  standard: 'Write three or four short sentences.',
  coach: 'Write three or four short sentences in a warm, encouraging voice, like a thoughtful friend who has seen the day ahead.',
};

export function buildPrompt(config, ctx, context) {
  const now = new Date();
  const system = [
    `You write the daily brief for "${ctx.settings.name}", a calm display on a wall or desk. It is read at a glance from across the room.`,
    STYLES[config.style] || STYLES.standard,
    'Lead with what matters most in the next few hours. Use specific times. Connect things when it helps (for example, rain before an outdoor meeting, a free afternoon to clear tasks).',
    'Plain text only: no markdown, no lists, no emoji, no greeting, no sign-off, and never mention that you are an AI or describe the data sources. Under 70 words.',
    'If something is broken or down, say so plainly. Do not invent anything that is not in the data.',
    config.instructions ? `The owner also asked: ${String(config.instructions).slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');
  const user = `It is ${ctx.fmtDay(now)}, ${ctx.fmtTime(now)} (${ctx.settings.timezone}).\n\n${context || 'No widgets have data yet.'}`;
  return { system, user };
}

/**
 * Rewrites run on a fixed timetable: `every` minutes, counted from the `at` time
 * of day. "Every 12 hours at 7:00" means 7 AM and 7 PM, even after a restart.
 */
export function briefDue(config, lastRun, now, tz) {
  const every = Math.max(15, +config.every || 60);
  const [h, m] = String(config.at || '07:00').split(':').map(Number);
  const t = tzParts(new Date(now), tz);
  const sinceAnchor = ((t.h * 60 + t.mi - (h * 60 + m)) % 1440 + 1440) % 1440;
  const lastSlot = now - (sinceAnchor % every) * 60e3 - t.s * 1000;
  return lastRun < lastSlot;
}

export default {
  type: 'summary',
  name: 'AI brief',
  description: 'A few sentences about your day, written from your other widgets, on the schedule you pick.',
  size: { w: 2, h: 1 },
  startDelay: 20,
  defaultTitle: 'Today',
  fields: [
    { key: 'style', label: 'Style', type: 'select', default: 'standard', options: [
      { value: 'brief', label: 'Brief: two sentences' },
      { value: 'standard', label: 'Standard: three or four sentences' },
      { value: 'coach', label: 'Coach: warm and encouraging' },
    ] },
    {
      key: 'instructions', label: 'Anything to keep in mind?', type: 'textarea',
      placeholder: 'e.g. I walk to work, so flag rain before 8:30. Remind me to stretch if I have back-to-back meetings.',
    },
    { key: 'every', label: 'Update', type: 'select', default: '60', half: true, options: [
      { value: '30', label: 'Every 30 minutes' }, { value: '60', label: 'Hourly' },
      { value: '120', label: 'Every 2 hours' }, { value: '240', label: 'Every 4 hours' },
      { value: '720', label: 'Every 12 hours' }, { value: '1440', label: 'Daily' },
    ], help: 'Each update is one short request to your chosen model.' },
    { key: 'at', label: 'At', type: 'time', default: '07:00', half: true, showIf: { key: 'every', in: ['720', '1440'] } },
  ],
  interval: (c) => Math.max(15, +c.every || 60) * 60,
  due: briefDue,

  async fetch(config, ctx) {
    const { apiKey, model } = ctx.settings.ai || {};
    if (!apiKey) throw new Error('Add your OpenRouter key in Settings');
    const { system, user } = buildPrompt(config, ctx, ctx.gatherContext());
    const out = await complete({
      apiKey, model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    return { text: out.text.replace(/\*\*|__|^#+\s*/gm, ''), model: out.model, at: new Date().toISOString() };
  },
};
