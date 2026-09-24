// Points are stored as decimal numbers with at most one decimal place, but every sum,
// comparison and clamp runs on integer "deci-points" (tenths), so 0.1 + 0.2 never
// drifts (FR-XP-009, decision 14.4: tenths, half-up).

export const DECI = 10;

export function toDeci(points: number): number {
  return Math.round(points * DECI);
}

export function fromDeci(deci: number): number {
  return deci / DECI;
}

/** A valid points amount: finite, non-negative, at most one decimal place. */
export function isPoints(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && toDeci(value) === value * DECI;
}

/**
 * Points for a TIMED completion: minutes × rate per minute, rounded half-up to tenths.
 * The rate is limited to two decimals, so the product is exact in hundredths.
 * 25 × 0.25 → 6.3, 7 × 0.33 → 2.3, 1 × 0.04 → 0.
 */
export function timedPoints(minutes: number, ratePerMinute: number): number {
  const rate100 = Math.round(ratePerMinute * 100);
  const hundredths = minutes * rate100;
  return Math.floor((hundredths + 5) / 10) / DECI;
}
