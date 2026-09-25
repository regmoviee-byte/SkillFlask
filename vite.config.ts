import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative base so the build works from any static host path (GitHub Pages, Telegram Mini App URL).
  base: './',
  plugins: [react()],
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
