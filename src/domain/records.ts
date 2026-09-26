// Personal records («Рекорды»): the best the journal holds, a pure function of the snapshot
// (principle 3.8), recomputed on every read and never stored. Only ACTIVE completions count, so
// cancelling the completion that made a record lowers it again, silently — the honesty rule of
// the achievements. There is nothing «current» here: «Лучшая серия» is the longest run ever
// (streaks.ts), never a streak that a quiet day could break. Ties go to the earliest date.
//
// Flask fills come from the same replay stream as the achievements (achievements/events.ts):
// the journal folded per skill with its capacities, so a flask is filled on the day the
// history shows it (events.ts operationDate), and a rollback un-fills it.

import { diffDays, weekStart } from '../lib/dates';
import { buildEvents, type HistorySnapshot, type ReplayEvent } from './achievements/events';
import { operationDate } from './events';
import { restDays } from './pause';
import { fromDeci, toDeci } from './points';
import type { TimelineEntry } from './progression';
import { activeDates, bestDayStreak, dayStreaks } from './streaks';
import type { PointTransaction, StepCompletion } from './types';

export interface DayPoints {
  points: number;
  date: string;
}

export interface Records {
  /** Most points on one local date, over all skills. */
  bestDay: DayPoints | null;
  /** The same per skill, most points first (skills with points only). */
  bestDayBySkill: (DayPoints & { skillId: string })[];
  /** Most points in one Monday..Sunday week, named by its Monday. */
  bestWeek: { points: number; weekStart: string } | null;
  /** Most completions on one local date. */
  mostCompletions: { count: number; date: string } | null;
  /**
   * The longest run of consecutive active dates ever (never a current streak; rest days of a
   * pause bridge it without counting); null below two days — a single day is no run.
   */
  bestStreak: { days: number; start: string; end: string } | null;
  /** The longest TIMED completion; null while there is none. */
  longestSession: { minutes: number; date: string; skillId: string; stepName: string } | null;
  /**
   * Fewest days between the fills of two consecutive flasks of one skill (flask ≥ 2): the
   * flask that filled the quickest after the one before it. 0 — the same day. A pair filled out
   * of calendar order (backdated history) is skipped.
   */
  fastestFlask: { days: number; flask: number; date: string; skillId: string } | null;
}

export type RecordKind = 'bestDay' | 'bestWeek' | 'mostCompletions' | 'bestStreak' | 'longestSession' | 'fastestFlask';

/** Display order of the records. */
export const RECORD_KINDS: readonly RecordKind[] = ['bestDay', 'bestWeek', 'mostCompletions', 'bestStreak', 'longestSession', 'fastestFlask'];

/** A flask that is filled at the end of the history, and when its (last) fill happened. */
export interface FlaskFill {
  skillId: string;
  flask: number;
  /** The day of the operation that filled it (operationDate). */
  date: string;
  /** Its write time, for a deterministic order. */
  at: string;
}

/** The ACTIVE completions of the skills in the snapshot. */
export function activeCompletions(snapshot: Pick<HistorySnapshot, 'skills' | 'completions'>): StepCompletion[] {
  const skills = new Set(snapshot.skills.map((s) => s.id));
  return snapshot.completions.filter((c) => c.status === 'ACTIVE' && skills.has(c.skillId));
}

/** A journal row of the replay as a buildTimeline entry, with its completion. */
export type SkillTimelineEntry = TimelineEntry<PointTransaction> & { completion: StepCompletion | undefined };

/** The journal rows of the replay per skill, in journal order. */
export function timelinesBySkill(events: readonly ReplayEvent[]): Map<string, SkillTimelineEntry[]> {
  const bySkill = new Map<string, SkillTimelineEntry[]>();
  for (const event of events) {
    if (event.kind !== 'TX') continue;
    const list = bySkill.get(event.tx.skillId) ?? [];
    list.push({ transaction: event.tx, before: event.before, after: event.after, levelChange: event.levelChange, completion: event.completion });
    bySkill.set(event.tx.skillId, list);
  }
  return bySkill;
}

/**
 * Every flask filled at the end of the history, with the day of the fill that still holds: a
 * rollback (a cancellation, a smaller correction) un-fills the flasks it gives back, and a
 * later refill dates them anew. Per skill by flask number; skills in the events' order.
 */
export function flaskFills(events: readonly ReplayEvent[]): FlaskFill[] {
  const bySkill = new Map<string, Map<number, FlaskFill>>();
  for (const event of events) {
    if (event.kind !== 'TX' || event.levelChange === 0) continue;
    const skillId = event.tx.skillId;
    const fills = bySkill.get(skillId) ?? new Map<number, FlaskFill>();
    bySkill.set(skillId, fills);
    if (event.levelChange > 0) {
      const date = operationDate(event.tx, event.completion);
      for (let flask = event.before.completedFlasks + 1; flask <= event.after.completedFlasks; flask++) {
        fills.set(flask, { skillId, flask, date, at: event.tx.createdAt });
      }
    } else {
      for (let flask = event.after.completedFlasks + 1; flask <= event.before.completedFlasks; flask++) fills.delete(flask);
    }
  }
  return [...bySkill.values()].flatMap((fills) => [...fills.values()].sort((a, b) => a.flask - b.flask));
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** By calendar date, then by when it was written (createdAt or at), then by id. */
function byDateThenWrite(a: { date: string; createdAt?: string; at?: string; id?: string }, b: typeof a): number {
  return compareStrings(a.date, b.date) || compareStrings(a.createdAt ?? a.at ?? '', b.createdAt ?? b.at ?? '') || compareStrings(a.id ?? '', b.id ?? '');
}

/** Sums per key (in tenths for points). */
function sumByKey<T>(items: readonly T[], key: (item: T) => string, deci: (item: T) => number): Map<string, number> {
  const sums = new Map<string, number>();
  for (const item of items) sums.set(key(item), (sums.get(key(item)) ?? 0) + deci(item));
  return sums;
}

/** The entry with the largest value above 0; ties go to the smallest key (the earliest date). */
function maxByKey(sums: ReadonlyMap<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const [key, value] of sums) {
    if (value <= 0) continue;
    if (!best || value > best[1] || (value === best[1] && key < best[0])) best = [key, value];
  }
  return best;
}

function bestDayOf(completions: readonly StepCompletion[]): DayPoints | null {
  const best = maxByKey(sumByKey(completions, (c) => c.date, (c) => toDeci(c.pointsAwarded)));
  return best && { date: best[0], points: fromDeci(best[1]) };
}

/**
 * All personal records of the snapshot. `events` may be passed when the caller already built
 * them (buildEvents of the same snapshot).
 */
export function computeRecords(snapshot: HistorySnapshot, events: readonly ReplayEvent[] = buildEvents(snapshot)): Records {
  // Oldest first, so every «first one wins» below is «the earliest wins» on a tie.
  const completions = activeCompletions(snapshot).sort(byDateThenWrite);

  const bySkill = new Map<string, StepCompletion[]>();
  for (const c of completions) {
    const list = bySkill.get(c.skillId);
    if (list) list.push(c);
    else bySkill.set(c.skillId, [c]);
  }
  const bestDayBySkill = [...bySkill.entries()]
    .flatMap(([skillId, list]) => {
      const best = bestDayOf(list);
      return best ? [{ skillId, ...best }] : [];
    })
    .sort((a, b) => b.points - a.points || compareStrings(a.date, b.date));

  const week = maxByKey(sumByKey(completions, (c) => weekStart(c.date), (c) => toDeci(c.pointsAwarded)));
  const most = maxByKey(sumByKey(completions, (c) => c.date, () => 1));

  // Rest days (the whole app on pause, package 18) neither break nor extend a run.
  const dates = activeDates(completions);
  const rest = restDays(snapshot);
  const streakDays = bestDayStreak(dates, rest);
  const run = streakDays >= 2 ? dayStreaks(dates, rest).find((r) => r.length === streakDays) : undefined;

  let longestSession: Records['longestSession'] = null;
  for (const c of completions) {
    const minutes = c.stepType === 'TIMED' ? (c.durationMinutes ?? 0) : 0;
    if (minutes > (longestSession?.minutes ?? 0)) longestSession = { minutes, date: c.date, skillId: c.skillId, stepName: c.stepName };
  }

  let fastestFlask: Records['fastestFlask'] = null;
  const fills = flaskFills(events);
  const fillOf = new Map(fills.map((f) => [`${f.skillId}:${f.flask}`, f]));
  for (const fill of [...fills].sort(byDateThenWrite)) {
    const previous = fill.flask >= 2 ? fillOf.get(`${fill.skillId}:${fill.flask - 1}`) : undefined;
    if (!previous) continue;
    // A backdated completion can fill the later flask on an earlier calendar day than the one
    // before it: that pair says nothing about speed, so it is no record (never a made-up «0»).
    const days = diffDays(previous.date, fill.date);
    if (days < 0) continue;
    if (!fastestFlask || days < fastestFlask.days) fastestFlask = { days, flask: fill.flask, date: fill.date, skillId: fill.skillId };
  }

  return {
    bestDay: bestDayOf(completions),
    bestDayBySkill,
    bestWeek: week && { weekStart: week[0], points: fromDeci(week[1]) },
    mostCompletions: most && { date: most[0], count: most[1] },
    bestStreak: run ? { days: run.length, start: run.start, end: run.end } : null,
    longestSession,
    fastestFlask,
  };
}

/** The local date a record was set on (for a week, its Monday). */
export function recordDate(records: Records, kind: RecordKind): string | null {
  switch (kind) {
    case 'bestDay':
      return records.bestDay?.date ?? null;
    case 'bestWeek':
      return records.bestWeek?.weekStart ?? null;
    case 'mostCompletions':
      return records.mostCompletions?.date ?? null;
    case 'bestStreak':
      return records.bestStreak?.end ?? null;
    case 'longestSession':
      return records.longestSession?.date ?? null;
    case 'fastestFlask':
      return records.fastestFlask?.date ?? null;
  }
}
