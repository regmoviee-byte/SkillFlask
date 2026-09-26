import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { latestPauseUntil, PAUSE_LENGTHS, pauseUntil, type PauseLength } from '../../domain/pause';
import type { Pause, Skill } from '../../domain/types';
import { addDays, isValidLocalDate } from '../../lib/dates';
import { useBottomButtons } from '../../platform/buttons';
import { haptics } from '../../platform/haptics';
import { changePauseUntil, pauseSkill } from '../../services/pauses';
import { errorMessage } from '../completionFeedback';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { pauseCopy as t } from './strings';

// «Поставить на паузу» and «Изменить дату» (v0.5 package 18, a lazy chunk): how long the skill
// rests — a week, two weeks, a month, until a date, or «пока не сниму». The pause starts today;
// a change keeps its first day and counts the lengths from today. One choice, then «Поставить на
// паузу» (MainButton in Telegram): the sheet says on which day the skill is back in the plan.

type Choice = PauseLength | 'date';

export interface PauseSheetProps {
  skill: Skill;
  /** The running pause: the sheet changes its last day; null — a new pause. */
  pause: Pause | null;
  open: boolean;
  /** Local date of the screen (useToday). */
  today: string;
  onClose(): void;
}

function initial(pause: Pause | null, today: string): { choice: Choice; date: string } {
  if (!pause) return { choice: 'week', date: pauseUntil('twoWeeks', today)! };
  if (pause.until === null) return { choice: 'open', date: pauseUntil('twoWeeks', today)! };
  return { choice: 'date', date: pause.until < today ? today : pause.until };
}

export default function PauseSheet({ skill, pause, open, today, onClose }: PauseSheetProps) {
  const [choice, setChoice] = useState<Choice>(() => initial(pause, today).choice);
  const [date, setDate] = useState(() => initial(pause, today).date);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const closeRef = useRef<() => void>(() => {});
  const { showToast } = useToast();
  const dateId = useId();
  // The pause as it was when the sheet opened: «Поставить на паузу» writes a pause that the live
  // query delivers while the sheet is still sliding out, and the title, the intro and the button
  // must not turn into those of «Изменить дату» on the way.
  const [session, setSession] = useState<{ open: boolean; pause: Pause | null }>({ open, pause });
  if (open !== session.open) setSession({ open, pause: open ? pause : session.pause });
  const shown = open && !session.open ? pause : session.pause;
  const editing = shown !== null;

  // A fresh start every time the sheet opens: the running pause, or a week.
  useEffect(() => {
    if (!open) return;
    const start = initial(shown, today);
    setChoice(start.choice);
    setDate(start.date);
    // Only on opening: the live pause moving on while the sheet is open does not reset a choice.
  }, [open]);

  // A new pause rests at least today and tomorrow; a change may end it today.
  const min = editing ? today : addDays(today, 1);
  const max = latestPauseUntil(today);
  const dateValid = isValidLocalDate(date) && date >= min && date <= max;
  const until = choice === 'date' ? (dateValid ? date : null) : pauseUntil(choice, today);
  const valid = choice !== 'date' || dateValid;

  async function submit() {
    if (!valid || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (editing) await changePauseUntil(skill.id, until);
      else await pauseSkill(skill.id, until);
      haptics.success();
      closeRef.current();
      showToast(t.paused(skill.name, until), { icon: 'pause' });
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const main = open ? { text: editing ? t.save : t.submit, onClick: () => void submit(), disabled: !valid, loading: busy } : undefined;
  const { native } = useBottomButtons({ main }, 1);

  const pick = (next: Choice) => {
    if (next === choice) return;
    haptics.select();
    setChoice(next);
  };
  // A radio group is one Tab stop (the checked option); the arrows, Home and End move the choice.
  const choices: Choice[] = [...PAUSE_LENGTHS.filter((length) => length !== 'open'), 'date', 'open'];
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = choices.indexOf(choice);
    const to =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (at + 1) % choices.length
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (at - 1 + choices.length) % choices.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? choices.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    pick(choices[to]!);
    event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  const option = (key: Choice, label: string, meta: string | null) => (
    <li key={key} role="presentation">
      <button
        type="button"
        role="radio"
        aria-checked={choice === key}
        tabIndex={choice === key ? 0 : -1}
        className="pause-option pressable-row"
        onClick={() => pick(key)}
        onKeyDown={onKeyDown}
      >
        <span className="pause-option-mark" aria-hidden="true">
          {choice === key && <Icon name="check" size={16} />}
        </span>
        <span className="pause-option-label">{label}</span>
        {meta && <span className="pause-option-meta">{meta}</span>}
      </button>
    </li>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      closeRef={closeRef}
      title={editing ? t.editTitle : t.title}
      className="pause-sheet"
      footer={
        native ? undefined : (
          <button type="button" className="button button-primary button-block" disabled={!valid || busy} onClick={() => void submit()}>
            {editing ? t.save : t.submit}
          </button>
        )
      }
    >
      <p className="hint pause-intro">{shown ? t.since(shown.from) : t.intro}</p>
      <ul className="card list pause-options" role="radiogroup" aria-label={t.options}>
        {choices.map((key) =>
          key === 'date' ? option(key, t.date, null) : key === 'open' ? option(key, t.length.open, null) : option(key, t.length[key], t.until(pauseUntil(key, today)!)),
        )}
      </ul>
      {choice === 'date' && (
        <div className="field pause-date">
          <label className="field-label" htmlFor={dateId}>
            {t.dateField}
          </label>
          <input
            id={dateId}
            className="input"
            type="date"
            value={date}
            min={min}
            max={max}
            aria-invalid={dateValid ? undefined : true}
            aria-describedby={dateValid ? undefined : `${dateId}-error`}
            onChange={(event) => setDate(event.target.value)}
          />
          {!dateValid && (
            <p id={`${dateId}-error`} className="field-error">
              {editing ? t.dateInvalidEdit : t.dateInvalid}
            </p>
          )}
        </div>
      )}
      <p className="pause-back t-body-strong" aria-live="polite">
        {valid ? (until === null ? t.backOpen : t.back(addDays(until, 1))) : ' '}
      </p>
    </Sheet>
  );
}
