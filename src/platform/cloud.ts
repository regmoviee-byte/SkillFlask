import { backupStats, BackupError, migrateBackup, type BackupFile } from '../data/backup';
import { logError } from './errorLog';
import { API, supports, webApp, type CloudStorage } from './telegram';

// Telegram CloudStorage (Bot API 6.9) as the transport of the automatic backup. Per bot and
// user, shared by the user's devices, 1 024 keys × 4 096 characters. The SDK exposes the
// object on every client but its methods throw below 6.9, so `available()` is the only gate.
//
// Layout: the encoded backup is split into chunks of 4 000 characters under `sf_a_000…` or
// `sf_b_000…` and described by `sf_meta` = { n, len, h (SHA-256 prefix), enc, slot, … }.
// Every save writes the slot the current meta does NOT point at, then the meta, then removes
// the other slot. A save interrupted halfway (the app closed while flushing) therefore never
// touches the copy the meta describes: the previous backup stays readable, and a meta can
// only point at a complete slot. Reads check the chunk count, the length and the hash.
//
// Ownership: a save can be told which copies it may replace (`canReplace`, given the hash of
// the copy in the cloud). The automatic backup only replaces the copy this device saved or
// restored, so a copy written by another phone, or one kept through «Удалить все данные», is
// never clobbered silently. The check and the meta write are not atomic (CloudStorage has no
// compare-and-set): two devices saving in the same second can still race.

export const CHUNK_SIZE = 4000;
/** Two slots of 500 chunks plus the meta stay under the 1 024-key limit. */
export const MAX_CHUNKS = 500;
export const META_KEY = 'sf_meta';
const REQUEST_TIMEOUT_MS = 15_000;
/** How long a timed-out request may still hold the queue waiting for its late callback. */
const REQUEST_HARD_CAP_MS = 60_000;
const CHUNK_KEY = /^sf_([ab])_(\d{3})$/;

export type CloudSlot = 'a' | 'b';
export type CloudEncoding = 'gz' | 'json';

export interface CloudMeta {
  v: 1;
  /** exportedAt of the backup. */
  at: string;
  /** Number of chunks. */
  n: number;
  /** Length of the encoded payload in characters. */
  len: number;
  /** First 16 hex characters of SHA-256 over the encoded payload. */
  h: string;
  enc: CloudEncoding;
  slot: CloudSlot;
  schemaVersion: number;
  skills: number;
  completions: number;
}

export const cloudMessages = {
  unavailable: 'Облако Telegram недоступно',
  timeout: 'Облако Telegram не отвечает — попробуйте позже',
  failed: (code: string) => `Облако Telegram вернуло ошибку ${code}`,
  tooBig: 'Копия слишком большая для облака Telegram — сохраните файл',
  empty: 'В облаке нет копии',
  torn: 'Копия в облаке неполная — сохраните её заново',
  damaged: 'Копия в облаке повреждена — сохраните её заново',
  newer: 'Копия в облаке создана более новой версией приложения',
  noGzip: 'Эта версия Telegram не может прочитать сжатую копию — обновите Telegram',
  conflict: 'В облаке другая копия — она создана не на этом устройстве',
} as const;

/** The copy in the cloud is not one this device may replace (see `canReplace`). */
export class CloudConflictError extends BackupError {
  override name = 'CloudConflictError';
  /** Meta of the copy found in the cloud; null when it is of a format this app cannot read. */
  readonly remote: CloudMeta | null;
  constructor(remote: CloudMeta | null) {
    super(cloudMessages.conflict);
    this.remote = remote;
  }
}

// ---- Transport ----

/** True inside Telegram ≥ 6.9 with WebCrypto (always there on https, which Mini Apps require). */
export function available(): boolean {
  return supports(API.cloudStorage) && typeof globalThis.crypto?.subtle?.digest === 'function';
}

function storage(): CloudStorage {
  const tg = webApp();
  if (!tg || !available()) throw new BackupError(cloudMessages.unavailable);
  return tg.CloudStorage;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * One request in flight at a time: the SDK routes every call through one bridge and some
 * clients drop overlapping callbacks. A request that never calls back fails after 15 s, but
 * the SDK call may still be running: the queue stays blocked until its late callback arrives
 * (or 60 s pass), so the next request never overlaps it. A late setItem therefore lands
 * before anything that follows; the caller already saw the failure.
 */
function request<T>(run: (cs: CloudStorage, done: (error: string | null, result?: T) => void) => void): Promise<T> {
  let release!: () => void;
  const finished = new Promise<void>((resolve) => (release = resolve));
  const task = () =>
    new Promise<T>((resolve, reject) => {
      let hardCap: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        reject(new BackupError(cloudMessages.timeout));
        hardCap = setTimeout(release, REQUEST_HARD_CAP_MS - REQUEST_TIMEOUT_MS);
      }, REQUEST_TIMEOUT_MS);
      const settle = () => {
        clearTimeout(timer);
        clearTimeout(hardCap);
        release();
      };
      const done = (error: string | null, result?: T) => {
        settle();
        // After a timeout the promise is already rejected; resolving it again is a no-op.
        if (error) reject(new BackupError(cloudMessages.failed(String(error))));
        else resolve(result as T);
      };
      try {
        run(storage(), done);
      } catch (error) {
        settle();
        reject(error instanceof BackupError ? error : new BackupError(cloudMessages.unavailable));
      }
    });
  const result = queue.then(task, task);
  queue = result.then(
    () => finished,
    () => finished,
  );
  return result;
}

export const cloud = {
  available,
  getItem: (key: string) => request<string>((cs, done) => cs.getItem(key, (e, v) => done(e, v ?? ''))),
  getItems: (keys: string[]) => request<Record<string, string>>((cs, done) => cs.getItems(keys, (e, v) => done(e, v ?? {}))),
  setItem: (key: string, value: string) => request<boolean>((cs, done) => cs.setItem(key, value, (e, ok) => done(e, ok ?? true))),
  removeItems: (keys: string[]) => request<boolean>((cs, done) => cs.removeItems(keys, (e, ok) => done(e, ok ?? true))),
  getKeys: () => request<string[]>((cs, done) => cs.getKeys((e, keys) => done(e, keys ?? []))),
};

// ---- Encoding ----

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function transform(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const writer = stream.writable.getWriter();
  // Not awaited: the readable side must be drained concurrently or backpressure stalls.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return readAll(stream.readable);
}

/** btoa over slices of 8 190 bytes: a multiple of 3, so the slices' base64 simply concatenates. */
function toBase64(bytes: Uint8Array): string {
  const STEP = 8190;
  let out = '';
  for (let i = 0; i < bytes.length; i += STEP) out += btoa(String.fromCharCode(...bytes.subarray(i, i + STEP)));
  return out;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * gzip + base64 where CompressionStream exists; otherwise the JSON itself with every
 * non-ASCII character escaped. Both are pure ASCII, so a chunk boundary never splits a
 * surrogate pair and every character counts once against the 4 096 limit.
 */
export async function encodePayload(json: string): Promise<{ payload: string; enc: CloudEncoding }> {
  if (typeof CompressionStream !== 'undefined') {
    const gz = await transform(new TextEncoder().encode(json), new CompressionStream('gzip'));
    return { payload: toBase64(gz), enc: 'gz' };
  }
  const ascii = json.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return { payload: ascii, enc: 'json' };
}

export async function decodePayload(payload: string, enc: CloudEncoding): Promise<string> {
  if (enc === 'json') return payload;
  if (typeof DecompressionStream === 'undefined') throw new BackupError(cloudMessages.noGzip);
  try {
    const bytes = await transform(fromBase64(payload), new DecompressionStream('gzip'));
    return new TextDecoder().decode(bytes);
  } catch {
    throw new BackupError(cloudMessages.damaged);
  }
}

async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash).subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Chunks and meta ----

export const chunkKey = (slot: CloudSlot, i: number) => `sf_${slot}_${String(i).padStart(3, '0')}`;

function isMeta(value: unknown): value is CloudMeta {
  const m = value as Partial<CloudMeta> | null;
  const count = (n: unknown, min = 0) => Number.isInteger(n) && (n as number) >= min;
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof m.at === 'string' &&
    count(m.n, 1) &&
    (m.n as number) <= MAX_CHUNKS &&
    count(m.len, 1) &&
    typeof m.h === 'string' &&
    (m.enc === 'gz' || m.enc === 'json') &&
    (m.slot === 'a' || m.slot === 'b') &&
    count(m.schemaVersion, 1) &&
    count(m.skills) &&
    count(m.completions)
  );
}

/** The meta of the copy in the cloud; null when there is none. */
export async function readCloudMeta(): Promise<CloudMeta | null> {
  const raw = await cloud.getItem(META_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupError(cloudMessages.damaged);
  }
  if ((parsed as { v?: unknown }).v !== 1) {
    if (typeof (parsed as { v?: unknown }).v === 'number') throw new BackupError(cloudMessages.newer);
    throw new BackupError(cloudMessages.damaged);
  }
  if (!isMeta(parsed)) throw new BackupError(cloudMessages.damaged);
  return parsed;
}

/**
 * The current meta read leniently: its slot and hash even when it is of a newer format.
 * Null when there is none or it is not a JSON object (it then describes nothing to keep).
 */
async function liveMeta(): Promise<{ slot: CloudSlot | null; h: string | null; meta: CloudMeta | null } | null> {
  const raw = await cloud.getItem(META_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { slot, h, v } = parsed as { slot?: unknown; h?: unknown; v?: unknown };
  return {
    slot: slot === 'a' || slot === 'b' ? slot : null,
    h: typeof h === 'string' ? h : null,
    meta: v === 1 && isMeta(parsed) ? parsed : null,
  };
}

export type PayloadInfo = Pick<CloudMeta, 'at' | 'enc' | 'schemaVersion' | 'skills' | 'completions'>;

/** Chunk keys to drop: everything except the first `keepCount` chunks of `keepSlot`. */
function staleChunks(keys: string[], keepSlot: CloudSlot | null, keepCount: number): string[] {
  return keys.filter((key) => {
    const match = CHUNK_KEY.exec(key);
    return match !== null && !(match[1] === keepSlot && Number(match[2]) < keepCount);
  });
}

export interface WriteOptions {
  onProgress?: (done: number, total: number) => void;
  /**
   * Whether the copy currently in the cloud (by its hash) may be replaced; without it any copy
   * is. Refusing throws CloudConflictError before anything is written.
   */
  canReplace?: (remoteHash: string | null) => boolean;
  /** Called with the new hash right before the meta is written (it may land even if the call then fails). */
  onMetaWrite?: (h: string) => void;
}

/** Writes an encoded payload: chunks into the free slot, the meta last, then the old slot goes. */
export async function writeCloudPayload(payload: string, info: PayloadInfo, options: WriteOptions = {}): Promise<CloudMeta> {
  const { onProgress, canReplace, onMetaWrite } = options;
  const n = Math.ceil(payload.length / CHUNK_SIZE);
  if (n > MAX_CHUNKS) throw new BackupError(cloudMessages.tooBig);
  if (n === 0) throw new BackupError(cloudMessages.empty);
  // The slot the current meta points at is never written. A transport error aborts the save
  // (guessing could overwrite the live copy); an unparsable meta describes nothing to keep.
  const live = await liveMeta();
  if (live && canReplace && !canReplace(live.h)) throw new CloudConflictError(live.meta);
  const slot: CloudSlot = live?.slot === 'a' ? 'b' : 'a';
  const h = await digest(payload);

  // Leftovers of the target slot beyond the new length (an earlier, longer or torn copy).
  const leftovers = (await cloud.getKeys()).filter((key) => {
    const match = CHUNK_KEY.exec(key);
    return match !== null && match[1] === slot && Number(match[2]) >= n;
  });
  if (leftovers.length) await cloud.removeItems(leftovers);

  for (let i = 0; i < n; i++) {
    await cloud.setItem(chunkKey(slot, i), payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    onProgress?.(i + 1, n);
  }
  const meta: CloudMeta = { v: 1, at: info.at, n, len: payload.length, h, enc: info.enc, slot, schemaVersion: info.schemaVersion, skills: info.skills, completions: info.completions };
  onMetaWrite?.(h);
  await cloud.setItem(META_KEY, JSON.stringify(meta));
  try {
    const stale = staleChunks(await cloud.getKeys(), slot, n);
    if (stale.length) await cloud.removeItems(stale);
  } catch (error) {
    // The new copy is complete; stale keys are removed by the next save.
    logError(error, 'cloud cleanup');
  }
  return meta;
}

/** Reads and verifies the payload the meta describes. */
export async function readCloudPayload(): Promise<{ meta: CloudMeta; payload: string }> {
  const meta = await readCloudMeta();
  if (!meta) throw new BackupError(cloudMessages.empty);
  const keys = Array.from({ length: meta.n }, (_, i) => chunkKey(meta.slot, i));
  const values = await cloud.getItems(keys);
  const parts = keys.map((key) => values[key] ?? '');
  if (parts.some((part) => !part)) throw new BackupError(cloudMessages.torn);
  const payload = parts.join('');
  if (payload.length !== meta.len) throw new BackupError(cloudMessages.torn);
  if ((await digest(payload)) !== meta.h) throw new BackupError(cloudMessages.damaged);
  return { meta, payload };
}

// ---- Backups ----

export async function saveBackupToCloud(file: BackupFile, options: WriteOptions = {}): Promise<CloudMeta> {
  const { payload, enc } = await encodePayload(JSON.stringify(file));
  const { skills, completions } = backupStats(file);
  return writeCloudPayload(payload, { at: file.exportedAt, enc, schemaVersion: file.schemaVersion, skills, completions }, options);
}

/** Reads, verifies, decodes and migrates the cloud copy; importing it is the caller's call. */
export async function loadBackupFromCloud(): Promise<{ meta: CloudMeta; file: BackupFile }> {
  const { meta, payload } = await readCloudPayload();
  const json = await decodePayload(payload, meta.enc);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BackupError(cloudMessages.damaged);
  }
  return { meta, file: migrateBackup(raw) };
}

/** Removes the copy: the meta first, so an interrupted delete never leaves a readable half. */
export async function deleteCloudBackup(): Promise<void> {
  await cloud.removeItems([META_KEY]);
  const stale = staleChunks(await cloud.getKeys(), null, 0);
  if (stale.length) await cloud.removeItems(stale);
}
