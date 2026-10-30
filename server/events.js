// Server-sent events: the display (and the preview on your phone) stay
// connected and get pushed updates the moment data changes.

export function createHub() {
  const clients = new Set();

  setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25000).unref();

  return {
    attach(req, res, initial) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      if (initial) res.write(`event: state\ndata: ${JSON.stringify(initial)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    send(event, data) {
      const msg = `event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
      for (const res of clients) res.write(msg);
    },
    get size() { return clients.size; },
  };
}
