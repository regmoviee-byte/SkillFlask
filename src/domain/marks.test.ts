import { describe, expect, it } from 'vitest';
import { computeProgress } from './progression';
import { markHeight, markPosition, marksForFlask, newestMarksFirst, validateMark, MarkError } from './marks';
import type { Mark } from './types';

const mark = (id: string, patch: Partial<Mark> = {}): Mark => ({
  id,
  skillId: 's',
  title: id,
  description: '',
  date: '2026-09-10',
  flaskNumber: 1,
  pointsInFlask: 0,
  totalPoints: 0,
  createdAt: '2026-09-10T10:00:00.000Z',
  updatedAt: '2026-09-10T10:00:00.000Z',
  ...patch,
});

describe('markPosition', () => {
  it('takes the flask being filled, the points in it and the total', () => {
    // Flasks of 100 and 150: 180 points fill the first and put 80 into the second.
    const progress = computeProgress(180, { base: 100, increment: 50, manual: [] });
    expect(markPosition(progress)).toEqual({ flaskNumber: 2, pointsInFlask: 80, totalPoints: 180 });
    expect(markPosition(computeProgress(0, { base: 10, increment: 0, manual: [] }))).toEqual({ flaskNumber: 1, pointsInFlask: 0, totalPoints: 0 });
    // Tenths stay exact.
    expect(markPosition(computeProgress(12.3, { base: 10, increment: 0, manual: [] }))).toEqual({ flaskNumber: 2, pointsInFlask: 2.3, totalPoints: 12.3 });
  });
});

describe('markHeight', () => {
  it('is the share of the flask it sits at, against the capacity as it is now', () => {
    expect(markHeight({ pointsInFlask: 30 }, 100)).toBe(0.3);
    expect(markHeight({ pointsInFlask: 30 }, 150)).toBeCloseTo(0.2);
    expect(markHeight({ pointsInFlask: 0 }, 100)).toBe(0);
  });

  it('clamps to the rim when the capacity was reduced below its points', () => {
    expect(markHeight({ pointsInFlask: 80 }, 50)).toBe(1);
    expect(markHeight({ pointsInFlask: 80 }, 0)).toBe(0);
    expect(markHeight({ pointsInFlask: -5 }, 50)).toBe(0);
  });
});

describe('marksForFlask', () => {
  it('keeps one flask, sorted by date and then by when they were written', () => {
    const marks = [
      mark('late', { date: '2026-09-12' }),
      mark('other', { flaskNumber: 2 }),
      mark('second', { createdAt: '2026-09-11T08:00:00.000Z' }),
      mark('first', { date: '2026-09-10', createdAt: '2026-09-10T09:00:00.000Z' }),
    ];
    expect(marksForFlask(marks, 1).map((m) => m.id)).toEqual(['first', 'second', 'late']);
    expect(marksForFlask(marks, 2).map((m) => m.id)).toEqual(['other']);
    expect(marksForFlask(marks, 3)).toEqual([]);
    expect(newestMarksFirst(marks).map((m) => m.id)).toEqual(['late', 'second', 'other', 'first']);
  });
});

describe('validateMark', () => {
  const today = '2026-09-24';
  const fails = (input: Parameters<typeof validateMark>[0]) => {
    try {
      validateMark(input, today);
    } catch (error) {
      expect(error).toBeInstanceOf(MarkError);
      return [(error as MarkError).field, (error as MarkError).message];
    }
    throw new Error('expected a MarkError');
  };

  it('trims and defaults the date to today', () => {
    expect(validateMark({ title: '  Пробный тест ', description: ' 72 из 100 ' }, today)).toEqual({ title: 'Пробный тест', description: '72 из 100', date: today });
    expect(validateMark({ title: 'Экзамен', date: '2025-06-01' }, today)).toEqual({ title: 'Экзамен', description: '', date: '2025-06-01' });
    expect(validateMark({ title: 'x'.repeat(60) }, today).title).toHaveLength(60);
  });

  it('rejects an empty or too long title, a long description, a future or invalid date', () => {
    expect(fails({ title: '   ' })).toEqual(['title', 'Укажите название засечки']);
    expect(fails({ title: 'x'.repeat(61) })).toEqual(['title', 'Слишком длинное название']);
    expect(fails({ title: 'Тест', description: 'x'.repeat(501) })).toEqual(['description', 'Слишком длинное описание']);
    expect(fails({ title: 'Тест', date: '2026-09-25' })).toEqual(['date', 'Дата не может быть в будущем']);
    expect(fails({ title: 'Тест', date: '2026-02-30' })).toEqual(['date', 'Некорректная дата']);
    expect(fails({ title: 'Тест', date: '' })).toEqual(['date', 'Некорректная дата']);
  });
});
