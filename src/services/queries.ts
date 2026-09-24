import { db } from '../data/db';
import { buildTimeline, computeProgress, totalPoints, type CapacityConfig, type Progress, type TimelineEntry } from '../domain/progression';
import type { Milestone, PointTransaction, Skill, StepCompletion, StepDefinition } from '../domain/types';

// Read models for the UI. Everything is derived from the journal on every read (principle 8).

export interface SkillSummary {
  skill: Skill;
  milestone: Milestone | undefined;
  progress: Progress;
}

export interface HistoryEntry extends TimelineEntry<PointTransaction> {
  completion: StepCompletion | undefined;
}

export interface SkillDetails extends SkillSummary {
  config: CapacityConfig;
  steps: StepDefinition[];
  /** Newest first. */
  history: HistoryEntry[];
}

function configOf(skill: Skill, manual: number[]): CapacityConfig {
  return { base: skill.capacityBase, increment: skill.capacityIncrement, manual };
}

function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export async function listSkillSummaries(): Promise<SkillSummary[]> {
  const [skills, milestones, thresholds, transactions] = await Promise.all([
    db.skills.orderBy('createdAt').toArray(),
    db.milestones.toArray(),
    db.levelThresholds.toArray(),
    db.transactions.toArray(),
  ]);
  return skills.map((skill) => {
    const manual = thresholds
      .filter((t) => t.skillId === skill.id)
      .sort((a, b) => a.flaskNumber - b.flaskNumber)
      .map((t) => t.requiredPoints);
    const total = totalPoints(transactions.filter((t) => t.skillId === skill.id).map((t) => t.delta));
    return {
      skill,
      milestone: milestones.find((m) => m.skillId === skill.id),
      progress: computeProgress(total, configOf(skill, manual)),
    };
  });
}

export async function getSkillDetails(id: string): Promise<SkillDetails | null> {
  const skill = await db.skills.get(id);
  if (!skill) return null;
  const [milestone, thresholds, steps, completions, transactions] = await Promise.all([
    db.milestones.where('skillId').equals(id).first(),
    db.levelThresholds.where('skillId').equals(id).sortBy('flaskNumber'),
    db.steps.where('skillId').equals(id).toArray(),
    db.completions.where('skillId').equals(id).toArray(),
    db.transactions.where('skillId').equals(id).toArray(),
  ]);
  const config = configOf(skill, thresholds.map((t) => t.requiredPoints));
  const completionById = new Map(completions.map((c) => [c.id, c]));
  const timeline = buildTimeline(transactions.sort(byCreatedAt), config);
  return {
    skill,
    milestone,
    config,
    progress: timeline.at(-1)?.after ?? computeProgress(0, config),
    steps: steps.filter((s) => s.isActive).sort(byCreatedAt),
    history: timeline
      .map((entry) => ({
        ...entry,
        completion: entry.transaction.completionId ? completionById.get(entry.transaction.completionId) : undefined,
      }))
      .reverse(),
  };
}

export async function getSkillFormData(id: string): Promise<{ skill: Skill; milestone: Milestone | undefined; manual: number[] } | null> {
  const skill = await db.skills.get(id);
  if (!skill) return null;
  const [milestone, thresholds] = await Promise.all([
    db.milestones.where('skillId').equals(id).first(),
    db.levelThresholds.where('skillId').equals(id).sortBy('flaskNumber'),
  ]);
  return { skill, milestone, manual: thresholds.map((t) => t.requiredPoints) };
}
