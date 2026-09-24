// Internals shared by the mutation services (skills, steps, completions): validation helpers,
// the table set of a journal write, progress replay and the milestone cache sync.

import { db } from '../data/db';
import { milestoneReachedAt } from '../domain/events';
import { reconcileMilestone } from '../domain/milestone';
import { buildTimeline, compareJournalOrder, computeProgress, type CapacityConfig, type Progress } from '../domain/progression';
import type { Milestone, Skill } from '../domain/types';

export class ValidationError extends Error {}

/**
 * A second completion of the same step and date within SAME_TAP_MS: a double submit. The step
 * row stays busy for that window and swallows this error without a toast, so the undo toast of
 * the completion that did land is never replaced.
 */
export class DoubleSubmitError extends ValidationError {}

/** A second completion of the same step and date within this window is a double submit. */
export const SAME_TAP_MS = 1500;

const MAX_NAME_LENGTH = 100;

export function requireName(value: string, what: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError(`Укажите ${what}`);
  if (name.length > MAX_NAME_LENGTH) throw new ValidationError(`Слишком длинное значение: ${what}`);
  return name;
}

export function requireInt(value: number, min: number, what: string): number {
  if (!Number.isInteger(value) || value < min) throw new ValidationError(`${what}: целое число не меньше ${min}`);
  return value;
}

// Computed on demand: `db` is a live binding that tests swap per test.
/** Every table a mutation may touch, including the achievement sync (services/achievements.ts). */
export const journalTables = () => [
  db.skills,
  db.milestones,
  db.levelThresholds,
  db.steps,
  db.completions,
  db.transactions,
  db.settings,
  db.achievementUnlocks,
];

export async function requireSkill(id: string): Promise<Skill> {
  const skill = await db.skills.get(id);
  if (!skill) throw new ValidationError('Навык не найден');
  return skill;
}

/** One message for every write refused on a skill that is not ACTIVE. */
export const NOT_ACTIVE_MESSAGE = 'Навык не активен';

/**
 * Steps and progress change only on an active skill: a completed one is read-only (decision
 * 14.9), an archived one waits for «Продолжить с этого места» (section 6).
 */
export function requireActiveSkill(skill: Skill): void {
  if (skill.status !== 'ACTIVE') throw new ValidationError(NOT_ACTIVE_MESSAGE);
}

export async function loadCapacityConfig(skill: Skill): Promise<CapacityConfig> {
  const thresholds = await db.levelThresholds.where('skillId').equals(skill.id).sortBy('flaskNumber');
  return { base: skill.capacityBase, increment: skill.capacityIncrement, manual: thresholds.map((t) => t.requiredPoints) };
}

export async function loadTimeline(skill: Skill) {
  const [config, transactions] = await Promise.all([
    loadCapacityConfig(skill),
    db.transactions.where('skillId').equals(skill.id).toArray(),
  ]);
  const timeline = buildTimeline(transactions.sort(compareJournalOrder), config);
  return { timeline, progress: timeline.at(-1)?.after ?? computeProgress(0, config) };
}

export interface MilestoneSync {
  progress: Progress;
  milestone: Milestone | undefined;
  /** The milestone became reached by this mutation. */
  reachedNow: boolean;
  /** The milestone stopped being reached by this mutation. */
  lostNow: boolean;
}

/**
 * Recomputes progress from the journal and brings the milestone cache in line with it.
 * The reach date is derived from the journal (FR-MS-007), so editing the target later keeps
 * the historical date. Must run inside a transaction covering the skills, milestones, thresholds and transactions.
 */
export async function syncMilestone(skill: Skill, now: string): Promise<MilestoneSync> {
  const { timeline, progress } = await loadTimeline(skill);
  const stored = await db.milestones.where('skillId').equals(skill.id).first();
  if (!stored) return { progress, milestone: undefined, reachedNow: false, lostNow: false };
  const derived = milestoneReachedAt(timeline, stored.targetFlaskNumber);
  const patch = reconcileMilestone(stored, skill, progress, derived, now);
  if (!patch) return { progress, milestone: stored, reachedNow: false, lostNow: false };
  await db.milestones.update(stored.id, patch);
  const milestone = { ...stored, ...patch };
  return {
    progress,
    milestone,
    reachedNow: stored.reachedAt === null && milestone.reachedAt !== null,
    lostNow: stored.reachedAt !== null && milestone.reachedAt === null,
  };
}
