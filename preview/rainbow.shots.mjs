// Screenshots of the «Радуга» preview page: node preview/rainbow.shots.mjs [outDir] [baseUrl]
// Needs `npx vite --port 5221` running in the repo. Exits non-zero on any console or page error,
// a mark caption cut short at 390 px or running into the numbers column (390 and 320 px), or a
// pennant outside x 2..158 of the viewBox.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'shots/rainbow';
const baseUrl = process.argv[3] ?? 'http://localhost:5221/preview/rainbow.html';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const MODES = { light: '', dark: '?dark', purple: '?tg=purple', reduced: '?motion=reduced' };
const errors = [];
const browser = await chromium.launch({ executablePath });

async function open(mode, extra = '', width = 390) {
  const dark = mode === 'dark' || mode === 'purple';
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${mode}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${mode}: ${e}`));
  await page.route('https://telegram.org/**', (r) => r.abort());
  const query = MODES[mode] + (extra ? (MODES[mode] ? '&' : '?') + extra : '');
  await page.goto(baseUrl + query, { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor();
  await page.waitForTimeout(300);
  return { ctx, page };
}

/**
 * The marks row as on the skill screen: every pennant stays within x 2..158 of the viewBox, no
 * caption runs into the numbers column, and at 390 px (`whole`) no caption is cut short.
 */
async function checkMarks(page, tag, whole) {
  const found = await page.evaluate(() => {
    const svg = document.querySelector('#marks .rainbow-svg');
    const toBox = svg.getScreenCTM().inverse();
    const numbers = document.querySelector('#marks .hero-info').getBoundingClientRect().left;
    const marks = [...svg.querySelectorAll('.rainbow-mark')].map((g) => {
      const r = g.getBoundingClientRect();
      return [new DOMPoint(r.left, r.top).matrixTransform(toBox).x, new DOMPoint(r.right, r.top).matrixTransform(toBox).x];
    });
    const captions = [...document.querySelectorAll('#marks .rainbow-mark-caption')].map((b) => ({
      text: b.textContent,
      scroll: b.scrollWidth,
      client: b.clientWidth,
      right: b.getBoundingClientRect().left + Math.min(b.scrollWidth, b.clientWidth),
    }));
    return { marks, captions, numbers };
  });
  found.marks.forEach(([min, max], i) => {
    if (min < 1.95 || max > 158.05) errors.push(`${tag}: mark ${i} spans x ${min.toFixed(1)}..${max.toFixed(1)} of the viewBox`);
  });
  for (const c of found.captions) {
    if (whole && c.scroll > c.client) errors.push(`${tag}: caption «${c.text}» is cut (${c.scroll} > ${c.client} px)`);
    if (c.right > found.numbers) errors.push(`${tag}: caption «${c.text}» runs into the numbers (${c.right.toFixed(1)} > ${found.numbers.toFixed(1)})`);
  }
  console.log(tag, found.captions.map((c) => `${c.text} ${c.scroll}/${c.client}`).join(', '));
}

/** Clicks #levelup and captures #stage `count` times, `every` ms apart (real time). */
async function film(page, name, count, every) {
  const stage = page.locator('#stage');
  await page.click('#levelup');
  const t0 = Date.now();
  const times = [];
  for (let i = 0; i < count; i++) {
    const due = t0 + i * every;
    const now = Date.now();
    if (due > now) await page.waitForTimeout(due - now);
    times.push(Date.now() - t0);
    await stage.screenshot({ path: `${outDir}/${name}-${String(i).padStart(2, '0')}.png`, animations: 'allow' });
  }
  console.log(name, times.join(' '));
}

for (const mode of Object.keys(MODES)) {
  const { ctx, page } = await open(mode);
  await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true });
  await page.locator('#marks').screenshot({ path: `${outDir}/${mode}-marks.png` });
  await checkMarks(page, `${mode} 390`, true);
  if (mode === 'light' || mode === 'purple') {
    const narrow = await open(mode, '', 320);
    await narrow.page.locator('#marks').screenshot({ path: `${outDir}/${mode}-marks-320.png` });
    await checkMarks(narrow.page, `${mode} 320`, false);
    await narrow.ctx.close();
  }
  if (mode === 'light' || mode === 'dark') {
    await film(page, `${mode}-levelup`, 11, 150);
    // After the beat the stage follows its fill prop again.
    await page.waitForTimeout(200);
    await page.click('#bump');
    await page.waitForTimeout(900);
    await page.locator('#stage').screenshot({ path: `${outDir}/${mode}-after-levelup-60.png` });
    const label = await page.locator('#stage svg').getAttribute('aria-label');
    if (label !== 'Радуга раскрашена на 60%') errors.push(`${mode}: after the level-up the stage reads «${label}»`);
    const three = await open(mode, 'levels=3');
    await film(three.page, `${mode}-levelup3`, 6, 360);
    await three.ctx.close();
  }
  if (mode === 'reduced') await film(page, 'reduced-levelup', 3, 150);
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
