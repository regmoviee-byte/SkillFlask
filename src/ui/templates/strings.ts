// Strings of the skill templates (v0.5 package 16): the chooser and the new-skill form's
// «Действия из шаблона». They live beside the lazy chunks that use them rather than in copy.ts,
// which is part of the first paint; the tone rules of copy.ts apply all the same (copy.test.ts
// walks this object and the catalogue's texts too). A plan is a promise of what the actions
// bring, never a demand: «По плану …», no dates to keep, nothing said about days without them.

import { formatNumber, formatRate, plural } from '../../lib/format';
import type { LevelText } from '../progress/texts';
import { keepNumbers } from '../copy';

const WEEKS: [string, string, string] = ['неделю', 'недели', 'недель'];
const MONTHS: [string, string, string] = ['месяц', 'месяца', 'месяцев'];
const DAYS: [string, string, string] = ['день', 'дня', 'дней'];

/** «8 дней», «9 недель», «3 месяца»: days rounded to what a plan can promise. */
function span(days: number): string {
  if (days <= 21) return `${formatNumber(days)} ${plural(days, DAYS)}`;
  if (days <= 70) {
    const weeks = Math.round(days / 7);
    return `${formatNumber(weeks)} ${plural(weeks, WEEKS)}`;
  }
  const months = Math.round(days / 30.4);
  return `${formatNumber(months)} ${plural(months, MONTHS)}`;
}

export const templatesCopy = Object.freeze({
  chooser: {
    intro: 'Выберите, чем занимаетесь, — очки и действия уже настроены. Всё можно будет поменять.',
    listLabel: 'Шаблоны навыков',
    customName: 'Свой навык',
    customText: 'Пустая форма — всё настроите сами',
  },
  actions: {
    title: 'Действия из шаблона',
    hint: 'Отмеченные появятся у навыка вместе с ним',
    /** «Изменить» opens the action's fields in a sheet; the label names the action. */
    edit: 'Изменить',
    editLabel: (name: string) => `Изменить: ${name}`,
    /** «+5 · каждый день»; a timed action: «0,5/мин · 30 мин · 3 раза в неделю». */
    metaPoints: (points: number, schedule: string) => `+${formatNumber(points)} · ${schedule}`,
    metaTimed: (rate: number, minutes: number | null, schedule: string) =>
      keepNumbers([formatRate(rate), minutes !== null ? `${formatNumber(minutes)} мин` : null, schedule].filter(Boolean).join(' · ')),
    /** Under the list: what the checked actions bring when done as planned, in the theme's words. */
    plan: (text: LevelText, levelDays: number, milestoneDays: number) =>
      keepNumbers(`По плану ${text.willComplete(1)} примерно за ${span(levelDays)}, веха — примерно за ${span(milestoneDays)}`),
    /** Nothing checked: the skill starts without actions. */
    none: 'Навык создастся без действий — их можно добавить потом',
  },
  sheet: {
    title: 'Действие',
    done: 'Готово',
  },
});
