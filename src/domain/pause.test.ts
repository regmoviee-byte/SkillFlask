import { describe, expect, it } from 'vitest';
import { History } from '../test/history';
import { evaluateAchievements } from './achievements/evaluate';
import { levelForecast } from './pace';
import { backOn, covers, isOver, latestPauseUntil, pausedDays, pausedDaysIn, pauseOn, pauseUntil, restDays, restedDaysIn, returnDue } from './pause';
import { computeProgress } from './progression';
import { weekRecap } from './recap';
import { computeRecords } from './records';
import { planForDate } from './schedule';
import { bestDayStreak, DayRecords, dayStreaks } from './streaks';
import type { Pause, StepDefinition } from './types';

const pause = (from: string, until: string | null, skillId = 's1', endedAt: string | null = null): Pause => ({
  id: `p-${skillId}-${from}`,
  skillId,
  from,
  until,
  createdAt: `${from}T09:00:00.000Z`,
  endedAt,
});

describe('pause intervals', () => {
  it('cover from..until, both days included; an open pause has no last day', () => {
    const week = pause('2026-09-21', '2026-09-27');
    expect(['2026-09-20', '2026-09-21', '2026-09-27', '2026-09-28'].map((d) => covers(week, d))).toEqual([false, true, true, false]);
    expect(covers(pause('2026-09-21', null), '2027-09-21')).toBe(true);
    expect(covers(pause('2026-09-21', null), '2026-09-20')).toBe(false);
  });

  it('give the lengths of the sheet from the first day: a week is seven days with today', () => {
    expect(pauseUntil('week', '2026-09-26')).toBe('2026-10-02');
    expect(pauseUntil('twoWeeks', '2026-09-26')).toBe('2026-10-09');
    expect(pauseUntil('month', '2026-09-26')).toBe('2026-10-25');
    // 31 January + a month is the end of February, the day before is the last day of rest.
    expect(pauseUntil('month', '2026-01-31')).toBe('2026-02-27');
    expect(pauseUntil('open', '2026-09-26')).toBeNull();
    expect(latestPauseUntil('2026-09-26')).toBe('2027-09-26');
  });

  it('find the pause of a skill on a date, and only of that skill', () => {
    const rows = [pause('2026-09-01', '2026-09-05'), pause('2026-09-10', null), pause('2026-09-03', '2026-09-04', 's2')];
    expect(pauseOn(rows, 's1', '2026-09-03')?.from).toBe('2026-09-01');
    expect(pauseOn(rows, 's1', '2026-09-07')).toBeNull();
    expect(pauseOn(rows, 's1', '2026-12-31')?.from).toBe('2026-09-10');
    expect(pauseOn(rows, 's2', '2026-09-05')).toBeNull();
    const paused = pausedDays(rows, 's2');
    expect(['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-10'].map(paused)).toEqual([false, true, true, false]);
  });

  it('end by themselves after the last day and are told once', () => {
    const ran = pause('2026-09-01', '2026-09-05');
    expect(isOver(ran, '2026-09-05')).toBe(false);
    expect(isOver(ran, '2026-09-06')).toBe(true);
    expect(returnDue(ran, '2026-09-06')).toBe(true);
    expect(returnDue({ ...ran, endedAt: '2026-09-06T08:00:00.000Z' }, '2026-09-06')).toBe(false);
    expect(isOver(pause('2026-09-01', null), '2030-01-01')).toBe(false);
    expect(backOn(ran)).toBe('2026-09-06');
    expect(backOn(pause('2026-09-01', null))).toBeNull();
  });

  it('count their days inside a week', () => {
    expect(pausedDaysIn(pause('2026-09-23', '2026-10-02'), '2026-09-21', '2026-09-27')).toBe(5);
    expect(pausedDaysIn(pause('2026-09-10', '2026-09-22'), '2026-09-21', '2026-09-27')).toBe(2);
    expect(pausedDaysIn(pause('2026-09-10', null), '2026-09-21', '2026-09-27')).toBe(7);
    expect(pausedDaysIn(pause('2026-09-28', null), '2026-09-21', '2026-09-27')).toBe(0);
  });
});

describe('rest days of the whole app', () => {
  const skill = (id: string, createdAt: string, extra: object = {}) => ({ id, createdAt, status: 'ACTIVE' as const, archivedAt: null, completedAt: null, ...extra });

  it('are the days on which every skill in progress was paused', () => {
    const skills = [skill('s1', '2026-09-01T09:00:00.000Z'), skill('s2', '2026-09-01T09:00:00.000Z')];
    const rest = restDays({ skills, pauses: [pause('2026-09-10', '2026-09-20', 's1'), pause('2026-09-15', null, 's2')] });
    // Only s1 rests on the 12th: s2 was in progress, the day is an ordinary one.
    expect(rest('2026-09-12')).toBe(false);
    expect(rest('2026-09-15')).toBe(true);
    expect(rest('2026-09-20')).toBe(true);
    expect(rest('2026-09-21')).toBe(false);
  });

  it('ignore skills that did not exist yet or were archived or completed before the day', () => {
    const rest = restDays({
      skills: [
        skill('s1', '2026-09-01T09:00:00.000Z'),
        skill('new', '2026-09-20T09:00:00.000Z'),
        skill('old', '2026-08-01T09:00:00.000Z', { status: 'ARCHIVED', archivedAt: '2026-09-05T09:00:00.000Z' }),
      ],
      pauses: [pause('2026-09-10', '2026-09-25', 's1')],
    });
    expect(rest('2026-09-15')).toBe(true);
    expect(rest('2026-09-20')).toBe(false);
  });

  it('are none without a pause, or without a skill in progress', () => {
    expect(restDays({ skills: [skill('s1', '2026-09-01T09:00:00.000Z')] })('2026-09-15')).toBe(false);
    expect(restDays({ skills: [], pauses: [pause('2026-09-10', null)] })('2026-09-15')).toBe(false);
  });
});

describe('day streaks across a pause', () => {
  const tueToThu = (date: string) => date >= '2026-09-22' && date <= '2026-09-24';

  it('neither break nor extend a run: active Mon, rest Tue–Thu, active Fri is two days', () => {
    expect(bestDayStreak(['2026-09-21', '2026-09-25'])).toBe(1);
    expect(bestDayStreak(['2026-09-21', '2026-09-25'], tueToThu)).toBe(2);
    expect(dayStreaks(['2026-09-20', '2026-09-21', '2026-09-25', '2026-09-26'], tueToThu)).toEqual([
      { length: 4, start: '2026-09-20', end: '2026-09-26' },
    ]);
  });

  it('break at a day without practice that was no rest', () => {
    // Saturday the 26th is neither practised nor paused.
    expect(bestDayStreak(['2026-09-21', '2026-09-25', '2026-09-27'], tueToThu)).toBe(2);
    // A rest stretch with an ordinary day inside does not bridge.
    const withHole = (date: string) => tueToThu(date) && date !== '2026-09-23';
    expect(bestDayStreak(['2026-09-21', '2026-09-25'], withHole)).toBe(1);
  });

  it('count a day of practice during a pause as a day of practice', () => {
    expect(bestDayStreak(['2026-09-21', '2026-09-23', '2026-09-25'], tueToThu)).toBe(3);
  });

  it('are kept incrementally the same way, whatever the order of the dates', () => {
    const dates = ['2026-09-25', '2026-09-19', '2026-09-21', '2026-09-20', '2026-09-28', '2026-09-26'];
    const records = new DayRecords(3, tueToThu);
    for (const date of dates) records.add(date);
    expect(records.bestDayStreak).toBe(bestDayStreak(dates, tueToThu));
    expect(records.bestDayStreak).toBe(5);
    expect(records.activeDays).toBe(6);
  });

  it('never walk into an open pause past the last date of practice', () => {
    const always = () => true;
    const records = new DayRecords(3, always);
    records.add('2026-09-21');
    records.add('2026-01-01');
    expect(records.bestDayStreak).toBe(2);
  });
});

describe('records, achievements and the recap with a pause', () => {
  function vacation() {
    const h = new History('2026-09-01T09:00:00.000Z');
    const skill = h.mkSkill({ capacity: 1000 });
    const step = h.mkStep(skill);
    for (const date of ['2026-09-19', '2026-09-20', '2026-09-21']) h.mkCompletion(step, date, `${date}T10:00:00.000Z`);
    for (const date of ['2026-09-25', '2026-09-26', '2026-09-27']) h.mkCompletion(step, date, `${date}T10:00:00.000Z`);
    return { h, skill };
  }

  it('bridge «Лучшая серия» over the paused days', () => {
    const { h, skill } = vacation();
    expect(computeRecords(h.snapshot()).bestStreak).toEqual({ days: 3, start: '2026-09-19', end: '2026-09-21' });
    h.mkPause(skill, '2026-09-22', '2026-09-24');
    expect(computeRecords(h.snapshot()).bestStreak).toEqual({ days: 6, start: '2026-09-19', end: '2026-09-27' });
  });

  it('open the streak ladder of the same length, never longer', () => {
    const { h, skill } = vacation();
    const series = (snapshot: ReturnType<History['snapshot']>) => evaluateAchievements(snapshot).filter((s) => s.def.ladderId === 'series' && s.unlocked).map((s) => s.target);
    expect(series(h.snapshot())).toEqual([3]);
    h.mkPause(skill, '2026-09-22', '2026-09-24');
    // Six days of practice: the 7-day tier needs one more, the rest days do not count.
    expect(series(h.snapshot())).toEqual([3]);
    h.mkCompletion(h.steps[0]!.id, '2026-09-28', '2026-09-28T10:00:00.000Z');
    expect(series(h.snapshot())).toEqual([3, 7]);
  });

  it('keep «Дни с практикой» and the rhythm weeks to practice only', () => {
    const { h, skill } = vacation();
    const days = (snapshot: ReturnType<History['snapshot']>) => evaluateAchievements(snapshot).filter((s) => s.def.ladderId === 'days' && s.unlocked).length;
    const before = days(h.snapshot());
    h.mkPause(skill, '2026-09-22', '2026-09-24');
    expect(days(h.snapshot())).toBe(before);
  });

  it('say which skill rested in the recap, up to today', () => {
    const { h, skill } = vacation();
    const other = h.mkSkill({ name: 'Бег' });
    h.mkPause(skill, '2026-09-22', '2026-09-24');
    h.mkPause(other, '2026-09-25', null);
    const recap = weekRecap(h.snapshot(), '2026-09-21', { today: '2026-09-26' });
    expect(recap.rested).toEqual([
      { skillId: skill, days: 3 },
      { skillId: other, days: 2 },
    ]);
    expect(weekRecap(h.snapshot(), '2026-09-21').rested.at(-1)).toEqual({ skillId: other, days: 3 });
    expect(weekRecap(h.snapshot(), '2026-09-14').rested).toEqual([]);
  });

  it('say nothing of a skill that was archived or completed: only its days in progress rested', () => {
    const { h, skill } = vacation();
    const other = h.mkSkill({ name: 'Бег' });
    h.mkPause(skill, '2026-09-22', null);
    h.mkPause(other, '2026-09-22', null);
    Object.assign(h.skills.find((s) => s.id === skill)!, { status: 'ARCHIVED', archivedAt: '2026-09-23T10:00:00.000Z' });
    Object.assign(h.skills.find((s) => s.id === other)!, { status: 'COMPLETED', completedAt: '2026-09-24T10:00:00.000Z' });
    expect(weekRecap(h.snapshot(), '2026-09-21').rested).toEqual([
      { skillId: skill, days: 2 },
      { skillId: other, days: 3 },
    ]);
    expect(weekRecap(h.snapshot(), '2026-09-28').rested).toEqual([]);
    expect(restedDaysIn(h.skills.find((s) => s.id === skill)!, [pause('2026-09-22', null)], '2026-10-05', '2026-10-11')).toBe(0);
  });
});

describe('the plan of a paused skill', () => {
  const step = (id: string, schedule: StepDefinition['schedule'], skillId = 's1'): StepDefinition => ({
    id,
    skillId,
    name: id,
    type: 'BOOLEAN',
    points: 5,
    pointsPerMinute: null,
    defaultMinutes: null,
    schedule,
    scheduleFrom: '2026-09-01',
    isActive: true,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  });
  const steps = [step('daily', { kind: 'DAILY' }), step('quota', { kind: 'TIMES_PER_WEEK', times: 3 }), step('other', { kind: 'DAILY' }, 's2')];
  // Monday the 21st done once, then Tuesday to Wednesday on pause.
  const isPaused = (skillId: string, date: string) => skillId === 's1' && date >= '2026-09-22' && date <= '2026-09-23';
  const completions = [{ stepId: 'quota', date: '2026-09-21', status: 'ACTIVE' as const }];

  it('has nothing on a paused day: no row, no quota — other skills as usual', () => {
    expect(planForDate(steps, completions, '2026-09-22', isPaused).map((i) => i.step.id)).toEqual(['other']);
  });

  it('keeps the whole target of a quota period paused only in part, with every completion of it', () => {
    const quota = planForDate(steps, completions, '2026-09-24', isPaused).find((i) => i.step.id === 'quota')!;
    expect(quota).toMatchObject({ target: 3, done: 1, state: 'DUE', period: { start: '2026-09-21', end: '2026-09-27' } });
  });

  it('never shows a quota period the skill rests through', () => {
    const allWeek = (skillId: string, date: string) => skillId === 's1' && date >= '2026-09-21' && date <= '2026-09-27';
    for (let d = 21; d <= 27; d++) expect(planForDate(steps, [], `2026-09-${d}`, allWeek).some((i) => i.step.skillId === 's1')).toBe(false);
  });
});

describe('the forecast of a paused skill', () => {
  const today = '2026-09-24';
  const progress = computeProgress(40, { base: 100, increment: 0, manual: [] });
  const completions = ['2026-09-10', '2026-09-12', '2026-09-14', '2026-09-16'].map((date, i) => ({ id: `c${i}`, date, status: 'ACTIVE' as const }));
  const transactions = completions.map((c) => ({ completionId: c.id, createdAt: `${c.date}T10:00:00.000Z`, delta: 10 }));

  it('leaves the paused days out of the pace', () => {
    const plain = levelForecast({ status: 'ACTIVE', progress, today, transactions, completions })!;
    const rested = levelForecast({ status: 'ACTIVE', progress, today, transactions, completions, excluded: (d) => d >= '2026-09-17' && d <= '2026-09-23' })!;
    expect(plain.pace.days).toBe(15);
    expect(rested.pace.days).toBe(8);
    expect(rested.pace.deci).toBe(plain.pace.deci);
    expect(rested.level.date < plain.level.date).toBe(true);
  });

  it('says nothing while the skill rests today', () => {
    expect(levelForecast({ status: 'ACTIVE', progress, today, transactions, completions, excluded: (d) => d >= '2026-09-24' })).toBeNull();
  });
});
