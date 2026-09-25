import { createElement, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { copy } from '../../copy';
import { useMotion, type MotionMode } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressState } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import './rocket.css';

// «Ракета»: a journey from world to world. Level 1 flies from the Earth to the Moon; level n ≥ 2
// flies on from the destination of level n − 1 to a planet generated from n (planetFor) along a
// route of a generated shape (routeFor). `fill` is the share of the route flown. The beat is the
// touchdown; then the camera moves up and the destination slides down to become the ground.

const VIEW_W = 160;
const VIEW_H = 260;

type Point = { x: number; y: number };
type Cubic = [Point, Point, Point, Point];
/** A waypoint; `k` is the length of its Bézier handles as a share of the neighbouring spans, `d` its heading. */
type Waypoint = Point & { k?: number; d?: Point };
const P = (x: number, y: number, k?: number, d?: Point): Waypoint => ({ x, y, k, d });

/** Level 1: an S up the left half, then an arc over onto the Moon. */
const MOON_SEGMENTS: Cubic[] = [
  [P(42, 226), P(42, 196), P(76, 190), P(76, 158)],
  [P(76, 158), P(76, 124), P(44, 118), P(46, 84)],
  [P(46, 84), P(48, 44), P(112, 16), P(116, 50)],
];
const MOON = { cx: 116, cy: 72, r: 22 };
/** The ground of level n ≥ 2: the planet of level n − 1 seen close up, a wide arc at the bottom. */
const GROUND = { cx: 62, cy: 420, r: 192 };
const groundY = (x: number) => GROUND.cy - Math.sqrt(GROUND.r ** 2 - (x - GROUND.cx) ** 2);
/** Where levels n ≥ 2 start: the top of the ground, where the camera brings the landed rocket. */
const LAUNCH = P(GROUND.cx, GROUND.cy - GROUND.r);

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const round = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const levelOf = (level: number | undefined) => Math.max(1, Math.floor(Number.isFinite(level) ? level! : 1));

function bezier([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

interface Sample extends Point {
  s: number;
  angle: number;
}

/** Arc-length table of a path, so `fill` moves the rocket at an even pace; angles unwrapped. */
function buildTable(segments: Cubic[], perSegment = 64): { samples: Sample[]; length: number } {
  const points: Point[] = [];
  segments.forEach((seg, i) => {
    for (let k = i === 0 ? 0 : 1; k <= perSegment; k++) points.push(bezier(seg, k / perSegment));
  });
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const length = lengths[lengths.length - 1]!;
  let previous = 0;
  const samples = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    let angle = (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI;
    while (angle - previous > 180) angle -= 360;
    while (angle - previous < -180) angle += 360;
    previous = angle;
    return { x: p.x, y: p.y, s: lengths[i]! / length, angle };
  });
  return { samples, length };
}

function sampleAt(table: Sample[], share: number): Sample {
  const s = clamp(share);
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]!.s <= s) lo = mid;
    else hi = mid;
  }
  const a = table[lo]!;
  const b = table[hi]!;
  const t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s, angle: lerp(a.angle, b.angle, t) };
}

/** A smooth path through waypoints; it leaves the first straight up and lands on the last straight down. */
function smooth(points: Waypoint[]): Cubic[] {
  const last = points.length - 1;
  const dir = (i: number): Point => {
    if (i === 0) return P(0, -1);
    if (i === last) return P(0, 1);
    if (points[i]!.d) return points[i]!.d!;
    const a = points[i - 1]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return P((b.x - a.x) / len, (b.y - a.y) / len);
  };
  return points.slice(1).map((b, i) => {
    const a = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const da = dir(i);
    const db = dir(i + 1);
    const ka = len * (a.k ?? 0.38);
    const kb = len * (b.k ?? 0.38);
    return [P(a.x, a.y), P(a.x + da.x * ka, a.y + da.y * ka), P(b.x - db.x * kb, b.y - db.y * kb), P(b.x, b.y)];
  });
}

// ---- Seeded generation: the same level always draws the same planet and route ----

type Rand = () => number;

/** mulberry32 over an integer hash of (level, salt); no Math.random. */
export function seeded(level: number, salt = 0): Rand {
  let a = Math.imul(level ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Item k of an endless deal of `list` in shuffled rounds; two neighbours are never the same. */
function dealt<T>(list: readonly T[], k: number, salt: number): T {
  const n = list.length;
  const deal = (block: number) => {
    const rand = seeded(block, salt);
    const out = [...list];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  const block = Math.floor(k / n);
  const items = deal(block);
  if (block > 0 && items[0] === deal(block - 1)[n - 1]) [items[0], items[1]] = [items[1]!, items[0]!];
  return items[k % n]!;
}

function cached<T>(make: (level: number) => T): (level: number) => T {
  const cache = new Map<number, T>();
  return (level) => {
    const n = levelOf(level);
    let value = cache.get(n);
    if (value === undefined) {
      if (cache.size > 96) cache.clear();
      value = make(n);
      cache.set(n, value);
    }
    return value;
  };
}

const hsl = (h: number, s: number, l: number) => `hsl(${Math.round((h + 720) % 360)},${Math.round(Math.min(100, Math.max(0, s)))}%,${Math.round(l)}%)`;

/** A soft closed blob around (cx, cy). */
function blob(rand: Rand, cx: number, cy: number, rx: number, ry: number): string {
  const pts = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2;
    const k = 0.72 + rand() * 0.4;
    return P(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
  });
  const mid = (a: Point, b: Point) => `${r1((a.x + b.x) / 2)} ${r1((a.y + b.y) / 2)}`;
  return `M${mid(pts[6]!, pts[0]!)}${pts.map((p, i) => `Q${r1(p.x)} ${r1(p.y)} ${mid(p, pts[(i + 1) % 7]!)}`).join('')}Z`;
}

/** An element as [tag, attributes, class]: planets carry their details as data. */
type Shape = ['circle' | 'ellipse' | 'path', Record<string, string | number>, string];

const PALETTE_KEYS = ['rock', 'ice', 'desert', 'lava', 'ocean', 'gas', 'violet', 'pink', 'jungle'] as const;
export type Palette = (typeof PALETTE_KEYS)[number] | 'moon';
export type Feature = 'bands' | 'craters' | 'blobs' | 'caps' | 'spot' | 'clouds' | 'ring' | 'moon' | 'glow';
const FEATURES: Feature[] = ['bands', 'craters', 'blobs', 'caps', 'spot', 'clouds', 'ring', 'moon', 'glow'];

// Base hue, saturation and lightness (natural colours; lightness 38–74 % reads on light, dark and
// purple pages), then the chance of each feature in FEATURES order.
const PALETTES: Record<(typeof PALETTE_KEYS)[number], [number, number, number, number[]]> = {
  rock: [30, 14, 60, [0, 1, 0.5, 0, 0, 0, 0.15, 0.5, 0]],
  ice: [200, 52, 70, [0.6, 0.4, 0, 1, 0, 0, 0.4, 0.3, 0.7]],
  desert: [32, 58, 62, [0.8, 0.5, 0, 0.5, 0, 0, 0.2, 0.4, 0.4]],
  lava: [8, 40, 38, [0, 0.5, 1, 0, 0, 0, 0, 0.3, 1]],
  ocean: [188, 52, 48, [0, 0, 1, 0.5, 0, 1, 0.15, 0.4, 1]],
  gas: [36, 62, 70, [1, 0, 0, 0, 0.75, 0, 0.55, 0.3, 0]],
  violet: [270, 40, 62, [0.7, 0.4, 0.4, 0, 0.3, 0, 0.5, 0.5, 0.3]],
  pink: [344, 60, 74, [0.8, 0, 0.3, 0, 0.5, 0, 0.4, 0.3, 0.5]],
  jungle: [116, 38, 46, [0, 0, 1, 0.3, 0, 1, 0.1, 0.4, 1]],
};

const SYLLABLES = ['ке', 'ра', 'то', 'ми', 'са', 'ве', 'но', 'зу', 'ла', 'ри', 'та', 'до', 'ки', 'ре', 'ва', 'ло', 'се', 'ни', 'гу', 'ме'];
const ENDINGS = ['лия', 'рон', 'нос', 'тис', 'дея', 'рида', 'вара', 'ран', 'лис', 'мор', 'нея', 'тан'];

export interface Planet {
  level: number;
  /** A generated name, for the preview only; the app never shows it. */
  name: string;
  palette: Palette;
  features: Feature[];
  /** Radius at the top of the scene, viewBox units. */
  r: number;
  /** Literal colours; empty for the Moon, whose colours are tokens in rocket.css. */
  base: string;
  shade: string;
  /** Atmosphere colour, 'halo' for the Moon's soft halo, '' for none. */
  glow: string;
  /** Details of the disc in the planet's own units: radius 100 around (0, 0). */
  shapes: Shape[];
  ring: { rx: number; ry: number; tilt: number; c: string; c2: string } | null;
  moon: { x: number; y: number; r: number; c: string } | null;
  /** Details of the planet as the ground of the next level, in viewBox units. */
  ground: Shape[];
}

/** The ground's details: flattened by the curve of the horizon, over x 6–130 where it is deep enough. */
function groundShapes(n: number, features: Feature[], colour: Record<string, string>): Shape[] {
  const g = seeded(n, 4);
  const out: Shape[] = [];
  const along = (i: number, count: number) => 6 + (i + 0.2 + g() * 0.6) * (124 / count);
  if (features.includes('bands')) [7, 16, 26].forEach((depth, i) => out.push(['circle', { cx: GROUND.cx, cy: GROUND.cy, r: GROUND.r - depth, fill: 'none', stroke: i % 2 ? colour.light! : colour.dark!, strokeWidth: 4 + g() * 3 }, 'rk-ps']));
  if (features.includes('blobs')) {
    for (let i = 0; i < 3; i++) {
      const x = along(i, 3);
      out.push(['path', { d: blob(g, x, groundY(x) + 7 + g() * 5, 14 + g() * 12, 4 + g() * 3), fill: colour.blob! }, 'rk-pf rk-mare']);
    }
  }
  if (features.includes('caps')) out.push(['ellipse', { cx: 8, cy: groundY(8) + 3, rx: 26, ry: 7, fill: colour.caps! }, 'rk-pf']);
  if (features.includes('spot')) out.push(['ellipse', { cx: 104, cy: groundY(104) + 12, rx: 13, ry: 4.5, fill: colour.spot! }, 'rk-pf']);
  if (features.includes('craters')) {
    for (let i = 0; i < 5; i++) {
      const x = along(i, 5);
      const rx = 3 + g() * 4;
      out.push(['ellipse', { cx: r1(x), cy: r1(groundY(x) + 4 + g() * 12), rx: r1(rx), ry: r1(rx * 0.42), fill: colour.crater! }, 'rk-pf rk-crater']);
    }
  }
  if (features.includes('clouds')) [22, 96].forEach((x) => out.push(['path', { d: `M${x} ${r1(groundY(x) + 9)}q6 -3 12 0`, fill: 'none', stroke: '#fff', strokeWidth: 2.4, strokeLinecap: 'round' }, 'rk-ps rk-cloud']));
  return out;
}

const MOON_CRATERS: [number, number, number][] = [
  [-36, 9, 23],
  [32, 45, 15],
  [14, -41, 11],
  [-23, 64, 8],
];

/** Draws the planet of level n (uncached; planetFor memoises it). */
export function makePlanet(n: number): Planet {
  if (n === 1) {
    return {
      level: 1,
      name: 'Луна',
      palette: 'moon',
      features: ['craters', 'blobs'],
      r: MOON.r,
      base: '',
      shade: '',
      glow: 'halo',
      shapes: MOON_CRATERS.map(([cx, cy, r]) => ['circle', { cx, cy, r }, 'rk-pf rk-crater']),
      ring: null,
      moon: null,
      ground: groundShapes(1, ['blobs', 'craters'], { blob: '', crater: '' }),
    };
  }
  const rand = seeded(n, 1);
  const palette = dealt(PALETTE_KEYS, n - 2, 3);
  const [h0, s, l, chances] = PALETTES[palette];
  const h = h0 + (rand() - 0.5) * 16;
  const L = l + (rand() - 0.5) * 4;
  const tone = (dh: number, ds: number, dl: number) => hsl(h + dh, s + ds, L + dl);
  const features = FEATURES.filter((_, i) => rand() < chances[i]!);
  if (!features.some((f) => f === 'bands' || f === 'craters' || f === 'blobs' || f === 'spot')) features.unshift('bands');
  const has = (f: Feature) => features.includes(f);
  let r = palette === 'gas' ? 23 + rand() * 5 : 18 + rand() * 9;
  if (has('ring')) r = Math.min(r, 17 + rand() * 4);
  r = r1(r);

  const colour: Record<string, string> = {
    dark: palette === 'ice' ? tone(0, -12, 12) : tone(-6, 6, -12),
    light: tone(4, -10, 9),
    crater: palette === 'lava' ? hsl(10, 30, 24) : tone(0, -4, -11),
    blob:
      palette === 'lava'
        ? hsl(24 + rand() * 10, 95, 58)
        : palette === 'ocean'
          ? rand() < 0.5
            ? hsl(40, 48, 72)
            : hsl(98, 38, 50)
          : palette === 'violet'
            ? tone(24, 6, 12)
            : tone(palette === 'pink' ? -12 : 0, 6, palette === 'rock' ? -9 : -12),
    caps: hsl(h, 40, 95),
    spot: tone(-24, 12, -16),
  };
  const shapes: Shape[] = [];
  const add = (tag: Shape[0], a: Shape[1], c = 'rk-pf') => shapes.push([tag, a, c]);
  if (has('bands')) {
    const count = palette === 'gas' ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const y = Math.round(-84 + (164 / count) * (i + rand() * 0.5));
      const hh = Math.round(palette === 'gas' ? 14 + rand() * 12 : 8 + rand() * 10);
      add('path', { d: `M-110 ${y}Q0 ${y + 14} 110 ${y}V${y + hh}Q0 ${y + hh + 14} -110 ${y + hh}Z`, fill: i % 2 ? colour.light! : colour.dark! });
    }
  }
  if (has('blobs')) {
    const count = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = 20 + rand() * 50;
      add('path', { d: blob(rand, Math.cos(a) * d, Math.sin(a) * d, 26 + rand() * 18, 18 + rand() * 12), fill: colour.blob! });
    }
    if (palette === 'jungle') add('path', { d: blob(rand, -30 + rand() * 60, 20 + rand() * 30, 16, 11), fill: hsl(196, 55, 58) });
  }
  if (has('caps')) {
    add('ellipse', { cx: 0, cy: -100, rx: 62, ry: 30, fill: colour.caps! });
    if (rand() < 0.6) add('ellipse', { cx: 0, cy: 100, rx: 48, ry: 20, fill: colour.caps! });
  }
  if (has('spot')) {
    const x = Math.round((rand() - 0.5) * 60);
    const y = Math.round(16 + rand() * 26);
    add('ellipse', { cx: x, cy: y, rx: 25, ry: 13, fill: colour.spot! });
    add('ellipse', { cx: x - 3, cy: y - 2, rx: 12, ry: 6, fill: tone(-24, 12, -4) });
  }
  if (has('craters')) {
    const count = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * 76;
      add('circle', { cx: Math.round(Math.cos(a) * d), cy: Math.round(Math.sin(a) * d), r: Math.round(6 + rand() * 10), fill: colour.crater! });
    }
  }
  if (has('clouds')) {
    for (let i = 0; i < 3; i++) {
      const x = Math.round(-60 + i * 36 + rand() * 20);
      const y = Math.round(-50 + i * 34 + rand() * 12);
      add('path', { d: `M${x} ${y}q16 -8 32 0`, fill: 'none', stroke: '#fff', strokeWidth: 7, strokeLinecap: 'round' }, 'rk-ps rk-cloud');
    }
  }
  const tilt = (rand() < 0.5 ? -1 : 1) * (10 + rand() * 12);
  const rx = 170 + rand() * 24;
  const ring = has('ring') ? { rx: Math.round(rx), ry: Math.round(rx * (0.22 + rand() * 0.08)), tilt: Math.round(tilt), c: tone(14, -16, 14), c2: tone(0, -10, -14) } : null;
  let moon: Planet['moon'] = null;
  if (has('moon')) {
    // Below the planet, clear of the landing on top and of the rings.
    const mr = 2.8 + rand() * 1.4;
    const a = (((ring ? 165 : 128) + rand() * 16) * Math.PI) / 180 * (rand() < 0.5 ? -1 : 1);
    const dist = ((r + 7 + mr) * 100) / r;
    moon = { x: Math.round(Math.sin(a) * dist), y: Math.round(-Math.cos(a) * dist), r: Math.round((mr * 100) / r), c: hsl(h + 50, 14, 70) };
  }
  const name = Array.from({ length: 1 + (rand() < 0.3 ? 1 : 0) + 1 }, () => SYLLABLES[Math.floor(rand() * SYLLABLES.length)]!).join('') + ENDINGS[Math.floor(rand() * ENDINGS.length)]!;
  return {
    level: n,
    name: `${name[0]!.toUpperCase()}${name.slice(1)}${rand() < 0.5 ? `-${2 + Math.floor(rand() * 40)}` : ''}`,
    palette,
    features,
    r,
    base: tone(0, 0, 0),
    shade: tone(0, 4, -14),
    glow: has('glow') ? (palette === 'lava' ? hsl(24, 95, 60) : tone(0, 18, 16)) : '',
    shapes,
    ring,
    moon,
    ground: groundShapes(n, features, colour),
  };
}

/** The destination planet of level `level`: level 1 is the Moon, every later one is generated from the level. */
export const planetFor = cached(makePlanet);

/** Half the planet's width with its rings and moon, viewBox units. */
function reachOf(p: Planet): number {
  const k = p.r / 100;
  return Math.max(p.r, p.ring ? (p.ring.rx + 7) * k : 0, p.moon ? (Math.abs(p.moon.x) + p.moon.r) * k : 0);
}

// ---- Routes ----

export type RouteKind = 'moon' | 's' | 'arc' | 'spiral' | 'sling' | 'zigzag' | 'loop';
const ROUTE_KINDS: RouteKind[] = ['s', 'arc', 'spiral', 'sling', 'zigzag', 'loop'];

export interface Dest {
  cx: number;
  cy: number;
  r: number;
}

export interface Route {
  level: number;
  kind: RouteKind;
  dest: Dest;
  /** Half-width of the destination with its rings and moon. */
  reach: number;
  /** The side (−1 left, 1 right) the rocket comes down from onto the destination. */
  side: number;
  d: string;
  table: Sample[];
  /** From this share of the route the rocket turns upright for a tail-first touchdown. */
  flip: [number, number];
  /** Heading on the ground: the whole turn nearest to the heading at the end of the route. */
  upright: number;
  /** Asteroids of a belt, as path data. */
  rocks: string[];
  /** The small moon of a slingshot. */
  moon: { x: number; y: number; r: number } | null;
  /** The highest share a mark takes: before the route closes in on the destination. */
  markMax: number;
}

/** The last three waypoints: beside the destination, over its top, onto its top. */
const approach = ({ cx, cy, r }: Dest, reach: number, side: number): Waypoint[] => [
  P(cx + side * (reach + 12), cy - r * 0.8 - 6),
  P(cx + side * (r * 0.4 + 6), cy - r - 14),
  P(cx, cy - r),
];

function rock(rand: Rand, cx: number, cy: number, r: number): string {
  return `M${Array.from({ length: 7 }, (_, i) => {
    const a = ((i + rand() * 0.5) / 7) * Math.PI * 2;
    const k = 0.7 + rand() * 0.45;
    return `${r1(cx + Math.cos(a) * r * k)} ${r1(cy + Math.sin(a) * r * k)}`;
  }).join('L')}Z`;
}

/** Draws the route of level n (uncached; routeFor memoises it). */
export function makeRoute(n: number): Route {
  let kind: RouteKind = 'moon';
  let dest: Dest = MOON;
  let reach = MOON.r;
  let side = -1;
  let segments = MOON_SEGMENTS;
  let moon: Route['moon'] = null;
  const u = seeded(n, 2);
  if (n > 1) {
    const planet = planetFor(n);
    const r = planet.r;
    kind = dealt(ROUTE_KINDS, n - 2, 5);
    reach = reachOf(planet);
    const s = u() < 0.5 ? -1 : 1;
    side = -s;
    // The top stays 44+ below the box's edge: room for the upright rocket over it before touchdown.
    const place = (dx: number): Dest => ({ cx: r1(Math.min(138 - reach, Math.max(22 + reach, 80 + dx))), cy: r1(r + 44 + 10 * u()), r });
    let pts: Waypoint[];
    switch (kind) {
      case 's':
        dest = place(s * (18 + 14 * u()));
        pts = [LAUNCH, P(62 + s * (14 + 8 * u()), 178 - 6 * u()), P(80 - s * (30 + 8 * u()), 122 - 10 * u())];
        break;
      case 'arc':
        dest = place(s * (22 + 12 * u()));
        pts = [LAUNCH, P(80 - s * (54 + 4 * u()), 170 - 8 * u()), P(80 - s * (57 + 2 * u()), 100 - 8 * u())];
        break;
      case 'spiral': {
        // One orbit around the destination, closing in, then down onto its top.
        dest = { cx: r1(80 + (u() - 0.5) * 12), cy: r1(r + 46 + 8 * u()), r };
        const { cx, cy } = dest;
        pts = [LAUNCH, P(cx + s * (reach + 26), cy + 10), P(cx - s * 4, cy - r - 23), P(cx - s * (reach + 22), cy + 4), P(cx + s * 2, cy + r + 27), P(cx + s * (reach + 15), cy - 2)];
        side = s;
        break;
      }
      case 'sling': {
        // Round a small moon on the side, flung back across to the destination.
        const mr = 8 + 2 * u();
        const m = P(80 + s * (28 + 4 * u()), 146 + 12 * u());
        const d = mr + 10;
        const round = 0.55;
        moon = { x: r1(m.x), y: r1(m.y), r: r1(mr) };
        dest = place(-s * (22 + 12 * u()));
        side = s;
        pts = [LAUNCH, P(m.x, m.y + d, round, P(s, 0)), P(m.x + s * d, m.y, round, P(0, -1)), P(m.x, m.y - d, round, P(-s, 0))];
        break;
      }
      case 'zigzag': {
        dest = place(s * (18 + 14 * u()));
        const zig = (k: number, y: number) => P(80 + k * (40 + 6 * u()), y, 0.28);
        pts = [LAUNCH, zig(-s, 192), zig(s, 160), zig(-s, 128)];
        break;
      }
      case 'loop': {
        // A loop-the-loop halfway up, away from the destination; out of it towards the middle.
        dest = place(s * (20 + 12 * u()));
        const q = 16 + 4 * u();
        const c = P(80 - s * (6 + 8 * u()), 146 + 8 * u());
        pts = [LAUNCH, P(c.x - s * q * 0.3, c.y + q * 2.2), P(c.x - s * q, c.y), P(c.x, c.y - q), P(c.x + s * q, c.y), P(c.x, c.y + q), P(c.x - s * q * 1.5, c.y - q * 0.7)];
        break;
      }
      default:
        pts = [];
    }
    segments = smooth(kind === 'spiral' ? [...pts, P(dest.cx + side * (r * 0.4 + 5), dest.cy - r - 14), P(dest.cx, dest.cy - r)] : [...pts, ...approach(dest, reach, side)]);
  }
  const { samples, length } = buildTable(segments);
  const rocks: string[] = [];
  if (kind === 'zigzag') {
    // A belt across the zig-zag: rocks between its legs, near enough to be weaved through.
    for (let gy = 0; gy < 7; gy++) {
      const row = rocks.length;
      for (let gx = 0; gx < 8 && rocks.length < row + 3; gx++) {
        const x = 12 + gx * 19.5 + (u() - 0.5) * 9;
        const y = 104 + gy * 15 + (u() - 0.5) * 9;
        const rr = 2.2 + u() * 2.4;
        if (y < groundY(x) - 16 && Math.hypot(x - dest.cx, y - dest.cy) > reach + rr + 8 && samples.every((p) => Math.hypot(p.x - x, p.y - y) > rr + 6)) rocks.push(rock(u, x, y, rr));
      }
    }
  }
  const end = samples[samples.length - 1]!;
  const near = samples.find((p) => Math.hypot(p.x - dest.cx, p.y - dest.cy) < dest.r + 18);
  return {
    level: n,
    kind,
    dest,
    reach,
    side,
    d: `M${segments[0]![0].x} ${segments[0]![0].y}${segments.map(([, a, b, c]) => ` C${r1(a.x)} ${r1(a.y)} ${r1(b.x)} ${r1(b.y)} ${r1(c.x)} ${r1(c.y)}`).join('')}`,
    table: samples,
    flip: n === 1 ? [0.8, 0.97] : [1 - 60 / length, 1 - 6 / length],
    upright: 360 * Math.round(end.angle / 360),
    rocks,
    moon,
    markMax: n === 1 ? MARK_MAX : Math.min(MARK_MAX, near?.s ?? 1),
  };
}

/** The route of level `level`: level 1 is today's S to the Moon; later ones take one of six shapes. */
export const routeFor = cached(makeRoute);

export function pathPoint(fill: number, level = 1): Point {
  const { x, y } = sampleAt(routeFor(level).table, fill);
  return { x, y };
}

export interface RocketPose extends Point {
  angle: number;
}

/** The rocket's tail on the route, nose along the tangent, then upright over the destination. */
export function rocketPose(fill: number, level = 1): RocketPose {
  const route = routeFor(level);
  const f = clamp(fill);
  const { x, y, angle } = sampleAt(route.table, f);
  return { x, y, angle: lerp(angle, route.upright, smoothstep(route.flip[0], route.flip[1], f)) };
}

export const poseTransform = ({ x, y, angle }: RocketPose, scale = 1) =>
  `translate(${round(x)}px, ${round(y)}px) rotate(${round(angle)}deg)${scale === 1 ? '' : ` scale(${scale})`}`;

export function flightKeyframes(from: number, to: number, level = 1): Keyframe[] {
  const a = clamp(from);
  const b = clamp(to);
  const steps = Math.max(2, Math.ceil(Math.abs(b - a) * Math.max(30, routeFor(level).table.length / 6)));
  return Array.from({ length: steps + 1 }, (_, i) => ({ transform: poseTransform(rocketPose(lerp(a, b, i / steps), level)), offset: i / steps }));
}

export type RocketStage = 'pad' | 'liftoff' | 'cruise' | 'descent' | 'landed';

/** The flight stage at `fill`: it sets the flame size. */
export function rocketStage(fill: number, level = 1): RocketStage {
  const f = clamp(fill);
  if (f <= 0) return 'pad';
  if (f >= 1) return 'landed';
  if (f < 0.3) return 'liftoff';
  if (f < routeFor(level).flip[0]) return 'cruise';
  return 'descent';
}

export const FLAME_SCALE: Record<RocketStage, number> = { pad: 0.2, liftoff: 1.15, cruise: 0.85, descent: 0.7, landed: 0.2 };

// Level-up: idle → flying → landing (the beat) → handover (the camera moves up) → launch → idle;
// several levels repeat landing → handover → launch compressed, at most MAX_CYCLES times.

export type RocketPhase = 'idle' | 'flying' | 'landing' | 'handover' | 'launch';

export interface RocketAnimationState {
  phase: RocketPhase;
  cyclesLeft: number;
  cycle: number;
}

export type RocketEvent =
  | { type: 'start'; levels: number }
  | { type: 'arrived' }
  | { type: 'landed' }
  | { type: 'moved' }
  | { type: 'launched' }
  | { type: 'abort' };

export const MAX_CYCLES = 3;
export const ROCKET_IDLE: RocketAnimationState = { phase: 'idle', cyclesLeft: 0, cycle: 0 };

export const ROCKET_DONE_EVENT: Record<Exclude<RocketPhase, 'idle'>, Exclude<RocketEvent['type'], 'start' | 'abort'>> = {
  flying: 'arrived',
  landing: 'landed',
  handover: 'moved',
  launch: 'launched',
};

/** Unknown or out-of-order events leave the state unchanged; 'abort' always returns to idle. */
export function nextRocketPhase(state: RocketAnimationState, event: RocketEvent): RocketAnimationState {
  if (event.type === 'abort') return ROCKET_IDLE;
  switch (state.phase) {
    case 'idle':
      if (event.type !== 'start' || !(event.levels >= 1)) return state;
      return { phase: 'flying', cyclesLeft: Math.min(MAX_CYCLES, Math.floor(event.levels)), cycle: 0 };
    case 'flying':
      return event.type === 'arrived' ? { ...state, phase: 'landing' } : state;
    case 'landing':
      return event.type === 'landed' ? { ...state, phase: 'handover' } : state;
    case 'handover':
      return event.type === 'moved' ? { ...state, phase: 'launch' } : state;
    case 'launch':
      if (event.type !== 'launched') return state;
      return state.cyclesLeft > 1 ? { phase: 'landing', cyclesLeft: state.cyclesLeft - 1, cycle: state.cycle + 1 } : ROCKET_IDLE;
  }
}

/** Where this launch ends: the next destination while more levels follow, `toFill` on the last one. */
export function launchTarget(state: RocketAnimationState, toFill: number): number {
  return state.cyclesLeft > 1 ? 1 : clamp(toFill);
}

/** The scene a handover moves to: the next level, or on the last cycle straight to the final one. */
export function handoverScene(state: RocketAnimationState, scene: number, last: number): number {
  return state.cyclesLeft > 1 ? scene + 1 : last;
}

export type RocketEasing = 'out' | 'launch' | 'land' | 'camera';

export interface RocketTiming {
  delay: number;
  duration: number;
  easing: RocketEasing;
}

export const EASING: Record<RocketEasing, string> = {
  out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  launch: 'cubic-bezier(0.55, 0, 0.3, 1)',
  land: 'cubic-bezier(0.3, 0.6, 0.35, 1)',
  camera: 'cubic-bezier(0.5, 0, 0.25, 1)',
};

/** Phase timings; `distance` is the share of the route flown. One level stays ≤ 1.2 s. */
export function rocketTiming(state: RocketAnimationState, distance = 1): RocketTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'flying':
      return { delay: 0, duration: Math.round(140 + 160 * clamp(distance)), easing: 'land' };
    case 'landing':
      return { delay: 0, duration: compressed ? 200 : 280, easing: 'out' };
    case 'handover':
      return { delay: 0, duration: compressed ? 280 : 360, easing: 'camera' };
    case 'launch':
      return { delay: 0, duration: compressed ? 240 : Math.round(100 + 140 * clamp(distance)), easing: 'launch' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

/** A `finished` promise that never settles (old WebViews) must not stall the choreography. */
export const FINISH_FALLBACK_MS = 450;
/** A new `level` waits this long for its playLevelUp before the scene just crossfades to it. */
export const LEVEL_HOLD_MS = 2000;

// ---- Marks ----

const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
/** Marks sit where the rocket will be at that fill; only the ends are squeezed off the launch and the landing. */
const MARK_MIN = 0.04;
const MARK_LO = 0.08;
const MARK_HI = 0.86;
const MARK_MAX = 0.9;
const CAPTION_GAP = 18;
const CAPTION_X = 144;
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;

/** The share of the route for a mark at height h: as is in the middle, squeezed off the launch and the landing. */
function squeeze(h: number, max: number): number {
  const hi = Math.min(MARK_HI, max - 0.04);
  return h < MARK_LO ? lerp(MARK_MIN, MARK_LO, h / MARK_LO) : h > hi ? lerp(hi, max, (h - hi) / (1 - hi)) : h;
}

/** A mark at `height` on the route of `level`; the hero draws marks on the current route. */
export const markPointOn = (level: number, height: number): Point => pathPoint(squeeze(clamp(height), routeFor(level).markMax), level);

/**
 * The contract's markPoint takes only the height, so it answers for level 1's route (Earth → Moon);
 * the hero itself places marks on the route of the level on screen (markPointOn).
 */
export const markPoint = (height: number): Point => markPointOn(1, height);

export const flagTip = ({ x, y }: Point): Point => ({ x: x + 8, y: y - 9 });

export function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Caption ys, CAPTION_GAP apart, inside the box and off the band beside the destination, in input order. */
export function captionYs(ys: number[], dest: Dest = MOON): number[] {
  const top = dest.cy - dest.r - 6;
  const bottom = dest.cy + dest.r + 6;
  const inBand = (y: number) => y > top && y < bottom;
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map(({ y }) => (inBand(y) ? (y - top < bottom - y ? top : bottom) : Math.max(10, y)));
  for (let k = 1; k < placed.length; k++) {
    placed[k] = Math.max(placed[k]!, placed[k - 1]! + CAPTION_GAP);
    if (inBand(placed[k]!)) placed[k] = bottom;
  }
  const max = VIEW_H - 10;
  if (placed.length && placed[placed.length - 1]! > max) {
    placed[placed.length - 1] = max;
    for (let k = placed.length - 2; k >= 0; k--) {
      placed[k] = Math.min(placed[k]!, placed[k + 1]! - CAPTION_GAP);
      if (inBand(placed[k]!)) placed[k] = top;
    }
  }
  const out = Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]!));
  return out;
}

/** True when the polyline keeps outside the destination's disc. */
function clearOf(points: Point[], { cx, cy, r }: Dest): boolean {
  for (let k = 1; k < points.length; k++) {
    for (let t = 0; t <= 1; t += 0.05) {
      if (Math.hypot(lerp(points[k - 1]!.x, points[k]!.x, t) - cx, lerp(points[k - 1]!.y, points[k]!.y, t) - cy) <= r + 1) return false;
    }
  }
  return true;
}

/** Leader from a pennant's tip to its caption: a slant, then level; round the destination when that would cross it. */
export function leaderPoints(tip: Point, y: number, dest: Dest = MOON): Point[] {
  const end = P(CAPTION_X - 4, y);
  const slant = [tip, P(Math.min(tip.x + Math.abs(y - tip.y), CAPTION_X - 6), y), end];
  if (clearOf(slant, dest)) return slant;
  const right = dest.cx + dest.r + 5;
  const x = tip.x >= dest.cx && right <= CAPTION_X - 6 ? right : Math.max(2, dest.cx - dest.r - 5);
  return [tip, P(x, tip.y), P(x, y), end];
}

/** Caption padding in px: towards a 44 px tap area, short of the next caption. */
function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) - CAPTION_LINE : CAPTION_PAD_MAX;
  return Math.round(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

// ---- WAAPI ----

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function done(animation: Animation | null, duration: number): Promise<void> {
  if (!animation) return Promise.resolve();
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration + FINISH_FALLBACK_MS)]);
}

function animate(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    try {
      return el.animate(keyframes, { ...options, easing: 'ease-out' });
    } catch {
      return null;
    }
  }
}

// ---- Drawing ----

/** The rocket in its own coordinates: tail centre at (0, 0), nose up at (0, −28). */
function RocketShape({ flame, flameScale = 1, flicker }: { flame?: Ref<SVGGElement> | 'none'; flameScale?: number; flicker?: boolean }) {
  return (
    <>
      {flame !== 'none' && (
        <g ref={flame} className="rocket-flame-wrap">
          <g className="rocket-flame-scale" style={{ transform: `scale(${flameScale})` }}>
            <path className={flicker ? 'rocket-flame anim-decor' : 'rocket-flame'} d="M-4.6 1 C-4.6 7 -1.6 11 0 16 C1.6 11 4.6 7 4.6 1 Z" />
            <path className="rocket-flame-core" d="M-2.2 1 C-2.2 4.5 -0.8 7 0 9.5 C0.8 7 2.2 4.5 2.2 1 Z" />
          </g>
        </g>
      )}
      <path className="rocket-fin" d="M-5.5 -10 L-11 -1 L-11 2 L-5 0 Z" />
      <path className="rocket-fin" d="M5.5 -10 L11 -1 L11 2 L5 0 Z" />
      <rect className="rocket-nozzle" x="-3.6" y="-1.5" width="7.2" height="3" rx="1" />
      <path className="rocket-body" d="M0 -28 C5.5 -24 7 -16 6.2 -8 C6 -4 5.4 -1 5 0 L-5 0 C-5.4 -1 -6 -4 -6.2 -8 C-7 -16 -5.5 -24 0 -28 Z" />
      <path className="rocket-body-shade" d="M0 -28 C5.5 -24 7 -16 6.2 -8 C6 -4 5.4 -1 5 0 L2 0 C3.4 -8 3.4 -20 0 -28 Z" />
      <circle className="rocket-window" cx="0" cy="-15" r="3.1" />
      <circle className="rocket-window-glint" cx="-1" cy="-16" r="0.9" />
      <rect className="rocket-fin-mid" x="-0.8" y="-7" width="1.6" height="7" rx="0.8" />
    </>
  );
}

const STARS: [number, number, number][] = [
  [20, 26, 1.6],
  [64, 16, 1.1],
  [150, 20, 1.2],
  [22, 132, 1.2],
  [142, 136, 1.6],
  [118, 186, 1.1],
  [14, 196, 1.1],
  [96, 104, 0.9],
];

const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r * 1.8} Q${x} ${y} ${x + r * 1.8} ${y} Q${x} ${y} ${x} ${y + r * 1.8} Q${x} ${y} ${x - r * 1.8} ${y} Q${x} ${y} ${x} ${y - r * 1.8} Z`;

/** Dust puffs at the touchdown point: [dx, dy] they drift to, out past the fins. */
const PUFFS: [number, number][] = [
  [-14, -3],
  [14, -2],
  [0, -5],
];

const shapes = (list: Shape[]) => list.map(([tag, a, c], i) => createElement(tag, { key: i, className: c, ...a }));

const planetClass = (p: Planet, gold?: boolean) => `rocket-planet${p.palette === 'moon' ? ' rocket-planet--moon' : ''}${gold ? ' rocket-planet--gold' : ''}`;

/** The lit side's shadow: a crescent on the right of the disc. */
const SHADE = 'M27 -96A100 100 0 0 1 27 96A118 118 0 0 0 27 -96Z';

/** A planet as a disc of radius `r` around (x, y); its details live in units of radius 100. `bare`: no glow. */
function Disc({ p, x, y, r, id, halo, gold, bare }: { p: Planet; x: number; y: number; r: number; id: string; halo?: string; gold?: boolean; bare?: boolean }) {
  const ring = p.ring;
  const half = (front: boolean) =>
    ring && (
      <g transform={`rotate(${ring.tilt})`}>
        {[ring.c, ring.c2].map((c, i) => (
          <path key={c} d={`M${-ring.rx} 0A${ring.rx} ${ring.ry} 0 0 ${front ? 0 : 1} ${ring.rx} 0`} fill="none" stroke={c} strokeWidth={i ? 2.5 : 13} className="rk-ps" />
        ))}
      </g>
    );
  return (
    <g className={planetClass(p, gold)} transform={`translate(${round(x)} ${round(y)}) scale(${Math.round((r / 100) * 10000) / 10000})`}>
      {!bare && (p.glow === 'halo' ? halo && <circle r="145" fill={`url(#${halo})`} /> : p.glow && <circle r="107" fill="none" stroke={p.glow} strokeWidth="14" className="rocket-planet-glow rk-ps" />)}
      {half(false)}
      <circle r="100" fill={p.base || undefined} className="rk-pb" />
      <clipPath id={id}>
        <circle r="100" />
      </clipPath>
      <g clipPath={`url(#${id})`}>{shapes(p.shapes)}</g>
      <path d={SHADE} fill={p.shade || undefined} className="rk-pf rocket-planet-shade" />
      <circle r="100" className="rocket-planet-rim" />
      {half(true)}
      {p.moon && (
        <>
          <circle cx={p.moon.x} cy={p.moon.y} r={p.moon.r} fill={p.moon.c} className="rk-pb" />
          <circle cx={p.moon.x} cy={p.moon.y} r={p.moon.r} className="rocket-planet-rim" />
        </>
      )}
    </g>
  );
}

function Flag({ x, y, angle, flagRef, shown = true }: Point & { angle: number; flagRef?: Ref<SVGGElement>; shown?: boolean }) {
  return (
    <g transform={`translate(${round(x)} ${round(y)}) rotate(${angle})`}>
      <g ref={flagRef} className="rocket-flag" style={{ opacity: shown ? 1 : 0 }}>
        <line x1="0" y1="0" x2="0" y2="-14" className="rocket-flag-pole" />
        <path d="M0.6 -14 L9 -11.5 L0.6 -8.5 Z" className="rocket-flag-cloth" />
      </g>
    </g>
  );
}

/** The flag on a destination: at 45° on the side away from the descent, leaning with the surface. */
const flagOn = ({ dest: { cx, cy, r }, side }: Route) => ({ x: cx - side * 0.707 * (r - 0.8), y: cy - 0.707 * (r - 0.8), angle: -side * 38 });

function Earth({ id }: { id: string }) {
  return (
    <g className="rocket-earth" clipPath={`url(#${id}-box)`}>
      <clipPath id={`${id}-box`}>
        <rect x="-10" y="0" width={VIEW_W + 20} height={VIEW_H} />
      </clipPath>
      <clipPath id={`${id}-c`}>
        <circle cx="62" cy="420" r="192" />
      </clipPath>
      <circle cx="62" cy="420" r="196" className="rocket-atmosphere" />
      <circle cx="62" cy="420" r="192" className="rocket-ocean" />
      <g clipPath={`url(#${id}-c)`}>
        <path className="rocket-land" d="M8 262 C12 248 22 238 34 232 C44 228 58 229 66 234 C74 238 70 246 80 250 C90 254 96 262 96 262 Z" />
        <path className="rocket-land" d="M118 262 C122 256 130 250 142 250 C152 250 160 254 164 262 Z" />
        <path className="rocket-cloud" d="M84 238 C90 235 98 235 104 238" />
        <path className="rocket-cloud" d="M4 250 C8 247 14 247 18 249" />
      </g>
      <g className="rocket-pad">
        <path d="M26 204 V228 M26 207 H32 M26 215 H32" className="rocket-tower" />
        <rect x="32" y="226.5" width="20" height="3" rx="1.5" className="rocket-platform" />
      </g>
    </g>
  );
}

/** The ground of `level`: the Earth for level 1, else the planet reached in level − 1 with its flag. */
function Ground({ level, id }: { level: number; id: string }) {
  if (level === 1) return <Earth id={id} />;
  const p = planetFor(level - 1);
  const { cx, cy, r } = GROUND;
  return (
    <g className={planetClass(p)} clipPath={`url(#${id}-box)`}>
      <clipPath id={`${id}-box`}>
        <rect x="-10" y="0" width={VIEW_W + 20} height={VIEW_H} />
      </clipPath>
      <clipPath id={`${id}-c`}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      {p.glow && p.glow !== 'halo' && <circle cx={cx} cy={cy} r={r + 4} fill={p.glow} className="rocket-atmosphere" />}
      <circle cx={cx} cy={cy} r={r} fill={p.base || undefined} className="rk-pb" />
      <g clipPath={`url(#${id}-c)`}>{shapes(p.ground)}</g>
      <circle cx={cx} cy={cy} r={r} className="rocket-planet-rim" />
      <Flag x={92} y={groundY(92) + 0.6} angle={9} />
    </g>
  );
}

/** The dashed route with its asteroids or slingshot moon. */
function RouteLine({ route }: { route: Route }) {
  const { moon } = route;
  return (
    <>
      <path d={route.d} className="rocket-route" />
      {route.rocks.map((d) => (
        <path key={d} d={d} className="rocket-rock" />
      ))}
      {moon && (
        <g className="rocket-planet rocket-planet--moon">
          <circle cx={moon.x} cy={moon.y} r={moon.r} className="rk-pb" />
          <circle cx={moon.x - moon.r * 0.3} cy={moon.y + moon.r * 0.2} r={moon.r * 0.32} className="rk-crater" />
          <circle cx={moon.x} cy={moon.y} r={moon.r} className="rocket-planet-rim" />
        </g>
      )}
    </>
  );
}

function Hero({ fill, state = 'active', motion: motionProp, label, marks, onMarkTap, level: levelProp, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion: MotionMode = motionProp ?? systemMotion;
  const idPrefix = `rocket${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const level = levelOf(levelProp);

  // While a choreography runs (and while a new level waits for it) the scene shows the overrides.
  const [override, setOverride] = useState<number | null>(null);
  const [sceneOverride, setSceneOverride] = useState<number | null>(null);
  /** The level whose scene is leaving during a handover. */
  const [leaving, setLeaving] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  const playing = useRef(false);
  const playToken = useRef(0);
  const holdTimer = useRef<number | undefined>(undefined);
  const targetRef = useRef(target);
  targetRef.current = target;
  const levelRef = useRef(level);
  levelRef.current = level;
  const shown = override ?? target;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const scene = sceneOverride ?? level;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const svgRef = useRef<SVGSVGElement>(null);
  const starsRef = useRef<SVGGElement>(null);
  const groundRef = useRef<SVGGElement>(null);
  const outGroundRef = useRef<SVGGElement>(null);
  const routeRef = useRef<SVGGElement>(null);
  const outRouteRef = useRef<SVGGElement>(null);
  const destRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<SVGGElement>(null);
  const rocketRef = useRef<SVGGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const flameRef = useRef<SVGGElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const flagRef = useRef<SVGGElement>(null);
  const puffRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGGElement>(null);

  useEffect(installPauseWhenHidden, []);
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  // Prop-driven changes outside a choreography. A new, higher level arrives with its fill just
  // before playLevelUp: the scene on screen holds until the play takes it over, or crossfades to
  // the new level when no play follows.
  const displayed = useRef({ scene, fill: shown });
  const previous = useRef({ level, target });
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = { level, target };
    if (playing.current || (from.level === level && from.target === target)) return;
    const release = () => {
      window.clearTimeout(holdTimer.current);
      const was = displayed.current.scene;
      setSceneOverride(null);
      setOverride(null);
      if (was !== levelRef.current) animate(svgRef.current, [{ opacity: 0.3 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    };
    if (level > from.level && displayed.current.scene < level) {
      setSceneOverride(displayed.current.scene);
      setOverride(displayed.current.fill);
      window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => !playing.current && release(), LEVEL_HOLD_MS);
      return;
    }
    if (from.level !== level || sceneOverride !== null) return release();
    setOverride(null);
    const rocket = rocketRef.current;
    if (motion === 'reduced') {
      animate(rocket, [{ opacity: 0.3 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    const duration = Math.round(360 + 420 * Math.abs(target - from.target));
    animate(rocket, flightKeyframes(from.target, target, level), { duration, easing: EASING.launch });
    animate(trailRef.current, [{ strokeDashoffset: `${1 - from.target}px` }, { strokeDashoffset: `${1 - target}px` }], { duration, easing: EASING.launch });
  }, [target, level, motion]);
  useLayoutEffect(() => {
    displayed.current = { scene, fill: shown };
  });

  // Completing on screen plants the flag (never on first load).
  const previousState = useRef<ProgressState>(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete') return;
    const keyframes = motion === 'reduced' ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }];
    animate(flagRef.current, keyframes, { duration: motion === 'reduced' ? 240 : 420, easing: EASING.out });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => rocketRef.current ?? svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const rocket = rocketRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        window.clearTimeout(holdTimer.current);
        // The `level` prop already names the new level; the flight being completed is the one on
        // screen (held since the props changed), else the flight of level − levels.
        const count = Math.max(1, Math.floor(levels) || 1);
        const last = levelRef.current;
        const first = sceneRef.current < last ? sceneRef.current : Math.max(1, last - count);
        const start = sceneRef.current < last ? shownRef.current : Math.min(clamp(fromFill), shownRef.current);
        const end = clamp(toFill);
        if (!rocket || typeof rocket.animate !== 'function') {
          onOverflow?.();
          flushSync(() => {
            setSceneOverride(null);
            setOverride(null);
          });
          return;
        }
        playing.current = true;
        const running: Animation[] = [];
        const track = (a: Animation | null) => {
          if (a) running.push(a);
          return a;
        };
        flushSync(() => {
          setScripted(true);
          setOverride(start);
          setSceneOverride(first);
          setLeaving(null);
        });

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            flushSync(() => {
              setSceneOverride(last);
              setOverride(end);
            });
            await done(track(animate(svgRef.current, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })), 240);
            return;
          }
          let current = start;
          let now = first;
          const fly = async (to: number, timing: RocketTiming) => {
            const opts = { duration: timing.duration, easing: EASING[timing.easing], fill: 'forwards' as const };
            const a = track(animate(rocket, flightKeyframes(current, to, now), opts));
            track(animate(trailRef.current, [{ strokeDashoffset: `${1 - current}px`, opacity: 1 }, { strokeDashoffset: `${1 - to}px`, opacity: 1 }], opts));
            current = to;
            await done(a, timing.duration);
          };
          const flame = (on: boolean, duration = 140) =>
            track(animate(flameRef.current, [{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], { duration, easing: 'ease-out', fill: 'forwards' }));

          let phase = nextRocketPhase(ROCKET_IDLE, { type: 'start', levels: count });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = rocketTiming(phase, phase.phase === 'flying' ? 1 - current : phase.phase === 'launch' ? launchTarget(phase, end) : 1);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'flying':
                flame(true);
                await fly(1, timing);
                break;
              case 'landing': {
                if (phase.cycle === 0) onOverflow?.();
                const d = timing.duration;
                flame(false, 120);
                track(animate(bodyRef.current, [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.1, 0.86)', offset: 0.25 }, { transform: 'scale(0.97, 1.04)', offset: 0.6 }, { transform: 'scale(1, 1)' }], { duration: d, easing: 'ease-out' }));
                Array.from(puffRef.current?.children ?? []).forEach((puff, i) => {
                  const [dx, dy] = PUFFS[i]!;
                  track(animate(puff, [{ transform: 'translate(0px, 0px) scale(0.4)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(1.8)`, opacity: 0 }], { duration: d, delay: i * 30, easing: 'ease-out' }));
                });
                track(animate(haloRef.current, [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: d + 80, easing: 'ease-in-out' }));
                const flag = track(animate(flagRef.current, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.2)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: d * 0.7, delay: d * 0.3, easing: 'ease-out', fill: 'forwards' }));
                await done(flag, d);
                break;
              }
              case 'handover': {
                // The camera moves up: the destination slides down and grows into the ground,
                // the old ground and route drop away, the next planet and route fade in.
                const from = routeFor(now);
                const next = handoverScene(phase, now, last);
                const { cx, cy, r } = from.dest;
                const k = GROUND.r / r;
                const zoom = (t: number) => `translate(${round(t * (GROUND.cx - k * cx))}px, ${round(t * (GROUND.cy - k * cy))}px) scale(${round(1 + t * (k - 1))})`;
                flushSync(() => {
                  setLeaving(now);
                  setSceneOverride(next);
                  setOverride(0);
                });
                running.splice(0).forEach((a) => a.cancel());
                now = next;
                current = 0;
                const opts = { duration: timing.duration, easing: EASING.camera, fill: 'forwards' as const };
                const y = (v: number) => `translateY(${v}px)`;
                const moved = track(
                  animate(
                    zoomRef.current,
                    [
                      { transform: zoom(0), opacity: 1 },
                      { transform: zoom(0.62), opacity: 1, offset: 0.62 },
                      { transform: zoom(1), opacity: 0 },
                    ],
                    opts,
                  ),
                );
                track(animate(rocket, [{ transform: poseTransform({ x: cx, y: cy - r, angle: 0 }) }, { transform: poseTransform({ ...LAUNCH, angle: 0 }) }], opts));
                track(animate(outGroundRef.current, [{ transform: y(0), opacity: 1 }, { transform: y(60), opacity: 0, offset: 0.55 }, { transform: y(90), opacity: 0 }], opts));
                track(animate(outRouteRef.current, [{ transform: y(0), opacity: 1 }, { transform: y(24), opacity: 0, offset: 0.35 }, { transform: y(70), opacity: 0 }], opts));
                track(animate(starsRef.current, [{ transform: y(0), opacity: 1 }, { transform: y(36), opacity: 0, offset: 0.5 }, { transform: y(-36), opacity: 0, offset: 0.5 }, { transform: y(0), opacity: 1 }], opts));
                track(animate(groundRef.current, [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }], opts));
                track(animate(destRef.current, [{ transform: y(-70), opacity: 0 }, { transform: y(-49), opacity: 0, offset: 0.3 }, { transform: y(0), opacity: 1 }], opts));
                track(animate(routeRef.current, [{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], opts));
                await done(moved, timing.duration);
                flushSync(() => setLeaving(null));
                break;
              }
              case 'launch':
                flame(true, 100);
                await fly(launchTarget(phase, end), timing);
                break;
            }
            phase = nextRocketPhase(phase, { type: ROCKET_DONE_EVENT[phase.phase as Exclude<RocketPhase, 'idle'>] });
          }
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            flushSync(() => {
              setOverride(end);
              setSceneOverride(last);
              setLeaving(null);
            });
            running.forEach((a) => a.cancel());
            playing.current = false;
            requestAnimationFrame(() => {
              if (aborted()) return;
              setScripted(false);
              setOverride(null);
              if (levelRef.current === last) setSceneOverride(null);
            });
          }
        }
      },
    }),
    [motion],
  );

  const route = routeFor(scene);
  const planet = planetFor(scene);
  const out = leaving === null ? null : routeFor(leaving);
  const stage = rocketStage(shown, scene);
  const complete = state === 'complete';
  const flameOn = state === 'active' && (stage === 'liftoff' || stage === 'cruise' || stage === 'descent');
  const pose = rocketPose(shown, scene);
  const landed = sampleAt(route.table, 1);
  const flag = flagOn(route);
  const { cx, cy, r } = route.dest;
  const view = `url(#${idPrefix}-view)`;

  // Marks belong to the level of the props: drawn once its scene is on screen.
  const shownMarks = scene === level ? (marks ?? []) : [];
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const markAt = (h: number) => markPointOn(scene, h);
  const captionY = captionYs(
    captioned.map((m) => flagTip(markAt(m.height)).y),
    route.dest,
  );

  const classes = ['rocket', 'rocket--hero', `rocket--${state}`, `rocket--stage-${stage}`, (marks?.length ?? 0) > 0 ? 'rocket--marked' : '', flameOn ? 'rocket--flame' : '', scripted ? 'rocket--scripted' : ''];

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <svg ref={svgRef} className="rocket-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label ?? rocketTheme.text.fillLabel(Math.floor(shown * 100))}>
        <defs>
          <radialGradient id={`${idPrefix}-halo`}>
            <stop offset="0.6" className="rocket-halo-in" />
            <stop offset="1" className="rocket-halo-out" />
          </radialGradient>
          {/* What moves with the camera stays inside the box (the svg itself overflows for the rocket). */}
          <clipPath id={`${idPrefix}-view`}>
            <rect x="-10" y="0" width={VIEW_W + 20} height={VIEW_H} />
          </clipPath>
        </defs>
        <g clipPath={view}>
          <g ref={starsRef} className="rocket-stars rocket-cam" aria-hidden="true">
            {STARS.map(([x, y, s]) => (
              <path key={`${x}-${y}`} d={sparkle(x, y, s)} />
            ))}
          </g>
        </g>
        {leaving !== null && (
          <g clipPath={view}>
            <g ref={outGroundRef} className="rocket-cam">
              <Ground level={leaving} id={`${idPrefix}-g0`} />
            </g>
          </g>
        )}
        <g ref={groundRef}>
          <Ground level={scene} id={`${idPrefix}-g1`} />
        </g>
        {out && (
          <g clipPath={view}>
            <g ref={outRouteRef} className="rocket-cam">
              <RouteLine route={out} />
              <path d={out.d} pathLength={1} className="rocket-trail" style={{ strokeDashoffset: '0px' }} />
            </g>
          </g>
        )}
        <g ref={routeRef}>
          <RouteLine route={route} />
          <path ref={trailRef} d={route.d} pathLength={1} className="rocket-trail" style={{ strokeDashoffset: `${1 - shown}px`, opacity: shown > 0 ? 1 : 0 }} />
          <g className="rocket-leaders" aria-hidden="true">
            {captioned.map((mark, i) => {
              const points = leaderPoints(flagTip(markAt(mark.height)), captionY[i]!, route.dest);
              const end = points[points.length - 1]!;
              return (
                <g key={mark.id}>
                  <polyline points={points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')} className="rocket-leader" />
                  <circle cx={end.x} cy={end.y} r="1.5" className="rocket-leader-dot" />
                </g>
              );
            })}
          </g>
          {shownMarks.map((mark) => {
            const { x, y } = markAt(mark.height);
            return (
              <g key={mark.id} className="rocket-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
                <rect x={x - 8} y={y - 18} width={24} height={24} className="rocket-mark-hit" />
                <line x1={x} x2={x} y1={y} y2={y - 12} className="rocket-mark-pole" />
                <path d={`M${x} ${y - 12}L${x + 8} ${y - 9}L${x} ${y - 6}Z`} className="rocket-mark-flag" />
                <circle cx={x} cy={y} r="1.8" className="rocket-mark-foot" />
              </g>
            );
          })}
        </g>
        <g ref={haloRef} className="rocket-beat-glow" opacity="0">
          <circle cx={cx} cy={cy} r={r + 12} fill={`url(#${idPrefix}-halo)`} />
        </g>
        <g clipPath={view}>
          <g ref={destRef} className="rocket-cam">
            <Disc p={planet} x={cx} y={cy} r={r} id={`${idPrefix}-d`} halo={`${idPrefix}-halo`} gold={complete} />
            <Flag {...flag} flagRef={flagRef} shown={complete} />
          </g>
        </g>
        {out && (
          <g clipPath={view}>
            <g ref={zoomRef} className="rocket-cam">
              <Disc p={planetFor(out.level)} x={out.dest.cx} y={out.dest.cy} r={out.dest.r} id={`${idPrefix}-z`} bare />
              <Flag {...flagOn(out)} />
            </g>
          </g>
        )}
        <g ref={rocketRef} className="rocket-craft" style={{ transform: poseTransform(pose) }}>
          <g ref={bodyRef}>
            <RocketShape flame={flameRef} flameScale={scripted ? 1 : FLAME_SCALE[stage]} flicker={flameOn || scripted} />
          </g>
        </g>
        <g transform={`translate(${round(landed.x)} ${round(landed.y)})`}>
          <g ref={puffRef} className="rocket-puffs" aria-hidden="true">
            {PUFFS.map(([dx], i) => (
              <circle key={i} cx={dx * 0.4} cy="-1" r={i === 2 ? 4 : 5} />
            ))}
          </g>
        </g>
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="rocket-mark-caption"
          style={{ left: `${(CAPTION_X / VIEW_W) * 100}%`, top: `${(captionY[i]! / VIEW_H) * 100}%`, paddingBlock: captionPad(captionY, i) }}
          aria-label={`${copy.marks.mark}: ${mark.label}`}
          onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}
        >
          {shortLabel(mark.label)}
        </button>
      ))}
    </div>
  );
}

// ---- Mini: a square, legible at 28 px ----

const MINI_PLANET = P(29.5, 10.5);
const MINI_ROCKET = 0.44;
/** The rocket's length on the mini's path, viewBox units. */
const MINI_BODY = 28 * MINI_ROCKET;
/** The parked rocket stands out from the planet's left side at this heading. */
const MINI_PARK = -70;

interface MiniScene {
  r: number;
  d: string;
  table: Sample[];
  /** Share of the path the tail covers: the nose reaches the planet at fill 1. */
  reach: number;
  parked: RocketPose;
}

const miniScene = cached((level): MiniScene => {
  const p = planetFor(level);
  const r = r1(Math.min(8, (10 * p.r) / reachOf(p)));
  const a = (MINI_PARK * Math.PI) / 180;
  const end = P(r1(MINI_PLANET.x + Math.sin(a) * r), r1(MINI_PLANET.y - Math.cos(a) * r));
  const path: Cubic = [P(9.5, 33), P(9.5, 25), P(end.x - 12, end.y + 9), end];
  const { samples, length } = buildTable([path], 48);
  return { r, d: `M9.5 33 C9.5 25 ${end.x - 12} ${end.y + 9} ${end.x} ${end.y}`, table: samples, reach: 1 - MINI_BODY / length, parked: { ...end, angle: MINI_PARK } };
});

export function miniPose(fill: number, level = 1): RocketPose {
  const m = miniScene(level);
  return sampleAt(m.table, clamp(fill) * m.reach);
}

/** The mini also takes the level (outside the contract): it shows that level's destination. */
export function RocketMini({ fill, state = 'active', size = 32, label, level: levelProp }: ProgressMiniProps & { level?: number }) {
  const idPrefix = `rocketmini${useId().replace(/[^\w-]/g, '')}`;
  const level = levelOf(levelProp);
  const f = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const m = miniScene(level);
  const complete = state === 'complete';
  const flying = state === 'active' && f > 0 && f < 1;
  const tail = complete ? 1 : f * m.reach;
  const pose = complete ? m.parked : miniPose(f, level);
  const from = level > 1 ? planetFor(level - 1) : null;
  return (
    <svg
      className={`rocket rocket--mini rocket--${state}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={label ?? rocketTheme.text.fillLabel(Math.floor(f * 100))}
    >
      <clipPath id={`${idPrefix}-box`}>
        <rect x="0" y="0" width="40" height="40" />
      </clipPath>
      <clipPath id={`${idPrefix}-earth`}>
        <circle cx="6" cy="62" r="28" />
      </clipPath>
      <g clipPath={`url(#${idPrefix}-box)`}>
        {from ? (
          <g className={planetClass(from)}>
            <circle cx="6" cy="62" r="28" fill={from.base || undefined} className="rk-pb" />
            <circle cx="6" cy="62" r="28" className="rocket-planet-rim" />
          </g>
        ) : (
          <>
            <circle cx="6" cy="62" r="28" className="rocket-ocean" />
            <g clipPath={`url(#${idPrefix}-earth)`}>
              <path className="rocket-land" d="M-4 42 C-2 37 3 33.5 9 34.5 C15 35.5 14 42 14 42 Z" />
            </g>
          </>
        )}
      </g>
      <Disc p={planetFor(level)} x={MINI_PLANET.x} y={MINI_PLANET.y} r={m.r} id={`${idPrefix}-d`} gold={complete} />
      {size >= 34 && <path d={m.d} className="rocket-route rocket-route--mini" />}
      <path d={m.d} pathLength={1} className="rocket-trail rocket-trail--mini" style={{ strokeDashoffset: `${1 - tail}px`, opacity: tail > 0 ? 1 : 0 }} />
      <g style={{ transform: poseTransform(pose, MINI_ROCKET) }}>
        {flying && <path className="rocket-flame" d="M-4.6 1 C-4.6 8 -1.6 12 0 18 C1.6 12 4.6 8 4.6 1 Z" />}
        <RocketShape flame="none" />
      </g>
    </svg>
  );
}

export const rocketTheme: ProgressThemeDefinition = {
  key: 'rocket',
  available: true,
  text: {
    name: 'Ракета',
    levelNoun: 'Полёт',
    levelGenitive: 'полёта',
    levelForms: ['полёт', 'полёта', 'полётов'],
    levelFormsOf: ['полёта', 'полётов', 'полётов'],
    completed: (n: number) => `Полёт ${n} завершён`,
    fillLabel: (percent: number) => `Ракета пролетела ${percent}% пути`,
    hint: 'Ракета летит от планеты к планете',
  },
  Hero,
  Mini: RocketMini,
  markPoint,
};
