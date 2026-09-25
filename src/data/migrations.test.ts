import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/v1-sample.json';
import { createDb, db, SCHEMA_VERSION, setDb } from './db';
import { MIGRATIONS } from './migrations';
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

/** The stores of schema version 2, before the marks table. */
const V2_STORES = {
  skills: 'id, status, createdAt',
  milestones: 'id, skillId',
  levelThresholds: '[skillId+flaskNumber], skillId',
  steps: 'id, skillId',
  completions: 'id, skillId, stepId, date, [skillId+date], [stepId+date], [status+date]',
  transactions: 'id, skillId, completionId, createdAt, [skillId+createdAt]',
  settings: 'key',
  achievementUnlocks: 'id',
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
  it('is followed by versions 3 and 4, the current schema version', () => {
    expect(SCHEMA_VERSION).toBe(4);
    expect(createDb(dbName()).verno).toBe(4);
    expect(Object.keys(MIGRATIONS).map(Number)).toEqual([2, 3, 4]);
    expect(MIGRATIONS[3]).toEqual({});
    expect(Object.keys(MIGRATIONS[4]!)).toEqual(['skills']);
  });

  it('upgrades a v1 database with defaults and keeps the journal valid', async () => {
    const name = dbName();
    await writeV1(name);

    const upgraded = createDb(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(4);
    expect(upgraded.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['settings', 'achievementUnlocks', 'marks', 'skills', 'completions', 'transactions']),
    );
    expect(await upgraded.settings.count()).toBe(0);
    expect(await upgraded.achievementUnlocks.count()).toBe(0);
    expect(await upgraded.marks.count()).toBe(0);

    const step = await upgraded.steps.get('step-speaking');
    expect(step).toMatchObject({
      pointsPerMinute: null,
      defaultMinutes: null,
      scheduleFrom: scheduleFromOf(tables.steps.find((s) => s.id === 'step-speaking')!),
      schedule: { kind: 'MANUAL' },
      points: 5,
    });
    for (const completion of await upgraded.completions.toArray()) expect(completion.cancelledAt).toBeNull();
    for (const skill of await upgraded.skills.toArray()) expect(skill).toMatchObject({ originSkillId: null, theme: 'flask', color: null });

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

describe('Dexie v3 upgrade', () => {
  it('upgrades a v2 database with an empty marks table and leaves every row as it was', async () => {
    const name = dbName();
    // A v2 database as the previous release left it: the v1 rows upgraded by the v2 transforms.
    const v2 = new Dexie(name);
    v2.version(1).stores(V1_STORES);
    v2.version(2).stores(V2_STORES);
    await v2.open();
    const rows = structuredClone(tables);
    for (const [table, fn] of Object.entries(MIGRATIONS[2])) for (const row of rows[table]) fn(row as never);
    await v2.transaction('rw', v2.tables, async () => {
      for (const [table, list] of Object.entries(rows)) await v2.table(table).bulkAdd(list);
      await v2.table('settings').add({ key: 'coachTodaySeen', value: true });
    });
    expect(v2.verno).toBe(2);
    const before = await dump(v2);
    v2.close();

    const upgraded = createDb(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(4);
    const after = await dump(upgraded);
    expect(after.marks).toEqual([]);
    delete after.marks;
    // Version 4 then gives every skill its appearance; nothing else changes.
    for (const skill of after.skills!) {
      expect(skill).toMatchObject({ theme: 'flask', color: null });
      delete skill.theme;
      delete skill.color;
    }
    expect(after).toEqual(before);
    // The new indexes are queryable.
    expect(await upgraded.marks.where('[skillId+date]').between(['skill-english', ''], ['skill-english', '\uffff']).count()).toBe(0);

    const previous = db;
    setDb(upgraded);
    expect(await verifyJournal()).toEqual([]);
    expect((await getSkillDetails('skill-english'))?.marks).toEqual([]);
    setDb(previous);
    upgraded.close();
  });
});

/** The stores of schema version 3 (= version 4's: the appearance is not indexed). */
const V3_STORES = { ...V2_STORES, marks: 'id, skillId, [skillId+date]' };

describe('Dexie v4 upgrade', () => {
  async function writeV3(name: string, mutate?: (rows: Tables) => void): Promise<Tables> {
    const v3 = new Dexie(name);
    v3.version(1).stores(V1_STORES);
    v3.version(2).stores(V2_STORES);
    v3.version(3).stores(V3_STORES);
    await v3.open();
    const rows = structuredClone(tables);
    for (const [table, fn] of Object.entries(MIGRATIONS[2]!)) for (const row of rows[table]!) fn(row as never);
    mutate?.(rows);
    await v3.transaction('rw', v3.tables, async () => {
      for (const [table, list] of Object.entries(rows)) await v3.table(table).bulkAdd(list);
    });
    expect(v3.verno).toBe(3);
    const before = await dump(v3);
    v3.close();
    return before;
  }

  it('gives every skill the flask and «Как в теме», and leaves every other row as it was', async () => {
    const name = dbName();
    const before = await writeV3(name);
    const upgraded = createDb(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(4);
    const after = await dump(upgraded);
    expect(after.skills!.map((s) => [s.theme, s.color])).toEqual(before.skills!.map(() => ['flask', null]));
    for (const skill of after.skills!) {
      delete skill.theme;
      delete skill.color;
    }
    expect(after).toEqual(before);

    const previous = db;
    setDb(upgraded);
    expect(await verifyJournal()).toEqual([]);
    expect((await getSkillDetails('skill-english'))?.skill).toMatchObject({ theme: 'flask', color: null });
    setDb(previous);
    upgraded.close();
  });

  it('is idempotent and keeps a stored appearance, even a theme this build does not know', async () => {
    const name = dbName();
    await writeV3(name, (rows) => {
      Object.assign(rows.skills![0]!, { theme: 'pizza', color: 'coral' });
      Object.assign(rows.skills![1]!, { theme: 'comet' });
    });
    const first = createDb(name);
    await first.open();
    const afterFirst = await dump(first);
    first.close();
    const second = createDb(name);
    await second.open();
    expect(await dump(second)).toEqual(afterFirst);
    second.close();
    expect(afterFirst.skills!.map((s) => [s.theme, s.color])).toEqual([
      ['pizza', 'coral'],
      ['comet', null],
    ]);

    const once = structuredClone(tables.skills!);
    const twice = structuredClone(tables.skills!);
    for (const row of once) MIGRATIONS[4]!.skills!(row as never);
    for (let i = 0; i < 2; i++) for (const row of twice) MIGRATIONS[4]!.skills!(row as never);
    expect(twice).toEqual(once);
    expect(once[0]).toMatchObject({ theme: 'flask', color: null });
  });
});
