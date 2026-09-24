import { describe, expect, it } from 'vitest';
import * as streaks from './streaks';
import { activeDates, bestDayStreak, DayRecords, dayNumber, dayStreaks, weekKey, weeksWithAtLeast } from './streaks';

describe('activeDates', () => {
  it('keeps distinct dates of ACTIVE completions, oldest first', () => {
    const c = (date: string, status = 'ACTIVE') => ({ date, status });
    expect(activeDates([c('2026-09-03'), c('2026-09-01'), c('2026-09-03'), c('2026-09-02', 'CANCELLED')])).toEqual([
      '2026-09-01',
      '2026-09-03',
    ]);
  });
});

describe('dayStreaks', () => {
  it('splits at gaps and ignores order and duplicates', () => {
    expect(dayStreaks(['2026-09-05', '2026-09-01', '2026-09-02', '2026-09-02', '2026-09-04'])).toEqual([
      { length: 2, start: '2026-09-01', end: '2026-09-02' },
      { length: 2, start: '2026-09-04', end: '2026-09-05' },
    ]);
    expect(dayStreaks([])).toEqual([]);
  });

  it('runs across a month and a year boundary', () => {
    expect(dayStreaks(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'])).toEqual([
      { length: 4, start: '2025-12-30', end: '2026-01-02' },
    ]);
    expect(bestDayStreak(['2026-02-27', '2026-02-28', '2026-03-01'])).toBe(3);
  });
});

describe('bestDayStreak', () => {
  it('is the longest run ever, not the latest', () => {
    expect(bestDayStreak(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10'])).toBe(3);
    expect(bestDayStreak(['2026-09-10'])).toBe(1);
    expect(bestDayStreak([])).toBe(0);
  });

  it('has no «current streak» sibling', () => {
    expect(Object.keys(streaks).filter((name) => /current/i.test(name))).toEqual([]);
  });
});

describe('weeks', () => {
  it('names a week by its Monday, also across the year boundary', () => {
    expect(weekKey('2026-09-24')).toBe('2026-09-21'); // Thursday
    expect(weekKey('2026-09-27')).toBe('2026-09-21'); // Sunday
    expect(weekKey('2026-09-28')).toBe('2026-09-28'); // Monday
    expect(weekKey('2026-01-01')).toBe('2025-12-29');
  });

  it('counts distinct days per week: three completions on one date are one day', () => {
    const oneDay = ['2026-09-21', '2026-09-21', '2026-09-21'];
    expect(weeksWithAtLeast(oneDay)).toEqual([]);
    expect(weeksWithAtLeast([...oneDay, '2026-09-23', '2026-09-27'])).toEqual(['2026-09-21']);
  });

  it('lists every qualifying week, with gaps between them', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-15', '2026-09-16', '2026-09-20', '2026-09-08'];
    expect(weeksWithAtLeast(dates)).toEqual(['2026-08-31', '2026-09-14']);
    expect(weeksWithAtLeast(dates, 1)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14']);
  });

  it('puts a week that spans New Year together', () => {
    expect(weeksWithAtLeast(['2025-12-29', '2025-12-31', '2026-01-02'])).toEqual(['2025-12-29']);
  });
});

describe('DayRecords', () => {
  it('numbers consecutive dates consecutively, across months, years and leap days', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2024-03-01') - dayNumber('2024-02-28')).toBe(2);
    expect(dayNumber('2026-01-01') - dayNumber('2025-12-31')).toBe(1);
  });

  it('keeps the records incrementally: a repeated date changes nothing, backfilled days join runs', () => {
    const records = new DayRecords();
    for (const date of ['2025-12-29', '2025-12-31', '2025-12-31', '2026-01-02']) records.add(date);
    expect(records).toMatchObject({ activeDays: 3, bestDayStreak: 1, rhythmWeeks: 1 });
    records.add('2026-01-01');
    records.add('2025-12-30');
    expect(records).toMatchObject({ activeDays: 5, bestDayStreak: 5, rhythmWeeks: 1 });
  });
});
