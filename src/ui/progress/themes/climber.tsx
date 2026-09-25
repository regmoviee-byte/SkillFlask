import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '../../../lib/format';
import { PLAIN_TICKS, scaleTicks } from '../../components/flaskScale';
import { DONE_EVENT, FINISH_FALLBACK_MS, IDLE, nextPhase, refillTarget, type AnimationEvent, type AnimationState } from '../../components/flaskAnimation';
import { copy } from '../../copy';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import './climber.css';

// «Альпинист»: a grey mountain with a snow cap fills the box; a switchback trail zig-zags from
// the meadow at its foot to the summit, and a small climber (the backpack in the skill colour)
// stands on it at `fill`. The trail behind him is trodden, the route ahead dashed. Level-up:
// he walks to the summit, plants a flag in the skill colour that waves twice and raises his
// pole (the beat). Then the scene sinks and fades while the conquered peak, flag and all,
// shrinks back onto the far ridge; the next mountain grows up from the meadow, taller than the
// old one now looks, with him at its foot, and he walks on to `toFill`. Idle: one cloud drifts. Complete: a golden flag.
// Rock, snow, meadow and jacket keep their natural colours (climber.css); only the backpack
// and the flag carry the skill colour. Only transform, opacity and stroke-dashoffset animate.

export interface Point {
  x: number;
  y: number;
}

/** The hero's switchback trail, foot to summit; every leg climbs (y strictly decreases). */
export const TRAIL: readonly Point[] = [
  { x: 70, y: 248 },
  { x: 24, y: 226 },
  { x: 104, y: 198 },
  { x: 34, y: 168 },
  { x: 92, y: 136 },
  { x: 54, y: 110 },
  { x: 82, y: 86 },
  { x: 64, y: 62 },
  { x: 68, y: 34 },
];

/** The mini's trail in its 32 × 32 box. */
export const MINI_TRAIL: readonly Point[] = [
  { x: 16, y: 30 },
  { x: 24, y: 26 },
  { x: 10, y: 21 },
  { x: 19, y: 15.5 },
  { x: 16, y: 12 },
];

/** The mountain's outline (clockwise from the bottom left); the trail stays inside it. */
export const MOUNTAIN: readonly Point[] = [
  { x: 0, y: 252 },
  { x: 10, y: 226 },
  { x: 17, y: 221 },
  { x: 27, y: 188 },
  { x: 23, y: 178 },
  { x: 36, y: 140 },
  { x: 43, y: 133 },
  { x: 48, y: 106 },
  { x: 45, y: 98 },
  { x: 54, y: 74 },
  { x: 59, y: 68 },
  { x: 63, y: 38 },
  { x: 66, y: 33 },
  { x: 71, y: 32 },
  { x: 76, y: 38 },
  { x: 80, y: 58 },
  { x: 86, y: 63 },
  { x: 92, y: 96 },
  { x: 98, y: 102 },
  { x: 104, y: 146 },
  { x: 110, y: 152 },
  { x: 116, y: 204 },
  { x: 120, y: 208 },
  { x: 126, y: 252 },
];

const poly = (points: readonly Point[], close = false) => `M${points.map((p) => `${p.x} ${p.y}`).join('L')}${close ? 'Z' : ''}`;
const MOUNTAIN_D = poly(MOUNTAIN, true);
const TRAIL_D = poly(TRAIL);
const MINI_TRAIL_D = poly(MINI_TRAIL);
/** The right, shaded face: the outline's right side back up a crooked ridge. */
const SHADE_D =
  'M71 32L76 38L80 58L86 63L92 96L98 102L104 146L110 152L116 204L120 208L126 252L88 252L80 204L84 160L78 112L74 74Z';
const SNOW_D = 'M63 38L66 33L71 32L76 38L80 58L86 63L88.3 75L84 71.5L80 79L75.5 70.5L70.5 77.5L66 69.5L61.5 76.5L57.5 70L53.6 75L54 74L59 68L63 38Z';
const SNOW_SHADE_D = 'M71 32L76 38L80 58L86 63L88.3 75L84 71.5L80 79L75.5 70.5L74 73Z';
const CRAGS_D = 'M20 212l7-5M34 184l6-6M46 124l5-7M29 238l9-4M96 172l5 8M90 118l4 8M58 92l5-6';
const MEADOW_D = 'M0 260V244C20 236 44 238 70 242S116 240 160 236V260Z';
const FAR_D = 'M96 252L124 180L132 188L146 158L160 186V252Z';
const CLOUD_D = 'M110 58C110 53 114 50 119 51C121 45 130 43 134 49C139 47 145 51 145 55C146 57 145 58 143 58Z';
/** The summit flag: pole from the peak up; the cloth hangs from its top (drawn from 0,0). */
const POLE = { x: 76, base: 42, top: 11 };
const CLOTH_D = 'M0 0H17L13 4.5L17 9H0Z';
/** Where the conquered peak ends up during the reset: a small far peak on the ridge (foot on the meadow). */
export const GHOST_SLOT = { x: 104, y: 138.6, scale: 0.45 };
const GHOST_AT = `translate(${GHOST_SLOT.x}px, ${GHOST_SLOT.y}px) scale(${GHOST_SLOT.scale})`;
const GHOST_OPACITY = 0.55;

/** The snow line: above it the climber walks on the cap. */
export const SNOW_LINE = 76;

const VIEW_W = 160;
const VIEW_H = 260;

export const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** A position on a trail: the point, its share of the trail's length and the way the climber faces. */
export interface TrailPos extends Point {
  /** Share of the trail's length walked, 0..1 (drives the trodden path's stroke-dashoffset). */
  walked: number;
  /** 1 facing right, −1 facing left: the direction of the leg he is on. */
  facing: 1 | -1;
}

export interface Trail {
  /** Where `fill` puts the climber: fill is the share of the HEIGHT climbed, so 50 % reads as halfway up. */
  at(fill: number): TrailPos;
  /** Key points of a walk from one fill to another along the switchbacks, offsets by distance. */
  walk(from: number, to: number): (TrailPos & { offset: number })[];
}

export function makeTrail(points: readonly Point[]): Trail {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = cum[cum.length - 1]!;
  const foot = points[0]!.y;
  const top = points[points.length - 1]!.y;
  const facingOf = (leg: number): 1 | -1 => (points[leg + 1]!.x - points[leg]!.x < 0 ? -1 : 1);

  function at(fill: number): TrailPos {
    const y = foot - clamp(fill) * (foot - top);
    let leg = 0;
    while (leg < points.length - 2 && points[leg + 1]!.y > y) leg++;
    const a = points[leg]!;
    const b = points[leg + 1]!;
    const t = Math.min(1, Math.max(0, (a.y - y) / (a.y - b.y)));
    const x = a.x + (b.x - a.x) * t;
    return { x, y, walked: (cum[leg]! + (cum[leg + 1]! - cum[leg]!) * t) / total, facing: facingOf(leg) };
  }

  function walk(from: number, to: number) {
    const a = at(from);
    const b = at(to);
    const lo = Math.min(a.walked, b.walked);
    const hi = Math.max(a.walked, b.walked);
    const corners = points
      .map((p, i) => ({ ...p, walked: cum[i]! / total, facing: 1 as 1 | -1 }))
      .filter((p) => p.walked > lo + 1e-9 && p.walked < hi - 1e-9);
    if (b.walked < a.walked) corners.reverse();
    const frames = [a, ...corners, b];
    const span = hi - lo;
    return frames.map((f, i) => {
      const next = frames[i + 1];
      // Faces the way he walks: towards the next key point (the last keeps the previous leg's).
      const dx = next ? next.x - f.x : 0;
      return { ...f, offset: span > 0 ? Math.abs(f.walked - a.walked) / span : i ? 1 : 0, facing: dx < 0 ? -1 : dx > 0 ? 1 : f.facing };
    }).map((f, i, all) => (i === all.length - 1 && i > 0 ? { ...f, facing: all[i - 1]!.facing } : f));
  }

  return { at, walk };
}

export const trail = makeTrail(TRAIL);
const miniTrail = makeTrail(MINI_TRAIL);

export type ClimbStage = 'foot' | 'trail' | 'snow' | 'summit';

/** The stage of the climb: at the foot, on the rock, on the snow cap, or on the summit (the flag stands). */
export function climbStage(fill: number): ClimbStage {
  const f = clamp(fill);
  if (f >= 1) return 'summit';
  if (f < 0.04) return 'foot';
  return trail.at(f).y <= SNOW_LINE ? 'snow' : 'trail';
}

/** Where a mark at `height` sits: on the trail, where the climber stood at that fill. */
export function markPoint(height: number): Point {
  const { x, y } = trail.at(height);
  return { x, y };
}

// ---- Choreography timing (the phases come from flaskAnimation's state machine) ----

export type ClimbEasing = 'walk' | 'in' | 'out';

export interface ClimbTiming {
  delay: number;
  duration: number;
  easing: ClimbEasing;
}

/** One level fits in LEVEL_MS: walk up 240, flag 340, reset 400 (sink 180, grow 220), walk on 220. */
export const LEVEL_MS = 1200;

/**
 * rising: the walk to the summit; overflow: the flag and the raised pole (the beat); draining:
 * the scene sinks and a taller mountain grows in (compressed cycles plant a quick flag first);
 * refilling: the walk from the foot to the summit again, or to `toFill` on the last cycle.
 */
export function climbTiming(state: AnimationState): ClimbTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 240, easing: 'walk' };
    case 'overflow':
      return { delay: 0, duration: 340, easing: 'out' };
    case 'draining':
      return compressed ? { delay: 0, duration: 320, easing: 'in' } : { delay: 0, duration: 400, easing: 'in' };
    case 'refilling':
      return compressed ? { delay: 0, duration: 260, easing: 'walk' } : { delay: 0, duration: 220, easing: 'out' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

/** The phases a level-up of `levels` plays, in order, with their timings. */
export function choreography(levels: number): { state: AnimationState; timing: ClimbTiming }[] {
  const out: { state: AnimationState; timing: ClimbTiming }[] = [];
  let state = nextPhase(IDLE, { type: 'start', levels });
  while (state.phase !== 'idle') {
    out.push({ state, timing: climbTiming(state) });
    state = nextPhase(state, { type: DONE_EVENT[state.phase] } as AnimationEvent);
  }
  return out;
}

// ---- Marks ----

const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const CAPTION_GAP = 18;
/** Left edge of the captions: right of the mountain's widest point (x 124). */
const CAPTION_X = 136;
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;
/** A pennant's tap area: 50 units ≈ 44 px on the 140 px hero, kept inside the box. */
const MARK_HIT = 50;

/** The tap rectangle around the pennant at `p`, clamped inside the view box. */
export function markHit(p: Point): { x: number; y: number; size: number } {
  const x = Math.min(VIEW_W - MARK_HIT, Math.max(0, p.x + 4 - MARK_HIT / 2));
  const y = Math.min(VIEW_H - MARK_HIT, Math.max(0, p.y - 6 - MARK_HIT / 2));
  return { x, y, size: MARK_HIT };
}

export function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Caption y positions, at least CAPTION_GAP apart and inside the box. */
export function captionYs(ys: number[]): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => Math.max(o.y, 10));
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

/** Vertical padding of caption `i` in px: towards a 44 px tap area, never over a neighbour. */
function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) - CAPTION_LINE : CAPTION_PAD_MAX;
  return Math.round(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

// ---- WAAPI plumbing, guarded like Flask.tsx ----

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function done(animation: Animation | null, duration: number): Promise<void> {
  if (!animation) return Promise.resolve();
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration + FINISH_FALLBACK_MS)]);
}

let cachedEasing: Record<ClimbEasing, string> | null = null;
function easings(): Record<ClimbEasing, string> {
  if (cachedEasing) return cachedEasing;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  cachedEasing = {
    walk: 'cubic-bezier(0.45, 0, 0.4, 1)',
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
/** html.paused while the page is hidden: the drifting cloud (.anim-decor) stops. */
function installPauseWhenHidden(): void {
  if (pauseInstalled || typeof document === 'undefined') return;
  pauseInstalled = true;
  const sync = () => document.documentElement.classList.toggle('paused', document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', sync);
  sync();
}

const place = (p: Point) => `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)`;
const face = (facing: number) => `scale(${facing}, 1)`;
const dash = (walked: number) => (1 - walked).toFixed(4);

// ---- Text ----

const text: ProgressThemeText = {
  name: 'Альпинист',
  levelNoun: 'Вершина',
  levelGenitive: 'вершины',
  levelForms: ['вершина', 'вершины', 'вершин'],
  levelFormsOf: ['вершины', 'вершин', 'вершин'],
  completed: (n) => `Вершина ${n} покорена`,
  fillLabel: (percent) => `Альпинист прошёл ${percent}% подъёма`,
  hint: 'Альпинист поднимается к вершине',
};

// ---- The climber figure: feet at 0,0, facing right, about 25 units tall ----

function Figure({ armRef }: { armRef?: Ref<SVGGElement> }) {
  return (
    <>
      <path d="M-0.6 -9L-3 -0.4M0.6 -9L2.8 -0.6" className="cl-legs" />
      <rect x="-8" y="-19.5" width="6" height="11.5" rx="2.2" className="cl-pack" />
      <rect x="-7.4" y="-21.4" width="4.8" height="2.8" rx="1.4" className="cl-pack-roll" />
      <rect x="-3" y="-18.5" width="6" height="10.5" rx="2.6" className="cl-jacket" />
      <path d="M-2.4 -17.6L-0.4 -10.6" className="cl-strap" />
      <circle cx="0.8" cy="-22" r="3.1" className="cl-skin" />
      <path d="M-2.4 -22.2A3.3 3.3 0 0 1 4 -22.2Z" className="cl-hat" />
      <g transform="translate(1.2 -16.4)">
        <g ref={armRef} className="cl-arm">
          <path d="M0 0L3.4 5" className="cl-sleeve" />
          <path d="M4 1.2L5.6 16.4" className="cl-pole" />
        </g>
      </g>
    </>
  );
}

/** The mountain itself: rock, shaded face, crags, snow cap and outline. */
function Peak() {
  return (
    <>
      <path d={MOUNTAIN_D} className="cl-rock" />
      <path d={SHADE_D} className="cl-rock-shade" />
      <path d={CRAGS_D} className="cl-crags" />
      <path d={SNOW_D} className="cl-snow" />
      <path d={SNOW_SHADE_D} className="cl-snow-shade" />
      <path d={MOUNTAIN_D} className="cl-outline" />
    </>
  );
}

/** The summit flag, drawn up from the pole's base at 0,0. */
function Flag({ clothRef }: { clothRef?: Ref<SVGGElement> }) {
  return (
    <>
      <path d={`M0 0V${POLE.top - POLE.base}`} className="cl-flag-pole" />
      <g transform={`translate(0.8 ${POLE.top - POLE.base})`}>
        <g ref={clothRef}>
          <path d={CLOTH_D} className="cl-flag-cloth" />
        </g>
      </g>
    </>
  );
}

// ---- Hero ----

function Hero({ fill, capacity, state = 'active', motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const id = `climber${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);

  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  const [flagUp, setFlagUp] = useState(false);
  const playing = useRef(false);
  const playToken = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const shown = override ?? target;

  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const climberRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const armRef = useRef<SVGGElement>(null);
  const edgeRef = useRef<SVGPathElement>(null);
  const coreRef = useRef<SVGPathElement>(null);
  const flagRef = useRef<SVGGElement>(null);
  const clothRef = useRef<SVGGElement>(null);
  const ghostRef = useRef<SVGGElement>(null);

  useEffect(installPauseWhenHidden, []);

  /** Walks the climber (and the trodden path behind him) along the switchbacks. */
  const walk = (from: number, to: number, duration: number, easing: string, hold: boolean): Animation[] => {
    const frames = trail.walk(from, to);
    const options: KeyframeAnimationOptions = { duration, easing, fill: hold ? 'forwards' : 'none' };
    const path = frames.map((f) => ({ offset: f.offset, strokeDashoffset: dash(f.walked) }));
    return [
      animate(climberRef.current, frames.map((f) => ({ offset: f.offset, transform: place(f) })), options),
      // The turn at each switchback is a step, not a squash.
      animate(faceRef.current, frames.map((f) => ({ offset: f.offset, transform: face(f.facing), easing: 'steps(1, end)' })), options),
      animate(edgeRef.current, path, options),
      animate(coreRef.current, path, options),
    ].filter((a): a is Animation => a !== null);
  };

  // Prop-driven changes: a walk along the trail from what was on screen, or a short crossfade
  // under reduced motion. A level-up owns the scene while it plays.
  useEffect(() => {
    if (!playing.current) setOverride(null);
  }, [target]);
  const lastShown = useRef(shown);
  useLayoutEffect(() => {
    const from = lastShown.current;
    lastShown.current = shown;
    if (playing.current || from === shown) return;
    if (motion === 'reduced') {
      animate(worldRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    walk(from, shown, 700, easings().out, false);
  }, [shown, motion]);

  // Completion on screen: the golden flag is planted (never on first load).
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete') return;
    const keyframes = motion === 'reduced' ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }];
    animate(flagRef.current, keyframes, { duration: motion === 'reduced' ? 240 : 500, easing: motion === 'reduced' ? 'ease-out' : easings().out });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const world = worldRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        if (!world || typeof world.animate !== 'function') {
          onOverflow?.();
          return;
        }
        playing.current = true;
        const running: Animation[] = [];
        const track = (...list: (Animation | null)[]) => {
          for (const a of list) if (a) running.push(a);
          return list;
        };
        // The app has already rendered the new level at `toFill` (the contract's level rule):
        // the choreography starts from `fromFill`, the completed level's fill (the caller lowers
        // it to what was on screen when writes overlap).
        const start = clamp(fromFill);
        const end = clamp(toFill);
        flushSync(() => {
          setScripted(true);
          setOverride(start);
          setFlagUp(false);
        });

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            flushSync(() => setOverride(end));
            const [fade] = track(animate(world, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }));
            await done(fade ?? null, 240);
            return;
          }
          const ease = easings();
          let current = start;
          const walkTo = async (to: number, timing: ClimbTiming) => {
            const list = walk(current, to, timing.duration, ease[timing.easing], true);
            track(...list);
            current = to;
            await Promise.all(list.map((a) => done(a, timing.duration)));
          };
          const plant = (duration: number) => {
            flushSync(() => setFlagUp(true));
            return track(
              animate(flagRef.current, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration, easing: ease.out, fill: 'forwards' }),
            );
          };
          // The beat: the flag goes in, waves twice; the climber raises his pole.
          const beat = async (timing: ClimbTiming) => {
            const pop = Math.round(timing.duration * 0.3);
            const waits = plant(pop).map((a) => done(a, pop));
            const wave = [
              { transform: 'scaleX(0.3) skewY(0deg)' },
              { transform: 'scaleX(1) skewY(-10deg)', offset: 0.3 },
              { transform: 'scaleX(0.78) skewY(8deg)', offset: 0.55 },
              { transform: 'scaleX(1) skewY(-8deg)', offset: 0.8 },
              { transform: 'scaleX(1) skewY(0deg)' },
            ];
            const [cloth] = track(animate(clothRef.current, wave, { duration: timing.duration, easing: 'ease-in-out', fill: 'forwards' }));
            const [arm] = track(
              animate(armRef.current, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-150deg)', offset: 0.35 }, { transform: 'rotate(-135deg)' }], {
                duration: timing.duration,
                easing: ease.out,
                fill: 'forwards',
              }),
            );
            await Promise.all([...waits, done(cloth ?? null, timing.duration), done(arm ?? null, timing.duration)]);
          };
          // The scene sinks and fades while the conquered peak (a copy, flag and all) shrinks back
          // onto the far ridge; the next mountain grows up from the meadow with the climber at its foot.
          const reset = async (timing: ClimbTiming, quickFlag: boolean) => {
            let rest = timing.duration;
            if (quickFlag) {
              const pop = Math.round(timing.duration * 0.28);
              await Promise.all(plant(pop).map((a) => done(a, pop)));
              rest -= pop;
            }
            const sink = Math.round(rest * 0.45);
            // The near scene clears early, so the peak is seen shrinking away behind it; the peak
            // settles on the ridge while the next mountain grows.
            const [out, ghost] = track(
              animate(
                world,
                [
                  { transform: 'translateY(0px) scale(1, 1)', opacity: 1 },
                  { transform: 'translateY(14px) scale(1, 1)', opacity: 0.3, offset: 0.45 },
                  { transform: 'translateY(48px) scale(1, 1)', opacity: 0 },
                ],
                { duration: sink, easing: 'linear', fill: 'forwards' },
              ),
              animate(ghostRef.current, [{ transform: 'translate(0px, 0px) scale(1)', opacity: 1 }, { transform: GHOST_AT, opacity: GHOST_OPACITY }], {
                duration: Math.round(rest * 0.75),
                easing: 'ease-in-out',
                fill: 'forwards',
              }),
            );
            await done(out ?? null, sink);
            if (aborted()) return;
            flushSync(() => {
              setOverride(0);
              setFlagUp(false);
            });
            // The far peak stays put; everything else of the old scene goes.
            for (const a of running.splice(0)) if (a !== ghost) a.cancel();
            track(ghost ?? null);
            const [grow] = track(
              animate(world, [{ transform: 'translateY(40px) scale(1, 0.88)', opacity: 0 }, { transform: 'translateY(0px) scale(1, 1)', opacity: 1 }], {
                duration: rest - sink,
                easing: 'ease-out',
                fill: 'forwards',
              }),
            );
            current = 0;
            await done(grow ?? null, rest - sink);
          };
          // On the last walk the far peak fades into the ridge.
          const fadeGhost = (duration: number) =>
            track(
              animate(ghostRef.current, [{ transform: GHOST_AT, opacity: GHOST_OPACITY }, { transform: GHOST_AT, opacity: 0 }], {
                duration,
                easing: 'ease-in',
                fill: 'forwards',
              }),
            );

          let phase = nextPhase(IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = climbTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await walkTo(1, timing);
                break;
              case 'overflow':
                onOverflow?.();
                await beat(timing);
                break;
              case 'draining':
                await reset(timing, phase.cycle > 0);
                break;
              case 'refilling':
                if (phase.cyclesLeft <= 1) fadeGhost(timing.duration);
                await walkTo(refillTarget(phase, end), timing);
                break;
            }
            phase = nextPhase(phase, { type: DONE_EVENT[phase.phase] } as AnimationEvent);
          }
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            flushSync(() => {
              setOverride(end);
              setFlagUp(false);
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

  const pos = trail.at(shown);
  const stage = climbStage(shown);
  const flagShown = flagUp || stage === 'summit';

  const shownMarks = marks ?? [];
  const reserved = useRef(false);
  reserved.current = scripted ? reserved.current || shownMarks.length > 0 : shownMarks.length > 0;
  const marked = reserved.current;
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const captionY = captionYs(captioned.map((m) => markPoint(m.height).y));
  const ticks = capacity !== undefined ? scaleTicks(capacity) : PLAIN_TICKS.map((share) => ({ share, value: null }));

  const classes = ['climber', 'climber--hero', `climber--${state}`, `climber--${stage}`, marked ? 'climber--marked' : '', scripted ? 'climber--scripted' : ''];

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <svg ref={svgRef} className="climber-svg" viewBox="0 0 160 260" role="img" aria-label={label ?? text.fillLabel(Math.floor(shown * 100))}>
        <defs>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0" className="cl-halo-in" />
            <stop offset="1" className="cl-halo-out" />
          </radialGradient>
        </defs>
        {state === 'complete' && <circle cx={POLE.x} cy="28" r="44" fill={`url(#${id}-halo)`} />}
        <path d={CLOUD_D} className="cl-cloud anim-decor" />
        {/* The far ridge stays put while the near scene changes: it is far away. */}
        <path d={FAR_D} className="cl-far" />
        {scripted && (
          <g ref={ghostRef} className="cl-ghost" opacity="0">
            <Peak />
            <g transform={`translate(${POLE.x} ${POLE.base})`}>
              <Flag />
            </g>
          </g>
        )}
        <g ref={worldRef} className="cl-world">
          <Peak />
          <path d={MEADOW_D} className="cl-meadow" />
          <path d={TRAIL_D} className="cl-route" />
          <path ref={edgeRef} d={TRAIL_D} pathLength={1} className="cl-trodden-edge" strokeDasharray="1 2" strokeDashoffset={dash(pos.walked)} />
          <path ref={coreRef} d={TRAIL_D} pathLength={1} className="cl-trodden" strokeDasharray="1 2" strokeDashoffset={dash(pos.walked)} />
          <g transform={`translate(${POLE.x} ${POLE.base})`}>
            <g ref={flagRef} className="cl-flag" opacity={flagShown ? 1 : 0}>
              <Flag clothRef={clothRef} />
            </g>
          </g>
          <g ref={climberRef} className="cl-climber" style={{ transform: place(pos) }}>
            <g ref={faceRef} style={{ transform: face(pos.facing) }}>
              <Figure armRef={armRef} />
            </g>
          </g>
        </g>
        {!marked &&
          ticks.map(({ share, value }) => {
            const y = trail.at(share).y;
            return (
              <g key={share} className="cl-tick">
                <line x1="150" x2="157" y1={y} y2={y} />
                {value !== null && (
                  <text x="146" y={y} dominantBaseline="central" textAnchor="end">
                    {formatNumber(value)}
                  </text>
                )}
              </g>
            );
          })}
        {/* Tap areas first, so where two overlap the pennant drawn on top still takes its own tap. */}
        {shownMarks.map((mark) => {
          const hit = markHit(markPoint(mark.height));
          return (
            <rect
              key={mark.id}
              x={hit.x}
              y={hit.y}
              width={hit.size}
              height={hit.size}
              className="cl-mark-hit"
              aria-hidden="true"
              onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}
            />
          );
        })}
        {shownMarks.map((mark) => {
          const p = markPoint(mark.height);
          const i = captioned.indexOf(mark);
          return (
            // Pointer only: the captions are the accessible way in.
            <g key={mark.id} className="cl-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              {i >= 0 && <path d={`M${p.x + 9} ${p.y - 9}L${CAPTION_X - 3} ${captionY[i]}`} className="cl-mark-leader" />}
              <path d={`M${p.x} ${p.y + 1}V${p.y - 13}`} className="cl-mark-pole" />
              <path d={`M${p.x} ${p.y - 13}L${p.x + 9} ${p.y - 9.5}L${p.x} ${p.y - 6}Z`} className="cl-mark-flag" />
            </g>
          );
        })}
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="cl-mark-caption"
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

// ---- Mini: the mountain, the trodden trail and a dot in the skill colour where the climber is ----

const MINI_MOUNTAIN_D = 'M1 31L16 8L31 31Z';
const MINI_SHADE_D = 'M16 8L31 31H18L17 18Z';
const MINI_SNOW_D = 'M16 8L19.6 14.4L17.8 13.6L16.2 15.2L14.4 13.4L12.4 14.4Z';

function Mini({ fill, state = 'active', size = 32, label }: ProgressMiniProps) {
  const f = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const p = miniTrail.at(f);
  return (
    <svg className={`climber-mini climber--${state}`} width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label ?? text.fillLabel(Math.floor(f * 100))}>
      <path d={MINI_MOUNTAIN_D} className="cl-rock" />
      <path d={MINI_SHADE_D} className="cl-rock-shade" />
      <path d={MINI_SNOW_D} className="cl-snow" />
      <path d={MINI_MOUNTAIN_D} className="cl-outline" />
      <path d={MINI_TRAIL_D} className="cl-route" />
      <path d={MINI_TRAIL_D} pathLength={1} className="cl-trodden" strokeDasharray="1 2" strokeDashoffset={dash(p.walked)} />
      {state === 'complete' ? (
        <g className="cl-flag">
          <path d="M16 8.5V1" className="cl-flag-pole" />
          <path d="M16.4 1H23.5L21.8 3L23.5 5H16.4Z" className="cl-flag-cloth" />
        </g>
      ) : (
        <circle cx={p.x} cy={p.y} r="3" className="cl-dot" />
      )}
    </svg>
  );
}

export const climberTheme: ProgressThemeDefinition = {
  key: 'climber',
  text,
  available: true,
  Hero,
  Mini,
  markPoint,
};
