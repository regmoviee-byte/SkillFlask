import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { DONE_EVENT, IDLE, nextPhase, refillTarget, type AnimationState } from '../../components/flaskAnimation';
import {
  buildRoad,
  carAt,
  carTheme,
  carTiming,
  DESIGNS,
  driveFrames,
  flagOf,
  HERO_ROAD,
  levelUpRoads,
  miniFlag,
  panFrames,
  poseAt,
  postAt,
  roadIndex,
  roadLeg,
  roadPoint,
  roadPose,
  ROADS,
  toMini,
  trailOffset,
  trailParts,
  type CarPose,
  type Road,
} from './car';

const FILLS = [0, 0.25, 0.5, 0.75, 0.999, 1];
const QUARTERS = [0, 0.25, 0.5, 0.75, 1];
const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

/** Inside a rounded w×h tile (corner radius r), `m` units in from its edge. */
function inTile(x: number, y: number, m = 0, w = 160, h = 260, r = 22): boolean {
  if (x < m || y < m || x > w - m || y > h - m) return false;
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return Math.hypot(x - cx, y - cy) <= r - m;
}

/** The car body in its own frame (bumpers, roof, shadow). */
const BODY = { x0: -14, x1: 14, y0: -16, y1: 4.5 };

/** Where a point of the car's own frame lands on screen. */
function toScreen(p: CarPose, lx: number, ly: number) {
  const a = (p.rot * Math.PI) / 180;
  const x = lx * p.face;
  return { x: p.x + x * Math.cos(a) - ly * Math.sin(a), y: p.y + x * Math.sin(a) + ly * Math.cos(a) };
}

/** Whether a screen point lies on the car body. */
function onCar(p: CarPose, x: number, y: number): boolean {
  const a = (p.rot * Math.PI) / 180;
  const dx = x - p.x;
  const dy = y - p.y;
  const lx = (dx * Math.cos(a) + dy * Math.sin(a)) * p.face;
  const ly = -dx * Math.sin(a) + dy * Math.cos(a);
  return lx >= BODY.x0 && lx <= BODY.x1 && ly >= BODY.y0 && ly <= BODY.y1;
}

/** Points covering a rectangle. */
function grid(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const out = [];
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) out.push({ x: x0 + ((x1 - x0) * i) / 6, y: y0 + ((y1 - y0) * j) / 6 });
  return out;
}

const heading = (road: Road, s: number) => roadPoint(road, s).a;

describe('car roads', () => {
  it('has six roads, one per level in turn', () => {
    expect(ROADS).toHaveLength(6);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 12, 13].map((level) => roadIndex(level))).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 5, 0]);
    expect(roadIndex(undefined)).toBe(0);
    expect(roadIndex(Number.NaN)).toBe(0);
    expect(roadIndex(0)).toBe(5);
  });

  it('enters every tile at the bottom middle and leaves at the top middle, heading up', () => {
    for (const road of ROADS) {
      const first = roadPoint(road, 0);
      const last = roadPoint(road, road.length);
      expect(first.x).toBeCloseTo(80, 6);
      expect(first.y).toBeCloseTo(260, 6);
      expect(last.x).toBeCloseTo(80, 6);
      expect(last.y).toBeCloseTo(0, 6);
      expect(first.a).toBeCloseTo(-Math.PI / 2, 6);
      expect(last.a).toBeCloseTo(-Math.PI / 2, 6);
      expect(road.d.startsWith('M80 260')).toBe(true);
      expect(road.d.endsWith('L80 0')).toBe(true);
    }
  });

  it('is one smooth path: the pieces meet without gaps or kinks', () => {
    for (const road of ROADS) {
      let s = 0;
      for (let i = 0; i < road.segs.length - 1; i++) {
        s += road.segs[i]!.len;
        const before = roadPoint(road, s - 1e-7);
        const after = roadPoint(road, s + 1e-7);
        expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1e-4);
        expect(Math.abs(Math.sin(after.a - before.a))).toBeLessThan(1e-4);
        expect(road.segs[i]!.len).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every road, the car and the flags inside the tile', () => {
    ROADS.forEach((road, n) => {
      for (let s = 0; s <= road.length; s += 1) {
        const p = roadPoint(road, s);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(160);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(260);
      }
      for (let f = 0; f <= 1.0001; f += 0.01) {
        const pose = roadPose(road, f);
        for (const [lx, ly] of [
          [BODY.x0, BODY.y0],
          [BODY.x1, BODY.y0],
          [BODY.x0, BODY.y1],
          [BODY.x1, BODY.y1],
        ]) {
          const c = toScreen(pose, lx!, ly!);
          expect(inTile(c.x, c.y, 1), `road ${n + 1} at ${f.toFixed(2)}`).toBe(true);
        }
      }
      // The finish flag, its ring of rays at their largest (the beat scales them to 1.25) and the
      // gold star; the start pennant.
      const flag = flagOf(n);
      for (let deg = 0; deg < 360; deg += 15) {
        const a = (deg * Math.PI) / 180;
        expect(inTile(flag.cx + Math.cos(a) * 18 * 1.25, flag.cy + Math.sin(a) * 14.5 * 1.25, 0), `rays of road ${n + 1}`).toBe(true);
      }
      expect(inTile(flag.x + flag.dir * 18, flag.top, 2)).toBe(true);
      expect(inTile(flag.cx + flag.dir * 20 + 6, flag.top - 4, 1)).toBe(true);
      const [px, py, pd] = DESIGNS[n]!.f;
      expect(inTile(px, py, 2) && inTile(px + pd * 12, py - 20, 2)).toBe(true);
    });
  });

  it('starts at the bottom and finishes at the top, with both lines on the road', () => {
    for (const road of ROADS) {
      expect(roadPoint(road, road.s0).y).toBeGreaterThan(200);
      expect(roadPoint(road, road.s1).y).toBeLessThan(72);
      expect(road.s0 - 15).toBeGreaterThan(0);
      expect(road.s1 + 15).toBeLessThan(road.length);
      // The finish line is ahead of the car at the finish, so the car never hides it.
      const car = roadPose(road, 1);
      const line = roadPoint(road, road.s1 + 15);
      expect(onCar(car, line.x, line.y)).toBe(false);
    }
  });

  it('moves the car forward along the road as the fill grows', () => {
    for (const road of ROADS) {
      let travelled = 0;
      let last = roadPoint(road, carAt(road, 0));
      for (let i = 1; i <= 400; i++) {
        expect(carAt(road, i / 400)).toBeGreaterThan(carAt(road, (i - 1) / 400));
        const p = roadPoint(road, carAt(road, i / 400));
        travelled += Math.hypot(p.x - last.x, p.y - last.y);
        last = p;
      }
      // Point to point the car walks the course: never back, never across the grass.
      expect(travelled).toBeCloseTo(road.s1 - road.s0, 0);
    }
  });

  it('builds the roads from rounded corners', () => {
    const road = buildRoad([0, 100, 0, 50, 50, 50], [10], 5, 5);
    expect(road.segs.map((g) => (g.r ? 'arc' : 'line'))).toEqual(['line', 'arc', 'line']);
    expect(road.length).toBeCloseTo(40 + (Math.PI * 10) / 2 + 40, 6);
    expect(road.d).toBe('M0 100L0 60A10 10 0 0 1 10 50L50 50');
    expect(road.s1).toBeCloseTo(road.length - 5, 6);
  });
});

describe('car pose', () => {
  it('names the stages of the first trip', () => {
    expect(FILLS.map((f) => roadLeg(f))).toEqual([
      { index: 2, kind: 'straight', heading: 1 },
      { index: 6, kind: 'straight', heading: -1 },
      { index: 8, kind: 'straight', heading: 1 },
      { index: 10, kind: 'straight', heading: 1 },
      { index: 14, kind: 'straight', heading: -1 },
      { index: 14, kind: 'straight', heading: -1 },
    ]);
  });

  it('follows the tangent, flipped on the way back and never upside down', () => {
    const start = roadPose(HERO_ROAD, 0);
    expect(start).toMatchObject({ face: 1 });
    expect(start.rot).toBeLessThan(0);
    expect(roadPose(HERO_ROAD, 1).face).toBe(-1);
    for (const road of ROADS) {
      for (let f = 0; f <= 1.0001; f += 0.02) {
        const p = roadPose(road, f);
        expect(Math.abs(p.rot)).toBeLessThanOrEqual(90 + 1e-9);
        // The nose points along the road.
        const nose = toScreen(p, 1, 0);
        const a = heading(road, carAt(road, f));
        expect((nose.x - p.x) * Math.cos(a) + (nose.y - p.y) * Math.sin(a)).toBeCloseTo(1, 6);
      }
    }
    expect(roadPose(HERO_ROAD, -1)).toEqual(start);
    expect(roadPose(HERO_ROAD, Number.NaN)).toEqual(start);
    expect(roadPose(HERO_ROAD, 2)).toEqual(roadPose(HERO_ROAD, 1));
  });

  it('drives along the road and flips in one instant', () => {
    const frames = driveFrames(HERO_ROAD, 0.1, 0.4);
    expect(frames.length).toBeGreaterThan(10);
    for (const frame of frames) expect(String(frame.transform)).toMatch(/^translate\([\d.-]+px, [\d.-]+px\) rotate\([\d.-]+deg\) scale\(-?1, 1\)$/);
    const offsets = frames.map((f) => f.offset as number);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]!).toBeGreaterThanOrEqual(offsets[i - 1]!);
    // Every flip (a U-turn) happens between two keyframes a hair apart.
    const scale = frames.map((f) => String(f.transform).includes('scale(-1'));
    let flips = 0;
    for (let i = 1; i < frames.length; i++) {
      if (scale[i] === scale[i - 1]) continue;
      flips++;
      expect(offsets[i]! - offsets[i - 1]!).toBeLessThan(0.001);
    }
    expect(flips).toBeGreaterThan(0);
  });

  it('drives from the finish of one road over the top edge to the start of the next', () => {
    for (let n = 0; n < ROADS.length; n++) {
      const a = ROADS[n]!;
      const b = ROADS[(n + 1) % ROADS.length]!;
      const frames = panFrames(a, b);
      const xy = frames.map((f) => String(f.transform).match(/translate\(([\d.-]+)px, ([\d.-]+)px\)/)!.slice(1).map(Number));
      const from = roadPose(a, 1);
      const to = roadPose(b, 0);
      expect(xy[0]![0]).toBeCloseTo(from.x, 1);
      expect(xy[0]![1]).toBeCloseTo(from.y, 1);
      expect(xy[xy.length - 1]![0]).toBeCloseTo(to.x, 1);
      expect(xy[xy.length - 1]![1]).toBeCloseTo(to.y, 1);
      // On screen the car glides down with the world, never jumps.
      for (let i = 1; i < xy.length; i++) expect(Math.hypot(xy[i]![0]! - xy[i - 1]![0]!, xy[i]![1]! - xy[i - 1]![1]!)).toBeLessThan(16);
    }
  });

  it('picks the roads of a level-up from the new level: the completed one, the next per cycle, the new level last', () => {
    expect(levelUpRoads(2, 1)).toEqual([0, 1]);
    expect(levelUpRoads(7, 1)).toEqual([5, 0]);
    expect(levelUpRoads(8, 3)).toEqual([4, 5, 0, 1]);
    expect(levelUpRoads(7, 3)).toEqual([3, 4, 5, 0]);
    // Seven levels at once: three cycles, the last jumps to the new level's road.
    expect(levelUpRoads(9, 7)).toEqual([1, 2, 3, roadIndex(9)]);
    expect(levelUpRoads(undefined, 2)).toEqual([0, 0, 0]);
  });
});

describe('car posts and trail', () => {
  it('puts the km posts beside the road, clear of the car at every quarter', () => {
    ROADS.forEach((road, n) => {
      for (const share of [0.25, 0.5, 0.75]) {
        const post = postAt(road, share);
        const label = post.side > 0 ? [post.x + 4.5, post.x + 20] : [post.x - 20, post.x - 4.5];
        expect(inTile(post.x, post.y, 4), `post ${share} of road ${n + 1}`).toBe(true);
        expect(label[0]! >= 2 && label[1]! <= 158, `label ${share} of road ${n + 1}`).toBe(true);
        for (const f of QUARTERS) {
          const car = roadPose(road, f);
          const hit = grid(post.x - 1.8, post.y - 4, post.x + 1.8, post.y + 4).some((p) => onCar(car, p.x, p.y));
          expect(hit, `post ${share} under the car at ${f} on road ${n + 1}`).toBe(false);
        }
        const car = roadPose(road, share);
        expect(grid(label[0]!, post.y - 5, label[1]!, post.y + 5).some((p) => onCar(car, p.x, p.y)), `label ${share} of road ${n + 1}`).toBe(false);
      }
    });
  });

  it('splits the trail at the bridge where the loop crosses its own road', () => {
    const n = DESIGNS.findIndex((d) => d.b?.length === 3);
    const road = ROADS[n]!;
    const [a, b, split] = DESIGNS[n]!.b as [number, number, number];
    const parts = trailParts(n);
    expect(parts).toEqual([
      [road.s0, split],
      [split, road.s1],
    ]);
    // The deck lies over the lower road, which passes under it before the split.
    const deck = roadPoint(road, (a + b) / 2);
    let under = -1;
    for (let s = 0; s < split; s += 0.25) {
      const p = roadPoint(road, s);
      if (Math.hypot(p.x - deck.x, p.y - deck.y) < 0.5) under = s;
    }
    expect(under).toBeGreaterThan(road.s0);
    expect((b - a) / 2).toBeGreaterThanOrEqual(13);
    expect(parts.map((part) => trailOffset(road, part, 0))).toEqual([100, 100]);
    expect(parts.map((part) => trailOffset(road, part, (split - road.s0) / (road.s1 - road.s0)))).toEqual([0, 100]);
    expect(parts.map((part) => trailOffset(road, part, 1))).toEqual([0, 0]);
    expect(trailParts(0)).toEqual([[HERO_ROAD.s0, HERO_ROAD.s1]]);
  });

  it('keeps the bridges on straight road', () => {
    DESIGNS.forEach((design, n) => {
      if (!design.b) return;
      const road = ROADS[n]!;
      expect(heading(road, design.b[0]!)).toBeCloseTo(heading(road, design.b[1]!), 6);
    });
  });
});

describe('car mini', () => {
  it('draws each road with the car and the flag inside its 40-unit tile', () => {
    ROADS.forEach((road, n) => {
      for (let f = 0; f <= 1.0001; f += 0.05) {
        const p = roadPoint(road, carAt(road, f));
        const c = toMini(p.x, p.y);
        for (let deg = 0; deg < 360; deg += 30) {
          const a = (deg * Math.PI) / 180;
          expect(inTile(c.x + Math.cos(a) * 4.4, c.y + Math.sin(a) * 4.4, 0, 40, 40, 10), `mini car of road ${n + 1} at ${f}`).toBe(true);
        }
      }
      const flag = miniFlag(n);
      for (const [x, y] of [
        [flag.x, flag.y],
        [flag.x, flag.y - 9],
        [flag.x + 6 * flag.dir, flag.y - 9],
        [flag.x + 6 * flag.dir, flag.y - 4.6],
      ]) {
        expect(inTile(x!, y!, 1, 40, 40, 10), `mini flag of road ${n + 1}`).toBe(true);
      }
    });
  });
});

describe('car marks', () => {
  it('follows the first road monotonically and stays inside the box', () => {
    let travelled = 0;
    let last = carTheme.markPoint(0);
    for (let i = 0; i <= 200; i++) {
      const p = carTheme.markPoint(i / 200);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(160);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(260);
      travelled += Math.hypot(p.x - last.x, p.y - last.y);
      last = p;
    }
    expect(carTheme.markPoint(0).y).toBeGreaterThan(carTheme.markPoint(1).y);
    // Monotonic along the path: the distance walked point to point is the course's length.
    expect(travelled).toBeCloseTo(HERO_ROAD.s1 - HERO_ROAD.s0, 0);
    expect(carTheme.markPoint(0.5)).toEqual({ x: poseAt(HERO_ROAD, carAt(HERO_ROAD, 0.5)).x, y: poseAt(HERO_ROAD, carAt(HERO_ROAD, 0.5)).y });
  });
});

describe('car level-up timing', () => {
  function play(levels: number, from: number, to: number) {
    let state: AnimationState = nextPhase(IDLE, { type: 'start', levels });
    const steps: string[] = [];
    let total = 0;
    let firstTrip = 0;
    for (let guard = 0; state.phase !== 'idle' && guard < 50; guard++) {
      const t = carTiming(state, from, to);
      total += t.delay + t.duration;
      if (state.phase === 'rising' || state.phase === 'overflow') firstTrip += t.delay + t.duration;
      steps.push(`${state.phase}${state.phase === 'refilling' ? `→${refillTarget(state, to)}` : ''}`);
      state = nextPhase(state, { type: DONE_EVENT[state.phase] } as never);
    }
    return { steps, total, firstTrip };
  }

  it('drives to the finish, celebrates, scrolls into the next road and drives on', () => {
    const { steps, total, firstTrip } = play(1, 0.9, 0.2);
    expect(steps).toEqual(['rising', 'overflow', 'draining', 'refilling→0.2']);
    expect(total).toBeLessThanOrEqual(1600);
    expect(firstTrip).toBeLessThanOrEqual(1200);
  });

  it('keeps the drive and the beat of the level within 1.2 s from any start', () => {
    for (const from of FILLS) expect(play(1, from, 0.5).firstTrip).toBeLessThanOrEqual(1200);
  });

  it('compresses several levels into three trips, then jumps to the result', () => {
    const { steps, total } = play(7, 0.9, 0.3);
    expect(steps).toEqual(['rising', 'overflow', 'draining', 'refilling→1', 'draining', 'refilling→1', 'draining', 'refilling→0.3']);
    expect(total).toBeLessThanOrEqual(3 * 1200);
  });
});

describe('car text', () => {
  const { text } = carTheme;

  it('names the trips', () => {
    expect(text.name).toBe('Машинка');
    expect(`${text.levelNoun} 3`).toBe('Поездка 3');
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до поездки 4');
    expect(text.completed(3)).toBe('Поездка 3 завершена');
    expect(text.fillLabel(45)).toBe('Машинка проехала 45% пути');
    expect(text.hint).toBe('Машинка едет по дороге к финишу');
  });

  it('declines the counts', () => {
    expect([1, 2, 5, 11, 21].map((n) => `${n} ${plural(n, text.levelForms)}`)).toEqual(['1 поездка', '2 поездки', '5 поездок', '11 поездок', '21 поездка']);
    expect([1, 2, 5, 11, 21].map((n) => `из ${n} ${plural(n, text.levelFormsOf)}`)).toEqual([
      'из 1 поездки',
      'из 2 поездок',
      'из 5 поездок',
      'из 11 поездок',
      'из 21 поездки',
    ]);
  });

  it('stays calm and clean', () => {
    const all = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.completed(7), text.fillLabel(50), text.hint];
    expect(all.filter((s) => FORBIDDEN.test(s) || s.includes('!'))).toEqual([]);
  });

  it('is available under its key', () => {
    expect(carTheme.key).toBe('car');
    expect(carTheme.available).toBe(true);
  });
});
