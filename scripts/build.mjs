// Builds signatures/{slug}.html for everyone in team/team.json and renders
// previews/{slug}.png plus previews/city-test-{city}.png.
// Usage: node scripts/build.mjs [--no-previews] [--live]
//   --live  render previews from https://assets.blinc.studio instead of local files
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, EMAIL_DIR } from './lib/assets.mjs';

export const ASSET_BASE = 'https://assets.blinc.studio/email';

// Fixed order. Only the highlight moves per person.
export const CITIES = ['LONDON', 'DUBAI', 'LIMASSOL', 'MILAN', 'LISBON'];

// Current logo, written by scripts/logo.mjs.
const LOGO = JSON.parse(fs.readFileSync(path.join(ROOT, 'team/logo.json'), 'utf8'));

// Layout from the mockup: 28px card padding, 133px avatar, 28px gap, and the settled
// wordmark's top-right corner 12.4px below the content top, flush with the end of the blue rule.
const PAD = 28, AVATAR = 133, GAP = 28, WORDMARK_TOP = 12.4;
const RULE_W = 600 - PAD * 2 - AVATAR - GAP;               // 383: text column and rule width
// The animation reaches past the settled wordmark on the right; let the logo cell take that
// much of the right padding so the wordmark itself lines up with the rule.
const OVERHANG = Math.max(0, Math.min(PAD, Math.round(LOGO.wordmark.right)));
const LAYOUT = {
  PAD_R: PAD - OVERHANG,
  INNER_W: RULE_W + AVATAR + GAP + OVERHANG,
  COL_W: RULE_W + OVERHANG,
  OVERHANG,
  LOGO_PAD_TOP: Math.max(0, Math.round(WORDMARK_TOP - LOGO.wordmark.top)),
};

const SEPARATOR = '&nbsp;&nbsp;/&nbsp;&nbsp;';
const GMAIL_LIMIT = 10000;
const TODO = 'TODO';

const args = new Set(process.argv.slice(2));
const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn(`! ${msg}`); };

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function citiesHtml(city, who) {
  const c = String(city ?? '').trim().toUpperCase();
  if (c === TODO) {
    warn(`${who}: city is TODO, strip rendered with no highlight`);
  } else if (!CITIES.includes(c)) {
    throw new Error(`${who}: city "${city}" is not one of ${CITIES.join(', ')}. Fix team.json or add it to CITIES in scripts/build.mjs.`);
  }
  return CITIES.map((name) => (name === c ? `<span style="color:#ffffff;">${name}</span>` : name)).join(SEPARATOR);
}

export function renderSignature(template, person) {
  const who = person.name || person.slug;
  for (const k of ['name', 'title', 'phone', 'phoneIntl', 'city']) {
    if (person[k] === TODO) warn(`${who}: ${k} is TODO`);
  }
  if (!person.avatarAsset) throw new Error(`${who}: no avatarAsset in team.json. Run "npm run avatars" first.`);
  const tokens = {
    ASSET_BASE: ASSET_BASE,
    NAME: escapeHtml(person.name),
    TITLE: escapeHtml(person.title),
    AVATAR: person.avatarAsset,
    PHONE: escapeHtml(person.phone),
    PHONE_INTL: escapeHtml(String(person.phoneIntl).replace(/[^+\d]/g, '')),
    CITIES: citiesHtml(person.city, who),
    LOGO: LOGO.animated,
    LOGO_W: LOGO.width,
    LOGO_H: LOGO.height,
    ...LAYOUT,
  };
  const html = template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in tokens)) throw new Error(`template.html has unknown token ${m}`);
    return tokens[key];
  });
  if (html.length > GMAIL_LIMIT) warn(`${who}: signature is ${html.length} characters, over Gmail's ${GMAIL_LIMIT} limit`);
  return html;
}

const page = (title, body) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
</head>
<body style="margin:0;padding:24px;background:#ffffff;">
${body}
</body>
</html>
`;

export function assetsUsed(html) {
  return [...new Set([...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]))];
}

// Hashes of everything in public/email/. Served at /manifest.json so the append-only check
// can compare a new deploy against what is live.
function writeManifest() {
  const files = {};
  for (const f of fs.readdirSync(EMAIL_DIR).sort()) {
    if (f.startsWith('.')) continue;
    files[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(EMAIL_DIR, f))).digest('hex');
  }
  fs.writeFileSync(path.join(ROOT, 'public/manifest.json'), JSON.stringify({ files }, null, 2) + '\n');
}

async function renderPreviews(jobs) {
  const { chromium } = await import('playwright');
  // Locally, previews load from public/email/. Files not supplied yet can be stood in
  // for by PREVIEW_PLACEHOLDERS (a folder outside public/); those previews are marked.
  const placeholders = process.env.PREVIEW_PLACEHOLDERS;
  const stage = path.join(ROOT, 'previews/.assets');
  let usedPlaceholder = new Set();
  if (!args.has('--live')) {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    if (placeholders) for (const f of fs.readdirSync(placeholders)) fs.copyFileSync(path.join(placeholders, f), path.join(stage, f));
    for (const f of fs.readdirSync(EMAIL_DIR)) fs.copyFileSync(path.join(EMAIL_DIR, f), path.join(stage, f));
    if (placeholders) usedPlaceholder = new Set(fs.readdirSync(placeholders).filter((f) => !fs.existsSync(path.join(EMAIL_DIR, f))));
  }
  const base = args.has('--live') ? ASSET_BASE : pathToFileURL(stage).href;

  const browser = await chromium.launch();
  const tab = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 700, height: 400 } });
  for (const { html, out, who } of jobs) {
    const file = path.join(stage, 'preview.html');
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(file, page(who, html.replaceAll(ASSET_BASE, base)));
    await tab.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    const broken = await tab.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src.split('/').pop()));
    if (broken.length) warn(`${who}: images failed to load in preview: ${broken.join(', ')}`);
    // The city strip must stay on one line inside the text column.
    const stripWidth = await tab.$$eval('td', (tds) => {
      const td = tds.find((t) => /LONDON/.test(t.textContent) && !t.querySelector('table'));
      const r = document.createRange(); r.selectNodeContents(td);
      return Math.ceil(r.getBoundingClientRect().width);
    });
    if (stripWidth > RULE_W) warn(`${who}: city strip is ${stripWidth}px, wider than the ${RULE_W}px column. It will not fit on one line at 600px.`);
    await (await tab.$('table')).screenshot({ path: out });
    const ph = assetsUsed(html).map((u) => u.split('/').pop()).filter((f) => usedPlaceholder.has(f));
    console.log(`${path.relative(ROOT, out)}${ph.length ? `  (placeholder: ${ph.join(', ')})` : ''}`);
  }
  await browser.close();
  fs.rmSync(stage, { recursive: true, force: true });
}

async function main() {
  const template = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8').trim();
  const team = JSON.parse(fs.readFileSync(path.join(ROOT, 'team/team.json'), 'utf8'));
  const slugs = new Set();
  const jobs = [];
  fs.mkdirSync(path.join(ROOT, 'signatures'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'previews'), { recursive: true });

  for (const person of team) {
    if (!/^[a-z0-9-]+$/.test(person.slug)) throw new Error(`Bad slug "${person.slug}": use lowercase letters, digits and dashes`);
    if (slugs.has(person.slug)) throw new Error(`Duplicate slug "${person.slug}"`);
    slugs.add(person.slug);
    const html = renderSignature(template, person);
    fs.writeFileSync(path.join(ROOT, 'signatures', `${person.slug}.html`), page(`${person.name} signature`, html));
    console.log(`signatures/${person.slug}.html  ${html.length} chars`);
    jobs.push({ html, who: person.name, out: path.join(ROOT, 'previews', `${person.slug}.png`) });
    for (const url of assetsUsed(html)) {
      const f = url.slice(ASSET_BASE.length + 1);
      if (!fs.existsSync(path.join(EMAIL_DIR, f))) warn(`${person.name}: ${f} is not in public/email/ yet, it will 404 once deployed`);
    }
  }

  // One test per city, using the first complete person, to check the highlight in every position.
  const sample = team.find((p) => CITIES.includes(String(p.city).toUpperCase()) && p.avatarAsset);
  if (sample) {
    for (const city of CITIES) {
      jobs.push({ html: renderSignature(template, { ...sample, city }), who: `city test ${city}`, out: path.join(ROOT, 'previews', `city-test-${city.toLowerCase()}.png`) });
    }
  }

  writeManifest();
  if (!args.has('--no-previews')) await renderPreviews(jobs);
  console.log(warnings.length ? `\n${warnings.length} warning(s):\n- ${[...new Set(warnings)].join('\n- ')}` : '\nNo warnings.');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => { console.error(`\nBUILD FAILED: ${e.message}`); process.exit(1); });
}
