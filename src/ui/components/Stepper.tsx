import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { haptics } from '../../platform/haptics';
import { copy } from '../copy';
import { Icon } from './Icon';

// A number with [−] and [+]: points of an action, usual minutes, the minutes of a completion,
// the N of a quota. The value itself is a numeric field in the display size, so a tap opens
// the digit keyboard for a far-away number; holding − or + repeats after 400 ms every 120 ms.
// Optional preset chips pick a common value in one tap.

const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 120;

export interface StepperProps {
  label: string;
  /** null: empty (only when `optional`). */
  value: number | null;
  onChange(value: number | null): void;
  min: number;
  max: number;
  /** What − and + add; 1 by default. */
  step?: number;
  presets?: readonly number[];
  /** A unit shown after the number, e.g. «мин». */
  unit?: string;
  /** The field may be left empty (the value is null then). */
  optional?: boolean;
  disabled?: boolean;
  /** id of a hint or preview that describes the value. */
  describedBy?: string;
  /** Focus the field on mount (the digit keyboard opens). */
  autoFocus?: boolean;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function Stepper({ label, value, onChange, min, max, step = 1, presets, unit, optional = false, disabled = false, describedBy, autoFocus }: StepperProps) {
  const id = useId();
  // While typing, the field keeps the raw digits (an empty field is fine until it loses focus).
  const [draft, setDraft] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // `fired`: the button whose long press already stepped (its closing click is swallowed).
  const repeat = useRef<{ timer?: number; interval?: number; fired: 0 | 1 | -1 }>({ fired: 0 });
  useEffect(() => () => stopRepeat(), []);

  function set(next: number | null) {
    if (next === valueRef.current) return;
    valueRef.current = next;
    haptics.select();
    onChange(next);
  }

  /**
   * −/+ from the current value. An empty field has nothing to take from (− is disabled then);
   * + fills it with the first preset, the common value, or else the start of the range.
   */
  function nudge(direction: 1 | -1) {
    const current = valueRef.current;
    if (current === null) {
      if (direction < 0) return stopRepeat();
      stopRepeat();
      return set(clamp(presets?.[0] ?? min, min, max));
    }
    // Off the step grid (a typed 37 with step 5) the first tap snaps to it.
    const snapped = direction > 0 ? Math.floor(current / step) * step + step : Math.ceil(current / step) * step - step;
    const next = clamp(snapped, min, max);
    // At the end of the range the button turns disabled and may never see its pointerup.
    if (next === (direction > 0 ? max : min)) stopRepeat();
    set(next);
  }

  function stopRepeat() {
    window.clearTimeout(repeat.current.timer);
    window.clearInterval(repeat.current.interval);
    repeat.current.timer = undefined;
    repeat.current.interval = undefined;
  }

  function startRepeat(direction: 1 | -1, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stopRepeat();
    repeat.current.fired = 0;
    repeat.current.timer = window.setTimeout(() => {
      repeat.current.fired = direction;
      // The interval first: a first step that reaches the end of the range stops it at once.
      repeat.current.interval = window.setInterval(() => nudge(direction), REPEAT_EVERY_MS);
      nudge(direction);
    }, REPEAT_DELAY_MS);
  }

  function click(direction: 1 | -1) {
    stopRepeat();
    // A long press already stepped; the click that ends it must not add one more.
    const fired = repeat.current.fired;
    repeat.current.fired = 0;
    if (fired === direction) return;
    nudge(direction);
  }

  function type(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, String(max).length);
    setDraft(digits);
    if (digits) onChange(Number(digits));
    else if (optional) onChange(null);
  }

  function commit() {
    if (draft === null) return;
    setDraft(null);
    if (!draft) {
      if (!optional) onChange(valueRef.current ?? min);
      return;
    }
    const n = clamp(Number(draft), min, max);
    if (n !== Number(draft)) onChange(n);
  }

  const shown = draft ?? (value === null ? '' : String(value));
  const buttonProps = (direction: 1 | -1) => ({
    type: 'button' as const,
    className: 'stepper-button',
    'aria-controls': id,
    disabled: disabled || (value === null ? direction < 0 : direction > 0 ? value >= max : value <= min),
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => startRepeat(direction, event),
    onPointerUp: stopRepeat,
    onPointerLeave: stopRepeat,
    onPointerCancel: stopRepeat,
    onClick: () => click(direction),
    // The context menu of a long press on Android would cancel the repeat.
    onContextMenu: (event: { preventDefault(): void }) => event.preventDefault(),
  });

  return (
    <div className={`stepper-field${disabled ? ' is-disabled' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="stepper">
        <button {...buttonProps(-1)} aria-label={copy.stepper.less}>
          <Icon name="minus" size={22} />
        </button>
        <span className="stepper-value">
          <input
            id={id}
            className="stepper-input t-display-l"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={shown}
            // As wide as the number, so a unit sits right next to it.
            style={{ width: `${Math.max(shown.length, 1) + 0.5}ch` }}
            placeholder="—"
            disabled={disabled}
            autoFocus={autoFocus}
            aria-describedby={describedBy}
            onChange={(e) => type(e.target.value)}
            onBlur={commit}
            onFocus={(e) => e.target.select()}
          />
          {unit && <span className="stepper-unit" aria-hidden="true">{unit}</span>}
        </span>
        <button {...buttonProps(1)} aria-label={copy.stepper.more}>
          <Icon name="plus" size={22} />
        </button>
      </div>
      {presets && presets.length > 0 && (
        <div className="chips stepper-presets" role="group" aria-label={copy.stepper.presets}>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="chip"
              aria-pressed={value === preset}
              disabled={disabled}
              onClick={() => {
                setDraft(null);
                set(preset);
              }}
            >
              {unit ? `${preset} ${unit}` : preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
