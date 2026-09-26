import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  AchievementUnlock,
  LevelThreshold,
  Mark,
  Pause,
  Milestone,
  PointTransaction,
  SettingRow,
  Skill,
  StepCompletion,
  StepDefinition,
} from '../domain/types';
import { upgradeCompletionV2, upgradeSkillV2, upgradeStepV2 } from './migrations/v2';
import { upgradeV3 } from './migrations/v3';
import { upgradeV4 } from './migrations/v4';
import { upgradeV5 } from './migrations/v5';

// Local IndexedDB storage (section 11.1). Schema rules:
// - Dexie's version number is the schema version and equals `schemaVersion` of a backup file.
// - Version numbers only grow; every version adds fields with defaults in an idempotent
//   upgrade whose row transforms live in ./migrations/<version>.ts.
// - Never change a primary key or rename a table in place — add a new table and copy.
// - Booleans are never indexed (IndexedDB cannot index them); index a status string instead.
// - Inside `.upgrade()` never await anything outside the transaction, or it commits early.

export const DB_NAME = import.meta.env.DEV ? 'skill-flask-dev' : 'skill-flask';

export class SkillFlaskDb extends Dexie {
  skills!: EntityTable<Skill, 'id'>;
  milestones!: EntityTable<Milestone, 'id'>;
  levelThresholds!: Table<LevelThreshold, [string, number]>;
  steps!: EntityTable<StepDefinition, 'id'>;
  completions!: EntityTable<StepCompletion, 'id'>;
  transactions!: EntityTable<PointTransaction, 'id'>;
  settings!: Table<SettingRow, string>;
  achievementUnlocks!: EntityTable<AchievementUnlock, 'id'>;
  marks!: EntityTable<Mark, 'id'>;
  pauses!: EntityTable<Pause, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      skills: 'id, status, createdAt',
      milestones: 'id, skillId',
      levelThresholds: '[skillId+flaskNumber], skillId',
      steps: 'id, skillId',
      completions: 'id, skillId, stepId, date',
      transactions: 'id, skillId, completionId, createdAt',
    });
    this.version(2)
      .stores({
        skills: 'id, status, createdAt',
        milestones: 'id, skillId',
        levelThresholds: '[skillId+flaskNumber], skillId',
        steps: 'id, skillId',
        completions: 'id, skillId, stepId, date, [skillId+date], [stepId+date], [status+date]',
        transactions: 'id, skillId, completionId, createdAt, [skillId+createdAt]',
        settings: 'key',
        achievementUnlocks: 'id',
      })
      .upgrade(async (tx) => {
        await tx.table('steps').toCollection().modify(upgradeStepV2);
        await tx.table('completions').toCollection().modify(upgradeCompletionV2);
        await tx.table('skills').toCollection().modify(upgradeSkillV2);
      });
    this.version(3)
      .stores({
        skills: 'id, status, createdAt',
        milestones: 'id, skillId',
        levelThresholds: '[skillId+flaskNumber], skillId',
        steps: 'id, skillId',
        completions: 'id, skillId, stepId, date, [skillId+date], [stepId+date], [status+date]',
        transactions: 'id, skillId, completionId, createdAt, [skillId+createdAt]',
        settings: 'key',
        achievementUnlocks: 'id',
        marks: 'id, skillId, [skillId+date]',
      })
      .upgrade(upgradeV3);
    // Version 4: the skill's appearance (theme, colour); no new index.
    this.version(4)
      .stores({
        skills: 'id, status, createdAt',
        milestones: 'id, skillId',
        levelThresholds: '[skillId+flaskNumber], skillId',
        steps: 'id, skillId',
        completions: 'id, skillId, stepId, date, [skillId+date], [stepId+date], [status+date]',
        transactions: 'id, skillId, completionId, createdAt, [skillId+createdAt]',
        settings: 'key',
        achievementUnlocks: 'id',
        marks: 'id, skillId, [skillId+date]',
      })
      .upgrade(upgradeV4);
    // Version 5: skill pauses («Пауза», package 18), a new table read by skill.
    this.version(5)
      .stores({
        skills: 'id, status, createdAt',
        milestones: 'id, skillId',
        levelThresholds: '[skillId+flaskNumber], skillId',
        steps: 'id, skillId',
        completions: 'id, skillId, stepId, date, [skillId+date], [stepId+date], [status+date]',
        transactions: 'id, skillId, completionId, createdAt, [skillId+createdAt]',
        settings: 'key',
        achievementUnlocks: 'id',
        marks: 'id, skillId, [skillId+date]',
        pauses: 'id, skillId',
      })
      .upgrade(upgradeV5);
  }
}

/** Current schema version; a backup file with a higher `schemaVersion` cannot be imported. */
export const SCHEMA_VERSION = 5;

export function createDb(name?: string): SkillFlaskDb {
  return new SkillFlaskDb(name);
}

// Live binding: importers always see the current instance, so tests can swap in a fresh
// database per test with `setDb` without touching a shared singleton.
export let db = createDb();

export function setDb(next: SkillFlaskDb): void {
  db = next;
}
