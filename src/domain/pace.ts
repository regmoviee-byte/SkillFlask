// «Когда дойду» (v0.5 package 14), the part the skill screen needs at first paint: the pace of
// the last four weeks and the date the current level fills. getSkillDetails uses it to know
// whether the forecast line will be there, so its place is kept before the lazy line arrives;
// the rest of the forecast (the milestone, «А если к дате?») is in forecast.ts, which re-exports
// all of this. Pure, on deci-points like the rest of the journal code. Nothing here judges the
// pace: with too little data there is simply no forecast (null), and the UI says nothing at all.
//
// - Pace: the net points of the journal rows that count on a date of the window (the last 28
//   local days ending today), cancellations included, over the days of that window on or after
//   the skill's first row — a skill 10 days old is measured over 10 days, not 28.
// - A row counts on its completion's `date` (a back-dated completion on the day it was done),
//   a row without a completion on the local date it was written (datedDeltas).
// - A forecast exists for an ACTIVE skill with at least MIN_ACTIVE_DAYS days with an active
//   completion in the window and a pace above zero; a date further than HORIZON_YEARS away is
//   not a forecast either.
// - `excluded` leaves dates out of the window altogether (their points, their days): the
//   skill's paused days (package 18, domain/pause.ts). While the skill rests today there is no
//   forecast at all: a date «в таком темпе» would count on days it is resting.

import { addDays, diffDays, localDate } from '../lib/dates';
import { DECI, toDeci } from './points';
import type { Progress } from './progression';
import type { CompletionStatus, SkillStatus } from './types';

export const PACE_WINDOW_DAYS = 28;
export const MIN_ACTIVE_DAYS = 3;
export const HORIZON_YEARS = 5;

/** A journal row on the local date it counts on. */
export interface DatedDelta {
  date: string;
  delta: number;
}

export interface PaceInput {
  /** Local YYYY-MM-DD the window ends on (included). */
  today: string;
  /** Every journal row of the skill, on the date it counts on (the first one starts the window). */
  entries: readonly DatedDelta[];
  /** The skill's completions: days with an ACTIVE one are its active days. */
  completions: readonly { date: string; status: CompletionStatus }[];
  /** Dates left out of the window (the skill's paused days, package 18); none by default. */
  excluded?: (date: string) => boolean;
}

export interface Pace {
  /** Net deci-points of the window. */
  deci: number;
  /** Calendar days the pace is measured over (1..28). */
  days: number;
  /** Distinct dates with an ACTIVE completion in the window. */
  activeDays: number;
  /** Points per day and per week, unrounded. */
  perDay: number;
  perWeek: number;
}

/** The window's pace; null for a skill without a journal row on or before `today`. */
export function measurePace({ today, entries, completions, excluded = () => false }: PaceInput): Pace | null {
  let first: string | null = null;
  for (const e of entries) if (e.date <= today && (first === null || e.date < first)) first = e.date;
  if (first === null) return null;
  const windowStart = addDays(today, 1 - PACE_WINDOW_DAYS);
  const start = first > windowStart ? first : windowStart;
  const inWindow = (date: string) => date >= start && date <= today && !excluded(date);

  let days = 0;
  for (let date = start; date <= today; date = addDays(date, 1)) if (!excluded(date)) days += 1;
  if (days === 0) return null;

  let deci = 0;
  for (const e of entries) if (inWindow(e.date)) deci += toDeci(e.delta);
  const active = new Set<string>();
  for (const c of completions) if (c.status === 'ACTIVE' && inWindow(c.date)) active.add(c.date);

  const perDay = deci / DECI / days;
  return { deci, days, activeDays: active.size, perDay, perWeek: perDay * 7 };
}

/** True when a pace is worth a forecast: an active skill, three active days, points gained. */
export function canForecast(status: SkillStatus, pace: Pace | null): pace is Pace {
  return status === 'ACTIVE' && pace !== null && pace.activeDays >= MIN_ACTIVE_DAYS && pace.deci > 0;
}

export interface ForecastDate {
  /** Local YYYY-MM-DD. */
  date: string;
  /** Days from today (≥ 1). */
  days: number;
}

/** Days from `today` to the same date HORIZON_YEARS later (29 February → 1 March). */
export function horizonDays(today: string): number {
  return diffDays(today, `${Number(today.slice(0, 4)) + HORIZON_YEARS}${today.slice(4)}`);
}

/**
 * When `remainingDeci` more points come in at `pace`: today + ⌈remaining / pace per day⌉, on
 * integers (remaining × days / deci). Null past the horizon.
 */
export function dateAtPace(remainingDeci: number, pace: Pace, today: string): ForecastDate | null {
  if (pace.deci <= 0) return null;
  const days = Math.max(1, Math.ceil((remainingDeci * pace.days) / pace.deci));
  if (days > horizonDays(today)) return null;
  return { date: addDays(today, days), days };
}

/** The date the current level fills (colour of the hero: «колба 3 заполнится ≈ 12 октября»). */
export function forecastLevel(progress: Progress, pace: Pace, today: string): ForecastDate | null {
  return dateAtPace(toDeci(progress.currentCapacity) - toDeci(progress.pointsInCurrentFlask), pace, today);
}

/**
 * The journal rows of a skill on the dates they count on: a completion's row on the completion's
 * `date`, a row without one (an imported correction) on the local date it was written.
 */
export function datedDeltas(
  transactions: readonly { completionId: string | null; createdAt: string; delta: number }[],
  completions: readonly { id: string; date: string }[],
): DatedDelta[] {
  const dateOf = new Map(completions.map((c) => [c.id, c.date]));
  return transactions.map((t) => ({
    date: (t.completionId !== null ? dateOf.get(t.completionId) : undefined) ?? localDate(new Date(t.createdAt)),
    delta: t.delta,
  }));
}

export interface LevelForecast {
  pace: Pace;
  /** When the current level fills. */
  level: ForecastDate;
}

/**
 * The pace and the level date of a skill, or null when there is no forecast to show (see
 * canForecast, and the horizon). The one rule behind getSkillDetails' `hasForecast` and the
 * forecast itself (services/insights.ts), so the two never disagree.
 */
export function levelForecast(input: {
  status: SkillStatus;
  progress: Progress;
  today: string;
  transactions: readonly { completionId: string | null; createdAt: string; delta: number }[];
  completions: readonly { id: string; date: string; status: CompletionStatus }[];
  excluded?: (date: string) => boolean;
}): LevelForecast | null {
  const { status, progress, today, transactions, completions, excluded } = input;
  if (status !== 'ACTIVE' || excluded?.(today)) return null;
  const pace = measurePace({ today, entries: datedDeltas(transactions, completions), completions, excluded });
  if (!canForecast(status, pace)) return null;
  const level = forecastLevel(progress, pace, today);
  return level ? { pace, level } : null;
}
