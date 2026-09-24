// Pure level calculation from the points journal and flask capacities (section 7.6).
// Kept free of storage and UI so the capacity formula can change without migrating history.

import { DECI, fromDeci, toDeci } from './points';

export interface CapacityConfig {
  base: number;
  increment: number;
  /** manual[i] is the capacity of flask i + 1. */
  manual: readonly number[];
}

export const DEFAULT_CAPACITY_BASE = 100;
export const DEFAULT_CAPACITY_INCREMENT = 50;

/**
 * Capacity of flask `n` (1-based). Manually set thresholds win; after they run out,
 * capacity keeps growing linearly by `increment` from the last manual value (decision 14.7).
 */
export function flaskCapacity(n: number, config: CapacityConfig): number {
  const { base, increment, manual } = config;
  if (n <= manual.length) return manual[n - 1];
  if (manual.length > 0) return manual[manual.length - 1] + increment * (n - manual.length);
  return base + increment * (n - 1);
}

export interface Progress {
  totalPoints: number;
  completedFlasks: number;
  /** Number of the flask being filled now (completedFlasks + 1). */
  currentFlask: number;
  pointsInCurrentFlask: number;
  currentCapacity: number;
  /** Fill ratio of the current flask, 0..1. */
  fill: number;
}

/**
 * The one journal fold rule: the balance after applying `delta` to `prev`, clamped at
 * zero after every step (FR-XP-001, FR-XP-006). Runs on deci integers so tenths add exactly.
 */
export function nextBalance(prev: number, delta: number): number {
  return fromDeci(Math.max(0, toDeci(prev) + toDeci(delta)));
}

/** Total progress of a journal: `nextBalance` folded over the deltas in order. */
export function foldJournal(deltas: Iterable<number>): number {
  let balance = 0;
  for (const delta of deltas) balance = nextBalance(balance, delta);
  return balance;
}

export function computeProgress(total: number, config: CapacityConfig): Progress {
  let remaining = toDeci(Math.max(0, total));
  let completed = 0;
  // With increment 0 and no manual thresholds this loop is O(total / base), which is fine
  // at the scale of a personal journal.
  for (;;) {
    const capacity = flaskCapacity(completed + 1, config);
    if (!(capacity > 0)) throw new Error(`Flask ${completed + 1} has non-positive capacity ${capacity}`);
    const capacityDeci = capacity * DECI;
    if (remaining < capacityDeci) {
      return {
        totalPoints: fromDeci(toDeci(Math.max(0, total))),
        completedFlasks: completed,
        currentFlask: completed + 1,
        pointsInCurrentFlask: fromDeci(remaining),
        currentCapacity: capacity,
        fill: remaining / capacityDeci,
      };
    }
    remaining -= capacityDeci;
    completed += 1;
  }
}

/** Points needed to completely fill flasks 1..n. */
export function pointsToFill(n: number, config: CapacityConfig): number {
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += flaskCapacity(i, config);
  return sum;
}

/** Journal order: createdAt, then id as a deterministic tie-break for equal timestamps. */
export function compareJournalOrder(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface TimelineEntry<T extends { delta: number }> {
  transaction: T;
  before: Progress;
  after: Progress;
  /** Positive on level-up, negative on level rollback, 0 otherwise. */
  levelChange: number;
}

/** Replays the journal in order and records the flask state after each operation (FR-HS-003). */
export function buildTimeline<T extends { delta: number }>(
  transactions: readonly T[],
  config: CapacityConfig,
): TimelineEntry<T>[] {
  let running = 0;
  let before = computeProgress(0, config);
  return transactions.map((transaction) => {
    running = nextBalance(running, transaction.delta);
    const after = computeProgress(running, config);
    const entry = { transaction, before, after, levelChange: after.completedFlasks - before.completedFlasks };
    before = after;
    return entry;
  });
}
