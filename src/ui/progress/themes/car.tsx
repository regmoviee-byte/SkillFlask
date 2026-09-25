import { Fragment, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '../../../lib/format';
import { PLAIN_TICKS, scaleTicks } from '../../components/flaskScale';
import { DONE_EVENT, FINISH_FALLBACK_MS, IDLE, MAX_CYCLES, nextPhase, refillTarget, type AnimationState } from '../../components/flaskAnimation';
import { copy } from '../../copy';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import './car.css';

// «Машинка»: a small car (the skill colour) drives from the start pennant at the bottom to the
// chequered flag at the top; `fill` is the share of the road behind it (the yellow line). Each
// level has its own road, six in turn (roadIndex): forest serpentine, meadow S-curves, mountain
// loop, city blocks, coastal road, desert hairpin. A road is one analytic path (buildRoad), so the
// car, the trail, the posts and the marks agree without layout; every road enters at the bottom
// middle and leaves at the top middle, so the next one goes on from it.
// Level-up: the app renders the new `level` and fill, then calls playLevelUp; the hero keeps the
// road it had on screen until then. The car drives to the flag (rise), the flag waves and the
// headlights blink (beat), the world scrolls down as the car drives into the next road (reset)
// and on to `toFill` (refill), ending on the new level's road. The order comes from the flask's state machine (flaskAnimation.ts);
// carTiming gives this theme's own timings.

const VIEW_W = 160;
const VIEW_H = 260;

/** A piece of road: a straight (r = 0) or an arc of radius r turning right (k = 1) or left (k = −1). */
interface Seg {
  x: number;
  y: number;
  /** Heading at the start, radians (0 points right, −π/2 up). */
  a: number;
  len: number;
  r: number;
  k: number;
}

export interface Road {
  segs: Seg[];
  length: number;
  /** The whole road, from the bottom edge to the top edge. */
  d: string;
  /** Where the car stands at fill 0 and at fill 1, as distances along the road. */
  s0: number;
  s1: number;
}

export interface RoadPoint {
  x: number;
  y: number;
  /** Heading, radians. */
  a: number;
}

function segPoint(g: Seg, u: number): RoadPoint {
  if (!g.r) return { x: g.x + Math.cos(g.a) * u, y: g.y + Math.sin(g.a) * u, a: g.a };
  const a = g.a + (g.k * u) / g.r;
  return { x: g.x + g.k * g.r * (Math.sin(a) - Math.sin(g.a)), y: g.y - g.k * g.r * (Math.cos(a) - Math.cos(g.a)), a };
}

/** The point `s` along the road (clamped to its ends). */
export function roadPoint(road: Road, s: number): RoadPoint {
  let rest = Math.min(road.length, Math.max(0, s));
  for (const g of road.segs) {
    if (rest <= g.len) return segPoint(g, rest);
    rest -= g.len;
  }
  const last = road.segs[road.segs.length - 1]!;
  return segPoint(last, last.len);
}

const f1 = (v: number) => Number(v.toFixed(1));

/** The stretch of road between the distances `from` and `to` as SVG path data. */
export function subPath(road: Road, from: number, to: number): string {
  let d = '';
  let s = 0;
  for (const g of road.segs) {
    const lo = Math.max(from, s);
    const hi = Math.min(to, s + g.len);
    if (hi > lo) {
      const p = segPoint(g, lo - s);
      const q = segPoint(g, hi - s);
      if (!d) d = `M${f1(p.x)} ${f1(p.y)}`;
      d += g.r ? `A${g.r} ${g.r} 0 ${(hi - lo) / g.r > Math.PI ? 1 : 0} ${g.k > 0 ? 1 : 0} ${f1(q.x)} ${f1(q.y)}` : `L${f1(q.x)} ${f1(q.y)}`;
    }
    s += g.len;
  }
  return d;
}

/**
 * A road through the vertices `p` ([x0, y0, x1, y1, …]) with each inner corner rounded by its
 * radius in `r`; the car starts `lead` after the first vertex and finishes `tail` before the last.
 */
export function buildRoad(p: number[], r: number[], lead: number, tail: number): Road {
  const segs: Seg[] = [];
  const n = p.length / 2;
  let x = p[0]!;
  let y = p[1]!;
  for (let i = 1; i < n; i++) {
    const ax = p[2 * i]! - p[2 * i - 2]!;
    const ay = p[2 * i + 1]! - p[2 * i - 1]!;
    const la = Math.hypot(ax, ay);
    const ux = ax / la;
    const uy = ay / la;
    const a = Math.atan2(uy, ux);
    let ex = p[2 * i]!;
    let ey = p[2 * i + 1]!;
    let nx = ex;
    let ny = ey;
    let arc: Seg | null = null;
    if (i < n - 1) {
      const bx = p[2 * i + 2]! - ex;
      const by = p[2 * i + 3]! - ey;
      const lb = Math.hypot(bx, by);
      const turn = Math.atan2(ux * by - uy * bx, ux * bx + uy * by);
      const t = r[i - 1]! * Math.tan(Math.abs(turn) / 2);
      ex -= ux * t;
      ey -= uy * t;
      nx += (bx / lb) * t;
      ny += (by / lb) * t;
      if (turn) arc = { x: ex, y: ey, a, len: r[i - 1]! * Math.abs(turn), r: r[i - 1]!, k: Math.sign(turn) };
    }
    const len = (ex - x) * ux + (ey - y) * uy;
    if (len > 1e-6) segs.push({ x, y, a, len, r: 0, k: 0 });
    if (arc) segs.push(arc);
    x = nx;
    y = ny;
  }
  const length = segs.reduce((sum, g) => sum + g.len, 0);
  const road: Road = { segs, length, d: '', s0: lead, s1: length - tail };
  road.d = subPath(road, 0, length);
  return road;
}

interface Design {
  /** Vertices from the bottom edge (80, 260) to the top edge (80, 0). */
  p: number[];
  /** Corner radii, one per inner vertex. */
  r: number[];
  /** Road before the car's start and after its finish. */
  s: [number, number];
  /** The start pennant and the finish flag: foot x, foot y and the side the cloth flies to (±1), each. */
  f: [number, number, number, number, number, number];
  /** A bridge [from, to] along the road; with a third number it crosses the road below and the trail splits there. */
  b?: number[];
}

// The six roads, one per level in turn. Every road enters at the bottom middle and leaves at the
// top middle, so the next road goes on from the finish of this one.
export const DESIGNS: Design[] = [
  // 1. Серпантин: four rows and three switchbacks through a forest.
  { p: [80, 260, 80, 244, 140, 236, 140, 188, 20, 172, 20, 124, 140, 108, 140, 60, 80, 52, 80, 0], r: [14, 22, 22, 22, 22, 22, 22, 12], s: [41, 74], f: [93, 230, 1, 90, 40, 1] },
  // 2. Плавные изгибы: two wide lobes of an S through fields.
  { p: [80, 260, 80, 240, 137, 240, 137, 150, 23, 150, 23, 60, 80, 60, 80, 0], r: [12, 45, 45, 45, 45, 12], s: [40, 81.4], f: [89, 229, 1, 68, 48, -1] },
  // 3. Спираль в гору: a loop around a hill, over its own bridge, then up to the pass.
  { p: [80, 260, 80, 128, 136, 128, 136, 196, 26, 196, 26, 96, 80, 52, 80, 0], r: [28, 28, 28, 24, 40, 30], s: [26, 79], f: [68, 249, -1, 62, 50, -1], b: [262, 290, 150] },
  // 4. Городские кварталы: right-angle turns between the blocks.
  { p: [80, 260, 80, 226, 32, 226, 32, 170, 80, 170, 80, 114, 128, 114, 128, 58, 80, 58, 80, 0], r: [10, 10, 10, 10, 10, 10, 10, 10], s: [55, 78.7], f: [70, 214, 1, 90, 46, 1] },
  // 5. Вдоль побережья: a long diagonal along the sea with a bridge over a river mouth.
  { p: [80, 260, 80, 248, 30, 248, 132, 86, 80, 50, 80, 0], r: [12, 20, 36, 16], s: [78, 72.5], f: [39, 211, 1, 96, 44, 1], b: [112, 136] },
  // 6. Пустыня: two long straights and one big hairpin between the dunes.
  { p: [80, 260, 80, 244, 138, 158, 26, 84, 80, 54, 80, 0], r: [30, 34, 18, 12], s: [43, 74.5], f: [77, 227, -1, 66, 47, -1] },
];

export const ROADS = DESIGNS.map((g) => buildRoad(g.p, g.r, g.s[0], g.s[1]));
/** The first road; the definition's markPoint uses it (the hero draws marks on its current road). */
export const HERO_ROAD = ROADS[0]!;

/** Which of the six roads a level drives: 1, 7, 13… the serpentine; 2, 8… the S-curves, and so on. */
export function roadIndex(level?: number): number {
  if (level === undefined || !Number.isFinite(level)) return 0;
  const n = ROADS.length;
  return (((Math.floor(level) - 1) % n) + n) % n;
}

/**
 * The roads of a level-up that completes `levels` and lands on `level` (the new level, as the
 * props already say when the play starts): the road being finished (`level − levels`), then one
 * per cycle of the choreography (at most MAX_CYCLES), the last always the road of `level`.
 * Without a level every road is the first.
 */
export function levelUpRoads(level: number | undefined, levels: number): number[] {
  const total = Math.max(1, Math.floor(levels) || 1);
  const cycles = Math.min(MAX_CYCLES, total);
  if (level === undefined) return Array<number>(cycles + 1).fill(0);
  const out = [roadIndex(level - total)];
  for (let c = 1; c <= cycles; c++) out.push(roadIndex(c === cycles ? level : level - total + c));
  return out;
}

/** How long a level increase keeps the old road on screen, waiting for its playLevelUp. */
export const HOLD_MS = 600;

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** The car's pose: position, tilt (−90..90°) and facing (1 right, −1 mirrored to face left). */
export interface CarPose {
  x: number;
  y: number;
  rot: number;
  face: 1 | -1;
}

/** The car follows the tangent of the road and flips when the road turns leftwards, so it never drives upside down. */
export function poseAt(road: Road, s: number): CarPose {
  const p = roadPoint(road, s);
  const face = Math.cos(p.a) > -1e-6 ? 1 : -1;
  const t = face > 0 ? p.a : p.a + Math.PI;
  return { x: p.x, y: p.y, rot: (Math.atan2(Math.sin(t), Math.cos(t)) * 180) / Math.PI, face };
}

/** Distance along the road of the car at `fill`. */
export const carAt = (road: Road, fill: number) => road.s0 + clamp(fill) * (road.s1 - road.s0);

export function roadPose(road: Road, fill: number): CarPose {
  return poseAt(road, carAt(road, fill));
}

export type RoadLeg = { index: number; kind: 'straight' | 'turn'; heading: 1 | -1 };

/** Stage of the trip: the straight or turn the car is on and whether it faces right or left. */
export function roadLeg(fill: number, road: Road = HERO_ROAD): RoadLeg {
  let s = carAt(road, fill);
  let index = 0;
  while (index < road.segs.length - 1 && s > road.segs[index]!.len) s -= road.segs[index++]!.len;
  return { index, kind: road.segs[index]!.r ? 'turn' : 'straight', heading: roadPose(road, fill).face };
}

const fmt = (v: number) => Number(v.toFixed(2));
export const poseTransform = (p: CarPose) => `translate(${fmt(p.x)}px, ${fmt(p.y)}px) rotate(${fmt(p.rot)}deg) scale(${p.face}, 1)`;

/**
 * Keyframes of the car along `at(t)`, t 0..1. Where the car flips, two keyframes share the
 * moment so the flip is instant rather than a spin through the interpolation.
 */
function framesAlong(at: (t: number) => CarPose, steps: number): Keyframe[] {
  const out: Keyframe[] = [];
  let prev = at(0);
  let pt = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = at(t);
    if (p.face !== prev.face) {
      let lo = pt;
      let hi = t;
      for (let k = 0; k < 12; k++) {
        const m = (lo + hi) / 2;
        if (at(m).face === prev.face) lo = m;
        else hi = m;
      }
      out.push({ transform: poseTransform(at(lo)), offset: lo }, { transform: poseTransform(at(hi)), offset: hi });
    }
    out.push({ transform: poseTransform(p), offset: t });
    prev = p;
    pt = t;
  }
  return out;
}

const driveSteps = (from: number, to: number) => Math.max(2, Math.ceil(Math.abs(clamp(to) - clamp(from)) * 64));

/** WAAPI keyframes that drive the car along the road from one fill to another. */
export function driveFrames(road: Road, from: number, to: number): Keyframe[] {
  const a = clamp(from);
  const b = clamp(to);
  return framesAlong((t) => roadPose(road, a + (b - a) * t), driveSteps(a, b));
}

/**
 * Keyframes of the car from the finish of road `a` over the top edge into road `b` (drawn one
 * tile higher) to its start, while the world scrolls down by one tile.
 */
export function panFrames(a: Road, b: Road): Keyframe[] {
  const run = a.length - a.s1 + b.s0;
  return framesAlong((t) => {
    const s = a.s1 + run * t;
    const onA = s <= a.length;
    const p = onA ? poseAt(a, s) : poseAt(b, s - a.length);
    return { ...p, y: p.y + VIEW_H * t - (onA ? 0 : VIEW_H) };
  }, 40);
}

/** Stretches of the trail: one, or two around a bridge where the road crosses itself. */
export function trailParts(n: number): [number, number][] {
  const road = ROADS[n]!;
  const split = DESIGNS[n]!.b?.[2];
  return split === undefined ? [[road.s0, road.s1]] : [[road.s0, split], [split, road.s1]];
}

/** Dash offset of a trail stretch (pathLength 100) with the car at `fill`: the share still ahead. */
export function trailOffset(road: Road, [a, b]: [number, number], fill: number): number {
  return fmt(100 * (1 - clamp((carAt(road, fill) - a) / (b - a))));
}

export interface CarTiming {
  delay: number;
  duration: number;
  easing: string;
}

export const DRIVE_EASING = 'cubic-bezier(0.45, 0, 0.2, 1)';
export const PAN_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * Timings of the level-up phases. A drive takes longer the further the car goes; the first
 * trip's drive and beat stay within 1.2 s, and the repeats of a multi-level write run short.
 */
export function carTiming(state: AnimationState, fromFill: number, toFill: number): CarTiming {
  const compressed = state.cycle > 0 || state.cyclesLeft > 1;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: Math.round(200 + 400 * (1 - clamp(fromFill))), easing: DRIVE_EASING };
    case 'overflow':
      return { delay: 0, duration: 420, easing: 'ease-in-out' };
    case 'draining':
      return state.cycle > 0 ? { delay: 0, duration: 300, easing: PAN_EASING } : { delay: 80, duration: 460, easing: PAN_EASING };
    case 'refilling':
      return compressed ? { delay: 0, duration: 320, easing: DRIVE_EASING } : { delay: 0, duration: Math.round(200 + 400 * clamp(toFill)), easing: DRIVE_EASING };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'linear' };
  }
}

/**
 * A km post beside the road at `share`: on the side away from the car's roof, or past the roof
 * when that side runs off the tile; `side` is where its number goes (away from the car).
 */
export function postAt(road: Road, share: number): { x: number; y: number; side: 1 | -1 } {
  const p = roadPose(road, share);
  const rad = (p.rot * Math.PI) / 180;
  let dx = -Math.sin(rad);
  let dy = Math.cos(rad);
  let gap = 14;
  if (Math.abs(p.x + dx * gap - VIEW_W / 2) > 62) {
    dx = -dx;
    dy = -dy;
    gap = 22;
  }
  const x = p.x + dx * gap;
  const away = x - p.x;
  return { x, y: p.y + dy * gap, side: away > 2 ? 1 : away < -2 ? -1 : x < VIEW_W / 2 ? 1 : -1 };
}

// ---- Scenery ----

const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const CAPTION_GAP = 18;
/** Captions start just right of the scene. */
const CAPTION_X = 166;
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;

function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Caption y positions, at least CAPTION_GAP apart and inside the box. */
function captionYs(ys: number[]): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => o.y);
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + CAPTION_GAP);
  if (placed.length && placed[placed.length - 1]! > VIEW_H - 10) {
    placed[placed.length - 1] = VIEW_H - 10;
    for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k]!, placed[k + 1]! - CAPTION_GAP);
  }
  const out = Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]!));
  return out;
}

/** Vertical padding of caption i in px: towards a 44 px tap area, never over a neighbour. */
function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) - CAPTION_LINE : CAPTION_PAD_MAX;
  return Math.round(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function done(animation: Animation, duration: number): Promise<void> {
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration + FINISH_FALLBACK_MS)]);
}

function animate(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    return el.animate(keyframes, { ...options, easing: 'ease-out' });
  }
}

/** Groups of `size` numbers from a flat list, with a key. */
function each(list: number[], size: number, draw: (v: number[]) => ReactNode): ReactNode {
  const out: ReactNode[] = [];
  for (let i = 0; i < list.length; i += size) out.push(<Fragment key={i}>{draw(list.slice(i, i + size))}</Fragment>);
  return out;
}

/** Round trees [x, y, crown radius, …]. */
const trees = (l: number[]) =>
  each(l, 3, ([x, y, r]) => (
    <>
      <rect x={x! - 1.2} y={y} width="2.4" height={r! * 0.9} rx="1" className="car-trunk" />
      <circle cx={x} cy={y! - r! * 0.35} r={r} className="car-crown" />
    </>
  ));

/** Fir trees [x, y (foot), height, …]. */
const firs = (l: number[]) => each(l, 3, ([x, y, h]) => <path d={`M${x} ${y! - h!}l${h! * 0.36} ${h! * 0.82}h${-h! * 0.72}Z`} className="car-fir" />);

/** Cacti [x, y (foot), height, …]. */
const cacti = (l: number[]) =>
  each(l, 3, ([x, y, h]) => <path d={`M${x} ${y}v${-h!}M${x} ${y! - h! * 0.4}h-3.4v${-h! * 0.32}M${x} ${y! - h! * 0.55}h3.4v${-h! * 0.3}`} className="car-cactus" />);

/** City blocks [x, y, w, h, roof 0..2, …]: a roof with a lighter top. */
const blocks = (l: number[]) =>
  each(l, 5, ([x, y, w, h, c]) => (
    <>
      <rect x={x} y={y} width={w} height={h} rx="1.6" className={`car-roof car-roof${c}`} />
      <rect x={x! + 2.4} y={y! + 2.4} width={w! - 4.8} height={h! - 4.8} rx="1" className="car-roof-top" />
    </>
  ));

/** A fence along `d`: a rail and its posts. */
const fence = (d: string) => (
  <>
    <path d={d} className="car-rail-wood" />
    <path d={d} className="car-fence" />
  </>
);

/** Everything drawn under the road of design n (layer 0) and over its verge (layer 1). */
function scenery(n: number, layer: 0 | 1): ReactNode {
  switch (n * 2 + layer) {
    case 0:
      return (
        <>
          <path d="M28 218a38 14 0 0 1 76 0ZM46 154a40 14 0 0 1 80 0ZM34 92a40 14 0 0 1 80 0ZM-6 42a36 26 0 0 1 72 0ZM104 42a30 20 0 0 1 60 0Z" className="car-hill" />
          {trees([44, 212, 7, 58, 218, 5, 72, 208, 8, 116, 214, 5, 66, 150, 6, 84, 144, 8, 102, 150, 5, 118, 146, 5, 50, 86, 7, 68, 90, 5, 88, 82, 6, 106, 88, 5, 122, 26, 7, 140, 34, 5, 26, 32, 7, 46, 22, 5, 22, 244, 6, 38, 252, 4])}
        </>
      );
    case 2:
      return (
        <>
          <path d="M110 12h56v80h-56ZM74 182h36v26h-36Z" className="car-field" />
          <path d="M-6 170h40v58h-40Z" className="car-crop" />
          <path d="M114 20h52M114 28h52M114 36h52M114 44h52M114 52h52M114 60h52M114 68h52M114 76h52M114 84h52M78 189h28M78 195h28M78 201h28M6 174v50M14 174v50M22 174v50M30 174v50" className="car-furrow" />
          <ellipse cx="70" cy="106" rx="16" ry="9" className="car-pond" />
          {fence('M104 10V96M-4 164H36M114 100H164')}
          <path d="M126 112a6 6 0 0 1 12 0ZM142 116a5 5 0 0 1 10 0Z" className="car-hay" />
          {trees([22, 40, 7, 42, 28, 5, 150, 150, 6, 146, 236, 5, 12, 110, 5])}
          {each([56, 92, 84, 90, 60, 122, 80, 124, 150, 176, 40, 246, 124, 140, 138, 132, 24, 142], 2, ([x, y]) => (
            <circle cx={x} cy={y} r="1.7" className="car-flower" />
          ))}
        </>
      );
    case 4:
      return (
        <>
          <path d="M84 118L122 14 138 40 150 30 168 60V118ZM-6 88L22 26 48 66 40 76Z" className="car-rock" />
          <path d="M122 14L138 40 130 118H108Z" className="car-ridge" />
          <path d="M122 14L111 44 118 39 123 46 129 38 138 40ZM150 30L143 44 149 41 154 46 160 40ZM22 26L14 44 20 40 25 45 32 38Z" className="car-snow" />
          <circle cx="108" cy="162" r="22" className="car-knoll" />
          {firs([100, 170, 16, 116, 164, 14, 108, 180, 11, 146, 236, 16, 132, 250, 12, 154, 214, 12, 34, 246, 15, 50, 236, 11, 14, 226, 13, 52, 150, 13, 60, 176, 11, 64, 124, 10])}
        </>
      );
    case 6:
      return (
        <>
          <path d="M0 58H160M0 114H160M0 170H160M32 0V260M128 0V260" className="car-street" />
          {blocks([
            45, 71, 22, 30, 0, 93, 71, 22, 30, 1, 45, 127, 22, 30, 2, 93, 127, 22, 30, 0, 45, 183, 22, 30, 1, -4, 71, 23, 30, 2, 141, 127, 23, 30, 1, -4, 127, 23, 30,
            0, 141, 183, 23, 30, 0, 93, 239, 22, 26, 1, 141, 239, 23, 26, 2, -4, 239, 23, 26, 1, 45, 239, 22, 26, 0, 93, 16, 22, 29, 2, 141, 16, 23, 29, 1, -4, 16,
            23, 29, 0,
          ])}
          <rect x="93" y="183" width="22" height="30" rx="1.6" className="car-park" />
          <rect x="141" y="71" width="23" height="30" rx="1.6" className="car-park" />
          {trees([100, 194, 5, 110, 204, 5, 149, 82, 5, 157, 94, 4])}
          <path d="M56 120v-12M104 176v-12M122 200h12M26 140h12" className="car-zebra" />
        </>
      );
    case 8:
      return (
        <>
          <path d="M-4 18H58Q52 58 40 86Q28 114 32 132Q34 150 16 168L-4 192Z" className="car-sea" />
          <path d="M58 18Q52 58 40 86Q28 114 32 132Q34 150 16 168L-4 192" className="car-beach" />
          {each([10, 52, 26, 38, 12, 100, 8, 148], 2, ([x, y]) => (
            <path d={`M${x} ${y}q3 -3 6 0t6 0`} className="car-wave" />
          ))}
          <path d="M20 76h13l-2.4 3.4h-8.4ZM27 74.6v-11l5.6 10Z" className="car-boat" />
          <path d="M120 238q5 -9 1 -19M142 252q5 -9 1 -19M136 158q5 -9 1 -19" className="car-palm-trunk" />
          {each([121, 219, 143, 233, 137, 139], 2, ([x, y]) => (
            <path d={`M${x} ${y}l-8 2M${x} ${y}l8 1M${x} ${y}l-5 -6M${x} ${y}l4 -7`} className="car-palm" />
          ))}
        </>
      );
    case 9:
      return <path d="M166 222Q150 212 140 204L82 166Q64 154 44 150Q34 148 28 140" className="car-river" />;
    case 10:
      return (
        <>
          <path d="M-6 178Q30 150 62 170Q84 184 98 210V266H-6ZM92 -6Q110 20 134 22Q152 24 166 42V-6ZM108 98Q136 82 166 92V134Q142 108 108 98Z" className="car-dune" />
          <path d="M-6 178Q30 150 62 170Q84 184 98 210M92 -6Q110 20 134 22Q152 24 166 42M108 98Q136 82 166 92" className="car-crest" />
          <path d="M106 66l5-16h26l5 16Z" className="car-mesa" />
          <path d="M126 50h11l5 16h-12Z" className="car-mesa-shade" />
          {cacti([18, 214, 17, 44, 246, 13, 104, 178, 12, 150, 88, 14, 16, 156, 12, 124, 250, 13, 22, 40, 11])}
          <path d="M46 204l6 -7 7 2 3 6ZM140 232l4 -5 6 2 1 4ZM14 70l5 -6 6 2 2 5Z" className="car-stone" />
        </>
      );
    default:
      return null;
  }
}

/** A side-view hatchback facing +x; the wheels touch y 1.6, the road's centre line is y 0. */
function Car({ puff, beamRef, bodyRef }: { puff: boolean; beamRef?: Ref<SVGPathElement>; bodyRef?: Ref<SVGGElement> }) {
  return (
    <>
      <ellipse cx="0" cy="2.4" rx="13" ry="2" className="car-shadow" />
      {puff && <circle cx="-15" cy="-3" r="2.2" className="car-puff anim-decor" />}
      <path ref={beamRef} d="M13 -7.2L34 -13V-1L13 -4.8Z" className="car-beam" />
      <g ref={bodyRef}>
        <path d="M-9 -9L-5.6 -14.6Q-5 -15.5 -3.8 -15.5H4.2Q5.4 -15.5 6.1 -14.6L10 -9Z" className="car-body" />
        <rect x="-13.5" y="-10" width="27" height="8.6" rx="3.4" className="car-body" />
        <path d="M-6.8 -9.6L-4.5 -13.7H-0.9V-9.6ZM0.9 -9.6V-13.7H4L6.9 -9.6Z" className="car-glass" />
        <path d="M-12.5 -4.6H12.5" className="car-trim" />
        <rect x="11.6" y="-8.4" width="2.2" height="2.4" rx="0.8" className="car-headlight" />
        <rect x="-13.8" y="-8.4" width="1.8" height="2.4" rx="0.8" className="car-taillight" />
        <circle cx="-7.4" cy="-2" r="3.6" className="car-tyre" />
        <circle cx="7.4" cy="-2" r="3.6" className="car-tyre" />
        <circle cx="-7.4" cy="-2" r="1.4" className="car-hub" />
        <circle cx="7.4" cy="-2" r="1.4" className="car-hub" />
      </g>
    </>
  );
}

/** A line across the road at `s`. */
function across(road: Road, s: number, half = 8.5): string {
  const p = roadPoint(road, s);
  const nx = -Math.sin(p.a) * half;
  const ny = Math.cos(p.a) * half;
  return `M${f1(p.x - nx)} ${f1(p.y - ny)}L${f1(p.x + nx)} ${f1(p.y + ny)}`;
}

/** Railings along both edges of a straight stretch [a, b]. */
function railings(road: Road, a: number, b: number): string {
  const p = roadPoint(road, a);
  const q = roadPoint(road, b);
  const nx = -Math.sin(p.a) * 9.6;
  const ny = Math.cos(p.a) * 9.6;
  return `M${f1(p.x + nx)} ${f1(p.y + ny)}L${f1(q.x + nx)} ${f1(q.y + ny)}M${f1(p.x - nx)} ${f1(p.y - ny)}L${f1(q.x - nx)} ${f1(q.y - ny)}`;
}

/** The finish flag of design n: pole foot, cloth corner, the side the cloth flies to. */
export function flagOf(n: number) {
  const [, , , x, y, dir] = DESIGNS[n]!.f;
  return { x, y, top: y - 26, cx: x + dir * 9, cy: y - 20, dir };
}

/** The road of design n with its scenery, flags, posts and (for the current road) the trail. */
function World({ n, fill, capacity, trailRef, clothRef, raysRef, starRef, complete }: {
  n: number;
  fill: number;
  capacity?: number;
  trailRef?: (i: number) => Ref<SVGPathElement>;
  clothRef?: Ref<SVGGElement>;
  raysRef?: Ref<SVGGElement>;
  starRef?: Ref<SVGPathElement>;
  complete: boolean;
}) {
  const road = ROADS[n]!;
  const design = DESIGNS[n]!;
  const ticks = capacity !== undefined ? scaleTicks(capacity) : PLAIN_TICKS.map((share) => ({ share, value: null }));
  const [px, py, pd] = design.f;
  const flag = flagOf(n);
  const bridge = design.b;
  const parts = trailParts(n);
  return (
    <g className={`car-w${n + 1}`}>
      <rect x="-1" y="-1" width={VIEW_W + 2} height={VIEW_H + 2} className="car-ground" />
      {scenery(n, 0)}
      <path d={road.d} className="car-verge" />
      {scenery(n, 1)}
      <path d={road.d} className="car-road-edge" />
      <path d={road.d} className="car-road" />
      <path d={road.d} className="car-road-dash" />
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i === 1 && bridge && (
            <>
              <path d={subPath(road, bridge[0]!, bridge[1]!)} className="car-road-edge" />
              <path d={subPath(road, bridge[0]!, bridge[1]!)} className="car-road" />
              <path d={subPath(road, bridge[0]!, bridge[1]!)} className="car-road-dash" />
            </>
          )}
          <path ref={trailRef?.(i)} d={subPath(road, part[0], part[1])} pathLength={100} className="car-trail" style={{ strokeDashoffset: trailOffset(road, part, fill) }} />
        </Fragment>
      ))}
      {bridge && <path d={railings(road, bridge[0]!, bridge[1]!)} className="car-rail" />}
      {ticks.map(({ share, value }) => {
        const post = postAt(road, share);
        return (
          <g key={share} className="car-post">
            <rect x={post.x - 1.8} y={post.y - 4} width="3.6" height="8" rx="1" className="car-post-body" />
            <rect x={post.x - 1.8} y={post.y - 4} width="3.6" height="2.6" rx="1" className="car-post-cap" />
            {value !== null && (
              <text x={post.x + post.side * 4.5} y={post.y} dominantBaseline="central" textAnchor={post.side > 0 ? 'start' : 'end'}>
                {formatNumber(value)}
              </text>
            )}
          </g>
        );
      })}
      <path d={across(road, road.s0 - 15)} className="car-line-across" />
      <path d={across(road, road.s1 + 15)} className="car-line-finish" />
      <path d={`M${px} ${py}V${py - 20}`} className="car-pole" />
      <path d={`M${px} ${py - 20}l${12 * pd} 3.6l${-12 * pd} 3.6Z`} className="car-start-flag" />
      <path d={`M${flag.x} ${flag.y}V${flag.top}`} className="car-pole" />
      <g ref={clothRef} className="car-cloth" style={{ transformOrigin: `${flag.x}px ${flag.top}px` }}>
        <path d={`M${flag.x} ${flag.top}h${18 * flag.dir}v12h${-18 * flag.dir}Z`} className="car-cloth-light" />
        <path
          d={[0, 2, 5, 7, 8, 10].map((k) => `M${flag.x + flag.dir * 4.5 * (k % 4)} ${flag.top + 4 * Math.floor(k / 4)}h${4.5 * flag.dir}v4h${-4.5 * flag.dir}Z`).join('')}
          className="car-cloth-dark"
        />
      </g>
      <g ref={raysRef} className="car-rays" style={{ transformOrigin: `${flag.cx}px ${flag.cy}px` }}>
        <path
          d={[0, 45, 90, 135, 180, 225, 270, 315]
            .map((deg) => {
              const c = Math.cos((deg * Math.PI) / 180);
              const s = Math.sin((deg * Math.PI) / 180);
              return `M${fmt(flag.cx + c * 13.5)} ${fmt(flag.cy + s * 11)}L${fmt(flag.cx + c * 18)} ${fmt(flag.cy + s * 14.5)}`;
            })
            .join('')}
        />
      </g>
      {complete && (
        <path
          ref={starRef}
          d={`M${flag.cx + flag.dir * 20} ${flag.top - 4}l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8Z`}
          className="car-star"
          style={{ transformOrigin: `${flag.cx + flag.dir * 20}px ${flag.top + 3}px` }}
        />
      )}
    </g>
  );
}

export function CarHero({ fill, capacity, state = 'active', level, motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const id = `car${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);

  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  /** While a level-up plays: the road on screen and the one above it. */
  const [roads, setRoads] = useState<[number, number] | null>(null);
  const playing = useRef(false);
  const playToken = useRef(0);
  /** Timer of a hold: the level went up and the old road stays until playLevelUp (0: none). */
  const holding = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const levelRef = useRef(level);
  levelRef.current = level;
  const shown = override ?? target;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const n = roads ? roads[0] : roadIndex(level);
  const road = ROADS[n]!;

  const sceneRef = useRef<SVGGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const trails = useRef<(SVGPathElement | null)[]>([]);
  const carRef = useRef<SVGGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const beamRef = useRef<SVGPathElement>(null);
  const clothRef = useRef<SVGGElement>(null);
  const raysRef = useRef<SVGGElement>(null);
  const starRef = useRef<SVGPathElement>(null);
  const trailRef = (i: number) => (el: SVGPathElement | null) => {
    trails.current[i] = el;
  };

  useEffect(installPauseWhenHidden, []);

  /** Animations that drive the car and its trail on road `k` from one fill to another. */
  const driveAll = (k: number, from: number, to: number, options: KeyframeAnimationOptions) => {
    const r = ROADS[k]!;
    const steps = driveSteps(from, to);
    return [
      animate(carRef.current, driveFrames(r, from, to), options),
      ...trailParts(k).map((part, i) =>
        animate(
          trails.current[i],
          Array.from({ length: steps + 1 }, (_, j) => ({ strokeDashoffset: trailOffset(r, part, from + ((to - from) * j) / steps) })),
          options,
        ),
      ),
    ];
  };

  // Prop-driven changes, before paint. A level up is followed by playLevelUp: the road and car on
  // screen stay until then (or HOLD_MS, then the new road fades in). Otherwise the car drives
  // along the road (never across the grass) and a new road fades in.
  const previous = useRef({ target, n, level });
  const painted = useRef({ n, shown });
  const release = () => {
    holding.current = 0;
    setRoads(null);
    setOverride(null);
  };
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = { target, n, level };
    if (playing.current || holding.current) return;
    if (level !== undefined && from.level !== undefined && level > from.level) {
      holding.current = window.setTimeout(release, HOLD_MS);
      setRoads([painted.current.n, painted.current.n]);
      setOverride(painted.current.shown);
      return;
    }
    if (from.target === target && from.n === n) return;
    setOverride(null);
    if (motion === 'reduced' || from.n !== n) {
      animate(sceneRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    driveAll(n, from.target, target, { duration: Math.round(260 + 500 * Math.abs(target - from.target)), easing: DRIVE_EASING });
  }, [target, n, level, motion]);
  // What this commit shows; the effect above reads the previous commit's.
  useLayoutEffect(() => {
    painted.current = { n, shown };
  });
  useEffect(() => () => window.clearTimeout(holding.current), []);

  // The skill is completed on screen: a gold star lights up over the finish (never on first load).
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete') return;
    const reduced = motion === 'reduced';
    animate(starRef.current, reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: reduced ? 240 : 500,
      easing: reduced ? 'ease-out' : 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => carRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const car = carRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        const held = holding.current;
        window.clearTimeout(held);
        holding.current = 0;
        if (!car || typeof car.animate !== 'function') {
          if (held) flushSync(release);
          onOverflow?.();
          return;
        }
        playing.current = true;
        const running: Animation[] = [];
        const track = (a: Animation | null, duration: number): Promise<void> => {
          if (!a) return Promise.resolve();
          running.push(a);
          return done(a, duration);
        };
        // The props name the new level: the completed road is `level − levels`'s (kept on screen by
        // the hold), and the last is the new level's, so the play ends on what the props show.
        const seq = levelUpRoads(levelRef.current, levels);
        let k = 0;
        const start = Math.min(clamp(fromFill), shownRef.current);
        const end = clamp(toFill);
        flushSync(() => {
          setScripted(true);
          setOverride(start);
          setRoads([seq[0]!, seq[1]!]);
        });

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            const last = seq[seq.length - 1]!;
            flushSync(() => {
              setOverride(end);
              setRoads([last, last]);
            });
            await track(animate(sceneRef.current, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }), 240);
            return;
          }
          let current = start;
          const drive = (to: number, t: CarTiming) => {
            const options: KeyframeAnimationOptions = { duration: t.duration, easing: t.easing, fill: 'forwards' };
            const waits = driveAll(seq[k]!, current, to, options).map((a) => track(a, t.duration));
            current = to;
            return Promise.all(waits);
          };
          const beat = (t: CarTiming) => {
            const o = { duration: t.duration, easing: t.easing };
            return Promise.all([
              track(animate(clothRef.current, [{ transform: 'skewY(0deg) scaleX(1)' }, { transform: 'skewY(-14deg) scaleX(0.86)' }, { transform: 'skewY(10deg) scaleX(0.94)' }, { transform: 'skewY(-6deg) scaleX(0.9)' }, { transform: 'skewY(0deg) scaleX(1)' }], o), t.duration),
              track(animate(beamRef.current, [{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0, offset: 0.4 }, { opacity: 0.9, offset: 0.6 }, { opacity: 0 }], o), t.duration),
              track(animate(bodyRef.current, [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)', offset: 0.2 }, { transform: 'translateY(0)', offset: 0.45 }, { transform: 'translateY(-1.5px)', offset: 0.65 }, { transform: 'translateY(0)' }], o), t.duration),
              track(animate(raysRef.current, [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.35 }, { opacity: 0, transform: 'scale(1.25)' }], { ...o, easing: 'ease-out' }), t.duration),
            ]);
          };
          // The car drives over the top edge into the next road while the world scrolls down.
          const pan = async (t: CarTiming) => {
            flushSync(() => setOverride(1));
            const o: KeyframeAnimationOptions = { duration: t.duration, easing: t.easing, fill: 'forwards' };
            await Promise.all([
              track(animate(worldRef.current, [{ transform: 'translateY(0)' }, { transform: `translateY(${VIEW_H}px)` }], o), t.duration),
              track(animate(car, panFrames(ROADS[seq[k]!]!, ROADS[seq[k + 1]!]!), o), t.duration),
            ]);
            // The next road now looks exactly like the scrolled one: swap without a jump.
            k++;
            flushSync(() => {
              setOverride(0);
              setRoads([seq[k]!, seq[k + 1] ?? seq[k]!]);
            });
            running.splice(0).forEach((a) => a.cancel());
            current = 0;
          };

          let phase = nextPhase(IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = carTiming(phase, start, end);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await drive(1, timing);
                break;
              case 'overflow':
                onOverflow?.();
                await beat(timing);
                break;
              case 'draining':
                await pan(timing);
                break;
              case 'refilling':
                await drive(refillTarget(phase, end), timing);
                break;
            }
            phase = nextPhase(phase, { type: DONE_EVENT[phase.phase] } as Parameters<typeof nextPhase>[1]);
          }
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            flushSync(() => setOverride(end));
            running.forEach((a) => a.cancel());
            playing.current = false;
            requestAnimationFrame(() => {
              setScripted(false);
              setRoads(null);
              if (Math.abs(targetRef.current - end) > 1e-6) setOverride(null);
            });
          }
        }
      },
    }),
    [motion],
  );

  const shownMarks = marks ?? [];
  const reserved = useRef(false);
  reserved.current = scripted ? reserved.current || shownMarks.length > 0 : shownMarks.length > 0;
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const markAt = (h: number) => roadPoint(road, carAt(road, h));
  const captionY = captionYs(captioned.map((m) => markAt(m.height).y - 12));
  const pose = roadPose(road, shown);
  const complete = state === 'complete';
  const classes = ['car', 'car--hero', `car--${state}`, reserved.current ? 'car--marked' : '', scripted ? 'car--scripted' : ''];

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <svg className="car-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label ?? carTheme.text.fillLabel(Math.floor(shown * 100))}>
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect width={VIEW_W} height={VIEW_H} rx="22" />
          </clipPath>
        </defs>
        <g ref={sceneRef}>
          <g clipPath={`url(#${id}-clip)`}>
            <g ref={worldRef}>
              <World n={n} fill={shown} capacity={capacity} trailRef={trailRef} clothRef={clothRef} raysRef={raysRef} starRef={starRef} complete={complete} />
              {scripted && roads && (
                <g transform={`translate(0 ${-VIEW_H})`}>
                  <World n={roads[1]} fill={0} capacity={capacity} complete={false} />
                </g>
              )}
            </g>
          </g>
          {shownMarks.map((mark) => {
            const p = markAt(mark.height);
            const k = captioned.indexOf(mark);
            const top = p.y - 21;
            return (
              <g key={mark.id} className="car-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
                {k >= 0 && <path d={`M${fmt(p.x + 9)} ${fmt(top + 3.5)}L${VIEW_W + 2} ${fmt(captionY[k]!)}`} className="car-mark-leader" />}
                <rect x={p.x - 10} y={top - 4} width="24" height="26" className="car-mark-hit" />
                <path d={`M${fmt(p.x)} ${fmt(p.y - 5)}V${fmt(top)}`} className="car-mark-pole" />
                <path d={`M${fmt(p.x)} ${fmt(top)}L${fmt(p.x + 10)} ${fmt(top + 3.5)}L${fmt(p.x)} ${fmt(top + 7)}Z`} className="car-mark-flag" />
              </g>
            );
          })}
          <g ref={carRef} className="car-car" style={{ transform: poseTransform(pose) }}>
            <Car puff={state === 'active'} beamRef={beamRef} bodyRef={bodyRef} />
          </g>
        </g>
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="car-mark-caption"
          style={{ left: `${(CAPTION_X / VIEW_W) * 100}%`, top: `${(captionY[i]! / VIEW_H) * 100}%`, paddingBlock: captionPad(captionY, i) }}
          aria-label={copy.marks.onFlask(mark.label)}
          onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}
        >
          {shortLabel(mark.label)}
        </button>
      ))}
    </div>
  );
}

/** The mini draws the hero's road at this scale, the course (car y 55..240 on every road) filling the 40-unit square. */
export const MINI_SCALE = 0.165;
const MINI_X = 20 - 80 * MINI_SCALE;
const MINI_Y = 20 - 147.5 * MINI_SCALE;
export const toMini = (x: number, y: number) => ({ x: fmt(MINI_X + x * MINI_SCALE), y: fmt(MINI_Y + y * MINI_SCALE) });

/** The mini's chequered flag (pole foot and the side the cloth flies to) beside the finish, kept inside the tile. */
export function miniFlag(n: number): { x: number; y: number; dir: 1 | -1 } {
  const road = ROADS[n]!;
  const f = roadPoint(road, road.s1 + 15);
  const p = toMini(f.x, f.y);
  const dir = p.x > 24 ? -1 : 1;
  return { x: fmt(Math.min(33, Math.max(7, p.x - dir * 1.5))), y: fmt(Math.min(33, Math.max(12, p.y))), dir };
}

export function CarMini({ fill, state = 'active', size = 32, level, label }: ProgressMiniProps) {
  const n = roadIndex(level);
  const road = ROADS[n]!;
  const shown = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const p = roadPoint(road, carAt(road, shown));
  const car = toMini(p.x, p.y);
  const flag = miniFlag(n);
  return (
    <svg className={`car car--mini car--${state} car-w${n + 1}`} width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={label ?? carTheme.text.fillLabel(Math.floor(shown * 100))}>
      <rect width="40" height="40" rx="10" className="car-ground" />
      <g transform={`matrix(${MINI_SCALE} 0 0 ${MINI_SCALE} ${fmt(MINI_X)} ${fmt(MINI_Y)})`}>
        <path d={road.d} className="car-road" />
        <path d={subPath(road, road.s0, road.s1)} pathLength={100} className="car-trail" style={{ strokeDashoffset: fmt(100 * (1 - shown)) }} />
      </g>
      <path d={`M${flag.x} ${flag.y}V${flag.y - 9}`} className="car-pole" />
      <path d={`M${flag.x} ${flag.y - 9}h${6 * flag.dir}v4.4h${-6 * flag.dir}Z`} className="car-mini-flag" />
      <path d={`M${flag.x} ${flag.y - 9}h${3 * flag.dir}v2.2h${-3 * flag.dir}ZM${flag.x + 3 * flag.dir} ${flag.y - 6.8}h${3 * flag.dir}v2.2h${-3 * flag.dir}Z`} className="car-mini-chequer" />
      <circle cx={car.x} cy={car.y} r="3.8" className="car-mini-car" />
    </svg>
  );
}

export const carTheme: ProgressThemeDefinition = {
  key: 'car',
  available: true,
  text: {
    name: 'Машинка',
    levelNoun: 'Поездка',
    levelGenitive: 'поездки',
    levelForms: ['поездка', 'поездки', 'поездок'],
    levelFormsOf: ['поездки', 'поездок', 'поездок'],
    completed: (n) => `Поездка ${n} завершена`,
    fillLabel: (p) => `Машинка проехала ${p}% пути`,
    hint: 'Машинка едет по дороге к финишу',
  },
  Hero: CarHero,
  Mini: CarMini,
  // The definition knows only the height, so it answers for the first road; the hero draws its
  // marks along the road of its own level.
  markPoint(height) {
    const p = roadPoint(HERO_ROAD, carAt(HERO_ROAD, height));
    return { x: p.x, y: p.y };
  },
};
