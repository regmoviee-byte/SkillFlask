import { db } from '../data/db';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/dates';
import { canCompleteSkill } from '../domain/milestone';
import type { Milestone, Skill } from '../domain/types';
import { afterWrite } from './afterWrite';
import { progressTables, requireActiveSkill, requireInt, requireName, requireSkill, syncMilestone, ValidationError } from './core';

// Skill lifecycle. Steps live in ./steps.ts and the journal in ./completions.ts; both are
// re-exported here so existing importers keep one entry point.
export { ValidationError } from './core';
export { createStep, getStep, setStepActive, updateStep, type StepInput, type StepPatch } from './steps';
export { archiveSkill, restartSkill, restoreSkill } from './lifecycle';
export {
  cancelCompletion,
  completeStep,
  correctDuration,
  getCompletion,
  restoreCompletion,
  setCompletionNote,
  type CompleteStepOptions,
  type CompletionResult,
  type MutationResult,
} from './completions';

export interface SkillInput {
  name: string;
  description: string;
  startLabel: string;
  targetLabel: string;
  milestoneName: string;
  milestoneTarget: number;
  capacityBase: number;
  capacityIncrement: number;
  /** Optional manual capacities of flasks 1..n; the formula continues after them. */
  manualCapacities: number[];
}

function validateSkillInput(input: SkillInput): SkillInput {
  return {
    name: requireName(input.name, 'название навыка'),
    description: input.description.trim(),
    startLabel: input.startLabel.trim(),
    targetLabel: input.targetLabel.trim(),
    milestoneName: requireName(input.milestoneName, 'название вехи'),
    milestoneTarget: requireInt(input.milestoneTarget, 1, 'Количество колб до вехи'),
    capacityBase: requireInt(input.capacityBase, 1, 'Ёмкость первой колбы'),
    capacityIncrement: requireInt(input.capacityIncrement, 0, 'Прирост ёмкости'),
    manualCapacities: input.manualCapacities.map((c) => requireInt(c, 1, 'Ёмкость колбы')),
  };
}

async function replaceThresholds(skillId: string, capacities: number[]): Promise<void> {
  await db.levelThresholds.where('skillId').equals(skillId).delete();
  await db.levelThresholds.bulkAdd(
    capacities.map((requiredPoints, i) => ({ skillId, flaskNumber: i + 1, requiredPoints })),
  );
}

export async function createSkill(raw: SkillInput): Promise<string> {
  const input = validateSkillInput(raw);
  const now = nowIso();
  const skill: Skill = {
    id: newId(),
    name: input.name,
    description: input.description,
    status: 'ACTIVE',
    startLabel: input.startLabel,
    targetLabel: input.targetLabel,
    capacityBase: input.capacityBase,
    capacityIncrement: input.capacityIncrement,
    completedAt: null,
    archivedAt: null,
    originSkillId: null,
    createdAt: now,
    updatedAt: now,
  };
  const milestone: Milestone = {
    id: newId(),
    skillId: skill.id,
    name: input.milestoneName,
    targetFlaskNumber: input.milestoneTarget,
    reachedAt: null,
    decision: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', [db.skills, db.milestones, db.levelThresholds], async () => {
    await db.skills.add(skill);
    await db.milestones.add(milestone);
    await replaceThresholds(skill.id, input.manualCapacities);
  });
  await afterWrite();
  return skill.id;
}

export async function updateSkill(id: string, raw: SkillInput): Promise<void> {
  const input = validateSkillInput(raw);
  const now = nowIso();
  await db.transaction('rw', progressTables(), async () => {
    const skill = await requireSkill(id);
    if (skill.status === 'COMPLETED') throw new ValidationError('Завершённый навык доступен только для чтения');
    const patch = {
      name: input.name,
      description: input.description,
      startLabel: input.startLabel,
      targetLabel: input.targetLabel,
      capacityBase: input.capacityBase,
      capacityIncrement: input.capacityIncrement,
      updatedAt: now,
    };
    await db.skills.update(id, patch);
    await replaceThresholds(id, input.manualCapacities);
    const milestone = await db.milestones.where('skillId').equals(id).first();
    if (milestone) {
      await db.milestones.update(milestone.id, {
        name: input.milestoneName,
        targetFlaskNumber: input.milestoneTarget,
        updatedAt: now,
      });
    }
    // A changed target or capacity re-interprets the journal; the reach date follows it.
    await syncMilestone({ ...skill, ...patch }, now);
  });
  await afterWrite();
}

/**
 * Permanently deletes the skill with its whole history (FR-SK-006, FR-SK-007). A copy made by
 * «Начать заново» is a skill of its own and stays; its `originSkillId` simply points nowhere.
 */
export async function deleteSkill(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.skills, db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions, db.achievementUnlocks],
    async () => {
      await Promise.all([
        db.milestones.where('skillId').equals(id).delete(),
        db.levelThresholds.where('skillId').equals(id).delete(),
        db.steps.where('skillId').equals(id).delete(),
        db.completions.where('skillId').equals(id).delete(),
        db.transactions.where('skillId').equals(id).delete(),
        // An unlock keeps what was shown but forgets the skill: a dangling skillId would make
        // every later backup fail its reference check on import.
        db.achievementUnlocks.filter((u) => u.skillId === id).modify({ skillId: null }),
      ]);
      await db.skills.delete(id);
    },
  );
  await afterWrite();
}

/** "Продолжить": keep the skill active and keep leveling after the milestone (FR-MS-005). */
export async function continueAfterMilestone(skillId: string): Promise<void> {
  await db.transaction('rw', [db.skills, db.milestones], async () => {
    requireActiveSkill(await requireSkill(skillId));
    const milestone = await db.milestones.where('skillId').equals(skillId).first();
    if (!milestone?.reachedAt) throw new ValidationError('Веха ещё не достигнута');
    await db.milestones.update(milestone.id, { decision: 'CONTINUE', updatedAt: nowIso() });
  });
  await afterWrite();
}

/** "Завершить навык": explicit user action once the milestone is reached (section 6). */
export async function completeSkill(skillId: string): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', [db.skills, db.milestones], async () => {
    const skill = await requireSkill(skillId);
    const milestone = await db.milestones.where('skillId').equals(skillId).first();
    if (!canCompleteSkill(skill, milestone)) throw new ValidationError('Навык можно завершить только после достижения вехи');
    await db.skills.update(skillId, { status: 'COMPLETED', completedAt: now, updatedAt: now });
  });
  await afterWrite();
}
