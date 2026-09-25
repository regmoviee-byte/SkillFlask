import { memo, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '../../../lib/format';
import { scaleTicks } from '../../components/flaskScale';
import { DONE_EVENT, FINISH_FALLBACK_MS, IDLE, nextPhase, refillTarget, type AnimationState, type PhaseTiming } from '../../components/flaskAnimation';
import { copy } from '../../copy';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import './tower.css';

// «Башня»: toy blocks stack up on a patch of ground. Eight blocks make a level: floor(fill × 8)
// sit in place and the next one hangs from a crane rope, lowering into its slot as the
// remainder grows. The level-up beat: the eighth block lands, a flag pops on top, the tower
// shrinks and moves into its slot of the city behind the ground line, and a fresh base is
// refilled. The city is every finished tower of past levels (`level − 1` buildings, seeded by
// their index): two depth layers of buildings with windows and a hazy far skyline for the
// oldest ones. At night (the dark theme) its windows glow warm and switch on and off slowly, as
// if people lived there; by day they reflect the sky. The blocks carry the skill colour; ground,
// flag, rope, bird and city are natural colours (tower.css). Only transform and opacity animate;
// the idle motion is the bird or the waving flag, plus the calm lamps of the city (.anim-decor).

// Geometry (viewBox 0 0 160 260).
const VIEW_W = 160;
const VIEW_H = 260;
/** Top of the ground: the lowest block stands here. */
const BASE = 238;
export const BLOCKS = 8;
const BLOCK_H = 22;
const BLOCK_W = 66;
const BLOCK_X = 80 - BLOCK_W / 2;
const TOWER_H = BLOCKS * BLOCK_H;
/** Top of the eighth block. */
const TOP = BASE - TOWER_H;
/** How far above its slot the next block hangs at the start of its share, viewBox units. */
export const HANG = 46;

// Marks: a pennant on a short pole on the right side of the tower; captions further right.
const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const POLE_X = BLOCK_X + BLOCK_W + 6;
const MARK_HIGHEST = TOP;
const MARK_LOWEST = BASE - 4;
const CAPTION_GAP = 18;
const CAPTION_X = 130;
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Blocks standing in place at `fill`: 0 … 8; the eighth lands only at the beat (fill 1). */
export function towerBlocks(fill: number): number {
  return Math.min(BLOCKS, Math.floor(clamp(fill) * BLOCKS + 1e-9));
}

/** Share of the next block already lowered, 0..1 (0 when the tower is complete). */
export function towerRemainder(fill: number): number {
  const placed = towerBlocks(fill);
  return placed >= BLOCKS ? 0 : Math.min(1, Math.max(0, clamp(fill) * BLOCKS - placed));
}

/** Top edge of block `i` (0 is the lowest), viewBox units. */
export function blockTop(i: number): number {
  return BASE - (i + 1) * BLOCK_H;
}

/** Where the hanging block's top is at `fill`: HANG above its slot at the start, in place at the end. */
export function hangY(fill: number): number {
  const placed = towerBlocks(fill);
  if (placed >= BLOCKS) return blockTop(BLOCKS - 1);
  return blockTop(placed) - (1 - towerRemainder(fill)) * HANG;
}

function markY(height: number): number {
  return Math.min(Math.max(BASE - clamp(height) * TOWER_H, MARK_HIGHEST), MARK_LOWEST);
}

/** Where a mark at `height` sits: a pennant on the right side of the tower, rising with the height. */
export function towerMarkPoint(height: number): { x: number; y: number } {
  return { x: POLE_X, y: markY(height) };
}

// ---- The city: the finished towers of past levels, behind the ground line ----
//
// Tower k (0-based: the one of level k + 1) stands in slot k mod CITY_SLOTS, so a building never
// moves once placed. The CITY_SLOTS newest stand as buildings with windows in two depth layers;
// older ones melt into a hazy far skyline (one silhouette path) that keeps growing past 60
// levels. Shapes, windows and lamp schedules are seeded by the tower's index: the same city on
// every visit.

/** Skyline slots in the order they fill, beside the tower first, then behind it: [centre x, far]. */
const SLOTS: readonly (readonly [number, boolean])[] = [
  [38, false],
  [122, false],
  [27, true],
  [133, true],
  [19, false],
  [141, false],
  [50, true],
  [110, true],
  [61, false],
  [99, false],
  [71, true],
  [89, true],
];
export const CITY_SLOTS = SLOTS.length;
/** Buildings stay between these x: the ground strip hides their feet. */
export const CITY_LEFT = 10;
export const CITY_RIGHT = 150;
/** Columns of the far haze: towers older than the CITY_SLOTS newest. */
export const HAZE_COLS = 36;
/** Walls reach below the grass, so no foot shows. */
const FOOT = BASE + 6;

interface CityLayer {
  w: [number, number];
  h: [number, number];
  /** Pane size and the gaps between panes. */
  pane: [number, number];
  gap: [number, number];
  margin: number;
  roof: number;
  /** Flats per building whose lamps switch on and off. */
  live: number;
}
const NEAR: CityLayer = { w: [13, 17], h: [44, 86], pane: [2.4, 2.8], gap: [1.8, 3], margin: 2.2, roof: 4, live: 6 };
const FAR: CityLayer = { w: [10, 14], h: [60, 108], pane: [1.8, 2.1], gap: [1.6, 2.5], margin: 1.8, roof: 3.5, live: 4 };

export type Roof = 'flat' | 'step' | 'gable' | 'spire' | 'slant' | 'tank';
const ROOFS: Roof[] = ['flat', 'step', 'gable', 'spire', 'slant', 'tank'];

/** Lamp patterns (tower.css @keyframes tower-lamp-0/1/2): lit spans as shares of the period. */
export const LAMP_PATTERNS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 0.55]],
  [[0, 0.28]],
  [
    [0, 0.2],
    [0.48, 0.72],
  ],
];
/** A lamp fades in or out over this share of its period (1.1–2.5 s). */
export const LAMP_FADE = 0.035;
/** Share of the other flats lit all evening. */
const LIT_SHARE = 0.3;

export interface CityLamp {
  /** Panes of one flat lit together, [x, y] of their top left corners. */
  panes: [number, number][];
  /** Switches on and off by `pattern`; otherwise lit all evening. */
  live: boolean;
  pattern: number;
  /** Seconds per cycle, and how far into it the lamp starts. */
  period: number;
  offset: number;
  /** Lit when nothing moves (reduced motion). */
  rest: boolean;
  /** Also lit by day (the light theme). */
  day: boolean;
  /** A paler bulb. */
  pale: boolean;
}

export interface CityBuilding {
  index: number;
  far: boolean;
  x: number;
  w: number;
  /** Top of the walls, and the highest point of the roof. */
  top: number;
  peak: number;
  roof: Roof;
  /** Walls and roof, down below the ground line. */
  path: string;
  pane: [number, number];
  panes: [number, number][];
  lamps: CityLamp[];
  /** Tip of the spire: a red beacon at night. */
  beacon?: [number, number];
}

export interface CityHaze {
  columns: { x: number; w: number; top: number }[];
  path: string;
  /** Faint far lights (night only). */
  lights: string;
}

/** A deterministic pseudo-random number in [0, 1) for (seed, salt). */
export function cityRandom(seed: number, salt: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((salt | 0) + 0x7f4a7c15, 0x85ebca77);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const box = (x: number, y: number, w: number, h: number) => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
const span = ([lo, hi]: [number, number], v: number) => lo + v * (hi - lo);

const buildings = new Map<number, CityBuilding>();

/** The building of finished tower `index` (0-based), always the same. */
export function cityBuilding(index: number): CityBuilding {
  const k = Math.max(0, Math.floor(index) || 0);
  const cached = buildings.get(k);
  if (cached) return cached;
  const r = (salt: number) => cityRandom(k, salt);
  const [cx, far] = SLOTS[k % CITY_SLOTS]!;
  const L = far ? FAR : NEAR;
  const w = r1(span(L.w, r(1)));
  // Later towers stand a little taller: the city grows up as well as out.
  const h = r1(span(L.h, r(2)) * (1 + 0.12 * Math.min(1, k / 48)));
  const x = r1(cx - w / 2);
  const top = BASE - h;
  const roof = ROOFS[Math.floor(r(3) * ROOFS.length)]!;
  let path = box(x, top, w, FOOT - top);
  let peak = top;
  let beacon: [number, number] | undefined;
  if (roof === 'flat') {
    path += box(x - 0.6, top - 1.4, w + 1.2, 1.9);
    peak = top - 1.4;
  } else if (roof === 'step') {
    const s = 5 + r(4) * 5;
    const sw = w * (0.5 + r(5) * 0.2);
    path += box(cx - sw / 2, top - s, sw, s + 0.5);
    peak = top - s;
  } else if (roof === 'gable') {
    const g = w * (0.3 + r(4) * 0.15);
    path += `M${x} ${r1(top + 0.5)}L${cx} ${r1(top - g)}L${r1(x + w)} ${r1(top + 0.5)}Z`;
    peak = top - g;
  } else if (roof === 'spire') {
    const s = 8 + r(4) * 7;
    const sx = cx + (r(5) - 0.5) * w * 0.4;
    path += box(sx - 0.6, top - s, 1.2, s + 0.5);
    peak = top - s;
    beacon = [r1(sx), r1(peak)];
  } else if (roof === 'slant') {
    const s = 4 + r(4) * 4;
    const left = r(5) < 0.5;
    path = `M${x} ${FOOT}V${r1(left ? top - s : top)}L${r1(x + w)} ${r1(left ? top : top - s)}V${FOOT}Z`;
    peak = top - s;
  } else {
    path += box(x + w * (0.15 + r(4) * 0.4), top - 3.6, 3.4, 4.1);
    peak = top - 3.6;
  }

  // Windows: a centred grid from under the roof down to the ground; flats of one or two panes.
  const [pw, ph] = L.pane;
  const [gx, gy] = L.gap;
  const cols = Math.max(1, Math.floor((w - 2 * L.margin + gx) / (pw + gx)));
  const rows = Math.max(1, Math.floor((BASE - 4 - (top + L.roof) + gy) / (ph + gy)));
  const x0 = x + (w - (cols * pw + (cols - 1) * gx)) / 2;
  const panes: [number, number][] = [];
  const flats: [number, number][][] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const pane: [number, number] = [r1(x0 + col * (pw + gx)), r1(top + L.roof + row * (ph + gy))];
      panes.push(pane);
      const last = flats[flats.length - 1];
      // A flat of two panes: this one joins the one on its left.
      if (col > 0 && last?.length === 1 && last[0]![1] === pane[1] && r(100 + panes.length) < 0.4) last.push(pane);
      else flats.push([pane]);
    }
  }
  const live = new Set(
    flats
      .map((_, i) => i)
      .sort((a, b) => r(500 + a) - r(500 + b))
      .slice(0, L.live),
  );
  const lamps: CityLamp[] = [];
  flats.forEach((flat, i) => {
    const q = (s: number) => r(1000 + i * 8 + s);
    if (live.has(i)) {
      const period = r1(32 + q(0) * 40);
      lamps.push({ panes: flat, live: true, pattern: Math.floor(q(1) * LAMP_PATTERNS.length), period, offset: r1(q(2) * period), rest: q(3) < 0.45, day: q(4) < 0.5, pale: q(5) < 0.3 });
    } else if (q(0) < LIT_SHARE) {
      lamps.push({ panes: flat, live: false, pattern: 0, period: 0, offset: 0, rest: true, day: q(4) < 0.1, pale: q(5) < 0.3 });
    }
  });

  const building: CityBuilding = { index: k, far, x, w, top, peak, roof, path, pane: L.pane, panes, lamps, beacon };
  buildings.set(k, building);
  return building;
}

// Haze columns take their places across the width in a scattered order.
const HAZE_ORDER = Array.from({ length: HAZE_COLS }, (_, i) => i).sort((a, b) => cityRandom(a, 900) - cityRandom(b, 900));

/** The far skyline of the `older` towers that no longer stand as buildings; null when none. */
export function cityHaze(older: number): CityHaze | null {
  const n = Math.max(0, Math.floor(older) || 0);
  if (!n) return null;
  // It keeps rising slowly after every column has its place.
  const grow = Math.min(1.25, 0.75 + n / 100);
  const step = (CITY_RIGHT - CITY_LEFT) / HAZE_COLS;
  const columns = HAZE_ORDER.slice(0, Math.min(HAZE_COLS, n)).map((pos) => {
    const w = 4 + cityRandom(pos, 901) * 3;
    const x = Math.min(CITY_RIGHT - w, Math.max(CITY_LEFT, CITY_LEFT + (pos + 0.5) * step - w / 2));
    return { x: r1(x), w: r1(w), top: r1(BASE - (50 + cityRandom(pos, 902) * 60) * grow), pos };
  });
  const lights = columns
    .filter((c) => cityRandom(c.pos, 903) < 0.7)
    .map((c) => box(c.x + 1 + cityRandom(c.pos, 904) * (c.w - 2.2), c.top + 4 + cityRandom(c.pos, 905) * (BASE - 14 - c.top), 0.9, 0.9))
    .join('');
  return { columns: columns.map(({ x, w, top }) => ({ x, w, top })), path: columns.map((c) => box(c.x, c.top, c.w, FOOT - c.top)).join(''), lights };
}

/** The skyline of `count` finished towers: far buildings first, then near ones, and the haze. */
export function skylineLayout(count: number): { buildings: CityBuilding[]; haze: CityHaze | null } {
  const n = Math.max(0, Math.floor(count) || 0);
  const list: CityBuilding[] = [];
  for (let k = Math.max(0, n - CITY_SLOTS); k < n; k++) list.push(cityBuilding(k));
  list.sort((a, b) => Number(b.far) - Number(a.far) || a.index - b.index);
  return { buildings: list, haze: cityHaze(n - CITY_SLOTS) };
}

/** Whether a lamp is lit `t` seconds after its animation started (the CSS keyframes, halfway through a fade). */
export function lampLitAt(lamp: CityLamp, t: number): boolean {
  if (!lamp.live) return true;
  const p = ((((t + lamp.offset) / lamp.period) % 1) + 1) % 1;
  return (LAMP_PATTERNS[lamp.pattern] ?? []).some(([on, off]) => p >= on + LAMP_FADE / 2 && p < off + LAMP_FADE / 2);
}

/**
 * Timings of the level-up: land 250 ms (spring), the flag beat 330, into the city 40 + 300,
 * refill 280 — 1.2 s for one level; each compressed repeat (into the city + refill) 440 ms.
 */
export function towerTiming(state: AnimationState): PhaseTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 250, easing: 'spring' };
    case 'overflow':
      return { delay: 0, duration: 330, easing: 'out' };
    case 'draining':
      return compressed ? { delay: 30, duration: 200, easing: 'out' } : { delay: 40, duration: 300, easing: 'out' };
    case 'refilling':
      return compressed ? { delay: 0, duration: 210, easing: 'out' } : { delay: 0, duration: 280, easing: 'spring' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

export const towerText: ProgressThemeText = {
  name: 'Башня',
  levelNoun: 'Башня',
  levelGenitive: 'башни',
  levelForms: ['башня', 'башни', 'башен'],
  levelFormsOf: ['башни', 'башен', 'башен'],
  completed: (n) => `Башня ${n} построена`,
  fillLabel: (percent) => `Башня построена на ${percent}%`,
  hint: 'Кубики ставятся друг на друга',
};

function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Caption y positions, at least CAPTION_GAP apart and inside the box. */
function captionYs(ys: number[]): number[] {
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

/** Vertical padding of caption `i`, px: grows towards a 44 px tap area without covering a neighbour. */
function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) - CAPTION_LINE : CAPTION_PAD_MAX;
  return Math.round(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Awaits an animation, or its duration plus a margin when `finished` never settles (old WebViews). */
function done(animation: Animation, duration: number): Promise<void> {
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration + FINISH_FALLBACK_MS)]);
}

let cachedEasing: Record<PhaseTiming['easing'], string> | null = null;
function easings(): Record<PhaseTiming['easing'], string> {
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
    return el.animate(keyframes, { ...options, easing: 'ease-out' });
  }
}

let pauseInstalled = false;
/** html.paused while the page is hidden: the idle bird and flag stop burning frames. */
function installPauseWhenHidden(): void {
  if (pauseInstalled || typeof document === 'undefined') return;
  pauseInstalled = true;
  const sync = () => document.documentElement.classList.toggle('paused', document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', sync);
  sync();
}

const ty = (y: number) => `translateY(${y.toFixed(2)}px)`;

/** One toy block with its top at `y`: a rounded body, a lighter top edge and an inset face. */
function Block({ y, index, detail = true }: { y: number; index: number; detail?: boolean }) {
  return (
    <g className={`tower-block tower-block--${index % 2 ? 'b' : 'a'}`}>
      <rect x={BLOCK_X} y={y} width={BLOCK_W} height={BLOCK_H - 1.5} rx="4" className="tower-block-body" />
      <rect x={BLOCK_X + 2.5} y={y + 2} width={BLOCK_W - 5} height="4" rx="2" className="tower-block-top" />
      {detail && <rect x={BLOCK_X + 9} y={y + 8} width={BLOCK_W - 18} height={BLOCK_H - 13.5} rx="2.5" className="tower-block-face" />}
    </g>
  );
}

/** The flag on top of a finished tower: a pole and a pennant that waves while idle. */
function Flag({ wave, poleRef, clothRef }: { wave: boolean; poleRef?: Ref<SVGGElement>; clothRef?: Ref<SVGGElement> }) {
  return (
    <>
      <g ref={poleRef} className="tower-flag-pole">
        <line x1="80" x2="80" y1={TOP} y2={TOP - 34} />
        <circle cx="80" cy={TOP - 35} r="2.6" className="tower-flag-knob" />
      </g>
      <g ref={clothRef} className="tower-flag-cloth">
        <path d={`M81 ${TOP - 34} Q94 ${TOP - 37} 108 ${TOP - 28} Q94 ${TOP - 20} 81 ${TOP - 21} Z`} className={wave ? 'anim-decor' : undefined} />
      </g>
    </>
  );
}

const panePath = (panes: [number, number][], [w, h]: [number, number]) => panes.map(([x, y]) => box(x, y, w, h)).join('');

/** One building of the city: walls, dark (or sky-lit) panes, and the lamps of its flats. */
const Building = memo(function Building({ b }: { b: CityBuilding }) {
  // Lamps lit all evening share a path per kind; each live one animates on its own schedule.
  const steady = new Map<string, [number, number][]>();
  for (const lamp of b.lamps) {
    if (lamp.live) continue;
    const kind = `${lamp.day ? ' tower-lamp--day' : ''}${lamp.pale ? ' tower-lamp--pale' : ''}`;
    steady.set(kind, [...(steady.get(kind) ?? []), ...lamp.panes]);
  }
  return (
    <g className={`tower-bld tower-bld--${b.far ? 'far' : 'near'}`} data-index={b.index}>
      <path d={b.path} className="tower-bld-wall" />
      <path d={panePath(b.panes, b.pane)} className="tower-bld-panes" />
      {[...steady].map(([kind, panes]) => (
        <path key={kind} d={panePath(panes, b.pane)} className={`tower-lamp${kind}`} />
      ))}
      {b.lamps
        .filter((lamp) => lamp.live)
        .map((lamp) => (
          <path
            key={`${lamp.panes[0]![0]}-${lamp.panes[0]![1]}`}
            d={panePath(lamp.panes, b.pane)}
            className={`tower-lamp anim-decor tower-lamp--p${lamp.pattern}${lamp.rest ? '' : ' tower-lamp--rest-off'}${lamp.day ? ' tower-lamp--day' : ''}${lamp.pale ? ' tower-lamp--pale' : ''}`}
            style={{ animationDuration: `${lamp.period}s`, animationDelay: `-${lamp.offset}s` }}
          />
        ))}
      {b.beacon && <circle cx={b.beacon[0]} cy={b.beacon[1]} r="0.9" className="tower-beacon" />}
    </g>
  );
});

/** The city behind the ground line: the haze of the oldest towers, then far and near buildings. */
const City = memo(function City({ count, leaving, cityRef }: { count: number; leaving: number | null; cityRef: Ref<SVGGElement> }) {
  const { buildings: list, haze } = useMemo(() => skylineLayout(count), [count]);
  // A building leaving for the haze fades out in the slot the newest one takes.
  const shown = leaving !== null && !list.some((b) => b.index === leaving) ? [cityBuilding(leaving), ...list].sort((a, b) => Number(b.far) - Number(a.far) || a.index - b.index) : list;
  return (
    <g ref={cityRef} className="tower-city" aria-hidden="true">
      {haze && (
        <g className="tower-haze">
          <path d={haze.path} className="tower-haze-wall" />
          <path d={haze.lights} className="tower-haze-lights" />
        </g>
      )}
      {shown.map((b) => (
        <Building key={b.index} b={b} />
      ))}
    </g>
  );
});

// The night sky (dark theme only): a crescent moon at the top left and a few faint stars.
const MOON = 'M24 23A7 7 0 0 0 24 37A8.75 8.75 0 0 1 24 23Z';
const STARS = [
  [10, 60, 0.8],
  [44, 14, 0.9],
  [60, 44, 0.6],
  [118, 12, 0.7],
  [140, 34, 0.9],
  [152, 70, 0.6],
  [8, 12, 0.6],
]
  .map(([x, y, r]) => `M${x! - r!} ${y}a${r} ${r} 0 1 0 ${2 * r!} 0a${r} ${r} 0 1 0 ${-2 * r!} 0Z`)
  .join('');

// The beat's sparks around the flag: [x, y, dx, dy].
const SPARKS: [number, number, number, number][] = [
  [70, TOP - 28, -18, -10],
  [92, TOP - 40, 6, -18],
  [108, TOP - 26, 18, -6],
  [64, TOP - 8, -20, 6],
  [100, TOP - 6, 20, 4],
];

function TowerHero({ fill, capacity, level, state = 'active', motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);

  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  // The city: `level − 1` finished towers. A level-up holds the count while it plays and adds
  // each tower as it moves in; `anchor` keeps them until the level prop catches up (or for good,
  // when no level is passed: then the city is the towers finished during this visit).
  const levelCount = Math.max(0, (Math.floor(level ?? 1) || 1) - 1);
  const [cityOverride, setCityOverride] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ from: number; count: number } | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const city = cityOverride ?? (anchor && anchor.from === levelCount ? Math.max(anchor.count, levelCount) : levelCount);
  const cityShown = useRef(city);
  cityShown.current = city;
  const levelCountRef = useRef(levelCount);
  levelCountRef.current = levelCount;
  const levelGiven = useRef(level !== undefined);
  levelGiven.current = level !== undefined;
  const playing = useRef(false);
  const playToken = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const shown = override ?? target;

  const svgRef = useRef<SVGSVGElement>(null);
  const stackRef = useRef<SVGGElement>(null);
  const blocksRef = useRef<SVGGElement>(null);
  const nextRef = useRef<SVGGElement>(null);
  const ghostRef = useRef<SVGRectElement>(null);
  const poleRef = useRef<SVGGElement>(null);
  const clothRef = useRef<SVGGElement>(null);
  const sparksRef = useRef<SVGGElement>(null);
  const cityRef = useRef<SVGGElement>(null);
  // useId() may contain characters that break url(#id) references.
  const id = `tower${useId().replace(/[^\w-]/g, '')}`;
  const buildingEl = (index: number) => cityRef.current?.querySelector(`[data-index="${index}"]`) ?? null;

  useEffect(installPauseWhenHidden, []);

  // Once the level prop moves, it is the truth again (an undone write takes its tower back).
  useLayoutEffect(() => setAnchor((a) => (a && a.from !== levelCount ? null : a)), [levelCount]);

  // Towers that join the city outside a level-up (a jump of several levels, a later visit)
  // fade in where they stand.
  const previousCity = useRef(city);
  useLayoutEffect(() => {
    const from = previousCity.current;
    previousCity.current = city;
    if (playing.current || city <= from) return;
    for (let k = Math.max(from, city - CITY_SLOTS); k < city; k++) {
      animate(buildingEl(k), [{ opacity: 0 }, { opacity: 1 }], { duration: motion === 'reduced' ? 240 : 600, easing: 'ease-out' });
    }
  }, [city, motion]);

  // Prop-driven changes: newly placed blocks drop in; a crossfade under reduced motion. A layout
  // effect, so a new block never shows in place for a frame before it drops.
  const previous = useRef(target);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (playing.current || from === target) return;
    setOverride(null);
    if (motion === 'reduced') {
      animate(stackRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    const before = towerBlocks(from);
    const after = towerBlocks(target);
    const blocks = Array.from(blocksRef.current?.children ?? []);
    for (let i = before; i < after; i++) {
      animate(blocks[i], [{ transform: ty(-16), opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 320,
        delay: (i - before) * 50,
        easing: easings().spring,
        fill: 'backwards',
      });
    }
  }, [target, motion]);

  // Completing the skill on screen: the flag pops up (never on first load).
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete' || !clothRef.current) return;
    const keyframes = motion === 'reduced' ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }];
    animate(clothRef.current, keyframes, { duration: motion === 'reduced' ? 240 : 500, easing: motion === 'reduced' ? 'ease-out' : easings().spring });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const stack = stackRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        const count = Math.max(1, Math.floor(levels) || 1);
        const levelFrom = levelCountRef.current;
        // The app renders the new level before it plays (the contract's level rule): the city of
        // the completed level is `level − levels − 1` towers, whatever the new props already show.
        // Without a level prop the city is the towers finished during this visit, as on screen.
        const cityFrom = levelGiven.current ? Math.max(0, Math.min(cityShown.current, levelFrom - count)) : cityShown.current;
        if (!stack || typeof stack.animate !== 'function') {
          // No WAAPI (old WebViews, tests): the finished towers simply join the city.
          onOverflow?.();
          if (stack) flushSync(() => setAnchor({ from: levelFrom, count: cityFrom + count }));
          return;
        }
        playing.current = true;
        const running: Animation[] = [];
        const track = (a: Animation | null): Animation | null => {
          if (a) running.push(a);
          return a;
        };
        // The app has already rendered the new level at `toFill` (the contract's level rule):
        // the choreography starts from `fromFill`, the completed level's fill (the caller lowers
        // it to what was on screen when writes overlap).
        const start = clamp(fromFill);
        const end = clamp(toFill);
        flushSync(() => {
          setScripted(true);
          setOverride(start);
          setCityOverride(cityFrom);
        });

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            flushSync(() => {
              setOverride(end);
              setCityOverride(cityFrom + count);
            });
            const fades = [stack, ...Array.from({ length: Math.min(count, CITY_SLOTS) }, (_, i) => buildingEl(cityFrom + count - 1 - i))].map((el, i) =>
              track(animate(el, [{ opacity: i ? 0 : 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })),
            );
            await Promise.all(fades.map((a) => (a ? done(a, 240) : undefined)));
            return;
          }
          const ease = easings();
          let current = start;
          const settle = (list: (Animation | null)[], duration: number) =>
            Promise.all(list.map((a) => (a ? done(a, duration + (Number(a.effect?.getTiming().delay) || 0)) : Promise.resolve())));

          // The eighth block is lowered into its slot; missing blocks below pop in first.
          const land = async (timing: PhaseTiming) => {
            const before = towerBlocks(current);
            if (before < BLOCKS - 1) {
              current = (BLOCKS - 1) / BLOCKS;
              flushSync(() => setOverride(current));
              const blocks = Array.from(blocksRef.current?.children ?? []);
              for (let i = before; i < BLOCKS - 1; i++) {
                track(animate(blocks[i], [{ transform: ty(-14), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 160, delay: (i - before) * 18, easing: ease.out, fill: 'backwards' }));
              }
            }
            const a = track(animate(nextRef.current, [{ transform: ty(hangY(current)) }, { transform: ty(blockTop(BLOCKS - 1)) }], { duration: timing.duration, easing: ease[timing.easing], fill: 'forwards' }));
            if (a) await done(a, timing.duration);
            current = 1;
            flushSync(() => setOverride(1));
          };

          // The beat: the rope lets go, the tower settles, the flag pops up with a few sparks.
          const beat = async (timing: PhaseTiming) => {
            const d = timing.duration;
            const list = [
              track(animate(nextRef.current, [{ transform: ty(blockTop(BLOCKS - 1)), opacity: 1 }, { transform: ty(blockTop(BLOCKS - 1) - 80), opacity: 0 }], { duration: d * 0.7, easing: ease.in, fill: 'forwards' })),
              track(animate(stack, [{ transform: 'none' }, { transform: 'scale(1.03, 0.96)', offset: 0.3 }, { transform: 'none' }], { duration: d * 0.6, easing: 'ease-out' })),
              track(animate(poleRef.current, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: d * 0.45, delay: d * 0.1, easing: ease.out, fill: 'backwards' })),
              track(animate(clothRef.current, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: d * 0.55, delay: d * 0.4, easing: ease.spring, fill: 'backwards' })),
            ];
            Array.from(sparksRef.current?.children ?? []).forEach((spark, i) => {
              const [, , dx, dy] = SPARKS[i]!;
              list.push(
                track(
                  animate(spark, [{ transform: 'translate(0, 0) scale(0.4)', opacity: 0 }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1)`, opacity: 1, offset: 0.35 }, { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0 }], {
                    duration: d * 0.6,
                    delay: d * 0.4,
                    easing: 'ease-out',
                    fill: 'backwards',
                  }),
                ),
              );
            });
            await settle(list, d);
          };

          // The reset: the finished tower shrinks and moves into its slot of the city, fading
          // into the building that stands there from now on (the one it replaces fades out).
          const intoCity = async (timing: PhaseTiming, cycle: number) => {
            const index = cityFrom + cycle;
            const b = cityBuilding(index);
            const old = index >= CITY_SLOTS ? index - CITY_SLOTS : null;
            flushSync(() => {
              setCityOverride(index + 1);
              setLeaving(old);
            });
            const d = timing.duration;
            const moved = `translate(${r1(b.x + b.w / 2 - 80)}px, 0px) scale(${(b.w / BLOCK_W).toFixed(3)}, ${((BASE - b.top) / TOWER_H).toFixed(3)})`;
            const list = [
              track(animate(stack, [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.55 }, { transform: moved, opacity: 0 }], { duration: d, easing: ease[timing.easing], fill: 'forwards' })),
              track(animate(buildingEl(index), [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: d, easing: 'ease-out', fill: 'backwards' })),
            ];
            if (old !== null) list.push(track(animate(buildingEl(old), [{ opacity: 1 }, { opacity: 0 }], { duration: d * 0.6, easing: 'ease-out', fill: 'forwards' })));
            await settle(list, d);
            current = 0;
            flushSync(() => {
              setOverride(0);
              setLeaving(null);
            });
            list[0]?.cancel();
          };

          // The fresh base: blocks drop in from above one after another, then the crane block.
          const refill = async (to: number, timing: PhaseTiming) => {
            current = to;
            flushSync(() => setOverride(to));
            const d = timing.duration;
            const placed = towerBlocks(to);
            const blocks = Array.from(blocksRef.current?.children ?? []);
            const step = placed > 1 ? (d * 0.45) / (placed - 1) : 0;
            const list = blocks.slice(0, placed).map((block, i) =>
              track(animate(block, [{ transform: ty(-40), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: d * 0.55, delay: i * step, easing: ease[timing.easing], fill: 'backwards' })),
            );
            if (placed < BLOCKS) {
              const y = hangY(to);
              list.push(track(animate(nextRef.current, [{ transform: ty(y - 50), opacity: 0 }, { transform: ty(y), opacity: 1 }], { duration: d, easing: ease.out, fill: 'forwards' })));
              list.push(track(animate(ghostRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: d, easing: 'ease-out', fill: 'backwards' })));
            } else {
              list.push(track(animate(clothRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: d * 0.3, delay: d * 0.7, easing: 'ease-out', fill: 'backwards' })));
              list.push(track(animate(poleRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: d * 0.3, delay: d * 0.7, easing: 'ease-out', fill: 'backwards' })));
            }
            await settle(list, d);
          };

          let phase = nextPhase(IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = towerTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await land(timing);
                break;
              case 'overflow':
                onOverflow?.();
                await beat(timing);
                break;
              case 'draining':
                await intoCity(timing, phase.cycle);
                break;
              case 'refilling':
                await refill(refillTarget(phase, end), timing);
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
            // Towers past the three played ones join now (and fade in); the city keeps them.
            flushSync(() => {
              setLeaving(null);
              setCityOverride(null);
              // Kept only while the level prop has not moved yet (it may already have, at the beat).
              setAnchor(levelCountRef.current === levelFrom ? { from: levelFrom, count: cityFrom + count } : null);
            });
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

  const complete = state === 'complete';
  const placed = towerBlocks(shown);
  const full = placed >= BLOCKS || complete;
  const shownMarks = marks ?? [];
  const reserved = useRef(false);
  reserved.current = scripted ? reserved.current || shownMarks.length > 0 : shownMarks.length > 0;
  const marked = reserved.current;
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const captionY = captionYs(captioned.map((m) => markY(m.height)));
  const ticks = capacity !== undefined ? scaleTicks(capacity) : [];
  const tickMarks = (className: string) =>
    ticks.map(({ share, value }) => {
      const y = BASE - share * TOWER_H;
      return (
        <g key={share} className={className} aria-hidden="true">
          {marked ? <line x1={BLOCK_X - 9} x2={BLOCK_X - 4} y1={y} y2={y} /> : <line x1={BLOCK_X + BLOCK_W + 4} x2={BLOCK_X + BLOCK_W + 9} y1={y} y2={y} />}
          <text x={marked ? BLOCK_X - 12 : BLOCK_X + BLOCK_W + 12} y={y} dominantBaseline="central" textAnchor={marked ? 'end' : 'start'}>
            {formatNumber(value)}
          </text>
        </g>
      );
    });

  const classes = ['tower', 'tower--hero', `tower--${state}`, marked ? 'tower--marked' : '', scripted ? 'tower--scripted' : ''].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
      <svg ref={svgRef} className="tower-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label ?? towerText.fillLabel(Math.floor(shown * 100))}>
        <g className="tower-sky" aria-hidden="true">
          <path d={MOON} transform="rotate(-28 24 30)" className="tower-moon" />
          <path d={STARS} className="tower-stars" />
        </g>
        {!full && (
          <g className="tower-bird anim-decor" aria-hidden="true">
            <path d="M-34 0 q4 -4.5 8 0 q4 -4.5 8 0" />
          </g>
        )}
        {ticks.length > 0 && (
          // The numbers of the scale cut their shape out of the city behind them, so they stay clear.
          <mask id={`${id}-city`} maskUnits="userSpaceOnUse" x="0" y="0" width={VIEW_W} height={VIEW_H}>
            <rect width={VIEW_W} height={VIEW_H} fill="white" />
            {tickMarks('tower-tick tower-tick--knock')}
          </mask>
        )}
        <g mask={ticks.length > 0 ? `url(#${id}-city)` : undefined}>
          <City count={city} leaving={leaving} cityRef={cityRef} />
        </g>
        <g className="tower-ground" aria-hidden="true">
          <rect x="6" y={BASE} width="148" height="16" rx="8" className="tower-earth" />
          <rect x="6" y={BASE - 2} width="148" height="7" rx="3.5" className="tower-grass" />
          <circle cx="30" cy={BASE + 10} r="1.8" className="tower-pebble" />
          <circle cx="122" cy={BASE + 9} r="2.2" className="tower-pebble" />
          <circle cx="136" cy={BASE + 11.5} r="1.4" className="tower-pebble" />
        </g>
        {tickMarks('tower-tick')}
        <g ref={stackRef} className="tower-stack">
          {!full && <rect ref={ghostRef} x={BLOCK_X + 1} y={blockTop(placed) + 0.5} width={BLOCK_W - 2} height={BLOCK_H - 3} rx="4" className="tower-ghost" />}
          <g ref={blocksRef}>
            {Array.from({ length: complete ? BLOCKS : placed }, (_, i) => (
              <Block key={i} index={i} y={blockTop(i)} />
            ))}
          </g>
          {!complete && (placed < BLOCKS || scripted) && (
            <g ref={nextRef} className="tower-next" style={{ transform: ty(hangY(shown)) }}>
              <line x1="80" x2="80" y1="-320" y2="-15" className="tower-rope" />
              <path d={`M${BLOCK_X + 6} 0 L80 -13 L${BLOCK_X + BLOCK_W - 6} 0`} className="tower-sling" />
              <circle cx="80" cy="-14" r="3" className="tower-hook" />
              {placed < BLOCKS && <Block index={placed} y={0} />}
            </g>
          )}
          {full && <Flag wave={!scripted} poleRef={poleRef} clothRef={clothRef} />}
          {shownMarks.length > 0 && <line x1={POLE_X} x2={POLE_X} y1={BASE} y2={MARK_HIGHEST - 12} className="tower-mark-mast" />}
          {shownMarks.map((mark) => {
            const y = markY(mark.height);
            return (
              <g key={mark.id} className="tower-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
                <rect x={POLE_X - 12} y={y - 14} width="30" height="22" className="tower-mark-hit" />
                {/* Tied to the tower only where it is already built; higher marks hang on the mast alone. */}
                {y >= blockTop(Math.max(0, placed - 1)) && placed > 0 && <line x1={BLOCK_X + BLOCK_W - 1} x2={POLE_X} y1={y} y2={y} className="tower-mark-pole" />}
                <line x1={POLE_X} x2={POLE_X} y1={y + 1} y2={y - 12} className="tower-mark-pole" />
                <circle cx={POLE_X} cy={y} r="1.8" className="tower-mark-knot" />
                <path d={`M${POLE_X} ${y - 12}L${POLE_X + 9} ${y - 8.5}L${POLE_X} ${y - 5}Z`} className="tower-mark-flag" />
              </g>
            );
          })}
        </g>
        <g ref={sparksRef} className="tower-sparks" aria-hidden="true">
          {SPARKS.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" />
          ))}
        </g>
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="tower-mark-caption"
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

// Mini (viewBox 0 0 32 32): a column of eight slots on a strip of ground, placed blocks filled,
// with two small houses of the city behind it (a lit window or two at night).
const MINI_BASE = 28;
const MINI_BLOCK = 2.9;
const MINI_W = 16;
const MINI_X = 16 - MINI_W / 2;

function TowerMini({ fill, state = 'active', size = 32, label }: ProgressMiniProps) {
  const complete = state === 'complete';
  const shown = complete ? 1 : state === 'empty' ? 0 : clamp(fill);
  const placed = complete ? BLOCKS : towerBlocks(shown);
  const top = MINI_BASE - BLOCKS * MINI_BLOCK;
  return (
    <svg
      className={`tower-mini tower--${state}`}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label={label ?? towerText.fillLabel(Math.floor(shown * 100))}
    >
      <g className="tower-mini-city" aria-hidden="true">
        <path d="M2.8 29V19.6h4.8V29ZM24.4 29V16.4h1.6v-2.2h.9v2.2h2.3V29Z" className="tower-bld-wall" />
        <path d="M4 21.4h1v1.2H4ZM5.6 24.6h1v1.2h-1ZM25.7 18.6h1v1.2h-1ZM27.3 22.2h1v1.2h-1Z" className="tower-mini-lamps" />
      </g>
      <rect x={MINI_X} y={top} width={MINI_W} height={BLOCKS * MINI_BLOCK} rx="1.5" className="tower-mini-slot" />
      {Array.from({ length: placed }, (_, i) => (
        <rect
          key={i}
          x={MINI_X}
          y={MINI_BASE - (i + 1) * MINI_BLOCK + 0.25}
          width={MINI_W}
          height={MINI_BLOCK - 0.5}
          rx="0.9"
          className={`tower-mini-block tower-block--${i % 2 ? 'b' : 'a'}`}
        />
      ))}
      <rect x="3" y={MINI_BASE} width="26" height="3.5" rx="1.75" className="tower-grass" />
      {placed >= BLOCKS && (
        <>
          <line x1="16" x2="16" y1={top} y2={top - 4.6} className="tower-mini-pole" />
          <path d={`M16.5 ${top - 4.8} L22 ${top - 3.3} L16.5 ${top - 1.8} Z`} className="tower-mini-flag" />
        </>
      )}
    </svg>
  );
}

export const towerTheme: ProgressThemeDefinition = {
  key: 'tower',
  text: towerText,
  available: true,
  Hero: TowerHero,
  Mini: TowerMini,
  markPoint: towerMarkPoint,
};
