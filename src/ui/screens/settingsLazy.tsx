import { Suspense } from 'react';
import { SaveCopyButton } from '../components/ErrorBoundary';
import { Screen } from '../components/Screen';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';

// «Настройки» is a lazy chunk (v0.5 package 18 made room in the initial load with it, as
// package 17 did with «Итоги недели»): a tab opened now and then, never the first screen, with
// the backup file, import, the error log and the switches behind it. The cloud backup itself
// runs from the first paint (services/backupSync.ts); only its screen waits here.
//
// Settings is also the way out when another chunk fails («обновите приложение в «Настройках»»):
// a redeploy removes the old hashed files while Telegram, with no service-worker precache, still
// runs the previous build. So the chunk is fetched quietly soon after the first paint
// (`prefetchSettings`, App), long before a redeploy can pull it away; and if it still fails, the
// fallback keeps the two things that matter: a reload and a copy of the data.

type SettingsModule = typeof import('./SettingsScreen');

let pending: Promise<SettingsModule> | null = null;

/** One shared import: the prefetch and the route use the same promise; a failure is retried next time. */
function loadSettings(): Promise<SettingsModule> {
  pending ??= import('./SettingsScreen').catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Fetches the settings chunk ahead of time (a failure is silent: the route tries again and logs it). */
export function prefetchSettings(): void {
  loadSettings().catch(() => {});
}

function SettingsUnavailable() {
  return (
    <Screen title={copy.settings.title} largeTitle>
      <div className="error-screen error-screen--inline">
        <p className="hint">{copy.errors.settingsChunk}</p>
        <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
          {copy.errorBoundary.reload}
        </button>
        <SaveCopyButton />
      </div>
    </Screen>
  );
}

const SettingsScreen = lazySafe(() => loadSettings().then((m) => ({ default: m.SettingsScreen })), 'SettingsScreen', SettingsUnavailable);

export function SettingsRoute() {
  return (
    <Suspense
      fallback={
        <Screen title={copy.settings.title} largeTitle>
          {null}
        </Screen>
      }
    >
      <SettingsScreen />
    </Suspense>
  );
}
