import { describe, expect, it } from 'vitest';
import type { Records } from '../../domain/records';
import { keepNumbers } from '../copy';
import { recordRow } from './RecordList';

const none: Records = {
  bestDay: null,
  bestWeek: null,
  mostCompletions: null,
  bestStreak: null,
  longestSession: null,
  fastestFlask: null,
  bestDayBySkill: [],
};

describe('recordRow «Лучшая серия»', () => {
  it('says «подряд» for a run without rest days', () => {
    const row = recordRow('bestStreak', { ...none, bestStreak: { days: 3, start: '2026-09-14', end: '2026-09-16' } }, {}, {});
    expect(row?.value).toBe('3 дня подряд');
    expect(row?.meta).toBe(keepNumbers('14–16 сентября'));
  });

  it('does not say «подряд» for a run bridged over a pause (its dates span more days)', () => {
    const row = recordRow('bestStreak', { ...none, bestStreak: { days: 12, start: '2026-09-14', end: '2026-09-26' } }, {}, {});
    expect(row?.value).toBe('12 дней с паузой');
    expect(row?.meta).toBe(keepNumbers('14–26 сентября'));
  });
});
