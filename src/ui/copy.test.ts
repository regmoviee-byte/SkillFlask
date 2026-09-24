import { describe, expect, it } from 'vitest';
import { copy } from './copy';

const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы|балл\b|баллов/i;

/** Collects every string of the dictionary, calling functions with representative arguments. */
function collect(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === 'string') out.push([path, value]);
  else if (typeof value === 'function') {
    // Not every sample fits every signature (a date formatter rejects a name); each function
    // must still produce at least one string.
    let produced = 0;
    for (const sample of [[7, 3, 12], ['2026-09-24', 2, 5], ['Английский', 1, 3], ['', 0]]) {
      try {
        const result = (value as (...a: unknown[]) => unknown)(...sample);
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

  it('limits emoji and exclamation marks to the two celebration toasts', () => {
    const loud = new Set(strings.filter(([, text]) => /[!\u{1F300}-\u{1FAFF}]/u.test(text)).map(([path]) => path.replace(/\(.*$/, '')));
    expect([...loud].sort()).toEqual(['copy.toast.milestoneReached', 'copy.toast.skillCompleted']);
  });

  it('names the filled flask and the carried remainder', () => {
    expect(copy.toast.flaskFilled(1, 1)).toBe('Колба 1 заполнена · остаток 1 очко');
    expect(copy.toast.flaskFilled(2, 5, 2)).toBe('Заполнено колб: 2 · остаток 5 очков');
    expect(copy.toast.flaskFilled(2, 0)).toBe('Колба 2 заполнена');
  });

  it('describes a completion toast and its undo', () => {
    expect(copy.completion.added(5, 'Чтение')).toBe('+5 · Чтение');
    expect(copy.completion.cancelled(1, 96, 100)).toBe('Отменено · Колба 1: 96/100');
    expect(copy.stepRow.meta(5, 0)).toBe('+5');
    expect(copy.stepRow.meta(5, 2)).toBe('+5 · сегодня ×2');
    expect(copy.stepRow.check('Чтение', 5)).toBe('Отметить: Чтение, +5 очков');
  });

  it('never calls a level rollback a demotion in toasts', () => {
    const toasts = strings.filter(([path]) => path.startsWith('copy.toast') || path.startsWith('copy.completion'));
    expect(toasts.filter(([, text]) => /понижен/i.test(text))).toEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(copy)).toBe(true);
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
