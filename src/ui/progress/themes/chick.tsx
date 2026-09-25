import { memo, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { copy } from '../../copy';
import { DONE_EVENT, IDLE, nextPhase, refillTarget, type AnimationState } from '../../components/flaskAnimation';
import { PLAIN_TICKS } from '../../components/flaskScale';
import { useMotion, type MotionMode } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressState, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import './chick.css';

// The chick («Цыплёнок»): an egg in a straw nest cracks, hatches and grows into a chick; at the
// beat the chick becomes a hen, flaps, hops out of the nest and walks off into the yard behind
// it, where every hen raised in a past level (`level` − 1 of them) strolls about as a miniature.
// A straw band climbs the stake beside the nest to the fill. The picture is a pure function of
// `fill` (chickPose) and of the hen count (yardLayout): renders and the level-up (the flask's
// state machine, sampled poses via WAAPI) share frames.

// ---- Geometry (viewBox 0 0 160 260) ----

const VIEW_W = 160;
const VIEW_H = 260;
const NEST_X = 70;
/** The scene is drawn around NEST_X and shifted left, clear of the stake. */
const SCENE_SHIFT = -8;
const EGG_BASE = 214;
const EGG_LIFT = 30;
/** Feet of the chick and the hen, hidden by the front of the nest. */
const CHICK_FOOT = 212;
const HEN_FOOT = 216;
/** The hen sits a little left of the nest's middle, so her tail stays clear of the stake. */
const HEN_X = NEST_X - 4;
/** The hen stands a head taller than the grown chick. */
const HEN_SCALE = 1.06;
/** The growth stake beside the nest: fill 0 at the ground, 1 near its top. */
const STAKE_X = 124;
const STAKE_BOTTOM = 234;
const STAKE_TRAVEL = 192;

/** Egg-local shell outline around (0, 0); the shell splits along ZIG. */
const EGG_PATH = 'M0 -32 C15 -32 25 -12 25 5 C25 20 14 30 0 30 C-14 30 -25 20 -25 5 C-25 -12 -15 -32 0 -32 Z';
type Point = [number, number];
const ZIG: Point[] = [[-27, -3], [-19, -10], [-12, -2], [-5, -11], [2, -3], [9, -12], [16, -4], [27, -9]];
/** The chick pecks at ZIG[PECK]; the cracks run from there to both sides. */
const PECK = 4;
/** The lid (the top of the shell) hinges on the right side of the egg. */
const LID_PIVOT: Point = [24, -9];

const pathOf = (points: Point[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const lengthOf = (points: Point[]) => points.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - points[i]![0], y - points[i]![1]), 0);
const CRACK_L_POINTS = ZIG.slice(0, PECK + 1).reverse();
const CRACK_R_POINTS = ZIG.slice(PECK);
export const CRACK_L_LEN = lengthOf(CRACK_L_POINTS);
export const CRACK_R_LEN = lengthOf(CRACK_R_POINTS);
const ZIG_PATH = pathOf(ZIG);
const ZIG_TAIL = ZIG.map(([x, y]) => `L${x} ${y}`).join(' ');
const LID_CLIP = `M-40 -50 L-40 -3 ${ZIG_TAIL} L40 -9 L40 -50 Z`;
const BASE_CLIP = `M-40 50 L-40 -3 ${ZIG_TAIL} L40 -9 L40 50 Z`;

// ---- Stages: a pure function of fill ----

export type ChickStage = 'egg' | 'cracks' | 'hatching' | 'chick' | 'hen';

/** The shells give way to the chick between HATCH_END and 0.75. */
const HATCH_END = 0.72;
export const CHICK_MIN = 1;
export const CHICK_MAX = 1.35;
/** The last frame before the beat: the chick at full size (1 itself is the hen). */
export const TOP = 0.999;

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const round = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0–0.25 an egg, 0.25–0.5 cracks grow, 0.5–0.75 it hatches, 0.75–1 the chick grows, 1 a hen. */
export function chickStage(fill: number): ChickStage {
  const f = clamp(fill);
  if (f >= 1) return 'hen';
  if (f >= 0.75) return 'chick';
  if (f >= 0.5) return 'hatching';
  if (f >= 0.25) return 'cracks';
  return 'egg';
}

export function crackProgress(fill: number): number {
  return clamp((clamp(fill) - 0.25) / 0.25);
}

export function hatchProgress(fill: number): number {
  return clamp((clamp(fill) - 0.5) / (HATCH_END - 0.5));
}

export function chickScale(fill: number): number {
  return CHICK_MIN + (CHICK_MAX - CHICK_MIN) * clamp((clamp(fill) - 0.75) / 0.25);
}

export function chickOpacity(fill: number): number {
  const f = clamp(fill);
  return f >= 1 ? 0 : clamp((f - HATCH_END) / (0.75 - HATCH_END));
}

export interface PartStyle {
  transform?: string;
  opacity?: number;
  dash?: number;
}

export const POSE_PARTS = ['shell', 'whole', 'lid', 'lidEdge', 'head', 'crackL', 'crackR', 'chick', 'hen', 'band', 'knot'] as const;
export type PosePart = (typeof POSE_PARTS)[number];
export type ChickPose = Record<PosePart, PartStyle>;

const standAt = (x: number, y: number, rotate: number, scale: number) => `translate(${round(x)}px, ${round(y)}px) rotate(${round(rotate)}deg) scale(${round(scale)})`;
const henAt = (scale: number) => standAt(HEN_X, HEN_FOOT, 0, HEN_SCALE * scale);
const HEN_HOME = henAt(1);

/** Every animated part at `fill`. */
export function chickPose(fill: number): ChickPose {
  const f = clamp(fill);
  const crack = crackProgress(f);
  const hatch = hatchProgress(f);
  const lid = easeOut(clamp(hatch / 0.8));
  const head = easeOut(clamp(hatch / 0.75));
  const chick = chickOpacity(f);
  const hen = f >= 1 ? 1 : 0;
  return {
    shell: { opacity: hen ? 0 : round(1 - chick) },
    // A seamless egg under the two halves while the lid is closed (no hairline along the cut).
    whole: { opacity: hatch > 0 ? 0 : 1 },
    lid: { transform: `translate(${round(2 * lid)}px, ${round(-11 * lid)}px) rotate(${round(30 * lid)}deg)` },
    lidEdge: { opacity: crack >= 1 ? 1 : 0 },
    head: { transform: `translate(0px, ${round(18 - 30 * head)}px)` },
    crackR: { dash: round(CRACK_R_LEN * (1 - clamp(crack / 0.7))) },
    crackL: { dash: round(CRACK_L_LEN * (1 - clamp((crack - 0.3) / 0.7))) },
    chick: { transform: standAt(NEST_X, CHICK_FOOT, 0, chickScale(f)), opacity: round(chick) },
    hen: { transform: HEN_HOME, opacity: hen },
    // The stake's straw band and its knot: the fill itself.
    band: { transform: `scale(1, ${round(f)})` },
    knot: { transform: `translate(0px, ${round(-STAKE_TRAVEL * f)}px)` },
  };
}

// ---- The yard: every hen raised in a past level ----
//
// Hen k (0-based: the hen of level k + 1) keeps slot k for good. The first NEAR_HENS stroll in
// front, the next FAR_HENS further back and smaller, the rest stand in a still flock along the
// fence (FLOCK_MAX of them drawn, three rows deep). Plumage, comb, a bow or scarf in the skill
// colour, and the stroll (one of WANDER_PATTERNS with its speed, phase, reach and side) are
// seeded by k, so a level always shows the same yard.

export const NEAR_HENS = 10;
export const FAR_HENS = 15;
export const FLOCK_MAX = 48;
const FLOCK_ROW = 16;
/** Where the hens may stroll, x in viewBox units. */
export const YARD_LEFT = 3;
export const YARD_RIGHT = 157;
/** Hen-local geometry (the big hen's drawing): around her belly, feet HEN_FEET below, facing left. */
export const HEN_FEET = 14;
/** Half her width in hen units, the head reaching forward in a peck included; her height. */
export const HEN_HALF = 58;
export const HEN_HEIGHT = 118;

/** Hens in the yard at `level` (1-based, the level being filled now): one per level before. */
export function hensBefore(level?: number): number {
  return level !== undefined && Number.isFinite(level) ? Math.max(0, Math.floor(level) - 1) : 0;
}

/** A seeded share 0..1 for hen `i` (salt picks the trait). */
export function henRandom(i: number, salt: number): number {
  let h = Math.imul((i + 1) * 0x9e3779b1 + salt * 0x85ebca77, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export type HenRow = 'near' | 'far' | 'flock';

export interface HenSlot {
  i: number;
  row: HenRow;
  /** Her feet: the middle of her stroll. */
  x: number;
  y: number;
  /** Her size against the big hen's drawing. */
  scale: number;
}

// Hand-placed so the first hens stand where the nest never hides them for long.
const NEAR_SLOTS: Point[] = [
  [24, 152],
  [104, 146],
  [74, 102],
  [140, 150],
  [30, 134],
  [90, 120],
  [16, 106],
  [120, 104],
  [140, 124],
  [46, 100],
];
const FAR_SLOTS: Point[] = [
  [52, 88],
  [110, 90],
  [30, 92],
  [82, 85],
  [136, 88],
  [64, 94],
  [96, 93],
  [146, 91],
  [16, 86],
  [124, 84],
  [42, 84],
  [72, 90],
  [140, 94],
  [100, 85],
  [20, 94],
];

export function henSlot(index: number): HenSlot {
  const i = Math.max(0, Math.floor(index));
  if (i < NEAR_HENS) {
    const [x, y] = NEAR_SLOTS[i]!;
    return { i, row: 'near', x, y, scale: round3(0.12 + (y - 100) * 0.0008) };
  }
  if (i < NEAR_HENS + FAR_HENS) {
    const [x, y] = FAR_SLOTS[i - NEAR_HENS]!;
    return { i, row: 'far', x, y, scale: round3(0.084 + (y - 84) * 0.0008) };
  }
  // The flock gathers by the coop and spreads along the fence, front row first.
  const k = (i - NEAR_HENS - FAR_HENS) % FLOCK_MAX;
  const row = Math.floor(k / FLOCK_ROW);
  const x = 45 + (k % FLOCK_ROW) * 6.9 + (row % 2) * 3.4 + (henRandom(i, 8) - 0.5) * 2;
  const y = 80 - row * 2.6 + (henRandom(i, 9) - 0.5) * 0.8;
  return { i, row: 'flock', x: round(x), y: round(y), scale: round3(0.062 - row * 0.004) };
}

export interface YardLayout {
  near: HenSlot[];
  far: HenSlot[];
  /** The still flock: at most FLOCK_MAX drawn. */
  flock: HenSlot[];
}

export function yardLayout(count: number): YardLayout {
  const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const slots = (from: number, to: number) => Array.from({ length: Math.max(0, Math.min(n, to) - from) }, (_, k) => henSlot(from + k));
  return {
    near: slots(0, NEAR_HENS),
    far: slots(NEAR_HENS, NEAR_HENS + FAR_HENS),
    flock: slots(NEAR_HENS + FAR_HENS, NEAR_HENS + FAR_HENS + FLOCK_MAX),
  };
}

export const PLUMES = ['brown', 'white', 'speckled', 'blackred'] as const;
export type Plume = (typeof PLUMES)[number];
export type HenWear = 'none' | 'scarf' | 'bow';

export interface HenLook {
  plume: Plume;
  /** Comb size against the big hen's. */
  comb: number;
  /** Every third hen wears the skill colour. */
  wear: HenWear;
}

const COMBS = [0.8, 1, 1.25];

export function henLook(index: number): HenLook {
  const i = Math.max(0, Math.floor(index));
  // Each hen's plumage moves on by 1–3 from the one before, so neighbours never match.
  let plume = 0;
  for (let k = 1; k <= i; k++) plume += 1 + Math.floor(henRandom(k, 1) * 3);
  return {
    plume: PLUMES[plume % PLUMES.length]!,
    comb: COMBS[Math.floor(henRandom(i, 2) * COMBS.length)]!,
    wear: i % 3 === 1 ? (i % 2 ? 'scarf' : 'bow') : 'none',
  };
}

// ---- The stroll: CSS keyframes compiled from WANDER_PATTERNS ----

/**
 * Strolls in nominal seconds: `wS` waits, `xN` walks to N (pattern units, −10..10; she turns
 * first when the way lies behind her), `pN` pecks N times, `h` hops. Each starts and ends at 0
 * facing left after a pause, so a hen that has just joined stands still where she arrived.
 */
export const WANDER_PATTERNS = [
  'w1.8 x-8 p2 w1 x7 w0.6 h w1.2 p1 x0 w1',
  'w1.6 p3 w1.2 x4 p2 w2 x-5 w0.8 p1 w0.6 x0 w1.2',
  'w1.6 x10 w1.4 p1 x-10 w0.8 h p2 w1 x0 w0.8',
  'w1.8 x-6 h w0.8 x3 p2 w1.4 x9 w1 h x0 w1',
] as const;
export const WANDER_REACH = 10;
/** Pattern units per nominal second; a turn, a waddle step, a peck and a hop in seconds. */
const WALK_SPEED = 4;
const TURN_S = 0.32;
const STEP_S = 0.32;
const PECK_S = 0.6;
const HOP_S = 0.5;
/** How narrow she gets mid-turn, and the instant (s) of the flip. */
const TURN_NARROW = 0.45;
const STEP_GAP = 0.004;
/** Degrees and hen units: waddle, body tilt and head dip of a peck, the height of a hop. */
const WADDLE = 5;
const BOB = 4;
const TILT = 22;
const DIP = 58;
const HOP_LIFT = 30;
/** Pivots, hen units: her front foot (waddle, peck, hop) and the top of her neck (the head). */
const FOOT: Point = [-6, HEN_FEET];
const NECK: Point = [-12, -60];

export interface WanderFrames {
  /** Nominal length, s. */
  length: number;
  /** [time 0..1, x in pattern units, facing: 1 left, −1 right]. */
  walk: [number, number, number][];
  /** [time, body tilt in degrees, lift in hen units]. */
  pose: [number, number, number][];
  /** [time, head angle in degrees]. */
  peck: [number, number][];
}

function compileWander(pattern: string): WanderFrames {
  let t = 0;
  let x = 0;
  let face = 1;
  const walk: [number, number, number][] = [[0, 0, 1]];
  const pose: [number, number, number][] = [[0, 0, 0]];
  const peck: [number, number][] = [[0, 0]];
  // A turn narrows her, flips her in one step (never a flat sliver) and widens her again.
  const turn = (to: number) => {
    walk.push([t, x, face], [t + TURN_S / 2, x, face * TURN_NARROW], [t + TURN_S / 2 + STEP_GAP, x, to * TURN_NARROW]);
    t += TURN_S;
    face = to;
    walk.push([t, x, face]);
  };
  for (const step of pattern.split(' ')) {
    const value = Number(step.slice(1));
    if (step[0] === 'w') t += value;
    else if (step[0] === 'x' && value !== x) {
      const dir = value < x ? 1 : -1;
      if (dir !== face) turn(dir);
      const time = Math.abs(value - x) / WALK_SPEED;
      const steps = Math.max(2, Math.round(time / STEP_S));
      walk.push([t, x, face]);
      pose.push([t, 0, 0]);
      for (let k = 1; k < steps; k++) pose.push([t + (time * k) / steps, k % 2 ? WADDLE : -WADDLE, -BOB]);
      t += time;
      x = value;
      walk.push([t, x, face]);
      pose.push([t, 0, 0]);
    } else if (step[0] === 'p') {
      for (let k = 0; k < value; k++) {
        pose.push([t, 0, 0], [t + 0.2, -TILT, 0], [t + 0.36, -TILT, 0], [t + PECK_S, 0, 0]);
        peck.push([t, 0], [t + 0.2, -DIP], [t + 0.36, -DIP], [t + PECK_S, 0]);
        t += PECK_S;
      }
    } else if (step[0] === 'h') {
      pose.push([t, 0, 0], [t + 0.18, 0, -HOP_LIFT], [t + 0.36, 0, 0], [t + 0.43, 0, 3], [t + HOP_S, 0, 0]);
      t += HOP_S;
    }
  }
  if (face !== 1) turn(1);
  walk.push([t, x, face]);
  pose.push([t, 0, 0]);
  peck.push([t, 0]);
  // Times as shares of the stroll (0.01 % steps); a flip keeps its own later step.
  const norm = <T extends number[]>(frames: T[]) => {
    let last = -1;
    return frames.map(([time, ...rest]) => {
      let share = Math.round((time! / t) * 10000) / 10000;
      if (share <= last && share < 1) share = Math.round((last + 0.0001) * 10000) / 10000;
      last = Math.max(last, share);
      return [share, ...rest] as unknown as T;
    });
  };
  return { length: round(t), walk: norm(walk), pose: norm(pose), peck: norm(peck) };
}

export const WANDER: readonly WanderFrames[] = WANDER_PATTERNS.map(compileWander);

const px = (v: number) => `${round(v)}px`;
/** Rotation by `deg` around `pivot`, then a lift, as one translate + rotate (they interpolate). */
function turnAbout([x, y]: Point, deg: number, lift = 0): string {
  const a = (deg * Math.PI) / 180;
  const dx = x - (x * Math.cos(a) - y * Math.sin(a));
  const dy = y - (x * Math.sin(a) + y * Math.cos(a)) + lift;
  const tenth = (v: number) => Math.round(v * 10) / 10 + 0;
  return `translate(${tenth(dx)}px, ${tenth(dy)}px) rotate(${round(deg) + 0}deg)`;
}
const walkTransform = (x: number, face: number) => `translate(${px(x)}, 0px) scale(${round(face)}, 1)`;
const poseTransform = (deg: number, lift: number) => turnAbout(FOOT, deg, lift);
const headTransform = (deg: number) => turnAbout(NECK, deg);

function keyframes(name: string, frames: [number, string][]): string {
  const lines: string[] = [];
  let last = '';
  for (const [t, value] of frames) {
    const line = `  ${Math.round(t * 10000) / 100}% { transform: ${value}; }`;
    if (line !== last) lines.push(line);
    last = line;
  }
  return `@keyframes ${name} {\n${lines.join('\n')}\n}`;
}

/** The stroll keyframes; chick.css holds exactly this text (a test keeps them in step). */
export function wanderCss(): string {
  return WANDER.flatMap((f, p) => [
    keyframes(`chick-walk-${p}`, f.walk.map(([t, x, face]) => [t, walkTransform(x, face)])),
    keyframes(`chick-pose-${p}`, f.pose.map(([t, deg, lift]) => [t, poseTransform(deg, lift)])),
    keyframes(`chick-peck-${p}`, f.peck.map(([t, deg]) => [t, headTransform(deg)])),
  ]).join('\n\n');
}

export interface WanderPose {
  x: number;
  face: number;
  tilt: number;
  lift: number;
  head: number;
}

/** Where a stroll stands at `phase` (0..1): the still pose under reduced motion. */
export function wanderAt(frames: WanderFrames, phase: number): WanderPose {
  const p = ((phase % 1) + 1) % 1;
  const at = <T extends number[]>(list: T[], k: number) => {
    const j = Math.max(1, list.findIndex(([t]) => t! >= p));
    const [t0, ...a] = list[j - 1]!;
    const [t1, ...b] = list[j]!;
    const s = t1! > t0! ? (p - t0!) / (t1! - t0!) : 1;
    return lerp(a[k]!, b[k]!, clamp(s));
  };
  const face = at(frames.walk, 1);
  return { x: round(at(frames.walk, 0)), face: face < 0 ? -1 : 1, tilt: round(at(frames.pose, 0)), lift: round(at(frames.pose, 1)), head: round(at(frames.peck, 0)) };
}

export interface HenWander {
  pattern: number;
  /** Length of one stroll, ms. */
  duration: number;
  /** A negative delay: where in her stroll she is when the yard appears, ms. */
  delay: number;
  /** Pattern units → viewBox units. */
  reach: number;
  /** −1 walks the pattern mirrored. */
  mirror: 1 | -1;
}

export function henWander(index: number): HenWander {
  const i = Math.max(0, Math.floor(index));
  const slot = henSlot(i);
  const pattern = Math.floor(henRandom(i, 3) * WANDER.length);
  const duration = Math.round(WANDER[pattern]!.length * (0.85 + 0.45 * henRandom(i, 4)) * 1000);
  const want = slot.row === 'near' ? 0.8 + henRandom(i, 7) : 0.5 + 0.6 * henRandom(i, 7);
  const room = (Math.min(slot.x - YARD_LEFT, YARD_RIGHT - slot.x) - HEN_HALF * slot.scale) / WANDER_REACH;
  return {
    pattern,
    duration,
    delay: -Math.round(henRandom(i, 5) * duration),
    reach: Math.max(0.2, Math.floor(Math.min(want, room) * 100) / 100),
    mirror: henRandom(i, 6) < 0.5 ? 1 : -1,
  };
}

// ---- The level-up walk: from the nest into the yard ----

/** Behind the nest and off its middle, where she lands after hopping out: her feet on the grass. */
const LAND_FEET = 170;
const LAND_SCALE = 0.36;
const LAND_SIDE = 34;
const HOME_X = HEN_X + SCENE_SHIFT;
const HOME_FEET = HEN_FOOT + HEN_FEET * HEN_SCALE;

export interface HenStand {
  x: number;
  /** Her feet (viewBox units). */
  y: number;
  scale: number;
  /** 1 faces left, −1 right. */
  face: number;
}

/** The hen of `index` hops out to `land`, then walks on the grass, shrinking, to `slot`. */
export function joinPath(index: number): { home: HenStand; land: HenStand; slot: HenStand } {
  const slot = henSlot(index);
  const away = slot.x - HOME_X;
  const landX = Math.abs(away) < LAND_SIDE ? HOME_X + (away < 0 ? -LAND_SIDE : LAND_SIDE) : Math.max(22, Math.min(100, slot.x));
  // Where her stroll starts: the pattern's first pose (facing left) on her side.
  const face = slot.row === 'flock' ? (henRandom(slot.i, 6) < 0.5 ? 1 : -1) : henWander(slot.i).mirror;
  return {
    home: { x: HOME_X, y: round(HOME_FEET), scale: HEN_SCALE, face: 1 },
    land: { x: landX, y: LAND_FEET, scale: LAND_SCALE, face: Math.abs(slot.x - landX) < 4 ? face : slot.x < landX ? 1 : -1 },
    slot: { x: slot.x, y: slot.y, scale: slot.scale, face },
  };
}

/** The big hen's transform (inside the shifted scene) standing at `s`. */
const standTransform = (s: HenStand) => `translate(${px(s.x - SCENE_SHIFT)}, ${px(s.y - HEN_FEET * s.scale)}) rotate(0deg) scale(${round3(s.face * s.scale)}, ${round3(s.scale)})`;

// ---- Timings ----

export interface ChickTiming {
  delay: number;
  duration: number;
}

export function riseDuration(from: number): number {
  return Math.round(160 + 300 * (1 - clamp(from)));
}

/** The beat: the chick turns into the hen (POP_MS), who flaps and hops out of the nest. */
export const BEAT_MS = 380;
const POP_MS = 170;
/** Share of the egg's drop after which it sits in the nest and starts to grow. */
const EGG_LANDS = 0.7;
/** The last hand-off into the yard: the big hen fades as her miniature appears. */
const HANDOFF_MS = 90;

/** The new egg drops in and grows to the target as it lands; a quick swap to the hen at 1. */
export interface RefillSpans {
  egg: number;
  grow: number;
  swap: number;
}

export function refillSpans(state: AnimationState, target: number): RefillSpans {
  const compressed = state.cycle > 0;
  const t = clamp(target);
  return { egg: compressed ? 100 : 140, grow: Math.round((compressed ? 260 : 300) * Math.min(t, TOP)), swap: t >= 1 ? 140 : 0 };
}

/** Draining is the walk into the yard (a repeat hops out first: its beat had no hop). */
export function chickTiming(state: AnimationState, from: number, target: number): ChickTiming {
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: riseDuration(from) };
    case 'overflow':
      return { delay: 0, duration: BEAT_MS };
    case 'draining':
      return state.cycle > 0 ? { delay: 0, duration: 240 } : { delay: 40, duration: 300 };
    case 'refilling': {
      const spans = refillSpans(state, target);
      return { delay: 0, duration: Math.round(spans.egg * EGG_LANDS) + spans.grow + spans.swap };
    }
    case 'idle':
      return { delay: 0, duration: 0 };
  }
}

export function levelUpSpan(levels: number, fromFill: number, toFill: number): number {
  let total = 0;
  let state = nextPhase(IDLE, { type: 'start', levels });
  while (state.phase !== 'idle') {
    const timing = chickTiming(state, fromFill, refillTarget(state, clamp(toFill)));
    total += timing.delay + timing.duration;
    state = nextPhase(state, { type: DONE_EVENT[state.phase] } as Parameters<typeof nextPhase>[1]);
  }
  return total;
}

// ---- Text ----

const text: ProgressThemeText = {
  name: 'Цыплёнок',
  levelNoun: 'Цыплёнок',
  levelGenitive: 'цыплёнка',
  levelForms: ['цыплёнок', 'цыплёнка', 'цыплят'],
  levelFormsOf: ['цыплёнка', 'цыплят', 'цыплят'],
  completed: (n) => `Цыплёнок ${n} вырос`,
  fillLabel: (p) => `Цыплёнок вырос на ${p}%`,
  hint: 'Из яйца вылупляется и растёт цыплёнок',
};

// ---- Marks: pennants on the growth stake, captions to the right (the flask's conventions) ----

const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const HERO_SCALE = 140 / VIEW_W;
/** Captions at least 24 px apart on screen: their 24 px buttons touch but never overlap. */
const CAPTION_GAP = Math.ceil(24 / HERO_SCALE);
const CAPTION_X = STAKE_X + 15;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;

function markPoint(height: number): { x: number; y: number } {
  return { x: STAKE_X, y: STAKE_BOTTOM - clamp(height) * STAKE_TRAVEL };
}

function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

export function captionYs(ys: number[]): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => o.y);
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + CAPTION_GAP);
  const max = VIEW_H - 10;
  if (placed.length && placed[placed.length - 1]! > max) {
    placed[placed.length - 1] = max;
    for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k]!, placed[k + 1]! - CAPTION_GAP);
  }
  const out = Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]!));
  return out;
}

/** Vertical padding of caption `i`, px: towards a 44 px tap area, within half the gap to a neighbour. */
export function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) / 2 - CAPTION_LINE / 2 : CAPTION_PAD_MAX;
  return Math.floor(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Resolves when the animation ends. `finished` may never settle in old WebViews and otherwise
 * lands a frame late at every phase boundary, so a timer at the end keeps the choreography on
 * its planned schedule (each phase starts from the pose the previous one ends on).
 */
function done(animation: Animation, duration: number): Promise<void> {
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration)]);
}

const spring = () => getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim() || 'cubic-bezier(0.34, 1.56, 0.64, 1)';

function animate(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    // An easing the engine does not parse: plain ease-out keeps the choreography going.
    return el.animate(keyframes, { ...options, easing: 'ease-out' });
  }
}

const cssOf = (p: PartStyle): CSSProperties => ({ transform: p.transform, opacity: p.opacity, strokeDashoffset: p.dash });
const frameOf = (p: PartStyle): Keyframe => {
  const frame: Keyframe = {};
  if (p.transform !== undefined) frame.transform = p.transform;
  if (p.opacity !== undefined) frame.opacity = p.opacity;
  if (p.dash !== undefined) frame.strokeDashoffset = `${p.dash}px`;
  return frame;
};

// ---- Drawing: hens ----

type ExtraPart = 'egg' | 'hop' | 'wing' | 'legs' | 'shadow' | 'rays' | 'scene';
type Parts = Partial<Record<PosePart | ExtraPart, SVGGraphicsElement | null>>;
type Setter = (key: PosePart | ExtraPart) => (el: SVGGraphicsElement | null) => void;

const HEN_TAIL = ['M20 -46 C24 -70 34 -88 42 -94 C44 -78 40 -60 32 -44 Z', 'M24 -40 C34 -57 44 -67 50 -69 C47 -54 41 -42 31 -34 Z'];
const HEN_WING = 'M0 0 C10 -10 32 -8 36 8 C28 22 8 18 0 0 Z';
const HEN_LEGS = 'M-6 -6 L-8 12 L-15 14 M-8 12 L-3 15 M10 -6 L10 12 L4 14 M10 12 L16 15';
const COMB = 'M-30 -86 C-33 -96 -26 -100 -23 -94 C-22 -103 -12 -104 -13 -95 C-8 -100 -1 -96 -6 -88 Z';
const BEAK = 'M-33 -80 L-45 -75 L-33 -70 Z';
const SPECKS = [[22, -44], [32, -26], [4, -20], [14, -54], [-2, -36], [26, -12], [38, -40]]
  .map(([x, y]) => `M${x! - 2.6} ${y}a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z`)
  .join('');
const SCARF = 'M-30 -52 C-21 -45 -7 -45 1 -52 L1 -43 C-7 -36 -21 -36 -29 -43 Z M-23 -42 L-28 -28 L-20 -29 L-16 -42 Z';
const BOW = 'M0 0 C-4 -8 -12 -7 -11 0 C-12 7 -4 8 0 0 Z M0 0 C4 -8 12 -7 11 0 C12 7 4 8 0 0 Z';
/** The head's outline without its bottom, so the neck runs into it seamlessly. */
const HEAD_RIM = 'M-31.5 -66.4 A15 15 0 1 1 -8.5 -66.4';

const combAt = (k: number) => (k === 1 ? undefined : `translate(-18 -88) scale(${k}) translate(18 88)`);

function Wear({ wear }: { wear: HenWear }) {
  if (wear === 'scarf') return <path d={SCARF} className="chick-wear" />;
  if (wear === 'bow')
    return (
      <g transform="translate(-2 -84) rotate(-16)">
        <path d={BOW} className="chick-wear" />
        <circle r="2.8" className="chick-wear-knot" />
      </g>
    );
  return null;
}

/** The hen in the nest: her look is the hen she will be in the yard. */
function Hen({ set, look }: { set?: Setter; look: HenLook }) {
  return (
    <>
      <ellipse ref={set?.('shadow')} cx="2" cy={HEN_FEET} rx="34" ry="6" className="chick-hen-shadow" />
      <g ref={set?.('hop')}>
        <path ref={set?.('legs')} className="chick-legs" d={HEN_LEGS} />
        <g className="chick-sil">
          {HEN_TAIL.map((d) => (
            <path key={d} d={d} />
          ))}
          <ellipse cx="8" cy="-32" rx="34" ry="28" />
          <ellipse cx="-14" cy="-58" rx="15" ry="18" />
          <circle cx="-20" cy="-76" r="15" />
        </g>
        {HEN_TAIL.map((d) => (
          <path key={d} d={d} className="chick-hen-dark" />
        ))}
        <ellipse cx="8" cy="-32" rx="34" ry="28" className="chick-hen-body" />
        <ellipse cx="-14" cy="-58" rx="15" ry="18" className="chick-hen-body" />
        <circle cx="-20" cy="-76" r="15" className="chick-hen-body" />
        <ellipse cx="-12" cy="-40" rx="14" ry="16" className="chick-hen-light" />
        {look.plume === 'speckled' && <path d={SPECKS} className="chick-hen-speck" />}
        <path d="M22 -14 q4 4 8 0 M28 -24 q4 4 8 0 M-14 -26 q3 3 6 0" className="chick-hen-feather" />
        <g transform="translate(0 -42)">
          <g ref={set?.('wing')}>
            <path d={HEN_WING} className="chick-hen-wing" />
            <path d="M10 4 C16 9 24 11 31 9 M8 -2 C15 2 24 3 32 1" className="chick-hen-feather" />
          </g>
        </g>
        <path d={COMB} transform={combAt(look.comb)} className="chick-comb" />
        <ellipse cx="-33" cy="-66" rx="3.2" ry="5" className="chick-comb" />
        <path d={BEAK} className="chick-beak" />
        <circle cx="-24" cy="-79" r="2.8" className="chick-eye" />
        <circle cx="-25" cy="-80" r="0.9" className="chick-eye-shine" />
        <Wear wear={look.wear} />
      </g>
    </>
  );
}

/** A hen of the yard: the big hen's shapes with bolder lines; her head dips on its own. */
function YardHenFigure({ look, head }: { look: HenLook; head: { className: string; style?: CSSProperties } }) {
  return (
    <>
      <path d={HEN_LEGS} className="chick-yh-legs" />
      <g className="chick-yh-sil">
        {HEN_TAIL.map((d) => (
          <path key={d} d={d} />
        ))}
        <ellipse cx="8" cy="-32" rx="34" ry="28" />
        <ellipse cx="-14" cy="-58" rx="15" ry="18" />
      </g>
      {HEN_TAIL.map((d) => (
        <path key={d} d={d} className="chick-hen-dark" />
      ))}
      <ellipse cx="8" cy="-32" rx="34" ry="28" className="chick-hen-body" />
      <ellipse cx="-14" cy="-58" rx="15" ry="18" className="chick-hen-body" />
      <ellipse cx="-12" cy="-40" rx="14" ry="16" className="chick-hen-light" />
      {look.plume === 'speckled' && <path d={SPECKS} className="chick-hen-speck" />}
      <path d={HEN_WING} transform="translate(0 -42)" className="chick-hen-wing" />
      {look.wear === 'scarf' && <Wear wear="scarf" />}
      <g className={head.className} style={head.style}>
        <path d={HEAD_RIM} className="chick-yh-rim" />
        <circle cx="-20" cy="-76" r="15" className="chick-hen-body" />
        <path d={COMB} transform={combAt(look.comb)} className="chick-comb" />
        <ellipse cx="-33" cy="-66" rx="4" ry="6" className="chick-comb" />
        <path d={BEAK} className="chick-beak" />
        <circle cx="-24" cy="-78" r="4.2" className="chick-eye" />
        {look.wear === 'bow' && <Wear wear="bow" />}
      </g>
    </>
  );
}

const plumeClass = (look: HenLook) => `chick-plume chick-plume--${look.plume}`;

/** One strolling hen: slot → reach (stretch) → walk and turn (CSS) → size → pose (CSS) → head (CSS). */
const StrollingHen = memo(function StrollingHen({ i, fresh, still }: { i: number; fresh: boolean; still: boolean }) {
  const slot = henSlot(i);
  const look = henLook(slot.i);
  const w = henWander(slot.i);
  const rest = wanderAt(WANDER[w.pattern]!, -w.delay / w.duration);
  const decor = still ? '' : ' anim-decor';
  const run = (name: string): CSSProperties =>
    still ? {} : { animationName: `${name}-${w.pattern}`, animationDuration: `${w.duration}ms`, animationDelay: `${fresh ? 0 : w.delay}ms` };
  return (
    <g data-hen={slot.i} className={`chick-yh chick-yh--${slot.row} ${plumeClass(look)}`} transform={`translate(${slot.x} ${round(slot.y - HEN_FEET * slot.scale)})`}>
      <g transform={`scale(${round3(w.mirror * w.reach)} 1)`}>
        <g className={`chick-walk${decor}`} style={{ transform: walkTransform(rest.x, rest.face), ...run('chick-walk') }}>
          <g transform={`scale(${round3(slot.scale / w.reach)} ${slot.scale})`}>
            <ellipse cx="2" cy={HEN_FEET} rx="30" ry="6" className="chick-yh-shadow" />
            <g className={`chick-pose${decor}`} style={{ transform: poseTransform(rest.tilt, rest.lift), ...run('chick-pose') }}>
              <YardHenFigure look={look} head={{ className: `chick-peck${decor}`, style: { transform: headTransform(rest.head), ...run('chick-peck') } }} />
            </g>
          </g>
        </g>
      </g>
    </g>
  );
});

/** A tiny hen of the still flock as path data: body, neck, head and tail (and her comb). */
function flockHen({ i, x, y, scale: s }: HenSlot): { body: string; comb: string } {
  const face = henRandom(i, 6) < 0.5 ? 1 : -1;
  const X = (v: number) => round(x + face * v * s);
  const Y = (v: number) => round(y + (v - HEN_FEET) * s);
  const oval = (cx: number, cy: number, rx: number, ry: number) => {
    const r = round(rx * s);
    return `M${round(X(cx) - r)} ${Y(cy)}a${r} ${round(ry * s)} 0 1 0 ${round(2 * r)} 0a${r} ${round(ry * s)} 0 1 0 ${round(-2 * r)} 0Z`;
  };
  const tail = [[22, -48], [46, -90], [44, -36]].map(([tx, ty]) => `${X(tx!)} ${Y(ty!)}`);
  const tailPath = `M${(face > 0 ? tail : tail.reverse()).join('L')}Z`;
  return { body: oval(8, -30, 34, 28) + oval(-12, -56, 15, 18) + oval(-19, -74, 16, 16) + tailPath, comb: oval(-20, -92, 8, 6) };
}

function Flock({ slots }: { slots: HenSlot[] }) {
  if (!slots.length) return null;
  const light: string[] = [];
  const dark: string[] = [];
  const combs: string[] = [];
  for (const slot of slots) {
    const { body, comb } = flockHen(slot);
    const plume = henLook(slot.i).plume;
    (plume === 'white' || plume === 'speckled' ? light : dark).push(body);
    combs.push(comb);
  }
  return (
    <g className="chick-flock">
      <path d={light.join('')} className="chick-flock-light" />
      <path d={dark.join('')} className="chick-flock-dark" />
      <path d={combs.join('')} className="chick-flock-comb" />
    </g>
  );
}

// ---- Drawing: the yard ----

const FENCE_POSTS = Array.from({ length: 10 }, (_, k) => 44 + k * 12.6)
  .map((x) => `M${round(x)} 76 V64.5 q1.6 -2.4 3.2 0 V76 Z`)
  .join('');
const TUFTS = [[10, 178], [134, 186], [152, 168], [48, 98], [128, 112], [142, 208], [8, 206], [100, 170], [12, 136], [80, 100]]
  .map(([x, y]) => `M${x! - 3.4} ${y! - 3.2}Q${x! - 1} ${y! - 2.6} ${x} ${y}V${y! - 6}M${x! + 3.4} ${y! - 3.6}Q${x! + 1} ${y! - 2.6} ${x} ${y}`)
  .join('');

function YardBackdrop() {
  return (
    <>
      <path d="M0 64 C22 56 48 53 80 54 C112 55 138 52 160 57 V80 H0 Z" className="chick-meadow" />
      <path d="M0 76 C4 71 12 70 22 70 H138 C148 70 156 71 160 76 V214 C160 238 140 252 112 252 H48 C20 252 0 238 0 214 Z" className="chick-grass" />
      <path d="M40 67.4 H158 M40 71.8 H158" className="chick-rail" />
      <path d={FENCE_POSTS} className="chick-post" />
      <g className="chick-coop">
        <path d="M8 60 H35 V78 H8 Z" className="chick-coop-wall" />
        <path d="M8.5 66 H15.5 M27.5 66 H34.5 M8.5 72 H15.5 M27.5 72 H34.5" className="chick-coop-plank" />
        <path d="M3.5 62 L21.5 45.5 L39.5 62 Z" className="chick-coop-roof" />
        <circle cx="21.5" cy="55.5" r="2.6" className="chick-coop-door" />
        <path d="M16.5 78 V71.5 A5 5 0 0 1 26.5 71.5 V78 Z" className="chick-coop-door" />
        <path d="M17 78 L12 83.5 H17.5 L22.5 78 Z" className="chick-coop-ramp" />
      </g>
      <path d={TUFTS} className="chick-tuft-grass" />
    </>
  );
}

interface YardProps {
  hens: number;
  /** Hens that joined on screen, comma-separated: their stroll starts from its beginning. */
  fresh: string;
  still: boolean;
}

const Yard = memo(function Yard({ hens, fresh, still }: YardProps) {
  const layout = yardLayout(hens);
  const joined = new Set(fresh.split(',').filter(Boolean).map(Number));
  // Far hens first, then the near ones, back to front.
  const strollers = [...layout.far, ...layout.near].sort((a, b) => a.y - b.y || a.i - b.i);
  return (
    <g className="chick-yard" aria-hidden="true">
      <YardBackdrop />
      <Flock slots={layout.flock} />
      {strollers.map((slot) => (
        <StrollingHen key={slot.i} i={slot.i} fresh={joined.has(slot.i)} still={still} />
      ))}
    </g>
  );
});

// ---- Drawing: the nest ----

interface SceneProps {
  id: string;
  pose: ChickPose;
  stage: ChickStage;
  look: HenLook;
  mini: boolean;
  idle: boolean;
  set?: Setter;
}

function Scene({ id, pose, stage, look, mini, idle, set }: SceneProps) {
  const wobble = idle && (stage === 'egg' || stage === 'cracks');
  const blink = idle && stage === 'chick';
  return (
    <>
      <ellipse cx="72" cy="241" rx="54" ry="5" className="chick-ground" />
      <ellipse cx={NEST_X} cy="204" rx="56" ry="13" className="chick-nest-back" />
      <ellipse cx={NEST_X} cy="207" rx="45" ry="8" className="chick-hollow" />
      {!mini && <path d="M26 197 C40 192 56 191 70 191 M84 191 C98 191 108 193 116 197" className="chick-straw chick-straw--light" />}

      {/* The egg: bottom shell, head, cracks, and the lid on its right hinge. */}
      <g transform={`translate(${NEST_X} ${EGG_BASE})`}>
        <g ref={set?.('egg')} style={{ transform: 'translate(0px, 0px)', opacity: 1 }}>
          <g className={wobble ? 'chick-wobble anim-decor' : 'chick-wobble'}>
            <g transform={`translate(0 ${-EGG_LIFT})`}>
              <g ref={set?.('shell')} className="chick-part" style={cssOf(pose.shell)}>
                <ellipse cx="0" cy="-6" rx="23" ry="6" className="chick-inside" />
                <g ref={set?.('head')} className="chick-part" style={cssOf(pose.head)}>
                  <circle cx="-2" cy="-6" r="13" className="chick-sil" />
                  <circle cx="-2" cy="-6" r="13" className="chick-body" />
                  <path d="M-4 -18 C-5 -24 0 -26 2 -23" className="chick-tuft" />
                  <path d="M-14 -8 L-22 -5 L-14 -2 Z" className="chick-beak" />
                  <circle cx="-7" cy="-9" r="2.3" className="chick-eye" />
                  <ellipse cx="-5" cy="-2" rx="3" ry="1.8" className="chick-blush" />
                </g>
                <path d={EGG_PATH} className="chick-whole chick-part" ref={set?.('whole')} style={cssOf(pose.whole)} />
                <g clipPath={`url(#${id}-base)`}>
                  <path d={EGG_PATH} className="chick-shell" />
                  <path d="M17 -2 C23 8 21 20 9 26 C17 18 19 8 17 -2 Z" className="chick-shell-shade" />
                  <circle cx="-10" cy="14" r="1.8" className="chick-speck" />
                  <circle cx="8" cy="19" r="1.4" className="chick-speck" />
                  <circle cx="-15" cy="4" r="1.2" className="chick-speck" />
                </g>
                <g clipPath={`url(#${id}-egg)`}>
                  <path d={pathOf(CRACK_R_POINTS)} className="chick-crack chick-part" strokeDasharray={`${CRACK_R_LEN} ${CRACK_R_LEN}`} ref={set?.('crackR')} style={cssOf(pose.crackR)} />
                  <path d={pathOf(CRACK_L_POINTS)} className="chick-crack chick-part" strokeDasharray={`${CRACK_L_LEN} ${CRACK_L_LEN}`} ref={set?.('crackL')} style={cssOf(pose.crackL)} />
                </g>
                <g transform={`translate(${LID_PIVOT[0]} ${LID_PIVOT[1]})`}>
                  <g ref={set?.('lid')} className="chick-part" style={cssOf(pose.lid)}>
                    <g transform={`translate(${-LID_PIVOT[0]} ${-LID_PIVOT[1]})`}>
                      <g clipPath={`url(#${id}-lid)`}>
                        <path d={EGG_PATH} className="chick-shell" />
                        <ellipse cx="-9" cy="-19" rx="3" ry="6" transform="rotate(25 -9 -19)" className="chick-shell-shine" />
                        <circle cx="7" cy="-22" r="1.6" className="chick-speck" />
                        <circle cx="-16" cy="-9" r="1.2" className="chick-speck" />
                      </g>
                      <g clipPath={`url(#${id}-egg)`}>
                        <path d={ZIG_PATH} className="chick-lid-edge chick-part" ref={set?.('lidEdge')} style={cssOf(pose.lidEdge)} />
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>

      <g ref={set?.('chick')} className="chick-part" style={cssOf(pose.chick)}>
        <g className="chick-sil">
          <path d="M22 -30 L34 -40 L31 -24 Z" />
          <ellipse cx="3" cy="-24" rx="25" ry="23" />
          <circle cx="-6" cy="-50" r="17" />
        </g>
        <path d="M22 -30 L34 -40 L31 -24 Z" className="chick-body-shade" />
        <ellipse cx="3" cy="-24" rx="25" ry="23" className="chick-body" />
        <circle cx="-6" cy="-50" r="17" className="chick-body" />
        <path d="M6 -30 C16 -37 29 -30 27 -17 C19 -11 9 -16 6 -30 Z" className="chick-body-shade" />
        <path d="M-9 -66 C-11 -73 -5 -77 -2 -73 M-5 -67 C-3 -74 3 -74 4 -70" className="chick-tuft" />
        <path d="M-21 -53 L-32 -48 L-21 -43 Z" className="chick-beak" />
        <g transform="translate(-13 -54)">
          <g className={blink ? 'chick-blink anim-decor' : 'chick-blink'}>
            <circle r="3" className="chick-eye" />
            <circle cx="-1" cy="-1" r="1" className="chick-eye-shine" />
          </g>
        </g>
        <ellipse cx="-10" cy="-43" rx="4.2" ry="2.5" className="chick-blush" />
      </g>

      <g ref={set?.('hen')} className={`chick-part chick-hen ${plumeClass(look)}`} style={cssOf(pose.hen)}>
        <Hen set={set} look={look} />
      </g>

      {/* The front of the nest over the feet; the ribbon is the skill colour. */}
      <path d="M12 203 C14 226 38 242 70 242 C102 242 126 226 128 203 C112 213 92 217 70 217 C48 217 28 213 12 203 Z" className="chick-nest" />
      {!mini && (
        <>
          <path d="M18 210 C30 220 44 224 58 225 M84 225 C100 224 112 218 122 210 M30 233 C44 238 60 239 70 239" className="chick-straw chick-straw--dark" />
          <path d="M16 205 C28 213 44 217 60 218 M82 218 C98 217 112 213 124 205 M8 199 L16 205 M132 198 L124 205 M6 210 L17 212" className="chick-straw chick-straw--light" />
        </>
      )}
      <path d="M17 215 C34 230 106 230 123 215" className="chick-ribbon" />
      {!mini && <path d="M24 216 C40 226 60 228 70 228" className="chick-ribbon-shine" />}
      <path d="M70 227 C62 216 50 221 54 229 C57 235 64 232 70 227 Z M70 227 C78 216 90 221 86 229 C83 235 76 232 70 227 Z M69 228 L63 239 L67 238 L70 231 L73 238 L77 239 L71 228 Z" className="chick-bow" />
      <circle cx="70" cy="227.5" r="3.4" className="chick-bow-knot" />

      {stage === 'hen' && !mini && (
        <path d="M18 106 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 Z M108 102 l1.5 -4.5 l1.5 4.5 l4.5 1.5 l-4.5 1.5 l-1.5 4.5 l-1.5 -4.5 l-4.5 -1.5 Z" className="chick-sparkle" />
      )}
    </>
  );
}

function ClipDefs({ id }: { id: string }) {
  return (
    <defs>
      <clipPath id={`${id}-egg`}>
        <path d={EGG_PATH} />
      </clipPath>
      <clipPath id={`${id}-lid`}>
        <path d={LID_CLIP} />
      </clipPath>
      <clipPath id={`${id}-base`}>
        <path d={BASE_CLIP} />
      </clipPath>
    </defs>
  );
}

// Rays of the beat around the hen's head (hero only).
const RAYS = [190, 230, 270, 310, 350].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x1: round(26 * Math.cos(a)), y1: round(26 * Math.sin(a)), x2: round(36 * Math.cos(a)), y2: round(36 * Math.sin(a)) };
});

const useSafeId = (prefix: string) => `${prefix}${useId().replace(/[^\w-]/g, '')}`;

function Hero({ fill, level, state = 'active', motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion: MotionMode = motionProp ?? systemMotion;
  const id = useSafeId('chick');
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);

  // While a choreography runs (and right after it) the scene shows `override`, not the prop.
  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  // The yard: `level` − 1 hens. The app renders the new level before it plays a level-up, so the
  // choreography shows the flock as it was and adds each hen as she walks in; then the level
  // prop is the count again. Without a level, the hens raised on screen stay for the visit.
  const [hensOverride, setHensOverride] = useState<number | null>(null);
  const [visitHens, setVisitHens] = useState(0);
  const [bigIndex, setBigIndex] = useState<number | null>(null);
  const settledHens = level === undefined ? visitHens : hensBefore(level);
  const hens = hensOverride ?? settledHens;
  const fresh = useRef(new Set<number>());
  const levelRef = useRef(level);
  levelRef.current = level;
  const settledRef = useRef(settledHens);
  settledRef.current = settledHens;
  const hensRef = useRef(hens);
  hensRef.current = hens;

  const playing = useRef(false);
  const playToken = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const shown = override ?? target;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const svgRef = useRef<SVGSVGElement>(null);
  const yardRef = useRef<SVGGElement>(null);
  const parts = useRef<Parts>({});
  const set: Setter = (key) => (el) => {
    parts.current[key] = el;
  };

  useEffect(installPauseWhenHidden, []);

  // Prop-driven changes: CSS transitions glide between poses; a crossfade under reduced motion.
  const previous = useRef(target);
  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (playing.current || from === target) return;
    setOverride(null);
    if (motion === 'reduced') animate(parts.current.scene, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  }, [target, motion]);

  // The golden hen steps up when the skill becomes completed on screen (never on first load).
  const previousState = useRef<ProgressState>(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete') return;
    if (motion === 'reduced') {
      animate(parts.current.hen, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    animate(parts.current.hen, [{ transform: henAt(0.6), opacity: 0 }, { transform: HEN_HOME, opacity: 1 }], { duration: 560, easing: spring() });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        const finished = Math.max(1, Math.floor(Number.isFinite(levels) ? levels : 1));
        const noLevel = levelRef.current === undefined;
        // The flock before this write: the level prop already names the new level.
        const base = playing.current ? hensRef.current : noLevel ? settledRef.current : Math.max(0, settledRef.current - finished);
        const settle = () => {
          if (noLevel) setVisitHens(base + finished);
        };
        const svg = svgRef.current;
        if (!svg || typeof svg.animate !== 'function') {
          onOverflow?.();
          flushSync(settle);
          return;
        }
        // Overlapping celebrations: start from what is on screen when it is below `fromFill`.
        const start = playing.current ? Math.min(clamp(fromFill), shownRef.current, TOP) : Math.min(clamp(fromFill), TOP);
        playing.current = true;
        const running: Animation[] = [];
        const play = (el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<unknown> => {
          const a = animate(el, keyframes, { fill: 'forwards', ...options });
          if (!a) return Promise.resolve();
          running.push(a);
          return done(a, Number(options.duration) + (options.delay ?? 0));
        };
        const end = clamp(toFill);
        let landed = 0;
        flushSync(() => {
          setScripted(true);
          setOverride(start);
          setHensOverride(base);
          setBigIndex(base);
        });

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            flushSync(() => {
              setOverride(end);
              setHensOverride(base + finished);
            });
            await play(parts.current.scene, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out', fill: 'none' });
            return;
          }
          const p = parts.current;
          let current = start;
          const yardHen = (i: number) => yardRef.current?.querySelector(`[data-hen="${i}"]`) ?? null;

          const progress = (to: number, duration: number, keys: readonly PosePart[] = POSE_PARTS) => {
            const steps = duration > 0 ? 16 : 1;
            const poses = Array.from({ length: steps + 1 }, (_, i) => chickPose(current + (to - current) * easeOut(i / steps)));
            current = to;
            return Promise.all(keys.map((key) => play(p[key], poses.map((pose) => frameOf(pose[key])), { duration, easing: 'linear' })));
          };
          const hide = (keys: (PosePart | ExtraPart)[]) => Promise.all(keys.map((key) => play(p[key], [{ opacity: 0 }, { opacity: 0 }], { duration: 0 })));

          /** The chick puffs up and, in one frame, is the hen (no double exposure); rays on the beat. */
          const becomeHen = (duration: number, beat: boolean) => {
            flushSync(() => setBigIndex(base + landed));
            const swap = beat ? 0.42 : 0.35;
            const chickAt = (scale: number) => standAt(NEST_X, CHICK_FOOT, 0, scale);
            const home = (k: number) => standTransform({ x: HOME_X, y: HOME_FEET, scale: HEN_SCALE * k, face: 1 });
            current = 1;
            // The rays outlive the swap; the hop does not wait for them.
            if (beat) play(p.rays, [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(0.6)', opacity: 0, offset: swap }, { transform: 'scale(1)', opacity: 1, offset: 0.7 }, { transform: 'scale(1.2)', opacity: 0 }], { duration: duration + 80, easing: 'ease-out', fill: 'none' });
            return Promise.all([
              // Linear timing with per-keyframe easing: both reach the swap in the same frame.
              play(p.chick, [{ transform: chickAt(CHICK_MAX), opacity: 1, easing: 'ease-out' }, { transform: chickAt(CHICK_MAX * 1.1), opacity: 1, offset: swap }, { transform: chickAt(CHICK_MAX * 1.1), opacity: 0, offset: swap }, { transform: chickAt(CHICK_MAX * 1.1), opacity: 0 }], { duration, easing: 'linear' }),
              play(p.hen, [{ transform: home(0.84), opacity: 0 }, { transform: home(0.84), opacity: 0, offset: swap }, { transform: home(0.9), opacity: 1, offset: swap, easing: spring() }, { transform: home(1), opacity: 1 }], { duration, easing: 'linear' }),
              hide(['legs', 'shadow']),
              play(p.hop, [{ transform: 'translate(0px, 0px) rotate(0deg)' }, { transform: 'translate(0px, 0px) rotate(0deg)' }], { duration: 0 }),
            ]);
          };

          /** She flaps and hops out of the nest, turning in the air to land on the grass facing her slot. */
          const hopOut = (duration: number, lift: number) => {
            const path = joinPath(base + landed);
            const mid = { x: lerp(path.home.x, path.land.x, 0.5), y: lerp(path.home.y, path.land.y, 0.5), scale: lerp(path.home.scale, path.land.scale, 0.45), face: 1 };
            const frames: Keyframe[] = [{ transform: standTransform(path.home), opacity: 1 }, { transform: standTransform(mid), opacity: 1, offset: 0.5 }];
            if (path.land.face < 0) frames.push({ transform: standTransform({ ...mid, face: -1 }), opacity: 1, offset: 0.5 });
            frames.push({ transform: standTransform(path.land), opacity: 1 });
            return Promise.all([
              play(p.hen, frames, { duration, easing: 'ease-in-out' }),
              play(p.hop, [{ transform: 'translate(0px, 0px) rotate(0deg)' }, { transform: `translate(0px, ${-lift}px) rotate(-8deg)`, offset: 0.45 }, { transform: 'translate(0px, 0px) rotate(0deg)' }], { duration, easing: 'ease-out' }),
              play(p.wing, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-44deg)', offset: 0.3 }, { transform: 'rotate(6deg)', offset: 0.6 }, { transform: 'rotate(-30deg)', offset: 0.8 }, { transform: 'rotate(0deg)' }], { duration, easing: 'ease-in-out', fill: 'none' }),
              play(p.legs, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], { duration }),
              play(p.shadow, [{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], { duration }),
            ]);
          };

          /** She walks on the grass to her slot, shrinking with the distance, and joins the yard. */
          const walkIn = async (duration: number) => {
            const index = base + landed;
            const path = joinPath(index);
            const alone = henSlot(index).row !== 'flock';
            if (alone) {
              // Her miniature waits, hidden, where she will stand; its stroll starts from its pause.
              landed += 1;
              fresh.current.add(index);
              flushSync(() => setHensOverride(base + landed));
            }
            // Her feet stay on the grass: position and size follow one straight line into the yard.
            const handoff = 1 - HANDOFF_MS / duration;
            const turns = path.slot.face !== path.land.face;
            const arrive = turns ? handoff - 0.14 : handoff;
            const keyframes: Keyframe[] = [];
            for (let k = 0; k <= 6; k++) {
              const t = k / 6;
              const at: HenStand = { x: lerp(path.land.x, path.slot.x, t), y: lerp(path.land.y, path.slot.y, t), scale: lerp(path.land.scale, path.slot.scale, t), face: path.land.face };
              keyframes.push({ transform: standTransform(at), opacity: 1, offset: t * arrive });
            }
            // Arrived, she turns round to face the way her stroll begins, then hands over.
            if (turns) keyframes.push({ transform: standTransform(path.slot), opacity: 1, offset: handoff });
            keyframes.push({ transform: standTransform(path.slot), opacity: 0, offset: 1 });
            const waddle: Keyframe[] = Array.from({ length: 9 }, (_, k) => ({ transform: `translate(0px, ${k % 2 ? -5 : 0}px) rotate(${k % 2 ? (k % 4 === 1 ? 6 : -6) : 0}deg)`, offset: (k / 8) * arrive }));
            waddle.push({ transform: 'translate(0px, 0px) rotate(0deg)', offset: 1 });
            const mini = alone ? yardHen(index) : null;
            if (mini) play(mini, [{ opacity: 0 }, { opacity: 0, offset: handoff }, { opacity: 1 }], { duration, easing: 'linear' });
            const walking = Promise.all([play(p.hen, keyframes, { duration, easing: 'linear' }), play(p.hop, waddle, { duration, easing: 'ease-in-out' })]);
            if (!alone) {
              // She becomes one of the flock as she fades.
              await wait(duration * handoff);
              if (aborted()) return;
              landed += 1;
              flushSync(() => setHensOverride(base + landed));
            }
            await walking;
          };

          const refill = async (to: number, spans: RefillSpans) => {
            const drop = play(
              p.egg,
              [
                { transform: 'translate(0px, -34px)', opacity: 0, easing: 'ease-in' },
                { transform: 'translate(0px, -31px)', opacity: 1, offset: 0.12, easing: 'ease-in' },
                { transform: 'translate(0px, 0px)', opacity: 1, offset: EGG_LANDS, easing: 'ease-out' },
                { transform: 'translate(0px, -3px)', opacity: 1, offset: 0.86, easing: 'ease-in' },
                { transform: 'translate(0px, 0px)', opacity: 1 },
              ],
              { duration: spans.egg, easing: 'linear' },
            );
            await wait(Math.round(spans.egg * EGG_LANDS));
            if (aborted()) return;
            await Promise.all([drop, progress(Math.min(to, TOP), spans.grow)]);
            if (to >= 1 && !aborted()) await becomeHen(spans.swap, false);
          };

          let phase = nextPhase(IDLE, { type: 'start', levels: finished });
          while (phase.phase !== 'idle' && !aborted()) {
            const goal = refillTarget(phase, end);
            const timing = chickTiming(phase, start, goal);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await progress(TOP, timing.duration);
                break;
              case 'overflow':
                onOverflow?.();
                await becomeHen(POP_MS, true);
                if (!aborted()) await hopOut(timing.duration - POP_MS, 44);
                break;
              case 'draining': {
                // The nest empties behind her: the band slides down, the egg waits to drop in.
                const drain = progress(0, timing.duration, ['band', 'knot']);
                current = 1;
                void progress(0, 0, POSE_PARTS.filter((key) => key !== 'band' && key !== 'knot' && key !== 'hen'));
                void hide(['egg']);
                const hop = phase.cycle > 0 ? Math.round(timing.duration * 0.35) : 0;
                if (hop) await hopOut(hop, 26);
                if (!aborted()) await walkIn(timing.duration - hop);
                await drain;
                break;
              }
              case 'refilling':
                await refill(goal, refillSpans(phase, goal));
                break;
            }
            phase = nextPhase(phase, { type: DONE_EVENT[phase.phase] } as Parameters<typeof nextPhase>[1]);
          }
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            // Commit the end state with transitions off, then drop the WAAPI layers: no jump. The
            // yard is the level prop's again (the hens past three cycles simply stand there).
            flushSync(() => {
              setOverride(end);
              setBigIndex(null);
              setHensOverride(null);
              settle();
            });
            running.forEach((a) => a.cancel());
            playing.current = false;
            requestAnimationFrame(() => {
              setScripted(false);
              if (Math.abs(targetRef.current - end) > 1e-6) setOverride(null);
            });
          }
        }
      },
    }),
    [motion],
  );

  // Marks are static; the room for captions stays until the choreography ends.
  const shownMarks = marks ?? [];
  const reserved = useRef(false);
  reserved.current = scripted ? reserved.current || shownMarks.length > 0 : shownMarks.length > 0;
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const captionY = captionYs(captioned.map((m) => markPoint(m.height).y));
  const stage = chickStage(shown);
  const pose = chickPose(shown);
  const look = henLook(bigIndex ?? hens);

  const classes = ['chick', 'chick--hero', `chick--${state}`, reserved.current ? 'chick--marked' : '', scripted ? 'chick--scripted' : ''].filter(Boolean);
  const henHead = { x: HEN_X + SCENE_SHIFT - 20 * HEN_SCALE, y: HEN_FOOT - 80 * HEN_SCALE };

  return (
    <div className={classes.join(' ')}>
      <svg ref={svgRef} className="chick-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label ?? text.fillLabel(Math.floor(shown * 100))}>
        <ClipDefs id={id} />
        <g ref={set('scene')}>
          <g ref={yardRef}>
            <Yard hens={hens} fresh={[...fresh.current].join(',')} still={motion === 'reduced'} />
          </g>
          <g transform={`translate(${SCENE_SHIFT} 0)`}>
            <Scene id={id} pose={pose} stage={stage} look={look} mini={false} idle={!scripted} set={set} />
          </g>
          {/* The stake in front of the yard (a hen walking off passes behind it): a straw band
              climbs it to the fill, quarter ticks on its left. */}
          <g transform={`translate(${STAKE_X} ${STAKE_BOTTOM})`}>
            <rect x="-2" y={-STAKE_TRAVEL - 8} width="4" height={STAKE_TRAVEL + 16} rx="2" className="chick-stake" />
            <rect ref={set('band')} x="-4.5" y={-STAKE_TRAVEL} width="9" height={STAKE_TRAVEL} className="chick-band chick-part" style={cssOf(pose.band)} />
            {PLAIN_TICKS.map((share) => (
              <line key={share} x1="-11" x2="-6" y1={-share * STAKE_TRAVEL} y2={-share * STAKE_TRAVEL} className="chick-tick" />
            ))}
            <ellipse ref={set('knot')} rx="6.5" ry="3" className="chick-knot chick-part" style={cssOf(pose.knot)} />
          </g>
        </g>
        <g transform={`translate(${henHead.x} ${henHead.y})`} aria-hidden="true">
          <g ref={set('rays')} className="chick-rays">
            {RAYS.map((r) => (
              <line key={`${r.x1} ${r.y1}`} {...r} />
            ))}
          </g>
        </g>
        {shownMarks.map((mark) => {
          const { x, y } = markPoint(mark.height);
          return (
            // Pointer only: the captions below are the accessible way in, and so is the list.
            <g key={mark.id} className="chick-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              <rect x={x - 6} y={y - 10} width="22" height="20" className="chick-mark-hit" />
              <path d={`M${x + 4} ${y - 5}L${x + 13} ${y}L${x + 4} ${y + 5}Z`} className="chick-mark-flag" />
            </g>
          );
        })}
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="chick-mark-caption"
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

/** The mini crops the nest and whoever sits in it into a square; no stake, no idle motion. */
const MINI_VIEWBOX = '0 102 142 142';
const MINI_LOOK: HenLook = { plume: 'brown', comb: 1, wear: 'none' };
const MINI_HEN: HenLook = { plume: 'white', comb: 1.25, wear: 'none' };

function Mini({ fill, state = 'active', size = 32, label }: ProgressMiniProps) {
  const id = useSafeId('chickmini');
  const shown = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  return (
    <span className={`chick chick--mini chick--${state}`} style={{ width: size, height: size }}>
      <svg className="chick-svg" viewBox={MINI_VIEWBOX} width={size} height={size} role="img" aria-label={label ?? text.fillLabel(Math.floor(shown * 100))}>
        <ClipDefs id={id} />
        {/* A hen of the yard behind the nest. */}
        <g className={`chick-yh ${plumeClass(MINI_HEN)}`} transform="translate(121 170) scale(-0.36 0.36)">
          <YardHenFigure look={MINI_HEN} head={{ className: 'chick-peck' }} />
        </g>
        <Scene id={id} pose={chickPose(shown)} stage={chickStage(shown)} look={MINI_LOOK} mini idle={false} />
      </svg>
    </span>
  );
}

export const chickTheme: ProgressThemeDefinition = {
  key: 'chick',
  text,
  available: true,
  Hero,
  Mini,
  markPoint,
};
