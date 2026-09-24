import { describe, expect, it } from 'vitest';
import { db } from '../data/db';
import type { PointTransaction, StepCompletion } from '../domain/types';
import { newId } from '../lib/ids';
import { verifyJournal } from '../services/journal';
import { getSkillDetails, listSkillSummaries } from '../services/queries';
import { createSkill, createStep } from '../services/skills';
import { installFreshDb } from '../test/harness';
import { seedDemoData } from './seed';

installFreshDb();

describe('seedDemoData', () => {
  it('creates a deterministic, valid journal through the real services', async () => {
    const summary = await seedDemoData({ days: 20, seed: 7 });
    expect(summary.skillIds).toHaveLength(3);
    expect(summary.stepIds).toHaveLength(7);
    expect(summary.completions).toBeGreaterThan(5);
    expect(await db.transactions.count()).toBe(summary.completions);
    expect(await verifyJournal()).toEqual([]);

    const names = (await listSkillSummaries()).map((s) => s.skill.name);
    expect(names).toEqual(['Английский', 'Тренировки', 'Автотесты']);

    const english = await getSkillDetails(summary.skillIds[0]);
    expect(english?.milestone?.targetFlaskNumber).toBe(10);
    // Timestamps are backdated, so history spans the seeded period.
    const dates = english!.history.map((h) => h.completion!.date);
    expect(new Set(dates).size).toBeGreaterThan(1);
  });

  it('produces the same journal for the same seed', async () => {
    const first = await seedDemoData({ days: 15, seed: 3 });
    const journal = async () => (await db.transactions.orderBy('createdAt').toArray()).map((t) => `${t.createdAt}:${t.delta}`);
    const firstJournal = await journal();
    await db.completions.clear();
    await db.transactions.clear();
    await db.steps.clear();
    await db.milestones.clear();
    await db.skills.clear();
    await db.levelThresholds.clear();
    const second = await seedDemoData({ days: 15, seed: 3 });
    expect(second.completions).toBe(first.completions);
    expect(await journal()).toEqual(firstJournal);
  });
});

describe('read-model performance', () => {
  it('builds skill details from 5 000 transactions under 200 ms', async () => {
    const skillId = await createSkill({
      name: 'Нагрузка',
      description: '',
      startLabel: '',
      targetLabel: '',
      milestoneName: 'Цель',
      milestoneTarget: 10,
      capacityBase: 100,
      capacityIncrement: 50,
      manualCapacities: [],
    });
    const stepId = await createStep({ skillId, name: 'Шаг', points: 5 });
    const step = (await db.steps.get(stepId))!;
    const completions: StepCompletion[] = [];
    const transactions: PointTransaction[] = [];
    for (let i = 0; i < 5000; i++) {
      const createdAt = new Date(Date.UTC(2025, 0, 1) + i * 600_000).toISOString();
      const id = newId();
      completions.push({
        id,
        skillId,
        stepId,
        stepName: step.name,
        stepType: step.type,
        pointsSnapshot: step.points,
        durationMinutes: null,
        pointsAwarded: step.points,
        date: createdAt.slice(0, 10),
        source: 'MANUAL',
        status: 'ACTIVE',
        cancelledAt: null,
        note: null,
        createdAt,
        updatedAt: createdAt,
      });
      transactions.push({ id: newId(), skillId, completionId: id, delta: step.points, reason: 'COMPLETION', createdAt });
    }
    await db.transaction('rw', [db.completions, db.transactions], async () => {
      await db.completions.bulkAdd(completions);
      await db.transactions.bulkAdd(transactions);
    });

    // Best of three: fake-indexeddb timing jitters on a loaded CI runner, the read model does not.
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const details = await getSkillDetails(skillId);
      best = Math.min(best, performance.now() - started);
      expect(details?.history).toHaveLength(5000);
      expect(details?.progress.totalPoints).toBe(25000);
    }
    expect(best).toBeLessThan(200);
  });
});
