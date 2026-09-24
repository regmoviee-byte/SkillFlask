import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  cancelCompletion,
  getCompletion,
  NOTE_MAX_LENGTH,
  restoreCompletion,
  setCompletionNote,
  type CompletionDetails,
} from '../../services/completions';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { errorMessage, forgetUndo } from '../completionFeedback';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

// «Выполнение»: opened from a history row. The note is editable for every completion (it is
// not progress, decision 14.8); cancel and restore only while the skill is active (14.9).
// A typed note is never thrown away: swipe, scrim, Back, cancel and restore all save it.

/** The counter appears once the note gets close to the limit. */
const COUNTER_FROM = 400;
const NOTE_ROWS = { min: 2, max: 5 };

export function CompletionSheet({ completionId, onClose }: { completionId: string | null; onClose(): void }) {
  // Keep the last completion on screen while the sheet animates out.
  const [shownId, setShownId] = useState(completionId);
  if (completionId !== null && completionId !== shownId) setShownId(completionId);
  const details = useLiveQuery(() => (shownId ? getCompletion(shownId) : null), [shownId]);
  const loaded = details?.completion.id === shownId ? details : undefined;
  return (
    <CompletionSheetView
      key={shownId ?? 'none'}
      open={completionId !== null && loaded !== undefined && loaded !== null}
      details={loaded ?? null}
      onClose={onClose}
    />
  );
}

function CompletionSheetView({ open, details, onClose }: { open: boolean; details: CompletionDetails | null; onClose(): void }) {
  const t = copy.completionSheet;
  const { showToast } = useToast();
  const closeRef = useRef<() => void>(() => {});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Set once the note was written by an action, so the close that follows does not save it again.
  const settled = useRef(false);

  // Reopening the same completion starts clean (the view is keyed by completion, not by opening).
  useEffect(() => {
    if (!open) return;
    setNote(null);
    setBusy(false);
    settled.current = false;
  }, [open]);

  const stored = details?.completion.note ?? '';
  const value = note ?? stored;
  const dirty = value.trim() !== stored;

  // Dismissed with an unsaved note (swipe, scrim, Back): keep it rather than lose it silently.
  function handleClose() {
    onClose();
    if (!details || !dirty || settled.current) return;
    settled.current = true;
    setCompletionNote(details.completion.id, value).then(
      () => showToast(copy.completionSheet.noteSaved),
      (error: unknown) => {
        haptics.error();
        showToast(errorMessage(error));
      },
    );
  }

  // Auto-grow between 2 and 5 lines; the rest scrolls inside the field.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 21;
    const paddingY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    el.style.height = 'auto';
    const borderY = el.offsetHeight - el.clientHeight;
    const lines = Math.min(NOTE_ROWS.max, Math.max(NOTE_ROWS.min, Math.round((el.scrollHeight - paddingY) / line)));
    el.style.height = `${lines * line + paddingY + borderY}px`;
  }, [value, open]);

  if (!details) return <Sheet open={false} onClose={onClose} />;
  const { completion, skill, progressAfter } = details;
  const editable = skill.status === 'ACTIVE';

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      // Cancel and restore keep a note typed alongside them.
      if (dirty) await setCompletionNote(completion.id, value);
      const message = await action();
      settled.current = true;
      closeRef.current();
      showToast(message);
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
      setBusy(false);
    }
  }

  const saveNote = () =>
    run(async () => {
      haptics.success(); // run() has already written the dirty note
      return t.noteSaved;
    });

  async function cancel() {
    // Rule: dialogs.confirm runs synchronously in the click handler, before any await.
    const ok = await dialogs.confirm(t.confirmCancel(completion.stepName, completion.date), {
      okLabel: t.confirmCancelOk,
      cancelLabel: t.keep,
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const { after } = await cancelCompletion(completion.id);
      forgetUndo(completion.id);
      haptics.warning();
      return copy.completion.cancelled(after.currentFlask, after.pointsInCurrentFlask, after.currentCapacity);
    });
  }

  const restore = () =>
    run(async () => {
      await restoreCompletion(completion.id);
      haptics.success();
      return copy.completion.restored;
    });

  const cancelled = completion.status === 'CANCELLED';

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title={completion.stepName}
      closeRef={closeRef}
      className="completion-sheet"
      footer={
        <>
          <button type="button" className="button button-primary button-block" disabled={!dirty || busy} onClick={saveNote}>
            {t.saveNote}
          </button>
          {editable && !cancelled && (
            <button type="button" className="button button-danger button-block" disabled={busy} onClick={cancel}>
              {t.cancel}
            </button>
          )}
          {editable && cancelled && (
            <button type="button" className="button button-block" disabled={busy} onClick={restore}>
              {t.restore}
            </button>
          )}
        </>
      }
    >
      <p className="completion-meta hint">
        {t.meta(completion.date, completion.pointsAwarded, progressAfter.currentFlask, progressAfter.pointsInCurrentFlask, progressAfter.currentCapacity)}
      </p>
      {cancelled && completion.cancelledAt && <p className="completion-meta hint">{t.cancelledAt(completion.cancelledAt)}</p>}
      {/* Package 8: «Минуты» of a TIMED completion (correctDuration) goes here. */}
      <label className="field completion-note">
        <span className="field-label">{t.note}</span>
        <textarea
          ref={textarea}
          className="input note-input"
          rows={NOTE_ROWS.min}
          value={value}
          maxLength={NOTE_MAX_LENGTH}
          placeholder={t.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
        />
        {value.length > COUNTER_FROM && (
          <span className="hint small note-counter" aria-live="polite">
            {t.noteCounter(value.length, NOTE_MAX_LENGTH)}
          </span>
        )}
      </label>
    </Sheet>
  );
}
