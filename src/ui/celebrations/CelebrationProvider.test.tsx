// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG } from '../../domain/achievements/catalog';
import type { AchievementState } from '../../domain/achievements/types';
import type { Progress } from '../../domain/progression';
import { filterStillUnlocked, markCelebrated, onAchievementsEarned } from '../../services/achievements';
import type { MutationResult } from '../../services/completions';
import { getSkillWithMilestone } from '../../services/queries';
import { haptics } from '../../platform/haptics';
import { ToastProvider } from '../components/Toast';
import { CelebrationProvider, useCelebrations, useCelebrationStage } from './CelebrationProvider';

vi.mock('../../services/queries', () => ({ getSkillWithMilestone: vi.fn() }));
vi.mock('../../services/skills', () => ({ completeSkill: vi.fn(), continueAfterMilestone: vi.fn() }));
vi.mock('../../services/achievements', () => ({
  markCelebrated: vi.fn(async () => {}),
  onAchievementsEarned: vi.fn(() => () => {}),
  filterStillUnlocked: vi.fn(async (states: unknown[]) => states),
}));
vi.mock('../../platform/haptics', () => ({
  haptics: { levelUp: vi.fn(), milestone: vi.fn(), success: vi.fn(), error: vi.fn(), tap: vi.fn(), press: vi.fn(), select: vi.fn() },
}));

const earned = (id: string, skillId: string | null = 's1'): AchievementState => {
  const def = CATALOG.find((d) => d.id === id)!;
  return { def, unlocked: true, unlockedAt: '2026-09-24T10:00:00.000Z', skillId, current: def.target, target: def.target };
};

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

let location = '';

function Probe({ live }: { live: Progress }) {
  api = useCelebrations();
  stage = useCelebrationStage('s1', live);
  const { pathname, search } = useLocation();
  location = pathname + search;
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
  vi.mocked(haptics.press).mockClear();
  vi.mocked(markCelebrated).mockClear();
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

  it('tells a fill made away from the flask on the hero it returns to, never by a card over it', async () => {
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
            <Probe live={progress(1, 1)} />
            <Navigator />
          </CelebrationProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    // «Задним числом»: the write happens on its own screen, which then goes back to the skill.
    const done = api.celebrateResult(result({ before: progress(0, 96), after: progress(1, 1), levelChange: 1, achievements: [earned('first-flask')] }), {
      skillId: 's1',
      afterNavigation: true,
      flaskRef: null,
    });
    act(() => navigate('/skills/s1'));
    // The skill screen's hero appears once its data has loaded, a moment after the route change.
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    const glass = document.createElement('div');
    glass.getBoundingClientRect = () => ({ x: 120, y: 120, top: 120, left: 120, right: 260, bottom: 320, width: 140, height: 200, toJSON: () => ({}) });
    const playLevelUp = vi.fn(async () => {});
    stage.flaskRef.current = { playLevelUp, element: () => glass };
    await act(() => done);
    expect(screen.queryByText(/^Колба \d+ заполнена$/)).toBeNull();
    expect(stage.pill?.flask).toBe(2);
    expect(stage.announcement).toBe('Колба 1 заполнена');
    expect(haptics.levelUp).toHaveBeenCalledWith(1);
    // Its data was read after the write: nothing to replay on the glass.
    expect(playLevelUp).not.toHaveBeenCalled();
    // The achievement card would sit right over the hero: it waits for the pill to go.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(screen.queryByText('Новая ачивка')).toBeNull();
    expect(await screen.findByText('Первая колба', undefined, { timeout: 4000 })).toBeTruthy();
  });

  it('announces a new achievement with a card at the top, after the flask, and opens it on the tab', async () => {
    renderProvider();
    await act(() =>
      api.celebrateResult(result({ before: progress(0, 96), after: progress(1, 1, 150), levelChange: 1, achievements: [earned('first-flask')] }), {
        skillId: 's1',
      }),
    );
    // The level-up card has the place first; the achievement waits until it has left.
    expect(screen.getByText('Колба 1 заполнена')).toBeTruthy();
    expect(screen.queryByText('Новая ачивка')).toBeNull();
    fireEvent.click(screen.getByText('Колба 1 заполнена'));
    const title = await screen.findByText('Первая колба', undefined, { timeout: 2000 });
    expect(screen.getByText('Новая ачивка')).toBeTruthy();
    expect(screen.getByText('Английский')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(haptics.press).toHaveBeenCalledTimes(1);
    expect(markCelebrated).toHaveBeenCalledWith(['first-flask'], expect.any(String));
    fireEvent.click(title.closest('button')!);
    expect(location).toBe('/achievements?focus=first-flask');
  });

  it('tells more than two achievements of one write in one card', async () => {
    renderProvider();
    await act(() =>
      api.celebrateResult(result({ achievements: [earned('first-step'), earned('first-flask'), earned('exact'), earned('milestones-1')] }), {
        skillId: 's1',
      }),
    );
    expect(await screen.findByText('Первое действие и ещё 3 ачивки')).toBeTruthy();
    expect(screen.getByText('Первая колба, Ювелирно, Вехи · 1')).toBeTruthy();
    expect(haptics.press).toHaveBeenCalledTimes(1);
    expect(markCelebrated).toHaveBeenCalledWith(['first-step', 'first-flask', 'exact', 'milestones-1'], expect.any(String));
  });

  it('shows two achievements as two cards, one after the other', async () => {
    renderProvider();
    await act(() => api.celebrateResult(result({ achievements: [earned('first-step'), earned('two-fronts', null)] }), { skillId: 's1' }));
    expect(await screen.findByText('Первое действие')).toBeTruthy();
    expect(screen.queryByText('Два фронта')).toBeNull();
    // Swipe up dismisses; the next card follows after a short gap.
    const card = screen.getByText('Первое действие').closest('button')!;
    fireEvent.touchStart(card, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(card, { touches: [{ clientY: 60 }] });
    expect(await screen.findByText('Два фронта', undefined, { timeout: 2000 })).toBeTruthy();
    // A global one has no skill: the caption says what it is for.
    expect(screen.getByText('Действия в двух навыках за один день')).toBeTruthy();
    expect(haptics.press).toHaveBeenCalledTimes(2);
  });

  it('waits for the milestone sheet to close before a card', async () => {
    renderProvider();
    await act(() =>
      api.celebrateResult(
        result({ before: progress(2, 95), after: progress(3, 0), levelChange: 1, milestoneReached: true, achievements: [earned('milestones-1')] }),
        { skillId: 's1' },
      ),
    );
    await screen.findByRole('dialog', { name: 'Веха достигнута: Достичь C1' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(screen.queryByText('Новая ачивка')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Решу позже' }));
    expect(await screen.findByText('Вехи · 1', undefined, { timeout: 2000 })).toBeTruthy();
  });

  it('shows what other writes published (a new skill, a completed one)', async () => {
    renderProvider();
    const listener = vi.mocked(onAchievementsEarned).mock.calls.at(-1)![0];
    act(() => listener([earned('first-skill')]));
    expect(await screen.findByText('Первый навык')).toBeTruthy();
  });

  it('drops a waiting card whose achievement an undo took away', async () => {
    vi.mocked(filterStillUnlocked).mockImplementationOnce(async () => []);
    renderProvider();
    await act(() => api.celebrateResult(result({ achievements: [earned('first-step')] }), { skillId: 's1' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(screen.queryByText('Новая ачивка')).toBeNull();
    expect(markCelebrated).not.toHaveBeenCalled();
  });
});
