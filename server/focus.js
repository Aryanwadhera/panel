// Focus mode: when something needs attention, it takes over the screen for a
// moment. Runs on the server so every display agrees and a phone can dismiss it.

const STATUS_SECONDS = 60;
const LEAVE_MINUTES = 10;

/** Everything that wants the screen right now, most important first. */
export function candidates({ widgets, state, settings, now }) {
  if (!settings.focus?.enabled) return [];
  const lead = (settings.focus.minutes || 5) * 60e3;
  const down = [];
  const leave = [];
  const soon = [];
  for (const w of widgets) {
    if (w.draft) continue;
    const data = state[w.id]?.data;
    if (w.type === 'status') {
      for (const c of data?.checks || []) {
        if (!c.ok) down.push({ key: `status:${w.id}:${c.name}`, kind: 'alert', title: `${c.name} is down`, text: c.code ? `HTTP ${c.code}` : 'No response', seconds: STATUS_SECONDS });
      }
    }
    if (w.type !== 'calendar') continue;
    for (const e of data?.events || []) {
      if (e.allDay) continue;
      const start = Date.parse(e.start);
      const shared = { title: e.title, at: e.start, location: e.location ? e.location.split('\n')[0] : '', map: e.map || null, travel: e.travel || null };
      const leaveBy = e.travel ? Date.parse(e.travel.leaveBy) : null;
      if (leaveBy && now >= leaveBy && now < Math.min(leaveBy + LEAVE_MINUTES * 60e3, start - lead)) {
        leave.push({ key: `leave:${e.title}:${e.start}`, kind: 'leave', ...shared });
      }
      if (now >= start - lead && now < start + 60e3) soon.push({ key: `event:${e.title}:${e.start}`, kind: 'event', ...shared });
    }
  }
  return [...down, ...leave, ...soon];
}

export function createFocus({ store, onChange }) {
  const dismissed = new Set();
  const firstSeen = new Map();
  let alerts = [];
  let current = null;

  function tick(now = Date.now()) {
    alerts = alerts.filter((a) => a.expires > now);
    const wanted = [...alerts, ...candidates({ widgets: store.config.widgets, state: store.state, settings: store.settings, now })];
    const keys = new Set(wanted.map((c) => c.key));
    for (const k of firstSeen.keys()) if (!keys.has(k)) firstSeen.delete(k);
    for (const k of dismissed) if (!keys.has(k)) dismissed.delete(k);
    let next = null;
    for (const c of wanted) {
      if (!firstSeen.has(c.key)) firstSeen.set(c.key, now);
      const spent = c.seconds && now - firstSeen.get(c.key) > c.seconds * 1000;
      if (!next && !spent && !dismissed.has(c.key)) next = c;
    }
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      current = next;
      onChange(current);
    }
  }

  return {
    tick,
    get current() { return current; },
    /** Show something from a webhook or the Settings test button. */
    alert({ title, text = '', seconds = 30, kind = 'alert' }) {
      const key = `alert:${Date.now()}`;
      alerts = [{ key, kind, title: String(title).slice(0, 120), text: String(text).slice(0, 240), seconds, expires: Date.now() + seconds * 1000 }, ...alerts];
      tick();
    },
    dismiss(now = Date.now()) {
      if (!current) return;
      dismissed.add(current.key);
      alerts = alerts.filter((a) => a.key !== current.key);
      tick(now);
    },
  };
}
