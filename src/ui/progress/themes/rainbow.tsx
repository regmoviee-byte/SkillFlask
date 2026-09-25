import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { DONE_EVENT, FINISH_FALLBACK_MS, IDLE, nextPhase, refillTarget, type AnimationState, type PhaseTiming } from '../../components/flaskAnimation';
import { copy } from '../../copy';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import './rainbow.css';

// «Радуга»: a coloring-book rainbow of seven arcs standing on two clouds. The arcs are colored
// in one after another (outermost first), each drawn left to right with stroke-dashoffset as
// the fill passes k/7. The level-up beat: the last arc closes, the sun rises from behind the
// right cloud under the arch with its rays and a short sparkle, the colours fade back to the
// ink outlines and the new level starts coloring again. The flask's state machine
// (flaskAnimation.ts) drives the order; the timings are this theme's own (≤ 1.2 s a level).
// Colours: the arcs are a tonal ramp of the skill colour (--liquid-*), the clouds and the sun
// keep their natural colours, the complete rainbow turns gold (rainbow.css).

export const ARC_COUNT = 7;
const CX = 80;
/** Centre of the arch; the legs run straight down from here into the clouds. */
const CY = 126;
/** Where the legs end, deep in the clouds. */
const FOOT = 228;
/**
 * Where each leg comes out of its cloud (outermost first): the cloud top on the leg's centre line
 * (the left cloud at the middle of its 2 px drift). The fill is mapped onto the visible run between
 * these two points only; the tails below them, under the clouds, fill at once when an arc starts
 * (left) and when it closes (right), so no point of the fill plays out of sight. rainbow.test.ts
 * checks the table against the cloud paths.
 */
export const ARC_FEET = {
  left: [183.7, 180.4, 179.1, 179.6, 173.9, 170.8, 170.2],
  right: [169.4, 167.4, 167.5, 167.1, 166.9, 168.3, 171.6],
} as const;
const R_OUT = 68;
const BAND = 5.6;
const R_IN = R_OUT - BAND * ARC_COUNT;
const VIEW_W = 160;
const VIEW_H = 260;

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Coloured share of each arc (outermost first) at `fill`: arc k fills while fill passes k/7 → (k+1)/7. */
export function rainbowArcs(fill: number): number[] {
  const f = clamp(fill) * ARC_COUNT;
  return Array.from({ length: ARC_COUNT }, (_, k) => clamp(f - k));
}

/** Centre-line radius of arc k (0 = outermost). */
export const arcRadius = (k: number) => R_OUT - BAND * (k + 0.5);

/** An arch of radius r: up the left leg, over the top, down the right leg (drawn left → right). */
export function arcPath(r: number, cx = CX, cy = CY, foot = FOOT): string {
  return `M${cx - r} ${foot}V${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}V${foot}`;
}

export const arcLength = (r: number, cy = CY, foot = FOOT) => 2 * (foot - cy) + Math.PI * r;

/**
 * Drawn length of an arc path of `total` length at coloured `share`: nothing at 0, the whole path
 * at 1, and in between the hidden left tail plus `share` of the visible run, so the share maps
 * linearly onto what can be seen.
 */
export function drawnLength(share: number, total: number, tailLeft: number, tailRight: number): number {
  const s = clamp(share);
  if (s <= 0) return 0;
  if (s >= 1) return total;
  return tailLeft + s * (total - tailLeft - tailRight);
}

const easeOutCubic = (t: number) => 1 - (1 - clamp(t)) ** 3;

/**
 * Keyframes of a fill change from `from` to `to` along an ease-out move: `offsets` (0..1) and,
 * per arc, its coloured share at each offset. Besides `samples + 1` even moments there is a
 * keyframe exactly where the fill crosses each k/7, so played linearly between keyframes only one
 * arc changes at a time: the arcs color in strictly one after another, whatever the jump.
 */
export function arcFrames(from: number, to: number, samples = 12): { offsets: number[]; arcs: number[][] } {
  const moments = new Map<number, number>();
  for (let i = 0; i <= samples; i++) moments.set(i / samples, from + (to - from) * easeOutCubic(i / samples));
  for (let k = 1; k < ARC_COUNT; k++) {
    const b = k / ARC_COUNT;
    if (b <= Math.min(from, to) || b >= Math.max(from, to)) continue;
    // Invert the ease: easeOutCubic(t) = u  ⇔  t = 1 − (1 − u)^(1/3).
    moments.set(1 - Math.cbrt(1 - (b - from) / (to - from)), b);
  }
  const offsets = [...moments.keys()].sort((a, b) => a - b);
  const frames = offsets.map((t) => rainbowArcs(moments.get(t)!));
  return { offsets, arcs: Array.from({ length: ARC_COUNT }, (_, k) => frames.map((arcs) => arcs[k]!)) };
}

/**
 * Rise 260, beat 360, fade 30 + 110, recolor 290 (1.05 s, the sun sinks during the recolor), which
 * leaves ~150 ms for the timers and frames between the phases inside 1.2 s (measured in Chromium:
 * 1.12–1.14 s from the tap to the last frame); repeats 30 + 100 and 200.
 */
export function rainbowTiming(state: AnimationState): PhaseTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 260, easing: 'out' };
    case 'overflow':
      return { delay: 0, duration: 360, easing: 'out' };
    case 'draining':
      return compressed ? { delay: 30, duration: 100, easing: 'in' } : { delay: 30, duration: 110, easing: 'in' };
    case 'refilling':
      return compressed ? { delay: 0, duration: 200, easing: 'out' } : { delay: 0, duration: 290, easing: 'out' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

/** The sun sinks back behind its cloud during the last recolor, never past its end. */
export const sunSinkDuration = (refill: PhaseTiming) => refill.duration;

/** The sun's way down: from under the arch (0) to behind the right cloud (1), in viewBox units. */
export const SUN_DROP = { x: 20, y: 96 } as const;
const sunAt = (k: number) => `translate(${(SUN_DROP.x * k).toFixed(2)}px, ${(SUN_DROP.y * k).toFixed(2)}px)`;
/** Share of the sink (in time) the sun stays opaque, and how far down it is by then. */
export const SUN_SINK_OPAQUE = 0.85;
const SUN_SINK_AT = 0.9;

/**
 * The sun sets: it slides down behind the right cloud fully opaque (ease-in-out, 90 % of the way at
 * 85 % of the time, where the cloud already covers the disc) and only then fades out. Played with a
 * linear effect easing, so the offsets are shares of the sink's time.
 */
export function sunSinkKeyframes(): Keyframe[] {
  return [
    { offset: 0, transform: sunAt(0), opacity: 1, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
    { offset: SUN_SINK_OPAQUE, transform: sunAt(SUN_SINK_AT), opacity: 1, easing: 'linear' },
    { offset: 1, transform: sunAt(1), opacity: 0 },
  ];
}

/** The sun rises from behind the right cloud; it is fully there after `visibleAt` of the way. */
const sunRiseKeyframes = (visibleAt: number): Keyframe[] => [
  { offset: 0, transform: sunAt(1), opacity: 0 },
  { offset: visibleAt, transform: sunAt(1 - visibleAt), opacity: 1 },
  { offset: 1, transform: sunAt(0), opacity: 1 },
];

/** A mark at `height` sits on the outer edge of the arch, left foot (0) over the top to the right foot (1). */
export function markPoint(height: number): { x: number; y: number } {
  const angle = Math.PI * (1 - clamp(height));
  return { x: CX + R_OUT * Math.cos(angle), y: CY - R_OUT * Math.sin(angle) };
}

export const rainbowText: ProgressThemeText = {
  name: 'Радуга',
  levelNoun: 'Радуга',
  levelGenitive: 'радуги',
  levelForms: ['радуга', 'радуги', 'радуг'],
  levelFormsOf: ['радуги', 'радуг', 'радуг'],
  completed: (n) => `Радуга ${n} сияет`,
  fillLabel: (percent) => `Радуга раскрашена на ${percent}%`,
  hint: 'Полосы раскрашиваются одна за другой',
};

// ---- Scene geometry (viewBox 0 0 160 260) ----

const RADII = Array.from({ length: ARC_COUNT }, (_, k) => arcRadius(k));
const PATHS = RADII.map((r) => arcPath(r));
const LENGTHS = RADII.map((r) => arcLength(r));
const TAILS = RADII.map((_, k) => [FOOT - ARC_FEET.left[k]!, FOOT - ARC_FEET.right[k]!] as const);
/** The ink lines of the coloring book: the eight edges between and around the bands. */
const EDGES = Array.from({ length: ARC_COUNT + 1 }, (_, j) => arcPath(R_OUT - BAND * j));
const PAPER = arcPath((R_OUT + R_IN) / 2);
/** Two cumulus clouds at the lower corners; their flat bottoms (y 238 / 240) close the scene near the foot of the box. */
export const LEFT_CLOUD = 'M4 238A16 16 0 0 1 10 208A19 19 0 0 1 32 180A15 15 0 0 1 58 176A17 17 0 0 1 77 200A20 20 0 0 1 80 238Z';
export const RIGHT_CLOUD = 'M78 240A15 15 0 0 1 84 212A18 18 0 0 1 104 188A21 21 0 0 1 132 168A16 16 0 0 1 153 184A16 16 0 0 1 158 212A15 15 0 0 1 156 240Z';
/** The sun's place under the arch; it hides behind the right cloud by SUN_DROP. */
export const SUN = { x: 80, y: 120, r: 10 };
const SUN_HIDDEN = sunAt(1);
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return `M${(SUN.x + c * 14).toFixed(1)} ${(SUN.y + s * 14).toFixed(1)}L${(SUN.x + c * 18.5).toFixed(1)} ${(SUN.y + s * 18.5).toFixed(1)}`;
}).join('');
const SPARKS = [
  { x: 28, y: 52, s: 9 },
  { x: 132, y: 44, s: 10 },
  { x: 100, y: 30, s: 6.5 },
  { x: 56, y: 34, s: 5 },
];
const sparkPath = ({ x, y, s }: (typeof SPARKS)[number]) =>
  `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`;

// Marks: a pennant standing outward on the outer edge (tilted at most MARK_TILT from upright, the
// flag flying towards the top of the arch), captions in a column right of the arch (it starts
// inside the box, just past the right leg at x = 148), each tied to its flag by a thin dotted
// leader (a flag on the left shoulder is far from it).
const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const HERO_SCALE = 140 / VIEW_W;
/** Caption text line and smallest button (px): neighbouring buttons never overlap. */
const CAPTION_LINE = 16;
const CAPTION_MIN = 24;
/** Minimum distance between two captions (viewBox units): one smallest button apart. */
const CAPTION_GAP = Math.ceil(CAPTION_MIN / HERO_SCALE);
const CAPTION_X = 152;
/** Room between a pennant and caption text (viewBox units). */
const CAPTION_CLEAR = 1.5;
const CAPTION_PAD_MAX = 14;
/** Pennant, in viewBox units: pole length and its round cap, the largest tilt (degrees), the tap circle. */
const POLE = 12;
const POLE_CAP = 0.9;
const MARK_TILT = 48;
const HIT_R = 11;
/** Every part of a pennant, its tap circle included, stays within these x. */
export const MARK_X = { min: 2, max: 158 } as const;

type Point = { x: number; y: number };
export interface Pennant {
  base: Point;
  top: Point;
  flag: [Point, Point, Point];
  /** The middle of the flag: where its leader starts and its caption lines up. */
  centre: Point;
  /** The tap circle, kept inside MARK_X. */
  hit: Point & { r: number };
  /** The drawn pennant's bounds, the pole's round caps included. */
  box: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * The pennant of a mark at `height`, in viewBox units. The pole stands outward on the outer edge,
 * leaning with the arch but at most MARK_TILT from upright, so near the feet it neither lies flat
 * nor leaves the box; the flag flies towards the top of the arch (mirrored on the right half).
 */
export function pennant(height: number): Pennant {
  const h = clamp(height);
  const base = markPoint(h);
  const a = (Math.max(-MARK_TILT, Math.min(MARK_TILT, 90 - 180 * (1 - h))) * Math.PI) / 180;
  const side = h > 0.5 ? -1 : 1;
  // A local point (x along the flag, y along the pole, up is −y), mirrored by `side`, rotated by a.
  const at = (lx: number, ly: number): Point => ({
    x: base.x + side * lx * Math.cos(a) - ly * Math.sin(a),
    y: base.y + side * lx * Math.sin(a) + ly * Math.cos(a),
  });
  const top = at(0, -POLE);
  const flag: [Point, Point, Point] = [top, at(9, -8.5), at(0, -5)];
  const tap = at(3, -8);
  const xs = [base.x, ...flag.map((p) => p.x)];
  const ys = [base.y, ...flag.map((p) => p.y)];
  return {
    base,
    top,
    flag,
    centre: at(4, -9),
    hit: { x: Math.min(MARK_X.max - HIT_R, Math.max(MARK_X.min + HIT_R, tap.x)), y: tap.y, r: HIT_R },
    box: { minX: Math.min(...xs) - POLE_CAP, maxX: Math.max(...xs) + POLE_CAP, minY: Math.min(...ys) - POLE_CAP, maxY: Math.max(...ys) + POLE_CAP },
  };
}

/**
 * How far (viewBox units) a caption at `y` starts right of the column so that its text clears every
 * pennant reaching into the column there (a mark near the right foot); 0 for most.
 */
export function captionShift(y: number, boxes: Pennant['box'][]): number {
  const half = CAPTION_LINE / 2 / HERO_SCALE;
  return boxes.reduce((shift, b) => (b.maxY > y - half && b.minY < y + half ? Math.max(shift, b.maxX + CAPTION_CLEAR - CAPTION_X) : shift), 0);
}

const shortLabel = (label: string) => (label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label);

/** Caption y positions at least CAPTION_GAP apart, in the order of their flags' y. */
export function captionYs(ys: number[]): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
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

/**
 * Vertical padding (px) of caption `i`: its tap area grows towards 44 px, but two neighbours
 * together never take more than the distance between them.
 */
export function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.floor((Math.min(...gaps) - CAPTION_LINE) / 2) : CAPTION_PAD_MAX;
  return Math.min(CAPTION_PAD_MAX, Math.max((CAPTION_MIN - CAPTION_LINE) / 2, room));
}

// ---- Guarded WAAPI (as in Flask.tsx) ----

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function done(animation: Animation | null, duration: number): Promise<void> {
  if (!animation) return wait(duration);
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

function animate(el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    return el.animate(keyframes, { ...options, easing: 'ease-out' });
  }
}

let pauseInstalled = false;
function installPauseWhenHidden(): void {
  if (pauseInstalled || typeof document === 'undefined') return;
  pauseInstalled = true;
  const sync = () => document.documentElement.classList.toggle('paused', document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', sync);
  sync();
}

const dashOffset = (k: number, share: number) => `${(LENGTHS[k]! - drawnLength(share, LENGTHS[k]!, ...TAILS[k]!)).toFixed(2)}px`;

// ---- Hero ----

function RainbowHero({ fill, state = 'active', motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const id = `rainbow${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);

  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  const playing = useRef(false);
  const playToken = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const shown = override ?? target;
  const arcs = rainbowArcs(shown);

  const svgRef = useRef<SVGSVGElement>(null);
  const colorRef = useRef<SVGGElement>(null);
  const arcRefs = useRef<(SVGPathElement | null)[]>([]);
  const sunRef = useRef<SVGGElement>(null);
  const raysRef = useRef<SVGPathElement>(null);
  const sparksRef = useRef<SVGGElement>(null);

  useEffect(installPauseWhenHidden, []);

  /** Colors the arcs from `from` to `to`; with `hold` the end state stays until cancelled. */
  const drawArcs = (from: number, to: number, duration: number, hold: boolean): Animation[] => {
    const { offsets, arcs: frames } = arcFrames(from, to);
    const last = offsets.length - 1;
    return frames.flatMap((shares, k) => {
      // A held move keeps even an unchanged arc pinned, over what earlier layers left.
      if (!hold && shares[0] === shares[last]) return [];
      const keyframes = shares.map((share, i) => ({ strokeDashoffset: dashOffset(k, share), offset: offsets[i]! }));
      const a = animate(arcRefs.current[k] ?? null, keyframes, { duration, easing: 'linear', fill: hold ? 'forwards' : 'none' });
      return a ? [a] : [];
    });
  };

  // Prop-driven changes: the arcs color in (or back) in order; a crossfade under reduced motion.
  // A layout effect, so the first frame of the move is painted instead of its end state.
  const previous = useRef(shown);
  // A new prop while no choreography runs drops what the last level-up left on screen (as in
  // Flask), so the arcs and the label follow `fill` and `state` again; the effect below then
  // colours in from the old picture to the new one.
  const previousTarget = useRef(target);
  useLayoutEffect(() => {
    const from = previousTarget.current;
    previousTarget.current = target;
    if (!playing.current && from !== target) setOverride(null);
  }, [target]);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = shown;
    if (playing.current || from === shown) return;
    if (motion === 'reduced') {
      animate(colorRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    const running = drawArcs(from, shown, 700, false);
    return () => running.forEach((a) => a.cancel());
  }, [shown, motion]);

  // The sun comes out when the skill becomes completed on screen (never on first load).
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete' || playing.current) return;
    const keyframes = motion === 'reduced' ? [{ opacity: 0 }, { opacity: 1 }] : sunRiseKeyframes(0.35);
    animate(sunRef.current, keyframes, { duration: motion === 'reduced' ? 240 : 700, easing: motion === 'reduced' ? 'ease-out' : easings().out });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => colorRef.current ?? svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const group = colorRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        if (!group || typeof group.animate !== 'function') {
          onOverflow?.();
          return;
        }
        playing.current = true;
        const running: Animation[] = [];
        const track = (a: Animation | null) => {
          if (a) running.push(a);
          return a;
        };
        const end = clamp(toFill);
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
            flushSync(() => setOverride(end));
            await done(track(animate(group, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })), 240);
            return;
          }
          const ease = easings();
          const sunWasOut = stateRef.current === 'complete';
          let current = start;
          let fade: Animation | null = null;
          const color = async (from: number, to: number, timing: PhaseTiming, alongside: Promise<void>[] = []) => {
            const drawn = drawArcs(from, to, timing.duration, true);
            drawn.forEach(track);
            current = to;
            await Promise.all([...drawn.map((a) => done(a, timing.duration)), ...alongside, drawn.length ? Promise.resolve() : wait(timing.duration)]);
          };
          const beat = async (timing: PhaseTiming) => {
            const { duration } = timing;
            const sun = track(
              animate(sunRef.current, sunRiseKeyframes(0.3), {
                duration,
                easing: ease.out,
                fill: 'forwards',
              }),
            );
            track(
              animate(raysRef.current, [{ opacity: 0, transform: 'scale(0.6) rotate(-30deg)' }, { opacity: 1, transform: 'scale(1) rotate(0deg)' }], {
                duration: duration - 120,
                delay: 120,
                easing: ease.out,
                fill: 'backwards',
              }),
            );
            Array.from(sparksRef.current?.children ?? []).forEach((spark, i) =>
              track(
                animate(
                  spark,
                  [
                    { opacity: 0, transform: 'scale(0) rotate(0deg)' },
                    { opacity: 1, transform: 'scale(1.15) rotate(45deg)', offset: 0.45 },
                    { opacity: 0, transform: 'scale(0.4) rotate(90deg)' },
                  ],
                  { duration: 420, delay: 160 + i * 80, easing: 'ease-out' },
                ),
              ),
            );
            await done(sun, duration);
          };

          let phase = nextPhase(IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = rainbowTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await color(current, 1, timing);
                break;
              case 'overflow':
                onOverflow?.();
                await beat(timing);
                break;
              case 'draining':
                fade = track(animate(group, [{ opacity: 1 }, { opacity: 0 }], { duration: timing.duration, easing: ease.in, fill: 'forwards' }));
                await done(fade, timing.duration);
                break;
              case 'refilling': {
                // The colours start again from the outlines: the arcs jump to empty while the
                // group is still faded out, then the fade is lifted in the same frame.
                const last = phase.cyclesLeft <= 1;
                const sinkMs = sunSinkDuration(timing);
                let sink = Promise.resolve();
                if (last && !sunWasOut) {
                  sink = done(track(animate(sunRef.current, sunSinkKeyframes(), { duration: sinkMs, easing: 'linear', fill: 'forwards' })), sinkMs);
                  // The rays fold in first, so only the disc goes down behind the cloud.
                  track(
                    animate(raysRef.current, [{ opacity: 1, transform: 'scale(1) rotate(0deg)' }, { opacity: 0, transform: 'scale(0.6) rotate(-30deg)' }], {
                      duration: sinkMs * 0.4,
                      easing: ease.in,
                      fill: 'forwards',
                    }),
                  );
                }
                const refill = color(0, refillTarget(phase, end), timing, [sink]);
                fade?.cancel();
                fade = null;
                await refill;
                break;
              }
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
              // A newer level-up owns the override by now.
              if (token !== playToken.current) return;
              setScripted(false);
              // Follow the prop again: nothing moves when it already equals `end` (the normal
              // case), otherwise the arcs colour on from `end` to it.
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
  const pennants = shownMarks.map((m) => pennant(m.height));
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const flags = pennants.slice(-MARK_CAPTIONS).map((p) => p.centre);
  const captionY = captionYs(flags.map((f) => f.y));
  const shifts = captionY.map((y) => captionShift(y, pennants.map((p) => p.box)));
  const sunOut = state === 'complete';

  const classes = ['rainbow', 'rainbow--hero', `rainbow--${state}`, reserved.current ? 'rainbow--marked' : '', scripted ? 'rainbow--scripted' : ''];

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <svg ref={svgRef} className="rainbow-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label ?? rainbowText.fillLabel(Math.floor(shown * 100))}>
        <path d={PAPER} className="rainbow-paper" strokeWidth={BAND * ARC_COUNT} />
        <g ref={colorRef} className="rainbow-arcs">
          {PATHS.map((d, k) => (
            <path
              key={k}
              ref={(el) => {
                arcRefs.current[k] = el;
              }}
              d={d}
              className={`rainbow-arc rainbow-arc--${k}`}
              strokeWidth={BAND + 0.3}
              style={{ strokeDasharray: `${LENGTHS[k]!.toFixed(2)} ${(LENGTHS[k]! + 2).toFixed(2)}`, strokeDashoffset: dashOffset(k, arcs[k]!) }}
            />
          ))}
        </g>
        <g className="rainbow-edges" aria-hidden="true">
          {EDGES.map((d, j) => (
            <path key={j} d={d} className={j === 0 || j === ARC_COUNT ? 'rainbow-edge rainbow-edge--rim' : 'rainbow-edge'} />
          ))}
        </g>
        <g ref={sunRef} className="rainbow-sun" style={{ transform: sunOut ? 'none' : SUN_HIDDEN, opacity: sunOut ? 1 : 0 }} aria-hidden="true">
          <path ref={raysRef} d={RAYS} className="rainbow-rays" />
          <circle cx={SUN.x} cy={SUN.y} r={SUN.r} className="rainbow-sun-disc" />
          <circle cx={SUN.x - 3} cy={SUN.y - 3} r={3.5} className="rainbow-sun-glint" />
        </g>
        <defs>
          <clipPath id={`${id}-l`}>
            <path d={LEFT_CLOUD} />
          </clipPath>
          <clipPath id={`${id}-r`}>
            <path d={RIGHT_CLOUD} />
          </clipPath>
        </defs>
        <g className={motion === 'reduced' ? 'rainbow-drift' : 'rainbow-drift anim-decor'} aria-hidden="true">
          <path d={LEFT_CLOUD} className="rainbow-cloud" />
          <ellipse cx="42" cy="246" rx="42" ry="14" className="rainbow-cloud-shade" clipPath={`url(#${id}-l)`} />
          <path d={LEFT_CLOUD} className="rainbow-cloud-line" />
        </g>
        <g aria-hidden="true">
          <path d={RIGHT_CLOUD} className="rainbow-cloud" />
          <ellipse cx="118" cy="248" rx="44" ry="15" className="rainbow-cloud-shade" clipPath={`url(#${id}-r)`} />
          <path d={RIGHT_CLOUD} className="rainbow-cloud-line" />
        </g>
        <g ref={sparksRef} className="rainbow-sparks" aria-hidden="true">
          {SPARKS.map((s) => (
            <path key={s.x} d={sparkPath(s)} />
          ))}
        </g>
        <g className="rainbow-leaders" aria-hidden="true">
          {flags.map((f, i) => (
            <path key={captioned[i]!.id} d={`M${f.x.toFixed(1)} ${f.y.toFixed(1)}L${(CAPTION_X + shifts[i]! - 2).toFixed(1)} ${captionY[i]!.toFixed(1)}`} />
          ))}
        </g>
        {shownMarks.map((mark, i) => {
          const { base, top, flag, hit } = pennants[i]!;
          return (
            // Pointer only: the captions are the accessible way in.
            <g key={mark.id} className="rainbow-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              <circle cx={hit.x.toFixed(2)} cy={hit.y.toFixed(2)} r={hit.r} className="rainbow-mark-hit" />
              <line x1={base.x.toFixed(2)} y1={base.y.toFixed(2)} x2={top.x.toFixed(2)} y2={top.y.toFixed(2)} className="rainbow-mark-pole" />
              <path d={`M${flag.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`} className="rainbow-mark-flag" />
            </g>
          );
        })}
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="rainbow-mark-caption"
          style={
            {
              left: `${((CAPTION_X + shifts[i]!) / VIEW_W) * 100}%`,
              top: `${(captionY[i]! / VIEW_H) * 100}%`,
              paddingBlock: captionPad(captionY, i),
              // A caption moved right past a pennant gives up that much width (rainbow.css).
              '--rb-shift': `${(shifts[i]! * HERO_SCALE).toFixed(1)}px`,
            } as CSSProperties
          }
          aria-label={copy.marks.onFlask(mark.label)}
          onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}
        >
          {shortLabel(mark.label)}
        </button>
      ))}
    </div>
  );
}

// ---- Mini (a square, 28–40 px) ----

export const MINI = { cx: 16, cy: 18.5, foot: 27, out: 14, band: 1.45 };
/** Where the mini's legs come out of its (mirrored) clouds, outermost first; see ARC_FEET. */
export const MINI_FEET = [25.6, 25.2, 23.5, 22.8, 22.6, 22.8, 23.5] as const;
export const MINI_LEFT_CLOUD = 'M0.5 30.5A3.5 3.5 0 0 1 4 25.5A5 5 0 0 1 12.5 24.5A3.5 3.5 0 0 1 13.5 30.5Z';
export const MINI_RIGHT_CLOUD = 'M18.5 30.5A3.5 3.5 0 0 1 19.5 24.5A5 5 0 0 1 28 25.5A3.5 3.5 0 0 1 31.5 30.5Z';
const MINI_RADII = Array.from({ length: ARC_COUNT }, (_, k) => MINI.out - MINI.band * (k + 0.5));
const MINI_LENGTHS = MINI_RADII.map((r) => arcLength(r, MINI.cy, MINI.foot));
const miniOffset = (k: number, share: number) => {
  const tail = MINI.foot - MINI_FEET[k]!;
  return (MINI_LENGTHS[k]! - drawnLength(share, MINI_LENGTHS[k]!, tail, tail)).toFixed(2);
};

function RainbowMini({ fill, state = 'active', motion, size = 32, label }: ProgressMiniProps) {
  const shown = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const arcs = rainbowArcs(shown);
  const mid = MINI.out - (MINI.band * ARC_COUNT) / 2;
  return (
    <svg
      className={`rainbow rainbow-mini rainbow--${state}${motion === 'reduced' ? ' rainbow-mini--reduced' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={label ?? rainbowText.fillLabel(Math.floor(shown * 100))}
    >
      <path d={arcPath(mid, MINI.cx, MINI.cy, MINI.foot)} className="rainbow-paper rainbow-paper--mini" strokeWidth={MINI.band * ARC_COUNT + 1.4} />
      {MINI_RADII.map((r, k) => (
        <path
          key={k}
          d={arcPath(r, MINI.cx, MINI.cy, MINI.foot)}
          className={`rainbow-arc rainbow-arc--${k}`}
          strokeWidth={MINI.band + 0.15}
          strokeDasharray={`${MINI_LENGTHS[k]!.toFixed(2)} ${(MINI_LENGTHS[k]! + 1).toFixed(2)}`}
          strokeDashoffset={miniOffset(k, arcs[k]!)}
        />
      ))}
      <path d={MINI_LEFT_CLOUD} className="rainbow-cloud rainbow-cloud--mini" />
      <path d={MINI_RIGHT_CLOUD} className="rainbow-cloud rainbow-cloud--mini" />
    </svg>
  );
}

export const rainbowTheme: ProgressThemeDefinition = {
  key: 'rainbow',
  text: rainbowText,
  available: true,
  Hero: RainbowHero,
  Mini: RainbowMini,
  markPoint,
};
