// Turns an animated logo GIF into the signature logo:
//   - crops tight to the union bounding box of every frame
//   - scales so the settled wordmark shows 70px wide at 1x (exported at 2x)
//   - rotates the frame order so frame 1 is the settled wordmark (Outlook desktop only shows frame 1)
//   - keeps the original total loop duration exactly, loops forever, 16-colour palette, target under 150KB
//   - also exports a static PNG of the settled frame, same canvas, transparent background
// Writes blinc-logo-animated-v{n}.gif and blinc-logo-static-v{n}.png to public/email/ (never overwrites)
// and records the sizes build.mjs needs in team/logo.json.
// Usage: node scripts/logo.mjs source/logo/<file>.gif [--dry-run <dir>]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import gifenc from 'gifenc';
const { GIFEncoder } = gifenc;
import { ROOT, nextVersionName, writeNewAsset, existingIdentical, kb } from './lib/assets.mjs';

const WORDMARK_1X = 70;       // settled wordmark width at 1x
const RETINA = 2;
const BG = 0x11;              // signature background #111111
const COLOURS = 16;           // palette size, including one transparent slot
const MAX_BYTES = 150 * 1024;
const INK = 2;                // luminance above background that counts as "logo"
const SETTLED_MIN_FRAMES = 10;

const input = process.argv[2];
if (!input) { console.error('Usage: node scripts/logo.mjs source/logo/<file>.gif'); process.exit(1); }

// Decode every frame fully composited, as greyscale luminance.
const meta = await sharp(input, { pages: -1 }).metadata();
const W = meta.width, H = meta.pageHeight, N = meta.pages;
const delays = meta.delay?.length === N ? meta.delay : Array(N).fill(meta.delay?.[0] ?? 100);
const totalMs = delays.reduce((a, b) => a + b, 0);
const strip = await sharp(input, { pages: -1 }).removeAlpha().toColourspace('b-w').raw().toBuffer();
if (strip.length !== W * H * N) throw new Error(`Unexpected decode size ${strip.length}, expected ${W * H * N} (1 channel)`);
const frames = Array.from({ length: N }, (_, i) => strip.subarray(i * W * H, (i + 1) * W * H));
const bg = frames[0][0];
console.log(`${path.basename(input)}: ${W}x${H}, ${N} frames, ${totalMs}ms loop, background ${bg}`);

function bbox(f) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (f[y * W + x] - bg > INK) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
const same = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) return false; return true; };

// Settled wordmark: the longest run of identical, non-empty frames.
let best = { start: 0, len: 0 };
for (let i = 0; i < N;) {
  let j = i + 1;
  while (j < N && same(frames[j], frames[i])) j++;
  if (j - i > best.len && bbox(frames[i])) best = { start: i, len: j - i };
  i = j;
}
if (best.len < SETTLED_MIN_FRAMES) throw new Error(`No settled hold found (longest still run is ${best.len} frames)`);
const settled = bbox(frames[best.start]);
console.log(`settled wordmark: frames ${best.start}-${best.start + best.len - 1}, ${settled.x1 - settled.x0}x${settled.y1 - settled.y0}px`);

// Union bounding box across the whole animation.
const union = { x0: W, y0: H, x1: 0, y1: 0 };
for (const f of frames) {
  const b = bbox(f);
  if (!b) continue;
  union.x0 = Math.min(union.x0, b.x0); union.y0 = Math.min(union.y0, b.y0);
  union.x1 = Math.max(union.x1, b.x1); union.y1 = Math.max(union.y1, b.y1);
}

// Scale so the settled wordmark is WORDMARK_1X * RETINA px wide. Grow the crop by a pixel or
// two where needed so the output is a whole number of pixels at 1x.
const scale = (WORDMARK_1X * RETINA) / (settled.x1 - settled.x0);
const fit = (a, b, limit) => {
  // Smallest growth (at most a few source px) that lands close to a whole 1x pixel.
  let len = b - a, bestLen = len, bestErr = Infinity;
  for (let l = len; l <= len + Math.ceil(RETINA / scale) + 1; l++) {
    const exact = l * scale, err = Math.abs(exact - Math.round(exact / RETINA) * RETINA);
    if (err < bestErr - 1e-9) { bestErr = err; bestLen = l; }
    if (err < 0.3) { bestLen = l; break; }
  }
  len = bestLen;
  const out = () => Math.round((len * scale) / RETINA) * RETINA;
  const grow = len - (b - a);
  const start = Math.max(0, Math.min(limit - len, a - Math.floor(grow / 2)));
  return { start, len, out: out() };
};
const cx = fit(union.x0, union.x1, W), cy = fit(union.y0, union.y1, H);
const OW = cx.out, OH = cy.out;
console.log(`union box ${union.x1 - union.x0}x${union.y1 - union.y0} -> crop ${cx.len}x${cy.len} at ${cx.start},${cy.start} -> ${OW}x${OH} (${OW / RETINA}x${OH / RETINA} at 1x)`);

async function scaleFrame(f) {
  const crop = Buffer.alloc(cx.len * cy.len);
  for (let y = 0; y < cy.len; y++) f.copy(crop, y * cx.len, (cy.start + y) * W + cx.start, (cy.start + y) * W + cx.start + cx.len);
  const out = await sharp(crop, { raw: { width: cx.len, height: cy.len, channels: 1 } })
    .resize(OW, OH, { kernel: 'lanczos3' }).toColourspace('b-w').raw().toBuffer();
  if (out.length !== OW * OH) throw new Error(`Scaled frame is ${out.length} bytes, expected ${OW * OH}`);
  return out;
}

// Rotate so the first settled frame comes first. Merge identical neighbours (summing their delays)
// so the total loop time is unchanged.
const order = [...Array(N).keys()].map((i) => (i + best.start) % N);
const scaled = [];
for (const i of order) scaled.push({ px: await scaleFrame(frames[i]), delay: delays[i] });

// Map background luminance to the signature background, ink to white, into COLOURS-1 levels.
const LEVELS = COLOURS - 1;
const TRANSPARENT = LEVELS;
const levelOf = (v) => Math.max(0, Math.min(LEVELS - 1, Math.round(((v - bg) / (255 - bg)) * (LEVELS - 1))));
const grey = (l) => Math.round(BG + (l / (LEVELS - 1)) * (255 - BG));
const palette = [...Array(LEVELS).keys()].map((l) => [grey(l), grey(l), grey(l)]).concat([[0, 0, 0]]);

const indexed = scaled.map(({ px, delay }) => ({ idx: Uint8Array.from(px, levelOf), delay }));
const merged = [];
for (const f of indexed) {
  const prev = merged[merged.length - 1];
  if (prev && prev.idx.every((v, i) => v === f.idx[i])) prev.delay += f.delay;
  else merged.push({ ...f });
}

// Frame 1 in full; later frames mark unchanged pixels transparent so they compress to almost nothing.
function encode(list) {
  const gif = GIFEncoder();
  list.forEach((f, n) => {
    let data = f.idx;
    if (n > 0) {
      data = Uint8Array.from(f.idx, (v, i) => (v === list[n - 1].idx[i] ? TRANSPARENT : v));
    }
    gif.writeFrame(data, OW, OH, {
      palette, delay: f.delay, repeat: 0, colorDepth: 4, dispose: 1,
      transparent: n > 0, transparentIndex: TRANSPARENT,
    });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

// GIF delays are stored in 1/100s, so every frame delay must be a multiple of 10ms.
if (merged.some((f) => f.delay % 10)) throw new Error('Frame delays are not multiples of 10ms; the loop length cannot be kept exactly');
let frameList = merged;
let gifBuf = encode(frameList);
// Over budget: drop every k-th changing frame (k = 8, 6, 4, 3, 2), giving its time to the frame
// before it, so the loop length is unchanged. Uses the gentlest k that fits.
for (const k of [8, 6, 4, 3, 2]) {
  if (gifBuf.length <= MAX_BYTES) break;
  const thinned = [{ ...merged[0] }];
  for (let i = 1; i < merged.length; i++) {
    if (i % k === 0 && i < merged.length - 1) thinned[thinned.length - 1].delay += merged[i].delay;
    else thinned.push({ ...merged[i] });
  }
  console.log(`  ${kb(gifBuf)} is over ${MAX_BYTES / 1024}KB, dropping every ${k}th frame: ${merged.length} -> ${thinned.length}`);
  frameList = thinned;
  gifBuf = encode(frameList);
}
if (gifBuf.length > MAX_BYTES) console.warn(`! animated logo is ${kb(gifBuf)}, over the ${MAX_BYTES / 1024}KB target`);
const outMs = frameList.reduce((a, f) => a + f.delay, 0);
if (outMs !== totalMs) throw new Error(`Loop length changed: ${totalMs}ms -> ${outMs}ms`);
console.log(`animated: ${frameList.length} frames, ${outMs}ms loop (unchanged), ${kb(gifBuf)}`);

// Static PNG: settled frame, white with luminance as alpha so it works on any dark background.
const still = scaled[0].px;
const rgba = Buffer.alloc(OW * OH * 4);
for (let i = 0; i < still.length; i++) {
  rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
  rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(((still[i] - bg) / (255 - bg)) * 255)));
}
const pngBuf = await sharp(rgba, { raw: { width: OW, height: OH, channels: 4 } }).png({ compressionLevel: 9, palette: true, colours: 64 }).toBuffer();

// --dry-run <dir>: write the files there to inspect, without touching public/email/ or team/logo.json.
const dry = process.argv.indexOf('--dry-run');
if (dry > -1) {
  const dir = process.argv[dry + 1];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'logo-animated.gif'), gifBuf);
  fs.writeFileSync(path.join(dir, 'logo-static.png'), pngBuf);
  console.log(`dry run: wrote ${dir}/logo-animated.gif and logo-static.png`);
  process.exit(0);
}
const save = (stem, ext, buf) => existingIdentical(stem, ext, buf) ?? writeNewAsset(nextVersionName(stem, ext), buf);
const gifName = save('blinc-logo-animated', 'gif', gifBuf);
const pngName = save('blinc-logo-static', 'png', pngBuf);
console.log(`public/email/${gifName} ${kb(gifBuf)}\npublic/email/${pngName} ${kb(pngBuf)}`);

// Where the settled wordmark sits inside the image, at 1x, so build.mjs can align it with the divider.
const w = (v) => Math.round((v * scale) / RETINA * 10) / 10;
const logo = {
  animated: gifName,
  static: pngName,
  width: OW / RETINA,
  height: OH / RETINA,
  wordmark: {
    left: w(settled.x0 - cx.start),
    top: w(settled.y0 - cy.start),
    right: w(cx.start + cx.len - settled.x1),
    width: WORDMARK_1X,
  },
  source: path.relative(ROOT, path.resolve(input)),
  loopMs: outMs,
};
fs.writeFileSync(path.join(ROOT, 'team/logo.json'), JSON.stringify(logo, null, 2) + '\n');
console.log('team/logo.json updated');
