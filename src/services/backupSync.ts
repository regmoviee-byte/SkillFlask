// Automatic backup to Telegram CloudStorage and the actions of the «Данные» settings group.
// Every committed write marks the data dirty and (re)starts a 30 s debounce; leaving the app
// (visibilitychange → hidden, Telegram `deactivated`) flushes at once. A save never runs
// during an import, a restore or a wipe, and the automatic one never replaces a cloud copy
// with an empty journal. Restore replaces the device's data («копия, а не синхронизация»).
//
// Ownership: the device remembers the hash of the copy it last saved or restored (setting
// `cloudBackupHash`). The automatic save only replaces that copy or an empty cloud; any other
// copy (another phone's, one kept through «Удалить все данные», one a failed start-up probe
// never offered) puts the status into 'conflict' and waits for the user: restore it, replace
// it with «Сохранить сейчас» after a confirmation, or delete it.

import { useSyncExternalStore } from 'react';
import { db } from '../data/db';
import { BackupError, exportBackup, importBackup, wipeAllData, type BackupStats } from '../data/backup';
import {
  cloud,
  CloudConflictError,
  deleteCloudBackup,
  loadBackupFromCloud,
  readCloudMeta,
  saveBackupToCloud,
  type CloudMeta,
} from '../platform/cloud';
import { logError } from '../platform/errorLog';
import { registerAfterCommitHook } from './afterWrite';
import { getSetting, setSetting } from './settings';

export const CLOUD_DEBOUNCE_MS = 30_000;
const RESTORE_OFFER_TIMEOUT_MS = 5_000;

/** 'conflict': the cloud holds a copy this device did not write; the automatic save waits. */
export type CloudState = 'unavailable' | 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export interface CloudStatus {
  state: CloudState;
  /** exportedAt of the last copy saved from (or restored to) this device. */
  lastAt: string | null;
  /** Encoded size of that copy in characters (= bytes, it is ASCII). */
  bytes: number | null;
  /** Error text of the last failed save. */
  message?: string;
  progress?: { done: number; total: number };
  /** The «Хранить копию в облаке Telegram» switch; on by default inside Telegram. */
  enabled: boolean;
  /**
   * Meta of the copy currently in the cloud: undefined until read (or when reading failed,
   * see remoteError), null when there is certainly none.
   */
  remote?: CloudMeta | null;
  /** Why the last read of the cloud meta failed; the copy may still be there. */
  remoteError?: string;
}

const INITIAL: CloudStatus = { state: 'unavailable', lastAt: null, bytes: null, enabled: false };

let status: CloudStatus = INITIAL;
const listeners = new Set<() => void>();

function update(patch: Partial<CloudStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const getCloudStatus = (): CloudStatus => status;

export function useCloudStatus(): CloudStatus {
  return useSyncExternalStore(subscribe, getCloudStatus, getCloudStatus);
}

// ---- Scheduler ----

let ready = false;
/** > 0 while an import, a restore or a wipe replaces the data. */
let suspended = 0;
/** Writes committed since the last save started. */
let pending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<CloudMeta | null> | null = null;
let teardown: (() => void) | null = null;
/** Hash of the cloud copy this device saved or restored last (setting `cloudBackupHash`). */
let ownedHash: string | null = null;
/** Hash of a save whose meta write was sent but not confirmed: it may have landed. */
let attemptedHash: string | null = null;

const ownsCopy = (h: string | null) => h !== null && (h === ownedHash || h === attemptedHash);

async function setOwnedCopy(meta: CloudMeta | null): Promise<void> {
  ownedHash = meta?.h ?? null;
  attemptedHash = null;
  await setSetting('cloudBackupHash', ownedHash);
  await setSetting('lastCloudBackupAt', meta?.at ?? null);
  await setSetting('lastCloudBackupBytes', meta?.len ?? null);
}

const idleState = (): CloudState => (status.lastAt ? 'saved' : 'idle');

function onVisibility(): void {
  if (document.visibilityState === 'hidden') void flushCloudBackup();
}

/** Called once after the database opened (DbBoundary); loads the switch and the last save. */
export async function initCloudBackup(): Promise<void> {
  if (ready) return;
  ready = true;
  const offHook = registerAfterCommitHook(scheduleCloudBackup);
  document.addEventListener('visibilitychange', onVisibility);
  teardown = () => {
    offHook();
    document.removeEventListener('visibilitychange', onVisibility);
  };
  if (!cloud.available()) {
    update({ ...INITIAL });
    return;
  }
  const [enabled, lastAt, bytes, hash] = await Promise.all([
    getSetting('cloudBackupEnabled', true),
    getSetting<string | null>('lastCloudBackupAt', null),
    getSetting<number | null>('lastCloudBackupBytes', null),
    getSetting<string | null>('cloudBackupHash', null),
  ]);
  ownedHash = hash;
  update({ state: lastAt ? 'saved' : 'idle', enabled, lastAt, bytes });
}

/** Test hook: forget everything the module learned and registered. */
export function resetCloudBackup(): void {
  clearTimeout(timer);
  teardown?.();
  teardown = null;
  ready = false;
  suspended = 0;
  pending = false;
  running = null;
  ownedHash = null;
  attemptedHash = null;
  status = INITIAL;
}

const autoSaveAllowed = () => ready && suspended === 0 && status.enabled && status.state !== 'unavailable';

/** The afterWrite hook: marks the data dirty and restarts the 30 s debounce. */
export function scheduleCloudBackup(): void {
  if (!autoSaveAllowed()) return;
  pending = true;
  // A foreign copy in the cloud: nothing is saved until the user resolves it.
  if (status.state === 'conflict') return;
  if (status.state !== 'saving') update({ state: 'dirty', message: undefined });
  clearTimeout(timer);
  timer = setTimeout(() => void flushCloudBackup(), CLOUD_DEBOUNCE_MS);
}

/** Saves now if there are unsaved changes (leaving the app, the debounce firing). */
export async function flushCloudBackup(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (!pending || !autoSaveAllowed() || status.state === 'conflict') return;
  // A failure is already in the status and the error log; the next write or pause retries.
  await save(true).catch(() => {});
}

async function save(auto: boolean, overwrite = false): Promise<CloudMeta | null> {
  while (running) await running.catch(() => {});
  if (auto && (!pending || !autoSaveAllowed() || status.state === 'conflict')) return null;
  running = runSave(auto, overwrite);
  try {
    return await running;
  } finally {
    running = null;
  }
}

async function runSave(auto: boolean, overwrite: boolean): Promise<CloudMeta | null> {
  pending = false;
  update({ state: 'saving', progress: undefined, message: undefined });
  try {
    const file = await exportBackup();
    // An emptied journal (all skills deleted, a wipe that kept the cloud copy) never
    // overwrites the copy automatically; «Сохранить сейчас» still can.
    if (auto && file.tables.skills.length === 0) {
      update({ state: pending ? 'dirty' : idleState() });
      return null;
    }
    const meta = await saveBackupToCloud(file, {
      onProgress: (done, total) => update({ progress: { done, total } }),
      // Only the copy this device wrote (or an empty cloud) is replaced without asking.
      canReplace: overwrite ? undefined : ownsCopy,
      onMetaWrite: (h) => {
        attemptedHash = h;
      },
    });
    await setOwnedCopy(meta);
    update({ state: pending ? 'dirty' : 'saved', lastAt: meta.at, bytes: meta.len, progress: undefined, remote: meta, remoteError: undefined });
    return meta;
  } catch (error) {
    pending = true;
    if (error instanceof CloudConflictError) {
      // Not a failure: the save waits for the user (Settings shows the copy found).
      update({ state: 'conflict', progress: undefined, remote: error.remote ?? undefined, remoteError: undefined });
      throw error;
    }
    logError(error, 'cloud backup');
    update({ state: 'error', message: error instanceof Error ? error.message : String(error), progress: undefined });
    throw error;
  }
}

// ---- Actions ----

/**
 * «Сохранить сейчас»: saves even an empty journal; throws what went wrong. A copy this device
 * did not write is replaced only with `overwrite` (the caller asks first): without it the
 * call throws CloudConflictError.
 */
export async function cloudBackupNow({ overwrite = false }: { overwrite?: boolean } = {}): Promise<CloudMeta> {
  clearTimeout(timer);
  timer = undefined;
  pending = true;
  return (await save(false, overwrite))!;
}

/**
 * Reads the meta of the cloud copy into the status (Settings shows its date and size) and
 * notices a copy this device did not write. Undefined when the read failed: that is not «no
 * copy», and the status keeps the reason in remoteError.
 */
export async function refreshCloudMeta(): Promise<CloudMeta | null | undefined> {
  if (!cloud.available()) return null;
  try {
    const meta = await readCloudMeta();
    update({ remote: meta, remoteError: undefined });
    const foreign = meta !== null && !ownsCopy(meta.h);
    if (foreign && ['idle', 'saved', 'dirty'].includes(status.state)) {
      clearTimeout(timer);
      timer = undefined;
      update({ state: 'conflict' });
    } else if (!foreign && status.state === 'conflict') {
      // The other copy is gone or was ours after all: carry on saving.
      update({ state: idleState() });
      if (pending) scheduleCloudBackup();
    }
    return meta;
  } catch (error) {
    logError(error, 'cloud meta');
    update({ remote: undefined, remoteError: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/** Runs `fn` with the automatic backup held off (imports, restores, wipes). */
export async function withCloudBackupSuspended<T>(fn: () => Promise<T>): Promise<T> {
  suspended += 1;
  clearTimeout(timer);
  timer = undefined;
  try {
    while (running) await running.catch(() => {});
    return await fn();
  } finally {
    suspended -= 1;
  }
}

export const restoreMessages = {
  changed: 'Копия в облаке только что обновилась — проверьте её дату и повторите',
} as const;

/**
 * Replaces the data on the device with the cloud copy. Reads, verifies and migrates it and
 * asks nothing: the caller confirms first. `confirmed` is the meta the user agreed to; if a
 * save replaced the copy meanwhile (the debounce fired behind the dialog), nothing happens.
 */
export async function cloudRestore(confirmed?: CloudMeta): Promise<BackupStats> {
  const hadPending = pending;
  pending = false;
  try {
    return await withCloudBackupSuspended(async () => {
      const { meta, file } = await loadBackupFromCloud();
      if (confirmed && meta.h !== confirmed.h) {
        update({ remote: meta });
        throw new BackupError(restoreMessages.changed);
      }
      const stats = await importBackup(file);
      // The device now holds exactly this copy: the automatic save may replace it again.
      await setOwnedCopy(meta);
      await setSetting('restoreOfferShown', true);
      if (status.state !== 'unavailable') update({ state: 'saved', lastAt: meta.at, bytes: meta.len, remote: meta, remoteError: undefined, message: undefined });
      return stats;
    });
  } catch (error) {
    pending = hadPending;
    throw error;
  }
}

/** «Удалить копию из облака»; `disable` also turns the automatic copy off. */
export async function cloudDelete({ disable = false }: { disable?: boolean } = {}): Promise<void> {
  await withCloudBackupSuspended(async () => {
    await deleteCloudBackup();
    await setOwnedCopy(null);
    if (disable) await setSetting('cloudBackupEnabled', false);
  });
  pending = false;
  update({ state: status.state === 'unavailable' ? 'unavailable' : 'idle', lastAt: null, bytes: null, remote: null, remoteError: undefined, message: undefined, ...(disable ? { enabled: false } : {}) });
}

export async function setCloudBackupEnabled(on: boolean): Promise<void> {
  await setSetting('cloudBackupEnabled', on);
  update({ enabled: on });
  if (on) {
    // Bring the copy up to date with whatever changed while it was off.
    scheduleCloudBackup();
  } else {
    clearTimeout(timer);
    timer = undefined;
    pending = false;
    if (status.state !== 'unavailable') update({ state: idleState(), message: undefined, progress: undefined });
  }
}

/** After a file import: the cloud copy is stale now. */
export function markCloudDirty(): void {
  scheduleCloudBackup();
}

/**
 * «Удалить все данные»: wipes the device and, when asked, the cloud copy. A kept copy stops
 * being this device's (the wipe drops cloudBackupHash): it is offered on the next empty start
 * and the automatic save never replaces it.
 */
export async function deleteAllData({ cloud: alsoCloud }: { cloud: boolean }): Promise<void> {
  pending = false;
  await withCloudBackupSuspended(() => wipeAllData());
  ownedHash = null;
  attemptedHash = null;
  if (alsoCloud) await cloudDelete();
  else if (status.state !== 'unavailable') {
    clearTimeout(timer);
    timer = undefined;
    update({ state: status.remote ? 'conflict' : 'idle', lastAt: null, bytes: null, message: undefined });
  }
}

// ---- Restore offer on an empty start ----

/**
 * The cloud copy to offer on start: only inside Telegram with CloudStorage, on an empty
 * database, and once per install (setting `restoreOfferShown`). Never restores by itself.
 * A slow or failing CloudStorage gives up after 5 s so the app still starts; that is not
 * «no copy»: restoreOfferShown stays unset so the next empty start asks again, and the
 * automatic save checks the cloud itself before writing (a copy it finds is a conflict).
 */
export async function findRestoreOffer(): Promise<CloudMeta | null> {
  if (!cloud.available()) return null;
  if ((await db.skills.count()) > 0) return null;
  if (await getSetting('restoreOfferShown', false)) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readCloudMeta(),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), RESTORE_OFFER_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    logError(error, 'restore offer');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * «Начать с чистого листа»: the offer is not shown again, and the declined copy becomes this
 * device's to replace (the dialog said the first change replaces it).
 */
export async function dismissRestoreOffer(declined?: CloudMeta): Promise<void> {
  await setSetting('restoreOfferShown', true);
  if (declined) {
    ownedHash = declined.h;
    await setSetting('cloudBackupHash', declined.h);
  }
}
