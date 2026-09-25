const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/**
 * Russian plural: plural(5, ['колба', 'колбы', 'колб']) → "колб"; fractions take the genitive
 * singular ("6,3 очка"). Level nouns come from the skill's theme (progress/texts.ts levelForms).
 */
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

export function formatPoints(n: number): string {
  return `${formatNumber(n)} ${plural(n, POINTS)}`;
}

export function formatDelta(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatNumber(Math.abs(n))}`;
}

const rateFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** A TIMED step's rate: «0,5/мин», «0,25/мин» (two decimals at most, decision 14.4). */
export function formatRate(rate: number): string {
  return `${rateFormat.format(rate)}/мин`;
}

/** «30 мин»; no group separator, a duration is at most 1 440 minutes. */
export function formatMinutes(n: number): string {
  return `${n} мин`;
}

/**
 * A decimal typed on a phone: «0,5» and «0.5» both mean a half (the Russian keyboard has a
 * comma, iOS «decimal» pads may give either). Null for an empty or malformed string.
 */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
