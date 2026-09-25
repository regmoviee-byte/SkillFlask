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
  // dist/.vite/manifest.json tells scripts/check-bundle.mjs the initial load from the lazy
  // chunks (the progress themes other than the flask). CI deletes it before publishing dist.
  build: { manifest: true },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
