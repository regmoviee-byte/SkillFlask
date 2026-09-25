import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock } from '../test/harness';
import { getAchievementsView, resetAchievementCache } from './achievements';
import { cancelCompletion, completeStep } from './completions';
import { getHomeView } from './queries';
import { getLastWeekLine, getRecapView, lastCompletedWeek } from './recap';
import { createSkill } from './skills';
import { createStep } from './steps';

installFreshDb();
// Thursday, 24 September 2026: the current week starts on the 21st, the last one on the 14th.
const TODAY = '2026-09-24';
beforeEach(() => {
  setClock(tickingClock(`${TODAY}T12:00:00`));
  resetAchievementCache();
});

async function setup() {
  const skillId = await createSkill({
    name: 'Английский',
    description: '',
    startLabel: '',
    targetLabel: '',
    milestoneName: 'Веха',
    milestoneTarget: 5,
    capacityBase: 20,
    capacityIncrement: 0,
    manualCapacities: [],
  });
  const stepId = await createStep({ skillId, name: 'Разговор', points: 10 });
  return { skillId, stepId };
}

describe('getRecapView', () => {
  it('opens on the last completed week and ranges from the first completion to this week', async () => {
    const { skillId, stepId } = await setup();
    expect(lastCompletedWeek(TODAY)).toBe('2026-09-14');
    await completeStep(stepId, { date: '2026-09-02' });
    await completeStep(stepId, { date: '2026-09-15' });
    await completeStep(stepId, { date: '2026-09-15' });
    await completeStep(stepId, { date: '2026-09-17' });

    const view = await getRecapView(lastCompletedWeek(TODAY), TODAY);
    expect(view.firstWeek).toBe('2026-08-31');
    expect(view.currentWeek).toBe('2026-09-21');
    expect(view.skillNames).toEqual({ [skillId]: 'Английский' });
    expect(view.recap).toMatchObject({ weekStart: '2026-09-14', points: 30, activeDays: 2, completions: 3, flasksFilled: 2 });
    expect(view.recap.topSkill).toEqual({ skillId, points: 30 });
    // Every run is one day long, so «Лучшая серия» stays with the first one, on the 2nd.
    expect(view.recap.records).toEqual(['bestDay', 'bestWeek', 'mostCompletions', 'fastestFlask']);
    expect(view.records.bestDay).toEqual({ date: '2026-09-15', points: 20 });
  });

  it('follows a cancellation: the recap and the records are re-read', async () => {
    const { stepId } = await setup();
    await completeStep(stepId, { date: '2026-09-15' });
    const second = await completeStep(stepId, { date: '2026-09-15' });
    expect((await getRecapView('2026-09-14', TODAY)).recap.points).toBe(20);
    await cancelCompletion(second.completionId);
    const view = await getRecapView('2026-09-14', TODAY);
    expect(view.recap).toMatchObject({ points: 10, completions: 1, flasksFilled: 0 });
    expect(view.records.bestDay).toEqual({ date: '2026-09-15', points: 10 });
    expect((await getAchievementsView()).records.bestDay).toEqual({ date: '2026-09-15', points: 10 });
  });

  it('never goes back before the last completed week on an empty journal', async () => {
    await setup();
    const view = await getRecapView('2026-09-14', TODAY);
    expect(view.firstWeek).toBe('2026-09-14');
    expect(view.recap.completions).toBe(0);
  });
});

describe('getLastWeekLine', () => {
  it('shows the previous week all through the current one, only when it had a completion', async () => {
    const { stepId } = await setup();
    await completeStep(stepId, { date: '2026-09-21' });
    expect(await getLastWeekLine(TODAY)).toBeNull();
    await completeStep(stepId, { date: '2026-09-14' });
    const done = await completeStep(stepId, { date: '2026-09-20' });
    await completeStep(stepId, { date: '2026-09-20' });
    expect(await getLastWeekLine(TODAY)).toEqual({ weekStart: '2026-09-14', points: 30, activeDays: 2 });
    // Monday and Sunday of the current week name the same week.
    expect((await getLastWeekLine('2026-09-21'))?.weekStart).toBe('2026-09-14');
    expect((await getLastWeekLine('2026-09-27'))?.weekStart).toBe('2026-09-14');
    expect((await getHomeView(TODAY)).lastWeek).toEqual({ weekStart: '2026-09-14', points: 30, activeDays: 2 });
    await cancelCompletion(done.completionId);
    expect((await getHomeView(TODAY)).lastWeek).toEqual({ weekStart: '2026-09-14', points: 20, activeDays: 2 });
  });
});
