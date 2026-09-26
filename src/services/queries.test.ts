import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock } from '../test/harness';
import { cancelCompletion, completeStep } from './completions';
import { archiveSkill } from './lifecycle';
import { getHomeView, hasActiveSteps, weekDates } from './queries';
import { createSkill, type SkillInput } from './skills';
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

    expect((await getHomeView(TODAY)).weekActivity).toEqual([true, false, false, true, false, false, false]);
    expect((await getHomeView('2026-09-28')).weekActivity).toEqual(Array(7).fill(false));
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
      weekRest: Array(7).fill(false),
      totalFlasks: 0,
      lastMilestone: null,
      lastWeek: null,
      achievements: { last: null, next: expect.objectContaining({ current: 0, target: 1 }) },
    });
    expect((await getHomeView(TODAY)).achievements.next?.def.id).toBe('first-skill');
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
