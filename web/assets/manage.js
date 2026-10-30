// The manage app: pairing, onboarding, and day-to-day widget management.
// Plain DOM, no build step, so it runs straight off the Pi.

const app = document.getElementById('app');

// ---------------------------------------------------------------- helpers

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked') el[k] = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

function render(...nodes) {
  app.replaceChildren(...nodes);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !path.startsWith('/api/pair')) {
    showPair();
    throw new Error('Pair this device first');
  }
  if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, msg);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), bad ? 4500 : 1800);
}

/** Run an async action with a spinner on the button; errors become a toast. */
async function busy(btn, fn) {
  btn?.classList.add('busy');
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (err) { toast(err.message, true); return undefined; } finally {
    btn?.classList.remove('busy');
    if (btn) btn.disabled = false;
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function ago(ts) {
  if (!ts) return 'never';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs HTTPS; on plain http fall back to a hidden textarea.
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied');
}

// ---------------------------------------------------------------- icons

const I = {
  summary: '<path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  weather: '<path d="M7 2.8v1.4M2.6 7.2H4M3.9 4.1l1 1M10.1 4.1l-1 1"/><path d="M4.3 10.4A3.3 3.3 0 0 1 10 6.6"/><path d="M8.5 20h8.5a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9-.8A3.9 3.9 0 0 0 8.5 20z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  tasks: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M3.5 6.5l1.2 1.2 2.2-2.4M3.5 12l1.2 1.2 2.2-2.4"/><circle cx="5" cy="17.5" r="1.3"/>',
  webhook: '<path d="M3.5 12h11M11 8l4 4-4 4"/><path d="M19.5 4.5v15"/>',
  api: '<path d="M8 4.5c-2 0-2.5 1-2.5 2.5v2.5c0 1.2-.8 2-2 2.5 1.2.5 2 1.3 2 2.5V17c0 1.5.5 2.5 2.5 2.5M16 4.5c2 0 2.5 1 2.5 2.5v2.5c0 1.2.8 2 2 2.5-1.2.5-2 1.3-2 2.5V17c0 1.5-.5 2.5-2.5 2.5"/>',
  headlines: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7.5 9h9M7.5 12.5h9M7.5 16h5"/>',
  status: '<path d="M3 12.5h4l2.2-5.5 4.2 11 2.4-5.5H21"/>',
  countdown: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.5 8 4.5 8 8.5s-8 4-8 8.5M16 3.5c0 4.5-8 4.5-8 8.5"/>',
  note: '<path d="M5.5 3.5h9l4 4v13h-13z"/><path d="M14.5 3.5v4h4M8.5 12h7M8.5 15.5h5"/>',
  nowplaying: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  bluetooth: '<path d="m7 7 10 10-5 4.5V2.5L17 7 7 17"/>',
  usb: '<path d="M12 2.5v15M12 2.5l-2 3h4z"/><circle cx="12" cy="19" r="2"/><path d="M12 13l-4.5-2.5V8M12 11l4.5-2V7"/><rect x="6.3" y="6" width="2.4" height="2.2" rx=".4"/><circle cx="16.5" cy="6.5" r="1.1"/>',
  hdmi: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/>',
  speaker: '<rect x="5.5" y="2.5" width="13" height="19" rx="2.5"/><circle cx="12" cy="14.5" r="3.5"/><circle cx="12" cy="7" r="1"/>',
  airplay: '<path d="M6.5 17H5a2.5 2.5 0 0 1-2.5-2.5v-8A2.5 2.5 0 0 1 5 4h14a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 19 17h-1.5"/><path d="m12 14 5 6.5H7z"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 5.5 7M4 12.5A8 8 0 0 0 18.5 17"/><path d="M5 3.5V7h3.5M19 20.5V17h-3.5"/>',
};
function icon(name, size = 24) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 ${size} ${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || I.note}</svg>`;
  return t.content.firstChild;
}

const brand = (name) => h('span', { class: 'brand' }, h('span', { class: 'brand-mark' }), 'Panel', name && name !== 'Panel' ? h('span', { class: 'top-name' }, `/ ${name}`) : null);

// ---------------------------------------------------------------- state

let B = null;     // bootstrap payload from the server
let bootId = null; // changes when the server restarts (e.g. after an update)
const updateListeners = new Set();
const audioListeners = new Set();
let tab = 'layout';
let events = null;

const def = (type) => B.catalog.find((c) => c.type === type);
const MASK = '••••';

async function boot() {
  let status;
  try {
    status = await api('GET', '/api/status');
  } catch {
    render(h('div', { class: 'center' }, h('div', { class: 'pair-box' }, brand(), h('h1', {}, 'Can’t reach your panel'), h('p', { class: 'lede' }, 'Make sure it’s powered on and on the same Wi‑Fi, then try again.'), h('p', { style: { marginTop: '24px' } }, h('button', { class: 'btn primary', onclick: boot }, 'Try again')))));
    return;
  }
  bootId = status.bootId;
  if (!status.authed) return showPair();
  if (new URLSearchParams(location.search).has('code')) {
    // Already paired: tidy the URL and take the code off the panel's screen.
    history.replaceState(null, '', '/');
    api('POST', '/api/pair/dismiss').catch(() => {});
  }
  B = await api('GET', '/api/admin/bootstrap');
  if (!B.setupComplete) return showOnboarding();
  showDashboard();
}

// ---------------------------------------------------------------- pairing

function showPair() {
  closeEvents();
  const preset = (new URLSearchParams(location.search).get('code') || '').replace(/\D/g, '').slice(0, 6);
  const input = h('input', {
    class: 'code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6',
    placeholder: '\u2022\u2022\u2022\u2022\u2022\u2022', 'aria-label': 'Pairing code', value: preset,
  });
  const err = h('p', { class: 'error-text', hidden: true });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Connect');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      btn.classList.add('busy');
      try {
        await api('POST', '/api/pair/confirm', { code: input.value });
        history.replaceState(null, '', '/');
        boot();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        input.select();
      } finally {
        btn.classList.remove('busy');
      }
    },
  }, input, err, btn);
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) form.requestSubmit();
  });
  const again = h('a', { href: '#', onclick: (e) => { e.preventDefault(); requestCode(); toast('Check the panel’s screen'); } }, 'Show it again');

  render(h('div', { class: 'center' }, h('div', { class: 'pair-box' },
    brand(),
    h('h1', {}, 'Connect to your panel'),
    h('p', { class: 'lede' }, 'Type the six-digit code that’s showing on the panel’s screen.'),
    form,
    h('p', { class: 'small muted', style: { marginTop: '18px', textAlign: 'center' } }, 'No code on the screen? ', again),
  )));

  const requestCode = () => api('POST', '/api/pair/request').catch(() => {});
  if (preset.length === 6) form.requestSubmit();
  else { requestCode(); input.focus(); }
}

// ---------------------------------------------------------------- shared form controls

function seg(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const paint = (v) => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  for (const o of options) {
    wrap.append(h('button', {
      type: 'button', 'data-v': String(o.value), disabled: o.disabled,
      onclick: () => { paint(o.value); onChange(o.value); },
    }, o.label));
  }
  paint(value);
  return wrap;
}

function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'switch' }, h('span', {}, label), input);
}

function field(label, control, help) {
  return h('div', { class: 'field' }, label ? h('label', {}, label) : null, control, help ? h('div', { class: 'help', html: help }) : null);
}

function timezoneSelect(value, onChange) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }
  if (!zones.includes(value)) zones = [value, ...zones];
  if (!zones.includes('UTC')) zones.push('UTC');
  const sel = h('select', { class: 'input', onchange: () => onChange(sel.value) },
    zones.map((z) => h('option', { value: z }, z.replace(/_/g, ' '))));
  sel.value = value;
  return sel;
}

/** Search-as-you-type place picker backed by Open-Meteo geocoding. */
function locationPicker(value, onChange, { allowClear = false, clearLabel = 'Clear' } = {}) {
  const wrap = h('div');
  const draw = (v) => {
    if (v) {
      wrap.replaceChildren(h('div', { class: 'panel chosen' },
        h('div', {}, h('div', { style: { fontWeight: 500 } }, v.name), v.detail ? h('div', { class: 'small muted' }, v.detail) : null),
        h('div', { class: 'actions' },
          allowClear ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => { onChange(null); draw(null); } }, clearLabel) : null,
          h('button', { type: 'button', class: 'btn small', onclick: () => draw(null) }, 'Change'))));
      return;
    }
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Search for a city', autocomplete: 'off', 'aria-label': 'City' });
    const results = h('div', { class: 'results panel', hidden: true });
    const search = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { results.hidden = true; return; }
      try {
        const list = await api('GET', `/api/geocode?q=${encodeURIComponent(q)}`);
        results.replaceChildren(...(list.length ? list.map((r) => h('button', {
          type: 'button',
          onclick: () => { onChange(r); draw(r); },
        }, h('b', {}, r.name), h('span', {}, r.detail))) : [h('div', { class: 'row muted small' }, 'No places found')]));
        results.hidden = false;
      } catch (err) { toast(err.message, true); }
    }, 280);
    input.addEventListener('input', search);
    wrap.replaceChildren(input, results);
    setTimeout(() => input.focus(), 50);
  };
  draw(value);
  return wrap;
}

let modelList = null;
async function modelOptions() {
  if (!modelList) {
    modelList = api('GET', '/api/ai/models').catch(() => { modelList = null; return []; });
  }
  return modelList;
}
function modelInput(value, onChange) {
  const id = `models-${Math.random().toString(36).slice(2)}`;
  const list = h('datalist', { id });
  const input = h('input', { class: 'input mono', list: id, value, spellcheck: 'false', autocomplete: 'off', oninput: () => onChange(input.value.trim()) });
  modelOptions().then((models) => {
    list.replaceChildren(...models.map((m) => h('option', {
      value: m.id,
    }, `${m.name}${m.input != null ? `  ·  $${m.input.toFixed(2)} / $${m.output.toFixed(2)} per M tokens` : ''}`)));
  });
  return h('div', {}, input, list);
}

// ---------------------------------------------------------------- onboarding

const FEEDS = [
  { label: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { label: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { label: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { label: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
];

function showOnboarding() {
  const locale = navigator.language || 'en-US';
  const prefers24 = !new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12;
  const ob = {
    step: 0,
    name: B.settings.name === 'Panel' ? '' : B.settings.name,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || B.settings.timezone,
    clock24: prefers24,
    units: /^en-(US|LR)|^my/.test(locale) ? 'imperial' : 'metric',
    location: B.settings.location,
    picks: { clock: true, weather: true, summary: true, calendar: false, tasks: true, headlines: false },
    calendarUrls: '',
    feeds: [FEEDS[0].url],
    apiKey: '',
    model: B.settings.ai.model,
  };

  const steps = () => ['welcome', 'location', 'widgets', ...(ob.picks.summary ? ['brief'] : []), 'done'];

  const go = (n) => { ob.step = n; draw(); window.scrollTo({ top: 0 }); };
  const next = () => go(ob.step + 1);
  const back = () => go(Math.max(0, ob.step - 1));

  function frame(title, lede, body, foot) {
    const list = steps();
    return h('div', { class: 'page' },
      h('div', { class: 'top' }, brand(), h('span', { class: 'small muted' }, `${Math.min(ob.step + 1, list.length - 1)} of ${list.length - 1}`)),
      h('div', { class: 'progress' }, list.slice(0, -1).map((_, i) => h('i', { class: i <= ob.step ? 'on' : '' }))),
      h('div', { class: 'step' }, h('h1', {}, title), lede ? h('p', { class: 'lede' }, lede) : null, h('div', { class: 'step-body' }, body), foot),
    );
  }

  function foot({ backable = true, nextLabel = 'Continue', onNext = next, extra = null } = {}) {
    const btn = h('button', { class: 'btn primary', onclick: () => onNext(btn) }, nextLabel);
    return h('div', { class: 'step-foot' },
      backable ? h('button', { class: 'btn ghost', onclick: back }, 'Back') : h('span'),
      h('div', { class: 'actions' }, extra, btn));
  }

  const views = {
    welcome() {
      const name = h('input', { class: 'input', value: ob.name, placeholder: 'Kitchen', maxlength: '40', oninput: () => { ob.name = name.value; } });
      const chips = h('div', { class: 'chips' }, ['Kitchen', 'Desk', 'Office', 'Hallway', 'Studio'].map((n) => h('button', {
        type: 'button', class: 'chip', onclick: () => { name.value = n; ob.name = n; },
      }, n)));
      return frame('Let’s set up your panel', 'A few quick questions. You can change any of this later.', h('div', { class: 'fields' },
        field('What should we call it?', h('div', { class: 'fields' }, name, chips)),
        field('Time zone', timezoneSelect(ob.timezone, (v) => { ob.timezone = v; })),
        h('div', { class: 'half-row' },
          field('Clock', seg([{ value: false, label: '12-hour' }, { value: true, label: '24-hour' }], ob.clock24, (v) => { ob.clock24 = v; })),
          field('Temperature', seg([{ value: 'imperial', label: '°F' }, { value: 'metric', label: '°C' }], ob.units, (v) => { ob.units = v; }))),
      ), foot({ backable: false }));
    },

    location() {
      return frame('Where is it?', 'Used for the weather and nothing else. A city is plenty.',
        locationPicker(ob.location, (r) => {
          ob.location = r;
          if (r?.timezone && r.timezone !== ob.timezone) ob.timezone = r.timezone;
        }),
        foot({ extra: h('button', { class: 'btn ghost', onclick: () => { ob.location = null; next(); } }, 'Skip') }));
    },

    widgets() {
      const options = [
        { key: 'clock', name: 'Clock', desc: 'The time and date.' },
        { key: 'weather', name: 'Weather', desc: ob.location ? `Conditions and forecast for ${ob.location.name}.` : 'Needs a location. Go back to add one.', disabled: !ob.location },
        { key: 'summary', name: 'Daily brief', desc: 'An AI summary of your day, written from everything else on the panel.' },
        { key: 'calendar', name: 'Calendar', desc: 'Today’s agenda from Google, Apple or Outlook.' },
        { key: 'tasks', name: 'Tasks', desc: 'A to-do list you can update from your phone or a webhook.' },
        { key: 'headlines', name: 'Headlines', desc: 'Top stories from news sites you choose.' },
      ];
      if (!ob.location) ob.picks.weather = false;
      const list = h('div', { class: 'picks' });
      const paint = () => {
        list.replaceChildren(...options.flatMap((o) => {
          const on = !!ob.picks[o.key];
          const tile = h('button', {
            type: 'button', class: `pick${on && (o.key === 'calendar' || o.key === 'headlines') ? ' has-extra' : ''}`, 'aria-pressed': String(on), disabled: o.disabled, style: o.disabled ? { opacity: .5 } : null,
            onclick: () => { ob.picks[o.key] = !on; paint(); },
          }, h('span', { class: 'ic' }, icon(o.key)), h('span', {}, h('b', {}, o.name), h('span', {}, o.desc)), h('span', { class: 'tick' }, icon('check')));
          const out = [tile];
          if (on && o.key === 'calendar') {
            const ta = h('textarea', { class: 'input mono', rows: '3', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', value: ob.calendarUrls, oninput: () => { ob.calendarUrls = ta.value; } });
            out.push(h('div', { class: 'pick-extra' }, field('Calendar links', ta,
              'Paste your private iCal link, one per line. <b>Google:</b> Settings → your calendar → “Secret address in iCal format”. <b>Apple:</b> Calendar app → Share → Public calendar. <b>Outlook:</b> Settings → Shared calendars → Publish.')));
          }
          if (on && o.key === 'headlines') {
            out.push(h('div', { class: 'pick-extra' }, field('Sources', h('div', { class: 'chips' }, FEEDS.map((f) => h('button', {
              type: 'button', class: 'chip', 'aria-pressed': String(ob.feeds.includes(f.url)),
              onclick: () => { ob.feeds = ob.feeds.includes(f.url) ? ob.feeds.filter((u) => u !== f.url) : [...ob.feeds, f.url]; paint(); },
            }, f.label))), 'You can add any RSS feed later.')));
          }
          return out;
        }));
      };
      paint();
      return frame('What should it show?', 'Pick a few to start. You can connect your own apps with webhooks once you’re in.', list, foot({
        onNext: () => {
          if (ob.picks.calendar && !ob.calendarUrls.trim()) return toast('Paste a calendar link, or turn Calendar off', true);
          if (!Object.values(ob.picks).some(Boolean)) return toast('Pick at least one widget', true);
          next();
        },
      }));
    },

    brief() {
      const status = h('p', { class: 'small', hidden: true });
      const key = h('input', { class: 'input mono', type: 'password', placeholder: 'sk-or-v1-…', value: ob.apiKey, autocomplete: 'off', spellcheck: 'false', oninput: () => { ob.apiKey = key.value.trim(); } });
      const test = h('button', { type: 'button', class: 'btn small', onclick: () => busy(test, async () => {
        status.hidden = true;
        try {
          await api('POST', '/api/ai/test', { apiKey: ob.apiKey, model: ob.model });
          status.className = 'small ok-text'; status.textContent = 'Connected. Your key works.';
        } catch (err) {
          status.className = 'small error-text'; status.textContent = err.message;
        }
        status.hidden = false;
      }) }, 'Test key');
      return frame('Your daily brief', 'Panel reads your calendar, tasks, weather and anything else you connect, then writes a few calm sentences about your day. It runs on OpenRouter, so you choose the model and pay only for what you use. A brief is usually a fraction of a cent.', h('div', { class: 'fields' },
        field('OpenRouter API key', key, 'Create one at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. It’s stored only on your panel.'),
        field('Model', modelInput(ob.model, (v) => { ob.model = v; }), 'Any OpenRouter model works. Fast, inexpensive models are ideal here.'),
        h('div', { class: 'actions' }, test, status),
      ), foot({
        nextLabel: 'Finish setup',
        onNext: (btn) => {
          if (!ob.apiKey) return toast('Paste a key, or skip the brief for now', true);
          finish(btn);
        },
        extra: h('button', { class: 'btn ghost', onclick: (e) => { ob.picks.summary = false; finish(e.currentTarget); } }, 'Skip for now'),
      }));
    },

    done() {
      return h('div', { class: 'page' },
        h('div', { class: 'top' }, brand()),
        h('div', { class: 'step done-hero' },
          h('div', { class: 'check' }, icon('check')),
          h('h1', {}, `${ob.name || 'Your panel'} is live`),
          h('p', { class: 'lede', style: { margin: '10px auto 0' } }, 'Look up: your screen just changed. Your widgets will fill in over the next few seconds.')),
        h('div', { style: { margin: '32px 0' } }, preview()),
        h('div', { class: 'callout' }, h('b', {}, 'Next: connect your own apps. '), 'Add a Webhook widget and you get a URL. POST a number, a list or a message to it from a script, Zapier, n8n, GitHub Actions, Home Assistant or iOS Shortcuts, and it shows up on the panel.'),
        h('div', { class: 'step-foot' }, h('span'), h('button', { class: 'btn primary', onclick: () => boot() }, 'Open dashboard')));
    },
  };

  async function finish(btn) {
    await busy(btn, async () => {
      await api('PUT', '/api/settings', {
        name: ob.name.trim() || 'Panel',
        timezone: ob.timezone, clock24: ob.clock24, units: ob.units,
        location: ob.location,
        ...(ob.picks.summary && ob.apiKey ? { ai: { apiKey: ob.apiKey, model: ob.model } } : {}),
      });
      for (const w of B.widgets) await api('DELETE', `/api/widgets/${w.id}`);
      for (const spec of starterLayout(ob)) await api('POST', '/api/widgets', spec);
      await api('POST', '/api/setup/complete');
      B = await api('GET', '/api/admin/bootstrap');
      go(steps().length - 1);
    });
  }

  function draw() {
    const name = steps()[ob.step];
    render(views[name]());
  }
  draw();
}

/** Arrange the picked widgets into a 4 × 3 grid that fills edge to edge. */
function starterLayout(ob) {
  const p = ob.picks;
  const top = [
    p.clock && { type: 'clock', w: 1, h: 1 },
    p.weather && { type: 'weather', w: 1, h: 1 },
    p.summary && { type: 'summary', w: 2, h: 1 },
  ].filter(Boolean);
  const bottom = [
    p.calendar && { type: 'calendar', w: 2, h: 2, config: { urls: ob.calendarUrls.trim() } },
    p.tasks && { type: 'tasks', w: 1, h: 2 },
    p.headlines && { type: 'headlines', w: 1, h: 2, config: { feeds: ob.feeds.join('\n') || FEEDS[0].url } },
  ].filter(Boolean);
  const fill = (row, prefer) => {
    if (!row.length) return;
    let used = row.reduce((a, b) => a + b.w, 0);
    // Shrink if the row is too wide, then grow the preferred widget to fill.
    while (used > 4) { const big = row.find((x) => x.w > 1); big.w--; used--; }
    const target = row.find((x) => prefer.includes(x.type)) || row[0];
    target.w += 4 - used;
  };
  fill(top, ['summary', 'clock']);
  fill(bottom, ['calendar', 'headlines']);
  if (!top.length) bottom.forEach((x) => { x.h = 3; });
  if (!bottom.length) top.forEach((x) => { x.h = 3; });
  return [...top, ...bottom];
}

// ---------------------------------------------------------------- live preview

function preview() {
  const size = B.system.displaySize || { width: 1920, height: 1080 };
  const frame = h('iframe', { src: '/display?preview=1', title: 'Live preview of the panel', tabindex: '-1', width: size.width, height: size.height });
  const wrap = h('div', { class: 'preview', style: { aspectRatio: `${size.width} / ${size.height}` } }, frame);
  new ResizeObserver(() => {
    frame.style.transform = `scale(${wrap.clientWidth / size.width})`;
  }).observe(wrap);
  return wrap;
}

// ---------------------------------------------------------------- dashboard

function openEvents(onChange) {
  closeEvents();
  events = new EventSource('/api/stream');
  const merge = (w) => {
    const i = B.widgets.findIndex((x) => x.id === w.id);
    if (i >= 0) B.widgets[i] = { ...B.widgets[i], data: w.data, error: w.error, updatedAt: w.updatedAt };
  };
  events.addEventListener('open', () => onChange('live'));
  events.addEventListener('error', () => onChange('off'));
  events.addEventListener('widget', (e) => { const w = JSON.parse(e.data); if (w) { merge(w); onChange('data', w.id); } });
  events.addEventListener('state', (e) => { const s = JSON.parse(e.data); s.widgets.forEach(merge); onChange('data'); });
  events.addEventListener('update', (e) => setUpdate(JSON.parse(e.data)));
  events.addEventListener('audio', (e) => { const a = JSON.parse(e.data); for (const fn of [...audioListeners]) fn(a); });
}
function closeEvents() {
  events?.close();
  events = null;
}

function showDashboard() {
  const live = h('span', { class: 'live off' }, h('i'), 'Connecting');
  const content = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const TABS = [['layout', 'Widgets'], ['sound', 'Sound'], ['settings', 'Settings'], ['devices', 'Devices']];

  const drawTabs = () => tabs.replaceChildren(...TABS.map(([id, label]) => h('button', {
    role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; drawTabs(); drawContent(); },
  }, label)));
  const drawContent = () => content.replaceChildren(({ layout: layoutTab, sound: soundTab, settings: settingsTab, devices: devicesTab })[tab]());

  render(h('div', { class: `page${tab === 'layout' ? ' wide' : ''}`, id: 'page' },
    h('div', { class: 'top' }, brand(B.settings.name), live),
    updateBanner(),
    tabs, content));
  drawTabs();
  drawContent();

  const page = document.getElementById('page');
  const syncWidth = () => page.classList.toggle('wide', tab === 'layout');
  tabs.addEventListener('click', syncWidth);

  openEvents((kind) => {
    if (kind === 'live') { live.className = 'live'; live.lastChild.textContent = 'Live'; }
    if (kind === 'off') { live.className = 'live off'; live.lastChild.textContent = 'Offline'; }
    if (kind === 'data' && tab === 'layout') refreshRows?.();
  });
}

let refreshRows = null;

function layoutTab() {
  const list = h('div', { class: 'panel rows-list' });
  const capacity = h('div', { class: 'capacity' });

  const move = async (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= B.widgets.length) return;
    [B.widgets[i], B.widgets[j]] = [B.widgets[j], B.widgets[i]];
    draw();
    await api('PUT', '/api/widgets/order', { ids: B.widgets.map((w) => w.id) }).catch((e) => toast(e.message, true));
  };

  const draw = () => {
    if (!B.widgets.length) {
      list.replaceChildren(h('div', { class: 'panel-pad' }, h('p', { class: 'muted' }, 'No widgets yet. Add one to get started.')));
    } else {
      list.replaceChildren(...B.widgets.map((w, i) => {
        const d = def(w.type);
        const sub = w.error ? w.error : w.type === 'webhook' ? (w.updatedAt ? `Webhook · updated ${ago(w.updatedAt)}` : 'Webhook · waiting for first update') : d?.name;
        return h('div', { class: 'wrow', onclick: () => openEditor(w.id) },
          h('span', { class: 'ic' }, icon(w.type)),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, w.title), h('div', { class: 'sub', style: w.error ? { color: 'var(--bad)' } : null }, sub)),
          w.error ? h('span', { class: 'err', title: w.error }) : null,
          h('span', { class: 'size' }, `${w.w}×${w.h}`),
          h('div', { class: 'order', onclick: (e) => e.stopPropagation() },
            h('button', { class: 'btn ghost icon', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, icon('up')),
            h('button', { class: 'btn ghost icon', 'aria-label': 'Move down', disabled: i === B.widgets.length - 1, onclick: () => move(i, 1) }, icon('down'))));
      }));
    }
    const { cols, rows } = B.settings.grid;
    const used = B.widgets.reduce((a, w) => a + w.w * w.h, 0);
    const total = cols * rows;
    capacity.className = `capacity${used > total ? ' over' : ''}`;
    capacity.replaceChildren(
      h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, (used / total) * 100)}%` } })),
      h('span', {}, used > total ? `${used - total} space${used - total > 1 ? 's' : ''} over: some widgets won’t fit` : `${used} of ${total} spaces used`));
  };
  refreshRows = draw;
  draw();

  const reload = h('button', { class: 'btn ghost small', onclick: () => busy(reload, async () => { await api('POST', '/api/display/reload'); toast('Screen reloaded'); }) }, icon('refresh'), 'Reload screen');

  return h('div', { class: 'layout' },
    h('div', { class: 'sticky' },
      preview(),
      h('div', { class: 'preview-cap' }, h('span', {}, `Live preview · ${B.settings.grid.cols} × ${B.settings.grid.rows} grid`), reload)),
    h('div', {},
      h('div', { class: 'group-h' }, h('h2', {}, 'Widgets'), h('span', { class: 'small muted' }, 'Top to bottom fills left to right')),
      list,
      capacity,
      h('div', { style: { marginTop: '16px' } }, h('button', { class: 'btn primary block', onclick: openGallery }, icon('plus'), 'Add widget'))));
}

// ---------------------------------------------------------------- sheet

function openSheet({ title, body, footer, onClose }) {
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-h' }, h('h2', {}, title), h('button', { class: 'btn ghost icon', 'aria-label': 'Close', onclick: close }, icon('x'))),
      h('div', { class: 'sheet-b' }, body),
      footer ? h('div', { class: 'sheet-f' }, footer) : null));
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(scrim);
  return close;
}

function openGallery() {
  const close = openSheet({
    title: 'Add a widget',
    body: h('div', { class: 'gallery' }, B.catalog.map((c) => h('button', {
      type: 'button', class: 'pick',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.style.opacity = .5;
        const w = await busy(null, () => api('POST', '/api/widgets', { type: c.type, draft: true }));
        if (!w) { btn.style.opacity = 1; return; }
        B.widgets.push(w);
        refreshRows?.();
        close();
        openEditor(w.id, { isNew: true });
      },
    }, h('span', { class: 'ic' }, icon(c.type)), h('span', {}, h('b', {}, c.name), h('span', {}, c.description))))),
  });
}

// ---------------------------------------------------------------- widget editor

function showIf(f, cfg) {
  if (!f.showIf) return true;
  return f.showIf.in.includes(cfg[f.showIf.key] ?? '');
}

function fieldControl(f, cfg, onChange) {
  const v = cfg[f.key];
  const saved = f.secret && typeof v === 'string' && v.startsWith(MASK);
  const ph = saved ? `Saved (${v}). Type to replace.` : f.placeholder || '';
  switch (f.type) {
    case 'toggle':
      return toggle(f.label, v ?? f.default ?? false, onChange);
    case 'select': {
      const sel = h('select', { class: 'input', onchange: () => onChange(sel.value, true) }, f.options.map((o) => h('option', { value: o.value }, o.label)));
      sel.value = v ?? f.default ?? f.options[0].value;
      return sel;
    }
    case 'textarea':
    case 'code':
    case 'lines': {
      const mono = f.type !== 'textarea';
      const ta = h('textarea', { class: `input${mono ? ' mono' : ''}`, rows: f.type === 'textarea' ? '4' : '3', placeholder: ph, spellcheck: mono ? 'false' : 'true', oninput: () => onChange(ta.value) });
      ta.value = saved ? '' : v ?? '';
      return ta;
    }
    case 'location':
      return locationPicker(v, (r) => onChange(r), { allowClear: true, clearLabel: 'Use panel location' });
    case 'number': {
      const inp = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: ph, oninput: () => onChange(inp.value) });
      inp.value = v ?? '';
      return inp;
    }
    case 'date': {
      const inp = h('input', { class: 'input', type: 'date', oninput: () => onChange(inp.value) });
      inp.value = v ?? '';
      return inp;
    }
    default: {
      const inp = h('input', { class: `input${f.type === 'url' ? ' mono' : ''}`, type: f.secret ? 'password' : f.type === 'url' ? 'url' : 'text', placeholder: ph, spellcheck: 'false', autocomplete: 'off', oninput: () => onChange(inp.value) });
      inp.value = saved ? '' : v ?? '';
      return inp;
    }
  }
}

function buildFields(fields, cfg, onAnyChange) {
  const wrap = h('div', { class: 'fields' });
  const draw = () => {
    const basic = [];
    const advanced = [];
    const visible = fields.filter((f) => f.type !== 'tasks' && showIf(f, cfg));
    for (let i = 0; i < visible.length; i++) {
      const f = visible[i];
      const make = (x) => {
        const control = fieldControl(x, cfg, (val, structural) => {
          cfg[x.key] = val;
          onAnyChange?.();
          if (structural) draw();
        });
        return x.type === 'toggle' ? control : field(x.label, control, x.help);
      };
      let node;
      if (f.half && visible[i + 1]?.half) { node = h('div', { class: 'half-row' }, make(f), make(visible[i + 1])); i++; }
      else node = make(f);
      (f.advanced ? advanced : basic).push(node);
    }
    const mapping = fields.some((f) => f.advanced && /Path$/.test(f.key));
    wrap.replaceChildren(...basic, advanced.length ? h('details', { class: 'more' },
      h('summary', {}, mapping ? 'Map fields from your own JSON' : 'More options'),
      h('div', { class: 'fields' }, mapping ? h('p', { class: 'help small muted' }, 'Only needed if the sender’s JSON doesn’t match the format below. Use dot paths like data.total or items[0].name.') : null, advanced)) : null);
  };
  draw();
  wrap.redraw = draw;
  return wrap;
}

function exampleBody(w, cfg) {
  if (w.type === 'tasks') return { text: 'Water the plants' };
  return B.samples[cfg.view || 'stat'];
}

function webhookSection(w, cfg, onUpdated) {
  const url = () => `${location.origin}/hook/${w.id}?token=${w.token}`;
  const sec = h('section');
  const draw = () => {
    const body = JSON.stringify(exampleBody(w, cfg));
    const curl = `curl -X POST '${url()}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}'`;
    const test = h('button', { class: 'btn small', onclick: () => busy(test, async () => {
      const updated = await api('POST', `/api/widgets/${w.id}/action`, exampleBody(w, cfg));
      onUpdated(updated);
      toast('Sent. Look at your panel');
    }) }, 'Send test data');
    const rotate = h('button', { class: 'btn ghost small', onclick: () => busy(rotate, async () => {
      if (!confirm('Make a new URL? Anything using the old one will stop working.')) return;
      const updated = await api('POST', `/api/widgets/${w.id}/token`);
      w.token = updated.token;
      onUpdated(updated);
      draw();
      toast('New URL created');
    }) }, 'New URL');
    sec.replaceChildren(
      h('h3', {}, 'Webhook'),
      h('p', { class: 'small muted', style: { marginBottom: '12px' } }, w.type === 'tasks'
        ? 'POST JSON to add or complete tasks from anywhere: {"text": "…"} adds one; add "action": "complete" to check it off.'
        : 'POST JSON to this URL to update the widget. Works with scripts, Zapier, Make, n8n, GitHub Actions, Home Assistant and iOS Shortcuts.'),
      h('div', { class: 'copy' }, h('code', {}, url()), h('button', { class: 'btn ghost icon', 'aria-label': 'Copy URL', onclick: () => copy(url()) }, icon('copy'))),
      h('div', { style: { marginTop: '12px', position: 'relative' } },
        h('pre', { class: 'code' }, curl),
        h('button', { class: 'btn ghost icon', 'aria-label': 'Copy example', style: { position: 'absolute', top: '4px', right: '4px' }, onclick: () => copy(curl) }, icon('copy'))),
      h('div', { class: 'actions', style: { marginTop: '12px' } }, test, rotate),
      h('p', { class: 'help small muted', style: { marginTop: '14px' } }, 'The token can also go in an Authorization: Bearer header. This URL only works on your network. To receive webhooks from cloud services, put Panel behind Tailscale Funnel or Cloudflare Tunnel and expose only /hook/.'));
  };
  draw();
  sec.redraw = draw;
  return sec;
}

function tasksSection(w, onUpdated) {
  const sec = h('section', {}, h('h3', {}, 'Tasks'));
  const list = h('ul', { class: 'task-list' });
  const act = async (body) => {
    const updated = await api('POST', `/api/widgets/${w.id}/action`, body).catch((e) => toast(e.message, true));
    if (updated) { onUpdated(updated); w.data = updated.data; draw(); }
  };
  const draw = () => {
    const tasks = w.data?.tasks || [];
    list.replaceChildren(...(tasks.length ? tasks.map((t) => h('li', { class: t.done ? 'done' : '' },
      h('input', { type: 'checkbox', checked: t.done, 'aria-label': `Complete ${t.text}`, onchange: () => act({ action: 'toggle', id: t.id }) }),
      h('span', {}, t.text),
      h('button', { class: 'btn ghost icon', 'aria-label': `Delete ${t.text}`, onclick: () => act({ action: 'remove', id: t.id }) }, icon('x'))))
      : [h('li', { class: 'muted small' }, 'Nothing yet. Add your first task below.')]));
  };
  const input = h('input', { class: 'input', placeholder: 'Add a task', maxlength: '200' });
  const add = h('form', { class: 'add-task', onsubmit: (e) => { e.preventDefault(); const text = input.value.trim(); if (!text) return; input.value = ''; act({ text }); } },
    input, h('button', { class: 'btn', type: 'submit' }, 'Add'));
  const clear = h('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onclick: () => act({ action: 'clear' }) }, 'Clear finished');
  draw();
  sec.append(list, add, clear);
  return sec;
}

function briefSection(w, onUpdated) {
  const out = h('pre', { class: 'code', style: { whiteSpace: 'pre-wrap', marginTop: '10px', maxHeight: '320px', overflow: 'auto' } }, 'Loading…');
  const details = h('details', { class: 'more', ontoggle: async () => {
    if (!details.open) return;
    try {
      const c = await api('GET', `/api/widgets/${w.id}/context`);
      out.textContent = `${c.system}\n\n——\n\n${c.user}`;
    } catch (e) { out.textContent = e.message; }
  } }, h('summary', {}, 'See exactly what the AI reads'), out);
  const regen = h('button', { class: 'btn small', onclick: () => busy(regen, async () => {
    const updated = await api('POST', `/api/widgets/${w.id}/refresh`);
    onUpdated(updated);
    if (updated.error) toast(updated.error, true); else toast('Brief rewritten');
  }) }, icon('refresh'), 'Rewrite now');
  return h('section', {},
    h('h3', {}, 'Brief'),
    B.settings.aiReady ? null : h('div', { class: 'callout', style: { marginBottom: '12px' } }, h('b', {}, 'Needs an OpenRouter key. '), 'Add one in Settings → Daily brief.'),
    w.data?.text ? h('p', { class: 'small', style: { color: 'var(--ink-2)', marginBottom: '12px' } }, w.data.text) : null,
    h('div', { class: 'actions' }, regen, w.data?.model ? h('span', { class: 'small muted mono' }, w.data.model) : null),
    details);
}

// ---------------------------------------------------------------- API widget tools

function fillTemplate(str, vals) {
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, k) => (vals[k] ?? '').trim());
}

function applyTemplate(t, vals, cfg, draft) {
  // Start clean so leftovers from a previous setup don't confuse the mapping.
  for (const k of Object.keys(cfg)) if (k !== 'includeInBrief') delete cfg[k];
  Object.assign(cfg, { method: 'GET', auth: 'none', every: '5', view: 'stat', maxItems: 8 });
  for (const [k, v] of Object.entries(t.config)) cfg[k] = fillTemplate(v, vals);
  const tokenInput = t.inputs.find((i) => i.token);
  const token = tokenInput && (vals[tokenInput.key] || '').trim();
  if (token) {
    const [kind, header] = tokenInput.token.split(':');
    cfg.auth = kind;
    if (header) cfg.authHeader = header;
    cfg.authToken = token;
  }
  draft.title = fillTemplate(t.title || t.name, vals).slice(0, 60);
  if (t.w) draft.w = Math.min(B.settings.grid.cols, t.w);
  if (t.h) draft.h = Math.min(B.settings.grid.rows, t.h);
}

function templatePicker(templates, { isNew }, onUse) {
  if (!templates.length) return null;
  const sec = h('section');
  const list = () => {
    const groups = [...new Set(templates.map((t) => t.group))];
    sec.replaceChildren(
      h('h3', {}, isNew ? 'Start from a template' : 'Templates'),
      h('p', { class: 'small muted', style: { margin: '-6px 0 12px' } }, 'Or set up any API yourself in Settings below.'),
      ...groups.map((g) => h('div', { class: 'tpl-group' },
        h('div', { class: 'label muted small' }, g),
        h('div', { class: 'chips' }, templates.filter((t) => t.group === g).map((t) => h('button', { type: 'button', class: 'chip', title: t.description, onclick: () => form(t) }, t.name))))));
  };
  const form = (t) => {
    const vals = Object.fromEntries(t.inputs.map((i) => [i.key, i.default || '']));
    const inputs = t.inputs.map((i) => {
      const inp = h('input', { class: `input${i.token ? ' mono' : ''}`, type: i.token ? 'password' : 'text', placeholder: i.placeholder || '', value: vals[i.key], autocomplete: 'off', spellcheck: 'false', oninput: () => { vals[i.key] = inp.value; } });
      return field(`${i.label}${i.optional ? ' (optional)' : ''}`, inp);
    });
    const use = h('button', { class: 'btn primary small', onclick: () => {
      const missing = t.inputs.find((i) => !i.optional && !String(vals[i.key] || '').trim());
      if (missing) return toast(`${missing.label} is needed`, true);
      if (/\{(lat|lon)\}/.test(t.config.url) && !B.settings.location) return toast('Set the panel’s location in Settings first', true);
      onUse(t, vals);
      sec.replaceChildren(h('div', { class: 'callout small' }, h('b', {}, `${t.name} is set up. `), 'Check the test result below, then tap Save.'), h('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onclick: list }, 'Pick a different template'));
    } }, 'Use template');
    sec.replaceChildren(
      h('h3', {}, t.name),
      h('p', { class: 'small muted', style: { margin: '-6px 0 14px' } }, t.description),
      h('div', { class: 'fields' }, inputs.length ? inputs : h('p', { class: 'small muted' }, 'Nothing to fill in.')),
      h('div', { class: 'actions', style: { marginTop: '14px' } }, use, h('button', { class: 'btn ghost small', onclick: list }, 'Back')));
    sec.querySelector('input')?.focus();
  };
  list();
  return sec;
}

const PICK_TARGETS = {
  stat: [['valuePath', 'Number'], ['deltaPath', 'Change'], ['labelPath', 'Label']],
  progress: [['valuePath', 'Value'], ['maxPath', 'Goal'], ['labelPath', 'Label']],
  list: [['itemsPath', 'Rows (a list)'], ['itemTitlePath', 'Row title'], ['itemMetaPath', 'Row detail'], ['itemStatusPath', 'Row status']],
  feed: [['itemsPath', 'Rows (a list)'], ['itemTitlePath', 'Row title'], ['itemMetaPath', 'Row detail']],
  text: [['textPath', 'Text']],
};

function apiTester(w, cfg, onMapped) {
  const sec = h('section');
  let result = null;
  let target = null;

  const run = async (reuse = false) => {
    if (!cfg.url) { result = null; draw(); return; }
    if (!reuse) { result = { loading: true }; draw(); }
    try {
      result = await api('POST', `/api/widgets/${w.id}/preview`, { config: cfg, reuse });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    draw();
  };

  const targets = () => PICK_TARGETS[cfg.view || 'stat'] || PICK_TARGETS.stat;

  const pick = (path, value) => {
    const t = target || targets()[0][0];
    if (t === 'itemsPath') {
      if (!Array.isArray(value)) return toast('Pick a list: the ones marked [ ]', true);
      cfg.itemsPath = path;
      target = 'itemTitlePath';
    } else if (t.startsWith('item')) {
      const base = cfg.itemsPath || '';
      let rel = null;
      if (path.startsWith(`${base}[`)) rel = path.slice(path.indexOf(']', base.length) + 1).replace(/^\./, '');
      else {
        const m = /^(.*?)\[\d+\]\.?(.*)$/.exec(path);
        if (m) { cfg.itemsPath = m[1]; rel = m[2]; }
      }
      if (!rel) return toast('Pick a value inside one of the rows', true);
      if (value && typeof value === 'object') return toast('Pick a single value, not a group', true);
      cfg[t] = rel;
      const order = targets().map(([k]) => k);
      target = order[order.indexOf(t) + 1] || t;
    } else {
      if (value && typeof value === 'object') return toast('Pick a single value, not a group', true);
      cfg[t] = path;
      const order = targets().map(([k]) => k);
      target = order[order.indexOf(t) + 1] || t;
    }
    onMapped();
    run(true);
  };

  /** Which path a row of the explorer currently feeds, for highlighting. */
  const usedBy = (path) => {
    const hits = [];
    for (const [k, label] of targets()) {
      const v = cfg[k];
      if (v == null || v === '') continue;
      const full = k.startsWith('item') && k !== 'itemsPath' ? `${cfg.itemsPath || ''}[0]${v.startsWith('[') ? '' : '.'}${v}` : v;
      if (full === path || (k === 'itemsPath' && v === path)) hits.push(label.replace(/ \(a list\)$/, ''));
    }
    return hits;
  };

  const tree = (value) => {
    const rows = [];
    const walk = (key, v, path, depth) => {
      if (rows.length > 400) return;
      const isObj = v && typeof v === 'object';
      const tags = usedBy(path);
      const preview = isObj
        ? (Array.isArray(v) ? `[ ${v.length}${v.length >= 20 ? '+' : ''} ]` : `{ ${Object.keys(v).length} }`)
        : typeof v === 'string' ? `"${v}"` : String(v);
      rows.push(h('button', {
        type: 'button', class: `jt-row${tags.length ? ' picked' : ''}${isObj ? ' group' : ''}`,
        style: { paddingLeft: `${10 + depth * 14}px` }, title: path || '(whole response)',
        onclick: () => pick(path, v),
      },
      key != null ? h('span', { class: 'jt-k' }, key) : null,
      h('span', { class: `jt-v ${isObj ? 'muted' : typeof v}` }, preview),
      tags.length ? h('span', { class: 'jt-tag' }, tags.join(', ')) : null));
      if (!isObj || depth > 7) return;
      if (Array.isArray(v)) {
        v.slice(0, 3).forEach((x, i) => walk(`${i}`, x, `${path}[${i}]`, depth + 1));
        if (v.length > 3) rows.push(h('div', { class: 'jt-more', style: { paddingLeft: `${24 + depth * 14}px` } }, `… ${v.length - 3} more`));
      } else {
        for (const [k, x] of Object.entries(v)) walk(k, x, path ? `${path}.${k}` : k, depth + 1);
      }
    };
    walk(null, value, '', 0);
    return h('div', { class: 'jt' }, rows);
  };

  const showsAs = (m) => {
    if (!m) return null;
    const view = cfg.view || 'stat';
    let text;
    if (view === 'stat') text = `${m.prefix || ''}${typeof m.value === 'number' ? m.value.toLocaleString() : m.value}${m.suffix || ''}${m.delta ? `  ${m.delta}` : ''}${m.caption || m.label ? `  · ${m.caption || m.label}` : ''}`;
    else if (view === 'progress') text = `${Math.round((m.value / m.max) * 100)}%  (${m.value} of ${m.max})${m.label ? ` · ${m.label}` : ''}`;
    else if (view === 'text') text = m.text;
    else {
      text = m.items.length ? m.items.slice(0, 4).map((i) => h('div', { class: 'shows-row' },
        i.status ? h('span', { class: `sdot ${i.status}` }) : null,
        h('span', {}, i.title), i.meta ? h('span', { class: 'muted' }, ` \u2014 ${i.meta}`) : null)) : '(no rows)';
    }
    return h('div', { class: 'shows-as' }, h('div', { class: 'label small muted' }, 'On the panel'), h('div', { class: `shows-as-v ${view}` }, text));
  };

  const draw = () => {
    const test = h('button', { class: 'btn small', onclick: () => run(false) }, icon('refresh'), result ? 'Test again' : 'Test request');
    const parts = [h('div', { class: 'actions', style: { justifyContent: 'space-between' } }, h('h3', { style: { margin: 0 } }, 'Test and pick fields'), test)];
    if (!result) {
      parts.push(h('p', { class: 'small muted', style: { marginTop: '8px' } }, cfg.url ? 'Run the request to see the response, then tap the values you want on the panel.' : 'Add a URL or pick a template first.'));
    } else if (result.loading) {
      parts.push(h('div', { class: 'row small muted', style: { padding: '12px 0' } }, h('span', { class: 'spinner' }), 'Calling the API…'));
    } else {
      const meta = result.meta;
      parts.push(h('div', { class: 'small', style: { margin: '10px 0' } },
        h('span', { class: result.ok ? 'ok-text' : 'error-text' }, result.ok ? '● Connected' : '● Failed'),
        meta ? h('span', { class: 'muted' }, ` · ${meta.status} · ${meta.ms} ms${meta.type ? ` · ${meta.type}` : ''}`) : null));
      if (!result.ok) parts.push(h('p', { class: 'error-text' }, result.error));
      if (result.ok && result.mapped) parts.push(showsAs(result.mapped));
      if (result.ok && result.mapError) parts.push(h('p', { class: 'small', style: { color: 'var(--warn)', margin: '8px 0' } }, `${result.mapError}. Tap a value below to fix it.`));
      if (result.body != null && typeof result.body === 'object') {
        const sel = h('select', { class: 'input', style: { height: '36px', width: 'auto' }, onchange: () => { target = sel.value; } },
          targets().map(([k, label]) => h('option', { value: k }, label)));
        sel.value = target && targets().some(([k]) => k === target) ? target : targets()[0][0];
        target = sel.value;
        parts.push(h('div', { class: 'actions', style: { margin: '14px 0 8px' } }, h('span', { class: 'small' }, 'Tap a value to use it as'), sel));
        parts.push(tree(result.body));
      } else if (result.body != null) {
        parts.push(h('pre', { class: 'code', style: { whiteSpace: 'pre-wrap', marginTop: '10px' } }, String(result.body)));
      }
    }
    sec.replaceChildren(...parts.filter(Boolean));
  };
  draw();
  sec.run = () => run(false);
  return sec;
}

function openEditor(id, { isNew = false } = {}) {
  const w = B.widgets.find((x) => x.id === id);
  if (!w) return;
  const d = def(w.type);
  const cfg = structuredClone(w.config || {});
  const draft = { title: w.title, w: w.w, h: w.h };
  const { cols, rows } = B.settings.grid;
  let dirty = false;
  let saved = false;

  const updateLocal = (updated) => {
    Object.assign(w, updated);
    refreshRows?.();
    statusLine.replaceChildren(...statusBits());
  };

  const statusBits = () => [
    w.error ? h('span', { class: 'error-text' }, w.error) : h('span', { class: 'small muted' }, w.updatedAt ? `Updated ${ago(w.updatedAt)}` : d.hookable && w.type !== 'tasks' ? 'Waiting for the first webhook' : w.type === 'api' && !w.config?.url ? 'Not set up yet' : d.refreshable ? 'Loading…' : ''),
  ];
  const statusLine = h('div', { style: { marginTop: '14px' } }, statusBits());

  const title = h('input', { class: 'input', value: draft.title, maxlength: '60', oninput: () => { draft.title = title.value; dirty = true; } });
  const sizes = h('div', { class: 'half-row' });
  const drawSizes = () => sizes.replaceChildren(
    field('Width', seg(Array.from({ length: cols }, (_, i) => ({ value: i + 1, label: String(i + 1) })), draft.w, (v) => { draft.w = v; dirty = true; })),
    field('Height', seg(Array.from({ length: rows }, (_, i) => ({ value: i + 1, label: String(i + 1) })), draft.h, (v) => { draft.h = v; dirty = true; })));
  drawSizes();

  const hook = d.hookable ? webhookSection(w, cfg, updateLocal) : null;
  const settingsFields = d.fields.filter((f) => f.type !== 'tasks');
  const fields = settingsFields.length ? buildFields(settingsFields, cfg, () => { dirty = true; hook?.redraw(); }) : null;

  // API widgets: start from a template, then test the request and pick fields.
  let tester = null;
  const apiTools = w.type === 'api' ? {
    templates: templatePicker(d.templates || [], { isNew: isNew || !cfg.url }, (t, vals) => {
      applyTemplate(t, vals, cfg, draft);
      title.value = draft.title;
      drawSizes();
      fields.redraw();
      dirty = true;
      tester.run();
    }),
    tester: (tester = apiTester(w, cfg, () => { fields.redraw(); dirty = true; })),
  } : null;

  const body = h('div', {},
    apiTools?.templates,
    h('section', {}, h('div', { class: 'fields' }, field('Title', title), sizes), statusLine),
    fields ? h('section', {}, h('h3', {}, 'Settings'), fields) : null,
    apiTools?.tester,
    w.type === 'tasks' ? tasksSection(w, updateLocal) : null,
    w.type === 'summary' ? briefSection(w, updateLocal) : null,
    hook);

  const del = h('button', { class: 'btn ghost danger', onclick: () => busy(del, async () => {
    if (!confirm(`Remove “${w.title}” from the panel?`)) return;
    await api('DELETE', `/api/widgets/${w.id}`);
    B.widgets = B.widgets.filter((x) => x.id !== w.id);
    refreshRows?.();
    saved = true;
    close();
    toast('Removed');
  }) }, 'Remove');

  const refresh = d.refreshable && w.type !== 'summary' ? h('button', { class: 'btn', onclick: () => busy(refresh, async () => {
    const updated = await api('POST', `/api/widgets/${w.id}/refresh`);
    updateLocal(updated);
    toast(updated.error ? updated.error : 'Refreshed', !!updated.error);
  }) }, 'Refresh') : null;

  const save = h('button', { class: 'btn primary', onclick: () => busy(save, async () => {
    const missing = d.fields.find((f) => f.required && showIf(f, cfg) && !String(cfg[f.key] ?? '').trim());
    if (missing) throw new Error(`${missing.label} is required`);
    const updated = await api('PUT', `/api/widgets/${w.id}`, { ...draft, config: cfg, publish: isNew });
    Object.assign(w, updated);
    refreshRows?.();
    dirty = false;
    saved = true;
    close();
    toast(isNew ? 'Added to the panel' : 'Saved');
  }) }, isNew ? 'Add to panel' : 'Save');

  const close = openSheet({
    title: isNew ? `New ${/^[A-Z]{2,}$/.test(d.name) ? d.name : d.name.toLowerCase()} widget` : w.title,
    body,
    footer: [del, h('span', { class: 'spacer', style: { flex: 1 } }), refresh, save],
    onClose: () => {
      // A widget added from the gallery but never saved shouldn't linger on the panel.
      if (isNew && !saved) {
        api('DELETE', `/api/widgets/${w.id}`).catch(() => {});
        B.widgets = B.widgets.filter((x) => x.id !== w.id);
        refreshRows?.();
        return;
      }
      if (dirty) toast('Changes not saved');
    },
  });
}

// ---------------------------------------------------------------- updates

function setUpdate(u) {
  if (!B || !u) return;
  const was = B.update?.phase;
  B.update = u;
  for (const fn of [...updateListeners]) fn(u);
  if (u.phase === 'restarting' && was !== 'restarting') waitForRestart();
}

/** Register a redraw that runs on every update-state change while `el` is on the page. */
function onUpdateState(el, draw) {
  const fn = (u) => { if (!el.isConnected) { updateListeners.delete(fn); return; } draw(u); };
  updateListeners.add(fn);
  draw(B.update);
  return el;
}

let waiting = false;
async function waitForRestart() {
  if (waiting) return;
  waiting = true;
  const started = Date.now();
  // Poll until a new server process answers, then reload onto the new code.
  while (Date.now() - started < 180e3) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const s = await fetch('/api/status', { cache: 'no-store' }).then((r) => r.json());
      if (s.bootId && s.bootId !== bootId) { location.reload(); return; }
    } catch { /* still restarting */ }
  }
  waiting = false;
  toast('Panel is taking a while to come back. Try reloading this page.', true);
}

async function installUpdate(btn) {
  await busy(btn, async () => {
    const u = await api('POST', '/api/system/update');
    setUpdate(u);
  });
}

const PHASES = {
  downloading: 'Downloading the update…',
  installing: 'Installing… this can take a minute on a Pi.',
  restarting: 'Restarting Panel. This page will reload on its own.',
};

function changeList(u) {
  return h('ul', { class: 'changes' }, u.changes.map((c) => h('li', {},
    h('span', {}, c.subject),
    h('span', { class: 'mono muted' }, c.commit))),
    u.behind > u.changes.length ? h('li', { class: 'muted' }, `and ${u.behind - u.changes.length} more`) : null);
}

function updateBanner() {
  const el = h('div', { class: 'update', hidden: true });
  return onUpdateState(el, (u) => {
    if (!u?.supported || (!u.available && !u.phase)) { el.hidden = true; return; }
    el.hidden = false;
    if (u.phase && u.phase !== 'failed') {
      el.className = 'update working';
      el.replaceChildren(
        h('span', { class: 'spinner' }),
        h('div', { class: 'grow' }, h('b', {}, 'Updating Panel'), h('div', { class: 'small muted' }, PHASES[u.phase])));
      return;
    }
    const btn = h('button', { class: 'btn primary small', onclick: () => installUpdate(btn) }, u.phase === 'failed' ? 'Try again' : 'Update now');
    const version = u.latest?.version && u.latest.version !== u.current.version ? `Version ${u.latest.version}` : `${u.behind} new change${u.behind === 1 ? '' : 's'}`;
    el.className = `update${u.phase === 'failed' ? ' failed' : ''}`;
    el.replaceChildren(
      h('div', { class: 'update-row' },
        h('span', { class: 'update-dot' }),
        h('div', { class: 'grow' },
          h('b', {}, u.phase === 'failed' ? 'The update didn’t install' : 'An update is available'),
          h('div', { class: 'small muted' }, u.phase === 'failed' ? u.error : `${version} · takes about a minute, and the screen comes back on its own`)),
        btn),
      u.changes.length && u.phase !== 'failed' ? h('details', { class: 'more' }, h('summary', {}, 'What’s new'), changeList(u)) : null);
  });
}

function updateSection() {
  const el = h('div', { class: 'panel' });
  return onUpdateState(el, (u) => {
    u ||= {};
    const ver = `${u.current?.version || B.system.version}${u.current?.commit ? ` (${u.current.commit})` : ''}`;
    let status;
    if (!u.supported) status = h('span', { class: 'muted' }, u.supported === false ? 'Not available for this install' : 'Checking…');
    else if (u.phase && u.phase !== 'failed') status = h('span', {}, PHASES[u.phase]);
    else if (u.checking) status = h('span', { class: 'muted' }, 'Checking for updates…');
    else if (u.available) status = h('span', { style: { fontWeight: 500 } }, 'Update available');
    else status = h('span', {}, 'Up to date');

    const check = h('button', { class: 'btn small', disabled: !u.supported || u.checking || (u.phase && u.phase !== 'failed'), onclick: () => busy(check, async () => {
      const r = await api('POST', '/api/system/check-update');
      setUpdate(r);
      if (r.error) toast(r.error, true);
      else toast(r.available ? 'An update is available' : 'You’re up to date');
    }) }, 'Check now');
    const install = u.available && !u.phase ? h('button', { class: 'btn small primary', onclick: () => installUpdate(install) }, 'Update now') : null;
    const restart = B.system.managed ? h('button', { class: 'btn small ghost', onclick: () => busy(restart, async () => {
      if (!confirm('Restart Panel? The screen will blank for a few seconds.')) return;
      await api('POST', '/api/system/restart');
      toast('Restarting…');
      waitForRestart();
    }) }, 'Restart') : null;

    el.replaceChildren(h('div', { class: 'rows-list' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, status),
          h('div', { class: 'sub' }, `Version ${ver}${u.checkedAt ? ` · checked ${ago(u.checkedAt)}` : ''}`)),
        h('div', { class: 'actions' }, check, install)),
      u.error && u.phase !== 'restarting' ? h('div', { class: 'row error-text' }, u.error) : null,
      u.available && u.changes?.length ? h('div', { class: 'row', style: { display: 'block' } }, h('div', { class: 'label', style: { marginBottom: '6px' } }, 'What’s new'), changeList(u)) : null,
      u.supported ? h('div', { class: 'row', style: { display: 'block' } },
        toggle('Install updates automatically', !!B.settings.autoUpdate, (v) => saveSettings({ autoUpdate: v })),
        h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'Checks every few hours and installs overnight, between 3 and 6 AM.')) : null,
      restart ? h('div', { class: 'row' }, h('span', { class: 'grow small muted' }, 'Restart the Panel server'), restart) : null));
  });
}

// ---------------------------------------------------------------- sound

const KIND = {
  bluetooth: 'Bluetooth',
  usb: 'USB',
  hdmi: 'Screen speakers (HDMI)',
  headphones: 'Headphone jack',
  other: 'Speaker',
};

function soundTab() {
  const wrap = h('div', {}, h('p', { class: 'muted', style: { padding: '8px 4px' } }, 'Looking for speakers…'));
  let A = null;
  let scanning = false;

  const act = (btn, fn) => busy(btn, async () => {
    const next = await fn();
    if (next?.caps) { A = next; draw(); }
  });

  const setVolume = debounce((v) => api('PUT', '/api/audio/volume', { volume: v }).catch((e) => toast(e.message, true)), 150);

  function speakers() {
    const rows = A.outputs.map((o) => {
      const on = o.name === A.output;
      // The Pi's own outputs have technical names; call them what they are.
      const builtIn = (o.kind === 'hdmi' || o.kind === 'headphones') && /built-in|bcm2835|vc4|fef0/i.test(`${o.description} ${o.name}`);
      const label = builtIn ? KIND[o.kind] : o.description;
      const detail = builtIn ? 'Built into the Pi' : KIND[o.kind];
      return h('button', { type: 'button', class: `out${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: (e) => {
        if (on) return;
        act(e.currentTarget, async () => { const r = await api('PUT', '/api/audio/output', { name: o.name }); toast(`Playing through ${label}`); return r; });
      } },
      h('span', { class: 'ic' }, icon(o.kind === 'other' ? 'speaker' : o.kind)),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, label), h('span', { class: 'sub' }, detail + (o.state === 'running' ? ' · playing now' : ''))),
      h('span', { class: 'radio' }));
    });
    const slider = h('input', { type: 'range', min: '0', max: '100', step: '1', value: A.volume ?? 50, 'aria-label': 'Volume', class: 'range',
      oninput: () => { pct.textContent = `${slider.value}%`; setVolume(+slider.value); } });
    const pct = h('span', { class: 'small muted mono', style: { width: '40px', textAlign: 'right' } }, `${A.volume ?? 50}%`);
    const mute = h('button', { class: 'btn ghost icon', 'aria-label': A.muted ? 'Unmute' : 'Mute', onclick: () => act(mute, () => api('PUT', '/api/audio/volume', { muted: !A.muted })) }, icon(A.muted ? 'mute' : 'volume'));
    const test = h('button', { class: 'btn small', onclick: () => act(test, async () => { await api('POST', '/api/audio/test'); toast('Played a chime'); }) }, 'Play test sound');
    return [
      h('div', { class: 'group-h' }, h('h2', {}, 'Speaker'), h('span', { class: 'small muted' }, 'Where the Pi plays sound')),
      A.error ? h('div', { class: 'callout', style: { marginBottom: '12px' } }, A.error) : null,
      h('div', { class: 'panel rows-list' },
        rows.length ? rows : h('div', { class: 'panel-pad muted' }, 'No speakers found. Plug one into USB or the headphone jack, or pair one over Bluetooth below.'),
        h('div', { class: 'row' }, mute, slider, pct),
        h('div', { class: 'row' }, h('span', { class: 'grow small muted' }, 'Check the speaker is working'), test)),
    ];
  }

  function bluetooth() {
    const b = A.bluetooth;
    const deviceRow = (d) => {
      const isBusy = b.busy === d.mac;
      const btn = (label, action, cls = 'btn small') => {
        const el = h('button', { class: cls, disabled: !!b.busy, onclick: () => act(el, async () => {
          if (action === 'forget' && !confirm(`Forget ${d.name}? You’ll need to pair it again to use it.`)) return null;
          const r = await api('POST', `/api/audio/bluetooth/${d.mac}/${action}`);
          toast({ pair: `Paired with ${d.name}`, connect: `Connected to ${d.name}`, disconnect: 'Disconnected', forget: 'Forgotten' }[action]);
          return r;
        }) }, label);
        return el;
      };
      return h('div', { class: 'row' },
        h('span', { class: 'ic-sm' }, icon(d.audio === false ? 'bluetooth' : 'speaker')),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, d.name),
          h('div', { class: 'sub' }, isBusy ? 'Connecting…' : d.paired ? (d.connected ? 'Connected' : 'Not connected') : d.audio ? 'Speaker or headphones' : 'Other device')),
        d.paired
          ? h('div', { class: 'actions' }, d.connected ? btn('Disconnect', 'disconnect') : btn('Connect', 'connect', 'btn small primary'), btn('Forget', 'forget', 'btn small ghost'))
          : btn('Pair', 'pair', 'btn small primary'));
    };
    const find = h('button', { class: 'btn small', disabled: scanning || b.scanning || !!b.busy, onclick: async () => {
      scanning = true;
      draw();
      try {
        const r = await api('POST', '/api/audio/bluetooth/scan');
        A = r;
        if (!r.bluetooth.nearby.length) toast('No speakers found. Is yours in pairing mode?', true);
      } catch (err) { toast(err.message, true); }
      scanning = false;
      draw();
    } }, scanning || b.scanning ? 'Looking…' : 'Find speakers');
    return [
      h('div', { class: 'group-h' }, h('h2', {}, 'Bluetooth'), find),
      b.error ? h('div', { class: 'callout', style: { marginBottom: '12px' } }, b.error) : null,
      h('div', { class: 'panel rows-list' },
        b.devices.length ? b.devices.map(deviceRow) : h('div', { class: 'panel-pad small muted' }, 'No Bluetooth speakers yet. Put your speaker in pairing mode (usually by holding its Bluetooth button until it flashes), then tap Find speakers.'),
        scanning || b.scanning ? h('div', { class: 'row small muted' }, h('span', { class: 'spinner' }), 'Looking for nearby speakers for about 12 seconds…') : null),
      b.nearby.length && !(scanning || b.scanning) ? h('div', {},
        h('div', { class: 'group-h', style: { marginTop: '16px' } }, h('h2', {}, 'Nearby')),
        h('div', { class: 'panel rows-list' }, b.nearby.map(deviceRow))) : null,
      h('p', { class: 'small muted', style: { margin: '10px 4px 0' } }, 'Panel reconnects your speaker automatically whenever it’s switched on.'),
    ];
  }

  function airplay() {
    const a = A.airplay;
    const np = A.nowPlaying;
    const hasWidget = B.widgets.some((w) => w.type === 'nowplaying');
    const addWidget = h('button', { class: 'btn small', onclick: () => act(addWidget, async () => {
      const w = await api('POST', '/api/widgets', { type: 'nowplaying' });
      B.widgets.push(w);
      toast('Now playing added to the screen');
      draw();
    }) }, icon('plus'), 'Show it on the screen');
    return [
      h('div', { class: 'group-h' }, h('h2', {}, 'AirPlay')),
      h('div', { class: 'panel rows-list' },
        h('div', { class: 'row', style: { display: 'block' } },
          toggle('Play music here from iPhone, iPad and Mac', a.enabled, (v) => act(null, () => api('PUT', '/api/audio/airplay', { enabled: v }))),
          h('div', { class: 'small muted', style: { marginTop: '2px' } }, a.enabled
            ? (a.running ? `Ready. Shows up as “${a.name}”. Rename it in Settings.` : 'Starting…')
            : 'Off. Nothing can play to this panel.')),
        a.error ? h('div', { class: 'row error-text' }, a.error) : null,
        np && np.state !== 'idle' && np.title ? h('div', { class: 'row' },
          np.artUrl ? h('img', { src: np.artUrl, alt: '', class: 'np-thumb' }) : h('span', { class: 'ic-sm' }, icon('nowplaying')),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, np.title), h('div', { class: 'sub' }, [np.artist, np.source && `from ${np.source}`].filter(Boolean).join(' · '))),
          h('span', { class: 'small muted' }, np.state === 'paused' ? 'Paused' : 'Playing')) : null,
        a.enabled && !hasWidget ? h('div', { class: 'row' }, h('span', { class: 'grow small muted' }, 'Show the song, artist and album art on the panel'), addWidget) : null),
      a.enabled ? h('div', { class: 'callout', style: { marginTop: '12px' } },
        h('b', {}, 'How to play here. '),
        `On iPhone, open Control Center, tap the AirPlay icon on the music card, and choose “${a.name}”. On a Mac, use the AirPlay button in Music or Control Center → Sound. Volume follows your phone. Sound comes out of the speaker selected above.`) : null,
    ];
  }

  function draw() {
    if (!wrap.isConnected && A) { audioListeners.delete(listener); return; }
    if (!A) return;
    if (!A.caps.sound && !A.caps.airplay && !A.caps.bluetooth) {
      wrap.replaceChildren(h('div', { class: 'callout' }, h('b', {}, 'Sound controls work on the Raspberry Pi. '),
        'This computer doesn’t have the Pi’s sound tools (PipeWire, BlueZ and shairport-sync). On a Pi, rerun the installer to set them up.'));
      return;
    }
    wrap.replaceChildren(...[
      ...(A.caps.sound ? speakers() : []),
      ...(A.caps.bluetooth ? bluetooth() : []),
      ...(A.caps.airplay ? airplay() : []),
    ].filter(Boolean));
  }

  const listener = (a) => {
    if (!wrap.isConnected) { audioListeners.delete(listener); return; }
    // Don't redraw under the user's finger while they drag the volume slider.
    if (document.activeElement?.type === 'range') return;
    A = a;
    draw();
  };
  audioListeners.add(listener);
  api('GET', '/api/audio').then((a) => { A = a; draw(); }).catch((e) => wrap.replaceChildren(h('p', { class: 'error-text' }, e.message)));
  return wrap;
}

// ---------------------------------------------------------------- settings

async function saveSettings(patch, quiet = false) {
  try {
    await api('PUT', '/api/settings', patch);
    B = { ...B, ...(await api('GET', '/api/admin/bootstrap')) };
    if (!quiet) toast('Saved');
  } catch (err) {
    toast(err.message, true);
  }
}

function settingsTab() {
  const s = B.settings;
  const sys = B.system;
  const save = debounce((patch) => saveSettings(patch), 500);

  const name = h('input', { class: 'input', value: s.name, maxlength: '40', onchange: () => saveSettings({ name: name.value }) });

  const nightRow = h('div', { class: 'half-row', hidden: s.theme !== 'auto' },
    field('Dark from', h('input', { class: 'input', type: 'time', value: s.nightStart, onchange: (e) => save({ nightStart: e.target.value }) })),
    field('Until', h('input', { class: 'input', type: 'time', value: s.nightEnd, onchange: (e) => save({ nightEnd: e.target.value }) })));

  // AI
  const ai = { apiKey: s.ai.apiKey, model: s.ai.model };
  const keyInput = h('input', { class: 'input mono', type: 'password', placeholder: s.ai.apiKey ? `Saved (${s.ai.apiKey}). Paste to replace.` : 'sk-or-v1-…', autocomplete: 'off', spellcheck: 'false', oninput: () => { ai.apiKey = keyInput.value.trim() || s.ai.apiKey; } });
  const aiStatus = h('p', { class: 'small', hidden: true });
  const testBtn = h('button', { class: 'btn small', onclick: () => busy(testBtn, async () => {
    aiStatus.hidden = true;
    try {
      const r = await api('POST', '/api/ai/test', ai);
      aiStatus.className = 'small ok-text'; aiStatus.textContent = `Connected to ${r.model}.`;
    } catch (err) { aiStatus.className = 'small error-text'; aiStatus.textContent = err.message; }
    aiStatus.hidden = false;
  }) }, 'Test');
  const aiSave = h('button', { class: 'btn small primary', onclick: () => busy(aiSave, () => saveSettings({ ai })) }, 'Save');

  const sysRow = (k, v) => h('div', { class: 'row' }, h('span', { class: 'grow muted' }, k), h('span', { class: 'mono', style: { textAlign: 'right', wordBreak: 'break-all' } }, v));

  return h('div', {},
    h('div', { class: 'group-h' }, h('h2', {}, 'General')),
    h('div', { class: 'panel panel-pad fields' },
      field('Name', name),
      field('Time zone', timezoneSelect(s.timezone, (v) => saveSettings({ timezone: v }))),
      h('div', { class: 'half-row' },
        field('Clock', seg([{ value: false, label: '12-hour' }, { value: true, label: '24-hour' }], s.clock24, (v) => saveSettings({ clock24: v }))),
        field('Temperature', seg([{ value: 'imperial', label: '°F' }, { value: 'metric', label: '°C' }], s.units, (v) => saveSettings({ units: v })))),
      field('Location', locationPicker(s.location, (r) => saveSettings({ location: r })), 'Used for weather.')),

    h('div', { class: 'group-h' }, h('h2', {}, 'Display')),
    h('div', { class: 'panel panel-pad fields' },
      h('div', { class: 'half-row' },
        field('Columns', seg([1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) })), s.grid.cols, (v) => saveSettings({ grid: { cols: v } }))),
        field('Rows', seg([1, 2, 3, 4].map((n) => ({ value: n, label: String(n) })), s.grid.rows, (v) => saveSettings({ grid: { rows: v } })))),
      field('Appearance', seg([{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'Dark at night' }], s.theme, (v) => {
        nightRow.hidden = v !== 'auto';
        saveSettings({ theme: v });
      })),
      nightRow),

    h('div', { class: 'group-h' }, h('h2', {}, 'Daily brief')),
    h('div', { class: 'panel panel-pad fields' },
      field('OpenRouter API key', keyInput, 'Get one at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. Stored only on your panel.'),
      field('Model', modelInput(ai.model, (v) => { ai.model = v; }), 'Any model ID from <a href="https://openrouter.ai/models" target="_blank" rel="noopener">openrouter.ai/models</a>.'),
      h('div', { class: 'actions' }, aiSave, testBtn, aiStatus)),

    h('div', { class: 'group-h' }, h('h2', {}, 'Software update')),
    updateSection(),

    h('div', { class: 'group-h' }, h('h2', {}, 'System')),
    h('div', { class: 'panel rows-list' },
      sysRow('Address', sys.urls.name),
      sys.urls.ip ? sysRow('IP address', sys.urls.ip) : null,
      sysRow('Data', sys.dataDir)));
}

// ---------------------------------------------------------------- devices

function devicesTab() {
  const list = h('div', { class: 'panel rows-list' });
  const draw = () => {
    list.replaceChildren(...(B.sessions.length ? B.sessions.map((s) => {
      const revoke = h('button', { class: 'btn small ghost danger', onclick: () => busy(revoke, async () => {
        if (!confirm(`Disconnect ${s.name}? It will need a new code to manage this panel.`)) return;
        await api('DELETE', `/api/sessions/${s.id}`);
        B.sessions = B.sessions.filter((x) => x.id !== s.id);
        draw();
        if (s.current) location.reload();
      }) }, s.current ? 'Sign out' : 'Disconnect');
      return h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, s.name, s.current ? h('span', { class: 'small muted', style: { fontWeight: 400 } }, '  · this device') : null),
          h('div', { class: 'sub' }, `Paired ${new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · active ${ago(s.lastSeen)}`)),
        revoke);
    }) : [h('div', { class: 'panel-pad muted' }, 'No paired devices yet.')]));
  };
  draw();
  return h('div', {},
    h('div', { class: 'group-h' }, h('h2', {}, 'Paired devices')),
    list,
    h('div', { class: 'callout', style: { marginTop: '16px' } },
      h('b', {}, 'Adding another phone or laptop? '),
      `Open ${B.system.urls.name}${B.system.urls.ip ? ` (or ${B.system.urls.ip})` : ''} on it and type the code that appears on the panel.`),
    B.system.local ? h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'You’re on the panel itself, so you don’t need to pair.') : null);
}

boot();
