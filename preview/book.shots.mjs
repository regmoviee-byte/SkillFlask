// Screenshots of the book theme preview (preview/book.html) on a phone viewport.
// Usage: node preview/book.shots.mjs [outDir] [baseUrl]
// Captures the whole page and the bookcase section («Полка», levels 1…70) in light, dark,
// purple-Telegram and reduced-motion modes, then the level-up choreography frame by frame in
// light and dark: one level from level 4, three levels, the very first book (the shelf appears)
// and the book that opens the bookcase above; then one reduced-motion level-up. Exits non-zero on
// any console error or page error.
// Requires a running dev server (`npx vite --port 5231`).

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? '/tmp/claude-0/-home-user-DailyApp/3c4f2948-d57c-5f7a-83fb-a8af732ded9c/scratchpad/shots/themes/book';
const baseUrl = process.argv[3] ?? 'http://localhost:5231/preview/book.html';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const MODES = {
  light: { query: '', dark: false },
  dark: { query: 'dark', dark: true },
  purple: { query: 'tg=purple', dark: true },
  reduced: { query: 'motion=reduced', dark: false },
};

const errors = [];
const browser = await chromium.launch({ executablePath });

async function openPage(mode, extraQuery = '') {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    colorScheme: MODES[mode].dark ? 'dark' : 'light',
  });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${mode}] console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${mode}] pageerror: ${String(e)}`));
  await page.route('https://telegram.org/**', (r) => r.abort());
  const query = [MODES[mode].query, extraQuery].filter(Boolean).join('&');
  await page.goto(`${baseUrl}${query ? `?${query}` : ''}`);
  await page.locator('#levelup').waitFor();
  // Fonts and the first idle frames settle.
  await page.waitForTimeout(500);
  return { context, page };
}

/** Clicks «Level up» `times` times and captures #stage every `every` ms, `count` frames each. */
async function captureLevelUp(page, name, count, every, times = 1) {
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  for (let t = 0; t < times; t++) {
    const started = Date.now();
    await page.locator('#levelup').click();
    for (let n = 0; n < count; n++) {
      const due = started + n * every;
      const left = due - Date.now();
      if (left > 0) await page.waitForTimeout(left);
      const frame = times > 1 ? `${t}-${String(n).padStart(2, '0')}` : String(n).padStart(2, '0');
      await stage.screenshot({ path: `${outDir}/${name}-${frame}.png`, animations: 'allow' });
    }
    // The choreography ends and the preview moves the level on.
    await page.waitForTimeout(Math.max(0, started + 1600 - Date.now()));
  }
  await stage.screenshot({ path: `${outDir}/${name}-end.png`, animations: 'allow' });
}

for (const mode of Object.keys(MODES)) {
  const { context, page } = await openPage(mode);
  await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true, animations: 'allow' });
  await page.locator('#shelf').screenshot({ path: `${outDir}/${mode}-shelf.png`, animations: 'allow' });
  await context.close();
  console.log(`captured ${mode}-page.png, ${mode}-shelf.png`);
}

for (const mode of ['light', 'dark']) {
  const runs = [
    // One level from level 4, twice: the shelf grows by a book each time.
    { name: 'levelup', query: '', count: 10, every: 130, times: 2 },
    { name: 'levelup3', query: 'levels=3', count: 8, every: 330 },
    // The first finished book: the shelf appears under it.
    { name: 'first', query: 'level=1', count: 10, every: 130 },
    // The sixteenth book no longer fits the near shelf: the bookcase above appears.
    { name: 'bookcase', query: 'level=16', count: 10, every: 130 },
  ];
  for (const { name, query, count, every, times } of runs) {
    const { context, page } = await openPage(mode, query);
    await captureLevelUp(page, `${mode}-${name}`, count, every, times);
    await context.close();
  }
  console.log(`captured ${mode} level-up frames`);
}

{
  // Reduced motion: a short crossfade, the shelf already one book longer.
  const { context, page } = await openPage('reduced');
  await captureLevelUp(page, 'reduced-levelup', 4, 80);
  await context.close();
  console.log('captured reduced level-up frames');
}

await browser.close();

if (errors.length) {
  console.error('Errors during the capture:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`done: ${outDir}`);
