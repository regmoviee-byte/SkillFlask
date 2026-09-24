import Dexie from 'dexie';
import { db, SCHEMA_VERSION } from './db';

export type OpenResult =
  | { ok: true }
  | { ok: false; kind: 'version' | 'quota' | 'blocked' | 'unknown'; message: string };

export const PREMIGRATION_KEY = 'sf_premigration_v1';

export const openMessages = {
  version: 'Данные созданы более новой версией приложения. Обновите приложение или восстановите резервную копию.',
  quota: 'Недостаточно места на устройстве',
  blocked: 'Хранилище недоступно (приватный режим?)',
  otherTab: 'Приложение обновилось в другой вкладке — перезагрузите',
  // Shown under the «Не удалось открыть данные» title, so it reads as the next step.
  unknown: 'Попробуйте перезагрузить приложение',
} as const;

/**
 * Dumps every table of an existing schema-v1 database to JSON (null when the database does
 * not exist or is already newer). Stored in localStorage before the first v2 upgrade as a
 * last-resort copy of the owner's journal.
 */
export async function snapshotV1(name: string): Promise<string | null> {
  if (!(await Dexie.exists(name))) return null;
  // A Dexie without version declarations opens in dynamic mode and reads the stored schema.
  const probe = new Dexie(name);
  try {
    await probe.open();
    if (probe.verno !== 1) return null;
    const tables: Record<string, unknown[]> = {};
    for (const table of probe.tables) tables[table.name] = await table.toArray();
    return JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), tables });
  } finally {
    probe.close();
  }
}

function classify(error: unknown): Exclude<OpenResult, { ok: true }> {
  const name = error instanceof Error ? error.name : '';
  if (name === 'VersionError') return { ok: false, kind: 'version', message: openMessages.version };
  if (name === 'QuotaExceededError') return { ok: false, kind: 'quota', message: openMessages.quota };
  if (name === 'OpenFailedError' || name === 'InvalidStateError' || name === 'MissingAPIError' || name === 'UnknownError') {
    return { ok: false, kind: 'blocked', message: openMessages.blocked };
  }
  // The raw (English) Dexie message is for the console, the user always sees Russian copy.
  console.error('openDb failed', error);
  return { ok: false, kind: 'unknown', message: openMessages.unknown };
}

let closedListener: ((message: string) => void) | undefined;

function onVersionChange(): false {
  // Another tab upgraded the schema: stop using the stale connection and ask for a reload.
  // Returning false skips Dexie's default handler, which would reopen the connection.
  db.close();
  closedListener?.(openMessages.otherTab);
  return false;
}

/**
 * Opens the database with a pre-migration snapshot and human-readable failures.
 * `onClosed` fires when another tab upgraded the database (versionchange) and this one had
 * to close; the UI should ask for a reload.
 */
export async function openDb(onClosed?: (message: string) => void): Promise<OpenResult> {
  try {
    const snapshot = await snapshotV1(db.name);
    if (snapshot) {
      try {
        localStorage.setItem(PREMIGRATION_KEY, snapshot);
      } catch {
        // Quota or private mode: the snapshot is best-effort.
      }
    }
  } catch {
    // Probing must never prevent the real open.
  }

  closedListener = onClosed;
  db.on('versionchange').unsubscribe(onVersionChange);
  db.on('versionchange', onVersionChange);

  try {
    await db.open();
  } catch (error) {
    return classify(error);
  }
  // Dexie 4 silently reopens a database written by a newer app version in dynamic mode;
  // the native version (Dexie stores schemaVersion × 10) tells the truth.
  if (db.backendDB().version / 10 > SCHEMA_VERSION) {
    db.close();
    return { ok: false, kind: 'version', message: openMessages.version };
  }
  return { ok: true };
}
