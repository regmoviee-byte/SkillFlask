// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayActivity } from '../../domain/activity';
import { setClock } from '../../lib/clock';
import { Heatmap, heatmapLayout } from './Heatmap';

beforeEach(() => setClock(() => new Date('2026-09-24T12:00:00')));
afterEach(() => {
  cleanup();
  setClock(null);
});

describe('heatmapLayout', () => {
  it('lays half a year out in week columns, Monday first, and labels the column where each month begins', () => {
    const layout = heatmapLayout('2026-03-30', '2026-09-24');
    expect(layout.weeks).toBe(26);
    expect(layout.dates).toHaveLength(182);
    expect(layout.dates.slice(0, 7)).toEqual(['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05']);
    expect(layout.dates[layout.todayIndex]).toBe('2026-09-24');
    expect(layout.months).toEqual([
      { column: 0, month: 3 },
      { column: 4, month: 4 },
      { column: 9, month: 5 },
      { column: 13, month: 6 },
      { column: 17, month: 7 },
      { column: 22, month: 8 },
    ]);
  });

  it('crosses a year: January is labelled where it begins, the days after today are the end of the grid', () => {
    const layout = heatmapLayout('2026-07-13', '2027-01-06');
    expect(layout.weeks).toBe(26);
    expect(layout.months).toEqual([
      { column: 2, month: 7 },
      { column: 7, month: 8 },
      { column: 11, month: 9 },
      { column: 15, month: 10 },
      { column: 20, month: 11 },
      { column: 24, month: 0 },
    ]);
    expect(layout.dates.slice(layout.todayIndex)).toEqual(['2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10']);
  });

  it('names the first column’s month when the next label leaves room, and never a month that has not begun', () => {
    const layout = heatmapLayout('2026-03-02', '2026-08-26');
    expect(layout.months.slice(0, 2)).toEqual([
      { column: 0, month: 2 },
      { column: 4, month: 3 },
    ]);
    // 1 October is a Thursday of this week, still ahead on the 29th of September.
    const beforeOctober = heatmapLayout('2026-04-06', '2026-09-29');
    expect(beforeOctober.months.at(-1)).toEqual({ column: 21, month: 8 });
  });
});

describe('Heatmap', () => {
  const days = new Map<string, DayActivity>([
    ['2026-09-24', { date: '2026-09-24', points: 25, completions: 3 }],
    ['2026-09-17', { date: '2026-09-17', points: 5, completions: 1 }],
    ['2026-08-03', { date: '2026-08-03', points: 10, completions: 1 }],
  ]);

  function renderMap(onSelect = vi.fn()) {
    render(<Heatmap from="2026-03-30" today="2026-09-24" days={days} label="За полгода: 3 дня с занятиями" onSelect={onSelect} />);
    return { onSelect, grid: screen.getByRole('group', { name: 'За полгода: 3 дня с занятиями' }) };
  }

  it('draws a button per day up to today, each named by its date and what was done', () => {
    const { grid } = renderMap();
    const cells = within(grid).getAllByRole('button');
    expect(cells).toHaveLength(179);
    expect(cells.at(-1)!.getAttribute('aria-label')).toBe('24 сентября: 3 действия, 25 очков');
    expect(within(grid).getByRole('button', { name: '17 сентября: 1 действие, 5 очков' }).dataset.level).toBe('1');
    expect(within(grid).getByRole('button', { name: '3 августа: 1 действие, 10 очков' }).dataset.level).toBe('2');
    const quiet = within(grid).getByRole('button', { name: '23 сентября' });
    expect(quiet.dataset.level).toBe('0');
    // Today is outlined, the three days after it are kept in the grid but not drawn.
    expect(cells.at(-1)!.classList.contains('is-today')).toBe(true);
    expect(grid.querySelectorAll('.is-future')).toHaveLength(3);
  });

  it('opens a day on a tap', () => {
    const { onSelect, grid } = renderMap();
    fireEvent.click(within(grid).getByRole('button', { name: '3 августа: 1 действие, 10 очков' }));
    expect(onSelect).toHaveBeenCalledWith('2026-08-03');
  });

  it('is one tab stop moved by the arrows: a day up and down, a week left and right, never past today', () => {
    const { grid } = renderMap();
    const tabbable = () => within(grid).getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(tabbable().map((b) => b.getAttribute('aria-label'))).toEqual(['24 сентября: 3 действия, 25 очков']);
    const today = tabbable()[0]!;
    today.focus();
    fireEvent.keyDown(today, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('17 сентября: 1 действие, 5 очков');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('16 сентября');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('24 сентября: 3 действия, 25 очков');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('30 марта');
    expect(tabbable()).toHaveLength(1);
  });
});
