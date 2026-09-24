// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEvent } from '../../domain/events';
import { computeProgress } from '../../domain/progression';
import type { Mark, StepCompletion } from '../../domain/types';
import { Timeline } from './Timeline';

afterEach(cleanup);

const at = '2026-09-24T10:00:00.000Z';
const date = '2026-09-24';
const after = computeProgress(12, { base: 10, increment: 0, manual: [] });

const completion = {
  id: 'c1',
  skillId: 's',
  stepId: 'st',
  stepName: 'Чтение',
  status: 'ACTIVE',
  note: '',
  durationMinutes: 2,
} as unknown as StepCompletion;

const mark: Mark = {
  id: 'm1',
  skillId: 's',
  title: 'Пробный тест',
  description: 'Грамматика 72 из 100',
  date,
  flaskNumber: 2,
  pointsInFlask: 2,
  totalPoints: 12,
  createdAt: at,
  updatedAt: at,
};

function renderTimeline(events: HistoryEvent[]) {
  const onOpen = vi.fn();
  const onOpenMark = vi.fn();
  render(<Timeline events={events} today={date} hasMore={false} onMore={() => {}} onOpen={onOpen} onOpenMark={onOpenMark} />);
  return { onOpen, onOpenMark };
}

describe('Timeline', () => {
  it('shows a mark with its flask, points and description, and opens it', () => {
    const { onOpenMark } = renderTimeline([{ id: 'mark:m1', type: 'MARK', at, date, mark }]);
    expect(screen.getByText('Колба 2 · 2 очка')).toBeTruthy();
    expect(screen.getByText('Грамматика 72 из 100')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Пробный тест/ }));
    expect(onOpenMark).toHaveBeenCalledWith('m1');
  });

  it('says the minutes changed when a correction kept the points', () => {
    renderTimeline([{ id: 't1', type: 'CORRECTION', at, date, delta: 0, after, completion, minutes: null }]);
    expect(screen.getByText(/Минуты изменены/)).toBeTruthy();
  });
});
