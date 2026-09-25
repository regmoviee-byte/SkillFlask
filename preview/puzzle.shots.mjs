// Screenshots of the puzzle theme preview (preview/puzzle.html) on a phone viewport.
// Usage: node preview/puzzle.shots.mjs [outDir] [baseUrl]
// Captures the whole page in light, dark, purple-Telegram and reduced-motion modes; each of the
// twenty pictures («Картинки») in light, dark and purple, with a contact sheet per mode; the
// level-up choreography frame by frame (one level: picture 1 → 2; three levels: 1 → 4) with a
// strip per run; times the level-up on the solo stage (under 1.2 s per level); and checks that
// mark captions keep the 16 px page gutter at 390 and 320 px.
// Exits non-zero on any console error, page error or failed check. Requires a running dev
// server (`npx vite --port 5233`).

import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? '/tmp/claude-0/-home-user-DailyApp/3c4f2948-d57c-5f7a-83fb-a8af732ded9c/scratchpad/shots/themes/puzzle';
const baseUrl = process.argv[3] ?? 'http://localhost:5233/preview/puzzle.html';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const MODES = {
  light: { query: '', dark: false },
  dark: { query: 'dark', dark: true },
  purple: { query: 'tg=purple', dark: true },
  reduced: { query: 'motion=reduced', dark: false },
};
const GUTTER = 16;

const errors = [];
const browser = await chromium.launch({ executablePath });

async function openPage(mode, extraQuery = '', width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
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

/** Lays PNG files out in a grid on the page's background and saves the sheet. */
async function sheet(files, path, columns, background) {
  const page = await browser.newPage({ viewport: { width: 280 * columns, height: 400 } });
  const cells = files.map((f) => `<img style="width:100%;display:block" src="data:image/png;base64,${readFileSync(f).toString('base64')}">`).join('');
  await page.setContent(`<body style="margin:0;background:${background};display:grid;grid-template-columns:repeat(${columns},1fr);gap:2px">${cells}</body>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path, fullPage: true });
  await page.close();
}

/** Clicks «Level up» and captures #stage every `every` ms, `count` times; then a strip. */
async function captureLevelUp(page, name, count, every) {
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  const files = [];
  const started = Date.now();
  await page.locator('#levelup').click();
  for (let n = 0; n < count; n++) {
    const due = started + n * every;
    const left = due - Date.now();
    if (left > 0) await page.waitForTimeout(left);
    const path = `${outDir}/${name}-${String(n).padStart(2, '0')}.png`;
    await stage.screenshot({ path, animations: 'allow' });
    files.push(path);
  }
  const background = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  await sheet(files, `${outDir}/${name}-strip.png`, Math.min(count, 8), background);
}

for (const mode of Object.keys(MODES)) {
  const { context, page } = await openPage(mode);
  await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true, animations: 'allow' });
  if (mode !== 'reduced') {
    // The twenty pictures, one file each, and a sheet of them.
    await page.locator('#pictures').screenshot({ path: `${outDir}/${mode}-pictures.png`, animations: 'disabled' });
    const figures = page.locator('#pictures figure');
    const files = [];
    for (let i = 0; i < (await figures.count()); i++) {
      const path = `${outDir}/${mode}-pic-${String(i + 1).padStart(2, '0')}.png`;
      await figures.nth(i).screenshot({ path, animations: 'disabled' });
      files.push(path);
    }
    if (files.length !== 20) errors.push(`[${mode}] expected 20 pictures, found ${files.length}`);
    const background = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    await sheet(files, `${outDir}/${mode}-pictures-sheet.png`, 5, background);
    await page.locator('#pictures-half').screenshot({ path: `${outDir}/${mode}-pictures-half.png`, animations: 'disabled' });
    await page.locator('#minis-levels').screenshot({ path: `${outDir}/${mode}-minis-levels.png`, animations: 'disabled' });
  }
  await context.close();
  console.log(`captured ${mode}`);
}

// The level-up on the solo stage (the other heroes would re-render at every step).
for (const mode of ['light', 'dark', 'purple']) {
  {
    const { context, page } = await openPage(mode, 'solo');
    await captureLevelUp(page, `${mode}-levelup`, 16, 75);
    await page.waitForTimeout(600);
    const level = await page.locator('#stage-level').textContent();
    if (level !== 'level 2') errors.push(`[${mode}] the stage should be at level 2 after a level-up, shows «${level}»`);
    await context.close();
  }
  {
    const { context, page } = await openPage(mode, 'solo&levels=3');
    await captureLevelUp(page, `${mode}-levelup3`, 18, 120);
    await context.close();
  }
  console.log(`captured ${mode} level-up frames`);
}

{
  const { context, page } = await openPage('light', 'solo&motion=reduced');
  await captureLevelUp(page, 'reduced-levelup', 6, 60);
  await context.close();
}

// How long the choreography takes on screen, without screenshots slowing it down.
for (const [query, budget] of [['levels=1', 1200], ['levels=3', 3 * 1200], ['levels=5', 3 * 1200], ['motion=reduced', 400]]) {
  const { context, page } = await openPage('light', `solo&${query}`);
  const times = [];
  for (let run = 0; run < 3; run++) {
    await page.locator('#levelup').click();
    await page.waitForFunction(() => document.getElementById('stage').dataset.playedMs, undefined, { timeout: 8000 });
    times.push(Number(await page.locator('#stage').getAttribute('data-played-ms')));
    await page.evaluate(() => delete document.getElementById('stage').dataset.playedMs);
    await page.locator('#reset').click();
    await page.waitForTimeout(700);
  }
  console.log(`level-up ${query}: ${times.join(' / ')} ms (budget ${budget})`);
  if (Math.max(...times) >= budget) errors.push(`level-up ${query} took ${Math.max(...times)} ms (budget ${budget})`);
  await context.close();
}

// Mark captions stay inside the reserved margin: at least GUTTER px from the screen edge.
for (const width of [390, 320]) {
  const { context, page } = await openPage('light', '', width);
  const cell = page.locator('.pz-mark-caption').first().locator('xpath=ancestor::div[contains(@class,"cell")]');
  await cell.screenshot({ path: `${outDir}/marks-${width}.png`, animations: 'disabled' });
  const lefts = await page.locator('.pz-mark-caption').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
  const min = Math.min(...lefts);
  console.log(`captions at ${width} px: leftmost ${min.toFixed(1)} px`);
  if (!lefts.length || min < GUTTER) errors.push(`captions at ${width} px start ${min.toFixed(1)} px from the edge (< ${GUTTER})`);
  await context.close();
}

await browser.close();

if (errors.length) {
  console.error('Errors during the capture:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`done: ${outDir}`);
