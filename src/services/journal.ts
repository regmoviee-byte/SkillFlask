import { db } from '../data/db';
import { fromDeci, toDeci } from '../domain/points';

export interface JournalProblem {
  code:
    | 'ORPHAN_TRANSACTION'
    | 'UNKNOWN_SKILL'
    | 'INVALID_DELTA'
    | 'ACTIVE_NET_MISMATCH'
    | 'CANCELLED_NET_NONZERO'
    | 'COMPLETION_WITHOUT_TRANSACTION';
  /** Id of the offending transaction or completion. */
  id: string;
  message: string;
}

/**
 * Read-only consistency check of the points journal (principle 3.8, FR-CP-007):
 * every transaction points at an existing skill and completion, deltas are numbers, and
 * per completion the net of its transactions equals `pointsAwarded` while ACTIVE and 0 when
 * CANCELLED. Returns an empty list for a clean journal.
 */
export async function verifyJournal(): Promise<JournalProblem[]> {
  return db.transaction('r', [db.skills, db.completions, db.transactions], async () => {
    const [skills, completions, transactions] = await Promise.all([
      db.skills.toArray(),
      db.completions.toArray(),
      db.transactions.toArray(),
    ]);
    const skillIds = new Set(skills.map((s) => s.id));
    const completionById = new Map(completions.map((c) => [c.id, c]));
    const netDeci = new Map<string, number>();
    const problems: JournalProblem[] = [];

    for (const t of transactions) {
      if (typeof t.delta !== 'number' || !Number.isFinite(t.delta)) {
        problems.push({ code: 'INVALID_DELTA', id: t.id, message: `Transaction ${t.id} has delta ${String(t.delta)}` });
        continue;
      }
      if (!skillIds.has(t.skillId)) {
        problems.push({ code: 'UNKNOWN_SKILL', id: t.id, message: `Transaction ${t.id} refers to missing skill ${t.skillId}` });
      }
      if (t.completionId === null) continue;
      if (!completionById.has(t.completionId)) {
        problems.push({
          code: 'ORPHAN_TRANSACTION',
          id: t.id,
          message: `Transaction ${t.id} refers to missing completion ${t.completionId}`,
        });
        continue;
      }
      netDeci.set(t.completionId, (netDeci.get(t.completionId) ?? 0) + toDeci(t.delta));
    }

    for (const c of completions) {
      const net = netDeci.get(c.id);
      if (net === undefined) {
        problems.push({ code: 'COMPLETION_WITHOUT_TRANSACTION', id: c.id, message: `Completion ${c.id} has no transactions` });
      } else if (c.status === 'ACTIVE' && net !== toDeci(c.pointsAwarded)) {
        problems.push({
          code: 'ACTIVE_NET_MISMATCH',
          id: c.id,
          message: `Completion ${c.id} awarded ${c.pointsAwarded} but its transactions sum to ${fromDeci(net)}`,
        });
      } else if (c.status === 'CANCELLED' && net !== 0) {
        problems.push({
          code: 'CANCELLED_NET_NONZERO',
          id: c.id,
          message: `Cancelled completion ${c.id} still nets ${fromDeci(net)}`,
        });
      }
    }
    return problems;
  });
}
