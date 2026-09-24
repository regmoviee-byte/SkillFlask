// Walks through the app on a phone-sized viewport and saves screenshots of every screen.
// Usage: node scripts/screenshots.mjs [outDir] [baseUrl]
// Modes: DARK=1 (dark colour scheme), TG_THEME=purple (a purple Telegram theme with safe-area
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
await applyTheme(context);

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

await page.goto(baseUrl);
await page.getByText('Здесь будут ваши навыки').waitFor();
await shot('skills-empty');

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
await shot('toast-undo');
await page.getByRole('button', { name: 'Отменить', exact: true }).click();
await page.getByText('Отменено · Колба 1: 0/10').waitFor();
await shot('toast-undone');
for (let i = 0; i < 9; i++) {
  await tapCheck();
  if (i === 2) await shot('skill-progress');
}
await page.getByRole('button', { name: 'Завершить', exact: true }).waitFor();
await shot('skill-milestone');

// History: the cancelled completion stays, struck through; a row opens the completion sheet.
await page.waitForTimeout(6000); // let the toast time out
await page.getByText('История').evaluate((el) => el.scrollIntoView({ block: 'start' }));
await shot('history');
await page.locator('button.history-row').first().click();
const sheet = page.locator('.completion-sheet');
await sheet.waitFor();
await sheet.getByLabel('Заметка').fill('Говорили про путешествия, 20 минут без пауз.');
await shot('completion-sheet');
await sheet.getByRole('button', { name: 'Сохранить' }).click();
await page.getByText('Заметка сохранена').waitFor();
await sheet.waitFor({ state: 'detached' });
await page.getByText('Говорили про путешествия', { exact: false }).first().waitFor();
// Cancel from the sheet, through the confirmation, then restore it.
await page.locator('button.history-row').first().click();
await sheet.getByRole('button', { name: 'Отменить выполнение' }).click();
const confirmSheet = page.locator('.sheet', { has: page.getByRole('button', { name: 'Оставить' }) });
await confirmSheet.waitFor();
await shot('completion-confirm-cancel');
await confirmSheet.getByRole('button', { name: 'Отменить', exact: true }).click();
await page.getByText(/^Отменено · Колба/).waitFor();
await sheet.waitFor({ state: 'detached' });
await page.locator('button.history-row.cancelled').first().click();
await sheet.getByRole('button', { name: 'Вернуть' }).click();
await page.getByText('Возвращено').waitFor();
await sheet.waitFor({ state: 'detached' });
// A typed note survives dismissing the sheet without «Сохранить».
await page.locator('button.history-row').first().click();
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
await shot('skill-completed');

await page.reload();
await page.getByText(/Навык достигнут/).first().waitFor();
await page.getByRole('button', { name: 'Назад' }).click();
await page.getByRole('tab', { name: 'Достигнутые' }).click();
await shot('skills-completed');

// A second skill whose single 25-point action fills flasks 1 (10) and 2 (15) at once:
// the toast must name both filled flasks. The action starts from an example chip.
await page.getByRole('link', { name: 'Новый навык' }).click();
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
await page.getByRole('status').getByText('Заполнено колб: 2').waitFor();
await shot('toast-flasks-filled');

// «Задним числом»: the full-screen form for another date.
await page.getByRole('link', { name: 'Задним числом' }).click();
await page.getByRole('button', { name: 'Отметить выполненным' }).waitFor();
await shot('backdate');
await page.getByRole('button', { name: 'Назад' }).click();

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
await page.getByText('Здесь будут ваши навыки').waitFor();

await tab('Настройки').click();
await page.getByRole('button', { name: 'Загрузить из файла…' }).click();
const importSheet = page.locator('.import-sheet');
await importSheet.waitFor();
await importSheet.getByLabel('Или вставьте текст копии').fill('{"hello": "world"}');
await importSheet.getByRole('button', { name: 'Проверить текст' }).click();
await importSheet.getByText('Это не резервная копия Skill Flask').waitFor();
await shot('import-error');
await importSheet.locator('input[type="file"]').setInputFiles(backupPath);
await importSheet.getByText(/^Навыков: 2 · выполнений: \d+/).waitFor();
if (await importSheet.getByLabel('Или вставьте текст копии').inputValue()) errors.push('the pasted text stayed next to the chosen file');
await shot('import-preview');
await importSheet.getByRole('button', { name: 'Заменить данные' }).click();
const replaceSheet = page.locator('.sheet', { has: page.getByRole('button', { name: 'Заменить', exact: true }) });
await replaceSheet.getByRole('button', { name: 'Заменить', exact: true }).click();
await page.getByText('Импортировано').waitFor();
await page.getByText('Тренировки').waitFor();
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

const tgContext = await browser.newContext(contextOptions);
await applyTheme(tgContext);
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

// Empty database + a copy in the cloud: the offer, never a silent restore.
await page.goto(baseUrl);
await page.getByText(/^Найдена резервная копия от .+: 2 навыка, \d+ выполнени/).waitFor();
await shot('tg-restore-offer');
await page.locator('#tg-main', { hasText: 'Восстановить' }).click();
await page.getByText('Тренировки').waitFor();
await shot('tg-restored');

await tab('Настройки').click();
await page.getByText(/^Сохранено сегодня в \d\d:\d\d · \d+ КБ$/).waitFor();
await page.getByText(/^Копия: .+ · 2 навыка/).waitFor();
await shot('tg-settings');

// A completion makes the copy stale; going to the background saves it at once.
await tab('Навыки').click();
await page.getByText('Тренировки').click();
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
await page.getByText('Здесь будут ваши навыки').waitFor();
if ((await cloudKeys()).length) errors.push(`cloud keys left after deleting everything: ${await cloudKeys()}`);
await page.reload();
await page.getByText('Здесь будут ваши навыки').waitFor();
await tgContext.close();

await browser.close();
if (errors.length) {
  console.error('Console errors:', errors);
  process.exit(1);
}
console.log(`${n} screenshots saved to ${outDir}/`);
