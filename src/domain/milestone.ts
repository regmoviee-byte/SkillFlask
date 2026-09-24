import type { Milestone, Skill } from './types';
import type { Progress } from './progression';

export const DEFAULT_MILESTONE_FLASKS = 10;

/** A milestone is reached once the number of fully filled flasks meets its target (FR-MS-004). */
export function isMilestoneReached(milestone: Pick<Milestone, 'targetFlaskNumber'>, progress: Progress): boolean {
  return progress.completedFlasks >= milestone.targetFlaskNumber;
}

/**
 * Brings the stored milestone state in line with actual progress. `reachedAt` is a cache of
 * the date derived from the journal (`derivedReachedAt`, FR-MS-007); while the skill is still
 * active, losing progress below the target un-reaches it (decision 14.3). Returns null when
 * nothing changes.
 */
export function reconcileMilestone(
  milestone: Milestone,
  skill: Pick<Skill, 'status'>,
  progress: Progress,
  derivedReachedAt: string | null,
  now: string,
): Partial<Milestone> | null {
  const reached = isMilestoneReached(milestone, progress);
  if (reached) {
    // syncMilestone derives `progress` and `derivedReachedAt` from the same timeline, so a
    // reached milestone always has a crossing date; `now` only covers a caller passing an
    // inconsistent pair and must never become the normal path (FR-MS-007).
    const reachedAt = derivedReachedAt ?? now;
    return milestone.reachedAt === reachedAt ? null : { reachedAt, updatedAt: now };
  }
  if (milestone.reachedAt !== null && skill.status === 'ACTIVE') {
    return { reachedAt: null, decision: null, updatedAt: now };
  }
  return null;
}

/** "Завершить навык" is only offered for an active skill whose milestone is reached (FR-MS-005). */
export function canCompleteSkill(skill: Pick<Skill, 'status'>, milestone: Milestone | undefined): boolean {
  return skill.status === 'ACTIVE' && milestone?.reachedAt != null;
}
