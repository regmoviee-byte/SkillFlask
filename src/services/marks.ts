// «Засечки»: memorable events on a skill's path (requirements, section 10). A mark is not
// progress and earns nothing (no journal row, no achievement); it records where the skill
// stood when it was written — the flask, the points inside it and the total, from the same
// journal fold as everything else — and keeps that position for good. Title, description and
// date can be edited and the mark deleted while the skill is ACTIVE; archiving and completing
// keep the marks (FR-HS-006), deleting the skill deletes them, «Начать заново» does not copy them.

import { db } from '../data/db';
import { newId } from '../lib/ids';
import { localDate, nowIso } from '../lib/dates';
import { MarkError, markPosition, validateMark, type MarkField, type MarkInput } from '../domain/marks';
import type { Mark } from '../domain/types';
import { afterWrite } from './afterWrite';
import { loadTimeline, requireActiveSkill, requireSkill, ValidationError } from './core';

/** A mark input the form should show under one of its fields. */
export class MarkValidationError extends ValidationError {
  constructor(
    message: string,
    readonly field: MarkField,
  ) {
    super(message);
  }
}

// Computed on demand: `db` is a live binding that tests swap per test.
const markTables = () => [db.skills, db.levelThresholds, db.transactions, db.marks];

function checked(input: MarkInput, today: string) {
  try {
    return validateMark(input, today);
  } catch (error) {
    if (error instanceof MarkError) throw new MarkValidationError(error.message, error.field);
    throw error;
  }
}

async function requireMark(id: string): Promise<Mark> {
  const mark = await db.marks.get(id);
  if (!mark) throw new ValidationError('Засечка не найдена');
  return mark;
}

/**
 * Pins a mark at the skill's current progress (the journal replayed in the write's own
 * transaction, so a completion in flight never lands half-counted). Returns the new id.
 */
export async function createMark(skillId: string, input: MarkInput): Promise<string> {
  const value = checked(input, localDate());
  const now = nowIso();
  const id = newId();
  await db.transaction('rw', markTables(), async () => {
    const skill = await requireSkill(skillId);
    requireActiveSkill(skill);
    const { progress } = await loadTimeline(skill);
    await db.marks.add({ id, skillId, ...value, ...markPosition(progress), createdAt: now, updatedAt: now });
  });
  await afterWrite();
  return id;
}

/** Title, description and date only: the position is a fact of the past and never moves. */
export async function updateMark(id: string, input: { title: string; description: string; date: string }): Promise<void> {
  const value = checked(input, localDate());
  await db.transaction('rw', markTables(), async () => {
    const mark = await requireMark(id);
    requireActiveSkill(await requireSkill(mark.skillId));
    await db.marks.update(id, { title: value.title, description: value.description, date: value.date, updatedAt: nowIso() });
  });
  await afterWrite();
}

/** Removes one mark of an ACTIVE skill (the UI asks first). */
export async function deleteMark(id: string): Promise<void> {
  await db.transaction('rw', markTables(), async () => {
    const mark = await requireMark(id);
    requireActiveSkill(await requireSkill(mark.skillId));
    await db.marks.delete(id);
  });
  await afterWrite();
}
