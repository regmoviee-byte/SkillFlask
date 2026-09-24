// Events of a skill's history, derived from the journal (never stored): the operations
// themselves plus the moments they caused — a flask filled or given back, the milestone
// crossed, the skill created or completed. The journal stays the only source of truth, so
// editing a capacity or the milestone target re-interprets these events like everything else.
// Marks («Засечки») are the one stored kind of event: they are merged in by withMarks().

import { localDate } from '../lib/clock';
import { fromDeci, MAX_MINUTES, timedPoints, toDeci } from './points';
import type { Progress, TimelineEntry } from './progression';
import type { Mark, Milestone, PointTransaction, Skill, StepCompletion } from './types';

/**
 * The date the milestone was reached, derived from the journal (FR-MS-007): the createdAt
 * of the last crossing to `target` completed flasks that was not followed by a drop below
 * the target. Null while the skill is currently below the target. Editing the target later
 * re-interprets history instead of stamping the edit time.
 */
export function milestoneReachedAt(
  timeline: readonly TimelineEntry<{ delta: number; createdAt: string }>[],
  target: number,
): string | null {
  let reachedAt: string | null = null;
  for (const entry of timeline) {
    const wasBelow = entry.before.completedFlasks < target;
    const isBelow = entry.after.completedFlasks < target;
    if (wasBelow && !isBelow) reachedAt = entry.transaction.createdAt;
    else if (isBelow) reachedAt = null;
  }
  return reachedAt;
}

interface EventBase {
  /** Stable key: the transaction id, suffixed for the events it caused. */
  id: string;
  /** When it was written (ISO). */
  at: string;
  /**
   * Local calendar day the event is listed under: a completion's own date, the write date for
   * every other operation; the moments an operation caused share its day.
   */
  date: string;
}

export interface TransactionEvent extends EventBase {
  type: PointTransaction['reason'];
  delta: number;
  /** Flask state right after this operation. */
  after: Progress;
  /** Undefined only for a row without a completion (none are written today). */
  completion: StepCompletion | undefined;
  /** Minutes before → after of a CORRECTION, when both can be recovered exactly from the points. */
  minutes: { from: number; to: number } | null;
}

export interface LevelEvent extends EventBase {
  type: 'LEVEL_UP' | 'LEVEL_DOWN';
  /** LEVEL_UP: the last flask that filled. LEVEL_DOWN: the flask the skill went back to. */
  flask: number;
  /** How many flasks the operation filled or gave back (≥ 1). */
  levels: number;
  after: Progress;
}

export interface MilestoneEvent extends EventBase {
  type: 'MILESTONE_REACHED' | 'MILESTONE_LOST';
  name: string;
}

export interface SkillEvent extends EventBase {
  /** SKILL_RESTORED has no timestamp of its own yet (package 6 adds archive/restore). */
  type: 'SKILL_CREATED' | 'SKILL_COMPLETED' | 'SKILL_ARCHIVED' | 'SKILL_RESTORED';
}

/** A mark, listed under its own date; inside the day by when it was written. */
export interface MarkEvent extends EventBase {
  type: 'MARK';
  mark: Mark;
}

export type HistoryEvent = TransactionEvent | LevelEvent | MilestoneEvent | SkillEvent | MarkEvent;

export const isTransactionEvent = (event: HistoryEvent): event is TransactionEvent =>
  event.type === 'COMPLETION' || event.type === 'CANCELLATION' || event.type === 'CORRECTION' || event.type === 'RESTORE';

/** The one duration that gives `points` at `rate`, or null when none or several do (rounding). */
export function minutesForPoints(points: number, rate: number): number | null {
  let found: number | null = null;
  for (let m = 1; m <= MAX_MINUTES; m++) {
    if (timedPoints(m, rate) !== points) continue;
    if (found !== null) return null;
    found = m;
  }
  return found;
}

/** Local YYYY-MM-DD of an ISO timestamp, in the device time zone. */
const dayOf = (iso: string): string => localDate(new Date(iso));

/**
 * Journal order in, events in the same (oldest-first) order out. Per transaction the fixed
 * sub-order is: the operation, then LEVEL_UP/LEVEL_DOWN when completedFlasks changed, then
 * MILESTONE_REACHED/LOST when the target was crossed — exactly once per crossing. The skill's
 * own moments (created, completed, archived) are merged in by time.
 */
export function eventsFromTimeline(
  timeline: readonly TimelineEntry<PointTransaction>[],
  completionsById: ReadonlyMap<string, StepCompletion>,
  milestone: Pick<Milestone, 'name' | 'targetFlaskNumber'> | undefined,
  skill: Pick<Skill, 'id' | 'createdAt' | 'status' | 'completedAt' | 'archivedAt'>,
): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  // Points of each completion after its rows so far, for the minutes of a correction.
  const running = new Map<string, number>();

  for (const entry of timeline) {
    const { transaction: t, before, after } = entry;
    const completion = t.completionId ? completionsById.get(t.completionId) : undefined;
    const at = t.createdAt;
    const date = t.reason === 'COMPLETION' && completion ? completion.date : dayOf(at);

    let minutes: TransactionEvent['minutes'] = null;
    if (completion) {
      const previous = running.get(completion.id) ?? 0;
      const next = fromDeci(toDeci(previous) + toDeci(t.delta));
      running.set(completion.id, next);
      if (t.reason === 'CORRECTION' && completion.stepType === 'TIMED') {
        const from = minutesForPoints(previous, completion.pointsSnapshot);
        const to = minutesForPoints(next, completion.pointsSnapshot);
        if (from !== null && to !== null) minutes = { from, to };
      }
    }
    events.push({ id: t.id, type: t.reason, at, date, delta: t.delta, after, completion, minutes });

    if (entry.levelChange > 0) {
      events.push({ id: `${t.id}:up`, type: 'LEVEL_UP', at, date, flask: after.completedFlasks, levels: entry.levelChange, after });
    } else if (entry.levelChange < 0) {
      events.push({ id: `${t.id}:down`, type: 'LEVEL_DOWN', at, date, flask: after.currentFlask, levels: -entry.levelChange, after });
    }

    if (milestone) {
      const target = milestone.targetFlaskNumber;
      const wasBelow = before.completedFlasks < target;
      const isBelow = after.completedFlasks < target;
      if (wasBelow !== isBelow) {
        events.push({ id: `${t.id}:ms`, type: isBelow ? 'MILESTONE_LOST' : 'MILESTONE_REACHED', at, date, name: milestone.name });
      }
    }
  }

  const own: SkillEvent[] = [{ id: `${skill.id}:created`, type: 'SKILL_CREATED', at: skill.createdAt, date: dayOf(skill.createdAt) }];
  if (skill.status === 'COMPLETED' && skill.completedAt) {
    own.push({ id: `${skill.id}:completed`, type: 'SKILL_COMPLETED', at: skill.completedAt, date: dayOf(skill.completedAt) });
  }
  if (skill.status === 'ARCHIVED' && skill.archivedAt) {
    own.push({ id: `${skill.id}:archived`, type: 'SKILL_ARCHIVED', at: skill.archivedAt, date: dayOf(skill.archivedAt) });
  }
  // Merge by time: the creation always opens the history; completing or archiving comes
  // after every operation written up to that moment.
  const merged: HistoryEvent[] = [];
  let i = 0;
  for (const event of own) {
    while (i < events.length && events[i]!.at <= event.at && event.type !== 'SKILL_CREATED') merged.push(events[i++]!);
    merged.push(event);
  }
  while (i < events.length) merged.push(events[i++]!);
  return merged;
}

/**
 * Merges marks into an oldest-first event list by the time they were written (`at`), so that
 * inside a day newestFirst() orders them with the operations by createdAt. The day they are
 * listed under is their own `date`, which may be earlier than the day they were written.
 */
export function withMarks(events: readonly HistoryEvent[], marks: readonly Mark[]): HistoryEvent[] {
  if (marks.length === 0) return [...events];
  const own: MarkEvent[] = [...marks]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    .map((mark) => ({ id: `mark:${mark.id}`, type: 'MARK', at: mark.createdAt, date: mark.date, mark }));
  const merged: HistoryEvent[] = [];
  let i = 0;
  for (const event of events) {
    while (i < own.length && own[i]!.at < event.at) merged.push(own[i++]!);
    merged.push(event);
  }
  while (i < own.length) merged.push(own[i++]!);
  return merged;
}

/**
 * Newest first for the list: grouped by day (latest day on top), and inside a day in reverse
 * journal order, so the moments an operation caused sit right above it.
 */
export function newestFirst(events: readonly HistoryEvent[]): HistoryEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.date !== b.event.date ? (a.event.date < b.event.date ? 1 : -1) : b.index - a.index))
    .map(({ event }) => event);
}
