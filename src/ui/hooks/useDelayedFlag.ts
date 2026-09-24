import { useEffect, useRef, useState } from 'react';

/**
 * A flag that turns on only after `active` has been true for `delayMs` (so fast loads never
 * flash a skeleton) and, once on, stays on for at least `minMs` (so a skeleton never blinks).
 */
export function useDelayedFlag(active: boolean, { delayMs = 150, minMs = 300 }: { delayMs?: number; minMs?: number } = {}): boolean {
  const [shown, setShown] = useState(false);
  const [shownAt, setShownAt] = useState(0);
  // The latest value as rendered: a timer that fires after a render turned `active` off, but
  // before that render's effects ran (a busy main thread), must not switch the flag on.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (active) {
      if (shown) return;
      const timer = window.setTimeout(() => {
        if (!activeRef.current) return;
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
