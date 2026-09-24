import type { TimelineEntry } from './progression';

/**
 * The date the milestone was reached, derived from the journal (FR-MS-007): the createdAt
 * of the last crossing to `target` completed flasks that was not followed by a drop below
 * the target. Null while the skill is currently below the target. Editing the target later
 * re-interprets history instead of stamping the edit time.
 */
export function milestoneReachedAt(
  timeline: readonly TimelineEntry<{ delta: number; createdAt: string }>[],
  target: number,
): string | null {
  let reachedAt: string | null = null;
  for (const entry of timeline) {
    const wasBelow = entry.before.completedFlasks < target;
    const isBelow = entry.after.completedFlasks < target;
    if (wasBelow && !isBelow) reachedAt = entry.transaction.createdAt;
    else if (isBelow) reachedAt = null;
  }
  return reachedAt;
}
