import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { exportBackup, importBackup, wipeAllData } from '../data/backup';
import { setClock } from '../lib/clock';
import { archiveSkill } from '../services/lifecycle';
import { installFreshDb } from '../test/harness';
import { getSetting } from './settings';
import { createSkill, type SkillInput } from './skills';
import { createStep, setStepActive } from './steps';
import { getActiveTimer, getTimerView, startTimer, TIMER_KEY, TimerRunningError } from './timer';
import { discardTimer, getTimerSkillProgress, pauseActiveTimer, recordTimer, resumeActiveTimer } from './timerControl';

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
};

const MIN = 60_000;
let now = new Date(2026, 8, 24, 10, 0);
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

installFreshDb();
beforeEach(() => {
  now = new Date(2026, 8, 24, 10, 0);
  setClock(() => now);
});

async function setup() {
  const skillId = await createSkill(input);
  const talk = await createStep({ skillId, name: 'Разговор', type: 'TIMED', pointsPerMinute: 0.5, defaultMinutes: 30 });
  const read = await createStep({ skillId, name: 'Чтение', type: 'TIMED', pointsPerMinute: 1, defaultMinutes: null });
  const check = await createStep({ skillId, name: 'Слова', points: 5 });
  return { skillId, talk, read, check };
}

describe('timer service', () => {
  it('starts one timer and gives it back with its action and skill', async () => {
    const { skillId, talk } = await setup();
    const timer = await startTimer(talk);
    expect(timer).toMatchObject({ stepId: talk, skillId, pausedAt: null, pausedMs: 0, date: '2026-09-24' });
    const view = await getTimerView();
    expect(view?.timer).toEqual(timer);
    expect(view?.step?.name).toBe('Разговор');
    expect(view?.skill?.name).toBe('Английский');
    // Starting the same action again returns the running timer, unchanged.
    advance(MIN);
    expect(await startTimer(talk)).toEqual(timer);
  });

  it('refuses a second timer and anything but a timed action of an active skill', async () => {
    const { skillId, talk, read, check } = await setup();
    await expect(startTimer(check)).rejects.toThrow('Действие не найдено');
    await startTimer(talk);
    await expect(startTimer(read)).rejects.toBeInstanceOf(TimerRunningError);
    await discardTimer((await getActiveTimer())!.startedAt);
    await archiveSkill(skillId);
    await expect(startTimer(read)).rejects.toThrow('Навык не активен');
    expect(await getActiveTimer()).toBeNull();
  });

  it('pauses and resumes the stored timer only', async () => {
    const { talk } = await setup();
    const timer = await startTimer(talk);
    advance(10 * MIN);
    const paused = await pauseActiveTimer(timer.startedAt);
    expect(paused?.pausedAt).toBe(now.toISOString());
    advance(5 * MIN);
    const resumed = await resumeActiveTimer(timer.startedAt);
    expect(resumed).toMatchObject({ pausedAt: null, pausedMs: 5 * MIN });
    // A stale tab's pause of a timer that is gone changes nothing.
    expect(await pauseActiveTimer('2020-01-01T00:00:00.000Z')).toEqual(resumed);
    expect((await getActiveTimer())?.pausedAt).toBeNull();
  });

  it('records the confirmed minutes and date through the normal completion, then removes the timer', async () => {
    const { skillId, talk } = await setup();
    const timer = await startTimer(talk);
    advance(25 * MIN);
    const result = await recordTimer(timer, { minutes: 25, date: timer.date });
    expect(result.pointsAwarded).toBe(12.5);
    const completion = await db.completions.get(result.completionId);
    expect(completion).toMatchObject({ skillId, stepId: talk, durationMinutes: 25, date: '2026-09-24', status: 'ACTIVE' });
    expect(await getActiveTimer()).toBeNull();
    expect((await getTimerSkillProgress(skillId))?.totalPoints).toBe(12.5);
    // Recorded once: the same timer cannot be recorded again.
    await expect(recordTimer(timer, { minutes: 25, date: timer.date })).rejects.toThrow('Этот таймер уже завершён');
  });

  it('records on the start day after midnight, and the date can be changed', async () => {
    const { talk } = await setup();
    now = new Date(2026, 8, 24, 23, 40);
    const timer = await startTimer(talk);
    now = new Date(2026, 8, 25, 0, 20);
    const result = await recordTimer(timer, { minutes: 40, date: timer.date });
    expect((await db.completions.get(result.completionId))?.date).toBe('2026-09-24');
    const next = await startTimer(talk);
    const moved = await recordTimer(next, { minutes: 5, date: '2026-09-25' });
    expect((await db.completions.get(moved.completionId))?.date).toBe('2026-09-25');
  });

  it('keeps the timer when the completion is refused', async () => {
    const { talk } = await setup();
    const timer = await startTimer(talk);
    await expect(recordTimer(timer, { minutes: 25, date: '2026-09-30' })).rejects.toThrow('Некорректная дата');
    await expect(recordTimer(timer, { minutes: 0, date: timer.date })).rejects.toThrow();
    expect(await getActiveTimer()).toEqual(timer);
  });

  it('writes the note with the completion and removes the timer in the same transaction', async () => {
    const { talk } = await setup();
    const timer = await startTimer(talk);
    advance(30 * MIN);
    const result = await recordTimer(timer, { minutes: 30, date: timer.date, note: '  Про погоду ' });
    const completion = await db.completions.get(result.completionId);
    expect(completion).toMatchObject({ note: 'Про погоду', durationMinutes: 30 });
    expect(completion!.updatedAt).toBe(completion!.createdAt);
    expect(await getActiveTimer()).toBeNull();
  });

  it('rolls the timer back with a completion refused inside the transaction', async () => {
    const { talk } = await setup();
    const timer = await startTimer(talk);
    // The minutes are checked after the timer was taken off: the refusal puts it back.
    await expect(recordTimer(timer, { minutes: 5000, date: timer.date })).rejects.toThrow();
    await setStepActive(talk, false);
    await expect(recordTimer(timer, { minutes: 25, date: timer.date })).rejects.toThrow('Действие не найдено');
    expect(await getActiveTimer()).toEqual(timer);
    expect(await db.completions.count()).toBe(0);
  });

  it('reads a malformed row as no timer and lets a new one replace it', async () => {
    const { talk } = await setup();
    await db.settings.put({ key: TIMER_KEY, value: { stepId: talk } });
    expect(await getTimerView()).toBeNull();
    expect((await startTimer(talk)).stepId).toBe(talk);
  });

  it('is device state: never exported, dropped from a file, cleared by an import and a wipe', async () => {
    const { talk } = await setup();
    const timer = await startTimer(talk);
    const file = await exportBackup();
    expect((file.tables.settings as { key: string }[]).some((row) => row.key === TIMER_KEY)).toBe(false);
    // A file carrying a timer (hand-made, or from a build that exported one) does not bring it.
    file.tables.settings = [...file.tables.settings!, { key: TIMER_KEY, value: timer }];
    await importBackup(file);
    expect(await getActiveTimer()).toBeNull();
    await startTimer(talk);
    await wipeAllData();
    expect(await getSetting(TIMER_KEY as 'activeTimer', null)).toBeNull();
  });
});
