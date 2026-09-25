// What the user feels and reads after a completion: haptics, one toast with «Отменить» for
// 6 s, and the undo itself (a CANCELLATION row, never a delete). Shared by the step row, the
// «Задним числом» screen and, in package 6, the Today tab. A filled flask or a reached
// milestone is celebrated on top of this by celebrations/CelebrationProvider.tsx.

import { BackupError } from '../data/backup';
import { cancelCompletion, type MutationResult } from '../services/completions';
import { ValidationError } from '../services/core';
import { haptics } from '../platform/haptics';
import { logError } from '../platform/errorLog';
import type { useCelebrations } from './celebrations/CelebrationProvider';
import type { ShowToast } from './components/Toast';
import { copy, type LevelCopy } from './copy';

// Only the latest completion toast is on screen (a new toast replaces the old), so one
// pending undo is enough. Keyed by completion id: an action left over from an earlier toast
// can never cancel a different completion.
let pendingUndo: string | null = null;

/** «+5 · Чтение» — the same for every completion; the flask, pill and sheet tell the rest. */
export function completionMessage(result: MutationResult, stepName: string): string {
  return copy.completion.added(result.pointsAwarded, stepName);
}

/** A write whose feedback belongs to a celebration (level-up or milestone haptics), not the plain success tap. */
export function isCelebrated(result: MutationResult): boolean {
  return result.levelChange > 0 || result.milestoneReached;
}

/** User-facing text of a failed mutation: validation and backup messages as is, anything else generic. */
export function errorMessage(error: unknown): string {
  if (error instanceof ValidationError || error instanceof BackupError) return error.message;
  logError(error, 'mutation');
  return copy.errors.save;
}

/** Haptics and the toast for a fresh completion, with «Отменить»; `levels` names the skill's levels after an undo. */
export function announceCompletion(result: MutationResult, stepName: string, showToast: ShowToast, levels: LevelCopy): void {
  // A level-up vibrates at the flask's overflow beat, a milestone when its sheet opens.
  if (!isCelebrated(result)) haptics.success();
  const completionId = result.completionId;
  pendingUndo = completionId;
  showToast(completionMessage(result, stepName), {
    action: { label: copy.completion.undo, onClick: () => void undoCompletion(completionId, showToast, levels) },
  });
}

/**
 * The UI side of a completion written from a tap (the step row's ✓, the timer's «Завершить»):
 * freeze the skill's hero, write, then the toast with «Отменить» and the celebrations, the «+N»
 * flying from `source`. A failed write releases the hero and rethrows for the caller to report.
 */
export async function writeCompletion(
  write: () => Promise<MutationResult>,
  ctx: {
    skillId: string;
    stepName: string;
    levels: LevelCopy;
    source: Element | null;
    showToast: ShowToast;
    celebrations: ReturnType<typeof useCelebrations>;
  },
): Promise<MutationResult> {
  // Freeze the flask on screen before the write, so the live query cannot move it before the
  // points have flown in.
  const release = ctx.celebrations.hold(ctx.skillId);
  let result: MutationResult;
  try {
    result = await write();
  } catch (error) {
    release();
    throw error;
  }
  announceCompletion(result, ctx.stepName, ctx.showToast, ctx.levels);
  void ctx.celebrations.celebrateResult(result, { skillId: ctx.skillId, source: ctx.source, points: result.pointsAwarded }).finally(release);
  return result;
}

/** The toast's «Отменить»: cancels exactly the completion the toast announced, once. */
export async function undoCompletion(completionId: string, showToast: ShowToast, levels: LevelCopy): Promise<void> {
  if (pendingUndo !== completionId) return;
  pendingUndo = null;
  try {
    const { after } = await cancelCompletion(completionId);
    haptics.warning();
    showToast(levels.cancelled(after.currentFlask, after.pointsInCurrentFlask, after.currentCapacity));
  } catch (error) {
    haptics.error();
    showToast(errorMessage(error));
  }
}

/** Drops the pending undo once the completion was cancelled another way (the completion sheet). */
export function forgetUndo(completionId: string): void {
  if (pendingUndo === completionId) pendingUndo = null;
}
