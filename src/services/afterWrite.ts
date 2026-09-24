// Hooks that follow every data mutation: package 7 registers the achievement sync (runs
// inside the mutation's transaction, so unlocks commit or roll back with the journal), the
// cloud backup scheduler (services/backupSync.ts) runs after the commit and never blocks it.
// A backup import or a full wipe replaces every table at once and runs the import hooks
// inside its transaction instead (package 7: re-derive unlocks without celebrating them).

import type { AchievementState } from '../domain/types';
import { logError } from '../platform/errorLog';

export interface WriteContext {
  /** Skill whose journal changed; null for writes that are not tied to one skill. */
  skillId: string | null;
  now: string;
}

/** Runs inside the write transaction (it covers `journalTables()`); returns what changed. */
export type InTransactionHook = (context: WriteContext) => Promise<AchievementState[]>;
/** Runs after the commit; failures are swallowed so a scheduled backup never fails a write. */
export type AfterCommitHook = () => void | Promise<void>;

export interface ImportContext {
  now: string;
}

/** Runs inside the transaction of a backup import or a wipe (it covers every table); a throw rolls it back. */
export type AfterImportHook = (context: ImportContext) => Promise<void>;

const inTransactionHooks: InTransactionHook[] = [];
const afterCommitHooks: AfterCommitHook[] = [];
const afterImportHooks: AfterImportHook[] = [];

function register<T>(list: T[], hook: T): () => void {
  list.push(hook);
  return () => {
    const i = list.indexOf(hook);
    if (i >= 0) list.splice(i, 1);
  };
}

export const registerInTransactionHook = (hook: InTransactionHook) => register(inTransactionHooks, hook);
export const registerAfterCommitHook = (hook: AfterCommitHook) => register(afterCommitHooks, hook);
export const registerAfterImportHook = (hook: AfterImportHook) => register(afterImportHooks, hook);

/** Called by journal mutations right before their transaction ends. */
export async function syncInTransaction(context: WriteContext): Promise<AchievementState[]> {
  const changed: AchievementState[] = [];
  for (const hook of inTransactionHooks) changed.push(...(await hook(context)));
  return changed;
}

/** Called by every mutation after its transaction committed. */
export async function afterWrite(): Promise<void> {
  for (const hook of afterCommitHooks) {
    try {
      await hook();
    } catch (error) {
      // A failed backup schedule must not turn a saved write into an error for the user.
      logError(error, 'afterWrite');
    }
  }
}

/** Called by importBackup and wipeAllData right before their transaction ends. */
export async function runAfterImport(context: ImportContext): Promise<void> {
  for (const hook of afterImportHooks) await hook(context);
}
