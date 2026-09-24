import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../data/fixtures/backup-v1.json';
import { db } from '../data/db';
import { exportBackup, importBackup, migrateBackup, wipeAllData } from '../data/backup';
import { setClock } from '../lib/clock';
import { nowIso } from '../lib/dates';
import type { AchievementState } from '../domain/achievements/types';
import type { PointTransaction, StepCompletion } from '../domain/types';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import {
  achievementTables,
  filterStillUnlocked,
  getAchievementsView,
  getHomeAchievementLine,
  markAchievementsSeen,
  markCelebrated,
  onAchievementsEarned,
  resetAchievementCache,
  syncAchievements,
  syncAchievementsOnStart,
} from './achievements';
import { cancelCompletion, completeStep, correctDuration, restoreCompletion } from './completions';
import { restartSkill } from './lifecycle';
import { getHomeView } from './queries';
import { completeSkill, createSkill, deleteSkill, updateSkill, type SkillInput } from './skills';
import { createStep, setStepActive } from './steps';

installFreshDb();
beforeEach(() => {
  setClock(tickingClock(todayNoon()));
  resetAchievementCache();
});

const input = (over: Partial<SkillInput> = {}): SkillInput => ({
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Достичь C1',
  milestoneTarget: 2,
  capacityBase: 10,
  capacityIncrement: 0,
  manualCapacities: [],
  ...over,
});

const ids = (states: readonly AchievementState[]) => states.map((s) => s.def.id);

/** What non-journal writes published after their commit, in order. */
let published: string[] = [];
let offPublished: () => void = () => {};
beforeEach(() => {
  published = [];
  offPublished = onAchievementsEarned((states) => published.push(...ids(states)));
});
afterEach(() => offPublished());

describe('syncAchievements inside the writes', () => {
  it('returns «Первое действие» from completeStep exactly once, dated at the completion', async () => {
    const skillId = await createSkill(input());
    const stepId = await createStep({ skillId, name: 'Разговор', points: 2 });
    const first = await completeStep(stepId);
    expect(ids(first.achievements)).toEqual(['first-step']);
    const completion = await db.completions.get(first.completionId);
    expect(first.achievements[0]).toMatchObject({ unlocked: true, unlockedAt: completion!.createdAt, skillId });
    expect(await db.achievementUnlocks.get('first-step')).toMatchObject({ unlockedAt: completion!.createdAt, celebratedAt: null, seenAt: null });
    const second = await completeStep(stepId);
    expect(second.achievements).toEqual([]);
  });

  it('publishes what a write without a MutationResult earned: a skill, a third step, a completed skill', async () => {
    const skillId = await createSkill(input({ milestoneTarget: 1 }));
    expect(published).toEqual(['first-skill']);
    const a = await createStep({ skillId, name: 'А', points: 10 });
    await createStep({ skillId, name: 'Б', points: 1 });
    expect(published).toEqual(['first-skill']);
    await createStep({ skillId, name: 'В', points: 1 });
    expect(published).toEqual(['first-skill', 'toolbox']);
    const result = await completeStep(a);
    // One completion of 10 into a flask of 10: first action, first flask filled to the brim,
    // the milestone — returned, not published.
    expect(ids(result.achievements).sort()).toEqual(['exact', 'first-flask', 'first-step', 'milestones-1']);
    expect(published).toEqual(['first-skill', 'toolbox']);
    await completeSkill(skillId);
    expect(published).toEqual(['first-skill', 'toolbox', 'completed-1']);
  });

  it('locks again silently on cancel (the ledger row goes) and celebrates a re-earn with a new date', async () => {
    const skillId = await createSkill(input());
    const stepId = await createStep({ skillId, name: 'Разговор', points: 2 });
    const done = await completeStep(stepId);
    await markCelebrated(['first-step'], nowIso());
    expect(await filterStillUnlocked(done.achievements)).toHaveLength(1);
    const cancelled = await cancelCompletion(done.completionId);
    expect(cancelled.achievements).toEqual([]);
    expect(await db.achievementUnlocks.get('first-step')).toBeUndefined();
    // A card still waiting for it is dropped.
    expect(await filterStillUnlocked(done.achievements)).toEqual([]);
    const again = await completeStep(stepId);
    expect(ids(again.achievements)).toEqual(['first-step']);
    const row = await db.achievementUnlocks.get('first-step');
    expect(row).toMatchObject({ celebratedAt: null, unlockedAt: (await db.completions.get(again.completionId))!.createdAt });
    expect(row!.unlockedAt > done.achievements[0]!.unlockedAt!).toBe(true);
  });

  it('files a completion brought back by «Вернуть» quietly, with its original date', async () => {
    const skillId = await createSkill(input());
    const stepId = await createStep({ skillId, name: 'Разговор', points: 2 });
    const done = await completeStep(stepId);
    await cancelCompletion(done.completionId);
    const restored = await restoreCompletion(done.completionId);
    expect(restored.achievements).toEqual([]);
    expect(await db.achievementUnlocks.get('first-step')).toMatchObject({ unlockedAt: done.achievements[0]!.unlockedAt });
  });

  it('re-evaluates the «Колбы» ladder when updateSkill changes the capacities, quietly', async () => {
    const skillId = await createSkill(input({ capacityBase: 20, milestoneTarget: 50 }));
    const stepId = await createStep({ skillId, name: 'Разговор', points: 10 });
    for (let i = 0; i < 5; i++) await completeStep(stepId);
    expect(await db.achievementUnlocks.get('flasks-5')).toBeUndefined();
    await updateSkill(skillId, input({ capacityBase: 10, milestoneTarget: 50 }));
    // Five flasks now, dated at the fifth completion: an old date, so nothing is celebrated.
    const rows = await db.transactions.orderBy('createdAt').toArray();
    expect(await db.achievementUnlocks.get('flasks-5')).toMatchObject({ unlockedAt: rows[4]!.createdAt, seenAt: null });
    expect(published).toEqual(['first-skill']);
    // Back to bigger flasks: locked again.
    await updateSkill(skillId, input({ capacityBase: 20, milestoneTarget: 50 }));
    expect(await db.achievementUnlocks.get('flasks-5')).toBeUndefined();
  });

  it('locks «Набор инструментов» when a step leaves the list', async () => {
    const skillId = await createSkill(input());
    const steps = [];
    for (const name of ['А', 'Б', 'В']) steps.push(await createStep({ skillId, name, points: 1 }));
    expect(await db.achievementUnlocks.get('toolbox')).toBeTruthy();
    await setStepActive(steps[1]!, false);
    expect(await db.achievementUnlocks.get('toolbox')).toBeUndefined();
    // Back on the list: unlocked again at the old creation date, so quietly.
    await setStepActive(steps[1]!, true);
    expect(await db.achievementUnlocks.get('toolbox')).toMatchObject({ unlockedAt: (await db.steps.get(steps[2]!))!.createdAt });
    expect(published).toEqual(['first-skill', 'toolbox']);
  });

  it('keeps «Навыки достигнуты» after «Начать заново» and deletes rows of a deleted skill', async () => {
    const skillId = await createSkill(input({ milestoneTarget: 1 }));
    await completeStep(await createStep({ skillId, name: 'А', points: 10 }));
    await completeSkill(skillId);
    const copy = await restartSkill(skillId);
    expect(await db.achievementUnlocks.get('completed-1')).toBeTruthy();
    await deleteSkill(skillId);
    // The completed skill and its history are gone: so is what only it held.
    expect(await db.achievementUnlocks.get('completed-1')).toBeUndefined();
    expect(await db.achievementUnlocks.get('first-step')).toBeUndefined();
    expect(await db.achievementUnlocks.get('first-skill')).toMatchObject({ skillId: copy });
  });
});

describe('app start', () => {
  it('celebrates nothing and is idempotent, also when StrictMode runs it twice at once', async () => {
    const skillId = await createSkill(input());
    const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
    await completeStep(stepId);
    await completeStep(stepId);
    // A catalogue entry «appears»: its row is missing, as after an app update.
    await db.achievementUnlocks.delete('first-flask');
    const before = await db.achievementUnlocks.count();

    const result = await db.transaction('rw', achievementTables(), () => syncAchievements(nowIso()));
    expect(result.earnedNow).toEqual([]);
    expect(ids(result.appearedQuietly)).toEqual(['first-flask']);
    expect(await db.achievementUnlocks.get('first-flask')).toMatchObject({ celebratedAt: null, seenAt: null });

    await Promise.all([syncAchievementsOnStart(), syncAchievementsOnStart()]);
    expect(await db.achievementUnlocks.count()).toBe(before + 1);
    const again = await db.transaction('rw', achievementTables(), () => syncAchievements(nowIso()));
    expect(again).toEqual({ earnedNow: [], appearedQuietly: [] });
  });
});

describe('timed practice', () => {
  it('earns «Часы практики · 1» and «Марафон» from minutes, and «Марафон» again from a correction', async () => {
    const skillId = await createSkill(input({ capacityBase: 1000 }));
    const stepId = await createStep({ skillId, name: 'Практика', type: 'TIMED', pointsPerMinute: 0.5 });
    const first = await completeStep(stepId, { minutes: 45 });
    expect(ids(first.achievements)).not.toContain('marathon');
    const second = await completeStep(stepId, { minutes: 20 });
    expect(ids(second.achievements)).toContain('hours-1');
    // A correction that makes one completion an hour long re-dates to that completion: it is
    // filed quietly (the tab's dot), not celebrated as news of the correction.
    const corrected = await correctDuration(first.completionId, 60);
    expect(corrected.achievements).toEqual([]);
    const completedAt = (await db.completions.get(first.completionId))!.createdAt;
    expect(await db.achievementUnlocks.get('marathon')).toMatchObject({ unlockedAt: completedAt, celebratedAt: null, seenAt: null });
    await cancelCompletion(first.completionId);
    expect(await db.achievementUnlocks.get('marathon')).toBeUndefined();
    expect(await db.achievementUnlocks.get('hours-1')).toBeUndefined();
  });

  it('files them quietly at start for a history recorded before the catalogue knew them', async () => {
    const skillId = await createSkill(input({ capacityBase: 1000 }));
    const stepId = await createStep({ skillId, name: 'Практика', type: 'TIMED', pointsPerMinute: 1 });
    const { completionId } = await completeStep(stepId, { minutes: 90 });
    // As after an app update that added the entries: their rows are missing.
    await db.achievementUnlocks.bulkDelete(['hours-1', 'marathon']);
    resetAchievementCache();
    await syncAchievementsOnStart();
    const createdAt = (await db.completions.get(completionId))!.createdAt;
    expect(await db.achievementUnlocks.get('hours-1')).toMatchObject({ unlockedAt: createdAt, celebratedAt: null, seenAt: null });
    expect(await db.achievementUnlocks.get('marathon')).toMatchObject({ unlockedAt: createdAt, skillId });
  });
});

describe('backup', () => {
  it('keeps the ledger with celebratedAt through export and import, so nothing replays', async () => {
    const skillId = await createSkill(input());
    const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
    await completeStep(stepId);
    await completeStep(stepId);
    await markCelebrated(['first-step', 'first-skill'], nowIso());
    await markAchievementsSeen(nowIso());
    const file = await exportBackup();
    const rows = await db.achievementUnlocks.orderBy('id').toArray();
    expect(rows.length).toBeGreaterThan(2);

    await wipeAllData();
    expect(await db.achievementUnlocks.count()).toBe(0);
    await importBackup(migrateBackup(JSON.parse(JSON.stringify(file))));
    expect(await db.achievementUnlocks.orderBy('id').toArray()).toEqual(rows);
  });

  it('files the unlocks of an old file without a ledger quietly, as celebrated and seen', async () => {
    await importBackup(migrateBackup(fixture));
    const rows = await db.achievementUnlocks.toArray();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.celebratedAt !== null && row.seenAt !== null)).toBe(true);
    // The dates come from the file's own history, not from the import.
    const first = (await db.transactions.orderBy('createdAt').first())!;
    expect(rows.find((row) => row.id === 'first-step')).toMatchObject({ unlockedAt: first.createdAt });
    // The first write after the restore celebrates only what it earns itself.
    const step = (await db.steps.toArray()).find((s) => s.isActive)!;
    expect((await db.skills.get(step.skillId))!.status).toBe('ACTIVE');
    const result = await completeStep(step.id);
    const createdAt = (await db.completions.get(result.completionId))!.createdAt;
    expect(result.achievements.every((s) => s.unlockedAt === createdAt)).toBe(true);
  });
});

describe('read models', () => {
  it('builds the tab: 8 ladders, 12 badges, 49 in total, the last unlock and the unseen count', async () => {
    const skillId = await createSkill(input());
    const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
    for (let i = 0; i < 3; i++) await completeStep(stepId);
    const view = await getAchievementsView();
    expect(view.ladders.map((l) => l.def.id)).toEqual(['actions', 'days', 'weeks', 'series', 'hours', 'flasks', 'milestones', 'completed']);
    expect(view.badges).toHaveLength(12);
    expect(view.total).toBe(49);
    expect(view.unlockedCount).toBe(4); // first skill, first action, first flask, to the brim (10 of 10)
    expect(view.lastUnlocked?.def.id).toBe('first-flask');
    expect(view.skillNames[skillId]).toBe('Английский');
    expect(view.unseenCount).toBe(4);
    const actions = view.ladders[0]!;
    expect(actions).toMatchObject({ current: 3, tierIndex: -1, next: { target: 10, remaining: 7 } });
    expect(actions.tiers.map((t) => t.def.id)).toEqual(['actions-10', 'actions-50', 'actions-100', 'actions-250', 'actions-500', 'actions-1000']);
    await markAchievementsSeen(nowIso());
    expect((await getAchievementsView()).unseenCount).toBe(0);
  });

  it('names the last unlock and the closest next one for the home tile', async () => {
    expect(await getHomeAchievementLine()).toMatchObject({ last: null });
    const skillId = await createSkill(input({ capacityBase: 100 }));
    const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
    for (let i = 0; i < 4; i++) await completeStep(stepId);
    const line = await getHomeAchievementLine();
    expect(line.last?.def.id).toBe('first-step');
    // 4 of 5 in one day beats 4 of 10 actions and 1 of 3 days.
    expect(line.next).toMatchObject({ current: 4, target: 5 });
    expect(line.next?.def.id).toBe('big-day');
    expect((await getHomeView()).achievements).toEqual(line);
  });

  it('re-reads the journal only when it changed', async () => {
    const skillId = await createSkill(input());
    await completeStep(await createStep({ skillId, name: 'Разговор', points: 5 }));
    const a = await getAchievementsView();
    const b = await getAchievementsView();
    expect(b.badges[0]).toBe(a.badges[0]); // the same cached evaluation
    await completeStep((await db.steps.toArray())[0]!.id);
    const c = await getAchievementsView();
    expect(c.badges[0]).not.toBe(a.badges[0]);
    expect(c.ladders[0]!.current).toBe(2);
  });
});

describe('scale', () => {
  it('syncs a history of 3 000 completions within a write budget', async () => {
    const skillId = await createSkill(input({ capacityBase: 100, capacityIncrement: 50, milestoneTarget: 100 }));
    const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
    const step = (await db.steps.get(stepId))!;
    const completions: StepCompletion[] = [];
    const transactions: PointTransaction[] = [];
    for (let i = 0; i < 3000; i++) {
      const createdAt = new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString();
      const id = `c${String(i).padStart(5, '0')}`;
      completions.push({
        id,
        skillId,
        stepId,
        stepName: step.name,
        stepType: step.type,
        pointsSnapshot: 5,
        durationMinutes: null,
        pointsAwarded: 5,
        date: createdAt.slice(0, 10),
        source: 'MANUAL',
        status: 'ACTIVE',
        cancelledAt: null,
        note: null,
        createdAt,
        updatedAt: createdAt,
      });
      transactions.push({ id: `t${String(i).padStart(5, '0')}`, skillId, completionId: id, delta: 5, reason: 'COMPLETION', createdAt });
    }
    await db.transaction('rw', [db.completions, db.transactions], async () => {
      await db.completions.bulkAdd(completions);
      await db.transactions.bulkAdd(transactions);
    });
    await completeStep(stepId); // warm-up
    const started = performance.now();
    const result = await completeStep(stepId);
    // fake-indexeddb is several times slower than a real IndexedDB; this bounds the regression.
    expect(performance.now() - started).toBeLessThan(600); // about 100 ms here
    expect(result.achievements).toEqual([]);
    expect(await db.achievementUnlocks.get('actions-1000')).toBeTruthy();
  });
});
