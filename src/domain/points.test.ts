import { describe, expect, it } from 'vitest';
import { fromDeci, isPoints, timedPoints, toDeci } from './points';

describe('deci-points', () => {
  it('round-trips tenths exactly', () => {
    expect(toDeci(0.1)).toBe(1);
    expect(toDeci(99.9)).toBe(999);
    expect(fromDeci(toDeci(0.1) + toDeci(0.2))).toBe(0.3);
    expect(fromDeci(1000)).toBe(100);
  });

  it('validates points', () => {
    expect(isPoints(5)).toBe(true);
    expect(isPoints(0)).toBe(true);
    expect(isPoints(2.5)).toBe(true);
    expect(isPoints(2.55)).toBe(false);
    expect(isPoints(-1)).toBe(false);
    expect(isPoints(NaN)).toBe(false);
    expect(isPoints(Infinity)).toBe(false);
    expect(isPoints('5')).toBe(false);
  });
});

describe('timedPoints', () => {
  it.each([
    [25, 0.25, 6.3],
    [7, 0.33, 2.3],
    [1, 0.05, 0.1],
    [3, 0.15, 0.5],
    [45, 1, 45],
    [1, 0.04, 0],
    [20, 0.5, 10],
  ])('%i min × %d/min → %d', (minutes, rate, expected) => {
    expect(timedPoints(minutes, rate)).toBe(expected);
  });
});
