// «Засечки» (requirements, section 10): the place of a memorable event on the skill's path.
// The position is stored as a business fact — flask number, points inside that flask, total
// progress — taken once from the progress at creation. Drawing it is a pure function of that
// fact and the flask's capacity today, so a redrawn or re-sized flask keeps the meaning.

import { isValidLocalDate } from '../lib/dates';
import type { Progress } from './progression';
import type { Mark } from './types';

export const MARK_TITLE_MAX = 60;
export const MARK_DESCRIPTION_MAX = 500;

export type MarkPosition = Pick<Mark, 'flaskNumber' | 'pointsInFlask' | 'totalPoints'>;

/** Where a mark written now sits: the flask being filled and the points inside it. */
export function markPosition(progress: Progress): MarkPosition {
  return {
    flaskNumber: progress.currentFlask,
    pointsInFlask: progress.pointsInCurrentFlask,
    totalPoints: progress.totalPoints,
  };
}

/**
 * Height of the mark on its flask, 0..1, against that flask's capacity as it is now. A
 * capacity reduced below the stored points pins the mark at the rim rather than moving it.
 */
export function markHeight(mark: Pick<Mark, 'pointsInFlask'>, capacityOfThatFlask: number): number {
  if (!(capacityOfThatFlask > 0)) return 0;
  const ratio = mark.pointsInFlask / capacityOfThatFlask;
  return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
}

const byDateThenCreated = (a: Mark, b: Mark): number =>
  a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

/** The marks of one flask, oldest first (by date, then by when they were written). */
export function marksForFlask(marks: readonly Mark[], flaskNumber: number): Mark[] {
  return marks.filter((m) => m.flaskNumber === flaskNumber).sort(byDateThenCreated);
}

/** Every mark, newest first: the order of the «Засечки» list. */
export function newestMarksFirst(marks: readonly Mark[]): Mark[] {
  return [...marks].sort((a, b) => byDateThenCreated(b, a));
}

export interface MarkInput {
  title: string;
  description?: string;
  date?: string;
}

export type MarkField = 'title' | 'description' | 'date';

/** A mark input that cannot be saved; `field` says which form field to show it under. */
export class MarkError extends Error {
  constructor(
    message: string,
    readonly field: MarkField,
  ) {
    super(message);
  }
}

export const markMessages = {
  titleRequired: 'Укажите название засечки',
  titleTooLong: 'Слишком длинное название',
  descriptionTooLong: 'Слишком длинное описание',
  dateInFuture: 'Дата не может быть в будущем',
  dateInvalid: 'Некорректная дата',
} as const;

/**
 * Trimmed title and description and a checked date (today when omitted), or MarkError. The
 * date may be any past day: an exam from last week is marked when the result comes in.
 */
export function validateMark(input: MarkInput, today: string): { title: string; description: string; date: string } {
  const title = input.title.trim();
  if (!title) throw new MarkError(markMessages.titleRequired, 'title');
  if (title.length > MARK_TITLE_MAX) throw new MarkError(markMessages.titleTooLong, 'title');
  const description = (input.description ?? '').trim();
  if (description.length > MARK_DESCRIPTION_MAX) throw new MarkError(markMessages.descriptionTooLong, 'description');
  const date = input.date ?? today;
  if (!isValidLocalDate(date)) throw new MarkError(markMessages.dateInvalid, 'date');
  if (date > today) throw new MarkError(markMessages.dateInFuture, 'date');
  return { title, description, date };
}
