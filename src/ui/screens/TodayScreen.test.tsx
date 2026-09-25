// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../../lib/clock';
import { addDays, formatWeekdayDate, isoWeekday, localDate, weekStart } from '../../lib/dates';
import { db } from '../../data/db';
import { cancelCompletion, completeStep } from '../../services/completions';
import { archiveSkill } from '../../services/lifecycle';
import { getSetting } from '../../services/settings';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon, withClock } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { groupDone, TodayScreen } from './TodayScreen';
import type { StepCompletion } from '../../domain/types';

const input = (name: string): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
});

/** The coach chip's accessible name: the hint, and that a tap closes it. */
const COACH = /^Подсказка: нажмите на кнопку с очками.*Закрыть подсказку$/;

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
/** Monday of the current week: steps created then are planned on every day of the week. */
const monday = () => weekStart(localDate());
afterEach(cleanup);

function renderToday() {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <ToastProvider>
        <TodayScreen />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('TodayScreen', () => {
  it('asks for a skill first', async () => {
    renderToday();
    expect(await screen.findByText('Начните с навыка')).toBeTruthy();
    // The first run leads to the templates (package 16): popular ones as chips, all of them, or the empty form.
    expect(screen.getByRole('link', { name: 'Все шаблоны' }).getAttribute('href')).toBe('/skills/new');
    expect(screen.getByRole('link', { name: 'Бег' }).getAttribute('href')).toBe('/skills/new/running');
    expect(screen.getByRole('link', { name: 'Свой навык' }).getAttribute('href')).toBe('/skills/new/custom');
  });

  it('is not a first run when every skill is archived: one way to a new skill, no template chips', async () => {
    await archiveSkill(await createSkill(input('Гитара')));
    renderToday();
    expect(await screen.findByText('Активных навыков нет')).toBeTruthy();
    expect(screen.queryByText('Начните с навыка')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Все шаблоны' })).toBeNull();
    expect(screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Новый навык', '/skills/new']]);
  });

  it('offers the skills without actions, three at most', async () => {
    for (const name of ['Английский', 'Бег', 'Гитара', 'Чтение']) await createSkill(input(name));
    renderToday();
    expect(await screen.findByText('Добавьте первое действие')).toBeTruthy();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['К навыку «Английский»', 'К навыку «Бег»', 'К навыку «Гитара»']);
  });

  it('lists the actions of active skills and what was done today', async () => {
    const english = await createSkill(input('Английский'));
    const speaking = await createStep({ skillId: english, name: 'Разговор', points: 5 });
    await createStep({ skillId: english, name: 'Чтение', points: 3 });
    const guitar = await createSkill(input('Гитара'));
    await createStep({ skillId: guitar, name: 'Аккорды', points: 2 });
    await archiveSkill(guitar);
    await completeStep(speaking);
    const mistake = await completeStep(speaking);
    await cancelCompletion(mistake.completionId);

    renderToday();
    await screen.findByText('Сделано сегодня');
    // The archived skill is not on «Сегодня».
    expect(screen.queryByText('Аккорды')).toBeNull();
    expect(document.querySelector('.today-group-name')?.textContent).toBe('Английский');
    expect(screen.getByRole('link', { name: 'Задним числом: Английский' }).getAttribute('href')).toBe(`/skills/${english}/add`);
    // Nothing is scheduled and something was done: no hint, the day's points say enough.
    expect(screen.queryByText('На сегодня ничего не запланировано — отметьте что-нибудь из списка ниже')).toBeNull();
    expect(document.querySelector('.today-summary-points')?.textContent).toBe('+5 очков');
    // «Сделано сегодня»: newest first, the cancelled one struck through with «отменено».
    const done = screen.getByText('Сделано сегодня').closest('section')!;
    const rows = within(done).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['РазговорАнглийский · отменено+5', 'РазговорАнглийский+5']);
    expect(rows[0]!.className).toContain('is-cancelled');
    // Nothing about overdue or missing days anywhere on the screen.
    expect(document.body.textContent).not.toMatch(/просроч|пропущ|осталось|не отмечено/i);
  });

  it('suggests the list below, as a quiet caption, on a day with nothing planned or done', async () => {
    const english = await createSkill(input('Английский'));
    await createStep({ skillId: english, name: 'Разговор', points: 5 });
    renderToday();
    const hint = await screen.findByText('На сегодня ничего не запланировано — отметьте что-нибудь из списка ниже');
    expect(hint.className).toContain('t-caption');
    expect(document.querySelector('.today-summary-points')).toBeNull();
  });

  it('shows «Осталось», the quota block and «Ещё» folded, with schedule captions', async () => {
    const english = await withClock(`${monday()}T08:00:00`, async () => {
      const id = await createSkill(input('Английский'));
      await createStep({ skillId: id, name: 'Разговор', points: 5, schedule: { kind: 'DAILY' } });
      await createStep({ skillId: id, name: 'Фильм', points: 3 });
      await createStep({ skillId: id, name: 'Зал', points: 20, schedule: { kind: 'TIMES_PER_WEEK', times: 3 } });
      return id;
    }, 2000);
    expect(english).toBeTruthy();
    renderToday();
    const remaining = (await screen.findByText('Осталось')).closest('section')!;
    expect(within(remaining).getByText('Разговор')).toBeTruthy();
    expect(within(remaining).getByText('Английский · каждый день')).toBeTruthy();
    expect(screen.getByText('Сделано 0 из 1')).toBeTruthy();
    const quota = screen.getByText('На этой неделе').closest('section')!;
    expect(within(quota).getByText('Английский · 0 из 3')).toBeTruthy();
    expect(within(quota).getByRole('img', { name: 'Выполнено 0 из 3' }).querySelectorAll('.quota-segment')).toHaveLength(3);
    // The rest is folded while something is left, and says how much it holds.
    const more = document.querySelector('details.today-more') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more.querySelector('summary')?.textContent).toBe('Ещё 1 действие');

    await act(async () => {
      fireEvent.click(within(remaining).getByRole('button', { name: 'Отметить: Разговор, +5 очков' }));
    });
    expect(await screen.findByText('Всё сделано на сегодня')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Осталось')).toBeNull());
    expect(document.body.textContent).not.toMatch(/просроч|пропущ|не отмечено/i);
  });

  it('opens a past day of the week: its plan, «В этот день отметок нет», and records on that date', async () => {
    // A Thursday, whatever the real day: Monday..Wednesday are past days of its week.
    const today = '2026-09-24';
    expect(isoWeekday(today)).toBe(4);
    const yesterday = addDays(today, -1);
    const english = await withClock(`${weekStart(today)}T08:00:00`, () => createSkill(input('Английский')));
    const daily = await withClock(`${weekStart(today)}T08:01:00`, () =>
      createStep({ skillId: english, name: 'Разговор', points: 5, schedule: { kind: 'DAILY' } }),
    );
    setClock(tickingClock(`${today}T12:00:00`));
    renderToday();
    await screen.findByText('Осталось');
    const strip = screen.getByRole('group', { name: 'День для отметок' });
    // Days ahead cannot be picked.
    const days = within(strip).getAllByRole('button');
    expect(days).toHaveLength(7);
    expect(days.filter((d) => (d as HTMLButtonElement).disabled)).toHaveLength(7 - isoWeekday(today));
    fireEvent.click(within(strip).getByRole('button', { name: formatWeekdayDate(yesterday) }));
    expect(await screen.findByText(`Отметки задним числом: ${formatWeekdayDate(yesterday)}`)).toBeTruthy();
    expect(screen.getByText('В этот день отметок нет')).toBeTruthy();
    // «Осталось» is about today only; the past day lists its plan neutrally.
    const planned = screen.getByText('По расписанию').closest('section')!;
    await act(async () => {
      fireEvent.click(within(planned).getByRole('button', { name: 'Отметить: Разговор, +5 очков' }));
    });
    const picked = await within(strip).findByRole('button', { name: `${formatWeekdayDate(yesterday)}: 1 выполнение` });
    expect(picked.getAttribute('aria-pressed')).toBe('true');
    const stored = await db.completions.where('stepId').equals(daily).toArray();
    expect(stored.map((c) => c.date)).toEqual([yesterday]);
    expect(screen.queryByText('В этот день отметок нет')).toBeNull();
  });

  it('shows the coach hint once and forgets it after the first completion', async () => {
    const english = await createSkill(input('Английский'));
    await createStep({ skillId: english, name: 'Разговор', points: 5 });
    renderToday();
    const coach = await screen.findByRole('button', { name: COACH });
    expect(coach).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отметить: Разговор, +5 очков' }));
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: COACH })).toBeNull());
    expect(await getSetting('coachTodaySeen', false)).toBe(true);
    await screen.findByText('Сделано сегодня');
  });

  it('hides the coach hint on tap', async () => {
    const english = await createSkill(input('Английский'));
    await createStep({ skillId: english, name: 'Разговор', points: 5 });
    renderToday();
    fireEvent.click(await screen.findByRole('button', { name: COACH }));
    await waitFor(() => expect(screen.queryByRole('button', { name: COACH })).toBeNull());
    expect(await getSetting('coachTodaySeen', false)).toBe(true);
  });

  it('keeps the rows in place after a tap while the screen stays open', async () => {
    const english = await createSkill(input('Английский'));
    await createStep({ skillId: english, name: 'Разговор', points: 5 });
    await createStep({ skillId: english, name: 'Чтение', points: 3 });
    renderToday();
    await screen.findByText('Разговор');
    const names = () => [...document.querySelectorAll('.today-group .step-row-name')].map((n) => n.textContent);
    expect(names()).toEqual(['Разговор', 'Чтение']);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отметить: Чтение, +3 очка' }));
    });
    await screen.findByText('Сделано сегодня');
    // The read model now puts «Чтение» first; the open screen does not move it under the finger.
    expect(names()).toEqual(['Разговор', 'Чтение']);
    cleanup();
    renderToday();
    await screen.findByText('Сделано сегодня');
    expect(names()).toEqual(['Чтение', 'Разговор']);
  });
});

describe('groupDone', () => {
  const completion = (id: string, stepId: string, status: StepCompletion['status'], pointsAwarded: number): { completion: StepCompletion; skillName: string } => ({
    completion: {
      id,
      skillId: 's',
      stepId,
      stepName: stepId === 'read' ? 'Чтение' : 'Разговор',
      stepType: 'BOOLEAN',
      pointsSnapshot: pointsAwarded,
      durationMinutes: null,
      pointsAwarded,
      date: '2026-09-24',
      source: 'MANUAL',
      status,
      cancelledAt: status === 'CANCELLED' ? '2026-09-24T10:00:00.000Z' : null,
      note: null,
      createdAt: '2026-09-24T09:00:00.000Z',
      updatedAt: '2026-09-24T09:00:00.000Z',
    },
    skillName: 'Английский',
  });

  it('folds repeated completions of an action into one row with ×N, cancelled ones apart', () => {
    const rows = groupDone([
      completion('c5', 'read', 'ACTIVE', 0.1),
      completion('c4', 'talk', 'ACTIVE', 5),
      completion('c3', 'read', 'CANCELLED', 0.1),
      completion('c2', 'read', 'ACTIVE', 0.2),
      completion('c1', 'talk', 'ACTIVE', 5),
    ]);
    expect(rows.map((r) => [r.stepName, r.cancelled, r.count, r.points, r.latestId])).toEqual([
      ['Чтение', false, 2, 0.3, 'c5'],
      ['Разговор', false, 2, 10, 'c4'],
      ['Чтение', true, 1, 0.1, 'c3'],
    ]);
  });
});
