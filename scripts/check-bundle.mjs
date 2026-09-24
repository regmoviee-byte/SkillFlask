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
// backup checks and their texts add 3.8 KB (182.8 KB).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = Number(process.argv[2] ?? 185);
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
