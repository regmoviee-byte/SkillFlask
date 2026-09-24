// Domain model — see requirements v0.2, section 5.
// Dates are ISO strings; calendar dates (without time) are local YYYY-MM-DD.

export type SkillStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type StepType = 'BOOLEAN' | 'TIMED';
export type CompletionSource = 'SCHEDULED' | 'MANUAL';
export type CompletionStatus = 'ACTIVE' | 'CANCELLED';
export type TransactionReason = 'COMPLETION' | 'CORRECTION' | 'CANCELLATION' | 'RESTORE';

/** ISO weekday: Monday = 1 … Sunday = 7 (FR-TD-007). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type StepSchedule =
  | { kind: 'MANUAL' }
  | { kind: 'DAILY' }
  | { kind: 'WEEKDAYS'; days: Weekday[] }
  | { kind: 'TIMES_PER_WEEK'; times: number }
  | { kind: 'TIMES_PER_MONTH'; times: number };

interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface Skill extends Timestamps {
  id: string;
  name: string;
  description: string;
  status: SkillStatus;
  /** Real-world starting point, e.g. "B1". A label only, not a flask number. */
  startLabel: string;
  targetLabel: string;
  /** Capacity of flask 1 when no manual thresholds are set. */
  capacityBase: number;
  /** Capacity growth per flask beyond the manually set thresholds. */
  capacityIncrement: number;
  completedAt: string | null;
  archivedAt: string | null;
  /** The skill this one was copied from by «Начать заново»; null otherwise. */
  originSkillId: string | null;
}

export interface Milestone extends Timestamps {
  id: string;
  skillId: string;
  name: string;
  targetFlaskNumber: number;
  /** Cache of the date derived from the journal (see domain/events.ts); null while below the target. */
  reachedAt: string | null;
  /** Set when the user chose "Продолжить" after reaching the milestone. */
  decision: 'CONTINUE' | null;
}

export interface LevelThreshold {
  skillId: string;
  flaskNumber: number;
  requiredPoints: number;
}

export interface StepDefinition extends Timestamps {
  id: string;
  skillId: string;
  name: string;
  type: StepType;
  /** Fixed points for a BOOLEAN step (integer ≥ 1). Unused for TIMED. */
  points: number;
  /** Rate for a TIMED step (≤ 2 decimals); null for BOOLEAN. */
  pointsPerMinute: number | null;
  /** Suggested duration for a TIMED step; null for BOOLEAN. */
  defaultMinutes: number | null;
  schedule: StepSchedule;
  /** YYYY-MM-DD; the schedule never plans dates before it. */
  scheduleFrom: string;
  isActive: boolean;
}

export interface StepCompletion extends Timestamps {
  id: string;
  skillId: string;
  stepId: string;
  /** Snapshot of the step definition at completion time (section 5.1). */
  stepName: string;
  stepType: StepType;
  /** Fixed points for BOOLEAN; rate per minute for TIMED. */
  pointsSnapshot: number;
  /** Only for TIMED completions. */
  durationMinutes: number | null;
  pointsAwarded: number;
  /** Local calendar date the step was done on. */
  date: string;
  source: CompletionSource;
  status: CompletionStatus;
  cancelledAt: string | null;
  note: string | null;
}

export interface PointTransaction {
  id: string;
  skillId: string;
  completionId: string | null;
  delta: number;
  reason: TransactionReason;
  createdAt: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/** What has already been shown for an achievement; the achievement itself is derived from the journal. */
export interface AchievementUnlock {
  /** Achievement id from the catalogue. */
  id: string;
  unlockedAt: string;
  skillId: string | null;
  celebratedAt: string | null;
  seenAt: string | null;
}

/**
 * An achievement whose state a mutation changed (opened or closed again). Package 7 derives
 * these from the journal; until then every MutationResult carries an empty list.
 */
export interface AchievementState {
  /** Achievement id from the catalogue. */
  id: string;
  /** Null when the mutation closed the achievement again. */
  unlockedAt: string | null;
}
