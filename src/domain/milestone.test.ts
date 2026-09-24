import { describe, expect, it } from 'vitest';
import { canCompleteSkill, isMilestoneReached, reconcileMilestone } from './milestone';
import { computeProgress, type CapacityConfig } from './progression';
import type { Milestone } from './types';

const config: CapacityConfig = { base: 10, increment: 0, manual: [] };
const now = '2026-09-24T10:00:00.000Z';
const earlier = '2026-09-01T10:00:00.000Z';

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    skillId: 's1',
    name: 'Достичь C1',
    targetFlaskNumber: 3,
    reachedAt: null,
    decision: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('isMilestoneReached', () => {
  it('requires the target number of fully filled flasks', () => {
    expect(isMilestoneReached(milestone(), computeProgress(29, config))).toBe(false);
    expect(isMilestoneReached(milestone(), computeProgress(30, config))).toBe(true);
    expect(isMilestoneReached(milestone(), computeProgress(55, config))).toBe(true);
  });
});

describe('reconcileMilestone', () => {
  const active = { status: 'ACTIVE' as const };

  it('stores the derived reach date and falls back to now', () => {
    expect(reconcileMilestone(milestone(), active, computeProgress(30, config), earlier, now)).toEqual({
      reachedAt: earlier,
      updatedAt: now,
    });
    expect(reconcileMilestone(milestone(), active, computeProgress(30, config), null, now)).toEqual({
      reachedAt: now,
      updatedAt: now,
    });
  });

  it('changes nothing when the stored date already matches', () => {
    expect(reconcileMilestone(milestone({ reachedAt: earlier }), active, computeProgress(40, config), earlier, now)).toBeNull();
  });

  it('replaces a stale date with the derived one', () => {
    expect(reconcileMilestone(milestone({ reachedAt: now }), active, computeProgress(40, config), earlier, now)).toEqual({
      reachedAt: earlier,
      updatedAt: now,
    });
  });

  it('un-reaches an active skill that dropped below the target', () => {
    const m = milestone({ reachedAt: earlier, decision: 'CONTINUE' });
    expect(reconcileMilestone(m, active, computeProgress(25, config), null, now)).toEqual({
      reachedAt: null,
      decision: null,
      updatedAt: now,
    });
  });

  it('keeps a completed skill reached', () => {
    const m = milestone({ reachedAt: earlier });
    expect(reconcileMilestone(m, { status: 'COMPLETED' }, computeProgress(0, config), null, now)).toBeNull();
  });
});

describe('canCompleteSkill', () => {
  it('needs an active skill with a reached milestone', () => {
    expect(canCompleteSkill({ status: 'ACTIVE' }, milestone())).toBe(false);
    expect(canCompleteSkill({ status: 'ACTIVE' }, milestone({ reachedAt: now }))).toBe(true);
    expect(canCompleteSkill({ status: 'COMPLETED' }, milestone({ reachedAt: now }))).toBe(false);
    expect(canCompleteSkill({ status: 'ACTIVE' }, undefined)).toBe(false);
  });
});
