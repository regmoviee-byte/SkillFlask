// Fails when the gzipped JavaScript of the production build exceeds the budget.
// Usage: node scripts/check-bundle.mjs [limitKB]   (after `npm run build`)
// 165 KB since v0.3 package 5 (the flask choreography, celebrations, history timeline: +8.6 KB
// over 148.4 KB). Package 6 («Сегодня», the home bento, the lifecycle) brings it to 161.9 KB.
// 173 KB since package 7: the achievement engine, the 44-entry catalogue with its Russian
// texts, the «Ачивки» tab, the detail sheet, the medal glyphs and the card add 8.7 KB (170.6 KB).
// 181 KB since package 8: the schedule planner, «Сегодня» v2 (week picker, «Осталось», quotas),
// timed steps (Stepper, «Сколько минут?», the step form's type/rate/schedule, minute
// corrections) and their texts add 8.1 KB (178.9 KB).
// 185 KB since package 9: marks («Засечки») — the mark sheet (view, form, delete), the marks
// card, the ⋯ menu, marks on the hero flask and in the history, the service, the schema-3
// backup checks and their texts bring it to 183.0 KB (measured); the final v0.3 polish
// (toast guards, review follow-ups) to 183.8 KB.
// 192 KB since package 10: personal records and «Итоги недели» — the pure records/recap
// functions, the recap screen with its week switcher, the records section on «Ачивки», the
// home row, the hero-or-card rule for a level-up and their texts add 4.4 KB (188.2 KB).
// 196 KB since package 11 («Образы прогресса»): the budget is now the INITIAL load — the entry
// chunk and what it imports statically (read from dist/.vite/manifest.json). The theme engine
// (registry, contract wrappers, the appearance picker and sheet, the level strings of all 13
// themes, the colour scopes, schema 4) adds 4.1 KB to it (192.4 KB; 193.1 KB with the eleven theme
// files of the theme branches registered, which only add their loaders to it). Every progress theme but
// the flask is a lazy chunk loaded the first time a skill shows it; each such chunk has its
// own budget (LAZY_LIMIT_KB, the theme README's «≈ 12 KB per theme» plus its CSS-free JS
// margin) and does not count towards the initial load.
// 200 KB since package 12: deep links (the start parameter parser, the skill link), the
// home-screen shortcut (Telegram 8.0 and the browser install prompt, the instructions sheet),
// the service worker's registration and update flow, the forced «Тема» (light / dark with the
// accent contrast check, the native buttons pinned to it) and their texts add 5.6 KB
// (198.9 KB, measured against 193.3 KB). Lazy-loading the two sheets it adds (install
// instructions, the link fallback) would win back only ≈ 0.7 KB, so they stay in the bundle.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = Number(process.argv[2] ?? 200);
const LAZY_LIMIT_KB = 14;
const dir = 'dist/assets';
const manifestPath = 'dist/.vite/manifest.json';

const gz = (file) => gzipSync(readFileSync(join('dist', file))).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);

const jsFiles = readdirSync(dir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => `assets/${file}`);

/** The JS of the initial load: every entry and, recursively, its static imports. */
function initialFiles() {
  if (!existsSync(manifestPath)) return new Set(jsFiles);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const out = new Set();
  const visit = (key) => {
    const chunk = manifest[key];
    if (!chunk || out.has(chunk.file)) return;
    out.add(chunk.file);
    for (const next of chunk.imports ?? []) visit(next);
  };
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);
  return out;
}

const initial = initialFiles();
let total = 0;
let lazyTotal = 0;
const failures = [];
const rows = [];
for (const file of jsFiles) {
  const size = gz(file);
  if (initial.has(file)) {
    total += size;
    rows.push(`${file}: ${kb(size)} KB gzip`);
  } else {
    lazyTotal += size;
    rows.push(`${file}: ${kb(size)} KB gzip (lazy)`);
    if (size > LAZY_LIMIT_KB * 1024) failures.push(`${file} is ${kb(size)} KB, over the ${LAZY_LIMIT_KB} KB of a lazy chunk`);
  }
}
console.log(rows.join('\n'));
console.log(`initial JS: ${kb(total)} KB gzip (budget ${LIMIT_KB} KB); lazy chunks: ${kb(lazyTotal)} KB gzip`);
if (total > LIMIT_KB * 1024) failures.push(`Bundle budget exceeded by ${kb(total - LIMIT_KB * 1024)} KB`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
