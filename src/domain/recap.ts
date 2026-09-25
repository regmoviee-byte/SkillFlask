// «Итоги недели»: one Monday..Sunday week of the journal, a pure function of the snapshot like
// the records it points at (records.ts). What happened, never what did not (tone rule 3); the
// comparison with the week before exists only in the user's favour (tone rule 5) — the flags
// below are false both when the week was equal and when it was smaller, so no screen can say
// «меньше». Only ACTIVE completions count; flasks are the fills that still hold (a rollback
// un-fills them), milestones the ones still reached; achievements are dated by the moment they
// were earned (achievements/evaluate.ts), everything else by its calendar day.

import { addDays, localDate, weekStart as mondayOf } from '../lib/dates';
import { evaluateAchievements } from './achievements/evaluate';
import { buildEvents, type HistorySnapshot } from './achievements/events';
import type { AchievementState } from './achievements/types';
import { milestoneReachedAt, operationDate } from './events';
import { fromDeci, toDeci } from './points';
import { activeCompletions, computeRecords, flaskFills, RECORD_KINDS, recordDate, timelinesBySkill, type RecordKind, type Records } from './records';
import type { StepCompletion } from './types';

export interface WeekRecap {
  /** Monday of the week. */
  weekStart: string;
  /** Its Sunday. */
  weekEnd: string;
  points: number;
  /** Distinct dates with an ACTIVE completion (0..7). */
  activeDays: number;
  /** Monday..Sunday: a completion on that date. */
  days: boolean[];
  completions: number;
  /** Flasks whose fill (the one that still holds) happened this week. */
  flasksFilled: number;
  /** Milestones reached this week and still reached. */
  milestones: { skillId: string; name: string; date: string }[];
  /** Achievements earned this week and still held, oldest first. */
  achievements: AchievementState[];
  /** The skill with the most points; a tie goes to the one that got there first. */
  topSkill: { skillId: string; points: number } | null;
  /** The action done most often; a tie goes to the one done first. */
  topAction: { stepId: string; skillId: string; name: string; count: number } | null;
  /**
   * Personal records set this week, in display order. Empty in the week of the first
   * completion: a record needs something before it.
   */
  records: RecordKind[];
  /** Only ever true in the user's favour; there is no «less» flag. */
  morePointsThanWeekBefore: boolean;
  moreDaysThanWeekBefore: boolean;
}

interface Totals {
  deci: number;
  dates: Set<string>;
  list: StepCompletion[];
}

function totals(completions: readonly StepCompletion[], from: string, to: string): Totals {
  const list = completions.filter((c) => c.date >= from && c.date <= to);
  return { deci: list.reduce((sum, c) => sum + toDeci(c.pointsAwarded), 0), dates: new Set(list.map((c) => c.date)), list };
}

const byDateThenWrite = (a: StepCompletion, b: StepCompletion) =>
  a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The key with the largest value; the first inserted wins a tie. */
function top(values: ReadonlyMap<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const entry of values) if (!best || entry[1] > best[1]) best = entry;
  return best;
}

export interface RecapOptions {
  /** The achievement states of the same snapshot, when the caller has them (a cached evaluation). */
  achievements?: readonly AchievementState[];
  /** The records of the same snapshot, when the caller has them. */
  records?: Records;
}

/** The recap of the week containing `weekStartDate` (any date of the week is accepted). */
export function weekRecap(snapshot: HistorySnapshot, weekStartDate: string, options: RecapOptions = {}): WeekRecap {
  const from = mondayOf(weekStartDate);
  const to = addDays(from, 6);
  const inWeek = (date: string) => date >= from && date <= to;
  const events = buildEvents(snapshot);
  const all = activeCompletions(snapshot);
  const week = totals(all, from, to);
  const before = totals(all, addDays(from, -7), addDays(from, -1));
  const list = [...week.list].sort(byDateThenWrite);

  const skillDeci = new Map<string, number>();
  const stepCounts = new Map<string, number>();
  for (const c of list) {
    skillDeci.set(c.skillId, (skillDeci.get(c.skillId) ?? 0) + toDeci(c.pointsAwarded));
    stepCounts.set(c.stepId, (stepCounts.get(c.stepId) ?? 0) + 1);
  }
  const bestSkill = top(skillDeci);
  const bestStep = top(stepCounts);
  // The action's name as the week logged it (the completion snapshot, like the history and
  // «Самое длинное занятие»): the latest of the week, so a later rename never rewrites a past week.
  const stepName = bestStep ? list.filter((c) => c.stepId === bestStep[0]).at(-1)!.stepName : '';

  const milestones: WeekRecap['milestones'] = [];
  const timelines = timelinesBySkill(events);
  for (const milestone of snapshot.milestones) {
    const timeline = timelines.get(milestone.skillId) ?? [];
    const target = milestone.targetFlaskNumber;
    const reachedAt = milestoneReachedAt(timeline, target);
    const crossing = timeline.find(
      (e) => e.transaction.createdAt === reachedAt && e.before.completedFlasks < target && e.after.completedFlasks >= target,
    );
    const date = crossing && operationDate(crossing.transaction, crossing.completion);
    if (date && inWeek(date)) milestones.push({ skillId: milestone.skillId, name: milestone.name, date });
  }
  milestones.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const achievements = (options.achievements ?? evaluateAchievements(snapshot))
    .filter((s) => s.unlocked && s.unlockedAt !== null && inWeek(localDate(new Date(s.unlockedAt))))
    .sort((a, b) => (a.unlockedAt! < b.unlockedAt! ? -1 : a.unlockedAt! > b.unlockedAt! ? 1 : 0));

  const records = options.records ?? computeRecords(snapshot, events);
  const hasEarlier = all.some((c) => c.date < from);
  const recordsSet = hasEarlier ? RECORD_KINDS.filter((kind) => {
    const date = recordDate(records, kind);
    return date !== null && inWeek(date);
  }) : [];

  return {
    weekStart: from,
    weekEnd: to,
    points: fromDeci(week.deci),
    activeDays: week.dates.size,
    days: Array.from({ length: 7 }, (_, i) => week.dates.has(addDays(from, i))),
    completions: week.list.length,
    flasksFilled: flaskFills(events).filter((fill) => inWeek(fill.date)).length,
    milestones,
    achievements,
    topSkill: bestSkill && { skillId: bestSkill[0], points: fromDeci(bestSkill[1]) },
    topAction: bestStep && { stepId: bestStep[0], skillId: list.find((c) => c.stepId === bestStep[0])!.skillId, name: stepName, count: bestStep[1] },
    records: recordsSet,
    morePointsThanWeekBefore: before.deci > 0 && week.deci > before.deci,
    moreDaysThanWeekBefore: before.dates.size > 0 && week.dates.size > before.dates.size,
  };
}
