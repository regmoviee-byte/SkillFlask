// Single source of "now" for services and tests. Tests replace it with `setClock`.

let clock: (() => Date) | null = null;
let lastNow = 0;

/** Overrides the current time (tests only); `null` restores the real clock. */
export function setClock(fn: (() => Date) | null): void {
  clock = fn;
  lastNow = 0;
}

/** The current time from the injectable clock. */
export function nowDate(): Date {
  return clock ? clock() : new Date();
}

const now = nowDate;

/** Local calendar date as YYYY-MM-DD, using the device time zone (FR-TD-006). */
export function localDate(date: Date = now()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Current time as ISO string, strictly increasing within the session so that journal
 * entries created in the same millisecond still replay in the order they were written.
 */
export function nowIso(): string {
  lastNow = Math.max(now().getTime(), lastNow + 1);
  return new Date(lastNow).toISOString();
}
