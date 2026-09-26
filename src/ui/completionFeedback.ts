// What the user feels and reads after a completion: haptics, one toast with «Заметка» and
// «Отменить» for 6 s, and the undo itself (a CANCELLATION row, never a delete). Shared by the
// step row, the «Задним числом» screen, the Today tab and the timer. A filled flask or a reached
// milestone is celebrated on top of this by celebrations/CelebrationProvider.tsx.
// «Заметка» (v0.5 package 17) opens the completion sheet with its note field focused, through
// the one CompletionNoteHost the app mounts; with «Спрашивать заметку после каждого действия»
// on, a tap's completion opens it by itself.

import { BackupError } from '../data/backup';
import { cancelCompletion, type MutationResult } from '../services/completions';
import { ValidationError } from '../services/core';
import { getSetting, type SettingKey } from '../services/settings';
import { haptics } from '../platform/haptics';
import { logError } from '../platform/errorLog';
import { primeKeyboard } from '../platform/viewport';
import type { useCelebrations } from './celebrations/CelebrationProvider';
import { openSheetCount } from './components/Sheet';
import type { ShowToast } from './components/Toast';
import { copy, type LevelCopy } from './copy';

// Only the latest completion toast is on screen (a new toast replaces the old), so one
// pending undo is enough. Keyed by completion id: an action left over from an earlier toast
// can never cancel a different completion.
let pendingUndo: string | null = null;

/** The completion sheet of the app-wide host (ui/sheets/CompletionNoteHost.tsx). */
let noteOpener: ((completionId: string) => void) | null = null;

/** CompletionNoteHost registers how it opens; returns the unregister. */
export function registerNoteOpener(open: (completionId: string) => void): () => void {
  noteOpener = open;
  return () => {
    if (noteOpener === open) noteOpener = null;
  };
}

/** Opens the completion's sheet with the note field focused. */
export function openCompletionNote(completionId: string): void {
  noteOpener?.(completionId);
}

/** The setting «Спрашивать заметку после каждого действия» (Settings → «Выполнение»); off by default. */
export const ASK_NOTE_KEY = 'askNote' satisfies SettingKey;

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
    secondary: {
      label: copy.completion.note,
      onClick: () => {
        // In the tap: the sheet appears once its data is read, too late for iOS to raise the keyboard.
        primeKeyboard();
        openCompletionNote(completionId);
      },
    },
  });
}

/**
 * The UI side of a completion written from a tap (the step row's ✓, the timer's «Завершить»):
 * freeze the skill's hero, write, then the toast with «Заметка» and «Отменить» and the
 * celebrations, the «+N» flying from `source`. With «Спрашивать заметку» on, the completion's
 * sheet then opens with the note focused — unless the write came with a note field of its own
 * (`noteField`: «Сколько минут?»), reached the milestone (its sheet is the moment) or another
 * sheet is open. A failed write (a double tap's second one included) opens nothing: it releases
 * the hero and rethrows for the caller to report.
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
    /** The write came from «Сколько минут?», which has a note field: the setting does not ask again. */
    noteField?: boolean;
  },
): Promise<MutationResult> {
  // Read alongside the write, so asking adds no wait after it.
  const ask = ctx.noteField ? Promise.resolve(false) : getSetting<boolean>(ASK_NOTE_KEY, false).catch(() => false);
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
  // Never held up by the setting: the ✓ turns green at once, the sheet follows the read.
  if (!result.milestoneReached) {
    void ask.then((on) => {
      if (on === true && openSheetCount() === 0) openCompletionNote(result.completionId);
    });
  }
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
