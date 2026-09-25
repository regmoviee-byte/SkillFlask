// Screenshots of the «Мяч в корзину» preview: node preview/ball.shots.mjs (Vite on :5240, or BASE=…).
// Full pages in light / dark / purple / reduced; the pile of past levels («Мячи») in light, dark
// and purple; level-up frames in light and dark plus freeze-frames of its beats (the jump, the
// landing, the ball rolling into the pile); a three-level run; six frames of the idle player a
// second apart; marks over the board; and a write during the level-up (?after). Exits non-zero on
// any console error, page error or a stage that does not end on the new level.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:5240/preview/ball.html';
const OUT = process.env.OUT ?? '/tmp/claude-0/-home-user-DailyApp/3c4f2948-d57c-5f7a-83fb-a8af732ded9c/scratchpad/shots/themes/ball';
mkdirSync(OUT, { recursive: true });

const MODES = { light: '', dark: '?dark', purple: '?tg=purple', reduced: '?motion=reduced' };
/** ms after the click: the rise, the jump, the landing, the new ball and the roll, the ball in the pile. */
const BEATS = [250, 560, 660, 800, 950, 1300];
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

async function open(query, scale = 2) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${query}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${query}: ${String(e)}`));
  await page.route('https://telegram.org/**', (r) => r.abort());
  await page.goto(BASE + query, { waitUntil: 'networkidle' });
  await page.waitForSelector('#levelup');
  await sleep(300);
  return { ctx, page };
}

async function frames(page, prefix, count, every) {
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  await sleep(200);
  await page.click('#levelup');
  for (let n = 0; n < count; n++) {
    const t = Date.now();
    await stage.screenshot({ path: `${OUT}/${prefix}-${pad(n)}.png`, animations: 'allow' });
    await sleep(Math.max(0, every - (Date.now() - t)));
  }
}

/** The stage `t` ms into a level-up, frozen: the running values baked into a clone. */
async function freeze(query, name, t) {
  const { ctx, page } = await open(query, 3);
  await page.locator('#stage').scrollIntoViewIfNeeded();
  await sleep(200);
  await page.evaluate(
    (t) =>
      new Promise((resolve) => {
        const stage = document.querySelector('#stage');
        const t0 = performance.now();
        document.querySelector('#levelup').click();
        const tick = () => {
          if (performance.now() - t0 < t) return requestAnimationFrame(tick);
          const clone = stage.cloneNode(true);
          const dst = [clone, ...clone.querySelectorAll('*')];
          [stage, ...stage.querySelectorAll('*')].forEach((el, i) => {
            const cs = getComputedStyle(el);
            Object.assign(dst[i].style, { transform: cs.transform, opacity: cs.opacity, strokeDashoffset: cs.strokeDashoffset, animation: 'none' });
          });
          const r = stage.getBoundingClientRect();
          Object.assign(clone.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, margin: 0, background: getComputedStyle(stage.parentElement).backgroundColor });
          clone.id = 'frozen';
          document.body.append(clone);
          resolve();
        };
        requestAnimationFrame(tick);
      }),
    t,
  );
  await page.locator('#frozen').screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
}

/** The stage's pile and jersey after the level-up: the new level, exactly. */
async function expectLevel(page, query, level) {
  const [balls, jersey] = await page.locator('#stage').evaluate((el) => [el.querySelectorAll('[data-i]').length, el.querySelector('.ball-jersey-no')?.textContent]);
  if (balls !== level - 1 || jersey !== String(level)) errors.push(`${query}: the stage shows ${balls} balls and jersey ${jersey}, not level ${level}`);
}

for (const [mode, query] of Object.entries(MODES)) {
  const { ctx, page } = await open(query);
  await page.screenshot({ path: `${OUT}/${mode}-page.png`, fullPage: true });
  if (mode !== 'reduced') await page.locator('#balls').screenshot({ path: `${OUT}/${mode}-balls.png` });
  if (mode === 'light' || mode === 'dark') {
    await frames(page, `${mode}-levelup`, 12, 80);
    await sleep(600);
    await expectLevel(page, query, 5);
    await ctx.close();
    for (const t of BEATS) await freeze(query, `${mode}-beat-${String(t).padStart(4, '0')}`, t);
    const multi = await open(`${query ? `${query}&` : '?'}levels=3`);
    await frames(multi.page, `${mode}-levels3`, 8, 400);
    await sleep(600);
    await expectLevel(multi.page, 'levels=3', 7);
    await multi.ctx.close();
  } else {
    // Reduced motion: a short crossfade to the new fill, no choreography.
    if (mode === 'reduced') {
      await frames(page, `${mode}-levelup`, 3, 150);
      await sleep(400);
      await expectLevel(page, query, 5);
    }
    await ctx.close();
  }
}
// The idle player: a breath, a double knee bounce, a look about, a blink; six frames a second apart.
{
  const { ctx, page } = await open('', 3);
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  const clip = { x: box.x, y: box.y + box.height * 0.55, width: box.width * 0.62, height: box.height * 0.45 };
  for (let n = 0; n < 6; n++) {
    const t = Date.now();
    await page.screenshot({ path: `${OUT}/idle-${pad(n)}.png`, clip, animations: 'allow' });
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  await ctx.close();
}
// Marks over the board (the flight's last quarter), and a write that lands during the beat.
for (const [name, query] of Object.entries({ 'marks-high': '?marks=0.9,0.95,0.99', 'marks-end-purple': '?tg=purple&marks=0.5,0.9,1', 'marks-four-dark': '?dark&marks=0.7,0.76,0.8,0.84', 'marks-low': '?marks=0,0.02,0.04,0.06' })) {
  const { ctx, page } = await open(query);
  await page.locator('#marks').screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
}
const after = await open('?after=0.35');
await frames(after.page, 'after-levelup', 10, 150);
await sleep(600);
const label = await after.page.locator('#stage [role="img"]').getAttribute('aria-label');
if (!label.includes('35%')) errors.push(`after=0.35: the stage reads «${label}»`);
await after.ctx.close();
await browser.close();

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok: ${OUT}`);
