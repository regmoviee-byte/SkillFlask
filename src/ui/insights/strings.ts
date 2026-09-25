// Strings of «Прогноз» and «Активность» (v0.5 package 14). They live beside the lazy chunks that
// use them rather than in copy.ts, which is part of the first paint; the tone rules of copy.ts
// apply all the same (copy.test.ts walks this object too). The forecast never judges the pace:
// it is a date at the current pace, or nothing; a chosen date gets what it takes, said plainly.

import { PACE_WINDOW_DAYS } from '../../domain/forecast';
import { formatDate, formatMonthIn, formatWeekdayDate } from '../../lib/dates';
import { formatMinutes, formatNumber, formatPoints, plural } from '../../lib/format';
import { keepNumbers } from '../copy';
import type { LevelText } from '../progress/texts';

const ACTIONS: [string, string, string] = ['действие', 'действия', 'действий'];
const DAYS: [string, string, string] = ['день', 'дня', 'дней'];
const DAYS_WITH: [string, string, string] = ['день с занятиями', 'дня с занятиями', 'дней с занятиями'];
const TIMES: [string, string, string] = ['раз', 'раза', 'раз'];

const count = (n: number, forms: [string, string, string]) => `${formatNumber(n)} ${plural(n, forms)}`;

/** Numbers stay with their words, «≈» with its number (copy.ts keepNumbers). */
const approx = (text: string) => keepNumbers(text).replace(/≈ /g, '≈\u00a0');

/** Past this many days a forecast names a month («примерно в марте»), a day before it. */
export const EXACT_DAYS = 60;

/** A pace of points per week as it is said: whole points from 10 up, tenths below. */
export function roundPerWeek(perWeek: number): number {
  return perWeek >= 10 ? Math.round(perWeek) : Math.round(perWeek * 10) / 10;
}

/** A step as an example of a weekly pace: «Разговор» 5 раз, «Чтение» по 30 мин 3 раза. */
export interface PaceExample {
  name: string;
  minutes: number | null;
  times: number;
}

export const insightsCopy = Object.freeze({
  forecast: {
    /**
     * «≈ 12 октября» up to EXACT_DAYS away, «примерно в марте 2027» further; the month keeps its
     * «в» and year on one line («примерно / в феврале 2027», never «примерно в / феврале»).
     */
    when: (date: string, days: number) =>
      approx(days > EXACT_DAYS ? `примерно ${formatMonthIn(date).replace(/ /g, '\u00a0')}` : `≈ ${formatDate(date)}`),
    /** The line under the hero: «В таком темпе колба 3 заполнится ≈ 12 октября». */
    line: (text: LevelText, level: number, when: string) => `В таком темпе ${text.willComplete(level)} ${when}`,
    title: 'Прогноз',
    /** «≈ 45 очков в неделю за последние 4 недели» (a younger skill: «за последние 10 дней»). */
    pace: (perWeek: number, days: number) =>
      approx(
        `≈ ${formatPoints(roundPerWeek(perWeek))} в неделю за ${
          days === PACE_WINDOW_DAYS ? 'последние 4 недели' : `${days % 10 === 1 && days % 100 !== 11 ? 'последний' : 'последние'} ${count(days, DAYS)}`
        }`,
      ),
    /** The milestone's row: the target label when the skill has one, the milestone's name otherwise. */
    milestone: (targetLabel: string, name: string) => (targetLabel ? `Цель «${targetLabel}»` : `Веха «${name}»`),
    ifDate: 'А если к дате?',
    date: 'Дата',
    pickDate: 'Выберите дату после сегодняшней',
    /** The chosen date is within reach of the current pace. */
    onPace: 'В нынешнем темпе вы успеваете к этой дате',
    /** «Нужно ≈ 70 очков в неделю: например, «Разговор» 5 раз в неделю или «Чтение» по 30 мин 3 раза». */
    required: (perWeek: number, examples: readonly PaceExample[]) => {
      const head = `Нужно ≈ ${formatPoints(perWeek)} в неделю`;
      if (examples.length === 0) return approx(head);
      const parts = examples.map(
        (e, i) => `«${e.name}» ${e.minutes !== null ? `по ${formatMinutes(e.minutes)} ` : ''}${count(e.times, TIMES)}${i === 0 ? ' в неделю' : ''}`,
      );
      return approx(`${head}: например, ${parts.join(' или ')}`);
    },
    note: 'Прогноз считается по очкам последних четырёх недель и меняется вместе с темпом.',
  },
  activity: {
    /** The map's accessible name: «За полгода: 64 дня с занятиями». */
    summary: (days: number) => `За полгода: ${count(days, DAYS_WITH)}`,
    /** The caption under the map (its months say the span): «64 дня с занятиями». */
    caption: (days: number) => count(days, DAYS_WITH),
    /** A map without a day of practice yet (a new skill): what will appear here. */
    empty: 'Здесь будут видны дни с занятиями',
    /** A skill that is not active and had no practice in half a year. */
    emptyPast: 'За полгода отметок нет',
    /** A cell: «24 сентября: 3 действия, 25 очков»; a day without a completion is just its date. */
    cell: (date: string, completions: number, points: number) =>
      completions > 0 ? `${formatDate(date)}: ${count(completions, ACTIONS)}, ${formatPoints(points)}` : formatDate(date),
    months: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    /** Row labels, Monday first: every other day is named. */
    weekdays: ['пн', '', 'ср', '', 'пт', '', ''],
    less: 'меньше',
    more: 'больше',
    /** The day sheet. */
    dayTitle: (date: string) => keepNumbers(formatWeekdayDate(date)),
    daySummary: (completions: number, points: number) => keepNumbers(`${count(completions, ACTIONS)} · ${formatPoints(points)}`),
    dayEmpty: 'В этот день занятий не было',
    previousDay: 'Предыдущий день',
    nextDay: 'Следующий день',
    points: (points: number) => `+${formatNumber(points)}`,
    minutes: (minutes: number) => formatMinutes(minutes),
    history: 'История навыка',
    /** The home map's group of a skill opens its history. */
    skillHistory: (name: string) => `История навыка «${name}»`,
  },
});
