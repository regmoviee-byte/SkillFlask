// Schema version 3 adds the `marks` table («Засечки», requirements section 10). No existing
// row changes: the new table simply starts empty, so the Dexie upgrade has nothing to do and
// the backup import has no row transforms to replay — a schemaVersion-2 file only gets
// `marks: []` (TABLE_SINCE in ../backup.ts). The entry exists so every version from 2 up has
// a documented step in MIGRATIONS.

import type { Transaction } from 'dexie';
import type { RowMigrations } from './v2';

/** The Dexie v3 upgrade: intentionally empty (see above). */
export async function upgradeV3(_tx: Transaction): Promise<void> {}

export const V3_MIGRATIONS: RowMigrations = {};
