import { request } from './http.js';

const BASE = 'https://openrouter.ai/api/v1';

export async function complete({ apiKey, model, messages, maxTokens = 500, temperature = 0.4 }) {
  const res = await request(`${BASE}/chat/completions`, {
    method: 'POST',
    timeout: 60000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Aryanwadhera/panel',
      'X-Title': 'Panel',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* fall through */ }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message || `OpenRouter responded ${res.status}`;
    if (res.status === 401) throw new Error('OpenRouter rejected the API key');
    if (res.status === 402) throw new Error('Your OpenRouter account is out of credits');
    throw new Error(msg);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error('The model returned an empty reply');
  return { text: String(text).trim(), model: body.model || model };
}

let modelCache = { at: 0, list: [] };

export async function listModels() {
  if (Date.now() - modelCache.at < 6 * 3600e3 && modelCache.list.length) return modelCache.list;
  const res = await request(`${BASE}/models`, { timeout: 20000 });
  if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`);
  const { data } = await res.json();
  const list = data
    .filter((m) => (m.architecture?.output_modalities || ['text']).includes('text'))
    .map((m) => ({
      id: m.id,
      name: m.name,
      // price per million tokens, in dollars
      input: m.pricing ? +m.pricing.prompt * 1e6 : null,
      output: m.pricing ? +m.pricing.completion * 1e6 : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  modelCache = { at: Date.now(), list };
  return list;
}
