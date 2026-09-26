import { describe, expect, it } from 'vitest';
import { addDays } from '../../lib/dates';
import type { StepCompletion } from '../types';
import { restDays } from '../pause';
import { activeDates, bestDayStreak, weeksWithAtLeast } from '../streaks';
import { applyEvent, createStats } from './stats';

/** Mulberry32, as in dev/seed.ts: deterministic dates for the cross-check. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const progress = { totalPoints: 0, completedFlasks: 0, currentFlask: 1, pointsInCurrentFlask: 0, currentCapacity: 10, fill: 0 };

describe('replay stats', () => {
  it('keep the date records equal to the batch rules of streaks.ts for any order of dates', () => {
    for (const seed of [1, 7, 42]) {
      const random = prng(seed);
      const stats = createStats({ skills: [{ id: 's', name: 's', status: 'ACTIVE' } as never], milestones: [] });
      const dates: string[] = [];
      for (let i = 0; i < 300; i++) {
        const date = addDays('2025-11-01', Math.floor(random() * 200));
        dates.push(date);
        const completion = { id: `c${i}`, stepId: 'st', date, status: 'ACTIVE' } as StepCompletion;
        applyEvent(stats, {
          at: `t${i}`,
          kind: 'TX',
          tx: { id: `t${i}`, skillId: 's', completionId: completion.id, delta: 1, reason: 'COMPLETION', createdAt: `t${i}` },
          completion,
          before: progress,
          after: progress,
          levelChange: 0,
          effective: true,
          minutes: 0,
        });
        const sorted = activeDates(dates.map((d) => ({ date: d, status: 'ACTIVE' })));
        expect(stats.global.activeDays).toBe(sorted.length);
        expect(stats.global.bestDayStreak).toBe(bestDayStreak(sorted));
        expect(stats.global.rhythmWeeks).toBe(weeksWithAtLeast(sorted, 3).length);
      }
    }
  });

  it('bridge the streak over rest days exactly like the batch rule, for any order of dates', () => {
    for (const seed of [3, 11]) {
      const random = prng(seed);
      const snapshot = {
        skills: [{ id: 's', name: 's', status: 'ACTIVE', createdAt: '2025-10-01T09:00:00.000Z', archivedAt: null, completedAt: null } as never],
        milestones: [],
        pauses: [
          { id: 'p1', skillId: 's', from: '2025-11-20', until: '2025-12-10', createdAt: '2025-11-20T09:00:00.000Z', endedAt: null },
          { id: 'p2', skillId: 's', from: '2026-02-01', until: '2026-02-03', createdAt: '2026-02-01T09:00:00.000Z', endedAt: null },
        ],
      };
      const rest = restDays(snapshot);
      const stats = createStats(snapshot);
      const dates: string[] = [];
      for (let i = 0; i < 200; i++) {
        const date = addDays('2025-11-01', Math.floor(random() * 120));
        dates.push(date);
        const completion = { id: `c${i}`, stepId: 'st', date, status: 'ACTIVE' } as StepCompletion;
        applyEvent(stats, {
          at: `t${i}`,
          kind: 'TX',
          tx: { id: `t${i}`, skillId: 's', completionId: completion.id, delta: 1, reason: 'COMPLETION', createdAt: `t${i}` },
          completion,
          before: progress,
          after: progress,
          levelChange: 0,
          effective: true,
          minutes: 0,
        });
        const sorted = activeDates(dates.map((d) => ({ date: d, status: 'ACTIVE' })));
        expect(stats.global.bestDayStreak).toBe(bestDayStreak(sorted, rest));
      }
    }
  });
});
