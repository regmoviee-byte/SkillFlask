// Screenshots of the «Машинка» preview: node preview/car.shots.mjs (with `npx vite --port 5232`
// running). Exits non-zero on any console error or page error.
//   <mode>-page.png           the whole preview (light, dark, purple, reduced)
//   <mode>-roads.png          the six roads, levels 1–6 at 50 % (light, dark, purple)
//   <mode>-levelup-N.png      one level-up from road 1 into road 2, frame by frame (light, dark)
//   <mode>-walk-N.png         the stage after each of six level-ups: roads 2, 3, 4, 5, 6, 1
//   <mode>-levels3-N.png      a three-level write: road 1 → 2 → 3 → 4 (light, dark)
//   reduced-levelup-N.png     the crossfade to road 2 under reduced motion
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:5232/preview/car.html';
const OUT = process.env.OUT ?? '/tmp/claude-0/-home-user-DailyApp/3c4f2948-d57c-5f7a-83fb-a8af732ded9c/scratchpad/shots/themes/car';
mkdirSync(OUT, { recursive: true });

const MODES = { light: '', dark: '?dark', purple: '?tg=purple', reduced: '?motion=reduced' };
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
try {
  for (const [mode, query] of Object.entries(MODES)) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const open = async (q) => {
      const page = await context.newPage();
      page.on('console', (m) => m.type() === 'error' && errors.push(`${mode}: ${m.text()}`));
      page.on('pageerror', (e) => errors.push(`${mode}: ${e}`));
      await page.route('https://telegram.org/**', (r) => r.abort());
      await page.goto(BASE + q);
      await page.locator('#stage svg').waitFor();
      await page.waitForTimeout(300);
      return page;
    };
    const page = await open(query);
    await page.screenshot({ path: `${OUT}/${mode}-page.png`, fullPage: true });
    if (mode !== 'reduced') await page.locator('#roads').screenshot({ path: `${OUT}/${mode}-roads.png` });
    if (mode === 'reduced') {
      // No choreography: a short crossfade straight to the next road.
      const stage = page.locator('#stage');
      await stage.scrollIntoViewIfNeeded();
      await page.click('#levelup');
      await page.waitForTimeout(120);
      await stage.screenshot({ path: `${OUT}/reduced-levelup-0.png`, animations: 'allow' });
      await page.waitForTimeout(500);
      await stage.screenshot({ path: `${OUT}/reduced-levelup-1.png` });
    }
    if (mode === 'light' || mode === 'dark') {
      const stage = page.locator('#stage');
      await stage.scrollIntoViewIfNeeded();
      // Fixed moments of the ~1.5 s choreography: the drive to the flag, the beat, the scroll into
      // the next road and the drive on.
      const moments = [0, 150, 300, 450, 600, 750, 850, 950, 1050, 1150, 1300, 1500, 1800];
      await page.click('#levelup');
      const t0 = Date.now();
      for (let n = 0; n < moments.length; n++) {
        await page.waitForTimeout(Math.max(0, moments[n] - (Date.now() - t0)));
        await stage.screenshot({ path: `${OUT}/${mode}-levelup-${n}.png`, animations: 'allow' });
      }
      // Five more level-ups walk the stage through roads 3, 4, 5, 6 and back to 1.
      await stage.screenshot({ path: `${OUT}/${mode}-walk-1.png` });
      for (let n = 2; n <= 6; n++) {
        await page.click('#levelup');
        await page.waitForTimeout(2200);
        await stage.screenshot({ path: `${OUT}/${mode}-walk-${n}.png` });
      }
      await page.close();
      const multi = await open(`${query}${query ? '&' : '?'}levels=3`);
      const stage3 = multi.locator('#stage');
      await stage3.scrollIntoViewIfNeeded();
      // Fixed moments of the ~2.9 s choreography (first beat, each scroll and drive, the end),
      // so the frames do not alias with the repeats however long a screenshot takes.
      const moments3 = [450, 900, 1150, 1500, 1750, 2100, 2350, 3000];
      await multi.click('#levelup');
      const t1 = Date.now();
      for (let n = 0; n < moments3.length; n++) {
        await multi.waitForTimeout(Math.max(0, moments3[n] - (Date.now() - t1)));
        await stage3.screenshot({ path: `${OUT}/${mode}-levels3-${n}.png`, animations: 'allow' });
      }
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
