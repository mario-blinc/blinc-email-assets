// After a deploy: fetches every image URL used in every signature and checks
// for a 200, the right content-type and cross-origin headers.
// Usage: node scripts/verify-urls.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/assets.mjs';

const TYPES = { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const dir = path.join(ROOT, 'signatures');
const urls = new Set();
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/src="(https:[^"]+)"/g)) urls.add(m[1]);
}
let failed = 0;
for (const url of [...urls].sort()) {
  const want = TYPES[url.split('.').pop().toLowerCase()];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const type = (res.headers.get('content-type') || '').split(';')[0];
    const issues = [];
    if (res.status !== 200) issues.push(`status ${res.status}`);
    if (type !== want) issues.push(`content-type ${type || 'none'}, expected ${want}`);
    if (res.headers.get('access-control-allow-origin') !== '*') issues.push('missing Access-Control-Allow-Origin');
    if (issues.length) failed++;
    console.log(`${issues.length ? 'FAIL' : 'OK  '}  ${url}${issues.length ? '  ' + issues.join(', ') : `  ${type}`}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${url}  ${e.message}`);
  }
}
console.log(`\n${urls.size - failed}/${urls.size} OK`);
process.exit(failed ? 1 : 0);
