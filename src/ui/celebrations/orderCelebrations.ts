// Which reward moments a service result earns, in the order they play. Pure: the provider
// (CelebrationProvider.tsx) only ever celebrates what a mutation of this session returned —
// never a live-query diff, so nothing plays on the first load of a screen.

import type { AchievementState, Milestone, Skill } from '../../domain/types';
import type { MutationResult } from '../../services/completions';
import { diffDays, localDate, nowIso } from '../../lib/dates';

export interface LevelUpPlay {
  /** Flasks filled by the operation (≥ 1). */
  levels: number;
  fromFill: number;
  toFill: number;
  /** The flask being filled now. */
  newFlask: number;
  /** Points carried into it. */
  remainder: number;
}

export type CelebrationEvent =
  | ({ kind: 'levelUp'; skillId: string } & LevelUpPlay)
  | {
      kind: 'milestone';
      skillId: string;
      skillName: string;
      milestoneName: string;
      flasks: number;
      totalPoints: number;
      days: number;
      /** A level-up of the same operation, folded in: the flask still plays it first. */
      levelUp: LevelUpPlay | null;
    }
  | { kind: 'skillCompleted'; skillId: string }
  /* Package 7 fills these from MutationResult.achievements. */
  | { kind: 'achievement'; state: AchievementState };

export const PRIORITY: Record<CelebrationEvent['kind'], number> = {
  milestone: 0,
  levelUp: 1,
  skillCompleted: 2,
  achievement: 3,
};

/** Stable sort by priority: milestone > levelUp > skillCompleted > achievement. */
export function byPriority(events: readonly CelebrationEvent[]): CelebrationEvent[] {
  return events
    .map((event, i) => ({ event, i }))
    .sort((a, b) => PRIORITY[a.event.kind] - PRIORITY[b.event.kind] || a.i - b.i)
    .map(({ event }) => event);
}

/** Calendar days from the skill's creation to `at`, counting both ends («1 день» on the first day). */
export function daysSince(createdAt: string, at: string): number {
  return Math.max(1, diffDays(localDate(new Date(createdAt)), localDate(new Date(at))) + 1);
}

/**
 * The celebrations a mutation earns. An empty list means an ordinary write: the caller shows
 * its plain toast. Losing a level or the milestone never celebrates anything.
 */
export function orderCelebrations(
  result: MutationResult,
  skill: Pick<Skill, 'id' | 'name' | 'createdAt'>,
  milestone: Pick<Milestone, 'name' | 'reachedAt'> | undefined,
): CelebrationEvent[] {
  const events: CelebrationEvent[] = [];
  const levelUp: LevelUpPlay | null =
    result.levelChange > 0
      ? {
          levels: result.levelChange,
          fromFill: result.before.fill,
          toFill: result.after.fill,
          newFlask: result.after.currentFlask,
          remainder: result.after.pointsInCurrentFlask,
        }
      : null;

  if (result.milestoneReached && milestone) {
    events.push({
      kind: 'milestone',
      skillId: skill.id,
      skillName: skill.name,
      milestoneName: milestone.name,
      flasks: result.after.completedFlasks,
      totalPoints: result.after.totalPoints,
      days: daysSince(skill.createdAt, milestone.reachedAt ?? nowIso()),
      levelUp,
    });
  } else if (levelUp) {
    events.push({ kind: 'levelUp', skillId: skill.id, ...levelUp });
  }
  for (const state of result.achievements) {
    if (state.unlockedAt !== null) events.push({ kind: 'achievement', state });
  }
  return byPriority(events);
}
