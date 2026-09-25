// Renders the PNG icons of the web app manifest from public/favicon.svg (run once after the
// favicon changes; the PNGs are committed): 192 and 512 as the favicon draws itself (rounded
// square), a maskable 512 (full-bleed background, the flask inside the 80 % safe circle) and
// the 180 px apple-touch-icon (iOS rounds the corners itself and shows transparency as black).
// Usage: node scripts/make-icons.mjs   (uses playwright-core's Chromium, like the screenshots)

import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const favicon = readFileSync('public/favicon.svg', 'utf8');
const background = favicon.match(/<rect[^>]*fill="([^"]+)"/)?.[1] ?? '#2481cc';
const glyph = (favicon.match(/<path[^>]*\/>/g) ?? []).join('');
if (!glyph) throw new Error('public/favicon.svg: no <path> to draw');

/** The flask on a full square, scaled around the centre of the 64-unit canvas. */
const fullBleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/>` +
  `<g transform="translate(32 32) scale(${scale}) translate(-32 -32.75)">${glyph}</g></svg>`;

const icons = [
  { file: 'icon-192.png', size: 192, svg: favicon },
  { file: 'icon-512.png', size: 512, svg: favicon },
  { file: 'icon-maskable-512.png', size: 512, svg: fullBleed(0.72) },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(0.86) },
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
for (const { file, size, svg } of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`public/icons/${file} (${size}×${size})`);
}
await browser.close();
