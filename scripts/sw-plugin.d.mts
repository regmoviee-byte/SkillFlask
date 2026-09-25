import type { Plugin } from 'vite';

/** Fills in public/sw.js's version and precache list in dist/ (scripts/sw-plugin.mjs). */
export function serviceWorker(appVersion: string): Plugin;
