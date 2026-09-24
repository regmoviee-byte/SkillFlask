import { describe, expect, it } from 'vitest';
import { formatNumber } from '../lib/format';
import { CATALOG, LADDERS } from '../domain/achievements/catalog';
import { MAX_BUTTON_TEXT } from '../platform/buttons';
import { BUTTON_TEXT_MAX, copy } from './copy';

const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы|балл\b|баллов/i;

/** Collects every string of the dictionary, calling functions with representative arguments. */
function collect(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === 'string') out.push([path, value]);
  else if (typeof value === 'function') {
    // Not every sample fits every signature (a date formatter rejects a name); each function
    // must still produce at least one string.
    let produced = 0;
    const fn = value as (...a: unknown[]) => unknown;
    for (const base of [[7, 3, 12], ['2026-09-24', 2, 5], ['Английский', 1, 3], ['', 0]]) {
      // Padded to the function's arity with the sample's first value, so no argument is undefined.
      const sample = [...base, ...Array<unknown>(Math.max(0, fn.length - base.length)).fill(base[0])];
      try {
        const result = fn(...sample);
        if (typeof result === 'string') {
          out.push([`${path}(${sample.join(',')})`, result]);
          produced += 1;
        }
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
    expect(produced, path).toBeGreaterThan(0);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collect(child, `${path}.${key}`, out);
  }
}

// Source text of every UI and service module (copy.ts is checked through its object above,
// since its header names the forbidden words).
const sources = import.meta.glob(['./**/*.{ts,tsx}', '../services/**/*.ts', '!./**/*.test.*', '!../services/**/*.test.*', '!./copy.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('copy dictionary', () => {
  const strings: [string, string][] = [];
  collect(copy, 'copy', strings);

  it('contains strings', () => {
    expect(strings.length).toBeGreaterThan(80);
  });

  it('never uses forbidden words', () => {
    const offenders = strings.filter(([, text]) => FORBIDDEN.test(text));
    expect(offenders).toEqual([]);
  });

  it('limits emoji and exclamation marks to the skill-completed toast', () => {
    const loud = new Set(strings.filter(([, text]) => /[!\u{1F300}-\u{1FAFF}]/u.test(text)).map(([path]) => path.replace(/\(.*$/, '')));
    expect([...loud].sort()).toEqual(['copy.toast.skillCompleted']);
  });

  it('names the filled flasks and the way back in the history', () => {
    expect(copy.history.flaskFilled(2)).toBe('Колба 2 заполнена');
    expect(copy.history.flaskFilled(3, 2)).toBe('Колбы 2–3 заполнены');
    expect(copy.history.flaskRollback(1)).toBe('Возврат к колбе 1');
    expect(copy.skill.toNext(42, 58, 4)).toBe('42% · ещё 58 до колбы 4');
    expect(copy.skill.flaskLabel(3, 42, 100, 42)).toBe('Колба 3: 42 из 100, 42%');
  });

  it('describes a completion toast and its undo', () => {
    expect(copy.completion.added(5, 'Чтение')).toBe('+5 · Чтение');
    expect(copy.completion.cancelled(1, 96, 100)).toBe('Отменено · Колба 1: 96/100');
    expect(copy.stepRow.points(5)).toBe('+5');
    expect(copy.stepRow.today(2)).toBe('сегодня ×2');
    expect(copy.stepRow.check('Чтение', 5)).toBe('Отметить: Чтение, +5 очков');
  });

  it('says «осталось» only about today’s plan (tone rule 4)', () => {
    const remaining = strings.filter(([, text]) => /осталось/i.test(text)).map(([path]) => path);
    // The section itself, and the form's hint that names it.
    expect(remaining).toEqual(['copy.today.remaining', 'copy.stepForm.dueHint']);
  });

  it('describes schedules, quotas and timed steps', () => {
    expect(copy.today.summaryProgress(1, 3)).toBe('Сделано 1 из 3');
    expect(copy.today.quotaProgress(1, 3)).toBe('1 из 3');
    expect(copy.today.moreCount(2)).toBe('Ещё 2 действия');
    expect(copy.today.quotaMonthOf(9)).toBe('В сентябре');
    expect(copy.stepRow.rate(0.5)).toBe('0,5/мин');
    expect(copy.stepRow.checkTimed('Чтение', 0.5)).toBe('Отметить: Чтение, 0,5 очка в минуту');
    expect(copy.minutes.willEarn(15)).toBe('Начислится 15 очков');
    expect(copy.addAction.submitTimed(45, 22.5)).toBe('Записать 45 мин · +22,5');
    expect(copy.addAction.submitTimed(999, 999).length).toBeLessThanOrEqual(MAX_BUTTON_TEXT);
    // A large rate drops «Записать» rather than overflow the native button.
    expect(copy.addAction.submitTimed(999, 9990)).toBe(`999 мин · +${formatNumber(9990)}`);
    expect(BUTTON_TEXT_MAX).toBe(MAX_BUTTON_TEXT);
    for (const [minutes, rate] of [[1440, 1000], [999, 999.99], [1, 0.01]] as const) {
      expect(copy.addAction.submitTimed(minutes, minutes * rate).length).toBeLessThanOrEqual(MAX_BUTTON_TEXT);
    }
    expect(copy.completionSheet.minutesPreview(30, 15, 45, 7.5)).toBe('Было 30 мин (15) → станет 45 мин (+7,5)');
    expect(copy.completion.durationChanged(7.5)).toBe('Длительность изменена: +7,5 очка');
    expect(copy.completion.durationChanged(-5)).toBe('Длительность изменена: −5 очков');
    expect(copy.stepForm.timedPreview(30, 15)).toBe('30 мин → 15 очков');
  });

  it('describes marks', () => {
    expect(copy.marks.position(2, 12.5, 21)).toBe('Колба 2, 12,5 из 21 очка');
    expect(copy.marks.position(1, 30, 100)).toBe('Колба 1, 30 из 100 очков');
    expect(copy.marks.historyPosition(3, 1)).toBe('Колба 3 · 1 очко');
    expect(copy.marks.confirmRemove('Пробный тест')).toBe('Удалить засечку «Пробный тест»?');
    expect(copy.marks.add.length).toBeLessThanOrEqual(BUTTON_TEXT_MAX);
  });

  it('never calls a level rollback a demotion in toasts', () => {
    const toasts = strings.filter(([path]) => path.startsWith('copy.toast') || path.startsWith('copy.completion'));
    expect(toasts.filter(([, text]) => /понижен/i.test(text))).toEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(copy)).toBe(true);
  });
});

describe('achievement catalogue', () => {
  it('keeps every achievement string clean: no loss, no «вернулся», no forbidden words', () => {
    const texts = [
      ...LADDERS.flatMap((l) => [l.title, l.description, l.howTo, ...l.unit]),
      ...CATALOG.flatMap((d) => [d.title, d.description, d.howTo]),
    ];
    expect(texts.length).toBeGreaterThan(44 * 3);
    expect(texts.filter((text) => FORBIDDEN.test(text) || /сгорел|пропущ|вернул/i.test(text))).toEqual([]);
  });
});

describe('source files', () => {
  it('keep forbidden words out of UI and service code', () => {
    const files = Object.keys(sources);
    expect(files).toContain('../services/skills.ts');
    expect(files).toContain('./screens/SkillScreen.tsx');
    expect(files.filter((f) => f.includes('.test.') || f.endsWith('/copy.ts'))).toEqual([]);
    const offenders = Object.entries(sources).filter(([, text]) => FORBIDDEN.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
