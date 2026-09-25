import { describe, expect, it } from 'vitest';
import { db } from '../data/db';
import type { PointTransaction, StepCompletion } from '../domain/types';
import { newId } from '../lib/ids';
import { verifyJournal } from '../services/journal';
import { isTransactionEvent } from '../domain/events';
import { getSkillHistory } from '../services/history';
import { getAllActivity, getSkillActivity, getSkillForecast } from '../services/insights';
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
    const history = await getSkillHistory(summary.skillIds[0], 1000);
    const dates = history!.events.filter(isTransactionEvent).map((e) => e.completion!.date);
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
  it('builds skill details, the history, the forecast and the heat maps from 5 000 transactions under 200 ms each (scaled on a loaded runner)', async () => {
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

    // One untimed warm-up (JIT, fake-indexeddb indexes), then the median of three runs: a single
    // slow outlier on a loaded CI runner does not fail it, a slow read model does.
    async function median(read: () => Promise<unknown>): Promise<number> {
      await read();
      const runs: number[] = [];
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        await read();
        runs.push(performance.now() - started);
      }
      return runs.sort((a, b) => a - b)[1]!;
    }
    const details = await getSkillDetails(skillId);
    expect(details?.progress.totalPoints).toBe(25000);
    const history = await getSkillHistory(skillId);
    expect(history?.operations).toBe(5000);
    expect(history?.events.filter(isTransactionEvent)).toHaveLength(20);
    // The budget follows the machine: both read models are bound by reading the same rows from
    // fake-indexeddb (about 70 ms of the 80 on a laptop), and a full parallel `npm test` can slow
    // that read several times over. So 200 ms, or 2.5× the plain read of the two tables when the
    // runner is loaded — it still catches a read model that does much more than read its rows once.
    const rawRead = await median(() =>
      Promise.all([db.completions.where('skillId').equals(skillId).toArray(), db.transactions.where('skillId').equals(skillId).toArray()]),
    );
    const budget = Math.max(200, rawRead * 2.5);
    expect(await median(() => getSkillDetails(skillId))).toBeLessThan(budget);
    expect(await median(() => getSkillHistory(skillId))).toBeLessThan(budget);

    // «Прогноз» and «Активность» (package 14) on the same journal, the day after its last completion.
    const today = '2025-02-05';
    const forecast = await getSkillForecast(skillId, today);
    expect(forecast?.pace.activeDays).toBe(27);
    expect((await getSkillActivity(skillId, today))?.days.size).toBe(35);
    expect((await getAllActivity(today)).days.size).toBe(35);
    expect(await median(() => getSkillForecast(skillId, today))).toBeLessThan(budget);
    expect(await median(() => getSkillActivity(skillId, today))).toBeLessThan(budget);
    expect(await median(() => getAllActivity(today))).toBeLessThan(budget);
  });
});
