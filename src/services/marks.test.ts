import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { setClock } from '../lib/clock';
import { addDays, localDate } from '../lib/dates';
import { markHeight } from '../domain/marks';
import { computeProgress, flaskCapacity } from '../domain/progression';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import { cancelCompletion, completeStep } from './completions';
import { ValidationError } from './core';
import { getSkillHistory } from './history';
import { archiveSkill, restartSkill, restoreSkill } from './lifecycle';
import { createMark, deleteMark, MarkValidationError, updateMark } from './marks';
import { getSkillDetails } from './queries';
import { completeSkill, createSkill, deleteSkill, updateSkill, type SkillInput } from './skills';
import { createStep } from './steps';

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));

// Flasks of 10, 20, then 25, 30…; the milestone is two flasks (30 points).
const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Достичь C1',
  milestoneTarget: 2,
  capacityBase: 10,
  capacityIncrement: 5,
  manualCapacities: [10, 20],
};

async function skillWithPoints(completions: number, points = 4) {
  const skillId = await createSkill(input);
  const stepId = await createStep({ skillId, name: 'Разговор', points });
  const ids: string[] = [];
  for (let i = 0; i < completions; i++) ids.push((await completeStep(stepId)).completionId);
  return { skillId, stepId, ids };
}

const markOf = async (id: string) => (await db.marks.get(id))!;

describe('createMark', () => {
  it('pins the mark at the progress the journal gives right now', async () => {
    const { skillId } = await skillWithPoints(4); // 16 points: flask 1 full, 6 in flask 2
    const id = await createMark(skillId, { title: '  Пробный тест ', description: '72 из 100' });
    const details = (await getSkillDetails(skillId))!;
    const mark = await markOf(id);
    expect(mark).toMatchObject({
      skillId,
      title: 'Пробный тест',
      description: '72 из 100',
      date: localDate(),
      flaskNumber: details.progress.currentFlask,
      pointsInFlask: details.progress.pointsInCurrentFlask,
      totalPoints: details.progress.totalPoints,
    });
    expect(mark).toMatchObject({ flaskNumber: 2, pointsInFlask: 6, totalPoints: 16 });
    expect(details.marks.map((m) => m.id)).toEqual([id]);
  });

  it('never moves the mark: a later cancellation or capacity edit leaves it as it was', async () => {
    const { skillId, ids } = await skillWithPoints(4);
    const id = await createMark(skillId, { title: 'Экзамен' });
    const before = await markOf(id);

    await cancelCompletion(ids[3]!);
    await cancelCompletion(ids[2]!);
    expect((await getSkillDetails(skillId))!.progress).toMatchObject({ currentFlask: 1, totalPoints: 8 });
    expect(await markOf(id)).toEqual(before);

    // Flask 2 shrinks from 20 to 5: the stored 6 points no longer fit and the mark sits at the rim.
    await updateSkill(skillId, { ...input, manualCapacities: [10, 5] });
    const after = await markOf(id);
    expect(after).toEqual(before);
    const config = (await getSkillDetails(skillId))!.config;
    expect(markHeight(after, flaskCapacity(after.flaskNumber, config))).toBe(1);
  });

  it('takes a past date but not a future one, and validates the title', async () => {
    const { skillId } = await skillWithPoints(1);
    const yesterday = addDays(localDate(), -1);
    const id = await createMark(skillId, { title: 'Собеседование', date: yesterday });
    expect((await markOf(id)).date).toBe(yesterday);
    await expect(createMark(skillId, { title: 'Завтра', date: addDays(localDate(), 1) })).rejects.toThrow('Дата не может быть в будущем');
    await expect(createMark(skillId, { title: '' })).rejects.toBeInstanceOf(MarkValidationError);
    await expect(createMark(skillId, { title: 'x'.repeat(61) })).rejects.toThrow('Слишком длинное название');
    await expect(createMark(skillId, { title: 'Тест', date: '2026-13-01' })).rejects.toThrow('Некорректная дата');
    await expect(createMark('nope', { title: 'Тест' })).rejects.toThrow('Навык не найден');
    expect(await db.marks.count()).toBe(1);
  });

  it('works on an empty flask: flask 1, 0 points', async () => {
    const skillId = await createSkill(input);
    const id = await createMark(skillId, { title: 'Начало курса' });
    expect(await markOf(id)).toMatchObject({ flaskNumber: 1, pointsInFlask: 0, totalPoints: 0 });
    expect(computeProgress(0, { base: 10, increment: 5, manual: [10, 20] }).currentFlask).toBe(1);
  });
});

describe('updateMark and deleteMark', () => {
  it('change the title, description and date only', async () => {
    const { skillId, stepId } = await skillWithPoints(1);
    const id = await createMark(skillId, { title: 'Тест' });
    const before = await markOf(id);
    await completeStep(stepId);
    await updateMark(id, { title: ' Пробный тест ', description: 'Сдан на 80', date: addDays(localDate(), -2) });
    const after = await markOf(id);
    expect(after).toMatchObject({ title: 'Пробный тест', description: 'Сдан на 80', date: addDays(localDate(), -2) });
    expect(after).toMatchObject({ flaskNumber: before.flaskNumber, pointsInFlask: before.pointsInFlask, totalPoints: before.totalPoints, createdAt: before.createdAt });
    expect(after.updatedAt > before.updatedAt).toBe(true);
    await expect(updateMark(id, { title: '', description: '', date: localDate() })).rejects.toThrow('Укажите название засечки');

    await deleteMark(id);
    expect(await db.marks.count()).toBe(0);
    await expect(deleteMark(id)).rejects.toThrow('Засечка не найдена');
  });
});

describe('marks through the skill lifecycle', () => {
  it('survive archive and restore, and completion', async () => {
    const { skillId } = await skillWithPoints(8); // 32 points: the milestone of two flasks
    const id = await createMark(skillId, { title: 'Экзамен B2' });
    await archiveSkill(skillId);
    expect((await getSkillDetails(skillId))!.marks.map((m) => m.id)).toEqual([id]);
    await restoreSkill(skillId);
    await completeSkill(skillId);
    expect((await getSkillDetails(skillId))!.marks.map((m) => m.id)).toEqual([id]);
    expect((await getSkillHistory(skillId))!.events.some((e) => e.type === 'MARK' && e.mark.id === id)).toBe(true);
  });

  it('are not copied by «Начать заново» and go away with the skill', async () => {
    const { skillId } = await skillWithPoints(8);
    const other = await createSkill({ ...input, name: 'Спорт' });
    await createMark(skillId, { title: 'Экзамен B2' });
    const kept = await createMark(other, { title: 'Забег' });
    await completeSkill(skillId);
    const copy = await restartSkill(skillId);
    expect((await getSkillDetails(copy))!.marks).toEqual([]);
    expect(await db.marks.where('skillId').equals(skillId).count()).toBe(1);

    await deleteSkill(skillId);
    expect(await db.marks.where('skillId').equals(skillId).count()).toBe(0);
    expect((await db.marks.toArray()).map((m) => m.id)).toEqual([kept]);
  });

  it('are read-only on a skill that is not active', async () => {
    const { skillId } = await skillWithPoints(8);
    const id = await createMark(skillId, { title: 'Экзамен' });
    await completeSkill(skillId);
    const refused = (p: Promise<unknown>) => expect(p).rejects.toSatisfy((e) => e instanceof ValidationError && e.message === 'Навык не активен');
    await refused(createMark(skillId, { title: 'Ещё' }));
    await refused(updateMark(id, { title: 'Другое', description: '', date: localDate() }));
    await refused(deleteMark(id));

    const archived = (await skillWithPoints(1)).skillId;
    const other = await createMark(archived, { title: 'Курс' });
    await archiveSkill(archived);
    await refused(createMark(archived, { title: 'Ещё' }));
    await refused(updateMark(other, { title: 'Другое', description: '', date: localDate() }));
    await refused(deleteMark(other));
    expect(await db.marks.count()).toBe(2);
  });
});

describe('marks in the history', () => {
  it('are listed at their own date, inside the day by when they were written', async () => {
    const { skillId, stepId } = await skillWithPoints(1);
    const today = await createMark(skillId, { title: 'Сегодня', description: 'Описание' });
    await completeStep(stepId);
    const past = await createMark(skillId, { title: 'Раньше', date: addDays(localDate(), -3) });
    const events = (await getSkillHistory(skillId))!.events;
    const marks = events.filter((e) => e.type === 'MARK');
    expect(marks.map((e) => e.type === 'MARK' && e.mark.id)).toEqual([today, past]);
    const todayIndex = events.findIndex((e) => e.type === 'MARK' && e.mark.id === today);
    // Written between the two completions: below the newer one, above the older one.
    expect(events.slice(0, todayIndex).filter((e) => e.type === 'COMPLETION')).toHaveLength(1);
    expect(events.slice(todayIndex).filter((e) => e.type === 'COMPLETION')).toHaveLength(1);
    const pastEvent = events.find((e) => e.type === 'MARK' && e.mark.id === past)!;
    expect(pastEvent.date).toBe(addDays(localDate(), -3));
    expect(events.at(-1)).toBe(pastEvent);
  });
});
