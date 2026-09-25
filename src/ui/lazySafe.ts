import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { logError } from '../platform/errorLog';

// React.lazy for chunks the screens can live without. A chunk that fails to load (a flaky
// mobile network, or a redeploy that removed the old hashed files while Telegram, which never
// gets the service worker's precache, still runs the previous build) would otherwise be thrown
// to the app-level ErrorBoundary and replace the whole app with «Что-то пошло не так». Here the
// error is logged and `fallback` takes the component's place for the rest of the session
// (React.lazy keeps the first outcome; a reload picks up the new build), like the progress
// themes fall back to the flask (progress/registry.ts).

/** Renders nothing: a missing chunk leaves no trace on the screen. */
function Nothing() {
  return null;
}

/** React.lazy with a logged fallback instead of a thrown chunk error; any props, like React.lazy. */
export function lazySafe<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  label: string,
  fallback: T = Nothing as unknown as T,
): LazyExoticComponent<T> {
  return lazy(() =>
    load().catch((error: unknown) => {
      logError(error, `chunk ${label}`);
      return { default: fallback };
    }),
  );
}
