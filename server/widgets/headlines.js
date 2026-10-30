import { fetchText } from '../lib/http.js';
import { parseFeed } from '../lib/feed.js';

export const FEEDS = [
  { label: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { label: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { label: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { label: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
];

export default {
  type: 'headlines',
  name: 'Headlines',
  description: 'Latest stories from any RSS or Atom feed.',
  size: { w: 1, h: 2 },
  interval: 20 * 60,
  fields: [
    {
      key: 'feeds', label: 'Feeds', type: 'lines', default: FEEDS[0].url, required: true,
      placeholder: 'https://feeds.bbci.co.uk/news/rss.xml',
      help: `One feed URL per line. Try: ${FEEDS.map((f) => `${f.label} (${f.url})`).join(', ')}.`,
    },
  ],

  async fetch(config) {
    const urls = String(config.feeds || '').split('\n').map((u) => u.trim()).filter(Boolean);
    if (!urls.length) throw new Error('Add a feed URL');
    const results = await Promise.allSettled(urls.map((u) => fetchText(u)));
    const items = [];
    let error = null;
    for (const r of results) {
      if (r.status === 'rejected') { error = r.reason.message; continue; }
      const feed = parseFeed(r.value);
      items.push(...feed.items.slice(0, 15));
    }
    if (!items.length && error) throw new Error(error);
    items.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    const seen = new Set();
    return { items: items.filter((i) => !seen.has(i.title) && seen.add(i.title)).slice(0, 20), multi: urls.length > 1 };
  },

  summarize(data) {
    if (!data?.items?.length) return null;
    return data.items.slice(0, 5).map((i) => `- ${i.title}${i.source ? ` (${i.source})` : ''}`).join('\n');
  },
};
