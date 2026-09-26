// Vite plugin for the static reminder files (v0.5 package 20, «Напоминание в календаре»): iOS
// opens an .ics file only from an https URL, so the build writes one file per 15-minute slot and
// day set to dist/reminders/ — 228 files, each under 1 KB. The files come from the app's own
// code (the default export of `entry`, src/ui/reminder/staticFiles.ts), loaded through Vite so
// the TypeScript and its imports need nothing else. They are written after the bundle, next to
// it and outside public/, so scripts/sw-plugin.mjs never precaches them (it also skips
// reminders/ explicitly), and public/sw.js leaves requests for them to the network.
// GitHub Pages serves `.ics` as `text/calendar` (its MIME table), which iOS needs to offer
// «Добавить в Календарь»; `vite preview` does the same, and so does the dev server below.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runnerImport } from 'vite';

export const REMINDERS_DIR = 'reminders';
const ICS_TYPE = 'text/calendar; charset=utf-8';

/** @param {{ entry?: string }} [options] */
export function reminderFiles({ entry = 'src/ui/reminder/staticFiles.ts' } = {}) {
  let config;
  let pending = null;
  /** @returns {Promise<{ path: string; content: string }[]>} */
  const files = () =>
    (pending ??= runnerImport(resolve(config.root, entry), { root: config.root, configFile: false, logLevel: 'error', mode: config.mode }).then(
      ({ module }) => module.default(config.env),
    ));
  return {
    name: 'skill-flask-reminders',
    configResolved(resolved) {
      config = resolved;
    },
    // `npm run dev`: the files from memory, so the buttons work before a build.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!path.startsWith(`${REMINDERS_DIR}/`)) return next();
        files().then((list) => {
          const file = list.find((f) => f.path === path);
          if (!file) return next();
          res.setHeader('Content-Type', ICS_TYPE);
          res.end(file.content);
        }, next);
      });
    },
    async closeBundle() {
      if (config.command !== 'build' || config.build.ssr) return;
      const outDir = resolve(config.root, config.build.outDir);
      const dir = join(outDir, REMINDERS_DIR);
      const list = await files();
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      for (const file of list) writeFileSync(join(outDir, file.path), file.content);
      config.logger.info(`${REMINDERS_DIR}/: ${list.length} .ics files`);
    },
  };
}
