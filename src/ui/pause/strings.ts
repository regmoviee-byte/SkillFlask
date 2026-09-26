// The words of the pause sheet (v0.5 package 18), in its lazy chunk; the pill, the menu items and
// the return toast are in the first paint (copy.ts `pause`). copy.test.ts walks this object.

import { formatDate } from '../../lib/dates';
import { keepNumbers } from '../copy';
import type { PauseLength } from '../../domain/pause';

export const pauseCopy = Object.freeze({
  title: 'Пауза',
  editTitle: 'Дата паузы',
  intro:
    'Навык уйдёт из «Сегодня» и вернётся сам. Дни паузы не попадут в прогноз, а дни, когда на паузе все навыки, не прервут серию. Отметить действие можно и на паузе — на экране навыка.',
  options: 'Сколько отдыхать',
  length: {
    week: 'На неделю',
    twoWeeks: 'На 2 недели',
    month: 'На месяц',
    open: 'Пока не сниму',
  } satisfies Record<PauseLength, string>,
  date: 'До даты…',
  /** The last day of rest beside an option. */
  until: (date: string) => `до ${keepNumbers(formatDate(date))}`,
  dateField: 'Последний день паузы',
  /** Under the options: when the skill is back. */
  back: (date: string) => `В план навык вернётся ${keepNumbers(formatDate(date))}`,
  backOpen: 'Навык вернётся в план, когда вы снимете паузу',
  since: (date: string) => `На паузе с ${keepNumbers(formatDate(date))}`,
  submit: 'Поставить на паузу',
  save: 'Сохранить',
  /** The date field's limits: a new pause rests at least until tomorrow, a change may end today. */
  dateInvalid: 'Выберите дату от завтра и не дальше чем через год',
  dateInvalidEdit: 'Выберите дату от сегодня и не дальше чем через год',
  /** The toast after the pause is set or changed. */
  paused: (name: string, until: string | null) => (until ? `${name} на паузе до ${keepNumbers(formatDate(until))}` : `${name} на паузе`),
});
