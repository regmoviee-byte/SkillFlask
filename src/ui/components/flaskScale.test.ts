import { describe, expect, it } from 'vitest';
import { scaleTicks } from './flaskScale';

const values = (capacity: number) => scaleTicks(capacity).map((t) => t.value);

describe('scaleTicks', () => {
  it('puts one to three ticks at round values', () => {
    expect(values(10)).toEqual([2.5, 5, 7.5]);
    expect(values(15)).toEqual([5, 10]);
    expect(values(20)).toEqual([5, 10, 15]);
    expect(values(25)).toEqual([10, 20]);
    expect(values(100)).toEqual([25, 50, 75]);
    expect(values(150)).toEqual([50, 100]);
    expect(values(1)).toEqual([0.5]);
    expect(values(2.5)).toEqual([1, 2]);
  });

  it('draws each tick at its share of the capacity, never right under the rim', () => {
    for (const capacity of [1, 3, 7, 10, 12, 15, 33, 99, 150, 1000, 12345.6]) {
      const ticks = scaleTicks(capacity);
      expect(ticks.length).toBeGreaterThanOrEqual(1);
      expect(ticks.length).toBeLessThanOrEqual(3);
      for (const t of ticks) {
        expect(t.share).toBeCloseTo(t.value / capacity);
        expect(t.share).toBeLessThanOrEqual(0.9);
        // Tenths at most, as points are stored.
        expect(Math.round(t.value * 10)).toBeCloseTo(t.value * 10);
      }
    }
  });

  it('has nothing to show for a flask of a tenth or less', () => {
    expect(scaleTicks(0.1)).toEqual([]);
    expect(scaleTicks(0)).toEqual([]);
  });
});
