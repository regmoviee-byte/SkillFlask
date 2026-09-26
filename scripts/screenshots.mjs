// Walks through the app on a phone-sized viewport and saves screenshots of every screen.
// Usage: node scripts/screenshots.mjs [outDir] [baseUrl]
// Modes: DARK=1 (dark colour scheme), SHIFT_DAYS=n (the browsers' clock runs n days ahead; 1 by
// default on a Monday, so «Сегодня» always has a past day of the week to pick), TG_THEME=purple (a purple Telegram theme with safe-area
// insets, as telegram-web-app.js would inject them). Requires a running server
// (`npm run preview` after `npm run build`, or `npm run dev`; the /styleguide capture needs the
// dev server, the route does not exist in production builds).
// Uses the Chromium that Playwright ships; PLAYWRIGHT_CHROMIUM overrides the executable path.
// The last part runs the app inside a fake Telegram (Bot API 7.10 with CloudStorage kept in
// localStorage and the native buttons drawn as a bar) to walk the cloud backup and the
// restore offer; the backup file downloaded in the browser part seeds its cloud. A second
// fake at Bot API 8.0 is launched with `startapp=skill_<id>` (deep link), offers the
// home-screen shortcut and forces the opposite «Тема» inside the Telegram theme.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'screenshots';
const baseUrl = process.argv[3] ?? 'http://localhost:4173/';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const tgTheme = process.env.TG_THEME;
const dark = Boolean(process.env.DARK) || tgTheme === 'purple';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath });
const contextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ru-RU',
  colorScheme: dark ? 'dark' : 'light',
  acceptDownloads: true,
};
const context = await browser.newContext(contextOptions);

/** TG_THEME=purple: what telegram-web-app.js sets on <html> for a purple user theme on a phone with a notch. */
async function applyTheme(ctx) {
  if (tgTheme !== 'purple') return;
  await ctx.addInitScript(() => {
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
      // A forced «Тема» (data-appearance, set by the app's boot script) wins over the theme.
      if (!root.dataset.appearance) root.dataset.theme = 'dark';
    };
    if (document.documentElement) apply();
    else document.addEventListener('DOMContentLoaded', apply);
  });
}

/** SHIFT_DAYS: every context's clock starts `shiftDays` ahead of the real one and then runs on. */
const shiftDays = process.env.SHIFT_DAYS !== undefined ? Number(process.env.SHIFT_DAYS) : new Date().getDay() === 1 ? 1 : 0;
async function setupContext(ctx) {
  if (shiftDays) {
    await ctx.clock.install({ time: Date.now() + shiftDays * 86_400_000 });
    await ctx.clock.resume();
  }
  await applyTheme(ctx);
}

const errors = [];
// The styleguide's ErrorBoundary demo throws on purpose; React reports it to the console.
const expected = (text) => text.includes('ERR_FAILED') || text.includes('ErrorBoundary demo');
async function openPage(ctx) {
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && !expected(m.text()) && errors.push(m.text()));
  p.on('pageerror', (e) => !expected(String(e)) && errors.push(String(e)));
  p.on('dialog', (d) => d.accept());
  // The Telegram script is not reachable offline; the app must work without it.
  await p.route('https://telegram.org/**', (r) => r.abort());
  return p;
}
await setupContext(context);

let page = await openPage(context);

let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${String(++n).padStart(2, '0')}-${name}.png` });
};
// Focusing an input scrolls it into view (300 ms delay + smooth scroll); let that settle so a
// form is not photographed mid-scroll.
const settled = () => page.waitForTimeout(800);
const tab = (name) => page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name });
// The home filter: toggle buttons in a group, the segment kept in the URL.
const filterGroup = () => page.getByRole('group', { name: 'Какие навыки показать' });
// The level-up card; an achievement card shares its place and motion (.top-card.ach-card).
const levelCard = { waitFor: (o) => page.locator('.top-card:not(.ach-card)').waitFor(o), click: () => page.locator('.top-card:not(.ach-card)').click() };
const achCard = (text) => page.locator('.ach-card', { hasText: text });
const segment = (name) => filterGroup().getByRole('button', { name, exact: true });
// The skill's ⋯ menu (a context sheet): «Изменить навык», «Добавить засечку».
const skillMenu = async (item) => {
  await page.getByRole('button', { name: 'Меню навыка' }).click();
  const menu = page.locator('.sheet', { has: page.getByRole('button', { name: 'Добавить засечку' }) });
  await menu.getByRole('button', { name: item }).click();
  await menu.waitFor({ state: 'detached' });
};
const markSheet = page.locator('.mark-sheet');
// The chooser's first card: the empty form (package 16).
const customCard = () => page.getByRole('list', { name: 'Шаблоны навыков' }).getByRole('link', { name: /^Свой навык/ });

// `/` opens the skills while there is no action to tap, «Сегодня» afterwards.
await page.goto(baseUrl);
await page.getByText('Первый навык').waitFor();
if (!/#\/skills$/.test(page.url())) errors.push(`an empty start did not open the skills: ${page.url()}`);
await shot('skills-empty');
await tab('Сегодня').click();
await page.getByText('Начните с навыка').waitFor();
await shot('today-empty');
await tab('Навыки').click();

// The first run leads to the templates (package 16): «Все шаблоны» opens the chooser, whose
// first card «Свой навык» is the empty form (the template walk has its own context below).
await page.getByRole('link', { name: 'Все шаблоны' }).click();
await customCard().click();
await page.getByLabel('Название', { exact: true }).fill('Английский');
await page.getByLabel('Сейчас').fill('B1');
await page.getByLabel('Цель').fill('C1');
await settled();
await shot('skill-form');
// Milestone and capacities sit in the «Дополнительно» disclosure.
await page.getByText('Дополнительно').click();
await page.getByLabel('Колб', { exact: true }).fill('3');
await page.getByLabel('Первый уровень', { exact: true }).fill('10');
await page.getByLabel('Прирост за уровень', { exact: true }).fill('5');
await settled();
await shot('skill-form-advanced');
await page.getByRole('button', { name: 'Создать навык' }).click();
await page.getByText('Достичь C1').waitFor();
await shot('skill-empty');
// «Сегодня» with a skill but no action yet: one button per skill, back to it.
await page.goto(`${baseUrl}#/today`);
await page.getByText('Добавьте первое действие').waitFor();
await shot('today-no-actions');
await page.getByRole('link', { name: 'К навыку «Английский»' }).click();
await page.getByText('Достичь C1').waitFor();

// First action from the skill screen's bottom button; the form returns to the skill.
await page.getByRole('button', { name: 'Создать первое действие' }).click();
await page.getByLabel('Название', { exact: true }).fill('Разговорная практика');
await page.getByLabel('Очки за выполнение').fill('5');
await settled();
await shot('step-form');
await page.getByRole('button', { name: 'Создать действие' }).click();
const check = page.locator('.check-button').first();
await check.waitFor();
await shot('skill-actions');

// The ✓ records a completion in one tap; the toast offers «Отменить» for 6 s. The ✓ stays
// busy (aria-busy) through completeStep's 1.5 s same-tap window: wait it out between taps.
const idleCheck = page.locator('.check-button[aria-busy="false"]').first();
const tapCheck = async () => {
  await idleCheck.waitFor();
  await check.click();
  await page.getByRole('button', { name: 'Отменить', exact: true }).waitFor();
  // The undo toast never covers the ✓ that was just tapped.
  const covered = await page.evaluate(() => {
    const t = document.querySelector('.toast')?.getBoundingClientRect();
    const c = document.querySelector('.check-button')?.getBoundingClientRect();
    return Boolean(t && c && c.bottom > t.top && c.top < t.bottom);
  });
  if (covered) errors.push('the undo toast covers the ✓ that was just tapped');
};
await tapCheck();
// A second tap ~0.8 s later is swallowed: no second completion, the undo toast stays.
await page.waitForTimeout(800);
await check.click();
await page.waitForTimeout(300);
if (await page.getByText('Уже отмечено', { exact: false }).count()) throw new Error('a quick second tap reached the same-tap guard');
if (!(await page.getByRole('button', { name: 'Отменить', exact: true }).count())) throw new Error('a quick second tap replaced the undo toast');
// The first completion earns «Первое действие»: a card under the header, never a sheet.
await achCard('Первое действие').waitFor();
if (await page.locator('.sheet').count()) errors.push('an achievement opened a sheet');
await shot('toast-undo');
await page.getByRole('button', { name: 'Отменить', exact: true }).click();
await page.getByText('Отменено · Колба 1: 0/10').waitFor();
await shot('toast-undone');
// 9 × 5 = 45 = 10 + 15 + 20: flask 1 fills on the 2nd tap, flask 2 on the 5th, and the 9th
// reaches the milestone of three flasks. A fill plays on the flask itself: no overlay, a pill.
for (let i = 0; i < 9; i++) {
  await tapCheck();
  if (i === 1) {
    await page.locator('.level-pill', { hasText: 'Колба 2' }).waitFor();
    if (await page.locator('.sheet').count()) errors.push('a flask fill opened a sheet');
    await shot('skill-levelup');
  }
  if (i === 2) await shot('skill-progress');
  if (i === 3) {
    // 20 points: 10 of 15 in flask 2. A mark «Пробный тест» pins that place: a tick on the
    // right wall of the flask with its caption, a row under «Засечки», a row in the history.
    await idleCheck.waitFor();
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
    await page.getByText('Отмечайте важные события на пути', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Меню навыка' }).click();
    await page.locator('.sheet', { has: page.getByRole('button', { name: 'Добавить засечку' }) }).waitFor();
    await settled();
    await shot('skill-menu');
    await page.locator('.sheet').getByRole('button', { name: 'Добавить засечку' }).click();
    await markSheet.getByRole('heading', { name: 'Новая засечка' }).waitFor();
    await markSheet.getByRole('button', { name: 'Сохранить' }).click();
    await markSheet.getByText('Укажите название засечки').waitFor();
    await markSheet.getByLabel('Название').fill('Пробный тест');
    await markSheet.getByLabel('Описание').fill('Грамматика 72 из 100, аудирование 18 из 25');
    await settled();
    await shot('mark-sheet');
    await markSheet.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByText('Засечка добавлена').waitFor();
    await markSheet.waitFor({ state: 'detached' });
    await page.locator('.flask-mark').first().waitFor();
    const caption = page.getByRole('button', { name: 'Засечка: Пробный тест', exact: true });
    await caption.waitFor();
    // The tick sits two thirds up the flask (10 of 15), right of the glass, captioned beside it.
    const place = await page.evaluate(() => {
      const svg = document.querySelector('.flask--hero .flask-svg').getBoundingClientRect();
      const tick = document.querySelector('.flask-mark-tick').getBoundingClientRect();
      const label = document.querySelector('.flask-mark-caption').getBoundingClientRect();
      const info = document.querySelector('.hero-info').getBoundingClientRect();
      return { height: (svg.bottom - tick.top) / svg.height, captionRight: label.right, infoLeft: info.left, right: tick.left - svg.left };
    });
    if (place.height < 0.5 || place.height > 0.8) errors.push(`the mark tick sits at ${place.height.toFixed(2)} of the flask, expected about 0.66`);
    if (place.captionRight > place.infoLeft) errors.push('the mark caption runs into the hero numbers');
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
    await shot('skill-mark');
    await page.getByRole('heading', { name: 'Засечки', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.locator('.mark-row', { hasText: 'Пробный тест' }).waitFor();
    await shot('marks-list');
    await caption.click();
    await markSheet.getByText('Колба 2, 10 из 15 очков').waitFor();
    await settled();
    await shot('mark-view');
    await page.keyboard.press('Escape');
    await markSheet.waitFor({ state: 'detached' });
    // The tick in the glass opens the same sheet (pointer only; the caption is the accessible way).
    await page.locator('.flask-mark-hit').first().click();
    await markSheet.getByText('Колба 2, 10 из 15 очков').waitFor();
    await page.keyboard.press('Escape');
    await markSheet.waitFor({ state: 'detached' });
    // A 360 px phone with a captioned mark: nothing scrolls sideways.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(200);
    const markOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (markOverflow > 0) errors.push(`the skill screen with a mark scrolls sideways by ${markOverflow}px at 360 px`);
    await shot('skill-mark-360');
    // 320 px: the narrower caption box (max-width) still ends before the numbers column, even
    // for a title long enough to fill it.
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(200);
    const tight = await page.evaluate(() => {
      const label = document.querySelector('.flask-mark-caption');
      const info = document.querySelector('.hero-info').getBoundingClientRect();
      return { captionEnd: label.getBoundingClientRect().left + parseFloat(getComputedStyle(label).maxWidth), infoLeft: info.left };
    });
    if (tight.captionEnd > tight.infoLeft) errors.push(`at 320 px a full mark caption would reach the hero numbers (${tight.captionEnd.toFixed(0)} > ${tight.infoLeft.toFixed(0)})`);
    await page.setViewportSize(contextOptions.viewport);
  }
}
// The milestone is a sheet with «Решу позже»; the decision stays on the rack.
const milestoneSheet = page.locator('.milestone-sheet');
await milestoneSheet.getByText('Веха достигнута', { exact: true }).waitFor();
await milestoneSheet.getByText('Достичь C1').waitFor();
await shot('milestone-sheet');
await milestoneSheet.getByRole('button', { name: 'Решу позже' }).click();
await milestoneSheet.waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Завершить', exact: true }).waitFor();
await shot('skill-milestone');
// A 360 px phone: the flask number drops to 48 px and nothing scrolls sideways.
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(200);
const narrow = await page.evaluate(() => ({
  numeral: getComputedStyle(document.querySelector('.roll')).fontSize,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
if (narrow.numeral !== '48px') errors.push(`the flask number is ${narrow.numeral} at 360 px, expected 48px`);
if (narrow.overflow > 0) errors.push(`the skill screen scrolls sideways by ${narrow.overflow}px at 360 px`);
await shot('skill-360');
await page.setViewportSize(contextOptions.viewport);

// History: grouped by day with separators; the cancelled completion stays, struck through;
// a row opens the completion sheet.
await page.waitForTimeout(6000); // let the toast time out
await page.getByRole('heading', { name: 'История', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
await page.getByText('Веха «Достичь C1» достигнута').waitFor();
await page.getByText('Колба 2 заполнена').waitFor();
if (!(await page.locator('.timeline-row.is-cancelled').count())) errors.push('the cancelled completion is not struck through in the timeline');
if (!(await page.locator('.timeline-mark', { hasText: 'Пробный тест' }).count())) errors.push('the mark is not in the history');
await shot('history');
await page.locator('.timeline-mark').evaluate((el) => el.scrollIntoView({ block: 'center' }));
await shot('history-mark');
// Edit the mark from its history row; the position never changes.
await page.locator('.timeline-mark').click();
await markSheet.getByRole('button', { name: 'Изменить' }).click();
await markSheet.getByRole('heading', { name: 'Изменить засечку' }).waitFor();
await markSheet.getByLabel('Название').fill('Пробный тест B2');
await markSheet.getByRole('button', { name: 'Сохранить' }).click();
await page.getByText('Засечка сохранена').waitFor();
await markSheet.waitFor({ state: 'detached' });
await page.locator('.timeline-mark', { hasText: 'Пробный тест B2' }).waitFor();
// Delete through the confirmation: a second mark comes and goes, the first one stays.
await skillMenu('Добавить засечку');
await markSheet.getByRole('heading', { name: 'Новая засечка' }).waitFor();
await markSheet.getByLabel('Название').fill('Черновик');
await markSheet.getByRole('button', { name: 'Сохранить' }).click();
await page.getByText('Засечка добавлена').waitFor();
await markSheet.waitFor({ state: 'detached' });
await page.locator('.timeline-mark', { hasText: 'Черновик' }).click();
await markSheet.getByRole('button', { name: 'Удалить' }).click();
const markConfirm = page.getByRole('dialog').filter({ hasText: 'Удалить засечку «Черновик»?' });
await markConfirm.waitFor();
await settled();
await shot('mark-confirm-delete');
await markConfirm.getByRole('button', { name: 'Удалить' }).click();
await page.getByText('Засечка удалена').waitFor();
await markSheet.waitFor({ state: 'detached' });
if (await page.locator('.timeline-mark', { hasText: 'Черновик' }).count()) errors.push('a deleted mark stays in the history');
if (!(await page.locator('.timeline-mark', { hasText: 'Пробный тест B2' }).count())) errors.push('deleting one mark took another with it');
await page.getByRole('heading', { name: 'История', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
await page.locator('button.timeline-row').first().click();
const sheet = page.locator('.completion-sheet');
await sheet.waitFor();
await sheet.getByLabel('Заметка').fill('Говорили про путешествия, 20 минут без пауз.');
await shot('completion-sheet');
await sheet.getByRole('button', { name: 'Сохранить' }).click();
await page.getByText('Заметка сохранена').waitFor();
await sheet.waitFor({ state: 'detached' });
await page.getByText('Говорили про путешествия', { exact: false }).first().waitFor();
// Cancel from the sheet, through the confirmation, then restore it.
await page.locator('button.timeline-row').first().click();
await sheet.getByRole('button', { name: 'Отменить выполнение' }).click();
const confirmSheet = page.locator('.sheet', { has: page.getByRole('button', { name: 'Оставить' }) });
await confirmSheet.waitFor();
await shot('completion-confirm-cancel');
await confirmSheet.getByRole('button', { name: 'Отменить', exact: true }).click();
await page.getByText(/^Отменено · Колба/).waitFor();
await sheet.waitFor({ state: 'detached' });
await page.locator('button.timeline-row.is-cancelled').first().click();
await sheet.getByRole('button', { name: 'Вернуть' }).click();
await page.getByText('Возвращено').waitFor();
await sheet.waitFor({ state: 'detached' });
// That completion reached the milestone: «Вернуть» reaches it again, and the sheet says so again.
await milestoneSheet.getByRole('button', { name: 'Решу позже' }).click();
await milestoneSheet.waitFor({ state: 'detached' });
// A typed note survives dismissing the sheet without «Сохранить».
await page.locator('button.timeline-row').first().click();
await sheet.getByLabel('Заметка').fill('Короткая заметка без кнопки');
await page.keyboard.press('Escape');
await page.getByText('Заметка сохранена').waitFor();
await sheet.waitFor({ state: 'detached' });
await page.getByText('Короткая заметка без кнопки').first().waitFor();

// Edit mode: rows link to the step form; «Убрать из списка» hides, «Вернуть» brings back.
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole('button', { name: 'Изменить', exact: true }).click();
await shot('actions-edit');
await page.getByRole('link', { name: /Разговорная практика/ }).click();
await page.getByText('Прошлое не пересчитывается', { exact: false }).waitFor();
await settled();
await shot('step-edit');
await page.getByRole('button', { name: 'Убрать из списка' }).click();
const hideSheet = page.locator('.sheet', { has: page.getByRole('button', { name: 'Убрать', exact: true }) });
await hideSheet.getByRole('button', { name: 'Убрать', exact: true }).click();
await page.getByText('Действие убрано из списка').waitFor();
// The only action is hidden: the card says so and lists it openly with «Вернуть».
await page.getByText('Все действия убраны из списка', { exact: false }).waitFor();
await page.locator('.toast').waitFor({ state: 'detached' });
await shot('actions-hidden');
await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
await check.waitFor();

await page.getByRole('button', { name: 'Завершить', exact: true }).click();
// Outside Telegram the confirmation is the in-app sheet.
const dialog = page.getByRole('dialog');
await dialog.waitFor();
await shot('confirm-sheet');
await dialog.getByRole('button', { name: 'Завершить' }).click();
await page.getByText(/Навык достигнут/).first().waitFor();
// The flask turns gold and gets its cork.
await page.locator('.flask--complete .flask-cork').waitFor();
// The confirmation sheet restores the scroll position when it unmounts; scroll up after it.
await dialog.waitFor({ state: 'detached' });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1300);
await shot('skill-completed');
await page.getByRole('heading', { name: 'История', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
await shot('history-completed');
await page.evaluate(() => window.scrollTo(0, 0));

await page.reload();
await page.getByText(/Навык достигнут/).first().waitFor();
// History holds the «Сегодня» visit from above; go home directly.
await page.goto(`${baseUrl}#/skills`);
// The only skill is completed: it is shown right away, without a one-option filter.
await page.locator('.skill-card.is-completed').waitFor();
if (await filterGroup().count()) errors.push('a filter with a single segment is offered');
await shot('skills-completed');
// The completed card's mini: the theme's gold, the check centred on the level chip.
const ringCheck = await page.locator('.skill-card.is-completed .skill-card-mini').first().evaluate((mini) => {
  if (!mini.querySelector('.is-complete, [class*="--complete"]')) return 'the mini is not drawn complete';
  const chip = mini.querySelector('.skill-card-level');
  const icon = chip?.querySelector('svg')?.getBoundingClientRect();
  if (!chip || !icon) return 'no check icon';
  const r = chip.getBoundingClientRect();
  const dx = icon.left + icon.width / 2 - (r.left + r.width / 2);
  const dy = icon.top + icon.height / 2 - (r.top + r.height / 2);
  return Math.abs(dx) > 2 || Math.abs(dy) > 2 ? `the check is off the chip's centre by ${dx.toFixed(1)}, ${dy.toFixed(1)}` : null;
});
if (ringCheck) errors.push(`completed card mini: ${ringCheck}`);
await page.locator('.skill-card.is-completed').first().screenshot({ path: `${outDir}/${String(++n).padStart(2, '0')}-skill-card-completed.png` });

// A second skill whose single 25-point action fills flasks 1 (10) and 2 (15) at once:
// the toast must name both filled flasks. The action starts from an example chip.
await page.getByRole('link', { name: 'Новый навык' }).first().click();
await customCard().click();
await page.getByLabel('Название', { exact: true }).fill('Тренировки');
await page.getByText('Дополнительно').click();
await page.getByLabel('Колб', { exact: true }).fill('5');
await page.getByLabel('Первый уровень', { exact: true }).fill('10');
await page.getByLabel('Прирост за уровень', { exact: true }).fill('5');
await page.getByRole('button', { name: 'Создать навык' }).click();
await page.getByRole('link', { name: 'Тренировка · 20' }).click();
await page.getByLabel('Очки за выполнение').fill('25');
await page.getByText(/≈ 1 выполнение до\s+колбы\s+1/).waitFor();
await settled();
await shot('step-form-chip');
await page.getByRole('button', { name: 'Создать действие' }).click();
await check.click();
// Two flasks at once: compressed drain/refill cycles, then the pill names the flask now filling.
await page.locator('.level-pill', { hasText: 'Колба 3' }).waitFor();
await page.getByRole('status').getByText('+25 · Тренировка').waitFor();
await shot('levelup-two-flasks');

// «Задним числом»: the full-screen form for another date. A fill recorded there is told on
// the hero it goes back to — the pill «Колба N» on the glass; a card at the top would cover
// that very flask (the TopCard stays for screens without it: «Сегодня» below).
await idleCheck.waitFor();
// The two-flask write above earned «Двойное дно»: its card plays first, so the hero is clear below.
await page.locator('.ach-card').waitFor();
await page.locator('.ach-card').waitFor({ state: 'detached', timeout: 10000 });
await page.getByRole('link', { name: 'Задним числом' }).click();
await page.getByRole('button', { name: 'Отметить выполненным' }).waitFor();
await page.getByText('Тренировка', { exact: true }).click();
await shot('backdate');
await page.getByRole('button', { name: 'Отметить выполненным' }).click();
await page.locator('.level-pill', { hasText: /Колба \d+/ }).waitFor();
await shot('backdate-levelup');
// Watched for as long as the celebration could take, not at one instant.
await page
  .locator('.top-card:not(.ach-card)')
  .waitFor({ state: 'attached', timeout: 1500 })
  .then(() => errors.push('a backdated fill covered the hero flask with the level-up card'), () => {});
await page.locator('.level-pill').waitFor({ state: 'detached' });

// Edit form (through the ⋯ menu): the delete confirmation is a danger sheet; cancel it.
await skillMenu('Изменить навык');
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

// Home: the bento row, the cards (ring, liquid bar, milestone dots, «+N сегодня») and chips
// for the non-empty segments only.
await page.getByRole('button', { name: 'Назад' }).click();
await page.getByRole('navigation', { name: 'Разделы' }).waitFor();
await page.locator('.skill-card').first().waitFor();
const chips = async () => (await filterGroup().getByRole('button').allTextContents()).join(' · ');
if ((await chips()) !== 'Активные · Достигнутые') errors.push(`home chips: ${await chips()}`);
if (!(await page.locator('.skill-card', { hasText: '+50 сегодня' }).count())) errors.push('the home card does not show today\'s points');
await shot('home');

// «Сегодня»: the coach chip above the first button, the two tiles, the groups. A tap that
// fills a flask is told by the TopCard (no flask on this screen); «Сделано сегодня» follows.
await tab('Сегодня').click();
await page.locator('.coach-chip').waitFor();
// Nothing is scheduled yet, but the day has completions: only its points, no «ничего не
// запланировано» hint; the week strip counts today's completions.
await page.locator('.today-summary-points').waitFor();
if (await page.getByText('ничего не запланировано', { exact: false }).count()) errors.push('«ничего не запланировано» on a day with completions');
await page.getByRole('group', { name: 'День для отметок' }).getByRole('button', { pressed: true, name: /: \d+ выполнени/ }).waitFor();
await shot('today');
const todayCheck = (skill) => page.locator('.today-group', { hasText: skill }).locator('.check-button').first();
const idleToday = (skill) => page.locator('.today-group', { hasText: skill }).locator('.check-button[aria-busy="false"]').first();
await todayCheck('Тренировки').click();
await page.locator('.top-card', { hasText: /Колба \d+ заполнена/ }).waitFor();
await shot('today-topcard');
await levelCard.waitFor({ state: 'detached' });
if (await page.locator('.coach-chip').count()) errors.push('the coach chip stayed after the first completion');
await page.getByText('Сделано сегодня').waitFor();
await shot('today-done');
// A row of «Сделано сегодня» opens the completion sheet.
await page.locator('.done-row').first().click();
await page.locator('.completion-sheet').waitFor();
await page.keyboard.press('Escape');
await page.locator('.completion-sheet').waitFor({ state: 'detached' });

// A third skill with a 1-point action, tapped 21 times from «Сегодня»: its history has more
// than one page (20 operations), so «Показать ещё» appears and loads the rest.
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
await tab('Навыки').click();
await page.getByRole('link', { name: 'Новый навык' }).first().click();
await customCard().click();
await page.getByLabel('Название', { exact: true }).fill('Чтение');
await page.getByRole('button', { name: 'Создать навык' }).click();
await page.getByRole('button', { name: 'Создать первое действие' }).click();
await page.getByLabel('Название', { exact: true }).fill('Десять страниц');
await page.getByLabel('Очки за выполнение').fill('1');
await page.getByRole('button', { name: 'Создать действие' }).click();
await check.waitFor();
await page.getByRole('button', { name: 'Назад' }).click();
await tab('Сегодня').click();
for (let i = 0; i < 21; i++) {
  await idleToday('Чтение').waitFor();
  await todayCheck('Чтение').click();
  await page.locator('.today-group', { hasText: 'Чтение' }).getByText(`сегодня ×${i + 1}`).waitFor();
}
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
await shot('today-many');
await page.locator('.today-group-skill', { hasText: 'Чтение' }).click();
await page.getByRole('heading', { name: 'История', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
const moreButton = page.getByRole('button', { name: 'Показать ещё' });
await moreButton.waitFor();
const rowsBefore = await page.locator('button.timeline-row').count();
await shot('history-more');
await moreButton.click();
await moreButton.waitFor({ state: 'detached' });
const rowsAfter = await page.locator('button.timeline-row').count();
if (!(rowsAfter > rowsBefore)) errors.push(`«Показать ещё» did not add rows: ${rowsBefore} → ${rowsAfter}`);
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole('button', { name: 'Назад' }).click();

// Schedules and timed actions (package 8), on «Чтение»: a timed action every day and a
// quota of 3 a week. The form's type is live; «Сегодня» v2 gets «Осталось» and the quota block.
await tab('Навыки').click();
await page.locator('.skill-card', { hasText: 'Чтение' }).click();
await page.getByRole('link', { name: 'Новое действие' }).click();
await page.getByLabel('Название', { exact: true }).fill('Чтение вслух');
await page.getByRole('group', { name: 'Тип' }).getByRole('button', { name: 'По времени' }).click();
await page.getByLabel('Очков за минуту').fill('0,5');
await page.getByRole('group', { name: 'Частые значения' }).getByRole('button', { name: '30 мин' }).click();
await page.getByLabel('Когда показывать на «Сегодня»').selectOption('DAILY');
await page.getByText('30 мин → 15 очков').waitFor();
await page.locator('input:focus').evaluate((el) => el.blur()).catch(() => {});
await settled();
await shot('step-form-timed');
await page.getByRole('button', { name: 'Создать действие' }).click();
await page.getByRole('button', { name: /^Отметить: Чтение вслух, 0,5 очка в минуту$/ }).waitFor();
await page.getByRole('link', { name: 'Новое действие' }).click();
await page.getByLabel('Название', { exact: true }).fill('Библиотека');
await page.getByLabel('Очки за выполнение').fill('5');
await page.getByLabel('Когда показывать на «Сегодня»').selectOption('WEEKDAYS');
await page.getByRole('group', { name: 'Дни недели' }).getByRole('button', { name: 'Суббота' }).click();
await settled();
await shot('step-form-weekdays');
await page.getByLabel('Когда показывать на «Сегодня»').selectOption('TIMES_PER_WEEK');
await page.getByText('пока не наберётся 3', { exact: false }).waitFor();
await shot('step-form-quota');
await page.getByRole('button', { name: 'Создать действие' }).click();
// Three actions on one skill's list: «Набор инструментов» (a card under the header).
await achCard('Набор инструментов').waitFor();
await page.getByText('3 раза в неделю').waitFor();
await achCard('Набор инструментов').waitFor({ state: 'detached', timeout: 8000 });
await shot('skill-scheduled-rows');
// «Задним числом» with a timed action: the duration under the date, minutes and points on the button.
await page.getByRole('link', { name: 'Задним числом' }).click();
await page.getByText('Чтение вслух', { exact: true }).click();
await page.getByRole('button', { name: 'Записать 30 мин · +15' }).waitFor();
await page.getByRole('group', { name: 'Частые значения' }).getByRole('button', { name: '60 мин' }).click();
await page.getByRole('button', { name: 'Записать 60 мин · +30' }).waitFor();
await shot('backdate-timed');
await page.getByRole('button', { name: 'Назад' }).click();
await page.getByRole('link', { name: 'Задним числом' }).waitFor();
await page.getByRole('button', { name: 'Назад' }).click();
await tab('Сегодня').click();
const dueSection = page.locator('.today-due');
const quotaSection = page.locator('.today-quota');
await dueSection.getByText('Чтение вслух').waitFor();
await dueSection.getByText('Чтение · каждый день').waitFor();
await quotaSection.getByText('Чтение · 0 из 3').waitFor();
await page.getByText('Сделано 0 из 1').waitFor();
if (await page.getByText(/просроч|пропущ/i).count()) errors.push('«Сегодня» talks about something overdue or missed');
if (await page.locator('details.today-more[open]').count()) errors.push('«Ещё» is open while something is left');
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
await shot('today-v2');
// The ✓ of a timed action asks «Сколько минут?» first: the usual 30 preselected, 45 picked.
await dueSection.locator('.check-button').first().click();
const minutesSheet = page.locator('.minutes-sheet');
await minutesSheet.getByText('Начислится 15 очков').waitFor();
await minutesSheet.getByRole('button', { name: '45 мин' }).click();
await minutesSheet.getByText('Начислится 22,5 очка').waitFor();
await shot('minutes-sheet');
await minutesSheet.getByRole('button', { name: 'Готово' }).click();
await minutesSheet.waitFor({ state: 'detached' });
await page.getByRole('status').getByText('+22,5 · Чтение вслух').waitFor();
await page.getByText('Всё сделано на сегодня').waitFor();
await dueSection.waitFor({ state: 'detached' });
// Nothing left: «Ещё» unfolds by itself.
await page.locator('details.today-more[open]').waitFor();
await shot('today-v2-done');
// The quota: one tap, 1 of 3 (the rest of the week keeps the block).
await quotaSection.locator('.check-button[aria-busy="false"]').first().click();
await quotaSection.getByText('Чтение · 1 из 3').waitFor();
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
await shot('today-v2-quota');
// «Минуты» in the completion sheet: 45 → 60 is one CORRECTION of +7,5.
await page.locator('.done-row', { hasText: 'Чтение вслух' }).click();
const doneSheet = page.locator('.completion-sheet');
await doneSheet.getByText('45 мин · 0,5/мин').waitFor();
await doneSheet.getByLabel('Минуты').fill('60');
await doneSheet.getByText('Было 45 мин (22,5) → станет 60 мин (+7,5)').waitFor();
await shot('completion-minutes');
await doneSheet.getByRole('button', { name: 'Пересчитать' }).click();
await page.getByText('Длительность изменена: +7,5 очка').waitFor();
await doneSheet.waitFor({ state: 'detached' });
// A past day of this week (SHIFT_DAYS makes sure there is one): its plan, «В этот день отметок нет».
const weekPicker = page.getByRole('group', { name: 'День для отметок' });
const pickable = weekPicker.locator('button:not([disabled])');
if ((await pickable.count()) > 1) {
  await pickable.nth((await pickable.count()) - 2).click();
  await page.getByText(/^Отметки задним числом: /).waitFor();
  await page.getByText('В этот день отметок нет').waitFor();
  if (await page.getByText('Осталось', { exact: true }).count()) errors.push('a past day says «Осталось»');
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
  await shot('today-past-day');
  await weekPicker.locator('button.is-today').click();
  await page.getByText('Всё сделано на сегодня').waitFor();
} else {
  errors.push('«Сегодня» has no past day of the week to pick (SHIFT_DAYS=0 on a Monday?)');
}
// A 320 px phone: the week strip and the quota rows fit without sideways scroll.
await page.setViewportSize({ width: 320, height: 700 });
await page.waitForTimeout(200);
const todayOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (todayOverflow > 0) errors.push(`«Сегодня» scrolls sideways by ${todayOverflow}px at 320 px`);
await shot('today-v2-320');
await page.setViewportSize(contextOptions.viewport);

// The live timer (v0.5 package 15), on «Чтение вслух» (0,5/мин, обычно 30 мин): ▶ beside the
// ✓, the pill on every screen, the sheet running and paused, «Завершить» → «Сколько минут?»
// prefilled → the completion toast. The timer counts from its stored timestamps, so moving its
// start back in IndexedDB and reloading is the same as waiting (and shows that a reload keeps it).
/** Moves the stored timer's start `ms` into the past (the page's own clock, SHIFT_DAYS included). */
const backdateTimer = (ms) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('skill-flask');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const idb = open.result;
          const store = idb.transaction('settings', 'readwrite').objectStore('settings');
          const get = store.get('activeTimer');
          get.onsuccess = () => {
            const row = get.result;
            if (!row) return reject(new Error('no activeTimer row'));
            row.value.startedAt = new Date(Date.parse(row.value.startedAt) - ms).toISOString();
            store.put(row).onsuccess = () => {
              idb.close();
              resolve();
            };
          };
        };
      }),
    ms,
  );
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
await page.getByRole('button', { name: 'Запустить таймер: Чтение вслух' }).click();
const timerPill = page.locator('.timer-pill');
await timerPill.getByText('00:0', { exact: false }).waitFor();
await page.getByRole('button', { name: 'Открыть таймер: Чтение вслух', exact: true }).waitFor();
// Twelve minutes in (after a reload: the stored timestamps are all it needs).
await backdateTimer(12 * 60_000);
await page.reload();
await timerPill.getByText(/^12:0\d$/).waitFor();
await shot('timer-pill-today');
// The sheet «Таймер»: the ring fills towards the usual 30 minutes; then paused.
await timerPill.getByRole('button', { name: /^Открыть таймер: Чтение вслух, / }).click();
const timerSheet = page.locator('.timer-sheet');
await timerSheet.getByText('Цель — 30 мин').waitFor();
await shot('timer-sheet');
await timerSheet.getByRole('button', { name: 'Пауза' }).click();
await timerSheet.getByText('На паузе').waitFor();
await shot('timer-sheet-paused');
await timerSheet.getByRole('button', { name: 'Продолжить' }).click();
await timerSheet.getByText('Цель — 30 мин').waitFor();
await page.keyboard.press('Escape');
await timerSheet.waitFor({ state: 'detached' });
// Four seconds before the usual 30 minutes: after the reload the goal toast comes while the app is open.
await backdateTimer(18 * 60_000 - 4000);
await page.reload();
await timerPill.getByText(/^29:5\d$/).waitFor();
await page.getByRole('status').getByText('30 минут — цель на сегодня есть').waitFor({ timeout: 8000 });
{
  // The toast rises above the pill instead of covering it.
  const [toastBox, pillBox] = await Promise.all([page.locator('.toast').boundingBox(), timerPill.boundingBox()]);
  if (!toastBox || !pillBox || toastBox.y + toastBox.height > pillBox.y) errors.push('the goal toast overlaps the timer pill');
}
await shot('timer-goal-toast');
// Another root screen, then a nested one scrolled to its end: the pill stays above the bars and
// the page end has room for it (the last row scrolls out from under it).
await tab('Навыки').click();
await page.locator('.skill-card', { hasText: 'Чтение' }).first().waitFor();
await shot('timer-pill-home');
await page.locator('.skill-card', { hasText: 'Чтение' }).first().click();
await page.getByRole('button', { name: 'Открыть таймер: Чтение вслух', exact: true }).waitFor();
// The lazy heat map and the history arrive after the first paint: let them, then go to the end.
await page.locator('.heatmap-grid button').first().waitFor();
await page.waitForTimeout(500);
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(300);
{
  const lastBottom = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.screen-body > *')].filter((el) => el.getBoundingClientRect().height > 0);
    return items.at(-1)?.getBoundingClientRect().bottom ?? 0;
  });
  const pillTop = (await timerPill.boundingBox())?.y ?? 0;
  if (lastBottom > pillTop + 1) errors.push(`the end of the skill screen stays under the timer pill (${lastBottom.toFixed(0)} > ${pillTop.toFixed(0)})`);
}
await shot('timer-pill-skill-end');
await page.evaluate(() => window.scrollTo(0, 0));
await timerPill.getByRole('button', { name: /^Открыть таймер: Чтение вслух, / }).click();
await timerSheet.getByText('Цель — 30 мин').waitFor();
// «Завершить» → «Сколько минут?» over the timer, with its minutes and start day.
await timerSheet.getByRole('button', { name: 'Завершить' }).click();
const timerMinutes = page.locator('.minutes-sheet');
await timerMinutes.getByText('Начислится 15 очков').waitFor();
if ((await timerMinutes.getByLabel('Минуты').inputValue()) !== '30') errors.push('«Завершить» did not fill in the timer’s 30 minutes');
if (!(await timerMinutes.getByLabel('Дата').inputValue())) errors.push('«Завершить» did not fill in the timer’s date');
await shot('timer-finish-minutes');
await timerMinutes.getByRole('button', { name: 'Готово' }).click();
await page.getByRole('status').getByText('+15 · Чтение вслух').waitFor();
await timerPill.waitFor({ state: 'detached' });
await timerSheet.waitFor({ state: 'detached' });
await shot('timer-recorded');
// A 320 px phone: the pill keeps its digits and buttons, the name gives way.
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
await page.getByRole('button', { name: 'Запустить таймер: Чтение вслух' }).click();
await timerPill.waitFor();
await page.setViewportSize({ width: 320, height: 700 });
await page.waitForTimeout(200);
{
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) errors.push(`the skill screen with the timer pill scrolls sideways by ${overflow}px at 320 px`);
  const inside = await timerPill.evaluate((el) => [...el.querySelectorAll('button')].every((b) => b.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5));
  if (!inside) errors.push('a timer pill button sticks out at 320 px');
}
await shot('timer-pill-320');
await page.setViewportSize(contextOptions.viewport);
// «Сбросить» leaves nothing behind for the rest of the walk.
await timerPill.getByRole('button', { name: /^Открыть таймер: Чтение вслух, / }).click();
await timerSheet.getByRole('button', { name: 'Сбросить' }).click();
const resetConfirm = page.getByRole('dialog', { name: 'Подтверждение' });
await resetConfirm.getByText('Сбросить таймер? Время не запишется').waitFor();
await shot('timer-confirm-reset');
await resetConfirm.getByRole('button', { name: 'Сбросить' }).click();
await timerPill.waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Назад' }).click();

// Archive from the skill form: gone from «Сегодня», a third chip «Архив» on the home screen,
// the banner with «Продолжить с этого места» on the skill.
await tab('Навыки').click();
await page.locator('.skill-card', { hasText: 'Тренировки' }).click();
await skillMenu('Изменить навык');
await page.getByRole('button', { name: 'Архивировать навык' }).click();
await dialog.waitFor();
await shot('confirm-archive');
await dialog.getByRole('button', { name: 'В архив' }).click();
await page.getByText('Навык в архиве').waitFor();
await dialog.waitFor({ state: 'detached' });
if ((await chips()) !== 'Активные · Достигнутые · Архив') errors.push(`home chips after archiving: ${await chips()}`);
await segment('Архив').click();
await page.locator('.skill-card.is-archived').waitFor();
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
await shot('home-archive');
await tab('Сегодня').click();
await page.locator('.today-group').first().waitFor();
if (await page.locator('.today-group', { hasText: 'Тренировки' }).count()) errors.push('an archived skill is still on «Сегодня»');
await tab('Навыки').click();
await segment('Архив').click();
if (!page.url().endsWith('#/skills?filter=archived')) errors.push(`the archive segment is not in the URL: ${page.url()}`);
await page.locator('.skill-card.is-archived').click();
await page.locator('.archived-banner').waitFor();
if (await page.locator('.check-button').count()) errors.push('an archived skill offers the ✓');
await shot('skill-archived');
// No form to open for an archived skill: «Удалить навык» closes its screen.
await page.getByRole('button', { name: 'Удалить навык' }).scrollIntoViewIfNeeded();
await shot('skill-archived-bottom');
await page.evaluate(() => window.scrollTo(0, 0));
// «Назад» returns to the archive segment it was opened from.
await page.getByRole('button', { name: 'Назад' }).click();
await page.locator('.skill-card.is-archived').waitFor();
if ((await segment('Архив').getAttribute('aria-pressed')) !== 'true') errors.push('«Назад» from an archived skill did not return to «Архив»');
await page.locator('.skill-card.is-archived').click();
await page.locator('.archived-banner').waitFor();
await page.getByRole('button', { name: 'Продолжить с этого места' }).click();
await page.getByText('Навык снова в работе').waitFor();
await check.waitFor();
await page.getByRole('button', { name: 'Назад' }).click();

// «Начать заново» on the completed skill: a copy with the same actions and an empty flask,
// opened in its form for a new name; the completed one stays in «Достигнутые».
await segment('Достигнутые').click();
await page.locator('.skill-card.is-completed').click();
await page.getByRole('button', { name: 'Начать заново' }).click();
await dialog.waitFor();
await shot('confirm-restart');
await dialog.getByRole('button', { name: 'Начать заново' }).click();
await page.getByText('Копия создана').waitFor();
await page.getByRole('button', { name: 'Удалить навык' }).waitFor();
// The page is inert until the confirmation sheet has finished closing.
await dialog.waitFor({ state: 'detached' });
await page.getByLabel('Название', { exact: true }).fill('Английский C1 → C2');
await settled();
await shot('restart-form');
await page.getByRole('button', { name: 'Сохранить' }).click();
await page.locator('.flask--empty').waitFor();
await page.getByRole('heading', { name: 'Английский C1 → C2' }).waitFor();
await page.getByText('Разговорная практика').waitFor();
await shot('restart-skill');
await page.getByRole('button', { name: 'Назад' }).click();
await page.getByRole('navigation', { name: 'Разделы' }).waitFor();
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
// «Назад» from the copy lands on the active skills, where the copy is listed.
// Waited for: the home list renders from its live query a moment after the navigation.
await page
  .locator('.skill-card', { hasText: 'Английский C1 → C2' })
  .waitFor({ timeout: 5000 })
  .catch(() => errors.push('«Назад» from the restarted copy does not show it on the home screen'));
await shot('home-after');

// The home tile names the last achievement.
const homeTile = page.locator('.tile--achievement');
if (!(await homeTile.getByText(/^Последняя ачивка · /).count())) errors.push('the home tile does not show the last achievement');
await homeTile.screenshot({ path: `${outDir}/${String(++n).padStart(2, '0')}-home-achievement-tile.png` });

// «Ачивки»: the dot on the tab until the tab was on screen, the summary ring, the filter, the
// seven ladders with their tiers, the badge tiles, the detail sheet. Never a current streak.
const achTab = tab('Ачивки');
if (!(await achTab.locator('.tab-badge').count())) errors.push('no dot on «Ачивки» for unseen achievements');
if (!/новых: \d+/.test((await achTab.getAttribute('aria-label')) ?? '')) errors.push('the «Ачивки» tab does not say how many are new');
await achTab.click();
await page.getByRole('img', { name: /^Получено \d+ из 49$/ }).waitFor();
await shot('achievements');
await achTab.locator('.tab-badge').waitFor({ state: 'detached', timeout: 3000 });
if ((await page.locator('.ladder-card').count()) !== 8) errors.push(`ladder cards: ${await page.locator('.ladder-card').count()}`);
if ((await page.locator('.ach-tile').count()) !== 12) errors.push(`badge tiles: ${await page.locator('.ach-tile').count()}`);
if (await page.getByText(/текущ|сгорел|пропущ|провал/i).count()) errors.push('the achievements tab mentions a current streak or a loss');
const series = page.getByRole('article', { name: 'Лучшая серия' });
await series.getByText(/^Ступени/).click();
await series.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot('achievements-ladder-tiers');
await page.getByRole('heading', { name: 'Значки' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
await shot('achievements-badges');
await page.locator('.ach-tile.is-unlocked').first().click();
const achSheet = page.locator('.achievement-sheet');
await achSheet.getByText('Как получить').waitFor();
await achSheet.getByText(/^Получена /).waitFor();
await page.waitForTimeout(400);
await shot('achievement-sheet');
await page.keyboard.press('Escape');
await achSheet.waitFor({ state: 'detached' });
await page.locator('.ach-tile.is-progress, .ach-tile.is-locked').first().click();
await achSheet.getByText('Ещё впереди').waitFor();
await page.waitForTimeout(400);
await shot('achievement-sheet-ahead');
await page.keyboard.press('Escape');
await achSheet.waitFor({ state: 'detached' });
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole('button', { name: 'Получено', exact: true }).click();
await page.getByRole('button', { name: 'Получено', exact: true, pressed: true }).waitFor();
if (await page.locator('.ach-tile.is-locked, .ach-tile.is-progress').count()) errors.push('«Получено» lists achievements still ahead');
await shot('achievements-earned');
await page.getByRole('button', { name: 'Все', exact: true }).click();
// A 360 px phone: nothing scrolls sideways.
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(200);
const achOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (achOverflow > 0) errors.push(`the achievements tab scrolls sideways by ${achOverflow}px at 360 px`);
await page.setViewportSize(contextOptions.viewport);

// Root tabs: the bar is only on the four root routes; legacy paths redirect.
await tab('Настройки').click();
await page.waitForTimeout(200);
await shot('tab-Настройки');
await page.goto(`${baseUrl}#/todo`);
await page.waitForURL(/#\/today$/);
await page.goto(`${baseUrl}#/account`);
await page.waitForURL(/#\/settings$/);
await page.goto(`${baseUrl}#/skills/nope/edit`);
await page.getByText('Навык не найден').waitFor();
if (await page.getByRole('navigation', { name: 'Разделы' }).count()) errors.push('tab bar rendered on a nested route');

// Settings in the browser: no cloud, the file reminder, a download → wipe → import round trip.
await page.goto(`${baseUrl}#/settings`);
await page.getByText('Резервной копии ещё нет — скачайте файл').waitFor();
await page.getByText('Активных дней за 14 дней: 1').waitFor();
await shot('settings');
const motionSwitch = page.getByRole('switch', { name: /Меньше анимации/ });
await motionSwitch.click();
if ((await page.evaluate(() => document.documentElement.dataset.motion)) !== 'reduced') errors.push('«Меньше анимации» did not set data-motion');
await motionSwitch.click();
if (await page.evaluate(() => document.documentElement.dataset.motion)) errors.push('«Меньше анимации» off left data-motion set');
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать файл' }).click()]);
if (!/^skill-flask-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename())) errors.push(`unexpected backup name ${download.suggestedFilename()}`);
const backupPath = `${outDir}/backup.json`;
await download.saveAs(backupPath);
await page.getByText('Файл сохранён').waitFor();
await page.getByText('Резервной копии ещё нет', { exact: false }).waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Ошибки (0)' }).click();
await page.getByText('Журнал ошибок пуст').waitFor();
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot('settings-bottom');

await page.getByRole('button', { name: 'Удалить все данные' }).click();
const wipeSheet = page.locator('.sheet', { has: page.getByRole('button', { name: 'Удалить всё' }) });
await wipeSheet.waitFor();
await shot('settings-confirm-wipe');
await wipeSheet.getByRole('button', { name: 'Удалить всё' }).click();
await page.getByText('Первый навык').waitFor();

await tab('Настройки').click();
await page.getByRole('button', { name: 'Загрузить из файла…' }).click();
const importSheet = page.locator('.import-sheet');
await importSheet.waitFor();
await importSheet.getByLabel('Или вставьте текст копии').fill('{"hello": "world"}');
await importSheet.getByRole('button', { name: 'Проверить текст' }).click();
await importSheet.getByText('Это не резервная копия Skill Flask').waitFor();
await shot('import-error');
await importSheet.locator('input[type="file"]').setInputFiles(backupPath);
await importSheet.getByText(/^Навыков: 4 · выполнений: \d+/).waitFor();
if (await importSheet.getByLabel('Или вставьте текст копии').inputValue()) errors.push('the pasted text stayed next to the chosen file');
await shot('import-preview');
await importSheet.getByRole('button', { name: 'Заменить данные' }).click();
const replaceSheet = page.locator('.sheet', { has: page.getByRole('button', { name: 'Заменить', exact: true }) });
await replaceSheet.getByRole('button', { name: 'Заменить', exact: true }).click();
await page.getByText('Импортировано').waitFor();
await page.getByText('Тренировки').first().waitFor();
await shot('import-done');

// ---- Package 12 in the browser: the hash route as a link, «Ссылка на навык», the home-screen
// instructions, «Тема», the service worker ----
const backupSkills = JSON.parse(readFileSync(backupPath, 'utf8')).tables.skills;
const linkedSkill = backupSkills.find((skill) => skill.status === 'ACTIVE');
// Outside Telegram the hash routes are the deep links: opened directly, the skill.
await page.goto(`${baseUrl}#/skills/${linkedSkill.id}`);
await page.locator('h1.screen-title', { hasText: linkedSkill.name }).waitFor();
await page.locator('.hero').waitFor();
await shot('deeplink-direct');
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseUrl).origin });
await skillMenu('Ссылка на навык');
await page.getByText('Ссылка скопирована').waitFor();
await shot('skill-link-toast');
const copiedLink = await page.evaluate(() => navigator.clipboard.readText());
if (copiedLink !== `${new URL(baseUrl).origin}${new URL(baseUrl).pathname}#/skills/${linkedSkill.id}`) errors.push(`«Ссылка на навык» copied ${copiedLink}`);
// Where the clipboard refuses (Telegram iOS), the link is shown to copy by hand.
await page.evaluate(() => {
  navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
});
await skillMenu('Ссылка на навык');
const linkSheet = page.locator('.link-sheet');
await linkSheet.waitFor();
if ((await linkSheet.getByLabel('Ссылка').inputValue()) !== copiedLink) errors.push('the link sheet shows another link');
await settled();
await shot('skill-link-sheet');
// «Скопировать» tries again in its own tap: with the clipboard back, the sheet closes on the toast.
await page.evaluate(() => {
  delete navigator.clipboard.writeText;
  return navigator.clipboard.writeText('');
});
await linkSheet.getByRole('button', { name: 'Скопировать', exact: true }).click();
await linkSheet.waitFor({ state: 'detached' });
await page.getByText('Ссылка скопирована').waitFor();
if ((await page.evaluate(() => navigator.clipboard.readText())) !== copiedLink) errors.push('«Скопировать» in the link sheet copied another link');

// Settings: «Тема» and «Добавить на главный экран» (no install prompt here: the instructions).
await page.goto(`${baseUrl}#/settings`);
const themeGroup = page.getByRole('group', { name: 'Тема' });
await themeGroup.getByRole('button', { name: 'Как в системе', exact: true }).waitFor();
await themeGroup.scrollIntoViewIfNeeded();
await shot('settings-theme');
// A 320 px phone: the three segments fit, nothing scrolls sideways.
await page.setViewportSize({ width: 320, height: 700 });
await page.waitForTimeout(200);
const themeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (themeOverflow > 0) errors.push(`Settings scroll sideways by ${themeOverflow}px at 320 px`);
// Centred: «if needed» counts a group half under the tab bar as visible.
await themeGroup.evaluate((el) => el.scrollIntoView({ block: 'center' }));
await shot('settings-theme-320');
await page.setViewportSize(contextOptions.viewport);
await page.getByRole('button', { name: 'Добавить на главный экран' }).click();
const installSheet = page.locator('.install-sheet');
await installSheet.getByText('Подтвердите добавление').waitFor();
await settled();
await shot('install-sheet');
await installSheet.getByRole('button', { name: 'Понятно' }).click();
await installSheet.waitFor({ state: 'detached' });
// A forced theme applies at once and is there from the first paint after a reload.
const forcedName = dark ? 'Светлая' : 'Тёмная';
const forcedValue = dark ? 'light' : 'dark';
await themeGroup.getByRole('button', { name: forcedName, exact: true }).click();
await page.waitForFunction((v) => document.documentElement.dataset.appearance === v && document.documentElement.dataset.theme === v, forcedValue);
await page.waitForTimeout(400); // the crossfade
await shot('settings-theme-forced');
await page.reload();
if ((await page.evaluate(() => document.documentElement.dataset.appearance)) !== forcedValue) errors.push('a forced «Тема» was not applied after a reload');
await themeGroup.getByRole('button', { name: forcedName, exact: true }).and(page.locator('[aria-pressed="true"]')).waitFor();
await themeGroup.getByRole('button', { name: 'Как в системе', exact: true }).click();
await page.waitForFunction(() => !document.documentElement.dataset.appearance);
// The installed browser app opens offline: the worker is registered here (never in Telegram).
const swScope = await page.evaluate(() =>
  Promise.race([navigator.serviceWorker.ready.then((reg) => reg.scope), new Promise((resolve) => setTimeout(() => resolve(null), 5000))]),
);
if (swScope !== baseUrl) errors.push(`the service worker is not registered for ${baseUrl}: ${swScope}`);

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
  // The flask: states, the level-up choreography mid-flight, rings, the milestone sheet, the TopCard.
  await page.getByRole('button', { name: 'Play level-up', exact: true }).scrollIntoViewIfNeeded();
  await shot('styleguide-flask');
  await page.getByRole('button', { name: 'Play level-up', exact: true }).click();
  await page.waitForTimeout(900); // rise done, overflow burst on screen
  await page.screenshot({ path: `${outDir}/${String(++n).padStart(2, '0')}-styleguide-levelup-overflow.png` });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Лист вехи' }).click();
  await page.locator('.milestone-sheet').waitFor();
  await shot('styleguide-milestone-sheet');
  await page.locator('.milestone-sheet').getByRole('button', { name: 'Решу позже' }).click();
  await page.locator('.milestone-sheet').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'TopCard' }).click();
  await levelCard.waitFor();
  await shot('styleguide-topcard');
  await levelCard.click();
  await levelCard.waitFor({ state: 'detached' });
  // Medals in every look, and the «Новая ачивка» card: one, then four told as one.
  await page.getByRole('button', { name: 'Четыре сразу' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Четыре сразу' }).click();
  await achCard(/и ещё 3 ачивки/).waitFor();
  await shot('styleguide-achievement-card');
  await achCard(/и ещё 3 ачивки/).waitFor({ state: 'detached', timeout: 6000 });
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

// Demo data (dev server only): a seeded month of history on the «Ачивки» tab and the home tile.
{
  const seedContext = await browser.newContext(contextOptions);
  await setupContext(seedContext);
  const seedPage = await openPage(seedContext);
  await seedPage.goto(baseUrl);
  await seedPage.getByText('Первый навык').first().waitFor();
  if (await seedPage.evaluate(() => typeof window.__skillFlask?.seed === 'function')) {
    await seedPage.evaluate(() => window.__skillFlask.seed({ days: 60, seed: 7 }));
    const previous = page;
    page = seedPage;
    // The seed writes through the real services, so its first skill and steps queue cards; a
    // fresh load starts without them (nothing is ever celebrated on load).
    await page.goto(`${baseUrl}#/skills`);
    await page.reload();
    await page.locator('.tile--achievement').waitFor();
    await shot('seed-home');
    await page.goto(`${baseUrl}#/achievements`);
    await page.getByRole('img', { name: /^Получено \d+ из 49$/ }).waitFor();
    await shot('seed-achievements');
    await page.getByRole('heading', { name: 'Значки' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot('seed-achievements-badges');
    page = previous;
  } else {
    console.log('seeded achievements: skipped (the seed exists in DEV builds only)');
  }
  await seedContext.close();
}

// ---- Inside a fake Telegram: restore offer, cloud status, background flush ----

/** The cloud layout of src/platform/cloud.ts, built independently here as a cross-check. */
function cloudStoreFor(json) {
  const payload = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  const file = JSON.parse(json);
  const store = {};
  const n = Math.ceil(payload.length / 4000);
  for (let i = 0; i < n; i++) store[`sf_a_${String(i).padStart(3, '0')}`] = payload.slice(i * 4000, (i + 1) * 4000);
  store.sf_meta = JSON.stringify({
    v: 1,
    at: file.exportedAt,
    n,
    len: payload.length,
    h: createHash('sha256').update(payload).digest('hex').slice(0, 16),
    enc: 'gz',
    slot: 'a',
    schemaVersion: file.schemaVersion,
    skills: file.tables.skills.length,
    completions: file.tables.completions.filter((c) => c.status === 'ACTIVE').length,
  });
  return store;
}

// The installed browser app starts offline (package 12): once the worker has precached the
// build and controls the page, a reload with the network off still opens the app — with its
// data: the backup is imported first (one skill in the pizza theme, a lazy chunk), then the
// skill and Today are opened offline.
{
  const offlineBackup = JSON.parse(readFileSync(backupPath, 'utf8'));
  const offlineSkill = offlineBackup.tables.skills.find((skill) => skill.status === 'ACTIVE');
  offlineSkill.theme = 'pizza';
  const offlineBackupPath = `${outDir}/backup-offline.json`;
  writeFileSync(offlineBackupPath, JSON.stringify(offlineBackup));
  const offlineContext = await browser.newContext(contextOptions);
  await setupContext(offlineContext);
  page = await openPage(offlineContext);
  await page.goto(baseUrl);
  await page.getByText('Первый навык').waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  await tab('Настройки').click();
  await page.getByRole('button', { name: 'Загрузить из файла…' }).click();
  const offlineImport = page.locator('.import-sheet');
  await offlineImport.locator('input[type="file"]').setInputFiles(offlineBackupPath);
  await offlineImport.getByRole('button', { name: 'Заменить данные' }).click();
  await page.locator('.sheet', { has: page.getByRole('button', { name: 'Заменить', exact: true }) }).getByRole('button', { name: 'Заменить', exact: true }).click();
  await page.getByText('Импортировано').waitFor();
  await offlineContext.setOffline(true);
  await page.goto(`${baseUrl}#/skills/${offlineSkill.id}`);
  await page.reload();
  await page.locator('h1.screen-title', { hasText: offlineSkill.name }).waitFor();
  await page.locator('.pizza-svg').waitFor();
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) errors.push('the offline start was not served by the service worker');
  await page.waitForTimeout(600);
  await shot('offline-start-skill');
  await page.goto(`${baseUrl}#/today`);
  await page.locator('.today-group').first().waitFor();
  await page.waitForTimeout(400);
  await shot('offline-start-today');
  await offlineContext.setOffline(false);
  await offlineContext.close();
}

// Safari on an iPhone has no install prompt: the row opens the instructions (package 12).
{
  const iosContext = await browser.newContext({
    ...contextOptions,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await setupContext(iosContext);
  page = await openPage(iosContext);
  await page.goto(`${baseUrl}#/settings`);
  await page.getByRole('button', { name: 'Добавить на главный экран' }).click();
  const iosSheet = page.locator('.install-sheet');
  await iosSheet.getByText('Выберите «На экран „Домой“»').waitFor();
  await settled();
  await shot('install-sheet-ios');
  await iosContext.close();
}

// Chrome on an iPhone: «Поделиться» is not at the bottom of Safari, the steps say so, and point to Safari.
{
  const criosContext = await browser.newContext({
    ...contextOptions,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  });
  await setupContext(criosContext);
  page = await openPage(criosContext);
  await page.goto(`${baseUrl}#/settings`);
  await page.getByRole('button', { name: 'Добавить на главный экран' }).click();
  const criosSheet = page.locator('.install-sheet');
  await criosSheet.getByText('Откройте меню «Поделиться» браузера').waitFor();
  if (await criosSheet.getByText(/внизу Safari/).count()) errors.push('Chrome on iOS got Safari’s instructions');
  await settled();
  await shot('install-sheet-ios-chrome');
  await criosContext.close();
}

// Skill templates (v0.5 package 16), in their own context: a first run on an empty database
// leads to the templates — popular chips in the empty states, the chooser (390 and 320 px), the
// template «Бег» prefilled with its actions, one switched off and one edited in the sheet, «Назад»
// back to the chooser with the card marked, the same card with those edits kept, the skill
// created with its actions — and «Свой
// навык» still opens the empty form.
{
  const templateContext = await browser.newContext(contextOptions);
  await setupContext(templateContext);
  page = await openPage(templateContext);
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const scrollToHeading = (locator) =>
    locator.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector('.screen-header').offsetHeight - 8));
  const popular = page.getByRole('list', { name: 'Популярные шаблоны' });
  await page.goto(baseUrl);
  await popular.waitFor();
  await shot('first-run-templates');
  await tab('Сегодня').click();
  await page.getByText('Начните с навыка').waitFor();
  await popular.waitFor();
  await shot('first-run-today');

  const templates = page.getByRole('list', { name: 'Шаблоны навыков' });
  const templateCard = (name) => templates.getByRole('link', { name: new RegExp(`^${name}`) });
  // Every card's text fits its card: nothing cut, nothing sideways.
  const clippedCards = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.template-card-name, .template-card-text')].filter((el) => el.scrollWidth > el.clientWidth + 0.5).map((el) => el.textContent),
    );
  const minisLoaded = () => page.waitForFunction(() => document.querySelectorAll('.template-card .progress-mini-placeholder').length === 0);
  await page.getByRole('link', { name: 'Все шаблоны' }).click();
  await templates.waitFor();
  await minisLoaded();
  if ((await templates.getByRole('link').count()) !== 13) errors.push('the chooser does not list «Свой навык» and 12 templates');
  await shot('template-chooser');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('template-chooser-end');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  if ((await sideways()) > 0) errors.push(`the template chooser scrolls sideways by ${await sideways()}px at 320 px`);
  if ((await clippedCards()).length) errors.push(`template cards cut at 320 px: ${await clippedCards()}`);
  await shot('template-chooser-320');
  await page.setViewportSize({ width: 390, height: 844 });

  // «Бег»: the form prefilled, its actions all on, what they bring as planned.
  await templateCard('Бег').click();
  const actionsHeading = page.getByRole('heading', { name: 'Действия из шаблона' });
  await actionsHeading.waitFor();
  if ((await page.getByLabel('Название', { exact: true }).inputValue()) !== 'Бег') errors.push('the template «Бег» did not fill the name');
  if ((await page.getByRole('checkbox', { checked: true }).count()) !== 3) errors.push('the template actions are not all on');
  await settled();
  await shot('template-form');
  await scrollToHeading(actionsHeading);
  await page.getByText(/^По плану поездка 1\s+завершится/).waitFor();
  await shot('template-form-actions');
  await page.getByRole('checkbox', { name: /^Растяжка после бега/ }).click();
  await page.getByRole('button', { name: 'Изменить: Пробежка' }).click();
  const actionSheet = page.locator('.template-action-sheet');
  await actionSheet.getByLabel('Очков за минуту').waitFor();
  await settled();
  await shot('template-action-sheet');
  await actionSheet.getByLabel('Очков за минуту').fill('0,6');
  await actionSheet.getByRole('button', { name: 'Готово' }).click();
  await actionSheet.waitFor({ state: 'detached' });
  await page.getByText(/^0,6\/мин/).waitFor();
  await scrollToHeading(actionsHeading);
  await page.waitForTimeout(300);
  await shot('template-form-edited');
  await page.setViewportSize({ width: 320, height: 700 });
  await scrollToHeading(actionsHeading);
  await page.waitForTimeout(300);
  if ((await sideways()) > 0) errors.push(`the template form scrolls sideways by ${await sideways()}px at 320 px`);
  await shot('template-form-320');
  await page.setViewportSize({ width: 390, height: 844 });

  // «Назад» puts the chooser back with «Бег» marked; the same card opens the template again.
  await page.getByRole('button', { name: 'Назад' }).click();
  await templates.waitFor();
  await minisLoaded();
  if ((await templateCard('Бег').getAttribute('aria-current')) !== 'true') errors.push('«Назад» from the template form lost the chosen card');
  // …and marked visibly in every mode (a dark-mode hairline once overrode the ring).
  const chosenRing = await templateCard('Бег').evaluate((card) => getComputedStyle(card).boxShadow);
  if (!/\b2px inset|inset .*\b2px\b/.test(chosenRing)) errors.push(`the chosen template card has no 2px ring: ${chosenRing}`);
  await page.waitForTimeout(400);
  await shot('template-chooser-back');
  // The same card brings the form back as it was left: «Растяжка» off, «Пробежка» at 0,6/мин.
  // «Растяжка» goes back on, so the skill gets all three actions.
  await templateCard('Бег').click();
  await actionsHeading.waitFor();
  const stretching = page.getByRole('checkbox', { name: /^Растяжка после бега/ });
  if (await stretching.isChecked()) errors.push('choosing «Бег» again lost the unchecked action');
  if (!(await page.getByText(/^0,6\/мин/).count())) errors.push('choosing «Бег» again lost the edited action');
  await stretching.click();
  await page.getByRole('button', { name: 'Создать навык' }).click();
  // The skill screen with its three actions. Its cards come and go: «Первый навык», then
  // «Набор инструментов» (three actions on one skill's list).
  await page.waitForURL(/#\/skills\/(?!new)[^/?]+$/);
  await page.locator('.step-row', { hasText: 'Длинная пробежка' }).waitFor();
  for (const title of ['Первый навык', 'Набор инструментов']) {
    await achCard(title).waitFor({ timeout: 15000 });
    await achCard(title).waitFor({ state: 'detached', timeout: 15000 });
  }
  await shot('template-skill');
  await scrollToHeading(page.getByRole('heading', { name: 'Действия', exact: true }));
  await page.waitForTimeout(300);
  await shot('template-skill-actions');
  if ((await page.locator('.step-row').count()) !== 3) errors.push(`the template skill has ${await page.locator('.step-row').count()} actions, not 3`);

  // «Свой навык» is still the empty form.
  await page.goto(`${baseUrl}#/skills`);
  await page.getByRole('link', { name: 'Новый навык' }).first().click();
  await templates.waitFor();
  await customCard().click();
  await page.getByRole('heading', { name: 'Оформление' }).waitFor();
  if ((await page.getByLabel('Название', { exact: true }).inputValue()) !== '') errors.push('«Свой навык» did not open the empty form');
  if (await actionsHeading.count()) errors.push('«Свой навык» shows template actions');
  await settled();
  await shot('template-custom-form');
  await templateContext.close();
}

// Notes and search (v0.5 package 17), in their own context on the templates «Английский» and
// «Гитара»: the completion toast's «Заметка» opens the completion sheet with the note focused;
// «Сколько минут?» has a note field written with the completion; the skill's «Поиск по истории»
// marks the matched words, «С заметками» filters, a miss says «Ничего не нашлось»; «Спрашивать
// заметку после каждого действия» opens the sheet by itself after a ✓; the home screen's search
// icon opens the search of every skill, grouped by skill, and a result opens its skill with that
// completion's sheet. 320 px and the three modes, nothing sideways.
{
  const notesContext = await browser.newContext(contextOptions);
  await setupContext(notesContext);
  page = await openPage(notesContext);
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const scrollToHeading = (locator) =>
    locator.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector('.screen-header').offsetHeight - 8));
  const toast = page.locator('.toast');
  const noteSheet = page.locator('.completion-sheet');
  const minutesSheet = page.locator('.minutes-sheet');
  const marks = page.locator('.mark-sheet');
  const noteFocused = () => page.waitForFunction(() => document.activeElement?.matches('.completion-sheet textarea'), null, { timeout: 5000 }).then(() => true, () => false);
  const fromTemplate = async (key, cards) => {
    await page.goto(`${baseUrl}#/skills/new/${key}`);
    await page.getByRole('heading', { name: 'Действия из шаблона' }).waitFor();
    await page.getByRole('button', { name: 'Создать навык' }).click();
    await page.waitForURL(/#\/skills\/(?!new)[^/?]+$/);
    for (const title of cards) {
      await achCard(title).waitFor({ timeout: 15000 });
      await achCard(title).waitFor({ state: 'detached', timeout: 15000 });
    }
    return page.url();
  };
  // A ✓ once the row is idle again (the same-tap window of the last one has passed).
  const tapRow = async (name) => {
    const row = page.locator('.step-row', { hasText: name });
    await row.locator('.check-button[aria-busy="false"]').waitFor();
    await row.locator('.check-button').click();
  };

  const englishUrl = await fromTemplate('english', ['Первый навык', 'Набор инструментов']);
  await tapRow('Новые слова');
  await toast.getByRole('button', { name: 'Заметка' }).waitFor();
  if ((await toast.getByRole('button').allTextContents()).join('|') !== 'Заметка|Отменить') errors.push('the completion toast does not offer «Заметка» before «Отменить»');
  const toastOverflow = await toast.evaluate((el) => el.scrollWidth - el.clientWidth);
  if (toastOverflow > 0) errors.push(`the completion toast overflows by ${toastOverflow}px`);
  await shot('notes-toast');
  await toast.getByRole('button', { name: 'Заметка' }).click();
  await noteSheet.waitFor();
  if (!(await noteFocused())) errors.push('«Заметка» did not focus the note field');
  await page.keyboard.type('Выучил 15 слов про путешествия и вокзал');
  await settled();
  await shot('notes-sheet-focused');
  await noteSheet.getByRole('button', { name: 'Сохранить' }).click();
  await page.getByText('Заметка сохранена').waitFor();
  await noteSheet.waitFor({ state: 'detached' });

  // «Сколько минут?»: the note under the minutes goes into the same write.
  await tapRow('Разговорная практика');
  await minutesSheet.waitFor();
  await minutesSheet.getByLabel('Заметка').fill('Обсуждали погоду и планы на выходные');
  await settled();
  await shot('notes-minutes-sheet');
  await minutesSheet.getByRole('button', { name: 'Готово' }).click();
  await minutesSheet.waitFor({ state: 'detached' });
  await toast.getByText('+15 · Разговорная практика').waitFor();
  await page.waitForTimeout(600);
  if (await noteSheet.count()) errors.push('a note sheet opened after «Сколько минут?» with the setting off');
  await tapRow('Новые слова');
  await toast.getByText('+5 · Новые слова').waitFor();
  // A mark whose description matches too.
  await skillMenu('Добавить засечку');
  await marks.getByLabel('Название').fill('Пробный тест');
  await marks.getByLabel('Описание').fill('Тема — путешествия, 7 из 10');
  await marks.getByRole('button', { name: 'Сохранить' }).click();
  await page.getByText('Засечка добавлена').waitFor();
  await marks.waitFor({ state: 'detached' });
  await toast.waitFor({ state: 'detached', timeout: 10000 });

  // The skill's «Поиск по истории».
  const historySearch = page.getByRole('searchbox', { name: 'Поиск по истории' });
  await historySearch.waitFor();
  await scrollToHeading(page.getByRole('heading', { name: 'История', exact: true }));
  await page.waitForTimeout(300);
  await shot('history-search-field');
  await historySearch.fill('путешеств');
  await page.getByText('Найдено: 2').waitFor();
  const hits = await page.locator('.search-results mark').allTextContents();
  if (hits.length !== 2 || hits.some((hit) => hit.toLowerCase() !== 'путешеств')) errors.push(`the history search marks ${JSON.stringify(hits)}`);
  await scrollToHeading(page.getByRole('heading', { name: 'История', exact: true }));
  await page.waitForTimeout(300);
  await shot('history-search');
  await page.getByRole('button', { name: 'Очистить поиск' }).click();
  await page.getByRole('group', { name: 'Что искать' }).getByRole('button', { name: 'С заметками' }).click();
  await page.getByText('Найдено: 2').waitFor();
  // «Найдено: 2» of the cleared query may still be on screen for a moment: wait for the filter's own results.
  const twoNotes = await page
    .waitForFunction(() => document.querySelectorAll('.search-results .history-note').length === 2, null, { timeout: 5000 })
    .then(() => true, () => false);
  if (!twoNotes) errors.push('«С заметками» does not list the two notes');
  await scrollToHeading(page.getByRole('heading', { name: 'История', exact: true }));
  await page.waitForTimeout(300);
  await shot('history-search-notes');
  await historySearch.fill('футбол');
  await page.getByText('Ничего не нашлось').waitFor();
  await page.setViewportSize({ width: 320, height: 568 });
  await historySearch.fill('путешеств');
  await page.getByText('Найдено: 1').waitFor();
  await scrollToHeading(page.getByRole('heading', { name: 'История', exact: true }));
  await page.waitForTimeout(300);
  if ((await sideways()) > 0) errors.push(`the history search scrolls sideways by ${await sideways()}px at 320 px`);
  await shot('history-search-320');
  await page.setViewportSize(contextOptions.viewport);
  await page.getByRole('group', { name: 'Что искать' }).getByRole('button', { name: 'Все' }).click();
  await page.getByRole('button', { name: 'Очистить поиск' }).click();

  // «Спрашивать заметку после каждого действия»: the sheet opens by itself after a ✓.
  await page.goto(`${baseUrl}#/settings`);
  const askNote = page.getByRole('switch', { name: 'Спрашивать заметку после каждого действия' });
  await askNote.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector('input[role="switch"]:disabled'));
  await askNote.check();
  await page.waitForTimeout(300);
  await askNote.evaluate((el) => el.closest('.settings-group').scrollIntoView({ block: 'center' }));
  await shot('settings-ask-note');
  await page.goto(englishUrl);
  await tapRow('Новые слова');
  await noteSheet.waitFor();
  if (!(await noteFocused())) errors.push('«Спрашивать заметку» opened the sheet without focusing the note');
  await settled();
  await shot('notes-auto-ask');
  await page.keyboard.press('Escape');
  await noteSheet.waitFor({ state: 'detached' });
  await page.waitForTimeout(400);
  if (await page.getByText('Заметка сохранена').count()) errors.push('closing the asked sheet empty saved a note');
  // The switch stays on for the rest of this context.

  // A second skill with a matching note, for the search of every skill.
  await fromTemplate('guitar', []);
  await tapRow('Практика');
  await minutesSheet.waitFor();
  await minutesSheet.getByLabel('Заметка').fill('Разобрал песню про путешествия');
  await minutesSheet.getByRole('button', { name: 'Готово' }).click();
  await toast.getByText(/· Практика$/).waitFor();
  await page.waitForTimeout(600);
  if (await noteSheet.count()) errors.push('«Спрашивать заметку» asked again after «Сколько минут?»');

  // The home header's search: every skill, grouped by skill, the latest hit first (once the
  // toast and the achievement card of that completion have gone, so they cover nothing).
  await toast.waitFor({ state: 'detached', timeout: 10000 });
  await page.locator('.ach-card').waitFor({ state: 'detached', timeout: 15000 });
  await page.goto(`${baseUrl}#/skills`);
  await page.locator('.skill-card').first().waitFor();
  await page.getByRole('link', { name: 'Поиск по истории' }).click();
  const globalField = page.getByRole('searchbox', { name: 'Поиск по всем навыкам' });
  await globalField.waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('input[type="search"]'), null, { timeout: 5000 }).catch(() => errors.push('the search screen did not focus its field'));
  await shot('search-empty');
  await globalField.fill('путешеств');
  await page.getByText('Найдено: 3').waitFor();
  const groupTitles = await page.locator('.search-group-title').allTextContents();
  if (groupTitles.join('|') !== 'Гитара|Английский') errors.push(`the search groups read ${JSON.stringify(groupTitles)}`);
  await page.waitForTimeout(300);
  await shot('search-results');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(300);
  if ((await sideways()) > 0) errors.push(`the search screen scrolls sideways by ${await sideways()}px at 320 px`);
  await shot('search-results-320');
  await page.setViewportSize(contextOptions.viewport);
  // A result opens its skill with the completion's sheet; «Назад» twice comes back to the results.
  await page.locator('.search-group', { hasText: 'Английский' }).getByRole('button', { name: /Новые слова/ }).click();
  await page.waitForURL(/#\/skills\/[^/?]+$/);
  await noteSheet.getByRole('textbox').waitFor();
  if ((await noteSheet.getByRole('textbox').inputValue()) !== 'Выучил 15 слов про путешествия и вокзал') errors.push('a search result opened another completion');
  await settled();
  await shot('search-opened');
  await page.goBack();
  await noteSheet.waitFor({ state: 'detached' });
  await page.goBack();
  await globalField.waitFor();
  if ((await globalField.inputValue()) !== 'путешеств') errors.push('«Назад» from a result lost the search');
  await page.getByText('Найдено: 3').waitFor();
  await notesContext.close();
}

// Pause and the compact «Сегодня» (v0.5 package 18), in their own context on an imported history
// of six skills (a schema-5 backup built here: «Английский» practised daily until two days ago,
// yesterday a day the whole app rested — the week strip draws it neutral — and «Чтение» back
// from a pause that ended yesterday, told once after the next start). Six skills make «Сегодня»
// compact: «Осталось» skill by skill with colour dots and «Ещё 1», «Сделано» folded into one
// line. Then «Гитара» goes on pause for a week from its ⋯ menu: the sheet, the pill on its screen
// and card, «Сегодня» without it and the line «На паузе: Гитара до …»; «Лучшая серия» is the
// same before and after; «Снять паузу» brings it back. 320 px and the three modes.
{
  const pauseContext = await browser.newContext(contextOptions);
  await setupContext(pauseContext);
  page = await openPage(pauseContext);
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const forbidden = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|отста/i;
  await page.goto(baseUrl);
  await page.getByText('Первый навык').first().waitFor();
  const today = await page.evaluate(() => {
    const d = new Date();
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((v) => String(v).padStart(2, '0')).join('-');
  });
  const shiftDate = (date, days) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  const at = (date, hour = 10) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).toISOString();
  const yesterday = shiftDate(today, -1);
  const start = shiftDate(today, -30);

  // The backup: six skills (created a month ago), daily actions, a history, three kinds of pause.
  const spec = [
    { id: 'skill-guitar', name: 'Гитара', theme: 'flask', color: 'amber', steps: ['Аккорды', 'Гаммы', 'Песня', 'Ритм'] },
    { id: 'skill-english', name: 'Английский', theme: 'flask', color: 'sky', steps: ['Разговор', 'Новые слова'] },
    { id: 'skill-running', name: 'Бег', theme: 'car', color: 'green', steps: ['Пробежка'] },
    { id: 'skill-reading', name: 'Чтение', theme: 'book', color: 'violet', steps: ['Глава'] },
    { id: 'skill-yoga', name: 'Йога', theme: 'flask', color: 'teal', steps: ['Растяжка'] },
    { id: 'skill-chess', name: 'Шахматы', theme: 'flask', color: 'coral', steps: ['Задача'] },
  ];
  const tables = { skills: [], milestones: [], levelThresholds: [], steps: [], completions: [], transactions: [], settings: [], achievementUnlocks: [], marks: [], pauses: [] };
  for (const [i, s] of spec.entries()) {
    const created = at(start, 8 + i);
    tables.skills.push({
      id: s.id, name: s.name, description: '', status: 'ACTIVE', startLabel: '', targetLabel: '', capacityBase: 100, capacityIncrement: 50,
      completedAt: null, archivedAt: null, originSkillId: null, theme: s.theme, color: s.color, createdAt: created, updatedAt: created,
    });
    tables.milestones.push({ id: `ms-${s.id}`, skillId: s.id, name: 'Цель', targetFlaskNumber: 5, reachedAt: null, decision: null, createdAt: created, updatedAt: created });
    s.steps.forEach((name, k) => {
      tables.steps.push({
        id: `${s.id}-step-${k}`, skillId: s.id, name, type: 'BOOLEAN', points: 5, pointsPerMinute: null, defaultMinutes: null,
        schedule: { kind: 'DAILY' }, scheduleFrom: start, isActive: true, createdAt: at(start, 8 + i), updatedAt: at(start, 8 + i),
      });
    });
  }
  let seq = 0;
  const complete = (stepId, date) => {
    const step = tables.steps.find((s) => s.id === stepId);
    const id = `c-${++seq}`;
    const createdAt = new Date(new Date(at(date, 18)).getTime() + seq * 1000).toISOString();
    tables.completions.push({
      id, skillId: step.skillId, stepId, stepName: step.name, stepType: 'BOOLEAN', pointsSnapshot: 5, durationMinutes: null, pointsAwarded: 5,
      date, source: 'SCHEDULED', status: 'ACTIVE', cancelledAt: null, note: null, createdAt, updatedAt: createdAt,
    });
    tables.transactions.push({ id: `t-${seq}`, skillId: step.skillId, completionId: id, delta: 5, reason: 'COMPLETION', createdAt });
  };
  // «Английский» every day for eleven days up to the day before yesterday; the others now and then.
  for (let d = 12; d >= 2; d--) complete('skill-english-step-0', shiftDate(today, -d));
  for (const d of [9, 6, 3]) complete('skill-running-step-0', shiftDate(today, -d));
  for (const d of [8, 4]) complete('skill-guitar-step-0', shiftDate(today, -d));
  // «Чтение» rested five days up to yesterday, not told yet; the rest rested yesterday only (told).
  tables.pauses.push({ id: 'p-reading', skillId: 'skill-reading', from: shiftDate(today, -5), until: yesterday, createdAt: at(shiftDate(today, -5), 9), endedAt: null });
  for (const s of spec.filter((x) => x.id !== 'skill-reading')) {
    tables.pauses.push({ id: `p-${s.id}`, skillId: s.id, from: yesterday, until: yesterday, createdAt: at(yesterday, 9), endedAt: at(today, 7) });
  }
  const pauseBackup = `${outDir}/backup-pause.json`;
  writeFileSync(pauseBackup, JSON.stringify({ format: 'skill-flask-backup', schemaVersion: 5, appVersion: 'walkthrough', exportedAt: at(today, 7), installId: 'walkthrough', tables }));

  await tab('Настройки').click();
  await page.getByRole('button', { name: 'Загрузить из файла…' }).click();
  await page.locator('.import-sheet input[type="file"]').setInputFiles(pauseBackup);
  await page.locator('.import-sheet').getByText(/^Навыков: 6/).waitFor();
  await page.locator('.import-sheet').getByRole('button', { name: 'Заменить данные' }).click();
  await page.locator('.sheet', { has: page.getByRole('button', { name: 'Заменить', exact: true }) }).getByRole('button', { name: 'Заменить', exact: true }).click();
  await page.getByText('Импортировано').waitFor();

  // The next start: «Чтение» is back, said once.
  await page.goto(`${baseUrl}#/today`);
  await page.reload();
  await page.locator('.toast', { hasText: 'Чтение снова в плане' }).waitFor({ timeout: 10000 });
  await shot('pause-return-toast');
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });

  // Six skills: compact. «Гитара» (four rows) first, three shown and «Ещё 1».
  const remaining = page.locator('.today-due');
  await remaining.locator('.step-row').first().waitFor();
  if ((await remaining.locator('.step-row-name').first().innerText()) !== 'Аккорды') errors.push('the busiest skill does not lead a compact «Осталось»');
  if ((await remaining.locator('.step-row .step-row-dot').count()) === 0) errors.push('a compact «Осталось» has no colour dots');
  const dueMore = remaining.getByRole('button', { name: 'Показать ещё 1 действие: Гитара' });
  await dueMore.waitFor();
  // Yesterday, when everything rested: a dash, not an empty day.
  const restDay = page.getByRole('group', { name: 'День для отметок' }).getByRole('button', { name: /: пауза$/ });
  if ((await restDay.count()) !== 1) errors.push(`the week strip shows ${await restDay.count()} rest days, expected yesterday`);
  await shot('today-compact');
  await dueMore.click();
  await remaining.getByText('Ритм').waitFor();
  await shot('today-compact-more');
  const tapRow = async (name) => {
    const row = page.locator('.today-due .step-row', { hasText: name });
    await row.locator('.check-button[aria-busy="false"]').waitFor();
    await row.locator('.check-button').click();
    await page.locator('.toast').waitFor();
  };
  await tapRow('Разговор');
  await tapRow('Пробежка');
  const doneFold = page.locator('details.today-done-fold');
  await doneFold.locator('summary', { hasText: 'Отмечено: 2 · +10 очков' }).waitFor();
  if (await page.getByRole('heading', { name: 'Сделано сегодня' }).count()) errors.push('a compact «Сегодня» still lists «Сделано сегодня» as a section');
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('today-compact-done');
  await doneFold.locator('summary').click();
  await doneFold.locator('.done-row').first().waitFor();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('today-compact-done-open');
  // The fold is remembered.
  await page.reload();
  await page.locator('details.today-done-fold[open] .done-row').first().waitFor();
  // Nothing of it for Гитара: the streak record before the pause.
  await tab('Ачивки').click();
  const streakRow = page.locator('.records .info-row', { hasText: 'Лучшая серия' });
  await streakRow.waitFor();
  const streakBefore = await streakRow.innerText();

  // «Поставить на паузу» from the ⋯ menu of «Гитара»: a week.
  await page.goto(`${baseUrl}#/skills/skill-guitar`);
  await page.locator('.hero').waitFor();
  await page.getByRole('button', { name: 'Меню навыка' }).click();
  const menu = page.locator('.sheet', { has: page.getByRole('button', { name: 'Добавить засечку' }) });
  await menu.getByRole('button', { name: 'Поставить на паузу' }).click();
  await menu.waitFor({ state: 'detached' });
  const pauseSheet = page.locator('.pause-sheet');
  await pauseSheet.getByRole('radio', { name: /^На неделю/ }).waitFor();
  if (forbidden.test(await pauseSheet.innerText())) errors.push('the pause sheet pressures the user');
  await settled();
  await shot('pause-sheet');
  await pauseSheet.getByRole('radio', { name: 'До даты…' }).click();
  await pauseSheet.getByLabel('Последний день паузы').waitFor();
  await settled();
  await shot('pause-sheet-date');
  await pauseSheet.getByRole('radio', { name: /^На неделю/ }).click();
  await pauseSheet.getByRole('button', { name: 'Поставить на паузу' }).click();
  await pauseSheet.waitFor({ state: 'detached' });
  const pill = page.locator('.pause-line .pause-pill');
  await pill.waitFor();
  if (!/^На паузе до \d+\s\S+$/.test((await pill.innerText()).replace(/ /g, ' '))) errors.push(`the skill's pill reads «${await pill.innerText()}»`);
  await page.locator('.toast', { hasText: 'Гитара на паузе до' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('skill-paused');
  if (await page.locator('.forecast-line').count()) errors.push('a skill on pause shows a forecast');
  // Still completes from its screen.
  await page.locator('.actions .step-row', { hasText: 'Гаммы' }).locator('.check-button').click();
  await page.locator('.toast', { hasText: 'Гаммы' }).waitFor();
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });

  // «Сегодня» without it, and the line at the end.
  await page.goto(`${baseUrl}#/today`);
  const pausedLine = page.locator('.today-paused');
  await pausedLine.waitFor();
  if (!/^На паузе: Гитара до \d+\s\S+$/.test((await pausedLine.innerText()).replace(/ /g, ' ').trim())) errors.push(`the pause line reads «${await pausedLine.innerText()}»`);
  if (await page.locator('.today-due .step-row', { hasText: 'Аккорды' }).count()) errors.push('a paused skill is still in «Осталось»');
  if (forbidden.test(await page.locator('.screen-body').innerText())) errors.push('«Сегодня» with a pause pressures the user');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('today-paused');
  // «Итоги недели» of this week: who rested, and for how long — not silence.
  const weekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  await page.goto(`${baseUrl}#/recap/${shiftDate(today, 1 - weekday)}`);
  const restSection = page.locator('.recap-section', { has: page.getByRole('heading', { name: 'Отдых' }) });
  await restSection.locator('.info-row', { hasText: 'Гитара' }).waitFor();
  if (!(await restSection.locator('.info-row', { hasText: 'Чтение' }).innerText()).includes('дн')) errors.push('«Отдых» does not count the days of «Чтение»');
  await restSection.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot('recap-rest');
  // Records unaffected: the streak record stays what it was.
  await page.goto(`${baseUrl}#/achievements`);
  await streakRow.waitFor();
  if ((await streakRow.innerText()) !== streakBefore) errors.push(`«Лучшая серия» changed with a pause: ${streakBefore} → ${await streakRow.innerText()}`);
  // The home card's pill.
  await tab('Навыки').click();
  const card = page.locator('.skill-card', { hasText: 'Гитара' });
  await card.locator('.pause-pill').waitFor();
  await card.scrollIntoViewIfNeeded();
  await shot('home-paused');

  // A second pause «пока не сниму» leaves four skills in the plan: «Сегодня» as before.
  await page.goto(`${baseUrl}#/skills/skill-chess`);
  await page.locator('.hero').waitFor();
  await page.getByRole('button', { name: 'Меню навыка' }).click();
  await menu.getByRole('button', { name: 'Поставить на паузу' }).click();
  await pauseSheet.getByRole('radio', { name: 'Пока не сниму' }).click();
  await pauseSheet.getByRole('button', { name: 'Поставить на паузу' }).click();
  await pauseSheet.waitFor({ state: 'detached' });
  await page.locator('.pause-line .pause-pill', { hasText: /^На паузе$/ }).waitFor();
  await page.goto(`${baseUrl}#/today`);
  await page.getByRole('heading', { name: 'Сделано сегодня' }).waitFor();
  if (await page.locator('.today-due .step-row-dot').count()) errors.push('four skills in the plan still get the compact «Осталось»');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('today-paused-two');

  // 320 px: the pill, the sheet, «Сегодня» with the line; nothing sideways.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${baseUrl}#/skills/skill-guitar`);
  await pill.waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  if ((await sideways()) > 0) errors.push(`a paused skill's screen scrolls sideways by ${await sideways()}px at 320 px`);
  await shot('skill-paused-320');
  await page.getByRole('button', { name: 'Меню навыка' }).click();
  await menu.getByRole('button', { name: 'Изменить дату' }).click();
  await pauseSheet.getByRole('radio', { name: 'До даты…' }).waitFor();
  const optionOverflow = await pauseSheet.locator('.pause-option').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 0.5).length);
  if (optionOverflow) errors.push(`${optionOverflow} pause options overflow at 320 px`);
  await settled();
  await shot('pause-sheet-320');
  await page.keyboard.press('Escape');
  await pauseSheet.waitFor({ state: 'detached' });
  await page.goto(`${baseUrl}#/today`);
  await pausedLine.waitFor();
  if ((await sideways()) > 0) errors.push(`«Сегодня» with the pause line scrolls sideways by ${await sideways()}px at 320 px`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('today-paused-320');
  await tab('Навыки').click();
  await card.locator('.pause-pill').waitFor();
  await card.scrollIntoViewIfNeeded();
  if ((await sideways()) > 0) errors.push(`the home screen with a paused card scrolls sideways by ${await sideways()}px at 320 px`);
  await shot('home-paused-320');
  await page.setViewportSize({ width: 390, height: 844 });

  // «Снять паузу» beside the pill: back in the plan today.
  await page.goto(`${baseUrl}#/skills/skill-guitar`);
  await page.locator('.pause-line').getByRole('button', { name: 'Снять паузу' }).click();
  await page.locator('.toast', { hasText: 'Пауза снята' }).waitFor();
  await page.locator('.pause-line').waitFor({ state: 'detached' });
  await shot('skill-unpaused');
  await page.goto(`${baseUrl}#/today`);
  await page.locator('.today-due .step-row', { hasText: 'Аккорды' }).waitFor();
  if (!/^На паузе: Шахматы$/.test((await pausedLine.innerText()).trim())) errors.push(`after «Снять паузу» the pause line reads «${await pausedLine.innerText()}»`);

  // Every skill on pause (the same history, each skill resting «пока не сниму» since
  // yesterday): «Сегодня» says so calmly, with the line naming them all; nothing to plan.
  const allPaused = { ...tables, pauses: spec.map((s) => ({ id: `all-${s.id}`, skillId: s.id, from: yesterday, until: null, createdAt: at(yesterday, 9), endedAt: null })) };
  const allPausedBackup = `${outDir}/backup-all-paused.json`;
  writeFileSync(allPausedBackup, JSON.stringify({ format: 'skill-flask-backup', schemaVersion: 5, appVersion: 'walkthrough', exportedAt: at(today, 7), installId: 'walkthrough', tables: allPaused }));
  await tab('Настройки').click();
  await page.getByRole('button', { name: 'Загрузить из файла…' }).click();
  await page.locator('.import-sheet input[type="file"]').setInputFiles(allPausedBackup);
  await page.locator('.import-sheet').getByText(/^Навыков: 6/).waitFor();
  await page.locator('.import-sheet').getByRole('button', { name: 'Заменить данные' }).click();
  await page.locator('.sheet', { has: page.getByRole('button', { name: 'Заменить', exact: true }) }).getByRole('button', { name: 'Заменить', exact: true }).click();
  await page.getByText('Импортировано').waitFor();
  await page.goto(`${baseUrl}#/today`);
  await page.getByText('Все навыки на паузе').waitFor();
  if (await page.locator('.today-due .step-row').count()) errors.push('«Сегодня» plans an action while every skill rests');
  if (!/^На паузе: /.test((await pausedLine.innerText()).trim())) errors.push(`with every skill resting the pause line reads «${await pausedLine.innerText()}»`);
  if (forbidden.test(await page.locator('.screen-body').innerText())) errors.push('«Сегодня» with every skill on pause pressures the user');
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
  await shot('today-all-paused');
  await page.setViewportSize({ width: 320, height: 640 });
  if ((await sideways()) > 0) errors.push(`«Сегодня» with every skill on pause scrolls sideways by ${await sideways()}px at 320 px`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('today-all-paused-320');
  await page.setViewportSize({ width: 390, height: 844 });
  await pauseContext.close();
}

// Big days on a small phone: a 1 250-point action on a 320 px screen. The tile numbers shrink
// to fit instead of being cut (own context, so the walk above keeps its data).
const bigContext = await browser.newContext({ ...contextOptions, viewport: { width: 320, height: 700 } });
await setupContext(bigContext);
page = await openPage(bigContext);
await page.goto(`${baseUrl}#/skills/new/custom`);
await page.getByLabel('Название', { exact: true }).fill('Очень длинное название навыка для проверки');
await page.getByText('Дополнительно').click();
await page.getByLabel('Колб', { exact: true }).fill('3');
await page.getByLabel('Первый уровень', { exact: true }).fill('5000');
await page.getByRole('button', { name: 'Создать навык' }).click();
// A fresh start: the first skill earns «Первый навык»; a tap on its card opens it on the tab.
await achCard('Первый навык').waitFor();
await page.waitForTimeout(500);
await shot('achievement-card-320');
await achCard('Первый навык').click();
await page.waitForURL(/#\/achievements\?focus=first-skill$/);
await page.locator('.ach-tile.is-focus', { hasText: 'Первый навык' }).waitFor();
await page.waitForTimeout(400);
await shot('achievements-focus-320');
const narrowAch = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (narrowAch > 0) errors.push(`the achievements tab scrolls sideways by ${narrowAch}px at 320 px`);
await page.goBack();
await page.getByRole('button', { name: 'Создать первое действие' }).click();
await page.getByLabel('Название', { exact: true }).fill('Большой проект');
await page.getByLabel('Очки за выполнение').fill('1250');
await page.getByRole('button', { name: 'Создать действие' }).click();
await page.locator('.check-button').first().waitFor();
await page.goto(`${baseUrl}#/today`);
await page.locator('.today-group .check-button').first().click();
await page.getByText('Сделано сегодня').waitFor();
await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
const clippedTiles = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tile-number')].filter((el) => el.scrollWidth > el.clientWidth + 0.5).map((el) => el.textContent),
  );
await page.waitForTimeout(1200); // the count-up
if ((await clippedTiles()).length) errors.push(`tile numbers cut at 320 px on «Сегодня»: ${await clippedTiles()}`);
await shot('today-big-320');
await tab('Навыки').click();
await page.locator('.skill-card').first().waitFor();
await page.waitForTimeout(1200);
if ((await clippedTiles()).length) errors.push(`tile numbers cut at 320 px on the home screen: ${await clippedTiles()}`);
await shot('home-big-320');
await bigContext.close();

// Records and «Итоги недели» (package 10), in their own context: a history written through
// «Задним числом» — one completion three weeks back, nothing the week after, a full last week
// (three flasks, a timed hour) — so the recap, an empty week and the records all show.
{
  const recapContext = await browser.newContext(contextOptions);
  await setupContext(recapContext);
  page = await openPage(recapContext);
  await page.goto(`${baseUrl}#/skills/new/custom`);
  // Dates from the browser's clock (SHIFT_DAYS moves it), as local YYYY-MM-DD.
  const today = await page.evaluate(() => {
    const d = new Date();
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((v) => String(v).padStart(2, '0')).join('-');
  });
  const shiftDate = (date, days) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  const isoWeekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  /** Monday of the week `back` weeks before the current one. */
  const mondayOf = (back) => shiftDate(today, 1 - isoWeekday - 7 * back);

  await page.getByLabel('Название', { exact: true }).fill('Английский');
  await page.getByText('Дополнительно').click();
  await page.getByLabel('Первый уровень', { exact: true }).fill('20');
  await page.getByLabel('Прирост за уровень', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Создать навык' }).click();
  await page.getByRole('button', { name: 'Создать первое действие' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Разговорная практика');
  await page.getByLabel('Очки за выполнение').fill('10');
  await page.getByRole('button', { name: 'Создать действие' }).click();
  await page.locator('.check-button').first().waitFor();
  await page.getByRole('link', { name: 'Новое действие' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Чтение вслух');
  await page.getByRole('group', { name: 'Тип' }).getByRole('button', { name: 'По времени' }).click();
  await page.getByLabel('Очков за минуту').fill('0,5');
  await page.getByRole('button', { name: 'Создать действие' }).click();
  await page.getByRole('button', { name: /^Отметить: Чтение вслух/ }).waitFor();
  const skillPath = new URL(page.url()).hash.replace(/^#/, '');

  const backdate = async (step, date, minutes) => {
    await page.goto(`${baseUrl}#${skillPath}/add`);
    await page.getByText(step, { exact: true }).click();
    await page.getByLabel('Когда выполнено').fill(date);
    if (minutes) await page.getByRole('group', { name: 'Частые значения' }).getByRole('button', { name: `${minutes} мин` }).click();
    // The same action on the same date within 1.5 s is refused as a double tap.
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: minutes ? /^Записать / : 'Отметить выполненным' }).click();
    await page.waitForURL((url) => url.hash === `#${skillPath}`);
    // Let a filled flask be told on the hero before the next write; the level-up card must
    // never cover it meanwhile (watched for 1.5 s, not at one instant).
    await page.locator('.hero').waitFor();
    await page
      .locator('.top-card:not(.ach-card)')
      .waitFor({ state: 'attached', timeout: 1500 })
      .then(() => errors.push(`a backdated fill (${date}) covered the hero flask with the level-up card`), () => {});
  };
  /** Scrolls a section's heading to just under the sticky header. */
  const scrollToHeading = (locator) =>
    locator.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector('.screen-header').offsetHeight - 8));
  const talk = 'Разговорная практика';
  await backdate(talk, shiftDate(mondayOf(3), 1));
  for (const [offset, step, minutes] of [[0, talk], [0, talk], [2, talk], [3, 'Чтение вслух', 60], [5, talk], [5, talk]]) {
    await backdate(step, shiftDate(mondayOf(1), offset), minutes);
  }

  // Home: «Итоги недели» for the last week, all through this one.
  if (await page.locator('.top-card:not(.ach-card)').count()) errors.push('a backdated fill covered the hero flask with the level-up card');
  await page.goto(`${baseUrl}#/skills`);
  const recapTile = page.locator('.tile--recap');
  await recapTile.waitFor();
  await page.locator('.top-card').waitFor({ state: 'detached', timeout: 10000 });
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
  await shot('home-recap');
  await recapTile.click();
  await page.waitForURL(/#\/recap$/);
  await page.getByRole('heading', { name: 'Лучшее за неделю' }).waitFor();
  if (await page.getByText(/меньше|хуже|пропущ/i).count()) errors.push('the recap compares against the user');
  await page.waitForTimeout(700); // the count-up
  await shot('recap');
  await scrollToHeading(page.getByRole('heading', { name: 'Лучшее за неделю' }));
  await shot('recap-best');
  await page.evaluate(() => window.scrollTo(0, 0));
  // The week before: nothing was marked, said plainly.
  await page.getByRole('button', { name: 'Предыдущая неделя' }).click();
  await page.getByText('В эту неделю отметок нет').waitFor();
  await shot('recap-empty');
  // The first week with a completion is as far back as the switcher goes.
  await page.getByRole('button', { name: 'Предыдущая неделя' }).click();
  await page.getByRole('heading', { name: 'Лучшее за неделю' }).waitFor();
  if (!(await page.getByRole('button', { name: 'Предыдущая неделя' }).isDisabled())) errors.push('the recap goes back past the first completion');
  // The current week: still going, with the achievements the writes of today earned.
  await page.goto(`${baseUrl}#/recap/${mondayOf(0)}`);
  await page.getByText('Неделя ещё идёт').waitFor();
  await page.getByRole('heading', { name: 'Ачивки недели' }).waitFor();
  if (!(await page.getByRole('button', { name: 'Следующая неделя' }).isDisabled())) errors.push('the recap goes past the current week');
  await shot('recap-current');

  // «Рекорды» on «Ачивки», under the summary.
  await page.goto(`${baseUrl}#/achievements`);
  const records = page.getByRole('heading', { name: 'Рекорды' });
  await records.waitFor();
  for (const title of ['Лучший день', 'Лучшая неделя', 'Больше всего действий за день', 'Лучшая серия', 'Самое длинное занятие', 'Самый быстрый уровень']) {
    if (!(await page.locator('.records .info-row', { hasText: title }).count())) errors.push(`the records miss «${title}»`);
  }
  await scrollToHeading(records);
  await page.waitForTimeout(300);
  await shot('records');
  await page.locator('.records .info-row', { hasText: 'Лучшая неделя' }).click();
  await page.waitForURL(new RegExp(`#/recap/${mondayOf(1)}$`));
  await page.getByRole('heading', { name: 'Лучшее за неделю' }).waitFor();

  // A 320 px phone: nothing scrolls sideways, nothing is cut.
  await page.setViewportSize({ width: 320, height: 700 });
  await page.waitForTimeout(700);
  const recapOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (recapOverflow > 0) errors.push(`the recap scrolls sideways by ${recapOverflow}px at 320 px`);
  await shot('recap-320');
  await scrollToHeading(page.getByRole('heading', { name: 'Лучшее за неделю' }));
  await shot('recap-best-320');
  await page.goto(`${baseUrl}#/achievements`);
  await records.waitFor();
  await scrollToHeading(records);
  const recordsOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (recordsOverflow > 0) errors.push(`the records scroll sideways by ${recordsOverflow}px at 320 px`);
  await page.waitForTimeout(300);
  await shot('records-320');
  await page.goto(`${baseUrl}#/skills`);
  await recapTile.waitFor();
  await shot('home-recap-320');

  // «Прогноз» and «Активность» (v0.5 package 14) on the same history: five days of practice in
  // the last four weeks give the forecast line, its sheet answers «А если к дате?», the skill's
  // heat map and the home screen's one open a day. Then a new skill: no line, an empty map.
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const forbiddenTone = /отста|просроч|пропущ|штраф|долг|провал/i;
  await page.goto(`${baseUrl}#${skillPath}`);
  // The line itself, not the placeholder that keeps its place until the lazy chunk arrives.
  const forecastLine = page.locator('button.forecast-line');
  await forecastLine.waitFor();
  if (!/^В таком темпе колба \d+ заполнится (≈|примерно)/.test((await forecastLine.innerText()).replace(/\u00a0/g, ' '))) {
    errors.push(`the forecast line reads «${await forecastLine.innerText()}»`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('skill-forecast');
  await forecastLine.click();
  const forecastSheet = page.getByRole('dialog', { name: 'Прогноз' });
  await forecastSheet.getByText('А если к дате?').waitFor();
  const answer = await forecastSheet.locator('.forecast-answer').innerText();
  if (!/^(Нужно ≈|В нынешнем темпе)/.test(answer.replace(/\u00a0/g, ' '))) errors.push(`«А если к дате?» answers «${answer}»`);
  if (forbiddenTone.test(await forecastSheet.innerText())) errors.push('the forecast sheet pressures the user');
  await shot('forecast-sheet');
  // A date close by: what it takes, in the skill's own actions.
  const soon = shiftDate(today, 10);
  await forecastSheet.getByLabel('Дата').fill(soon);
  await forecastSheet.getByText(/^Нужно ≈/).waitFor();
  await shot('forecast-sheet-date');
  await page.keyboard.press('Escape');
  await forecastSheet.waitFor({ state: 'detached' });

  const skillMap = page.locator('.activity .heatmap-grid');
  await skillMap.locator('button').first().waitFor();
  await scrollToHeading(page.getByRole('heading', { name: 'Активность' }));
  await page.waitForTimeout(300);
  await shot('skill-activity');
  if ((await skillMap.locator('button[data-level="0"]').count()) === (await skillMap.locator('button').count())) errors.push('the skill heat map shows no day of practice');
  // The latest day with practice: its completions, «История навыка».
  await skillMap.locator('button:not([data-level="0"])').last().click();
  const daySheet = page.locator('.day-sheet');
  await daySheet.locator('.day-sheet-row').first().waitFor();
  await shot('day-sheet');
  await daySheet.getByRole('button', { name: 'Предыдущий день' }).click();
  await page.waitForTimeout(300);
  await shot('day-sheet-previous');
  await daySheet.getByRole('button', { name: 'Следующий день' }).click();
  await daySheet.getByRole('button', { name: 'История навыка' }).click();
  await daySheet.waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
  const historyTop = await page.getByRole('heading', { name: 'История' }).evaluate((el) => el.getBoundingClientRect().top);
  if (historyTop < 0 || historyTop > 200) errors.push(`«История навыка» left the history heading at ${Math.round(historyTop)}px`);
  await shot('day-sheet-to-history');

  // Home: every skill together, as a wide tile after the others.
  await page.goto(`${baseUrl}#/skills`);
  const homeMap = page.locator('.tile--activity');
  await homeMap.locator('.heatmap-grid button').first().waitFor();
  await homeMap.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot('home-activity');
  await homeMap.locator('.heatmap-grid button:not([data-level="0"])').last().click();
  await page.locator('.day-sheet .day-sheet-skill').first().waitFor();
  await shot('home-day-sheet');
  await page.locator('.day-sheet .day-sheet-skill').first().click();
  await page.waitForURL((url) => url.hash === `#${skillPath}`);
  await page.getByRole('heading', { name: 'История' }).waitFor();
  await page.waitForTimeout(500);
  await shot('home-day-to-history');

  // A 320 px phone: the line wraps, the map scales, nothing scrolls sideways.
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${baseUrl}#${skillPath}`);
  await forecastLine.waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  if ((await overflow()) > 0) errors.push(`the skill screen scrolls sideways by ${await overflow()}px at 320 px`);
  await shot('skill-forecast-320');
  await scrollToHeading(page.getByRole('heading', { name: 'Активность' }));
  await page.waitForTimeout(300);
  await shot('skill-activity-320');
  await forecastLine.click();
  await forecastSheet.getByText('А если к дате?').waitFor();
  await shot('forecast-sheet-320');
  await page.keyboard.press('Escape');
  await forecastSheet.waitFor({ state: 'detached' });
  await page.goto(`${baseUrl}#/skills`);
  await homeMap.locator('.heatmap-grid button').first().waitFor();
  if ((await overflow()) > 0) errors.push(`the home screen scrolls sideways by ${await overflow()}px at 320 px`);
  await homeMap.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot('home-activity-320');
  await homeMap.locator('.heatmap-grid button:not([data-level="0"])').last().click();
  await page.locator('.day-sheet .day-sheet-skill').first().waitFor();
  await shot('home-day-sheet-320');
  await page.keyboard.press('Escape');

  // A new skill: nothing forecast, the map empty on purpose.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}#/skills/new/custom`);
  await page.getByLabel('Название', { exact: true }).fill('Гитара');
  await page.getByRole('button', { name: 'Создать навык' }).click();
  await page.getByRole('button', { name: 'Создать первое действие' }).waitFor();
  await page.getByText('Здесь будут видны дни с занятиями').waitFor();
  if (await page.locator('.forecast-line').count()) errors.push('a new skill shows a forecast');
  await scrollToHeading(page.getByRole('heading', { name: 'Активность' }));
  await page.waitForTimeout(300);
  await shot('skill-new-activity');

  // The same history in a context without the service worker (Telegram never gets its precache),
  // for the lazy chunks of package 14: a slow one keeps its place (the forecast line does not
  // push the milestone rack down when it arrives), a missing one (a redeploy removed the old
  // hashed files, a flaky network) leaves its place empty and the app keeps working.
  await page.goto(`${baseUrl}#/settings`);
  const [insightsDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать файл' }).click()]);
  const insightsBackup = `${outDir}/backup-insights.json`;
  await insightsDownload.saveAs(insightsBackup);
  await recapContext.close();

  const chunkContext = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  await setupContext(chunkContext);
  page = await openPage(chunkContext);
  await page.goto(`${baseUrl}#/settings`);
  await page.getByRole('button', { name: 'Загрузить из файла…' }).click();
  await page.locator('.import-sheet input[type="file"]').setInputFiles(insightsBackup);
  await page.locator('.import-sheet').getByRole('button', { name: 'Заменить данные' }).click();
  await page.locator('.sheet', { has: page.getByRole('button', { name: 'Заменить', exact: true }) }).getByRole('button', { name: 'Заменить', exact: true }).click();
  await page.getByText('Импортировано').waitFor();

  const slowChunk = /\/assets\/ForecastLine-[^/]*\.js$/;
  await page.route(slowChunk, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto(`${baseUrl}#${skillPath}`);
  const rack = page.locator('.rack');
  await rack.waitFor();
  const rackBefore = await rack.evaluate((el) => el.getBoundingClientRect().top);
  if (!(await page.locator('.forecast-line--placeholder').count())) errors.push('the forecast line has no placeholder while its chunk loads');
  await page.locator('button.forecast-line').waitFor();
  await page.waitForTimeout(300);
  const rackAfter = await rack.evaluate((el) => el.getBoundingClientRect().top);
  if (Math.abs(rackAfter - rackBefore) > 12) errors.push(`the forecast line moved the milestone rack by ${Math.round(rackAfter - rackBefore)}px when it arrived`);
  await page.unroute(slowChunk);

  const missingChunk = /\/assets\/(ForecastLine|ActivityCard|LinkSheet)-[^/]*\.js$/;
  await page.route(missingChunk, (route) => route.abort());
  await page.reload();
  await page.getByRole('heading', { name: 'История' }).waitFor();
  await page.waitForTimeout(600);
  if (await page.getByText('Что-то пошло не так').count()) errors.push('a missing lazy chunk took the skill screen down');
  if (await page.locator('.activity, button.forecast-line').count()) errors.push('a missing lazy chunk left a broken section on the skill screen');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('chunk-missing-skill');
  await page.goto(`${baseUrl}#/skills`);
  await page.locator('.skill-card').first().waitFor();
  await page.waitForTimeout(600);
  if (await page.getByText('Что-то пошло не так').count()) errors.push('a missing lazy chunk took the home screen down');
  if (await page.locator('.tile--activity').count()) errors.push('a missing lazy chunk left an empty tile on the home screen');
  await shot('chunk-missing-home');
  await chunkContext.close();
}

// «Образы прогресса и цвет» (packages 11 and 13), in their own context: the picker in the skill
// form (all thirteen themes), every theme on the hero at 60 % (switched through the ⋯ sheet),
// a mark on each one's path (at 390 and 320 px, opened from its caption, then deleted), each
// one's level-up caught mid-flight, the rack of minis, the home card, and the skill in a colour.
{
  const themeContext = await browser.newContext(contextOptions);
  await setupContext(themeContext);
  page = await openPage(themeContext);
  // The hero at the top of the page, clear of the sticky header (taller with Telegram's safe
  // areas): a clip of the page scrolled to the top rather than an element shot, which may
  // leave the hero under the header after a tap scrolled the page.
  const shotHero = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator('.hero').boundingBox();
    await page.screenshot({ path: `${outDir}/${String(++n).padStart(2, '0')}-${name}.png`, clip: box });
  };
  // The picker's colour swatches just above the bottom bar (the form's footer).
  const swatchesInView = () =>
    page.evaluate(() => {
      const groups = document.querySelectorAll('.appearance .appearance-group');
      const colors = groups[groups.length - 1].getBoundingClientRect();
      const footer = document.querySelector('.screen-footer');
      const bottom = footer ? footer.getBoundingClientRect().top : window.innerHeight;
      window.scrollBy(0, colors.bottom + 12 - bottom);
    });
  const cardsGone = async () => {
    await page.locator('.ach-card').waitFor({ state: 'detached', timeout: 15000 });
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
  };
  await page.goto(`${baseUrl}#/skills/new/custom`);
  await page.getByLabel('Название', { exact: true }).fill('Гитара');
  const themeGroup = page.getByRole('group', { name: 'Образ' });
  const colorGroup = page.getByRole('group', { name: 'Цвет' });
  await themeGroup.waitFor();
  if (!(await themeGroup.getByRole('radio', { name: /^Колба\./ }).isChecked())) errors.push('a new skill does not start as a flask');
  if (!(await colorGroup.getByRole('radio', { name: 'Как в теме' }).isChecked())) errors.push('a new skill does not start «Как в теме»');
  const themes = await themeGroup.getByRole('radio').evaluateAll((els) => els.map((el) => ({ key: el.value, name: el.getAttribute('aria-label').split('.')[0] })));
  if (themes[0]?.key !== 'flask') errors.push(`the picker does not start with the flask: ${JSON.stringify(themes)}`);
  // All thirteen themes ship (packages 11 and 13).
  if (themes.length !== 13) errors.push(`the picker offers ${themes.length} themes, expected 13: ${themes.map((t) => t.key).join(', ')}`);
  const themeCard = (scope, key) => scope.locator('label.theme-card').filter({ has: page.locator(`input[value="${key}"]`) });
  const swatch = (scope, name) => scope.locator('label.swatch').filter({ has: page.getByRole('radio', { name, exact: true }) });
  await settled(); // the focused name field scrolls itself into view first
  await page.getByRole('heading', { name: 'Оформление' }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector('.screen-header').offsetHeight - 8));
  await page.waitForTimeout(1200); // the cards' minis fill to 60 % once
  await shot('appearance-picker');
  await swatchesInView();
  await page.waitForTimeout(200);
  await shot('appearance-picker-colors');
  const last = themes[themes.length - 1];
  await themeCard(themeGroup, last.key).click();
  await swatch(colorGroup, 'Коралловый').click();
  await page.getByRole('img', { name: `Предпросмотр: ${last.name}, коралловый` }).waitFor();
  await page.waitForTimeout(700);
  await shot('appearance-picker-chosen');
  const pickerOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (pickerOverflow > 0) errors.push(`the skill form scrolls sideways by ${pickerOverflow}px with the picker`);
  // Capacity 20 for every level and a milestone of 16, so the rack keeps its minis and the
  // milestone (with its banner, which pushes the actions below the fold) stays ahead of the
  // thirteen level-ups.
  await page.getByText('Дополнительно').click();
  await page.locator('.field-narrow input').fill('16');
  await page.getByLabel('Первый уровень', { exact: true }).fill('20');
  await page.getByLabel('Прирост за уровень', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Создать навык' }).click();
  await page.getByRole('button', { name: 'Создать первое действие' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Гаммы');
  await page.getByLabel('Очки за выполнение').fill('12');
  await page.getByRole('button', { name: 'Создать действие' }).click();
  await page.getByRole('link', { name: 'Новое действие' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Концерт');
  await page.getByLabel('Очки за выполнение').fill('20');
  await page.getByRole('button', { name: 'Создать действие' }).click();
  // 12 of 20: every theme is shown at 60 %; «Концерт» (20) then completes exactly one level.
  await page.getByRole('button', { name: /^Отметить: Гаммы/ }).click();
  await cardsGone();

  for (const theme of themes) {
    await cardsGone();
    await skillMenu('Оформление');
    const sheet = page.locator('.appearance-sheet');
    await sheet.getByRole('radio', { name: /^Колба\./ }).waitFor();
    if (theme === themes[0]) {
      await page.waitForTimeout(1200);
      await shot('appearance-sheet');
    }
    if (!(await sheet.getByRole('radio', { name: new RegExp(`^${theme.name}\\.`) }).isChecked())) {
      await themeCard(sheet, theme.key).click();
      await page.getByRole('status').getByText('Оформление сохранено').waitFor();
    }
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    await page.evaluate(() => window.scrollTo(0, 0));
    // The theme's chunk, then its idle state.
    await page.locator('.hero .progress-hero-placeholder').waitFor({ state: 'detached' });
    await page.waitForTimeout(700);
    await shotHero(`theme-${theme.key}`);
    // A mark on the theme's path: a pennant with its caption (shortened past 12 characters)
    // beside the drawing, clear of the numbers; the caption opens the mark in the theme's nouns.
    // (This context's page: `markSheet` above belongs to the first one.)
    const themeMarkSheet = page.locator('.mark-sheet');
    await skillMenu('Добавить засечку');
    await themeMarkSheet.getByRole('heading', { name: 'Новая засечка' }).waitFor();
    await themeMarkSheet.getByLabel('Название').fill('Первый концерт');
    await themeMarkSheet.getByRole('button', { name: 'Сохранить' }).click();
    await themeMarkSheet.waitFor({ state: 'detached' });
    const markCaption = page.locator('.hero').getByRole('button', { name: 'Засечка: Первый концерт', exact: true });
    await markCaption.waitFor();
    const measureMark = () =>
      markCaption.evaluate((el) => {
        const caption = el.getBoundingClientRect();
        const info = document.querySelector('.hero-info').getBoundingClientRect();
        return { overlap: caption.right - info.left, text: el.textContent, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
    const markPlace = await measureMark();
    if (markPlace.overlap > 1) errors.push(`the «${theme.name}» mark caption runs into the hero numbers by ${markPlace.overlap.toFixed(0)}px`);
    // The same on a 320 px phone (narrower captions and margins), and nothing scrolls sideways.
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(150);
    const narrowMark = await measureMark();
    if (narrowMark.overlap > 1) errors.push(`at 320 px the «${theme.name}» mark caption runs into the hero numbers by ${narrowMark.overlap.toFixed(0)}px`);
    if (narrowMark.sideways > 0) errors.push(`at 320 px the «${theme.name}» skill screen with a mark scrolls sideways by ${narrowMark.sideways}px`);
    if (theme.key === 'car') await shotHero('theme-car-mark-320');
    await page.setViewportSize(contextOptions.viewport);
    await page.waitForTimeout(150);
    // (A theme may number its captions: the pizza's «1» badge.)
    if (!markPlace.text.endsWith('Первый конц…')) errors.push(`the «${theme.name}» mark caption reads «${markPlace.text}», expected «Первый конц…»`);
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
    await shotHero(`theme-${theme.key}-mark`);
    await markCaption.click();
    await themeMarkSheet.getByText(/ \d+, 12 из 20 очков$/).waitFor();
    // Deleted again: its row under «Засечки» would push «Концерт» down, and the tap on it
    // would scroll the hero away (the level-up then rightly goes to the card).
    await themeMarkSheet.getByRole('button', { name: 'Удалить' }).click();
    const themeMarkConfirm = page.getByRole('dialog').filter({ hasText: 'Удалить засечку «Первый концерт»?' });
    await themeMarkConfirm.getByRole('button', { name: 'Удалить' }).click();
    await themeMarkSheet.waitFor({ state: 'detached' });
    await markCaption.waitFor({ state: 'detached' });
    // A level-up mid-flight (the points fly for about half a second, then the choreography
    // starts: caught about 0.4 s into it), then its end.
    await cardsGone();
    // The pill «<Noun> N» shows for 2 s at the beat; a slow screenshot may outlast it, so the
    // page notes that it appeared.
    await page.evaluate(() => {
      window.__pillSeen = false;
      const seen = new MutationObserver(() => {
        if (!document.querySelector('.level-pill')) return;
        window.__pillSeen = true;
        seen.disconnect();
      });
      seen.observe(document.body, { childList: true, subtree: true });
    });
    await page.getByRole('button', { name: /^Отметить: Концерт/ }).click();
    await page.waitForTimeout(950);
    await shotHero(`theme-${theme.key}-levelup`);
    await page.waitForFunction(() => window.__pillSeen, null, { timeout: 10000 });
    await page.locator('.level-pill').waitFor({ state: 'detached', timeout: 5000 });
    if (await page.locator('.top-card:not(.ach-card)').count()) errors.push(`the «${theme.name}» level-up went to the card, not the hero`);
    // Should a milestone be reached after all: its sheet, decided later.
    const later = page.getByRole('button', { name: 'Решу позже' });
    if (await later.count()) {
      await later.click();
      await later.waitFor({ state: 'detached' });
    }
  }

  // The last theme again, in coral: the rack of minis, the history in its nouns, the home card.
  await cardsGone();
  await skillMenu('Оформление');
  const sheet = page.locator('.appearance-sheet');
  await sheet.getByRole('radio', { name: /^Колба\./ }).waitFor();
  if (!(await sheet.locator(`input[value="${last.key}"]`).isChecked())) {
    await themeCard(sheet, last.key).click();
    await page.getByRole('status').getByText('Оформление сохранено').waitFor();
  }
  // Created in coral: the sheet shows it chosen.
  if (!(await sheet.getByRole('radio', { name: 'Коралловый', exact: true }).isChecked())) errors.push('the ⋯ sheet does not show the skill’s colour');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-liquid-color="coral"] .hero').waitFor();
  await page.waitForTimeout(700);
  await shot('theme-colored');
  // The rack draws minis for a milestone of up to 12 levels: moved to 12 (reached, quietly by
  // the edit), it shows the thirteen filled levels' minis in the theme and colour.
  await skillMenu('Изменить навык');
  await page.getByLabel('Название', { exact: true }).waitFor();
  // The edit form may open «Дополнительно» already (the skill has non-default capacities).
  if (!(await page.locator('.field-narrow input').isVisible())) await page.getByText('Дополнительно').click();
  await page.locator('.field-narrow input').fill('12');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.locator('.rack').waitFor();
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
  await page.locator('.rack').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector('.screen-header').offsetHeight - 8));
  await page.waitForTimeout(600);
  await shot('theme-rack');
  await page.getByRole('heading', { name: 'История' }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector('.screen-header').offsetHeight - 8));
  // «<Noun> N <completed>» in the skill's theme on the history's level separators.
  await page.locator('.timeline-chip.tone-accent').first().waitFor();
  await page.waitForTimeout(300);
  await shot('theme-history');
  await page.goto(`${baseUrl}#/skills`);
  await page.locator('.skill-card[data-liquid-color="coral"]').waitFor();
  await page.waitForTimeout(700);
  await shot('theme-home');
  // A 320 px phone: the picker's grid and swatches still fit.
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${baseUrl}#/skills/new/custom`);
  await page.getByRole('heading', { name: 'Оформление' }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector('.screen-header').offsetHeight - 8));
  await page.waitForTimeout(1200);
  const narrowPicker = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (narrowPicker > 0) errors.push(`the picker scrolls sideways by ${narrowPicker}px at 320 px`);
  await shot('appearance-picker-320');
  await swatchesInView();
  await page.waitForTimeout(200);
  await shot('appearance-picker-320-colors');
  await themeContext.close();
}

/**
 * A fake Telegram client in `ctx`: the WebApp object at `version` (methods of later versions
 * absent, like a real client), CloudStorage in localStorage seeded with `seed`, the native
 * buttons drawn as a bar, events that really dispatch, and calls recorded in __tgFake.calls.
 */
async function installFakeTelegramIn(ctx, { seed, scheme, version = '7.10', startParam = null, themeParams = {} }) {
  await ctx.addInitScript(fakeTelegramInit, { seed, scheme, version, startParam, themeParams });
}

function fakeTelegramInit({ seed, scheme, version, startParam, themeParams }) {
  // Like telegram-web-app.js: the theme's colours as --tg-theme-* on <html>.
  const paint = () => {
    for (const [key, value] of Object.entries(themeParams)) document.documentElement.style.setProperty(`--tg-theme-${key.replace(/_/g, '-')}`, value);
  };
  if (document.documentElement) paint();
  else document.addEventListener('DOMContentLoaded', paint);
  const KEY = '__fake_cloud';
  if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(seed));
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const store = (next) => localStorage.setItem(KEY, JSON.stringify(next));
  const later = (fn) => setTimeout(fn, 5);
  // The bottom bar and its buttons in the colours the app sent, else the SDK's defaults
  // (the MainButton in button_color, the SecondaryButton in the bar's colour, accent text).
  const bar = { main: null, secondary: null, back: null, color: null };
  const themeColor = (value) => (value && !value.startsWith('#') ? themeParams[value] : value);
  function render() {
    if (!document.body) return;
    let el = document.getElementById('tg-bar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tg-bar';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;gap:8px;padding:8px 16px 12px;background:rgba(127,127,127,.18);font:600 16px system-ui';
      document.body.append(el);
      const back = document.createElement('button');
      back.id = 'tg-back';
      back.textContent = '‹ Назад';
      back.style.cssText = 'position:fixed;top:8px;left:8px;z-index:1000;padding:6px 12px;border:0;border-radius:16px;background:rgba(127,127,127,.25);font:600 14px system-ui;color:inherit';
      back.onclick = () => bar.back.handlers.forEach((cb) => cb());
      document.body.append(back);
    }
    el.replaceChildren();
    el.style.background = themeColor(bar.color) ?? 'rgba(127,127,127,.18)';
    const accent = themeParams.button_color ?? '#2481cc';
    const defaults = { 'tg-secondary': ['transparent', accent], 'tg-main': [accent, themeParams.button_text_color ?? '#fff'] };
    for (const [id, b] of [['tg-secondary', bar.secondary], ['tg-main', bar.main]]) {
      if (!b.isVisible) continue;
      const button = document.createElement('button');
      button.id = id;
      button.textContent = b.isProgressVisible ? '…' : b.text;
      button.disabled = !b.isActive;
      button.style.cssText = `height:48px;border:0;border-radius:12px;background:${b.color ?? defaults[id][0]};color:${b.textColor ?? defaults[id][1]};font:inherit;opacity:${b.isActive ? 1 : 0.5}`;
      button.onclick = () => b.isActive && b.handlers.forEach((cb) => cb());
      el.append(button);
    }
    el.style.display = el.childElementCount ? 'flex' : 'none';
    document.getElementById('tg-back').style.display = bar.back.isVisible ? '' : 'none';
  }
  const bottomButton = () => {
    const b = { text: '', isVisible: false, isActive: true, isProgressVisible: false, color: null, textColor: null, handlers: new Set() };
    Object.assign(b, {
      setText: (text) => ((b.text = text), render()),
      setParams: (p) => {
        if ('text' in p) b.text = p.text;
        if ('is_visible' in p) b.isVisible = p.is_visible;
        if ('is_active' in p) b.isActive = p.is_active;
        if ('color' in p) b.color = p.color;
        if ('text_color' in p) b.textColor = p.text_color;
        render();
      },
      onClick: (cb) => b.handlers.add(cb),
      offClick: (cb) => b.handlers.delete(cb),
      show: () => ((b.isVisible = true), render()),
      hide: () => ((b.isVisible = false), render()),
      enable: () => ((b.isActive = true), render()),
      disable: () => ((b.isActive = false), render()),
      showProgress: () => ((b.isProgressVisible = true), render()),
      hideProgress: () => ((b.isProgressVisible = false), render()),
    });
    return b;
  };
  bar.main = bottomButton();
  bar.secondary = bottomButton();
  bar.back = { isVisible: false, handlers: new Set() };
  Object.assign(bar.back, {
    show: () => ((bar.back.isVisible = true), render()),
    hide: () => ((bar.back.isVisible = false), render()),
    onClick: (cb) => bar.back.handlers.add(cb),
    offClick: (cb) => bar.back.handlers.delete(cb),
  });
  document.addEventListener('DOMContentLoaded', render);
  const popups = [];
  const calls = [];
  const noop = () => {};
  const record = (name) => (...args) => calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const listeners = new Map();
  const emit = (event, ...args) => (listeners.get(event) ?? []).forEach((cb) => cb(...args));
  const atLeast = (v) => {
    const [a, b] = [version, v].map((x) => x.split('.').map(Number));
    return a[0] !== b[0] ? a[0] > b[0] : (a[1] ?? 0) >= (b[1] ?? 0);
  };
  const homeScreen = { status: 'missed' };
  window.__tgFake = { popups, calls, emit, homeScreen };
  // One signature per tab, as Telegram keeps its launch data across a reload of the webview.
  const initData = sessionStorage.getItem('__fake_init_data') ?? `auth_date=${Date.now()}&hash=${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem('__fake_init_data', initData);
  window.Telegram = {
    WebApp: {
      version,
      platform: 'android',
      colorScheme: scheme,
      themeParams,
      initData,
      initDataUnsafe: startParam ? { start_param: startParam } : {},
      isExpanded: true,
      viewportHeight: window.innerHeight,
      viewportStableHeight: window.innerHeight,
      isClosingConfirmationEnabled: false,
      ready: noop,
      expand: noop,
      close: noop,
      isVersionAtLeast: atLeast,
      onEvent: (event, cb) => listeners.set(event, [...(listeners.get(event) ?? []), cb]),
      offEvent: (event, cb) => listeners.set(event, (listeners.get(event) ?? []).filter((x) => x !== cb)),
      setHeaderColor: record('setHeaderColor'),
      setBackgroundColor: record('setBackgroundColor'),
      setBottomBarColor: (color) => {
        calls.push(`setBottomBarColor(${JSON.stringify(color)})`);
        bar.color = color;
        render();
      },
      // Bot API 8.0: the client asks the user, then reports homeScreenAdded.
      ...(atLeast('8.0')
        ? {
            addToHomeScreen: () => {
              calls.push('addToHomeScreen()');
              later(() => {
                homeScreen.status = 'added';
                emit('homeScreenAdded');
              });
            },
            checkHomeScreenStatus: (cb) => later(() => cb?.(homeScreen.status)),
          }
        : {}),
      enableClosingConfirmation: noop,
      disableClosingConfirmation: noop,
      enableVerticalSwipes: noop,
      disableVerticalSwipes: noop,
      showAlert: (message, cb) => later(() => cb?.()),
      showConfirm: (message, cb) => {
        popups.push(message);
        later(() => cb?.(true));
      },
      // Answers like a user who confirms: the destructive or «ok» button.
      showPopup: (params, cb) => {
        popups.push(params.message);
        const button = params.buttons?.find((b) => b.type === 'destructive' || b.id === 'ok') ?? params.buttons?.[0];
        later(() => cb?.(button?.id));
      },
      BackButton: bar.back,
      SettingsButton: { isVisible: false, show: noop, hide: noop, onClick: noop, offClick: noop },
      MainButton: bar.main,
      SecondaryButton: bar.secondary,
      HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
      CloudStorage: {
        setItem: (key, value, cb) => later(() => (store({ ...load(), [key]: value }), cb?.(null, true))),
        getItem: (key, cb) => later(() => cb(null, load()[key] ?? '')),
        getItems: (keys, cb) => later(() => cb(null, Object.fromEntries(keys.map((key) => [key, load()[key] ?? ''])))),
        removeItem: (key, cb) => later(() => {
          const next = load();
          delete next[key];
          store(next);
          cb?.(null, true);
        }),
        removeItems: (keys, cb) => later(() => {
          const next = load();
          for (const key of keys) delete next[key];
          store(next);
          cb?.(null, true);
        }),
        getKeys: (cb) => later(() => cb(null, Object.keys(load()))),
      },
    },
  };
}

const tgSeed = cloudStoreFor(readFileSync(backupPath, 'utf8'));
const tgContext = await browser.newContext(contextOptions);
await setupContext(tgContext);
await installFakeTelegramIn(tgContext, { seed: tgSeed, scheme: dark ? 'dark' : 'light' });
page = await openPage(tgContext);
const cloudKeys = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('__fake_cloud') || '{}')).sort());
const cloudMeta = () => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('__fake_cloud') || '{}').sf_meta || 'null'));
const setHidden = (hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

// Telegram opens the app with its launch parameters in the hash; the router must still pick
// the entry screen (StartRedirect), not treat the hash as an unknown page.
const tgLaunch = `${baseUrl}#tgWebAppData=query_id%3DAAH%26user%3D%257B%2522id%2522%253A1%257D&tgWebAppVersion=7.10&tgWebAppPlatform=ios`;

// Empty database + a copy in the cloud: the offer, never a silent restore.
await page.goto(tgLaunch);
await page.getByText(/^Найдена резервная копия от .+: 4 навыка, \d+ выполнени/).waitFor();
await shot('tg-restore-offer');
await page.locator('#tg-main', { hasText: 'Восстановить' }).click();
// With actions restored, the app opens on «Сегодня».
await page.locator('.today-group', { hasText: 'Тренировки' }).waitFor();
await shot('tg-restored');

await tab('Настройки').click();
await page.getByText(/^Сохранено сегодня в \d\d:\d\d · \d+ КБ$/).waitFor();
await page.getByText(/^Копия: .+ · 4 навыка/).waitFor();
// Bot API 7.10: no home-screen shortcut, and no service worker inside Telegram.
if (await page.getByRole('button', { name: 'Добавить на главный экран' }).count()) errors.push('the home-screen row shows below Bot API 8.0');
if (await page.evaluate(() => navigator.serviceWorker.getRegistration().then(Boolean))) errors.push('a service worker was registered inside Telegram');
await shot('tg-settings');

// A completion makes the copy stale; going to the background saves it at once.
await tab('Навыки').click();
// «Чтение» (1 point a tap): no flask fills, so no milestone sheet stands in the way.
await page.locator('.skill-card', { hasText: 'Чтение' }).click();
await page.locator('.check-button').first().click();
await page.getByRole('button', { name: 'Отменить', exact: true }).waitFor();
// A mark inside Telegram: «Сохранить» is the native MainButton while the sheet is open (no
// HTML copy of it in the sheet), and it goes away with the sheet.
await skillMenu('Добавить засечку');
const tgMarkSheet = page.locator('.mark-sheet');
await tgMarkSheet.getByLabel('Название').fill('Экзамен');
await page.locator('#tg-main', { hasText: 'Сохранить' }).waitFor();
if (await tgMarkSheet.getByRole('button', { name: 'Сохранить' }).count()) errors.push('the mark sheet shows an HTML «Сохранить» next to the native MainButton');
await settled();
await shot('tg-mark-sheet');
await page.locator('#tg-main', { hasText: 'Сохранить' }).click();
await page.getByText('Засечка добавлена').waitFor();
await tgMarkSheet.waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Засечка: Экзамен', exact: true }).waitFor();
if (await page.locator('#tg-main', { hasText: 'Сохранить' }).count()) errors.push('the native «Сохранить» stayed after the mark sheet closed');
// The pause sheet inside Telegram: «Поставить на паузу» is the native MainButton, no HTML copy
// in the sheet; pressed, it sets the pause, and «Снять паузу» takes it off again.
await skillMenu('Поставить на паузу');
const tgPauseSheet = page.locator('.pause-sheet');
await tgPauseSheet.getByRole('radio', { name: /^На неделю/ }).waitFor();
await page.locator('#tg-main', { hasText: 'Поставить на паузу' }).waitFor();
if (await tgPauseSheet.getByRole('button', { name: 'Поставить на паузу' }).count()) errors.push('the pause sheet shows an HTML «Поставить на паузу» next to the native MainButton');
await settled();
await shot('tg-pause-sheet');
await page.locator('#tg-main', { hasText: 'Поставить на паузу' }).click();
await tgPauseSheet.waitFor({ state: 'detached' });
await page.locator('.pause-line .pause-pill').waitFor();
if (await page.locator('#tg-main', { hasText: 'Поставить на паузу' }).count()) errors.push('the native «Поставить на паузу» stayed after the pause sheet closed');
await page.locator('.pause-line').getByRole('button', { name: 'Снять паузу' }).click();
await page.locator('.pause-line').waitFor({ state: 'detached' });
await page.locator('#tg-back').click();
await tab('Настройки').click();
await page.getByText('Есть несохранённые изменения').waitFor();
await shot('tg-settings-dirty');
await setHidden(true);
await page.getByText(/^Сохранено сегодня в/).waitFor();
await setHidden(false);
const flushed = await cloudMeta();
if (flushed?.slot !== 'b') errors.push(`the background flush did not write the other slot: ${JSON.stringify(flushed)}`);
if ((await cloudKeys()).some((key) => key.startsWith('sf_a_'))) errors.push('the previous cloud slot was not removed');
await page.getByRole('button', { name: 'Сохранить сейчас' }).click();
await page.getByText('Копия сохранена в облаке').waitFor();
await shot('tg-settings-saved');

// Another phone replaced the copy: the automatic save waits, «Сохранить сейчас» asks first.
await page.evaluate(() => {
  const cloud = JSON.parse(localStorage.getItem('__fake_cloud'));
  const meta = JSON.parse(cloud.sf_meta);
  cloud.sf_meta = JSON.stringify({ ...meta, h: 'ffffffffffffffff', at: new Date(Date.now() - 86_400_000).toISOString(), skills: 3, completions: 40 });
  localStorage.setItem('__fake_cloud', JSON.stringify(cloud));
});
await tab('Навыки').click();
await tab('Настройки').click();
await page.getByText(/^В облаке другая копия \(сохранена вчера в \d\d:\d\d\) — восстановите её/).waitFor();
await page.getByText(/^Копия: вчера в .+ · 3 навыка, 40 выполнений$/).waitFor();
await shot('tg-settings-conflict');
await page.getByRole('button', { name: 'Сохранить сейчас' }).click();
await page.getByText(/^Сохранено сегодня в/).waitFor();
if (!(await page.evaluate(() => window.__tgFake.popups.some((m) => m.includes('сохранена не с этого устройства'))))) {
  errors.push('«Сохранить сейчас» replaced a foreign cloud copy without asking');
}
if ((await cloudMeta())?.h === 'ffffffffffffffff') errors.push('the foreign cloud copy was not replaced after the confirmation');

// «Удалить все данные» with the copy: both native popups are confirmed; nothing is offered after a reload.
await page.getByRole('button', { name: 'Удалить все данные' }).click();
await page.getByText('Первый навык').waitFor();
if ((await cloudKeys()).length) errors.push(`cloud keys left after deleting everything: ${await cloudKeys()}`);
// A new document (the query differs), as when Telegram opens the app again.
await page.goto(tgLaunch.replace('/#', '/?relaunch#'));
await page.getByText('Первый навык').waitFor();
if (!/#\/skills$/.test(page.url())) errors.push(`a Telegram launch with no action did not open the skills: ${page.url()}`);
await tgContext.close();

// ---- Telegram 8.0, launched by a link: `startapp=skill_<id>` (package 12) ----
// A fresh install: the cloud copy is offered first, and after «Восстановить» the launch link
// opens its skill. Then the home-screen shortcut, and a forced «Тема» against Telegram's.
{
  const linked = JSON.parse(readFileSync(backupPath, 'utf8')).tables.skills.find((skill) => skill.status === 'ACTIVE');
  const startParam = `skill_${linked.id.replace(/-/g, '')}`;
  const tg8Context = await browser.newContext(contextOptions);
  await setupContext(tg8Context);
  // Telegram's own theme, painted as the SDK does: TG_THEME=purple matches its injected
  // colours; otherwise Telegram's default light or dark theme, so a forced «Тема» is seen
  // against real --tg-theme-* colours it must not mix in.
  const themeParams =
    tgTheme === 'purple'
      ? { button_color: '#8774e1', button_text_color: '#ffffff', bg_color: '#1e1b2e', secondary_bg_color: '#151321', section_bg_color: '#1e1b2e', text_color: '#f0eefb', hint_color: '#9b95b8' }
      : dark
        ? { button_color: '#2ea6ff', button_text_color: '#ffffff', bg_color: '#212121', secondary_bg_color: '#181818', section_bg_color: '#212121', text_color: '#ffffff', hint_color: '#aaaaaa' }
        : { button_color: '#2481cc', button_text_color: '#ffffff', bg_color: '#ffffff', secondary_bg_color: '#efeff4', section_bg_color: '#ffffff', text_color: '#000000', hint_color: '#999999' };
  await installFakeTelegramIn(tg8Context, { seed: tgSeed, scheme: dark ? 'dark' : 'light', version: '8.0', startParam, themeParams });
  page = await openPage(tg8Context);
  await page.goto(`${baseUrl}#tgWebAppData=query_id%3DAAH&tgWebAppStartParam=${startParam}&tgWebAppVersion=8.0&tgWebAppPlatform=android`);
  await page.getByText(/^Найдена резервная копия от/).waitFor();
  await page.locator('#tg-main', { hasText: 'Восстановить' }).click();
  await page.waitForURL((url) => url.hash === `#/skills/${linked.id}`);
  await page.locator('h1.screen-title', { hasText: linked.name }).waitFor();
  await page.locator('.hero').waitFor();
  await shot('tg-deeplink-skill');
  // Only the first route follows the link: the skills tab stays the skills tab.
  await page.locator('#tg-back').click();
  await page.waitForURL(/#\/skills$/);

  await tab('Настройки').click();
  const addRow = page.getByRole('button', { name: 'Добавить на главный экран' });
  await addRow.waitFor();
  await addRow.scrollIntoViewIfNeeded();
  await shot('tg8-settings-home-screen');
  await addRow.click();
  await page.getByText('Ярлык добавлен на главный экран').waitFor();
  await page.getByText('Уже на главном экране').waitFor();
  if (!(await page.evaluate(() => window.__tgFake.calls.includes('addToHomeScreen()')))) errors.push('«Добавить на главный экран» did not call addToHomeScreen');
  await shot('tg8-home-screen-added');

  // «Тема» against Telegram's: dark inside a light Telegram, light inside a dark or purple one.
  const tgThemeGroup = page.getByRole('group', { name: 'Тема' });
  await tgThemeGroup.getByRole('button', { name: 'Как в Telegram', exact: true }).waitFor();
  const forcedTg = dark ? { name: 'Светлая', value: 'light', bg: '#f2f2f7' } : { name: 'Тёмная', value: 'dark', bg: '#000000' };
  await tgThemeGroup.scrollIntoViewIfNeeded();
  await tgThemeGroup.getByRole('button', { name: forcedTg.name, exact: true }).click();
  await page.waitForFunction((v) => document.documentElement.dataset.appearance === v && document.documentElement.dataset.theme === v, forcedTg.value);
  const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const expectedBg = forcedTg.value === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(242, 242, 247)';
  if (pageBg !== expectedBg) errors.push(`a forced «${forcedTg.name}» inside Telegram paints the page ${pageBg}`);
  if (!(await page.evaluate((bg) => window.__tgFake.calls.includes(`setHeaderColor(${JSON.stringify(bg)})`), forcedTg.bg))) errors.push('the Telegram header was not painted with the forced palette');
  await page.waitForTimeout(400); // the crossfade
  await shot('tg8-theme-forced-settings');
  // Telegram switching its own theme does not undo the choice.
  await page.evaluate(() => window.__tgFake.emit('themeChanged'));
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== forcedTg.value) errors.push('themeChanged undid the forced «Тема»');
  await tab('Навыки').click();
  await page.locator('.skill-card').first().waitFor();
  await page.waitForTimeout(600);
  await shot('tg8-theme-forced-home');
  await page.locator('.skill-card', { hasText: linked.name }).click();
  await page.locator('.hero').waitFor();
  await page.waitForTimeout(600);
  await shot('tg8-theme-forced-skill');
  await page.goto(`${baseUrl}#/today`);
  await page.locator('.today-group').first().waitFor();
  await page.waitForTimeout(600);
  await shot('tg8-theme-forced-today');
  // The native bottom buttons take the forced palette too (the target of an add_ link).
  await page.goto(`${baseUrl}#/skills/${linked.id}/add`);
  await page.locator('#tg-main').waitFor();
  await page.locator('#tg-secondary').waitFor();
  const nativeColors = await page.evaluate(() =>
    ['tg-bar', 'tg-main', 'tg-secondary'].map((id) => {
      const style = getComputedStyle(document.getElementById(id));
      return [style.backgroundColor, style.color];
    }),
  );
  const accentColor = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--color-accent)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  const forcedElevated = forcedTg.value === 'dark' ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)';
  if (nativeColors[0][0] !== expectedBg) errors.push(`the forced bottom bar is ${nativeColors[0][0]}`);
  if (nativeColors[1][0] !== accentColor) errors.push(`the native MainButton is ${nativeColors[1][0]}, the app accent ${accentColor}`);
  if (nativeColors[2][0] !== forcedElevated || nativeColors[2][1] !== accentColor) errors.push(`the native SecondaryButton is ${nativeColors[2].join(' / ')} in a forced «Тема»`);
  await page.waitForTimeout(400);
  await shot('tg8-theme-forced-buttons');
  await page.goto(`${baseUrl}#/today`);
  await page.locator('.today-group').first().waitFor();
  // A reload of the same launch keeps the screen (the link was followed) and the theme.
  await page.reload();
  await page.locator('.today-group').first().waitFor();
  if (!/#\/today$/.test(page.url())) errors.push(`a reload followed the launch link again: ${page.url()}`);
  if ((await page.evaluate(() => document.documentElement.dataset.appearance)) !== forcedTg.value) errors.push('the forced «Тема» was lost on reload');
  await tg8Context.close();
}

await browser.close();
if (errors.length) {
  console.error('Console errors:', errors);
  process.exit(1);
}
console.log(`${n} screenshots saved to ${outDir}/`);
