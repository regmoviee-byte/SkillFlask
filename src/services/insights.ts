// «Прогноз» and «Активность» (v0.5 package 14): read models over the journal, one read
// transaction per view like the rest of services/queries.ts. The screens load them from lazy
// chunks (ui/insights), so none of this is part of the first paint.
//
// - A journal row counts on its completion's `date` (the day the step was done, a back-dated
//   completion included); a row without a completion (an imported correction) on the local
//   date it was written.
// - The heat map covers ACTIVITY_WEEKS weeks ending with the current one, ACTIVE completions
//   only, read by index for that range.

import { db } from '../data/db';
import { localDate } from '../lib/dates';
import { activityByDay, type DayActivity } from '../domain/activity';
import { ACTIVITY_WEEKS, activityStart } from '../domain/activityWindow';
import { forecastMilestone, levelForecast, type ForecastDate, type Pace } from '../domain/forecast';
import { compareJournalOrder, computeProgress, foldJournal, type CapacityConfig, type Progress } from '../domain/progression';
import type { Milestone, Skill, StepCompletion, StepDefinition } from '../domain/types';

export { ACTIVITY_WEEKS, activityStart };

/** A completion as the day sheet lists it. */
export interface ActivityCompletion {
  id: string;
  skillId: string;
  stepName: string;
  points: number;
  /** A TIMED completion's minutes; null otherwise. */
  minutes: number | null;
  note: string | null;
}

export interface ActivityView {
  /** First date of the map (a Monday) and the last one (today). */
  from: string;
  today: string;
  /** The days with an ACTIVE completion. */
  days: Map<string, DayActivity>;
  /** Those completions per date, in the order they were written. */
  byDate: Map<string, ActivityCompletion[]>;
  /** Names of the skills the completions belong to. */
  skillNames: Record<string, string>;
}

function activityView(completions: StepCompletion[], skills: Skill[], today: string): ActivityView {
  const from = activityStart(today);
  const active = completions.filter((c) => c.status === 'ACTIVE' && c.date >= from && c.date <= today);
  active.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const byDate = new Map<string, ActivityCompletion[]>();
  for (const c of active) {
    const list = byDate.get(c.date) ?? [];
    list.push({ id: c.id, skillId: c.skillId, stepName: c.stepName, points: c.pointsAwarded, minutes: c.durationMinutes, note: c.note });
    byDate.set(c.date, list);
  }
  return {
    from,
    today,
    days: activityByDay(active, from, today),
    byDate,
    skillNames: Object.fromEntries(skills.map((s) => [s.id, s.name])),
  };
}

/** The heat map of one skill; null when the skill does not exist. */
export async function getSkillActivity(skillId: string, today: string = localDate()): Promise<ActivityView | null> {
  return db.transaction('r', [db.skills, db.completions], async () => {
    const skill = await db.skills.get(skillId);
    if (!skill) return null;
    const completions = await db.completions
      .where('[skillId+date]')
      .between([skillId, activityStart(today)], [skillId, today], true, true)
      .toArray();
    return activityView(completions, [skill], today);
  });
}

/** The heat map of every skill together («Все навыки» on the home screen). */
export async function getAllActivity(today: string = localDate()): Promise<ActivityView> {
  return db.transaction('r', [db.skills, db.completions], async () => {
    const [skills, completions] = await Promise.all([
      db.skills.toArray(),
      db.completions.where('[status+date]').between(['ACTIVE', activityStart(today)], ['ACTIVE', today], true, true).toArray(),
    ]);
    return activityView(completions, skills, today);
  });
}

export interface ForecastView {
  skill: Skill;
  milestone: Milestone | undefined;
  config: CapacityConfig;
  progress: Progress;
  pace: Pace;
  /** When the current level fills. */
  level: ForecastDate;
  /** When the milestone's target level is reached; null once reached or past the horizon. */
  milestoneDate: ForecastDate | null;
  /** Active steps, oldest first: «А если к дате?» names them. */
  steps: StepDefinition[];
}

/**
 * The forecast of a skill («В таком темпе колба 3 заполнится ≈ 12 октября»); null when there is
 * none to show: not an active skill, too few days of practice lately, no pace, or further than
 * the horizon. `excluded` leaves dates out of the pace (paused days, package 18).
 */
export async function getSkillForecast(
  skillId: string,
  today: string = localDate(),
  excluded?: (date: string) => boolean,
): Promise<ForecastView | null> {
  return db.transaction('r', [db.skills, db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions], async () => {
    const skill = await db.skills.get(skillId);
    if (!skill || skill.status !== 'ACTIVE') return null;
    const [milestone, thresholds, steps, completions, transactions] = await Promise.all([
      db.milestones.where('skillId').equals(skillId).first(),
      db.levelThresholds.where('skillId').equals(skillId).sortBy('flaskNumber'),
      db.steps.where('skillId').equals(skillId).toArray(),
      db.completions.where('skillId').equals(skillId).toArray(),
      db.transactions.where('skillId').equals(skillId).toArray(),
    ]);
    const config: CapacityConfig = { base: skill.capacityBase, increment: skill.capacityIncrement, manual: thresholds.map((t) => t.requiredPoints) };
    const progress = computeProgress(foldJournal(transactions.sort(compareJournalOrder).map((t) => t.delta)), config);
    const forecast = levelForecast({ status: skill.status, progress, today, transactions, completions, excluded });
    if (!forecast) return null;
    const { pace, level } = forecast;
    return {
      skill,
      milestone,
      config,
      progress,
      pace,
      level,
      milestoneDate: milestone ? forecastMilestone(progress.totalPoints, milestone.targetFlaskNumber, config, pace, today) : null,
      steps: steps.filter((s) => s.isActive).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    };
  });
}
