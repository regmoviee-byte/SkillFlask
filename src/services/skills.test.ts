import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { getSkillDetails, listSkillSummaries } from './queries';
import {
  completeSkill,
  completeStep,
  continueAfterMilestone,
  createSkill,
  createStep,
  deleteSkill,
  updateSkill,
  ValidationError,
  type SkillInput,
} from './skills';

const english: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Достичь C1',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 50,
  manualCapacities: [10, 20, 30],
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function details(id: string) {
  const d = await getSkillDetails(id);
  if (!d) throw new Error('skill not found');
  return d;
}

describe('E2E-001: full skill cycle', () => {
  it('goes from skill creation to a completed skill', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Разговорная практика', points: 5 });

    let d = await details(skillId);
    expect(d.skill.status).toBe('ACTIVE');
    expect(d.progress).toMatchObject({ currentFlask: 1, pointsInCurrentFlask: 0, currentCapacity: 10 });
    expect(d.milestone).toMatchObject({ name: 'Достичь C1', targetFlaskNumber: 3, reachedAt: null });

    // Flask 1 (10 points) fills after two completions, the level goes up.
    await completeStep(stepId);
    const second = await completeStep(stepId);
    expect(second.before.completedFlasks).toBe(0);
    expect(second.after).toMatchObject({ completedFlasks: 1, currentFlask: 2, pointsInCurrentFlask: 0, currentCapacity: 20 });

    // 10 + 20 + 30 = 60 points reach the milestone of three flasks.
    let result = second;
    for (let i = 0; i < 10; i++) result = await completeStep(stepId);
    expect(result.after.completedFlasks).toBe(3);
    expect(result.milestoneReached).toBe(true);

    d = await details(skillId);
    expect(d.milestone?.reachedAt).not.toBeNull();
    expect(d.skill.status).toBe('ACTIVE'); // not completed automatically (FR-MS-005)
    expect(d.history).toHaveLength(12);
    expect(d.history[0].completion?.stepName).toBe('Разговорная практика');

    await completeSkill(skillId);
    d = await details(skillId);
    expect(d.skill.status).toBe('COMPLETED');
    expect(d.skill.completedAt).not.toBeNull();

    // A completed skill is read-only.
    await expect(completeStep(stepId)).rejects.toThrow(ValidationError);
    await expect(createStep({ skillId, name: 'Ещё', points: 1 })).rejects.toThrow(ValidationError);
    await expect(updateSkill(skillId, english)).rejects.toThrow(ValidationError);
  });
});

describe('completeStep', () => {
  it('can fill several flasks with one completion and carries the overflow', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Интенсив', points: 35 });
    const result = await completeStep(stepId);
    expect(result.after).toMatchObject({ completedFlasks: 2, currentFlask: 3, pointsInCurrentFlask: 5 });
  });

  it('writes one completion with a snapshot and one transaction', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
    const { completionId } = await completeStep(stepId, '2026-09-20');

    const completion = await db.completions.get(completionId);
    expect(completion).toMatchObject({
      stepName: 'Чтение',
      stepType: 'BOOLEAN',
      pointsSnapshot: 7,
      pointsAwarded: 7,
      date: '2026-09-20',
      source: 'MANUAL',
      status: 'ACTIVE',
    });
    const transactions = await db.transactions.where('completionId').equals(completionId).toArray();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ delta: 7, reason: 'COMPLETION' });
  });

  it('does not change past completions when the step changes later', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
    const { completionId } = await completeStep(stepId);
    await db.steps.update(stepId, { name: 'Чтение книг', points: 100 });
    const d = await details(skillId);
    expect(d.progress.totalPoints).toBe(7);
    expect((await db.completions.get(completionId))?.stepName).toBe('Чтение');
  });
});

describe('milestone', () => {
  it('"Продолжить" keeps the skill active and leveling', async () => {
    const skillId = await createSkill({ ...english, milestoneTarget: 1 });
    const stepId = await createStep({ skillId, name: 'Шаг', points: 10 });
    await completeStep(stepId);
    await continueAfterMilestone(skillId);
    await completeStep(stepId);
    const d = await details(skillId);
    expect(d.skill.status).toBe('ACTIVE');
    expect(d.milestone?.decision).toBe('CONTINUE');
    expect(d.progress.totalPoints).toBe(20);
  });

  it('cannot complete a skill before the milestone', async () => {
    const skillId = await createSkill(english);
    await expect(completeSkill(skillId)).rejects.toThrow(ValidationError);
  });

  it('is re-evaluated when the target changes', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 10 });
    await completeStep(stepId);
    expect((await details(skillId)).milestone?.reachedAt).toBeNull();

    await updateSkill(skillId, { ...english, milestoneTarget: 1 });
    expect((await details(skillId)).milestone?.reachedAt).not.toBeNull();

    await updateSkill(skillId, { ...english, milestoneTarget: 2 });
    expect((await details(skillId)).milestone?.reachedAt).toBeNull();
  });
});

describe('skills', () => {
  it('validates input', async () => {
    await expect(createSkill({ ...english, name: '  ' })).rejects.toThrow(ValidationError);
    await expect(createSkill({ ...english, milestoneTarget: 0 })).rejects.toThrow(ValidationError);
    await expect(createSkill({ ...english, capacityBase: 0 })).rejects.toThrow(ValidationError);
    await expect(createSkill({ ...english, manualCapacities: [10, -1] })).rejects.toThrow(ValidationError);
    const skillId = await createSkill(english);
    await expect(createStep({ skillId, name: 'Шаг', points: 0 })).rejects.toThrow(ValidationError);
  });

  it('lists skills with their progress', async () => {
    const a = await createSkill(english);
    await createSkill({ ...english, name: 'Китайский', manualCapacities: [] });
    await completeStep(await createStep({ skillId: a, name: 'Шаг', points: 15 }));
    const summaries = await listSkillSummaries();
    expect(summaries.map((s) => [s.skill.name, s.progress.currentFlask, s.progress.pointsInCurrentFlask, s.progress.currentCapacity])).toEqual([
      ['Английский', 2, 5, 20],
      ['Китайский', 1, 0, 100],
    ]);
  });

  it('deletes a skill with all of its history', async () => {
    const skillId = await createSkill(english);
    await completeStep(await createStep({ skillId, name: 'Шаг', points: 5 }));
    await deleteSkill(skillId);
    expect(await getSkillDetails(skillId)).toBeNull();
    for (const table of [db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions]) {
      expect(await table.count()).toBe(0);
    }
  });
});
