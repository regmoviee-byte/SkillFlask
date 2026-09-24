import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import { localDate } from '../lib/dates';
import { cancelCompletion, completeStep } from './completions';
import { getSkillHistory } from './history';
import { getSkillDetails } from './queries';
import { completeSkill, createSkill, ValidationError, type SkillInput } from './skills';
import { createStep, getStep, setStepActive, updateStep } from './steps';

const skillInput: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 1,
  capacityBase: 100,
  capacityIncrement: 50,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));

async function details(id: string) {
  const d = await getSkillDetails(id);
  if (!d) throw new Error('skill not found');
  return d;
}

describe('updateStep', () => {
  it('changes only the definition: past snapshots and progress stay (FR-ST-007)', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
    const { completionId } = await completeStep(stepId);

    await updateStep(stepId, { name: '  Чтение книг ', points: 10 });
    expect(await getStep(stepId)).toMatchObject({ name: 'Чтение книг', points: 10, type: 'BOOLEAN', isActive: true });
    expect(await db.completions.get(completionId)).toMatchObject({ stepName: 'Чтение', pointsSnapshot: 7, pointsAwarded: 7 });
    expect((await details(skillId)).progress.totalPoints).toBe(7);

    // The next completion uses the new definition.
    await completeStep(stepId);
    expect((await details(skillId)).progress.totalPoints).toBe(17);
  });

  it('validates input and rejects a completed skill', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 100 });
    await expect(updateStep(stepId, { name: ' ', points: 5 })).rejects.toThrow(ValidationError);
    await expect(updateStep(stepId, { name: 'Чтение', points: 0 })).rejects.toThrow(ValidationError);
    await expect(updateStep(stepId, { name: 'Чтение', points: 1.5 })).rejects.toThrow(ValidationError);
    await expect(updateStep('nope', { name: 'Чтение', points: 5 })).rejects.toThrow('Действие не найдено');
    await completeStep(stepId);
    await completeSkill(skillId);
    await expect(updateStep(stepId, { name: 'Чтение', points: 5 })).rejects.toThrow('Навык завершён — история доступна только для чтения');
  });
});

describe('setStepActive', () => {
  it('hides a step from the list and keeps its history (FR-ST-008, FR-ST-009)', async () => {
    const skillId = await createSkill(skillInput);
    const reading = await createStep({ skillId, name: 'Чтение', points: 7 });
    const talking = await createStep({ skillId, name: 'Разговор', points: 5 });
    await completeStep(reading);

    await setStepActive(reading, false);
    let d = await details(skillId);
    expect(d.steps.map((s) => s.name)).toEqual(['Разговор']);
    expect(d.hiddenSteps.map((s) => s.name)).toEqual(['Чтение']);
    expect((await getSkillHistory(skillId))?.operations).toBe(1);
    expect(d.progress.totalPoints).toBe(7);
    expect(d.lastDoneAt[reading]).not.toBeNull();
    // A hidden step cannot be completed.
    await expect(completeStep(reading)).rejects.toThrow('Действие не найдено');

    await setStepActive(talking, false);
    d = await details(skillId);
    expect(d.hiddenSteps.map((s) => s.name)).toEqual(['Разговор', 'Чтение']); // most recently hidden first

    await setStepActive(reading, true);
    d = await details(skillId);
    expect(d.steps.map((s) => s.name)).toEqual(['Чтение']);
    expect(d.hiddenSteps.map((s) => s.name)).toEqual(['Разговор']);
  });
});

describe('getSkillDetails step counters', () => {
  it('counts ACTIVE completions of today and the last active date per step', async () => {
    const skillId = await createSkill(skillInput);
    const reading = await createStep({ skillId, name: 'Чтение', points: 7 });
    const talking = await createStep({ skillId, name: 'Разговор', points: 5 });
    await completeStep(reading);
    const second = await completeStep(reading);
    await completeStep(reading, { date: '2026-01-05' });
    await cancelCompletion(second.completionId);

    const d = await details(skillId);
    expect(d.todayCounts).toEqual({ [reading]: 1 });
    expect(d.lastDoneAt[reading]).toBe(localDate());
    expect(d.lastDoneAt[talking]).toBeNull();
  });
});
