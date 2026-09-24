// Achievements as a service: the engine (domain/achievements) is re-run inside every write
// transaction and once at start, and the ledger `achievementUnlocks` is brought in line with
// it. The ledger is never the source of truth — it remembers what the UI has shown (a row
// exists while the achievement is unlocked; `celebratedAt` once its card played, `seenAt`
// once the tab was opened). An achievement that a cancellation or a smaller capacity takes
// away loses its row silently; earning it again adds a fresh row and celebrates again.
//
// Mutations returning a MutationResult carry what they earned in `achievements`; the others
// (a new skill or step, completing or restarting a skill) publish it after the commit through
// onAchievementsEarned, which the CelebrationProvider listens to. Nothing is ever celebrated
// on load: the start sync only files what it finds.

import { db, type SkillFlaskDb } from '../data/db';
import { nowIso } from '../lib/dates';
import { CATALOG, LADDERS } from '../domain/achievements/catalog';
import { evaluateWithStats, type Evaluation } from '../domain/achievements/evaluate';
import type { HistorySnapshot } from '../domain/achievements/events';
import type { AchievementState, LadderDef } from '../domain/achievements/types';
import type { AchievementUnlock } from '../domain/types';
import { logError } from '../platform/errorLog';

/** The six tables the engine reads. */
export const snapshotTables = () => [db.skills, db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions];
/** What a sync needs: the snapshot and the ledger. */
export const achievementTables = () => [...snapshotTables(), db.achievementUnlocks];

/** The engine's input: six whole-table reads inside the caller's transaction. */
export async function loadSnapshot(): Promise<HistorySnapshot> {
  const [skills, milestones, thresholds, steps, completions, transactions] = await Promise.all([
    db.skills.toArray(),
    db.milestones.toArray(),
    db.levelThresholds.toArray(),
    db.steps.toArray(),
    db.completions.toArray(),
    db.transactions.toArray(),
  ]);
  return { skills, milestones, thresholds, steps, completions, transactions };
}

// ---- Evaluation cache ----

let cached: { db: SkillFlaskDb; key: string; evaluation: Evaluation } | null = null;

/**
 * The engine's result for the current database, re-evaluated only when the history changed.
 * The key holds the four small tables whole, and the size and newest row of the journal: a
 * completion never changes in a way the rules read without a journal row (a completion writes
 * one even when worth 0 points; cancel and restore write one; a change of minutes writes a
 * CORRECTION even when the points stay the same; a note edit writes none and matters to no
 * rule). Runs inside a transaction covering snapshotTables().
 */
async function evaluate(): Promise<Evaluation> {
  const [skills, milestones, thresholds, steps, completionCount, transactionCount, lastRow] = await Promise.all([
    db.skills.toArray(),
    db.milestones.toArray(),
    db.levelThresholds.toArray(),
    db.steps.toArray(),
    db.completions.count(),
    db.transactions.count(),
    db.transactions.orderBy('createdAt').last(),
  ]);
  const key = JSON.stringify([skills, milestones, thresholds, steps, completionCount, transactionCount, lastRow?.id ?? null]);
  if (cached && cached.db === db && cached.key === key) return cached.evaluation;
  const [completions, transactions] = await Promise.all([db.completions.toArray(), db.transactions.toArray()]);
  const evaluation = evaluateWithStats({ skills, milestones, thresholds, steps, completions, transactions });
  cached = { db, key, evaluation };
  return evaluation;
}

/** Test hook: forget the cached evaluation. */
export function resetAchievementCache(): void {
  cached = null;
}

// ---- Sync ----

export interface SyncResult {
  /** Unlocked by this write: the rule became true at an event of this write. Celebrate these. */
  earnedNow: AchievementState[];
  /** Unlocked with an older date (a capacity edit, a catalogue entry added since, a restore). */
  appearedQuietly: AchievementState[];
}

/**
 * Brings the ledger in line with the engine. Must run inside a transaction covering
 * achievementTables(). `now` is the write's own timestamp: every row a write adds is stamped at
 * or after it (nowIso() only grows), so an unlock dated at or after `now` was earned by this
 * write; anything older only appeared (it is filed quietly, the tab's dot tells about it).
 */
export async function syncAchievements(now: string): Promise<SyncResult> {
  const { states } = await evaluate();
  const rows = new Map((await db.achievementUnlocks.toArray()).map((row) => [row.id, row]));
  const put: AchievementUnlock[] = [];
  const earnedNow: AchievementState[] = [];
  const appearedQuietly: AchievementState[] = [];
  for (const state of states) {
    // A locked achievement stays in `rows`: its row is deleted below.
    if (!state.unlocked) continue;
    const row = rows.get(state.def.id);
    rows.delete(state.def.id);
    const unlockedAt = state.unlockedAt!;
    const fresh = unlockedAt >= now;
    if (!row) {
      put.push({ id: state.def.id, unlockedAt, skillId: state.skillId, celebratedAt: null, seenAt: null });
      (fresh ? earnedNow : appearedQuietly).push(state);
    } else if (row.unlockedAt !== unlockedAt || row.skillId !== state.skillId) {
      // Re-dated (the history was re-interpreted); a re-earn by this very write is news again.
      put.push(fresh ? { ...row, unlockedAt, skillId: state.skillId, celebratedAt: null, seenAt: null } : { ...row, unlockedAt, skillId: state.skillId });
      if (fresh) earnedNow.push(state);
    }
  }
  // What is left is locked now (or no longer in the catalogue): its row goes, silently.
  if (rows.size) await db.achievementUnlocks.bulkDelete([...rows.keys()]);
  if (put.length) await db.achievementUnlocks.bulkPut(put);
  return { earnedNow, appearedQuietly };
}

/**
 * After a backup import or a wipe (inside its transaction): the ledger rows the file carried
 * keep their celebratedAt/seenAt, so nothing replays; unlocks the file did not know about (an
 * older backup without the ledger, a catalogue entry added since) are history, not news.
 */
export async function syncAfterImport({ now }: { now: string }): Promise<void> {
  cached = null;
  const known = new Set(await db.achievementUnlocks.toCollection().primaryKeys());
  const { earnedNow, appearedQuietly } = await syncAchievements(now);
  const added = [...earnedNow, ...appearedQuietly].map((s) => s.def.id).filter((id) => !known.has(id));
  if (added.length) {
    await db.achievementUnlocks.where('id').anyOf(added).modify({ celebratedAt: now, seenAt: now });
  }
}

/**
 * Once at app start: files unlocks that appeared without a write of this session (a catalogue
 * entry added in an update). Idempotent and never celebrates — the result is not shown.
 */
export async function syncAchievementsOnStart(): Promise<void> {
  try {
    await db.transaction('rw', achievementTables(), () => syncAchievements(nowIso()));
  } catch (error) {
    logError(error, 'syncAchievementsOnStart');
  }
}

/**
 * The ones still unlocked as announced: a card waiting behind the milestone sheet is dropped
 * when «Отменить» took its achievement away in the meantime.
 */
export async function filterStillUnlocked(states: readonly AchievementState[]): Promise<AchievementState[]> {
  const rows = await db.achievementUnlocks.bulkGet(states.map((s) => s.def.id));
  return states.filter((state, i) => rows[i]?.unlockedAt === state.unlockedAt);
}

/** The achievement card played for these. */
export async function markCelebrated(ids: readonly string[], now: string): Promise<void> {
  if (!ids.length) return;
  await db.achievementUnlocks
    .where('id')
    .anyOf([...ids])
    .filter((row) => row.celebratedAt === null)
    .modify({ celebratedAt: now });
}

/** Unlocks not seen on the tab yet: the dot on the tab bar. */
export async function countUnseenAchievements(): Promise<number> {
  return db.achievementUnlocks.filter((row) => row.seenAt === null).count();
}

/** The «Ачивки» tab was opened: every unlock so far is seen, the tab's dot goes out. */
export async function markAchievementsSeen(now: string): Promise<void> {
  await db.achievementUnlocks.filter((row) => row.seenAt === null).modify({ seenAt: now });
}

// ---- Earned outside a MutationResult ----

type EarnedListener = (states: AchievementState[]) => void;
const earnedListeners = new Set<EarnedListener>();

/** Achievements earned by a write that returns no MutationResult (skill/step creation, completing a skill). */
export function onAchievementsEarned(listener: EarnedListener): () => void {
  earnedListeners.add(listener);
  return () => earnedListeners.delete(listener);
}

/** Called by those writes after their commit. */
export function publishEarned(states: AchievementState[]): void {
  if (!states.length) return;
  for (const listener of earnedListeners) {
    try {
      listener(states);
    } catch (error) {
      logError(error, 'publishEarned');
    }
  }
}

// ---- Read models ----

export interface LadderView {
  def: LadderDef;
  /** The ladder's counter now (for «Лучшая серия», the record). */
  current: number;
  /** Index of the highest unlocked tier, −1 before the first. */
  tierIndex: number;
  /** The first locked tier; null when every tier is unlocked. */
  next: { target: number; remaining: number } | null;
  tiers: AchievementState[];
}

export interface AchievementsView {
  ladders: LadderView[];
  badges: AchievementState[];
  unlockedCount: number;
  total: number;
  /** The most recent unlock. */
  lastUnlocked: AchievementState | null;
  /** Ledger rows not seen on the tab yet. */
  unseenCount: number;
  /** Names of the skills unlocks are credited to. */
  skillNames: Record<string, string>;
}

const latestFirst = (a: AchievementState, b: AchievementState) => (a.unlockedAt! < b.unlockedAt! ? 1 : a.unlockedAt! > b.unlockedAt! ? -1 : 0);

function lastOf(states: readonly AchievementState[]): AchievementState | null {
  return states.filter((s) => s.unlocked).sort(latestFirst)[0] ?? null;
}

/**
 * The locked achievement closest to its target. Ties: the smaller target, then a badge before
 * a ladder tier (on an empty start that is «Первый навык»), then catalogue order.
 */
function nextOf(states: readonly AchievementState[]): AchievementState | null {
  const rank = (s: AchievementState) => [-(s.current / s.target), s.target, s.def.kind === 'BADGE' ? 0 : 1];
  let best: AchievementState | null = null;
  for (const state of states) {
    if (state.unlocked) continue;
    if (!best) {
      best = state;
      continue;
    }
    const [a, b] = [rank(state), rank(best)];
    const i = a.findIndex((v, k) => v !== b[k]);
    if (i >= 0 && a[i]! < b[i]!) best = state;
  }
  return best;
}

async function skillNames(): Promise<Record<string, string>> {
  const skills = await db.skills.toArray();
  return Object.fromEntries(skills.map((s) => [s.id, s.name]));
}

export async function getAchievementsView(): Promise<AchievementsView> {
  return db.transaction('r', achievementTables(), async () => {
    const [{ states, stats }, unseenCount, names] = await Promise.all([
      evaluate(),
      db.achievementUnlocks.filter((row) => row.seenAt === null).count(),
      skillNames(),
    ]);
    const ladders = LADDERS.map((def): LadderView => {
      const tiers = states.filter((s) => s.def.ladderId === def.id);
      const current = def.value(stats);
      const tierIndex = tiers.reduce((top, s, i) => (s.unlocked ? i : top), -1);
      const locked = tiers.find((s) => !s.unlocked);
      return { def, current, tierIndex, next: locked ? { target: locked.target, remaining: locked.target - current } : null, tiers };
    });
    return {
      ladders,
      badges: states.filter((s) => s.def.kind === 'BADGE'),
      unlockedCount: states.filter((s) => s.unlocked).length,
      total: CATALOG.length,
      lastUnlocked: lastOf(states),
      unseenCount,
      skillNames: names,
    };
  });
}

export interface HomeAchievementLine {
  last: AchievementState | null;
  next: AchievementState | null;
}

/** The home tile's line; runs inside the caller's transaction when there is one (getHomeView). */
export async function getHomeAchievementLine(): Promise<HomeAchievementLine> {
  return db.transaction('r', snapshotTables(), async () => {
    const { states } = await evaluate();
    return { last: lastOf(states), next: nextOf(states) };
  });
}
