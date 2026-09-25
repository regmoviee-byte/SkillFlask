// Screenshots of the «Ракета» preview page: the whole page in light / dark / purple / reduced,
// close-ups (heroes, minis, marks, «Планеты» — levels 1–12), and level-ups frame by frame in
// slow motion (light and dark): one level from the Earth, three levels, and the handover from
// level 4 to 5, where the destination slides down to become the next ground.
// Usage: node preview/rocket.shots.mjs [outDir] [baseUrl]; needs `npx vite --port 5236`.
// Exits non-zero on any console error or page error.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? '/tmp/claude-0/-home-user-DailyApp/3c4f2948-d57c-5f7a-83fb-a8af732ded9c/scratchpad/shots/themes/rocket';
const baseUrl = process.argv[3] ?? 'http://localhost:5236/preview/rocket.html';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const MODES = {
  light: '',
  dark: '?dark',
  purple: '?tg=purple',
  reduced: '?motion=reduced',
};
/** Slow motion: animations and page timers run this many times slower while frames are taken. */
const SLOW = 4;

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
  // Timers follow the slow motion too, so the choreography's fallbacks keep their proportion.
  await page.addInitScript(() => {
    const setTimeout = window.setTimeout;
    window.__slow = 1;
    window.setTimeout = (fn, ms, ...args) => setTimeout(fn, (ms || 0) * window.__slow, ...args);
  });
  const query = MODES[mode] + (extra ? (MODES[mode] ? '&' : '?') + extra : '');
  await page.goto(baseUrl + query);
  await page.locator('#levelup').waitFor();
  await page.waitForTimeout(600);
  return { page, context };
}

/** Frames every `every` ms of animation time from `from` ms on, taken in slow motion. */
async function levelUp(page, context, prefix, frames, every, from = 0) {
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
  await page.evaluate((slow) => (window.__slow = slow), SLOW);
  await page.click('#levelup');
  const t0 = Date.now();
  for (let n = 0; n < frames; n++) {
    const due = t0 + (from + n * every) * SLOW;
    const now = Date.now();
    if (due > now) await page.waitForTimeout(due - now);
    await stage.screenshot({ path: `${outDir}/${prefix}-${String(n).padStart(2, '0')}.png`, animations: 'allow' });
  }
  await page.waitForTimeout(1200 * SLOW);
  await stage.screenshot({ path: `${outDir}/${prefix}-end.png` });
}

for (const mode of Object.keys(MODES)) {
  const { page, context } = await open(mode);
  await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true });
  // Close-ups at the real size, for judging detail.
  for (const part of ['heroes', 'minis', 'marks', 'planets']) await page.locator(`#${part}`).screenshot({ path: `${outDir}/${mode}-${part}.png` });
  if (mode === 'light' || mode === 'dark') {
    // Earth → Moon, then the Moon becomes the ground of the flight to planet 2.
    await levelUp(page, context, `${mode}-levelup`, 12, 80);
    await context.close();
    const multi = await open(mode, 'levels=3');
    await levelUp(multi.page, multi.context, `${mode}-levelup3`, 8, 300);
    await multi.context.close();
    // Planet to planet: the destination of level 4 slides down to become the ground of level 5.
    const later = await open(mode, 'level=4');
    // The handover starts after the last stretch of flight and the touchdown (~440 ms).
    await levelUp(later.page, later.context, `${mode}-handover`, 10, 45, 390);
    await later.context.close();
  } else {
    await context.close();
  }
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok: ${outDir}`);
