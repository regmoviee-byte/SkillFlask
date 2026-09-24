import { describe, expect, it } from 'vitest';
import type { LevelThreshold, Milestone, PointTransaction, Skill, StepCompletion, StepDefinition } from '../types';
import { addDays } from '../../lib/dates';
import { CATALOG } from './catalog';
import { evaluateAchievements, evaluateWithStats } from './evaluate';
import type { HistorySnapshot } from './events';

// A tiny journal builder: every write takes the next minute, so the order is explicit.
class History {
  skills: Skill[] = [];
  milestones: Milestone[] = [];
  thresholds: LevelThreshold[] = [];
  steps: StepDefinition[] = [];
  completions: StepCompletion[] = [];
  transactions: PointTransaction[] = [];
  private t = Date.parse('2026-09-01T09:00:00.000Z');
  private seq = 0;

  /** The next write time (ISO); `lastAt` repeats the previous one. */
  tick(): string {
    this.t += 60_000;
    return new Date(this.t).toISOString();
  }

  get lastAt(): string {
    return new Date(this.t).toISOString();
  }

  private id(prefix: string): string {
    return `${prefix}${String(++this.seq).padStart(4, '0')}`;
  }

  mkSkill(options: { name?: string; capacity?: number; increment?: number; milestone?: number; manual?: number[] } = {}): string {
    const at = this.tick();
    const id = this.id('s');
    this.skills.push({
      id,
      name: options.name ?? id,
      description: '',
      status: 'ACTIVE',
      startLabel: '',
      targetLabel: '',
      capacityBase: options.capacity ?? 10,
      capacityIncrement: options.increment ?? 0,
      completedAt: null,
      archivedAt: null,
      originSkillId: null,
      createdAt: at,
      updatedAt: at,
    });
    this.milestones.push({
      id: this.id('m'),
      skillId: id,
      name: 'Веха',
      targetFlaskNumber: options.milestone ?? 10,
      reachedAt: null,
      decision: null,
      createdAt: at,
      updatedAt: at,
    });
    (options.manual ?? []).forEach((requiredPoints, i) => this.thresholds.push({ skillId: id, flaskNumber: i + 1, requiredPoints }));
    return id;
  }

  mkStep(skillId: string, points = 5, isActive = true): string {
    const at = this.tick();
    const id = this.id('st');
    this.steps.push({
      id,
      skillId,
      name: id,
      type: 'BOOLEAN',
      points,
      pointsPerMinute: null,
      defaultMinutes: null,
      schedule: { kind: 'MANUAL' },
      scheduleFrom: at.slice(0, 10),
      isActive,
      createdAt: at,
      updatedAt: at,
    });
    return id;
  }

  mkTx(skillId: string, completionId: string, delta: number, reason: PointTransaction['reason'], createdAt = this.tick()): PointTransaction {
    const tx = { id: this.id('t'), skillId, completionId, delta, reason, createdAt };
    this.transactions.push(tx);
    return tx;
  }

  /** A completion dated `date` (default: the write day) logged at `createdAt` (default: the next minute). */
  mkCompletion(stepId: string, date?: string, createdAt = this.tick()): StepCompletion {
    const step = this.steps.find((s) => s.id === stepId)!;
    const completion: StepCompletion = {
      id: this.id('c'),
      skillId: step.skillId,
      stepId,
      stepName: step.name,
      stepType: 'BOOLEAN',
      pointsSnapshot: step.points,
      durationMinutes: null,
      pointsAwarded: step.points,
      date: date ?? createdAt.slice(0, 10),
      source: 'MANUAL',
      status: 'ACTIVE',
      cancelledAt: null,
      note: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.completions.push(completion);
    this.mkTx(step.skillId, completion.id, step.points, 'COMPLETION', createdAt);
    return completion;
  }

  cancel(completion: StepCompletion): string {
    const at = this.tick();
    completion.status = 'CANCELLED';
    completion.cancelledAt = at;
    this.mkTx(completion.skillId, completion.id, -completion.pointsAwarded, 'CANCELLATION', at);
    return at;
  }

  completeSkill(skillId: string): string {
    const at = this.tick();
    Object.assign(this.skills.find((s) => s.id === skillId)!, { status: 'COMPLETED', completedAt: at });
    return at;
  }

  snapshot(): HistorySnapshot {
    return structuredClone({
      skills: this.skills,
      milestones: this.milestones,
      thresholds: this.thresholds,
      steps: this.steps,
      completions: this.completions,
      transactions: this.transactions,
    });
  }
}

const stateOf = (snapshot: HistorySnapshot, id: string) => {
  const state = evaluateAchievements(snapshot).find((s) => s.def.id === id);
  if (!state) throw new Error(`no achievement ${id}`);
  return state;
};
const unlockedIds = (snapshot: HistorySnapshot) => evaluateAchievements(snapshot).filter((s) => s.unlocked).map((s) => s.def.id);

describe('evaluateAchievements — dating and revocation', () => {
  it('dates «Первое действие» at the completion createdAt and credits its skill', () => {
    const h = new History();
    const skill = h.mkSkill();
    const step = h.mkStep(skill);
    expect(stateOf(h.snapshot(), 'first-step')).toMatchObject({ unlocked: false, unlockedAt: null, current: 0, target: 1 });
    const c = h.mkCompletion(step);
    h.mkCompletion(step);
    expect(stateOf(h.snapshot(), 'first-step')).toMatchObject({ unlocked: true, unlockedAt: c.createdAt, skillId: skill, current: 1 });
  });

  it('dates a backdated completion at the moment it was logged, not its calendar date', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill());
    const c = h.mkCompletion(step, '2026-08-11', '2026-09-10T18:30:00.000Z');
    expect(c.date).toBe('2026-08-11');
    expect(stateOf(h.snapshot(), 'first-step').unlockedAt).toBe('2026-09-10T18:30:00.000Z');
  });

  it('locks «Первое действие» again when its only completion is cancelled', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill());
    const c = h.mkCompletion(step);
    expect(stateOf(h.snapshot(), 'first-step').unlocked).toBe(true);
    h.cancel(c);
    expect(stateOf(h.snapshot(), 'first-step')).toMatchObject({ unlocked: false, unlockedAt: null, skillId: null, current: 0 });
    // A new completion earns it again, dated at the re-earn.
    const again = h.mkCompletion(step);
    expect(stateOf(h.snapshot(), 'first-step').unlockedAt).toBe(again.createdAt);
  });

  it('moves the date to the next completion when the earliest one is cancelled later', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill());
    const first = h.mkCompletion(step);
    const second = h.mkCompletion(step);
    h.cancel(first);
    expect(stateOf(h.snapshot(), 'first-step').unlockedAt).toBe(second.createdAt);
  });

  it('locks «Колбы · 5» after a negative row drops below five and re-dates the re-earn', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 10 }), 10);
    const done = Array.from({ length: 5 }, () => h.mkCompletion(step));
    expect(stateOf(h.snapshot(), 'flasks-5')).toMatchObject({ unlocked: true, unlockedAt: done[4]!.createdAt });
    h.cancel(done[2]!);
    expect(stateOf(h.snapshot(), 'flasks-5')).toMatchObject({ unlocked: false, unlockedAt: null, current: 4 });
    const again = h.mkCompletion(step);
    expect(stateOf(h.snapshot(), 'flasks-5')).toMatchObject({ unlocked: true, unlockedAt: again.createdAt, current: 5 });
  });

  it('is deterministic', () => {
    const h = new History();
    const a = h.mkSkill();
    const b = h.mkSkill();
    const sa = h.mkStep(a, 7);
    const sb = h.mkStep(b, 12);
    for (let i = 0; i < 12; i++) h.mkCompletion(i % 3 ? sa : sb, addDays('2026-09-01', i % 5));
    const snapshot = h.snapshot();
    expect(evaluateAchievements(snapshot)).toEqual(evaluateAchievements(snapshot));
    expect(evaluateAchievements(structuredClone(snapshot))).toEqual(evaluateAchievements(snapshot));
  });

  it('re-evaluates the «Колбы» ladder when the capacities differ (a capacity edit)', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 20 });
    const step = h.mkStep(skill, 10);
    for (let i = 0; i < 5; i++) h.mkCompletion(step);
    expect(stateOf(h.snapshot(), 'flasks-5')).toMatchObject({ unlocked: false, current: 2 });
    // The same journal read with smaller flasks: five flasks, the date of the fifth row.
    h.skills[0]!.capacityBase = 10;
    expect(stateOf(h.snapshot(), 'flasks-5')).toMatchObject({ unlocked: true, unlockedAt: h.transactions[4]!.createdAt });
    // Manual thresholds win over the formula.
    h.thresholds.push({ skillId: skill, flaskNumber: 1, requiredPoints: 50 });
    expect(stateOf(h.snapshot(), 'flasks-5')).toMatchObject({ unlocked: false, current: 1 });
  });

  it('keeps every state inside [0, target] and unlocked iff dated', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill());
    for (let i = 0; i < 30; i++) h.mkCompletion(step);
    for (const state of evaluateAchievements(h.snapshot())) {
      expect(state.current).toBeGreaterThanOrEqual(0);
      expect(state.current).toBeLessThanOrEqual(state.target);
      expect(state.unlocked).toBe(state.unlockedAt !== null);
      expect(state.target).toBe(state.def.target);
    }
    expect(evaluateAchievements(h.snapshot())).toHaveLength(CATALOG.length);
  });
});

describe('evaluateAchievements — one positive case per ladder', () => {
  it('Действия: counts effective completions', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }));
    const done = Array.from({ length: 10 }, () => h.mkCompletion(step, '2026-09-01'));
    expect(stateOf(h.snapshot(), 'actions-10')).toMatchObject({ unlocked: true, unlockedAt: done[9]!.createdAt });
    expect(stateOf(h.snapshot(), 'actions-50')).toMatchObject({ unlocked: false, current: 10 });
  });

  it('Дни с практикой: distinct dates, not necessarily in a row', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }));
    for (const date of ['2026-09-01', '2026-09-01', '2026-09-05', '2026-09-09']) h.mkCompletion(step, date);
    expect(evaluateWithStats(h.snapshot()).stats.global.activeDays).toBe(3);
    expect(stateOf(h.snapshot(), 'days-3').unlocked).toBe(true);
  });

  it('Недели в ритме: a week with three days of practice, weeks need not be consecutive', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }));
    for (const date of ['2026-08-31', '2026-09-02', '2026-09-06', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']) h.mkCompletion(step, date);
    const { stats } = evaluateWithStats(h.snapshot());
    expect(stats.global.rhythmWeeks).toBe(2);
    expect(stateOf(h.snapshot(), 'weeks-1').unlocked).toBe(true);
    expect(stateOf(h.snapshot(), 'weeks-4').current).toBe(2);
  });

  it('Лучшая серия: the record stays after a gap', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }));
    for (const date of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10']) h.mkCompletion(step, date);
    expect(stateOf(h.snapshot(), 'series-3')).toMatchObject({ unlocked: true, current: 3 });
    // A backdated day that joins two runs raises the record.
    for (const date of ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']) h.mkCompletion(step, date);
    expect(stateOf(h.snapshot(), 'series-7').unlocked).toBe(true);
  });

  it('Колбы: filled flasks of every skill together', () => {
    const h = new History();
    const a = h.mkStep(h.mkSkill({ capacity: 10 }), 10);
    const b = h.mkStep(h.mkSkill({ capacity: 10 }), 30);
    h.mkCompletion(a);
    h.mkCompletion(a);
    const last = h.mkCompletion(b);
    expect(stateOf(h.snapshot(), 'flasks-5')).toMatchObject({ unlocked: true, unlockedAt: last.createdAt });
  });

  it('Вехи: skills at or above their milestone', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 10, milestone: 1 });
    const c = h.mkCompletion(h.mkStep(skill, 10));
    expect(stateOf(h.snapshot(), 'milestones-1')).toMatchObject({ unlocked: true, unlockedAt: c.createdAt });
  });

  it('Навыки достигнуты: completed skills, dated at completion', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 10, milestone: 1 });
    h.mkCompletion(h.mkStep(skill, 10));
    const at = h.completeSkill(skill);
    expect(stateOf(h.snapshot(), 'completed-1')).toMatchObject({ unlocked: true, unlockedAt: at });
  });
});

describe('evaluateAchievements — one positive case per badge', () => {
  it('Первый навык', () => {
    const h = new History();
    const skill = h.mkSkill();
    expect(stateOf(h.snapshot(), 'first-skill')).toMatchObject({ unlocked: true, unlockedAt: h.skills[0]!.createdAt, skillId: skill });
  });

  it('Первая колба: credited to the skill whose first flask filled earliest', () => {
    const h = new History();
    const a = h.mkSkill({ capacity: 10 });
    const b = h.mkSkill({ capacity: 10 });
    const sa = h.mkStep(a, 5);
    const sb = h.mkStep(b, 10);
    h.mkCompletion(sa);
    const fill = h.mkCompletion(sb);
    h.mkCompletion(sa);
    expect(stateOf(h.snapshot(), 'first-flask')).toMatchObject({ unlocked: true, unlockedAt: fill.createdAt, skillId: b });
  });

  it('Набор инструментов: three steps still on the list of one skill', () => {
    const h = new History();
    const skill = h.mkSkill();
    h.mkStep(skill);
    h.mkStep(skill, 5, false); // hidden later: does not count
    h.mkStep(skill);
    expect(stateOf(h.snapshot(), 'toolbox')).toMatchObject({ unlocked: false, current: 2 });
    const third = h.mkStep(skill);
    expect(stateOf(h.snapshot(), 'toolbox')).toMatchObject({ unlocked: true, skillId: skill, unlockedAt: h.steps.find((s) => s.id === third)!.createdAt });
  });

  it('Два фронта: two skills on one date', () => {
    const h = new History();
    const a = h.mkStep(h.mkSkill());
    const b = h.mkStep(h.mkSkill());
    h.mkCompletion(a, '2026-09-01');
    h.mkCompletion(b, '2026-09-02');
    expect(stateOf(h.snapshot(), 'two-fronts').unlocked).toBe(false);
    h.mkCompletion(a, '2026-09-02');
    expect(stateOf(h.snapshot(), 'two-fronts').unlocked).toBe(true);
  });

  it('Многоборье: three different steps of one skill on one date', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 1000 });
    const steps = [h.mkStep(skill), h.mkStep(skill), h.mkStep(skill)];
    h.mkCompletion(steps[0]!, '2026-09-01');
    h.mkCompletion(steps[0]!, '2026-09-01');
    h.mkCompletion(steps[1]!, '2026-09-01');
    expect(stateOf(h.snapshot(), 'multi').current).toBe(2);
    h.mkCompletion(steps[2]!, '2026-09-01');
    expect(stateOf(h.snapshot(), 'multi')).toMatchObject({ unlocked: true, skillId: skill });
  });

  it('Три направления: a filled flask in three skills', () => {
    const h = new History();
    for (let i = 0; i < 3; i++) h.mkCompletion(h.mkStep(h.mkSkill({ capacity: 10 }), 10));
    expect(stateOf(h.snapshot(), 'three-dirs').unlocked).toBe(true);
  });

  it('Двойное дно: one completion fills two flasks', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 10 });
    h.mkCompletion(h.mkStep(skill, 25));
    expect(stateOf(h.snapshot(), 'double')).toMatchObject({ unlocked: true, skillId: skill });
    // Twenty-five points fill two flasks and leave five: not to the brim.
    expect(stateOf(h.snapshot(), 'exact').unlocked).toBe(false);
  });

  it('Ювелирно: a flask filled to the brim', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 10 }), 4);
    h.mkCompletion(step);
    h.mkCompletion(step);
    expect(stateOf(h.snapshot(), 'exact').unlocked).toBe(false);
    const fill = h.mkCompletion(h.mkStep(h.skills[0]!.id, 2));
    expect(stateOf(h.snapshot(), 'exact')).toMatchObject({ unlocked: true, unlockedAt: fill.createdAt });
  });

  it('Дальше цели: one more flask after the milestone', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 10, milestone: 2 }), 10);
    h.mkCompletion(step);
    h.mkCompletion(step);
    expect(stateOf(h.snapshot(), 'beyond').unlocked).toBe(false);
    h.mkCompletion(step);
    expect(stateOf(h.snapshot(), 'beyond').unlocked).toBe(true);
  });

  it('Большой день: five completions with one date', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 1000 }));
    for (let i = 0; i < 4; i++) h.mkCompletion(step, '2026-09-01');
    h.mkCompletion(step, '2026-09-02');
    expect(stateOf(h.snapshot(), 'big-day').current).toBe(4);
    h.mkCompletion(step, '2026-09-01');
    expect(stateOf(h.snapshot(), 'big-day').unlocked).toBe(true);
  });

  it('cancelled completions count for nothing but their rows still move the flasks', () => {
    const h = new History();
    const step = h.mkStep(h.mkSkill({ capacity: 10 }), 10);
    const c = h.mkCompletion(step, '2026-09-01');
    h.cancel(c);
    const ids = unlockedIds(h.snapshot());
    expect(ids).toEqual(['first-skill']);
    // The flask filled and emptied again: nothing about flasks stays unlocked.
    expect(evaluateWithStats(h.snapshot()).stats.global).toMatchObject({ completions: 0, activeDays: 0, totalCompletedFlasks: 0 });
  });
});

describe('evaluateAchievements — scale', () => {
  it('replays 5 000 completions quickly', () => {
    const h = new History();
    const skill = h.mkSkill({ capacity: 100, increment: 50 });
    const steps = [h.mkStep(skill, 5), h.mkStep(skill, 3), h.mkStep(skill, 8)];
    for (let i = 0; i < 5000; i++) h.mkCompletion(steps[i % 3]!, addDays('2024-01-01', Math.floor(i / 4)));
    const snapshot = h.snapshot();
    evaluateAchievements(snapshot);
    const started = performance.now();
    const states = evaluateAchievements(snapshot);
    // About 30 ms on a laptop; the bound leaves room for a loaded CI runner.
    expect(performance.now() - started).toBeLessThan(150);
    expect(states.find((s) => s.def.id === 'actions-1000')!.unlocked).toBe(true);
    expect(states.find((s) => s.def.id === 'days-365')!.unlocked).toBe(true);
    expect(states.find((s) => s.def.id === 'series-30')!.unlocked).toBe(true);
    expect(states.find((s) => s.def.id === 'weeks-52')!.unlocked).toBe(true);
  });
});
