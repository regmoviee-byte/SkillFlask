import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { hasActiveSteps } from '../services/queries';
import { logError } from '../platform/errorLog';

/**
 * The app's entry (`/`): «Сегодня» once an active skill has an action to tap, the skills
 * otherwise. Asked once per visit of `/`; nothing renders until the answer is in, so the
 * first screen never flashes.
 */
export function StartRedirect() {
  const [target, setTarget] = useState<'/today' | '/skills' | null>(null);

  useEffect(() => {
    let alive = true;
    hasActiveSteps().then(
      (has) => alive && setTarget(has ? '/today' : '/skills'),
      (error: unknown) => {
        logError(error, 'start');
        if (alive) setTarget('/skills');
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return target ? <Navigate to={target} replace /> : null;
}
