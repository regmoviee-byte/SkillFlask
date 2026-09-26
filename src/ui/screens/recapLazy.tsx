import { Suspense } from 'react';
import { Screen } from '../components/Screen';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';

// «Итоги недели» is a lazy chunk (v0.5 package 17 made room in the initial load with it): a
// screen opened from the home tile now and then, never the first one. Its header stands while
// the chunk loads; a chunk that fails to load leaves it with a line to update the app.

function RecapUnavailable() {
  return (
    <Screen title={copy.recap.title} back="/skills" largeTitle>
      <p className="hint center">{copy.errors.recapChunk}</p>
    </Screen>
  );
}

const RecapScreen = lazySafe(() => import('./RecapScreen').then((m) => ({ default: m.RecapScreen })), 'RecapScreen', RecapUnavailable);

export function RecapRoute() {
  return (
    <Suspense
      fallback={
        <Screen title={copy.recap.title} back="/skills" largeTitle>
          {null}
        </Screen>
      }
    >
      <RecapScreen />
    </Suspense>
  );
}
