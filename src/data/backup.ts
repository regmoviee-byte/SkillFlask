// Versioned backup of the whole database: one JSON object with every table's rows, built
// generically from `db.tables` so a table added by a later schema version is covered without
// touching this file's export or import (only its row checks below). Nothing derived is
// stored: progress, levels and events are recomputed from the journal after an import.
// Restore always REPLACES the data on the device («копия, а не синхронизация»).

import { db, SCHEMA_VERSION } from './db';
import { MIGRATIONS } from './migrations';
import { isValidLocalDate, nowIso } from '../lib/dates';
import { MARK_DESCRIPTION_MAX, MARK_TITLE_MAX } from '../domain/marks';
import { isPoints } from '../domain/points';
import { ScheduleError, validateSchedule } from '../domain/schedule';
import type { StepSchedule } from '../domain/types';
import { runAfterImport } from '../services/afterWrite';
import { verifyJournal } from '../services/journal';
import { getSetting, type SettingKey } from '../services/settings';

export const BACKUP_FORMAT = 'skill-flask-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  /** Dexie version of the data (`db.verno`); older files are migrated on import. */
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  installId: string;
  /** Rows of every table by table name. */
  tables: Record<string, unknown[]>;
}

/** A backup that cannot be read or imported; the message is shown to the user as is. */
export class BackupError extends Error {
  override name = 'BackupError';
}

export const backupMessages = {
  notBackup: 'Это не резервная копия Skill Flask',
  newer: 'Файл создан более новой версией приложения',
  corrupt: (path: string) => `Файл повреждён: ${path}`,
  rejected: 'Импорт отменён: файл не прошёл проверку',
} as const;

/**
 * Settings that describe this device rather than the journal: kept from the current database
 * on import instead of taken from the file (the spec names installId; the backup timestamps,
 * the restore offer flag, the appearance switches, «Спрашивать заметку» and the fold of «Сделано»
 * on «Сегодня» are just as device-bound).
 */
export const DEVICE_SETTINGS = [
  'installId',
  'restoreOfferShown',
  'storagePersistRequested',
  'cloudBackupEnabled',
  'lastCloudBackupAt',
  'lastCloudBackupBytes',
  'cloudBackupHash',
  'lastFileBackupAt',
  'motion',
  'appearance',
  'askNote',
  'todayDoneOpen',
] as const satisfies readonly SettingKey[];

/**
 * Settings that never leave the device: the running timer (v0.5 package 15) is state of this
 * phone at this moment, not history. Left out of every export (file and cloud) and dropped
 * from a file that carries one; an import or a wipe clears the device's own.
 */
export const LOCAL_ONLY_SETTINGS = ['activeTimer'] as const satisfies readonly SettingKey[];

const isLocalOnly = (row: unknown) => (LOCAL_ONLY_SETTINGS as readonly unknown[]).includes((row as { key?: unknown } | null)?.key);

/** Schema version that introduced a table; tables absent here exist since version 1. */
const TABLE_SINCE: Record<string, number> = { settings: 2, achievementUnlocks: 2, marks: 3, pauses: 5 };

const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// ---- Export ----

/** Every table of the database in one read transaction, so the copy is a consistent snapshot. */
export async function exportBackup(): Promise<BackupFile> {
  // Outside the read transaction: the first read of installId writes it.
  const installId = await getSetting('installId', '');
  const tables = await db.transaction('r', db.tables, async () => {
    const out: Record<string, unknown[]> = {};
    for (const table of db.tables) out[table.name] = await table.toArray();
    if (out.settings) out.settings = out.settings.filter((row) => !isLocalOnly(row));
    return out;
  });
  return { format: BACKUP_FORMAT, schemaVersion: db.verno, appVersion, exportedAt: nowIso(), installId, tables };
}

// ---- Row checks ----

type Check = (value: unknown) => boolean;

const str: Check = (v) => typeof v === 'string';
const id: Check = (v) => typeof v === 'string' && v.length > 0;
const bool: Check = (v) => typeof v === 'boolean';
const any: Check = () => true;
const int = (min: number): Check => (v) => Number.isInteger(v) && (v as number) >= min;
const oneOf = (...values: unknown[]): Check => (v) => values.includes(v);
const nullable = (check: Check): Check => (v) => v === null || check(v);
const iso: Check = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const localDate: Check = isValidLocalDate;
const points: Check = isPoints;
/** A journal delta: signed, at most one decimal. */
const delta: Check = (v) => typeof v === 'number' && isPoints(Math.abs(v));
/** Trimmed text of 1..max characters (a title). */
const title = (max: number): Check => (v) => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= max;
const text = (max: number): Check => (v) => typeof v === 'string' && v.length <= max;
const rate: Check = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** An enum-like key (theme, colour): a short word, validated against the known ones at read time. */
const key: Check = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v);
/** The shapes validateSchedule accepts: weekdays 1..7 (at least one), quotas of 1..31. */
const schedule: Check = (v) => {
  if (!v || typeof v !== 'object') return false;
  try {
    validateSchedule(v as StepSchedule);
    return true;
  } catch (error) {
    if (error instanceof ScheduleError) return false;
    throw error;
  }
};

const timestamps = { createdAt: iso, updatedAt: iso };

/** Shape of a row per table at the current schema version (after the migration transforms). */
export const ROW_CHECKS: Record<string, Record<string, Check>> = {
  skills: {
    id,
    name: str,
    description: str,
    status: oneOf('ACTIVE', 'COMPLETED', 'ARCHIVED'),
    startLabel: str,
    targetLabel: str,
    capacityBase: int(1),
    capacityIncrement: int(0),
    completedAt: nullable(iso),
    archivedAt: nullable(iso),
    originSkillId: nullable(id),
    // Any short key: one this build does not know (a newer release's) is read as the default.
    theme: key,
    color: nullable(key),
    ...timestamps,
  },
  milestones: {
    id,
    skillId: id,
    name: str,
    targetFlaskNumber: int(1),
    reachedAt: nullable(iso),
    decision: oneOf('CONTINUE', null),
    ...timestamps,
  },
  levelThresholds: { skillId: id, flaskNumber: int(1), requiredPoints: int(1) },
  steps: {
    id,
    skillId: id,
    name: str,
    type: oneOf('BOOLEAN', 'TIMED'),
    points,
    pointsPerMinute: nullable(rate),
    defaultMinutes: nullable(int(1)),
    schedule,
    scheduleFrom: localDate,
    isActive: bool,
    ...timestamps,
  },
  completions: {
    id,
    skillId: id,
    stepId: id,
    stepName: str,
    stepType: oneOf('BOOLEAN', 'TIMED'),
    pointsSnapshot: rate,
    durationMinutes: nullable(int(1)),
    pointsAwarded: points,
    date: localDate,
    source: oneOf('SCHEDULED', 'MANUAL'),
    status: oneOf('ACTIVE', 'CANCELLED'),
    cancelledAt: nullable(iso),
    note: nullable(str),
    ...timestamps,
  },
  transactions: {
    id,
    skillId: id,
    completionId: nullable(id),
    delta,
    reason: oneOf('COMPLETION', 'CORRECTION', 'CANCELLATION', 'RESTORE'),
    createdAt: iso,
  },
  settings: { key: id, value: any },
  achievementUnlocks: { id, unlockedAt: iso, skillId: nullable(id), celebratedAt: nullable(iso), seenAt: nullable(iso) },
  marks: {
    id,
    skillId: id,
    title: title(MARK_TITLE_MAX),
    description: text(MARK_DESCRIPTION_MAX),
    date: localDate,
    flaskNumber: int(1),
    pointsInFlask: points,
    totalPoints: points,
    ...timestamps,
  },
  pauses: {
    id,
    skillId: id,
    from: localDate,
    until: nullable(localDate),
    createdAt: iso,
    endedAt: nullable(iso),
  },
};

/** Foreign keys checked after the shapes: [table, field, referenced table]; null is allowed only where the shape allows it. */
const REFERENCES: [string, string, string][] = [
  ['milestones', 'skillId', 'skills'],
  ['levelThresholds', 'skillId', 'skills'],
  ['steps', 'skillId', 'skills'],
  ['completions', 'skillId', 'skills'],
  ['completions', 'stepId', 'steps'],
  ['transactions', 'skillId', 'skills'],
  ['transactions', 'completionId', 'completions'],
  ['achievementUnlocks', 'skillId', 'skills'],
  ['marks', 'skillId', 'skills'],
  ['pauses', 'skillId', 'skills'],
];

/**
 * Rows whose skill must match the skill of the row they reference: [table, field, referenced
 * table]. A completion's points credited to another skill pass every other check.
 */
const SAME_SKILL: [string, string, string][] = [
  ['completions', 'stepId', 'steps'],
  ['transactions', 'completionId', 'completions'],
];

const corrupt = (path: string) => new BackupError(backupMessages.corrupt(path));

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function primaryKeyOf(tableName: string): string | string[] | null {
  const keyPath = db.table(tableName).schema.primKey.keyPath;
  return keyPath ?? null;
}

/**
 * Shape, uniqueness and referential checks of every row at the current schema version.
 * Throws BackupError «Файл повреждён: {table}[{i}].{field}» at the first problem.
 */
export function validateBackup(tables: Record<string, unknown[]>): void {
  const known = db.tables.map((t) => t.name);
  for (const name of Object.keys(tables)) {
    if (!known.includes(name)) throw corrupt(`tables.${name}`);
  }
  for (const name of known) {
    const rows = tables[name];
    if (!Array.isArray(rows)) throw corrupt(`tables.${name}`);
    const checks = ROW_CHECKS[name];
    if (!checks) throw new Error(`No row checks for table ${name}`);
    const keyPath = primaryKeyOf(name);
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (!isRecord(row)) throw corrupt(`${name}[${i}]`);
      for (const [field, check] of Object.entries(checks)) {
        if (!check(row[field])) throw corrupt(`${name}[${i}].${field}`);
      }
      if (keyPath) {
        const key = JSON.stringify(Array.isArray(keyPath) ? keyPath.map((k) => row[k]) : row[keyPath]);
        if (seen.has(key)) throw corrupt(`${name}[${i}].${Array.isArray(keyPath) ? keyPath.join('+') : keyPath}`);
        seen.add(key);
      }
    });
  }
  // A journal row outside a completion escapes verifyJournal's per-completion net check, so
  // only a CORRECTION may stand alone (none is written today): a hand-edited file cannot
  // credit points without a completion.
  (tables.transactions as Row[]).forEach((row, i) => {
    if (row.completionId === null && row.reason !== 'CORRECTION') throw corrupt(`transactions[${i}].completionId`);
  });
  // A pause ends on or after its first day; two pauses of a skill never share a day. `endedAt`
  // never changes which days are paused (domain/pause.ts): one on a pause without a last day
  // (only a hand-edited file, or an older build after the local date moved back) is dropped
  // rather than refused, so no copy the app wrote becomes unrestorable over it.
  const pausesBySkill = new Map<unknown, Row[]>();
  (tables.pauses as Row[]).forEach((row, i) => {
    if (row.until !== null && (row.until as string) < (row.from as string)) throw corrupt(`pauses[${i}].until`);
    if (row.endedAt !== null && row.until === null) row.endedAt = null;
    const list = pausesBySkill.get(row.skillId) ?? [];
    const overlaps = list.some((other) => (other.until === null || (other.until as string) >= (row.from as string)) && (row.until === null || (row.until as string) >= (other.from as string)));
    if (overlaps) throw corrupt(`pauses[${i}].from`);
    list.push(row);
    pausesBySkill.set(row.skillId, list);
  });
  for (const [table, field, target] of REFERENCES) {
    const ids = new Set((tables[target] as Row[]).map((row) => row.id));
    (tables[table] as Row[]).forEach((row, i) => {
      const value = row[field];
      if (value !== null && !ids.has(value)) throw corrupt(`${table}[${i}].${field}`);
    });
  }
  for (const [table, field, target] of SAME_SKILL) {
    const skillOf = new Map((tables[target] as Row[]).map((row) => [row.id, row.skillId]));
    (tables[table] as Row[]).forEach((row, i) => {
      const value = row[field];
      if (value !== null && skillOf.get(value) !== row.skillId) throw corrupt(`${table}[${i}].skillId`);
    });
  }
}

// ---- Migration ----

/**
 * Parses an untrusted object into a current-version backup: checks the envelope, replays the
 * row transforms of every schema version after the file's (the same pure functions the Dexie
 * upgrade runs, src/data/migrations/), then validates every row.
 */
export function migrateBackup(raw: unknown): BackupFile {
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError(backupMessages.notBackup);
  const version = raw.schemaVersion;
  if (!Number.isInteger(version) || (version as number) < 1) throw corrupt('schemaVersion');
  if ((version as number) > SCHEMA_VERSION) throw new BackupError(backupMessages.newer);
  if (typeof raw.exportedAt !== 'string' || !iso(raw.exportedAt)) throw corrupt('exportedAt');
  if (!isRecord(raw.tables)) throw corrupt('tables');

  // Rows are plain JSON; a deep copy keeps the caller's object untouched by the transforms.
  const tables = JSON.parse(JSON.stringify(raw.tables)) as Record<string, unknown[]>;
  for (const table of db.tables) {
    const since = TABLE_SINCE[table.name] ?? 1;
    if (since <= (version as number) && !Array.isArray(tables[table.name])) throw corrupt(`tables.${table.name}`);
  }
  for (let v = (version as number) + 1; v <= SCHEMA_VERSION; v++) {
    for (const table of db.tables) {
      if (TABLE_SINCE[table.name] === v) tables[table.name] ??= [];
    }
    for (const [table, transform] of Object.entries(MIGRATIONS[v] ?? {})) {
      const rows = tables[table];
      if (!Array.isArray(rows)) continue;
      rows.forEach((row, i) => {
        if (!isRecord(row)) throw corrupt(`${table}[${i}]`);
        (transform as (row: Row) => void)(row);
      });
    }
  }
  validateBackup(tables);
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
    exportedAt: raw.exportedAt,
    installId: typeof raw.installId === 'string' ? raw.installId : '',
    tables,
  };
}

/** Parses the text of a backup file (or a pasted copy) and migrates it. */
export function parseBackupText(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    throw new BackupError(backupMessages.notBackup);
  }
  return migrateBackup(raw);
}

// ---- Summary ----

export interface BackupStats {
  skills: number;
  /** ACTIVE completions; cancelled ones stay in the history but are not counted. */
  completions: number;
  /** Local date of the latest ACTIVE completion, null without one. */
  lastDate: string | null;
}

export function backupStats(file: BackupFile): BackupStats {
  const completions = (file.tables.completions ?? []) as { status?: unknown; date?: unknown }[];
  let count = 0;
  let lastDate: string | null = null;
  for (const c of completions) {
    if (c.status !== 'ACTIVE') continue;
    count += 1;
    if (typeof c.date === 'string' && (lastDate === null || c.date > lastDate)) lastDate = c.date;
  }
  return { skills: (file.tables.skills ?? []).length, completions: count, lastDate };
}

// ---- Import and wipe ----

/** Reads the device-bound settings rows to carry over a replace. */
async function deviceSettings(keys: readonly string[]) {
  return (await db.settings.bulkGet([...keys])).filter((row) => row !== undefined);
}

/**
 * Replaces everything on the device with the backup, in one transaction: every table is
 * cleared and refilled, device-bound settings are carried over, then the journal must verify
 * clean or the whole import rolls back. Import hooks (the achievement sync) run inside it.
 * Live queries re-render after the commit.
 */
export async function importBackup(file: BackupFile): Promise<BackupStats> {
  const now = nowIso();
  await db.transaction('rw', db.tables, async () => {
    const keep = await deviceSettings(DEVICE_SETTINGS);
    await Promise.all(db.tables.map((table) => table.clear()));
    for (const table of db.tables) {
      const all = file.tables[table.name] ?? [];
      const rows = table.name === 'settings' ? all.filter((row) => !isLocalOnly(row)) : all;
      if (rows.length) await table.bulkAdd(rows);
    }
    await db.settings.bulkDelete([...DEVICE_SETTINGS]);
    await db.settings.bulkPut(keep);
    const problems = await verifyJournal();
    if (problems.length) {
      console.warn('importBackup: journal problems', problems);
      throw new BackupError(backupMessages.rejected);
    }
    await runAfterImport({ now });
  });
  return backupStats(file);
}

/**
 * Settings that survive «Удалить все данные». The last cloud save (lastCloudBackup*, its
 * hash) does not: a cloud copy kept through the wipe no longer describes this device, so the
 * automatic backup treats it as someone else's and never replaces it silently.
 */
const WIPE_KEEPS = ['installId', 'cloudBackupEnabled', 'motion', 'appearance', 'askNote', 'todayDoneOpen'] as const satisfies readonly SettingKey[];

/** «Удалить все данные»: clears every table, keeping the install id and the device switches. */
export async function wipeAllData(): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', db.tables, async () => {
    const keep = await deviceSettings(WIPE_KEEPS);
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.settings.bulkPut(keep);
    await runAfterImport({ now });
  });
}
