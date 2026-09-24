// Fails when the gzipped JavaScript of the production build exceeds the budget.
// Usage: node scripts/check-bundle.mjs [limitKB]   (after `npm run build`)
// 165 KB since v0.3 package 5 (the flask choreography, celebrations, history timeline: +8.6 KB
// over 148.4 KB); the rest is the headroom for package 7's achievement catalogue.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = Number(process.argv[2] ?? 165);
const dir = 'dist/assets';

let total = 0;
const rows = [];
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.js')) continue;
  const size = gzipSync(readFileSync(join(dir, file))).length;
  total += size;
  rows.push(`${file}: ${(size / 1024).toFixed(1)} KB gzip`);
}
console.log(rows.join('\n'));
console.log(`total JS: ${(total / 1024).toFixed(1)} KB gzip (budget ${LIMIT_KB} KB)`);
if (total > LIMIT_KB * 1024) {
  console.error(`Bundle budget exceeded by ${((total - LIMIT_KB * 1024) / 1024).toFixed(1)} KB`);
  process.exit(1);
}
