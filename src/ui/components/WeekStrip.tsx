import { isoWeekday } from '../../lib/dates';
import { copy } from '../copy';

// Seven dots, Monday first: filled on a day with at least one completion, today outlined.
// Facts only (principle 3.3, copy rule 3): no target, no streak, no count of the other days,
// and a day without activity is the same neutral dot as a day still to come.

interface WeekStripProps {
  /** Monday..Sunday: true on a date with an ACTIVE completion (getHomeView / getTodayView). */
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
