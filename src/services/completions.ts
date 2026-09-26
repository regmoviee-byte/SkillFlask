// Completions and their journal (FR-CP-*, E2E-002). Every change of progress is a new
// PointTransaction row — COMPLETION, CANCELLATION, RESTORE or CORRECTION — never an edit or
// a delete, so the history replays to the same numbers (principle 3.8). Per completion the
// net of its rows is `pointsAwarded` while ACTIVE and 0 when CANCELLED (verifyJournal).

import { db } from '../data/db';
import { newId } from '../lib/ids';
import { isValidLocalDate, localDate, nowIso } from '../lib/dates';
import { fromDeci, MAX_MINUTES, timedPoints, toDeci } from '../domain/points';
import { compareJournalOrder, type Progress } from '../domain/progression';
import { isScheduledOn } from '../domain/schedule';
import type {
  AchievementState,
  CompletionSource,
  PointTransaction,
  Skill,
  StepCompletion,
  TransactionReason,
} from '../domain/types';
import { afterWrite, syncInTransaction } from './afterWrite';
import {
  DoubleSubmitError,
  journalTables,
  loadTimeline,
  requireActiveSkill,
  requireSkill,
  SAME_TAP_MS,
  syncMilestone,
  ValidationError,
} from './core';
import { getSetting, setSetting } from './settings';

/** Outcome of a journal mutation, enough for the UI to show the right toast (FR-XP-005). */
export interface MutationResult {
  completionId: string;
  pointsAwarded: number;
  /** Signed change applied to the journal. */
  delta: number;
  before: Progress;
  after: Progress;
  /** Positive on level-up, negative on rollback. */
  levelChange: number;
  milestoneReached: boolean;
  milestoneLost: boolean;
  /**
   * Achievements this write earned (services/achievements.ts: unlocked at or after its own
   * timestamp). Ones it locked again are not reported: that happens silently.
   */
  achievements: AchievementState[];
}

/** @deprecated Use MutationResult. */
export type CompletionResult = MutationResult;

export interface CompleteStepOptions {
  /** Local calendar date, today by default; never in the future. */
  date?: string;
  /** TIMED steps only (required there): whole minutes, 1..1440. Ignored for BOOLEAN. */
  minutes?: number;
  /**
   * SCHEDULED when the date is one the step's schedule plans (a due date, or inside a quota
   * period), MANUAL otherwise — by default. Informational: points never depend on it.
   */
  source?: CompletionSource;
  note?: string | null;
  /**
   * Runs first inside the completion's transaction (which covers `journalTables()`, the settings
   * too): a throw records nothing. The live timer checks and removes itself here.
   */
  inTransaction?: () => Promise<void>;
}

export const NOTE_MAX_LENGTH = 500;
export { SAME_TAP_MS };

/** Whole minutes of a TIMED completion, or a ValidationError with `message`. */
function requireMinutes(minutes: unknown, message: string): number {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) throw new ValidationError(message);
  return minutes;
}

function normalizeNote(note: string | null | undefined): string | null {
  const text = (note ?? '').trim();
  if (text.length > NOTE_MAX_LENGTH) throw new ValidationError(`Заметка: не больше ${NOTE_MAX_LENGTH} символов`);
  return text || null;
}

async function requireCompletion(id: string): Promise<StepCompletion> {
  const completion = await db.completions.get(id);
  if (!completion) throw new ValidationError('Выполнение не найдено');
  return completion;
}

/** Net of a completion's journal rows, in deci-points. */
async function netDeci(completionId: string): Promise<number> {
  const rows = await db.transactions.where('completionId').equals(completionId).toArray();
  return rows.reduce((sum, t) => sum + toDeci(t.delta), 0);
}

let persistAskedThisSession = false;

/**
 * Asks the browser to keep IndexedDB from eviction once the journal has something worth
 * keeping. Never awaited for the prompt itself (Firefox asks the user). The setting is stored
 * only when persistence was granted, so a refusal is asked again — at most once per session.
 */
async function requestStoragePersist(): Promise<void> {
  const storage = globalThis.navigator?.storage;
  if (typeof storage?.persist !== 'function' || persistAskedThisSession) return;
  if (await getSetting('storagePersistRequested', false)) return;
  persistAskedThisSession = true;
  storage
    .persist()
    .then((granted) => (granted ? setSetting('storagePersistRequested', true) : undefined))
    .catch(() => {});
}

/** Test hook: forget that persistence was asked in this session. */
export function resetStoragePersistRequest(): void {
  persistAskedThisSession = false;
}

interface JournalWrite {
  skill: Skill;
  completion: StepCompletion;
  /** Signed change in deci-points. */
  deltaDeci: number;
  /**
   * Write the row even when the delta is 0: a completion's own COMPLETION row, its CANCELLATION
   * and RESTORE rows (a TIMED completion may be worth 0 points and must still be in the history
   * and the achievement replay) and a CORRECTION that changed the minutes. Otherwise a 0 delta
   * writes no row.
   */
  keepZero?: boolean;
  reason: TransactionReason;
  /** Fields of the completion to update; omitted for the COMPLETION row (added before). */
  patch?: Partial<StepCompletion>;
  now: string;
}

/**
 * The common tail of every journal mutation: one row, the completion update, the milestone
 * sync and the achievement hooks. Runs inside a transaction covering `journalTables()`.
 */
async function writeJournal({ skill, completion, deltaDeci, keepZero = false, reason, patch, now }: JournalWrite): Promise<MutationResult> {
  const { progress: before } = await loadTimeline(skill);
  if (patch) await db.completions.update(completion.id, patch);
  if (deltaDeci !== 0 || keepZero) {
    await db.transactions.add({
      id: newId(),
      skillId: skill.id,
      completionId: completion.id,
      delta: fromDeci(deltaDeci),
      reason,
      createdAt: now,
    });
  }
  const sync = await syncMilestone(skill, now);
  const achievements = await syncInTransaction({ skillId: skill.id, now });
  return {
    completionId: completion.id,
    pointsAwarded: patch?.pointsAwarded ?? completion.pointsAwarded,
    delta: fromDeci(deltaDeci),
    before,
    after: sync.progress,
    levelChange: sync.progress.completedFlasks - before.completedFlasks,
    milestoneReached: sync.reachedNow,
    milestoneLost: sync.lostNow,
    achievements,
  };
}

/**
 * Records a completion of a step (FR-ST-010, FR-TD-004): a completion with a snapshot of the
 * step plus exactly one points transaction, written atomically (FR-CP-007). A TIMED step takes
 * the minutes: the snapshot keeps its rate, the points are minutes × rate in tenths (14.4).
 */
export async function completeStep(stepId: string, options: CompleteStepOptions = {}): Promise<MutationResult> {
  const today = localDate();
  const date = options.date ?? today;
  if (!isValidLocalDate(date) || date > today) throw new ValidationError('Некорректная дата');
  const note = normalizeNote(options.note);
  const minutesGiven = options.minutes;
  const now = nowIso();
  const result = await db.transaction('rw', journalTables(), async () => {
    await options.inTransaction?.();
    const step = await db.steps.get(stepId);
    if (!step || !step.isActive) throw new ValidationError('Действие не найдено');
    const skill = await requireSkill(step.skillId);
    requireActiveSkill(skill);

    // A double submit on a slow device: the UI's busy flag normally swallows it first.
    // Only ACTIVE ones count: a completion just undone via «Отменить» marks nothing any more.
    const sameDay = await db.completions.where('[stepId+date]').equals([stepId, date]).toArray();
    const nowMs = Date.parse(now);
    const recent = (c: StepCompletion) => nowMs - Date.parse(c.createdAt) >= 0 && nowMs - Date.parse(c.createdAt) < SAME_TAP_MS;
    if (sameDay.some((c) => c.status === 'ACTIVE' && recent(c))) {
      throw new DoubleSubmitError('Уже отмечено — подождите секунду');
    }

    const timed = step.type === 'TIMED';
    const minutes = timed ? requireMinutes(minutesGiven, 'Укажите длительность в минутах') : null;
    const rate = step.pointsPerMinute ?? 0;
    const completion: StepCompletion = {
      id: newId(),
      skillId: skill.id,
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      pointsSnapshot: timed ? rate : step.points,
      durationMinutes: minutes,
      pointsAwarded: timed ? timedPoints(minutes!, rate) : step.points,
      date,
      source: options.source ?? (isScheduledOn(step, date) ? 'SCHEDULED' : 'MANUAL'),
      status: 'ACTIVE',
      cancelledAt: null,
      note,
      createdAt: now,
      updatedAt: now,
    };
    await db.completions.add(completion);
    return writeJournal({ skill, completion, deltaDeci: toDeci(completion.pointsAwarded), keepZero: true, reason: 'COMPLETION', now });
  });
  await requestStoragePersist().catch(() => {});
  await afterWrite();
  return result;
}

/**
 * Cancels a mistaken completion (FR-CP-005, FR-CP-006): a CANCELLATION row takes its net
 * back out of the journal, the completion stays in the history as CANCELLED. Progress may go
 * back a flask and the milestone may stop being reached (FR-XP-005, decision 14.3).
 */
export async function cancelCompletion(completionId: string): Promise<MutationResult> {
  const now = nowIso();
  const result = await db.transaction('rw', journalTables(), async () => {
    const completion = await requireCompletion(completionId);
    if (completion.status !== 'ACTIVE') throw new ValidationError('Выполнение уже отменено');
    const skill = await requireSkill(completion.skillId);
    requireActiveSkill(skill);
    const net = await netDeci(completionId);
    return writeJournal({
      skill,
      completion,
      deltaDeci: net > 0 ? -net : 0,
      // A 0-point completion still needs its row: the history shows the cancellation and the
      // achievement cache sees the change.
      keepZero: true,
      reason: 'CANCELLATION',
      patch: { status: 'CANCELLED', cancelledAt: now, updatedAt: now },
      now,
    });
  });
  await afterWrite();
  return result;
}

/** «Вернуть»: a cancelled completion counts again, through a RESTORE row. */
export async function restoreCompletion(completionId: string): Promise<MutationResult> {
  const now = nowIso();
  const result = await db.transaction('rw', journalTables(), async () => {
    const completion = await requireCompletion(completionId);
    if (completion.status !== 'CANCELLED') throw new ValidationError('Выполнение не отменено');
    const skill = await requireSkill(completion.skillId);
    requireActiveSkill(skill);
    const net = await netDeci(completionId);
    return writeJournal({
      skill,
      completion,
      deltaDeci: toDeci(completion.pointsAwarded) - net,
      keepZero: true,
      reason: 'RESTORE',
      patch: { status: 'ACTIVE', cancelledAt: null, updatedAt: now },
      now,
    });
  });
  await afterWrite();
  return result;
}

/**
 * Changes the minutes of a TIMED completion (FR-CP-003, FR-CP-004). Points are recomputed
 * with the rate snapshot, never the step's current rate (FR-XP-008), and the difference is
 * one CORRECTION row.
 */
export async function correctDuration(completionId: string, minutes: number): Promise<MutationResult> {
  requireMinutes(minutes, `Минуты: целое число от 1 до ${MAX_MINUTES}`);
  const now = nowIso();
  const result = await db.transaction('rw', journalTables(), async () => {
    const completion = await requireCompletion(completionId);
    if (completion.stepType !== 'TIMED') throw new ValidationError('Длительность можно менять только у временного выполнения');
    if (completion.status !== 'ACTIVE') throw new ValidationError('Сначала верните выполнение');
    const skill = await requireSkill(completion.skillId);
    requireActiveSkill(skill);
    const newPoints = timedPoints(minutes, completion.pointsSnapshot);
    const net = await netDeci(completionId);
    return writeJournal({
      skill,
      completion,
      deltaDeci: toDeci(newPoints) - net,
      // A change of minutes is history even when the points round to the same tenths.
      keepZero: minutes !== completion.durationMinutes,
      reason: 'CORRECTION',
      patch: { durationMinutes: minutes, pointsAwarded: newPoints, updatedAt: now },
      now,
    });
  });
  await afterWrite();
  return result;
}

/**
 * Sets or clears the note of a completion (FR-CP-008, decision 14.8). Not a progress change:
 * allowed for cancelled completions and on completed or archived skills, writes no row.
 */
export async function setCompletionNote(completionId: string, note: string | null): Promise<void> {
  const text = normalizeNote(note);
  const now = nowIso();
  await db.transaction('rw', [db.completions], async () => {
    await requireCompletion(completionId);
    await db.completions.update(completionId, { note: text, updatedAt: now });
  });
  await afterWrite();
}

export interface CompletionDetails {
  completion: StepCompletion;
  skill: Skill;
  /** This completion's journal rows in journal order. */
  transactions: PointTransaction[];
  /** Flask state right after the completion was recorded (its COMPLETION row), as in the history. */
  progressAfter: Progress;
}

export async function getCompletion(id: string): Promise<CompletionDetails | null> {
  return db.transaction('r', [db.skills, db.levelThresholds, db.completions, db.transactions], async () => {
    const completion = await db.completions.get(id);
    if (!completion) return null;
    const skill = await db.skills.get(completion.skillId);
    if (!skill) return null;
    const { timeline, progress } = await loadTimeline(skill);
    const own = timeline.filter((entry) => entry.transaction.completionId === id);
    return {
      completion,
      skill,
      transactions: own.map((entry) => entry.transaction).sort(compareJournalOrder),
      progressAfter: own[0]?.after ?? progress,
    };
  });
}
