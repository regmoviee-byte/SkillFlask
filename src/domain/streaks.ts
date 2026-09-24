// Calendar facts about practice days, for the achievement ladders «Дни с практикой», «Недели
// в ритме» and «Лучшая серия». Pure, on local YYYY-MM-DD dates. Only records are computed
// here: there is deliberately no «current streak» — nothing in the app may show a streak that
// a day without practice could break (principle 3.2). The batch functions define the rules;
// DayRecords keeps the same numbers incrementally for the achievement replay.

import { diffDays, weekStart } from '../lib/dates';

/** Distinct dates of the ACTIVE completions, oldest first; cancelled ones do not count. */
export function activeDates(completions: readonly { date: string; status: string }[]): string[] {
  const dates = new Set<string>();
  for (const c of completions) if (c.status === 'ACTIVE') dates.add(c.date);
  return [...dates].sort();
}

export interface DayStreak {
  /** Days in the run (≥ 1). */
  length: number;
  start: string;
  end: string;
}

/** Runs of consecutive calendar dates, oldest first. Duplicates and order of the input do not matter. */
export function dayStreaks(dates: readonly string[]): DayStreak[] {
  const sorted = [...new Set(dates)].sort();
  const runs: DayStreak[] = [];
  for (const date of sorted) {
    const last = runs.at(-1);
    if (last && diffDays(last.end, date) === 1) {
      last.end = date;
      last.length += 1;
    } else {
      runs.push({ length: 1, start: date, end: date });
    }
  }
  return runs;
}

/** The longest run of consecutive dates ever (0 without dates): a record that never resets. */
export function bestDayStreak(dates: readonly string[]): number {
  let best = 0;
  for (const run of dayStreaks(dates)) best = Math.max(best, run.length);
  return best;
}

/** The week a date belongs to, named by its Monday (weeks run Monday..Sunday). */
export function weekKey(date: string): string {
  return weekStart(date);
}

/** Keys of the weeks with at least `n` distinct dates, oldest first. The weeks need not be consecutive. */
export function weeksWithAtLeast(dates: readonly string[], n = 3): string[] {
  const perWeek = new Map<string, Set<string>>();
  for (const date of dates) {
    const key = weekKey(date);
    const days = perWeek.get(key) ?? new Set<string>();
    days.add(date);
    perWeek.set(key, days);
  }
  return [...perWeek.entries()]
    .filter(([, days]) => days.size >= n)
    .map(([key]) => key)
    .sort();
}

/** Days since 1970-01-01 of a YYYY-MM-DD date: consecutive dates differ by exactly 1. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

/** Day number of the Monday of that day's week (1970-01-01 was a Thursday). */
const mondayOf = (day: number) => day - ((day + 3) % 7);

/**
 * activeDates / bestDayStreak / weeksWithAtLeast, kept up to date one new date at a time:
 * O(length of the run) per date instead of re-reading every date, which made a long history
 * quadratic in the replay. Dates are only ever added, so the records only grow.
 */
export class DayRecords {
  private readonly days = new Set<number>();
  private readonly perWeek = new Map<number, number>();
  activeDays = 0;
  bestDayStreak = 0;
  /** Weeks with at least `rhythmDays` distinct dates. */
  rhythmWeeks = 0;

  constructor(private readonly rhythmDays = 3) {}

  /** Adds a date; a date seen before changes nothing. */
  add(date: string): void {
    const day = dayNumber(date);
    if (this.days.has(day)) return;
    this.days.add(day);
    this.activeDays = this.days.size;
    let start = day;
    let end = day;
    while (this.days.has(start - 1)) start -= 1;
    while (this.days.has(end + 1)) end += 1;
    this.bestDayStreak = Math.max(this.bestDayStreak, end - start + 1);
    const week = mondayOf(day);
    const inWeek = (this.perWeek.get(week) ?? 0) + 1;
    this.perWeek.set(week, inWeek);
    if (inWeek === this.rhythmDays) this.rhythmWeeks += 1;
  }
}
