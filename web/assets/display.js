// The display. Gets a snapshot, keeps a live connection, and redraws only
// the cards whose content changed.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.body.classList.add('preview');

const root = $('#root');
const overlay = $('#overlay');
let S = null;
let bootId = null;

// ---------------------------------------------------------------- time

const tz = () => S?.settings?.timezone || undefined;
const h24 = () => !!S?.settings?.clock24;
const fmtCache = new Map();
function fmt(date, opts) {
  const key = JSON.stringify([tz(), opts]);
  let f = fmtCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz(), ...opts }); fmtCache.set(key, f); }
  return f.format(date);
}
const timeStr = (d) => fmt(d, { hour: 'numeric', minute: '2-digit', hour12: !h24() });
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function rel(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function num(v) {
  if (typeof v !== 'number') return esc(v);
  const a = Math.abs(v);
  if (a >= 1e6) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: a < 10 ? 2 : a < 100 ? 1 : 0 }).format(v);
}

// ---------------------------------------------------------------- icons

const CLOUD = 'M7.5 19h9.5a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.7 10.1 4.5 4.5 0 0 0 7.5 19z';
const CLOUD_HI = 'M7.5 15h9.5a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.7 6.1 4.5 4.5 0 0 0 7.5 15z';
const ICONS = {
  clear: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  'clear-night': '<path d="M20 14.2A8 8 0 1 1 9.8 4a6.5 6.5 0 0 0 10.2 10.2z"/>',
  partly: '<path d="M8.5 2.5v1.5M3.4 4.6l1 1M1.8 9.6h1.5M13.6 4.6l-1 1"/><path d="M4.8 12.6A4 4 0 0 1 12.4 7.6"/><path d="M9.5 20.5h8a3.6 3.6 0 0 0 .3-7.2 4.9 4.9 0 0 0-9.2-.9 4.1 4.1 0 0 0 .9 8.1z"/>',
  'partly-night': '<path d="M11.8 8.4A4.6 4.6 0 0 1 5 3.4a4.6 4.6 0 1 0 6.8 5z"/><path d="M9.5 20.5h8a3.6 3.6 0 0 0 .3-7.2 4.9 4.9 0 0 0-9.2-.9 4.1 4.1 0 0 0 .9 8.1z"/>',
  cloudy: `<path d="${CLOUD}"/>`,
  fog: '<path d="M4 8h16M2.5 12h19M4 16h16M7 20h10"/>',
  drizzle: `<path d="${CLOUD_HI}"/><path d="M9 18.5v.6M13 18.5v.6M17 18.5v.6M11 21.2v.6M15 21.2v.6"/>`,
  rain: `<path d="${CLOUD_HI}"/><path d="M9 18l-1 3.2M13 18l-1 3.2M17 18l-1 3.2"/>`,
  snow: `<path d="${CLOUD_HI}"/><circle cx="9" cy="19" r=".6"/><circle cx="13" cy="19" r=".6"/><circle cx="17" cy="19" r=".6"/><circle cx="11" cy="21.6" r=".6"/><circle cx="15" cy="21.6" r=".6"/>`,
  storm: `<path d="${CLOUD_HI}"/><path d="M13 16.2l-2.4 3.4h3L11.2 23"/>`,
};
function icon(name, day = true) {
  const key = !day && ICONS[`${name}-night`] ? `${name}-night` : name;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] || ICONS.cloudy}</svg>`;
}

// ---------------------------------------------------------------- renderers
// Each returns { body, meta?, bare?, cls? }. Strings are HTML; escape everything.

const empty = (title, sub = '') => ({ body: `<div class="empty"><b>${esc(title)}</b>${esc(sub)}</div>` });

function sparkline(values) {
  if (!values || values.length < 3) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 28 - ((v - min) / span) * 24]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${line} L100 30 L0 30Z"/><path class="l" d="${line}"/></svg>`;
}

const R = {
  clock(w) {
    const now = new Date();
    const { showSeconds, showDate, zones = [] } = w.props;
    const zoneHtml = zones.map((z) => `<div><span>${esc(z.label)}</span>${esc(new Intl.DateTimeFormat('en-US', { timeZone: z.tz, hour: 'numeric', minute: '2-digit', hour12: !h24() }).format(now))}</div>`).join('');
    return {
      bare: true,
      body: `<div class="clock">
        <div class="clock-time${showSeconds ? ' secs' : ''}" data-clock="${showSeconds ? 's' : 'm'}">${clockText(now, showSeconds)}</div>
        ${showDate ? `<div class="clock-date">${esc(fmt(now, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>` : ''}
        ${zones.length ? `<div class="zones">${zoneHtml}</div>` : ''}
      </div>`,
    };
  },

  weather(w) {
    const d = w.data;
    if (!d?.current) return empty('No forecast yet', w.error || 'Fetching the weather…');
    const c = d.current;
    const days = (d.days || []).slice(0, w.h > 1 && w.w === 1 ? 4 : 5);
    return {
      meta: esc(d.place || ''),
      body: `<div class="wx">
        <div class="wx-now">
          <div class="wx-top"><div class="wx-temp">${c.temp}°</div>${icon(c.icon, c.day)}</div>
          <div class="wx-desc">${esc(c.text)}</div>
          <div class="wx-sub">H ${d.today.hi}° &nbsp;L ${d.today.lo}°${d.today.rain >= 20 ? ` &nbsp;· ${d.today.rain}% rain` : ''}</div>
        </div>
        ${w.props.showForecast ? `<div class="wx-days">${days.map((x) => `
          <div class="wx-day"><span class="d">${esc(fmt(new Date(`${x.date}T12:00:00Z`), { weekday: 'short', timeZone: 'UTC' }))}</span>${icon(x.icon)}<span class="r">${x.rain >= 30 ? `${x.rain}%` : ''}</span><span class="t">${x.hi}°<span>${x.lo}°</span></span></div>`).join('')}
        </div>` : ''}
      </div>`,
    };
  },

  calendar(w) {
    const evs = w.data?.events;
    if (!evs) return empty('Calendar not connected', w.error || 'Loading…');
    const now = new Date();
    const today = dayKey(now);
    const tomorrow = dayKey(new Date(now.getTime() + 86400e3));
    const groups = new Map();
    let todayCount = 0;
    const place = w.props.showMap ? nextPlace(evs, now) : null;
    for (const e of evs) {
      const start = new Date(e.start), end = new Date(e.end);
      let key = dayKey(start);
      if (e.allDay && start < now && end > now) key = today; // multi-day all-day spanning today
      if (key < today) continue;
      if (key === today && !e.allDay && end <= now && (evs.length > 6 || place)) continue; // hide finished events when busy, and keep the map in view
      if (key === today) todayCount++;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    if (!groups.size) return { meta: 'Nothing today', body: '<div class="empty"><b>Nothing scheduled</b>An open calendar for the next few days.</div>' };
    let html = '';
    if (!groups.has(today)) html += '<li class="day">Today</li><li class="ev past"><span class="t">—</span><span class="x"><b>Nothing else today</b></span></li>';
    for (const [key, list] of groups) {
      const label = key === today ? 'Today' : key === tomorrow ? 'Tomorrow' : fmt(new Date(list[0].start), { weekday: 'long', month: 'short', day: 'numeric' });
      html += `<li class="day">${esc(label)}</li>`;
      for (const e of list) {
        const start = new Date(e.start), end = new Date(e.end);
        const state = !e.allDay && end <= now ? ' past' : !e.allDay && start <= now ? ' now' : '';
        const cal = e.cal ? ` cal${Math.min(3, e.cal)}` : '';
        html += `<li class="ev${state}${cal}"><span class="t">${e.allDay ? 'All day' : esc(timeStr(start))}</span><span class="x"><b>${esc(e.title)}</b>${w.props.showLocation && e.location ? `<i>${esc(e.location.split('\n')[0])}</i>` : ''}</span></li>`;
        if (e === place) html += `<li class="ev-place">${e.travel ? `<p>${esc(travelLine(e, now))}</p>` : ''}${eventMap(e)}</li>`;
      }
    }
    return { meta: todayCount ? `${todayCount} today` : '', body: `<ol class="agenda">${html}</ol>`, fade: true };
  },

  tasks(w) {
    const all = w.data?.tasks || [];
    const today = dayKey(new Date());
    const open = all.filter((t) => !t.done);
    const done = w.props.showCompleted ? all.filter((t) => t.done && t.doneAt && dayKey(new Date(t.doneAt)) === today) : [];
    if (!open.length && !done.length) return { meta: '', body: '<div class="empty"><b>All clear</b>Nothing on the list.</div>' };
    const li = (t) => `<li class="${t.done ? 'done' : ''}"><span class="box"></span><span>${esc(t.text)}</span></li>`;
    return {
      meta: open.length ? `${open.length} left` : 'Done',
      body: `<ul class="tasks">${open.map(li).join('')}${done.map(li).join('')}</ul>`,
      fade: true,
    };
  },

  stat(w) {
    const d = w.data;
    if (!d) return waiting(w);
    const delta = d.delta == null ? '' : String(d.delta);
    const dir = /^[+]|^[0-9]/.test(delta) && !/^0(\.0+)?%?$/.test(delta) ? 'up' : /^[-−]/.test(delta) ? 'down' : '';
    const arrow = dir === 'up' ? '↑ ' : dir === 'down' ? '↓ ' : '';
    return {
      meta: w.updatedAt ? rel(w.updatedAt) : '',
      body: `<div class="stat">
        <div class="stat-value">${d.prefix ? `<span class="pre">${esc(d.prefix)}</span>` : ''}${num(d.value)}${d.suffix ? `<span class="suf">${esc(d.suffix)}</span>` : ''}</div>
        ${delta || d.label || d.caption ? `<div class="stat-row">${delta ? `<span class="delta ${dir}">${arrow}${esc(delta.replace(/^[+-]/, ''))}</span>` : ''}<span class="cap">${esc(d.caption || d.label || '')}</span></div>` : ''}
        ${sparkline(d.trend)}
      </div>`,
    };
  },

  progress(w) {
    const d = w.data;
    if (!d) return waiting(w);
    const pct = Math.max(0, Math.min(100, (d.value / (d.max || 100)) * 100));
    return {
      meta: d.max !== 100 ? `${num(d.value)} / ${num(d.max)}` : '',
      body: `<div class="stat">
        <div class="stat-value">${Math.round(pct)}<span class="suf">%</span></div>
        ${d.label ? `<div class="stat-row"><span class="cap">${esc(d.label)}</span></div>` : ''}
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>`,
    };
  },

  list(w) {
    const items = w.data?.items;
    if (!items) return waiting(w);
    if (!items.length) return empty('Nothing here', 'The last update had no items.');
    return {
      meta: w.updatedAt ? rel(w.updatedAt) : '',
      body: `<ul class="rows">${items.map((i) => `<li>${i.status ? `<span class="dot ${/ok|good|up/.test(i.status) ? 'good' : /bad|down|error/.test(i.status) ? 'bad' : ''}"></span>` : ''}<span class="tt">${esc(i.title)}</span>${i.meta ? `<span class="mm">${esc(i.meta)}</span>` : ''}</li>`).join('')}</ul>`,
      fade: true,
    };
  },

  feed(w) {
    const items = w.data?.items;
    if (!items?.length) return waiting(w, 'No events yet');
    return {
      body: `<ul class="rows">${items.map((i) => `<li><span class="tt">${esc(i.title)}${i.meta ? ` <span class="mm">· ${esc(i.meta)}</span>` : ''}</span><span class="mm">${esc(rel(i.time))}</span></li>`).join('')}</ul>`,
      fade: true,
    };
  },

  text(w) {
    if (!w.data?.text) return waiting(w);
    return { meta: w.updatedAt ? rel(w.updatedAt) : '', body: `<div class="fit"><p>${esc(w.data.text)}</p></div>`, fit: true };
  },

  note(w) {
    if (!w.props.text) return empty('Empty note', 'Add some text from the manage page.');
    return { body: `<div class="fit"><p>${esc(w.props.text)}</p></div>`, fit: true };
  },

  summary(w) {
    const d = w.data;
    if (!d?.text) {
      if (w.error) return empty('Your brief isn’t ready', w.error);
      return empty('Writing your brief…', 'This takes a few seconds once your other widgets have loaded.');
    }
    // The first sentence carries the headline.
    const m = /^(.+?[.!?])(\s+[\s\S]*)?$/.exec(d.text.trim());
    const html = m ? `<b>${esc(m[1])}</b>${esc(m[2] || '')}` : esc(d.text);
    return { meta: d.at ? esc(timeStr(new Date(d.at))) : '', body: `<div class="fit brief"><p>${html}</p></div>`, fit: true };
  },

  headlines(w) {
    const items = w.data?.items;
    if (!items) return empty('No headlines yet', w.error || 'Loading…');
    return {
      body: `<ul class="rows news">${items.map((i) => `<li><span class="tt">${esc(i.title)}</span><span class="mm">${[w.data.multi ? i.source : '', i.time ? rel(i.time) : ''].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ul>`,
      fade: true,
    };
  },

  status(w) {
    const checks = w.data?.checks;
    if (!checks) return empty('Checking…', w.error || '');
    const down = checks.filter((c) => !c.ok).length;
    return {
      meta: down ? `<span class="bad">${down} down</span>` : 'All up',
      body: `<ul class="rows">${checks.map((c) => `<li><span class="dot ${c.ok ? 'good' : 'bad'}"></span><span class="tt">${esc(c.name)}</span><span class="mm">${c.ok ? `${c.ms} ms` : esc(c.code ? `HTTP ${c.code}` : 'No response')}</span></li>`).join('')}</ul>`,
      fade: true,
    };
  },

  nowplaying(w) {
    const d = w.data || { state: 'idle', airplay: {} };
    const note = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>';
    const art = `<div class="np-art">${d.artUrl ? `<img src="${esc(d.artUrl)}" alt="">` : note}</div>`;
    if (d.state === 'idle' || !d.title) {
      const name = d.airplay?.name || S.settings.name;
      return {
        bare: true,
        body: `<div class="np idle">${art}<div class="np-info">
          <div class="np-label">Now playing</div>
          <div class="np-title">Nothing playing</div>
          <div class="np-artist">${d.airplay?.available === false ? 'AirPlay isn’t installed. Run the Panel installer again.' : d.airplay?.enabled === false ? 'AirPlay is turned off in Sound settings.' : `AirPlay to “${esc(name)}” from your iPhone or Mac.`}</div>
        </div></div>`,
      };
    }
    const label = d.state === 'paused' ? 'Paused' : `Playing${d.source ? ` from ${esc(d.source)}` : ''}`;
    const progress = d.duration ? `<div class="np-progress" data-np-pos="${d.position ?? 0}" data-np-at="${d.positionAt ?? Date.now()}" data-np-dur="${d.duration}" data-np-playing="${d.state === 'playing' ? 1 : 0}">${progressInner(d.position ?? 0, d.positionAt, d.duration, d.state === 'playing')}</div>` : '';
    return {
      bare: true,
      body: `<div class="np ${d.state}">${art}<div class="np-info">
        <div class="np-label">${d.state === 'playing' ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}${label}</div>
        <div class="np-title">${esc(d.title)}</div>
        ${d.artist ? `<div class="np-artist">${esc(d.artist)}</div>` : ''}
        ${d.album ? `<div class="np-album">${esc(d.album)}</div>` : ''}
        ${progress}
      </div></div>`,
    };
  },

  photos(w) {
    const list = w.data?.photos || [];
    if (!list.length) return { bare: true, body: '<div class="empty"><b>No photos yet</b>Add some from your phone.</div>' };
    return { bare: true, body: frameHtml(list, w.props) };
  },

  countdown(w) {
    const { label, date } = w.props;
    if (!date) return empty('No date set');
    const days = Math.round((Date.parse(date) - Date.parse(dayKey(new Date()))) / 86400e3);
    const when = fmt(new Date(`${date}T12:00:00Z`), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    if (days === 0) return { body: `<div class="count"><div class="count-n">Today</div><div class="count-l"><b>${esc(label)}</b></div></div>` };
    if (days < 0) return { body: `<div class="count"><div class="count-n">${-days}</div><div class="count-l">day${days === -1 ? '' : 's'} since <b>${esc(label)}</b></div></div>` };
    return { meta: esc(when), body: `<div class="count"><div class="count-n">${days}</div><div class="count-l">day${days === 1 ? '' : 's'} until <b>${esc(label)}</b></div></div>` };
  },
};

/** Today's next event with a known place. A timed event beats an all-day one. */
function nextPlace(evs, now) {
  const today = dayKey(now);
  const left = evs.filter((e) => {
    const start = new Date(e.start), end = new Date(e.end);
    const isToday = dayKey(start) === today || (e.allDay && start < now && end > now);
    return e.map && isToday && (e.allDay || end > now);
  });
  return left.find((e) => !e.allDay) || left[0] || null;
}

function travelLine(e, now) {
  const leaveBy = new Date(e.travel.leaveBy);
  const m = e.travel.minutes;
  const drive = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min drive` : `${m} min drive`;
  return `${drive} · ${leaveBy <= now ? 'leave now' : `leave by ${timeStr(leaveBy)}`}`;
}

/** A map centred on the event, built from the tiles around it. */
function eventMap(e, size = 18) {
  const zoom = 16;
  const tiles = 2 ** zoom;
  const lat = (e.map.lat * Math.PI) / 180;
  const x = ((e.map.lon + 180) / 360) * tiles;
  const y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * tiles;
  let html = '';
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
      if (tx < 0 || ty < 0 || tx >= tiles || ty >= tiles) continue;
      html += `<img src="/api/map/${tx}/${ty}" alt="" loading="lazy" style="left:calc(50% + ${((tx - x) * size).toFixed(2)}vh);top:calc(50% + ${((ty - y) * size).toFixed(2)}vh);width:${size}vh;height:${size}vh">`;
    }
  }
  return `<div class="map"><div class="map-tiles">${html}</div><span class="map-pin"></span><small>© OpenStreetMap</small></div>`;
}

function waiting(w, title = 'Waiting for data') {
  if (w.error) return empty('Couldn’t update', w.error);
  return empty(title, w.type === 'webhook' ? 'Send a webhook to fill this in.' : 'Loading…');
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
function progressInner(pos, at, dur, playing) {
  const now = Math.min(dur, Math.max(0, pos + (playing && at ? (Date.now() - at) / 1000 : 0)));
  return `<div class="bar"><i style="width:${(now / dur) * 100}%"></i></div><div class="np-times"><span>${mmss(now)}</span><span>-${mmss(dur - now)}</span></div>`;
}

function clockText(now, secs) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit', second: secs ? '2-digit' : undefined, hour12: !h24() }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const ap = get('dayPeriod');
  return `${esc(get('hour'))}:${esc(get('minute'))}${secs ? `<span class="s">:${esc(get('second'))}</span>` : ''}${ap ? `<span class="ampm">${esc(ap)}</span>` : ''}`;
}

// ---------------------------------------------------------------- painting

function cardHtml(w) {
  let r;
  try { r = (R[w.view] || R[w.type] || (() => empty('Unknown widget')))(w); } catch (err) { console.error(err); r = empty('Couldn’t draw this widget'); }
  const stale = w.error && w.data && !['summary'].includes(w.type) ? `<div class="note">Couldn’t refresh: ${esc(w.error)}</div>` : '';
  const head = r.bare ? '' : `<header class="card-h"><span class="title">${esc(w.title)}</span><span class="meta">${r.meta || ''}</span></header>`;
  return { html: `${head}<div class="card-b${r.fade ? ' fade-able' : ''}">${r.body}</div>${stale}`, fit: r.fit };
}

function fitText(el) {
  const box = el.querySelector('.fit');
  if (!box) return;
  const p = box.querySelector('p');
  let size = 4.4;
  box.style.justifyContent = 'flex-start';
  p.style.setProperty('--fs', `${size}vh`);
  while (size > 1.9 && box.scrollHeight > box.clientHeight + 1) {
    size -= 0.15;
    p.style.setProperty('--fs', `${size}vh`);
  }
  box.style.justifyContent = '';
}

function paint(el, w) {
  el.dataset.type = w.type;
  el.dataset.view = w.view;
  el.dataset.w = w.w;
  el.dataset.h = w.h;
  el.style.gridColumn = `span ${w.w}`;
  el.style.gridRow = `span ${w.h}`;
  const { html, fit } = cardHtml(w);
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
  if (fit) fitText(el);
  const body = el.querySelector('.card-b.fade-able');
  if (body) body.classList.toggle('fade', body.scrollHeight > body.clientHeight + 2);
}

function renderGrid() {
  let grid = $('.grid', root);
  if (!grid) {
    root.innerHTML = '<div class="grid"></div>';
    grid = $('.grid', root);
  }
  grid.style.setProperty('--cols', S.settings.grid.cols);
  grid.style.setProperty('--rows', S.settings.grid.rows);
  const existing = new Map([...grid.children].map((el) => [el.dataset.id, el]));
  S.widgets.forEach((w, i) => {
    let el = existing.get(w.id);
    existing.delete(w.id);
    if (!el) {
      el = document.createElement('section');
      el.className = 'card';
      el.dataset.id = w.id;
    }
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
    paint(el, w);
  });
  existing.forEach((el) => el.remove());
}

function qrBlock() {
  const sys = S.system;
  const main = sys.urls.name.replace(/^http:\/\//, '');
  const ip = sys.urls.ip?.replace(/^http:\/\//, '');
  return { main, ip };
}

function renderWelcome() {
  const p = S.pairing;
  const { main, ip } = qrBlock();
  const code = p ? `${p.code.slice(0, 3)} ${p.code.slice(3)}` : '—';
  root.innerHTML = `<div class="welcome">
    <div>
      <div class="brand"><span class="brand-mark"></span>Panel</div>
      <h1>${S.setupComplete ? 'Your panel is ready for widgets.' : 'Let’s set up your panel.'}</h1>
      <ol class="steps">
        <li><span>1</span><span>On your phone, scan the code. Or on any computer on this Wi‑Fi, open <b>${esc(main)}</b>${ip ? ` or <b>${esc(ip)}</b>` : ''}.</span></li>
        ${S.setupComplete ? '<li><span>2</span><span>Tap <b>Add widget</b> and pick what you’d like to see.</span></li>' : `<li><span>2</span><span>Enter this code<span class="code">${code}</span></span></li>`}
      </ol>
    </div>
    <div class="qr-card">
      <div class="qr">${p?.qr || ''}</div>
      <div class="url">${esc(main)}${ip ? `<span>${esc(ip)}</span>` : ''}</div>
    </div>
  </div>`;
}

function renderOverlay() {
  const p = S.pairing;
  if (PREVIEW || !p || !S.setupComplete || !p.expires) { overlay.innerHTML = ''; return; }
  const left = Math.max(0, Math.round((p.expires - Date.now()) / 1000));
  if (!left) { overlay.innerHTML = ''; return; }
  const code = `${p.code.slice(0, 3)} ${p.code.slice(3)}`;
  overlay.innerHTML = `<div class="pair">
    <div>
      <h2>Someone wants to manage this panel</h2>
      <div class="code">${code}</div>
      <p>Enter this code on your phone or laptop to connect. It expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.</p>
    </div>
    <div class="qr">${p.qr}</div>
  </div>`;
}

// ---------------------------------------------------------------- photo frame

const frameHtml = (list, props) => `<div class="frame${props.fit ? ' fit' : ''}" data-photos="${esc(JSON.stringify(list))}" data-every="${props.every}"></div>`;

const inHours = (from, until) => {
  const now = fmt(new Date(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return from > until ? now >= from || now < until : now >= from && now < until;
};

/** Everyone's photo changes on the same beat, worked out from the clock. */
function syncFrames() {
  for (const el of document.querySelectorAll('[data-photos]')) {
    const list = JSON.parse(el.dataset.photos);
    const name = list[Math.floor(Date.now() / 1000 / +el.dataset.every) % list.length];
    if (el.dataset.showing === name) continue;
    el.dataset.showing = name;
    const img = new Image();
    img.alt = '';
    img.onload = () => {
      el.append(img);
      requestAnimationFrame(() => img.classList.add('in'));
      setTimeout(() => { while (el.children.length > 1) el.firstChild.remove(); }, 1400);
    };
    img.src = `/api/photos/${encodeURIComponent(name)}`;
  }
}

function renderFrame() {
  const el = $('#frame');
  const w = PREVIEW ? null : S.widgets.find((x) => x.type === 'photos' && x.props.full && x.data?.photos?.length && inHours(x.props.full.from, x.props.full.until));
  el.hidden = !w;
  if (!w) { if (el.innerHTML) el.innerHTML = ''; return; }
  const html = frameHtml(w.data.photos, w.props);
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
}

// ---------------------------------------------------------------- focus mode

function focusCountdown(f) {
  const mins = Math.ceil((Date.parse(f.at) - Date.now()) / 60e3);
  if (mins <= 0) return 'Starting now';
  return `Starts in ${mins} min`;
}

function renderFocus() {
  const el = $('#focus');
  const f = S.focus;
  el.hidden = !f;
  if (!f) { el.dataset.key = ''; el.innerHTML = ''; return; }
  if (el.dataset.key === f.key) return;
  el.dataset.key = f.key;
  const at = f.at ? timeStr(new Date(f.at)) : '';
  const label = f.kind === 'leave' ? 'Time to leave' : f.kind === 'event' ? focusCountdown(f) : 'Needs attention';
  const detail = f.kind === 'alert' ? f.text : [f.kind === 'leave' ? `Starts at ${at}` : at, f.location].filter(Boolean).join(' · ');
  const drive = f.travel ? `${f.travel.minutes} min drive` : '';
  el.innerHTML = `<div class="focus${f.map ? ' has-map' : ''} ${esc(f.kind)}">
    <div class="focus-text">
      <div class="focus-label"${f.kind === 'event' ? ` data-focus-at="${esc(f.at)}"` : ''}>${esc(label)}</div>
      <h1>${esc(f.title)}</h1>
      ${detail ? `<p>${esc(detail)}</p>` : ''}
      ${drive ? `<p>${esc(drive)}</p>` : ''}
    </div>
    ${f.map ? eventMap(f, 34) : ''}
  </div>`;
}

function applyTheme() {
  const { theme, nightStart, nightEnd } = S.settings;
  let dark = theme === 'dark';
  if (theme === 'auto') {
    const now = fmt(new Date(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    dark = nightStart > nightEnd ? now >= nightStart || now < nightEnd : now >= nightStart && now < nightEnd;
  }
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function render() {
  if (!S) return;
  applyTheme();
  document.title = S.settings.name || 'Panel';
  const showWelcome = !S.setupComplete || (!S.widgets.length && !PREVIEW);
  if (showWelcome) {
    renderWelcome();
  } else if (!S.widgets.length) {
    root.innerHTML = '<div class="welcome"><div><h1 style="font-size:6vh">Add a widget to get started.</h1></div></div>';
  } else {
    if ($('.welcome', root)) root.innerHTML = '';
    renderGrid();
  }
  renderFrame();
  renderFocus();
  syncFrames();
  renderOverlay();
}

// ---------------------------------------------------------------- live data

function setState(next) {
  if (bootId && next.bootId !== bootId) return location.reload(); // server updated or restarted
  bootId = next.bootId;
  S = next;
  render();
}

function connect() {
  const es = new EventSource('/api/stream');
  let downTimer = null;
  const conn = $('#conn');
  es.addEventListener('open', () => { clearTimeout(downTimer); conn.hidden = true; });
  es.addEventListener('state', (e) => setState(JSON.parse(e.data)));
  es.addEventListener('widget', (e) => {
    const w = JSON.parse(e.data);
    if (!S || !w) return;
    const i = S.widgets.findIndex((x) => x.id === w.id);
    if (i >= 0) S.widgets[i] = w;
    render();
  });
  es.addEventListener('focus', (e) => { if (S) { S.focus = JSON.parse(e.data); renderFocus(); } });
  es.addEventListener('reload', () => location.reload());
  es.addEventListener('error', () => {
    clearTimeout(downTimer);
    if (!PREVIEW) downTimer = setTimeout(() => { conn.hidden = false; }, 8000);
  });
}

async function start() {
  try {
    const res = await fetch('/api/display/state');
    if (res.status === 401) {
      root.innerHTML = `<div class="welcome"><div><div class="brand"><span class="brand-mark"></span>Panel</div>
        <h1>This screen isn’t paired.</h1><ol class="steps"><li><span>→</span><span><a href="/" style="color:inherit">Connect this browser</a> first, then come back to <b>/display</b>.</span></li></ol></div></div>`;
      return;
    }
    setState(await res.json());
  } catch {
    setTimeout(start, 3000);
    return;
  }
  connect();
  if (!PREVIEW) {
    fetch('/api/display/hello', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: innerWidth, height: innerHeight }),
    }).catch(() => {});
  }
}

// Tick the clocks every second; redraw everything once a minute so
// "now" markers, relative times and the night theme stay right.
setInterval(() => {
  if (!S) return;
  const now = new Date();
  for (const el of document.querySelectorAll('[data-clock]')) el.innerHTML = clockText(now, el.dataset.clock === 's');
  for (const el of document.querySelectorAll('[data-np-pos]')) {
    if (el.dataset.npPlaying === '1') el.innerHTML = progressInner(+el.dataset.npPos, +el.dataset.npAt, +el.dataset.npDur, true);
  }
  for (const el of document.querySelectorAll('[data-focus-at]')) el.textContent = focusCountdown({ at: el.dataset.focusAt });
  syncFrames();
  if (S.pairing?.expires) renderOverlay();
}, 1000);
setInterval(() => { for (const el of document.querySelectorAll('.card')) el._html = null; render(); }, 60e3);
addEventListener('resize', () => { for (const el of document.querySelectorAll('.card')) el._html = null; render(); });

start();
