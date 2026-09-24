import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative base so the build works from any static host path (GitHub Pages, Telegram Mini App URL).
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
