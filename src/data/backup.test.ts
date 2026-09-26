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
import { setSkillAppearance } from '../services/skills';
import { createMark, deleteMark, updateMark } from '../services/marks';
import { endPause, pauseSkill } from '../services/pauses';
import { addDays, localDate } from '../lib/dates';

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
  await createMark(english, { title: 'Пробный тест', description: '72 из 100', date: addDays(localDate(), -1) });
  await pauseSkill(sport, addDays(localDate(), 6));
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
    expect(file.schemaVersion).toBe(5);
    expect(file.tables.marks).toHaveLength(1);
    expect(file.tables.pauses).toHaveLength(1);
    const stats = await importBackup(parseBackupText(JSON.stringify(file)));
    expect(stats).toMatchObject({ skills: 2, completions: 3 });
    expect(await db.marks.toArray()).toEqual(file.tables.marks);
    expect(await db.pauses.toArray()).toEqual(file.tables.pauses);
    expect(details[1]!.pause).toMatchObject({ skillId: ids[1], until: addDays(localDate(), 6) });
    expect(details[0]!.marks).toHaveLength(1);
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
    settings.push({ key: 'askNote', value: true });

    await importBackup(migrateBackup(file));
    expect(await getSetting('installId', '')).toBe(own);
    expect(await getSetting('lastCloudBackupAt', null)).toBeNull();
    expect(await getSetting('askNote', false)).toBe(false);
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
    const mark = await createMark(english, { title: 'Экзамен' });
    await updateMark(mark, { title: 'Экзамен B2', description: 'Сдан', date: localDate() });
    await deleteMark(await createMark(english, { title: 'Черновик' }));
    await createMark(sport, { title: 'Забег' });
    await endPause(sport);
    await pauseSkill(english, null);
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
    // The deleted skill took its marks and its pause with it; the other skill keeps its own.
    expect(file.tables.marks.map((m) => (m as { title: string }).title)).toEqual(['Забег']);
    expect(file.tables.pauses.map((p) => (p as { skillId: string }).skillId)).toEqual([]);
    // «Начать заново» does not copy the pause: the copy starts in the plan.
    expect(await db.pauses.where('skillId').equals(copy).count()).toBe(0);
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
    expect(file.tables.skills[0]).toMatchObject({ originSkillId: null, theme: 'flask', color: null });
    // The fixture object itself is untouched.
    expect(Object.keys(fixture.tables.steps[0])).not.toContain('scheduleFrom');

    const stats = await importBackup(file);
    expect(stats).toEqual({ skills: 2, completions: 12, lastDate: backupStats(file).lastDate });
    expect(await verifyJournal()).toEqual([]);
    const summaries = await listSkillSummaries();
    expect(summaries.map((s) => s.skill.name)).toEqual(['Английский', 'Тренировки']);
  });
});

describe('schema-v2 files', () => {
  it('import with an empty marks table', async () => {
    await seed();
    const file = clone(await exportBackup()) as BackupFile;
    // What the previous release wrote: schemaVersion 2 and no marks table.
    file.schemaVersion = 2;
    delete (file.tables as Record<string, unknown>).marks;
    const migrated = migrateBackup(file);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.tables.marks).toEqual([]);
    await importBackup(migrated);
    expect(await db.marks.count()).toBe(0);
    expect(await verifyJournal()).toEqual([]);
  });

  it('are told apart from a damaged v4 file, which must have the table', async () => {
    await seed();
    const file = clone(await exportBackup()) as BackupFile;
    delete (file.tables as Record<string, unknown>).marks;
    expect(() => migrateBackup(file)).toThrow('Файл повреждён: tables.marks');
  });
});

describe('schema-v4 files and the pauses', () => {
  it('import with an empty pauses table', async () => {
    await seed();
    const file = clone(await exportBackup()) as BackupFile;
    // What package 17 wrote: schemaVersion 4 and no pauses table.
    file.schemaVersion = 4;
    delete (file.tables as Record<string, unknown>).pauses;
    const migrated = migrateBackup(file);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.tables.pauses).toEqual([]);
    await importBackup(migrated);
    expect(await db.pauses.count()).toBe(0);
    expect(await verifyJournal()).toEqual([]);
  });

  it('are told apart from a damaged v5 file, which must have the table', async () => {
    await seed();
    const file = clone(await exportBackup()) as BackupFile;
    delete (file.tables as Record<string, unknown>).pauses;
    expect(() => migrateBackup(file)).toThrow('Файл повреждён: tables.pauses');
  });

  it('round-trip the pause as it was, ended or running', async () => {
    const [english, sport] = await seed();
    await pauseSkill(english, null);
    await endPause(sport);
    const before = await db.pauses.toArray();
    const file = await exportBackup();
    await wipeAllData();
    expect(await db.pauses.count()).toBe(0);
    await importBackup(parseBackupText(JSON.stringify(file)));
    expect(await db.pauses.toArray()).toEqual(before);
  });
});

describe('schema-v3 files and the appearance', () => {
  it('import a v3 file with the flask and «Как в теме» for every skill', async () => {
    await seed();
    const file = clone(await exportBackup()) as BackupFile;
    // What package 10 wrote: schemaVersion 3, skills without theme and colour.
    file.schemaVersion = 3;
    for (const skill of file.tables.skills as Record<string, unknown>[]) {
      delete skill.theme;
      delete skill.color;
    }
    const migrated = migrateBackup(file);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect((migrated.tables.skills as Record<string, unknown>[]).map((s) => [s.theme, s.color])).toEqual([
      ['flask', null],
      ['flask', null],
    ]);
    await importBackup(migrated);
    expect((await db.skills.toArray()).map((s) => [s.theme, s.color])).toEqual([
      ['flask', null],
      ['flask', null],
    ]);
    expect(await verifyJournal()).toEqual([]);
  });

  it('round-trips a v4 file: theme and colour come back as they were', async () => {
    const [english, sport] = await seed();
    await setSkillAppearance(english, { theme: 'pizza', color: 'coral' });
    await setSkillAppearance(sport, { theme: 'rocket', color: null });
    const file = await exportBackup();
    await wipeAllData();
    await importBackup(parseBackupText(JSON.stringify(file)));
    expect(await db.skills.get(english)).toMatchObject({ theme: 'pizza', color: 'coral' });
    expect(await db.skills.get(sport)).toMatchObject({ theme: 'rocket', color: null });
  });

  it('accepts a theme or colour key this build does not know (a newer release’s) and keeps it', async () => {
    const [english] = await seed();
    const file = clone(await exportBackup()) as BackupFile;
    const row = (file.tables.skills as Record<string, unknown>[]).find((s) => s.id === english)!;
    Object.assign(row, { theme: 'comet', color: 'ultramarine' });
    await importBackup(migrateBackup(file));
    // Stored as is; the UI reads it as the flask and «Как в теме» (domain/appearance.ts).
    expect(await db.skills.get(english)).toMatchObject({ theme: 'comet', color: 'ultramarine' });
  });

  it('rejects an appearance that is not a key', async () => {
    await seed();
    const file = clone(await exportBackup()) as BackupFile;
    const reject = (field: string, value: unknown) => {
      const copy = clone(file);
      (copy.tables.skills as Record<string, unknown>[])[0]![field] = value;
      return () => migrateBackup(copy);
    };
    expect(reject('theme', null)).toThrow('Файл повреждён: skills[0].theme');
    expect(reject('theme', '')).toThrow('Файл повреждён: skills[0].theme');
    expect(reject('theme', 'x'.repeat(40))).toThrow('Файл повреждён: skills[0].theme');
    expect(reject('color', 42)).toThrow('Файл повреждён: skills[0].color');
    expect(reject('color', null)).not.toThrow();
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

  it('checks the marks: a real skill, a title, a date and points', () => {
    expect(reject((f) => (rows(f, 'marks')[0].skillId = 'nope'))).toThrow('Файл повреждён: marks[0].skillId');
    expect(reject((f) => (rows(f, 'marks')[0].title = ''))).toThrow('Файл повреждён: marks[0].title');
    expect(reject((f) => (rows(f, 'marks')[0].title = 'x'.repeat(61)))).toThrow('Файл повреждён: marks[0].title');
    expect(reject((f) => (rows(f, 'marks')[0].date = '2026-02-30'))).toThrow('Файл повреждён: marks[0].date');
    expect(reject((f) => (rows(f, 'marks')[0].flaskNumber = 0))).toThrow('Файл повреждён: marks[0].flaskNumber');
    expect(reject((f) => (rows(f, 'marks')[0].pointsInFlask = 0.05))).toThrow('Файл повреждён: marks[0].pointsInFlask');
    expect(reject((f) => delete rows(f, 'marks')[0].description)).toThrow('Файл повреждён: marks[0].description');
  });

  it('checks the pauses: a real skill, dates in order, one at a time per skill', () => {
    const pause = rows(file, 'pauses')[0]!;
    expect(reject((f) => (rows(f, 'pauses')[0].skillId = 'nope'))).toThrow('Файл повреждён: pauses[0].skillId');
    expect(reject((f) => (rows(f, 'pauses')[0].from = '2026-02-30'))).toThrow('Файл повреждён: pauses[0].from');
    expect(reject((f) => (rows(f, 'pauses')[0].until = addDays(pause.from as string, -1)))).toThrow('Файл повреждён: pauses[0].until');
    // Only a pause with a last day can have ended: a stray endedAt is dropped, not refused.
    const open = clone(file);
    Object.assign(rows(open, 'pauses')[0], { until: null, endedAt: file.exportedAt });
    expect(rows(migrateBackup(open), 'pauses')[0]).toMatchObject({ until: null, endedAt: null });
    expect(reject((f) => (rows(f, 'pauses')[0].endedAt = 'yesterday'))).toThrow('Файл повреждён: pauses[0].endedAt');
    // Two pauses of one skill never share a day; back to back is fine.
    const overlapping = { ...pause, id: 'second', from: addDays(pause.from as string, 3), until: null };
    expect(reject((f) => rows(f, 'pauses').push(overlapping))).toThrow('Файл повреждён: pauses[1].from');
    const next = { ...pause, id: 'second', from: addDays(pause.until as string, 1), until: null };
    expect(reject((f) => rows(f, 'pauses').push(next))).not.toThrow();
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
    await setSetting('askNote', true);
    await wipeAllData();
    expect(await db.skills.count()).toBe(0);
    expect(await db.completions.count()).toBe(0);
    expect(await db.marks.count()).toBe(0);
    expect(await db.pauses.count()).toBe(0);
    expect(await getSetting('installId', '')).toBe(installId);
    expect(await getSetting('cloudBackupEnabled', true)).toBe(false);
    // «Спрашивать заметку» is this phone's switch, like «Тема» (package 17).
    expect(await getSetting('askNote', false)).toBe(true);
    // Offered again on the next start when the cloud still holds a copy.
    expect(await getSetting('restoreOfferShown', false)).toBe(false);
    // A kept cloud copy is no longer this device's to replace.
    expect(await getSetting('cloudBackupHash', null)).toBeNull();
    expect(await getSetting('lastCloudBackupAt', null)).toBeNull();
  });
});
