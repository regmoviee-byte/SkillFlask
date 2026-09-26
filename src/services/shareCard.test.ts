import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { setClock } from '../lib/clock';
import { addDays } from '../lib/dates';
import { installFreshDb, tickingClock } from '../test/harness';
import { cancelCompletion, completeStep } from './completions';
import { completeSkill, createSkill, type SkillInput } from './skills';
import { createStep } from './steps';
import { getShareCardData } from './shareCard';
import { pauseSkill } from './pauses';

const TODAY = '2026-09-26';

const input: SkillInput = {
  name: 'Гитара',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 5,
  capacityBase: 100,
  capacityIncrement: 50,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(`${TODAY}T12:00:00`)));

/** A step of the skill completed on each date (`days` before today). */
async function practise(stepId: string, daysAgo: number[]) {
  for (const d of daysAgo) await completeStep(stepId, { date: addDays(TODAY, -d) });
}

describe('getShareCardData', () => {
  it('folds the journal into the hero’s numbers', async () => {
    const id = await createSkill(input);
    const step = await createStep({ skillId: id, name: 'Гаммы', points: 60 });
    await practise(step, [0, 1, 2]);
    const data = await getShareCardData(id, TODAY);
    expect(data?.skill.name).toBe('Гитара');
    expect(data?.milestone?.targetFlaskNumber).toBe(5);
    // 180 points: flask 1 (100) is full, 80 of 150 in flask 2.
    expect(data?.progress).toMatchObject({ totalPoints: 180, completedFlasks: 1, currentFlask: 2, pointsInCurrentFlask: 80, currentCapacity: 150 });
    expect(data?.pause).toBeNull();
  });

  it('finds the best run of days and the active days of the last 30, cancelled ones left out', async () => {
    const id = await createSkill(input);
    const step = await createStep({ skillId: id, name: 'Гаммы', points: 5 });
    // A run of three 40–38 days ago (outside the month), then 3, 2 and today.
    await practise(step, [40, 39, 38, 3, 2, 0]);
    // Yesterday, cancelled: counted, it would join 3–0 into a run of four.
    await completeStep(step, { date: addDays(TODAY, -1) });
    const yesterday = await db.completions.where('date').equals(addDays(TODAY, -1)).first();
    await cancelCompletion(yesterday!.id);
    const data = await getShareCardData(id, TODAY);
    expect(data?.bestStreak).toEqual({ days: 3, bridged: false });
    expect(data?.activeDays30).toBe(3);
    expect(data?.activeDaysTotal).toBe(6);
  });

  it('bridges the skill’s own paused days, and says so', async () => {
    const id = await createSkill(input);
    const step = await createStep({ skillId: id, name: 'Гаммы', points: 5 });
    await practise(step, [10, 9, 5, 4]);
    await db.pauses.add({ id: 'p1', skillId: id, from: addDays(TODAY, -8), until: addDays(TODAY, -6), createdAt: `${addDays(TODAY, -8)}T09:00:00.000Z`, endedAt: `${addDays(TODAY, -5)}T09:00:00.000Z` });
    const data = await getShareCardData(id, TODAY);
    expect(data?.bestStreak).toEqual({ days: 4, bridged: true });
  });

  it('shows no run below two days, and the running pause of an active skill', async () => {
    const id = await createSkill(input);
    const step = await createStep({ skillId: id, name: 'Гаммы', points: 5 });
    await practise(step, [3]);
    const pause = await pauseSkill(id, addDays(TODAY, 6));
    const data = await getShareCardData(id, TODAY);
    expect(data?.bestStreak).toBeNull();
    expect(data?.pause?.id).toBe(pause.id);
  });

  it('reads a completed skill, and nothing for a skill that is gone', async () => {
    const id = await createSkill({ ...input, milestoneTarget: 1 });
    const step = await createStep({ skillId: id, name: 'Гаммы', points: 100 });
    await completeStep(step);
    await completeSkill(id);
    const data = await getShareCardData(id, TODAY);
    expect(data?.skill.status).toBe('COMPLETED');
    expect(data?.progress.completedFlasks).toBe(1);
    expect(data?.pause).toBeNull();
    expect(await getShareCardData('missing', TODAY)).toBeNull();
  });
});
