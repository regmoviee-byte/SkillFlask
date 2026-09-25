// The stored row of the live timer (v0.5 package 15): its shape, a new one, and reading it
// back. Kept apart from the helpers in timer.ts because the first paint needs only this (the
// live query of the row and the ▶); the rest is used by the lazy timer UI.

import { isValidLocalDate, localDate } from '../lib/dates';
import type { StepDefinition } from './types';

export interface ActiveTimer {
  stepId: string;
  skillId: string;
  /** ISO timestamp of the start. */
  startedAt: string;
  /** ISO timestamp of the current pause; null while running. */
  pausedAt: string | null;
  /** Milliseconds spent in pauses that have ended. */
  pausedMs: number;
  /** The local day the timer started (YYYY-MM-DD): the completion's date by default. */
  date: string;
}

/** A new running timer of `step`, started at `now` on its local day. */
export function newTimer(step: Pick<StepDefinition, 'id' | 'skillId'>, now: Date): ActiveTimer {
  return { stepId: step.id, skillId: step.skillId, startedAt: now.toISOString(), pausedAt: null, pausedMs: 0, date: localDate(now) };
}

const isIso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

/** The stored row as a timer, or null when it is missing or malformed (a malformed row is ignored, never thrown). */
export function parseTimer(value: unknown): ActiveTimer | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Record<string, unknown>;
  if (typeof t.stepId !== 'string' || !t.stepId || typeof t.skillId !== 'string' || !t.skillId) return null;
  if (!isIso(t.startedAt) || !(t.pausedAt === null || isIso(t.pausedAt))) return null;
  if (typeof t.pausedMs !== 'number' || !Number.isFinite(t.pausedMs) || t.pausedMs < 0) return null;
  if (!isValidLocalDate(t.date)) return null;
  return { stepId: t.stepId, skillId: t.skillId, startedAt: t.startedAt, pausedAt: t.pausedAt, pausedMs: t.pausedMs, date: t.date };
}
