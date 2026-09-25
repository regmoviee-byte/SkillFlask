import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { DONE_EVENT, IDLE, nextPhase, refillTarget, type AnimationState } from '../../components/flaskAnimation';
import {
  BEAT_MS,
  CHICK_MAX,
  CHICK_MIN,
  CRACK_L_LEN,
  CRACK_R_LEN,
  FAR_HENS,
  FLOCK_MAX,
  HEN_FEET,
  HEN_HALF,
  HEN_HEIGHT,
  NEAR_HENS,
  PLUMES,
  POSE_PARTS,
  TOP,
  WANDER,
  WANDER_PATTERNS,
  WANDER_REACH,
  YARD_LEFT,
  YARD_RIGHT,
  captionPad,
  captionYs,
  chickOpacity,
  chickPose,
  chickScale,
  chickStage,
  chickTheme,
  chickTiming,
  crackProgress,
  hatchProgress,
  henLook,
  henSlot,
  henWander,
  hensBefore,
  joinPath,
  levelUpSpan,
  refillSpans,
  riseDuration,
  wanderAt,
  wanderCss,
  yardLayout,
} from './chick';

const FILLS = [0, 0.25, 0.5, 0.75, 0.999, 1];
const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

describe('chick stages', () => {
  it('reads egg → cracks → hatching → chick → hen at the rule’s checkpoints', () => {
    expect(FILLS.map(chickStage)).toEqual(['egg', 'cracks', 'hatching', 'chick', 'chick', 'hen']);
    expect(chickStage(0.249)).toBe('egg');
    expect(chickStage(0.499)).toBe('cracks');
    expect(chickStage(0.749)).toBe('hatching');
    expect(chickStage(-1)).toBe('egg');
    expect(chickStage(Number.NaN)).toBe('egg');
    expect(chickStage(7)).toBe('hen');
  });

  it('grows the cracks over the second quarter', () => {
    expect(FILLS.map(crackProgress)).toEqual([0, 0, 1, 1, 1, 1]);
    expect(crackProgress(0.375)).toBeCloseTo(0.5);
  });

  it('hatches in the third quarter', () => {
    expect(FILLS.map(hatchProgress)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(hatchProgress(0.6)).toBeGreaterThan(0.4);
    expect(hatchProgress(0.6)).toBeLessThan(0.5);
  });

  it('grows the chick in the last quarter and swaps it for the hen at 1', () => {
    expect(FILLS.map(chickScale)).toEqual([CHICK_MIN, CHICK_MIN, CHICK_MIN, CHICK_MIN, expect.closeTo(CHICK_MAX, 2), CHICK_MAX]);
    expect(chickScale(0.875)).toBeCloseTo((CHICK_MIN + CHICK_MAX) / 2);
    expect(FILLS.map(chickOpacity)).toEqual([0, 0, 0, 1, 1, 0]);
  });

  it('poses every part at the checkpoints', () => {
    for (const f of FILLS) {
      const pose = chickPose(f);
      expect(Object.keys(pose).sort()).toEqual([...POSE_PARTS].sort());
      for (const part of POSE_PARTS) {
        const { opacity, dash } = pose[part];
        if (opacity !== undefined) expect(opacity).toBeGreaterThanOrEqual(0);
        if (opacity !== undefined) expect(opacity).toBeLessThanOrEqual(1);
        if (dash !== undefined) expect(dash).toBeGreaterThanOrEqual(0);
      }
    }
    // A whole egg, no cracks.
    expect(chickPose(0).crackR.dash).toBeCloseTo(CRACK_R_LEN, 1);
    expect(chickPose(0).crackL.dash).toBeCloseTo(CRACK_L_LEN, 1);
    expect(chickPose(0).whole.opacity).toBe(1);
    expect(chickPose(0.25).shell.opacity).toBe(1);
    // Fully cracked, the lid still closed.
    expect(chickPose(0.5).crackR.dash).toBe(0);
    expect(chickPose(0.5).crackL.dash).toBe(0);
    expect(chickPose(0.5).lid.transform).toBe('translate(0px, 0px) rotate(0deg)');
    // The chick stands; the shells are gone.
    expect(chickPose(0.75).shell.opacity).toBe(0);
    expect(chickPose(0.75).chick.opacity).toBe(1);
    expect(chickPose(0.999).chick.transform).toContain(`scale(${CHICK_MAX})`);
    // The straw band on the stake carries the fill from the ground up.
    expect(FILLS.map((f) => chickPose(f).band.transform)).toEqual(['scale(1, 0)', 'scale(1, 0.25)', 'scale(1, 0.5)', 'scale(1, 0.75)', 'scale(1, 1)', 'scale(1, 1)']);
    expect(chickPose(0.1).knot.transform).not.toBe(chickPose(0.2).knot.transform);
    // The hen alone at the beat.
    expect(chickPose(1).hen.opacity).toBe(1);
    expect(chickPose(1).chick.opacity).toBe(0);
    expect(chickPose(0.999).hen.opacity).toBe(0);
  });

  it('keeps every transform in one function list so transitions interpolate', () => {
    const shape = (t: string | undefined) => t?.replace(/-?[\d.]+/g, '#');
    for (const part of ['lid', 'head', 'chick', 'hen', 'band', 'knot'] as const) {
      const shapes = new Set([0, 0.3, 0.6, 0.8, 1].map((f) => shape(chickPose(f)[part].transform)));
      expect(shapes.size, part).toBe(1);
    }
  });
});

describe('chick marks', () => {
  const { markPoint } = chickTheme;

  it('rise monotonically along the stake and stay inside the box', () => {
    let last = Infinity;
    for (let i = 0; i <= 100; i++) {
      const { x, y } = markPoint(i / 100);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(160);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(260);
      expect(y).toBeLessThan(last);
      last = y;
    }
    expect(markPoint(-1)).toEqual(markPoint(0));
    expect(markPoint(2)).toEqual(markPoint(1));
  });

  it('keeps neighbouring captions and their tap areas apart', () => {
    const ys = captionYs([130, 118, 125, 40]);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) expect((sorted[k]! - sorted[k - 1]!) * (140 / 160)).toBeGreaterThanOrEqual(24);
    // A button is 16 px of text plus its padding on both sides; neighbours never overlap.
    const half = (i: number) => 8 + captionPad(ys, i);
    for (let i = 0; i < ys.length; i++) {
      for (let j = i + 1; j < ys.length; j++) expect(half(i) + half(j)).toBeLessThanOrEqual(Math.abs(ys[i]! - ys[j]!) * (140 / 160) + 0.5);
    }
    expect(captionPad([100], 0)).toBe(14);
  });
});

describe('chick text', () => {
  const { text } = chickTheme;

  it('names the levels', () => {
    expect(text.name).toBe('Цыплёнок');
    expect(text.completed(3)).toBe('Цыплёнок 3 вырос');
    expect(text.fillLabel(45)).toBe('Цыплёнок вырос на 45%');
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до цыплёнка 4');
  });

  it('counts chicks with plural()', () => {
    const count = (n: number) => `${n} ${plural(n, text.levelForms)}`;
    expect([1, 2, 5, 11, 21].map(count)).toEqual(['1 цыплёнок', '2 цыплёнка', '5 цыплят', '11 цыплят', '21 цыплёнок']);
    const of = (n: number) => `из ${n} ${plural(n, text.levelFormsOf)}`;
    expect([1, 2, 5, 11, 21].map(of)).toEqual(['из 1 цыплёнка', 'из 2 цыплят', 'из 5 цыплят', 'из 11 цыплят', 'из 21 цыплёнка']);
  });

  it('is calm: no forbidden words, no exclamation marks', () => {
    const strings = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.completed(7), text.fillLabel(50), text.hint];
    expect(strings.filter((s) => FORBIDDEN.test(s) || s.includes('!'))).toEqual([]);
  });

  it('is available', () => {
    expect(chickTheme.key).toBe('chick');
    expect(chickTheme.available).toBe(true);
  });
});

describe('chick choreography', () => {
  /** The phases the hero walks through for `levels`, with the refill target of each. */
  function script(levels: number, toFill: number): string[] {
    const out: string[] = [];
    let state: AnimationState = nextPhase(IDLE, { type: 'start', levels });
    while (state.phase !== 'idle') {
      out.push(state.phase === 'refilling' ? `refilling→${refillTarget(state, toFill)}` : state.phase);
      state = nextPhase(state, { type: DONE_EVENT[state.phase] } as Parameters<typeof nextPhase>[1]);
    }
    return out;
  }

  it('rises, becomes a hen, walks off and refills', () => {
    expect(script(1, 0.2)).toEqual(['rising', 'overflow', 'draining', 'refilling→0.2']);
  });

  it('compresses many levels into three cycles, then lands on toFill', () => {
    expect(script(5, 0.4)).toEqual(['rising', 'overflow', 'draining', 'refilling→1', 'draining', 'refilling→1', 'draining', 'refilling→0.4']);
  });

  it('times the phases', () => {
    expect(riseDuration(0.9)).toBe(190);
    expect(riseDuration(0)).toBe(460);
    expect(chickTiming({ phase: 'overflow', cyclesLeft: 1, cycle: 0 }, 0.9, 0.2)).toEqual({ delay: 0, duration: BEAT_MS });
    expect(chickTiming({ phase: 'draining', cyclesLeft: 1, cycle: 0 }, 0.9, 0.2)).toEqual({ delay: 40, duration: 300 });
    expect(chickTiming({ phase: 'draining', cyclesLeft: 1, cycle: 1 }, 0.9, 0.2).duration).toBeLessThan(300);
    expect(refillSpans({ phase: 'refilling', cyclesLeft: 1, cycle: 0 }, 0.2)).toEqual({ egg: 140, grow: 60, swap: 0 });
    // More levels follow: the new chick grows to the brim and turns into a hen at once.
    expect(refillSpans({ phase: 'refilling', cyclesLeft: 2, cycle: 1 }, 1)).toEqual({ egg: 100, grow: Math.round(260 * TOP), swap: 140 });
  });

  it('stays within 1.2 s per level', () => {
    expect(levelUpSpan(1, 0.9, 0.2)).toBeLessThanOrEqual(1200);
    for (const levels of [2, 3, 10]) expect(levelUpSpan(levels, 0.9, 0.5)).toBeLessThanOrEqual(1200 * Math.min(levels, 3));
    // Compressed: ten levels take no longer than three.
    expect(levelUpSpan(10, 0.9, 0.5)).toBe(levelUpSpan(3, 0.9, 0.5));
  });
});

describe('chick yard: the flock of past levels', () => {
  const all = Array.from({ length: 120 }, (_, i) => henSlot(i));

  it('holds one hen per level before the current one', () => {
    expect([undefined, 0, 1, 2, 5, 2.7, Number.NaN, Number.POSITIVE_INFINITY, -3].map(hensBefore)).toEqual([0, 0, 0, 1, 4, 1, 0, 0, 0]);
    for (const level of [1, 2, 5, 11, 12, 25, 26, 27, 60, 100]) {
      const n = hensBefore(level);
      const yard = yardLayout(n);
      expect(yard.near.length, `level ${level}`).toBe(Math.min(n, NEAR_HENS));
      expect(yard.far.length, `level ${level}`).toBe(Math.min(Math.max(n - NEAR_HENS, 0), FAR_HENS));
      expect(yard.flock.length, `level ${level}`).toBe(Math.min(Math.max(n - NEAR_HENS - FAR_HENS, 0), FLOCK_MAX));
    }
    expect(yardLayout(-4)).toEqual({ near: [], far: [], flock: [] });
    expect(yardLayout(Number.NaN)).toEqual({ near: [], far: [], flock: [] });
  });

  it('moves into a farther, smaller row at the thresholds', () => {
    expect([0, NEAR_HENS - 1, NEAR_HENS, NEAR_HENS + FAR_HENS - 1, NEAR_HENS + FAR_HENS, 99].map((i) => henSlot(i).row)).toEqual(['near', 'near', 'far', 'far', 'flock', 'flock']);
    const scales = (row: string) => all.filter((s) => s.row === row).map((s) => s.scale);
    const ys = (row: string) => all.filter((s) => s.row === row).map((s) => s.y);
    expect(Math.min(...scales('near'))).toBeGreaterThan(Math.max(...scales('far')));
    expect(Math.min(...scales('far'))).toBeGreaterThan(Math.max(...scales('flock')));
    // Farther back is higher up the yard.
    expect(Math.min(...ys('near'))).toBeGreaterThan(Math.max(...ys('far')));
    expect(Math.min(...ys('far'))).toBeGreaterThan(Math.max(...ys('flock')));
    // Near hens stand about 12–18 px tall on the 140 px hero, far ones smaller still.
    const px = (scale: number) => HEN_HEIGHT * scale * (140 / 160);
    for (const s of scales('near')) expect(px(s)).toBeGreaterThanOrEqual(12), expect(px(s)).toBeLessThanOrEqual(18);
    for (const s of scales('far')) expect(px(s)).toBeLessThan(12);
  });

  it('keeps every hen inside the box, behind the nest', () => {
    for (const s of all) {
      expect(s.x - HEN_HALF * s.scale, `hen ${s.i}`).toBeGreaterThanOrEqual(0);
      expect(s.x + HEN_HALF * s.scale, `hen ${s.i}`).toBeLessThanOrEqual(160);
      expect(s.y - HEN_HEIGHT * s.scale, `hen ${s.i}`).toBeGreaterThan(40);
      // Her feet stay above the rim of the nest (y 191): the yard is behind it.
      expect(s.y, `hen ${s.i}`).toBeLessThan(191);
    }
  });

  it('never moves a hen once placed, and is deterministic', () => {
    for (const n of [3, 11, 30, 80]) {
      const a = yardLayout(n);
      const b = yardLayout(n + 1);
      expect(b.near.slice(0, a.near.length)).toEqual(a.near);
      expect(b.far.slice(0, a.far.length)).toEqual(a.far);
      expect(b.flock.slice(0, a.flock.length)).toEqual(a.flock);
    }
    expect(yardLayout(40)).toEqual(yardLayout(40));
    expect(all.map((s) => henLook(s.i))).toEqual(all.map((s) => henLook(s.i)));
    expect(all.map((s) => henWander(s.i))).toEqual(all.map((s) => henWander(s.i)));
    // Distinct places in the near and far rows.
    const spots = all.filter((s) => s.row !== 'flock').map((s) => `${s.x} ${s.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('gives the hens varied looks, every third one in the skill colour', () => {
    const looks = all.map((s) => henLook(s.i));
    for (let i = 1; i < looks.length; i++) expect(looks[i]!.plume, `hen ${i}`).not.toBe(looks[i - 1]!.plume);
    expect(new Set(looks.slice(0, 8).map((l) => l.plume)).size).toBe(PLUMES.length);
    expect(new Set(looks.map((l) => l.comb)).size).toBe(3);
    looks.forEach((l, i) => expect(l.wear !== 'none', `hen ${i}`).toBe(i % 3 === 1));
    expect(new Set(looks.map((l) => l.wear))).toEqual(new Set(['none', 'scarf', 'bow']));
  });
});

describe('chick yard: the strolls', () => {
  const strollers = Array.from({ length: NEAR_HENS + FAR_HENS }, (_, i) => i);

  it('compiles each pattern into a closed loop that walks the way she faces', () => {
    expect(WANDER).toHaveLength(WANDER_PATTERNS.length);
    for (const frames of WANDER) {
      for (const list of [frames.walk, frames.pose, frames.peck]) {
        expect(list[0]![0]).toBe(0);
        expect(list[list.length - 1]![0]).toBe(1);
        for (let k = 1; k < list.length; k++) expect(list[k]![0]).toBeGreaterThanOrEqual(list[k - 1]![0]!);
        // Back where she started, standing.
        expect(list[list.length - 1]!.slice(1)).toEqual(list[0]!.slice(1));
      }
      expect(frames.walk[0]).toEqual([0, 0, 1]);
      for (let k = 1; k < frames.walk.length; k++) {
        const [, x0, f0] = frames.walk[k - 1]!;
        const [, x1, f1] = frames.walk[k]!;
        expect(Math.abs(x1!)).toBeLessThanOrEqual(10);
        // Left (smaller x) facing left (1), right facing right (−1); she never goes flat.
        if (x1 !== x0) expect(Math.sign(x0! - x1!)).toBe(f1), expect(f0).toBe(f1);
        expect(Math.abs(f1!)).toBeGreaterThanOrEqual(0.4);
      }
      // Calm: several seconds per loop, a slow walk.
      expect(frames.length).toBeGreaterThan(12);
      expect(frames.length).toBeLessThan(25);
    }
  });

  it('seeds a bounded stroll per hen that never leaves the yard', () => {
    const lengths = WANDER.map((w) => w.length * 1000);
    for (const i of strollers) {
      const w = henWander(i);
      const slot = henSlot(i);
      expect(w.pattern).toBeGreaterThanOrEqual(0);
      expect(w.pattern).toBeLessThan(WANDER.length);
      expect(w.duration).toBeGreaterThanOrEqual(Math.min(...lengths) * 0.85 - 1);
      expect(w.duration).toBeLessThanOrEqual(Math.max(...lengths) * 1.3 + 1);
      expect(w.delay).toBeLessThanOrEqual(0);
      expect(w.delay).toBeGreaterThan(-w.duration);
      expect(w.reach, `hen ${i}`).toBeGreaterThanOrEqual(0.3);
      const half = HEN_HALF * slot.scale;
      expect(slot.x - WANDER_REACH * w.reach - half, `hen ${i}`).toBeGreaterThanOrEqual(YARD_LEFT - 0.5);
      expect(slot.x + WANDER_REACH * w.reach + half, `hen ${i}`).toBeLessThanOrEqual(YARD_RIGHT + 0.5);
    }
  });

  it('never moves the hens in lockstep', () => {
    const w = strollers.map(henWander);
    expect(new Set(w.map((x) => x.duration)).size).toBe(w.length);
    expect(new Set(w.map((x) => x.delay)).size).toBe(w.length);
    expect(new Set(w.map((x) => x.pattern)).size).toBe(WANDER.length);
    expect(new Set(w.map((x) => x.mirror)).size).toBe(2);
    // Where each stands when the yard appears (the still pose under reduced motion) varies.
    const poses = strollers.map((i) => wanderAt(WANDER[w[i]!.pattern]!, -w[i]!.delay / w[i]!.duration));
    expect(new Set(poses.map((p) => `${p.x} ${p.face}`)).size).toBeGreaterThan(10);
    expect(poses.some((p) => p.face < 0)).toBe(true);
    for (const p of poses) expect(Math.abs(p.x)).toBeLessThanOrEqual(10);
  });

  it('starts every stroll standing still at its middle', () => {
    for (const frames of WANDER) expect(wanderAt(frames, 0)).toEqual({ x: 0, face: 1, tilt: 0, lift: 0, head: 0 });
    // She stands still at least a second first, so a hen who just joined stays where she arrived.
    for (const frames of WANDER) expect(frames.walk[1]![0] * frames.length).toBeGreaterThanOrEqual(1.5);
  });

  type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
  const fs = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process?.getBuiltinModule?.('node:fs') as Fs | undefined;

  it.skipIf(!fs)('matches the keyframes in chick.css (transform only)', () => {
    const css = fs!.readFileSync(new URL('./chick.css', import.meta.url), 'utf8');
    const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
    expect(flat(css)).toContain(flat(wanderCss()));
    const blocks = wanderCss().match(/@keyframes [\w-]+/g)!;
    expect(blocks).toHaveLength(WANDER.length * 3);
    expect(wanderCss().match(/\{ (\w[\w-]*):/g)!.every((m) => m === '{ transform:')).toBe(true);
  });
});

describe('chick level-up walk', () => {
  it('lands on the grass beside and behind the nest, then walks back into the yard', () => {
    for (let i = 0; i < 40; i++) {
      const { home, land, slot } = joinPath(i);
      const target = henSlot(i);
      expect(slot).toMatchObject({ x: target.x, y: target.y, scale: target.scale });
      // Out of the nest (its rim at y 191, middle at x 62): her feet on the grass behind it.
      expect(land.y).toBeLessThan(191 - 12);
      expect(Math.abs(land.x - 62)).toBeGreaterThanOrEqual(20);
      expect(land.y).toBeLessThan(home.y);
      // The walk goes back and up the yard: farther is higher and smaller.
      expect(slot.y).toBeLessThan(land.y);
      expect(slot.scale).toBeLessThan(land.scale);
      expect(land.scale).toBeLessThan(home.scale);
      // She faces her slot when she lands, and the way her stroll begins when she arrives.
      if (Math.abs(target.x - land.x) >= 4) expect(land.face).toBe(target.x < land.x ? 1 : -1);
      if (target.row !== 'flock') expect(slot.face).toBe(henWander(i).mirror);
    }
    expect(HEN_FEET).toBeGreaterThan(0);
  });
});
