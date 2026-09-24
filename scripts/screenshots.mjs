// Walks through the app on a phone-sized viewport and saves screenshots of every screen.
// Usage: node scripts/screenshots.mjs [outDir] [baseUrl]
// Requires a running server (`npm run preview` after `npm run build`, or `npm run dev`).
// Uses the Chromium that Playwright ships; PLAYWRIGHT_CHROMIUM overrides the executable path.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'screenshots';
const baseUrl = process.argv[3] ?? 'http://localhost:4173/';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ru-RU',
  colorScheme: process.env.DARK ? 'dark' : 'light',
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_FAILED') && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
// The Telegram script is not reachable offline; the app must work without it.
await page.route('https://telegram.org/**', (r) => r.abort());

let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${String(++n).padStart(2, '0')}-${name}.png` });
};

await page.goto(baseUrl);
await page.getByText('Здесь будут ваши навыки').waitFor();
await shot('skills-empty');

await page.getByRole('link', { name: 'Создать навык' }).click();
await page.getByLabel('Название', { exact: true }).fill('Английский');
await page.getByLabel('Сейчас').fill('B1');
await page.getByLabel('Цель').fill('C1');
await page.getByLabel('Колб', { exact: true }).fill('3');
await page.getByLabel('Первая колба').fill('10');
await page.getByLabel('Прирост за уровень', { exact: true }).fill('5');
await shot('skill-form');
await page.getByRole('button', { name: 'Создать навык' }).click();
await page.getByText('Достичь C1').waitFor();
await shot('skill-empty');

await page.getByRole('link', { name: 'Добавить действие' }).click();
await page.getByRole('link', { name: 'Создать новое действие' }).click();
await page.getByLabel('Название', { exact: true }).fill('Разговорная практика');
await page.getByLabel('Количество баллов').fill('5');
await shot('step-form');
await page.getByRole('button', { name: 'Создать действие' }).click();
await page.getByText('Разговорная практика').waitFor();
await shot('add-action');

for (let i = 0; i < 9; i++) {
  if (i > 0) {
    await page.getByRole('link', { name: 'Добавить действие' }).click();
    await page.locator('.radio-row').first().click();
  }
  await page.getByRole('button', { name: 'Отметить выполненным' }).click();
  await page.getByRole('link', { name: 'Добавить действие' }).waitFor();
  if (i === 2) await shot('skill-progress');
}
await page.getByRole('button', { name: 'Завершить', exact: true }).waitFor();
await shot('skill-milestone');
await page.getByRole('button', { name: 'Завершить', exact: true }).click();
await page.getByText(/Навык достигнут/).first().waitFor();
await shot('skill-completed');

await page.reload();
await page.getByText(/Навык достигнут/).first().waitFor();
await page.getByRole('link', { name: 'Навыки' }).click();
await page.getByRole('tab', { name: 'Достигнутые' }).click();
await shot('skills-completed');

for (const tab of ['Ачивки', 'Список дел', 'Аккаунт']) {
  await page.getByRole('link', { name: tab }).click();
  await page.waitForTimeout(200);
  await shot(`tab-${tab}`);
}

await browser.close();
if (errors.length) {
  console.error('Console errors:', errors);
  process.exit(1);
}
console.log(`${n} screenshots saved to ${outDir}/`);
