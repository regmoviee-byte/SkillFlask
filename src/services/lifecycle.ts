// Skill lifecycle transitions of section 6: archive, «Продолжить с этого места» and «Начать
// заново». Archiving hides a skill from active work and keeps every row of its history
// (principle 3.6); restoring brings the same skill back with the progress its journal gives.
// Restarting never touches the original: it copies the settings into a new skill whose
// journal starts empty. Completing a skill lives next to the milestone in ./skills.ts.

import { db } from '../data/db';
import { newId } from '../lib/ids';
import { localDate, nowIso } from '../lib/dates';
import type { LevelThreshold, Milestone, Skill, StepDefinition } from '../domain/types';
import { afterWrite } from './afterWrite';
import { progressTables, requireSkill, syncMilestone, ValidationError } from './core';

/** ACTIVE → ARCHIVED: the skill leaves «Сегодня» and the active list, its history stays. */
export async function archiveSkill(id: string): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', [db.skills], async () => {
    const skill = await requireSkill(id);
    if (skill.status !== 'ACTIVE') throw new ValidationError('В архив можно убрать только активный навык');
    await db.skills.update(id, { status: 'ARCHIVED', archivedAt: now, updatedAt: now });
  });
  await afterWrite();
}

/**
 * ARCHIVED → ACTIVE, the same skill with the progress its journal gives. A milestone reached
 * before archiving is still reached, so «Завершить / Продолжить» come back with it.
 */
export async function restoreSkill(id: string): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', progressTables(), async () => {
    const skill = await requireSkill(id);
    if (skill.status !== 'ARCHIVED') throw new ValidationError('Навык не в архиве');
    const patch = { status: 'ACTIVE' as const, archivedAt: null, updatedAt: now };
    await db.skills.update(id, patch);
    // Progress is untouched; the milestone cache is only brought in line with the journal.
    await syncMilestone({ ...skill, ...patch }, now);
  });
  await afterWrite();
}

/**
 * «Начать заново» for an archived or completed skill: a new ACTIVE skill with the same name,
 * labels, capacities, milestone and active steps, and an empty journal. Steps start their
 * schedule today. The original skill and its history are left exactly as they are; the copy
 * remembers it in `originSkillId`. Returns the new skill's id.
 */
export async function restartSkill(id: string): Promise<string> {
  const now = nowIso();
  const today = localDate();
  const newSkillId = newId();
  await db.transaction('rw', [db.skills, db.milestones, db.levelThresholds, db.steps], async () => {
    const skill = await requireSkill(id);
    if (skill.status === 'ACTIVE') throw new ValidationError('Начать заново можно только архивный или достигнутый навык');
    const [milestone, thresholds, steps] = await Promise.all([
      db.milestones.where('skillId').equals(id).first(),
      db.levelThresholds.where('skillId').equals(id).toArray(),
      db.steps.where('skillId').equals(id).toArray(),
    ]);

    const copy: Skill = {
      ...skill,
      id: newSkillId,
      status: 'ACTIVE',
      completedAt: null,
      archivedAt: null,
      originSkillId: skill.id,
      createdAt: now,
      updatedAt: now,
    };
    await db.skills.add(copy);
    if (milestone) {
      const next: Milestone = { ...milestone, id: newId(), skillId: newSkillId, reachedAt: null, decision: null, createdAt: now, updatedAt: now };
      await db.milestones.add(next);
    }
    await db.levelThresholds.bulkAdd(thresholds.map((t): LevelThreshold => ({ ...t, skillId: newSkillId })));
    // Hidden steps stay with the original: the copy starts from what was on the list.
    const active = steps.filter((s) => s.isActive).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    await db.steps.bulkAdd(
      active.map((step, i): StepDefinition => {
        // nowIso() is strictly increasing, so the copies keep the original order by createdAt.
        const createdAt = i === 0 ? now : nowIso();
        return { ...step, id: newId(), skillId: newSkillId, scheduleFrom: today, createdAt, updatedAt: createdAt };
      }),
    );
  });
  await afterWrite();
  return newSkillId;
}
