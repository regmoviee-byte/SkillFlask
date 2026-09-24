import { API, tgCall } from './telegram';

// The only place HapticFeedback is called. Each verb maps to a Telegram pattern inside the
// client and to navigator.vibrate outside (Android browsers; iOS Safari ignores it).
// Multi-step patterns use module-level timers so a screen change can cancel them.

const STORAGE_KEY = 'sf_haptics';
const timers = new Set<number>();

function enabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Persists the «Вибро-отклик» switch (Settings, package 4). */
export function setHapticsEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'off');
  } catch {
    // Private mode: the switch simply does not persist.
  }
}

export const isHapticsEnabled = enabled;

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some WebViews expose vibrate but reject it without a user gesture.
  }
}

type Impact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type Notification = 'success' | 'warning' | 'error';

function native(fn: (h: NonNullable<ReturnType<typeof getHaptics>>) => void, fallback: number | number[]): void {
  if (!enabled()) return;
  const done = tgCall(API.haptics, (tg) => {
    fn(tg.HapticFeedback);
    return true;
  });
  if (!done) vibrate(fallback);
}

function getHaptics() {
  return tgCall(API.haptics, (tg) => tg.HapticFeedback);
}

function later(ms: number, fn: () => void): void {
  const id = window.setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
}

const impact = (style: Impact, fallback: number | number[]) => native((h) => h.impactOccurred(style), fallback);
const notify = (type: Notification, fallback: number | number[]) => native((h) => h.notificationOccurred(type), fallback);

export const haptics = {
  /** Changing a selection: tab, segmented control, radio. */
  select(): void {
    native((h) => h.selectionChanged(), [5]);
  },
  /** A light tap: opening a sheet, a chip. */
  tap(): void {
    impact('light', [8]);
  },
  /** A committed press: a ✓ on an action. */
  press(): void {
    impact('medium', [15]);
  },
  success(): void {
    notify('success', [20]);
  },
  /** A flask filled: heavy impact, then success, repeated for multi-level fills (≤ 3). */
  levelUp(levels = 1): void {
    if (!enabled()) return;
    const repeats = Math.max(1, Math.min(3, levels));
    if (!getHaptics()) {
      vibrate([30, 60, 40]);
      return;
    }
    impact('heavy', []);
    later(140, () => notify('success', []));
    for (let i = 1; i < repeats; i++) later(140 + i * 220, () => impact('heavy', []));
  },
  milestone(): void {
    if (!enabled()) return;
    if (!getHaptics()) {
      vibrate([40, 80, 40, 80, 60]);
      return;
    }
    impact('rigid', []);
    later(200, () => notify('success', []));
    later(450, () => notify('success', []));
  },
  warning(): void {
    notify('warning', [20, 40, 20]);
  },
  error(): void {
    notify('error', [40, 40, 40]);
  },
  /** Cancels queued multi-step patterns (e.g. when the screen changes). */
  cancel(): void {
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
  },
};
