// The skill's history as a list of events (domain/events.ts), derived from the journal on
// every read like every other read model; the skill's marks are merged in at their dates.

import { db } from '../data/db';
import { eventsFromTimeline, isTransactionEvent, newestFirst, withMarks, type HistoryEvent } from '../domain/events';
import { buildTimeline, compareJournalOrder } from '../domain/progression';
import type { LevelThreshold, Mark, Milestone, PointTransaction, Skill, StepCompletion } from '../domain/types';

export const HISTORY_PAGE = 20;

/** The tables a history read covers (the search reads the same ones: services/search.ts). */
export const historyTables = () => [db.skills, db.milestones, db.levelThresholds, db.completions, db.transactions, db.marks];

/** Everything one skill's history is derived from. */
export interface SkillRows {
  milestone: Milestone | undefined;
  thresholds: LevelThreshold[];
  completions: StepCompletion[];
  transactions: PointTransaction[];
  marks: Mark[];
}

/** The skill's rows; inside a transaction over historyTables(). */
export async function readSkillRows(skillId: string): Promise<SkillRows> {
  const [milestone, thresholds, completions, transactions, marks] = await Promise.all([
    db.milestones.where('skillId').equals(skillId).first(),
    db.levelThresholds.where('skillId').equals(skillId).toArray(),
    db.completions.where('skillId').equals(skillId).toArray(),
    db.transactions.where('skillId').equals(skillId).toArray(),
    db.marks.where('skillId').equals(skillId).toArray(),
  ]);
  return { milestone, thresholds, completions, transactions, marks };
}

/** Every event of the skill, newest first: the journal replayed, its moments and the marks. */
export function historyEvents(skill: Skill, rows: SkillRows): HistoryEvent[] {
  const manual = [...rows.thresholds].sort((a, b) => a.flaskNumber - b.flaskNumber).map((t) => t.requiredPoints);
  const config = { base: skill.capacityBase, increment: skill.capacityIncrement, manual };
  const timeline = buildTimeline([...rows.transactions].sort(compareJournalOrder), config);
  const events = eventsFromTimeline(timeline, new Map(rows.completions.map((c) => [c.id, c])), rows.milestone, skill);
  return newestFirst(withMarks(events, rows.marks));
}

export interface SkillHistory {
  /**
   * Newest first, cut after `limit` operations (the moments an operation caused stay with it;
   * marks older than the cut come with the next page).
   */
  events: HistoryEvent[];
  /** Operations (journal rows) in the whole history. */
  operations: number;
  hasMore: boolean;
}

/** Null when the skill does not exist. `limit` counts operations, not separators. */
export async function getSkillHistory(skillId: string, limit: number = HISTORY_PAGE): Promise<SkillHistory | null> {
  return db.transaction('r', historyTables(), async () => {
    const skill = await db.skills.get(skillId);
    if (!skill) return null;
    const rows = await readSkillRows(skillId);
    const all = historyEvents(skill, rows);
    const operations = rows.transactions.length;

    if (operations <= limit) return { events: all, operations, hasMore: false };
    let seen = 0;
    const cut = all.findIndex((event) => isTransactionEvent(event) && ++seen === limit);
    return { events: all.slice(0, cut + 1), operations, hasMore: true };
  });
}
