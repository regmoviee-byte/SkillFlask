import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock } from '../test/harness';
import { cancelCompletion, completeStep } from './completions';
import { archiveSkill } from './lifecycle';
import { getHomeView, getTodayView, hasActiveSteps, weekDates } from './queries';
import { completeSkill, createSkill, type SkillInput } from './skills';
import { createStep, setStepActive } from './steps';

const input = (name: string, milestoneTarget = 10): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget,
  capacityBase: 10,
  capacityIncrement: 0,
  manualCapacities: [],
});

// Thursday 24 September 2026, local time; the clock ticks 2 s per read.
const TODAY = '2026-09-24';
installFreshDb();
beforeEach(() => setClock(tickingClock(`${TODAY}T12:00:00`)));

describe('weekDates', () => {
  it('runs Monday to Sunday around the given day', () => {
    expect(weekDates(TODAY)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
    expect(weekDates('2026-09-27')[0]).toBe('2026-09-21');
    expect(weekDates('2026-09-28')[0]).toBe('2026-09-28');
  });
});

describe('week activity', () => {
  it('marks only the dates of this week with an ACTIVE completion', async () => {
    const skillId = await createSkill(input('Английский'));
    const step = await createStep({ skillId, name: 'Чтение', points: 3 });
    await completeStep(step, { date: '2026-09-20' }); // Sunday of the week before
    await completeStep(step, { date: '2026-09-21' }); // Monday
    const cancelled = await completeStep(step, { date: '2026-09-22' }); // Tuesday, then cancelled
    await cancelCompletion(cancelled.completionId);
    await completeStep(step); // today, Thursday

    const expected = [true, false, false, true, false, false, false];
    expect((await getTodayView(TODAY)).weekActivity).toEqual(expected);
    expect((await getHomeView(TODAY)).weekActivity).toEqual(expected);
  });

  it('is all false for a new week', async () => {
    const skillId = await createSkill(input('Английский'));
    const step = await createStep({ skillId, name: 'Чтение', points: 3 });
    await completeStep(step);
    expect((await getTodayView('2026-09-28')).weekActivity).toEqual(Array(7).fill(false));
  });
});

describe('getTodayView', () => {
  it('lists the active steps of active skills only', async () => {
    const english = await createSkill(input('Английский'));
    const speaking = await createStep({ skillId: english, name: 'Разговор', points: 5 });
    const hidden = await createStep({ skillId: english, name: 'Убранное', points: 1 });
    await setStepActive(hidden, false);
    const archived = await createSkill(input('Гитара'));
    await createStep({ skillId: archived, name: 'Аккорды', points: 2 });
    await archiveSkill(archived);
    const done = await createSkill(input('Бег', 1));
    const run = await createStep({ skillId: done, name: 'Пробежка', points: 10 });
    await completeStep(run);
    await completeSkill(done);
    const empty = await createSkill(input('Чтение'));

    const view = await getTodayView(TODAY);
    expect(view.today).toBe(TODAY);
    expect(view.groups.map((g) => [g.summary.skill.name, g.steps.map((s) => s.step.id)])).toEqual([
      ['Английский', [speaking]],
      // An active skill without actions is still there: the screen offers to add one.
      ['Чтение', []],
    ]);
    expect(view.groups[1]?.summary.skill.id).toBe(empty);
    // What was done today stays listed, whatever the skill's status is now.
    expect(view.done.map((d) => [d.completion.stepName, d.skillName])).toEqual([['Пробежка', 'Бег']]);
  });

  it('counts only ACTIVE completions of today and keeps cancelled ones in «Сделано сегодня»', async () => {
    const skillId = await createSkill(input('Английский'));
    const speaking = await createStep({ skillId, name: 'Разговор', points: 5 });
    const reading = await createStep({ skillId, name: 'Чтение', points: 3 });
    await completeStep(speaking, { date: '2026-09-23' });
    const first = await completeStep(speaking);
    await completeStep(speaking);
    await completeStep(reading);
    await cancelCompletion(first.completionId);

    const view = await getTodayView(TODAY);
    const steps = view.groups[0]!.steps;
    expect(steps.map((s) => [s.step.name, s.todayCount, s.lastDoneAt])).toEqual([
      // Both were done today; equal dates keep the order the actions were created in.
      ['Разговор', 1, TODAY],
      ['Чтение', 1, TODAY],
    ]);
    expect(view.todayPoints).toBe(8);
    expect(view.groups[0]!.summary.todayPoints).toBe(8);
    // Newest first, the cancelled one included; yesterday's is not «today».
    expect(view.done.map((d) => [d.completion.stepName, d.completion.status])).toEqual([
      ['Чтение', 'ACTIVE'],
      ['Разговор', 'ACTIVE'],
      ['Разговор', 'CANCELLED'],
    ]);
  });

  it('puts the most recently used steps and skills first', async () => {
    const a = await createSkill(input('А'));
    const a1 = await createStep({ skillId: a, name: 'А1', points: 1 });
    const a2 = await createStep({ skillId: a, name: 'А2', points: 1 });
    const a3 = await createStep({ skillId: a, name: 'А3', points: 1 });
    const b = await createSkill(input('Б'));
    const b1 = await createStep({ skillId: b, name: 'Б1', points: 1 });
    const c = await createSkill(input('В'));
    await createStep({ skillId: c, name: 'В1', points: 1 });

    await completeStep(a3, { date: '2026-09-20' });
    await completeStep(a2, { date: '2026-09-22' });
    await completeStep(b1, { date: '2026-09-01' });

    const view = await getTodayView(TODAY);
    // Skills by the time of their last completion (Б was worked on last), never-used ones last.
    expect(view.groups.map((g) => g.summary.skill.name)).toEqual(['Б', 'А', 'В']);
    // Steps by the date they were last done, never-done ones in creation order after them.
    expect(view.groups[1]!.steps.map((s) => s.step.id)).toEqual([a2, a3, a1]);
    // A cancelled completion is no activity.
    const latest = await completeStep(a1, { date: '2026-09-24' });
    await cancelCompletion(latest.completionId);
    expect((await getTodayView(TODAY)).groups[1]!.steps.map((s) => s.step.id)).toEqual([a2, a3, a1]);
  });
});

describe('getHomeView', () => {
  it('sums today, the filled flasks and names the last milestone', async () => {
    const english = await createSkill(input('Английский', 1));
    const speaking = await createStep({ skillId: english, name: 'Разговор', points: 12 });
    await completeStep(speaking, { date: '2026-09-22' });
    const run = await createSkill(input('Бег', 5));
    const jog = await createStep({ skillId: run, name: 'Пробежка', points: 25 });
    await completeStep(jog);
    const cancelled = await completeStep(jog);
    await cancelCompletion(cancelled.completionId);
    await archiveSkill(run);

    const home = await getHomeView(TODAY);
    expect(home.todayPoints).toBe(25);
    // 12 points fill one flask of 10 in Английский, 25 fill two in Бег (archived ones count too).
    expect(home.totalFlasks).toBe(3);
    expect(home.lastMilestone).toMatchObject({ skillId: english, skillName: 'Английский', name: 'Цель' });
    expect(home.summaries.map((s) => [s.skill.name, s.todayPoints, s.lastActivityAt !== null])).toEqual([
      ['Английский', 0, true],
      ['Бег', 25, true],
    ]);
  });

  it('has nothing to show on an empty database', async () => {
    expect(await getHomeView(TODAY)).toEqual({
      summaries: [],
      todayPoints: 0,
      weekActivity: Array(7).fill(false),
      totalFlasks: 0,
      lastMilestone: null,
    });
  });
});

describe('hasActiveSteps', () => {
  it('is true once an active skill has an action on its list', async () => {
    expect(await hasActiveSteps()).toBe(false);
    const skillId = await createSkill(input('Английский'));
    expect(await hasActiveSteps()).toBe(false);
    const step = await createStep({ skillId, name: 'Чтение', points: 1 });
    expect(await hasActiveSteps()).toBe(true);
    await setStepActive(step, false);
    expect(await hasActiveSteps()).toBe(false);
    await setStepActive(step, true);
    await archiveSkill(skillId);
    expect(await hasActiveSteps()).toBe(false);
  });
});
