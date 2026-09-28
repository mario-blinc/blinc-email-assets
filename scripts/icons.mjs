// Draws the contact-row icons (phone, globe) in Blinc blue as 2x retina PNGs.
// Display size 13px, exported 26px. Outline style matches the mockup.
// Usage: node scripts/icons.mjs [outDir]   (default: public/email, never overwrites)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { nextVersionName, writeNewAsset, existingIdentical, kb } from './lib/assets.mjs';

const BLUE = '#7395FF';
const PX = 26;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${PX}" viewBox="0 0 24 24" fill="none" stroke="${BLUE}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  'icon-phone': svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  'icon-web': svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
};

const outDir = process.argv[2];
for (const [stem, s] of Object.entries(ICONS)) {
  // Render at 8x then downsample for smooth anti-aliased strokes.
  const png = await sharp(Buffer.from(s), { density: 72 * 8 })
    .resize(PX, PX, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9, palette: true, colours: 64 })
    .toBuffer();
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${stem}-v1.png`), png);
    console.log(`${outDir}/${stem}-v1.png ${kb(png)}`);
    continue;
  }
  const same = existingIdentical(stem, 'png', png);
  if (same) { console.log(`${same} already up to date`); continue; }
  const name = writeNewAsset(nextVersionName(stem, 'png'), png);
  console.log(`public/email/${name} ${kb(png)}`);
}
