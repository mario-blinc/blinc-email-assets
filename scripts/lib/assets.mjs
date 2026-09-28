// Helpers for writing to public/email/. That folder is append-only: every email
// ever sent points at those URLs, so nothing in it may be overwritten or deleted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EMAIL_DIR = path.join(ROOT, 'public/email');

// Returns the first free "{stem}-v{n}.{ext}" name in public/email/.
export function nextVersionName(stem, ext) {
  for (let n = 1; ; n++) {
    const name = `${stem}-v${n}.${ext}`;
    if (!fs.existsSync(path.join(EMAIL_DIR, name))) return name;
  }
}

// Writes a new asset. The 'wx' flag makes the OS refuse if the file already exists.
export function writeNewAsset(name, buffer) {
  fs.mkdirSync(EMAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(EMAIL_DIR, name), buffer, { flag: 'wx' });
  return name;
}

// Newest version of an asset whose bytes match, so re-running a script never mints a duplicate.
export function existingIdentical(stem, ext, buffer) {
  if (!fs.existsSync(EMAIL_DIR)) return null;
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-v(\\d+)\\.${ext}$`);
  for (const f of fs.readdirSync(EMAIL_DIR)) {
    if (re.test(f) && fs.readFileSync(path.join(EMAIL_DIR, f)).equals(buffer)) return f;
  }
  return null;
}

export function kb(buffer) {
  return (buffer.length / 1024).toFixed(1) + 'KB';
}
