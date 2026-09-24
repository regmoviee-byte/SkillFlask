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

/** Runs `fn` with the clock frozen at `iso` (nowIso still increases by 1 ms per call). */
export async function withClock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const fixed = new Date(iso);
  setClock(() => fixed);
  try {
    return await fn();
  } finally {
    setClock(null);
  }
}
