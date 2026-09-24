import { useEffect, useState } from 'react';

/**
 * A flag that turns on only after `active` has been true for `delayMs` (so fast loads never
 * flash a skeleton) and, once on, stays on for at least `minMs` (so a skeleton never blinks).
 */
export function useDelayedFlag(active: boolean, { delayMs = 150, minMs = 300 }: { delayMs?: number; minMs?: number } = {}): boolean {
  const [shown, setShown] = useState(false);
  const [shownAt, setShownAt] = useState(0);

  useEffect(() => {
    if (active) {
      if (shown) return;
      const timer = window.setTimeout(() => {
        setShown(true);
        setShownAt(Date.now());
      }, delayMs);
      return () => window.clearTimeout(timer);
    }
    if (!shown) return;
    const remaining = Math.max(0, minMs - (Date.now() - shownAt));
    const timer = window.setTimeout(() => setShown(false), remaining);
    return () => window.clearTimeout(timer);
  }, [active, shown, shownAt, delayMs, minMs]);

  return shown;
}
