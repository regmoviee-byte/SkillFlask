// The backup as a file, for the browser and as a second copy inside Telegram. Export walks a
// cascade until something works: a download link outside Telegram; inside it the share sheet
// with a file, then the clipboard, then the text itself for the user to copy by hand. Telegram
// iOS neither downloads blob: nor data: links, so they are never used inside Telegram.
// Import parses and migrates first (the UI shows a preview), then replaces after a confirm.

import { exportBackup, importBackup, parseBackupText, type BackupFile, type BackupStats } from '../data/backup';
import { diffDays, localDate, nowIso } from '../lib/dates';
import { copyText } from '../platform/clipboard';
import { isTelegram } from '../platform/telegram';
import { markCloudDirty, withCloudBackupSuspended } from './backupSync';
import { setSetting } from './settings';

export type ExportOutcome =
  | { kind: 'download' }
  | { kind: 'share' }
  /** Copied as text; `kb` is the size for the toast. */
  | { kind: 'clipboard'; kb: number }
  /** Nothing else worked: show the text in a read-only field. */
  | { kind: 'text'; text: string; name: string }
  /** The user closed the share sheet. */
  | { kind: 'cancelled' };

export const SHARE_TITLE = 'Резервная копия Skill Flask';

export function backupFileName(date: string = localDate()): string {
  return `skill-flask-${date}.json`;
}

function download(json: string, name: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function share(json: string, name: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (typeof navigator.share !== 'function' || typeof File !== 'function') return 'unsupported';
  const file = new File([json], name, { type: 'application/json' });
  if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await navigator.share({ files: [file], title: SHARE_TITLE });
    return 'shared';
  } catch (error) {
    // AbortError: the user closed the sheet. Anything else (no user activation left after
    // reading the database, a WebView quirk) falls through to the clipboard.
    return error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

/** Saves the backup the best way this platform allows; see ExportOutcome. */
export async function exportToFile(): Promise<ExportOutcome> {
  const json = JSON.stringify(await exportBackup());
  const name = backupFileName();
  const saved = async <T extends ExportOutcome>(outcome: T): Promise<T> => {
    await setSetting('lastFileBackupAt', nowIso());
    return outcome;
  };

  if (!isTelegram()) {
    download(json, name);
    return saved({ kind: 'download' });
  }
  const shared = await share(json, name);
  if (shared === 'shared') return saved({ kind: 'share' });
  if (shared === 'cancelled') return { kind: 'cancelled' };
  if (await copyText(json)) return saved({ kind: 'clipboard', kb: Math.max(1, Math.round(json.length / 1024)) });
  return { kind: 'text', text: json, name };
}

/** Parses a chosen file or pasted text into a current-version backup (throws BackupError). */
export async function readBackupFile(file: Blob): Promise<BackupFile> {
  return parseBackupText(await file.text());
}

export { parseBackupText };

/** Replaces the data on the device with the backup; the cloud copy follows 30 s later. */
export async function importFromFile(file: BackupFile): Promise<BackupStats> {
  const stats = await withCloudBackupSuspended(() => importBackup(file));
  markCloudDirty();
  return stats;
}

/** A file copy is suggested in the browser once the newest backup is older than this. */
export const FILE_REMINDER_DAYS = 7;

/**
 * The browser's «скачайте файл» reminder: days since the newer of the last file and cloud
 * backup when that is more than 7 days ago, 'never' when there is no backup but at least one
 * completion, null otherwise.
 */
export function fileBackupReminder(
  lastFileAt: string | null,
  lastCloudAt: string | null,
  completions: number,
  today: string = localDate(),
): number | 'never' | null {
  const latest = [lastFileAt, lastCloudAt].filter((at): at is string => Boolean(at)).sort().at(-1);
  if (!latest) return completions > 0 ? 'never' : null;
  const days = diffDays(localDate(new Date(latest)), today);
  return days > FILE_REMINDER_DAYS ? days : null;
}
