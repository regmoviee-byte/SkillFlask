import { useEffect, useState, type ReactNode } from 'react';
import { openDb, openMessages, type OpenResult } from '../data/open';
import { copy } from './copy';

type State = { status: 'opening'; slow: boolean } | { status: 'ok' } | { status: 'error'; message: string };

const SLOW_OPEN_MS = 300;

/**
 * Opens the database before the app renders and turns open failures (newer schema on disk,
 * quota, private mode, an upgrade from another tab) into a readable message with a reload
 * button instead of a blank screen.
 */
export function DbBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'opening', slow: false });

  useEffect(() => {
    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      setState((prev) => (prev.status === 'opening' ? { status: 'opening', slow: true } : prev));
    }, SLOW_OPEN_MS);
    openDb((message) => setState({ status: 'error', message }))
      .then((result: OpenResult) => {
        if (cancelled) return;
        setState(result.ok ? { status: 'ok' } : { status: 'error', message: result.message });
      })
      .catch((e: unknown) => {
        // openDb classifies db.open() failures itself; anything else must still end in the
        // reload screen, never in an endless "opening" state.
        console.error(e);
        if (!cancelled) setState({ status: 'error', message: openMessages.unknown });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, []);

  if (state.status === 'ok') return children;
  if (state.status === 'opening') {
    return <div className="db-boundary">{state.slow && <p className="hint">{copy.db.opening}</p>}</div>;
  }
  return (
    <div className="db-boundary" role="alert">
      <p className="empty-title">{copy.db.title}</p>
      <p className="hint">{state.message}</p>
      <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
        {copy.db.reload}
      </button>
    </div>
  );
}
