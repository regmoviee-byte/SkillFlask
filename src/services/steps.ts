// Step definitions (section 5, FR-ST-*). A step's completions carry a snapshot of it, so
// renaming, re-pricing or re-scheduling a step only affects future completions (FR-ST-007),
// and a step is never deleted while it has history: it is hidden instead (FR-ST-008, FR-ST-009).
//
// Two types (FR-ST-001…003): BOOLEAN earns fixed whole points; TIMED earns minutes × rate,
// rounded half-up to tenths (domain/points.ts timedPoints). The type is fixed at creation:
// changing it would make the step's history mean something else.

import { db } from '../data/db';
import { newId } from '../lib/ids';
import { localDate, nowIso } from '../lib/dates';
import { isRate, MAX_MINUTES } from '../domain/points';
import { ScheduleError, validateSchedule } from '../domain/schedule';
import type { StepDefinition, StepSchedule, StepType } from '../domain/types';
import { publishEarned } from './achievements';
import { afterWrite, syncInTransaction } from './afterWrite';
import { journalTables, requireActiveSkill, requireInt, requireName, requireSkill, ValidationError } from './core';

export interface StepInput {
  skillId: string;
  name: string;
  /** BOOLEAN when omitted. */
  type?: StepType;
  /** BOOLEAN: whole points ≥ 1. Ignored for TIMED. */
  points?: number;
  /** TIMED: points per minute in (0, 1000] with at most two decimals. Ignored for BOOLEAN. */
  pointsPerMinute?: number | null;
  /** TIMED: the usual duration offered first, 1..1440 minutes, or null. Ignored for BOOLEAN. */
  defaultMinutes?: number | null;
  /** MANUAL when omitted. */
  schedule?: StepSchedule;
}

/** Fields to change; omitted ones keep their value. `type` may only repeat the current type. */
export type StepPatch = Partial<Omit<StepInput, 'skillId'>>;

export const TYPE_IMMUTABLE_MESSAGE = 'Тип действия нельзя изменить; создайте новое действие';
const RATE_MESSAGE = 'Очков за минуту: число с не более чем двумя знаками после запятой, например 0,25';

type Definition = Pick<StepDefinition, 'type' | 'points' | 'pointsPerMinute' | 'defaultMinutes'>;

/** The type-specific fields, normalised: a TIMED step stores 0 fixed points, a BOOLEAN one no rate. */
function validateDefinition(type: StepType, raw: StepPatch): Definition {
  if (type === 'BOOLEAN') {
    return { type, points: requireInt(raw.points ?? NaN, 1, 'Очки за выполнение'), pointsPerMinute: null, defaultMinutes: null };
  }
  if (type !== 'TIMED') throw new ValidationError('Некорректный тип действия');
  const rate = raw.pointsPerMinute;
  if (!isRate(rate)) throw new ValidationError(RATE_MESSAGE);
  const minutes = raw.defaultMinutes ?? null;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES)) {
    throw new ValidationError(`Обычно минут: целое число от 1 до ${MAX_MINUTES}`);
  }
  return { type, points: 0, pointsPerMinute: Math.round(rate * 100) / 100, defaultMinutes: minutes };
}

function checkedSchedule(schedule: StepSchedule): StepSchedule {
  try {
    return validateSchedule(schedule);
  } catch (error) {
    if (error instanceof ScheduleError) throw new ValidationError(error.message);
    throw error;
  }
}

async function requireStep(id: string): Promise<StepDefinition> {
  const step = await db.steps.get(id);
  if (!step) throw new ValidationError('Действие не найдено');
  return step;
}

export async function createStep(raw: StepInput): Promise<string> {
  const name = requireName(raw.name, 'название действия');
  const definition = validateDefinition(raw.type ?? 'BOOLEAN', raw);
  const schedule = checkedSchedule(raw.schedule ?? { kind: 'MANUAL' });
  const now = nowIso();
  const { id, earned } = await db.transaction('rw', journalTables(), async () => {
    const skill = await requireSkill(raw.skillId);
    requireActiveSkill(skill);
    const step: StepDefinition = {
      id: newId(),
      skillId: skill.id,
      name,
      ...definition,
      schedule,
      // The schedule plans from today on: a new step never shows up on past dates.
      scheduleFrom: localDate(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.steps.add(step);
    return { id: step.id, earned: await syncInTransaction({ skillId: skill.id, now }) };
  });
  await afterWrite();
  publishEarned(earned);
  return id;
}

/** Compared in canonical form: key or day order of a stored schedule (an old backup) is no change. */
function canonical(schedule: StepSchedule): string {
  try {
    return JSON.stringify(validateSchedule(schedule));
  } catch {
    return JSON.stringify(schedule);
  }
}

const sameSchedule = (a: StepSchedule, b: StepSchedule) => canonical(a) === canonical(b);

/**
 * Renames, re-prices or re-schedules a step. Only the definition changes: past completions
 * keep their snapshot and the journal is untouched (FR-ST-007, FR-XP-008). A new schedule
 * plans from today on (`scheduleFrom`): earlier days, this week's included, no longer plan
 * the step at all (it shows under «Ещё» there), and nothing is recomputed.
 */
export async function updateStep(id: string, raw: StepPatch): Promise<void> {
  // Validated before the transaction; an omitted name keeps the step's own.
  const newName = raw.name !== undefined ? requireName(raw.name, 'название действия') : null;
  const now = nowIso();
  await db.transaction('rw', journalTables(), async () => {
    const step = await requireStep(id);
    const name = newName ?? step.name;
    requireActiveSkill(await requireSkill(step.skillId));
    if (raw.type !== undefined && raw.type !== step.type) throw new ValidationError(TYPE_IMMUTABLE_MESSAGE);
    const definition = validateDefinition(step.type, {
      points: raw.points ?? step.points,
      pointsPerMinute: raw.pointsPerMinute !== undefined ? raw.pointsPerMinute : step.pointsPerMinute,
      defaultMinutes: raw.defaultMinutes !== undefined ? raw.defaultMinutes : step.defaultMinutes,
    });
    const schedule = raw.schedule ? checkedSchedule(raw.schedule) : step.schedule;
    const rescheduled = !sameSchedule(schedule, step.schedule);
    await db.steps.update(id, {
      name,
      ...definition,
      schedule,
      ...(rescheduled ? { scheduleFrom: localDate() } : {}),
      updatedAt: now,
    });
    // No rule reads a step's definition today; the sync keeps every write uniform.
    await syncInTransaction({ skillId: step.skillId, now });
  });
  await afterWrite();
}

/** Hides a step from the lists («Убрать из списка») or brings it back; history stays intact. */
export async function setStepActive(id: string, isActive: boolean): Promise<void> {
  const now = nowIso();
  const earned = await db.transaction('rw', journalTables(), async () => {
    const step = await requireStep(id);
    requireActiveSkill(await requireSkill(step.skillId));
    if (step.isActive === isActive) return [];
    await db.steps.update(id, { isActive, updatedAt: now });
    // «Набор инструментов» counts the steps on the list: hiding one may lock it again.
    return syncInTransaction({ skillId: step.skillId, now });
  });
  await afterWrite();
  publishEarned(earned);
}

export async function getStep(id: string): Promise<StepDefinition | null> {
  return (await db.steps.get(id)) ?? null;
}
