import { rid } from '../store.js';
import { HttpError } from '../lib/http.js';

function norm(t) {
  const text = typeof t === 'string' ? t : t?.text ?? t?.title ?? t?.content;
  if (!text) return null;
  return {
    id: t?.id ? String(t.id) : rid(5),
    text: String(text).slice(0, 200),
    done: !!(t?.done ?? t?.completed),
    doneAt: t?.done || t?.completed ? Date.now() : null,
  };
}

export default {
  type: 'tasks',
  name: 'Tasks',
  description: 'A simple to-do list. Add from your phone or push tasks with a webhook.',
  size: { w: 1, h: 2 },
  fields: [
    { key: 'tasks', label: 'Tasks', type: 'tasks' },
    { key: 'showCompleted', label: 'Show tasks finished today', type: 'toggle', default: true },
  ],
  display: (c) => ({ showCompleted: c.showCompleted !== false }),

  ingest(body, prev) {
    let tasks = [...(prev?.tasks || [])];
    const action = body.action || (Array.isArray(body.tasks) ? 'replace' : body.text ? 'add' : null);
    const find = () => {
      const t = tasks.find((x) => (body.id && x.id === body.id) || (body.text && x.text.toLowerCase() === String(body.text).toLowerCase()));
      if (!t) throw new HttpError(404, 'No matching task');
      return t;
    };
    switch (action) {
      case 'add': {
        const t = norm(body);
        if (!t) throw new HttpError(400, 'A task needs "text"');
        tasks.push(t);
        break;
      }
      case 'complete': case 'done': Object.assign(find(), { done: true, doneAt: Date.now() }); break;
      case 'reopen': Object.assign(find(), { done: false, doneAt: null }); break;
      case 'toggle': { const t = find(); Object.assign(t, { done: !t.done, doneAt: t.done ? null : Date.now() }); break; }
      case 'edit': { const t = find(); if (body.newText) t.text = String(body.newText).slice(0, 200); break; }
      case 'remove': { const t = find(); tasks = tasks.filter((x) => x !== t); break; }
      case 'clear': tasks = tasks.filter((x) => !x.done); break;
      case 'replace': tasks = body.tasks.map(norm).filter(Boolean); break;
      default: throw new HttpError(400, 'Send {"text": "..."} to add, or an "action": add, complete, reopen, toggle, remove, clear, replace');
    }
    return { tasks: tasks.slice(-100) };
  },

  summarize(data) {
    const open = (data?.tasks || []).filter((t) => !t.done);
    if (!open.length) return 'No open tasks.';
    return `${open.length} open task${open.length > 1 ? 's' : ''}:\n${open.slice(0, 12).map((t) => `- ${t.text}`).join('\n')}`;
  },
};
