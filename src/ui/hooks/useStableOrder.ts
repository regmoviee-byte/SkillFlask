import { useRef } from 'react';

/**
 * Keeps rows where they were while the screen stays open. The read model sorts «Сегодня» by
 * recent use, so a tap on ✓ would move its row under the next tap; here the first order
 * seen is kept, rows that disappear drop out and new ones join at the end. The next visit
 * starts from the read model's order again.
 */
export function useStableOrder<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const order = useRef<string[] | null>(null);
  const keys = items.map(keyOf);
  if (order.current === null) {
    order.current = keys;
  } else {
    const present = new Set(keys);
    const known = new Set(order.current);
    // Idempotent for the same input, so a repeated render (StrictMode) gives the same order.
    order.current = [...order.current.filter((k) => present.has(k)), ...keys.filter((k) => !known.has(k))];
  }
  const index = new Map(order.current.map((k, i) => [k, i]));
  return [...items].sort((a, b) => index.get(keyOf(a))! - index.get(keyOf(b))!);
}
