import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MARK_DESCRIPTION_MAX, MARK_TITLE_MAX, MarkError, validateMark, type MarkField } from '../../domain/marks';
import type { Mark } from '../../domain/types';
import { formatDate, localDate } from '../../lib/dates';
import { useBottomButtons } from '../../platform/buttons';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { createMark, deleteMark, MarkValidationError, updateMark } from '../../services/marks';
import { errorMessage } from '../completionFeedback';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

// «Засечка»: one sheet for a new mark, for looking at one and for editing it. The position
// (flask, points) is shown but never edited: it is a fact of the moment the mark was written.
// «Сохранить» / «Изменить» are the Telegram MainButton while the sheet is open.

/** What the sheet shows: a new mark of the skill, or an existing one by id. */
export type MarkSheetTarget = { kind: 'new' } | { kind: 'mark'; id: string };

interface MarkSheetProps {
  target: MarkSheetTarget | null;
  skillId: string;
  /** The skill's marks (the live query), to look the target up in. */
  marks: readonly Mark[];
  /** Capacity of a flask number as it is now. */
  capacityOf(flaskNumber: number): number;
  /** Edit and delete only while the skill is ACTIVE. */
  editable: boolean;
  onClose(): void;
}

export function MarkSheet({ target, skillId, marks, capacityOf, editable, onClose }: MarkSheetProps) {
  // Keep the last target on screen while the sheet animates out.
  const [shown, setShown] = useState<MarkSheetTarget | null>(target);
  if (target !== null && target !== shown) setShown(target);
  const live = shown?.kind === 'mark' ? marks.find((m) => m.id === shown.id) : undefined;
  // A deleted mark stays on screen while the sheet slides away.
  const [kept, setKept] = useState<Mark | undefined>(live);
  if (live && live !== kept) setKept(live);
  const mark = live ?? (shown?.kind === 'mark' && kept?.id === shown.id ? kept : undefined);
  // A mark deleted elsewhere closes the sheet rather than showing an empty one.
  const missing = shown?.kind === 'mark' && !live;
  const key = shown === null ? 'none' : shown.kind === 'new' ? 'new' : shown.id;
  return (
    <MarkSheetView
      key={key}
      open={target !== null && !missing}
      skillId={skillId}
      mark={mark}
      capacity={mark ? capacityOf(mark.flaskNumber) : undefined}
      editable={editable}
      onClose={onClose}
    />
  );
}

interface ViewProps {
  open: boolean;
  skillId: string;
  mark: Mark | undefined;
  capacity: number | undefined;
  editable: boolean;
  onClose(): void;
}

type Draft = { title: string; description: string; date: string };

function MarkSheetView({ open, skillId, mark, capacity, editable, onClose }: ViewProps) {
  const t = copy.marks;
  const { showToast } = useToast();
  const closeRef = useRef<() => void>(() => {});
  const today = localDate();
  const [mode, setMode] = useState<'view' | 'edit'>(mark ? 'view' : 'edit');
  const [draft, setDraft] = useState<Draft>(() => draftOf(mark, today));
  const [errors, setErrors] = useState<Partial<Record<MarkField | 'form', string>>>({});
  const [busy, setBusy] = useState(false);
  // Rule: a double tap must not save twice; the ref flips before the first await.
  const busyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const dateId = useId();
  const descriptionId = useId();

  // Every opening starts from what is stored.
  useEffect(() => {
    if (!open) return;
    setMode(mark ? 'view' : 'edit');
    setDraft(draftOf(mark, localDate()));
    setErrors({});
    // Only on opening: a live update of the mark must not wipe what is being typed.
  }, [open]);

  const editing = mode === 'edit';
  const stored = draftOf(mark, today);
  const dirty = editing && (draft.title !== stored.title || draft.description !== stored.description || draft.date !== stored.date);

  function set(field: MarkField, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (errors[field] || errors.form) setErrors({});
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busyRef.current) return;
    try {
      validateMark(draft, localDate());
    } catch (error) {
      if (!(error instanceof MarkError)) throw error;
      haptics.error();
      setErrors({ [error.field]: error.message });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      if (mark) await updateMark(mark.id, draft);
      else await createMark(skillId, draft);
      haptics.tap();
      closeRef.current();
      showToast(mark ? t.saved : t.added);
    } catch (error) {
      haptics.error();
      setErrors(error instanceof MarkValidationError ? { [error.field]: error.message } : { form: errorMessage(error) });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function remove() {
    if (!mark || busyRef.current) return;
    // dialogs.confirm runs synchronously in the click handler, before any await.
    const answer = dialogs.confirm(t.confirmRemove(mark.title), { okLabel: t.remove, cancelLabel: t.keep, danger: true });
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      try {
        if (!(await answer)) return;
        await deleteMark(mark.id);
        haptics.tap();
        closeRef.current();
        showToast(t.removed);
      } catch (error) {
        haptics.error();
        showToast(errorMessage(error));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }

  const main = !open
    ? undefined
    : editing
      ? { text: t.save, onClick: () => formRef.current?.requestSubmit(), loading: busy }
      : editable
        ? { text: t.edit, onClick: () => setMode('edit') }
        : undefined;
  const { native } = useBottomButtons({ main }, 1);

  const footer = (
    <>
      {main && !native && (
        <button type="button" className="button button-primary button-block" disabled={busy} onClick={main.onClick}>
          {main.text}
        </button>
      )}
      {!editing && editable && mark && (
        <button type="button" className="button button-danger button-block" disabled={busy} onClick={remove}>
          {t.remove}
        </button>
      )}
    </>
  );

  const title = editing ? (mark ? t.editTitle : t.newTitle) : (mark?.title ?? t.mark);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      closeRef={closeRef}
      className="mark-sheet"
      // A form with typed text closes only through Back or the buttons, never by a stray swipe.
      dismissible={!dirty}
      footer={footer}
    >
      {!editing && mark ? (
        <div className="mark-view">
          <p className="mark-view-meta hint">
            <Icon name="pennant" size={18} />
            <span>{formatDate(mark.date)}</span>
          </p>
          {capacity !== undefined && <p className="mark-view-position">{t.position(mark.flaskNumber, mark.pointsInFlask, capacity)}</p>}
          {mark.description && <p className="mark-view-description">{mark.description}</p>}
        </div>
      ) : (
        <form ref={formRef} className="form mark-form" onSubmit={save} noValidate>
          {mark && capacity !== undefined && <p className="hint mark-form-position">{t.position(mark.flaskNumber, mark.pointsInFlask, capacity)}</p>}
          <div className="field">
            <label className="field-label" htmlFor={titleId}>
              {t.name}
            </label>
            <input
              id={titleId}
              className="input"
              value={draft.title}
              maxLength={MARK_TITLE_MAX}
              placeholder={t.namePlaceholder}
              enterKeyHint="next"
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? `${titleId}-error` : undefined}
              onChange={(e) => set('title', e.target.value)}
            />
            {errors.title && (
              <span id={`${titleId}-error`} className="field-hint field-error" role="alert">
                {errors.title}
              </span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor={dateId}>
              {t.date}
            </label>
            <input
              id={dateId}
              className="input"
              type="date"
              value={draft.date}
              max={today}
              aria-invalid={errors.date ? true : undefined}
              aria-describedby={errors.date ? `${dateId}-error` : undefined}
              onChange={(e) => set('date', e.target.value)}
            />
            {errors.date && (
              <span id={`${dateId}-error`} className="field-hint field-error" role="alert">
                {errors.date}
              </span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor={descriptionId}>
              {t.description}
            </label>
            <textarea
              id={descriptionId}
              className="input note-input"
              rows={3}
              value={draft.description}
              maxLength={MARK_DESCRIPTION_MAX}
              placeholder={t.descriptionPlaceholder}
              aria-invalid={errors.description ? true : undefined}
              onChange={(e) => set('description', e.target.value)}
            />
            {errors.description && (
              <span className="field-hint field-error" role="alert">
                {errors.description}
              </span>
            )}
          </div>
          {errors.form && (
            <p className="field-error" role="alert">
              {errors.form}
            </p>
          )}
        </form>
      )}
    </Sheet>
  );
}

function draftOf(mark: Mark | undefined, today: string): Draft {
  return mark ? { title: mark.title, description: mark.description, date: mark.date } : { title: '', description: '', date: today };
}
