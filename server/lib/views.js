// The five generic building blocks that webhooks and custom APIs render into.
// Each accepts a simple canonical payload, or any JSON plus a few "paths"
// that say where to find the values.

import { getPath } from './http.js';

export const VIEWS = [
  { value: 'stat', label: 'Number', hint: 'A big number with a label, change and trend line' },
  { value: 'list', label: 'List', hint: 'Rows of items, replaced on each update' },
  { value: 'feed', label: 'Event feed', hint: 'Each update adds a row to the top' },
  { value: 'text', label: 'Text', hint: 'A short message' },
  { value: 'progress', label: 'Progress', hint: 'A percentage or goal with a bar' },
];

const isViews = (...v) => ({ key: 'view', in: v });

export const viewFields = [
  { key: 'view', label: 'Show as', type: 'select', options: VIEWS, default: 'stat' },
  { key: 'prefix', label: 'Prefix', type: 'text', placeholder: '$', showIf: isViews('stat'), half: true },
  { key: 'suffix', label: 'Suffix', type: 'text', placeholder: '%', showIf: isViews('stat'), half: true },
  { key: 'maxItems', label: 'Max rows', type: 'number', default: 8, showIf: isViews('list', 'feed') },
];

export const pathFields = [
  { key: 'valuePath', label: 'Value', type: 'text', placeholder: 'data.total', showIf: isViews('stat', 'progress'), advanced: true },
  { key: 'labelPath', label: 'Label', type: 'text', placeholder: 'data.name', showIf: isViews('stat', 'progress'), advanced: true },
  { key: 'deltaPath', label: 'Change', type: 'text', placeholder: 'data.change', showIf: isViews('stat'), advanced: true },
  { key: 'maxPath', label: 'Goal / max', type: 'text', placeholder: 'data.goal', showIf: isViews('progress'), advanced: true },
  { key: 'itemsPath', label: 'Items array', type: 'text', placeholder: 'results', showIf: isViews('list', 'feed'), advanced: true },
  { key: 'itemTitlePath', label: 'Item title', type: 'text', placeholder: 'name', showIf: isViews('list', 'feed'), advanced: true },
  { key: 'itemMetaPath', label: 'Item detail', type: 'text', placeholder: 'status', showIf: isViews('list', 'feed'), advanced: true },
  { key: 'textPath', label: 'Text', type: 'text', placeholder: 'message', showIf: isViews('text'), advanced: true },
];

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null || v === '') return null;
  const n = Number(String(v ?? '').replace(/[, _]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function pick(payload, path, key) {
  if (path) return getPath(payload, path);
  return payload && typeof payload === 'object' ? payload[key] : undefined;
}

function toItem(it, cfg) {
  if (it == null) return null;
  if (typeof it !== 'object') return { title: String(it) };
  const title = cfg.itemTitlePath ? getPath(it, cfg.itemTitlePath)
    : it.title ?? it.name ?? it.text ?? it.message ?? it.label;
  const meta = cfg.itemMetaPath ? getPath(it, cfg.itemMetaPath)
    : it.meta ?? it.value ?? it.subtitle ?? it.detail ?? it.status;
  if (title == null) return null;
  const item = { title: String(title).slice(0, 200) };
  if (meta != null && meta !== '') item.meta = String(meta).slice(0, 80);
  if (typeof it.status === 'string' && /^(ok|good|up|warn|bad|down|error)$/i.test(it.status)) item.status = it.status.toLowerCase();
  return item;
}

function itemsFrom(payload, cfg) {
  let raw = pick(payload, cfg.itemsPath, 'items');
  if (Array.isArray(payload) && !cfg.itemsPath) raw = payload;
  if (!Array.isArray(raw)) {
    if (payload?.item) raw = [payload.item];
    else if (payload && typeof payload === 'object' && !cfg.itemsPath) raw = [payload];
    else raw = [];
  }
  return raw.map((it) => toItem(it, cfg)).filter(Boolean);
}

export function mapView(view, payload, cfg = {}, prev = null) {
  const max = Math.min(50, Math.max(1, +cfg.maxItems || 8));
  switch (view) {
    case 'stat': {
      const rawValue = typeof payload === 'number' || typeof payload === 'string' ? payload : pick(payload, cfg.valuePath, 'value');
      const value = num(rawValue);
      if (value === null && rawValue == null) throw new Error('Expected a "value" (or set the Value path)');
      const history = [...(prev?.history || []), value].filter((v) => v !== null).slice(-30);
      const trend = Array.isArray(payload?.trend) ? payload.trend.map(num).filter((v) => v !== null) : history;
      return {
        value: value ?? String(rawValue),
        label: pick(payload, cfg.labelPath, 'label') ?? null,
        delta: pick(payload, cfg.deltaPath, 'delta') ?? null,
        caption: payload?.caption ?? null,
        prefix: payload?.prefix ?? cfg.prefix ?? '',
        suffix: payload?.suffix ?? cfg.suffix ?? '',
        trend,
        history,
      };
    }
    case 'progress': {
      const value = num(typeof payload === 'number' ? payload : pick(payload, cfg.valuePath, 'value'));
      if (value === null) throw new Error('Expected a numeric "value"');
      const max = num(pick(payload, cfg.maxPath, 'max')) || 100;
      return { value, max, label: pick(payload, cfg.labelPath, 'label') ?? null };
    }
    case 'list':
      return { items: itemsFrom(payload, cfg).slice(0, max) };
    case 'feed': {
      const now = new Date().toISOString();
      const incoming = itemsFrom(payload, cfg).map((it) => ({ ...it, time: now }));
      return { items: [...incoming, ...(prev?.items || [])].slice(0, max) };
    }
    case 'text': {
      let text = typeof payload === 'string' ? payload : pick(payload, cfg.textPath, 'text') ?? payload?.message;
      if (text == null) text = JSON.stringify(payload);
      return { text: String(text).slice(0, 600) };
    }
    default:
      throw new Error(`Unknown view "${view}"`);
  }
}

export function summarizeView(view, data) {
  if (!data) return null;
  switch (view) {
    case 'stat': return `${data.label ? `${data.label}: ` : ''}${data.prefix || ''}${data.value}${data.suffix || ''}${data.delta != null ? ` (change ${data.delta})` : ''}`;
    case 'progress': return `${data.label ? `${data.label}: ` : ''}${data.value} of ${data.max} (${Math.round((data.value / data.max) * 100)}%)`;
    case 'list':
    case 'feed': return data.items?.length ? data.items.slice(0, 8).map((i) => `- ${i.title}${i.meta ? ` (${i.meta})` : ''}`).join('\n') : null;
    case 'text': return data.text;
    default: return null;
  }
}

export const SAMPLES = {
  stat: { value: 12840, label: 'Revenue today', delta: '+8.2%', prefix: '$' },
  list: { items: [{ title: 'api.example.com', meta: '99.98%' }, { title: 'Checkout service', meta: 'healthy' }, { title: 'Nightly build', meta: 'passed' }] },
  feed: { title: 'New signup: maya@studio.co', meta: 'Pro plan' },
  text: { text: 'Deploy finished. All systems normal.' },
  progress: { value: 7200, max: 10000, label: 'Steps' },
};
