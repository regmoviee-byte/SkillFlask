import { describe, expect, it } from 'vitest';
import { eventsFromTimeline, milestoneReachedAt, minutesForPoints, newestFirst } from './events';
import { buildTimeline, type CapacityConfig } from './progression';
import type { PointTransaction, StepCompletion } from './types';

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

// ---- eventsFromTimeline ----

const e2eConfig: CapacityConfig = { base: 100, increment: 50, manual: [] };

function completion(id: string, over: Partial<StepCompletion> = {}): StepCompletion {
  return {
    id,
    skillId: 's1',
    stepId: 'step',
    stepName: 'Разговорная практика',
    stepType: 'BOOLEAN',
    pointsSnapshot: 5,
    durationMinutes: null,
    pointsAwarded: 5,
    date: '2026-09-20',
    source: 'MANUAL',
    status: 'ACTIVE',
    cancelledAt: null,
    note: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...over,
  };
}

let seq = 0;
function tx(completionId: string, delta: number, reason: PointTransaction['reason'], createdAt: string): PointTransaction {
  return { id: `t${++seq}`, skillId: 's1', completionId, delta, reason, createdAt };
}

const skill = {
  id: 's1',
  createdAt: '2026-09-19T08:00:00.000Z',
  status: 'ACTIVE' as const,
  completedAt: null,
  archivedAt: null,
};

function events(rows: PointTransaction[], completions: StepCompletion[], target = 10, over: Partial<typeof skill> | object = {}) {
  return eventsFromTimeline(
    buildTimeline(rows, e2eConfig),
    new Map(completions.map((c) => [c.id, c])),
    { name: 'Достичь C1', targetFlaskNumber: target },
    { ...skill, ...over } as typeof skill,
  );
}

describe('eventsFromTimeline', () => {
  it('E2E-002: 96 + 5 fills flask 1, the cancel gives it back', () => {
    const rows = [
      tx('big', 96, 'COMPLETION', '2026-09-20T10:00:00.000Z'),
      tx('small', 5, 'COMPLETION', '2026-09-20T11:00:00.000Z'),
      tx('small', -5, 'CANCELLATION', '2026-09-20T11:01:00.000Z'),
    ];
    const list = events(rows, [completion('big', { pointsAwarded: 96 }), completion('small', { status: 'CANCELLED' })]);
    expect(list.map((e) => e.type)).toEqual(['SKILL_CREATED', 'COMPLETION', 'COMPLETION', 'LEVEL_UP', 'CANCELLATION', 'LEVEL_DOWN']);
    const up = list[3]!;
    const down = list[5]!;
    expect(up).toMatchObject({ type: 'LEVEL_UP', flask: 1, levels: 1 });
    expect(down).toMatchObject({ type: 'LEVEL_DOWN', flask: 1, levels: 1 });
    expect(list[2]).toMatchObject({ type: 'COMPLETION', delta: 5, after: { currentFlask: 2, pointsInCurrentFlask: 1 } });
  });

  it('emits the milestone once per crossing, after the level event of the same operation', () => {
    const rows = [
      tx('a', 100, 'COMPLETION', '2026-09-20T10:00:00.000Z'), // flask 1 → target 1 reached
      tx('b', 10, 'COMPLETION', '2026-09-20T10:05:00.000Z'), // no crossing
      tx('a', -100, 'CANCELLATION', '2026-09-20T10:10:00.000Z'), // below again
      tx('a', 100, 'RESTORE', '2026-09-20T10:20:00.000Z'), // reached again
    ];
    const list = events(rows, [completion('a', { pointsAwarded: 100 }), completion('b', { pointsAwarded: 10 })], 1);
    expect(list.map((e) => e.type)).toEqual([
      'SKILL_CREATED',
      'COMPLETION',
      'LEVEL_UP',
      'MILESTONE_REACHED',
      'COMPLETION',
      'CANCELLATION',
      'LEVEL_DOWN',
      'MILESTONE_LOST',
      'RESTORE',
      'LEVEL_UP',
      'MILESTONE_REACHED',
    ]);
    expect(list.filter((e) => e.type === 'MILESTONE_REACHED')).toHaveLength(2);
    expect(list[3]).toMatchObject({ name: 'Достичь C1' });
  });

  it('a multi-flask jump is one LEVEL_UP naming the last filled flask', () => {
    const list = events([tx('a', 260, 'COMPLETION', '2026-09-20T10:00:00.000Z')], [completion('a', { pointsAwarded: 260 })]);
    // 100 + 150 = 250 → flasks 1 and 2 filled, 10 in flask 3.
    expect(list[2]).toMatchObject({ type: 'LEVEL_UP', flask: 2, levels: 2 });
  });

  it('dates a completion by its own date and later operations by when they were written', () => {
    const rows = [
      tx('a', 5, 'COMPLETION', '2026-09-24T09:00:00'),
      tx('a', -5, 'CANCELLATION', '2026-09-24T09:30:00'),
    ];
    const list = events(rows, [completion('a', { date: '2026-09-21', status: 'CANCELLED' })]);
    expect(list.find((e) => e.type === 'COMPLETION')?.date).toBe('2026-09-21');
    expect(list.find((e) => e.type === 'CANCELLATION')?.date).toBe('2026-09-24');
  });

  it('recovers the minutes of a correction when the points pin them down', () => {
    const timed = completion('t', { stepType: 'TIMED', pointsSnapshot: 0.5, durationMinutes: 45, pointsAwarded: 22.5 });
    const rows = [tx('t', 15, 'COMPLETION', '2026-09-20T10:00:00.000Z'), tx('t', 7.5, 'CORRECTION', '2026-09-20T12:00:00.000Z')];
    const correction = events(rows, [timed]).find((e) => e.type === 'CORRECTION');
    expect(correction).toMatchObject({ minutes: { from: 30, to: 45 } });
    // At 0.04 per minute both 2 and 3 minutes give 0.1: the duration is not shown.
    expect(minutesForPoints(0.1, 0.04)).toBeNull();
    expect(minutesForPoints(15, 0.5)).toBe(30);
  });

  it('places the completion of the skill after its last operation', () => {
    const rows = [tx('a', 5, 'COMPLETION', '2026-09-20T10:00:00.000Z')];
    const list = events(rows, [completion('a')], 10, { status: 'COMPLETED', completedAt: '2026-09-22T10:00:00.000Z' });
    expect(list.map((e) => e.type)).toEqual(['SKILL_CREATED', 'COMPLETION', 'SKILL_COMPLETED']);
  });
});

describe('newestFirst', () => {
  it('orders by day, newest on top, and keeps an operation below the moments it caused', () => {
    const rows = [
      tx('big', 96, 'COMPLETION', '2026-09-24T09:00:00'),
      tx('small', 5, 'COMPLETION', '2026-09-24T10:00:00'),
      tx('old', 5, 'COMPLETION', '2026-09-24T11:00:00'), // backdated to the 22nd
    ];
    const list = newestFirst(
      events(rows, [
        completion('big', { pointsAwarded: 96, date: '2026-09-24' }),
        completion('small', { date: '2026-09-24' }),
        completion('old', { date: '2026-09-22' }),
      ]),
    );
    expect(list.map((e) => `${e.type}:${e.date}`)).toEqual([
      'LEVEL_UP:2026-09-24',
      'COMPLETION:2026-09-24',
      'COMPLETION:2026-09-24',
      'COMPLETION:2026-09-22',
      `SKILL_CREATED:${skill.createdAt.slice(0, 10)}`,
    ]);
  });
});
