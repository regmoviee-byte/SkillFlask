import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../domain/achievements/catalog';
import type { AchievementState } from '../../domain/achievements/types';
import type { Progress } from '../../domain/progression';
import type { MutationResult } from '../../services/completions';
import { byPriority, daysSince, orderCelebrations, type CelebrationEvent } from './orderCelebrations';

const progress = (completed: number, points: number, capacity: number): Progress => ({
  totalPoints: completed * 100 + points,
  completedFlasks: completed,
  currentFlask: completed + 1,
  pointsInCurrentFlask: points,
  currentCapacity: capacity,
  fill: points / capacity,
});

const result = (over: Partial<MutationResult> = {}): MutationResult => ({
  completionId: 'c1',
  pointsAwarded: 5,
  delta: 5,
  before: progress(0, 90, 100),
  after: progress(0, 95, 100),
  levelChange: 0,
  milestoneReached: false,
  milestoneLost: false,
  achievements: [],
  ...over,
});

const achievementState = (id: string, unlockedAt: string | null): AchievementState => {
  const def = CATALOG.find((d) => d.id === id)!;
  return { def, unlocked: unlockedAt !== null, unlockedAt, skillId: null, current: unlockedAt ? def.target : 0, target: def.target };
};

const skill = { id: 's1', name: 'Английский', createdAt: '2026-09-01T09:00:00' };
const milestone = { name: 'Достичь C1', reachedAt: '2026-09-24T10:00:00' };

describe('orderCelebrations', () => {
  it('an ordinary completion celebrates nothing: the caller shows the plain toast', () => {
    expect(orderCelebrations(result(), skill, milestone)).toEqual([]);
  });

  it('a filled flask is a level-up with the fills to animate between', () => {
    const events = orderCelebrations(result({ before: progress(0, 96, 100), after: progress(1, 1, 150), levelChange: 1 }), skill, milestone);
    expect(events).toEqual([{ kind: 'levelUp', skillId: 's1', levels: 1, fromFill: 0.96, toFill: 1 / 150, newFlask: 2, remainder: 1 }]);
  });

  it('folds a coincident level-up into the milestone, which the flask still plays first', () => {
    const events = orderCelebrations(
      result({ before: progress(2, 95, 100), after: progress(3, 0, 100), levelChange: 1, milestoneReached: true }),
      skill,
      milestone,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'milestone',
      skillName: 'Английский',
      milestoneName: 'Достичь C1',
      flasks: 3,
      totalPoints: 300,
      days: 24,
      levelUp: { levels: 1, fromFill: 0.95, toFill: 0, newFlask: 4 },
    });
  });

  it('never celebrates a way back', () => {
    const cancelled = result({ delta: -5, before: progress(1, 1, 150), after: progress(0, 96, 100), levelChange: -1, milestoneLost: true });
    expect(orderCelebrations(cancelled, skill, milestone)).toEqual([]);
  });

  it('orders milestone > levelUp > skillCompleted > achievement', () => {
    const achievement: CelebrationEvent = { kind: 'achievement', state: achievementState('first-flask', '2026-09-24T10:00:00') };
    const completed: CelebrationEvent = { kind: 'skillCompleted', skillId: 's1' };
    const levelUp: CelebrationEvent = { kind: 'levelUp', skillId: 's1', levels: 1, fromFill: 0.9, toFill: 0.1, newFlask: 2, remainder: 10 };
    const ms = orderCelebrations(result({ milestoneReached: true }), skill, milestone)[0]!;
    expect(byPriority([achievement, completed, levelUp, ms]).map((e) => e.kind)).toEqual(['milestone', 'levelUp', 'skillCompleted', 'achievement']);

    // From a result: opened achievements follow the level-up, closed ones are not celebrated.
    const events = orderCelebrations(
      result({
        before: progress(0, 96, 100),
        after: progress(1, 1, 150),
        levelChange: 1,
        achievements: [achievementState('first-flask', '2026-09-24T10:00:00'), achievementState('toolbox', null)],
      }),
      skill,
      milestone,
    );
    expect(events.map((e) => e.kind)).toEqual(['levelUp', 'achievement']);
  });

  it('counts the days of the milestone from the creation day, both ends included', () => {
    expect(daysSince('2026-09-24T08:00:00', '2026-09-24T20:00:00')).toBe(1);
    expect(daysSince('2026-09-01T08:00:00', '2026-09-24T20:00:00')).toBe(24);
  });
});
