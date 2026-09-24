import { describe, expect, it } from 'vitest';
import { FLASKS, FLASKS_OF, formatDelta, formatPoints, plural } from './format';

describe('plural', () => {
  it('declines flasks as a subject', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, FLASKS))).toEqual(['колба', 'колбы', 'колб', 'колб', 'колба', 'колбы']);
  });

  it('declines flasks after «из»', () => {
    expect([1, 2, 3, 5, 11, 21].map((n) => `из ${n} ${plural(n, FLASKS_OF)}`)).toEqual([
      'из 1 колбы',
      'из 2 колб',
      'из 3 колб',
      'из 5 колб',
      'из 11 колб',
      'из 21 колбы',
    ]);
  });
});

describe('formatting', () => {
  it('formats points and deltas with tenths', () => {
    expect(formatPoints(6.3)).toBe('6,3 очка');
    expect(formatPoints(1)).toBe('1 очко');
    expect(formatDelta(-2.5)).toBe('−2,5');
    expect(formatDelta(0)).toBe('0');
  });
});
