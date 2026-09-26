import type { Plugin } from 'vite';

/** Fills in public/sw.js's version and precache list in dist/ (scripts/sw-plugin.mjs). */
export function serviceWorker(appVersion: string): Plugin;

/** The files an offline start precaches: the bundle and public/, never the reminder .ics files. */
export function precacheFiles(bundled: string[], publicFiles: string[]): string[];
