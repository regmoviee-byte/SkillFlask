// Screenshots of the chick theme preview: the whole page in light / dark / purple / reduced
// modes, the yard («Двор») in light, dark and purple, level-ups as contact sheets (the grown hen
// hops out and walks into the yard, one of them into the far flock, and a 3-level one), and six
// frames of the stage one second apart with the hens strolling.
// Usage: node preview/chick.shots.mjs [outDir] [baseUrl]   (requires `npx vite --port 5237`)
// Exits non-zero on any console error or page error.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'screenshots/themes/chick';
const baseUrl = process.argv[3] ?? 'http://localhost:5237';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const MODES = {
  light: '',
  dark: 'dark',
  purple: 'tg=purple',
  reduced: 'motion=reduced',
};
const isDark = (mode) => mode === 'dark' || mode === 'purple';

const errors = [];
const browser = await chromium.launch({ executablePath });

async function open(mode, extra = '', { width = 390, scale = 2 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: scale,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    colorScheme: isDark(mode) ? 'dark' : 'light',
    reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${mode}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${mode}] ${String(e)}`));
  await page.route('https://telegram.org/**', (r) => r.abort());
  const query = [MODES[mode], extra].filter(Boolean).join('&');
  await page.goto(`${baseUrl}/preview/chick.html${query ? `?${query}` : ''}`);
  await page.locator('#stage svg[role="img"]').waitFor();
  await page.waitForTimeout(600);
  return { page, context };
}

for (const mode of Object.keys(MODES)) {
  const { page, context } = await open(mode);
  await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true });
  if (mode === 'reduced') {
    // Reduced motion: the hens stand still (no running stroll), in varied poses.
    const running = await page.evaluate(() => [...document.querySelectorAll('.chick-yard *')].filter((el) => getComputedStyle(el).animationName !== 'none').length);
    if (running) errors.push(`[reduced] ${running} yard elements still animate`);
  }
  await context.close();
}

// The yard at levels 1, 2, 5, 12, 30, 60 (close-ups at 3×).
for (const mode of ['light', 'dark', 'purple']) {
  const { page, context } = await open(mode, '', { scale: 3 });
  await page.locator('#yard').screenshot({ path: `${outDir}/${mode}-yard.png` });
  await context.close();
}

// A 12-character caption («Пробный тест») shows in full, and neighbouring caption buttons
// never overlap, on a 390 px phone and on a narrow 360 px one.
for (const width of [390, 360]) {
  const { page, context } = await open('light', '', { width });
  const captions = await page.locator('.chick-mark-caption').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, need: el.scrollWidth, clipped: el.scrollWidth > el.clientWidth, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }),
  );
  const full = captions.filter((c) => c.text === 'Пробный тест');
  if (!full.length || full.some((c) => c.clipped)) errors.push(`[${width}px] «Пробный тест» is clipped: ${JSON.stringify(full)}`);
  for (const a of captions) {
    for (const b of captions) {
      if (a !== b && Math.abs(a.left - b.left) < 1 && a.top < b.top && a.bottom > b.top + 0.5) errors.push(`[${width}px] captions overlap: ${a.text} / ${b.text}`);
    }
  }
  const view = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  if (view.scroll > view.width) errors.push(`[${width}px] the page scrolls sideways: ${view.scroll} > ${view.width}`);
  console.log(`${width}px captions: ${captions.map((c) => `${c.text} ${Math.round(c.right - c.left)}/${c.need}px${c.clipped ? ' clipped' : ''}`).join(', ')}`);
  await context.close();
}

/**
 * Clicks «Level up» and records the stage with a screencast (every painted frame), then lays
 * frames `step` ms apart into a contact sheet `<name>-sheet.png`; the settled end state goes to
 * `<name>-end.png`. Returns the time from the click to «готов».
 */
async function levelUp(mode, extra, name, step, span) {
  const { page, context } = await open(mode, extra);
  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ t: f.metadata.timestamp * 1000, data: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await page.evaluate(() => {
    document.getElementById('levelup').addEventListener('click', () => (window.__clicked = Date.now()), { capture: true });
    const hint = document.querySelector('#stage + div .hint');
    new MutationObserver(() => {
      if (window.__clicked && !window.__done && hint.textContent.startsWith('готов')) window.__done = Date.now();
    }).observe(hint, { childList: true, subtree: true, characterData: true });
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.waitForTimeout(300);
  await page.locator('#levelup').click();
  await page.waitForFunction(() => window.__done, null, { timeout: 10_000 });
  await page.waitForTimeout(250);
  await cdp.send('Page.stopScreencast');
  const { clicked, done } = await page.evaluate(() => ({ clicked: window.__clicked, done: window.__done }));
  const picks = [];
  for (let t = 0; t <= span; t += step) {
    let best = null;
    for (const f of frames) if (f.t <= clicked + t + 8 && (!best || f.t > best.t)) best = f;
    if (best) picks.push({ t, data: best.data });
  }
  await stage.screenshot({ path: `${outDir}/${name}-end.png` });
  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1200, height: 600 });
  const cells = picks
    .map((p) => `<figure><div style="width:${box.width}px;height:${box.height}px;background:url(data:image/png;base64,${p.data}) -${box.x}px -${box.y}px / 390px auto no-repeat"></div><figcaption>${p.t} ms</figcaption></figure>`)
    .join('');
  await sheet.setContent(`<body style="margin:0;display:flex;flex-wrap:wrap;background:${isDark(mode) ? '#1c1c1e' : '#fff'};color:#888;font:11px sans-serif">${cells.replaceAll('<figure>', '<figure style="margin:3px">')}</body>`);
  await sheet.screenshot({ path: `${outDir}/${name}-sheet.png`, fullPage: true });
  await context.close();
  console.log(`${name}: ${frames.length} frames, ${picks.length} in the sheet, «готов» after ${done - clicked} ms`);
  return done - clicked;
}

// One level: the hen of level 4 hops out and walks into the yard (light, dark, purple).
for (const mode of ['light', 'dark', 'purple']) {
  const ms = await levelUp(mode, '', `${mode}-levelup`, 50, 1250);
  if (ms > 1400) errors.push(`[${mode}] one level-up took ${ms} ms`);
}
// The 27th hen walks back into the still flock by the fence.
await levelUp('light', 'level=27', 'light-levelup-flock', 50, 1250);
// Three levels: three hens join, then the new egg.
await levelUp('light', 'levels=3', 'light-levelup3', 100, 3000);
// Reduced motion: a short crossfade, the new hen already in the yard.
await levelUp('reduced', '', 'reduced-levelup', 40, 400);

// Six frames of the stage one second apart after a level-up (level 12 → 13): the hens stroll.
for (const mode of ['light', 'dark']) {
  const { page, context } = await open(mode, 'level=12', { scale: 3 });
  await page.locator('#levelup').click();
  await page.getByText('готов').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const hero = page.locator('#stage .chick--hero');
  const started = Date.now();
  for (let i = 0; i < 6; i++) {
    const due = started + i * 1000 - Date.now();
    if (due > 0) await page.waitForTimeout(due);
    await hero.screenshot({ path: `${outDir}/${mode}-wander-${i}.png`, animations: 'allow' });
  }
  await context.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok: ${outDir}`);
