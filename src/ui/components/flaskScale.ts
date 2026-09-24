// The capacity scale beside the hero flask: at most three ticks at round values (1, 2, 2,5
// or 5 times a power of ten), so a flask of 15 reads «5 · 10» rather than «3,8 · 7,5 · 11,3».
// Values are in tenths of a point, like everything the journal stores.

/** A tick of the scale: its share of the flask (0..1) and the points it stands for. */
export interface ScaleTick {
  share: number;
  value: number;
}

/** Ticks without numbers, for a flask whose capacity is not shown. */
export const PLAIN_TICKS: readonly number[] = [0.25, 0.5, 0.75];

const MAX_TICKS = 3;
/** Nothing above this share: a tick right under the rim would collide with it. */
const TOP_SHARE = 0.9;
const MULTIPLIERS = [1, 2, 2.5, 5];

/** The finest round step that leaves 1..3 ticks inside the flask, lowest first. */
export function scaleTicks(capacity: number): ScaleTick[] {
  const deci = Math.round(capacity * 10);
  if (!(deci > 1)) return [];
  const top = deci * TOP_SHARE;
  for (let power = 1; power <= deci * 10; power *= 10) {
    for (const multiplier of MULTIPLIERS) {
      const step = multiplier * power;
      if (!Number.isInteger(step)) continue;
      const count = Math.floor(top / step);
      if (count < 1) return [];
      if (count > MAX_TICKS) continue;
      return Array.from({ length: count }, (_, i) => ({ share: ((i + 1) * step) / deci, value: ((i + 1) * step) / 10 }));
    }
  }
  return [];
}
