import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import { localDate } from '../lib/dates';
import { cancelCompletion, completeStep } from './completions';
import { getSkillHistory } from './history';
import { getSkillDetails } from './queries';
import { completeSkill, createSkill, ValidationError, type SkillInput } from './skills';
import { createStep, getStep, setStepActive, TYPE_IMMUTABLE_MESSAGE, updateStep } from './steps';

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
    await expect(updateStep(stepId, { name: 'Чтение', points: 5 })).rejects.toThrow('Навык не активен');
  });

  it('keeps the fields a patch omits, the name included', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 7, schedule: { kind: 'DAILY' } });
    await updateStep(stepId, { points: 3 });
    expect(await getStep(stepId)).toMatchObject({ name: 'Чтение', points: 3, schedule: { kind: 'DAILY' } });
    await updateStep(stepId, { name: 'Чтение вслух' });
    expect(await getStep(stepId)).toMatchObject({ name: 'Чтение вслух', points: 3 });
  });
});

describe('createStep', () => {
  it('stores a BOOLEAN step by default: manual, planned from today', async () => {
    const skillId = await createSkill(skillInput);
    const id = await createStep({ skillId, name: 'Чтение', points: 7 });
    expect(await getStep(id)).toMatchObject({
      type: 'BOOLEAN',
      points: 7,
      pointsPerMinute: null,
      defaultMinutes: null,
      schedule: { kind: 'MANUAL' },
      scheduleFrom: localDate(),
    });
  });

  it('stores a TIMED step with its rate, usual minutes and a normalised schedule', async () => {
    const skillId = await createSkill(skillInput);
    const id = await createStep({
      skillId,
      name: 'Практика',
      type: 'TIMED',
      points: 99, // ignored for a timed step
      pointsPerMinute: 0.25,
      defaultMinutes: 30,
      schedule: { kind: 'WEEKDAYS', days: [5, 1, 3] },
    });
    expect(await getStep(id)).toMatchObject({
      type: 'TIMED',
      points: 0,
      pointsPerMinute: 0.25,
      defaultMinutes: 30,
      schedule: { kind: 'WEEKDAYS', days: [1, 3, 5] },
    });
  });

  it('validates rates, minutes, points and schedules', async () => {
    const skillId = await createSkill(skillInput);
    const timed = { skillId, name: 'Практика', type: 'TIMED' as const, defaultMinutes: null };
    for (const rate of [0, -1, 0.125, 1000.5, NaN, null]) {
      await expect(createStep({ ...timed, pointsPerMinute: rate })).rejects.toThrow(
        'Очков за минуту: число с не более чем двумя знаками после запятой, например 0,25',
      );
    }
    await expect(createStep({ ...timed, pointsPerMinute: 1000 })).resolves.toBeTypeOf('string');
    for (const minutes of [0, 1441, 2.5]) {
      await expect(createStep({ ...timed, pointsPerMinute: 1, defaultMinutes: minutes })).rejects.toThrow('Обычно минут: целое число от 1 до 1440');
    }
    await expect(createStep({ skillId, name: 'Чтение', points: 0 })).rejects.toThrow(ValidationError);
    await expect(createStep({ skillId, name: 'Чтение', points: 2.5 })).rejects.toThrow(ValidationError);
    await expect(createStep({ skillId, name: 'Чтение', points: 5, schedule: { kind: 'WEEKDAYS', days: [] } })).rejects.toThrow(
      'Выберите хотя бы один день недели',
    );
    await expect(createStep({ skillId, name: 'Чтение', points: 5, schedule: { kind: 'TIMES_PER_MONTH', times: 32 } })).rejects.toThrow(
      'Количество повторов: от 1 до 31',
    );
  });
});

describe('updateStep for types and schedules', () => {
  it('keeps the type, re-prices a timed step and restarts the schedule from today when it changes', async () => {
    const skillId = await createSkill(skillInput);
    const id = await createStep({ skillId, name: 'Практика', type: 'TIMED', pointsPerMinute: 0.5, defaultMinutes: 30 });
    await expect(updateStep(id, { name: 'Практика', type: 'BOOLEAN', points: 5 })).rejects.toThrow(TYPE_IMMUTABLE_MESSAGE);
    await updateStep(id, { name: 'Практика', type: 'TIMED', pointsPerMinute: 0.75, defaultMinutes: null });
    expect(await getStep(id)).toMatchObject({ type: 'TIMED', pointsPerMinute: 0.75, defaultMinutes: null, schedule: { kind: 'MANUAL' } });

    // Same schedule: scheduleFrom stays; a new one plans from today on.
    await db.steps.update(id, { scheduleFrom: '2026-01-01' });
    await updateStep(id, { name: 'Практика', schedule: { kind: 'MANUAL' } });
    expect((await getStep(id))!.scheduleFrom).toBe('2026-01-01');
    await updateStep(id, { name: 'Практика', schedule: { kind: 'TIMES_PER_WEEK', times: 2 } });
    expect(await getStep(id)).toMatchObject({ schedule: { kind: 'TIMES_PER_WEEK', times: 2 }, scheduleFrom: localDate() });

    // A stored schedule with unsorted days (an old backup) is the same schedule, not a new one.
    await db.steps.update(id, { schedule: { kind: 'WEEKDAYS', days: [5, 1, 3] }, scheduleFrom: '2026-01-01' });
    await updateStep(id, { name: 'Практика, вечер', schedule: { kind: 'WEEKDAYS', days: [1, 3, 5] } });
    expect((await getStep(id))!.scheduleFrom).toBe('2026-01-01');
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
