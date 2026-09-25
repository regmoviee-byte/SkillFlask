import { describe, expect, it, onTestFinished } from 'vitest';
import { formatNumber } from '../lib/format';
import { setClock } from '../lib/clock';
import { CATALOG, LADDERS } from '../domain/achievements/catalog';
import { MAX_BUTTON_TEXT } from '../platform/buttons';
import { BUTTON_TEXT_MAX, copy, levelCopy } from './copy';
import { PROGRESS_THEME_KEYS } from './progress/contract';
import { THEME_TEXT } from './progress/texts';
import { insightsCopy } from './insights/strings';

const flask = levelCopy(THEME_TEXT.flask);

const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|отста[её]|баллы|балл\b|баллов/i;

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
  // The level strings of every theme, and the themes' own phrases.
  for (const key of PROGRESS_THEME_KEYS) {
    collect(levelCopy(THEME_TEXT[key]), `levelCopy(${key})`, strings);
    collect(THEME_TEXT[key], `THEME_TEXT.${key}`, strings);
  }
  // «Прогноз» and «Активность» (ui/insights/strings.ts); the two phrases that take a theme or a
  // list of steps are called with real ones.
  const { line, required, ...forecast } = insightsCopy.forecast;
  collect({ forecast, activity: insightsCopy.activity }, 'insightsCopy', strings);
  for (const key of PROGRESS_THEME_KEYS) strings.push([`insightsCopy.forecast.line(${key})`, line(THEME_TEXT[key], 3, '≈ 12 октября')]);
  strings.push(['insightsCopy.forecast.required', required(70, [{ name: 'Разговор', minutes: null, times: 5 }, { name: 'Чтение', minutes: 30, times: 3 }])]);
  strings.push(['insightsCopy.forecast.required()', required(7, [])]);

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
    expect(flask.completed(2)).toBe('Колба 2 заполнена');
    expect(flask.completed(3, 2)).toBe('Колбы 2–3 заполнены');
    expect(flask.rollback(1)).toBe('Возврат к колбе 1');
    expect(flask.toNext(42, 58, 4)).toBe('42% · ещё\u00a058 до\u00a0колбы\u00a04');
    expect(flask.heroLabel(3, 42, 100, 42)).toBe('Колба 3: 42 из 100, 42%');
  });

  it('describes a completion toast and its undo', () => {
    expect(copy.completion.added(5, 'Чтение')).toBe('+5 · Чтение');
    expect(flask.cancelled(1, 96, 100)).toBe('Отменено · Колба 1: 96/100');
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
    expect(flask.markPosition(2, 12.5, 21)).toBe('Колба 2, 12,5 из 21 очка');
    expect(flask.markPosition(1, 30, 100)).toBe('Колба 1, 30 из 100 очков');
    expect(flask.markHistory(3, 1)).toBe('Колба 3 · 1 очко');
    expect(copy.marks.confirmRemove('Пробный тест')).toBe('Удалить засечку «Пробный тест»?');
    expect(copy.marks.add.length).toBeLessThanOrEqual(BUTTON_TEXT_MAX);
  });

  it('never calls a level rollback a demotion in toasts', () => {
    const toasts = strings.filter(([path]) => path.startsWith('copy.toast') || path.startsWith('copy.completion'));
    expect(toasts.filter(([, text]) => /понижен/i.test(text))).toEqual([]);
  });

  it('forecasts without pressure: a date at the current pace, or what a chosen date takes', () => {
    // The year is named only when it is not the current one.
    setClock(() => new Date('2026-09-24T12:00:00'));
    onTestFinished(() => setClock(null));
    const t = insightsCopy.forecast;
    expect(t.line(THEME_TEXT.flask, 3, t.when('2026-10-12', 18))).toBe('В таком темпе колба 3 заполнится ≈\u00a012\u00a0октября');
    expect(t.line(THEME_TEXT.pizza, 3, t.when('2026-10-12', 18))).toBe('В таком темпе пицца 3 будет съедена ≈\u00a012\u00a0октября');
    expect(t.when('2027-03-15', 172)).toBe('примерно в\u00a0марте\u00a02027');
    expect(t.pace(45.2, 28)).toBe('≈\u00a045\u00a0очков в неделю за последние 4\u00a0недели');
    expect(t.pace(6.44, 21)).toBe('≈\u00a06,4\u00a0очка в неделю за последний 21\u00a0день');
    expect(t.milestone('B2', 'Достичь B2')).toBe('Цель «B2»');
    expect(t.milestone('', 'Главная цель')).toBe('Веха «Главная цель»');
    expect(t.required(70, [{ name: 'Разговор', minutes: null, times: 5 }, { name: 'Чтение', minutes: 30, times: 3 }])).toBe(
      'Нужно ≈\u00a070\u00a0очков в неделю: например, «Разговор» 5\u00a0раз в неделю или «Чтение» по 30\u00a0мин 3\u00a0раза',
    );
    expect(insightsCopy.activity.cell('2026-09-24', 3, 25)).toBe('24 сентября: 3 действия, 25 очков');
    expect(insightsCopy.activity.summary(64)).toBe('За полгода: 64 дня с занятиями');
    expect(Object.isFrozen(insightsCopy)).toBe(true);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(flask)).toBe(true);
  });
});

describe('level strings of the progress themes', () => {
  const pizza = levelCopy(THEME_TEXT.pizza);

  it('speak the theme’s nouns everywhere a level is named', () => {
    expect(pizza.completed(1)).toBe('Пицца 1 съедена');
    expect(pizza.completed(3, 2)).toBe('Пиццы 2–3 съедены');
    expect(pizza.rollback(1)).toBe('Возврат к пицце 1');
    expect(pizza.toNext(40, 60, 2)).toBe('40% · ещё\u00a060 до\u00a0пиццы\u00a02');
    expect(pizza.milestoneProgress(2, 10)).toBe('2 из 10 пицц');
    expect(pizza.milestoneProgress(1, 1)).toBe('1 из 1 пиццы');
    expect(pizza.levels(3)).toBe('3 пиццы');
    expect(pizza.state(2, 45, 150)).toBe('Пицца 2: 45/150');
    expect(pizza.formMilestoneLevels).toBe('Пицц');
    expect(levelCopy(THEME_TEXT.book).completed(2)).toBe('Книга 2 прочитана');
    expect(levelCopy(THEME_TEXT.car).completed(2)).toBe('Поездка 2 завершена');
    expect(levelCopy(THEME_TEXT.flower).completed(2)).toBe('Цветок 2 распустился');
    expect(levelCopy(THEME_TEXT.rocket).completed(2)).toBe('Полёт 2 завершён');
    expect(levelCopy(THEME_TEXT.rocket).rollback(2)).toBe('Возврат к полёту 2');
    expect(levelCopy(THEME_TEXT.car).toNext(10, 5, 3)).toBe('10% · ещё\u00a05 до\u00a0поездки\u00a03');
  });

  it('has every noun and phrase for all thirteen themes, with the plural forms right for 1, 2, 5, 11, 21', () => {
    expect(Object.keys(THEME_TEXT).sort()).toEqual([...PROGRESS_THEME_KEYS].sort());
    const plurals: Record<string, [string, string, string]> = {
      flask: ['колба', 'колбы', 'колб'],
      flower: ['цветок', 'цветка', 'цветков'],
      pizza: ['пицца', 'пиццы', 'пицц'],
      car: ['поездка', 'поездки', 'поездок'],
      book: ['книга', 'книги', 'книг'],
      rocket: ['полёт', 'полёта', 'полётов'],
      ball: ['бросок', 'броска', 'бросков'],
      chick: ['цыплёнок', 'цыплёнка', 'цыплят'],
      climber: ['вершина', 'вершины', 'вершин'],
      puzzle: ['пазл', 'пазла', 'пазлов'],
      moon: ['луна', 'луны', 'лун'],
      tower: ['башня', 'башни', 'башен'],
      rainbow: ['радуга', 'радуги', 'радуг'],
    };
    for (const key of PROGRESS_THEME_KEYS) {
      const text = THEME_TEXT[key];
      for (const field of ['name', 'levelNoun', 'levelGenitive', 'levelDative', 'hint'] as const) {
        expect(text[field].trim().length, `${key}.${field}`).toBeGreaterThan(0);
      }
      const [one, few, many] = plurals[key]!;
      const lc = levelCopy(text);
      expect([1, 2, 5, 11, 21].map((n) => lc.levels(n)), key).toEqual([`1 ${one}`, `2 ${few}`, `5 ${many}`, `11 ${many}`, `21 ${one}`]);
      // After «из»: the genitive singular for 1 and 21, the genitive plural otherwise.
      expect([1, 2, 5, 11, 21].map((n) => lc.milestoneProgress(0, n)), key).toEqual(
        [1, 2, 5, 11, 21].map((n) => `0 из ${n} ${n % 10 === 1 && n !== 11 ? text.levelGenitive : text.levelFormsOf[1]}`),
      );
      expect(text.levelFormsOf[0], key).toBe(text.levelGenitive);
      // The phrases name the level with its number, the noun first where the theme says so.
      expect(text.completed(7), key).toContain('7');
      expect(text.completedRange(2, 3), key).toContain('2–3');
      expect(lc.noun(4), key).toBe(`${text.levelNoun} 4`);
      expect(text.fillLabel(45), key).toContain('45%');
      // The forecast's future: lower case (it follows «В таком темпе»), with the number.
      expect(text.willComplete(3), key).toMatch(/^[а-яё]/);
      expect(text.willComplete(3), key).toContain(' 3');
    }
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
