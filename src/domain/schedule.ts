// Step schedules (FR-ST-005/006, FR-TD-001…007) as pure functions. A plan is never stored
// (FR-TD-002/003): «Сегодня» asks planForDate() what a date holds, from the steps and the
// completions around it, every time it renders. A date without the planned completion simply
// stops being asked about — nothing is overdue, nothing is carried over (FR-TD-005).
//
// Two shapes of schedule:
// - due on dates (DAILY, WEEKDAYS): the step is planned once on each such date;
// - quotas (TIMES_PER_WEEK, TIMES_PER_MONTH): N completions somewhere in the period, shown as
//   a separate x/N block every day of the period until met — never «for today» (decision 14.5).
// Weeks start on Monday (FR-TD-007); dates are local YYYY-MM-DD strings (FR-TD-006).

import { addDays, isoWeekday, monthEnd, monthStart, weekStart } from '../lib/dates';
import { plural } from '../lib/format';
import type { StepCompletion, StepDefinition, StepSchedule, Weekday } from './types';

export const MAX_TIMES = 31;

/** A schedule that cannot be stored; the message is shown to the user as is. */
export class ScheduleError extends Error {}

/** Normalises a schedule (days unique and sorted) or throws ScheduleError. */
export function validateSchedule(schedule: StepSchedule): StepSchedule {
  switch (schedule?.kind) {
    case 'MANUAL':
    case 'DAILY':
      return { kind: schedule.kind };
    case 'WEEKDAYS': {
      const days = Array.isArray(schedule.days) ? schedule.days : [];
      if (!days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) throw new ScheduleError('Некорректные дни недели');
      const unique = [...new Set(days)].sort((a, b) => a - b) as Weekday[];
      if (unique.length === 0) throw new ScheduleError('Выберите хотя бы один день недели');
      return { kind: 'WEEKDAYS', days: unique };
    }
    case 'TIMES_PER_WEEK':
    case 'TIMES_PER_MONTH':
      if (!Number.isInteger(schedule.times) || schedule.times < 1 || schedule.times > MAX_TIMES) {
        throw new ScheduleError(`Количество повторов: от 1 до ${MAX_TIMES}`);
      }
      return { kind: schedule.kind, times: schedule.times };
    default:
      throw new ScheduleError('Некорректное расписание');
  }
}

export const isQuota = (schedule: StepSchedule): schedule is Extract<StepSchedule, { times: number }> =>
  schedule.kind === 'TIMES_PER_WEEK' || schedule.kind === 'TIMES_PER_MONTH';

/** A DAILY or WEEKDAYS step planned on `date`; never before `scheduleFrom`, never a quota or MANUAL. */
export function isDueOn(schedule: StepSchedule, date: string, scheduleFrom: string): boolean {
  if (date < scheduleFrom) return false;
  switch (schedule.kind) {
    case 'DAILY':
      return true;
    case 'WEEKDAYS':
      return schedule.days.includes(isoWeekday(date));
    default:
      return false;
  }
}

export interface Period {
  start: string;
  end: string;
}

/** The quota period containing `date`: Monday..Sunday or the calendar month; null for other schedules. */
export function periodOf(schedule: StepSchedule, date: string): Period | null {
  if (schedule.kind === 'TIMES_PER_WEEK') {
    const start = weekStart(date);
    return { start, end: addDays(start, 6) };
  }
  if (schedule.kind === 'TIMES_PER_MONTH') return { start: monthStart(date), end: monthEnd(date) };
  return null;
}

/** True when a completion dated `date` counts for the step's schedule (source SCHEDULED). */
export function isScheduledOn(step: Pick<StepDefinition, 'schedule' | 'scheduleFrom'>, date: string): boolean {
  if (isDueOn(step.schedule, date, step.scheduleFrom)) return true;
  return isQuota(step.schedule) && date >= step.scheduleFrom;
}

const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const TIMES: [string, string, string] = ['раз', 'раза', 'раз'];

/** «вручную», «каждый день», «пн, ср, пт», «по будням», «3 раза в неделю», «5 раз в месяц». */
export function describeSchedule(schedule: StepSchedule): string {
  switch (schedule.kind) {
    case 'MANUAL':
      return 'вручную';
    case 'DAILY':
      return 'каждый день';
    case 'WEEKDAYS': {
      const key = schedule.days.join('');
      if (key === '1234567') return 'каждый день';
      if (key === '12345') return 'по будням';
      if (key === '67') return 'по выходным';
      return schedule.days.map((d) => WEEKDAY_SHORT[d - 1]).join(', ');
    }
    case 'TIMES_PER_WEEK':
      return `${schedule.times} ${plural(schedule.times, TIMES)} в неделю`;
    case 'TIMES_PER_MONTH':
      return `${schedule.times} ${plural(schedule.times, TIMES)} в месяц`;
  }
}

export interface PlannedItem {
  step: StepDefinition;
  /** Completions the date or period asks for: 1 for a due date, N for a quota. */
  target: number;
  /** ACTIVE completions on the date (due) or in the period up to and including the date (quota). */
  done: number;
  state: 'DUE' | 'DONE';
  /** The quota period; null for a step due on a date. */
  period: Period | null;
}

type CompletionFacts = Pick<StepCompletion, 'stepId' | 'date' | 'status'>;

const byCreatedAt = (a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

/**
 * What `date` holds for the given steps: every active step due on the date (target 1) and
 * every quota step whose schedule has started (target N over its period). Only completions up
 * to and including `date` count, so the plan of a past date is what that date looked like at
 * its end — a completion made later in the week does not rewrite Wednesday. MANUAL steps are
 * never planned, nor the steps of a skill `isPaused` on the date (package 18, domain/pause.ts):
 * a quota period the skill rests through is never shown, and one paused only in part keeps its
 * whole target. Sorted DUE before DONE, then by the step's creation. Pure: no clock.
 */
export function planForDate(
  steps: readonly StepDefinition[],
  completions: readonly CompletionFacts[],
  date: string,
  isPaused: (skillId: string, date: string) => boolean = () => false,
): PlannedItem[] {
  const active = completions.filter((c) => c.status === 'ACTIVE' && c.date <= date);
  const items: PlannedItem[] = [];
  for (const step of steps) {
    if (!step.isActive || isPaused(step.skillId, date)) continue;
    if (isDueOn(step.schedule, date, step.scheduleFrom)) {
      const done = active.filter((c) => c.stepId === step.id && c.date === date).length;
      items.push({ step, target: 1, done, state: done >= 1 ? 'DONE' : 'DUE', period: null });
    } else if (isQuota(step.schedule) && date >= step.scheduleFrom) {
      const period = periodOf(step.schedule, date)!;
      const done = active.filter((c) => c.stepId === step.id && c.date >= period.start).length;
      const target = step.schedule.times;
      items.push({ step, target, done, state: done >= target ? 'DONE' : 'DUE', period });
    }
  }
  return items.sort((a, b) => (a.state === b.state ? byCreatedAt(a.step, b.step) : a.state === 'DUE' ? -1 : 1));
}
