import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { intensity, intensityScale, type DayActivity } from '../../domain/activity';
import { addDays, diffDays, weekStart } from '../../lib/dates';
import { haptics } from '../../platform/haptics';
import { insightsCopy } from '../insights/strings';

// «Активность»: a heat map of the days of practice, weeks as columns (Monday at the top), the
// last `weeks` weeks ending with the current one. Cells scale with the width (CSS grid of
// 1fr columns, the grid itself 26 : 7), so it fits a 320 px phone without scrolling sideways.
// Intensity 0..4 from domain/activity.ts (quartiles of the map's own days); the colour is
// `--heat` — the skill colour inside a skill's scope, the accent on the home screen (styles.css).
// Today is outlined; the days still to come this week are not drawn. One tab stop: the arrows
// move a day (up, down) or a week (left, right), Home and End jump to the first day and today.
// A day without practice looks like any quiet day, never red (copy rule 2).

export interface HeatmapLayout {
  /** Number of week columns. */
  weeks: number;
  /** Every date of the map, column by column (Monday..Sunday), the days after today included. */
  dates: string[];
  /** Index of today in `dates`. */
  todayIndex: number;
  /** Month labels: the column that holds the 1st of the month (0-based) and the month (0..11). */
  months: { column: number; month: number }[];
}

/** A month label needs about this many columns; a closer one before it is dropped. */
const LABEL_COLUMNS = 3;

/** The columns of the map from the Monday `from` to the week of `today`, and where each month starts. */
export function heatmapLayout(from: string, today: string): HeatmapLayout {
  const weeks = Math.max(1, diffDays(from, weekStart(today)) / 7 + 1);
  const dates = Array.from({ length: weeks * 7 }, (_, i) => addDays(from, i));
  const months: { column: number; month: number }[] = [];
  for (let column = 0; column < weeks; column++) {
    // The column where a month begins, among the days already drawn.
    const first = dates.slice(column * 7, column * 7 + 7).find((date) => date.endsWith('-01') && date <= today);
    if (first) months.push({ column, month: Number(first.slice(5, 7)) - 1 });
  }
  // The first column names its month too when the next label leaves room for it.
  const next = months[0]?.column ?? Infinity;
  if (next >= LABEL_COLUMNS) months.unshift({ column: 0, month: Number(from.slice(5, 7)) - 1 });
  return { weeks, dates, todayIndex: diffDays(from, today), months };
}

interface HeatmapProps {
  /** The Monday of the first column. */
  from: string;
  today: string;
  days: ReadonlyMap<string, DayActivity>;
  /** The accessible name of the map: «За полгода: 64 дня с занятиями». */
  label: string;
  onSelect(date: string): void;
}

export function Heatmap({ from, today, days, label, onSelect }: HeatmapProps) {
  const t = insightsCopy.activity;
  const layout = heatmapLayout(from, today);
  const scale = intensityScale(days.values());
  const [focus, setFocus] = useState(layout.todayIndex);
  const grid = useRef<HTMLDivElement>(null);
  const focused = Math.min(Math.max(0, focus), layout.todayIndex);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    let next: number;
    if (event.key in step) next = focused + step[event.key]!;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = layout.todayIndex;
    else return;
    event.preventDefault();
    next = Math.min(Math.max(0, next), layout.todayIndex);
    setFocus(next);
    grid.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
  }

  const style = { '--heatmap-weeks': layout.weeks } as CSSProperties;
  return (
    <div className="heatmap" style={style}>
      <div className="heatmap-months" aria-hidden="true">
        {layout.months.map(({ column, month }) => (
          <span key={column} style={{ gridColumnStart: column + 1 }}>
            {t.months[month]}
          </span>
        ))}
      </div>
      <div className="heatmap-body">
        <div className="heatmap-weekdays" aria-hidden="true">
          {t.weekdays.map((name, i) => (
            <span key={i}>{name}</span>
          ))}
        </div>
        <div ref={grid} className="heatmap-grid" role="group" aria-label={label} onKeyDown={move}>
          {layout.dates.map((date, i) => {
            if (i > layout.todayIndex) return <span key={date} className="heatmap-cell is-future" aria-hidden="true" />;
            const day = days.get(date);
            return (
              <button
                key={date}
                type="button"
                className={`heatmap-cell${i === layout.todayIndex ? ' is-today' : ''}`}
                data-level={intensity(day, scale)}
                data-index={i}
                tabIndex={i === focused ? 0 : -1}
                aria-label={t.cell(date, day?.completions ?? 0, day?.points ?? 0)}
                onFocus={() => setFocus(i)}
                onClick={() => {
                  haptics.select();
                  onSelect(date);
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** «меньше ▢▢▢▢▢ больше»: the five levels of the map. */
export function HeatmapLegend() {
  const t = insightsCopy.activity;
  return (
    <span className="heatmap-legend" aria-hidden="true">
      {t.less}
      {([0, 1, 2, 3, 4] as const).map((level) => (
        <span key={level} className="heatmap-cell" data-level={level} />
      ))}
      {t.more}
    </span>
  );
}
