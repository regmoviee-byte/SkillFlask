// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Progress } from '../../domain/progression';
import type { StepDefinition } from '../../domain/types';
import { cancelCompletion, completeStep, type MutationResult } from '../../services/completions';
import { DoubleSubmitError, SAME_TAP_MS, ValidationError } from '../../services/core';
import { BUSY_TAIL_MS, StepRow } from './StepRow';
import { ToastProvider } from './Toast';

vi.mock('../../services/completions', () => ({ completeStep: vi.fn(), cancelCompletion: vi.fn() }));

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
});
afterEach(cleanup);

describe('StepRow', () => {
  it('shows the points and today’s count', () => {
    renderRow();
    expect(screen.getByText('+5 · сегодня ×2')).toBeTruthy();
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
