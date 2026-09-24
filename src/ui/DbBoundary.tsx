import { useEffect, useState, type ReactNode } from 'react';
import { openDb, openMessages, type OpenResult } from '../data/open';
import type { CloudMeta } from '../platform/cloud';
import { logError } from '../platform/errorLog';
import { findRestoreOffer, initCloudBackup } from '../services/backupSync';
import { copy } from './copy';
import { RestoreOfferScreen } from './screens/RestoreOfferScreen';

type State =
  | { status: 'opening'; slow: boolean }
  | { status: 'offer'; meta: CloudMeta }
  | { status: 'ok' }
  | { status: 'error'; message: string };

const SLOW_OPEN_MS = 300;

/** Starts the cloud backup and looks for a copy to offer on an empty start; never fails the open. */
async function afterOpen(): Promise<CloudMeta | null> {
  try {
    await initCloudBackup();
    return await findRestoreOffer();
  } catch (error) {
    logError(error, 'cloud backup start');
    return null;
  }
}

/**
 * Opens the database before the app renders and turns open failures (newer schema on disk,
 * quota, private mode, an upgrade from another tab) into a readable message with a reload
 * button instead of a blank screen. On an empty database inside Telegram it first offers the
 * cloud copy (RestoreOfferScreen).
 */
export function DbBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'opening', slow: false });

  useEffect(() => {
    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      setState((prev) => (prev.status === 'opening' ? { status: 'opening', slow: true } : prev));
    }, SLOW_OPEN_MS);
    openDb((message) => setState({ status: 'error', message }))
      .then(async (result: OpenResult) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: 'error', message: result.message });
          return;
        }
        const offer = await afterOpen();
        if (!cancelled) setState(offer ? { status: 'offer', meta: offer } : { status: 'ok' });
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
  if (state.status === 'offer') return <RestoreOfferScreen meta={state.meta} onDone={() => setState({ status: 'ok' })} />;
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
