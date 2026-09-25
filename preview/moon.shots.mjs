// Screenshots of the «Луна» preview: node preview/moon.shots.mjs [outDir] [baseUrl] [--static]
// Needs the dev server (npx vite --port 5239). Exits non-zero on any console or page error.
// Captures, in light, dark and purple: the twelve months, the sky at levels 1…100 and the special
// moons; level-ups as contact sheets (screencast frames every 80 ms: the star's flight, the season
// turning);
// a three-level write; the reduced-motion page. --static skips the level-ups.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const onlyStatic = process.argv.includes('--static');
const outDir = args[0] ?? '/tmp/claude-0/-home-user-DailyApp/3c4f2948-d57c-5f7a-83fb-a8af732ded9c/scratchpad/shots/themes/moon';
const baseUrl = args[1] ?? 'http://localhost:5239/preview/moon.html';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const MODES = {
  light: { query: '', scheme: 'light' },
  dark: { query: '?dark', scheme: 'dark' },
  purple: { query: '?tg=purple', scheme: 'dark' },
  reduced: { query: '?motion=reduced', scheme: 'light' },
};

const errors = [];
const browser = await chromium.launch({ executablePath });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(mode, extra = '') {
  const { query, scheme } = MODES[mode];
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    colorScheme: scheme,
  });
  await context.route('https://telegram.org/**', (route) => route.abort());
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${mode}] console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[${mode}] pageerror: ${err.message}`));
  const url = baseUrl + (query ? query + (extra ? `&${extra}` : '') : extra ? `?${extra}` : '');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#levelup');
  await sleep(300);
  return { context, page };
}

/** Lays the frames out in a grid with their times and saves one PNG. */
async function sheet(name, frames, cols, width = 164) {
  const page = await browser.newPage({ viewport: { width: (width + 8) * cols + 8, height: 400 }, deviceScaleFactor: 1 });
  const cells = frames
    .map(({ png, label }) => `<figure><img src="data:image/png;base64,${png.toString('base64')}"><figcaption>${label}</figcaption></figure>`)
    .join('');
  await page.setContent(
    `<style>body{margin:0;background:#888;font:12px system-ui;display:grid;grid-template-columns:repeat(${cols},auto);gap:4px;padding:4px;width:max-content}figure{margin:0}img{display:block;width:${width}px}figcaption{text-align:center;color:#fff}</style>${cells}`,
  );
  await page.locator('body').screenshot({ path: `${outDir}/${name}.png` });
  await page.close();
}

/**
 * Clicks #levelup and records the screen (CDP screencast, every compositor frame) for `ms`, then
 * lays out the #stage part of the frames closest to every `every` ms from the click.
 */
async function levelUp(page, name, ms = 1300, every = 80, cols = 9) {
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  await sleep(300);
  const box = await stage.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp * 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(200);
  const clickAt = await page.evaluate(() => new Promise((resolve) => {
    document.getElementById('levelup').click();
    resolve(performance.timeOrigin + performance.now());
  }));
  await sleep(ms + 150);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const picked = [];
  for (let at = 0; at <= ms; at += every) {
    let best = null;
    for (const f of frames) if (f.t - clickAt <= at + 8 && (!best || f.t > best.t)) best = f;
    if (best) picked.push({ ...best, label: `${Math.round(best.t - clickAt)} ms` });
  }
  const viewport = page.viewportSize();
  const sheetPage = await browser.newPage({ viewport: { width: (box.width + 8) * cols + 8, height: 400 }, deviceScaleFactor: 2 });
  const cells = picked
    .map(({ data, label }) => `<figure><div style="width:${box.width}px;height:${box.height}px;background:url(data:image/png;base64,${data}) -${box.x}px -${box.y}px / ${viewport.width}px ${viewport.height}px no-repeat"></div><figcaption>${label}</figcaption></figure>`)
    .join('');
  await sheetPage.setContent(`<style>body{margin:0;background:#888;font:11px system-ui;display:grid;grid-template-columns:repeat(${cols},auto);gap:4px;padding:4px;width:max-content}figure{margin:0}figcaption{text-align:center;color:#fff}</style>${cells}`);
  await sheetPage.locator('body').screenshot({ path: `${outDir}/${name}.png` });
  await sheetPage.close();
}

for (const mode of Object.keys(MODES)) {
  const { context, page } = await open(mode);
  if (mode === 'reduced') {
    await page.screenshot({ path: `${outDir}/${mode}-page.png`, fullPage: true });
  } else {
    // Each hero at 2× with its caption, laid out as a sheet (a section screenshot is too tall to read).
    for (const part of ['months', 'sky', 'special']) {
      const boxes = await page.$$eval(`#${part} > div > div`, (cells) =>
        cells.map((cell) => {
          const r = cell.querySelector('.moon--hero').getBoundingClientRect();
          return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, label: cell.lastElementChild.textContent };
        }),
      );
      const frames = [];
      for (const { label, ...clip } of boxes) frames.push({ png: await page.screenshot({ fullPage: true, clip, animations: 'disabled' }), label });
      await sheet(`${mode}-${part}`, frames, part === 'months' ? 6 : frames.length, 280);
    }
  }
  if (!onlyStatic) {
    // From the Wolf Moon into the Snow Moon: the first star flies up, January turns to February.
    await levelUp(page, `${mode}-levelup`);
    await context.close();
    if (mode === 'light' || mode === 'dark') {
      // Level 7 → 8: the seventh star completes the Big Dipper; July turns to August.
      const seventh = await open(mode, 'level=7');
      await levelUp(seventh.page, `${mode}-levelup-constellation`);
      await seventh.context.close();
      // Three levels in one write (8 → 11), the supermoon of level 9 passing by.
      const multi = await open(mode, 'level=8&levels=3');
      await levelUp(multi.page, `${mode}-levelup3`, 2100, 120);
      await multi.context.close();
    }
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
