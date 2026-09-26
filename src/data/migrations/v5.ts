// Schema version 5 adds the `pauses` table («Пауза», v0.5 package 18). Like version 3's marks,
// no existing row changes: the table starts empty, the Dexie upgrade has nothing to do and the
// import of an older backup only gets `pauses: []` (TABLE_SINCE in ../backup.ts). The entry
// exists so every version has a documented step in MIGRATIONS.

import type { Transaction } from 'dexie';
import type { RowMigrations } from './v2';

/** The Dexie v5 upgrade: intentionally empty (see above). */
export async function upgradeV5(_tx: Transaction): Promise<void> {}

export const V5_MIGRATIONS: RowMigrations = {};
