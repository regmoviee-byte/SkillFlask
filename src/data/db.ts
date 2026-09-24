import Dexie, { type EntityTable, type Table } from 'dexie';
import type { LevelThreshold, Milestone, PointTransaction, Skill, StepCompletion, StepDefinition } from '../domain/types';

// Local IndexedDB storage (section 11.1). Dexie's version number is the schema version:
// add a new `version(n)` block with an upgrade function for every schema change.
export class SkillFlaskDb extends Dexie {
  skills!: EntityTable<Skill, 'id'>;
  milestones!: EntityTable<Milestone, 'id'>;
  levelThresholds!: Table<LevelThreshold, [string, number]>;
  steps!: EntityTable<StepDefinition, 'id'>;
  completions!: EntityTable<StepCompletion, 'id'>;
  transactions!: EntityTable<PointTransaction, 'id'>;

  constructor(name = 'skill-flask') {
    super(name);
    this.version(1).stores({
      skills: 'id, status, createdAt',
      milestones: 'id, skillId',
      levelThresholds: '[skillId+flaskNumber], skillId',
      steps: 'id, skillId',
      completions: 'id, skillId, stepId, date',
      transactions: 'id, skillId, completionId, createdAt',
    });
  }
}

export const db = new SkillFlaskDb();
