// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Progress } from '../../domain/progression';
import type { StepDefinition } from '../../domain/types';
import { cancelCompletion, completeStep, type MutationResult } from '../../services/completions';
import { DoubleSubmitError, SAME_TAP_MS, ValidationError } from '../../services/core';
import { TimerContext } from '../timer/context';
import { BUSY_TAIL_MS, StepRow } from './StepRow';
import { ToastProvider } from './Toast';

vi.mock('../../services/completions', () => ({ completeStep: vi.fn(), cancelCompletion: vi.fn(), NOTE_MAX_LENGTH: 500 }));
const celebrations = vi.hoisted(() => ({ hold: vi.fn(), release: vi.fn(), celebrateResult: vi.fn() }));
vi.mock('../celebrations/CelebrationProvider', () => ({
  useCelebrations: () => ({ hold: celebrations.hold, celebrateResult: celebrations.celebrateResult }),
}));

const progress = (flask: number, points: number, capacity: number): Progress => ({
  totalPoints: points,
  completedFlasks: flask - 1,
  currentFlask: flask,
  pointsInCurrentFlask: points,
  currentCapacity: capacity,
  fill: points / capacity,
});

const result = (id: string): MutationResult => ({
  completionId: id,
  pointsAwarded: 5,
  delta: 5,
  before: progress(1, 91, 100),
  after: progress(1, 96, 100),
  levelChange: 0,
  milestoneReached: false,
  milestoneLost: false,
  achievements: [],
});

const step: StepDefinition = {
  id: 'step-1',
  skillId: 'skill-1',
  name: 'Чтение',
  type: 'BOOLEAN',
  points: 5,
  pointsPerMinute: null,
  defaultMinutes: null,
  schedule: { kind: 'MANUAL' },
  scheduleFrom: '2026-09-24',
  isActive: true,
  createdAt: '2026-09-24T09:00:00.000Z',
  updatedAt: '2026-09-24T09:00:00.000Z',
};

function renderRow(props: Partial<Parameters<typeof StepRow>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ul>
          <StepRow step={step} skill={{ status: 'ACTIVE' }} todayCount={2} mode="complete" {...props} />
        </ul>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const check = () => screen.getByRole('button', { name: 'Отметить: Чтение, +5 очков' });
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

beforeEach(() => {
  vi.mocked(completeStep).mockReset();
  vi.mocked(cancelCompletion).mockReset();
  celebrations.release.mockReset();
  celebrations.hold.mockReset().mockImplementation(() => celebrations.release);
  celebrations.celebrateResult.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('StepRow', () => {
  it('shows the points on the ✓ and today’s count under the name', () => {
    renderRow();
    expect(screen.getByText('сегодня ×2')).toBeTruthy();
    expect(check().textContent).toBe('+5');
  });

  it('holds the flask before the write and hands the result to the celebrations', async () => {
    const order: string[] = [];
    celebrations.hold.mockImplementation(() => {
      order.push('hold');
      return celebrations.release;
    });
    vi.mocked(completeStep).mockImplementation(async () => {
      order.push('write');
      return result('c1');
    });
    renderRow();
    fireEvent.click(check());
    await wait(0);
    expect(order).toEqual(['hold', 'write']);
    expect(celebrations.hold).toHaveBeenCalledWith('skill-1');
    expect(celebrations.celebrateResult).toHaveBeenCalledWith(result('c1'), expect.objectContaining({ skillId: 'skill-1', points: 5, source: check() }));
    expect(celebrations.release).toHaveBeenCalledTimes(1);
  });

  it('releases the flask when the write fails', async () => {
    vi.mocked(completeStep).mockRejectedValue(new ValidationError('Навык не активен'));
    renderRow();
    fireEvent.click(check());
    expect(await screen.findByText('Навык не активен')).toBeTruthy();
    expect(celebrations.release).toHaveBeenCalledTimes(1);
    expect(celebrations.celebrateResult).not.toHaveBeenCalled();
  });

  it('ignores a second tap while busy and for 600 ms after the write', async () => {
    vi.mocked(completeStep).mockImplementation(async () => result('c1'));
    renderRow();
    fireEvent.click(check());
    fireEvent.click(check()); // same tick: the write has not even started to settle
    await wait(0);
    fireEvent.click(check()); // settled, but inside the busy tail
    expect(completeStep).toHaveBeenCalledTimes(1);
    expect(check().classList.contains('done')).toBe(true);

    await wait(BUSY_TAIL_MS + 50);
    expect(check().classList.contains('done')).toBe(false);
  });

  it('stays busy through the same-tap window, keeping the undo toast on screen', async () => {
    vi.mocked(completeStep).mockImplementation(async () => result('c1'));
    renderRow();
    fireEvent.click(check());
    expect(await screen.findByText('+5 · Чтение')).toBeTruthy();

    await wait(700); // past the green tail, still inside SAME_TAP_MS
    fireEvent.click(check());
    await wait(0);
    expect(completeStep).toHaveBeenCalledTimes(1);
    expect(screen.getByText('+5 · Чтение')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();

    await wait(SAME_TAP_MS - 700 + 50);
    fireEvent.click(check());
    await wait(0);
    expect(completeStep).toHaveBeenCalledTimes(2);
  });

  it('swallows a double submit caught by the service without replacing the toast', async () => {
    vi.mocked(completeStep).mockResolvedValueOnce(result('c1')).mockRejectedValueOnce(new DoubleSubmitError('Уже отмечено — подождите секунду'));
    // Two rows of the same step (e.g. Today and the skill screen): each has its own busy flag.
    render(
      <MemoryRouter>
        <ToastProvider>
          <ul>
            <StepRow step={step} skill={{ status: 'ACTIVE' }} todayCount={0} mode="complete" />
            <StepRow step={step} skill={{ status: 'ACTIVE' }} todayCount={0} mode="complete" />
          </ul>
        </ToastProvider>
      </MemoryRouter>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Отметить: Чтение, +5 очков' });
    fireEvent.click(first!);
    expect(await screen.findByText('+5 · Чтение')).toBeTruthy();
    fireEvent.click(second!);
    await wait(0);
    expect(completeStep).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Уже отмечено — подождите секунду')).toBeNull();
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();
  });

  it('shows «+5 · Чтение» with «Отменить», which cancels that completion', async () => {
    vi.mocked(completeStep).mockResolvedValue(result('c1'));
    vi.mocked(cancelCompletion).mockResolvedValue({ ...result('c1'), delta: -5, before: progress(1, 96, 100), after: progress(1, 91, 100) });
    renderRow();
    fireEvent.click(check());
    expect(await screen.findByText('+5 · Чтение')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await wait(0);
    expect(cancelCompletion).toHaveBeenCalledTimes(1);
    expect(cancelCompletion).toHaveBeenCalledWith('c1');
    expect(await screen.findByText('Отменено · Колба 1: 91/100')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull();
  });

  it('toasts a validation message', async () => {
    vi.mocked(completeStep).mockRejectedValue(new ValidationError('Уже отмечено — подождите секунду'));
    renderRow();
    fireEvent.click(check());
    expect(await screen.findByText('Уже отмечено — подождите секунду')).toBeTruthy();
  });

  it('asks «Сколько минут?» for a TIMED step, then records the minutes', async () => {
    vi.mocked(completeStep).mockImplementation(async () => ({ ...result('c1'), pointsAwarded: 22.5, delta: 22.5 }));
    const timed: StepDefinition = { ...step, type: 'TIMED', points: 0, pointsPerMinute: 0.5, defaultMinutes: 30, schedule: { kind: 'DAILY' } };
    renderRow({ step: timed, todayCount: 0 });
    const button = screen.getByRole('button', { name: 'Отметить: Чтение, 0,5 очка в минуту' });
    expect(button.textContent).toBe('0,5/мин');
    expect(screen.getByText('каждый день')).toBeTruthy();

    fireEvent.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Сколько минут?' });
    expect(completeStep).not.toHaveBeenCalled();
    // The usual minutes come first and are preselected; the points are shown live.
    const presets = within(sheet).getByRole('group', { name: 'Частые значения' });
    expect(within(presets).getAllByRole('button').map((b) => b.textContent)).toEqual(['30 мин', '15 мин', '45 мин', '60 мин']);
    expect(within(sheet).getByText('Начислится 15 очков')).toBeTruthy();
    fireEvent.click(within(presets).getByRole('button', { name: '45 мин' }));
    expect(within(sheet).getByText('Начислится 22,5 очка')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Больше' }));
    expect((within(sheet).getByLabelText('Минуты') as HTMLInputElement).value).toBe('50');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Меньше' }));
    // The optional note under the minutes goes into the same write, trimmed.
    fireEvent.change(within(sheet).getByLabelText('Заметка'), { target: { value: '  Вслух, без запинок ' } });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Готово' }));
    await wait(0);
    expect(completeStep).toHaveBeenCalledWith('step-1', { date: undefined, minutes: 45, note: 'Вслух, без запинок' });
    expect(await screen.findByText('+22,5 · Чтение')).toBeTruthy();
  });

  it('starts the live timer with ▶ beside a TIMED step’s ✓, today only', () => {
    const timed: StepDefinition = { ...step, type: 'TIMED', points: 0, pointsPerMinute: 0.5, defaultMinutes: 30 };
    const start = vi.fn();
    const withTimer = (stepId: string | null, props: Partial<Parameters<typeof StepRow>[0]> = {}) =>
      render(
        <MemoryRouter>
          <TimerContext.Provider value={{ stepId, start }}>
            <ul>
              <StepRow step={timed} skill={{ status: 'ACTIVE' }} todayCount={0} mode="complete" {...props} />
            </ul>
          </TimerContext.Provider>
        </MemoryRouter>,
      );
    withTimer(null);
    fireEvent.click(screen.getByRole('button', { name: 'Запустить таймер: Чтение' }));
    expect(start).toHaveBeenCalledWith(timed);
    cleanup();
    // This step's timer runs: the same button opens it.
    withTimer('step-1');
    expect(screen.getByRole('button', { name: 'Открыть таймер: Чтение' }).classList.contains('is-running')).toBe(true);
    // A past day picked on «Сегодня», a BOOLEAN step, an inactive skill: no ▶.
    for (const other of [() => withTimer(null, { date: '2020-01-06' }), () => renderRow(), () => withTimer(null, { skill: { status: 'ARCHIVED' } })]) {
      cleanup();
      other();
      expect(screen.getByText('Чтение')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /таймер/ })).toBeNull();
    }
  });

  it('records on the given past date and counts «в этот день»', async () => {
    vi.mocked(completeStep).mockImplementation(async () => result('c1'));
    renderRow({ date: '2026-01-05', todayCount: 1, context: 'Английский' });
    expect(screen.getByText('Английский · в этот день ×1')).toBeTruthy();
    fireEvent.click(check());
    await wait(0);
    expect(completeStep).toHaveBeenCalledWith('step-1', { date: '2026-01-05', minutes: undefined });
  });

  it('shows a quota as x of N with a segmented bar', () => {
    renderRow({ quota: { done: 1, target: 3 }, context: 'Спорт', todayCount: 0 });
    expect(screen.getByText('Спорт · 1 из 3')).toBeTruthy();
    const bar = screen.getByRole('img', { name: 'Выполнено 1 из 3' });
    expect([...bar.querySelectorAll('.quota-segment')].map((s) => s.classList.contains('is-done'))).toEqual([true, false, false]);
  });

  it('links to the step form in edit mode', () => {
    renderRow({ mode: 'edit' });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/steps/step-1/edit');
  });

  it('is read-only for a skill that is not active', () => {
    renderRow({ skill: { status: 'COMPLETED' } });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Чтение')).toBeTruthy();
  });
});
