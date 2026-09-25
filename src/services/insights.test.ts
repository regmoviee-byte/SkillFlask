import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { newId } from '../lib/ids';
import { setClock } from '../lib/clock';
import { cancelCompletion, completeStep } from './completions';
import { archiveSkill } from './lifecycle';
import { activityStart, getAllActivity, getSkillActivity, getSkillForecast } from './insights';
import { createSkill, type SkillInput } from './skills';
import { getSkillDetails } from './queries';
import { createStep } from './steps';
import { installFreshDb, tickingClock } from '../test/harness';

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'B2',
  milestoneName: 'Достичь B2',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 50,
  manualCapacities: [],
};

const TODAY = '2026-09-24';

installFreshDb();
// Local noon: the dates below are local calendar dates in both TZ runs.
beforeEach(() => setClock(tickingClock(`${TODAY}T12:00:00`)));

async function skillWithStep(points = 10) {
  const skillId = await createSkill(input);
  const stepId = await createStep({ skillId, name: 'Разговор', points });
  return { skillId, stepId };
}

describe('getSkillForecast', () => {
  it('is null for a new skill and with fewer than three days of practice', async () => {
    const { skillId, stepId } = await skillWithStep();
    expect(await getSkillForecast(skillId, TODAY)).toBeNull();
    await completeStep(stepId, { date: '2026-09-20' });
    await completeStep(stepId, { date: '2026-09-22' });
    await completeStep(stepId, { date: '2026-09-22' });
    expect(await getSkillForecast(skillId, TODAY)).toBeNull();
  });

  it('forecasts the level and the milestone from the days of the window', async () => {
    const { skillId, stepId } = await skillWithStep();
    // A back-dated completion 9 days ago starts the window: 10 days, 40 points → 4 a day.
    for (const date of ['2026-09-15', '2026-09-20', '2026-09-22', TODAY]) await completeStep(stepId, { date });
    const forecast = (await getSkillForecast(skillId, TODAY))!;
    expect(forecast.pace).toMatchObject({ deci: 400, days: 10, activeDays: 4 });
    // 60 left in flask 1 at 4 a day: 15 days.
    expect(forecast.level).toEqual({ date: '2026-10-09', days: 15 });
    // Levels 1..3 need 100 + 150 + 200 = 450: 410 to go, 103 days.
    expect(forecast.milestoneDate).toEqual({ date: '2027-01-05', days: 103 });
    expect(forecast.steps.map((s) => s.name)).toEqual(['Разговор']);
  });

  it('leaves a cancelled completion out of the points and the days', async () => {
    const { skillId, stepId } = await skillWithStep();
    for (const date of ['2026-09-20', '2026-09-22']) await completeStep(stepId, { date });
    const third = await completeStep(stepId, { date: TODAY });
    expect(await getSkillForecast(skillId, TODAY)).not.toBeNull();
    await cancelCompletion(third.completionId);
    expect(await getSkillForecast(skillId, TODAY)).toBeNull();
  });

  it('counts a completion on its local date, and a row without one on the local date it was written', async () => {
    const { skillId, stepId } = await skillWithStep();
    // Written late in the evening: in São Paulo the UTC timestamp is already the next day.
    for (const date of ['2026-09-20', '2026-09-22', TODAY]) {
      setClock(() => new Date(`${date}T23:30:00`));
      await completeStep(stepId, { date });
    }
    // An imported correction without a completion, the evening of 19 September.
    await db.transactions.add({
      id: newId(),
      skillId,
      completionId: null,
      delta: 10,
      reason: 'CORRECTION',
      createdAt: new Date('2026-09-19T23:30:00').toISOString(),
    });
    const forecast = (await getSkillForecast(skillId, TODAY))!;
    expect(forecast.pace).toMatchObject({ deci: 400, days: 6, activeDays: 3 });
  });

  it('shows nothing for a skill that is not active', async () => {
    const { skillId, stepId } = await skillWithStep();
    for (const date of ['2026-09-20', '2026-09-22', TODAY]) await completeStep(stepId, { date });
    await archiveSkill(skillId);
    expect(await getSkillForecast(skillId, TODAY)).toBeNull();
  });

  it('has no milestone date once the milestone is reached, and no forecast past five years', async () => {
    const skillId = await createSkill({ ...input, milestoneTarget: 1, capacityBase: 10, capacityIncrement: 0 });
    const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
    for (const date of ['2026-09-20', '2026-09-22', TODAY]) await completeStep(stepId, { date });
    const forecast = (await getSkillForecast(skillId, TODAY))!;
    expect(forecast.progress.completedFlasks).toBe(1);
    expect(forecast.milestoneDate).toBeNull();

    const slow = await createSkill({ ...input, capacityBase: 100_000 });
    const tiny = await createStep({ skillId: slow, name: 'Минутка', points: 1 });
    for (const date of ['2026-09-20', '2026-09-22', TODAY]) await completeStep(tiny, { date });
    expect(await getSkillForecast(slow, TODAY)).toBeNull();
  });

  it('leaves excluded dates out (the seam for paused days)', async () => {
    const { skillId, stepId } = await skillWithStep();
    for (const date of ['2026-09-15', '2026-09-20', '2026-09-22', TODAY]) await completeStep(stepId, { date });
    const paused = new Set(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']);
    const forecast = (await getSkillForecast(skillId, TODAY, (d) => paused.has(d)))!;
    expect(forecast.pace).toMatchObject({ deci: 400, days: 6 });
  });
});

describe('getSkillDetails().hasForecast', () => {
  it('says whether getSkillForecast has a forecast, so the screen keeps the line’s place', async () => {
    const { skillId, stepId } = await skillWithStep();
    const agree = async (expected: boolean) => {
      expect((await getSkillDetails(skillId, TODAY))!.hasForecast).toBe(expected);
      expect((await getSkillForecast(skillId, TODAY)) !== null).toBe(expected);
    };
    await agree(false);
    for (const date of ['2026-09-20', '2026-09-22']) await completeStep(stepId, { date });
    await agree(false);
    const last = await completeStep(stepId, { date: TODAY });
    await agree(true);
    await cancelCompletion(last.completionId);
    await agree(false);
    await completeStep(stepId, { date: TODAY });
    await archiveSkill(skillId);
    await agree(false);
  });
});

describe('activity', () => {
  it('starts the map on the Monday 25 weeks before this week’s', () => {
    expect(activityStart(TODAY)).toBe('2026-03-30');
  });

  it('counts a back-dated completion on its date, not on the day it was written, and leaves cancelled ones out', async () => {
    const { skillId, stepId } = await skillWithStep();
    const other = await skillWithStep(3);
    await completeStep(stepId, { date: '2026-08-03' });
    const cancelled = await completeStep(stepId, { date: '2026-09-01' });
    await cancelCompletion(cancelled.completionId);
    await completeStep(stepId);
    await completeStep(stepId);
    await completeStep(other.stepId);
    // Before the map: not in it.
    await completeStep(stepId, { date: '2026-03-29' });

    const view = (await getSkillActivity(skillId, TODAY))!;
    expect(view.from).toBe('2026-03-30');
    expect([...view.days.values()]).toEqual([
      { date: '2026-08-03', points: 10, completions: 1 },
      { date: TODAY, points: 20, completions: 2 },
    ]);
    expect(view.byDate.get(TODAY)!.map((c) => [c.stepName, c.points])).toEqual([
      ['Разговор', 10],
      ['Разговор', 10],
    ]);
    expect(view.skillNames).toEqual({ [skillId]: 'Английский' });

    const all = await getAllActivity(TODAY);
    expect(all.days.get(TODAY)).toEqual({ date: TODAY, points: 23, completions: 3 });
    expect(all.days.has('2026-09-01')).toBe(false);
    expect(new Set(all.byDate.get(TODAY)!.map((c) => c.skillId))).toEqual(new Set([skillId, other.skillId]));
    expect(await getSkillActivity('missing', TODAY)).toBeNull();
  });
});
