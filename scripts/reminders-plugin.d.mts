import type { Plugin } from 'vite';

export const REMINDERS_DIR: string;

/**
 * Writes the static reminder .ics files to dist/reminders/ and serves them in dev; the files are
 * the default export of `entry` (src/ui/reminder/staticFiles.ts), called with the env (scripts/reminders-plugin.mjs).
 */
export function reminderFiles(options?: { entry?: string }): Plugin;
