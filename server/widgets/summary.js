import { complete } from '../lib/openrouter.js';

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

export default {
  type: 'summary',
  name: 'Daily brief',
  description: 'An AI summary of your day, written from your other widgets. Uses your OpenRouter key.',
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
    { key: 'every', label: 'Rewrite every', type: 'select', default: '60', options: [
      { value: '30', label: '30 minutes' }, { value: '60', label: 'Hour' },
      { value: '120', label: '2 hours' }, { value: '240', label: '4 hours' },
    ], help: 'Each rewrite is one short request to your chosen model.' },
  ],
  interval: (c) => Math.max(15, +c.every || 60) * 60,

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
