import { db } from '../data/db';
import { newId } from '../lib/ids';

export type SettingKey =
  | 'storagePersistRequested'
  | 'lastCloudBackupAt'
  | 'lastFileBackupAt'
  | 'cloudBackupEnabled'
  | 'restoreOfferShown'
  | 'motion'
  | 'coachTodaySeen'
  | 'installId';

/** Reads a setting; `installId` is generated on first read so every install has a stable id. */
export async function getSetting<T>(key: SettingKey, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  if (row) return row.value as T;
  if (key === 'installId') {
    const value = newId() as unknown as T;
    await db.settings.put({ key, value });
    return value;
  }
  return fallback;
}

export async function setSetting(key: SettingKey, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
