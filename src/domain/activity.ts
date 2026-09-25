// «Активность» (v0.5 package 14): what a day of practice looked like, for the heat map. Pure,
// on local YYYY-MM-DD dates and deci-points. A day counts by the completion's `date` — the day
// the step was done, a back-dated completion included — never by when it was written. Only
// ACTIVE completions count: a cancelled one did not happen.
//
// Intensity is relative to the map's own days: the quartiles of the points of the days with
// points, so a light skill (5 points a day) shows as much contrast as a heavy one. The best day
// of the window is always the deepest colour.

import { fromDeci, toDeci } from './points';

export interface DayActivity {
  date: string;
  /** Points of the day's ACTIVE completions. */
  points: number;
  /** Number of the day's ACTIVE completions. */
  completions: number;
}

/** Levels of the map: 0 is a day without a completion, 1..4 lighter to deeper. */
export type Intensity = 0 | 1 | 2 | 3 | 4;

/** The days of `from..to` (included) with at least one ACTIVE completion, keyed by date. */
export function activityByDay(
  completions: readonly { date: string; status: string; pointsAwarded: number }[],
  from: string,
  to: string,
): Map<string, DayActivity> {
  const deci = new Map<string, { deci: number; n: number }>();
  for (const c of completions) {
    if (c.status !== 'ACTIVE' || c.date < from || c.date > to) continue;
    const day = deci.get(c.date) ?? { deci: 0, n: 0 };
    day.deci += toDeci(c.pointsAwarded);
    day.n += 1;
    deci.set(c.date, day);
  }
  const out = new Map<string, DayActivity>();
  for (const [date, day] of deci) out.set(date, { date, points: fromDeci(day.deci), completions: day.n });
  return out;
}

export interface IntensityScale {
  /** Upper bounds (included) of levels 1, 2 and 3, in points; nearest-rank quartiles. */
  q1: number;
  q2: number;
  q3: number;
  /** The best day's points: always level 4. */
  max: number;
}

/** The quartiles of the days with points (null without such a day). */
export function intensityScale(days: Iterable<DayActivity>): IntensityScale | null {
  const values = [...days].map((d) => d.points).filter((p) => p > 0).sort((a, b) => a - b);
  if (values.length === 0) return null;
  const rank = (p: number) => values[Math.max(0, Math.ceil(p * values.length) - 1)]!;
  return { q1: rank(0.25), q2: rank(0.5), q3: rank(0.75), max: values[values.length - 1]! };
}

/**
 * The level of a day: 0 without a completion; a day with completions worth 0 points (a minute
 * at a tiny rate) is still a day of practice, level 1; the best day is 4.
 */
export function intensity(day: DayActivity | undefined, scale: IntensityScale | null): Intensity {
  if (!day || day.completions === 0) return 0;
  if (!scale || day.points <= 0) return 1;
  if (day.points >= scale.max) return 4;
  if (day.points <= scale.q1) return 1;
  if (day.points <= scale.q2) return 2;
  if (day.points <= scale.q3) return 3;
  return 4;
}
