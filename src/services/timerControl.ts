// Pausing, resuming, discarding and recording the live timer (v0.5 package 15), for the lazy
// timer UI; starting and reading it are in timer.ts (the first paint). Every change applies only
// to the timer it was meant for: another tab may have finished it and started a new one.
// Recording goes through the ordinary completeStep, so points, celebrations, the undo toast and
// achievements are the same as for minutes typed by hand.

import { db } from '../data/db';
import { nowDate } from '../lib/clock';
import type { Progress } from '../domain/progression';
import { pauseTimer, resumeTimer, type ActiveTimer } from '../domain/timer';
import { completeStep, type MutationResult } from './completions';
import { loadTimeline, ValidationError } from './core';
import { getActiveTimer, TIMER_KEY } from './timer';

/**
 * Changes the stored timer if it is still the one started at `startedAt` (another tab may have
 * finished it and started a new one); `null` from `change` removes it. Returns the stored timer.
 */
async function updateTimer(startedAt: string, change: (timer: ActiveTimer) => ActiveTimer | null): Promise<ActiveTimer | null> {
  return db.transaction('rw', db.settings, async () => {
    const current = await getActiveTimer();
    if (!current || current.startedAt !== startedAt) return current;
    const next = change(current);
    if (next) await db.settings.put({ key: TIMER_KEY, value: next });
    else await db.settings.delete(TIMER_KEY);
    return next;
  });
}

export function pauseActiveTimer(startedAt: string): Promise<ActiveTimer | null> {
  return updateTimer(startedAt, (timer) => pauseTimer(timer, nowDate()));
}

export function resumeActiveTimer(startedAt: string): Promise<ActiveTimer | null> {
  return updateTimer(startedAt, (timer) => resumeTimer(timer, nowDate()));
}

/** «Сбросить», or a timer whose action or skill is gone: removed without recording anything. */
export async function discardTimer(startedAt: string): Promise<void> {
  await updateTimer(startedAt, () => null);
}

/**
 * «Завершить»: records the timer's action with the minutes, date and note the user confirmed
 * (the normal completion, same validation) and removes the timer in the same transaction, so a
 * WebView killed in between can never leave a recorded timer to be recorded twice. A timer that
 * is no longer the stored one (finished in another tab) records nothing.
 */
export async function recordTimer(timer: ActiveTimer, options: { minutes: number; date: string; note?: string | null }): Promise<MutationResult> {
  return completeStep(timer.stepId, {
    ...options,
    inTransaction: async () => {
      const current = await getActiveTimer();
      if (!current || current.startedAt !== timer.startedAt) throw new ValidationError('Этот таймер уже завершён');
      await db.settings.delete(TIMER_KEY);
    },
  });
}

/** The skill's progress for the timer sheet's mini; null when the skill is gone. */
export async function getTimerSkillProgress(skillId: string): Promise<Progress | null> {
  return db.transaction('r', [db.skills, db.levelThresholds, db.transactions], async () => {
    const skill = await db.skills.get(skillId);
    return skill ? (await loadTimeline(skill)).progress : null;
  });
}
