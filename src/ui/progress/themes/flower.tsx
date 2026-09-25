import { Fragment, memo, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '../../../lib/format';
import { copy } from '../../copy';
import { DONE_EVENT, IDLE, MAX_CYCLES, nextPhase, refillTarget, type AnimationState } from '../../components/flaskAnimation';
import { scaleTicks } from '../../components/flaskScale';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import './flower.css';

// The flower («Цветок»): every level grows its own species in a terracotta pot — a daisy, a
// tulip, a sunflower, a bellflower… (`flowerFor(level)`, twelve of them, neighbours always
// differ). A seed sprouts a pair of seedling leaves, the stem rises, the species' own leaves
// unfold at a quarter, a half and three quarters, a bud forms near the top and opens into the
// species' bloom at the beat of completion. The flowers of past levels stand in a garden behind
// and around the pot (`gardenSlot(index)`: three depth rows for the first 24, then a far meadow
// of tiny blooms that keeps filling in), with a border, a fence and a watering can as it grows.
// Natural colours from token mixes; about every other species wears the skill colour on its
// petals (README rule 3). The level-up reuses the flask's state machine (rising → overflow →
// draining → refilling), each level within 1.1 s: the stem grows to the top, the bud opens, the
// whole plant is transplanted into its garden slot (it shrinks and moves there) and a fresh
// seed of the next species sprouts. Only transform, opacity and stroke-dashoffset move; while
// idle, one leaf sways and a butterfly drifts over a garden of three flowers or more.

// Geometry (viewBox 0 0 160 260): the stem leaves the soil at y 208 and reaches y 52 when full.
const VIEW_W = 160;
const VIEW_H = 260;
const SOIL_Y = 208;
const TIP_Y = 52;
const TRAVEL = SOIL_Y - TIP_Y;
const STEM_X = 80;
const STEM_SAMPLES = 32;

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

// ---- Path helpers: every drawn shape is a path of absolute M/L/C/Q/Z commands ----

type Pt = [number, number];
const r1 = (v: number) => Math.round(v * 10) / 10;
const P = (x: number, y: number) => `${r1(x)} ${r1(y)}`;

/** Maps every coordinate pair of a path (absolute M/L/C/Q/Z commands only). */
function mapPath(d: string, f: (x: number, y: number) => Pt): string {
  return d.replace(/(-?[\d.]+)[ ,]+(-?[\d.]+)/g, (_, x: string, y: string) => P(...f(+x, +y)));
}
const mirror = (d: string) => mapPath(d, (x, y) => [-x, y]);
const move = (d: string, dx: number, dy: number, k = 1, deg = 0) => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return mapPath(d, (x, y) => [dx + k * (x * c - y * s), dy + k * (x * s + y * c)]);
};

/** An ellipse as four cubic arcs (so it can be moved and mirrored like any path). */
function circ(cx: number, cy: number, rx: number, ry = rx): string {
  const a = rx * 0.552;
  const b = ry * 0.552;
  return (
    `M${P(cx - rx, cy)}C${P(cx - rx, cy - b)} ${P(cx - a, cy - ry)} ${P(cx, cy - ry)}C${P(cx + a, cy - ry)} ${P(cx + rx, cy - b)} ${P(cx + rx, cy)}` +
    `C${P(cx + rx, cy + b)} ${P(cx + a, cy + ry)} ${P(cx, cy + ry)}C${P(cx - a, cy + ry)} ${P(cx - rx, cy + b)} ${P(cx - rx, cy)}Z`
  );
}

interface PetalForm {
  cx?: number;
  cy?: number;
  /** 0 a round end, 1 a pointed one. */
  tip?: number;
  /** Vertical squash of the ring (a flower seen a little from the side). */
  sy?: number;
  rot?: number;
}

/** Petals at the given angles (degrees, 0 = up) from radius r0 out to r0 + len, half-width w. */
function petalsAt(angles: number[], r0: number, len: number, w: number, { cx = 0, cy = 0, tip = 0.5, sy = 1 }: PetalForm = {}): string {
  const e = r0 + len;
  const y1 = -r0 - len * (0.15 + 0.15 * tip);
  const y2 = -r0 - len * (1 - 0.2 * tip);
  const w2 = w * (1 - 0.6 * tip);
  const one = `M0 ${-r0}C${w} ${y1} ${w2} ${y2} 0 ${-e}C${-w2} ${y2} ${-w} ${y1} 0 ${-r0}Z`;
  return angles
    .map((a) => {
      const c = Math.cos((a * Math.PI) / 180);
      const s = Math.sin((a * Math.PI) / 180);
      return mapPath(one, (x, y) => [cx + x * c - y * s, cy + (x * s + y * c) * sy]);
    })
    .join('');
}
const ring = (n: number, r0: number, len: number, w: number, o: PetalForm = {}) =>
  petalsAt(
    Array.from({ length: n }, (_, i) => (o.rot ?? 0) + (360 * i) / n),
    r0,
    len,
    w,
    o,
  );

/** Tiny dots on a sunflower spiral (golden angle) inside radius r. */
function spiralDots(n: number, r: number, dot: number, cy: number): string {
  return Array.from({ length: n }, (_, i) => {
    const d = r * Math.sqrt((i + 0.5) / n);
    const a = i * 2.39996;
    return circ(d * Math.cos(a), cy + d * Math.sin(a), dot);
  }).join('');
}

/** A closed curve through the points (midpoint quadratics); a doubled point stays a sharp corner. */
function smooth(pts: Pt[]): string {
  const n = pts.length;
  const mid = (i: number) => {
    const p = pts[i % n]!;
    const q = pts[(i + 1) % n]!;
    return P((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  };
  let d = `M${mid(n - 1)}`;
  for (let i = 0; i < n; i++) d += `Q${P(...pts[i]!)} ${mid(i)}`;
  return `${d}Z`;
}

interface LeafForm {
  len: number;
  /** Half-width at the widest point. */
  width: number;
  /** Direction: degrees from straight up, negative leans left (−60 points up and to the left). */
  angle: number;
  /** Where the blade is widest (lower = nearer the base) and how full it is. */
  a?: number;
  p?: number;
  /** Sideways curve of the midrib (negative droops). */
  bend?: number;
  /** Lobes or teeth along each edge and how deep they cut; `saw` points them back to the base. */
  lobes?: number;
  depth?: number;
  saw?: boolean;
  /** Share of the length that is a bare leaf stalk. */
  stalk?: number;
  /** Three leaflets on a stalk (a rose leaf). */
  compound?: boolean;
}

/** A leaf with its base at 0 0: the outline and the midrib. */
export function leafShape(f: LeafForm): [string, string] {
  if (f.compound) {
    const [leaflet] = leafShape({ len: f.len * 0.48, width: f.width, angle: 0, a: 0.75, lobes: 5, depth: 0.16, saw: true });
    const stalk = f.len * 0.62;
    const d = [move(leaflet, 0, -stalk, 1, 0), move(leaflet, 0, -stalk * 0.5, 0.85, -58), move(leaflet, 0, -stalk * 0.5, 0.85, 58), `M-0.6 0L-0.5 ${-stalk}L0.5 ${-stalk}L0.6 0Z`].join('');
    return [move(d, 0, 0, 1, f.angle), move(`M0 0L0 ${-stalk - f.len * 0.3}`, 0, 0, 1, f.angle)];
  }
  const { len, width, angle, a = 0.8, p = 0.9, bend = -0.06, lobes = 0, depth = 0, saw = false, stalk = 0 } = f;
  const steps = lobes ? 30 : 14;
  const mid = (t: number): Pt => [bend * len * Math.sin(Math.PI * t), -t * len];
  const half = (t: number) => {
    if (t < stalk) return 0.6;
    const u = (t - stalk) / (1 - stalk);
    let w = width * Math.sin(Math.PI * u ** a) ** p;
    if (lobes) {
      const ph = lobes * u;
      w *= 1 - depth * (saw ? ph - Math.floor(ph) : 0.5 - 0.5 * Math.cos(2 * Math.PI * ph));
    }
    return Math.max(0.4, w);
  };
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const [x, y] = mid(t);
    const w = half(t);
    left.push([x - w, y]);
    right.push([x + w, y]);
  }
  const tip = mid(1);
  const outline = smooth([[0, 0], [0, 0], ...left, tip, tip, ...right.reverse()]);
  const v0 = mid(Math.max(0.06, stalk));
  const v1 = mid(0.85);
  const vm = mid((Math.max(0.06, stalk) + 0.85) / 2);
  const vein = `M${P(...v0)}Q${P(2 * vm[0] - (v0[0] + v1[0]) / 2, 2 * vm[1] - (v0[1] + v1[1]) / 2)} ${P(...v1)}`;
  return [move(outline, 0, 0, 1, angle), move(vein, 0, 0, 1, angle)];
}

// ---- Species ----

/**
 * A part of a bud or a bloom: a colour role and a path. Roles (flower.css): a/b the petals and
 * their lighter or deeper shade, c/d the heart, e the deepest shade, k ink, x spots and seeds,
 * y pollen yellow, w white, g/l green, and the strokes s (a green pedicel), v (a vein), n (filaments).
 */
type Part = [string, string];

export interface Species {
  key: string;
  /** Russian name, for the preview and the tests. */
  name: string;
  /** The petals wear the skill colour; the others keep their natural colour. */
  skill: boolean;
  /** The stem: sway amplitude, phase, lean to the right over its height, stroke width. */
  stem: [wave: number, phase: number, lean: number, width: number];
  leaf: LeafForm;
  /** Leaf tone: '' green, 'sage' (lavender), 'blue' (tulip, iris), 'deep' (rose). */
  tone: string;
  /** The three true leaves (at 25 / 50 / 75 %): height on the stem, side, size, extra turn (°). */
  leaves: [pos: number, side: -1 | 1, size: number, turn: number][];
  /** Scale of the bud and the bloom drawings. */
  k: number;
  bud: Part[];
  bloom: Part[];
}

const DAISY: Species = {
  key: 'daisy',
  name: 'ромашка',
  skill: false,
  stem: [3, 0, 0, 3.6],
  leaf: { len: 28, width: 5.8, angle: -58, a: 0.8, p: 0.8, lobes: 3, depth: 0.32 },
  tone: '',
  leaves: [[0.22, -1, 0.95, 0], [0.45, 1, 0.9, 0], [0.66, -1, 0.75, 0]],
  k: 1.25,
  bud: [
    ['w', circ(0, -11, 6.8, 6.4)],
    ['g', 'M-8.5 -9C-8.5 -1 -4 1.5 0 1.5C4 1.5 8.5 -1 8.5 -9C6 -7.5 3.5 -10.5 0 -8.8C-3.5 -10.5 -6 -7.5 -8.5 -9Z'],
  ],
  bloom: [
    ['b', ring(16, 5, 18, 3.5, { rot: 11.25, cy: -6, tip: 0.15 })],
    ['a', ring(16, 5, 19.5, 3.7, { cy: -6, tip: 0.15 })],
    ['c', circ(0, -6, 7.4)],
    ['d', circ(-1.3, -7.3, 4.6)],
  ],
};

const TULIP_SIDE = 'M-1 0C-12 -1 -16.5 -13 -14.5 -30C-8 -27 -3 -20 -0.5 -11Z';
const TULIP: Species = {
  key: 'tulip',
  name: 'тюльпан',
  skill: true,
  stem: [1.5, 0.3, 1, 4.6],
  leaf: { len: 54, width: 6.5, angle: -14, a: 0.7, p: 0.5, bend: -0.1 },
  tone: 'blue',
  leaves: [[0.01, -1, 1, 0], [0.02, 1, 0.92, 2], [0.3, -1, 0.62, -12]],
  k: 1.3,
  bud: [
    ['a', 'M0 0C-8 -3 -8.5 -17 0 -27C8.5 -17 8 -3 0 0Z'],
    ['b', 'M-3.5 -6C-5 -11 -4.5 -17 -1.5 -22C-2 -16 -2.5 -11 -3.5 -6Z'],
  ],
  bloom: [
    ['e', 'M0 -3C-9 -5 -12 -18 -9 -33C-6 -28 -3 -27 0 -31C3 -27 6 -28 9 -33C12 -18 9 -5 0 -3Z'],
    ['d', TULIP_SIDE],
    ['d', mirror(TULIP_SIDE)],
    ['a', 'M0 1C-9 0 -11 -12 -8.5 -22C-6.5 -28 -2.5 -32 0 -34C2.5 -32 6.5 -28 8.5 -22C11 -12 9 0 0 1Z'],
    ['b', 'M-4.5 -7C-6.5 -13 -5.5 -21 -2.5 -27C-2.5 -20 -3 -13 -4.5 -7Z'],
  ],
};

const SUNFLOWER: Species = {
  key: 'sunflower',
  name: 'подсолнух',
  skill: false,
  stem: [2, 0, -1, 5.4],
  leaf: { len: 33, width: 9.6, angle: -64, a: 0.62, p: 0.85, stalk: 0.2, bend: -0.05 },
  tone: '',
  leaves: [[0.2, -1, 1, 0], [0.44, 1, 0.95, 0], [0.66, -1, 0.8, 0]],
  k: 1.2,
  bud: [
    ['g', ring(12, 3, 8.5, 3, { cy: -5, tip: 1 })],
    ['l', circ(0, -5, 6)],
    ['a', ring(12, 5, 2.4, 1.8, { cy: -5, rot: 15, tip: 1 })],
  ],
  bloom: [
    ['b', ring(20, 10.5, 13.5, 3.9, { rot: 9, cy: -4, tip: 0.8 })],
    ['a', ring(20, 10.5, 14.5, 4.1, { cy: -4, tip: 0.8 })],
    ['c', circ(0, -4, 12.2)],
    ['d', circ(0, -4, 8.2)],
    ['x', spiralDots(34, 10.8, 0.75, -4)],
  ],
};

const BELL = 'M-3 0C-7.5 1 -8 8 -9 14C-9.5 17 -11.5 19.5 -13 21.5L-8.5 21L-5 23.5L0 21.5L5 23.5L8.5 21L13 21.5C11.5 19.5 9.5 17 9 14C8 8 7.5 1 3 0Z';
const BELL_PARTS = (dx: number, dy: number, k: number, deg: number): Part[] => [
  ['a', move(BELL, dx, dy, k, deg)],
  ['e', move(circ(0, 21.2, 8.6, 2.1), dx, dy, k, deg)],
  ['b', move('M-4 3C-6 7 -6.5 12 -7.5 16C-5 13 -4 8 -4 3Z', dx, dy, k, deg)],
  ['g', move('M-3.5 0.8L-5.5 -2L-1.5 -0.5L0 -3.2L1.5 -0.5L5.5 -2L3.5 0.8Z', dx, dy, k, deg)],
];
const BELLFLOWER: Species = {
  key: 'bellflower',
  name: 'колокольчик',
  skill: true,
  stem: [5, 0.4, 2, 3],
  leaf: { len: 28, width: 3.8, angle: -55, a: 0.9, p: 1, bend: -0.08 },
  tone: '',
  leaves: [[0.2, -1, 0.95, 0], [0.42, 1, 0.9, 0], [0.63, -1, 0.75, 0]],
  k: 1.3,
  bud: [
    ['s', 'M0 0C1 -6 5 -9 8.5 -8'],
    ['a', 'M8.5 -8C4.5 -7 3.5 -1 4.5 5C5.5 8 7.5 9 8.5 9C9.5 9 11.5 8 12.5 5C13.5 -1 12.5 -7 8.5 -8Z'],
    ['g', 'M5 -6.5L4 -9.5L7.5 -8L8.5 -11L9.5 -8L13 -9.5L12 -6.5Z'],
  ],
  bloom: [
    ['s', 'M0 0C0 -8 5 -13.5 11 -12.5M-0.5 9C-3.5 5 -9 4 -12.5 7M0 0C-1 -6 -3 -10 -6 -12'],
    ['a', circ(-6.5, -8.5, 2.6, 4.2)],
    ...BELL_PARTS(-12.5, 7, 0.72, 12),
    ...BELL_PARTS(11, -12.5, 1, -8),
  ],
};

const POPPY_BACK = 'M-1 -6C-9 -5 -19 -12 -19 -22C-19 -30 -9 -32 -3 -27C-1 -25 0 -21 0 -18Z';
const POPPY_FRONT = 'M0 3C-9 4 -19 -1 -20 -10C-21 -17 -14 -21 -8 -18C-3 -16 -1 -11 0 -9Z';
const POPPY: Species = {
  key: 'poppy',
  name: 'мак',
  skill: false,
  stem: [6, 1, -2, 2.8],
  leaf: { len: 30, width: 7, angle: -52, a: 0.85, p: 0.75, lobes: 4, depth: 0.55 },
  tone: '',
  leaves: [[0.14, -1, 0.95, 0], [0.32, 1, 0.85, 0], [0.5, -1, 0.7, 0]],
  k: 1.3,
  bud: [
    ['s', 'M0 0C0 -7 4 -11 8 -10C11 -9.5 12.5 -7 12.5 -4'],
    ['g', circ(12.5, 2.5, 4.8, 7)],
    ['l', circ(11, 0.5, 1.6, 3.6)],
  ],
  bloom: [
    ['e', POPPY_BACK],
    ['e', mirror(POPPY_BACK)],
    ['k', circ(0, -14.5, 8, 4)],
    ['l', circ(0, -15.5, 4, 2.8)],
    ['v', 'M-2.6 -15.5L2.6 -15.5M0 -17.8L0 -13.2'],
    ['a', POPPY_FRONT],
    ['a', mirror(POPPY_FRONT)],
    ['d', 'M-3 -3C-8 -3 -13 -6 -15 -11C-11 -8 -7 -6 -3 -5Z'],
  ],
};

const ROSE: Species = {
  key: 'rose',
  name: 'роза',
  skill: true,
  stem: [2.5, 0.5, 1.5, 3.8],
  leaf: { len: 32, width: 5.6, angle: -56, compound: true },
  tone: 'deep',
  leaves: [[0.22, 1, 0.9, 0], [0.44, -1, 0.9, 0], [0.64, 1, 0.75, 0]],
  k: 1.6,
  bud: [
    ['g', 'M0 0C-4 -2 -7 -6 -7 -11C-4 -8 -2 -6 0 -5C2 -6 4 -8 7 -11C7 -6 4 -2 0 0Z'],
    ['a', 'M0 -3C-6 -6 -6 -15 0 -22C6 -15 6 -6 0 -3Z'],
    ['v', 'M-2.5 -8C-2 -12 1 -14 2.5 -10'],
  ],
  bloom: [
    ['g', ring(5, 6.5, 9, 2.4, { rot: 36, cy: -9, tip: 1 })],
    ['e', ring(5, 3, 13.5, 9, { cy: -10, tip: 0 })],
    ['d', ring(5, 2, 10.5, 7.5, { rot: 36, cy: -10, tip: 0 })],
    ['a', circ(0, -10, 7)],
    ['v', 'M-3.5 -9C-4.5 -13 1.5 -15.5 4 -12C6 -9 2.5 -5 -1 -6.5C-3.5 -8 -2.5 -11.5 0.5 -11.5C2.5 -11.5 3 -9 1 -8.5'],
  ],
};

const DANDELION_BRACT = 'M-2 -2C-6 1 -9 4 -12.5 4.5C-9.5 2 -6.5 -1 -3.5 -4Z';
const DANDELION: Species = {
  key: 'dandelion',
  name: 'одуванчик',
  skill: false,
  stem: [2, 1.2, 0, 3],
  leaf: { len: 36, width: 5.6, angle: -34, a: 0.75, p: 0.6, lobes: 5, depth: 0.7, saw: true, bend: -0.04 },
  tone: '',
  leaves: [[0.02, -1, 1, 8], [0.02, 1, 0.95, 6], [0.03, -1, 0.75, 34]],
  k: 1.4,
  bud: [
    ['g', DANDELION_BRACT],
    ['g', mirror(DANDELION_BRACT)],
    ['g', 'M0 0C-5 -2 -6 -12 -3 -18C-2 -20 2 -20 3 -18C6 -12 5 -2 0 0Z'],
    ['a', circ(0, -18.8, 2.6, 1.8)],
  ],
  bloom: [
    ['g', move(DANDELION_BRACT, 0, -3, 1.1)],
    ['g', move(mirror(DANDELION_BRACT), 0, -3, 1.1)],
    ['b', ring(28, 4, 15, 1.6, { cy: -7, tip: 0.3 })],
    ['a', ring(22, 3, 11, 1.7, { rot: 8, cy: -7, tip: 0.3 })],
    ['c', ring(14, 1.5, 6.5, 1.7, { rot: 4, cy: -7, tip: 0.3 })],
    ['c', circ(0, -7, 2.4)],
  ],
};

const IRIS_FALL = 'M-1 -9C-8 -10 -17 -7 -20 1C-22 7 -17 11 -13 7C-10 3 -5 -2 -1 -5Z';
const IRIS_STANDARD = 'M-1.5 -9C-8 -12 -13 -20 -11 -29C-5 -25 -2.5 -18 -0.5 -12Z';
const IRIS_BEARD = 'M-3 -8C-7 -7 -10 -5 -12 -2C-9 -4 -6 -6 -3 -7Z';
const IRIS: Species = {
  key: 'iris',
  name: 'ирис',
  skill: true,
  stem: [1, 0, 0, 4.2],
  leaf: { len: 60, width: 3.8, angle: -7, a: 1, p: 0.3, bend: 0.03 },
  tone: 'blue',
  leaves: [[0.01, -1, 1, 0], [0.01, 1, 0.9, 0], [0.02, -1, 0.72, -16]],
  k: 1.35,
  bud: [
    ['a', 'M0 0C-5 -6 -5 -24 0 -34C5 -24 5 -6 0 0Z'],
    ['g', 'M0 0C-6 -4 -6.5 -14 -3 -21C-1 -13 0.5 -7 2.5 -2Z'],
  ],
  bloom: [
    ['g', 'M-2 0C-2 -3 -1.5 -6 0 -9C1.5 -6 2 -3 2 0Z'],
    ['b', IRIS_STANDARD],
    ['b', mirror(IRIS_STANDARD)],
    ['b', 'M0 -8C-7 -13 -7.5 -26 0 -33C7.5 -26 7 -13 0 -8Z'],
    ['a', IRIS_FALL],
    ['a', mirror(IRIS_FALL)],
    ['a', 'M-3.5 -9C-7 -1 -7 9 0 13C7 9 7 -1 3.5 -9Z'],
    ['v', 'M-2 1L-3 8M2 1L3 8M0 2L0 10'],
    ['y', 'M-1.2 -7C-1.4 -2 -1 3 0 6C1 3 1.4 -2 1.2 -7Z'],
    ['y', IRIS_BEARD],
    ['y', mirror(IRIS_BEARD)],
  ],
};

const GERBERA: Species = {
  key: 'gerbera',
  name: 'гербера',
  skill: false,
  stem: [1.5, 2, 0, 3.4],
  leaf: { len: 32, width: 6.5, angle: -38, a: 0.7, p: 0.7, lobes: 4, depth: 0.3, stalk: 0.15 },
  tone: '',
  leaves: [[0.02, 1, 0.95, 4], [0.02, -1, 1, 4], [0.03, 1, 0.78, 30]],
  k: 1.25,
  bud: [
    ['g', ring(12, 3, 7, 2.6, { cy: -5, tip: 1, sy: 0.7 })],
    ['g', circ(0, -5, 7.5, 5)],
    ['a', ring(12, 6.5, 2.5, 1.5, { cy: -5, rot: 15, sy: 0.7 })],
  ],
  bloom: [
    ['b', ring(22, 7, 16.5, 3.1, { rot: 8.2, cy: -5, tip: 0.1 })],
    ['a', ring(22, 7, 15.5, 3, { cy: -5, tip: 0.1 })],
    ['y', ring(24, 5, 4.2, 1.1, { cy: -5, tip: 0.8 })],
    ['k', circ(0, -5, 5.6)],
    ['l', circ(0, -5, 2.4)],
  ],
};

/** A lavender spike: whorls of florets, smaller towards the top (roles: side florets, front ones, shine). */
function lavender(whorls: number, top: number, r: number, roles = 'dab'): Part[] {
  const sides: string[] = [];
  const fronts: string[] = [];
  const shines: string[] = [];
  for (let i = 0; i < whorls; i++) {
    const t = i / (whorls - 1);
    const y = -3 - t * top;
    const s = r * (1 - 0.45 * t);
    sides.push(circ(-2.7 * (s / r), y, s * 0.9, s * 0.78), circ(2.7 * (s / r), y, s * 0.9, s * 0.78));
    fronts.push(circ(0, y - s * 0.45, s * 0.82, s * 0.74));
    shines.push(circ(-s * 0.3, y - s * 0.75, s * 0.28));
  }
  return [
    ['s', `M0 0L0 ${-top - 3}`],
    [roles[0]!, sides.join('')],
    [roles[1]!, fronts.join('')],
    [roles[2]!, shines.join('')],
  ];
}

const LAVENDER: Species = {
  key: 'lavender',
  name: 'лаванда',
  skill: true,
  stem: [2, 0.2, -2, 2.6],
  leaf: { len: 25, width: 2.5, angle: -46, a: 1, p: 0.5, bend: -0.05 },
  tone: 'sage',
  leaves: [[0.12, -1, 1, 0], [0.3, 1, 1, 0], [0.5, -1, 0.9, 0]],
  k: 1.2,
  bud: lavender(6, 20, 2.6, 'edd'),
  bloom: lavender(9, 34, 4),
};

const LILY_STAMENS = [-50, -20, 20, 50, 160, 200];
const LILY: Species = {
  key: 'lily',
  name: 'лилия',
  skill: false,
  stem: [1.5, 0.4, 1, 4],
  leaf: { len: 27, width: 3.6, angle: -50, a: 0.9, p: 0.9, bend: -0.07 },
  tone: '',
  leaves: [[0.24, -1, 0.9, 0], [0.44, 1, 0.9, 0], [0.62, -1, 0.78, 0]],
  k: 1.25,
  bud: [
    ['a', 'M0 0C-3.5 -6 -4.5 -20 -2.5 -30C-1.5 -34 1.5 -34 2.5 -30C4.5 -20 3.5 -6 0 0Z'],
    ['l', 'M0 0C-3 -5 -3.8 -12 -3.4 -18C-1 -13 1 -13 3.4 -18C3.8 -12 3 -5 0 0Z'],
  ],
  bloom: [
    ['b', ring(3, 2, 23, 6.2, { rot: 60, cy: -10, tip: 0.9 })],
    ['a', ring(3, 2, 24, 6.8, { cy: -10, tip: 0.9 })],
    ['c', circ(0, -10, 5)],
    ['x', [0, 120, 240].map((a) => move(`${circ(-1.4, -8, 0.9)}${circ(1.5, -10.5, 0.8)}${circ(-0.8, -13, 0.7)}`, 0, -10, 1, a)).join('')],
    ['n', LILY_STAMENS.map((a) => move('M0 0C1 -5 1 -10 0 -14', 0, -10, 1, a)).join('')],
    ['k', LILY_STAMENS.map((a) => move(circ(0, -14.5, 1.1, 2.1), 0, -10, 1, a)).join('')],
  ],
};

const VIOLET: Species = {
  key: 'violet',
  name: 'фиалка',
  skill: true,
  stem: [5, 1.4, 2, 2.6],
  leaf: { len: 22, width: 7.5, angle: -40, a: 0.55, p: 0.9, stalk: 0.42, bend: -0.04 },
  tone: '',
  leaves: [[0.02, -1, 0.95, 20], [0.02, 1, 0.9, 16], [0.05, -1, 0.7, 42]],
  k: 1.75,
  bud: [
    ['s', 'M0 0C0 -5 3 -8 6 -7'],
    ['e', 'M6 -7C3 -6 2.5 -1 4 3C5 5 7 5 8 3C9.5 -1 9 -6 6 -7Z'],
  ],
  bloom: [
    ['e', petalsAt([-30, 30], 1, 12.5, 6.6, { cy: -8, tip: 0 })],
    ['a', petalsAt([-102, 102], 1, 10.5, 5.6, { cy: -8, tip: 0 })],
    ['a', petalsAt([180], 1, 11.5, 7.4, { cy: -8, tip: 0 })],
    ['v', 'M0 -5L0 2M-1.8 -5.3L-3.2 0.8M1.8 -5.3L3.2 0.8M-4 -8.5L-8.5 -7M4 -8.5L8.5 -7'],
    ['w', circ(0, -7.8, 2.9)],
    ['y', circ(0, -7.3, 1.4)],
  ],
};

/** Twelve species, natural and skill-coloured by turns, in the order the first levels grow them. */
export const SPECIES: readonly Species[] = [DAISY, TULIP, SUNFLOWER, BELLFLOWER, POPPY, ROSE, DANDELION, IRIS, GERBERA, LAVENDER, LILY, VIOLET];

/** A small integer hash (seeded choices that never change between renders). */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const rand = (n: number, salt: number) => hash(n * 7919 + salt) / 4294967296;

/** Steps coprime with 12 and odd: a cycle visits every species once, natural and skill by turns. */
const STEPS = [1, 5, 7, 11];

/**
 * The species a level grows (1-based level). The first twelve levels follow the curated order;
 * every later round of twelve is a seeded reshuffle (a step through the list and an offset), so
 * neighbours always differ, also across rounds, and natural and skill colours alternate.
 */
export function flowerFor(level: number): Species {
  const n = SPECIES.length;
  const i = Math.max(1, Math.floor(level) || 1) - 1;
  const round = Math.floor(i / n);
  let step = 1;
  let offset = 0;
  for (let r = 1; r <= round; r++) {
    const last = ((n - 1) * step + offset) % n;
    const h = hash(r);
    step = STEPS[h % STEPS.length]!;
    offset = (last + 1 + ((h >>> 3) % (n - 1))) % n;
  }
  return SPECIES[((i % n) * step + offset) % n]!;
}

// ---- The stem of a species ----

/** A point of a species' stem at `height` (0..1 of the level), in viewBox units. */
export function stemPoint(height: number, sp: Species = DAISY): { x: number; y: number } {
  const h = clamp(height);
  const [wave, phase, lean] = sp.stem;
  return {
    x: STEM_X + wave * (Math.sin(h * Math.PI * 1.5 + phase) - Math.sin(phase)) + lean * h,
    y: SOIL_Y - h * TRAVEL,
  };
}

interface StemGeometry {
  cumulative: number[];
  length: number;
  path: string;
  dashArray: string;
}
const stems = new Map<string, StemGeometry>();
function stemOf(sp: Species): StemGeometry {
  let g = stems.get(sp.key);
  if (!g) {
    const points = Array.from({ length: STEM_SAMPLES + 1 }, (_, i) => stemPoint(i / STEM_SAMPLES, sp));
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    const length = cumulative[STEM_SAMPLES]!;
    g = {
      cumulative,
      length,
      path: points.map((p, i) => `${i ? 'L' : 'M'}${P(p.x, p.y)}`).join(''),
      dashArray: `${length.toFixed(2)} ${(length * 2).toFixed(2)}`,
    };
    stems.set(sp.key, g);
  }
  return g;
}

export const STEM_LENGTH = stemOf(DAISY).length;
/** The round cap of a hidden stem would still show as a dot: an empty stem ends this far before its start. */
const STEM_CAP = 3;

/** stroke-dashoffset that shows the stem up to `fill`: beyond the full length hides it, 0 draws it all. */
export function stemDash(fill: number, sp: Species = DAISY): number {
  const { cumulative, length } = stemOf(sp);
  const f = clamp(fill);
  const h = f * STEM_SAMPLES;
  const i = Math.min(STEM_SAMPLES - 1, Math.floor(h));
  const drawn = cumulative[i]! + (h - i) * (cumulative[i + 1]! - cumulative[i]!);
  return Math.max(0, length - drawn) + STEM_CAP * (1 - f);
}

// ---- Growth stages (the same for every species) ----

/** Leaves unfold at a quarter, a half and three quarters (where and how is the species' own). */
export const LEAVES: readonly { at: number; side: -1 | 1 }[] = [
  { at: 0.25, side: -1 },
  { at: 0.5, side: 1 },
  { at: 0.75, side: -1 },
];
/** Everything that unfolds on the stem: a pair of seedling leaves low down, then the three leaves. */
export const FOLIAGE: readonly { at: number; side: -1 | 0 | 1 }[] = [{ at: 0.1, side: 0 }, ...LEAVES];
/** Seedling leaves are this size of a true leaf. */
const SEEDLING_SIZE = 0.5;
const SEEDLING = 'M0 0C-7 3 -19 -1 -26 -15C-17 -16 -6 -11 0 0Z';
/** A leaf starts to unfold this much before its height and is out this much after it. */
const LEAF_BEFORE = 0.03;
const LEAF_AFTER = 0.04;
const BUD_FROM = 0.85;
const BUD_TO = 0.95;
const SEED_GONE = 0.08;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const inverseEaseOutCubic = (p: number) => 1 - Math.cbrt(1 - p);

/** Scale of a leaf (0..1) at `fill`: nothing below its height, fully out a little above it. */
export function leafScale(fill: number, at: number): number {
  return easeOutCubic(clamp((clamp(fill) - (at - LEAF_BEFORE)) / (LEAF_BEFORE + LEAF_AFTER)));
}

/** Scale of the bud (0..1): it forms between 85 % and 95 %. */
export function budScale(fill: number): number {
  return easeOutCubic(clamp((clamp(fill) - BUD_FROM) / (BUD_TO - BUD_FROM)));
}

/** Opacity of the glow behind the flower head: it gathers with the bud. */
export function glowOpacity(fill: number): number {
  return 0.4 * budScale(fill);
}

/** Opacity of the seed on the soil: it is gone once the sprout is out. */
export function seedOpacity(fill: number): number {
  return 1 - clamp(clamp(fill) / SEED_GONE);
}

export type FlowerStage = 'seed' | 'sprout' | 'leaf1' | 'leaf2' | 'leaf3' | 'bud' | 'bloom';

/** The stage the picture reads as, for tests and captions. */
export function stage(fill: number): FlowerStage {
  const f = clamp(fill);
  if (f >= 1) return 'bloom';
  if (f >= BUD_FROM) return 'bud';
  if (f >= LEAVES[2]!.at) return 'leaf3';
  if (f >= LEAVES[1]!.at) return 'leaf2';
  if (f >= LEAVES[0]!.at) return 'leaf1';
  if (f > 0) return 'sprout';
  return 'seed';
}

// ---- The garden: the flowers of past levels ----

export interface GardenSlot {
  /** Where the flower stands (the foot of its stem), viewBox units. */
  x: number;
  y: number;
  /** Stem height and bloom scale (1 = the size of the bloom on the pot). */
  h: number;
  b: number;
  /** 0 the front row beside the pot, 1 the middle row, 2 the back row, 3 the far meadow. */
  row: 0 | 1 | 2 | 3;
}

/** The first 24 flowers stand in three rows (x, foot y, stem height); later ones join the meadow. */
const SLOTS: [number, number, number][] = [
  // Front row, beside the pot.
  [33, 251, 36],
  [127, 251, 38],
  [21, 254, 30],
  [139, 254, 31],
  [12, 251, 37],
  [149, 251, 36],
  // Middle row: behind the pot, the blooms look over its rim.
  [53, 224, 31],
  [107, 224, 30],
  [41, 227, 27],
  [120, 227, 28],
  [65, 222, 30],
  [95, 222, 30],
  [14, 234, 28],
  [146, 234, 28],
  // Back row.
  [47, 211, 25],
  [113, 211, 25],
  [31, 213, 24],
  [129, 213, 24],
  [59, 209, 23],
  [101, 209, 23],
  [17, 216, 22],
  [143, 216, 22],
  [7, 213, 20],
  [153, 213, 20],
];
export const GARDEN_ROWS = [6, 14, 24] as const;
const ROW_BLOOM = [0.34, 0.28, 0.23];
/** The far meadow: tiny blooms on the hill behind the fence (its crest, y by x). */
const hillTop = (x: number) => 171 + 13 * ((x - 80) / 80) ** 2;

/** Where the flower of level `index + 1` stands in the garden: fixed by its index, never moved. */
export function gardenSlot(index: number): GardenSlot {
  const i = Math.max(0, Math.floor(index) || 0);
  const slot = SLOTS[i];
  if (slot) {
    const row = i < GARDEN_ROWS[0] ? 0 : i < GARDEN_ROWS[1] ? 1 : 2;
    return { x: slot[0], y: slot[1], h: slot[2], b: ROW_BLOOM[row]!, row };
  }
  // The meadow spreads from the middle outwards and keeps getting denser; nearer blooms are bigger.
  const x = 80 + (rand(i, 1) - 0.5) * 150 * Math.min(1, 0.45 + i / 120);
  const depth = rand(i, 2);
  return { x: r1(x), y: r1(hillTop(x) + 3 + depth * 14), h: 0, b: r1(66 + depth * 40) / 1000, row: 3 };
}

/** What the garden of `count` flowers has: its rows, meadow and furniture. */
export function gardenDecor(count: number): { rows: number; meadow: number; border: boolean; fence: boolean; can: boolean; butterfly: boolean } {
  const n = Math.max(0, Math.floor(count) || 0);
  return {
    rows: GARDEN_ROWS.filter((_, r) => n > (r ? GARDEN_ROWS[r - 1]! : 0)).length,
    meadow: Math.max(0, n - SLOTS.length),
    border: n >= 4,
    fence: n >= 8,
    can: n >= 20,
    butterfly: n >= 3,
  };
}

// ---- Choreography timings (the flask's state machine, the flower's clock) ----

export interface FlowerTiming {
  /** Pause before the phase, ms. */
  delay: number;
  duration: number;
  easing: 'spring' | 'in' | 'out';
}

/**
 * One level takes 1.1 s: grow 200 → bloom 300 → transplant 320 → seed 60 + sprout 220.
 * Repeats: transplant 240 → seed 60 + sprout 200 → quick bloom 160.
 */
export function flowerTiming(state: AnimationState): FlowerTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 200, easing: 'out' };
    case 'overflow':
      return { delay: 0, duration: 300, easing: 'spring' };
    case 'draining':
      return { delay: 0, duration: compressed ? 240 : 320, easing: 'in' };
    case 'refilling':
      return { delay: 0, duration: compressed ? 200 : 220, easing: 'out' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

/** A leaf or the bud pops out over this long while the stem grows past it (within the grow). */
export const POP_MS = 120;
/** The seed appears this long before a sprout. */
export const SEED_MS = 60;
/** The quick bloom at the top of a compressed refill (more levels follow). */
export const QUICK_BLOOM_MS = 160;

/** When a leaf at `share` (0..1 of a grow's way) pops, so that the pop ends with the grow. */
export function popDelay(share: number, duration: number): number {
  const pop = Math.min(POP_MS, duration);
  return Math.round(Math.min(duration - pop, Math.max(0, inverseEaseOutCubic(clamp(share)) * duration)));
}

/** How long a phase takes on screen, ms: its pause and duration, plus the seed and the quick bloom around a sprout. */
export function phaseSpan(state: AnimationState, target: number): number {
  const timing = flowerTiming(state);
  if (state.phase !== 'refilling') return timing.delay + timing.duration;
  return timing.delay + SEED_MS + timing.duration + (target >= 1 ? QUICK_BLOOM_MS : 0);
}

// ---- Text ----

const text: ProgressThemeText = {
  name: 'Цветок',
  levelNoun: 'Цветок',
  levelGenitive: 'цветка',
  levelForms: ['цветок', 'цветка', 'цветков'],
  levelFormsOf: ['цветка', 'цветков', 'цветков'],
  completed: (n) => `Цветок ${n} распустился`,
  fillLabel: (p) => `Цветок вырос на ${p}%`,
  hint: 'Из зёрнышка растёт цветок',
};

// ---- Marks: pennants in a column right of the leaves, a leader to the stem, a caption ----

const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const CAPTION_GAP = 18;
/** The pennants' poles stand here, clear of every species' leaves (a test checks it). */
export const POLE_X = 116;
const CAPTION_X = 128;
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;
/** Pennants stay between the garden (its blooms reach up to y 176) and the flower head. */
const MARK_LOWEST = 174;
const MARK_HIGHEST = TIP_Y + 18;

function markPoint(height: number): { x: number; y: number } {
  return { x: POLE_X, y: Math.min(MARK_LOWEST, Math.max(MARK_HIGHEST, SOIL_Y - clamp(height) * TRAVEL)) };
}

function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Pennant and caption y positions, top to bottom, at least `gap` apart and inside the box. */
function spreadYs(ys: number[], gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => o.y);
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + gap);
  if (placed.length && placed[placed.length - 1]! > MARK_LOWEST) {
    placed[placed.length - 1] = MARK_LOWEST;
    for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k]!, placed[k + 1]! - gap);
  }
  const out = Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]!));
  return out;
}

/** Vertical padding of caption `i` in px: towards a 44 px tap area, never over a neighbour. */
function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) - CAPTION_LINE : CAPTION_PAD_MAX;
  return Math.round(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

// ---- Drawing ----

const POT = 'M48 214 L55 248 Q80 253 105 248 L112 214 Z';
const POT_SHINE = 'M56 219 L61 245 Q63.5 245.6 66 245.8 L62.5 219 Z';

const leafCache = new Map<string, [string, string]>();
function leafOf(sp: Species): [string, string] {
  let leaf = leafCache.get(sp.key);
  if (!leaf) leafCache.set(sp.key, (leaf = leafShape(sp.leaf)));
  return leaf;
}

const translate = (p: { x: number; y: number }) => `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)`;
const budTransform = (fill: number, sp: Species, scale = budScale(fill)) => `${translate(stemPoint(fill, sp))} scale(${(scale * sp.k).toFixed(3)})`;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Awaits a phase's animations or its planned time, whichever comes first: the choreography keeps
 * the planned clock (`finished` resolves a frame late, and never in some old WebViews).
 */
function settle(animations: (Animation | null)[], duration: number): Promise<unknown> {
  return Promise.race([Promise.all(animations.map((a) => a?.finished.catch(() => undefined))), wait(duration)]);
}

let cachedEasing: Record<FlowerTiming['easing'], string> | null = null;
function easings(): Record<FlowerTiming['easing'], string> {
  if (cachedEasing) return cachedEasing;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  cachedEasing = {
    spring: read('--ease-spring', 'cubic-bezier(0.34, 1.56, 0.64, 1)'),
    in: read('--ease-in', 'cubic-bezier(0.7, 0, 0.84, 0)'),
    out: read('--ease-out', 'cubic-bezier(0.2, 0.8, 0.2, 1)'),
  };
  return cachedEasing;
}

function animate(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    // An easing the engine does not parse: plain ease-out keeps the choreography going.
    try {
      return el.animate(keyframes, { ...options, easing: 'ease-out' });
    } catch {
      return null;
    }
  }
}

const spClass = (sp: Species) => `fsp fsp-${sp.key}${sp.skill ? ' fsp--skill' : ''}${sp.tone ? ` fsp--${sp.tone}` : ''}`;

function Parts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map(([role, d], i) => (
        <path key={i} d={d} className={`fl-${role}`} />
      ))}
    </>
  );
}

/**
 * A small plant with its foot at 0 0: the species' stem `h` tall, its first two leaves, a bud or
 * the open bloom (`bloom` = its scale). The garden draws every past flower with it, the mini its
 * current one (`fill` < 1 grows it like the hero, without the choreography).
 */
function SmallPlant({ sp, h, bloom, leaf, stem, fill = 1, open = true, seedling = false }: { sp: Species; h: number; bloom: number; leaf: number; stem: number; fill?: number; open?: boolean; seedling?: boolean }) {
  const f = clamp(fill);
  const at = (t: number): Pt => {
    const p = stemPoint(t, sp);
    return [((p.x - STEM_X) * h) / 70, -t * h];
  };
  const points = Array.from({ length: 7 }, (_, i) => at((i / 6) * f));
  const [shape] = leafOf(sp);
  const tip = at(f);
  const bud = open ? 0 : budScale(f);
  return (
    <g className={spClass(sp)}>
      {f > 0 && <path d={points.map((p, i) => `${i ? 'L' : 'M'}${P(...p)}`).join('')} className="flower-stem" style={{ strokeWidth: stem * (sp.stem[3] / 3.6) }} />}
      {seedling &&
        [1, -1].map((side) => {
          const k = leafScale(f, FOLIAGE[0]!.at) * leaf * SEEDLING_SIZE;
          return k > 0 && <path key={side} d={SEEDLING} className="flower-leaf" transform={`translate(${P(...at(0.1))}) scale(${(side * k).toFixed(3)} ${k.toFixed(3)})`} />;
        })}
      {sp.leaves.slice(0, 2).map(([pos, side, size, turn], i) => {
        const k = leafScale(f, LEAVES[i]!.at) * leaf * size;
        return k > 0 && <path key={i} d={shape} className="flower-leaf" transform={`translate(${P(...at(pos))}) scale(${(-side * k).toFixed(3)} ${k.toFixed(3)}) rotate(${turn})`} />;
      })}
      {bud > 0 && (
        <g transform={`translate(${P(...tip)}) scale(${(bud * bloom * sp.k).toFixed(3)})`}>
          <Parts parts={sp.bud} />
        </g>
      )}
      {open && (
        <g transform={`translate(${P(...tip)}) scale(${(bloom * sp.k).toFixed(3)})`}>
          <Parts parts={sp.bloom} />
        </g>
      )}
    </g>
  );
}

/** The flowers of a garden row (static, with `arriving` ones hidden until they fade in). */
function Row({ from, to, count, arriving }: { from: number; to: number; count: number; arriving: number }) {
  const flowers = [];
  for (let i = from; i < Math.min(to, count); i++) {
    const slot = gardenSlot(i);
    const sp = flowerFor(i + 1);
    const hidden = i >= count - arriving;
    flowers.push(
      // An arriving flower is keyed apart, so the settled one is a fresh element without a style.
      <g key={hidden ? -1 - i : i} transform={`translate(${slot.x} ${slot.y})`} data-arriving={hidden ? i : undefined} style={hidden ? { opacity: 0 } : undefined}>
        <SmallPlant sp={sp} h={slot.h} bloom={slot.b} leaf={0.36 + slot.b * 0.4} stem={1.5} />
      </g>,
    );
  }
  return <>{flowers}</>;
}

/** The meadow: tiny blooms grouped by species (one path each); arriving ones apart, to fade in. */
function Meadow({ count, arriving }: { count: number; arriving: number }) {
  const settled = new Map<Species, string[]>();
  const fresh = [];
  for (let i = SLOTS.length; i < count; i++) {
    const slot = gardenSlot(i);
    const sp = flowerFor(i + 1);
    const dot = circ(slot.x, slot.y, 26 * slot.b);
    if (i >= count - arriving) {
      fresh.push(<path key={i} d={dot} className={`${spClass(sp)} fl-a flower-meadow-dot`} data-arriving={i} style={{ opacity: 0 }} />);
    } else {
      settled.set(sp, [...(settled.get(sp) ?? []), dot]);
    }
  }
  return (
    <g className="flower-meadow">
      {[...settled].map(([sp, dots]) => (
        <path key={sp.key} d={dots.join('')} className={`${spClass(sp)} fl-a flower-meadow-dot`} />
      ))}
      {fresh}
    </g>
  );
}

const FENCE = Array.from({ length: 18 }, (_, i) => {
  const x = 2 + i * 9.2;
  return `M${P(x - 1.6, 206)}L${P(x - 1.6, 195)}L${P(x, 193)}L${P(x + 1.6, 195)}L${P(x + 1.6, 206)}Z`;
}).join('');
/** The low stone border between the front bed and the rows behind, beside the pot. */
const BORDER = [4, 12, 20, 28, 36, 124, 132, 140, 148, 156].map((x, i) => circ(x, 238 + (i % 2) * 0.6, 4.2, 2.3)).join('');

/** A soft lawn (a radial fade, no hard edges) under the garden, wider as the garden grows. */
function Lawn({ id, cx, cy, rx, ry, className }: { id: string; cx: number; cy: number; rx: number; ry: number; className: string }) {
  return (
    <>
      <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={rx} gradientTransform={`translate(0 ${cy}) scale(1 ${r1((ry / rx) * 100) / 100}) translate(0 ${-cy})`}>
        <stop offset="0.45" className={className} />
        <stop offset="1" className={className} style={{ stopOpacity: 0 }} />
      </radialGradient>
      <rect x="0" y={cy - ry} width="160" height={ry * 2} fill={`url(#${id})`} />
    </>
  );
}

/**
 * Furniture that comes with the newest flowers waits hidden and fades in with them (see the
 * transplant); once settled it is drawn without the wrapper, exactly as a fresh render draws it.
 */
function Arrive({ when, children }: { when: boolean; children: ReactNode }) {
  return when ? (
    <g key="arriving" data-arriving="-1" style={{ opacity: 0 }}>
      {children}
    </g>
  ) : (
    <Fragment key="settled">{children}</Fragment>
  );
}

/** The garden behind the pot: the lawns, the meadow, the fence, the back and middle rows (memoised: it changes only with the garden). */
const GardenBack = memo(function GardenBack({ id, count, arriving }: { id: string; count: number; arriving: number }) {
  const decor = gardenDecor(count);
  const before = gardenDecor(count - arriving);
  return (
    <g className="flower-garden" aria-hidden="true">
      {decor.meadow > 0 && (
        <Arrive when={!before.meadow}>
          <Lawn id={`${id}f`} cx={80} cy={190} rx={82} ry={22} className="flower-grass-far" />
        </Arrive>
      )}
      {decor.meadow > 0 && <Meadow count={count} arriving={arriving} />}
      {decor.fence && (
        <Arrive when={!before.fence}>
          <path d={`${FENCE}M0 198H160V199.6H0ZM0 202.5H160V204.1H0Z`} className="flower-fence" />
        </Arrive>
      )}
      <Lawn id={`${id}g`} cx={80} cy={230} rx={64 + 18 * Math.min(1, count / 6)} ry={30} className="flower-grass" />
      <g className="flower-row flower-row--2">
        <Row from={GARDEN_ROWS[1]} to={GARDEN_ROWS[2]} count={count} arriving={arriving} />
      </g>
      <g className="flower-row flower-row--1">
        <Row from={GARDEN_ROWS[0]} to={GARDEN_ROWS[1]} count={count} arriving={arriving} />
      </g>
      {decor.border && (
        <Arrive when={!before.border}>
          <path d={BORDER} className="flower-stone" />
        </Arrive>
      )}
    </g>
  );
});

/** The garden in front: the front row beside the pot and the watering can. */
const GardenFront = memo(function GardenFront({ count, arriving }: { count: number; arriving: number }) {
  return (
    <g className="flower-garden" aria-hidden="true">
      <g className="flower-row flower-row--0">
        <Row from={0} to={GARDEN_ROWS[0]} count={count} arriving={arriving} />
      </g>
      {gardenDecor(count).can && (
        <Arrive when={!gardenDecor(count - arriving).can}>
          <g className="flower-can" transform="translate(128 238)">
            <path d="M3 5H19L18 20Q11 21.5 4 20Z" className="flower-can-body" />
            <path d="M18.5 9L28 1.5L29.5 3L19 13Z" className="flower-can-body" />
            <path d="M26.5 -0.5L31 -2.5L32.5 3.5L28.5 4Z" className="flower-can-rose" />
            <path d="M5 5C5 -3 17 -3 17 5" className="flower-can-handle" />
            <path d="M5.5 8H8L7.5 17H5.8Z" className="flower-can-shine" />
          </g>
        </Arrive>
      )}
    </g>
  );
});

/** A butterfly drifting over the garden, resting on the first flower now and then. */
function Butterfly({ still }: { still: boolean }) {
  const slot = gardenSlot(0);
  return (
    <g className="flower-garden" transform={`translate(${slot.x + 1} ${slot.y - slot.h - 12})`} aria-hidden="true">
      <g className={still ? 'flower-butterfly' : 'flower-butterfly anim-decor'}>
        <g className={still ? 'flower-wings' : 'flower-wings anim-decor'}>
          <path d="M0 0C-3 -6 -9 -8 -9.5 -3.5C-10 0 -5 1.5 0 0ZM0 0.5C-3 1.5 -7 4 -5.5 6.5C-4 8 -1 4.5 0 0.5Z" className="flower-wing" />
          <path d="M0 0C3 -6 9 -8 9.5 -3.5C10 0 5 1.5 0 0ZM0 0.5C3 1.5 7 4 5.5 6.5C4 8 1 4.5 0 0.5Z" className="flower-wing" />
        </g>
        <path d="M-0.8 -3.5Q0 -5 0.8 -3.5L0.6 4Q0 5 -0.6 4Z" className="flower-butterfly-body" />
      </g>
    </g>
  );
}

// ---- The hero ----

/** What the hero shows: the current plant's fill and level, the garden's size and newest arrivals. */
interface View {
  fill: number;
  level: number;
  garden: number;
  arriving: number;
  /** Bumped on every transplant so the pot starts with fresh elements. */
  gen: number;
}

function Hero({ fill, capacity, state = 'active', level, motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  // useId() may contain characters that break url(#id) references.
  const id = `flower-lawn${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const current = Math.max(1, Math.floor(level ?? 1) || 1);

  const [override, setOverride] = useState<View | null>(null);
  const [scripted, setScripted] = useState(false);
  const playing = useRef(false);
  const playToken = useRef(0);
  const view: View = override ?? { fill: target, level: current, garden: current - 1, arriving: 0, gen: 0 };
  const props = useRef({ current, given: level !== undefined });
  props.current = { current, given: level !== undefined };

  const svgRef = useRef<SVGSVGElement>(null);
  const plantRef = useRef<SVGGElement>(null);
  const stemRef = useRef<SVGPathElement>(null);
  const leafRefs = useRef<(SVGGElement | null)[]>([]);
  const budRef = useRef<SVGGElement>(null);
  const seedRef = useRef<SVGGElement>(null);
  const bloomRef = useRef<SVGGElement>(null);
  const petalsRef = useRef<SVGGElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(installPauseWhenHidden, []);

  // Prop-driven changes: CSS transitions do the work; a new level (outside a level-up) fades in,
  // and every change is a crossfade under reduced motion.
  // A level-up that follows cancels the fade (the app renders the new level first, then plays).
  const previous = useRef({ target, current });
  const fade = useRef<Animation | null>(null);
  useEffect(() => {
    const from = previous.current;
    previous.current = { target, current };
    if (playing.current || (from.target === target && from.current === current)) return;
    setOverride(null);
    if (motion === 'reduced' || from.current !== current)
      fade.current = animate(svgRef.current, [{ opacity: 0.35 }, { opacity: 1 }], {
        duration: 240,
        easing: 'ease-out',
      });
  }, [target, current, motion]);

  // The golden bloom opens when the skill becomes completed on screen (never on first load).
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete') return;
    if (motion === 'reduced') {
      animate(bloomRef.current, [{ opacity: 0 }, { opacity: 1 }], {
        duration: 240,
        easing: 'ease-out',
      });
      return;
    }
    animate(petalsRef.current, [{ transform: 'scale(0.15) rotate(-30deg)' }, { transform: 'scale(1) rotate(0deg)' }], { duration: 600, easing: easings().spring });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        if (!stemRef.current || typeof stemRef.current.animate !== 'function') {
          onOverflow?.();
          return;
        }
        playing.current = true;
        fade.current?.cancel();
        const running: Animation[] = [];
        const track = (a: Animation | null): Animation | null => {
          if (a) running.push(a);
          return a;
        };
        // The app renders the new level with the new fill first, then plays: the flower being
        // completed is the one of level `level − levels`, with the garden as it was before it.
        const count = Math.max(1, Math.floor(levels) || 1);
        const { current: last, given } = props.current;
        const first = given ? Math.max(1, last - count) : 1;
        const cycles = Math.min(count, MAX_CYCLES);
        /** The level whose plant cycle `c` transplants (the last cycle jumps to the last level completed). */
        const completedIn = (c: number) => (!given ? 1 : c < cycles - 1 ? first + c : last - 1);
        let shown: View = { fill: clamp(fromFill), level: first, garden: first - 1, arriving: 0, gen: 0 };
        const show = (next: View) => {
          shown = next;
          flushSync(() => setOverride(next));
        };
        flushSync(() => {
          setScripted(true);
          // Under reduced motion the props' own state stays: only a crossfade follows.
          setOverride(motion === 'reduced' ? null : shown);
        });

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            const crossfade = track(
              animate(svgRef.current, [{ opacity: 0.2 }, { opacity: 1 }], {
                duration: 240,
                easing: 'ease-out',
              }),
            );
            await settle([crossfade], 240);
            return;
          }
          const ease = easings();

          /** The stem grows from the shown fill to `to`; leaves and the bud pop as the tip passes them. */
          const grow = async (to: number, timing: FlowerTiming) => {
            const sp = flowerFor(shown.level);
            const from = shown.fill;
            const steps = 12;
            const at = (i: number) => from + (to - from) * easeOutCubic(i / steps);
            const frames = Array.from({ length: steps + 1 }, (_, i) => i);
            const options = { duration: timing.duration, easing: 'linear', fill: 'forwards' } as const;
            const layers: (Animation | null)[] = [
              track(animate(stemRef.current, frames.map((i) => ({ offset: i / steps, strokeDashoffset: `${stemDash(at(i), sp).toFixed(2)}px` })), options)),
              track(animate(budRef.current, frames.map((i) => ({ offset: i / steps, transform: budTransform(at(i), sp) })), options)),
            ];
            if (seedOpacity(from) > 0) {
              layers.push(
                track(
                  animate(seedRef.current, [{ opacity: seedOpacity(from) }, { opacity: seedOpacity(to) }], {
                    duration: Math.round(timing.duration * 0.3),
                    easing: 'ease-out',
                    fill: 'forwards',
                  }),
                ),
              );
            }
            FOLIAGE.forEach((leaf, i) => {
              const before = leafScale(from, leaf.at);
              const after = leafScale(to, leaf.at);
              if (after <= before) return;
              const share = to > from ? (leaf.at - LEAF_BEFORE - from) / (to - from) : 0;
              const delay = popDelay(share, timing.duration);
              const duration = Math.min(POP_MS, timing.duration);
              layers.push(
                track(
                  animate(leafRefs.current[i], [{ transform: `scale(${before.toFixed(3)})` }, { transform: `scale(${after.toFixed(3)})` }], { duration, delay, easing: ease.spring, fill: 'forwards' }),
                ),
              );
            });
            shown = { ...shown, fill: to };
            await settle(layers, timing.duration);
          };

          /** The bud gives way to the species' bloom, which opens with a spring; the glow pulses. */
          const bloom = async (duration: number) => {
            const sp = flowerFor(shown.level);
            const tip = translate(stemPoint(1, sp));
            const layers: (Animation | null)[] = [
              track(
                animate(budRef.current, [{ transform: budTransform(1, sp) }, { transform: budTransform(1, sp, 0) }], {
                  duration: Math.min(160, duration),
                  easing: 'ease-in',
                  fill: 'forwards',
                }),
              ),
              track(
                animate(
                  bloomRef.current,
                  [
                    { opacity: 0, transform: tip },
                    { opacity: 1, transform: tip },
                  ],
                  { duration: Math.min(120, duration), easing: 'ease-out', fill: 'forwards' },
                ),
              ),
              track(animate(petalsRef.current, [{ transform: 'scale(0.12) rotate(-30deg)' }, { transform: 'scale(1) rotate(0deg)' }], { duration, easing: ease.spring, fill: 'forwards' })),
              track(
                animate(
                  glowRef.current,
                  [
                    { opacity: glowOpacity(1), transform: 'scale(0.8)' },
                    { opacity: 1, transform: 'scale(1.15)', offset: 0.5 },
                    { opacity: 0.6, transform: 'scale(1)' },
                  ],
                  { duration, easing: 'ease-in-out', fill: 'forwards' },
                ),
              ),
            ];
            await settle(layers, duration);
          };

          /**
           * The whole plant is lifted out of the pot and set into its garden slot, shrinking on the
           * way; it hands over to the garden's flower there (a short crossfade), and the skipped
           * flowers of a long jump fade in with it. Then the pot holds the next species' seed.
           */
          const transplant = async (c: number, timing: FlowerTiming) => {
            const sp = flowerFor(shown.level);
            const completed = completedIn(c);
            const garden = given ? completed : 0;
            const slot = gardenSlot(Math.max(0, completed - 1));
            show({ ...shown, garden, arriving: garden - shown.garden });
            const d = timing.duration;
            const base = `translate(${STEM_X}px, ${SOIL_Y}px)`;
            const back = `translate(${-STEM_X}px, ${-SOIL_Y}px)`;
            const s = slot.row === 3 ? 0.06 : slot.h / TRAVEL;
            const lift = { x: STEM_X + (slot.x - STEM_X) * 0.3, y: SOIL_Y - 16 + (slot.y - SOIL_Y) * 0.3 };
            const tip = translate(stemPoint(1, sp));
            const grown = (slot.row === 3 ? 1 : slot.b / s).toFixed(3);
            const layers: (Animation | null)[] = [
              track(
                animate(
                  plantRef.current,
                  [
                    { transform: `${base} scale(1) ${back}`, opacity: 1 },
                    { transform: `translate(${lift.x.toFixed(1)}px, ${lift.y.toFixed(1)}px) scale(${(0.35 + s * 0.65).toFixed(3)}) ${back}`, opacity: 1, offset: 0.4 },
                    { transform: `translate(${slot.x}px, ${slot.y}px) scale(${s.toFixed(3)}) ${back}`, opacity: 1, offset: 0.7 },
                    { transform: `translate(${slot.x}px, ${slot.y}px) scale(${s.toFixed(3)}) ${back}`, opacity: 0 },
                  ],
                  { duration: d, easing: 'ease-in-out', fill: 'forwards' },
                ),
              ),
              // The bloom grows relative to the shrinking plant: garden blooms are big for their stems.
              track(
                animate(bloomRef.current, [{ transform: `${tip} scale(1)` }, { transform: `${tip} scale(${grown})`, offset: 0.7 }, { transform: `${tip} scale(${grown})` }], {
                  duration: d,
                  easing: 'ease-in-out',
                  fill: 'forwards',
                }),
              ),
              track(animate(glowRef.current, [{ opacity: 0.6 }, { opacity: 0 }], { duration: d * 0.5, easing: 'ease-out', fill: 'forwards' })),
            ];
            // The transplanted flower takes over at the end; skipped ones (a long jump) fade in on the way.
            const arrivals = Array.from(svgRef.current?.querySelectorAll('[data-arriving]') ?? []);
            arrivals.forEach((el, i) => {
              const index = Number(el.getAttribute('data-arriving'));
              const own = index === completed - 1 || index < 0;
              layers.push(
                track(
                  animate(el, [{ opacity: 0 }, { opacity: 1 }], {
                    duration: own ? d * 0.35 : d * 0.8,
                    delay: own ? d * 0.6 : (d * 0.2 * i) / arrivals.length,
                    easing: 'ease-out',
                    fill: 'forwards',
                  }),
                ),
              );
            });
            await settle(layers, d);
            if (aborted()) return;
            show({ fill: 0, level: c < cycles - 1 ? completedIn(c + 1) : given ? last : 1, garden, arriving: 0, gen: shown.gen + 1 });
          };

          const sprout = async (to: number, timing: FlowerTiming) => {
            const seed = track(animate(seedRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: SEED_MS, easing: 'ease-out', fill: 'forwards' }));
            await settle([seed], SEED_MS);
            if (aborted()) return;
            await grow(to, timing);
            // More levels follow: a quick bloom before this plant is transplanted too.
            if (to >= 1 && !aborted()) await bloom(QUICK_BLOOM_MS);
          };

          let phase = nextPhase(IDLE, { type: 'start', levels: count });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = flowerTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await grow(1, timing);
                break;
              case 'overflow':
                onOverflow?.();
                await bloom(timing.duration);
                break;
              case 'draining':
                await transplant(phase.cycle, timing);
                break;
              case 'refilling':
                await sprout(refillTarget(phase, clamp(toFill)), timing);
                break;
            }
            phase = nextPhase(phase, { type: DONE_EVENT[phase.phase] } as Parameters<typeof nextPhase>[1]);
          }
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            // The end state is the props' own: the level and fill the app rendered before.
            flushSync(() => setOverride(null));
            running.forEach((a) => a.cancel());
            playing.current = false;
            requestAnimationFrame(() => setScripted(false));
          }
        }
      },
    }),
    [motion],
  );

  const sp = flowerFor(view.level);
  const stem = stemOf(sp);
  const [leafPath, veinPath] = leafOf(sp);
  const shownMarks = marks ?? [];
  const reserved = useRef(false);
  reserved.current = scripted ? reserved.current || shownMarks.length > 0 : shownMarks.length > 0;
  const marked = reserved.current;
  const markYs = spreadYs(
    shownMarks.map((m) => markPoint(m.height).y),
    Math.min(CAPTION_GAP, shownMarks.length > 1 ? (MARK_LOWEST - MARK_HIGHEST) / (shownMarks.length - 1) : CAPTION_GAP),
  );
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const captionY = markYs.slice(-MARK_CAPTIONS);
  const tip = stemPoint(1, sp);
  const open = state === 'complete' || view.fill >= 1;
  const budS = open ? 0 : budScale(view.fill);
  const still = motion === 'reduced';

  const classes = ['flower', 'flower--hero', `flower--${state}`, marked ? 'flower--marked' : '', scripted ? 'flower--scripted' : ''].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
      <div className="flower-glow" ref={glowRef} style={{ opacity: state === 'complete' ? 0.9 : glowOpacity(view.fill) }} aria-hidden="true" />
      <svg ref={svgRef} className="flower-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label ?? text.fillLabel(Math.floor(view.fill * 100))}>
        {view.garden > 0 && <GardenBack id={id} count={view.garden} arriving={view.arriving} />}
        {(capacity !== undefined ? scaleTicks(capacity) : []).map(({ share, value }) => {
          const y = SOIL_Y - share * TRAVEL;
          return (
            <g key={share} className="flower-tick">
              <line x1="34" x2="41" y1={y} y2={y} />
              <text x="30" y={y} dominantBaseline="central" textAnchor="end">
                {formatNumber(value)}
              </text>
            </g>
          );
        })}
        <path d={POT} className="flower-pot" />
        <path d={POT_SHINE} className="flower-pot-shine" />
        <rect x="42" y="202" width="76" height="14" rx="4" className="flower-pot-rim" />
        <ellipse cx="80" cy="208" rx="32" ry="4" className="flower-soil" />
        {view.garden > 0 && <GardenFront count={view.garden} arriving={view.arriving} />}
        {gardenDecor(view.garden).butterfly && (
          <Arrive when={!gardenDecor(view.garden - view.arriving).butterfly}>
            <Butterfly still={still} />
          </Arrive>
        )}
        {shownMarks.map((mark, i) => {
          const s = stemPoint(Math.min(1, Math.max(0, mark.height)), sp);
          const y = markYs[i]!;
          return (
            // Pointer only: the captions are the accessible way in, and so is the list.
            <g key={mark.id} className="flower-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              <rect x={POLE_X - 10} y={y - 15} width={30} height={22} className="flower-mark-hit" />
              <path d={`M${P(s.x, Math.min(SOIL_Y - 2, s.y))}L${P(POLE_X, y)}`} className="flower-mark-tick" />
              <line x1={POLE_X} x2={POLE_X} y1={y + 1} y2={y - 12} className="flower-mark-pole" />
              <path d={`M${POLE_X} ${y - 12}L${POLE_X + 9} ${y - 8.5}L${POLE_X} ${y - 5}Z`} className="flower-mark-flag" />
            </g>
          );
        })}
        <g key={`${view.level}.${view.gen}`} ref={plantRef} className={`flower-plant ${spClass(sp)}`}>
          <path ref={stemRef} d={stem.path} className="flower-stem" strokeDasharray={stem.dashArray} style={{ strokeDashoffset: `${stemDash(view.fill, sp).toFixed(2)}px`, strokeWidth: sp.stem[3] }} />
          {FOLIAGE.map((leaf, i) => {
            const spec = i ? sp.leaves[i - 1]! : null;
            const p = stemPoint(spec ? spec[0] : leaf.at, sp);
            const side = spec ? spec[1] : 0;
            return (
              <g key={leaf.at} style={{ transform: `${translate(p)} scale(${side ? -side : 1}, 1)${spec ? ` scale(${spec[2]}) rotate(${spec[3]}deg)` : ''}` }}>
                <g
                  ref={(el) => {
                    leafRefs.current[i] = el;
                  }}
                  className="flower-leaf-grow"
                  style={{ transform: `scale(${leafScale(view.fill, leaf.at).toFixed(3)})` }}
                >
                  {spec ? (
                    // The lowest true leaf sways a little while idle.
                    <g className={i === 1 && !still ? 'flower-leaf-sway anim-decor' : 'flower-leaf-sway'}>
                      <path d={leafPath} className="flower-leaf" />
                      <path d={veinPath} className="flower-leaf-vein" />
                    </g>
                  ) : (
                    <>
                      <path d={SEEDLING} className="flower-leaf" style={{ transform: `scale(${SEEDLING_SIZE})` }} />
                      <path d={SEEDLING} className="flower-leaf" style={{ transform: `scale(${-SEEDLING_SIZE}, ${SEEDLING_SIZE})` }} />
                    </>
                  )}
                </g>
              </g>
            );
          })}
          <g ref={budRef} className="flower-bud" style={{ transform: budTransform(view.fill, sp, budS) }}>
            <Parts parts={sp.bud} />
          </g>
          <g ref={bloomRef} className="flower-bloom" style={{ transform: translate(tip), opacity: open ? 1 : 0 }}>
            <g ref={petalsRef} className="flower-petals">
              <g transform={`scale(${sp.k})`}>
                <Parts parts={sp.bloom} />
              </g>
            </g>
          </g>
        </g>
        <g ref={seedRef} className="flower-seed" style={{ opacity: seedOpacity(view.fill) }}>
          <ellipse cx="80" cy="206" rx="5.5" ry="3.5" className="flower-seed-body" style={{ transform: 'rotate(-20deg)', transformOrigin: '80px 206px' }} />
          <ellipse cx="78.5" cy="205" rx="1.6" ry="0.9" className="flower-seed-shine" />
        </g>
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="flower-mark-caption"
          style={{
            left: `${(CAPTION_X / VIEW_W) * 100}%`,
            top: `${((captionY[i]! - 8.5) / VIEW_H) * 100}%`,
            paddingBlock: captionPad(captionY, i),
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

// ---- Mini (viewBox 0 0 40 40): a small pot and the current level's species, static ----

function Mini({ fill, state = 'active', level, size = 32, label }: ProgressMiniProps) {
  const shown = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const sp = flowerFor(level ?? 1);
  const classes = ['flower', 'flower--mini', `flower--${state}`];
  return (
    <svg className={classes.join(' ')} width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={label ?? text.fillLabel(Math.floor(shown * 100))}>
      <path d="M13 33.5L14.5 39Q20 40 25.5 39L27 33.5Z" className="flower-pot" />
      <rect x="11.5" y="30.5" width="17" height="4" rx="1.3" className="flower-pot-rim" />
      <ellipse cx="20" cy="31.2" rx="6" ry="1" className="flower-soil" />
      <g className="flower-plant" transform="translate(20 31)">
        <SmallPlant sp={sp} h={18} bloom={0.3} leaf={0.36} stem={2.4} fill={shown} open={state === 'complete' || shown >= 1} seedling />
      </g>
      {shown < SEED_GONE && <ellipse cx="20" cy="30.5" rx="2.2" ry="1.3" className="flower-seed-body" />}
    </svg>
  );
}

export const flowerTheme: ProgressThemeDefinition = {
  key: 'flower',
  text,
  available: true,
  Hero,
  Mini,
  markPoint,
};
