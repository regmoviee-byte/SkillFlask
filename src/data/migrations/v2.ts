// Per-row transforms of the Dexie v2 upgrade. Pure and idempotent (`??=` only), so the
// same functions run inside `db.version(2).upgrade()` and when importing an older backup.

import type { Skill, StepCompletion, StepDefinition } from '../../domain/types';
import { localDate } from '../../lib/clock';

type V1Step = Omit<StepDefinition, 'pointsPerMinute' | 'defaultMinutes' | 'scheduleFrom' | 'schedule'> &
  Partial<Pick<StepDefinition, 'pointsPerMinute' | 'defaultMinutes' | 'scheduleFrom' | 'schedule'>>;
type V1Completion = Omit<StepCompletion, 'cancelledAt'> & Partial<Pick<StepCompletion, 'cancelledAt'>>;
type V1Skill = Omit<Skill, 'originSkillId'> & Partial<Pick<Skill, 'originSkillId'>>;

export function upgradeStepV2(step: V1Step): void {
  step.pointsPerMinute ??= null;
  step.defaultMinutes ??= null;
  // The local calendar day the step was created on (FR-TD-006), never the UTC date.
  step.scheduleFrom ??= localDate(new Date(step.createdAt));
  step.schedule ??= { kind: 'MANUAL' };
}

export function upgradeCompletionV2(completion: V1Completion): void {
  completion.cancelledAt ??= null;
}

export function upgradeSkillV2(skill: V1Skill): void {
  skill.originSkillId ??= null;
}

export interface RowMigrations {
  steps?: (row: V1Step) => void;
  completions?: (row: V1Completion) => void;
  skills?: (row: V1Skill) => void;
}

/** Row transforms by target schema version; backup import replays them from the file's version up. */
export const MIGRATIONS: Record<number, RowMigrations> = {
  2: { steps: upgradeStepV2, completions: upgradeCompletionV2, skills: upgradeSkillV2 },
};
