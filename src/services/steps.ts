// Step definitions (section 5, FR-ST-*). A step's completions carry a snapshot of it, so
// renaming or re-pricing a step only affects future completions (FR-ST-007), and a step is
// never deleted while it has history: it is hidden instead (FR-ST-008, FR-ST-009).

import { db } from '../data/db';
import { newId } from '../lib/ids';
import { localDate, nowIso } from '../lib/dates';
import type { StepDefinition } from '../domain/types';
import { afterWrite } from './afterWrite';
import { requireActiveSkill, requireInt, requireName, requireSkill, ValidationError } from './core';

export interface StepInput {
  skillId: string;
  name: string;
  points: number;
}

export interface StepPatch {
  name: string;
  points: number;
}

function validate(raw: StepPatch): StepPatch {
  return {
    name: requireName(raw.name, 'название действия'),
    points: requireInt(raw.points, 1, 'Очки за выполнение'),
  };
}

async function requireStep(id: string): Promise<StepDefinition> {
  const step = await db.steps.get(id);
  if (!step) throw new ValidationError('Действие не найдено');
  return step;
}

export async function createStep(raw: StepInput): Promise<string> {
  const { name, points } = validate(raw);
  const now = nowIso();
  const id = await db.transaction('rw', [db.skills, db.steps], async () => {
    const skill = await requireSkill(raw.skillId);
    if (skill.status !== 'ACTIVE') throw new ValidationError('Действия можно добавлять только к активному навыку');
    const step: StepDefinition = {
      id: newId(),
      skillId: skill.id,
      name,
      type: 'BOOLEAN',
      points,
      pointsPerMinute: null,
      defaultMinutes: null,
      schedule: { kind: 'MANUAL' },
      scheduleFrom: localDate(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.steps.add(step);
    return step.id;
  });
  await afterWrite();
  return id;
}

/**
 * Renames or re-prices a step. Only the definition changes: past completions keep their
 * snapshot and the journal is untouched (FR-ST-007, FR-XP-008).
 */
export async function updateStep(id: string, raw: StepPatch): Promise<void> {
  const { name, points } = validate(raw);
  const now = nowIso();
  await db.transaction('rw', [db.skills, db.steps], async () => {
    const step = await requireStep(id);
    requireActiveSkill(await requireSkill(step.skillId));
    await db.steps.update(id, { name, points, updatedAt: now });
  });
  await afterWrite();
}

/** Hides a step from the lists («Убрать из списка») or brings it back; history stays intact. */
export async function setStepActive(id: string, isActive: boolean): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', [db.skills, db.steps], async () => {
    const step = await requireStep(id);
    requireActiveSkill(await requireSkill(step.skillId));
    if (step.isActive === isActive) return;
    await db.steps.update(id, { isActive, updatedAt: now });
  });
  await afterWrite();
}

export async function getStep(id: string): Promise<StepDefinition | null> {
  return (await db.steps.get(id)) ?? null;
}
