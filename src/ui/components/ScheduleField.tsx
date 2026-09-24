import { useId } from 'react';
import type { StepSchedule, Weekday } from '../../domain/types';
import { MAX_TIMES } from '../../domain/schedule';
import { haptics } from '../../platform/haptics';
import { copy } from '../copy';
import { Stepper } from './Stepper';

// «ПОВТОР» of the step form: when the step shows up on «Сегодня». One select for the kind,
// then what that kind needs — seven weekday toggles, or the N of a quota. The texts say what
// happens on a day without the completion: nothing (FR-TD-003).

type Kind = StepSchedule['kind'];

const t = copy.stepForm;
const KINDS: [Kind, string][] = [
  ['MANUAL', t.scheduleManual],
  ['DAILY', t.scheduleDaily],
  ['WEEKDAYS', t.scheduleWeekdays],
  ['TIMES_PER_WEEK', t.schedulePerWeek],
  ['TIMES_PER_MONTH', t.schedulePerMonth],
];

/** What a kind starts with when picked: Mon/Wed/Fri, 3 a week, 10 a month. */
function defaultsFor(kind: Kind, previous: StepSchedule): StepSchedule {
  switch (kind) {
    case 'WEEKDAYS':
      return { kind, days: [1, 3, 5] };
    case 'TIMES_PER_WEEK':
    case 'TIMES_PER_MONTH':
      // Switching week ⇄ month keeps the number the user already chose.
      return { kind, times: 'times' in previous ? previous.times : kind === 'TIMES_PER_WEEK' ? 3 : 10 };
    default:
      return { kind };
  }
}

export function ScheduleField({ value, onChange }: { value: StepSchedule; onChange(value: StepSchedule): void }) {
  const hintId = useId();

  function toggleDay(day: Weekday) {
    if (value.kind !== 'WEEKDAYS') return;
    haptics.select();
    const days = value.days.includes(day) ? value.days.filter((d) => d !== day) : [...value.days, day].sort((a, b) => a - b);
    onChange({ kind: 'WEEKDAYS', days });
  }

  const hint =
    value.kind === 'DAILY' || value.kind === 'WEEKDAYS'
      ? value.kind === 'WEEKDAYS' && value.days.length === 0
        ? t.weekdaysEmpty
        : t.dueHint
      : value.kind === 'TIMES_PER_WEEK' || value.kind === 'TIMES_PER_MONTH'
        ? t.quotaHint(value.times)
        : null;

  return (
    <div className="schedule-field">
      <label className="field">
        <span className="field-label">{t.schedule}</span>
        <select
          className="input"
          value={value.kind}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(defaultsFor(e.target.value as Kind, value))}
        >
          {KINDS.map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {value.kind === 'WEEKDAYS' && (
        <div className="weekday-chips" role="group" aria-label={t.weekdays}>
          {copy.today.weekdaysShort.map((short, i) => {
            const day = (i + 1) as Weekday;
            return (
              <button
                key={day}
                type="button"
                className="weekday-chip"
                aria-pressed={value.days.includes(day)}
                aria-label={t.weekdayNames[i]}
                onClick={() => toggleDay(day)}
              >
                {short}
              </button>
            );
          })}
        </div>
      )}

      {(value.kind === 'TIMES_PER_WEEK' || value.kind === 'TIMES_PER_MONTH') && (
        <Stepper
          label={value.kind === 'TIMES_PER_WEEK' ? t.timesPerWeek : t.timesPerMonth}
          value={value.times}
          min={1}
          max={MAX_TIMES}
          describedBy={hintId}
          onChange={(times) => onChange({ kind: value.kind, times: times ?? 1 })}
        />
      )}

      {hint && (
        <p id={hintId} className={`hint small field-hint${value.kind === 'WEEKDAYS' && value.days.length === 0 ? ' is-warning' : ''}`} aria-live="polite">
          {hint}
        </p>
      )}
    </div>
  );
}
