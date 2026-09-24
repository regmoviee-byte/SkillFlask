// The whole history as one ordered stream of events, for the achievement replay. Built from a
// plain snapshot of the six journal tables, so the engine stays pure and deterministic.

import { buildTimeline, compareJournalOrder, type CapacityConfig, type Progress } from '../progression';
import type { LevelThreshold, Milestone, PointTransaction, Skill, StepCompletion, StepDefinition } from '../types';

export interface HistorySnapshot {
  skills: readonly Skill[];
  milestones: readonly Milestone[];
  thresholds: readonly LevelThreshold[];
  steps: readonly StepDefinition[];
  completions: readonly StepCompletion[];
  transactions: readonly PointTransaction[];
}

export type ReplayEvent =
  | { at: string; kind: 'SKILL_CREATED'; skill: Skill }
  | { at: string; kind: 'STEP_CREATED'; step: StepDefinition }
  | {
      at: string;
      kind: 'TX';
      tx: PointTransaction;
      completion: StepCompletion | undefined;
      before: Progress;
      after: Progress;
      levelChange: number;
      /**
       * A COMPLETION row of a completion that is ACTIVE in the snapshot. A completion cancelled
       * by now never counts as done (days, counts), while its + and − rows still both move the
       * flasks, so the points replay exactly as the journal says.
       */
      effective: boolean;
      /**
       * Minutes of an effective TIMED completion on its COMPLETION row: the duration it has in
       * the snapshot, corrections included (the earlier duration is not stored, so a
       * correction re-dates to the completion, like any re-interpreted history). 0 elsewhere.
       */
      minutes: number;
    }
  | { at: string; kind: 'SKILL_COMPLETED'; skill: Skill };

const KIND_ORDER: Record<ReplayEvent['kind'], number> = { SKILL_CREATED: 0, STEP_CREATED: 1, TX: 2, SKILL_COMPLETED: 3 };

function capacityOf(skill: Skill, thresholds: readonly LevelThreshold[]): CapacityConfig {
  const manual = thresholds
    .filter((t) => t.skillId === skill.id)
    .sort((a, b) => a.flaskNumber - b.flaskNumber)
    .map((t) => t.requiredPoints);
  return { base: skill.capacityBase, increment: skill.capacityIncrement, manual };
}

/**
 * Every event of the snapshot, oldest first. Journal rows keep the per-skill order of
 * buildTimeline (createdAt, id), so flask states match the skill screen. Equal timestamps
 * break by kind (a skill before its steps, steps before rows, rows before the completion of
 * the skill), then by input order — the result is the same for the same snapshot.
 */
export function buildEvents(snapshot: HistorySnapshot): ReplayEvent[] {
  const completions = new Map(snapshot.completions.map((c) => [c.id, c]));
  const events: ReplayEvent[] = [];
  for (const skill of snapshot.skills) {
    events.push({ at: skill.createdAt, kind: 'SKILL_CREATED', skill });
    const rows = snapshot.transactions.filter((t) => t.skillId === skill.id).sort(compareJournalOrder);
    const config = capacityOf(skill, snapshot.thresholds);
    for (const entry of buildTimeline(rows, config)) {
      const completion = entry.transaction.completionId ? completions.get(entry.transaction.completionId) : undefined;
      const effective = entry.transaction.reason === 'COMPLETION' && completion?.status === 'ACTIVE';
      events.push({
        at: entry.transaction.createdAt,
        kind: 'TX',
        tx: entry.transaction,
        completion,
        before: entry.before,
        after: entry.after,
        levelChange: entry.levelChange,
        effective,
        minutes: effective && completion.stepType === 'TIMED' ? (completion.durationMinutes ?? 0) : 0,
      });
    }
    if (skill.status === 'COMPLETED' && skill.completedAt) events.push({ at: skill.completedAt, kind: 'SKILL_COMPLETED', skill });
  }
  const skillIds = new Set(snapshot.skills.map((s) => s.id));
  for (const step of snapshot.steps) {
    if (skillIds.has(step.skillId)) events.push({ at: step.createdAt, kind: 'STEP_CREATED', step });
  }
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      if (a.event.at !== b.event.at) return a.event.at < b.event.at ? -1 : 1;
      return KIND_ORDER[a.event.kind] - KIND_ORDER[b.event.kind] || a.index - b.index;
    })
    .map(({ event }) => event);
}
