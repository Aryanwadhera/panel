import { types, intervalOf } from './widgets/index.js';
import { fmtTime, fmtDay } from './lib/time.js';

const RETRY_AFTER_ERROR = 5 * 60; // seconds

/** Keeps every polling widget fresh, and gives widgets a shared context. */
export class Scheduler {
  constructor(store, onUpdate) {
    this.store = store;
    this.onUpdate = onUpdate;
    this.running = new Set();
    this.bootAt = Date.now();
  }

  start() {
    this.timer = setInterval(() => this.tick(), 5000);
    this.tick();
  }

  context(widget) {
    const settings = this.store.settings;
    const tz = settings.timezone;
    return {
      settings,
      previous: this.store.state[widget.id]?.data ?? null,
      fmtTime: (d) => fmtTime(d, tz, settings.clock24),
      fmtDay: (d) => fmtDay(d, tz),
      gatherContext: () => this.gatherContext(widget.id),
    };
  }

  /** Plain-text digest of every widget, for the AI brief. */
  gatherContext(excludeId) {
    const sections = [];
    for (const w of this.store.config.widgets) {
      const def = types[w.type];
      if (w.id === excludeId || !def?.summarize) continue;
      const st = this.store.state[w.id] || {};
      let text = null;
      try { text = def.summarize(st.data, w.config || {}, this.context(w)); } catch { /* skip */ }
      if (st.error && !text) text = `(unavailable: ${st.error})`;
      if (text) sections.push(`## ${w.title || def.name}\n${text}`);
    }
    return sections.join('\n\n');
  }

  tick() {
    const now = Date.now();
    for (const w of this.store.config.widgets) {
      const def = types[w.type];
      if (!def?.fetch || this.running.has(w.id)) continue;
      if (def.startDelay && now - this.bootAt < def.startDelay * 1000 && !this.store.state[w.id]?.data) continue;
      const st = this.store.state[w.id] || {};
      const every = st.error ? Math.min(intervalOf(w), RETRY_AFTER_ERROR) : intervalOf(w);
      if (!st.lastRun || now - st.lastRun >= every * 1000) this.run(w);
    }
  }

  async run(w) {
    const def = types[w.type];
    if (!def?.fetch || this.running.has(w.id)) return;
    this.running.add(w.id);
    try {
      const data = await def.fetch(w.config || {}, this.context(w));
      this.store.setData(w.id, { data, updatedAt: new Date().toISOString(), error: null, lastRun: Date.now() });
    } catch (err) {
      this.store.setData(w.id, { error: err.message || String(err), lastRun: Date.now() });
      console.warn(`[${w.type}] ${w.title || w.id}: ${err.message}`);
    } finally {
      this.running.delete(w.id);
      // The widget may have been deleted while we were fetching.
      if (this.store.widget(w.id)) this.onUpdate(w.id);
      else delete this.store.state[w.id];
    }
  }

  /** Force a refresh on next tick (after a config change, say). */
  invalidate(id) {
    if (this.store.state[id]) this.store.state[id].lastRun = 0;
  }

  invalidateAll() {
    for (const id of Object.keys(this.store.state)) this.invalidate(id);
  }
}
