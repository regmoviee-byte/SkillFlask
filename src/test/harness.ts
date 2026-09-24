// Shared setup for service tests: a fresh database per test, an injectable clock and the
// journal invariant checked after every test.

import { afterEach, beforeEach, expect } from 'vitest';
import { createDb, db, setDb, type SkillFlaskDb } from '../data/db';
import { newId } from '../lib/ids';
import { setClock } from '../lib/clock';
import { verifyJournal } from '../services/journal';

/** Creates an isolated database and makes it the current `db`. */
export function freshDb(): SkillFlaskDb {
  const next = createDb(`test-${newId()}`);
  setDb(next);
  return next;
}

/** Fresh database before each test; after each test the journal must verify clean, then it is deleted. */
export function installFreshDb(): void {
  beforeEach(() => {
    freshDb();
  });
  afterEach(async () => {
    setClock(null);
    expect(await verifyJournal()).toEqual([]);
    await db.delete();
  });
}

/**
 * A clock that starts at `iso` and moves `stepMs` forward on every read. Journal writes of
 * the same step then sit further apart than the double-submit window of completeStep.
 */
export function tickingClock(iso: string, stepMs = 2000): () => Date {
  let t = new Date(iso).getTime() - stepMs;
  return () => new Date((t += stepMs));
}

/** Local noon of today (real clock), as an ISO string without zone: a safe start for tickingClock. */
export function todayNoon(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00:00`;
}

/**
 * Runs `fn` with the clock frozen at `iso` (nowIso still increases by 1 ms per call), or
 * ticking by `stepMs` per read when given.
 */
export async function withClock<T>(iso: string, fn: () => Promise<T>, stepMs = 0): Promise<T> {
  const fixed = new Date(iso);
  setClock(stepMs > 0 ? tickingClock(iso, stepMs) : () => fixed);
  try {
    return await fn();
  } finally {
    setClock(null);
  }
}
