import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { setClock } from '../lib/clock';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/dates';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import type { StepCompletion } from '../domain/types';
import {
  cancelCompletion,
  completeStep,
  correctDuration,
  getCompletion,
  restoreCompletion,
  setCompletionNote,
  SAME_TAP_MS,
} from './completions';
import { CATALOG } from '../domain/achievements/catalog';
import { registerAfterCommitHook, registerInTransactionHook } from './afterWrite';
import { DoubleSubmitError } from './core';
import { getSkillHistory } from './history';
import { getSkillDetails } from './queries';
import { completeSkill, createSkill, ValidationError, type SkillInput } from './skills';
import { createStep } from './steps';
import { archiveSkill } from './lifecycle';

const skillInput: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Достичь C1',
  milestoneTarget: 10,
  capacityBase: 100,
  capacityIncrement: 50,
  manualCapacities: [100],
};

installFreshDb();
// Repeated completions of one step must sit further apart than the double-submit window.
beforeEach(() => setClock(tickingClock(todayNoon())));

async function details(id: string) {
  const d = await getSkillDetails(id);
  if (!d) throw new Error('skill not found');
  return d;
}

async function rowsOf(completionId: string) {
  return (await db.transactions.where('completionId').equals(completionId).sortBy('createdAt')).map((t) => [t.reason, t.delta]);
}

/** A skill with a 96-point and a 5-point step: 96 + 5 crosses flask 1 (capacity 100). */
async function e2e002() {
  const skillId = await createSkill(skillInput);
  const big = await createStep({ skillId, name: 'Интенсив', points: 96 });
  const small = await createStep({ skillId, name: 'Разговорная практика', points: 5 });
  await completeStep(big);
  const crossing = await completeStep(small);
  return { skillId, big, small, crossing };
}

describe('E2E-002: cancelling a completion rolls the flask back', () => {
  it('96 + 5 → flask 2 with 1; cancel → flask 1 with 96, CANCELLED, a −5 row', async () => {
    const { skillId, crossing } = await e2e002();
    expect(crossing.after).toMatchObject({ currentFlask: 2, pointsInCurrentFlask: 1, currentCapacity: 150 });
    expect(crossing.levelChange).toBe(1);

    const cancelled = await cancelCompletion(crossing.completionId);
    expect(cancelled).toMatchObject({ completionId: crossing.completionId, delta: -5, levelChange: -1, achievements: [] });
    expect(cancelled.before).toMatchObject({ currentFlask: 2, pointsInCurrentFlask: 1 });
    expect(cancelled.after).toMatchObject({ currentFlask: 1, pointsInCurrentFlask: 96, currentCapacity: 100 });

    const completion = await db.completions.get(crossing.completionId);
    expect(completion).toMatchObject({ status: 'CANCELLED', pointsAwarded: 5 });
    expect(completion?.cancelledAt).not.toBeNull();

    const d = await details(skillId);
    expect(d.progress).toMatchObject({ currentFlask: 1, pointsInCurrentFlask: 96 });
    // Newest first: the CANCELLATION row with its «Возврат к колбе 1», then the original
    // completion (kept, now CANCELLED) with the flask it filled.
    const history = (await getSkillHistory(skillId))!;
    expect(history.events.map((e) => [e.type, 'delta' in e ? e.delta : null])).toEqual([
      ['LEVEL_DOWN', null],
      ['CANCELLATION', -5],
      ['LEVEL_UP', null],
      ['COMPLETION', 5],
      ['COMPLETION', 96],
      ['SKILL_CREATED', null],
    ]);
    const second = history.events[3];
    expect(second?.type === 'COMPLETION' && second.completion?.status).toBe('CANCELLED');
  });

  it('rejects a second cancel and a missing completion', async () => {
    const { crossing } = await e2e002();
    await cancelCompletion(crossing.completionId);
    await expect(cancelCompletion(crossing.completionId)).rejects.toThrow('Выполнение уже отменено');
    await expect(cancelCompletion('nope')).rejects.toThrow('Выполнение не найдено');
    expect(await rowsOf(crossing.completionId)).toEqual([
      ['COMPLETION', 5],
      ['CANCELLATION', -5],
    ]);
  });

  it('restores a cancelled completion with a RESTORE row', async () => {
    const { skillId, crossing } = await e2e002();
    await cancelCompletion(crossing.completionId);
    const restored = await restoreCompletion(crossing.completionId);
    expect(restored).toMatchObject({ delta: 5, pointsAwarded: 5, levelChange: 1 });
    expect(restored.after).toMatchObject({ currentFlask: 2, pointsInCurrentFlask: 1 });
    expect(await rowsOf(crossing.completionId)).toEqual([
      ['COMPLETION', 5],
      ['CANCELLATION', -5],
      ['RESTORE', 5],
    ]);
    expect(await db.completions.get(crossing.completionId)).toMatchObject({ status: 'ACTIVE', cancelledAt: null });
    expect((await details(skillId)).progress.totalPoints).toBe(101);
    await expect(restoreCompletion(crossing.completionId)).rejects.toThrow('Выполнение не отменено');
  });

  it('un-reaches the milestone when the reaching completion is cancelled', async () => {
    const skillId = await createSkill({ ...skillInput, milestoneTarget: 1 });
    const stepId = await createStep({ skillId, name: 'Шаг', points: 60 });
    await completeStep(stepId);
    const reaching = await completeStep(stepId);
    expect(reaching.milestoneReached).toBe(true);

    const cancelled = await cancelCompletion(reaching.completionId);
    expect(cancelled.milestoneLost).toBe(true);
    expect((await details(skillId)).milestone?.reachedAt).toBeNull();

    const restored = await restoreCompletion(reaching.completionId);
    expect(restored.milestoneReached).toBe(true);
  });

  it('rejects cancel and restore on a completed skill (decision 14.9)', async () => {
    const skillId = await createSkill({ ...skillInput, milestoneTarget: 1 });
    const stepId = await createStep({ skillId, name: 'Шаг', points: 100 });
    const first = await completeStep(stepId);
    const second = await completeStep(stepId);
    await cancelCompletion(second.completionId);
    await completeSkill(skillId);
    await expect(cancelCompletion(first.completionId)).rejects.toThrow('Навык не активен');
    await expect(restoreCompletion(second.completionId)).rejects.toThrow(ValidationError);
    expect((await details(skillId)).progress.totalPoints).toBe(100);
  });

  it('rejects cancel on an archived skill', async () => {
    const { skillId, crossing } = await e2e002();
    await archiveSkill(skillId);
    await expect(cancelCompletion(crossing.completionId)).rejects.toThrow('Навык не активен');
  });
});

describe('correctDuration', () => {
  /** A TIMED completion as package 8 will write it: 30 min at 0.5 points per minute. */
  async function timedFixture() {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 1 });
    await db.steps.update(stepId, { type: 'TIMED', pointsPerMinute: 0.5, defaultMinutes: 30 });
    // The injectable clock, like the service: the real time would sort after the corrections
    // written by the ticking clock (it starts at local noon) whenever the test runs after noon.
    const now = nowIso();
    const completion: StepCompletion = {
      id: newId(),
      skillId,
      stepId,
      stepName: 'Чтение',
      stepType: 'TIMED',
      pointsSnapshot: 0.5,
      durationMinutes: 30,
      pointsAwarded: 15,
      date: '2026-09-20',
      source: 'MANUAL',
      status: 'ACTIVE',
      cancelledAt: null,
      note: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.completions.add(completion);
    await db.transactions.add({ id: newId(), skillId, completionId: completion.id, delta: 15, reason: 'COMPLETION', createdAt: now });
    return { skillId, stepId, completionId: completion.id };
  }

  it('corrects 30 → 45 → 30 with CORRECTION rows that net to zero', async () => {
    const { skillId, stepId, completionId } = await timedFixture();
    // The current rate of the step is irrelevant: the snapshot decides (FR-XP-008).
    await db.steps.update(stepId, { pointsPerMinute: 2 });

    const up = await correctDuration(completionId, 45);
    expect(up).toMatchObject({ delta: 7.5, pointsAwarded: 22.5 });
    expect(await db.completions.get(completionId)).toMatchObject({ durationMinutes: 45, pointsAwarded: 22.5 });

    const down = await correctDuration(completionId, 30);
    expect(down).toMatchObject({ delta: -7.5, pointsAwarded: 15 });
    expect(await rowsOf(completionId)).toEqual([
      ['COMPLETION', 15],
      ['CORRECTION', 7.5],
      ['CORRECTION', -7.5],
    ]);
    expect(await db.completions.get(completionId)).toMatchObject({ durationMinutes: 30, pointsAwarded: 15 });
    expect((await details(skillId)).progress.totalPoints).toBe(15);
  });

  it('writes no row when the points do not change and validates minutes', async () => {
    const { completionId } = await timedFixture();
    expect((await correctDuration(completionId, 30)).delta).toBe(0);
    expect(await rowsOf(completionId)).toHaveLength(1);
    await expect(correctDuration(completionId, 0)).rejects.toThrow(ValidationError);
    await expect(correctDuration(completionId, 1441)).rejects.toThrow(ValidationError);
    await expect(correctDuration(completionId, 2.5)).rejects.toThrow(ValidationError);
  });

  it('rejects a BOOLEAN completion and a cancelled one', async () => {
    const { crossing } = await e2e002();
    await expect(correctDuration(crossing.completionId, 30)).rejects.toThrow('Длительность можно менять только у временного выполнения');
    const { completionId } = await timedFixture();
    await cancelCompletion(completionId);
    await expect(correctDuration(completionId, 45)).rejects.toThrow(ValidationError);
    expect(await rowsOf(completionId)).toEqual([
      ['COMPLETION', 15],
      ['CANCELLATION', -15],
    ]);
  });
});

describe('notes', () => {
  it('trims, clears and limits a note without touching the journal', async () => {
    const { crossing } = await e2e002();
    const before = await db.transactions.count();

    await setCompletionNote(crossing.completionId, '  Говорили про работу  ');
    expect((await db.completions.get(crossing.completionId))?.note).toBe('Говорили про работу');
    await setCompletionNote(crossing.completionId, '   ');
    expect((await db.completions.get(crossing.completionId))?.note).toBeNull();
    await expect(setCompletionNote(crossing.completionId, 'а'.repeat(501))).rejects.toThrow('Заметка: не больше 500 символов');
    await setCompletionNote(crossing.completionId, 'а'.repeat(500));
    expect((await db.completions.get(crossing.completionId))?.note).toHaveLength(500);

    expect(await db.transactions.count()).toBe(before);
  });

  it('is editable on cancelled completions and completed skills', async () => {
    const skillId = await createSkill({ ...skillInput, milestoneTarget: 1 });
    const stepId = await createStep({ skillId, name: 'Шаг', points: 100 });
    const kept = await completeStep(stepId);
    const cancelled = await completeStep(stepId);
    await cancelCompletion(cancelled.completionId);
    await completeSkill(skillId);
    await setCompletionNote(cancelled.completionId, 'Отметил по ошибке');
    await setCompletionNote(kept.completionId, 'Первая колба');
    expect((await db.completions.get(cancelled.completionId))?.note).toBe('Отметил по ошибке');
    expect((await db.completions.get(kept.completionId))?.note).toBe('Первая колба');
  });

  it('can be given with the completion', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 5 });
    const { completionId } = await completeStep(stepId, { note: ' Утром ' });
    expect((await db.completions.get(completionId))?.note).toBe('Утром');
    await expect(completeStep(stepId, { note: 'x'.repeat(501) })).rejects.toThrow(ValidationError);
  });
});

describe('same-tap guard', () => {
  it('rejects the same step and date within 1.5 s and accepts it after', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 5 });
    const other = await createStep({ skillId, name: 'Другой', points: 5 });
    let t = new Date(todayNoon()).getTime();
    setClock(() => new Date(t));

    await completeStep(stepId);
    t += SAME_TAP_MS - 100;
    await expect(completeStep(stepId)).rejects.toThrow('Уже отмечено — подождите секунду');
    await completeStep(other); // a different step is not a double tap
    t += 200;
    await completeStep(stepId);
    expect(await db.completions.where('stepId').equals(stepId).count()).toBe(2);
  });

  it('ignores a completion that was just cancelled («Отменить» right after the tap)', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 5 });
    let t = new Date(todayNoon()).getTime();
    setClock(() => new Date(t));

    const first = await completeStep(stepId);
    t += 300;
    await cancelCompletion(first.completionId);
    t += 300;
    await completeStep(stepId);
    t += 300;
    await expect(completeStep(stepId)).rejects.toThrow(DoubleSubmitError);
    expect(await db.completions.where('stepId').equals(stepId).count()).toBe(2);
  });

  it('does not block a backdated completion of the same step', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 5 });
    const fixed = new Date(todayNoon());
    setClock(() => fixed);
    await completeStep(stepId);
    await completeStep(stepId, { date: '2026-01-05' });
    expect(await db.completions.count()).toBe(2);
  });
});

describe('getCompletion', () => {
  it('returns the completion with its rows and the flask state after it', async () => {
    const { skillId, crossing } = await e2e002();
    await cancelCompletion(crossing.completionId);
    const details = await getCompletion(crossing.completionId);
    expect(details?.skill.id).toBe(skillId);
    expect(details?.transactions.map((t) => t.reason)).toEqual(['COMPLETION', 'CANCELLATION']);
    expect(details?.progressAfter).toMatchObject({ currentFlask: 2, pointsInCurrentFlask: 1 });
    expect(await getCompletion('nope')).toBeNull();
  });
});

describe('afterWrite hooks', () => {
  it('runs the achievement sync inside the transaction and backup scheduling after the commit', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 5 });
    const calls: string[] = [];
    const extra = CATALOG.find((d) => d.id === 'actions-10')!;
    const offSync = registerInTransactionHook(async ({ skillId: changed, now }) => {
      calls.push(`sync:${changed === skillId}:${(await db.completions.count()) === 1}`);
      return [{ def: extra, unlocked: true, unlockedAt: now, skillId: null, current: 10, target: 10 }];
    });
    const offBackup = registerAfterCommitHook(() => {
      calls.push('backup');
      throw new Error('offline'); // never fails the write
    });
    try {
      const result = await completeStep(stepId);
      // The built-in achievement sync runs first, then the registered hooks.
      expect(result.achievements.map((s) => s.def.id)).toEqual(['first-step', 'actions-10']);
      expect(calls).toEqual(['sync:true:true', 'backup']);
    } finally {
      offSync();
      offBackup();
    }
  });

  it('rolls the journal row back when the in-transaction sync fails', async () => {
    const skillId = await createSkill(skillInput);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 5 });
    const off = registerInTransactionHook(async () => {
      throw new Error('sync failed');
    });
    try {
      await expect(completeStep(stepId)).rejects.toThrow('sync failed');
    } finally {
      off();
    }
    expect(await db.completions.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });
});
