// Minimal RSS / Atom reader. Feeds are messy; this takes titles, links and
// dates and ignores everything else.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]) : '';
}

export function parseFeed(xml) {
  const firstItem = xml.search(/<(item|entry)\b/i);
  const head = firstItem > 0 ? xml.slice(0, firstItem) : '';
  const source = tag(head, 'title');
  const items = [];
  for (const [block] of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const title = tag(block, 'title');
    if (!title) continue;
    const link = tag(block, 'link') || (/<link\b[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? '');
    const date = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date');
    const t = Date.parse(date);
    items.push({ title, link, source, time: Number.isNaN(t) ? null : new Date(t).toISOString() });
  }
  return { source, items };
}
