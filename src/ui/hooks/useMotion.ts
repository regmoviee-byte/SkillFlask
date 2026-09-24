import { useSyncExternalStore } from 'react';

// html[data-motion="reduced"] when the system asks for reduced motion OR the user chose it in
// Settings (setting `motion`, package 4 adds the toggle). CSS in motion.css does the rest;
// components that animate in JS read useMotion().

export type MotionMode = 'full' | 'reduced';
export type MotionPreference = 'system' | 'full' | 'reduced';

let preference: MotionPreference = 'system';
let current: MotionMode = 'full';
const listeners = new Set<() => void>();
let watching = false;

function mediaQuery(): MediaQueryList | undefined {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
}

function compute(): MotionMode {
  if (preference !== 'system') return preference;
  return mediaQuery()?.matches ? 'reduced' : 'full';
}

/** Recomputes the mode and reflects it on <html>. */
export function applyMotion(): MotionMode {
  const next = compute();
  const root = document.documentElement;
  if (next === 'reduced') root.dataset.motion = 'reduced';
  else delete root.dataset.motion;
  if (next !== current) {
    current = next;
    listeners.forEach((cb) => cb());
  }
  if (!watching) {
    watching = true;
    mediaQuery()?.addEventListener?.('change', () => applyMotion());
  }
  return next;
}

/** Called by Settings (package 4) and at start-up with the stored setting. */
export function setMotionPreference(next: MotionPreference): void {
  preference = next;
  applyMotion();
}

export function motionMode(): MotionMode {
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useMotion(): MotionMode {
  return useSyncExternalStore(subscribe, () => current, () => 'full');
}
