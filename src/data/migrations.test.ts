import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/v1-sample.json';
import { createDb, db, SCHEMA_VERSION, setDb } from './db';
import { MIGRATIONS } from './migrations/v2';
import { snapshotV1 } from './open';
import { newId } from '../lib/ids';
import { localDate } from '../lib/clock';
import { verifyJournal } from '../services/journal';
import { getSkillDetails } from '../services/queries';
import { compareJournalOrder } from '../domain/progression';

const V1_STORES = {
  skills: 'id, status, createdAt',
  milestones: 'id, skillId',
  levelThresholds: '[skillId+flaskNumber], skillId',
  steps: 'id, skillId',
  completions: 'id, skillId, stepId, date',
  transactions: 'id, skillId, completionId, createdAt',
};

type Tables = Record<string, Record<string, unknown>[]>;
const tables = fixture.tables as Tables;

/** `scheduleFrom` defaults to the local day of `createdAt`, so the expectation follows the runner's time zone. */
const scheduleFromOf = (step: Record<string, unknown>) => localDate(new Date(step.createdAt as string));

/** Writes the v1 fixture through a Dexie that knows only schema version 1, then closes it. */
async function writeV1(name: string): Promise<void> {
  const v1 = new Dexie(name);
  v1.version(1).stores(V1_STORES);
  await v1.open();
  await v1.transaction('rw', v1.tables, async () => {
    for (const [table, rows] of Object.entries(tables)) await v1.table(table).bulkAdd(rows);
  });
  expect(v1.verno).toBe(1);
  v1.close();
}

async function dump(database: Dexie): Promise<Tables> {
  const out: Tables = {};
  for (const table of database.tables) out[table.name] = await table.orderBy(':id').toArray();
  return out;
}

const names: string[] = [];
function dbName(): string {
  const name = `migration-${newId()}`;
  names.push(name);
  return name;
}

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name);
});

describe('fixture', () => {
  it('has the documented shape', () => {
    expect(tables.skills).toHaveLength(2);
    expect(tables.steps).toHaveLength(3);
    expect(tables.completions).toHaveLength(12);
    expect(tables.transactions).toHaveLength(12);
    const stamps = tables.transactions.map((t) => t.createdAt);
    expect(new Set(stamps).size).toBe(stamps.length - 1);
    expect(Object.keys(tables.steps[0])).not.toContain('scheduleFrom');
  });
});

describe('Dexie v2 upgrade', () => {
  it('is the current schema version', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(createDb(dbName()).verno).toBe(2);
  });

  it('upgrades a v1 database with defaults and keeps the journal valid', async () => {
    const name = dbName();
    await writeV1(name);

    const upgraded = createDb(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(2);
    expect(upgraded.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['settings', 'achievementUnlocks', 'skills', 'completions', 'transactions']),
    );
    expect(await upgraded.settings.count()).toBe(0);
    expect(await upgraded.achievementUnlocks.count()).toBe(0);

    const step = await upgraded.steps.get('step-speaking');
    expect(step).toMatchObject({
      pointsPerMinute: null,
      defaultMinutes: null,
      scheduleFrom: scheduleFromOf(tables.steps.find((s) => s.id === 'step-speaking')!),
      schedule: { kind: 'MANUAL' },
      points: 5,
    });
    for (const completion of await upgraded.completions.toArray()) expect(completion.cancelledAt).toBeNull();
    for (const skill of await upgraded.skills.toArray()) expect(skill.originSkillId).toBeNull();

    // New compound indexes are queryable.
    expect(await upgraded.completions.where('[skillId+date]').equals(['skill-english', '2026-08-07']).count()).toBe(2);
    expect(await upgraded.completions.where('[status+date]').between(['ACTIVE', '2026-08-01'], ['ACTIVE', '2026-08-31']).count()).toBe(12);

    const previous = db;
    setDb(upgraded);
    expect(await verifyJournal()).toEqual([]);
    const details = await getSkillDetails('skill-english');
    // 5+3+5+3+5+5+3+5+3 = 37 points: flask 1 (30) full, 7 in flask 2 (50).
    expect(details?.progress).toMatchObject({ completedFlasks: 1, pointsInCurrentFlask: 7, currentCapacity: 50 });
    // Journal order, newest first; t08 and t09 share a timestamp and replay in id order.
    const journal = (await upgraded.transactions.where('skillId').equals('skill-english').toArray()).sort(compareJournalOrder).reverse();
    expect(journal.map((t) => t.id).slice(0, 4)).toEqual(['t12', 't10', 't09', 't08']);
    setDb(previous);
    upgraded.close();
  });

  it('is idempotent: opening twice and applying the transforms twice yield identical rows', async () => {
    const name = dbName();
    await writeV1(name);

    const first = createDb(name);
    await first.open();
    const afterFirst = await dump(first);
    first.close();

    const second = createDb(name);
    await second.open();
    const afterSecond = await dump(second);
    second.close();
    expect(afterSecond).toEqual(afterFirst);

    const once = structuredClone(tables);
    const twice = structuredClone(tables);
    const apply = (t: Tables) => {
      for (const [table, fn] of Object.entries(MIGRATIONS[2])) for (const row of t[table]) fn(row as never);
    };
    apply(once);
    apply(twice);
    apply(twice);
    expect(twice).toEqual(once);
    expect(once.steps[0]).toMatchObject({ scheduleFrom: scheduleFromOf(tables.steps[0]), pointsPerMinute: null });
    expect(once.completions[0]).toMatchObject({ cancelledAt: null });
    expect(once.skills[0]).toMatchObject({ originSkillId: null });
  });

  it('snapshots a v1 database before the upgrade and nothing otherwise', async () => {
    expect(await snapshotV1(dbName())).toBeNull();

    const name = dbName();
    await writeV1(name);
    const snapshot = JSON.parse((await snapshotV1(name))!);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.tables.transactions).toHaveLength(12);
    expect(snapshot.tables.steps[0]).not.toHaveProperty('scheduleFrom');

    const upgraded = createDb(name);
    await upgraded.open();
    upgraded.close();
    expect(await snapshotV1(name)).toBeNull();
  });
});
