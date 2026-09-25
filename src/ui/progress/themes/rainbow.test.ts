import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { IDLE, MAX_CYCLES, nextPhase, type AnimationState } from '../../components/flaskAnimation';
import {
  ARC_COUNT,
  ARC_FEET,
  LEFT_CLOUD,
  MINI,
  MINI_FEET,
  MINI_LEFT_CLOUD,
  MARK_X,
  MINI_RIGHT_CLOUD,
  RIGHT_CLOUD,
  SUN,
  SUN_DROP,
  SUN_SINK_OPAQUE,
  arcFrames,
  arcLength,
  arcPath,
  arcRadius,
  captionPad,
  captionShift,
  captionYs,
  drawnLength,
  markPoint,
  pennant,
  rainbowArcs,
  rainbowText,
  rainbowTheme,
  rainbowTiming,
  sunSinkDuration,
  sunSinkKeyframes,
} from './rainbow';

type Point = readonly [number, number];

/** A cloud path of `M x y` and `A r r 0 0 1 x y` bumps, closed by a straight bottom. */
function parseCloud(d: string) {
  const n = d.match(/-?\d*\.?\d+/g)!.map(Number);
  const pts: Point[] = [[n[0]!, n[1]!]];
  const bumps: { r: number; c: Point; a: Point; b: Point }[] = [];
  for (let i = 2; i < n.length; i += 7) {
    const r = n[i]!;
    const b: Point = [n[i + 5]!, n[i + 6]!];
    const a = pts[pts.length - 1]!;
    // SVG arc centre (large-arc 0, sweep 1): the midpoint plus the chord normal.
    const hx = (a[0] - b[0]) / 2;
    const hy = (a[1] - b[1]) / 2;
    const d2 = hx * hx + hy * hy;
    const f = Math.sqrt(Math.max(0, (r * r - d2) / d2));
    bumps.push({ r, c: [f * hy + (a[0] + b[0]) / 2, -f * hx + (a[1] + b[1]) / 2], a, b });
    pts.push(b);
  }
  return { pts, bumps };
}

const side = (a: Point, b: Point, p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

/** The highest point of the cloud's outline at x (the smallest y). */
function cloudTop(d: string, x: number): number {
  const { pts, bumps } = parseCloud(d);
  let top = Infinity;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    if (a[0] !== b[0] && (x - a[0]) * (x - b[0]) <= 0) top = Math.min(top, a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]));
  });
  for (const { r, c, a, b } of bumps) {
    const dx = x - c[0];
    if (Math.abs(dx) > r) continue;
    for (const y of [c[1] - Math.sqrt(r * r - dx * dx), c[1] + Math.sqrt(r * r - dx * dx)]) {
      // On the bump itself: across the chord from the centre.
      if (side(a, b, [x, y]) * side(a, b, c) < 0) top = Math.min(top, y);
    }
  }
  return top;
}

const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999, 1];

describe('rainbowArcs', () => {
  it('colours the arcs one after another, outermost first', () => {
    const expected: Record<number, number[]> = {
      0: [0, 0, 0, 0, 0, 0, 0],
      0.25: [1, 0.75, 0, 0, 0, 0, 0],
      0.5: [1, 1, 1, 0.5, 0, 0, 0],
      0.75: [1, 1, 1, 1, 1, 0.25, 0],
      0.999: [1, 1, 1, 1, 1, 1, 0.993],
      1: [1, 1, 1, 1, 1, 1, 1],
    };
    for (const fill of FILLS) {
      const arcs = rainbowArcs(fill);
      expect(arcs).toHaveLength(ARC_COUNT);
      arcs.forEach((share, k) => expect(share, `fill ${fill}, arc ${k}`).toBeCloseTo(expected[fill]![k]!, 3));
    }
  });

  it('never leaves a gap: at most one arc is partly coloured, and the coloured total follows the fill', () => {
    for (const fill of FILLS) {
      const arcs = rainbowArcs(fill);
      expect(arcs.filter((s) => s > 0 && s < 1).length).toBeLessThanOrEqual(1);
      for (let k = 1; k < ARC_COUNT; k++) expect(arcs[k]!).toBeLessThanOrEqual(arcs[k - 1]!);
      expect(arcs.reduce((a, b) => a + b, 0) / ARC_COUNT).toBeCloseTo(fill, 6);
    }
  });

  it('clamps odd input', () => {
    expect(rainbowArcs(-1)).toEqual(rainbowArcs(0));
    expect(rainbowArcs(2)).toEqual(rainbowArcs(1));
    expect(rainbowArcs(Number.NaN)).toEqual(rainbowArcs(0));
  });
});

describe('arc geometry', () => {
  it('nests the arcs inside the box, outermost first', () => {
    for (let k = 0; k < ARC_COUNT; k++) {
      const r = arcRadius(k);
      expect(r).toBeGreaterThan(0);
      if (k) expect(r).toBeLessThan(arcRadius(k - 1));
      expect(80 - r).toBeGreaterThanOrEqual(0);
      expect(80 + r).toBeLessThanOrEqual(160);
    }
  });

  it('draws each arc from the left foot over the top to the right foot', () => {
    expect(arcPath(10, 80, 100, 200)).toBe('M70 200V100A10 10 0 0 1 90 100V200');
    expect(arcLength(10, 100, 200)).toBeCloseTo(200 + Math.PI * 10, 6);
  });

  it('starts and ends every arc where its legs come out of the clouds', () => {
    // The fill maps onto the visible run only: each foot is on the cloud top at the leg's centre
    // line, at most 2.5 units off wherever the left cloud is in its 2 px drift.
    for (let k = 0; k < ARC_COUNT; k++) {
      const r = arcRadius(k);
      for (const drift of [0, 1, 2]) expect(Math.abs(ARC_FEET.left[k]! - cloudTop(LEFT_CLOUD, 80 - r - drift)), `left ${k} drift ${drift}`).toBeLessThanOrEqual(2.5);
      expect(Math.abs(ARC_FEET.left[k]! - cloudTop(LEFT_CLOUD, 80 - r - 1)), `left ${k}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(ARC_FEET.right[k]! - cloudTop(RIGHT_CLOUD, 80 + r)), `right ${k}`).toBeLessThanOrEqual(0.05);
      // The legs are visible between the feet and the arch.
      expect(ARC_FEET.left[k]!).toBeGreaterThan(126);
      expect(ARC_FEET.right[k]!).toBeGreaterThan(126);
    }
    for (let k = 0; k < ARC_COUNT; k++) {
      const r = MINI.out - MINI.band * (k + 0.5);
      expect(Math.abs(MINI_FEET[k]! - cloudTop(MINI_LEFT_CLOUD, MINI.cx - r)), `mini left ${k}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(MINI_FEET[k]! - cloudTop(MINI_RIGHT_CLOUD, MINI.cx + r)), `mini right ${k}`).toBeLessThanOrEqual(0.05);
      expect(MINI_FEET[k]!).toBeLessThan(MINI.foot);
    }
  });

  it('maps an arc share linearly onto its visible run', () => {
    // Total 200, tails 30 (left) and 20 (right): 150 visible.
    expect(drawnLength(0, 200, 30, 20)).toBe(0);
    expect(drawnLength(1, 200, 30, 20)).toBe(200);
    expect(drawnLength(0.001, 200, 30, 20)).toBeCloseTo(30.15, 6);
    expect(drawnLength(0.5, 200, 30, 20)).toBeCloseTo(105, 6);
    expect(drawnLength(0.999, 200, 30, 20)).toBeCloseTo(179.85, 6);
    expect(drawnLength(-1, 200, 30, 20)).toBe(0);
    expect(drawnLength(2, 200, 30, 20)).toBe(200);
  });

  it('eases a fill change through the arcs strictly one after another and ends on the target', () => {
    for (const [from, to] of [
      [0.9, 1],
      [0, 0.2],
      [0.5, 0.25],
      [0, 1],
      [0.02, 0.98],
      [1, 0],
    ] as const) {
      const { offsets, arcs } = arcFrames(from, to);
      expect(arcs).toHaveLength(ARC_COUNT);
      expect(offsets[0]).toBe(0);
      expect(offsets[offsets.length - 1]).toBe(1);
      for (let i = 1; i < offsets.length; i++) expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
      arcs.forEach((shares, k) => {
        expect(shares).toHaveLength(offsets.length);
        expect(shares[0]).toBeCloseTo(rainbowArcs(from)[k]!, 9);
        expect(shares[shares.length - 1]).toBeCloseTo(rainbowArcs(to)[k]!, 9);
        for (let i = 1; i < shares.length; i++) {
          if (to > from) expect(shares[i]!).toBeGreaterThanOrEqual(shares[i - 1]!);
          else expect(shares[i]!).toBeLessThanOrEqual(shares[i - 1]!);
        }
      });
      // Between two keyframes (played linearly) at most one arc changes.
      for (let i = 1; i < offsets.length; i++) {
        const moving = arcs.filter((shares) => Math.abs(shares[i]! - shares[i - 1]!) > 1e-9);
        expect(moving.length, `${from} → ${to}, segment ${i}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('markPoint', () => {
  it('runs along the outer arc left to right and stays inside the box', () => {
    let previous = markPoint(0);
    for (let i = 0; i <= 100; i++) {
      const p = markPoint(i / 100);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(160);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(260);
      if (i) expect(p.x).toBeGreaterThan(previous.x);
      previous = p;
    }
    // Symmetric heights meet the same level; the top of the arch is the middle of the level.
    expect(markPoint(0.25).y).toBeCloseTo(markPoint(0.75).y, 6);
    expect(markPoint(0.5).x).toBeCloseTo(80, 6);
    expect(markPoint(0.5).y).toBeLessThan(markPoint(0.25).y);
    expect(rainbowTheme.markPoint).toBe(markPoint);
  });
});

describe('pennant', () => {
  const centre = { x: markPoint(0.5).x, y: markPoint(0).y };
  const rOut = centre.y - markPoint(0.5).y;
  /** Outside the arch and clear of its rim line (0.8 units either side of the outer edge). */
  const outside = (p: { x: number; y: number }) =>
    (p.y <= centre.y ? Math.hypot(p.x - centre.x, p.y - centre.y) : Math.abs(p.x - centre.x)) >= rOut + 0.8;
  const heights = Array.from({ length: 201 }, (_, i) => i / 200);

  it('keeps every part of every mark inside x 2..158, its flag and tap circle included', () => {
    for (const h of heights) {
      const { box, hit, centre: flag } = pennant(h);
      expect(box.minX, `h ${h}`).toBeGreaterThanOrEqual(MARK_X.min);
      expect(box.maxX, `h ${h}`).toBeLessThanOrEqual(MARK_X.max);
      expect(hit.x - hit.r, `h ${h}`).toBeGreaterThanOrEqual(MARK_X.min);
      expect(hit.x + hit.r, `h ${h}`).toBeLessThanOrEqual(MARK_X.max);
      expect(flag.x, `h ${h}`).toBeLessThanOrEqual(158);
      expect(box.minY).toBeGreaterThanOrEqual(0);
    }
    // The right shoulder the review measured, and the right foot.
    expect(pennant(0.85).box.maxX).toBeLessThanOrEqual(158);
    expect(pennant(1).box.maxX).toBeLessThanOrEqual(158);
  });

  it('stands the pole outward, at most 48° from upright, with the flag clear of the arch and flying towards its top', () => {
    for (const h of heights) {
      const { base, top, flag } = pennant(h);
      expect(Math.hypot(base.x - markPoint(h).x, base.y - markPoint(h).y)).toBeCloseTo(0, 9);
      const [dx, dy] = [top.x - base.x, top.y - base.y];
      expect(Math.hypot(dx, dy)).toBeCloseTo(12, 9);
      expect((Math.atan2(Math.abs(dx), -dy) * 180) / Math.PI, `h ${h}`).toBeLessThanOrEqual(48 + 1e-9);
      expect(dx * (base.x - centre.x) + dy * (base.y - centre.y), `h ${h}`).toBeGreaterThan(0);
      // The flag's corners and edges stay outside the rim.
      for (let i = 0; i < 3; i++) {
        const [a, b] = [flag[i]!, flag[(i + 1) % 3]!];
        for (let t = 0; t <= 1; t += 0.125) expect(outside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), `h ${h}, edge ${i}`).toBe(true);
      }
      if (h < 0.5) expect(flag[1].x).toBeGreaterThan(top.x);
      if (h > 0.5) expect(flag[1].x).toBeLessThan(top.x);
    }
  });
});

describe('level-up choreography', () => {
  const run = (levels: number) => {
    const phases: { state: AnimationState; total: number }[] = [];
    let state = nextPhase(IDLE, { type: 'start', levels });
    const done = { rising: 'rose', overflow: 'overflowed', draining: 'drained', refilling: 'refilled' } as const;
    while (state.phase !== 'idle') {
      const t = rainbowTiming(state);
      phases.push({ state, total: t.delay + t.duration });
      state = nextPhase(state, { type: done[state.phase] });
    }
    return phases;
  };

  it('sets the sun behind the right cloud before it fades', () => {
    const frames = sunSinkKeyframes();
    const at = (t: string | number | null | undefined) => {
      const [x, y] = String(t).match(/-?\d*\.?\d+/g)!.map(Number);
      return { x: SUN.x + x!, y: SUN.y + y! };
    };
    expect(frames[0]).toMatchObject({ offset: 0, opacity: 1 });
    expect(frames[frames.length - 1]).toMatchObject({ offset: 1, opacity: 0 });
    for (const f of frames) if ((f.offset ?? 0) <= SUN_SINK_OPAQUE) expect(f.opacity, `offset ${f.offset}`).toBe(1);
    expect(SUN_SINK_OPAQUE).toBeGreaterThanOrEqual(0.85);
    // Where it stops being opaque, the whole disc (its rim too) is under the cloud tops; at rest,
    // behind the cloud, so are the eight rays (to their round caps).
    const under = (x: number, y: number) => y > cloudTop(RIGHT_CLOUD, x) && y < 240;
    const disc = (c: { x: number; y: number }, r: number) => Array.from({ length: 91 }, (_, i) => (Math.PI * i) / 90).every((a) => under(c.x - r * Math.cos(a), c.y - r * Math.sin(a)));
    const rays = (c: { x: number; y: number }) =>
      Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4).every((a) => [13, 19.7].every((r) => under(c.x + r * Math.cos(a), c.y + r * Math.sin(a))));
    const fading = frames.find((f) => f.offset === SUN_SINK_OPAQUE)!;
    expect(disc(at(fading.transform), SUN.r + 0.75)).toBe(true);
    const rest = at(frames[frames.length - 1]!.transform);
    expect(rest).toEqual({ x: SUN.x + SUN_DROP.x, y: SUN.y + SUN_DROP.y });
    expect(disc(rest, SUN.r + 0.75) && rays(rest)).toBe(true);
  });

  it('tells one level as rise → beat → reset → refill in at most 1.2 s, the sun sink included', () => {
    const phases = run(1);
    expect(phases.map((p) => p.state.phase)).toEqual(['rising', 'overflow', 'draining', 'refilling']);
    const refill = rainbowTiming(phases[3]!.state);
    expect(sunSinkDuration(refill)).toBeLessThanOrEqual(refill.duration);
    // 100 ms of the 1.2 s are left for the timers and frames between the phases.
    expect(phases.reduce((a, p) => a + p.total, 0)).toBeLessThanOrEqual(1100);
  });

  it('compresses several levels into at most three cycles, each shorter than the first', () => {
    for (const levels of [2, 3, 7]) {
      const phases = run(levels);
      expect(phases.filter((p) => p.state.phase === 'refilling')).toHaveLength(Math.min(levels, MAX_CYCLES));
      expect(phases.filter((p) => p.state.phase === 'overflow')).toHaveLength(1);
      expect(phases.reduce((a, p) => a + p.total, 0)).toBeLessThanOrEqual(1200 * Math.min(levels, MAX_CYCLES));
    }
    const repeat = rainbowTiming({ phase: 'refilling', cyclesLeft: 1, cycle: 1 });
    expect(repeat.duration).toBeLessThan(rainbowTiming({ phase: 'refilling', cyclesLeft: 1, cycle: 0 }).duration);
    expect(rainbowTiming(IDLE).duration).toBe(0);
  });
});

describe('mark captions', () => {
  const SCALE = 140 / 160;
  it('keeps the caption buttons apart, however close the flags', () => {
    for (const ys of [
      [100, 100, 101, 102],
      [60, 70, 250, 255],
      [120, 130],
      [80],
    ]) {
      const placed = captionYs(ys);
      placed.forEach((y) => expect(y).toBeLessThanOrEqual(250));
      for (let i = 0; i < placed.length; i++) {
        const pad = captionPad(placed, i);
        expect(pad).toBeGreaterThanOrEqual(4);
        expect(pad).toBeLessThanOrEqual(14);
        for (let j = i + 1; j < placed.length; j++) {
          // Each button is 16 px of text plus its padding above and below.
          expect(Math.abs(placed[i]! - placed[j]!) * SCALE).toBeGreaterThanOrEqual(16 + pad + captionPad(placed, j));
        }
      }
    }
    expect(captionPad([80], 0)).toBe(14);
  });

  it('moves a caption right only where a pennant reaches into the column', () => {
    const boxes = [0.1, 0.3, 0.5, 0.7, 0.85, 0.97, 1].map((h) => pennant(h).box);
    // Captions start at 152 units; one level with a pennant that reaches past it clears it by 1.5.
    for (let y = 20; y <= 250; y += 0.5) {
      const shift = captionShift(y, boxes);
      expect(shift).toBeGreaterThanOrEqual(0);
      expect(shift).toBeLessThanOrEqual(MARK_X.max + 1.5 - 152);
      for (const b of boxes) if (b.maxY > y - 16 / 2 / (140 / 160) && b.minY < y + 16 / 2 / (140 / 160)) expect(152 + shift).toBeGreaterThanOrEqual(b.maxX + 1.5 - 1e-9);
    }
    expect(captionShift(pennant(0.97).centre.y, boxes)).toBeGreaterThan(0);
    expect(captionShift(60, [pennant(0.5).box])).toBe(0);
    expect(captionShift(pennant(0.97).centre.y, [])).toBe(0);
  });
});

describe('text', () => {
  it('names the levels naturally', () => {
    const t = rainbowText;
    expect([1, 2, 5, 11, 21].map((n) => `${n} ${plural(n, t.levelForms)}`)).toEqual(['1 радуга', '2 радуги', '5 радуг', '11 радуг', '21 радуга']);
    expect([1, 3, 5, 21].map((n) => `из ${n} ${plural(n, t.levelFormsOf)}`)).toEqual(['из 1 радуги', 'из 3 радуг', 'из 5 радуг', 'из 21 радуги']);
    expect(`${t.levelNoun} 3`).toBe('Радуга 3');
    expect(`ещё 5 до ${t.levelGenitive} 4`).toBe('ещё 5 до радуги 4');
    expect(t.completed(3)).toBe('Радуга 3 сияет');
    expect(t.fillLabel(45)).toBe('Радуга раскрашена на 45%');
    expect(t.name).toBe('Радуга');
    expect(t.hint).toBe('Полосы раскрашиваются одна за другой');
  });

  it('keeps every string calm: no forbidden words, no exclamation marks', () => {
    const t = rainbowText;
    const strings = [t.name, t.levelNoun, t.levelGenitive, ...t.levelForms, ...t.levelFormsOf, t.completed(1), t.completed(12), t.fillLabel(0), t.fillLabel(100), t.hint];
    for (const s of strings) {
      expect(s).not.toMatch(FORBIDDEN);
      expect(s).not.toContain('!');
    }
  });

  it('is available in the picker', () => {
    expect(rainbowTheme.key).toBe('rainbow');
    expect(rainbowTheme.available).toBe(true);
  });
});
