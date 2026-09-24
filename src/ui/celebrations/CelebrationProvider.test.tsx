// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Progress } from '../../domain/progression';
import type { MutationResult } from '../../services/completions';
import { getSkillWithMilestone } from '../../services/queries';
import { haptics } from '../../platform/haptics';
import { ToastProvider } from '../components/Toast';
import { CelebrationProvider, useCelebrations, useCelebrationStage } from './CelebrationProvider';

vi.mock('../../services/queries', () => ({ getSkillWithMilestone: vi.fn() }));
vi.mock('../../services/skills', () => ({ completeSkill: vi.fn(), continueAfterMilestone: vi.fn() }));
vi.mock('../../platform/haptics', () => ({
  haptics: { levelUp: vi.fn(), milestone: vi.fn(), success: vi.fn(), error: vi.fn(), tap: vi.fn() },
}));

const progress = (completed: number, points: number, capacity = 100): Progress => ({
  totalPoints: completed * 100 + points,
  completedFlasks: completed,
  currentFlask: completed + 1,
  pointsInCurrentFlask: points,
  currentCapacity: capacity,
  fill: points / capacity,
});

const result = (over: Partial<MutationResult>): MutationResult => ({
  completionId: 'c1',
  pointsAwarded: 5,
  delta: 5,
  before: progress(0, 90),
  after: progress(0, 95),
  levelChange: 0,
  milestoneReached: false,
  milestoneLost: false,
  achievements: [],
  ...over,
});

const skill = {
  id: 's1',
  name: 'Английский',
  description: '',
  status: 'ACTIVE' as const,
  startLabel: '',
  targetLabel: '',
  capacityBase: 100,
  capacityIncrement: 0,
  completedAt: null,
  archivedAt: null,
  originSkillId: null,
  createdAt: '2026-09-01T09:00:00',
  updatedAt: '2026-09-01T09:00:00',
};
const milestone = {
  id: 'm1',
  skillId: 's1',
  name: 'Достичь C1',
  targetFlaskNumber: 3,
  reachedAt: '2026-09-24T10:00:00',
  decision: null,
  createdAt: '2026-09-01T09:00:00',
  updatedAt: '2026-09-01T09:00:00',
};

let api: ReturnType<typeof useCelebrations>;
let stage: ReturnType<typeof useCelebrationStage>;

function Probe({ live }: { live: Progress }) {
  api = useCelebrations();
  stage = useCelebrationStage('s1', live);
  return <p data-testid="shown">{stage.shown?.pointsInCurrentFlask}</p>;
}

function renderProvider(live: Progress = progress(0, 90)) {
  const utils = render(
    <MemoryRouter>
      <ToastProvider>
        <CelebrationProvider>
          <Probe live={live} />
        </CelebrationProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  return {
    ...utils,
    rerenderLive: (next: Progress) =>
      utils.rerender(
        <MemoryRouter>
          <ToastProvider>
            <CelebrationProvider>
              <Probe live={next} />
            </CelebrationProvider>
          </ToastProvider>
        </MemoryRouter>,
      ),
  };
}

beforeEach(() => {
  vi.mocked(getSkillWithMilestone).mockResolvedValue({ skill, milestone });
  vi.mocked(haptics.levelUp).mockClear();
  vi.mocked(haptics.milestone).mockClear();
});
afterEach(() => {
  cleanup();
  document.getElementById('sheets')?.remove();
});

describe('CelebrationProvider', () => {
  it('an ordinary completion plays nothing: no card, no sheet', async () => {
    renderProvider();
    await act(() => api.celebrateResult(result({}), { skillId: 's1' }));
    expect(screen.queryByText(/^Колба \d+ заполнена$/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a filled flask off screen is a TopCard, never a dialog, with the level-up vibration', async () => {
    renderProvider();
    await act(() => api.celebrateResult(result({ before: progress(0, 96), after: progress(1, 1, 150), levelChange: 1 }), { skillId: 's1' }));
    // The title names the flask that filled (the one the ring shows), the caption the skill.
    expect(screen.getByText('Колба 1 заполнена')).toBeTruthy();
    expect(screen.getByText('Английский')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(haptics.levelUp).toHaveBeenCalledWith(1);
  });

  it('a reached milestone opens the sheet with «Решу позже», which only closes it', async () => {
    renderProvider();
    await act(() =>
      api.celebrateResult(result({ before: progress(2, 95), after: progress(3, 0), levelChange: 1, milestoneReached: true }), { skillId: 's1' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Веха достигнута: Достичь C1' });
    expect(dialog.textContent).toContain('Веха достигнута');
    expect(haptics.milestone).toHaveBeenCalledTimes(1);
    // The level-up is folded into the milestone: no TopCard on top of the sheet.
    expect(screen.queryByText(/^Колба \d+ заполнена$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Решу позже' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('holds the stage on screen until the celebration releases it', async () => {
    const { rerenderLive } = renderProvider(progress(0, 90));
    let release = () => {};
    act(() => {
      release = api.hold('s1');
    });
    // The write lands: the live query moves on, the screen keeps what it showed.
    rerenderLive(progress(0, 95));
    expect(screen.getByTestId('shown').textContent).toBe('90');
    act(() => release());
    expect(screen.getByTestId('shown').textContent).toBe('95');
  });

  it('waits for the route change when the caller navigates after the write', async () => {
    let navigate: (to: string) => void = () => {};
    function Navigator() {
      const go = useNavigate();
      useEffect(() => {
        navigate = go;
      }, [go]);
      return null;
    }
    render(
      <MemoryRouter>
        <ToastProvider>
          <CelebrationProvider>
            <Probe live={progress(0, 90)} />
            <Navigator />
          </CelebrationProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const done = api.celebrateResult(result({ before: progress(0, 96), after: progress(1, 1), levelChange: 1 }), { skillId: 's1', afterNavigation: true, flaskRef: null });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(screen.queryByText(/^Колба \d+ заполнена$/)).toBeNull();
    act(() => navigate('/skills/s1'));
    await act(() => done);
    expect(screen.getByText(/^Колба \d+ заполнена$/)).toBeTruthy();
  });
});
