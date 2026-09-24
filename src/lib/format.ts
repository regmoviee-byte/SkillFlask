const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Russian plural: plural(5, ['колба', 'колбы', 'колб']) → "колб". */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export const POINTS: [string, string, string] = ['очко', 'очка', 'очков'];
export const FLASKS: [string, string, string] = ['колба', 'колбы', 'колб'];

export function formatPoints(n: number): string {
  return `${formatNumber(n)} ${plural(n, POINTS)}`;
}

export function formatDelta(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatNumber(Math.abs(n))}`;
}
