import { addDays, isoWeekday, weekStart } from '../../lib/dates';
import { haptics } from '../../platform/haptics';
import { copy } from '../copy';

// The week, Monday first. Facts only (principle 3.3, copy rule 3): no target, no streak, no
// count of the days without activity, never red — a day without a completion looks like a day
// still to come.
// - WeekStrip: seven dots on a bento tile (home), filled on a day with a completion.
// - WeekPicker: the strip of «Сегодня» v2, seven buttons; a past day is picked to see and
//   record on it, days ahead cannot be picked, small dots count a day's completions.

interface WeekStripProps {
  /** Monday..Sunday: true on a date with an ACTIVE completion (getHomeView). */
  days: boolean[];
  /** Local date the strip is for; its weekday gets the outline. */
  today: string;
}

export function WeekStrip({ days, today }: WeekStripProps) {
  const todayIndex = isoWeekday(today) - 1;
  const active = days.filter(Boolean).length;
  return (
    <div className="week-strip" role="img" aria-label={copy.today.week(active)}>
      {days.map((on, i) => (
        <span key={i} className={`week-day${on ? ' is-active' : ''}${i === todayIndex ? ' is-today' : ''}`} aria-hidden="true">
          <span className="week-dot" />
          <span className="week-initial">{copy.today.weekdays[i]}</span>
        </span>
      ))}
    </div>
  );
}

/** Dots under a day: one per completion, three at most (a count, not a score). */
const MAX_DOTS = 3;

interface WeekPickerProps {
  today: string;
  /** The picked date, in the week of `today` and not after it. */
  selected: string;
  /** ACTIVE completions per day, Monday..Sunday (getDayPlan().weekActivity). */
  counts: number[];
  onSelect(date: string): void;
}

export function WeekPicker({ today, selected, counts, onSelect }: WeekPickerProps) {
  const monday = weekStart(today);
  const t = copy.today;
  return (
    <div className="week-picker" role="group" aria-label={t.weekPicker}>
      {t.weekdaysShort.map((short, i) => {
        const date = addDays(monday, i);
        const ahead = date > today;
        const n = counts[i] ?? 0;
        return (
          <button
            key={date}
            type="button"
            className={`week-picker-day${date === today ? ' is-today' : ''}`}
            aria-pressed={date === selected}
            aria-label={t.dayLabel(date, n)}
            disabled={ahead}
            onClick={() => {
              if (date === selected) return;
              haptics.select();
              onSelect(date);
            }}
          >
            <span className="week-picker-name">{short}</span>
            <span className="week-picker-date">{Number(date.slice(8))}</span>
            <span className="week-picker-dots" aria-hidden="true">
              {Array.from({ length: ahead ? 0 : Math.min(n, MAX_DOTS) }, (_, k) => (
                <span key={k} className="week-picker-dot" />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
