// The achievement engine: a pure function of the journal snapshot (principle 3.8).
//
// DATING RULE. An achievement is unlocked iff its rule holds at the end of the history, and
// `unlockedAt` is the `at` of the event at which the rule most recently became true. So:
// - a completion backdated to last Tuesday earns its achievement at the moment it was logged
//   (the journal row's createdAt), never at the completion's calendar date;
// - a correction that removes the underlying progress (a cancellation, a smaller capacity in
//   a re-interpreted history) locks the achievement again, silently, like a milestone that is
//   no longer reached (principle 3.5); earning it again dates it at the re-earn;
// - an entry added to the catalogue later is unlocked retroactively with the historical date.
// The ledger table `achievementUnlocks` only remembers what the UI has shown.
//
// Complexity: O(events × rules); every rule is a read of the replay stats (stats.ts).

import { CATALOG } from './catalog';
import { buildEvents, type HistorySnapshot } from './events';
import { applyEvent, createStats, type Stats } from './stats';
import type { AchievementDef, AchievementState } from './types';

export interface Evaluation {
  states: AchievementState[];
  /** Stats at the end of the history (ladder counters for the UI). */
  stats: Stats;
}

export function evaluateWithStats(snapshot: HistorySnapshot, catalog: readonly AchievementDef[] = CATALOG): Evaluation {
  const stats = createStats(snapshot);
  const holds = catalog.map(() => false);
  const unlockedAt: (string | null)[] = catalog.map(() => null);
  const skillIds: (string | null)[] = catalog.map(() => null);

  for (const event of buildEvents(snapshot)) {
    applyEvent(stats, event);
    catalog.forEach((def, i) => {
      const now = def.value(stats) >= def.target;
      if (now === holds[i]) return;
      holds[i] = now;
      unlockedAt[i] = now ? event.at : null;
      skillIds[i] = now ? (def.skillOf?.(stats) ?? null) : null;
    });
  }

  const states = catalog.map((def, i) => ({
    def,
    unlocked: holds[i]!,
    unlockedAt: unlockedAt[i]!,
    skillId: skillIds[i]!,
    current: Math.min(def.value(stats), def.target),
    target: def.target,
  }));
  return { states, stats };
}

/** Every catalogue entry with its state at the end of the snapshot's history. */
export function evaluateAchievements(snapshot: HistorySnapshot, catalog: readonly AchievementDef[] = CATALOG): AchievementState[] {
  return evaluateWithStats(snapshot, catalog).states;
}
