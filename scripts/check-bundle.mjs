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
// Package 13 (all thirteen themes, review follow-ups: the fastest level's mini in «Рекорды», the
// shared html.paused hook, the installed-app check, the shortcut request guard) keeps the
// budget: 199.2 KB, about 0.8 KB of headroom. The next package that adds initial-load code
// should lazy-load those sheets or raise the budget with a reason.
// v0.5 package 14 («Прогноз», «Активность») keeps the budget: the forecast, the heat maps, their
// sheets, read models and strings are lazy chunks; what stays in the initial load (the lazy
// wrappers, the map's same-size skeleton, the section titles, the future-tense level phrases of
// the 13 themes) is paid for by lazy-loading the install and link sheets. With more lazy chunks
// importing React, rolldown began to split React and other shared modules out of the entry
// (+1–3 KB of chunk overhead); vite.config.ts now keeps every initial module in one chunk
// (codeSplitting group `$initial`). 199.3 KB measured.
// 201 KB since package 14's review fixes (+0.7 KB): the forecast line keeps its place from the
// first paint instead of pushing the milestone rack and the ✓ buttons down as it arrives, which
// takes knowing at first paint whether there is a forecast — getSkillDetails applies the same
// rule as the lazy forecast (domain/pace.ts: the pace, the three-day rule, the level date,
// ≈ 0.5 KB); and a lazy chunk that fails to load no longer takes the app down (ui/lazySafe.ts),
// the home map's half-year check, the sheets' onExited (≈ 0.2 KB). 200.0 KB measured: 1 byte
// under 200 KB, too close for CI's zlib, so the budget moves by the next whole KB.
// 202 KB since v0.5 package 15 (the live timer, +1.4 KB): the pill, the sheet «Таймер», the
// finish flow, pausing and recording are a lazy chunk (TimerHost, ≈ 3.9 KB), but the first paint
// must know whether a timer runs — on every screen, since the pill floats over all of them — and
// start one from the ▶ of a step row: the live query of the settings row and its parser
// (services/timer.ts, domain/timerRow.ts), the context the rows read, the ▶ itself with its
// three glyphs, the date field of «Сколько минут?» that a timer's start day fills in, and the
// fallback toast for a timer chunk that fails to load. 201.4 KB measured.
// 203 KB since v0.5 package 16 (skill templates, +0.9 KB): the catalogue, the chooser, the form's
// «Действия из шаблона» with its sheet and their strings are lazy chunks (≈ 6 KB), but a new
// user's first paint is the empty state, which now leads to the templates — the popular chips
// and their names, «Все шаблоны», «Свой навык» — and the routes `/skills/new` (the chooser's
// lazy wrapper, whose fallback keeps the empty form reachable) and `/skills/new/<key>` (the form
// waits for its template chunk, fills its fields from it and creates the checked actions with
// the skill), the template keys the deep link `new_<key>` checks strictly, and the step
// fields' estimate against capacities typed in a form, and the session's new-skill drafts (a
// form's edits kept across «Назад» to the chooser). 202.6 KB measured: 0.4 KB of headroom, so
// the next packages' UI goes into lazy chunks.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = Number(process.argv[2] ?? 203);
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
