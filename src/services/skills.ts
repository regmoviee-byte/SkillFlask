import { db } from '../data/db';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/dates';
import { DEFAULT_PROGRESS_THEME, isProgressTheme, isSkillColor, type ProgressThemeKey, type SkillColor } from '../domain/appearance';
import { canCompleteSkill } from '../domain/milestone';
import type { Milestone, Skill } from '../domain/types';
import { publishEarned } from './achievements';
import { afterWrite, syncInTransaction } from './afterWrite';
import { journalTables, requireActiveSkill, requireInt, requireName, requireSkill, syncMilestone, ValidationError } from './core';

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
  /** The progress theme; the flask for a new skill, unchanged on an update when omitted. */
  theme?: ProgressThemeKey;
  /** The skill colour, null «Как в теме»; null for a new skill, unchanged on an update when omitted. */
  color?: SkillColor | null;
}

export interface SkillAppearance {
  theme: ProgressThemeKey;
  color: SkillColor | null;
}

function validateAppearance<T extends Partial<SkillAppearance>>(input: T): T {
  if (input.theme !== undefined && !isProgressTheme(input.theme)) throw new ValidationError('Неизвестный образ прогресса');
  if (input.color !== undefined && input.color !== null && !isSkillColor(input.color)) throw new ValidationError('Неизвестный цвет');
  return input;
}

function validateSkillInput(input: SkillInput): SkillInput {
  return {
    name: requireName(input.name, 'название навыка'),
    description: input.description.trim(),
    startLabel: input.startLabel.trim(),
    targetLabel: input.targetLabel.trim(),
    milestoneName: requireName(input.milestoneName, 'название вехи'),
    milestoneTarget: requireInt(input.milestoneTarget, 1, 'Количество уровней до вехи'),
    capacityBase: requireInt(input.capacityBase, 1, 'Ёмкость первого уровня'),
    capacityIncrement: requireInt(input.capacityIncrement, 0, 'Прирост ёмкости'),
    manualCapacities: input.manualCapacities.map((c) => requireInt(c, 1, 'Ёмкость уровня')),
    ...validateAppearance({ theme: input.theme, color: input.color }),
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
    theme: input.theme ?? DEFAULT_PROGRESS_THEME,
    color: input.color ?? null,
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
  const earned = await db.transaction('rw', journalTables(), async () => {
    await db.skills.add(skill);
    await db.milestones.add(milestone);
    await replaceThresholds(skill.id, input.manualCapacities);
    return syncInTransaction({ skillId: skill.id, now });
  });
  await afterWrite();
  publishEarned(earned);
  return skill.id;
}

export async function updateSkill(id: string, raw: SkillInput): Promise<void> {
  const input = validateSkillInput(raw);
  const now = nowIso();
  const earned = await db.transaction('rw', journalTables(), async () => {
    const skill = await requireSkill(id);
    if (skill.status === 'COMPLETED') throw new ValidationError('Завершённый навык доступен только для чтения');
    // An archived skill is read-only too: its capacities would re-interpret history unseen.
    requireActiveSkill(skill);
    const patch = {
      name: input.name,
      description: input.description,
      startLabel: input.startLabel,
      targetLabel: input.targetLabel,
      capacityBase: input.capacityBase,
      capacityIncrement: input.capacityIncrement,
      ...(input.theme !== undefined && { theme: input.theme }),
      ...(input.color !== undefined && { color: input.color }),
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
    // A changed target or capacity re-interprets the journal; the reach date follows it, and
    // so do the achievements (unlocks re-dated or locked again, new ones filed quietly).
    await syncMilestone({ ...skill, ...patch }, now);
    return syncInTransaction({ skillId: id, now });
  });
  await afterWrite();
  publishEarned(earned);
}

/**
 * «Оформление» from the skill's ⋯ menu: the theme and the colour, saved at once. Presentation
 * only — no journal row, nothing to re-evaluate; the backup picks the change up (afterWrite).
 * Like every setting of the skill, only while it is active (an archived or completed skill is
 * read-only, decision 14.9).
 */
export async function setSkillAppearance(id: string, appearance: Partial<SkillAppearance>): Promise<void> {
  // An omitted field stays as stored (a theme key of a newer release survives a colour change).
  const { theme, color } = validateAppearance(appearance);
  await db.transaction('rw', db.skills, async () => {
    requireActiveSkill(await requireSkill(id));
    await db.skills.update(id, { ...(theme !== undefined && { theme }), ...(color !== undefined && { color }), updatedAt: nowIso() });
  });
  await afterWrite();
}

/**
 * Permanently deletes the skill with its whole history and its marks (FR-SK-006, FR-SK-007,
 * FR-HS-006). A copy made by «Начать заново» is a skill of its own and stays; its
 * `originSkillId` simply points nowhere.
 */
export async function deleteSkill(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [...journalTables(), db.marks],
    async () => {
      await Promise.all([
        db.marks.where('skillId').equals(id).delete(),
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
      // Its history is gone, and so are the achievements only it held (silently).
      await syncInTransaction({ skillId: null, now: nowIso() });
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
  const earned = await db.transaction('rw', journalTables(), async () => {
    const skill = await requireSkill(skillId);
    const milestone = await db.milestones.where('skillId').equals(skillId).first();
    if (!canCompleteSkill(skill, milestone)) throw new ValidationError('Навык можно завершить только после достижения вехи');
    await db.skills.update(skillId, { status: 'COMPLETED', completedAt: now, updatedAt: now });
    return syncInTransaction({ skillId, now });
  });
  await afterWrite();
  publishEarned(earned);
}
