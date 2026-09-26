// Calendar facts about practice days, for the achievement ladders «Дни с практикой», «Недели
// в ритме» and «Лучшая серия». Pure, on local YYYY-MM-DD dates. Only records are computed
// here: there is deliberately no «current streak» — nothing in the app may show a streak that
// a day without practice could break (principle 3.2). The batch functions define the rules;
// DayRecords keeps the same numbers incrementally for the achievement replay.
//
// Rest days (v0.5 package 18, domain/pause.ts restDays): a day on which the whole app was on
// pause neither breaks nor extends a run — active Monday, rest Tuesday to Thursday, active
// Friday is a run of two days. A day of practice during a pause is simply a day of practice.
// «Дни с практикой» and «Недели в ритме» count practice only, so rest days change neither.

import { addDays, diffDays, weekStart } from '../lib/dates';

/** A date the whole app rested on (domain/pause.ts restDays); none by default. */
export type RestDay = (date: string) => boolean;

const noRest: RestDay = () => false;

/** Every date strictly between `a` and `b` is a rest day (true when they are neighbours). */
function restBetween(a: string, b: string, rest: RestDay): boolean {
  for (let date = addDays(a, 1); date < b; date = addDays(date, 1)) if (!rest(date)) return false;
  return true;
}

/** Distinct dates of the ACTIVE completions, oldest first; cancelled ones do not count. */
export function activeDates(completions: readonly { date: string; status: string }[]): string[] {
  const dates = new Set<string>();
  for (const c of completions) if (c.status === 'ACTIVE') dates.add(c.date);
  return [...dates].sort();
}

export interface DayStreak {
  /** Days of practice in the run (≥ 1); rest days inside it are not counted. */
  length: number;
  start: string;
  end: string;
}

/**
 * Runs of consecutive calendar dates, oldest first; only rest days may stand between two dates
 * of one run. Duplicates and order of the input do not matter.
 */
export function dayStreaks(dates: readonly string[], rest: RestDay = noRest): DayStreak[] {
  const sorted = [...new Set(dates)].sort();
  const runs: DayStreak[] = [];
  for (const date of sorted) {
    const last = runs.at(-1);
    if (last && (diffDays(last.end, date) === 1 || restBetween(last.end, date, rest))) {
      last.end = date;
      last.length += 1;
    } else {
      runs.push({ length: 1, start: date, end: date });
    }
  }
  return runs;
}

/** The longest run of consecutive dates ever (0 without dates): a record that never resets. */
export function bestDayStreak(dates: readonly string[], rest: RestDay = noRest): number {
  let best = 0;
  for (const run of dayStreaks(dates, rest)) best = Math.max(best, run.length);
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

/** The YYYY-MM-DD date of a day number (dayNumber's inverse). */
function dateOfDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
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

  private first = Number.POSITIVE_INFINITY;
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly rhythmDays = 3,
    private readonly rest: RestDay = noRest,
  ) {}

  /** Adds a date; a date seen before changes nothing. */
  add(date: string): void {
    const day = dayNumber(date);
    if (this.days.has(day)) return;
    this.days.add(day);
    this.activeDays = this.days.size;
    this.first = Math.min(this.first, day);
    this.last = Math.max(this.last, day);
    // The run through the new date: days of practice on both sides, across rest days; the
    // walk never leaves the known dates, so an open pause cannot make it endless.
    let length = 1;
    for (let d = day - 1; d >= this.first; d--) {
      if (this.days.has(d)) length += 1;
      else if (!this.rest(dateOfDay(d))) break;
    }
    for (let d = day + 1; d <= this.last; d++) {
      if (this.days.has(d)) length += 1;
      else if (!this.rest(dateOfDay(d))) break;
    }
    this.bestDayStreak = Math.max(this.bestDayStreak, length);
    const week = mondayOf(day);
    const inWeek = (this.perWeek.get(week) ?? 0) + 1;
    this.perWeek.set(week, inWeek);
    if (inWeek === this.rhythmDays) this.rhythmWeeks += 1;
  }
}
