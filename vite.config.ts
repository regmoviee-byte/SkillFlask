import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };
import { serviceWorker } from './scripts/sw-plugin.mjs';

export default defineConfig({
  // Relative base so the build works from any static host path (GitHub Pages, Telegram Mini App URL).
  base: './',
  // serviceWorker: dist/sw.js gets the build's version and precache list (the offline start
  // of the installed browser app; never registered inside Telegram).
  plugins: [react(), serviceWorker(pkg.version)],
  build: {
    // dist/.vite/manifest.json tells scripts/check-bundle.mjs the initial load from the lazy
    // chunks (the progress themes other than the flask, the forecast and heat maps, a few
    // sheets). CI deletes it before publishing dist.
    manifest: true,
    // Everything the first paint needs stays one chunk: left alone, rolldown splits React and
    // other modules the lazy chunks share into chunks of their own, which costs kilobytes of
    // the initial budget in chunk overhead and worse compression (scripts/check-bundle.mjs).
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'app', tags: ['$initial'] }] } } },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    // Above test-setup's 5 s findBy*/waitFor budget: a query that never matches fails as itself,
    // with the DOM it searched, instead of as an anonymous «Test timed out».
    testTimeout: 20000,
  },
});
