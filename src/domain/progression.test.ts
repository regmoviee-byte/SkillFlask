import { describe, expect, it } from 'vitest';
import { buildTimeline, computeProgress, flaskCapacity, foldJournal, nextBalance, pointsToFill, type CapacityConfig } from './progression';

const linear: CapacityConfig = { base: 100, increment: 50, manual: [] };
const flat100: CapacityConfig = { base: 100, increment: 0, manual: [] };

describe('flaskCapacity', () => {
  it('grows linearly from the base', () => {
    expect([1, 2, 3, 4, 5].map((n) => flaskCapacity(n, linear))).toEqual([100, 150, 200, 250, 300]);
  });

  it('uses manual thresholds first, then continues linearly from the last one', () => {
    const config: CapacityConfig = { base: 100, increment: 10, manual: [20, 30, 40] };
    expect([1, 2, 3, 4, 5].map((n) => flaskCapacity(n, config))).toEqual([20, 30, 40, 50, 60]);
  });

  it('supports constant capacity', () => {
    expect(flaskCapacity(7, flat100)).toBe(100);
  });
});

describe('foldJournal', () => {
  it('sums deltas and never goes below zero', () => {
    expect(foldJournal([5, 10, -3])).toBe(12);
    expect(foldJournal([5, -10])).toBe(0);
    expect(foldJournal([])).toBe(0);
  });

  it('clamps after every step, not only at the end', () => {
    expect(foldJournal([5, -10, 5])).toBe(5);
    expect(nextBalance(0, -3)).toBe(0);
  });

  it('adds tenths exactly', () => {
    expect(foldJournal(Array.from({ length: 1000 }, () => 0.1))).toBe(100);
    expect(foldJournal([99.9, 0.1])).toBe(100);
  });
});

describe('computeProgress', () => {
  it('starts on flask 1 with zero points', () => {
    expect(computeProgress(0, linear)).toEqual({
      totalPoints: 0,
      completedFlasks: 0,
      currentFlask: 1,
      pointsInCurrentFlask: 0,
      currentCapacity: 100,
      fill: 0,
    });
  });

  it('carries the overflow into the next flask', () => {
    const p = computeProgress(130, linear);
    expect(p.completedFlasks).toBe(1);
    expect(p.currentFlask).toBe(2);
    expect(p.pointsInCurrentFlask).toBe(30);
    expect(p.currentCapacity).toBe(150);
    expect(p.fill).toBeCloseTo(0.2);
  });

  it('treats an exactly full flask as completed', () => {
    const p = computeProgress(100, linear);
    expect(p.completedFlasks).toBe(1);
    expect(p.pointsInCurrentFlask).toBe(0);
  });

  it('fills a 100 flask exactly with 99.9 + 0.1', () => {
    const p = computeProgress(foldJournal([99.9, 0.1]), linear);
    expect(p.completedFlasks).toBe(1);
    expect(p.pointsInCurrentFlask).toBe(0);
    expect(p.fill).toBe(0);
  });

  it('keeps tenths in the current flask', () => {
    const p = computeProgress(7.3, linear);
    expect(p.pointsInCurrentFlask).toBe(7.3);
    expect(p.totalPoints).toBe(7.3);
    expect(p.fill).toBeCloseTo(0.073);
  });

  it('can fill several flasks at once', () => {
    // 100 + 150 + 200 = 450, then 10 into flask 4
    const p = computeProgress(460, linear);
    expect(p.completedFlasks).toBe(3);
    expect(p.currentFlask).toBe(4);
    expect(p.pointsInCurrentFlask).toBe(10);
    expect(p.currentCapacity).toBe(250);
  });

  it('has no upper level limit', () => {
    const p = computeProgress(100 * 250 + 1, flat100);
    expect(p.completedFlasks).toBe(250);
    expect(p.pointsInCurrentFlask).toBe(1);
  });

  it('clamps negative totals to zero', () => {
    expect(computeProgress(-5, linear).totalPoints).toBe(0);
  });

  it('rejects non-positive capacities instead of looping forever', () => {
    expect(() => computeProgress(10, { base: 0, increment: 0, manual: [] })).toThrow();
  });
});

describe('pointsToFill', () => {
  it('sums capacities of the first n flasks', () => {
    expect(pointsToFill(3, linear)).toBe(450);
    expect(pointsToFill(0, linear)).toBe(0);
  });
});

describe('buildTimeline', () => {
  it('records level-up and rollback (E2E-002)', () => {
    // 96 points: 4 left to fill flask 1. A 5-point step levels up with 1 point carried over,
    // then its cancellation returns the user to flask 1.
    const timeline = buildTimeline([{ delta: 96 }, { delta: 5 }, { delta: -5 }], linear);

    expect(timeline[0].levelChange).toBe(0);
    expect(timeline[0].after.pointsInCurrentFlask).toBe(96);

    expect(timeline[1].levelChange).toBe(1);
    expect(timeline[1].after.currentFlask).toBe(2);
    expect(timeline[1].after.pointsInCurrentFlask).toBe(1);

    expect(timeline[2].levelChange).toBe(-1);
    expect(timeline[2].after.currentFlask).toBe(1);
    expect(timeline[2].after.pointsInCurrentFlask).toBe(96);
  });

  it('agrees with foldJournal, including the per-step clamp', () => {
    const deltas = [5, -10, 5];
    const timeline = buildTimeline(deltas.map((delta) => ({ delta })), linear);
    expect(timeline.at(-1)!.after.totalPoints).toBe(5);
    expect(timeline.at(-1)!.after).toEqual(computeProgress(foldJournal(deltas), linear));
  });

  it('matches computeProgress on the final total', () => {
    const deltas = [40, 70, 200, -30, 15];
    const timeline = buildTimeline(deltas.map((delta) => ({ delta })), linear);
    expect(timeline.at(-1)!.after).toEqual(computeProgress(foldJournal(deltas), linear));
  });
});
