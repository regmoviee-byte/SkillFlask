import { describe, expect, it } from 'vitest';
import { describeSchedule, isDueOn, isScheduledOn, periodOf, planForDate, ScheduleError, validateSchedule } from './schedule';
import type { StepCompletion, StepDefinition, StepSchedule } from './types';

// Runs in CI twice: in the default time zone and with TZ=America/Sao_Paulo (a negative offset
// that had DST), so nothing here may depend on the device zone.

let order = 0;
function step(schedule: StepSchedule, scheduleFrom = '2026-01-01', over: Partial<StepDefinition> = {}): StepDefinition {
  order += 1;
  const createdAt = `2026-01-01T00:00:${String(order % 60).padStart(2, '0')}.${String(order).padStart(3, '0')}Z`;
  return {
    id: `s${order}`,
    skillId: 'skill',
    name: `Действие ${order}`,
    type: 'BOOLEAN',
    points: 5,
    pointsPerMinute: null,
    defaultMinutes: null,
    schedule,
    scheduleFrom,
    isActive: true,
    createdAt,
    updatedAt: createdAt,
    ...over,
  };
}

type Facts = Pick<StepCompletion, 'stepId' | 'date' | 'status'>;
const done = (s: StepDefinition, ...dates: string[]): Facts[] => dates.map((date) => ({ stepId: s.id, date, status: 'ACTIVE' }));

describe('validateSchedule', () => {
  it('sorts and dedupes weekdays and rejects an empty set', () => {
    expect(validateSchedule({ kind: 'WEEKDAYS', days: [5, 1, 3, 1] })).toEqual({ kind: 'WEEKDAYS', days: [1, 3, 5] });
    expect(() => validateSchedule({ kind: 'WEEKDAYS', days: [] })).toThrow('Выберите хотя бы один день недели');
    expect(() => validateSchedule({ kind: 'WEEKDAYS', days: [0 as never] })).toThrow(ScheduleError);
  });

  it('accepts quotas from 1 to 31 and drops unknown fields', () => {
    expect(validateSchedule({ kind: 'TIMES_PER_MONTH', times: 31 })).toEqual({ kind: 'TIMES_PER_MONTH', times: 31 });
    expect(validateSchedule({ kind: 'DAILY', times: 3 } as never)).toEqual({ kind: 'DAILY' });
    for (const times of [0, 32, 2.5]) {
      expect(() => validateSchedule({ kind: 'TIMES_PER_WEEK', times })).toThrow('Количество повторов: от 1 до 31');
    }
    expect(() => validateSchedule({ kind: 'YEARLY' } as never)).toThrow(ScheduleError);
  });
});

describe('isDueOn', () => {
  it('counts Sunday as 7 and follows weekdays across a month boundary', () => {
    const monWedSun: StepSchedule = { kind: 'WEEKDAYS', days: [1, 3, 7] };
    // Mon 2026-09-28, Tue 29, Wed 30, Thu 1 Oct, …, Sun 4 Oct.
    const week = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    expect(week.map((d) => isDueOn(monWedSun, d, '2026-01-01'))).toEqual([true, false, true, false, false, false, true]);
  });

  it('never plans a date before scheduleFrom, MANUAL or a quota', () => {
    expect(isDueOn({ kind: 'DAILY' }, '2026-09-23', '2026-09-24')).toBe(false);
    expect(isDueOn({ kind: 'DAILY' }, '2026-09-24', '2026-09-24')).toBe(true);
    expect(isDueOn({ kind: 'MANUAL' }, '2026-09-24', '2026-01-01')).toBe(false);
    expect(isDueOn({ kind: 'TIMES_PER_WEEK', times: 3 }, '2026-09-24', '2026-01-01')).toBe(false);
  });

  it('marks completions of a quota period or a due date as scheduled', () => {
    expect(isScheduledOn({ schedule: { kind: 'TIMES_PER_MONTH', times: 2 }, scheduleFrom: '2026-09-01' }, '2026-09-24')).toBe(true);
    expect(isScheduledOn({ schedule: { kind: 'TIMES_PER_MONTH', times: 2 }, scheduleFrom: '2026-09-25' }, '2026-09-24')).toBe(false);
    expect(isScheduledOn({ schedule: { kind: 'WEEKDAYS', days: [4] }, scheduleFrom: '2026-01-01' }, '2026-09-24')).toBe(true);
    expect(isScheduledOn({ schedule: { kind: 'MANUAL' }, scheduleFrom: '2026-01-01' }, '2026-09-24')).toBe(false);
  });
});

describe('periodOf', () => {
  it('starts the week of a Sunday on the Monday before', () => {
    expect(periodOf({ kind: 'TIMES_PER_WEEK', times: 3 }, '2026-10-04')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(periodOf({ kind: 'TIMES_PER_WEEK', times: 3 }, '2026-09-28')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
  });

  it('spans February and 31-day months', () => {
    const monthly: StepSchedule = { kind: 'TIMES_PER_MONTH', times: 5 };
    expect(periodOf(monthly, '2026-02-14')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodOf(monthly, '2028-02-29')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(periodOf(monthly, '2026-01-31')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
    expect(periodOf(monthly, '2026-12-31')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('is null for schedules without a quota', () => {
    expect(periodOf({ kind: 'DAILY' }, '2026-09-24')).toBeNull();
    expect(periodOf({ kind: 'MANUAL' }, '2026-09-24')).toBeNull();
  });
});

describe('describeSchedule', () => {
  it('speaks Russian with plurals', () => {
    expect(describeSchedule({ kind: 'MANUAL' })).toBe('вручную');
    expect(describeSchedule({ kind: 'DAILY' })).toBe('каждый день');
    expect(describeSchedule({ kind: 'WEEKDAYS', days: [1, 3, 5] })).toBe('пн, ср, пт');
    expect(describeSchedule({ kind: 'WEEKDAYS', days: [1, 2, 3, 4, 5] })).toBe('по будням');
    expect(describeSchedule({ kind: 'WEEKDAYS', days: [6, 7] })).toBe('по выходным');
    expect(describeSchedule({ kind: 'TIMES_PER_WEEK', times: 1 })).toBe('1 раз в неделю');
    expect(describeSchedule({ kind: 'TIMES_PER_WEEK', times: 3 })).toBe('3 раза в неделю');
    expect(describeSchedule({ kind: 'TIMES_PER_MONTH', times: 5 })).toBe('5 раз в месяц');
    expect(describeSchedule({ kind: 'TIMES_PER_MONTH', times: 21 })).toBe('21 раз в месяц');
  });
});

describe('planForDate', () => {
  it('fills a 3-per-week quota with Mon/Tue/Thu: DUE on Wed, DONE on Thu and Fri', () => {
    const quota = step({ kind: 'TIMES_PER_WEEK', times: 3 });
    const completions = done(quota, '2026-09-21', '2026-09-22', '2026-09-24');
    const at = (date: string) => planForDate([quota], completions, date)[0]!;
    expect(at('2026-09-23')).toMatchObject({ state: 'DUE', done: 2, target: 3, period: { start: '2026-09-21', end: '2026-09-27' } });
    expect(at('2026-09-24')).toMatchObject({ state: 'DONE', done: 3 });
    expect(at('2026-09-25')).toMatchObject({ state: 'DONE', done: 3 });
    // The next week starts from zero.
    expect(at('2026-09-28')).toMatchObject({ state: 'DUE', done: 0, period: { start: '2026-09-28', end: '2026-10-04' } });
  });

  it('counts a quota beyond its target and ignores cancelled completions', () => {
    const quota = step({ kind: 'TIMES_PER_MONTH', times: 2 });
    const completions: Facts[] = [...done(quota, '2026-02-02', '2026-02-10', '2026-02-27'), { stepId: quota.id, date: '2026-02-28', status: 'CANCELLED' }];
    expect(planForDate([quota], completions, '2026-02-28')[0]).toMatchObject({ state: 'DONE', done: 3, target: 2 });
    expect(planForDate([quota], completions, '2026-03-01')[0]).toMatchObject({ state: 'DUE', done: 0, period: { start: '2026-03-01', end: '2026-03-31' } });
  });

  it('FR-TD-005: a Wednesday without the completion, a manual Thursday, the next Wednesday still planned', () => {
    const wednesdays = step({ kind: 'WEEKDAYS', days: [3] });
    const completions = done(wednesdays, '2026-09-24'); // Thursday, done by hand
    expect(planForDate([wednesdays], completions, '2026-09-23')).toMatchObject([{ state: 'DUE', done: 0 }]);
    expect(planForDate([wednesdays], completions, '2026-09-24')).toEqual([]);
    expect(planForDate([wednesdays], completions, '2026-09-30')).toMatchObject([{ state: 'DUE', done: 0, target: 1 }]);
  });

  it('plans a daily step from scheduleFrom on only', () => {
    const daily = step({ kind: 'DAILY' }, '2026-09-24');
    expect(planForDate([daily], [], '2026-09-23')).toEqual([]);
    expect(planForDate([daily], [], '2026-09-24')).toMatchObject([{ state: 'DUE' }]);
    const quota = step({ kind: 'TIMES_PER_WEEK', times: 2 }, '2026-09-24');
    expect(planForDate([quota], [], '2026-09-23')).toEqual([]);
  });

  it('never plans MANUAL or hidden steps and keeps a later completion out of a past date', () => {
    const manual = step({ kind: 'MANUAL' });
    const hidden = step({ kind: 'DAILY' }, '2026-01-01', { isActive: false });
    const daily = step({ kind: 'DAILY' });
    const plan = planForDate([manual, hidden, daily], done(daily, '2026-09-25'), '2026-09-24');
    expect(plan.map((p) => [p.step.id, p.state])).toEqual([[daily.id, 'DUE']]);
  });

  it('counts several completions on a due date and sorts DUE first, then by creation', () => {
    const a = step({ kind: 'DAILY' });
    const b = step({ kind: 'DAILY' });
    const c = step({ kind: 'TIMES_PER_WEEK', times: 1 });
    const plan = planForDate([c, b, a], [...done(a, '2026-09-24', '2026-09-24')], '2026-09-24');
    expect(plan.map((p) => [p.step.id, p.state, p.done])).toEqual([
      [b.id, 'DUE', 0],
      [c.id, 'DUE', 0],
      [a.id, 'DONE', 2],
    ]);
  });
});
