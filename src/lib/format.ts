const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Russian plural: plural(5, ['колба', 'колбы', 'колб']) → "колб"; fractions take the genitive singular ("6,3 очка"). */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  if (!Number.isInteger(n)) return few;
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export const POINTS: [string, string, string] = ['очко', 'очка', 'очков'];
export const FLASKS: [string, string, string] = ['колба', 'колбы', 'колб'];
/** Genitive after «из»: «из 1 колбы», «из 3 колб», «из 21 колбы». */
export const FLASKS_OF: [string, string, string] = ['колбы', 'колб', 'колб'];

export function formatPoints(n: number): string {
  return `${formatNumber(n)} ${plural(n, POINTS)}`;
}

export function formatDelta(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatNumber(Math.abs(n))}`;
}
