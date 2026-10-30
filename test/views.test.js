import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapView } from '../server/lib/views.js';
import { parseFeed } from '../server/lib/feed.js';
import tasks from '../server/widgets/tasks.js';

test('stat accepts canonical payloads and keeps history', () => {
  const a = mapView('stat', { value: '1,200', label: 'Users' });
  const b = mapView('stat', { value: 1300 }, {}, a);
  assert.equal(b.value, 1300);
  assert.deepEqual(b.history, [1200, 1300]);
});

test('paths map arbitrary JSON', () => {
  const d = mapView('stat', { data: { total: 42, name: 'Orders' } }, { valuePath: 'data.total', labelPath: 'data.name' });
  assert.equal(d.value, 42);
  assert.equal(d.label, 'Orders');
  const l = mapView('list', { results: [{ name: 'A', status: 'ok' }] }, { itemsPath: 'results' });
  assert.deepEqual(l.items, [{ title: 'A', meta: 'ok', status: 'ok' }]);
});

test('feed prepends and caps', () => {
  let d = null;
  for (let i = 0; i < 5; i++) d = mapView('feed', { title: `e${i}` }, { maxItems: 3 }, d);
  assert.deepEqual(d.items.map((i) => i.title), ['e4', 'e3', 'e2']);
});

test('tasks webhook actions', () => {
  let d = tasks.ingest({ text: 'Buy milk' }, null);
  d = tasks.ingest({ action: 'complete', text: 'buy milk' }, d);
  assert.equal(d.tasks[0].done, true);
  d = tasks.ingest({ action: 'clear' }, d);
  assert.equal(d.tasks.length, 0);
});

test('rss and atom parsing', () => {
  const rss = '<rss><channel><title>News</title><item><title><![CDATA[Hello &amp; world]]></title><link>https://x</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const f = parseFeed(rss);
  assert.equal(f.items[0].title, 'Hello & world');
  assert.equal(f.items[0].source, 'News');
  const atom = '<feed><title>Blog</title><entry><title>Post</title><link href="https://y"/><updated>2026-10-30T10:00:00Z</updated></entry></feed>';
  assert.equal(parseFeed(atom).items[0].link, 'https://y');
});
