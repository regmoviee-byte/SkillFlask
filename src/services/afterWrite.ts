// Hooks that follow every data mutation. Empty for now: package 7 registers the achievement
// sync (runs inside the mutation's transaction, so unlocks commit or roll back with the
// journal), package 4 the cloud backup scheduler (runs after the commit, never blocks it).

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

const inTransactionHooks: InTransactionHook[] = [];
const afterCommitHooks: AfterCommitHook[] = [];

function register<T>(list: T[], hook: T): () => void {
  list.push(hook);
  return () => {
    const i = list.indexOf(hook);
    if (i >= 0) list.splice(i, 1);
  };
}

export const registerInTransactionHook = (hook: InTransactionHook) => register(inTransactionHooks, hook);
export const registerAfterCommitHook = (hook: AfterCommitHook) => register(afterCommitHooks, hook);

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
