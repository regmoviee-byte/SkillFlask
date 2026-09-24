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
// restore offer; the backup file downloaded in the browser part seeds its cloud.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
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
      root.dataset.theme = 'dark';
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

// `/` opens the skills while there is no action to tap, «Сегодня» afterwards.
await page.goto(baseUrl);
await page.getByText('Первый навык').waitFor();
if (!/#\/skills$/.test(page.url())) errors.push(`an empty start did not open the skills: ${page.url()}`);
await shot('skills-empty');
await tab('Сегодня').click();
await page.getByText('Начните с навыка').waitFor();
await shot('today-empty');
await tab('Навыки').click();

await page.getByRole('link', { name: 'Создать навык' }).click();
await page.getByLabel('Название', { exact: true }).fill('Английский');
await page.getByLabel('Сейчас').fill('B1');
await page.getByLabel('Цель').fill('C1');
await settled();
await shot('skill-form');
// Milestone and capacities sit in the «Дополнительно» disclosure.
await page.getByText('Дополнительно').click();
await page.getByLabel('Колб', { exact: true }).fill('3');
await page.getByLabel('Первая колба').fill('10');
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
await page.getByText('История').evaluate((el) => el.scrollIntoView({ block: 'start' }));
await page.getByText('Веха «Достичь C1» достигнута').waitFor();
await page.getByText('Колба 2 заполнена').waitFor();
if (!(await page.locator('.timeline-row.is-cancelled').count())) errors.push('the cancelled completion is not struck through in the timeline');
await shot('history');
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
await page.getByText('История').evaluate((el) => el.scrollIntoView({ block: 'start' }));
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
// The completed card's ring: gold with the check in its centre (the ring's own rotated svg
// must not take the icon along).
const ringCheck = await page.locator('.skill-card.is-completed .ring').first().evaluate((ring) => {
  const r = ring.getBoundingClientRect();
  const icon = ring.querySelector('.ring-label svg')?.getBoundingClientRect();
  if (!icon) return 'no check icon';
  const dx = icon.left + icon.width / 2 - (r.left + r.width / 2);
  const dy = icon.top + icon.height / 2 - (r.top + r.height / 2);
  return Math.abs(dx) > 2 || Math.abs(dy) > 2 || getComputedStyle(ring.querySelector('.ring-label svg')).transform !== 'none'
    ? `the check is off the ring's centre by ${dx.toFixed(1)}, ${dy.toFixed(1)}`
    : null;
});
if (ringCheck) errors.push(`completed card ring: ${ringCheck}`);
await page.locator('.skill-card.is-completed').first().screenshot({ path: `${outDir}/${String(++n).padStart(2, '0')}-skill-card-completed.png` });

// A second skill whose single 25-point action fills flasks 1 (10) and 2 (15) at once:
// the toast must name both filled flasks. The action starts from an example chip.
await page.getByRole('link', { name: 'Новый навык' }).first().click();
await page.getByLabel('Название', { exact: true }).fill('Тренировки');
await page.getByText('Дополнительно').click();
await page.getByLabel('Колб', { exact: true }).fill('5');
await page.getByLabel('Первая колба').fill('10');
await page.getByLabel('Прирост за уровень', { exact: true }).fill('5');
await page.getByRole('button', { name: 'Создать навык' }).click();
await page.getByRole('link', { name: 'Тренировка · 20' }).click();
await page.getByLabel('Очки за выполнение').fill('25');
await page.getByText('≈ 1 выполнение до первой колбы', { exact: false }).waitFor();
await settled();
await shot('step-form-chip');
await page.getByRole('button', { name: 'Создать действие' }).click();
await check.click();
// Two flasks at once: compressed drain/refill cycles, then the pill names the flask now filling.
await page.locator('.level-pill', { hasText: 'Колба 3' }).waitFor();
await page.getByRole('status').getByText('+25 · Тренировка').waitFor();
await shot('levelup-two-flasks');

// «Задним числом»: the full-screen form for another date. A fill recorded there is told by
// the TopCard on the way back (the flask is not on that screen).
await idleCheck.waitFor();
await page.getByRole('link', { name: 'Задним числом' }).click();
await page.getByRole('button', { name: 'Отметить выполненным' }).waitFor();
await page.getByText('Тренировка', { exact: true }).click();
await shot('backdate');
await page.getByRole('button', { name: 'Отметить выполненным' }).click();
await page.locator('.top-card', { hasText: /Колба \d+ заполнена/ }).waitFor();
await page.waitForTimeout(500);
await shot('topcard');
await levelCard.waitFor({ state: 'detached' });

// Edit form: the delete confirmation is a danger sheet; cancel it.
await page.getByRole('link', { name: 'Изменить навык' }).click();
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
await page.getByText('История').evaluate((el) => el.scrollIntoView({ block: 'start' }));
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

// Archive from the skill form: gone from «Сегодня», a third chip «Архив» on the home screen,
// the banner with «Продолжить с этого места» on the skill.
await tab('Навыки').click();
await page.locator('.skill-card', { hasText: 'Тренировки' }).click();
await page.getByRole('link', { name: 'Изменить навык' }).click();
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

// Big days on a small phone: a 1 250-point action on a 320 px screen. The tile numbers shrink
// to fit instead of being cut (own context, so the walk above keeps its data).
const bigContext = await browser.newContext({ ...contextOptions, viewport: { width: 320, height: 700 } });
await setupContext(bigContext);
page = await openPage(bigContext);
await page.goto(`${baseUrl}#/skills/new`);
await page.getByLabel('Название', { exact: true }).fill('Очень длинное название навыка для проверки');
await page.getByText('Дополнительно').click();
await page.getByLabel('Колб', { exact: true }).fill('3');
await page.getByLabel('Первая колба').fill('5000');
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

const tgContext = await browser.newContext(contextOptions);
await setupContext(tgContext);
await tgContext.addInitScript(
  ({ seed, scheme }) => {
    const KEY = '__fake_cloud';
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(seed));
    const load = () => JSON.parse(localStorage.getItem(KEY) || '{}');
    const store = (next) => localStorage.setItem(KEY, JSON.stringify(next));
    const later = (fn) => setTimeout(fn, 5);
    const bar = { main: null, secondary: null, back: null };
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
      for (const [id, b, bg] of [['tg-secondary', bar.secondary, 'transparent'], ['tg-main', bar.main, '#2481cc']]) {
        if (!b.isVisible) continue;
        const button = document.createElement('button');
        button.id = id;
        button.textContent = b.isProgressVisible ? '…' : b.text;
        button.disabled = !b.isActive;
        button.style.cssText = `height:48px;border:0;border-radius:12px;background:${bg};color:${id === 'tg-main' ? '#fff' : '#2481cc'};font:inherit;opacity:${b.isActive ? 1 : 0.5}`;
        button.onclick = () => b.isActive && b.handlers.forEach((cb) => cb());
        el.append(button);
      }
      el.style.display = el.childElementCount ? 'flex' : 'none';
      document.getElementById('tg-back').style.display = bar.back.isVisible ? '' : 'none';
    }
    const bottomButton = () => {
      const b = { text: '', isVisible: false, isActive: true, isProgressVisible: false, handlers: new Set() };
      Object.assign(b, {
        setText: (text) => ((b.text = text), render()),
        setParams: (p) => {
          if ('text' in p) b.text = p.text;
          if ('is_visible' in p) b.isVisible = p.is_visible;
          if ('is_active' in p) b.isActive = p.is_active;
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
    const noop = () => {};
    window.__tgFake = { popups };
    window.Telegram = {
      WebApp: {
        version: '7.10',
        platform: 'android',
        colorScheme: scheme,
        themeParams: {},
        isExpanded: true,
        viewportHeight: window.innerHeight,
        viewportStableHeight: window.innerHeight,
        isClosingConfirmationEnabled: false,
        ready: noop,
        expand: noop,
        close: noop,
        isVersionAtLeast: () => true,
        onEvent: noop,
        offEvent: noop,
        setHeaderColor: noop,
        setBackgroundColor: noop,
        setBottomBarColor: noop,
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
  },
  { seed: cloudStoreFor(readFileSync(backupPath, 'utf8')), scheme: dark ? 'dark' : 'light' },
);
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
await shot('tg-settings');

// A completion makes the copy stale; going to the background saves it at once.
await tab('Навыки').click();
// «Чтение» (1 point a tap): no flask fills, so no milestone sheet stands in the way.
await page.locator('.skill-card', { hasText: 'Чтение' }).click();
await page.locator('.check-button').first().click();
await page.getByRole('button', { name: 'Отменить', exact: true }).waitFor();
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

await browser.close();
if (errors.length) {
  console.error('Console errors:', errors);
  process.exit(1);
}
console.log(`${n} screenshots saved to ${outDir}/`);
