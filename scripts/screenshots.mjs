// Walks through the app on a phone-sized viewport and saves screenshots of every screen.
// Usage: node scripts/screenshots.mjs [outDir] [baseUrl]
// Modes: DARK=1 (dark colour scheme), TG_THEME=purple (a purple Telegram theme with safe-area
// insets, as telegram-web-app.js would inject them). Requires a running server
// (`npm run preview` after `npm run build`, or `npm run dev`; the /styleguide capture needs the
// dev server, the route does not exist in production builds).
// Uses the Chromium that Playwright ships; PLAYWRIGHT_CHROMIUM overrides the executable path.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'screenshots';
const baseUrl = process.argv[3] ?? 'http://localhost:4173/';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const tgTheme = process.env.TG_THEME;
const dark = Boolean(process.env.DARK) || tgTheme === 'purple';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ru-RU',
  colorScheme: dark ? 'dark' : 'light',
});

if (tgTheme === 'purple') {
  // What telegram-web-app.js sets on <html> for a purple user theme on a phone with a notch.
  await context.addInitScript(() => {
    const vars = {
      '--tg-theme-button-color': '#8774e1',
      '--tg-theme-button-text-color': '#ffffff',
      '--tg-theme-bg-color': '#1e1b2e',
      '--tg-theme-secondary-bg-color': '#151321',
      '--tg-theme-section-bg-color': '#1e1b2e',
      '--tg-theme-text-color': '#f0eefb',
      '--tg-theme-hint-color': '#9b95b8',
      '--tg-theme-link-color': '#a597ff',
      '--tg-safe-area-inset-top': '54px',
      '--tg-content-safe-area-inset-top': '46px',
      '--tg-safe-area-inset-bottom': '34px',
    };
    const apply = () => {
      const root = document.documentElement;
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
      root.dataset.theme = 'dark';
    };
    if (document.documentElement) apply();
    else document.addEventListener('DOMContentLoaded', apply);
  });
}

const page = await context.newPage();
const errors = [];
// The styleguide's ErrorBoundary demo throws on purpose; React reports it to the console.
const expected = (text) => text.includes('ERR_FAILED') || text.includes('ErrorBoundary demo');
page.on('console', (m) => m.type() === 'error' && !expected(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => !expected(String(e)) && errors.push(String(e)));
page.on('dialog', (d) => d.accept());
// The Telegram script is not reachable offline; the app must work without it.
await page.route('https://telegram.org/**', (r) => r.abort());

let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${String(++n).padStart(2, '0')}-${name}.png` });
};
// Focusing an input scrolls it into view (300 ms delay + smooth scroll); let that settle so a
// form is not photographed mid-scroll.
const settled = () => page.waitForTimeout(800);
const tab = (name) => page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name });

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
await settled();
await shot('skill-form');
await page.getByRole('button', { name: 'Создать навык' }).click();
await page.getByText('Достичь C1').waitFor();
await shot('skill-empty');

await page.getByRole('button', { name: 'Добавить действие' }).click();
await page.getByText('Действий пока нет').waitFor();
await shot('add-action-empty');
await page.getByRole('button', { name: 'Создать новое действие' }).click();
await page.getByLabel('Название', { exact: true }).fill('Разговорная практика');
await page.getByLabel('Очки за выполнение').fill('5');
await settled();
await shot('step-form');
await page.getByRole('button', { name: 'Создать действие' }).click();
await page.getByText('Разговорная практика').waitFor();
await shot('add-action');

for (let i = 0; i < 9; i++) {
  if (i > 0) {
    await page.getByRole('button', { name: 'Добавить действие' }).click();
    await page.locator('.radio-row').first().click();
  }
  await page.getByRole('button', { name: 'Отметить выполненным' }).click();
  await page.getByRole('button', { name: 'Добавить действие' }).waitFor();
  if (i === 2) await shot('skill-progress');
}
await page.getByRole('button', { name: 'Завершить', exact: true }).waitFor();
await shot('skill-milestone');
await page.getByRole('button', { name: 'Завершить', exact: true }).click();
// Outside Telegram the confirmation is the in-app sheet.
const dialog = page.getByRole('dialog');
await dialog.waitFor();
await shot('confirm-sheet');
await dialog.getByRole('button', { name: 'Завершить' }).click();
await page.getByText(/Навык достигнут/).first().waitFor();
await shot('skill-completed');

await page.reload();
await page.getByText(/Навык достигнут/).first().waitFor();
await page.getByRole('button', { name: 'Назад' }).click();
await page.getByRole('tab', { name: 'Достигнутые' }).click();
await shot('skills-completed');

// A second skill whose single 25-point action fills flasks 1 (10) and 2 (15) at once:
// the toast must name both filled flasks.
await page.getByRole('link', { name: 'Новый навык' }).click();
await page.getByLabel('Название', { exact: true }).fill('Тренировки');
await page.getByLabel('Колб', { exact: true }).fill('5');
await page.getByLabel('Первая колба').fill('10');
await page.getByLabel('Прирост за уровень', { exact: true }).fill('5');
await page.getByRole('button', { name: 'Создать навык' }).click();
await page.getByRole('button', { name: 'Добавить действие' }).click();
await page.getByRole('button', { name: 'Создать новое действие' }).click();
await page.getByLabel('Название', { exact: true }).fill('Длинная тренировка');
await page.getByLabel('Очки за выполнение').fill('25');
await page.getByRole('button', { name: 'Создать действие' }).click();
await page.getByText('Длинная тренировка').waitFor();
await page.getByRole('button', { name: 'Отметить выполненным' }).click();
await page.getByText('Заполнено колб: 2, теперь колба 3').waitFor();
await shot('toast-flasks-filled');

// Edit form: the delete confirmation is a danger sheet; cancel it.
await page.getByRole('link', { name: 'Изм.' }).click();
await page.getByRole('button', { name: 'Удалить навык' }).click();
await dialog.waitFor();
await shot('confirm-delete-sheet');
// A double tap on «Отмена» must close the sheet once and keep the edit form (one history pop).
await dialog.getByRole('button', { name: 'Отмена' }).dblclick();
await dialog.waitFor({ state: 'detached' });
await page.waitForTimeout(300);
if (!/#\/skills\/[^/]+\/edit$/.test(page.url())) errors.push(`double tap on «Отмена» left the edit form: ${page.url()}`);
await page.getByRole('button', { name: 'Удалить навык' }).waitFor();
await page.getByRole('button', { name: 'Назад' }).click();

// Root tabs: the bar is only on the four root routes; legacy paths redirect.
await page.getByRole('button', { name: 'Назад' }).click();
await page.getByRole('navigation', { name: 'Разделы' }).waitFor();
for (const name of ['Сегодня', 'Ачивки', 'Настройки']) {
  await tab(name).click();
  await page.waitForTimeout(200);
  await shot(`tab-${name}`);
}
await page.goto(`${baseUrl}#/todo`);
await page.waitForURL(/#\/today$/);
await page.goto(`${baseUrl}#/account`);
await page.waitForURL(/#\/settings$/);
await page.goto(`${baseUrl}#/skills/nope/edit`);
await page.getByText('Навык не найден').waitFor();
if (await page.getByRole('navigation', { name: 'Разделы' }).count()) errors.push('tab bar rendered on a nested route');

// Styleguide (dev server only): every component state on one page.
await page.goto(`${baseUrl}#/styleguide`);
await page.waitForTimeout(600);
if (await page.locator('[data-screen="styleguide"]').count()) {
  await shot('styleguide-top');
  await page.getByRole('button', { name: 'Масштаб 100 %' }).click();
  await page.getByText('t-caption').scrollIntoViewIfNeeded();
  await shot('styleguide-type-130');
  // Chromium hit-tests below a `zoom`-ed block against un-zoomed geometry; switch the demo off.
  await page.getByRole('button', { name: 'Масштаб 130 %' }).click();
  await page.getByRole('button', { name: 'Лист', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shot('styleguide-sheet');
  await page.locator('.sheet-scrim').click({ position: { x: 20, y: 20 } });
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Контекстный лист' }).click();
  await page.getByRole('dialog').waitFor();
  await shot('styleguide-context-sheet');
  await page.getByRole('dialog').getByRole('button', { name: 'Изменить' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Тост с действием' }).click();
  await shot('styleguide-toast-action');
  await page.getByText('Скелетоны').scrollIntoViewIfNeeded();
  await shot('styleguide-skeletons');
  await page.getByText('Пустые состояния').scrollIntoViewIfNeeded();
  await shot('styleguide-empty-states');
  await page.getByText('Иконки').scrollIntoViewIfNeeded();
  await shot('styleguide-icons');
  await page.getByRole('button', { name: 'Сломать экран' }).click();
  await page.getByText('Что-то пошло не так').waitFor();
  await shot('styleguide-error-boundary');
} else {
  console.log('styleguide: skipped (DEV-only route; run against `npm run dev` to capture it)');
}

await browser.close();
if (errors.length) {
  console.error('Console errors:', errors);
  process.exit(1);
}
console.log(`${n} screenshots saved to ${outDir}/`);
