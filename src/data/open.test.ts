import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, db, setDb } from './db';
import { openDb } from './open';
import { newId } from '../lib/ids';

const names: string[] = [];
const previous = db;

afterEach(async () => {
  setDb(previous);
  for (const name of names.splice(0)) await Dexie.delete(name);
});

function fresh(): string {
  const name = `open-${newId()}`;
  names.push(name);
  return name;
}

describe('openDb', () => {
  it('opens a new database', async () => {
    setDb(createDb(fresh()));
    expect(await openDb()).toEqual({ ok: true });
    expect(db.isOpen()).toBe(true);
    expect(db.verno).toBe(5);
    db.close();
  });

  it('explains a database written by a newer app version', async () => {
    const name = fresh();
    const future = new Dexie(name);
    future.version(5).stores({ skills: 'id', settings: 'key', achievementUnlocks: 'id' });
    await future.open();
    future.close();

    setDb(createDb(name));
    const result = await openDb();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('version');
      expect(result.message).toMatch(/более новой версией/);
    }
    expect(db.isOpen()).toBe(false);
  });
});
