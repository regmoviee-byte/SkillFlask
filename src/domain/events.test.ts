import { describe, expect, it } from 'vitest';
import { milestoneReachedAt } from './events';
import { buildTimeline, type CapacityConfig } from './progression';

const config: CapacityConfig = { base: 10, increment: 0, manual: [] };

function timeline(deltas: number[]) {
  return buildTimeline(
    deltas.map((delta, i) => ({ delta, createdAt: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` })),
    config,
  );
}

describe('milestoneReachedAt', () => {
  it('is null while below the target', () => {
    expect(milestoneReachedAt(timeline([10, 5]), 2)).toBeNull();
    expect(milestoneReachedAt([], 1)).toBeNull();
  });

  it('returns the crossing date', () => {
    expect(milestoneReachedAt(timeline([10, 5, 5, 3]), 2)).toBe('2026-09-03T10:00:00.000Z');
  });

  it('forgets the date when progress drops below the target and keeps the second crossing', () => {
    expect(milestoneReachedAt(timeline([10, 10, -5]), 2)).toBeNull();
    expect(milestoneReachedAt(timeline([10, 10, -5, 5]), 2)).toBe('2026-09-04T10:00:00.000Z');
  });

  it('keeps the original crossing when the target is edited 3 → 1 → 3', () => {
    const t = timeline([10, 10, 10, 2]);
    expect(milestoneReachedAt(t, 3)).toBe('2026-09-03T10:00:00.000Z');
    expect(milestoneReachedAt(t, 1)).toBe('2026-09-01T10:00:00.000Z');
    expect(milestoneReachedAt(t, 3)).toBe('2026-09-03T10:00:00.000Z');
  });

  it('dates a multi-flask jump by the entry that crossed the target', () => {
    expect(milestoneReachedAt(timeline([35]), 3)).toBe('2026-09-01T10:00:00.000Z');
  });
});
