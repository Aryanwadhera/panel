// The photo frame's library: pictures uploaded from a phone, kept on the Pi.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_PHOTOS = 300;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const NAME = /^[\w-]{10,40}\.(jpg|png|webp)$/;

function extensionOf(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function createPhotos(dataDir) {
  const dir = path.join(dataDir, 'photos');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safe = (name) => (NAME.test(name) ? path.join(dir, name) : null);

  const list = () => fs.readdirSync(dir)
    .filter((f) => NAME.test(f))
    .map((f) => ({ name: f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .map((p) => p.name);

  return {
    list,
    add(buf) {
      const ext = extensionOf(buf);
      if (!ext) throw new Error('That isn’t a JPEG, PNG or WebP picture');
      if (list().length >= MAX_PHOTOS) throw new Error(`The frame holds ${MAX_PHOTOS} photos. Remove a few first.`);
      const name = `${crypto.randomBytes(9).toString('base64url')}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buf, { mode: 0o600 });
      return name;
    },
    read(name) {
      const file = safe(name);
      if (!file || !fs.existsSync(file)) return null;
      return { body: fs.readFileSync(file), type: TYPES[name.split('.').pop()] };
    },
    remove(name) {
      const file = safe(name);
      if (file) fs.rmSync(file, { force: true });
    },
    clear() {
      for (const f of list()) fs.rmSync(path.join(dir, f), { force: true });
    },
  };
}
