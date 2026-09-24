import { afterEach, describe, expect, it } from 'vitest';
import { setClock } from './clock';
import {
  addDays,
  diffDays,
  formatDateTime,
  formatDayLabel,
  isoWeekday,
  isValidLocalDate,
  localDate,
  monthEnd,
  monthStart,
  nowIso,
  weekStart,
} from './dates';

afterEach(() => setClock(null));

describe('isValidLocalDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidLocalDate('2026-09-24')).toBe(true);
    expect(isValidLocalDate('2024-02-29')).toBe(true);
    expect(isValidLocalDate('2026-13-45')).toBe(false);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-9-4')).toBe(false);
    expect(isValidLocalDate('2026-09-24T00:00:00')).toBe(false);
    expect(isValidLocalDate(undefined)).toBe(false);
  });
});

describe('addDays / diffDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2025-12-31', '2026-01-01')).toBe(1);
    expect(diffDays('2026-01-01', '2025-12-31')).toBe(-1);
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
  });
});

describe('isoWeekday / weekStart', () => {
  it('maps Monday to 1 and Sunday to 7', () => {
    expect(isoWeekday('2026-09-21')).toBe(1); // Monday
    expect(isoWeekday('2026-09-27')).toBe(7); // Sunday
    expect(isoWeekday('2026-09-24')).toBe(4);
  });

  it('starts the week on Monday, also across a month boundary', () => {
    expect(weekStart('2026-09-27')).toBe('2026-09-21');
    expect(weekStart('2026-09-21')).toBe('2026-09-21');
    expect(weekStart('2026-10-01')).toBe('2026-09-28');
  });
});

describe('monthStart / monthEnd', () => {
  it('handles February and December', () => {
    expect(monthStart('2026-02-14')).toBe('2026-02-01');
    expect(monthEnd('2026-02-14')).toBe('2026-02-28');
    expect(monthEnd('2024-02-14')).toBe('2024-02-29');
    expect(monthEnd('2026-12-05')).toBe('2026-12-31');
  });
});

describe('formatting', () => {
  it('formats a date with time', () => {
    const iso = new Date(2026, 8, 24, 14, 2).toISOString();
    expect(formatDateTime(iso)).toBe('24 сентября, 14:02');
  });

  it('labels today and yesterday', () => {
    expect(formatDayLabel('2026-09-24', '2026-09-24')).toBe('Сегодня');
    expect(formatDayLabel('2026-09-23', '2026-09-24')).toBe('Вчера');
    expect(formatDayLabel('2026-09-01', '2026-09-24')).toMatch(/1 сентября/);
  });
});

describe('clock', () => {
  it('follows the injected clock and keeps nowIso strictly increasing', () => {
    const fixed = new Date(2026, 8, 24, 10, 0, 0);
    setClock(() => fixed);
    expect(localDate()).toBe('2026-09-24');
    const a = nowIso();
    const b = nowIso();
    expect(a).toBe(fixed.toISOString());
    expect(b > a).toBe(true);
  });
});
