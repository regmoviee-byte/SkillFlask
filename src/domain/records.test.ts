import { describe, expect, it } from 'vitest';
import { History } from '../test/history';
import { buildEvents } from './achievements/events';
import { computeRecords, flaskFills, recordDate } from './records';
import { activeDates, bestDayStreak } from './streaks';

describe('computeRecords — empty and simple journals', () => {
  it('has no record on an empty journal', () => {
    const h = new History();
    h.mkStep(h.mkSkill());
    expect(computeRecords(h.snapshot())).toEqual({
      bestDay: null,
      bestDayBySkill: [],
      bestWeek: null,
      mostCompletions: null,
      bestStreak: null,
      longestSession: null,
      fastestFlask: null,
    });
  });

  it('adds the points of every skill on a date for «Лучший день», and keeps one per skill', () => {
    const h = new History();
    const a = h.mkStep(h.mkSkill({ capacity: 1000 }), 5);
    const b = h.mkStep(h.mkSkill({ capacity: 1000 }), 20);
    h.mkCompletion(a, '2026-09-02');
    h.mkCompletion(a, '2026-09-02');
    h.mkCompletion(b, '2026-09-02');
    h.mkCompletion(b, '2026-09-03');
    h.mkCompletion(a, '2026-09-04');
    const records = computeRecords(h.snapshot());
    expect(records.bestDay).toEqual({ date: '2026-09-02', points: 30 });
    const [skillA, skillB] = h.skills.map((s) => s.id);
    // Most points first; a tie within a skill goes to its earliest date.
    expect(records.bestDayBySkill).toEqual([
      { skillId: skillB, date: '2026-09-02', points: 20 },
      { skillId: skillA, date: '2026-09-02', points: 10 },
    ]);
    expect(records.mostCompletions).toEqual({ date: '2026-09-02', count: 3 });
  });

  it('adds tenths exactly (deci arithmetic)', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }));
    for (const points of [0.1, 0.2, 99.7]) {
      const c = h.mkTimed(step, 1, '2026-09-05');
      Object.assign(c, { pointsAwarded: points });
      h.transactions.at(-1)!.delta = points;
    }
    expect(computeRecords(h.snapshot()).bestDay).toEqual({ date: '2026-09-05', points: 100 });
  });

  it('gives a tie to the earliest date', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 5);
    // Written in reverse calendar order: the tie still goes to the earlier date.
    h.mkCompletion(step, '2026-09-10');
    h.mkCompletion(step, '2026-09-11');
    h.mkCompletion(step, '2026-09-03');
    h.mkCompletion(step, '2026-09-04');
    const records = computeRecords(h.snapshot());
    expect(records.bestDay).toEqual({ date: '2026-09-03', points: 5 });
    expect(records.mostCompletions).toEqual({ date: '2026-09-03', count: 1 });
    // Two two-day runs: the earlier one is the record.
    expect(records.bestStreak).toEqual({ days: 2, start: '2026-09-03', end: '2026-09-04' });
  });

  it('has no «Лучшая серия» below two days in a row', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 5);
    h.mkCompletion(step, '2026-09-03');
    h.mkCompletion(step, '2026-09-05');
    expect(computeRecords(h.snapshot()).bestStreak).toBeNull();
    h.mkCompletion(step, '2026-09-06');
    expect(computeRecords(h.snapshot()).bestStreak).toEqual({ days: 2, start: '2026-09-05', end: '2026-09-06' });
  });
});

describe('computeRecords — weeks', () => {
  it('splits weeks between Sunday and Monday', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    h.mkCompletion(step, '2026-09-13'); // Sunday
    h.mkCompletion(step, '2026-09-13');
    h.mkCompletion(step, '2026-09-14'); // Monday
    h.mkCompletion(step, '2026-09-20'); // Sunday of the same week
    h.mkCompletion(step, '2026-09-20');
    const records = computeRecords(h.snapshot());
    expect(records.bestWeek).toEqual({ weekStart: '2026-09-14', points: 30 });
    expect(recordDate(records, 'bestWeek')).toBe('2026-09-14');
  });

  it('keeps a week across a month and a year boundary together', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    h.mkCompletion(step, '2025-12-27'); // Saturday of the week before
    h.mkCompletion(step, '2025-12-31');
    h.mkCompletion(step, '2026-01-01');
    h.mkCompletion(step, '2026-01-04'); // Sunday
    expect(computeRecords(h.snapshot()).bestWeek).toEqual({ weekStart: '2025-12-29', points: 30 });
  });

  it('gives a tie between weeks to the earlier one', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    h.mkCompletion(step, '2026-09-16');
    h.mkCompletion(step, '2026-09-08');
    expect(computeRecords(h.snapshot()).bestWeek).toEqual({ weekStart: '2026-09-07', points: 10 });
  });
});

describe('computeRecords — cancellations', () => {
  it('lowers «Лучший день», «Лучшая неделя» and «Больше всего действий» when their completion is cancelled', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }), 10);
    h.mkCompletion(step, '2026-09-02');
    h.mkCompletion(step, '2026-09-09');
    const extra = h.mkCompletion(step, '2026-09-09');
    let records = computeRecords(h.snapshot());
    expect(records.bestDay).toEqual({ date: '2026-09-09', points: 20 });
    expect(records.mostCompletions).toEqual({ date: '2026-09-09', count: 2 });
    h.cancel(extra);
    records = computeRecords(h.snapshot());
    expect(records.bestDay).toEqual({ date: '2026-09-02', points: 10 });
    expect(records.bestWeek).toEqual({ weekStart: '2026-08-31', points: 10 });
    expect(records.mostCompletions).toEqual({ date: '2026-09-02', count: 1 });
  });

  it('takes «Лучшая серия» from bestDayStreak and shortens it when a day in the run is cancelled', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }));
    for (const date of ['2026-09-01', '2026-09-02', '2026-09-05', '2026-09-06', '2026-09-07']) h.mkCompletion(step, date);
    const middle = h.completions.find((c) => c.date === '2026-09-06')!;
    let records = computeRecords(h.snapshot());
    expect(records.bestStreak).toEqual({ days: 3, start: '2026-09-05', end: '2026-09-07' });
    expect(records.bestStreak!.days).toBe(bestDayStreak(activeDates(h.completions)));
    h.cancel(middle);
    records = computeRecords(h.snapshot());
    // Two runs of two days: the earlier one.
    expect(records.bestStreak).toEqual({ days: 2, start: '2026-09-01', end: '2026-09-02' });
  });
});

describe('computeRecords — «Самое длинное занятие»', () => {
  it('is the longest ACTIVE timed completion, with its current minutes', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 1000 });
    const step = h.mkStep(skill);
    h.mkCompletion(step, '2026-09-01');
    expect(computeRecords(h.snapshot()).longestSession).toBeNull();
    const short = h.mkTimed(step, 30, '2026-09-02');
    const long = h.mkTimed(step, 90, '2026-09-03');
    expect(computeRecords(h.snapshot()).longestSession).toEqual({ minutes: 90, date: '2026-09-03', skillId: skill, stepName: long.stepName });
    h.cancel(long);
    expect(computeRecords(h.snapshot()).longestSession).toMatchObject({ minutes: 30, date: '2026-09-02' });
    h.correct(short, 45);
    expect(computeRecords(h.snapshot()).longestSession).toMatchObject({ minutes: 45 });
    // A tie goes to the earlier date.
    h.mkTimed(step, 45, '2026-09-01');
    expect(computeRecords(h.snapshot()).longestSession).toMatchObject({ minutes: 45, date: '2026-09-01' });
  });
});

describe('computeRecords — «Самая быстрая колба»', () => {
  it('counts the days between the fills of consecutive flasks, from flask 2 on', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 10 });
    const step = h.mkStep(skill, 5);
    h.mkCompletion(step, '2026-09-01');
    h.mkCompletion(step, '2026-09-03'); // flask 1 filled
    expect(computeRecords(h.snapshot()).fastestFlask).toBeNull();
    h.mkCompletion(step, '2026-09-04');
    h.mkCompletion(step, '2026-09-08'); // flask 2: 5 days after flask 1
    h.mkCompletion(step, '2026-09-09');
    h.mkCompletion(step, '2026-09-10'); // flask 3: 2 days after flask 2
    expect(computeRecords(h.snapshot()).fastestFlask).toEqual({ days: 2, flask: 3, date: '2026-09-10', skillId: skill });
  });

  it('forgets a fill a cancellation gave back, and dates the refill anew', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 10 });
    const step = h.mkStep(skill, 5);
    h.mkCompletion(step, '2026-09-01');
    h.mkCompletion(step, '2026-09-01'); // flask 1
    h.mkCompletion(step, '2026-09-02');
    const fill = h.mkCompletion(step, '2026-09-02'); // flask 2, one day later
    expect(computeRecords(h.snapshot()).fastestFlask).toMatchObject({ days: 1, flask: 2 });
    h.cancel(fill);
    expect(computeRecords(h.snapshot()).fastestFlask).toBeNull();
    h.mkCompletion(step, '2026-09-06');
    expect(computeRecords(h.snapshot()).fastestFlask).toEqual({ days: 5, flask: 2, date: '2026-09-06', skillId: skill });
    expect(flaskFills(buildEvents(h.snapshot())).map((f) => [f.flask, f.date])).toEqual([
      [1, '2026-09-01'],
      [2, '2026-09-06'],
    ]);
  });

  it('counts a completion that fills two flasks as the same day, and compares skills', () => {
    const h = new History();
    const slow = h.mkSkill({ capacity: 10 });
    const slowStep = h.mkStep(slow, 10);
    h.mkCompletion(slowStep, '2026-09-01');
    h.mkCompletion(slowStep, '2026-09-03');
    const quick = h.mkSkill({ capacity: 10 });
    h.mkCompletion(h.mkStep(quick, 25), '2026-09-05');
    expect(computeRecords(h.snapshot()).fastestFlask).toEqual({ days: 0, flask: 2, date: '2026-09-05', skillId: quick });
  });

  it('skips a pair filled out of calendar order by a backdated completion', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 10 });
    const step = h.mkStep(skill, 10);
    h.mkCompletion(step, '2026-09-10'); // flask 1
    h.mkCompletion(step, '2026-09-04'); // flask 2, backdated before flask 1: no record
    expect(computeRecords(h.snapshot()).fastestFlask).toBeNull();
    h.mkCompletion(step, '2026-09-13'); // flask 3: 9 days after flask 2, the next valid pair
    expect(computeRecords(h.snapshot()).fastestFlask).toEqual({ days: 9, flask: 3, date: '2026-09-13', skillId: skill });
  });
});
