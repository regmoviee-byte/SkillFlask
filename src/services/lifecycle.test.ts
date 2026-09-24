import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { setClock } from '../lib/clock';
import { addDays, localDate } from '../lib/dates';
import { installFreshDb, tickingClock, todayNoon, withClock } from '../test/harness';
import { completeStep } from './completions';
import { getSkillHistory } from './history';
import { archiveSkill, restartSkill, restoreSkill } from './lifecycle';
import { getHomeView, getSkillDetails, listSkillSummaries } from './queries';
import { completeSkill, continueAfterMilestone, createSkill, deleteSkill, updateSkill, type SkillInput } from './skills';
import { createStep, setStepActive, updateStep } from './steps';
import { getDayPlan } from './today';

const english: SkillInput = {
  name: 'Английский',
  description: 'Разговорный',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Достичь C1',
  milestoneTarget: 2,
  capacityBase: 10,
  capacityIncrement: 5,
  manualCapacities: [10, 20],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));

/** The skills «Сегодня» lists (active ones only). */
const todaySkills = async () => (await getDayPlan(localDate())).skills.map((s) => s.skill.id);

async function details(id: string) {
  const d = await getSkillDetails(id);
  if (!d) throw new Error('skill not found');
  return d;
}

/** A skill with two active steps, one hidden step and the milestone (10 + 20 points) reached. */
async function reachedSkill() {
  const skillId = await createSkill(english);
  const speaking = await createStep({ skillId, name: 'Разговорная практика', points: 5 });
  const reading = await createStep({ skillId, name: 'Чтение', points: 10 });
  const hidden = await createStep({ skillId, name: 'Старое', points: 1 });
  await completeStep(hidden);
  await setStepActive(hidden, false);
  for (let i = 0; i < 3; i++) await completeStep(reading);
  await completeStep(speaking);
  return { skillId, speaking, reading, hidden };
}

describe('archiveSkill', () => {
  it('makes the skill read-only, its settings included', async () => {
    const { skillId } = await reachedSkill();
    await archiveSkill(skillId);
    await expect(updateSkill(skillId, { ...english, capacityBase: 1 })).rejects.toThrow('Навык не активен');
    expect((await db.skills.get(skillId))!.capacityBase).toBe(english.capacityBase);
  });

  it('hides the skill from «Сегодня» and keeps its whole history', async () => {
    const { skillId, speaking } = await reachedSkill();
    const historyBefore = await getSkillHistory(skillId);
    expect(await todaySkills()).toEqual([skillId]);

    await archiveSkill(skillId);

    const skill = await db.skills.get(skillId);
    expect(skill).toMatchObject({ status: 'ARCHIVED' });
    expect(skill?.archivedAt).not.toBeNull();
    expect(await todaySkills()).toEqual([]);
    // Every operation is still there; the history adds the archiving itself.
    const historyAfter = (await getSkillHistory(skillId))!;
    expect(historyAfter.operations).toBe(historyBefore!.operations);
    expect(historyAfter.events.map((e) => e.type)).toContain('SKILL_ARCHIVED');
    expect((await details(skillId)).progress.totalPoints).toBe(36);
    // Nothing can be recorded or changed while it waits.
    await expect(completeStep(speaking)).rejects.toThrow('Навык не активен');
    await expect(createStep({ skillId, name: 'Новое', points: 1 })).rejects.toThrow('Навык не активен');
    await expect(updateStep(speaking, { name: 'Другое', points: 1 })).rejects.toThrow('Навык не активен');
    await expect(continueAfterMilestone(skillId)).rejects.toThrow('Навык не активен');
  });

  it('only archives an active skill', async () => {
    const { skillId } = await reachedSkill();
    await archiveSkill(skillId);
    await expect(archiveSkill(skillId)).rejects.toThrow('В архив можно убрать только активный навык');
    const other = await createSkill({ ...english, milestoneTarget: 1 });
    const step = await createStep({ skillId: other, name: 'Шаг', points: 10 });
    await completeStep(step);
    await completeSkill(other);
    await expect(archiveSkill(other)).rejects.toThrow('В архив можно убрать только активный навык');
    await expect(archiveSkill('nope')).rejects.toThrow('Навык не найден');
  });
});

describe('restoreSkill', () => {
  it('brings back the same skill with its progress and the reached milestone', async () => {
    const { skillId, speaking } = await reachedSkill();
    const before = await details(skillId);
    expect(before.milestone?.reachedAt).not.toBeNull();

    await archiveSkill(skillId);
    await restoreSkill(skillId);

    const after = await details(skillId);
    expect(after.skill).toMatchObject({ id: skillId, status: 'ACTIVE', archivedAt: null });
    expect(after.progress).toEqual(before.progress);
    // The milestone is still reached, with its original date and the decision still open.
    expect(after.milestone).toMatchObject({ reachedAt: before.milestone!.reachedAt, decision: null });
    expect(await todaySkills()).toEqual([skillId]);
    // Recording works again.
    expect((await completeStep(speaking)).after.totalPoints).toBe(41);
    await expect(restoreSkill(skillId)).rejects.toThrow('Навык не в архиве');
  });
});

describe('restartSkill', () => {
  it('copies the settings, the milestone and the active steps into a new skill with an empty journal', async () => {
    const { skillId } = await reachedSkill();
    await completeSkill(skillId);
    const original = await details(skillId);
    const originalHistory = (await getSkillHistory(skillId))!;

    // A day later: the copies start their schedule on the day of the restart.
    const tomorrow = addDays(localDate(), 1);
    const copyId = await withClock(`${tomorrow}T09:00:00`, () => restartSkill(skillId), 2000);

    const copy = await details(copyId);
    expect(copyId).not.toBe(skillId);
    expect(copy.skill).toMatchObject({
      name: 'Английский',
      description: 'Разговорный',
      startLabel: 'B1',
      targetLabel: 'C1',
      capacityBase: 10,
      capacityIncrement: 5,
      status: 'ACTIVE',
      completedAt: null,
      archivedAt: null,
      originSkillId: skillId,
    });
    expect(copy.skill.createdAt > original.skill.createdAt).toBe(true);
    expect(copy.config.manual).toEqual([10, 20]);
    expect(copy.milestone).toMatchObject({ name: 'Достичь C1', targetFlaskNumber: 2, reachedAt: null, decision: null, skillId: copyId });
    expect(copy.milestone?.id).not.toBe(original.milestone?.id);
    expect(copy.progress).toMatchObject({ totalPoints: 0, completedFlasks: 0, currentFlask: 1 });
    // Only the steps that were on the list, in their order, new ids, schedule from the restart day.
    expect(copy.steps.map((s) => [s.name, s.points])).toEqual([
      ['Разговорная практика', 5],
      ['Чтение', 10],
    ]);
    expect(copy.hiddenSteps).toEqual([]);
    for (const step of copy.steps) {
      expect(step.skillId).toBe(copyId);
      expect(step.scheduleFrom).toBe(tomorrow);
      expect(original.steps.map((s) => s.id)).not.toContain(step.id);
    }
    // No history is copied.
    expect(await db.completions.where('skillId').equals(copyId).count()).toBe(0);
    expect(await db.transactions.where('skillId').equals(copyId).count()).toBe(0);
    expect((await getSkillHistory(copyId))!.operations).toBe(0);
    // The original is untouched.
    expect(await details(skillId)).toEqual(original);
    expect((await getSkillHistory(skillId))!.operations).toBe(originalHistory.operations);
  });

  it('plans the copied steps from the restart day on, never on the dates before it', async () => {
    const skillId = await createSkill(english);
    await createStep({ skillId, name: 'Разговор', points: 5, schedule: { kind: 'DAILY' } });
    await createStep({ skillId, name: 'Спорт', points: 5, schedule: { kind: 'TIMES_PER_WEEK', times: 3 } });
    await archiveSkill(skillId);
    const today = localDate();
    const copyId = await restartSkill(skillId);
    const steps = (await details(copyId)).steps;
    expect(steps.map((s) => [s.schedule.kind, s.scheduleFrom])).toEqual([
      ['DAILY', today],
      ['TIMES_PER_WEEK', today],
    ]);
    const plan = await getDayPlan(today);
    expect(plan.due.map((row) => row.step.id)).toEqual([steps[0]!.id]);
    expect(plan.quota.map((row) => row.step.id)).toEqual([steps[1]!.id]);
    const yesterday = await getDayPlan(addDays(today, -1));
    expect([...yesterday.due, ...yesterday.quota]).toEqual([]);
    expect(yesterday.totalPlanned).toBe(0);
  });

  it('restarts an archived skill and leaves it in the archive', async () => {
    const { skillId } = await reachedSkill();
    await archiveSkill(skillId);
    const copyId = await restartSkill(skillId);
    expect((await db.skills.get(skillId))?.status).toBe('ARCHIVED');
    expect(await todaySkills()).toEqual([copyId]);
    const home = await getHomeView();
    expect(home.summaries.map((s) => [s.skill.id, s.skill.status])).toEqual([
      [copyId, 'ACTIVE'],
      [skillId, 'ARCHIVED'],
    ]);
    // The copy is editable like any new skill.
    await updateSkill(copyId, { ...english, name: 'Английский C1 → C2' });
    expect((await db.skills.get(copyId))?.name).toBe('Английский C1 → C2');
  });

  it('refuses an active skill', async () => {
    const { skillId } = await reachedSkill();
    await expect(restartSkill(skillId)).rejects.toThrow('Начать заново можно только архивный или достигнутый навык');
    expect(await listSkillSummaries()).toHaveLength(1);
  });

  it('keeps the copy when the original is deleted', async () => {
    const { skillId } = await reachedSkill();
    await archiveSkill(skillId);
    const copyId = await restartSkill(skillId);
    const step = (await details(copyId)).steps[0]!;
    await completeStep(step.id);

    await deleteSkill(skillId);

    expect(await db.skills.get(skillId)).toBeUndefined();
    const copy = await details(copyId);
    expect(copy.skill.originSkillId).toBe(skillId);
    expect(copy.steps).toHaveLength(2);
    expect(copy.progress.totalPoints).toBe(5);
    expect((await getSkillHistory(copyId))!.operations).toBe(1);
  });
});

describe('deleteSkill', () => {
  it('takes its achievements along and re-credits the ones another skill still holds', async () => {
    const { skillId } = await reachedSkill();
    const other = await createSkill(english);
    expect(await db.achievementUnlocks.get('first-flask')).toMatchObject({ skillId });
    expect(await db.achievementUnlocks.get('first-skill')).toMatchObject({ skillId });
    await deleteSkill(skillId);
    // Nothing is left pointing at the deleted skill: every later backup stays importable.
    const rows = await db.achievementUnlocks.toArray();
    expect(rows.filter((row) => row.skillId === skillId)).toEqual([]);
    expect(await db.achievementUnlocks.get('first-flask')).toBeUndefined();
    const created = (await db.skills.get(other))!.createdAt;
    expect(await db.achievementUnlocks.get('first-skill')).toMatchObject({ skillId: other, unlockedAt: created });
  });
});
