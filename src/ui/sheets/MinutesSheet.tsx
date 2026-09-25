import { useEffect, useId, useRef, useState } from 'react';
import { MAX_MINUTES, timedPoints } from '../../domain/points';
import { isValidLocalDate, localDate } from '../../lib/dates';
import type { StepDefinition } from '../../domain/types';
import { useBottomButtons } from '../../platform/buttons';
import { copy } from '../copy';
import { Sheet } from '../components/Sheet';
import { Stepper } from '../components/Stepper';

// «Сколько минут?» — the step before a TIMED completion is recorded. Common durations are one
// tap away (the step's usual minutes first and preselected), any other is typed; the points it
// will earn are shown live, rounded exactly as the journal will round them. «Готово» is the
// Telegram MainButton while the sheet is open. The live timer's «Завершить» opens it too, with
// the timer's minutes and start day filled in: then a «Дата» field is shown (the day a timer
// ran past midnight on, still editable) and a warning when the timer looks forgotten.

const PRESETS = [15, 30, 45, 60];
const MINUTE_STEP = 5;

/** The chips: the usual minutes first, then the common ones. */
export function minutePresets(defaultMinutes: number | null): number[] {
  return defaultMinutes === null ? PRESETS : [defaultMinutes, ...PRESETS.filter((m) => m !== defaultMinutes)];
}

interface MinutesSheetProps {
  open: boolean;
  step: Pick<StepDefinition, 'name' | 'pointsPerMinute' | 'defaultMinutes'>;
  onClose(): void;
  /**
   * Called after the sheet has started closing, with whole minutes in 1..1440 and, when the
   * sheet shows the date field, the chosen local date (never after today).
   */
  onDone(minutes: number, date?: string): void;
  /** Minutes to start from instead of the step's usual ones (a timer's). */
  initialMinutes?: number;
  /** Shows a «Дата» field starting at this local date (a timer's start day). */
  initialDate?: string;
  /** A line above the field: a timer that ran more than 12 hours or started a week ago. */
  warning?: string | null;
}

export function MinutesSheet({ open, step, onClose, onDone, initialMinutes, initialDate, warning }: MinutesSheetProps) {
  const t = copy.minutes;
  const startMinutes = initialMinutes ?? step.defaultMinutes;
  const [minutes, setMinutes] = useState<number | null>(startMinutes);
  const [date, setDate] = useState(initialDate ?? '');
  const closeRef = useRef<() => void>(() => {});
  const earnId = useId();
  const dateId = useId();
  // Every opening starts from the usual (or the timer's) minutes and date again.
  useEffect(() => {
    if (!open) return;
    setMinutes(startMinutes);
    setDate(initialDate ?? '');
  }, [open, startMinutes, initialDate]);

  const today = localDate();
  const withDate = initialDate !== undefined;
  const dateValid = !withDate || (isValidLocalDate(date) && date <= today);
  const valid = minutes !== null && minutes >= 1 && minutes <= MAX_MINUTES && dateValid;
  const points = minutes !== null && minutes >= 1 && minutes <= MAX_MINUTES ? timedPoints(minutes, step.pointsPerMinute ?? 0) : null;

  function done() {
    if (!valid) return;
    // Close first (it pops the sheet's history entry), so a celebration sheet that the
    // completion may open never stacks on this one.
    closeRef.current();
    onDone(minutes!, withDate ? date : undefined);
  }

  const { native } = useBottomButtons({ main: open ? { text: t.done, onClick: done, disabled: !valid } : undefined }, 1);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t.title}
      closeRef={closeRef}
      className="minutes-sheet"
      footer={
        native ? undefined : (
          <button type="button" className="button button-primary button-block" disabled={!valid} onClick={done}>
            {t.done}
          </button>
        )
      }
    >
      <p className="hint minutes-step">{step.name}</p>
      {warning && <p className="minutes-warning">{warning}</p>}
      <Stepper
        label={t.field}
        value={minutes}
        onChange={setMinutes}
        min={1}
        max={MAX_MINUTES}
        step={MINUTE_STEP}
        presets={minutePresets(step.defaultMinutes)}
        unit={t.unit}
        optional
        describedBy={earnId}
      />
      <p id={earnId} className="minutes-earn t-body-strong" aria-live="polite">
        {points !== null ? t.willEarn(points) : ' '}
      </p>
      {withDate && (
        <div className="field minutes-date">
          <label className="field-label" htmlFor={dateId}>
            {t.date}
          </label>
          <input
            id={dateId}
            className="input"
            type="date"
            value={date}
            max={today}
            aria-invalid={dateValid ? undefined : true}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      )}
    </Sheet>
  );
}
