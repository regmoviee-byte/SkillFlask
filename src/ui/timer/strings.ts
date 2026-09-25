// Strings of the live timer (v0.5 package 15): the pill, the sheet «Таймер» and the finish
// flow. They live beside the lazy chunk that uses them rather than in copy.ts, which is part of
// the first paint; the tone rules of copy.ts apply all the same (copy.test.ts walks this
// object too). A timer never counts down and never scolds: it shows the time spent, says when
// the usual minutes are there, and a forgotten one is simply offered for recording.

import { formatDate } from '../../lib/dates';
import { formatNumber, plural } from '../../lib/format';
import { keepNumbers } from '../copy';

const MINUTES: [string, string, string] = ['минута', 'минуты', 'минут'];

export const timerCopy = Object.freeze({
  title: 'Таймер',
  /** The pill opens the sheet; its visible text is the action's name and the time. */
  open: (name: string) => `Открыть таймер: ${name}`,
  pause: 'Пауза',
  resume: 'Продолжить',
  finish: 'Завершить',
  reset: 'Сбросить',
  /** Under the digits while paused. */
  paused: 'На паузе',
  /** Under the digits: the action's usual minutes as the goal of the ring. */
  goal: (minutes: number) => keepNumbers(`Цель — ${formatNumber(minutes)} мин`),
  /** Toast and haptics once, when the usual minutes are reached while the app is open. */
  goalReached: (minutes: number) => keepNumbers(`${formatNumber(minutes)} ${plural(minutes, MINUTES)} — цель на сегодня есть`),
  /** Asked when another action's ▶ is tapped: the running timer goes through «Завершить» first. */
  confirmReplace: (name: string) => `Остановить таймер „${name}“ и начать новый?`,
  confirmReplaceOk: 'Остановить',
  confirmReset: 'Сбросить таймер? Время не запишется',
  confirmResetOk: 'Сбросить',
  keep: 'Оставить',
  resetDone: 'Таймер сброшен',
  /** A timer whose action or skill can no longer be recorded is removed; said once, neutrally. */
  stepGone: 'Таймер сброшен: этого действия больше нет в списке',
  skillInactive: (name: string) => `Таймер сброшен: навык «${name}» сейчас не активен`,
  /** More than 12 hours: probably left running. */
  long: 'Таймер шёл больше 12 часов — проверьте минуты',
  /** Started more than a week ago. */
  old: (date: string) => keepNumbers(`Таймер запущен ${formatDate(date)} — запишите время или сбросьте таймер`),
  /** The sheet's line under the skill: the skill's name and its level. */
  skillLine: (skill: string, level: string) => `${skill} · ${level}`,
});
