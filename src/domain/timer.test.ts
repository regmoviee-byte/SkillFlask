import { describe, expect, it } from 'vitest';
import { localDate } from '../lib/dates';
import {
  formatElapsed,
  isLongTimer,
  isOldTimer,
  minutesToRecord,
  msUntilGoal,
  newTimer,
  parseTimer,
  pauseTimer,
  resumeTimer,
  timerElapsedMs,
  timerProblem,
  TIMER_LONG_MS,
  type ActiveTimer,
} from './timer';

const MIN = 60_000;
const step = { id: 'step-1', skillId: 'skill-1' };
/** Local wall-clock time (the device zone: the suite also runs under TZ=America/Sao_Paulo). */
const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 8, day, h, m, s);
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

describe('timer', () => {
  it('starts running on the local day of the start', () => {
    const start = at(24, 9, 30);
    const timer = newTimer(step, start);
    expect(timer).toEqual({ stepId: 'step-1', skillId: 'skill-1', startedAt: start.toISOString(), pausedAt: null, pausedMs: 0, date: '2026-09-24' });
    expect(timerElapsedMs(timer, plus(start, 25 * MIN))).toBe(25 * MIN);
  });

  it('keeps the start day when the timer runs past midnight', () => {
    const start = at(24, 23, 50);
    const timer = newTimer(step, start);
    const after = at(25, 0, 20);
    expect(localDate(after)).toBe('2026-09-25');
    expect(timer.date).toBe('2026-09-24');
    expect(timerElapsedMs(timer, after)).toBe(30 * MIN);
  });

  it('counts pauses out, over any sequence of pause and resume', () => {
    const start = at(24, 10);
    let timer = newTimer(step, start);
    timer = pauseTimer(timer, plus(start, 10 * MIN));
    // Frozen while paused, however late it is read.
    expect(timerElapsedMs(timer, plus(start, 50 * MIN))).toBe(10 * MIN);
    timer = resumeTimer(timer, plus(start, 15 * MIN));
    expect(timer.pausedMs).toBe(5 * MIN);
    expect(timerElapsedMs(timer, plus(start, 20 * MIN))).toBe(15 * MIN);
    timer = pauseTimer(timer, plus(start, 30 * MIN));
    timer = resumeTimer(timer, plus(start, 40 * MIN));
    expect(timer.pausedMs).toBe(15 * MIN);
    expect(timerElapsedMs(timer, plus(start, 45 * MIN))).toBe(30 * MIN);
  });

  it('ignores a second pause or a resume of a running timer', () => {
    const start = at(24, 10);
    const running = newTimer(step, start);
    expect(resumeTimer(running, plus(start, MIN))).toBe(running);
    const paused = pauseTimer(running, plus(start, MIN));
    expect(pauseTimer(paused, plus(start, 5 * MIN))).toBe(paused);
  });

  it('survives a reload: the stored row alone gives the same time', () => {
    const start = at(24, 10);
    const timer = pauseTimer(resumeTimer(pauseTimer(newTimer(step, start), plus(start, 3 * MIN)), plus(start, 4 * MIN)), plus(start, 9 * MIN));
    // Whatever went through storage (JSON, IndexedDB's structured clone) reads back the same.
    const reloaded = parseTimer(JSON.parse(JSON.stringify(timer)));
    expect(reloaded).toEqual(timer);
    expect(timerElapsedMs(reloaded!, plus(start, 60 * MIN))).toBe(8 * MIN);
  });

  it('never reads negative time when the device clock went back', () => {
    const start = at(24, 10);
    expect(timerElapsedMs(newTimer(step, start), plus(start, -5 * MIN))).toBe(0);
    // A resume "before" the pause adds nothing to the paused time.
    const paused = pauseTimer(newTimer(step, start), plus(start, 10 * MIN));
    expect(resumeTimer(paused, plus(start, 5 * MIN)).pausedMs).toBe(0);
  });

  it('records whole minutes, rounded, at least one and at most a day', () => {
    expect(minutesToRecord(0)).toBe(1);
    expect(minutesToRecord(20_000)).toBe(1);
    expect(minutesToRecord(89_999)).toBe(1);
    expect(minutesToRecord(90_000)).toBe(2);
    expect(minutesToRecord(29 * MIN + 29_000)).toBe(29);
    expect(minutesToRecord(29 * MIN + 30_000)).toBe(30);
    expect(minutesToRecord(30 * 60 * MIN)).toBe(1440);
  });

  it('flags a timer longer than 12 hours and one older than 7 days', () => {
    expect(isLongTimer(TIMER_LONG_MS)).toBe(false);
    expect(isLongTimer(TIMER_LONG_MS + 1000)).toBe(true);
    const timer = newTimer(step, at(10, 9));
    expect(isOldTimer(timer, '2026-09-17')).toBe(false);
    expect(isOldTimer(timer, '2026-09-18')).toBe(true);
  });

  it('knows how long until the usual minutes', () => {
    const start = at(24, 10);
    const timer = newTimer(step, start);
    expect(msUntilGoal(timer, 30, plus(start, 10 * MIN))).toBe(20 * MIN);
    expect(msUntilGoal(timer, 30, plus(start, 30 * MIN))).toBeNull();
    expect(msUntilGoal(timer, null, start)).toBeNull();
    // Paused: the goal is as far as it was at the pause.
    expect(msUntilGoal(pauseTimer(timer, plus(start, 5 * MIN)), 30, plus(start, 29 * MIN))).toBe(25 * MIN);
  });

  it('formats mm:ss and h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(4 * MIN + 7_999)).toBe('04:07');
    expect(formatElapsed(59 * MIN + 59_000)).toBe('59:59');
    expect(formatElapsed(64 * MIN + 7_000)).toBe('1:04:07');
    expect(formatElapsed(-5)).toBe('00:00');
  });

  it('names what makes a stored timer unrecordable', () => {
    const timed = { isActive: true, type: 'TIMED' as const, skillId: 'skill-1' };
    expect(timerProblem(timed, { status: 'ACTIVE' })).toBeNull();
    expect(timerProblem(undefined, undefined)).toBe('step');
    expect(timerProblem({ ...timed, isActive: false }, { status: 'ACTIVE' })).toBe('step');
    expect(timerProblem(timed, { status: 'ARCHIVED' })).toBe('skill');
    expect(timerProblem(timed, { status: 'COMPLETED' })).toBe('skill');
    expect(timerProblem(timed, undefined)).toBe('skill');
  });

  it('reads a malformed row as no timer', () => {
    const good: ActiveTimer = newTimer(step, at(24, 10));
    expect(parseTimer(good)).toEqual(good);
    for (const bad of [null, 'x', {}, { ...good, stepId: '' }, { ...good, startedAt: 'yesterday' }, { ...good, pausedMs: -1 }, { ...good, date: '2026-02-30' }, { ...good, pausedAt: 5 }]) {
      expect(parseTimer(bad)).toBeNull();
    }
  });
});
