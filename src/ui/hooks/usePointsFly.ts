import { useCallback } from 'react';
import { motionMode, useMotion, type MotionMode } from './useMotion';

// «+5» flies from the ✓ to the flask before the liquid moves: the eye follows the points into
// the glass. A fixed pill over everything, WAAPI along an arc (a raised mid keyframe), 550 ms.

const DURATION = 550;
const FALLBACK_MS = 450;

function center(rect: DOMRect, dy = 0.5): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * dy };
}

/** True when some part of the element is inside the viewport. */
export function onScreen(el: Element | null | undefined): el is Element {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/**
 * Animates a `.points-pill` with `text` from `from` to `to` (aimed at the upper part of the
 * glass). Resolves at once under reduced motion or when either end is off screen.
 */
export async function flyPoints(from: Element | null | undefined, to: Element | null | undefined, text: string, motion: MotionMode = motionMode()): Promise<void> {
  if (motion === 'reduced' || !onScreen(from) || !onScreen(to) || typeof document.body.animate !== 'function') return;
  const a = center(from.getBoundingClientRect());
  const b = center(to.getBoundingClientRect(), 0.3);
  const pill = document.createElement('div');
  pill.className = 'points-pill';
  pill.setAttribute('aria-hidden', 'true');
  pill.textContent = text;
  document.body.append(pill);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // The arc rises above the straight line by a third of the distance, at least 40px.
  const lift = Math.max(40, Math.hypot(dx, dy) / 3);
  const at = (x: number, y: number, scale: number) => `translate(${a.x + x}px, ${a.y + y}px) translate(-50%, -50%) scale(${scale})`;
  const animation = pill.animate(
    [
      { transform: at(0, 0, 0.9), opacity: 0 },
      { transform: at(0, -12, 1.05), opacity: 1, offset: 0.15 },
      { transform: at(dx * 0.5, dy * 0.5 - lift, 1), opacity: 1, offset: 0.55 },
      { transform: at(dx, dy, 0.6), opacity: 0 },
    ],
    { duration: DURATION, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
  );
  await Promise.race([animation.finished.catch(() => undefined), new Promise((resolve) => window.setTimeout(resolve, DURATION + FALLBACK_MS))]);
  pill.remove();
}

/** `flyPoints` bound to the current motion mode. */
export function usePointsFly(): (from: Element | null | undefined, to: Element | null | undefined, text: string) => Promise<void> {
  const motion = useMotion();
  return useCallback((from, to, text) => flyPoints(from, to, text, motion), [motion]);
}
