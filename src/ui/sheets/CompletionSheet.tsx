import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  cancelCompletion,
  correctDuration,
  getCompletion,
  NOTE_MAX_LENGTH,
  restoreCompletion,
  setCompletionNote,
  type CompletionDetails,
} from '../../services/completions';
import { MAX_MINUTES, timedPoints, toDeci, fromDeci } from '../../domain/points';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { useCelebrations } from '../celebrations/CelebrationProvider';
import { errorMessage, forgetUndo, isCelebrated } from '../completionFeedback';
import { Sheet } from '../components/Sheet';
import { Stepper } from '../components/Stepper';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { copyForSkill } from '../progress/registry';

// «Выполнение»: opened from a history row. The note is editable for every completion (it is
// not progress, decision 14.8); cancel and restore only while the skill is active (14.9).
// A typed note is never thrown away: swipe, scrim, Back, cancel and restore all save it — the
// sheet says so under the field. «Вернуть» that refills a flask is celebrated like a completion.
// A TIMED completion also shows its minutes: «Пересчитать» writes one CORRECTION row for the
// difference at the rate it was recorded with (correctDuration).

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
  const celebrations = useCelebrations();
  const closeRef = useRef<() => void>(() => {});
  const [note, setNote] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const minutesHintId = useId();
  const [busy, setBusy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Set once the note was written by an action, so the close that follows does not save it again.
  const settled = useRef(false);

  // Reopening the same completion starts clean (the view is keyed by completion, not by opening).
  useEffect(() => {
    if (!open) return;
    setNote(null);
    setMinutes(null);
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
      return copyForSkill(skill).cancelled(after.currentFlask, after.pointsInCurrentFlask, after.currentCapacity);
    });
  }

  const restore = () =>
    run(async () => {
      // Hold the flask behind the sheet so a refilled flask plays its level-up, not a jump.
      const release = celebrations.hold(skill.id);
      try {
        const result = await restoreCompletion(completion.id);
        if (!isCelebrated(result)) haptics.success();
        void celebrations.celebrateResult(result, { skillId: skill.id }).finally(release);
      } catch (error) {
        release();
        throw error;
      }
      return copy.completion.restored;
    });

  const cancelled = completion.status === 'CANCELLED';
  const timed = completion.stepType === 'TIMED' && completion.durationMinutes !== null;
  const storedMinutes = completion.durationMinutes ?? 0;
  const newMinutes = minutes ?? storedMinutes;
  const minutesValid = newMinutes >= 1 && newMinutes <= MAX_MINUTES;
  const recalcDelta = fromDeci(toDeci(timedPoints(newMinutes, completion.pointsSnapshot)) - toDeci(completion.pointsAwarded));
  const canRecalc = editable && !cancelled && timed && minutesValid && newMinutes !== storedMinutes;

  const recalc = () =>
    run(async () => {
      // A longer duration may fill a flask: hold it behind the sheet, as «Вернуть» does.
      const release = celebrations.hold(skill.id);
      try {
        const result = await correctDuration(completion.id, newMinutes);
        if (!isCelebrated(result)) haptics.success();
        void celebrations.celebrateResult(result, { skillId: skill.id }).finally(release);
        return copy.completion.durationChanged(result.delta);
      } catch (error) {
        release();
        throw error;
      }
    });

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title={completion.stepName}
      closeRef={closeRef}
      className="completion-sheet"
      footer={
        <>
          {timed && editable && !cancelled && (
            <button type="button" className="button button-primary button-block" disabled={!canRecalc || busy} onClick={recalc}>
              {t.recalc}
            </button>
          )}
          <button
            type="button"
            className={`button button-block${timed && editable && !cancelled ? '' : ' button-primary'}`}
            disabled={!dirty || busy}
            onClick={saveNote}
          >
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
        {copyForSkill(skill).completionMeta(completion.date, completion.pointsAwarded, progressAfter.currentFlask, progressAfter.pointsInCurrentFlask, progressAfter.currentCapacity)}
      </p>
      {cancelled && completion.cancelledAt && <p className="completion-meta hint">{t.cancelledAt(completion.cancelledAt)}</p>}
      {timed && <p className="completion-meta hint">{t.timedMeta(storedMinutes, completion.pointsSnapshot)}</p>}
      {timed && editable && !cancelled && (
        <div className="completion-minutes">
          <Stepper label={t.minutes} value={newMinutes} onChange={setMinutes} min={1} max={MAX_MINUTES} step={5} unit={copy.minutes.unit} describedBy={minutesHintId} />
          <p id={minutesHintId} className="hint small field-hint" aria-live="polite">
            {canRecalc ? t.minutesPreview(storedMinutes, completion.pointsAwarded, newMinutes, recalcDelta) : '\u00a0'}
          </p>
        </div>
      )}
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
        {value.length > COUNTER_FROM ? (
          <span className="hint small note-counter" aria-live="polite">
            {t.noteCounter(value.length, NOTE_MAX_LENGTH)}
          </span>
        ) : (
          <span className="field-hint hint small">{t.noteAutosave}</span>
        )}
      </label>
    </Sheet>
  );
}
