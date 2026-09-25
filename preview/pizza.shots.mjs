// Screenshots of the pizza theme preview (preview/pizza.html) on a phone viewport.
// Usage: node preview/pizza.shots.mjs [outDir] [baseUrl]
// Captures the whole page in light, dark, purple-Telegram and reduced-motion modes, then the
// level-up choreography frame by frame (one level, then three). Exits non-zero on any console
// error or page error. Requires a running dev server (`npx vite --port 5211`).

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? '/tmp/claude-0/-home-user-DailyApp/3c4f2948-d57c-5f7a-83fb-a8af732ded9c/scratchpad/shots/themes/pizza';
const baseUrl = process.argv[3] ?? 'http://localhost:5211/preview/pizza.html';
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

/** Clicks «Level up» and captures #stage every `every` ms, `count` times. */
async function captureLevelUp(page, name, count, every) {
  const stage = page.locator('#stage');
  const started = Date.now();
  await page.locator('#levelup').click();
  for (let n = 0; n < count; n++) {
    const due = started + n * every;
    const left = due - Date.now();
    if (left > 0) await page.waitForTimeout(left);
    await stage.screenshot({ path: `${outDir}/${name}-${String(n).padStart(2, '0')}.png`, animations: 'allow' });
  }
}

/** Layout checks with real text metrics: ruler labels inside the box, captions apart and inside the hero. */
async function checkGeometry(page, mode) {
  const problems = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.pizza--hero').forEach((hero, h) => {
      hero.querySelectorAll('.pizza-ruler text').forEach((t) => {
        const box = t.getBBox();
        if (box.x < 0 || box.x + box.width > 160.5) out.push(`hero ${h}: ruler label «${t.textContent}» spans ${box.x.toFixed(1)}..${(box.x + box.width).toFixed(1)}`);
      });
      const heroBox = hero.getBoundingClientRect();
      const captions = [...hero.querySelectorAll('.pizza-mark-caption')].map((c) => c.getBoundingClientRect());
      captions.forEach((r, i) => {
        if (r.bottom > heroBox.bottom + 0.5) out.push(`hero ${h}: caption ${i} ends ${(r.bottom - heroBox.bottom).toFixed(1)} px below the hero`);
        if (r.right > heroBox.right + 0.5) out.push(`hero ${h}: caption ${i} ends ${(r.right - heroBox.right).toFixed(1)} px right of the hero`);
        if (i > 0 && r.top < captions[i - 1].bottom - 0.5) out.push(`hero ${h}: caption ${i} overlaps caption ${i - 1} by ${(captions[i - 1].bottom - r.top).toFixed(1)} px`);
      });
    });
    return out;
  });
  for (const p of problems) errors.push(`[${mode}] geometry: ${p}`);
}

mkdirSync(`${outDir}/detail`, { recursive: true });
for (const mode of Object.keys(MODES)) {
  const { context, page } = await openPage(mode);
  await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true, animations: 'allow' });
  await checkGeometry(page, mode);
  const cells = page.locator('.cell');
  const count = await cells.count();
  for (let i = 0; i < count; i++) await cells.nth(i).screenshot({ path: `${outDir}/detail/${mode}-cell${i}.png`, animations: 'allow' });
  await page.locator('.minis').screenshot({ path: `${outDir}/detail/${mode}-minis.png`, animations: 'allow' });
  await context.close();
  console.log(`captured ${mode}-page.png and details`);
}

/** Samples the plate every frame of a level-up: it must never reach the stage clip (y 168). */
async function checkArrival(mode, levels) {
  const { context, page } = await openPage(mode, `levels=${levels}`);
  const maxBottom = await page.evaluate(async () => {
    const svg = document.querySelector('#stage svg');
    const plate = svg.querySelector('.pizza-plate');
    const unit = 160 / svg.getBoundingClientRect().width;
    let max = -Infinity;
    document.querySelector('#levelup').click();
    const end = performance.now() + 900 * 3 + 600;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      // Only while a pizza arrives (the slide that starts above, at a negative translateY):
      // the away phase takes the serving below the clip on purpose.
      const arriving = svg
        .querySelector('.pizza-serving')
        .getAnimations()
        .some((an) => an.playState === 'running' && String(an.effect.getKeyframes()[0]?.transform).includes('translateY(-'));
      if (!arriving) continue;
      const bottom = (plate.getBoundingClientRect().bottom - svg.getBoundingClientRect().top) * unit;
      max = Math.max(max, bottom);
    }
    return max;
  });
  if (!Number.isFinite(maxBottom)) errors.push(`[${mode}] arrival: no arriving frames were sampled`);
  else if (!(maxBottom < 168)) errors.push(`[${mode}] arrival: the plate reaches y ${maxBottom.toFixed(1)} (the stage clip is at 168)`);
  console.log(`arrival (${levels} levels): plate bottom at most y ${maxBottom.toFixed(1)}`);
  await context.close();
}
await checkArrival('light', 1);
await checkArrival('light', 3);

for (const mode of ['light', 'dark']) {
  {
    const { context, page } = await openPage(mode);
    await captureLevelUp(page, `${mode}-levelup`, 11, 150);
    await context.close();
  }
  {
    const { context, page } = await openPage(mode, 'levels=3');
    await captureLevelUp(page, `${mode}-levelup3`, 6, 320);
    await context.close();
  }
  console.log(`captured ${mode} level-up frames`);
}

await browser.close();

if (errors.length) {
  console.error('Errors during the capture:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`done: ${outDir}`);
