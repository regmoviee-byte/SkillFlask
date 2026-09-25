import { describe, expect, it } from 'vitest';
import { History } from '../test/history';
import { weekRecap } from './recap';

// Weeks of September 2026: Monday the 7th, 14th, 21st.

describe('weekRecap — totals', () => {
  it('counts points, active days, completions and the dots of Monday..Sunday only', () => {
    const h = new History();
    const a = h.mkStep(h.mkSkill({ capacity: 1000 }), 5);
    const b = h.mkStep(h.mkSkill({ capacity: 1000 }), 2.5);
    h.mkCompletion(a, '2026-09-13'); // Sunday before
    h.mkCompletion(a, '2026-09-14'); // Monday
    h.mkCompletion(b, '2026-09-14');
    h.mkCompletion(b, '2026-09-16');
    h.mkCompletion(a, '2026-09-20'); // Sunday
    h.mkCompletion(a, '2026-09-21'); // Monday after
    const recap = weekRecap(h.snapshot(), '2026-09-17'); // any date of the week
    expect(recap).toMatchObject({ weekStart: '2026-09-14', weekEnd: '2026-09-20', points: 15, activeDays: 3, completions: 4 });
    expect(recap.days).toEqual([true, false, true, false, false, false, true]);
  });

  it('keeps a week across a month and a year boundary together', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    h.mkCompletion(step, '2025-12-29');
    h.mkCompletion(step, '2026-01-01');
    h.mkCompletion(step, '2026-01-05');
    const recap = weekRecap(h.snapshot(), '2025-12-29');
    expect(recap).toMatchObject({ weekStart: '2025-12-29', weekEnd: '2026-01-04', points: 20, activeDays: 2 });
    expect(weekRecap(h.snapshot(), '2025-09-29')).toMatchObject({ weekStart: '2025-09-29', points: 0, completions: 0, topSkill: null, topAction: null });
  });

  it('leaves cancelled completions out', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    h.mkCompletion(step, '2026-09-14');
    h.cancel(h.mkCompletion(step, '2026-09-15'));
    expect(weekRecap(h.snapshot(), '2026-09-14')).toMatchObject({ points: 10, activeDays: 1, completions: 1 });
  });
});

describe('weekRecap — flasks and milestones', () => {
  it('counts the fills of the week net of rollbacks, and the milestones still reached', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 10, milestone: 2 });
    const step = h.mkStep(skill, 10);
    h.mkCompletion(step, '2026-09-10'); // flask 1, the week before
    h.mkCompletion(step, '2026-09-15'); // flask 2 and the milestone
    const third = h.mkCompletion(step, '2026-09-16'); // flask 3
    let recap = weekRecap(h.snapshot(), '2026-09-14');
    expect(recap.flasksFilled).toBe(2);
    expect(recap.milestones).toEqual([{ skillId: skill, name: 'Веха', date: '2026-09-15' }]);
    expect(weekRecap(h.snapshot(), '2026-09-07').flasksFilled).toBe(1);

    h.cancel(third);
    recap = weekRecap(h.snapshot(), '2026-09-14');
    expect(recap.flasksFilled).toBe(1);

    // Cancelling the flask-2 completion gives the milestone back: the week no longer lists it.
    h.cancel(h.completions.find((c) => c.date === '2026-09-15')!);
    recap = weekRecap(h.snapshot(), '2026-09-14');
    expect(recap.flasksFilled).toBe(0);
    expect(recap.milestones).toEqual([]);
  });
});

describe('weekRecap — best of the week', () => {
  it('names the skill with the most points and the action done most often; ties go to the first', () => {
    const h = new History();
    const english = h.mkSkill({ capacity: 1000 });
    const talk = h.mkStep(english, 5);
    const read = h.mkStep(english, 20);
    const sport = h.mkSkill({ capacity: 1000 });
    const run = h.mkStep(sport, 10);
    h.mkCompletion(run, '2026-09-14');
    h.mkCompletion(run, '2026-09-15');
    h.mkCompletion(talk, '2026-09-15');
    h.mkCompletion(talk, '2026-09-16');
    h.mkCompletion(read, '2026-09-17');
    h.steps.find((s) => s.id === talk)!.name = 'Разговорная практика';
    const recap = weekRecap(h.snapshot(), '2026-09-14');
    // 30 points against 20; two runs tie two talks, and the runs came first.
    expect(recap.topSkill).toEqual({ skillId: english, points: 30 });
    expect(recap.topAction).toEqual({ stepId: run, skillId: sport, name: h.steps.find((s) => s.id === run)!.name, count: 2 });

    h.mkCompletion(read, '2026-09-18');
    h.mkCompletion(talk, '2026-09-19');
    expect(weekRecap(h.snapshot(), '2026-09-14').topAction).toEqual({ stepId: talk, skillId: english, name: 'Разговорная практика', count: 3 });
  });

  it('breaks a tie of skills by who got there first', () => {
    const h = new History();
    const a = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    const b = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    h.mkCompletion(b, '2026-09-15');
    h.mkCompletion(a, '2026-09-16');
    expect(weekRecap(h.snapshot(), '2026-09-14').topSkill).toEqual({ skillId: h.skills[1]!.id, points: 10 });
  });
});

describe('weekRecap — records set in the week', () => {
  it('lists none in the week of the first completion, then the records the week holds', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 10 });
    const step = h.mkStep(skill, 5);
    h.mkCompletion(step, '2026-09-08');
    h.mkCompletion(step, '2026-09-09'); // flask 1
    expect(weekRecap(h.snapshot(), '2026-09-07').records).toEqual([]);

    h.mkCompletion(step, '2026-09-14');
    h.mkCompletion(step, '2026-09-14'); // flask 2, and the best day
    h.mkCompletion(step, '2026-09-15');
    h.mkTimed(step, 40, '2026-09-16');
    const recap = weekRecap(h.snapshot(), '2026-09-14');
    expect(recap.records).toEqual(['bestDay', 'bestWeek', 'mostCompletions', 'bestStreak', 'longestSession', 'fastestFlask']);
    // The week before no longer holds any of them.
    expect(weekRecap(h.snapshot(), '2026-09-07').records).toEqual([]);
  });

  it('gives a record back to the week before when the completion that set it is cancelled', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    h.mkCompletion(step, '2026-09-01');
    h.mkCompletion(step, '2026-09-08');
    h.mkCompletion(step, '2026-09-08');
    h.mkCompletion(step, '2026-09-15');
    const extra = h.mkCompletion(step, '2026-09-15');
    const third = h.mkCompletion(step, '2026-09-15');
    expect(weekRecap(h.snapshot(), '2026-09-14').records).toContain('bestDay');
    h.cancel(third);
    h.cancel(extra);
    expect(weekRecap(h.snapshot(), '2026-09-14').records).not.toContain('bestDay');
    expect(weekRecap(h.snapshot(), '2026-09-07').records).toContain('bestDay');
  });
});

describe('weekRecap — achievements of the week', () => {
  it('lists what was earned during the week by the moment it was earned', () => {
    // Writes on Monday the 14th, 09:00 UTC onwards.
    const h = new History('2026-09-14T09:00:00.000Z');
    const step = h.mkStep(h.mkSkill());
    // Backdated to the week before, logged this week: «Первое действие» belongs to this week.
    const first = h.mkCompletion(step, '2026-09-10');
    const ids = (week: string) => weekRecap(h.snapshot(), week).achievements.map((s) => s.def.id);
    expect(ids('2026-09-14')).toEqual(['first-skill', 'first-step']);
    expect(ids('2026-09-07')).toEqual([]);
    expect(weekRecap(h.snapshot(), '2026-09-14').achievements[1]!.unlockedAt).toBe(first.createdAt);
    h.cancel(first);
    expect(ids('2026-09-14')).toEqual(['first-skill']);
  });
});

describe('weekRecap — comparisons only in the user’s favour', () => {
  const build = (before: number, now: number, beforeDays = before, nowDays = now) => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    for (let i = 0; i < before; i++) h.mkCompletion(step, `2026-09-0${7 + (i % Math.max(1, beforeDays))}`);
    for (let i = 0; i < now; i++) h.mkCompletion(step, `2026-09-1${4 + (i % Math.max(1, nowDays))}`);
    return weekRecap(h.snapshot(), '2026-09-14');
  };

  it('says «больше» only when the week had more than a week with something in it', () => {
    expect(build(2, 3)).toMatchObject({ morePointsThanWeekBefore: true, moreDaysThanWeekBefore: true });
    expect(build(3, 3)).toMatchObject({ morePointsThanWeekBefore: false, moreDaysThanWeekBefore: false });
    expect(build(3, 2)).toMatchObject({ morePointsThanWeekBefore: false, moreDaysThanWeekBefore: false });
    // More points on fewer days: only the points are in favour.
    expect(build(2, 4, 2, 1)).toMatchObject({ morePointsThanWeekBefore: true, moreDaysThanWeekBefore: false });
    // Nothing the week before: nothing to compare with.
    expect(build(0, 3)).toMatchObject({ morePointsThanWeekBefore: false, moreDaysThanWeekBefore: false });
    expect(Object.keys(build(2, 3)).filter((key) => /less|fewer|worse/i.test(key))).toEqual([]);
  });
});
