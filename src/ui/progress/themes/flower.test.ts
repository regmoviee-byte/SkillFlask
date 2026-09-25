import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { DONE_EVENT, IDLE, MAX_CYCLES, nextPhase, refillTarget, type AnimationState } from '../../components/flaskAnimation';
import {
  FOLIAGE,
  GARDEN_ROWS,
  LEAVES,
  POLE_X,
  POP_MS,
  QUICK_BLOOM_MS,
  SEED_MS,
  SPECIES,
  STEM_LENGTH,
  budScale,
  flowerFor,
  flowerTheme,
  flowerTiming,
  gardenDecor,
  gardenSlot,
  glowOpacity,
  leafScale,
  leafShape,
  phaseSpan,
  popDelay,
  seedOpacity,
  stage,
  stemDash,
  stemPoint,
  type Species,
} from './flower';

const SAMPLES = [0, 0.25, 0.5, 0.75, 0.999, 1];
const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

/** Every coordinate pair of a path (the theme draws with absolute M/L/C/Q/Z only). */
function points(d: string): [number, number][] {
  return [...d.matchAll(/(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

/** The bounding box of a bloom (its curves stay inside their control points), in bloom units × k. */
function bloomBox(sp: Species): { minX: number; maxX: number; minY: number; maxY: number } {
  const all = sp.bloom.flatMap(([, d]) => points(d)).map(([x, y]) => [x * sp.k, y * sp.k] as const);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('flower stages', () => {
  it('reads seed → sprout → leaves → bud → bloom along the fill', () => {
    expect(SAMPLES.map(stage)).toEqual(['seed', 'leaf1', 'leaf2', 'leaf3', 'bud', 'bloom']);
    expect(stage(0.1)).toBe('sprout');
    expect(stage(-1)).toBe('seed');
    expect(stage(Number.NaN)).toBe('seed');
  });

  it('draws every stem from nothing to its full length', () => {
    // An empty stem hides even its round cap: the dash ends a little before the path starts.
    expect(stemDash(0)).toBeGreaterThan(STEM_LENGTH);
    expect(stemDash(0)).toBeLessThan(STEM_LENGTH + 5);
    expect(Math.abs(stemDash(0.5) - STEM_LENGTH / 2)).toBeLessThan(2);
    for (const sp of SPECIES) {
      const dashes = SAMPLES.map((f) => stemDash(f, sp));
      expect(dashes[5]).toBe(0);
      expect(dashes[4]).toBeGreaterThan(0);
      expect(dashes[4]).toBeLessThan(1);
      for (let i = 1; i < dashes.length; i++) expect(dashes[i]!).toBeLessThan(dashes[i - 1]!);
    }
  });

  it('roots every stem in the pot and tops it at the same height', () => {
    for (const sp of SPECIES) {
      expect(stemPoint(0, sp)).toEqual({ x: 80, y: 208 });
      expect(stemPoint(1, sp).y).toBe(52);
      expect(Math.abs(stemPoint(1, sp).x - 80)).toBeLessThan(12);
    }
  });

  it('unfolds the leaves at a quarter, a half and three quarters', () => {
    expect(LEAVES.map((l) => l.at)).toEqual([0.25, 0.5, 0.75]);
    const scales = (fill: number) => LEAVES.map((l) => leafScale(fill, l.at));
    expect(scales(0)).toEqual([0, 0, 0]);
    expect(scales(0.25)[0]).toBeGreaterThan(0.5);
    expect(scales(0.25).slice(1)).toEqual([0, 0]);
    expect(scales(0.5)[0]).toBe(1);
    expect(scales(0.5)[1]).toBeGreaterThan(0.5);
    expect(scales(0.5)[2]).toBe(0);
    expect(scales(0.75).slice(0, 2)).toEqual([1, 1]);
    expect(scales(0.75)[2]).toBeGreaterThan(0.5);
    expect(scales(0.999)).toEqual([1, 1, 1]);
    expect(scales(1)).toEqual([1, 1, 1]);
  });

  it('opens a pair of seedling leaves low on the stem before the true leaves', () => {
    const [seedling, ...leaves] = FOLIAGE;
    expect(leaves).toEqual([...LEAVES]);
    expect(seedling).toEqual({ at: 0.1, side: 0 });
    expect(SAMPLES.map((f) => leafScale(f, seedling!.at))).toEqual([0, 1, 1, 1, 1, 1]);
    expect(leafScale(0.05, seedling!.at)).toBe(0);
  });

  it('forms the bud between 85 % and 95 %', () => {
    expect(SAMPLES.map(budScale)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(budScale(0.85)).toBe(0);
    expect(budScale(0.9)).toBeGreaterThan(0);
    expect(budScale(0.9)).toBeLessThan(1);
    expect(budScale(0.95)).toBe(1);
  });

  it('lights the glow only with the bud', () => {
    expect(SAMPLES.map(glowOpacity)).toEqual([0, 0, 0, 0, 0.4, 0.4]);
  });

  it('shows the seed only at the start', () => {
    expect(seedOpacity(0)).toBe(1);
    expect(seedOpacity(0.04)).toBeCloseTo(0.5, 6);
    expect(SAMPLES.slice(1).map(seedOpacity)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('flower species', () => {
  it('offers at least ten species, natural and skill-coloured by turns', () => {
    expect(SPECIES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(SPECIES.map((s) => s.key)).size).toBe(SPECIES.length);
    expect(new Set(SPECIES.map((s) => s.name)).size).toBe(SPECIES.length);
    SPECIES.forEach((sp, i) => expect(sp.skill).toBe(i % 2 === 1));
    for (const sp of SPECIES) {
      expect(sp.leaves).toHaveLength(3);
      expect(sp.bud.length).toBeGreaterThan(0);
      expect(sp.bloom.length).toBeGreaterThan(2);
    }
  });

  it('gives each species its own stem, leaf, bud and bloom', () => {
    const distinct = (f: (sp: Species) => unknown) => new Set(SPECIES.map((sp) => JSON.stringify(f(sp)))).size;
    expect(distinct((sp) => sp.stem)).toBe(SPECIES.length);
    expect(distinct((sp) => sp.leaf)).toBe(SPECIES.length);
    expect(distinct((sp) => sp.bud)).toBe(SPECIES.length);
    expect(distinct((sp) => sp.bloom)).toBe(SPECIES.length);
  });

  it('grows the curated order first: a daisy, a tulip, a sunflower…', () => {
    expect([1, 2, 3, 4, 5].map((l) => flowerFor(l).name)).toEqual(['ромашка', 'тюльпан', 'подсолнух', 'колокольчик', 'мак']);
    expect(Array.from({ length: SPECIES.length }, (_, i) => flowerFor(i + 1))).toEqual([...SPECIES]);
  });

  it('is deterministic and never repeats a neighbour', () => {
    const first = Array.from({ length: 600 }, (_, i) => flowerFor(i + 1).key);
    expect(Array.from({ length: 600 }, (_, i) => flowerFor(i + 1).key)).toEqual(first);
    for (let i = 1; i < first.length; i++) expect(first[i]).not.toBe(first[i - 1]);
  });

  it('shows every species once per round of twelve, in a new order after the first', () => {
    const n = SPECIES.length;
    const rounds = Array.from({ length: 30 }, (_, r) => Array.from({ length: n }, (_, j) => flowerFor(r * n + j + 1).key));
    for (const round of rounds) expect(new Set(round).size).toBe(n);
    expect(new Set(rounds.map((r) => r.join())).size).toBeGreaterThan(8);
    // Within a round, a natural flower and a skill-coloured one take turns.
    for (let l = 1; l < 30 * n; l++) {
      if (l % n === 0) continue;
      expect(flowerFor(l + 1).skill).not.toBe(flowerFor(l).skill);
    }
  });

  it('reads a missing or odd level as level 1', () => {
    for (const odd of [0, -3, Number.NaN, 1.7]) expect(flowerFor(odd)).toBe(SPECIES[0]);
    expect(flowerFor(2.9)).toBe(SPECIES[1]);
  });

  it('keeps every leaf clear of the scale on the left and of the pennants on the right', () => {
    for (const sp of SPECIES) {
      const [outline] = leafShape(sp.leaf);
      sp.leaves.forEach(([pos, side, size, turn]) => {
        const base = stemPoint(pos, sp);
        const t = (turn * Math.PI) / 180;
        for (const [x, y] of points(outline)) {
          const px = base.x - side * size * (x * Math.cos(t) - y * Math.sin(t));
          if (side === 1) expect(px, sp.key).toBeLessThan(POLE_X - 3);
          else expect(px, sp.key).toBeGreaterThan(42);
        }
      });
    }
  });

  it('opens every bloom inside the box, clear of the pennants', () => {
    for (const sp of SPECIES) {
      const tip = stemPoint(1, sp);
      const box = bloomBox(sp);
      expect(tip.x + box.minX, sp.key).toBeGreaterThan(42);
      expect(tip.x + box.maxX, sp.key).toBeLessThan(POLE_X);
      expect(tip.y + box.minY, sp.key).toBeGreaterThan(0);
      // Big enough to read: at least 36 units across or tall.
      expect(Math.max(box.maxX - box.minX, box.maxY - box.minY), sp.key).toBeGreaterThan(36);
    }
  });
});

describe('flower garden', () => {
  it('plants the first flowers beside the pot, then behind it, then in the meadow', () => {
    expect(GARDEN_ROWS).toEqual([6, 14, 24]);
    const rows = Array.from({ length: 40 }, (_, i) => gardenSlot(i).row);
    expect(rows.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(new Set(rows.slice(6, 14))).toEqual(new Set([1]));
    expect(new Set(rows.slice(14, 24))).toEqual(new Set([2]));
    expect(new Set(rows.slice(24))).toEqual(new Set([3]));
    // Front row beside the pot, never in front of it.
    for (let i = 0; i < 6; i++) expect(Math.abs(gardenSlot(i).x - 80)).toBeGreaterThan(40);
  });

  it('keeps a flower where it was planted', () => {
    const before = Array.from({ length: 200 }, (_, i) => gardenSlot(i));
    expect(Array.from({ length: 200 }, (_, i) => gardenSlot(i))).toEqual(before);
    const clear = before.slice(0, 24).map((s) => `${s.x},${s.y}`);
    expect(new Set(clear).size).toBe(24);
    expect(gardenSlot(-2)).toEqual(gardenSlot(0));
    expect(gardenSlot(Number.NaN)).toEqual(gardenSlot(0));
  });

  it('keeps every garden bloom inside the box and below the scale', () => {
    for (let i = 0; i < 24; i++) {
      const slot = gardenSlot(i);
      const box = bloomBox(flowerFor(i + 1));
      expect(slot.x + box.minX * slot.b, `slot ${i}`).toBeGreaterThanOrEqual(0);
      expect(slot.x + box.maxX * slot.b, `slot ${i}`).toBeLessThanOrEqual(160);
      // Clear of the capacity scale's lowest label (y 163–175, left of x 42).
      const top = slot.y - slot.h + box.minY * slot.b;
      expect(top, `slot ${i}`).toBeGreaterThan(slot.x + box.minX * slot.b < 44 ? 176 : 170);
      expect(slot.y, `slot ${i}`).toBeLessThanOrEqual(256);
      // Nearer rows stand lower and bloom bigger.
      expect(slot.b).toBe([0.34, 0.28, 0.23][slot.row]);
    }
    for (let i = 24; i < 400; i++) {
      const { x, y, b } = gardenSlot(i);
      const r = 26 * b;
      expect(x - r).toBeGreaterThanOrEqual(0);
      expect(x + r).toBeLessThanOrEqual(160);
      expect(y - r).toBeGreaterThan(170);
      expect(y + r).toBeLessThan(204);
    }
  });

  it('spreads the meadow wider as it grows', () => {
    const spread = (from: number, to: number) => {
      const xs = Array.from({ length: to - from }, (_, i) => gardenSlot(from + i).x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(24, 34)).toBeLessThan(110);
    expect(spread(80, 120)).toBeGreaterThan(130);
  });

  it('counts rows, meadow and furniture by the number of flowers', () => {
    expect(gardenDecor(0)).toEqual({ rows: 0, meadow: 0, border: false, fence: false, can: false, butterfly: false });
    expect([1, 6, 7, 14, 15, 24, 25, 69].map((n) => gardenDecor(n).rows)).toEqual([1, 1, 2, 2, 3, 3, 3, 3]);
    expect([24, 25, 69, 200].map((n) => gardenDecor(n).meadow)).toEqual([0, 1, 45, 176]);
    expect([2, 3].map((n) => gardenDecor(n).butterfly)).toEqual([false, true]);
    expect([3, 4].map((n) => gardenDecor(n).border)).toEqual([false, true]);
    expect([7, 8].map((n) => gardenDecor(n).fence)).toEqual([false, true]);
    expect([19, 20].map((n) => gardenDecor(n).can)).toEqual([false, true]);
  });
});

describe('flower marks', () => {
  it('climb the column right of the plant monotonically and stay inside the box', () => {
    let lastY = Number.POSITIVE_INFINITY;
    for (let h = 0; h <= 1.0001; h += 0.05) {
      const { x, y } = flowerTheme.markPoint(h);
      expect(x).toBe(POLE_X);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(260);
      expect(y).toBeLessThanOrEqual(lastY);
      lastY = y;
    }
    expect(flowerTheme.markPoint(0).y).toBeGreaterThan(flowerTheme.markPoint(1).y + 100);
    expect(flowerTheme.markPoint(-3)).toEqual(flowerTheme.markPoint(0));
    expect(flowerTheme.markPoint(7)).toEqual(flowerTheme.markPoint(1));
  });

  it('stay above the garden and below the flower head', () => {
    expect(flowerTheme.markPoint(0).y).toBeLessThan(176);
    expect(flowerTheme.markPoint(1).y).toBeGreaterThan(stemPoint(1).y + 12);
  });
});

describe('flower text', () => {
  const { text } = flowerTheme;

  it('names the levels in every form', () => {
    expect(text.name).toBe('Цветок');
    expect(`${text.levelNoun} 3`).toBe('Цветок 3');
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до цветка 4');
    expect([1, 2, 5, 11, 21].map((n) => `${n} ${plural(n, text.levelForms)}`)).toEqual(['1 цветок', '2 цветка', '5 цветков', '11 цветков', '21 цветок']);
    expect([1, 2, 5, 11, 21].map((n) => `из ${n} ${plural(n, text.levelFormsOf)}`)).toEqual(['из 1 цветка', 'из 2 цветков', 'из 5 цветков', 'из 11 цветков', 'из 21 цветка']);
    expect(text.completed(3)).toBe('Цветок 3 распустился');
    expect(text.fillLabel(45)).toBe('Цветок вырос на 45%');
    expect(text.hint).toBe('Из зёрнышка растёт цветок');
  });

  it('keeps the tone: no forbidden words, no exclamation marks', () => {
    const strings = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.completed(7), text.fillLabel(100), text.hint, ...SPECIES.map((s) => s.name)];
    for (const s of strings) {
      expect(s).not.toMatch(FORBIDDEN);
      expect(s).not.toContain('!');
    }
  });

  it('is registered under its key and available', () => {
    expect(flowerTheme.key).toBe('flower');
    expect(flowerTheme.available).toBe(true);
  });
});

describe('flower choreography', () => {
  /** Runs the flask's machine with the flower's clock, summing each cycle's time. */
  function play(levels: number, toFill = 0.2): { phases: string[]; cycles: number[]; targets: number[] } {
    let state = nextPhase(IDLE, { type: 'start', levels });
    const phases: string[] = [];
    const cycles: number[] = [];
    const targets: number[] = [];
    for (let guard = 0; state.phase !== 'idle' && guard < 50; guard++) {
      phases.push(state.cycle > 0 ? `${state.phase}*` : state.phase);
      const target = refillTarget(state, toFill);
      if (state.phase === 'refilling') targets.push(target);
      cycles[state.cycle] = (cycles[state.cycle] ?? 0) + phaseSpan(state, target);
      state = nextPhase(state, { type: DONE_EVENT[state.phase] } as never);
    }
    return { phases, cycles, targets };
  }

  it('grows, blooms, transplants and sprouts again for one level', () => {
    const { phases, targets } = play(1);
    expect(phases).toEqual(['rising', 'overflow', 'draining', 'refilling']);
    expect(targets).toEqual([0.2]);
  });

  it('repeats transplant → sprout compressed for more levels, at most three cycles', () => {
    expect(play(2).targets).toEqual([1, 0.2]);
    const { phases, targets, cycles } = play(7);
    expect(phases.filter((p) => p.startsWith('draining'))).toHaveLength(MAX_CYCLES);
    expect(targets).toEqual([1, 1, 0.2]);
    expect(cycles).toHaveLength(MAX_CYCLES);
  });

  it('plans 1.1 s for one level, leaving headroom under the 1.2 s budget', () => {
    for (const toFill of [0, 0.2, 0.5, 0.999]) {
      const total = play(1, toFill).cycles.reduce((sum, ms) => sum + ms, 0);
      expect(total).toBeLessThanOrEqual(1100);
    }
  });

  it('keeps every level within 1.2 s, whatever fill the last one grows to', () => {
    for (const levels of [1, 2, 3, 7]) {
      for (const toFill of [0, 0.2, 0.5, 0.999]) {
        const { cycles } = play(levels, toFill);
        const total = cycles.reduce((sum, ms) => sum + ms, 0);
        expect(total).toBeLessThanOrEqual(1100 * Math.min(levels, MAX_CYCLES));
        for (const ms of cycles.slice(1)) expect(ms).toBeLessThanOrEqual(1100);
      }
    }
  });

  it('counts the seed and the quick bloom in a sprout’s span', () => {
    const rise: AnimationState = { phase: 'rising', cyclesLeft: 1, cycle: 0 };
    expect(phaseSpan(rise, 0.2)).toBe(flowerTiming(rise).duration);
    const sprout: AnimationState = { phase: 'refilling', cyclesLeft: 2, cycle: 0 };
    expect(phaseSpan(sprout, 1)).toBe(SEED_MS + flowerTiming(sprout).duration + QUICK_BLOOM_MS);
    const last: AnimationState = { phase: 'refilling', cyclesLeft: 1, cycle: 2 };
    expect(phaseSpan(last, 0.2)).toBe(SEED_MS + flowerTiming(last).duration);
    const bloom: AnimationState = { phase: 'overflow', cyclesLeft: 1, cycle: 0 };
    expect(phaseSpan(bloom, 0.2)).toBe(flowerTiming(bloom).duration);
  });

  it('pops every leaf inside its grow', () => {
    for (const duration of [100, 200, 220]) {
      for (const share of [-0.5, 0, 0.3, 0.8, 1, 2]) {
        const delay = popDelay(share, duration);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay + Math.min(POP_MS, duration)).toBeLessThanOrEqual(duration);
      }
    }
    expect(popDelay(0.1, 1000)).toBeLessThan(popDelay(0.6, 1000));
    // A leaf high on the stem waits for the tip in a normal sprout.
    expect(popDelay(0.9, 220)).toBeGreaterThan(50);
  });

  it('compresses the repeated phases', () => {
    const first: AnimationState = { phase: 'draining', cyclesLeft: 2, cycle: 0 };
    const later: AnimationState = { phase: 'draining', cyclesLeft: 1, cycle: 1 };
    expect(flowerTiming(first).duration).toBeGreaterThan(flowerTiming(later).duration);
    expect(flowerTiming({ ...first, phase: 'refilling' }).duration).toBeGreaterThan(flowerTiming({ ...later, phase: 'refilling' }).duration);
    expect(flowerTiming(IDLE)).toEqual({ delay: 0, duration: 0, easing: 'out' });
    expect(flowerTiming({ phase: 'overflow', cyclesLeft: 1, cycle: 0 }).easing).toBe('spring');
  });
});
