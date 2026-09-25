// «Итоги недели» and the home entry to it: read models over the cached history read of the
// achievements (services/achievements.ts), so a recap never re-reads the journal the tab has
// just evaluated. The recap itself is a pure function of the journal (domain/recap.ts).

import { db } from '../data/db';
import { addDays, localDate, weekStart } from '../lib/dates';
import { fromDeci, toDeci } from '../domain/points';
import { activeCompletions, type Records } from '../domain/records';
import { weekRecap, type WeekRecap } from '../domain/recap';
import { readHistory, snapshotTables } from './achievements';

export interface RecapView {
  recap: WeekRecap;
  /** The records of the whole journal (the values of the ones set this week). */
  records: Records;
  skillNames: Record<string, string>;
  /** Stored progress themes of the skills, for the fastest level's name. */
  skillThemes: Record<string, string>;
  /** The Monday of the earliest week the switcher goes back to. */
  firstWeek: string;
  /** The Monday of the current week: the switcher goes no further. */
  currentWeek: string;
}

/** The week «Итоги недели» opens on: the last completed one. */
export function lastCompletedWeek(today: string = localDate()): string {
  return addDays(weekStart(today), -7);
}

/**
 * The recap of the week of `week` (any date in it). The switcher's range: from the week of the
 * first completion (or the last completed week, when that is later) to the current week.
 */
export async function getRecapView(week: string, today: string = localDate()): Promise<RecapView> {
  return db.transaction('r', snapshotTables(), async () => {
    const history = await readHistory();
    const { snapshot } = history;
    const records = history.records();
    const recap = weekRecap(snapshot, week, { achievements: history.evaluation.states, records });
    const first = activeCompletions(snapshot).reduce<string | null>((min, c) => (min === null || c.date < min ? c.date : min), null);
    const fallback = lastCompletedWeek(today);
    return {
      recap,
      records,
      skillNames: Object.fromEntries(snapshot.skills.map((s) => [s.id, s.name])),
      skillThemes: Object.fromEntries(snapshot.skills.map((s) => [s.id, s.theme])),
      firstWeek: first !== null && weekStart(first) < fallback ? weekStart(first) : fallback,
      currentWeek: weekStart(today),
    };
  });
}

export interface LastWeekLine {
  /** Monday of the previous week. */
  weekStart: string;
  points: number;
  activeDays: number;
}

/**
 * The home row «Итоги недели · 14–20 сентября»: the previous week, all through the current one,
 * when it had any completion; null otherwise. Reads that week's completions by index, inside
 * the caller's transaction when there is one (getHomeView).
 */
export async function getLastWeekLine(today: string = localDate()): Promise<LastWeekLine | null> {
  const from = lastCompletedWeek(today);
  const rows = await db.completions.where('[status+date]').between(['ACTIVE', from], ['ACTIVE', addDays(from, 6)], true, true).toArray();
  if (rows.length === 0) return null;
  return {
    weekStart: from,
    points: fromDeci(rows.reduce((sum, c) => sum + toDeci(c.pointsAwarded), 0)),
    activeDays: new Set(rows.map((c) => c.date)).size,
  };
}
