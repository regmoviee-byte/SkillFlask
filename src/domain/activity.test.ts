import { describe, expect, it } from 'vitest';
import { activityByDay, intensity, intensityScale, type DayActivity } from './activity';

const day = (date: string, points: number, completions = 1): DayActivity => ({ date, points, completions });

describe('activityByDay', () => {
  it('sums the ACTIVE completions of each date in the range, in tenths', () => {
    const days = activityByDay(
      [
        { date: '2026-09-01', status: 'ACTIVE', pointsAwarded: 0.1 },
        { date: '2026-09-01', status: 'ACTIVE', pointsAwarded: 0.2 },
        { date: '2026-09-01', status: 'CANCELLED', pointsAwarded: 50 },
        { date: '2026-09-02', status: 'CANCELLED', pointsAwarded: 5 },
        { date: '2026-08-31', status: 'ACTIVE', pointsAwarded: 5 },
        { date: '2026-09-10', status: 'ACTIVE', pointsAwarded: 5 },
      ],
      '2026-09-01',
      '2026-09-09',
    );
    expect([...days.values()]).toEqual([{ date: '2026-09-01', points: 0.3, completions: 2 }]);
  });
});

describe('intensity', () => {
  it('buckets the days by the quartiles of the days with points; the best day is the deepest', () => {
    const days = [1, 2, 3, 4, 5, 6, 7, 8].map((p, i) => day(`2026-09-0${i + 1}`, p));
    const scale = intensityScale(days)!;
    expect(scale).toEqual({ q1: 2, q2: 4, q3: 6, max: 8 });
    expect(days.map((d) => intensity(d, scale))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('is relative: a light skill shows the same contrast as a heavy one', () => {
    const light = [1, 2, 3, 4].map((p, i) => day(`2026-09-0${i + 1}`, p));
    const heavy = [100, 200, 300, 400].map((p, i) => day(`2026-09-0${i + 1}`, p));
    const levels = (days: DayActivity[]) => days.map((d) => intensity(d, intensityScale(days)));
    expect(levels(light)).toEqual([1, 2, 3, 4]);
    expect(levels(heavy)).toEqual([1, 2, 3, 4]);
  });

  it('draws equal days all as the best day, and one outlier apart from the rest', () => {
    const even = [10, 10, 10].map((p, i) => day(`2026-09-0${i + 1}`, p));
    expect(even.map((d) => intensity(d, intensityScale(even)))).toEqual([4, 4, 4]);
    const outlier = [5, 5, 5, 100].map((p, i) => day(`2026-09-0${i + 1}`, p));
    expect(outlier.map((d) => intensity(d, intensityScale(outlier)))).toEqual([1, 1, 1, 4]);
  });

  it('is 0 without a completion, 1 for a day of practice worth 0 points', () => {
    const scale = intensityScale([day('2026-09-01', 10)]);
    expect(intensity(undefined, scale)).toBe(0);
    expect(intensity(day('2026-09-02', 0), scale)).toBe(1);
    expect(intensity(day('2026-09-02', 0), intensityScale([day('2026-09-02', 0)]))).toBe(1);
    expect(intensityScale([])).toBeNull();
  });
});
