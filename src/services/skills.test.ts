import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../data/db';
import { addDays, localDate } from '../lib/dates';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock, todayNoon, withClock } from '../test/harness';
import { resetStoragePersistRequest } from './completions';
import { verifyJournal } from './journal';
import { getSkillDetails, listSkillSummaries } from './queries';
import { getSetting } from './settings';
import {
  completeSkill,
  completeStep,
  continueAfterMilestone,
  createSkill,
  createStep,
  deleteSkill,
  updateSkill,
  ValidationError,
  type SkillInput,
} from './skills';

const english: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Достичь C1',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 50,
  manualCapacities: [10, 20, 30],
};

installFreshDb();
// Repeated completions of one step must sit further apart than the double-submit window.
beforeEach(() => setClock(tickingClock(todayNoon())));

async function details(id: string) {
  const d = await getSkillDetails(id);
  if (!d) throw new Error('skill not found');
  return d;
}

describe('E2E-001: full skill cycle', () => {
  it('goes from skill creation to a completed skill', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Разговорная практика', points: 5 });

    let d = await details(skillId);
    expect(d.skill.status).toBe('ACTIVE');
    expect(d.progress).toMatchObject({ currentFlask: 1, pointsInCurrentFlask: 0, currentCapacity: 10 });
    expect(d.milestone).toMatchObject({ name: 'Достичь C1', targetFlaskNumber: 3, reachedAt: null });
    expect(d.steps[0]).toMatchObject({ pointsPerMinute: null, defaultMinutes: null, schedule: { kind: 'MANUAL' } });
    expect(d.steps[0].scheduleFrom).toBe(localDate());

    // Flask 1 (10 points) fills after two completions, the level goes up.
    await completeStep(stepId);
    const second = await completeStep(stepId);
    expect(second.before.completedFlasks).toBe(0);
    expect(second.after).toMatchObject({ completedFlasks: 1, currentFlask: 2, pointsInCurrentFlask: 0, currentCapacity: 20 });
    expect(second).toMatchObject({ delta: 5, levelChange: 1, milestoneReached: false, milestoneLost: false });

    // 10 + 20 + 30 = 60 points reach the milestone of three flasks.
    let result = second;
    for (let i = 0; i < 10; i++) result = await completeStep(stepId);
    expect(result.after.completedFlasks).toBe(3);
    expect(result.milestoneReached).toBe(true);

    d = await details(skillId);
    expect(d.milestone?.reachedAt).not.toBeNull();
    expect(d.skill.status).toBe('ACTIVE'); // not completed automatically (FR-MS-005)
    expect(d.history).toHaveLength(12);
    expect(d.history[0].completion?.stepName).toBe('Разговорная практика');

    // One more completion after the milestone does not report it as reached again.
    expect((await completeStep(stepId)).milestoneReached).toBe(false);

    await completeSkill(skillId);
    d = await details(skillId);
    expect(d.skill.status).toBe('COMPLETED');
    expect(d.skill.completedAt).not.toBeNull();

    // A completed skill is read-only (decision 14.9).
    await expect(completeStep(stepId)).rejects.toThrow(ValidationError);
    await expect(createStep({ skillId, name: 'Ещё', points: 1 })).rejects.toThrow(ValidationError);
    await expect(updateSkill(skillId, english)).rejects.toThrow(ValidationError);
    await expect(continueAfterMilestone(skillId)).rejects.toThrow('Навык не активен');
  });
});

describe('createStep', () => {
  it('starts the schedule on the local calendar day, whatever the UTC date is (FR-TD-006)', async () => {
    const skillId = await createSkill(english);
    // 23:30 local time on the 23rd in a zone west of UTC is already the 24th in UTC.
    const lateEvening = new Date(2026, 8, 23, 23, 30);
    const stepId = await withClock(lateEvening.toISOString(), () => createStep({ skillId, name: 'Вечером', points: 1 }));
    const step = await db.steps.get(stepId);
    expect(step?.scheduleFrom).toBe(localDate(lateEvening));
    expect(step?.scheduleFrom).toBe('2026-09-23');
  });
});

describe('completeStep', () => {
  it('can fill several flasks with one completion and carries the overflow', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Интенсив', points: 35 });
    const result = await completeStep(stepId);
    expect(result.after).toMatchObject({ completedFlasks: 2, currentFlask: 3, pointsInCurrentFlask: 5 });
    expect(result.levelChange).toBe(2);
  });

  it('writes one completion with a snapshot and one transaction', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
    const { completionId } = await completeStep(stepId, { date: '2026-09-20' });

    const completion = await db.completions.get(completionId);
    expect(completion).toMatchObject({
      stepName: 'Чтение',
      stepType: 'BOOLEAN',
      pointsSnapshot: 7,
      pointsAwarded: 7,
      date: '2026-09-20',
      source: 'MANUAL',
      status: 'ACTIVE',
      cancelledAt: null,
    });
    const transactions = await db.transactions.where('completionId').equals(completionId).toArray();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ delta: 7, reason: 'COMPLETION' });
  });

  it('rejects impossible and future dates', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
    await expect(completeStep(stepId, { date: '2026-13-45' })).rejects.toThrow('Некорректная дата');
    await expect(completeStep(stepId, { date: addDays(localDate(), 1) })).rejects.toThrow('Некорректная дата');
    await expect(completeStep(stepId, { date: '20.09.2026' })).rejects.toThrow(ValidationError);
    expect(await db.completions.count()).toBe(0);
  });

  it('accepts a backdated completion up to today', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
    await withClock('2026-09-24T12:00:00', async () => {
      await completeStep(stepId, { date: '2026-09-24' });
      await completeStep(stepId, { date: '2026-09-01' });
    });
    expect(await db.completions.count()).toBe(2);
  });

  it('does not change past completions when the step changes later', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
    const { completionId } = await completeStep(stepId);
    await db.steps.update(stepId, { name: 'Чтение книг', points: 100 });
    const d = await details(skillId);
    expect(d.progress.totalPoints).toBe(7);
    expect((await db.completions.get(completionId))?.stepName).toBe('Чтение');
  });

  it('requests persistent storage once, after the first completion', async () => {
    resetStoragePersistRequest();
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', { storage: { persist } });
    try {
      const skillId = await createSkill(english);
      const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
      expect(await getSetting('storagePersistRequested', false)).toBe(false);
      await completeStep(stepId);
      await completeStep(stepId);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(await getSetting('storagePersistRequested', false)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks for persistent storage again in a later session when it was refused', async () => {
    resetStoragePersistRequest();
    const persist = vi.fn(() => Promise.resolve(false));
    vi.stubGlobal('navigator', { storage: { persist } });
    try {
      const skillId = await createSkill(english);
      const stepId = await createStep({ skillId, name: 'Чтение', points: 7 });
      await completeStep(stepId);
      await completeStep(stepId);
      expect(persist).toHaveBeenCalledTimes(1); // once per session
      expect(await getSetting('storagePersistRequested', false)).toBe(false);
      resetStoragePersistRequest(); // next app start
      await completeStep(stepId);
      expect(persist).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('milestone', () => {
  it('"Продолжить" keeps the skill active and leveling', async () => {
    const skillId = await createSkill({ ...english, milestoneTarget: 1 });
    const stepId = await createStep({ skillId, name: 'Шаг', points: 10 });
    await completeStep(stepId);
    await continueAfterMilestone(skillId);
    await completeStep(stepId);
    const d = await details(skillId);
    expect(d.skill.status).toBe('ACTIVE');
    expect(d.milestone?.decision).toBe('CONTINUE');
    expect(d.progress.totalPoints).toBe(20);
  });

  it('cannot complete a skill before the milestone', async () => {
    const skillId = await createSkill(english);
    await expect(completeSkill(skillId)).rejects.toThrow(ValidationError);
    await expect(continueAfterMilestone(skillId)).rejects.toThrow('Веха ещё не достигнута');
  });

  it('is re-evaluated when the target changes', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 10 });
    await completeStep(stepId);
    expect((await details(skillId)).milestone?.reachedAt).toBeNull();

    await updateSkill(skillId, { ...english, milestoneTarget: 1 });
    expect((await details(skillId)).milestone?.reachedAt).not.toBeNull();

    await updateSkill(skillId, { ...english, milestoneTarget: 2 });
    expect((await details(skillId)).milestone?.reachedAt).toBeNull();
  });

  it('keeps the historical reach date when the target is edited 3 → 1 → 3 (FR-MS-007)', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 10 });
    const crossing = await withClock('2026-09-10T09:00:00', async () => {
      for (let i = 0; i < 5; i++) await completeStep(stepId);
      return (await completeStep(stepId)).completionId; // 60 points: flask 3 filled
    }, 2000);
    const crossingAt = (await db.transactions.where('completionId').equals(crossing).first())!.createdAt;
    expect((await details(skillId)).milestone?.reachedAt).toBe(crossingAt);

    await withClock('2026-09-20T09:00:00', () => updateSkill(skillId, { ...english, milestoneTarget: 1 }));
    const firstFlaskAt = (await db.transactions.where('skillId').equals(skillId).sortBy('createdAt'))[0].createdAt;
    expect((await details(skillId)).milestone?.reachedAt).toBe(firstFlaskAt);

    await withClock('2026-09-21T09:00:00', () => updateSkill(skillId, { ...english, milestoneTarget: 3 }));
    expect((await details(skillId)).milestone?.reachedAt).toBe(crossingAt);
  });

  it('reports milestoneReached exactly once', async () => {
    const skillId = await createSkill({ ...english, milestoneTarget: 1 });
    const stepId = await createStep({ skillId, name: 'Шаг', points: 6 });
    expect((await completeStep(stepId)).milestoneReached).toBe(false);
    expect((await completeStep(stepId)).milestoneReached).toBe(true);
    expect((await completeStep(stepId)).milestoneReached).toBe(false);
  });
});

describe('skills', () => {
  it('validates input', async () => {
    await expect(createSkill({ ...english, name: '  ' })).rejects.toThrow(ValidationError);
    await expect(createSkill({ ...english, milestoneTarget: 0 })).rejects.toThrow(ValidationError);
    await expect(createSkill({ ...english, capacityBase: 0 })).rejects.toThrow(ValidationError);
    await expect(createSkill({ ...english, manualCapacities: [10, -1] })).rejects.toThrow(ValidationError);
    const skillId = await createSkill(english);
    await expect(createStep({ skillId, name: 'Шаг', points: 0 })).rejects.toThrow(ValidationError);
  });

  it('lists skills with their progress', async () => {
    const a = await createSkill(english);
    await createSkill({ ...english, name: 'Китайский', manualCapacities: [] });
    await completeStep(await createStep({ skillId: a, name: 'Шаг', points: 15 }));
    const summaries = await listSkillSummaries();
    expect(summaries.map((s) => [s.skill.name, s.progress.currentFlask, s.progress.pointsInCurrentFlask, s.progress.currentCapacity])).toEqual([
      ['Английский', 2, 5, 20],
      ['Китайский', 1, 0, 100],
    ]);
    expect(summaries[0].skill.originSkillId).toBeNull();
  });

  it('deletes a skill with all of its history', async () => {
    const skillId = await createSkill(english);
    await completeStep(await createStep({ skillId, name: 'Шаг', points: 5 }));
    await deleteSkill(skillId);
    expect(await getSkillDetails(skillId)).toBeNull();
    for (const table of [db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions]) {
      expect(await table.count()).toBe(0);
    }
  });
});

describe('verifyJournal', () => {
  it('reports a transaction whose completion is missing and a net mismatch', async () => {
    const skillId = await createSkill(english);
    const stepId = await createStep({ skillId, name: 'Шаг', points: 5 });
    const { completionId } = await completeStep(stepId);
    expect(await verifyJournal()).toEqual([]);

    await db.transactions.add({ id: 'orphan', skillId, completionId: 'nope', delta: 1, reason: 'CORRECTION', createdAt: 'x' });
    await db.completions.update(completionId, { pointsAwarded: 6 });
    const problems = await verifyJournal();
    expect(problems.map((p) => p.code).sort()).toEqual(['ACTIVE_NET_MISMATCH', 'ORPHAN_TRANSACTION']);

    // Restore the invariant so the harness check passes.
    await db.transactions.delete('orphan');
    await db.completions.update(completionId, { pointsAwarded: 5 });
  });
});
