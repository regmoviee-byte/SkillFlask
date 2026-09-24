// What the user feels and reads after a completion: haptics, one toast with «Отменить» for
// 6 s, and the undo itself (a CANCELLATION row, never a delete). Shared by the step row, the
// «Задним числом» screen and, in package 6, the Today tab.

import { cancelCompletion, type MutationResult } from '../services/completions';
import { ValidationError } from '../services/core';
import { haptics } from '../platform/haptics';
import { logError } from '../platform/errorLog';
import type { ShowToast } from './components/Toast';
import { copy } from './copy';

// Only the latest completion toast is on screen (a new toast replaces the old), so one
// pending undo is enough. Keyed by completion id: an action left over from an earlier toast
// can never cancel a different completion.
let pendingUndo: string | null = null;

export function completionMessage(result: MutationResult, stepName: string): string {
  if (result.milestoneReached) return copy.toast.milestoneReached(result.pointsAwarded);
  if (result.levelChange > 0) {
    return copy.toast.flaskFilled(result.after.completedFlasks, result.after.pointsInCurrentFlask, result.levelChange);
  }
  return copy.completion.added(result.pointsAwarded, stepName);
}

/** User-facing text of a failed mutation: validation messages as is, anything else generic. */
export function errorMessage(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  logError(error, 'mutation');
  return copy.errors.save;
}

/** Haptics and the toast for a fresh completion, with «Отменить». */
export function announceCompletion(result: MutationResult, stepName: string, showToast: ShowToast): void {
  // Package 5 moves the level-up and milestone moments to the flask animation and sheet.
  if (result.milestoneReached) haptics.milestone();
  else if (result.levelChange > 0) haptics.levelUp(result.levelChange);
  else haptics.success();
  const completionId = result.completionId;
  pendingUndo = completionId;
  showToast(completionMessage(result, stepName), {
    action: { label: copy.completion.undo, onClick: () => void undoCompletion(completionId, showToast) },
  });
}

/** The toast's «Отменить»: cancels exactly the completion the toast announced, once. */
export async function undoCompletion(completionId: string, showToast: ShowToast): Promise<void> {
  if (pendingUndo !== completionId) return;
  pendingUndo = null;
  try {
    const { after } = await cancelCompletion(completionId);
    haptics.warning();
    showToast(copy.completion.cancelled(after.currentFlask, after.pointsInCurrentFlask, after.currentCapacity));
  } catch (error) {
    haptics.error();
    showToast(errorMessage(error));
  }
}

/** Drops the pending undo once the completion was cancelled another way (the completion sheet). */
export function forgetUndo(completionId: string): void {
  if (pendingUndo === completionId) pendingUndo = null;
}
