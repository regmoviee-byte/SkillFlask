// Row transforms by target schema version. The Dexie upgrade of version v and the backup
// import of an older file run the same pure functions: import replays MIGRATIONS[v] for every
// version after the file's, up to SCHEMA_VERSION. A version without row changes still has an
// (empty) entry, so every step is documented next to its Dexie declaration.

import { V2_MIGRATIONS, type RowMigrations } from './v2';
import { V3_MIGRATIONS } from './v3';
import { V4_MIGRATIONS } from './v4';

export type { RowMigrations } from './v2';

export const MIGRATIONS: Record<number, RowMigrations> = {
  2: V2_MIGRATIONS,
  3: V3_MIGRATIONS,
  4: V4_MIGRATIONS,
};
