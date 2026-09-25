import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { resolveStartPath } from '../services/queries';
import { launchStartLink } from '../platform/deeplink';
import { logError } from '../platform/errorLog';

/**
 * The app's entry (`/`, and Telegram's launch hash): «Сегодня» once an active skill has an
 * action to tap, the skills otherwise. The first route of a launch follows the launch link
 * (`startapp=skill_<id>`, platform/deeplink.ts) when it points at something on this device.
 * Asked once per visit; nothing renders until the answer is in, so the first screen never
 * flashes.
 */
export function StartRedirect() {
  // The router's initial entry has the key 'default': only it may follow the launch link.
  const first = useLocation().key === 'default';
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    resolveStartPath(first ? launchStartLink() : null).then(
      // A function would run as a state updater: only a path string is taken.
      (path) => alive && setTarget(typeof path === 'string' ? () => path : '/skills'),
      (error: unknown) => {
        logError(error, 'start');
        if (alive) setTarget('/skills');
      },
    );
    return () => {
      alive = false;
    };
  }, [first]);

  return target ? <Navigate to={target} replace /> : null;
}
