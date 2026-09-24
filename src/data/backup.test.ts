import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/backup-v1.json';
import { db, SCHEMA_VERSION } from './db';
import {
  BACKUP_FORMAT,
  backupStats,
  exportBackup,
  importBackup,
  migrateBackup,
  parseBackupText,
  ROW_CHECKS,
  wipeAllData,
  type BackupFile,
} from './backup';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import { registerAfterImportHook } from '../services/afterWrite';
import { cancelCompletion, completeStep, restoreCompletion } from '../services/completions';
import { archiveSkill, restartSkill, restoreSkill } from '../services/lifecycle';
import { verifyJournal } from '../services/journal';
import { getSkillDetails, listSkillSummaries } from '../services/queries';
import { getSetting, setSetting } from '../services/settings';
import { completeSkill, continueAfterMilestone, createSkill, deleteSkill, updateSkill, type SkillInput } from '../services/skills';
import { createStep, setStepActive, updateStep } from '../services/steps';

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));

const skillInput = (name: string): SkillInput => ({
  name,
  description: '',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Достичь C1',
  milestoneTarget: 2,
  capacityBase: 10,
  capacityIncrement: 5,
  manualCapacities: [8],
});

/** Two skills, a hidden step, a cancelled completion and a level-up: every table has rows. */
async function seed(): Promise<string[]> {
  const english = await createSkill(skillInput('Английский'));
  const sport = await createSkill(skillInput('Спорт'));
  const talk = await createStep({ skillId: english, name: 'Разговор', points: 5 });
  const read = await createStep({ skillId: english, name: 'Чтение', points: 3 });
  const run = await createStep({ skillId: sport, name: 'Бег', points: 4 });
  await completeStep(talk);
  await completeStep(talk);
  const mistake = await completeStep(read);
  await cancelCompletion(mistake.completionId);
  await completeStep(run, { note: 'Лёгкий темп' });
  await setSetting('coachTodaySeen', true);
  return [english, sport];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of db.tables) out[table.name] = await table.count();
  return out;
}

describe('export → wipe → import', () => {
  it('reproduces every read model', async () => {
    const ids = await seed();
    const summaries = await listSkillSummaries();
    const details = await Promise.all(ids.map((id) => getSkillDetails(id)));
    const file = await exportBackup();

    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.schemaVersion).toBe(db.verno);
    expect(Object.keys(file.tables).sort()).toEqual(db.tables.map((t) => t.name).sort());

    await wipeAllData();
    expect(await db.skills.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);

    // Through text, as a file or a pasted copy would arrive.
    const stats = await importBackup(parseBackupText(JSON.stringify(file)));
    expect(stats).toMatchObject({ skills: 2, completions: 3 });
    expect(await listSkillSummaries()).toEqual(summaries);
    expect(await Promise.all(ids.map((id) => getSkillDetails(id)))).toEqual(details);
    expect(await getSetting('coachTodaySeen', false)).toBe(true);
    expect(await verifyJournal()).toEqual([]);
  });

  it('keeps the device-bound settings of the current install', async () => {
    await seed();
    const file = clone(await exportBackup());
    const settings = file.tables.settings as { key: string; value: unknown }[];
    const own = settings.find((row) => row.key === 'installId')!.value;
    for (const row of settings) if (row.key === 'installId') row.value = 'another-phone';
    settings.push({ key: 'lastCloudBackupAt', value: '2026-01-01T00:00:00.000Z' });

    await importBackup(migrateBackup(file));
    expect(await getSetting('installId', '')).toBe(own);
    expect(await getSetting('lastCloudBackupAt', null)).toBeNull();
  });

  it('runs the import hooks inside the transaction', async () => {
    await seed();
    const file = await exportBackup();
    const hook = vi.fn(async () => {
      // Inside the import transaction the new rows are already visible.
      expect(await db.skills.count()).toBe(2);
    });
    const off = registerAfterImportHook(hook);
    try {
      await importBackup(file);
    } finally {
      off();
    }
    expect(hook).toHaveBeenCalledOnce();
  });
});

describe('every mutation', () => {
  it('leaves a database whose export imports again (no dangling achievement rows)', async () => {
    const [english, sport] = await seed();
    const talk = (await db.steps.where('skillId').equals(english).toArray())[0]!.id;
    for (let i = 0; i < 4; i++) await completeStep(talk); // 30 points: the milestone (8 + 15)
    const extra = await createStep({ skillId: english, name: 'Письмо', points: 2 });
    await updateStep(extra, { name: 'Письмо, эссе', points: 3 });
    await setStepActive(extra, false);
    const done = await completeStep(talk);
    await cancelCompletion(done.completionId);
    await restoreCompletion(done.completionId);
    await continueAfterMilestone(english);
    await updateSkill(english, { ...skillInput('Английский'), capacityBase: 12 });
    await completeSkill(english);
    const copy = await restartSkill(english);
    await archiveSkill(sport);
    await restoreSkill(sport);
    // The skill that holds the first unlocks goes, with its history.
    await deleteSkill(english);
    await createStep({ skillId: copy, name: 'Разговор', points: 5 });

    const file = await exportBackup();
    expect(file.tables.achievementUnlocks.length).toBeGreaterThan(0);
    const again = migrateBackup(clone(file));
    await wipeAllData();
    await importBackup(again);
    expect(await verifyJournal()).toEqual([]);
  });
});

describe('older files', () => {
  it('imports a schema-v1 backup through the shared migration transforms', async () => {
    const file = migrateBackup(fixture);
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.tables.settings).toEqual([]);
    expect(file.tables.achievementUnlocks).toEqual([]);
    const step = file.tables.steps[0] as Record<string, unknown>;
    expect(step.schedule).toEqual({ kind: 'MANUAL' });
    expect(step.pointsPerMinute).toBeNull();
    expect(step.scheduleFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((file.tables.completions[0] as Record<string, unknown>).cancelledAt).toBeNull();
    expect((file.tables.skills[0] as Record<string, unknown>).originSkillId).toBeNull();
    // The fixture object itself is untouched.
    expect(Object.keys(fixture.tables.steps[0])).not.toContain('scheduleFrom');

    const stats = await importBackup(file);
    expect(stats).toEqual({ skills: 2, completions: 12, lastDate: backupStats(file).lastDate });
    expect(await verifyJournal()).toEqual([]);
    const summaries = await listSkillSummaries();
    expect(summaries.map((s) => s.skill.name)).toEqual(['Английский', 'Тренировки']);
  });
});

describe('rejected files', () => {
  let file: BackupFile;
  beforeEach(async () => {
    await seed();
    file = clone(await exportBackup());
  });

  const reject = (mutate: (f: BackupFile & Record<string, unknown>) => void) => {
    const copy = clone(file) as BackupFile & Record<string, unknown>;
    mutate(copy);
    return () => migrateBackup(copy);
  };
  const rows = (f: BackupFile, table: string) => f.tables[table] as Record<string, unknown>[];

  it('names the field of a dangling reference', () => {
    expect(reject((f) => (rows(f, 'transactions')[0].completionId = 'nope'))).toThrow('Файл повреждён: transactions[0].completionId');
    expect(reject((f) => (rows(f, 'completions')[1].stepId = 'nope'))).toThrow('Файл повреждён: completions[1].stepId');
    expect(reject((f) => (rows(f, 'milestones')[0].skillId = 'nope'))).toThrow('Файл повреждён: milestones[0].skillId');
  });

  it('names the skill of a row that points into another skill', () => {
    const [english, sport] = file.tables.skills.map((s) => (s as { id: string }).id);
    const other = (id: unknown) => (id === english ? sport : english);
    // The points of a completion credited to the other (existing) skill.
    const tx = rows(file, 'transactions').findIndex((t) => t.completionId !== null);
    expect(reject((f) => (rows(f, 'transactions')[tx].skillId = other(rows(f, 'transactions')[tx].skillId)))).toThrow(`Файл повреждён: transactions[${tx}].skillId`);
    expect(reject((f) => (rows(f, 'completions')[0].skillId = other(rows(f, 'completions')[0].skillId)))).toThrow('Файл повреждён: completions[0].skillId');
  });

  it('rejects points outside a completion: only a correction may have no completion', () => {
    expect(reject((f) => (rows(f, 'transactions')[0].completionId = null))).toThrow('Файл повреждён: transactions[0].completionId');
    const orphan = { ...rows(file, 'transactions')[0], id: 'orphan', completionId: null, reason: 'CORRECTION', delta: 1 };
    expect(() => migrateBackup({ ...clone(file), tables: { ...clone(file).tables, transactions: [...rows(file, 'transactions'), orphan] } })).not.toThrow();
  });

  it('checks the skill of an achievement unlock', () => {
    const unlock = { id: 'first-step', unlockedAt: file.exportedAt, skillId: 'nope', celebratedAt: null, seenAt: null };
    expect(reject((f) => (f.tables.achievementUnlocks = [unlock]))).toThrow('Файл повреждён: achievementUnlocks[0].skillId');
    expect(() => migrateBackup({ ...clone(file), tables: { ...clone(file).tables, achievementUnlocks: [{ ...unlock, skillId: null }] } })).not.toThrow();
  });

  it('names the field of a bad value', () => {
    expect(reject((f) => (rows(f, 'completions')[0].date = '2026-13-45'))).toThrow('Файл повреждён: completions[0].date');
    expect(reject((f) => (rows(f, 'transactions')[2].delta = 0.05))).toThrow('Файл повреждён: transactions[2].delta');
    expect(reject((f) => (rows(f, 'skills')[1].status = 'DONE'))).toThrow('Файл повреждён: skills[1].status');
    expect(reject((f) => delete rows(f, 'steps')[0].isActive)).toThrow('Файл повреждён: steps[0].isActive');
    expect(reject((f) => (rows(f, 'skills')[1].id = rows(f, 'skills')[0].id))).toThrow('Файл повреждён: skills[1].id');
  });

  it('names a missing or unknown table', () => {
    expect(reject((f) => delete f.tables.completions)).toThrow('Файл повреждён: tables.completions');
    expect(reject((f) => (f.tables.extra = []))).toThrow('Файл повреждён: tables.extra');
  });

  it('rejects something that is not a backup, and a newer schema', () => {
    expect(() => parseBackupText('{"hello":1}')).toThrow('Это не резервная копия Skill Flask');
    expect(() => parseBackupText('not json')).toThrow('Это не резервная копия Skill Flask');
    expect(reject((f) => (f.schemaVersion = SCHEMA_VERSION + 1))).toThrow('Файл создан более новой версией приложения');
  });

  it('rolls back an import that breaks the journal invariant', async () => {
    const before = await counts();
    const summaries = await listSkillSummaries();
    const broken = clone(file);
    // A valid shape, but the completion's transactions no longer sum to what it awarded.
    const active = rows(broken, 'completions').find((c) => c.status === 'ACTIVE')!;
    active.pointsAwarded = 7;
    await expect(importBackup(migrateBackup(broken))).rejects.toThrow('Импорт отменён: файл не прошёл проверку');
    expect(await counts()).toEqual(before);
    expect(await listSkillSummaries()).toEqual(summaries);
  });
});

describe('schema coverage', () => {
  it('has row checks for every table of the current schema', () => {
    expect(Object.keys(ROW_CHECKS).sort()).toEqual(db.tables.map((t) => t.name).sort());
  });
});

describe('wipeAllData', () => {
  it('clears the journal but keeps the install id and device switches', async () => {
    await seed();
    const installId = await getSetting('installId', '');
    await setSetting('cloudBackupEnabled', false);
    await setSetting('restoreOfferShown', true);
    await setSetting('cloudBackupHash', 'abc');
    await setSetting('lastCloudBackupAt', '2026-09-01T10:00:00.000Z');
    await wipeAllData();
    expect(await db.skills.count()).toBe(0);
    expect(await db.completions.count()).toBe(0);
    expect(await getSetting('installId', '')).toBe(installId);
    expect(await getSetting('cloudBackupEnabled', true)).toBe(false);
    // Offered again on the next start when the cloud still holds a copy.
    expect(await getSetting('restoreOfferShown', false)).toBe(false);
    // A kept cloud copy is no longer this device's to replace.
    expect(await getSetting('cloudBackupHash', null)).toBeNull();
    expect(await getSetting('lastCloudBackupAt', null)).toBeNull();
  });
});
