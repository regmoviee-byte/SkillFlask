// Screenshots of the flower theme preview: the whole page in light / dark / purple / reduced
// modes, the species row and the garden (levels 1–70) in light / dark / purple, and the level-up
// frame by frame (light and dark: bloom → transplant into the garden → a fresh seed; then a
// 3-level one). Each level-up frame is its own run: click, wait t ms, pause every animation.
// Usage: node preview/flower.shots.mjs [outDir] [baseUrl]   (requires `npx vite --port 5210`)
// Exits non-zero on any console error or page error.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'screenshots/themes/flower';
const baseUrl = process.argv[3] ?? 'http://localhost:5210';
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
  });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${mode}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${mode}] ${String(e)}`));
  await page.route('https://telegram.org/**', (r) => r.abort());
  const query = MODES[mode] + (extra ? (MODES[mode] ? '&' : '?') + extra : '');
  await page.goto(`${baseUrl}/preview/flower.html${query}`);
  await page.locator('#stage svg[role="img"]').waitFor();
  await page.waitForTimeout(600);
  return { page, context };
}

for (const mode of Object.keys(MODES)) {
  const { page, context } = await open(mode);
  await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true });
  if (mode !== 'reduced') {
    // The butterfly holds still for the stills.
    await page.addStyleTag({ content: '.anim-decor { animation-play-state: paused !important; }' });
    await page.locator('#species').screenshot({ path: `${outDir}/${mode}-species.png` });
    await page.locator('#garden').screenshot({ path: `${outDir}/${mode}-garden.png` });
  }
  await context.close();
}

/** Captures #stage `t` ms into the level-up for every t (a fresh page per frame), then the end. */
async function levelUp(mode, extra, name, times) {
  const { page, context } = await open(mode, extra);
  for (const [i, t] of times.entries()) {
    if (i) {
      await page.reload();
      await page.locator('#stage svg[role="img"]').waitFor();
      await page.waitForTimeout(300);
    }
    await page.evaluate(async (t) => {
      document.getElementById('levelup').click();
      await new Promise((resolve) => setTimeout(resolve, t));
      for (const a of document.getAnimations()) if (!a.effect?.target?.classList?.contains('anim-decor')) a.pause();
    }, t);
    await page.locator('#stage').screenshot({ path: `${outDir}/${mode}-${name}-${String(t).padStart(4, '0')}.png` });
  }
  // The settled end state of a whole run (≤ 1.2 s per level).
  await page.reload();
  await page.locator('#stage svg[role="img"]').waitFor();
  await page.waitForTimeout(300);
  await page.locator('#levelup').click();
  await page.getByText('готов').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(200);
  await page.locator('#stage').screenshot({ path: `${outDir}/${mode}-${name}-end.png` });
  await context.close();
}

const ONE = [0, 150, 300, 450, 540, 600, 660, 720, 780, 860, 1000];
for (const mode of ['light', 'dark']) await levelUp(mode, '', 'levelup', ONE);
await levelUp('purple', '', 'levelup', [540, 640, 740, 860]);
await levelUp('light', 'levels=3', 'levelup3', [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400]);

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok: ${outDir}`);
