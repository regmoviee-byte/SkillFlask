import { useEffect, useId, useRef, useState } from 'react';
import { MAX_MINUTES, timedPoints } from '../../domain/points';
import type { StepDefinition } from '../../domain/types';
import { useBottomButtons } from '../../platform/buttons';
import { copy } from '../copy';
import { Sheet } from '../components/Sheet';
import { Stepper } from '../components/Stepper';

// «Сколько минут?» — the step before a TIMED completion is recorded. Common durations are one
// tap away (the step's usual minutes first and preselected), any other is typed; the points it
// will earn are shown live, rounded exactly as the journal will round them. «Готово» is the
// Telegram MainButton while the sheet is open.

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
  /** Called after the sheet has started closing, with whole minutes in 1..1440. */
  onDone(minutes: number): void;
}

export function MinutesSheet({ open, step, onClose, onDone }: MinutesSheetProps) {
  const t = copy.minutes;
  const [minutes, setMinutes] = useState<number | null>(step.defaultMinutes);
  const closeRef = useRef<() => void>(() => {});
  const earnId = useId();
  // Every opening starts from the usual minutes again.
  useEffect(() => {
    if (open) setMinutes(step.defaultMinutes);
  }, [open, step.defaultMinutes]);

  const valid = minutes !== null && minutes >= 1 && minutes <= MAX_MINUTES;
  const points = valid ? timedPoints(minutes, step.pointsPerMinute ?? 0) : null;

  function done() {
    if (!valid) return;
    // Close first (it pops the sheet's history entry), so a celebration sheet that the
    // completion may open never stacks on this one.
    closeRef.current();
    onDone(minutes);
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
    </Sheet>
  );
}
