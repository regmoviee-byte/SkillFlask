import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '../../../lib/format';
import { PLAIN_TICKS, scaleTicks } from '../../components/flaskScale';
import { FINISH_FALLBACK_MS, MAX_CYCLES } from '../../components/flaskAnimation';
import { copy } from '../../copy';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import './ball.css';

// «Мяч в корзину»: `fill` is how far the ball has flown along the arc from the hands to the hoop;
// every basket of a past level leaves its ball on the floor.

// Geometry (hero viewBox 0 0 160 260, mini 0 0 40 40)

export interface Point {
  x: number;
  y: number;
}

type Cubic = readonly [Point, Point, Point, Point];

/** The flight: from the hands (bottom left) over the top into the hoop. */
export const HERO_CURVE: Cubic = [
  { x: 47, y: 178 },
  { x: 54, y: 62 },
  { x: 90, y: -4 },
  { x: 124, y: 40 },
];
const MINI_CURVE: Cubic = [
  { x: 9, y: 31 },
  { x: 9, y: 14 },
  { x: 17, y: 2 },
  { x: 29, y: 8.5 },
];

const VIEW_W = 160;
const VIEW_H = 260;
const BALL_R = 11;
const RIM = { x: 124, y: 56, rx: 17, ry: 4.5 };
/** The ball clears the net's hem, falls to the floor, and (golden) rests. */
const HEM_Y = 87 + BALL_R;
const REST_Y = 67;
const SPIN = 240;
/** The floor's top edge. */
const FLOOR = 251;
const RAD = Math.PI / 180;

/** Back (1) or front (0) half of a rim. */
const rimArc = (r: typeof RIM, sweep: number) => `M${r.x - r.rx} ${r.y}A${r.rx} ${r.ry} 0 0 ${sweep} ${r.x + r.rx} ${r.y}`;
const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

function bezier([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function arcLengthTable(curve: Cubic, samples = 240): { points: Point[]; lengths: number[] } {
  const points = [bezier(curve, 0)];
  const lengths = [0];
  for (let i = 1; i <= samples; i++) {
    const p = bezier(curve, i / samples);
    const q = points[i - 1]!;
    points.push(p);
    lengths.push(lengths[i - 1]! + Math.hypot(p.x - q.x, p.y - q.y));
  }
  return { points, lengths };
}

function arcSampler(curve: Cubic): (share: number) => Point {
  const { points, lengths } = arcLengthTable(curve);
  const total = lengths[lengths.length - 1]!;
  return (share) => {
    const target = clamp(share) * total;
    let lo = 0;
    let hi = lengths.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid]! < target) lo = mid;
      else hi = mid;
    }
    const span = lengths[hi]! - lengths[lo]! || 1;
    const k = (target - lengths[lo]!) / span;
    const a = points[lo]!;
    const b = points[hi]!;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
}

const heroArc = arcSampler(HERO_CURVE);
const miniArc = arcSampler(MINI_CURVE);
const pathOf = ([p0, p1, p2, p3]: Cubic) => `M${p0.x} ${p0.y}C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`;
const HERO_PATH = pathOf(HERO_CURVE);
const MINI_PATH = pathOf(MINI_CURVE);

export const arcPoint = heroArc;

/** Share of the flight where the ball is highest. */
export const APEX_SHARE: number = (() => {
  let best = 0;
  for (let i = 1; i <= 400; i++) if (heroArc(i / 400).y < heroArc(best / 400).y) best = i;
  return best / 400;
})();

export type BallStage = 'hand' | 'rising' | 'falling' | 'score';

export function ballStage(fill: number): BallStage {
  const f = clamp(fill);
  if (f <= 0) return 'hand';
  if (f >= 1) return 'score';
  return f < APEX_SHARE ? 'rising' : 'falling';
}

export function ballPose(fill: number): Point & { rotate: number } {
  const f = clamp(fill);
  return { ...heroArc(f), rotate: f * SPIN };
}

export function markPoint(height: number): Point {
  return heroArc(clamp(height));
}

/** The arc's unit normal towards its inner side. */
function innerNormal(share: number): Point {
  const p = heroArc(share - 0.005);
  const q = heroArc(share + 0.005);
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
}

/** A pennant's top: under its mark, past the ±3 ticks; up to 7.8 units where the arc falls. */
export function pennantTop(height: number): Point {
  const h = clamp(height);
  const p = markPoint(h);
  const n = innerNormal(h);
  const k = 5 - Math.min(0, n.x) * 3.5;
  return { x: p.x + n.x * k, y: p.y + n.y * k };
}

const fmt = (n: number) => Number(n.toFixed(2));
const place = (p: Point, rotate = 0) => `translate(${fmt(p.x)}px, ${fmt(p.y)}px) rotate(${fmt(rotate)}deg)`;
const ballTransform = (fill: number) => {
  const pose = ballPose(fill);
  return place(pose, pose.rotate);
};
const REST_TRANSFORM = place({ x: RIM.x, y: REST_Y }, 18);
/** The trail has pathLength 1. */
const trailOffset = (fill: number) => fmt(1 - clamp(fill));

// The player: a figure facing the hoop, built from joints. Angles are SVG rotations in degrees
// (0: a limb hangs down, −90: it points at the hoop); the root sits on the floor between the feet.

export interface PlayerPose {
  /** Jump height and landing squash (0..0.15). */
  lift: number;
  squash: number;
  /** Hips lowered; feet drawn up in a jump. */
  crouch: number;
  tuck: number;
  /** Torso (forward +) and head (up −). */
  lean: number;
  nod: number;
  /** Front and back arm: shoulder, elbow. */
  armF: readonly [number, number];
  armB: readonly [number, number];
}

const PLAYER_X = 31;
const HIP = 26.2;
const LEG = 12.2;
const ANKLE = 3;
const FEET = [-6, 6.5];
const NECK = 21;
const SHOULDER = 18.5;
/** Shoulders across the torso: the front one towards the viewer, clear of the jersey's number. */
const SHOULDERS = [2.2, -1.8];
const UPPER = 11;
const FORE = 10.5;

/** (x, y) turned by `deg` and moved to `o`; `along(p, deg, len)` walks a bone. */
const turn = (o: Point, deg: number, x: number, y: number): Point => {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return { x: o.x + x * c - y * s, y: o.y + x * s + y * c };
};
const along = (p: Point, deg: number, len: number) => turn(p, deg, 0, len);

/** Two bones from a joint towards (dx, dy): the first bone's angle and the second's, relative. */
function reach(dx: number, dy: number, a: number, b: number, bend: number): [number, number] {
  const d = Math.min(a + b - 0.01, Math.max(Math.abs(a - b) + 0.01, Math.hypot(dx, dy)));
  const inner = (x: number, y: number) => Math.acos((x * x + d * d - y * y) / (2 * x * d)) / RAD;
  const first = inner(a, b);
  return [Math.atan2(-dx, dy) / RAD - bend * first, bend * (first + inner(b, a))];
}

/** Legs keep the feet on the floor (or tucked in a jump): back leg 0, front leg 1. */
function legAngles(pose: PlayerPose, k: number): [number, number] {
  return reach(FEET[k]! - pose.tuck * 0.5 - (k ? 1.2 : -1.2), HIP - ANKLE - pose.tuck - pose.crouch, LEG, LEG, 1);
}

/** Front (0) or back (1) shoulder. */
const shoulderOf = (pose: PlayerPose, k: number): Point =>
  turn({ x: PLAYER_X, y: FLOOR - pose.lift - HIP + pose.crouch }, pose.lean, SHOULDERS[k]!, -SHOULDER);

/** Where the hands and the ankles (front, back) and the head are, in hero units. */
export function playerPoints(pose: PlayerPose): { hands: Point[]; head: Point; ankles: Point[] } {
  const hip = { x: PLAYER_X, y: FLOOR - pose.lift - HIP + pose.crouch };
  const hand = ([s, e]: readonly [number, number], k: number) => along(along(shoulderOf(pose, k), pose.lean + s, UPPER), pose.lean + s + e, FORE);
  const ankle = (k: number) => {
    const [t, kn] = legAngles(pose, k);
    return along(along({ x: hip.x + (k ? 1.2 : -1.2), y: hip.y }, t, LEG), t + kn, LEG);
  };
  return { hands: [hand(pose.armF, 0), hand(pose.armB, 1)], head: along(along(hip, pose.lean + 180, NECK), pose.lean + pose.nod + 180, 8.5), ankles: [ankle(1), ankle(0)] };
}

const tr = (x: number, y: number, a: number) => `translate(${fmt(x)}px, ${fmt(y)}px) rotate(${fmt(a)}deg)`;

/** Transforms of the joint groups: root, back leg (hip, knee, foot), front leg, torso, head,
 * back arm (shoulder, elbow), front arm. */
export function poseTransforms(pose: PlayerPose): string[] {
  const hipY = pose.crouch - HIP;
  const legs = [0, 1].flatMap((k) => {
    const [t, kn] = legAngles(pose, k);
    return [tr(k ? 1.2 : -1.2, hipY, t), tr(0, LEG, kn), tr(0, LEG, -t - kn)];
  });
  return [
    `translate(${PLAYER_X}px, ${fmt(FLOOR - pose.lift)}px) scale(${fmt(1 + pose.squash * 0.6)}, ${fmt(1 - pose.squash)})`,
    ...legs,
    tr(0, hipY, pose.lean),
    tr(0, -NECK, pose.nod),
    tr(SHOULDERS[1]!, -SHOULDER, pose.armB[0]),
    tr(0, UPPER, pose.armB[1]),
    tr(SHOULDERS[0]!, -SHOULDER, pose.armF[0]),
    tr(0, UPPER, pose.armF[1]),
  ];
}

const pose = (crouch: number, lean: number, armF: [number, number], armB: [number, number], more?: Partial<PlayerPose>): PlayerPose => ({
  lift: 0,
  squash: 0,
  crouch,
  tuck: 0,
  lean,
  nod: 0,
  armF,
  armB,
  ...more,
});

function mix(a: PlayerPose, b: PlayerPose, t: number): PlayerPose {
  const arm = (p: readonly number[], q: readonly number[]): [number, number] => [lerp(p[0]!, q[0]!, t), lerp(p[1]!, q[1]!, t)];
  const out = { ...a, armF: arm(a.armF, b.armF), armB: arm(a.armB, b.armB) };
  for (const k of ['lift', 'squash', 'crouch', 'tuck', 'lean', 'nod'] as const) out[k] = lerp(a[k], b[k], t);
  return out;
}

/** The head turns up towards a point (the ball), less than the eyes would. */
const look = (p: Point, lean: number) => -Math.min(30, (Math.atan2(197 - p.y, p.x - PLAYER_X - 3) / RAD) * 0.36) - lean * 0.5;

/** Watching the ball, arms loose. */
const STAND = pose(0, 2, [-24, -40], [-4, -30]);
/** Just after the release: landed in a crouch, arms still up towards the hoop. */
const FOLLOW = pose(4.5, 7, [-158, -10], [-146, -26]);
/** Both arms up: the basket, and a completed skill. */
export const CHEER = pose(0, -5, [-138, -18], [142, 16], { nod: -16 });
/** Shooting stance: the hands under the ball at the start of the arc. */
const SET: PlayerPose = (() => {
  const base = pose(1.5, 8, [0, 0], [0, 0]);
  const hold = (dx: number, dy: number, k: number): [number, number] => {
    const s = shoulderOf(base, k);
    const [a, e] = reach(HERO_CURVE[0].x + dx - s.x, HERO_CURVE[0].y + dy - s.y, UPPER, FORE, -1);
    return [a - base.lean, e];
  };
  return { ...base, armF: hold(-3, 11, 0), armB: hold(-7, 10, 1), nod: look(HERO_CURVE[0], base.lean) };
})();

/** Share of the flight over which the shot is released. */
export const RELEASE = 0.08;

/** The player's pose for a fill: the stance with the ball, the follow-through as it leaves,
 * relaxing while it flies, both arms up at the basket. */
export function playerPose(fill: number): PlayerPose {
  const f = clamp(fill);
  if (f >= 1) return CHEER;
  if (f <= 0) return SET;
  if (f < RELEASE) return { ...mix(SET, FOLLOW, smooth(f / RELEASE)), nod: look(heroArc(f), 7) };
  // The arms come down bending at the elbows, not stiff through the horizontal.
  const t = smooth((f - RELEASE) / (1 - RELEASE));
  const p = mix(FOLLOW, STAND, t);
  const bend = Math.sin(Math.PI * t) * 45;
  return { ...p, armF: [p.armF[0], p.armF[1] - bend], armB: [p.armB[0], p.armB[1] - bend], nod: look(heroArc(f), p.lean) };
}

interface PoseFrame {
  pose: PlayerPose;
  offset?: number;
  easing?: string;
}

/** The player's beat, over the drop and the reset: a dip as the ball meets the rim, a jump with
 * both arms up, a squashed landing, a fist pump, then the stance for the next ball. */
export function cheerFrames(from: PlayerPose): PoseFrame[] {
  return [
    { pose: from, easing: 'ease-in-out' },
    { pose: { ...STAND, crouch: 4, lean: 6, armF: [-34, -64], armB: [-16, -44], nod: from.nod }, offset: 0.18, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
    { pose: { ...CHEER, lift: 13, tuck: 4 }, offset: 0.38, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)' },
    { pose: { ...CHEER, crouch: 4.5, squash: 0.1, armF: [-118, -80], armB: [148, -22] }, offset: 0.54, easing: 'ease-out' },
    { pose: pose(1.5, 3, [-40, -112], [-12, -34], { nod: -8 }), offset: 0.68, easing: 'ease-in-out' },
    { pose: SET, offset: 0.86 },
    { pose: SET },
  ];
}

/** Keyframes per joint group (see poseTransforms). */
export function poseKeyframes(frames: PoseFrame[]): Keyframe[][] {
  const all = frames.map((f) => poseTransforms(f.pose));
  return all[0]!.map((_, k) =>
    frames.map(({ offset, easing }, i) => ({ transform: all[i]![k], ...(offset === undefined ? {} : { offset }), ...(easing ? { easing } : {}) })),
  );
}

export function flightFrames(from: number, to: number): { ball: Keyframe[]; trail: Keyframe[]; player: Keyframe[][] } {
  const a = clamp(from);
  const b = clamp(to);
  const steps = Math.max(2, Math.ceil(Math.abs(b - a) * 24));
  const ball: Keyframe[] = [];
  const poses: PoseFrame[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = a + ((b - a) * i) / steps;
    ball.push({ transform: ballTransform(f) });
    // The basket itself is the beat's.
    poses.push({ pose: playerPose(Math.min(f, 0.999)) });
  }
  return { ball, trail: [{ strokeDashoffset: String(trailOffset(a)) }, { strokeDashoffset: String(trailOffset(b)) }], player: poseKeyframes(poses) };
}

// The pile: the balls of past levels, radius 5, never moved once placed.

export interface PileBall extends Point {
  rotate: number;
  /** 0 orange, 1 light orange, 2 worn tan, 3 the skill colour. */
  tone: number;
}

const PILE_R = 5;
const PILE_SEAMS = 'M-5 0H5M-2.8-4.1C-1-2-1 2-2.8 4.1M2.8-4.1C1-2 1 2 2.8 4.1';

/** A ball resting on two others. */
function onTop(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const h = Math.sqrt(4 * PILE_R * PILE_R - (d * d) / 4);
  return { x: (a.x + b.x) / 2 + (dy / d) * h, y: (a.y + b.y) / 2 - (dx / d) * h };
}

/** Rolled to rest in front of the player's feet, row by row into a heap (15), then into the
 * cart at the left edge (7). Clear of the captions and their leaders (x 93). */
const SLOTS: Point[] = (() => {
  const out: Point[] = [];
  let row = [45, 55.1, 65.3, 75.4, 85.5].map((x) => ({ x, y: FLOOR - PILE_R }));
  while (row.length) {
    out.push(...row);
    row = row.slice(1).map((b, j) => onTop(row[j]!, b));
  }
  const cart = [8.6, 19.4, 8.9, 19.1, 8.5, 19.5].map((x, i) => ({ x, y: 241 - Math.floor(i / 2) * 10 - (i % 2) * 0.3 }));
  return [...out, ...cart, onTop(cart[4]!, cart[5]!)];
})();
export const PILE_SLOTS = SLOTS.length;
/** Where the heap in front of the feet ends and the cart begins. */
const HEAP = 15;

/** Balls on the floor: one per past level. */
export function pileCount(level: number | undefined): number {
  return Number.isFinite(level) && level! >= 1 ? Math.floor(level!) - 1 : 0;
}

export function pileBall(i: number): PileBall {
  return { ...SLOTS[i]!, rotate: (i * 137.5 + 20) % 360, tone: i % 9 === 4 ? 3 : i % 5 === 2 ? 2 : i % 3 === 1 ? 1 : 0 };
}

/** The balls drawn for `count` past levels; beyond the slots the cart's tag counts them. */
export function pileLayout(count: number): PileBall[] {
  return Array.from({ length: Math.min(PILE_SLOTS, Math.max(0, count)) }, (_, i) => pileBall(i));
}

interface PathPoint extends Point {
  /** ms from the hem. */
  at: number;
  rotate: number;
  scale: number;
}

/** Ball `i` joining the pile: from the net's hem it falls to the floor (in `fall` ms, shrinking
 * to the pile's size), bounces once and rolls into its place, or hops onto the heap or into the
 * cart over the player's head. `pace` scales the bounce and the roll. */
export function joinPath(i: number, fall: number, pace = 1): PathPoint[] {
  const to = pileBall(i);
  const floorY = FLOOR - PILE_R;
  // `turn`: how far the ball turns on the way to a point; rolling left turns it back.
  const pts: (PathPoint & { turn: number })[] = [{ x: RIM.x, y: HEM_Y, at: 0, rotate: 0, scale: BALL_R / PILE_R, turn: 0 }];
  const add = (x: number, y: number, ms: number, turn: number) => pts.push({ x, y, at: pts[pts.length - 1]!.at + ms, rotate: 0, scale: 1, turn });
  const hop = (x: number, y: number, height: number, ms: number, turn: number) => {
    const a = pts[pts.length - 1]!;
    for (let s = 1; s <= 4; s++) add(lerp(a.x, x, s / 4), lerp(a.y, y, s / 4) - height * s * (4 - s) / 4, (ms * pace) / 4, turn / 4);
  };
  add(RIM.x, floorY, fall, -70);
  if (i < HEAP && to.y > floorY - 1) {
    const land = Math.max(to.x + 16, 104);
    hop(land, floorY, 13, 170, -70);
    add(to.x, to.y, (80 + (land - to.x) * 2.6) * pace, -(land - to.x) / PILE_R / RAD);
  } else {
    hop(to.x + 1.2, to.y, i < HEAP ? (floorY + to.y) / 2 - Math.min(to.y, 205) + 16 : 80, 300, -200);
    add(to.x, to.y, 90 * pace, -14);
  }
  // The last point is the ball at rest in its place.
  let r = to.rotate;
  for (let k = pts.length - 1; k >= 0; k--) {
    pts[k]!.rotate = r;
    r -= pts[k]!.turn;
  }
  return pts.map(({ turn: _, ...p }) => p);
}

/** Beat shares: at the rim (haptic, ripple, spark), past the hem, the new ball, on the floor. */
export const BEAT_RIM = 0.2;
export const BEAT_HEM = 0.52;
export const BEAT_HAND = 0.75;
export const BEAT_FLOOR = 0.78;
/** Gravity: y = t² as a cubic. */
const FALL_EASING = 'cubic-bezier(0.33, 0, 0.67, 0.33)';

/** The drop: gravity to the rim, the net's drag, out and down to the floor, handing over to the
 * pile's ball (smaller: the size of the balls on the floor). */
export function dropFrames(): { ball: Keyframe[]; fade: Keyframe[] } {
  const top = ballPose(1);
  const at = (y: number, turn: number, scale = 1) => `${place({ x: RIM.x, y }, top.rotate + turn)} scale(${fmt(scale)})`;
  const floor = at(FLOOR - PILE_R, 110, PILE_R / BALL_R);
  return {
    ball: [
      { transform: at(top.y, 0), easing: 'cubic-bezier(0.35, 0.1, 0.9, 0.6)' },
      { transform: at(RIM.y, 25), offset: BEAT_RIM, easing: 'cubic-bezier(0.2, 0.5, 0.6, 1)' },
      { transform: at(HEM_Y, 60), offset: BEAT_HEM, easing: FALL_EASING },
      { transform: floor, offset: BEAT_FLOOR },
      { transform: floor },
    ],
    fade: [{ opacity: 1 }, { opacity: 1, offset: BEAT_HEM }, { opacity: 0, offset: BEAT_HEM + 0.18 }, { opacity: 0 }],
  };
}

// The level-up: rising → beat → reset → refilling; more levels repeat the last three (compressed,
// at most MAX_CYCLES), the last refill stops at toFill.

export type BallPhase = 'idle' | 'rising' | 'beat' | 'reset' | 'refilling';

export interface BallAnimState {
  phase: BallPhase;
  /** Cycles left, the current one included. */
  cyclesLeft: number;
  /** Later cycles run compressed. */
  cycle: number;
}

export type BallEvent = { type: 'start'; levels: number } | { type: 'done' } | { type: 'abort' };

export const BALL_IDLE: BallAnimState = { phase: 'idle', cyclesLeft: 0, cycle: 0 };

/** 'done' ends the running phase; other events leave it unchanged. */
export function nextBallPhase(state: BallAnimState, event: BallEvent): BallAnimState {
  if (event.type === 'abort') return BALL_IDLE;
  switch (state.phase) {
    case 'idle':
      if (event.type !== 'start' || !(event.levels >= 1)) return state;
      return { phase: 'rising', cyclesLeft: Math.min(MAX_CYCLES, Math.floor(event.levels)), cycle: 0 };
    case 'rising':
      return event.type === 'done' ? { ...state, phase: 'beat' } : state;
    case 'beat':
      return event.type === 'done' ? { ...state, phase: 'reset' } : state;
    case 'reset':
      return event.type === 'done' ? { ...state, phase: 'refilling' } : state;
    case 'refilling':
      if (event.type !== 'done') return state;
      return state.cyclesLeft > 1 ? { phase: 'beat', cyclesLeft: state.cyclesLeft - 1, cycle: state.cycle + 1 } : BALL_IDLE;
  }
}

export function ballRefillTarget(state: BallAnimState, toFill: number): number {
  return state.cyclesLeft > 1 ? 1 : clamp(toFill);
}

export interface BallPhaseTiming {
  delay: number;
  duration: number;
  easing?: 'flight' | 'out' | 'spring';
}

/** One level: 230 + 480 + 150 + 320 ≤ 1.2 s; the reset starts at BEAT_HAND of the beat, so a
 * level plays in about 1.06 s. Repeats about 0.65 s. */
export function ballPhaseTiming(state: BallAnimState): BallPhaseTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 230, easing: 'flight' };
    case 'beat':
      return { delay: 0, duration: compressed ? 400 : 480 };
    case 'reset':
      return { delay: 0, duration: compressed ? 110 : 150, easing: 'spring' };
    case 'refilling':
      return { delay: 0, duration: compressed ? 240 : 320, easing: state.cyclesLeft > 1 ? 'flight' : 'out' };
    case 'idle':
      return { delay: 0, duration: 0 };
  }
}

// Text

export const ballText: ProgressThemeText = {
  name: 'Мяч в корзину',
  levelNoun: 'Бросок',
  levelGenitive: 'броска',
  levelForms: ['бросок', 'броска', 'бросков'],
  levelFormsOf: ['броска', 'бросков', 'бросков'],
  completed: (n) => `Бросок ${n}: попадание`,
  fillLabel: (percent) => `Мяч пролетел ${percent}% пути к кольцу`,
  hint: 'Мяч летит по дуге в корзину',
};

// Marks

const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
/** Caption gaps: 24 px tap boxes at least, 44 px ones where they fit. */
const CAPTION_GAP = 28;
const TAP_GAP = 51;
const CAPTION_X = 96;
const CAPTION_TOP = 102;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;
const PENNANT_H = 13;

export function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** The middle of a mark's flag, in hero units. */
export const flagY = (height: number) => pennantTop(height).y + 3.5;

/** Where a mark's leader starts: the foot of its pole. */
export function poleFoot(height: number): Point {
  const p = pennantTop(height);
  return { x: p.x + 1, y: p.y + PENNANT_H };
}

/** Captions, highest mark on top: beside the flag below the hem, else under the hoop with a leader;
 * gaps up to TAP_GAP as the box allows; a caption steps right of a leader passing its text. */
export function captionSpots(heights: number[]): Point[] {
  const order = heights.map((h, i) => ({ h, i })).sort((a, b) => b.h - a.h);
  const lay = (gap: number) => {
    const p = order.map((o) => Math.max(flagY(o.h), CAPTION_TOP));
    for (let k = 1; k < p.length; k++) p[k] = Math.max(p[k]!, p[k - 1]! + gap);
    for (let k = p.length - 1; k >= 0; k--) p[k] = Math.min(p[k]!, k + 1 < p.length ? p[k + 1]! - gap : VIEW_H - 12);
    return p;
  };
  let gap = TAP_GAP;
  let ys = lay(gap);
  while (ys[0]! < CAPTION_TOP && gap > CAPTION_GAP) ys = lay(--gap);
  const spots = order.map(({ h }, k) => ({ x: Math.abs(ys[k]! - flagY(h)) < 8 ? pennantTop(h).x + 14 : CAPTION_X, y: ys[k]! }));
  for (let k = spots.length - 1; k > 0; k--) {
    const s = spots[k]!;
    const a = poleFoot(order[k]!.h);
    const at = (y: number) => a.x + ((s.x - 3 - a.x) * (y - a.y)) / (s.y - a.y);
    for (const r of spots.slice(0, k)) if (s.x >= CAPTION_X && r.y - 9 > a.y) r.x = Math.max(r.x, at(r.y - 9) + 4, at(r.y) + 6);
  }
  const out = Array<Point>(heights.length);
  order.forEach((o, k) => (out[o.i] = spots[k]!));
  return out;
}

/** Vertical padding in px: towards a 44 px tap area, never into a neighbour's. */
export function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.floor((Math.min(...gaps) - CAPTION_LINE) / 2) : CAPTION_PAD_MAX;
  return Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room));
}

// WAAPI, guarded as in progress/themes/flask.tsx

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function done(animation: Animation | null, duration: number): Promise<void> {
  if (!animation) return Promise.resolve();
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration + FINISH_FALLBACK_MS)]);
}

type Easing = NonNullable<BallPhaseTiming['easing']>;
let cachedEasing: Record<Easing, string> | null = null;
function easings(): Record<Easing, string> {
  if (cachedEasing) return cachedEasing;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  cachedEasing = {
    flight: 'cubic-bezier(0.45, 0, 0.4, 1)',
    out: read('--ease-out', 'cubic-bezier(0.2, 0.8, 0.2, 1)'),
    spring: read('--ease-spring', 'cubic-bezier(0.34, 1.56, 0.64, 1)'),
  };
  return cachedEasing;
}

function animate(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    return el.animate(keyframes, { ...options, easing: 'ease-out' });
  }
}

// Static drawing

/** The net: three rows of knots, strands in three groups. */
const rimFrontY = (x: number) => RIM.y + RIM.ry * Math.sqrt(Math.max(0, 1 - ((x - RIM.x) / RIM.rx) ** 2));
const NET_TOP = [107, 115.5, 124, 132.5, 141].map((x) => ({ x, y: rimFrontY(x) }));
const NET_MID = [110.6, 119.6, 128.4, 137.4].map((x) => ({ x, y: 72 }));
const NET_LOW = [114.5, 119.2, 124, 128.8, 133.5].map((x) => ({ x, y: 87 }));
const line = (...pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join('');
const strand = (i: number) =>
  line(NET_TOP[i]!, NET_MID[i]!, NET_LOW[i + 1]!) + line(NET_TOP[i + 1]!, NET_MID[i]!, NET_LOW[i]!);
const NET_GROUPS = [
  line(NET_TOP[0]!, NET_LOW[0]!) + strand(0),
  strand(1) + strand(2),
  strand(3) + line(NET_TOP[4]!, NET_LOW[4]!),
];
const NET_HEM = line(...NET_LOW);

const SPARKS = 'M101 50L94 45M100 60L92 62M147 50L154 45M148 60L156 62';
/** The ball cart at the left edge: rail, sides, bottom, wires. */
const CART = 'M3 219H25M3.5 219L4.5 246H23.5L24.5 219M8.9 219V246M14 219V246M19.1 219V246M4 232.5H24';

type JointRef = (el: SVGElement | null) => void;

function Player({ pose, number, idle, joint }: { pose: PlayerPose; number: number; idle: string; joint: (k: number) => JointRef }) {
  const t = poseTransforms(pose);
  const g = (k: number) => ({ ref: joint(k), style: { transform: t[k] } });
  const leg = (k: number) => (
    <g {...g(1 + k * 3)} className={k ? undefined : 'ball-far'}>
      <path d={`M0 0V${LEG}`} className="ball-thigh" />
      <g {...g(2 + k * 3)}>
        <path d={`M0 0V${LEG}`} className="ball-shin" />
        <rect {...g(3 + k * 3)} x="-3.4" y="-1.7" width="9" height="4.7" rx="2.3" className="ball-shoe" />
      </g>
    </g>
  );
  const arm = (k: number) => (
    <g {...g(9 + k * 2)} className={k ? undefined : 'ball-far'}>
      <path d={`M0 0V${UPPER}`} className="ball-upper" />
      <g {...g(10 + k * 2)}>
        <path d={`M0 0V${FORE - 1}`} className="ball-fore" />
        <circle cy={FORE} r="2.7" className="ball-hand" />
      </g>
    </g>
  );
  return (
    <g {...g(0)} className="ball-player" aria-hidden="true">
      <g className={`ball-idle-legs${idle}`}>
        {leg(0)}
        {leg(1)}
      </g>
      <g className={`ball-idle-up${idle}`}>
        <g {...g(7)}>
          {arm(0)}
          <path d="M-2.4-23h4.8v5h-4.8z" className="ball-neck" />
          <path d="M-6.2-19.6L-3-20.6Q0-16.4 3-20.6L6.2-19.6L7-2.5H-7z" className="ball-jersey" />
          <text x="-0.9" y="-10.5" className="ball-jersey-no">
            {number}
          </text>
          <path d="M-7.2-3.5H7.2L8.2 5.2H1.4L0 2.8L-1.4 5.2H-8.2z" className="ball-shorts" />
          <g {...g(8)}>
            <g className={`ball-idle-head${idle}`}>
            <circle cx="-1.6" cy="-8" r="1.8" className="ball-ear" />
            <circle cx="1" cy="-8.5" r="8" className="ball-head" />
            <path d="M-6.9-5.2A8 8 0 0 1 8.4-11.6Q4.5-13.4 1.2-11.8Q-1.8-10.4-3.4-7.4Q-5-5.2-6.9-5.2z" className="ball-hair" />
            <g className={`ball-eyes${idle}`}>
              <circle cx="4.4" cy="-8.6" r="1.1" />
              <circle cx="7.6" cy="-8.4" r="1" />
            </g>
            <path d="M4.2-4.6q1.9 1.5 3.8-.2" className="ball-smile" />
            </g>
          </g>
          {arm(1)}
        </g>
      </g>
    </g>
  );
}

function BallBody({ gradient }: { gradient: string }) {
  return (
    <>
      <circle r={BALL_R} fill={`url(#${gradient})`} className="ball-skin" />
      <g className="ball-seams">
        <path d="M-11 0H11" />
        <path d="M-6.2 -9.1C-2.2 -4.4 -2.2 4.4 -6.2 9.1" />
        <path d="M6.2 -9.1C2.2 -4.4 2.2 4.4 6.2 9.1" />
      </g>
    </>
  );
}

function PileBalls({ balls, from }: { balls: PileBall[]; from: number }) {
  return balls.map((b, i) => (
    <g key={i + from} data-i={i + from} className={`ball-heap ball-heap-${b.tone}`} style={{ transform: place(b, b.rotate) }}>
      <circle r={PILE_R} />
      <path d={PILE_SEAMS} />
    </g>
  ));
}

// Hero

/** A new level with no level-up after it: the old pile stays this long, then the new one fades in. */
export const HOLD_MS = 600;

function BallHero({ fill, capacity, state = 'active', level, motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const id = `ball${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);

  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  /** Balls on the floor while a level-up plays (or waits to): the pile that was on screen. */
  const [pile, setPile] = useState<number | null>(null);
  const playing = useRef(false);
  const playToken = useRef(0);
  /** Timer of a hold: the level went up and the old pile stays until playLevelUp (0: none). */
  const holding = useRef(0);
  const shown = override ?? target;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const count = pile ?? pileCount(level);
  const countRef = useRef(count);
  countRef.current = count;
  const levelRef = useRef(level);
  levelRef.current = level;
  const complete = state === 'complete';
  const resting = complete && override === null;

  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const posRef = useRef<SVGGElement>(null);
  const popRef = useRef<SVGGElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const netRefs = useRef<(SVGGElement | null)[]>([]);
  const joints = useRef<(SVGElement | null)[]>([]);
  const sparkRef = useRef<SVGPathElement>(null);
  const glides = useRef<Animation[]>([]);
  const joint = (k: number): JointRef => (el) => {
    joints.current[k] = el;
  };
  const movePlayer = (frames: Keyframe[][], options: KeyframeAnimationOptions) => frames.map((f, k) => animate(joints.current[k], f, options));
  const crossfade = () => animate(sceneRef.current, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });

  useEffect(installPauseWhenHidden, []);
  useEffect(() => () => window.clearTimeout(holding.current), []);

  // A new prop clears what a choreography left.
  const previousTarget = useRef(target);
  useEffect(() => {
    const from = previousTarget.current;
    previousTarget.current = target;
    if (playing.current || holding.current || from === target) return;
    setOverride(null);
  }, [target]);

  // The level went up: playLevelUp follows, so the pile and the ball on screen stay until it takes
  // them on (or HOLD_MS, then the new level fades in). Before paint, and before the glide below.
  const painted = useRef({ count, shown });
  const previousLevel = useRef(level);
  useLayoutEffect(() => {
    const from = previousLevel.current ?? 1;
    previousLevel.current = level;
    if (playing.current || holding.current || !((level ?? 1) > from)) return;
    holding.current = window.setTimeout(() => {
      flushSync(() => {
        setPile(null);
        setOverride(null);
      });
      holding.current = 0;
      crossfade();
    }, HOLD_MS);
    setPile(painted.current.count);
    setOverride(painted.current.shown);
  }, [level]);

  // Outside a choreography: glide (before paint) or crossfade.
  const previousShown = useRef<number | 'rest'>(resting ? 'rest' : shown);
  useLayoutEffect(() => {
    const from = previousShown.current;
    const to = resting ? 'rest' : shown;
    previousShown.current = to;
    if (playing.current || holding.current || from === to) return;
    glides.current.forEach((a) => a.cancel());
    glides.current = [];
    if (motion === 'reduced' || from === 'rest' || to === 'rest') {
      const fade = crossfade();
      if (fade) glides.current.push(fade);
      return;
    }
    const frames = flightFrames(from, to);
    const options = { duration: 600, easing: easings().out };
    for (const a of [animate(posRef.current, frames.ball, options), animate(trailRef.current, frames.trail, options), ...movePlayer(frames.player, options)]) {
      if (a) glides.current.push(a);
    }
  }, [shown, resting, motion]);

  // What this commit shows; the hold above reads the previous commit's.
  useLayoutEffect(() => {
    painted.current = { count, shown };
  });

  // Completed on screen (not on load): the golden ball drops into the net.
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete') return;
    const keyframes = motion === 'reduced' ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateY(-26px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }];
    animate(popRef.current, keyframes, { duration: motion === 'reduced' ? 240 : 520, easing: motion === 'reduced' ? 'ease-out' : easings().spring });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => posRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const pos = posRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        const end = clamp(toFill);
        const held = holding.current;
        window.clearTimeout(held);
        holding.current = 0;
        if (!pos || typeof pos.animate !== 'function') {
          if (held)
            flushSync(() => {
              setPile(null);
              setOverride(null);
            });
          onOverflow?.();
          return;
        }
        playing.current = true;
        glides.current.forEach((a) => a.cancel());
        glides.current = [];
        const running: Animation[] = [];
        const joins: Promise<void>[] = [];
        const track = (a: Animation | null) => {
          if (a) running.push(a);
          return a;
        };
        // The props name the new level; the balls on screen are the pile before it (the hold kept
        // them), and each basket adds its ball until the pile matches the level.
        const start = Math.min(clamp(fromFill), shownRef.current);
        const final = pileCount(levelRef.current);
        let heap = Math.min(countRef.current, final);
        flushSync(() => {
          setScripted(true);
          setOverride(start);
          setPile(heap);
        });

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            heap = final;
            flushSync(() => {
              setOverride(end);
              setPile(final);
            });
            await done(track(crossfade()), 240);
            return;
          }
          const ease = easings();
          let current = start;
          let beats = 0;
          const fly = async (to: number, timing: BallPhaseTiming) => {
            const frames = flightFrames(current, to);
            const options: KeyframeAnimationOptions = { duration: timing.duration, easing: ease[timing.easing ?? 'out'], fill: 'forwards' };
            track(animate(trailRef.current, frames.trail, options));
            movePlayer(frames.player, options).forEach(track);
            const a = track(animate(pos, frames.ball, options));
            current = to;
            await done(a, timing.duration);
          };
          const beat = async (timing: BallPhaseTiming, reset: number) => {
            const d = timing.duration;
            const rim = d * BEAT_RIM;
            const drop = dropFrames();
            // Easing per keyframe: the ball meets the rim at BEAT_RIM.
            const dropping = track(animate(pos, drop.ball, { duration: d, fill: 'forwards' }));
            track(animate(popRef.current, drop.fade, { duration: d, fill: 'forwards' }));
            track(animate(trailRef.current, [{ strokeDashoffset: '0', opacity: 1 }, { strokeDashoffset: '0', opacity: 0 }], { duration: rim, fill: 'forwards' }));
            netRefs.current.forEach((strands, i) => {
              const options = { duration: d * 0.6, delay: rim + i * 25, easing: 'ease-out' };
              const frames = [
                { transform: 'scale(1, 1)' },
                { transform: `scale(0.86, ${1.3 - i * 0.05})`, offset: 0.4 },
                { transform: 'scale(1.04, 0.93)', offset: 0.75 },
                { transform: 'scale(1, 1)' },
              ];
              track(animate(strands, frames, options));
            });
            const sparkFrames = [
              { opacity: 0, transform: 'scale(0.7)' },
              { opacity: 1, transform: 'scale(1)', offset: 0.3 },
              { opacity: 1, transform: 'scale(1.1)', offset: 0.6 },
              { opacity: 0, transform: 'scale(1.25)' },
            ];
            track(animate(sparkRef.current, sparkFrames, { duration: d * 0.5, delay: rim, easing: 'ease-out' }));
            // The player jumps as the ball goes in and lands in the stance for the next one.
            movePlayer(poseKeyframes(cheerFrames(playerPose(Math.min(current, 0.999)))), { duration: d * BEAT_HAND + reset, fill: 'forwards' }).forEach(track);
            // The ball goes in: the jersey takes the new number and the ball joins the pile, a new ball
            // on the floor flown in from the hem.
            const first = beats++ === 0;
            window.setTimeout(() => {
              if (aborted()) return;
              if (first) onOverflow?.();
              if (heap >= final) return;
              const i = heap++;
              flushSync(() => setPile(heap));
              const svg = svgRef.current;
              const fall = d * (BEAT_FLOOR - BEAT_HEM);
              // It takes over from the dropping ball at the hem: on the drop's own timeline.
              const at = (a: Animation | null) => {
                if (a && dropping?.startTime != null) a.startTime = Number(dropping.startTime) + d * BEAT_HEM;
                return track(a);
              };
              const options = { delay: dropping?.startTime != null ? 0 : d * (BEAT_HEM - BEAT_RIM), fill: 'both' as const };
              // Past the slots the cart's tag counts it.
              if (i >= PILE_SLOTS) {
                at(animate(svg?.querySelector('.ball-cart-tag'), [{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { ...options, duration: 300 }));
                return;
              }
              const path = joinPath(i, fall, d / 480);
              const total = path[path.length - 1]!.at;
              const frames = path.map((p) => ({ transform: `${place(p, p.rotate)} scale(${fmt(p.scale)})`, offset: p.at / total, ...(p.at ? {} : { easing: FALL_EASING }) }));
              const ball = svg?.querySelector(`[data-i="${i}"]`);
              joins.push(done(at(animate(ball, frames, { ...options, duration: total })), total + options.delay));
              at(animate(ball, [{ opacity: 0 }, { opacity: 1 }], { ...options, duration: fall * 0.7, fill: 'backwards' }));
            }, rim);
            // The reset overlaps the end of the drop.
            await wait(d * BEAT_HAND);
          };
          const reset = async (timing: BallPhaseTiming) => {
            // A new ball in the hands; the old one is on its way to the pile.
            const pop = popRef.current;
            flushSync(() => setOverride(0));
            for (const a of running) if ([pos, pop, trailRef.current].includes((a.effect as KeyframeEffect | null)?.target as SVGGElement)) a.cancel();
            current = 0;
            const popIn = [{ opacity: 0.2, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)' }];
            await done(track(animate(pop, popIn, { duration: timing.duration, easing: ease.spring, fill: 'forwards' })), timing.duration);
          };

          let phase = nextBallPhase(BALL_IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = ballPhaseTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await fly(1, timing);
                break;
              case 'beat':
                await beat(timing, ballPhaseTiming({ ...phase, phase: 'reset' }).duration);
                break;
              case 'reset':
                await reset(timing);
                break;
              case 'refilling':
                await fly(ballRefillTarget(phase, end), timing);
                break;
            }
            phase = nextBallPhase(phase, { type: 'done' });
          }
          if (beats === 0 && !aborted()) onOverflow?.();
          await Promise.all(joins);
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            // Commit the end state, then drop the layers: no jump. Past three cycles the rest of
            // the balls join at once.
            flushSync(() => {
              setOverride(end);
              setPile(null);
            });
            running.forEach((a) => a.cancel());
            for (let i = heap; i < final; i++) animate(svgRef.current?.querySelector(`[data-i="${i}"]`), [{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: (i - heap) * 60, fill: 'backwards' });
            playing.current = false;
            // Then follow the prop again (as Flask): glide on to a later write, or rest in the net.
            requestAnimationFrame(() => {
              setScripted(false);
              setOverride(null);
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
  const marked = reserved.current;
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const spots = captionSpots(captioned.map((m) => m.height));
  const captionY = spots.map((s) => s.y);
  const ticks = capacity !== undefined ? scaleTicks(capacity) : PLAIN_TICKS.map((share) => ({ share, value: null as number | null }));
  const balls = pileLayout(count);
  const idle = motion === 'reduced' ? '' : ' anim-decor';

  const classes = [
    'ball-theme',
    'ball-theme--hero',
    `ball-theme--${state}`,
    marked ? 'ball-theme--marked' : '',
    scripted ? 'ball-theme--scripted' : '',
    // Aiming: the ball in the hands keeps still, so do they.
    !resting && shown === 0 ? 'ball-theme--aiming' : '',
  ].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
      <svg ref={svgRef} className="ball-svg" viewBox="0 0 160 260" role="img" aria-label={label ?? ballText.fillLabel(Math.floor(shown * 100))}>
        <defs>
          <radialGradient id={`${id}-skin`} cx="0.36" cy="0.3" r="0.75">
            <stop offset="0" className="ball-stop-light" />
            <stop offset="1" className="ball-stop-deep" />
          </radialGradient>
        </defs>
        <line x1="4" x2="156" y1="252" y2="252" className="ball-floor" />
        {/* Wall-mounted: free space under the hoop for captions. */}
        <rect x="148" y="18" width="10" height="26" rx="2" className="ball-mount" />
        <rect x="98" y="12" width="52" height="40" rx="4" className="ball-board" />
        <rect x="113" y="30" width="22" height="17" rx="1.5" className="ball-board-square" />
        <path d={rimArc(RIM, 1)} className="ball-rim" />
        <path d={HERO_PATH} className="ball-arc" />
        {ticks.map(({ share, value }) => {
          const p = heroArc(share);
          const n = innerNormal(share);
          return (
            <g key={share} className="ball-tick">
              <line x1={fmt(p.x - n.x * 3)} y1={fmt(p.y - n.y * 3)} x2={fmt(p.x + n.x * 3)} y2={fmt(p.y + n.y * 3)} />
              {value !== null && (
                <text
                  x={fmt(p.x - n.x * 13)}
                  y={fmt(p.y - n.y * 14)}
                  dominantBaseline="central"
                  textAnchor={n.x > 0.5 ? 'end' : n.x < -0.5 ? 'start' : 'middle'}
                >
                  {formatNumber(value)}
                </text>
              )}
            </g>
          );
        })}
        <g ref={sceneRef}>
          <path
            ref={trailRef}
            d={HERO_PATH}
            pathLength={1}
            className="ball-trail"
            style={{ strokeDashoffset: resting ? 0 : trailOffset(shown) }}
          />
          <g className="ball-cart" aria-hidden="true">
            <PileBalls balls={balls.slice(HEAP)} from={HEAP} />
            <path d={CART} className="ball-cart-wires" />
            <circle cx="7.5" cy="248.8" r="2.2" className="ball-cart-wheel" />
            <circle cx="20.5" cy="248.8" r="2.2" className="ball-cart-wheel" />
            {count > PILE_SLOTS && (
              <g className="ball-cart-tag">
                <rect x="4" y="223.5" width="20" height="11" rx="3" />
                <text x="14" y="229.4">
                  ×{formatNumber(count)}
                </text>
              </g>
            )}
          </g>
          <Player pose={resting ? CHEER : playerPose(shown)} number={(count + 1) % 100} idle={idle} joint={joint} />
          <g aria-hidden="true">
            <PileBalls balls={balls.slice(0, HEAP)} from={0} />
          </g>
          {shownMarks.map((mark) => {
            const p = pennantTop(mark.height);
            const s = spots[captioned.indexOf(mark)];
            const foot = poleFoot(mark.height);
            const d = `M${fmt(foot.x - 1)} ${fmt(foot.y)}V${fmt(p.y)}l9 3.5l-9 3.5`;
            return (
              // Pointer only: the captions are the accessible way.
              <g key={mark.id} className="ball-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
                {s && s.x >= CAPTION_X && <line x1={fmt(foot.x)} y1={fmt(foot.y)} x2={fmt(s.x - 3)} y2={fmt(s.y)} className="ball-mark-leader" />}
                <rect x={fmt(p.x - 6)} y={fmt(p.y - 4)} width="20" height={PENNANT_H + 8} className="ball-mark-hit" />
                {/* On the board: a halo in its colour. */}
                {p.x > 88 && <path d={d} className="ball-mark-halo" />}
                <path d={d} className="ball-mark-pennant" />
              </g>
            );
          })}
          <g ref={posRef} className="ball-pos" style={{ transform: resting ? REST_TRANSFORM : ballTransform(shown) }}>
            <g ref={popRef} className="ball-pop">
              <BallBody gradient={`${id}-skin`} />
            </g>
          </g>
        </g>
        <path d={rimArc(RIM, 0)} className="ball-rim" />
        <g className="ball-net" aria-hidden="true">
          {NET_GROUPS.map((d, i) => (
            <g
              key={i}
              ref={(el) => {
                netRefs.current[i] = el;
              }}
              className="ball-net-strands"
            >
              <path d={d} />
              {i === 1 && <path d={NET_HEM} className="ball-net-hem" />}
            </g>
          ))}
        </g>
        <path ref={sparkRef} d={SPARKS} className="ball-spark" aria-hidden="true" />
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="ball-mark-caption"
          style={{
            left: `${(spots[i]!.x / VIEW_W) * 100}%`,
            top: `${(captionY[i]! / VIEW_H) * 100}%`,
            paddingBlock: captionPad(captionY, i),
            maxWidth: Math.min(96, Math.round(190 - spots[i]!.x * HERO_SCALE)),
          }}
          aria-label={copy.marks.onFlask(mark.label)}
          onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}
        >
          {shortLabel(mark.label)}
        </button>
      ))}
    </div>
  );
}

// Mini: the hoop and the ball on a short arc, square, legible at 28 px; up to three balls of past
// levels under the hoop.

const MINI_RIM = { x: 29, y: 15, rx: 7, ry: 2 };
const MINI_PILE = [
  { x: 25.9, y: 36.6 },
  { x: 32.1, y: 36.6 },
  { x: 29, y: 31.4 },
];

export function miniPoint(fill: number): Point {
  return miniArc(clamp(fill));
}

function BallMini({ fill, state = 'active', level, size = 32, label }: ProgressMiniProps) {
  const id = `ballmini${useId().replace(/[^\w-]/g, '')}`;
  const complete = state === 'complete';
  const f = complete ? 1 : state === 'empty' ? 0 : clamp(fill);
  const p = complete ? { x: MINI_RIM.x, y: 18.5 } : miniPoint(f);
  const net = <path d="M22.5 15.5L25.5 24.5M35.5 15.5L32.5 24.5M29 17L29 25M25.5 24.5H32.5" className="ball-net-strands" />;
  return (
    <svg
      className={`ball-theme ball-theme--mini ball-theme--${state}`}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label={label ?? ballText.fillLabel(Math.floor(f * 100))}
    >
      <defs>
        <radialGradient id={`${id}-skin`} cx="0.36" cy="0.3" r="0.75">
          <stop offset="0" className="ball-stop-light" />
          <stop offset="1" className="ball-stop-deep" />
        </radialGradient>
      </defs>
      <rect x="21" y="2" width="16" height="11" rx="1.5" className="ball-board" />
      <path d={rimArc(MINI_RIM, 1)} className="ball-rim" />
      {MINI_PILE.slice(0, pileCount(level)).map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r="3" className={`ball-heap ball-heap-${pileBall(i).tone}`} />
      ))}
      {/* Complete: the ball in front of the net reads at 28 px. */}
      {complete ? (
        net
      ) : (
        <>
          <path d={MINI_PATH} className="ball-mini-arc" />
          <path d={MINI_PATH} pathLength={1} className="ball-trail" style={{ strokeDashoffset: trailOffset(f) }} />
        </>
      )}
      <g transform={`translate(${fmt(p.x)} ${fmt(p.y)}) rotate(${fmt(f * SPIN)}) scale(0.5)`}>
        <BallBody gradient={`${id}-skin`} />
      </g>
      <path d={rimArc(MINI_RIM, 0)} className="ball-rim" />
      {!complete && net}
    </svg>
  );
}

export const ballTheme: ProgressThemeDefinition = {
  key: 'ball',
  text: ballText,
  available: true,
  Hero: BallHero,
  Mini: BallMini,
  markPoint,
};
