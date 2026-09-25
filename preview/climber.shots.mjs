// Screenshots of the «Альпинист» preview: node preview/climber.shots.mjs (with `npx vite --port
// 5217` running). Whole page for light / dark / purple / reduced; level-up frames of #stage
// for light and dark (every 150 ms for 1.6 s), then a three-level one. Fails on any console
// or page error.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5217/preview/climber.html';
const OUT = process.env.SHOTS_DIR ?? '/tmp/claude-0/-home-user-DailyApp/3c4f2948-d57c-5f7a-83fb-a8af732ded9c/scratchpad/shots/themes/climber';
const MODES = { light: '', dark: '?dark', purple: '?tg=purple', reduced: '?motion=reduced' };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];

async function open(query) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${query}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${query}: ${String(e)}`));
  await page.route('https://telegram.org/**', (r) => r.abort());
  await page.goto(BASE + query);
  await page.locator('#stage svg').waitFor();
  await page.waitForTimeout(400);
  return { context, page };
}

async function levelUp(page, prefix, frames, every) {
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.click('#levelup');
  for (let n = 0; n < frames; n++) {
    await stage.screenshot({ path: `${OUT}/${prefix}-${String(n).padStart(2, '0')}.png` });
    await page.waitForTimeout(every);
  }
}

try {
  for (const [mode, query] of Object.entries(MODES)) {
    const { context, page } = await open(query);
    await page.screenshot({ path: `${OUT}/${mode}-page.png`, fullPage: true });
    if (mode === 'light' || mode === 'dark') {
      await levelUp(page, `${mode}-levelup`, 11, 150);
      const sep = query ? '&' : '?';
      const multi = await open(`${query}${sep}levels=3`);
      await levelUp(multi.page, `${mode}-levels3`, 6, 400);
      await multi.context.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`shots in ${OUT}`);
