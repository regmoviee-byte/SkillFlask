import { describe, expect, it } from 'vitest';
import { THEME_TEXT } from '../ui/progress/texts';
import { formatDelta, formatMinutes, formatPoints, formatRate, parseDecimal, plural } from './format';

describe('plural', () => {
  // The flask's level nouns (every theme's are checked in copy.test.ts).
  const { levelForms, levelFormsOf } = THEME_TEXT.flask;

  it('declines flasks as a subject', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, levelForms))).toEqual(['колба', 'колбы', 'колб', 'колб', 'колба', 'колбы']);
  });

  it('declines flasks after «из»', () => {
    expect([1, 2, 3, 5, 11, 21].map((n) => `из ${n} ${plural(n, levelFormsOf)}`)).toEqual([
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

  it('formats a rate with up to two decimals and minutes', () => {
    expect(formatRate(0.5)).toBe('0,5/мин');
    expect(formatRate(0.25)).toBe('0,25/мин');
    expect(formatRate(2)).toBe('2/мин');
    expect(formatMinutes(30)).toBe('30 мин');
    expect(formatMinutes(1440)).toBe('1440 мин');
  });
});

describe('parseDecimal', () => {
  it('accepts a comma or a dot', () => {
    expect(parseDecimal('0,5')).toBe(0.5);
    expect(parseDecimal('0.25')).toBe(0.25);
    expect(parseDecimal(' 2 ')).toBe(2);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal('1,')).toBe(1);
  });

  it('rejects anything else', () => {
    for (const text of ['', ' ', 'abc', '1,2,3', '-1', '1e3', '0,5 мин']) expect(parseDecimal(text), text).toBeNull();
  });
});
