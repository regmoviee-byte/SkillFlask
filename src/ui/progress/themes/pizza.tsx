import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '../../../lib/format';
import { copy } from '../../copy';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMark, ProgressMiniProps, ProgressThemeDefinition } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import './pizza.css';

// The pizza («Пицца»): a round pizza of eight slices on a plate, seen from above. `fill` is
// the share eaten: whole slices vanish clockwise from 12 o'clock and the current slice shows
// a bite that grows with the remainder. The level-up choreography (eating → beat → away →
// arrive) is a small pure state machine below, driven through WAAPI; only transform and
// opacity animate. The idle steam is the one decorative loop (.anim-decor).

// ---- Geometry (viewBox 0 0 160 260) ----

const VIEW_W = 160;
const VIEW_H = 260;
/** Centre of the pizza; the plate takes the upper part of the box. */
const CX = 80;
const CY = 90;
const R_PLATE = 68;
const R_RING = 61;
const R_CRUST = 56;
const R_SAUCE = 49.5;
const R_CHEESE = 47;
/** Radius of the mark points: on the rim, between the crust and the plate ring. */
const R_MARK = 61;
export const SLICES = 8;
const SLICE_DEG = 360 / SLICES;
/** The serving (plate and pizza) is clipped here: it leaves and arrives past the table edge. */
const STAGE_BOTTOM = 168;
/** How far the serving travels when it leaves and arrives. */
const TRAVEL = 190;
/** The arriving serving settles past its place by this much (the plate stays clear of STAGE_BOTTOM). */
const ARRIVE_OVERSHOOT = 5;
/** The bite line, from the pizza centre: just past the tip at the first bite, the cheese edge at the last. */
const BITE_MIN = 12;
const BITE_MAX = 48.5;
/** The scallops along the bite line: radius and angular spread. */
const SCOOP = 7;
const SCOOP_DEG = 12;

// The capacity ruler under the plate (with `capacity`): 0 on the left, the capacity on the right.
const RULER_Y = 178;
const RULER_X0 = 30;
const RULER_X1 = 102;
/** The capacity label starts here; «10 000» (about 48 units at 12.5 px) ends by x = 156. */
export const RULER_LABEL_X = RULER_X1 + 6;
/** Longer labels (100 000 and up) are squeezed to this width so they stay inside the box. */
export const RULER_LABEL_MAX_W = 48;
const RULER_LABEL_MAX_CHARS = 6;

// Marks («засечки»): a pennant on the rim and a caption in the list under the plate.
const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
/** Caption rows (viewBox y of their centres): under the ruler, the last one inside the box. */
const CAPTION_TOP = 193;
const CAPTION_BOTTOM = 247;
const CAPTION_X = 14;
/** Hero px per viewBox unit (the hero is 140 px wide, pizza.css). */
const HERO_SCALE = 140 / VIEW_W;
/** The caption's line box in px (pizza.css .pizza-mark-caption line-height). */
export const CAPTION_LINE = 15;
/** The touch-target guideline, px: a caption grows to it when no neighbour or box edge is near. */
const CAPTION_TAP = 44;
/** Marks go around the rim over this sweep, so the start (0) and the end (1) of the level stay apart
 * (the end pennant's flag, pointing clockwise, stays clear of the start pennant's pole). */
export const MARK_SWEEP = 340;
/** Pennants closer than this (degrees) are nudged apart. */
export const MARK_GAP = 16;

export const clamp = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** A point at `deg` clockwise from 12 o'clock, `r` from the pizza centre. */
export function polar(deg: number, r: number, cx = CX, cy = CY): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

const f2 = (n: number) => Number(n.toFixed(2));

/** A sector of radius `r` from `from` to `to` degrees (clockwise); a full circle when it spans 360. */
export function sectorPath(from: number, to: number, r: number, cx = CX, cy = CY): string {
  const span = to - from;
  if (span <= 0) return '';
  if (span >= 360) return `M${f2(cx)} ${f2(cy - r)}A${r} ${r} 0 1 1 ${f2(cx)} ${f2(cy + r)}A${r} ${r} 0 1 1 ${f2(cx)} ${f2(cy - r)}Z`;
  const a = polar(from, r, cx, cy);
  const b = polar(to, r, cx, cy);
  return `M${f2(cx)} ${f2(cy)}L${f2(a.x)} ${f2(a.y)}A${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${f2(b.x)} ${f2(b.y)}Z`;
}

export interface PizzaStage {
  /** Whole slices eaten, 0..8, clockwise from 12 o'clock. */
  gone: number;
  /** How much of the current slice is bitten off, 0..1 (0 when no slice is started). */
  bite: number;
}

/** The pizza at `fill`: floor(fill · 8) slices gone, the rest of the share as a bite. */
export function pizzaStage(fill: number): PizzaStage {
  const f = clamp(fill);
  if (f >= 1) return { gone: SLICES, bite: 0 };
  const units = f * SLICES;
  const gone = Math.floor(units);
  return { gone, bite: units - gone };
}

/**
 * The bite circles of the current slice (index `slice`) at `bite` 0..1: [x, y, r]. The slice is
 * eaten like a real one, from the tip towards the crust: one circle clears the tip up to the
 * bite line, three small scoops scallop that line. At the end only the crust arc is left.
 */
export function biteCircles(slice: number, bite: number): [number, number, number][] {
  if (bite <= 0) return [];
  const mid = (slice + 0.5) * SLICE_DEG;
  // The bite line runs from near the tip (a first bite is visible) to the edge of the cheese.
  const depth = BITE_MIN + clamp(bite) * (BITE_MAX - BITE_MIN);
  const scoop = SCOOP;
  const out: [number, number, number][] = [[CX, CY, f2(depth - scoop * 0.6)]];
  for (const off of [-SCOOP_DEG, 0, SCOOP_DEG]) {
    const p = polar(mid + off, depth - scoop * 0.7);
    out.push([f2(p.x), f2(p.y), scoop]);
  }
  return out;
}

/** Where a mark at `height` sits: on the rim, clockwise from 12 o'clock like the slices, 0..340°. */
export function markPoint(height: number): { x: number; y: number } {
  const p = polar(clamp(height) * MARK_SWEEP, R_MARK);
  return { x: f2(p.x), y: f2(p.y) };
}

/**
 * The drawn angle of each mark (same order as `heights`): its height along the rim, nudged so
 * neighbouring pennants stay MARK_GAP apart (evenly spread when that cannot fit). The order
 * around the rim never changes.
 */
export function markAngles(heights: number[]): number[] {
  const n = heights.length;
  if (n === 0) return [];
  const order = heights.map((h, i) => ({ i, a: clamp(h) * MARK_SWEEP })).sort((p, q) => p.a - q.a || p.i - q.i);
  const gap = n > 1 ? Math.min(MARK_GAP, MARK_SWEEP / (n - 1)) : 0;
  for (let k = 1; k < n; k++) order[k]!.a = Math.max(order[k]!.a, order[k - 1]!.a + gap);
  order[n - 1]!.a = Math.min(order[n - 1]!.a, MARK_SWEEP);
  for (let k = n - 2; k >= 0; k--) order[k]!.a = Math.min(order[k]!.a, order[k + 1]!.a - gap);
  const out: number[] = new Array<number>(n);
  for (const p of order) out[p.i] = f2(Math.max(0, p.a));
  return out;
}

// ---- Level-up state machine ----
//   idle → eating → beat → away → arrive → idle
// Several levels repeat the cycle with shorter timings (the pizza in between arrives whole and
// is eaten at once), at most PIZZA_MAX_CYCLES times, then the last pizza arrives at `toFill`.

export type PizzaPhase = 'idle' | 'eating' | 'beat' | 'away' | 'arrive';

export interface PizzaAnimationState {
  phase: PizzaPhase;
  /** Cycles still to play, the current one included. */
  cyclesLeft: number;
  /** 0 for the first cycle, then 1, 2… — later cycles run compressed. */
  cycle: number;
}

export type PizzaAnimationEvent = { type: 'start'; levels: number } | { type: 'ate' } | { type: 'beaten' } | { type: 'gone' } | { type: 'arrived' } | { type: 'abort' };

export const PIZZA_MAX_CYCLES = 3;

export const PIZZA_IDLE: PizzaAnimationState = { phase: 'idle', cyclesLeft: 0, cycle: 0 };

/** The event that ends each running phase. */
export const PIZZA_DONE_EVENT: Record<Exclude<PizzaPhase, 'idle'>, PizzaAnimationEvent['type']> = {
  eating: 'ate',
  beat: 'beaten',
  away: 'gone',
  arrive: 'arrived',
};

/** Unknown or out-of-order events leave the state unchanged; 'abort' always returns to idle. */
export function nextPizzaPhase(state: PizzaAnimationState, event: PizzaAnimationEvent): PizzaAnimationState {
  if (event.type === 'abort') return PIZZA_IDLE;
  switch (state.phase) {
    case 'idle':
      if (event.type !== 'start' || !(event.levels >= 1)) return state;
      return { phase: 'eating', cyclesLeft: Math.min(PIZZA_MAX_CYCLES, Math.floor(event.levels)), cycle: 0 };
    case 'eating':
      return event.type === 'ate' ? { ...state, phase: 'beat' } : state;
    case 'beat':
      return event.type === 'beaten' ? { ...state, phase: 'away' } : state;
    case 'away':
      return event.type === 'gone' ? { ...state, phase: 'arrive' } : state;
    case 'arrive':
      if (event.type !== 'arrived') return state;
      return state.cyclesLeft > 1 ? { phase: 'eating', cyclesLeft: state.cyclesLeft - 1, cycle: state.cycle + 1 } : PIZZA_IDLE;
  }
}

/** The fill the arriving pizza shows: whole (0) while more levels follow, `toFill` on the last. */
export function arriveTarget(state: PizzaAnimationState, toFill: number): number {
  return state.cyclesLeft > 1 ? 0 : clamp(toFill);
}

export interface PizzaPhaseTiming {
  /** Pause before the phase starts, ms. */
  delay: number;
  duration: number;
  easing: 'in' | 'out';
}

/**
 * First cycle: eat 300, beat 240, away 160 after a 20 pause, arrive 480 (1.2 s); repeats
 * 160/140/120/260. The arrive phase slides a whole pizza in, then eats it down to its fill.
 * The arrival eases out with a small explicit overshoot (ARRIVE_OVERSHOOT), not a spring: a
 * spring would carry the plate past the stage clip.
 */
export function pizzaPhaseTiming(state: PizzaAnimationState): PizzaPhaseTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'eating':
      return compressed ? { delay: 0, duration: 160, easing: 'out' } : { delay: 0, duration: 300, easing: 'out' };
    case 'beat':
      return compressed ? { delay: 0, duration: 140, easing: 'out' } : { delay: 0, duration: 240, easing: 'out' };
    case 'away':
      return compressed ? { delay: 20, duration: 120, easing: 'in' } : { delay: 20, duration: 160, easing: 'in' };
    case 'arrive':
      return compressed ? { delay: 0, duration: 260, easing: 'out' } : { delay: 0, duration: 480, easing: 'out' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

/** The longest fade of the first bite after the new pizza arrives, ms. */
const BITE_FADE_MAX = 100;

/**
 * How the arrive phase of `duration` ms splits: the whole pizza slides in, the whole slices of
 * `fill` are eaten, then the bite on the next slice fades in (each part 0 when not needed).
 */
export function arriveSplit(fill: number, duration: number): { slide: number; eat: number; fade: number } {
  const { gone, bite } = pizzaStage(fill);
  if (gone > 0) {
    const settle = Math.round(duration * 0.4);
    const fade = bite > 0 ? Math.min(BITE_FADE_MAX, Math.round(settle * 0.35)) : 0;
    return { slide: duration - settle, eat: settle - fade, fade };
  }
  const fade = bite > 0 ? Math.min(BITE_FADE_MAX, Math.round(duration * 0.3)) : 0;
  return { slide: duration - fade, eat: 0, fade };
}

/** The slices [first..end) vanish one after another inside `total` ms: [delay, duration] per slice. */
export function eatingSchedule(first: number, total: number, end: number = SLICES): [number, number][] {
  const n = Math.min(SLICES, end) - Math.min(SLICES, Math.max(0, first));
  if (n <= 0) return [];
  if (n === 1) return [[0, Math.round(total * 0.7)]];
  const duration = Math.min(280, Math.round(total * 0.45));
  const step = (total - duration) / (n - 1);
  return Array.from({ length: n }, (_, i) => [Math.round(i * step), duration]);
}

/** A `finished` promise that never settles (old WebViews) must not stall the choreography. */
const FINISH_FALLBACK_MS = 450;

// ---- Marks helpers ----

/** «Пробный тест» fits; longer titles end with «…». */
export function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Caption rows: `count` captions spread between CAPTION_TOP and CAPTION_BOTTOM (viewBox y). */
export function captionYs(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [CAPTION_TOP];
  const step = (CAPTION_BOTTOM - CAPTION_TOP) / (count - 1);
  return Array.from({ length: count }, (_, i) => f2(CAPTION_TOP + i * step));
}

/**
 * Vertical padding of caption `i` in px (the button is centred on its row): the tap area grows
 * towards 44 px, but never past half the way to a neighbour's row or past the bottom of the box.
 */
export function captionPad(ys: number[], i: number): number {
  const y = ys[i]!;
  const gaps = ys.filter((_, j) => j !== i).map((other) => Math.abs(other - y) * HERO_SCALE);
  const height = Math.min(CAPTION_TAP, ...gaps, 2 * (VIEW_H - y) * HERO_SCALE);
  return Math.max(0, Math.floor(((height - CAPTION_LINE) / 2) * 100) / 100);
}

// ---- Scene pieces ----

interface Topping {
  kind: 'pepperoni' | 'herb' | 'olive';
  deg: number;
  r: number;
  size: number;
}

/** Toppings of slice `i`, kept inside its wedge (angle offsets are small at every radius). */
function toppings(i: number): Topping[] {
  const mid = (i + 0.5) * SLICE_DEG;
  const list: Topping[] = [{ kind: 'pepperoni', deg: mid + (i % 2 ? -3 : 3), r: 31, size: 5.5 }];
  if (i % 2 === 0) list.push({ kind: 'herb', deg: mid + 10, r: 41, size: 3.6 });
  else list.push({ kind: 'olive', deg: mid - 9, r: 41, size: 2.6 });
  if (i % 3 === 0) list.push({ kind: 'pepperoni', deg: mid - 4, r: 15, size: 3.2 });
  else if (i % 3 === 1) list.push({ kind: 'herb', deg: mid + 6, r: 16, size: 2.6 });
  return list;
}

/** Crumbs on the plate where slice `i` used to be: [x, y, r]. */
function crumbs(i: number): [number, number, number][] {
  const a = polar((i + 0.3) * SLICE_DEG, 30);
  const b = polar((i + 0.72) * SLICE_DEG, 45);
  const c = polar((i + 0.55) * SLICE_DEG, 20);
  return [
    [f2(a.x), f2(a.y), 1.7],
    [f2(b.x), f2(b.y), 1.3],
    [f2(c.x), f2(c.y), 1.1],
  ];
}

/** The four crumbs of the beat: they start at the last slice and drift out and down: [dx, dy]. */
const BURST: [number, number][] = [
  [-22, 26],
  [-9, 34],
  [8, 30],
  [20, 22],
];
const BURST_ORIGIN = polar(7.5 * SLICE_DEG, 34);

/** The steam wisps rise from the last slice, which stays until the end. */
const STEAM = ['M62 60c-5-7 4-11-1-18c-3-5 2-8 1-12', 'M74 54c-4-6 4-9 0-15c-3-4 2-7 1-10'];

/** The middle of a numbered flag, relative to the mark point before rotation. */
const FLAG_MID: [number, number] = [4.3, -10];

const CHEF_HAT = 'M68 24h24v-6c5 0 6-8 1-9c0-6-8-7-13-3c-5-4-13-3-13 3c-5 1-4 9 1 9z';

function Slice({ index, bite, clip, sliceRef }: { index: number; bite: number; clip: string; sliceRef: (el: SVGGElement | null) => void }) {
  const from = index * SLICE_DEG;
  const to = from + SLICE_DEG;
  return (
    <g className="pizza-slice" ref={sliceRef}>
      <path d={sectorPath(from, to, R_CRUST)} className="pizza-crust" />
      <path d={sectorPath(from, to, R_SAUCE)} className="pizza-sauce" />
      <path d={sectorPath(from, to, R_CHEESE)} className="pizza-cheese" />
      {toppings(index).map((t, k) => {
        const p = polar(t.deg, t.r);
        if (t.kind === 'herb') {
          return <ellipse key={k} cx={f2(p.x)} cy={f2(p.y)} rx={t.size} ry={t.size * 0.55} transform={`rotate(${f2(t.deg + 40)} ${f2(p.x)} ${f2(p.y)})`} className="pizza-herb" />;
        }
        if (t.kind === 'olive') return <circle key={k} cx={f2(p.x)} cy={f2(p.y)} r={t.size} className="pizza-olive" />;
        return (
          <g key={k}>
            <circle cx={f2(p.x)} cy={f2(p.y)} r={t.size} className="pizza-pepperoni" />
            <circle cx={f2(p.x - t.size * 0.3)} cy={f2(p.y - t.size * 0.3)} r={t.size * 0.28} className="pizza-pepperoni-light" />
          </g>
        );
      })}
      <path d={`M${f2(polar(from, R_CRUST).x)} ${f2(polar(from, R_CRUST).y)}L${CX} ${CY}L${f2(polar(to, R_CRUST).x)} ${f2(polar(to, R_CRUST).y)}`} className="pizza-cut" />
      {bite > 0 && (
        // Clipped to the pizza: the bite never paints over the coloured rim of the plate.
        <g className="pizza-bites" clipPath={`url(#${clip})`}>
          {biteCircles(index, bite).map(([x, y, r], k) => (
            <circle key={k} cx={x} cy={y} r={r} className="pizza-bite" />
          ))}
        </g>
      )}
    </g>
  );
}

// ---- WAAPI helpers (guarded like progress/themes/flask.tsx) ----

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Awaits an animation, or its duration plus a margin when `finished` never settles (old WebViews). */
function done(animation: Animation, duration: number): Promise<void> {
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration + FINISH_FALLBACK_MS)]);
}

let cachedEasing: Record<PizzaPhaseTiming['easing'], string> | null = null;
/** The motion tokens as WAAPI easing strings (WAAPI cannot read var()). */
function easings(): Record<PizzaPhaseTiming['easing'], string> {
  if (cachedEasing) return cachedEasing;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  cachedEasing = {
    in: read('--ease-in', 'cubic-bezier(0.7, 0, 0.84, 0)'),
    out: read('--ease-out', 'cubic-bezier(0.2, 0.8, 0.2, 1)'),
  };
  return cachedEasing;
}

function animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    // An easing the engine does not parse: plain ease-out keeps the choreography going.
    return el.animate(keyframes, { ...options, easing: 'ease-out' });
  }
}

// ---- Hero ----

const text = {
  name: 'Пицца',
  levelNoun: 'Пицца',
  levelGenitive: 'пиццы',
  levelForms: ['пицца', 'пиццы', 'пицц'] as [string, string, string],
  levelFormsOf: ['пиццы', 'пицц', 'пицц'] as [string, string, string],
  completed: (n: number) => `Пицца ${n} съедена`,
  fillLabel: (percent: number) => `Пицца съедена на ${percent}%`,
  hint: 'Кусочки съедаются один за другим',
};

export function PizzaHero({ fill, capacity, state = 'active', motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const id = `pizza${useId().replace(/[^\w-]/g, '')}`;
  // A completed skill shows its reward: a whole golden pizza.
  const target = state === 'complete' ? 0 : state === 'empty' ? 0 : clamp(fill);

  // While a choreography runs (and right after it) the scene shows `override`, not the prop.
  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  const playing = useRef(false);
  // Each playLevelUp takes a token; a newer call aborts the older one, which then leaves the
  // scene to it instead of committing its own end state.
  const playToken = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const shown = override ?? target;
  const stage = pizzaStage(shown);

  const svgRef = useRef<SVGSVGElement>(null);
  const servingRef = useRef<SVGGElement>(null);
  const burstRef = useRef<SVGGElement>(null);
  const pulseRef = useRef<SVGCircleElement>(null);
  const sliceRefs = useRef<(SVGGElement | null)[]>([]);

  useEffect(installPauseWhenHidden, []);

  // Prop-driven changes: a puff of crumbs at the slice being eaten, a crossfade under reduced motion.
  const previous = useRef(target);
  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (playing.current || from === target) return;
    setOverride(null);
    if (motion === 'reduced') {
      if (servingRef.current) animate(servingRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    if (target > from && burstRef.current) {
      const at = polar((Math.min(pizzaStage(target).gone, SLICES - 1) + 0.5) * SLICE_DEG, 34);
      const dx = at.x - BURST_ORIGIN.x;
      const dy = at.y - BURST_ORIGIN.y;
      Array.from(burstRef.current.children).forEach((crumb, i) => {
        const [bx, by] = BURST[i]!;
        animate(
          crumb,
          [
            { transform: `translate(${f2(dx)}px, ${f2(dy)}px)`, opacity: 1 },
            { transform: `translate(${f2(dx + bx * 0.4)}px, ${f2(dy + by * 0.4)}px)`, opacity: 0 },
          ],
          { duration: 420, delay: i * 30, easing: 'ease-out' },
        );
      });
    }
  }, [target, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const serving = servingRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        if (!serving || typeof serving.animate !== 'function') {
          onOverflow?.();
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
        flushSync(() => {
          setScripted(true);
          setOverride(start);
        });

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            flushSync(() => setOverride(clamp(toFill)));
            const fade = track(animate(serving, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }));
            if (fade) await done(fade, 240);
            return;
          }
          const ease = easings();
          /** Slides the serving through `ys` (viewBox units); [y, offset] pins a keyframe. */
          const slide = async (ys: (number | [number, number])[], timing: PizzaPhaseTiming) => {
            const frames: Keyframe[] = ys.map((y) => (Array.isArray(y) ? { transform: `translateY(${y[0]}px)`, offset: y[1] } : { transform: `translateY(${y}px)` }));
            const a = track(
              animate(serving, frames, {
                duration: timing.duration,
                easing: ease[timing.easing],
                fill: 'forwards',
              }),
            );
            if (a) await done(a, timing.duration);
          };
          const eat = async (first: number, timing: PizzaPhaseTiming, end = SLICES) => {
            const schedule = eatingSchedule(first, timing.duration, end);
            const waits = schedule.map(([delay, duration], k) => {
              const slice = sliceRefs.current[first + k];
              if (!slice) return Promise.resolve();
              // Lifted off the plate outwards, then gone.
              const out = polar((first + k + 0.5) * SLICE_DEG, 12);
              const a = track(
                animate(
                  slice,
                  [
                    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                    { transform: `translate(${f2((out.x - CX) * 0.5)}px, ${f2((out.y - CY) * 0.5)}px) scale(1.05)`, opacity: 1, offset: 0.4 },
                    { transform: `translate(${f2(out.x - CX)}px, ${f2(out.y - CY)}px) scale(0.7)`, opacity: 0 },
                  ],
                  { duration, delay, easing: ease.out, fill: 'forwards' },
                ),
              );
              return a ? done(a, duration + delay) : Promise.resolve();
            });
            await Promise.all(waits);
          };
          const beat = async (timing: PizzaPhaseTiming) => {
            const waits: Promise<void>[] = [];
            const bounce = track(
              animate(
                serving,
                [
                  { transform: 'translateY(0) scale(1)' },
                  { transform: 'translateY(0) scale(1.07)', offset: 0.3 },
                  { transform: 'translateY(0) scale(1)' },
                ],
                { duration: timing.duration, easing: 'ease-in-out' },
              ),
            );
            if (bounce) waits.push(done(bounce, timing.duration));
            if (pulseRef.current) {
              const pulse = track(
                // Up to 1.14: the ring (r 68 · 1.14 ≈ 77.5) stays above the stage clip.
                animate(
                  pulseRef.current,
                  [
                    { transform: 'scale(0.92)', opacity: 1 },
                    { transform: 'scale(1.06)', opacity: 0.9, offset: 0.5 },
                    { transform: 'scale(1.14)', opacity: 0 },
                  ],
                  {
                    duration: timing.duration,
                    easing: 'ease-out',
                  },
                ),
              );
              if (pulse) waits.push(done(pulse, timing.duration));
            }
            Array.from(burstRef.current?.children ?? []).forEach((crumb, i) => {
              const [dx, dy] = BURST[i]!;
              const a = track(
                animate(
                  crumb,
                  [
                    { transform: 'translate(0, 0)', opacity: 1 },
                    { transform: `translate(${dx * 0.7}px, ${dy * 0.3 - 8}px)`, opacity: 1, offset: 0.4 },
                    { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
                  ],
                  { duration: timing.duration, delay: i * 40, easing: 'ease-out' },
                ),
              );
              if (a) waits.push(done(a, timing.duration + i * 40));
            });
            await Promise.all(waits);
          };

          let current = start;
          let phase = nextPizzaPhase(PIZZA_IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = pizzaPhaseTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'eating':
                await eat(pizzaStage(current).gone, timing);
                break;
              case 'beat':
                // Every slice is gone: the empty plate shows it while the crumbs drift.
                flushSync(() => setOverride(1));
                onOverflow?.();
                await beat(timing);
                break;
              case 'away':
                await slide([0, TRAVEL], timing);
                break;
              case 'arrive': {
                current = arriveTarget(phase, toFill);
                const split = arriveSplit(current, timing.duration);
                // Swapped while out of sight: a whole pizza is served from above, settling a
                // touch past its place (no spring: the plate must stay clear of the stage clip)…
                flushSync(() => setOverride(0));
                await slide([-TRAVEL, [ARRIVE_OVERSHOOT, 0.8], 0], { ...timing, duration: split.slide });
                // …and eaten down to the new fill: the points past the level.
                const { gone } = pizzaStage(current);
                if (split.eat && !aborted()) await eat(0, { ...timing, duration: split.eat }, gone);
                if (aborted()) break;
                flushSync(() => setOverride(current));
                // The first bite of the next slice fades in instead of popping.
                const bites = split.fade ? sliceRefs.current[gone]?.querySelector('.pizza-bites') : null;
                if (bites) {
                  const a = track(animate(bites, [{ opacity: 0 }, { opacity: 1 }], { duration: split.fade, easing: ease.out }));
                  if (a) await done(a, split.fade);
                }
                break;
              }
            }
            phase = nextPizzaPhase(phase, { type: PIZZA_DONE_EVENT[phase.phase] } as PizzaAnimationEvent);
          }
        } finally {
          if (aborted()) {
            // A newer choreography owns the scene now; its layers sit above these.
            running.forEach((a) => a.cancel());
          } else {
            // Commit the end state, then drop the WAAPI layers: no jump.
            flushSync(() => setOverride(clamp(toFill)));
            running.forEach((a) => a.cancel());
            playing.current = false;
            requestAnimationFrame(() => {
              setScripted(false);
              // The screen already shows the new state (it normally does): follow the prop again.
              if (Math.abs(targetRef.current - clamp(toFill)) > 1e-6) setOverride(null);
            });
          }
        }
      },
    }),
    [motion],
  );

  // Static: marks never animate; the caller decides which pizza they belong to.
  const shownMarks = marks ?? [];
  const captioned = [...shownMarks.slice(-MARK_CAPTIONS)].sort((a, b) => a.height - b.height);
  const captionY = captionYs(captioned.length);
  // A captioned pennant carries the number of its caption (1–4, clockwise), so the two match.
  const markNumber = new Map(captioned.map((mark, i) => [mark.id, i + 1]));
  const angles = markAngles(shownMarks.map((mark) => mark.height));
  const capacityLabel = capacity === undefined ? '' : formatNumber(capacity);
  const rulerLength = RULER_X1 - RULER_X0;

  const classes = ['pizza', 'pizza--hero', `pizza--${state}`, scripted ? 'pizza--scripted' : ''].filter(Boolean);
  const stagePercent = Math.floor(clamp(state === 'complete' ? 1 : shown) * 100);

  return (
    <div className={classes.join(' ')}>
      <svg ref={svgRef} className="pizza-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label ?? text.fillLabel(stagePercent)}>
        <defs>
          <clipPath id={`${id}-stage`}>
            <rect x="0" y="0" width={VIEW_W} height={STAGE_BOTTOM} />
          </clipPath>
          <clipPath id={`${id}-pie`}>
            <circle cx={CX} cy={CY} r={R_CRUST + 1.5} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id}-stage)`}>
          <g className="pizza-serving" ref={servingRef}>
            <circle cx={CX} cy={CY} r={R_PLATE} className="pizza-plate" />
            <circle cx={CX} cy={CY} r={R_RING} className="pizza-plate-ring" />
            <circle ref={pulseRef} cx={CX} cy={CY} r={R_PLATE} className="pizza-pulse" aria-hidden="true" />
            {Array.from({ length: SLICES }, (_, i) =>
              i < stage.gone ? null : (
                <Slice
                  key={i}
                  index={i}
                  bite={i === stage.gone ? stage.bite : 0}
                  clip={`${id}-pie`}
                  sliceRef={(el) => {
                    sliceRefs.current[i] = el;
                  }}
                />
              ),
            )}
            <g className="pizza-crumbs" aria-hidden="true">
              {Array.from({ length: stage.gone }, (_, i) => crumbs(i).map(([x, y, r], k) => <circle key={`${i}-${k}`} cx={x} cy={y} r={r} />))}
            </g>
            <g className="pizza-burst" ref={burstRef} aria-hidden="true">
              {BURST.map(([dx], k) => (
                <circle key={dx} cx={f2(BURST_ORIGIN.x + (k - 1.5) * 6)} cy={f2(BURST_ORIGIN.y + (k % 2) * 4)} r={k % 2 ? 2.8 : 3.5} />
              ))}
            </g>
            <g className="pizza-steam anim-decor" aria-hidden="true">
              {STEAM.map((d) => (
                <path key={d} d={d} />
              ))}
            </g>
          </g>
        </g>
        {state === 'complete' && <path d={CHEF_HAT} className="pizza-hat" />}
        {capacity !== undefined && (
          <g className="pizza-ruler" aria-hidden="true">
            <line x1={RULER_X0} x2={RULER_X1} y1={RULER_Y} y2={RULER_Y} className="pizza-ruler-line" />
            {Array.from({ length: SLICES + 1 }, (_, k) => {
              const x = f2(RULER_X0 + (k * rulerLength) / SLICES);
              return <line key={k} x1={x} x2={x} y1={RULER_Y - 3} y2={RULER_Y + 3} className="pizza-ruler-tick" />;
            })}
            {shown > 0 && <line x1={RULER_X0} x2={f2(RULER_X0 + rulerLength * clamp(shown))} y1={RULER_Y} y2={RULER_Y} className="pizza-ruler-eaten" />}
            <text x={RULER_X0 - 6} y={RULER_Y} dominantBaseline="central" textAnchor="end">
              0
            </text>
            <text
              x={RULER_LABEL_X}
              y={RULER_Y}
              dominantBaseline="central"
              textAnchor="start"
              {...(capacityLabel.length > RULER_LABEL_MAX_CHARS ? { textLength: RULER_LABEL_MAX_W, lengthAdjust: 'spacingAndGlyphs' } : {})}
            >
              {capacityLabel}
            </text>
          </g>
        )}
        {shownMarks.map((mark, k) => {
          const deg = angles[k]!;
          const p = polar(deg, R_MARK);
          const x = f2(p.x);
          const y = f2(p.y);
          const n = markNumber.get(mark.id);
          // The number sits upright in the middle of the flag (local offset FLAG_MID, rotated).
          const a = (deg * Math.PI) / 180;
          const nx = f2(x + FLAG_MID[0] * Math.cos(a) - FLAG_MID[1] * Math.sin(a));
          const ny = f2(y + FLAG_MID[0] * Math.sin(a) + FLAG_MID[1] * Math.cos(a));
          return (
            // Pointer only: the captions below are the accessible way in, and so is the list.
            <g key={mark.id} className="pizza-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              <g transform={`rotate(${deg} ${x} ${y})`}>
                <rect x={x - 12} y={y - 20} width={30} height={28} className="pizza-mark-hit" />
                <line x1={x} x2={x} y1={y + 2} y2={y - 15} className="pizza-mark-pole" />
                <path
                  d={n ? `M${x} ${y - 15}h11l-3 5l3 5h-11Z` : `M${x} ${y - 15}L${f2(x + 9)} ${y - 11.5}L${x} ${y - 8}Z`}
                  className="pizza-mark-flag"
                />
              </g>
              {n && (
                <text x={nx} y={ny} className="pizza-mark-num" textAnchor="middle" dominantBaseline="central">
                  {n}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {captioned.map((mark: ProgressMark, i) => (
        <button
          key={mark.id}
          type="button"
          className="pizza-mark-caption"
          style={{ left: `${(CAPTION_X / VIEW_W) * 100}%`, top: `${(captionY[i]! / VIEW_H) * 100}%`, paddingBlock: captionPad(captionY, i) }}
          aria-label={copy.marks.onFlask(mark.label)}
          onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}
        >
          <span className="pizza-mark-caption-num" aria-hidden="true">
            {i + 1}
          </span>
          {shortLabel(mark.label)}
        </button>
      ))}
    </div>
  );
}

// ---- Mini ----

const MINI = 40;
const MINI_C = 20;
const MINI_DOTS = [45, 135, 225, 315];
/** Before the level is done a sliver of the last slice stays visible, even at 28 px. */
export const MINI_MAX_EATEN = 345;

export function PizzaMini({ fill, state = 'active', size = 32, label }: ProgressMiniProps) {
  const shown = state === 'complete' || state === 'empty' ? 0 : clamp(fill);
  const from = Math.min(shown * 360, MINI_MAX_EATEN);
  return (
    <svg
      className={`pizza pizza--mini pizza--${state}`}
      viewBox={`0 0 ${MINI} ${MINI}`}
      width={size}
      height={size}
      role="img"
      aria-label={label ?? text.fillLabel(Math.floor((state === 'complete' ? 1 : shown) * 100))}
    >
      <circle cx={MINI_C} cy={MINI_C} r={19} className="pizza-plate" />
      <circle cx={MINI_C} cy={MINI_C} r={16.5} className="pizza-plate-ring" />
      {shown < 1 && (
        <>
          <path d={sectorPath(from, 360, 15.5, MINI_C, MINI_C)} className="pizza-crust" />
          <path d={sectorPath(from, 360, 13, MINI_C, MINI_C)} className="pizza-sauce" />
          <path d={sectorPath(from, 360, 12, MINI_C, MINI_C)} className="pizza-cheese" />
          {MINI_DOTS.filter((deg) => deg > from).map((deg) => {
            const p = polar(deg, 7.5, MINI_C, MINI_C);
            return <circle key={deg} cx={f2(p.x)} cy={f2(p.y)} r={2.4} className="pizza-pepperoni" />;
          })}
        </>
      )}
    </svg>
  );
}

export const pizzaTheme: ProgressThemeDefinition = {
  key: 'pizza',
  text,
  available: true,
  Hero: PizzaHero,
  Mini: PizzaMini,
  markPoint,
};
