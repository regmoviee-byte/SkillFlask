// «Поделиться прогрессом» (v0.5 package 19): what the share card of a skill shows, read in one
// transaction and derived from the journal like every other view. Loaded only by the share
// sheet's lazy chunk.
//
// - Progress is the journal folded with the skill's capacities (the hero's numbers).
// - «Лучшая серия» is the skill's own longest run of days with an ACTIVE completion
//   (domain/streaks.ts bestDayStreak): the skill's paused days neither break nor extend it,
//   as the pause promises (domain/pause.ts); below two days there is no run to show.
// - «Активных дней за 30 дней» counts the dates with an ACTIVE completion of this skill from
//   29 days before the view's date to that date.

import { db } from '../data/db';
import { addDays, diffDays, localDate } from '../lib/dates';
import { pausedDays, pauseOn } from '../domain/pause';
import { compareJournalOrder, computeProgress, foldJournal, type Progress } from '../domain/progression';
import { activeDates, bestDayStreak, dayStreaks } from '../domain/streaks';
import type { Milestone, Pause, Skill } from '../domain/types';

/** The window of «активных дней»: the view's date and the 29 days before it. */
export const SHARE_ACTIVE_WINDOW = 30;

export interface ShareCardData {
  skill: Skill;
  milestone: Milestone | undefined;
  progress: Progress;
  /** The skill's best run of days (≥ 2), with `bridged` when rest days of a pause lie inside it; null below two days. */
  bestStreak: { days: number; bridged: boolean } | null;
  /** Dates with an ACTIVE completion in the last SHARE_ACTIVE_WINDOW days, the view's date included. */
  activeDays30: number;
  /** Dates with an ACTIVE completion ever. */
  activeDaysTotal: number;
  /** The pause an ACTIVE skill rests in on the view's date, null otherwise. */
  pause: Pause | null;
}

/** The card of a skill; null when it does not exist. */
export async function getShareCardData(skillId: string, today: string = localDate()): Promise<ShareCardData | null> {
  return db.transaction('r', [db.skills, db.milestones, db.levelThresholds, db.completions, db.transactions, db.pauses], async () => {
    const skill = await db.skills.get(skillId);
    if (!skill) return null;
    const [milestone, thresholds, completions, transactions, pauses] = await Promise.all([
      db.milestones.where('skillId').equals(skillId).first(),
      db.levelThresholds.where('skillId').equals(skillId).sortBy('flaskNumber'),
      db.completions.where('skillId').equals(skillId).toArray(),
      db.transactions.where('skillId').equals(skillId).toArray(),
      db.pauses.where('skillId').equals(skillId).toArray(),
    ]);
    const config = { base: skill.capacityBase, increment: skill.capacityIncrement, manual: thresholds.map((t) => t.requiredPoints) };
    const progress = computeProgress(foldJournal(transactions.sort(compareJournalOrder).map((t) => t.delta)), config);

    const dates = activeDates(completions);
    const rest = pausedDays(pauses, skillId);
    const best = bestDayStreak(dates, rest);
    const run = best >= 2 ? dayStreaks(dates, rest).find((r) => r.length === best) : undefined;
    const from = addDays(today, -(SHARE_ACTIVE_WINDOW - 1));

    return {
      skill,
      milestone,
      progress,
      bestStreak: run ? { days: run.length, bridged: diffDays(run.start, run.end) + 1 > run.length } : null,
      activeDays30: dates.filter((date) => date >= from && date <= today).length,
      activeDaysTotal: dates.length,
      pause: skill.status === 'ACTIVE' ? pauseOn(pauses, skillId, today) : null,
    };
  });
}
