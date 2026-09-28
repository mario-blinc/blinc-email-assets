// Turns each render in source/avatars/ into a circular 266x266 PNG (2x for 133px display)
// in public/email/ as avatar-{slug}-v{n}.png, and points team.json at it.
// Never overwrites: a changed avatar gets the next version number.
// Usage: node scripts/avatars.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, EMAIL_DIR, nextVersionName, writeNewAsset, existingIdentical, kb } from './lib/assets.mjs';

const OUT = 266;          // exported size
const SS = 4;             // mask supersampling factor
const MAX_BYTES = 100 * 1024;
const SRC_DIR = path.join(ROOT, 'source/avatars');
const TEAM_FILE = path.join(ROOT, 'team/team.json');

export async function processAvatar(input) {
  const big = OUT * SS;
  const { width, height } = await sharp(input).metadata();
  const side = Math.min(width, height);
  // Centre-crop to square and scale to 4x the output size.
  const square = await sharp(input)
    .extract({ left: Math.floor((width - side) / 2), top: Math.floor((height - side) / 2), width: side, height: side })
    .resize(big, big, { kernel: 'lanczos3' })
    .ensureAlpha()
    .toBuffer();
  // Circle mask drawn at 4x; downsampling it gives a smooth anti-aliased edge.
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${big}" height="${big}"><circle cx="${big / 2}" cy="${big / 2}" r="${big / 2}" fill="#fff"/></svg>`);
  const masked = await sharp(square).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const small = sharp(masked).resize(OUT, OUT, { kernel: 'lanczos3' });
  // Try progressively smaller palettes until under the size target.
  let png;
  for (const colours of [256, 192, 128]) {
    png = await small.clone().png({ compressionLevel: 9, palette: true, quality: 92, colours, effort: 10 }).toBuffer();
    if (png.length < MAX_BYTES) break;
  }
  return png;
}

async function main() {
  const team = JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
  const sources = fs.existsSync(SRC_DIR) ? fs.readdirSync(SRC_DIR).filter((f) => /\.(png|jpe?g|webp|tiff?)$/i.test(f)) : [];
  let changed = false;

  for (const file of sources) {
    const person = team.find((p) => p.avatar === file);
    if (!person) { console.warn(`! source/avatars/${file} is not referenced by any team.json entry, skipped`); continue; }
    const png = await processAvatar(fs.readFileSync(path.join(SRC_DIR, file)));
    const stem = `avatar-${person.slug}`;
    const current = person.avatarAsset && fs.existsSync(path.join(EMAIL_DIR, person.avatarAsset))
      ? fs.readFileSync(path.join(EMAIL_DIR, person.avatarAsset)) : null;
    if (current && current.equals(png)) { console.log(`${person.avatarAsset} up to date`); continue; }
    const name = existingIdentical(stem, 'png', png) ?? writeNewAsset(nextVersionName(stem, 'png'), png);
    console.log(`public/email/${name} ${kb(png)}${png.length >= MAX_BYTES ? '  ! over 100KB target' : ''}`);
    person.avatarAsset = name;
    changed = true;
  }

  for (const p of team) {
    if (!p.avatarAsset) console.warn(`! ${p.name}: no avatar yet (add a render to source/avatars/ and set "avatar")`);
  }
  if (changed) fs.writeFileSync(TEAM_FILE, JSON.stringify(team, null, 2) + '\n');
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
