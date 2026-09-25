// Schema version 4 adds the skill's appearance («Оформление», package 11): the progress theme
// and the colour. Presentation only, no index: every existing skill becomes a flask that
// follows the Telegram accent, exactly what it looked like before. Pure and idempotent
// (`??=` only), so the Dexie upgrade and the import of an older backup run the same function.
// A theme key this build does not know (a newer release's backup) is not rejected here: it is
// read as the flask (domain/appearance.ts).

import type { Transaction } from 'dexie';
import { DEFAULT_PROGRESS_THEME } from '../../domain/appearance';
import type { RowMigrations, V1Skill } from './v2';

export function upgradeSkillV4(skill: V1Skill): void {
  skill.theme ??= DEFAULT_PROGRESS_THEME;
  skill.color ??= null;
}

/** The Dexie v4 upgrade: defaults for every stored skill. */
export async function upgradeV4(tx: Transaction): Promise<void> {
  await tx.table('skills').toCollection().modify(upgradeSkillV4);
}

export const V4_MIGRATIONS: RowMigrations = { skills: upgradeSkillV4 };
