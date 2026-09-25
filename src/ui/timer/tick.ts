import { useEffect, useState } from 'react';
import { nowDate } from '../../lib/clock';

// One interval for everything that shows a running timer (the pill and the sheet): it ticks
// once a second while someone listens and the page is visible, and stops otherwise. The
// digits are always recomputed from the timer's timestamps with the injectable clock, so a
// stopped interval (a hidden page, a sleeping WebView) never loses time — the first tick after
// it comes back simply shows the right number.

const listeners = new Set<() => void>();
let interval: number | undefined;
let visibilityBound = false;

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function sync(): void {
  const want = listeners.size > 0 && visible();
  if (want && interval === undefined) interval = window.setInterval(() => listeners.forEach((cb) => cb()), 1000);
  else if (!want && interval !== undefined) {
    window.clearInterval(interval);
    interval = undefined;
  }
}

function onVisibility(): void {
  // Back in front: show the right time at once, then tick again.
  if (visible()) listeners.forEach((cb) => cb());
  sync();
}

function subscribe(cb: () => void): () => void {
  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true;
    document.addEventListener('visibilitychange', onVisibility);
  }
  listeners.add(cb);
  sync();
  return () => {
    listeners.delete(cb);
    sync();
  };
}

/** The current time in ms, re-read every second while `running`; read once otherwise (a paused timer does not move). */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => nowDate().getTime());
  useEffect(() => {
    const read = () => setNow(nowDate().getTime());
    read();
    return running ? subscribe(read) : undefined;
  }, [running]);
  return now;
}
