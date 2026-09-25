// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localDate } from '../../lib/dates';
import { clearErrors, logError } from '../../platform/errorLog';
import { exportBackup } from '../../data/backup';
import { META_KEY, readCloudMeta, saveBackupToCloud } from '../../platform/cloud';
import { initCloudBackup, resetCloudBackup } from '../../services/backupSync';
import { completeStep } from '../../services/completions';
import { getSetting, setSetting } from '../../services/settings';
import { createSkill } from '../../services/skills';
import { createStep } from '../../services/steps';
import { initHomeScreen, resetHomeScreen } from '../../platform/homeScreen';
import { resetAppearance } from '../../platform/theme';
import { installFakeTelegram, type FakeTelegram } from '../../test/fakeTelegram';
import { installFreshDb, withClock } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { SettingsScreen } from './SettingsScreen';

installFreshDb();

let fake: FakeTelegram | undefined;
beforeEach(() => {
  localStorage.clear();
});
let stopHomeScreen: (() => void) | undefined;
afterEach(() => {
  cleanup();
  resetCloudBackup();
  stopHomeScreen?.();
  stopHomeScreen = undefined;
  resetHomeScreen();
  fake?.uninstall();
  fake = undefined;
  clearErrors();
  resetAppearance();
  delete document.documentElement.dataset.appearance;
});

/** One skill with an action done on three different days of the last two weeks, plus an older one. */
async function seed(): Promise<void> {
  const skillId = await createSkill({
    name: 'Английский',
    description: '',
    startLabel: '',
    targetLabel: '',
    milestoneName: 'Главная цель',
    milestoneTarget: 3,
    capacityBase: 100,
    capacityIncrement: 50,
    manualCapacities: [],
  });
  const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
  const today = localDate();
  await withClock(`${today}T10:00:00`, async () => {
    for (const back of [0, 0, 3, 13, 14]) await completeStep(stepId, { date: addDays(today, -back) });
  }, 2000);
}

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <ToastProvider>
        <SettingsScreen />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('SettingsScreen', () => {
  it('shows the four groups, counts and the honest 14-day metric in the browser', async () => {
    await seed();
    await initCloudBackup();
    renderSettings();
    for (const title of ['Данные', 'Оформление', 'О приложении', 'Опасная зона']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.getByText('Доступно при запуске из Telegram')).toBeTruthy();
    expect(screen.queryByText('Сохранить сейчас')).toBeNull();
    expect(await screen.findByText('1 навык · 1 действие · 5 выполнений')).toBeTruthy();
    // Today, 3 and 13 days ago are inside the window; 14 days ago is not.
    expect(await screen.findByText('Активных дней за 14 дней: 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Скачать файл' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Загрузить из файла…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить все данные' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Меньше анимации/ })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Виброотклик' })).toBeTruthy();
  });

  it('reminds to download a file in the browser when the last copy is old', async () => {
    await seed();
    renderSettings();
    expect(await screen.findByText('Резервной копии ещё нет — скачайте файл')).toBeTruthy();
    cleanup();
    await setSetting('lastFileBackupAt', new Date(`${addDays(localDate(), -10)}T12:00:00`).toISOString());
    renderSettings();
    expect(await screen.findByText('Последняя копия 10 дней назад — скачайте файл')).toBeTruthy();
    cleanup();
    await setSetting('lastFileBackupAt', new Date().toISOString());
    renderSettings();
    await screen.findByText('Активных дней за 14 дней: 3');
    expect(screen.queryByText(/скачайте файл$/)).toBeNull();
  });

  it('shows the cloud copy controls inside Telegram', async () => {
    fake = installFakeTelegram('7.10');
    await seed();
    await initCloudBackup();
    renderSettings();
    expect(screen.getByText('Копии в облаке пока нет')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Хранить копию в облаке Telegram' })).toHaveProperty('checked', true);
    expect(await screen.findByText('В облаке нет копии')).toBeTruthy();
    expect(screen.getByText(/Это копия, а не синхронизация/)).toBeTruthy();
    expect(screen.queryByText(/скачайте файл$/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить сейчас' }));
    expect(await screen.findByText(/^Сохранено сегодня в \d{2}:\d{2} · \d+ КБ$/)).toBeTruthy();
    expect(await screen.findByText(/^Копия: сегодня в \d{2}:\d{2} · 1 навык, 5 выполнений$/)).toBeTruthy();
  });

  it('shows a copy another device saved as a conflict and replaces it only after asking', async () => {
    fake = installFakeTelegram('7.10');
    await seed();
    const theirs = await saveBackupToCloud(await exportBackup()); // e.g. another phone
    await initCloudBackup();
    const answers = ['cancel', 'ok'];
    const popups: string[] = [];
    fake.tg.showPopup = (params, cb) => {
      popups.push(params.message);
      cb?.(answers.shift());
    };
    renderSettings();
    expect(await screen.findByText(/^В облаке другая копия \(сохранена сегодня в \d{2}:\d{2}\) — восстановите её или нажмите «Сохранить сейчас»$/)).toBeTruthy();

    const saveButton = screen.getByRole('button', { name: 'Сохранить сейчас' });
    fireEvent.click(saveButton);
    await waitFor(() => expect(popups).toHaveLength(1));
    expect(popups[0]).toMatch(/^Копия в облаке от .+ сохранена не с этого устройства/);
    await waitFor(() => expect(saveButton.hasAttribute('disabled')).toBe(false));
    expect((await readCloudMeta())?.h).toBe(theirs.h); // «Отмена»: untouched

    fireEvent.click(saveButton);
    expect(await screen.findByText(/^Сохранено сегодня в/)).toBeTruthy();
    expect((await readCloudMeta())?.h).not.toBe(theirs.h);
  });

  it('does not take a failed cloud read for «no copy»', async () => {
    fake = installFakeTelegram('7.10');
    await seed();
    await saveBackupToCloud(await exportBackup());
    await initCloudBackup();
    fake.cloud.failNext = { method: 'getItem', error: 'SERVER_ERROR' };
    renderSettings();
    const restore = await screen.findByRole('button', { name: /Восстановить из облака…/ });
    expect(await screen.findByText('Не удалось проверить облако — нажмите, чтобы повторить')).toBeTruthy();
    expect(restore.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Удалить копию из облака' }).hasAttribute('disabled')).toBe(false);
    // Tapping retries; the copy is there after all.
    fireEvent.click(restore);
    expect(await screen.findByText(/^Копия: сегодня в .+ · 1 навык, 5 выполнений$/)).toBeTruthy();
    expect(fake.cloud.store.has(META_KEY)).toBe(true);
  });

  it('lists the last errors and clears them', async () => {
    logError(new Error('Первая ошибка'), 'test');
    logError(new Error('Вторая ошибка'), 'test');
    renderSettings();
    const row = screen.getByRole('button', { name: 'Ошибки (2)' });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const entries = screen.getAllByText(/ошибка$/).map((el) => el.textContent);
    expect(entries).toEqual(['test: Вторая ошибка', 'test: Первая ошибка']);
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }));
    expect(screen.getByRole('button', { name: 'Ошибки (0)' })).toBeTruthy();
    expect(within(document.body).getByText('Журнал ошибок пуст')).toBeTruthy();
  });

  it('counts an error logged while the screen is open', async () => {
    renderSettings();
    screen.getByRole('button', { name: 'Ошибки (0)' });
    act(() => logError(new Error('Облако недоступно'), 'cloud backup'));
    expect(screen.getByRole('button', { name: 'Ошибки (1)' })).toBeTruthy();
  });

  it('«Тема» forces the app’s light or dark palette at once and stores it', async () => {
    fake = installFakeTelegram('7.10');
    renderSettings();
    const group = screen.getByRole('group', { name: 'Тема' });
    const auto = within(group).getByRole('button', { name: 'Как в Telegram' });
    expect(auto.getAttribute('aria-pressed')).toBe('true');
    const root = document.documentElement;

    fireEvent.click(within(group).getByRole('button', { name: 'Тёмная' }));
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.appearance).toBe('dark');
    await waitFor(async () => expect(await getSetting('appearance', 'auto')).toBe('dark'));
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Тёмная' }).getAttribute('aria-pressed')).toBe('true'));
    expect(localStorage.getItem('sf_appearance')).toBe('dark');
    // Telegram switching its own theme does not undo the choice.
    fake.emit('themeChanged');
    expect(root.dataset.theme).toBe('dark');

    fireEvent.click(within(group).getByRole('button', { name: 'Светлая' }));
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.appearance).toBe('light');

    fireEvent.click(auto);
    expect(root.dataset.appearance).toBeUndefined();
    await waitFor(async () => expect(await getSetting('appearance', 'dark')).toBe('auto'));
  });

  it('calls the automatic theme «Как в системе» in a browser', () => {
    renderSettings();
    expect(within(screen.getByRole('group', { name: 'Тема' })).getByRole('button', { name: 'Как в системе' })).toBeTruthy();
  });

  it('offers the home-screen shortcut in Telegram 8.0 and hides it at 7.10', async () => {
    fake = installFakeTelegram('7.10');
    stopHomeScreen = initHomeScreen();
    renderSettings();
    await screen.findByText('Активных дней за 14 дней: 0');
    expect(screen.queryByRole('button', { name: 'Добавить на главный экран' })).toBeNull();
    cleanup();
    stopHomeScreen();
    fake.uninstall();

    fake = installFakeTelegram('8.0');
    stopHomeScreen = initHomeScreen();
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить на главный экран' }));
    expect(fake.calls).toContain('addToHomeScreen()');
    act(() => fake!.emit('homeScreenAdded'));
    expect(await screen.findByText('Уже на главном экране')).toBeTruthy();
    expect(await screen.findByText('Ярлык добавлен на главный экран')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить на главный экран' })).toBeNull();
  });

  it('toasts only for a shortcut request still pending here; a double tap asks once, a later tap asks again', async () => {
    fake = installFakeTelegram('8.0');
    stopHomeScreen = initHomeScreen();
    // The request's window (60 s) is closed by hand: the timers of the database stay real.
    const lapse: Array<() => void> = [];
    const realTimeout = window.setTimeout.bind(window);
    const spy = vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 60_000) {
        lapse.push(fn);
        return 0;
      }
      return realTimeout(fn, ms);
    }) as typeof window.setTimeout);
    try {
      renderSettings();
      const add = await screen.findByRole('button', { name: 'Добавить на главный экран' });
      fireEvent.click(add);
      fireEvent.click(add);
      await waitFor(() => expect(lapse).toHaveLength(1));
      expect(fake.calls.filter((call) => call === 'addToHomeScreen()')).toHaveLength(1);
      // Telegram's dialog was cancelled (no event): a tap a little later asks again.
      const later = Date.now() + 5000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
      fireEvent.click(add);
      clock.mockRestore();
      expect(fake.calls.filter((call) => call === 'addToHomeScreen()')).toHaveLength(2);
      // Cancelled again; the shortcut then comes from Telegram's own menu, long after.
      act(() => lapse.forEach((fn) => fn()));
      act(() => fake!.emit('homeScreenAdded'));
      expect(await screen.findByText('Уже на главном экране')).toBeTruthy();
      expect(screen.queryByText('Ярлык добавлен на главный экран')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('in a browser without an install prompt opens the instructions', async () => {
    stopHomeScreen = initHomeScreen();
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить на главный экран' }));
    const sheet = await screen.findByRole('dialog', { name: 'На главный экран' });
    expect(within(sheet).getByText('Подтвердите добавление')).toBeTruthy();
  });
});
