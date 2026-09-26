import { useEffect } from 'react';
import { logError } from '../../platform/errorLog';
import { takeReturns } from '../../services/pauses';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { useToday } from '../hooks/useToday';

// «Гитара снова в плане» (v0.5 package 18): a pause ends by itself after its last day, and the
// first open of the app after it says so once, gently. The check runs at start, when the day
// changes while the app is open and when it comes back to the foreground on another day
// (useToday), a moment after the first screen so the start's redirect does not sweep the toast
// away. takeReturns marks what it told, so a second run — StrictMode, another tab — finds nothing.

/** Lets the start redirect and the first screen settle before the toast. */
const DELAY_MS = 800;

/** One check per day at a time: StrictMode's second effect shares the first one's answer. */
const pending = new Map<string, Promise<string[]>>();
/** The checks whose answer is already on screen: a shared answer is told once. */
const told = new WeakSet<Promise<string[]>>();

function returnsOf(today: string): Promise<string[]> {
  let check = pending.get(today);
  if (!check) {
    check = takeReturns(today).then(
      (back) => back.map((skill) => skill.name),
      (error: unknown) => {
        logError(error, 'takeReturns');
        return [];
      },
    );
    pending.set(today, check);
    void check.finally(() => window.setTimeout(() => pending.delete(today), DELAY_MS));
  }
  return check;
}

export function PauseReturns() {
  const today = useToday();
  const { showToast } = useToast();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const check = returnsOf(today);
      // Told even when this effect is gone by then (midnight, a remount): takeReturns has already
      // marked the pauses as told, so a dropped answer would be lost for good. The toast lives in
      // the provider, which outlives this effect.
      void check.then((names) => {
        if (told.has(check)) return;
        told.add(check);
        if (names.length > 0) showToast(copy.pause.back(...names), { icon: 'play' });
      });
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [today, showToast]);
  return null;
}
