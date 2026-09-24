// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportBackup } from '../data/backup';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { installFreshDb, withClock } from '../test/harness';
import { completeStep } from '../services/completions';
import { createSkill } from '../services/skills';
import { createStep } from '../services/steps';
import {
  CHUNK_SIZE,
  chunkKey,
  cloud,
  CloudConflictError,
  cloudMessages,
  decodePayload,
  deleteCloudBackup,
  encodePayload,
  loadBackupFromCloud,
  MAX_CHUNKS,
  META_KEY,
  readCloudMeta,
  readCloudPayload,
  saveBackupToCloud,
  writeCloudPayload,
  type PayloadInfo,
} from './cloud';

installFreshDb();

let fake: FakeTelegram | undefined;
afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  vi.unstubAllGlobals();
});

const info: PayloadInfo = { at: '2026-09-24T11:02:00.000Z', enc: 'json', schemaVersion: 2, skills: 3, completions: 812 };

/** Pseudo-random ASCII that neither compresses nor repeats, so every chunk is distinct. */
function payloadOf(length: number, seed = 1): string {
  let x = seed;
  let out = '';
  while (out.length < length) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out += String.fromCharCode(33 + (x % 90));
  }
  return out;
}

describe('availability', () => {
  it('needs Telegram with Bot API 6.9', async () => {
    expect(cloud.available()).toBe(false);
    fake = installFakeTelegram('6.2');
    expect(cloud.available()).toBe(false);
    // Below 6.9 the SDK methods would throw; the wrapper rejects instead.
    await expect(cloud.getItem(META_KEY)).rejects.toThrow(cloudMessages.unavailable);
    fake.uninstall();
    fake = installFakeTelegram('6.9');
    expect(cloud.available()).toBe(true);
    expect(await cloud.getItem('missing')).toBe('');
  });
});

describe('chunked payload', () => {
  it('round-trips 1.5 MB within the key and value limits, meta written last', async () => {
    fake = installFakeTelegram('7.10');
    const payload = payloadOf(1_500_000);
    const progress: number[] = [];
    const meta = await writeCloudPayload(payload, info, { onProgress: (done) => progress.push(done) });

    expect(meta.n).toBe(Math.ceil(payload.length / CHUNK_SIZE));
    expect(progress.at(-1)).toBe(meta.n);
    expect(fake.cloud.store.size).toBeLessThan(1024);
    for (const value of fake.cloud.store.values()) expect(value.length).toBeLessThanOrEqual(4096);
    const sets = fake.cloud.log.filter((line) => line.startsWith('set '));
    expect(sets.at(-1)).toBe(`set ${META_KEY}`);
    expect(sets.filter((line) => line === `set ${META_KEY}`)).toHaveLength(1);

    const read = await readCloudPayload();
    expect(read.payload).toBe(payload);
    expect(read.meta).toEqual(meta);
  });

  it('alternates slots and removes the previous copy after the meta switched', async () => {
    fake = installFakeTelegram('7.10');
    const first = await writeCloudPayload(payloadOf(20_000, 1), info);
    const second = await writeCloudPayload(payloadOf(9_000, 2), info);
    expect(first.slot).toBe('a');
    expect(second.slot).toBe('b');
    expect([...fake.cloud.store.keys()].sort()).toEqual([META_KEY, chunkKey('b', 0), chunkKey('b', 1), chunkKey('b', 2)].sort());
    const metaSet = fake.cloud.log.indexOf(`set ${META_KEY}`, fake.cloud.log.indexOf(`set ${chunkKey('b', 2)}`));
    expect(fake.cloud.log.indexOf(`remove ${chunkKey('a', 0)}`)).toBeGreaterThan(metaSet);
    expect((await readCloudPayload()).payload).toBe(payloadOf(9_000, 2));
  });

  it('keeps the previous copy readable when a save is interrupted', async () => {
    fake = installFakeTelegram('7.10');
    await writeCloudPayload(payloadOf(30_000, 1), info);
    const setItem = fake.tg.CloudStorage.setItem;
    let calls = 0;
    fake.tg.CloudStorage.setItem = (key, value, cb) => (++calls === 3 ? cb?.('SERVER_ERROR') : setItem(key, value, cb));
    await expect(writeCloudPayload(payloadOf(30_000, 2), info)).rejects.toThrow('SERVER_ERROR');
    fake.tg.CloudStorage.setItem = setItem;
    expect((await readCloudPayload()).payload).toBe(payloadOf(30_000, 1));
  });

  it('aborts a save when the current meta cannot be read', async () => {
    fake = installFakeTelegram('7.10');
    await writeCloudPayload(payloadOf(10_000, 1), info);
    fake.cloud.failNext = { method: 'getItem', error: 'TIMEOUT' };
    await expect(writeCloudPayload(payloadOf(10_000, 2), info)).rejects.toThrow('TIMEOUT');
    expect((await readCloudPayload()).payload).toBe(payloadOf(10_000, 1));
  });

  it('detects a missing chunk (torn write)', async () => {
    fake = installFakeTelegram('7.10');
    const meta = await writeCloudPayload(payloadOf(50_000), info);
    fake.cloud.store.delete(chunkKey(meta.slot, 4));
    await expect(readCloudPayload()).rejects.toThrow(cloudMessages.torn);
  });

  it('detects a hash mismatch', async () => {
    fake = installFakeTelegram('7.10');
    const meta = await writeCloudPayload(payloadOf(50_000), info);
    const key = chunkKey(meta.slot, 2);
    const chunk = fake.cloud.store.get(key)!;
    fake.cloud.store.set(key, (chunk[0] === 'x' ? 'y' : 'x') + chunk.slice(1));
    await expect(readCloudPayload()).rejects.toThrow(cloudMessages.damaged);
  });

  it('refuses a payload beyond the chunk budget without writing', async () => {
    fake = installFakeTelegram('7.10');
    await expect(writeCloudPayload('x'.repeat(MAX_CHUNKS * CHUNK_SIZE + 1), info)).rejects.toThrow(cloudMessages.tooBig);
    expect(fake.cloud.store.size).toBe(0);
  });

  it('reports no copy and deletes the meta first', async () => {
    fake = installFakeTelegram('7.10');
    expect(await readCloudMeta()).toBeNull();
    await expect(readCloudPayload()).rejects.toThrow(cloudMessages.empty);
    await writeCloudPayload(payloadOf(10_000), info);
    fake.cloud.log.length = 0;
    await deleteCloudBackup();
    expect(fake.cloud.log[0]).toBe(`remove ${META_KEY}`);
    expect(fake.cloud.store.size).toBe(0);
  });
});

describe('ownership', () => {
  it('refuses to replace a copy it may not, before writing anything', async () => {
    fake = installFakeTelegram('7.10');
    const theirs = await writeCloudPayload(payloadOf(10_000, 1), info);
    fake.cloud.log.length = 0;
    const attempt = writeCloudPayload(payloadOf(10_000, 2), info, { canReplace: (h) => h === 'mine' });
    await expect(attempt).rejects.toBeInstanceOf(CloudConflictError);
    await expect(attempt).rejects.toMatchObject({ remote: theirs });
    expect(fake.cloud.log).toEqual([]);
    expect((await readCloudPayload()).payload).toBe(payloadOf(10_000, 1));
  });

  it('replaces its own copy and writes freely into an empty cloud', async () => {
    fake = installFakeTelegram('7.10');
    const seen: (string | null)[] = [];
    const canReplace = (h: string | null) => (seen.push(h), false);
    const first = await writeCloudPayload(payloadOf(10_000, 1), info, { canReplace });
    expect(seen).toEqual([]); // nothing in the cloud: nothing to ask about
    const second = await writeCloudPayload(payloadOf(10_000, 2), info, { canReplace: (h) => h === first.h });
    expect(second.slot).toBe('b');
  });

  it('treats a meta of a newer format as a copy to keep', async () => {
    fake = installFakeTelegram('7.10');
    fake.cloud.store.set(META_KEY, JSON.stringify({ v: 2, h: 'future', slot: 'a' }));
    await expect(writeCloudPayload(payloadOf(10_000), info, { canReplace: (h) => h === null })).rejects.toMatchObject({ remote: null });
  });
});

describe('request queue', () => {
  it('keeps the next request waiting while a timed-out one may still call back', async () => {
    fake = installFakeTelegram('7.10');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { setItem } = fake.tg.CloudStorage;
      let late: (() => void) | undefined;
      fake.tg.CloudStorage.setItem = (key, value, cb) => {
        late = () => setItem(key, value, cb);
      };
      const slow = cloud.setItem('slow', '1');
      const slowResult = slow.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await slowResult).toMatchObject({ message: cloudMessages.timeout });

      fake.tg.CloudStorage.setItem = setItem;
      let nextDone = false;
      const next = cloud.getItem('slow').then((value) => ((nextDone = true), value));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(nextDone).toBe(false); // the timed-out call has not answered yet

      late!(); // the SDK finally answers: the late write lands before the next read
      expect(await next).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up waiting for a lost callback after the hard cap', async () => {
    fake = installFakeTelegram('7.10');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fake.tg.CloudStorage.getKeys = () => {}; // never calls back
      const lost = cloud.getKeys().catch((error: unknown) => error);
      const next = cloud.getItem('x');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await lost).toMatchObject({ message: cloudMessages.timeout });
      expect(await next).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('encoding', () => {
  it('gzips to base64 and back, keeping non-ASCII text', async () => {
    const json = JSON.stringify({ note: 'Говорили про путешествия 🎯', n: payloadOf(5000) });
    const { payload, enc } = await encodePayload(json);
    expect(enc).toBe('gz');
    expect(payload).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(await decodePayload(payload, enc)).toBe(json);
  });

  it('falls back to escaped ASCII JSON without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const json = JSON.stringify({ note: 'Колба 🎯' });
    const { payload, enc } = await encodePayload(json);
    expect(enc).toBe('json');
    expect(payload).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(await decodePayload(payload, enc))).toEqual(JSON.parse(json));
  });
});

describe('backup through the cloud', () => {
  it('saves and loads the whole database', async () => {
    fake = installFakeTelegram('7.10');
    await withClock('2026-09-20T09:00:00', async () => {
      const skillId = await createSkill({
        name: 'Английский',
        description: '',
        startLabel: 'B1',
        targetLabel: 'C1',
        milestoneName: 'Достичь C1',
        milestoneTarget: 3,
        capacityBase: 10,
        capacityIncrement: 5,
        manualCapacities: [],
      });
      const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
      await completeStep(stepId, { note: 'Заметка с ёлкой' });
      await completeStep(stepId);
    }, 2000);
    const file = await exportBackup();
    const meta = await saveBackupToCloud(file);
    expect(meta).toMatchObject({ enc: 'gz', skills: 1, completions: 2, at: file.exportedAt, schemaVersion: file.schemaVersion });

    const loaded = await loadBackupFromCloud();
    expect(loaded.meta).toEqual(meta);
    expect(loaded.file.tables).toEqual(file.tables);
  });
});
