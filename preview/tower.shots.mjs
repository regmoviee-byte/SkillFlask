// Screenshots of the «Башня» theme preview: the whole page in light / dark / purple / reduced
// modes, the «Город» section (the skyline at levels 1, 3, 7, 15, 40) by day and at night, the
// level-up choreography frame by frame (light and dark every 150 ms for 1.6 s: the finished
// tower moves into the city), a 3-level one in 6 frames, and the night stage for 6 s, one frame
// a second, so the windows switching on and off are visible.
// Usage: node preview/tower.shots.mjs [outDir] [baseUrl]   (requires `npx vite --port 5230`)
// Exits non-zero on any console error or page error.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'screenshots/themes/tower';
const baseUrl = process.argv[3] ?? 'http://localhost:5230';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const MODES = {
  light: '',
  dark: '?dark',
  purple: '?tg=purple',
  reduced: '?motion=reduced',
};

const errors = [];
const browser = await chromium.launch({ executablePath });

async function open(mode, extra = '') {
  const dark = mode === 'dark' || mode === 'purple';
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${mode}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${mode}] ${String(e)}`));
  await page.route('https://telegram.org/**', (r) => r.abort());
  const query = MODES[mode] + (extra ? (MODES[mode] ? '&' : '?') + extra : '');
  await page.goto(`${baseUrl}/preview/tower.html${query}`);
  await page.locator('#stage svg[role="img"]').waitFor();
  await page.waitForTimeout(500);
  return { page, context };
}

for (const mode of Object.keys(MODES)) {
  const { page, context } = await open(mode);
  await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true });
  if (mode !== 'reduced') await page.locator('#city').screenshot({ path: `${outDir}/${mode}-city.png`, animations: 'allow' });
  await context.close();
}

/** Clicks «Level up» and captures #stage `frames` times, `every` ms apart from the click. */
async function levelUp(mode, extra, name, frames, every) {
  const { page, context } = await open(mode, extra);
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  const t0 = Date.now();
  await page.locator('#levelup').click();
  for (let i = 0; i < frames; i++) {
    const due = t0 + i * every - Date.now();
    if (due > 0) await page.waitForTimeout(due);
    await stage.screenshot({ path: `${outDir}/${mode}-${name}-${String(i).padStart(2, '0')}.png`, animations: 'allow' });
  }
  await context.close();
}

for (const mode of ['light', 'dark']) {
  await levelUp(mode, '', 'levelup', 11, 150);
}
await levelUp('light', 'levels=3', 'levelup3', 6, 400);

// The night stage for 6 s, a frame a second: lamps switch on and off slowly.
{
  const { page, context } = await open('dark');
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) {
    const due = t0 + i * 1000 - Date.now();
    if (due > 0) await page.waitForTimeout(due);
    await stage.screenshot({ path: `${outDir}/dark-night-${i}.png`, animations: 'allow' });
  }
  await context.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok: ${outDir}`);
