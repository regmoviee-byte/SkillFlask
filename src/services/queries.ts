import { db } from '../data/db';
import { addDays, localDate } from '../lib/dates';
import { compareJournalOrder, computeProgress, foldJournal, type CapacityConfig, type Progress } from '../domain/progression';
import type { Milestone, Skill, StepDefinition } from '../domain/types';

// Read models for the UI. Everything is derived from the journal on every read (principle 8),
// inside a read transaction so a mutation in flight never produces a half-updated view.

export interface SkillSummary {
  skill: Skill;
  milestone: Milestone | undefined;
  progress: Progress;
}

export interface SkillDetails extends SkillSummary {
  config: CapacityConfig;
  /** Active steps, oldest first. */
  steps: StepDefinition[];
  /** Steps removed from the list («Убранные действия»), most recently changed first. */
  hiddenSteps: StepDefinition[];
  /** ACTIVE completions dated today, per active step id (steps without any are absent). */
  todayCounts: Record<string, number>;
  /** Local date of the latest ACTIVE completion per step id (active and hidden), null without one. */
  lastDoneAt: Record<string, string | null>;
}

function configOf(skill: Skill, manual: number[]): CapacityConfig {
  return { base: skill.capacityBase, increment: skill.capacityIncrement, manual };
}

function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export async function listSkillSummaries(): Promise<SkillSummary[]> {
  return db.transaction('r', [db.skills, db.milestones, db.levelThresholds, db.transactions], async () => {
    const [skills, milestones, thresholds, transactions] = await Promise.all([
      db.skills.orderBy('createdAt').toArray(),
      db.milestones.toArray(),
      db.levelThresholds.toArray(),
      db.transactions.toArray(),
    ]);
    transactions.sort(compareJournalOrder);
    return skills.map((skill) => {
      const manual = thresholds
        .filter((t) => t.skillId === skill.id)
        .sort((a, b) => a.flaskNumber - b.flaskNumber)
        .map((t) => t.requiredPoints);
      const total = foldJournal(transactions.filter((t) => t.skillId === skill.id).map((t) => t.delta));
      return {
        skill,
        milestone: milestones.find((m) => m.skillId === skill.id),
        progress: computeProgress(total, configOf(skill, manual)),
      };
    });
  });
}

/**
 * `today` is the local date the view is for: screens pass it from useToday() and list it in
 * the live query's deps, so a screen left open across midnight re-reads «сегодня ×N».
 */
export async function getSkillDetails(id: string, today: string = localDate()): Promise<SkillDetails | null> {
  return db.transaction(
    'r',
    [db.skills, db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions],
    async () => {
      const skill = await db.skills.get(id);
      if (!skill) return null;
      const [milestone, thresholds, steps, completions, transactions] = await Promise.all([
        db.milestones.where('skillId').equals(id).first(),
        db.levelThresholds.where('skillId').equals(id).sortBy('flaskNumber'),
        db.steps.where('skillId').equals(id).toArray(),
        db.completions.where('skillId').equals(id).toArray(),
        db.transactions.where('skillId').equals(id).toArray(),
      ]);
      const activeSteps = steps.filter((s) => s.isActive).sort(byCreatedAt);
      const doneToday = activeSteps.length
        ? await db.completions
            .where('[stepId+date]')
            .anyOf(activeSteps.map((s) => [s.id, today]))
            .filter((c) => c.status === 'ACTIVE')
            .toArray()
        : [];
      const todayCounts: Record<string, number> = {};
      for (const c of doneToday) todayCounts[c.stepId] = (todayCounts[c.stepId] ?? 0) + 1;
      const lastDoneAt: Record<string, string | null> = Object.fromEntries(steps.map((s) => [s.id, null]));
      for (const c of completions) {
        const last = lastDoneAt[c.stepId];
        if (c.status === 'ACTIVE' && (last == null || c.date > last)) lastDoneAt[c.stepId] = c.date;
      }

      const config = configOf(skill, thresholds.map((t) => t.requiredPoints));
      // The history list has its own read model (services/history.ts).
      const total = foldJournal(transactions.sort(compareJournalOrder).map((t) => t.delta));
      return {
        skill,
        milestone,
        config,
        progress: computeProgress(total, config),
        steps: activeSteps,
        hiddenSteps: steps.filter((s) => !s.isActive).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
        todayCounts,
        lastDoneAt,
      };
    },
  );
}

export async function getSkillFormData(id: string): Promise<{ skill: Skill; milestone: Milestone | undefined; manual: number[] } | null> {
  return db.transaction('r', [db.skills, db.milestones, db.levelThresholds], async () => {
    const skill = await db.skills.get(id);
    if (!skill) return null;
    const [milestone, thresholds] = await Promise.all([
      db.milestones.where('skillId').equals(id).first(),
      db.levelThresholds.where('skillId').equals(id).sortBy('flaskNumber'),
    ]);
    return { skill, milestone, manual: thresholds.map((t) => t.requiredPoints) };
  });
}

export interface DataOverview {
  skills: number;
  /** Active steps (hidden ones are not counted). */
  steps: number;
  /** ACTIVE completions. */
  completions: number;
  /** Distinct dates with an ACTIVE completion in the 14 days ending `today` (the MVP criterion). */
  activeDays14: number;
}

/** Counts for the «Данные» and «О приложении» settings groups. */
export async function getDataOverview(today: string = localDate()): Promise<DataOverview> {
  return db.transaction('r', [db.skills, db.steps, db.completions], async () => {
    const from = addDays(today, -13);
    const [skills, steps, completions, recent] = await Promise.all([
      db.skills.count(),
      db.steps.filter((s) => s.isActive).count(),
      db.completions.where('[status+date]').between(['ACTIVE', ''], ['ACTIVE', '\uffff']).count(),
      db.completions.where('[status+date]').between(['ACTIVE', from], ['ACTIVE', today], true, true).toArray(),
    ]);
    return { skills, steps, completions, activeDays14: new Set(recent.map((c) => c.date)).size };
  });
}

/** The skill and its milestone as stored right now: what a celebration needs after a write. */
export async function getSkillWithMilestone(id: string): Promise<{ skill: Skill; milestone: Milestone | undefined } | null> {
  return db.transaction('r', [db.skills, db.milestones], async () => {
    const skill = await db.skills.get(id);
    if (!skill) return null;
    return { skill, milestone: await db.milestones.where('skillId').equals(id).first() };
  });
}
