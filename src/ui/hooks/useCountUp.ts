import { useEffect, useRef, useState } from 'react';
import { useMotion } from './useMotion';

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Animates a number towards `value` with requestAnimationFrame; returns `value` directly under reduced motion. */
export function useCountUp(value: number, { duration = 600 }: { duration?: number } = {}): number {
  const motion = useMotion();
  const [shown, setShown] = useState(value);
  // The number currently on screen: a value change mid-animation continues from it, never jumps back.
  const shownRef = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    if (motion === 'reduced' || typeof requestAnimationFrame !== 'function') {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = shownRef.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const next = t < 1 ? origin + (value - origin) * easeOut(t) : value;
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration, motion]);

  return motion === 'reduced' ? value : shown;
}
