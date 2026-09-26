import { Suspense } from 'react';
import { Screen } from '../components/Screen';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';

// «Ачивки» is a lazy chunk (v0.5 package 19 made room in the initial load with it, as packages
// 17 and 18 did with «Итоги недели» and «Настройки»): the ladders, the badge grid, the records
// section and the detail sheet. The engine, the home line and the celebration cards stay in the
// first paint. The chunk is fetched soon after the first screen (App), so the tab opens at once;
// its header stands while it loads, and a chunk that fails to load leaves a line to restart.

type AchievementsModule = typeof import('./AchievementsScreen');

let pending: Promise<AchievementsModule> | null = null;

/** One shared import: the prefetch and the route use the same promise; a failure is retried next time. */
function loadAchievements(): Promise<AchievementsModule> {
  pending ??= import('./AchievementsScreen').catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Fetches the chunk ahead of time (a failure is silent: the route tries again and logs it). */
export function prefetchAchievements(): void {
  loadAchievements().catch(() => {});
}

function AchievementsUnavailable() {
  return (
    <Screen title={copy.achievements.title} largeTitle>
      <p className="hint center">{copy.errors.sheetChunk}</p>
    </Screen>
  );
}

const AchievementsScreen = lazySafe(() => loadAchievements().then((m) => ({ default: m.AchievementsScreen })), 'AchievementsScreen', AchievementsUnavailable);

export function AchievementsRoute() {
  return (
    <Suspense
      fallback={
        <Screen title={copy.achievements.title} largeTitle>
          {null}
        </Screen>
      }
    >
      <AchievementsScreen />
    </Suspense>
  );
}
