// A tiny in-memory journal for pure domain tests (achievements, records, recap): the six
// tables of a HistorySnapshot, written the way the services write them.

import type { HistorySnapshot } from '../domain/achievements/events';
import type { LevelThreshold, Milestone, PointTransaction, Skill, StepCompletion, StepDefinition } from '../domain/types';

// Every write takes the next minute, so the order is explicit. Dates default to the UTC date of
// the write; the start (09:00 UTC) keeps that the local date in every zone the tests run in.
export class History {
  skills: Skill[] = [];
  milestones: Milestone[] = [];
  thresholds: LevelThreshold[] = [];
  steps: StepDefinition[] = [];
  completions: StepCompletion[] = [];
  transactions: PointTransaction[] = [];
  private t: number;
  private seq = 0;

  constructor(start = '2026-09-01T09:00:00.000Z') {
    this.t = Date.parse(start);
  }

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

  /** A TIMED completion of `minutes` at 1 point a minute (the step's type does not matter to the rules). */
  mkTimed(stepId: string, minutes: number, date?: string): StepCompletion {
    const completion = this.mkCompletion(stepId, date);
    Object.assign(completion, { stepType: 'TIMED', pointsSnapshot: 1, durationMinutes: minutes, pointsAwarded: minutes });
    this.transactions.at(-1)!.delta = minutes;
    return completion;
  }

  /** correctDuration: the new minutes and one CORRECTION row for the difference. */
  correct(completion: StepCompletion, minutes: number): string {
    const at = this.tick();
    this.mkTx(completion.skillId, completion.id, minutes - completion.pointsAwarded, 'CORRECTION', at);
    Object.assign(completion, { durationMinutes: minutes, pointsAwarded: minutes, updatedAt: at });
    return at;
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