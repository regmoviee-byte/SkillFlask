// Domain model — see requirements v0.2, section 5.
// Dates are ISO strings; calendar dates (without time) are local YYYY-MM-DD.

export type SkillStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type StepType = 'BOOLEAN' | 'TIMED';
export type ScheduleKind = 'MANUAL';
export type CompletionSource = 'SCHEDULED' | 'MANUAL';
export type CompletionStatus = 'ACTIVE' | 'CANCELLED';
export type TransactionReason = 'COMPLETION' | 'CORRECTION' | 'CANCELLATION';

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
}

export interface Milestone extends Timestamps {
  id: string;
  skillId: string;
  name: string;
  targetFlaskNumber: number;
  reachedAt: string | null;
  /** Set when the user chose "Продолжить" after reaching the milestone. */
  decision: 'CONTINUE' | null;
}

export interface LevelThreshold {
  skillId: string;
  flaskNumber: number;
  requiredPoints: number;
}

export interface StepSchedule {
  kind: ScheduleKind;
}

export interface StepDefinition extends Timestamps {
  id: string;
  skillId: string;
  name: string;
  type: StepType;
  /** Fixed points for BOOLEAN steps. */
  points: number;
  schedule: StepSchedule;
  isActive: boolean;
}

export interface StepCompletion extends Timestamps {
  id: string;
  skillId: string;
  stepId: string;
  /** Snapshot of the step definition at completion time (section 5.1). */
  stepName: string;
  stepType: StepType;
  pointsSnapshot: number;
  durationMinutes: number | null;
  pointsAwarded: number;
  /** Local calendar date the step was done on. */
  date: string;
  source: CompletionSource;
  status: CompletionStatus;
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
