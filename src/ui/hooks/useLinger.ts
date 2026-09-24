import { useEffect, useReducer, useRef } from 'react';

/**
 * Keeps a row that just left a list on screen for `ms`, in its old place: on «Сегодня» a
 * step completed from «Осталось» shows its green ✓ before it moves to «Сделано», instead of
 * vanishing under the finger. A row that comes back stops leaving. Pair it with useStableOrder
 * (the input order is kept; leaving rows sit after the row that preceded them).
 */
export function useLinger<T>(items: readonly T[], keyOf: (item: T) => string, ms: number): Array<{ item: T; leaving: boolean }> {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const shown = useRef<{ key: string; item: T }[]>([]);
  const leaving = useRef(new Map<string, number>());
  const now = Date.now();

  const present = new Set(items.map(keyOf));
  for (const row of shown.current) {
    if (!present.has(row.key) && !leaving.current.has(row.key)) leaving.current.set(row.key, now + ms);
  }
  for (const [key, until] of leaving.current) {
    if (present.has(key) || until <= now) leaving.current.delete(key);
  }

  const result: { key: string; item: T; leaving: boolean }[] = items.map((item) => ({ key: keyOf(item), item, leaving: false }));
  let previous: string | null = null;
  for (const row of shown.current) {
    if (leaving.current.has(row.key)) {
      const at = previous === null ? 0 : result.findIndex((r) => r.key === previous) + 1;
      result.splice(at, 0, { ...row, leaving: true });
    }
    previous = row.key;
  }
  shown.current = result.map(({ key, item }) => ({ key, item }));

  const next = Math.min(...leaving.current.values());
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(rerender, Math.max(0, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [next]);

  return result.map(({ item, leaving: isLeaving }) => ({ item, leaving: isLeaving }));
}
