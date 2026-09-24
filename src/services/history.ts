// The skill's history as a list of events (domain/events.ts), derived from the journal on
// every read like every other read model — nothing here is stored.

import { db } from '../data/db';
import { eventsFromTimeline, isTransactionEvent, newestFirst, type HistoryEvent } from '../domain/events';
import { buildTimeline, compareJournalOrder } from '../domain/progression';

export const HISTORY_PAGE = 20;

export interface SkillHistory {
  /** Newest first, cut after `limit` operations (the moments an operation caused stay with it). */
  events: HistoryEvent[];
  /** Operations (journal rows) in the whole history. */
  operations: number;
  hasMore: boolean;
}

/** Null when the skill does not exist. `limit` counts operations, not separators. */
export async function getSkillHistory(skillId: string, limit: number = HISTORY_PAGE): Promise<SkillHistory | null> {
  return db.transaction('r', [db.skills, db.milestones, db.levelThresholds, db.completions, db.transactions], async () => {
    const skill = await db.skills.get(skillId);
    if (!skill) return null;
    const [milestone, thresholds, completions, transactions] = await Promise.all([
      db.milestones.where('skillId').equals(skillId).first(),
      db.levelThresholds.where('skillId').equals(skillId).sortBy('flaskNumber'),
      db.completions.where('skillId').equals(skillId).toArray(),
      db.transactions.where('skillId').equals(skillId).toArray(),
    ]);
    const config = { base: skill.capacityBase, increment: skill.capacityIncrement, manual: thresholds.map((t) => t.requiredPoints) };
    const timeline = buildTimeline(transactions.sort(compareJournalOrder), config);
    const all = newestFirst(eventsFromTimeline(timeline, new Map(completions.map((c) => [c.id, c])), milestone, skill));

    if (transactions.length <= limit) return { events: all, operations: transactions.length, hasMore: false };
    let seen = 0;
    const cut = all.findIndex((event) => isTransactionEvent(event) && ++seen === limit);
    return { events: all.slice(0, cut + 1), operations: transactions.length, hasMore: true };
  });
}
