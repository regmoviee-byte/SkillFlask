import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock } from '../test/harness';
import { cancelCompletion, completeStep } from './completions';
import { archiveSkill } from './lifecycle';
import { completeSkill, createSkill, type SkillInput } from './skills';
import { createStep, setStepActive, updateStep } from './steps';
import { getDayPlan, getWeekActivity, type DayPlan } from './today';

const input = (name: string, milestoneTarget = 10): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget,
  capacityBase: 1000,
  capacityIncrement: 0,
  manualCapacities: [],
});

// Thursday 24 September 2026, local time; the clock ticks 2 s per read. Steps created at the
// start of a test plan from Monday 21 on (the clock is moved back for their creation).
const TODAY = '2026-09-24';
const MONDAY = '2026-09-21';
installFreshDb();
beforeEach(() => setClock(tickingClock(`${MONDAY}T08:00:00`)));
const toToday = () => setClock(tickingClock(`${TODAY}T12:00:00`));

const ids = (rows: { step: { id: string } }[]) => rows.map((row) => row.step.id);
const extraIds = (plan: DayPlan) => plan.extra.flatMap((g) => g.steps.map((s) => s.step.id));

describe('getDayPlan', () => {
  it('moves a daily step from «Осталось» to «Сделано» and back after a cancellation', async () => {
    const skillId = await createSkill(input('Английский'));
    const daily = await createStep({ skillId, name: 'Разговор', points: 5, schedule: { kind: 'DAILY' } });
    toToday();

    let plan = await getDayPlan(TODAY);
    expect(ids(plan.due)).toEqual([daily]);
    expect(plan.due[0]).toMatchObject({ state: 'DUE', target: 1, done: 0, count: 0, skill: { name: 'Английский' } });
    expect([plan.totalDone, plan.totalPlanned]).toEqual([0, 1]);
    expect(extraIds(plan)).toEqual([]);

    const { completionId } = await completeStep(daily);
    plan = await getDayPlan(TODAY);
    expect(plan.due).toEqual([]);
    expect(plan.done.map((d) => d.completion.id)).toEqual([completionId]);
    expect([plan.totalDone, plan.totalPlanned]).toEqual([1, 1]);
    // Done for today, it stays one tap away in «Ещё» (several completions a day are fine, 14.6).
    expect(extraIds(plan)).toEqual([daily]);
    expect(plan.extra[0]!.steps[0]).toMatchObject({ count: 1, lastDoneAt: TODAY });

    await cancelCompletion(completionId);
    plan = await getDayPlan(TODAY);
    expect(ids(plan.due)).toEqual([daily]);
    expect([plan.totalDone, plan.totalPlanned]).toEqual([0, 1]);
    expect(plan.done.map((d) => d.completion.status)).toEqual(['CANCELLED']);
  });

  it('shows a 3-per-week quota as x/3, drops it once met and still takes a 4th completion', async () => {
    const skillId = await createSkill(input('Спорт'));
    const gym = await createStep({ skillId, name: 'Зал', points: 20, schedule: { kind: 'TIMES_PER_WEEK', times: 3 } });
    toToday();

    await completeStep(gym, { date: MONDAY });
    let plan = await getDayPlan(TODAY);
    expect(plan.quota).toHaveLength(1);
    expect(plan.quota[0]).toMatchObject({ done: 1, target: 3, state: 'DUE', period: { start: MONDAY, end: '2026-09-27' } });
    // A quota is never «for today»: it has its own block and stays out of the summary.
    expect([plan.totalDone, plan.totalPlanned]).toEqual([0, 0]);
    expect(extraIds(plan)).toEqual([]);

    await completeStep(gym, { date: '2026-09-22' });
    await completeStep(gym);
    plan = await getDayPlan(TODAY);
    expect(plan.quota).toEqual([]);
    expect(extraIds(plan)).toEqual([gym]);

    const fourth = await completeStep(gym);
    expect(fourth.pointsAwarded).toBe(20);
    plan = await getDayPlan(TODAY);
    expect(plan.quota).toEqual([]);
    expect(plan.extra[0]!.steps[0]).toMatchObject({ count: 2 });
    // Wednesday, as it was at its end: 2 of 3.
    expect((await getDayPlan('2026-09-23')).quota[0]).toMatchObject({ done: 2, target: 3 });
  });

  it('lists a weekday step only on its days', async () => {
    const skillId = await createSkill(input('Гитара'));
    const monThu = await createStep({ skillId, name: 'Аккорды', points: 2, schedule: { kind: 'WEEKDAYS', days: [1, 4] } });
    toToday();
    expect(ids((await getDayPlan(TODAY)).due)).toEqual([monThu]);
    expect(ids((await getDayPlan(MONDAY)).due)).toEqual([monThu]);
    const wednesday = await getDayPlan('2026-09-23');
    expect(wednesday.due).toEqual([]);
    expect(wednesday.totalPlanned).toBe(0);
    expect(extraIds(wednesday)).toEqual([monThu]);
  });

  it('leaves out archived skills, hidden steps and dates before a new schedule', async () => {
    const english = await createSkill(input('Английский'));
    const speaking = await createStep({ skillId: english, name: 'Разговор', points: 5, schedule: { kind: 'DAILY' } });
    const hidden = await createStep({ skillId: english, name: 'Убранное', points: 1, schedule: { kind: 'DAILY' } });
    await setStepActive(hidden, false);
    const guitar = await createSkill(input('Гитара'));
    await createStep({ skillId: guitar, name: 'Аккорды', points: 2, schedule: { kind: 'DAILY' } });
    await archiveSkill(guitar);
    const run = await createSkill(input('Бег', 1));
    const jog = await createStep({ skillId: run, name: 'Пробежка', points: 1000 });
    const manual = await createStep({ skillId: english, name: 'Фильм', points: 3 });
    toToday();
    await completeStep(jog);
    await completeSkill(run);

    const plan = await getDayPlan(TODAY);
    expect(ids(plan.due)).toEqual([speaking]);
    expect(extraIds(plan)).toEqual([manual]);
    expect(plan.skills.map((s) => s.skill.name)).toEqual(['Английский']);
    // What was done on the date stays listed, whatever the skill's status is now.
    expect(plan.done.map((d) => [d.completion.stepName, d.skillName])).toEqual([['Пробежка', 'Бег']]);

    // Rescheduling plans from today on: the past keeps the plan it had.
    await updateStep(manual, { name: 'Фильм', schedule: { kind: 'DAILY' } });
    expect(ids((await getDayPlan(TODAY)).due)).toEqual([speaking, manual]);
    expect(ids((await getDayPlan('2026-09-23')).due)).toEqual([speaking]);
  });

  it('keeps v1’s «Ещё»: steps by last use, skills by last activity, empty groups dropped', async () => {
    const a = await createSkill(input('А'));
    const a1 = await createStep({ skillId: a, name: 'А1', points: 1 });
    const a2 = await createStep({ skillId: a, name: 'А2', points: 1 });
    const a3 = await createStep({ skillId: a, name: 'А3', points: 1 });
    const b = await createSkill(input('Б'));
    const b1 = await createStep({ skillId: b, name: 'Б1', points: 1 });
    await createSkill(input('Без действий'));
    toToday();
    await completeStep(a3, { date: MONDAY });
    await completeStep(a2, { date: '2026-09-22' });
    await completeStep(b1, { date: '2026-09-01' });

    const plan = await getDayPlan(TODAY);
    expect(plan.extra.map((g) => g.summary.skill.name)).toEqual(['Б', 'А']);
    expect(plan.extra[1]!.steps.map((s) => s.step.id)).toEqual([a2, a3, a1]);
    // Active skills without actions are still named for the empty state.
    expect(plan.skills.map((s) => s.skill.name)).toEqual(['Б', 'А', 'Без действий']);
  });

  it('counts the week per day for the strip, cancelled completions and the week before left out', async () => {
    const skillId = await createSkill(input('Английский'));
    const step = await createStep({ skillId, name: 'Чтение', points: 3 });
    toToday();
    await completeStep(step, { date: '2026-09-20' }); // Sunday of the week before
    await completeStep(step, { date: MONDAY });
    await completeStep(step, { date: MONDAY });
    const cancelled = await completeStep(step, { date: '2026-09-22' });
    await cancelCompletion(cancelled.completionId);
    await completeStep(step);

    const expected = [2, 0, 0, 1, 0, 0, 0];
    expect((await getDayPlan(TODAY)).weekActivity).toEqual(expected);
    // A past day of the week: the strip still shows the whole week.
    expect((await getDayPlan('2026-09-22')).weekActivity).toEqual(expected);
    expect(await getWeekActivity(MONDAY)).toEqual(expected);
    expect(await getWeekActivity('2026-09-14')).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it('plans a past date as it looked at its end and lists that date’s completions', async () => {
    const skillId = await createSkill(input('Английский'));
    const daily = await createStep({ skillId, name: 'Разговор', points: 5, schedule: { kind: 'DAILY' } });
    toToday();
    await completeStep(daily, { date: '2026-09-22' });

    const tuesday = await getDayPlan('2026-09-22');
    expect(tuesday.due).toEqual([]);
    expect(tuesday.done.map((d) => d.completion.date)).toEqual(['2026-09-22']);
    expect([tuesday.totalDone, tuesday.totalPlanned]).toEqual([1, 1]);
    const wednesday = await getDayPlan('2026-09-23');
    expect(ids(wednesday.due)).toEqual([daily]);
    expect(wednesday.done).toEqual([]);
  });
});
