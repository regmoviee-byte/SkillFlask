// Vite plugin for public/sw.js (plain JS: vite.config.ts is type-checked without Node's types).
// public/ is copied to dist/ as it is; after the build this fills in the worker's version —
// the package version plus a hash of everything the build ships, so every build that changes
// a file changes sw.js and browsers install it as an update — and the list of files to
// precache for an offline start.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Every file under `dir`, as paths relative to it with forward slashes. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path).map((file) => `${name}/${file}`) : [name];
  });
}

/**
 * What the app ships for an offline start: the bundle and public/, without the page itself
 * (precached as './'), the worker, the build manifest and the reminder files (v0.5 package 20:
 * 228 .ics files opened now and then from a calendar button, never needed offline).
 * @param {string[]} bundled
 * @param {string[]} publicFiles
 */
export function precacheFiles(bundled, publicFiles) {
  return [...bundled.filter((file) => !file.startsWith('.vite/') && file !== 'index.html'), ...publicFiles.filter((file) => file !== 'sw.js')]
    .filter((file) => !file.startsWith('reminders/'))
    .sort();
}

/** @param {string} appVersion */
export function serviceWorker(appVersion) {
  let config;
  let bundled = [];
  return {
    name: 'skill-flask-sw',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle(_, bundle) {
      bundled = Object.keys(bundle);
    },
    closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const template = join(config.publicDir, 'sw.js');
      if (!existsSync(template) || !existsSync(join(outDir, 'index.html'))) return;
      const shipped = precacheFiles(bundled, filesUnder(config.publicDir));
      const hash = createHash('sha256');
      for (const file of shipped) hash.update(file).update(readFileSync(join(outDir, file)));
      hash.update(readFileSync(join(outDir, 'index.html')));
      const version = `${appVersion}-${hash.digest('hex').slice(0, 10)}`;
      // './' is the page itself (index.html); everything else by its path next to it.
      const precache = ['./', ...shipped.map((file) => `./${file}`)];
      const source = readFileSync(template, 'utf8')
        .replace('__SW_VERSION__', version)
        .replace('/* __SW_PRECACHE__ */ []', JSON.stringify(precache));
      writeFileSync(join(outDir, 'sw.js'), source);
      config.logger.info(`sw.js ${version}: ${precache.length} files to precache`);
    },
  };
}
