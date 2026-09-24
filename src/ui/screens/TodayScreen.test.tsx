// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../../lib/clock';
import { cancelCompletion, completeStep } from '../../services/completions';
import { archiveSkill } from '../../services/lifecycle';
import { getSetting } from '../../services/settings';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
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
    expect(screen.getByRole('link', { name: 'Создать навык' }).getAttribute('href')).toBe('/skills/new');
  });

  it('offers the skills without actions, three at most', async () => {
    for (const name of ['Английский', 'Бег', 'Гитара', 'Чтение']) await createSkill(input(name));
    renderToday();
    expect(await screen.findByText('Добавьте первое действие')).toBeTruthy();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['К навыку «Английский»', 'К навыку «Бег»', 'К навыку «Гитара»']);
  });

  it('lists the actions of active skills, the tiles and what was done today', async () => {
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
    // Tiles: points and completions of today, cancelled ones not counted; the week strip has no target.
    expect(screen.getByText('Действий').closest('.tile')?.textContent).toContain('1');
    expect(screen.getByRole('img', { name: 'Активных дней на неделе: 1' })).toBeTruthy();
    // «Сделано сегодня»: newest first, the cancelled one struck through with «отменено».
    const done = screen.getByText('Сделано сегодня').closest('section')!;
    const rows = within(done).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['РазговорАнглийский · отменено+5', 'РазговорАнглийский+5']);
    expect(rows[0]!.className).toContain('is-cancelled');
    // Nothing about overdue or missing days anywhere on the screen.
    expect(document.body.textContent).not.toMatch(/просроч|пропущ|осталось|не отмечено/i);
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
