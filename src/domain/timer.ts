// The live timer of a TIMED action (v0.5 package 15). One timer at a time, kept as a settings
// row (services/timer.ts). Its time is never a ticking counter: it is derived from timestamps
// every time it is read, so a WebView that slept, a closed Mini App or a reload loses nothing.
// Elapsed = now − startedAt − pausedMs − (paused ? now − pausedAt : 0).

import { diffDays } from '../lib/dates';
import { MAX_MINUTES } from './points';
import type { ActiveTimer } from './timerRow';
import type { Skill, StepDefinition } from './types';

export { newTimer, parseTimer, type ActiveTimer } from './timerRow';

const MINUTE_MS = 60_000;
/** Past this the finish flow asks to check the minutes before recording (a forgotten timer). */
export const TIMER_LONG_MS = 12 * 60 * MINUTE_MS;
/** A timer started more than this many days ago is offered for recording with a warning. */
export const TIMER_OLD_DAYS = 7;

/** Milliseconds of practice so far; never negative (a device clock set back reads as 0). */
export function timerElapsedMs(timer: ActiveTimer, now: Date): number {
  const end = timer.pausedAt !== null ? Date.parse(timer.pausedAt) : now.getTime();
  return Math.max(0, end - Date.parse(timer.startedAt) - timer.pausedMs);
}

/** Pauses a running timer at `now`; a paused one is returned as is. */
export function pauseTimer(timer: ActiveTimer, now: Date): ActiveTimer {
  return timer.pausedAt !== null ? timer : { ...timer, pausedAt: now.toISOString() };
}

/** Resumes a paused timer at `now`: the pause joins `pausedMs`; a running one is returned as is. */
export function resumeTimer(timer: ActiveTimer, now: Date): ActiveTimer {
  if (timer.pausedAt === null) return timer;
  return { ...timer, pausedAt: null, pausedMs: timer.pausedMs + Math.max(0, now.getTime() - Date.parse(timer.pausedAt)) };
}

/**
 * Whole minutes to record for `elapsedMs`: rounded to the nearest minute (half up), at least 1
 * (a timer stopped after 20 seconds still records a minute) and at most MAX_MINUTES, the limit
 * of a completion.
 */
export function minutesToRecord(elapsedMs: number): number {
  return Math.min(MAX_MINUTES, Math.max(1, Math.round(elapsedMs / MINUTE_MS)));
}

/** More than 12 hours: probably a timer left running; the minutes are checked before recording. */
export function isLongTimer(elapsedMs: number): boolean {
  return elapsedMs > TIMER_LONG_MS;
}

/** Started more than TIMER_OLD_DAYS days before `today`. */
export function isOldTimer(timer: ActiveTimer, today: string): boolean {
  return diffDays(timer.date, today) > TIMER_OLD_DAYS;
}

/** Milliseconds until the goal (the step's usual minutes) is reached; null without a goal or once reached. */
export function msUntilGoal(timer: ActiveTimer, goalMinutes: number | null, now: Date): number | null {
  if (goalMinutes === null || goalMinutes <= 0) return null;
  const left = goalMinutes * MINUTE_MS - timerElapsedMs(timer, now);
  return left > 0 ? left : null;
}

/** «04:07» under an hour, «1:04:07» from an hour on (whole seconds, rounded down). */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** Why a stored timer can no longer be recorded: its action left the list or its skill is not active. */
export type TimerProblem = 'step' | 'skill';

export function timerProblem(
  step: Pick<StepDefinition, 'isActive' | 'type' | 'skillId'> | undefined,
  skill: Pick<Skill, 'status'> | undefined,
): TimerProblem | null {
  if (!step || !step.isActive || step.type !== 'TIMED') return 'step';
  if (!skill || skill.status !== 'ACTIVE') return 'skill';
  return null;
}
