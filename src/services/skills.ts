import { db } from '../data/db';
import { localDate, nowIso } from '../lib/dates';
import { canCompleteSkill, reconcileMilestone } from '../domain/milestone';
import { computeProgress, totalPoints, type CapacityConfig, type Progress } from '../domain/progression';
import type { Milestone, Skill, StepCompletion, StepDefinition } from '../domain/types';

export class ValidationError extends Error {}

const MAX_NAME_LENGTH = 100;

function requireName(value: string, what: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError(`Укажите ${what}`);
  if (name.length > MAX_NAME_LENGTH) throw new ValidationError(`Слишком длинное значение: ${what}`);
  return name;
}

function requireInt(value: number, min: number, what: string): number {
  if (!Number.isInteger(value) || value < min) throw new ValidationError(`${what}: целое число не меньше ${min}`);
  return value;
}

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

const progressTables = [db.skills, db.milestones, db.levelThresholds, db.transactions];

async function loadCapacityConfig(skill: Skill): Promise<CapacityConfig> {
  const thresholds = await db.levelThresholds.where('skillId').equals(skill.id).sortBy('flaskNumber');
  return { base: skill.capacityBase, increment: skill.capacityIncrement, manual: thresholds.map((t) => t.requiredPoints) };
}

async function loadProgress(skill: Skill): Promise<Progress> {
  const [config, transactions] = await Promise.all([
    loadCapacityConfig(skill),
    db.transactions.where('skillId').equals(skill.id).toArray(),
  ]);
  return computeProgress(totalPoints(transactions.map((t) => t.delta)), config);
}

/** Must run inside a transaction covering `progressTables`. */
async function syncMilestone(skill: Skill, now: string): Promise<Progress> {
  const progress = await loadProgress(skill);
  const milestone = await db.milestones.where('skillId').equals(skill.id).first();
  const patch = milestone && reconcileMilestone(milestone, skill, progress, now);
  if (milestone && patch) await db.milestones.update(milestone.id, patch);
  return progress;
}

async function replaceThresholds(skillId: string, capacities: number[]): Promise<void> {
  await db.levelThresholds.where('skillId').equals(skillId).delete();
  await db.levelThresholds.bulkAdd(
    capacities.map((requiredPoints, i) => ({ skillId, flaskNumber: i + 1, requiredPoints })),
  );
}

async function requireSkill(id: string): Promise<Skill> {
  const skill = await db.skills.get(id);
  if (!skill) throw new ValidationError('Навык не найден');
  return skill;
}

export async function createSkill(raw: SkillInput): Promise<string> {
  const input = validateSkillInput(raw);
  const now = nowIso();
  const skill: Skill = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    status: 'ACTIVE',
    startLabel: input.startLabel,
    targetLabel: input.targetLabel,
    capacityBase: input.capacityBase,
    capacityIncrement: input.capacityIncrement,
    completedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const milestone: Milestone = {
    id: crypto.randomUUID(),
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
  return skill.id;
}

export async function updateSkill(id: string, raw: SkillInput): Promise<void> {
  const input = validateSkillInput(raw);
  const now = nowIso();
  await db.transaction('rw', progressTables, async () => {
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
    await syncMilestone({ ...skill, ...patch }, now);
  });
}

/** Permanently deletes the skill with its whole history (FR-SK-006, FR-SK-007). */
export async function deleteSkill(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.skills, db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions],
    async () => {
      await Promise.all([
        db.milestones.where('skillId').equals(id).delete(),
        db.levelThresholds.where('skillId').equals(id).delete(),
        db.steps.where('skillId').equals(id).delete(),
        db.completions.where('skillId').equals(id).delete(),
        db.transactions.where('skillId').equals(id).delete(),
      ]);
      await db.skills.delete(id);
    },
  );
}

export interface StepInput {
  skillId: string;
  name: string;
  points: number;
}

export async function createStep(raw: StepInput): Promise<string> {
  const name = requireName(raw.name, 'название действия');
  const points = requireInt(raw.points, 1, 'Количество баллов');
  const now = nowIso();
  return db.transaction('rw', [db.skills, db.steps], async () => {
    const skill = await requireSkill(raw.skillId);
    if (skill.status !== 'ACTIVE') throw new ValidationError('Действия можно добавлять только к активному навыку');
    const step: StepDefinition = {
      id: crypto.randomUUID(),
      skillId: skill.id,
      name,
      type: 'BOOLEAN',
      points,
      schedule: { kind: 'MANUAL' },
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.steps.add(step);
    return step.id;
  });
}

export interface CompletionResult {
  completionId: string;
  pointsAwarded: number;
  before: Progress;
  after: Progress;
  milestoneReached: boolean;
}

/**
 * Records a manual completion of a step (FR-ST-010, FR-TD-004): a completion with a snapshot
 * of the step plus exactly one points transaction, written atomically (FR-CP-007).
 */
export async function completeStep(stepId: string, date: string = localDate()): Promise<CompletionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('Некорректная дата');
  const now = nowIso();
  return db.transaction('rw', [...progressTables, db.steps, db.completions], async () => {
    const step = await db.steps.get(stepId);
    if (!step || !step.isActive) throw new ValidationError('Действие не найдено');
    const skill = await requireSkill(step.skillId);
    if (skill.status !== 'ACTIVE') throw new ValidationError('Навык не активен');

    const before = await loadProgress(skill);
    const completion: StepCompletion = {
      id: crypto.randomUUID(),
      skillId: skill.id,
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      pointsSnapshot: step.points,
      durationMinutes: null,
      pointsAwarded: step.points,
      date,
      source: 'MANUAL',
      status: 'ACTIVE',
      note: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.completions.add(completion);
    await db.transactions.add({
      id: crypto.randomUUID(),
      skillId: skill.id,
      completionId: completion.id,
      delta: completion.pointsAwarded,
      reason: 'COMPLETION',
      createdAt: now,
    });
    const after = await syncMilestone(skill, now);
    const milestone = await db.milestones.where('skillId').equals(skill.id).first();
    return {
      completionId: completion.id,
      pointsAwarded: completion.pointsAwarded,
      before,
      after,
      milestoneReached: milestone != null && milestone.reachedAt === now,
    };
  });
}

/** "Продолжить": keep the skill active and keep leveling after the milestone (FR-MS-005). */
export async function continueAfterMilestone(skillId: string): Promise<void> {
  await db.transaction('rw', [db.milestones], async () => {
    const milestone = await db.milestones.where('skillId').equals(skillId).first();
    if (!milestone?.reachedAt) throw new ValidationError('Веха ещё не достигнута');
    await db.milestones.update(milestone.id, { decision: 'CONTINUE', updatedAt: nowIso() });
  });
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
}
