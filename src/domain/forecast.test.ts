import { describe, expect, it } from 'vitest';
import { addDays } from '../lib/dates';
import {
  canForecast,
  forecastLevel,
  forecastMilestone,
  measurePace,
  paceInActions,
  remainingToLevel,
  requiredPace,
  type DatedDelta,
  type Pace,
} from './forecast';
import { computeProgress, pointsToFill, type CapacityConfig } from './progression';
import type { CompletionStatus, StepDefinition } from './types';

const TODAY = '2026-09-24';
const linear: CapacityConfig = { base: 100, increment: 50, manual: [] };

/** One ACTIVE completion of `points` on each of the given days before today (0 = today). */
function daily(points: number, ...daysAgo: number[]) {
  const entries: DatedDelta[] = daysAgo.map((d) => ({ date: addDays(TODAY, -d), delta: points }));
  const completions: { date: string; status: CompletionStatus }[] = daysAgo.map((d) => ({ date: addDays(TODAY, -d), status: 'ACTIVE' }));
  return { entries, completions };
}

function pace(deci: number, days: number, activeDays = 3): Pace {
  const perDay = deci / 10 / days;
  return { deci, days, activeDays, perDay, perWeek: perDay * 7 };
}

describe('measurePace', () => {
  it('is the net points of the last 28 days over 28 days', () => {
    // 40 days of history: only the last 28 count.
    const { entries, completions } = daily(10, ...Array.from({ length: 40 }, (_, i) => i));
    const p = measurePace({ today: TODAY, entries, completions })!;
    expect(p.days).toBe(28);
    expect(p.deci).toBe(2800);
    expect(p.activeDays).toBe(28);
    expect(p.perDay).toBe(10);
    expect(p.perWeek).toBe(70);
  });

  it('measures a skill younger than the window from its first row', () => {
    const { entries, completions } = daily(15, 9, 5, 0);
    const p = measurePace({ today: TODAY, entries, completions })!;
    // The first row is 9 days ago: days 9..0 are ten days.
    expect(p.days).toBe(10);
    expect(p.deci).toBe(450);
    expect(p.perWeek).toBeCloseTo(31.5);
  });

  it('counts cancellations: a cancelled completion earns nothing and makes no active day', () => {
    const { entries, completions } = daily(10, 6, 4, 2, 1);
    entries.push({ date: addDays(TODAY, -1), delta: -10 });
    completions[3] = { date: addDays(TODAY, -1), status: 'CANCELLED' as const };
    const p = measurePace({ today: TODAY, entries, completions })!;
    expect(p.deci).toBe(300);
    expect(p.activeDays).toBe(3);
    expect(p.days).toBe(7);
  });

  it('counts a row on its date: a back-dated one inside the window counts, one before it does not', () => {
    const inside = daily(10, 20, 3, 2);
    expect(measurePace({ today: TODAY, ...inside })!.days).toBe(21);
    const before = daily(10, 40, 3, 2, 1);
    const p = measurePace({ today: TODAY, ...before })!;
    expect(p.days).toBe(28);
    expect(p.deci).toBe(300);
  });

  it('leaves excluded dates out of the points and the days (the seam for paused days)', () => {
    const { entries, completions } = daily(10, 27, 10, 9, 8, 2);
    const paused = new Set([addDays(TODAY, -10), addDays(TODAY, -9), addDays(TODAY, -8)]);
    const p = measurePace({ today: TODAY, entries, completions, excluded: (d) => paused.has(d) })!;
    expect(p.days).toBe(25);
    expect(p.deci).toBe(200);
    expect(p.activeDays).toBe(2);
  });

  it('is null without a row', () => {
    expect(measurePace({ today: TODAY, entries: [], completions: [] })).toBeNull();
  });
});

describe('canForecast', () => {
  it('needs an active skill, three active days and points gained', () => {
    const three = measurePace({ today: TODAY, ...daily(5, 5, 3, 1) });
    const two = measurePace({ today: TODAY, ...daily(5, 3, 1) });
    expect(canForecast('ACTIVE', three)).toBe(true);
    expect(canForecast('ACTIVE', two)).toBe(false);
    expect(canForecast('COMPLETED', three)).toBe(false);
    expect(canForecast('ARCHIVED', three)).toBe(false);
    expect(canForecast('ACTIVE', null)).toBe(false);
    // Three active days whose points were corrected away: no pace, no forecast.
    const { entries, completions } = daily(5, 5, 3, 1);
    entries.push({ date: addDays(TODAY, -1), delta: -15 });
    expect(canForecast('ACTIVE', measurePace({ today: TODAY, entries, completions }))).toBe(false);
  });
});

describe('forecastLevel', () => {
  it('is today + ⌈remaining / pace per day⌉', () => {
    // Flask 1 of 100 with 40 in it; 10 a day → 6 days.
    const progress = computeProgress(40, linear);
    expect(forecastLevel(progress, pace(2800, 28), TODAY)).toEqual({ date: '2026-09-30', days: 6 });
    // 7 a day: 60 / 7 = 8.57 → 9 days.
    expect(forecastLevel(progress, pace(490, 7), TODAY)).toEqual({ date: '2026-10-03', days: 9 });
    // Tenths on integers: 0.1 left at 0.1 a day is one day, never 0 or a rounding error.
    expect(forecastLevel(computeProgress(99.9, linear), pace(1, 1), TODAY)).toEqual({ date: '2026-09-25', days: 1 });
  });

  it('crosses a month and a year boundary', () => {
    expect(forecastLevel(computeProgress(0, linear), pace(1000, 10), '2026-12-25')).toEqual({ date: '2027-01-04', days: 10 });
  });

  it('is null past five years', () => {
    // 100 points at 0.1 a week: far past the horizon.
    expect(forecastLevel(computeProgress(0, linear), pace(1, 28), TODAY)).toBeNull();
    // Exactly at the horizon (1826 days from 2026-09-24 to 2031-09-24) still counts.
    expect(forecastLevel(computeProgress(0, linear), pace(1000, 1826), TODAY)).toEqual({ date: '2031-09-24', days: 1826 });
    expect(forecastLevel(computeProgress(0, linear), pace(1000, 1827), TODAY)).toBeNull();
  });
});

describe('forecastMilestone', () => {
  it('walks manual thresholds, then the increment, level by level', () => {
    const config: CapacityConfig = { base: 100, increment: 20, manual: [50, 80] };
    // Levels 1..4: 50 + 80 + 100 + 120 = 350.
    expect(pointsToFill(4, config)).toBe(350);
    expect(remainingToLevel(60, 4, config)).toBe(2900);
    // 290 missing at 10 a day: 29 days.
    expect(forecastMilestone(60, 4, config, pace(2800, 28), TODAY)).toEqual({ date: '2026-10-23', days: 29 });
  });

  it('is null once the milestone is reached', () => {
    expect(remainingToLevel(250, 2, linear)).toBeNull();
    expect(forecastMilestone(250, 2, linear, pace(2800, 28), TODAY)).toBeNull();
    expect(forecastMilestone(400, 2, linear, pace(2800, 28), TODAY)).toBeNull();
  });

  it('is null past five years, without walking a thousand levels to know it', () => {
    expect(forecastMilestone(0, 1000, linear, pace(2800, 28), TODAY)).toBeNull();
    expect(remainingToLevel(0, 1_000_000, linear, 10_000)).toBe(Infinity);
  });
});

describe('requiredPace', () => {
  it('is the inverse of the milestone forecast', () => {
    // 250 to go by 50 days: 35 a week.
    const need = requiredPace(0, 2, linear, TODAY, addDays(TODAY, 50))!;
    expect(need).toEqual({ perWeek: 35, days: 50, onPace: false });
    const at = forecastMilestone(0, 2, linear, pace(need.perWeek * 10, 7), TODAY);
    expect(at).toEqual({ date: addDays(TODAY, 50), days: 50 });
  });

  it('rounds up to whole points and says when the current pace is enough', () => {
    // 100 in 3 days: 233.3 a week → 234.
    expect(requiredPace(0, 1, linear, TODAY, addDays(TODAY, 3))!.perWeek).toBe(234);
    expect(requiredPace(0, 1, linear, TODAY, addDays(TODAY, 10), pace(2800, 28))!.onPace).toBe(true);
    expect(requiredPace(0, 1, linear, TODAY, addDays(TODAY, 9), pace(2800, 28))!.onPace).toBe(false);
  });

  it('is null for today or before, and for a milestone reached', () => {
    expect(requiredPace(0, 2, linear, TODAY, TODAY)).toBeNull();
    expect(requiredPace(0, 2, linear, TODAY, addDays(TODAY, -3))).toBeNull();
    expect(requiredPace(300, 2, linear, TODAY, addDays(TODAY, 30))).toBeNull();
  });
});

describe('paceInActions', () => {
  const base = { skillId: 's', schedule: { kind: 'MANUAL' as const }, scheduleFrom: TODAY, isActive: true, createdAt: '', updatedAt: '' };
  const talk: StepDefinition = { ...base, id: 'talk', name: 'Разговор', type: 'BOOLEAN', points: 15, pointsPerMinute: null, defaultMinutes: null };
  const reading: StepDefinition = { ...base, id: 'read', name: 'Чтение', type: 'TIMED', points: 0, pointsPerMinute: 0.8, defaultMinutes: 30 };
  const noMinutes: StepDefinition = { ...base, id: 'run', name: 'Бег', type: 'TIMED', points: 0, pointsPerMinute: 1, defaultMinutes: null };
  const hidden: StepDefinition = { ...talk, id: 'old', name: 'Старое', isActive: false };
  const tiny: StepDefinition = { ...reading, id: 'tiny', name: 'Минутка', pointsPerMinute: 0.01, defaultMinutes: 1 };

  it('says how often each step alone covers the points: BOOLEAN by its points, TIMED by its usual minutes', () => {
    expect(paceInActions(70, [talk, reading, noMinutes, hidden, tiny])).toEqual([
      { stepId: 'talk', name: 'Разговор', type: 'BOOLEAN', points: 15, minutes: null, timesPerWeek: 5 },
      // 30 min × 0.8 = 24 points: 70 / 24 → 3.
      { stepId: 'read', name: 'Чтение', type: 'TIMED', points: 24, minutes: 30, timesPerWeek: 3 },
    ]);
  });

  it('works on tenths', () => {
    const half = { ...reading, pointsPerMinute: 0.25, defaultMinutes: 25 }; // 6.3 points
    expect(paceInActions(12.6, [half])[0]!.timesPerWeek).toBe(2);
  });
});
