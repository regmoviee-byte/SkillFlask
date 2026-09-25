// The live timer of a TIMED action (v0.5 package 15): one timer at a time in the settings row
// `activeTimer`. The row is the source of truth for every tab and every reopening of the Mini
// App (a live query follows it); its time is derived from its timestamps (domain/timer.ts).
// It is device state: not in backups (data/backup.ts), gone after an import or a wipe.
// This module is what the first paint needs (the live query, the ▶); pausing, resuming,
// discarding and recording are in timerControl.ts, used by the lazy timer UI only.

import { db } from '../data/db';
import { nowDate } from '../lib/clock';
import { newTimer, parseTimer, type ActiveTimer } from '../domain/timerRow';
import type { Skill, StepDefinition } from '../domain/types';
import { requireActiveSkill, requireSkill, ValidationError } from './core';

export const TIMER_KEY = 'activeTimer';

/** Another action's timer is running: the UI asks before it finishes that one and starts this. */
export class TimerRunningError extends ValidationError {}

export interface TimerView {
  timer: ActiveTimer;
  /** The timer's action and skill as they are now; either may be gone or no longer active. */
  step: StepDefinition | undefined;
  skill: Skill | undefined;
}

/** The stored timer, or null without one (a malformed row reads as none). */
export async function getActiveTimer(): Promise<ActiveTimer | null> {
  return parseTimer((await db.settings.get(TIMER_KEY))?.value);
}

/** The running or paused timer with its action and skill; null without one. For a live query. */
export async function getTimerView(): Promise<TimerView | null> {
  return db.transaction('r', [db.settings, db.steps, db.skills], async () => {
    const timer = await getActiveTimer();
    if (!timer) return null;
    const [step, skill] = await Promise.all([db.steps.get(timer.stepId), db.skills.get(timer.skillId)]);
    return { timer, step, skill };
  });
}

/**
 * Starts the timer of a TIMED action of an active skill. Starting the one already running
 * returns it; while another runs this throws TimerRunningError (finish that one first).
 */
export async function startTimer(stepId: string): Promise<ActiveTimer> {
  return db.transaction('rw', [db.settings, db.steps, db.skills], async () => {
    const step = await db.steps.get(stepId);
    if (!step || !step.isActive || step.type !== 'TIMED') throw new ValidationError('Действие не найдено');
    requireActiveSkill(await requireSkill(step.skillId));
    const current = await getActiveTimer();
    if (current) {
      if (current.stepId === stepId) return current;
      throw new TimerRunningError('Уже идёт другой таймер');
    }
    const timer = newTimer(step, nowDate());
    await db.settings.put({ key: TIMER_KEY, value: timer });
    return timer;
  });
}
