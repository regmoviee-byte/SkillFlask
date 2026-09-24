// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../data/db';
import { exportBackup, wipeAllData } from '../data/backup';
import { CloudConflictError, META_KEY, readCloudMeta, saveBackupToCloud } from '../platform/cloud';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { installFreshDb } from '../test/harness';
import {
  CLOUD_DEBOUNCE_MS,
  cloudBackupNow,
  cloudDelete,
  cloudRestore,
  deleteAllData,
  dismissRestoreOffer,
  findRestoreOffer,
  getCloudStatus,
  initCloudBackup,
  refreshCloudMeta,
  resetCloudBackup,
  setCloudBackupEnabled,
} from './backupSync';
import { getSetting } from './settings';
import { createSkill, deleteSkill, type SkillInput } from './skills';

installFreshDb();

let fake: FakeTelegram | undefined;
beforeEach(() => {
  fake = installFakeTelegram('7.10');
});
afterEach(() => {
  resetCloudBackup();
  vi.useRealTimers();
  fake?.uninstall();
  fake = undefined;
});

const skill = (name: string): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Главная цель',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 50,
  manualCapacities: [],
});

const metaWrites = () => fake!.cloud.log.filter((line) => line === `set ${META_KEY}`).length;

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * Lets pending IndexedDB work and CloudStorage callbacks run without moving the fake clock
 * (setImmediate is not faked), then waits for a save in flight to end.
 */
const { setImmediate: nextTask } = globalThis as unknown as { setImmediate(cb: () => void): void };
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise<void>((resolve) => nextTask(resolve));
  await vi.waitFor(() => expect(getCloudStatus().state).not.toBe('saving'), { timeout: 3000 });
}

describe('automatic backup', () => {
  beforeEach(() => {
    // Only the debounce timer is faked: fake-indexeddb and the fake cloud keep running.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => setVisibility('visible'));

  it('starts idle and enabled inside Telegram', async () => {
    await initCloudBackup();
    expect(getCloudStatus()).toMatchObject({ state: 'idle', enabled: true, lastAt: null });
  });

  it('saves 30 s after the last write', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    expect(getCloudStatus().state).toBe('dirty');

    await vi.advanceTimersByTimeAsync(20_000);
    await createSkill(skill('Спорт')); // restarts the debounce
    await vi.advanceTimersByTimeAsync(20_000);
    expect(metaWrites()).toBe(0);

    await vi.advanceTimersByTimeAsync(CLOUD_DEBOUNCE_MS - 20_000);
    await vi.waitFor(() => expect(getCloudStatus().state).toBe('saved'), { timeout: 3000 });
    expect(metaWrites()).toBe(1);
    const status = getCloudStatus();
    expect(status.state).toBe('saved');
    expect(status.bytes).toBeGreaterThan(0);
    expect(await getSetting('lastCloudBackupAt', null)).toBe(status.lastAt);
    expect(await readCloudMeta()).toMatchObject({ skills: 2 });
  });

  it('flushes at once when the app goes to the background', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    expect(metaWrites()).toBe(0);
    setVisibility('hidden');
    await vi.waitFor(() => expect(getCloudStatus().state).toBe('saved'), { timeout: 3000 });
    expect(metaWrites()).toBe(1);
    // Nothing new: a second pause writes nothing.
    setVisibility('visible');
    setVisibility('hidden');
    await settle();
    expect(metaWrites()).toBe(1);
  });

  it('does nothing while switched off', async () => {
    await initCloudBackup();
    await setCloudBackupEnabled(false);
    await createSkill(skill('Английский'));
    expect(getCloudStatus()).toMatchObject({ state: 'idle', enabled: false });
    await vi.advanceTimersByTimeAsync(CLOUD_DEBOUNCE_MS);
    setVisibility('hidden');
    await settle();
    expect(metaWrites()).toBe(0);
    expect(await getSetting('cloudBackupEnabled', true)).toBe(false);
  });

  it('never replaces a copy with an empty journal automatically', async () => {
    await initCloudBackup();
    const id = await createSkill(skill('Английский'));
    await cloudBackupNow();
    await deleteSkill(id);
    setVisibility('hidden');
    await settle();
    expect(metaWrites()).toBe(1);
    expect(await readCloudMeta()).toMatchObject({ skills: 1 });
    // Settings must not claim the cloud matches the device.
    expect(getCloudStatus().state).toBe('dirty');
  });

  it('reports a failed save and retries on the next pause', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    fake!.cloud.failNext = { method: 'setItem', error: 'QUOTA_EXCEEDED' };
    setVisibility('hidden');
    await vi.waitFor(() => expect(getCloudStatus().state).toBe('error'), { timeout: 3000 });
    expect(getCloudStatus().message).toContain('QUOTA_EXCEEDED');
    setVisibility('visible');
    setVisibility('hidden');
    await vi.waitFor(() => expect(getCloudStatus().state).toBe('saved'), { timeout: 3000 });
  });

  it('is unavailable outside Telegram and below Bot API 6.9', async () => {
    fake!.uninstall();
    await initCloudBackup();
    expect(getCloudStatus().state).toBe('unavailable');
    await createSkill(skill('Английский'));
    expect(getCloudStatus().state).toBe('unavailable');
    resetCloudBackup();
    fake = installFakeTelegram('6.2');
    await initCloudBackup();
    expect(getCloudStatus().state).toBe('unavailable');
  });
});

describe('a cloud copy this device did not write', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => setVisibility('visible'));

  /** A copy saved by «another device»: straight to the cloud, then the local data goes. */
  async function foreignCopy(...names: string[]) {
    for (const name of names) await createSkill(skill(name));
    const meta = await saveBackupToCloud(await exportBackup());
    await wipeAllData();
    fake!.cloud.log.length = 0;
    return meta;
  }

  it('is kept through «Удалить все данные» → «Оставить копию» and a new skill', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    await createSkill(skill('Спорт'));
    const kept = await cloudBackupNow();
    await deleteAllData({ cloud: false });
    expect(await getSetting('cloudBackupHash', null)).toBeNull();

    await createSkill(skill('Новый'));
    setVisibility('hidden');
    await settle();
    expect(metaWrites()).toBe(1); // only the save before the wipe
    expect(await readCloudMeta()).toEqual(kept);
    expect(getCloudStatus()).toMatchObject({ state: 'conflict', remote: kept });

    // Later writes wait too; the next empty start offers the copy again.
    await createSkill(skill('Ещё один'));
    expect(getCloudStatus().state).toBe('conflict');
    await vi.advanceTimersByTimeAsync(CLOUD_DEBOUNCE_MS);
    await settle();
    expect(metaWrites()).toBe(1);
    await wipeAllData();
    expect(await findRestoreOffer()).toEqual(kept);
  });

  it('is kept on a fresh device whose start-up probe failed', async () => {
    const theirs = await foreignCopy('Английский', 'Спорт');
    fake!.cloud.failNext = { method: 'getItem', error: 'SERVER_ERROR' };
    expect(await findRestoreOffer()).toBeNull();
    expect(await getSetting('restoreOfferShown', false)).toBe(false);

    await initCloudBackup();
    await createSkill(skill('Первый навык'));
    await vi.advanceTimersByTimeAsync(CLOUD_DEBOUNCE_MS);
    await settle();
    expect(metaWrites()).toBe(0);
    expect(await readCloudMeta()).toEqual(theirs);
    expect(getCloudStatus()).toMatchObject({ state: 'conflict', remote: theirs });

    // The user can still take it, and then the device owns it.
    await cloudRestore(theirs);
    expect(await db.skills.count()).toBe(2);
    await createSkill(skill('После восстановления'));
    setVisibility('hidden');
    await settle();
    expect(metaWrites()).toBe(1);
    expect(await readCloudMeta()).toMatchObject({ skills: 3 });
  });

  it('written by another phone meanwhile is not replaced by the automatic save', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    await cloudBackupNow();
    // The other phone replaced the copy with «Сохранить сейчас» (it had asked its user).
    const other = await saveBackupToCloud({ ...(await exportBackup()), exportedAt: '2026-09-25T08:00:00.000Z' });
    await createSkill(skill('Спорт'));
    setVisibility('hidden');
    await settle();
    expect(await readCloudMeta()).toEqual(other);
    expect(getCloudStatus().state).toBe('conflict');

    // «Сохранить сейчас» refuses without the user's yes, replaces with it.
    await expect(cloudBackupNow()).rejects.toBeInstanceOf(CloudConflictError);
    expect(await readCloudMeta()).toEqual(other);
    const mine = await cloudBackupNow({ overwrite: true });
    expect(mine.skills).toBe(2);
    expect(getCloudStatus().state).toBe('saved');
    expect(await getSetting('cloudBackupHash', null)).toBe(mine.h);
  });

  it('is noticed by a refresh, and the conflict ends once the copy is gone', async () => {
    const theirs = await foreignCopy('Английский');
    await initCloudBackup();
    await createSkill(skill('Мой'));
    await refreshCloudMeta();
    expect(getCloudStatus()).toMatchObject({ state: 'conflict', remote: theirs });
    fake!.cloud.store.delete(META_KEY);
    await refreshCloudMeta();
    expect(getCloudStatus()).toMatchObject({ state: 'dirty', remote: null });
    await vi.advanceTimersByTimeAsync(CLOUD_DEBOUNCE_MS);
    await settle();
    expect(await readCloudMeta()).toMatchObject({ skills: 1 });
  });

  it('becomes replaceable when the user starts fresh from the offer', async () => {
    const declined = await foreignCopy('Английский');
    await initCloudBackup();
    const offer = await findRestoreOffer();
    expect(offer).toEqual(declined);
    await dismissRestoreOffer(offer!);
    await createSkill(skill('С чистого листа'));
    setVisibility('hidden');
    await settle();
    expect(await readCloudMeta()).toMatchObject({ skills: 1 });
    expect((await readCloudMeta())?.h).not.toBe(declined.h);
  });

  it('keeps an unreadable meta apart from «no copy»', async () => {
    await foreignCopy('Английский');
    await initCloudBackup();
    fake!.cloud.failNext = { method: 'getItem', error: 'SERVER_ERROR' };
    expect(await refreshCloudMeta()).toBeUndefined();
    expect(getCloudStatus().remote).toBeUndefined();
    expect(getCloudStatus().remoteError).toContain('SERVER_ERROR');
    expect(await refreshCloudMeta()).toMatchObject({ skills: 1 });
    expect(getCloudStatus().remoteError).toBeUndefined();
  });
});

describe('restore and delete', () => {
  it('restores the cloud copy over the local data', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    await cloudBackupNow();
    await wipeAllData();
    await createSkill(skill('Локальный'));

    const stats = await cloudRestore();
    expect(stats.skills).toBe(1);
    expect((await db.skills.toArray()).map((s) => s.name)).toEqual(['Английский']);
    expect(getCloudStatus().state).toBe('saved');
    expect(await getSetting('restoreOfferShown', false)).toBe(true);
    // The restore itself scheduled nothing.
    expect(getCloudStatus().state).not.toBe('dirty');
  });

  it('refuses to restore a copy other than the confirmed one', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    const confirmed = await cloudBackupNow();
    await createSkill(skill('Спорт'));
    await cloudBackupNow(); // e.g. the debounce fired while the confirm dialog was open
    await expect(cloudRestore(confirmed)).rejects.toThrow('Копия в облаке только что обновилась');
    expect(await db.skills.count()).toBe(2);
    expect(getCloudStatus().remote).toMatchObject({ skills: 2 });
  });

  it('deletes the copy and can switch the automatic copy off', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    await cloudBackupNow();
    await cloudDelete({ disable: true });
    expect(await readCloudMeta()).toBeNull();
    expect(getCloudStatus()).toMatchObject({ state: 'idle', lastAt: null, enabled: false, remote: null });
  });

  it('wipes the device and, when asked, the cloud copy', async () => {
    await initCloudBackup();
    await createSkill(skill('Английский'));
    await cloudBackupNow();
    await deleteAllData({ cloud: false });
    expect(await db.skills.count()).toBe(0);
    expect(await readCloudMeta()).not.toBeNull();
    await deleteAllData({ cloud: true });
    expect(await readCloudMeta()).toBeNull();
  });
});

describe('restore offer', () => {
  async function seedCloudCopy(): Promise<void> {
    await createSkill(skill('Английский'));
    await saveBackupToCloud(await exportBackup());
    await wipeAllData();
  }

  it('is offered on an empty database when the cloud holds a copy', async () => {
    expect(await findRestoreOffer()).toBeNull();
    await seedCloudCopy();
    expect(await findRestoreOffer()).toMatchObject({ skills: 1 });
  });

  it('is offered once', async () => {
    await seedCloudCopy();
    await dismissRestoreOffer();
    expect(await findRestoreOffer()).toBeNull();
  });

  it('is not offered with local data or outside Telegram', async () => {
    await seedCloudCopy();
    await createSkill(skill('Локальный'));
    expect(await findRestoreOffer()).toBeNull();
    await wipeAllData();
    fake!.uninstall();
    expect(await findRestoreOffer()).toBeNull();
  });
});
