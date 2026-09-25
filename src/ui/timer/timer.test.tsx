// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { localDate } from '../../lib/dates';
import { archiveSkill } from '../../services/lifecycle';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { getActiveTimer, startTimer } from '../../services/timer';
import { installFreshDb, todayNoon } from '../../test/harness';
import { installFakeTelegram, type FakeTelegram } from '../../test/fakeTelegram';
import { CelebrationProvider } from '../celebrations/CelebrationProvider';
import { DialogHost } from '../components/DialogHost';
import { TabBarContext } from '../components/TabBar';
import { ToastProvider } from '../components/Toast';
import { TodayScreen } from '../screens/TodayScreen';
import { TimerLayer } from './TimerLayer';

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
};

const MIN = 60_000;
// The timer reads the injectable clock; tests move it by hand.
let now = new Date(todayNoon());
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

let fake: FakeTelegram | null = null;
installFreshDb();
beforeEach(() => {
  now = new Date(todayNoon());
  setClock(() => now);
});
afterEach(() => {
  cleanup();
  fake?.uninstall();
  fake = null;
});

async function setup() {
  const skillId = await createSkill(input);
  const talk = await createStep({ skillId, name: 'Разговор', type: 'TIMED', pointsPerMinute: 0.5, defaultMinutes: 30 });
  const read = await createStep({ skillId, name: 'Чтение', type: 'TIMED', pointsPerMinute: 1, defaultMinutes: null });
  return { skillId, talk, read };
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <TabBarContext.Provider value>
        <ToastProvider>
          <CelebrationProvider>
            <TimerLayer>
              <Routes>
                <Route path="/today" element={<TodayScreen />} />
              </Routes>
            </TimerLayer>
            <DialogHost />
          </CelebrationProvider>
        </ToastProvider>
      </TabBarContext.Provider>
    </MemoryRouter>,
  );
}

/** The pill's open button: «Открыть таймер: Разговор, 12:34». */
const pill = (name: string, time: string) => screen.findByRole('button', { name: `Открыть таймер: ${name}, ${time}` });
const sheet = (title: string) => screen.findByRole('dialog', { name: title });

describe('live timer', () => {
  it('starts from «Сегодня», pauses, resumes and survives a reload', async () => {
    const { talk } = await setup();
    const view = renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Запустить таймер: Разговор' }));
    expect(await pill('Разговор', '00:00')).toBeTruthy();
    expect((await getActiveTimer())?.stepId).toBe(talk);
    // The row's ▶ now opens the timer instead.
    expect(screen.getByRole('button', { name: 'Открыть таймер: Разговор' })).toBeTruthy();

    advance(12 * MIN + 34_000);
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(await pill('Разговор', '12:34')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Продолжить' })).toBeTruthy();

    // Closed and reopened five minutes later: still 12:34, still paused.
    view.unmount();
    advance(5 * MIN);
    renderApp();
    expect(await pill('Разговор', '12:34')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await screen.findByRole('button', { name: 'Пауза' });
    advance(MIN);
    // The next tick of the one-second interval shows the new time.
    expect(await pill('Разговор', '13:34')).toBeTruthy();
  });

  it('finishes through «Сколько минут?»: prefilled, «Назад» returns to the timer, «Готово» records', async () => {
    const { talk } = await setup();
    await startTimer(talk);
    advance(25 * MIN + 20_000);
    renderApp();
    fireEvent.click(await pill('Разговор', '25:20'));
    const timerSheet = await sheet('Таймер');
    expect(within(timerSheet).getByText('25:20')).toBeTruthy();
    expect(within(timerSheet).getByText('Цель — 30 мин')).toBeTruthy();

    fireEvent.click(within(timerSheet).getByRole('button', { name: 'Завершить' }));
    let minutes = await sheet('Сколько минут?');
    expect((within(minutes).getByLabelText('Минуты') as HTMLInputElement).value).toBe('25');
    expect((within(minutes).getByLabelText('Дата') as HTMLInputElement).value).toBe(localDate(now));
    expect(within(minutes).getByText('Начислится 12,5 очка')).toBeTruthy();

    // «Назад» (Escape here): the minutes sheet goes, the timer is still there and still running.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Сколько минут?' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Таймер' })).toBeTruthy();
    expect((await getActiveTimer())?.pausedAt).toBeNull();

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Таймер' })).getByRole('button', { name: 'Завершить' }));
    minutes = await sheet('Сколько минут?');
    fireEvent.click(within(minutes).getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText('+12,5 · Разговор')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: /^Открыть таймер: Разговор, / })).toBeNull();
    expect(await getActiveTimer()).toBeNull();
    const [completion] = await db.completions.where('stepId').equals(talk).toArray();
    expect(completion).toMatchObject({ durationMinutes: 25, pointsAwarded: 12.5, date: localDate(now), status: 'ACTIVE' });
  });

  it('asks before replacing another action’s timer and records that one first', async () => {
    const { talk, read } = await setup();
    await startTimer(read);
    advance(10 * MIN);
    renderApp();
    await pill('Чтение', '10:00');

    // «Отмена» changes nothing.
    fireEvent.click(await screen.findByRole('button', { name: 'Запустить таймер: Разговор' }));
    let confirm = await screen.findByRole('dialog', { name: 'Подтверждение' });
    expect(within(confirm).getByText('Остановить таймер „Чтение“ и начать новый?')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await getActiveTimer())?.stepId).toBe(read);

    fireEvent.click(screen.getByRole('button', { name: 'Запустить таймер: Разговор' }));
    confirm = await screen.findByRole('dialog', { name: 'Подтверждение' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Остановить' }));
    const minutes = await sheet('Сколько минут?');
    expect(within(minutes).getByText('Чтение')).toBeTruthy();
    expect((within(minutes).getByLabelText('Минуты') as HTMLInputElement).value).toBe('10');
    fireEvent.click(within(minutes).getByRole('button', { name: 'Готово' }));

    expect(await pill('Разговор', '00:00')).toBeTruthy();
    expect((await getActiveTimer())?.stepId).toBe(talk);
    const [completion] = await db.completions.where('stepId').equals(read).toArray();
    expect(completion).toMatchObject({ durationMinutes: 10, pointsAwarded: 10 });
  });

  it('drops the timer of an archived skill with a neutral toast', async () => {
    const { skillId, talk } = await setup();
    await startTimer(talk);
    renderApp();
    await pill('Разговор', '00:00');
    await act(() => archiveSkill(skillId));
    expect(await screen.findByText('Таймер сброшен: навык «Английский» сейчас не активен')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Открыть таймер/ })).toBeNull());
    expect(await getActiveTimer()).toBeNull();
    expect(await db.completions.count()).toBe(0);
  });

  it('«Сбросить» asks, then discards without recording', async () => {
    const { talk } = await setup();
    await startTimer(talk);
    advance(3 * MIN);
    renderApp();
    fireEvent.click(await pill('Разговор', '03:00'));
    fireEvent.click(within(await sheet('Таймер')).getByRole('button', { name: 'Сбросить' }));
    const confirm = await screen.findByRole('dialog', { name: 'Подтверждение' });
    expect(within(confirm).getByText('Сбросить таймер? Время не запишется')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Сбросить' }));
    expect(await screen.findByText('Таймер сброшен')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await getActiveTimer()).toBeNull();
    expect(await db.completions.count()).toBe(0);
  });

  it('says once when the usual minutes are reached while the app is open', async () => {
    const { talk } = await setup();
    await startTimer(talk);
    advance(30 * MIN - 200);
    renderApp();
    await pill('Разговор', '29:59');
    // The goal moment comes 200 ms later by the timer; the clock stands still, so it fires on time.
    expect(await screen.findByText('30 минут — цель на сегодня есть')).toBeTruthy();
  });

  it('offers a forgotten timer for recording with a warning, on its start day, at most a day of minutes', async () => {
    const { talk } = await setup();
    const started = await startTimer(talk);
    advance(8 * 24 * 60 * MIN);
    renderApp();
    fireEvent.click(await pill('Разговор', '192:00:00'));
    const timerSheet = await sheet('Таймер');
    expect(within(timerSheet).getByText(/^Таймер запущен .+ — запишите время или сбросьте таймер$/)).toBeTruthy();
    fireEvent.click(within(timerSheet).getByRole('button', { name: 'Завершить' }));
    const minutes = await sheet('Сколько минут?');
    expect(within(minutes).getByText(/^Таймер запущен/)).toBeTruthy();
    expect((within(minutes).getByLabelText('Минуты') as HTMLInputElement).value).toBe('1440');
    expect((within(minutes).getByLabelText('Дата') as HTMLInputElement).value).toBe(started.date);
  });

  it('asks to check the minutes of a timer that ran more than 12 hours', async () => {
    const { talk } = await setup();
    await startTimer(talk);
    advance(13 * 60 * MIN);
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить' }));
    const minutes = await sheet('Сколько минут?');
    expect(within(minutes).getByText('Таймер шёл больше 12 часов — проверьте минуты')).toBeTruthy();
    expect((within(minutes).getByLabelText('Минуты') as HTMLInputElement).value).toBe('780');
  });

  it('finishes with the Telegram MainButton', async () => {
    fake = installFakeTelegram('7.10');
    const { talk } = await setup();
    await startTimer(talk);
    advance(40 * MIN);
    renderApp();
    fireEvent.click(await pill('Разговор', '40:00'));
    await sheet('Таймер');
    const setParams = (text: string) => fake!.calls.some((call) => call.startsWith('MainButton.setParams') && call.includes(`"text":"${text}"`));
    // Never press before the button says what it does.
    await waitFor(() => expect(setParams('Завершить')).toBe(true));
    act(() => fake!.click('MainButton'));
    const minutes = await sheet('Сколько минут?');
    expect((within(minutes).getByLabelText('Минуты') as HTMLInputElement).value).toBe('40');
    await waitFor(() => expect(setParams('Готово')).toBe(true));
    act(() => fake!.click('MainButton'));
    expect(await screen.findByText('+20 · Разговор')).toBeTruthy();
    await waitFor(async () => expect(await getActiveTimer()).toBeNull());
  });
});
