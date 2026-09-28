// Fails if any file already published in public/email/ has been deleted or changed.
// Usage:
//   node scripts/check-append-only.mjs              compare with the live site's /manifest.json
//   node scripts/check-append-only.mjs --git <ref>  compare with a git ref, e.g. origin/main
// Runs as the Vercel build command, so a deploy that breaks old emails never goes live.
// Uses only Node built-ins so Vercel needs no npm install.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMAIL_DIR = path.join(ROOT, 'public/email');
const LIVE_MANIFEST = 'https://assets.blinc.studio/manifest.json';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const current = {};
for (const f of fs.existsSync(EMAIL_DIR) ? fs.readdirSync(EMAIL_DIR) : []) current[f] = sha(fs.readFileSync(path.join(EMAIL_DIR, f)));

let baseline, source;
const gi = process.argv.indexOf('--git');
if (gi > -1) {
  const ref = process.argv[gi + 1] || 'origin/main';
  source = `git ${ref}`;
  baseline = {};
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
  try { git('rev-parse', '--verify', `${ref}^{commit}`); } catch {
    console.error(`Unknown git ref "${ref}". Run "git fetch origin" first, or pass --git <ref>.`);
    process.exit(1);
  }
  for (const p of git('ls-tree', '-r', '--name-only', ref, '--', 'public/email/').toString().split('\n').filter(Boolean)) {
    baseline[path.basename(p)] = sha(git('show', `${ref}:${p}`));
  }
} else {
  source = LIVE_MANIFEST;
  try {
    const res = await fetch(LIVE_MANIFEST, { signal: AbortSignal.timeout(15000) });
    if (res.status === 404) { console.log(`No live manifest yet (${LIVE_MANIFEST} 404). First deploy, nothing to compare.`); process.exit(0); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    baseline = (await res.json()).files;
  } catch (e) {
    if (process.env.ALLOW_NO_MANIFEST) { console.warn(`! Could not fetch ${LIVE_MANIFEST}: ${e.message}. Skipping check.`); process.exit(0); }
    console.error(`Could not fetch ${LIVE_MANIFEST}: ${e.message}. Set ALLOW_NO_MANIFEST=1 only if the site has never been deployed.`);
    process.exit(1);
  }
}

const problems = [];
for (const [f, h] of Object.entries(baseline)) {
  if (!(f in current)) problems.push(`DELETED  public/email/${f}`);
  else if (current[f] !== h) problems.push(`CHANGED  public/email/${f}`);
}
if (problems.length) {
  console.error(`Append-only check FAILED against ${source}:\n  ${problems.join('\n  ')}\n\nEvery email ever sent points at these files. Restore them and save changes as a new version (-v2, -v3).`);
  process.exit(1);
}
console.log(`Append-only check passed against ${source}: ${Object.keys(baseline).length} published file(s) intact, ${Object.keys(current).length - Object.keys(baseline).length} new.`);
