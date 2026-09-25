import { useEffect, useId, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { copy } from '../../copy';
import { FINISH_FALLBACK_MS, IDLE, nextPhase, refillTarget, type AnimationEvent, type AnimationState } from '../../components/flaskAnimation';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import { levelNumber, PIC_W, PictureArt, PictureDefs, pictureIndex } from './puzzle-pictures';
import './puzzle.css';

// The puzzle («Пазл»): a 3×4 jigsaw in a wooden frame hanging on a nail. Every level is a new
// picture (twenty of them, puzzle-pictures.tsx, chosen by `level`), and `fill` places its twelve
// pieces bottom-up in a snake, so a mark's height matches the rows already assembled. The empty
// board shows a faint print of the picture with dashed cut lines; the next piece hovers beside
// the frame at the height of its slot and turns towards it as points arrive, and the last one is
// the beat. Level-up (rise → beat → reset → refill) reuses the state machine of
// flaskAnimation.ts with its own shorter timings, through guarded WAAPI: the last piece snaps in,
// the picture shimmers, the pieces fade to reveal the NEXT picture's print, and fly back in.
// Only transform and opacity animate; the hovering piece's bob is the one idle loop (.anim-decor).

// ---- Geometry (viewBox 0 0 160 260) ----

const VIEW_W = 160;
const VIEW_H = 260;
export const COLS = 3;
export const ROWS = 4;
export const PIECES = COLS * ROWS;
/** Side of a piece; the picture spans X0..X1 × Y0..Y1. */
const S = 36;
const X0 = 20;
const Y0 = 50;
const X1 = X0 + COLS * S;
const Y1 = Y0 + ROWS * S;
/** The wooden frame around the picture. */
const BORDER = 7;
/** The nail the frame hangs on; the frame sways around it at the beat. */
const NAIL = { x: (X0 + X1) / 2, y: 18 };
/** The hovering piece: its centre x, its scale, and its tilt at the start and the end of its share. */
const FLOAT_X = 143;
const FLOAT_SCALE = 0.66;
const FLOAT_TILT = [16, 5] as const;
/** Knob of a piece: half-width of the neck and radius of the bulb. */
const KNOB_W = 4.5;
const KNOB_R = 6.2;

/**
 * Order in which the pieces arrive, as [col, row]: a snake from the bottom-right corner up, so
 * the assembled part grows like a level; the last piece is the top-right one with the sun.
 */
export const ORDER: readonly (readonly [number, number])[] = [
  [2, 3], [1, 3], [0, 3],
  [0, 2], [1, 2], [2, 2],
  [2, 1], [1, 1], [0, 1],
  [0, 0], [1, 0], [2, 0],
];

// Marks: a pennant on the left side of the frame, captions to the left of the hero.
const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const MARK_X = X0 - BORDER - 3;
const CAPTION_GAP = 18;
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;

export const clamp = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const f2 = (n: number) => Number(n.toFixed(2));

/** Pieces in the frame at `fill`: whole twelfths, so 0.999 leaves the last piece for the beat. */
export function puzzlePlaced(fill: number): number {
  const f = clamp(fill);
  return f >= 1 ? PIECES : Math.min(PIECES - 1, Math.floor(f * PIECES + 1e-9));
}

export interface PuzzleStage {
  /** Pieces in the frame, 0..12. */
  placed: number;
  /** Index (in ORDER) of the hovering piece; null when the picture is complete. */
  next: number | null;
  /** How far the points went into the next piece's share, 0..1. */
  share: number;
}

export function puzzleStage(fill: number): PuzzleStage {
  const placed = puzzlePlaced(fill);
  if (placed >= PIECES) return { placed, next: null, share: 0 };
  return { placed, next: placed, share: f2(Math.min(1, Math.max(0, clamp(fill) * PIECES - placed))) };
}

export type PieceVisual = 'placed' | 'floating' | 'hidden';

/** What piece `k` (index in ORDER) shows; `cleared` is the empty frame of the reset. */
export function pieceVisual(k: number, fill: number, cleared = false): PieceVisual {
  if (cleared) return 'hidden';
  const { placed } = puzzleStage(fill);
  return k < placed ? 'placed' : k === placed ? 'floating' : 'hidden';
}

// ---- Piece outlines ----

/** Tab across the vertical edge right of (c, r): +1 into the right piece, −1 into the left one. */
const tabV = (c: number, r: number) => ((c + r) % 2 === 0 ? 1 : -1);
/** Tab across the horizontal edge below (c, r): +1 into the lower piece, −1 into the upper one. */
const tabH = (c: number, r: number) => ((c + r) % 2 === 1 ? 1 : -1);

/**
 * An edge from (ax, ay) to (bx, by) with a knob in the middle; `bump` +1 bulges to the left of
 * the direction of travel (outwards on a clockwise outline), −1 dents inwards, 0 is straight.
 */
export function edgePath(ax: number, ay: number, bx: number, by: number, bump: number): string {
  if (!bump) return `L${f2(bx)} ${f2(by)}`;
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const p = (t: number) => `${f2(mx + ux * t)} ${f2(my + uy * t)}`;
  return `L${p(-KNOB_W)}A${KNOB_R} ${KNOB_R} 0 1 ${bump > 0 ? 1 : 0} ${p(KNOB_W)}L${f2(bx)} ${f2(by)}`;
}

/** Outline of the piece at column `c`, row `r`, clockwise, in picture coordinates. */
export function piecePath(c: number, r: number): string {
  const x0 = X0 + c * S;
  const y0 = Y0 + r * S;
  const x1 = x0 + S;
  const y1 = y0 + S;
  const top = r > 0 ? -tabH(c, r - 1) : 0;
  const right = c < COLS - 1 ? tabV(c, r) : 0;
  const bottom = r < ROWS - 1 ? tabH(c, r) : 0;
  const left = c > 0 ? -tabV(c - 1, r) : 0;
  return `M${x0} ${y0}${edgePath(x0, y0, x1, y0, top)}${edgePath(x1, y0, x1, y1, right)}${edgePath(x1, y1, x0, y1, bottom)}${edgePath(x0, y1, x0, y0, left)}Z`;
}

/** The inner cut lines of the empty frame, each drawn once (for the dashed slot outlines). */
function cutsPath(): string {
  let d = '';
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS - 1; c++) {
      const x = X0 + (c + 1) * S;
      d += `M${x} ${Y0 + r * S}${edgePath(x, Y0 + r * S, x, Y0 + (r + 1) * S, -tabV(c, r))}`;
    }
  for (let r = 0; r < ROWS - 1; r++)
    for (let c = 0; c < COLS; c++) {
      const y = Y0 + (r + 1) * S;
      d += `M${X0 + c * S} ${y}${edgePath(X0 + c * S, y, X0 + (c + 1) * S, y, -tabH(c, r))}`;
    }
  return d;
}

const PATHS = ORDER.map(([c, r]) => piecePath(c, r));
const CUTS = cutsPath();
const centre = (k: number) => ({ x: X0 + ORDER[k]![0] * S + S / 2, y: Y0 + ORDER[k]![1] * S + S / 2 });

/** CSS transform of piece `k`; the origin is the centre of its slot. */
export function pieceTransform(k: number, visual: PieceVisual, share = 0, scale = 1): string {
  if (visual === 'placed') return `translate(0px, 0px) rotate(0deg) scale(${scale})`;
  const { x } = centre(k);
  const s = clamp(share);
  const tilt = FLOAT_TILT[0] + (FLOAT_TILT[1] - FLOAT_TILT[0]) * s;
  return `translate(${f2(FLOAT_X - 3 * s - x)}px, ${f2(-4)}px) rotate(${f2(tilt)}deg) scale(${FLOAT_SCALE * scale})`;
}

/**
 * WAAPI keyframes for piece `k` going from one look to another: pieces fly in from beside the
 * frame (or, `inPlace`, settle into their slots when a whole picture comes at once), fade out in
 * place at the reset, and the beat's last piece overshoots as it snaps in.
 */
export function pieceKeyframes(k: number, from: PieceVisual, to: PieceVisual, fromShare = 0, toShare = 0, beat = false, inPlace = false): Keyframe[] {
  const at = (v: PieceVisual, share: number, scale = 1) => pieceTransform(k, v, share, scale);
  if (to === 'placed' && from === 'floating')
    return beat
      ? [{ transform: at('floating', fromShare), opacity: 1 }, { transform: at('placed', 0, 1.12), opacity: 1, offset: 0.6 }, { transform: at('placed', 0), opacity: 1 }]
      : [{ transform: at('floating', fromShare), opacity: 1 }, { transform: at('placed', 0), opacity: 1 }];
  if (to === 'placed' && inPlace) return [{ transform: at('placed', 0, 1.1), opacity: 0 }, { transform: at('placed', 0), opacity: 1 }];
  if (to === 'placed')
    return [{ transform: at('floating', 0.5), opacity: 0 }, { transform: at('floating', 0.5), opacity: 1, offset: 0.3 }, { transform: at('placed', 0), opacity: 1 }];
  if (to === 'floating')
    return from === 'floating'
      ? [{ transform: at('floating', fromShare), opacity: 1 }, { transform: at('floating', toShare), opacity: 1 }]
      : [{ transform: at('floating', toShare, 0.8), opacity: 0 }, { transform: at('floating', toShare), opacity: 1 }];
  return from === 'placed'
    ? [{ transform: at('placed', 0), opacity: 1 }, { transform: at('placed', 0, 0.9), opacity: 0 }]
    : [{ transform: at(from, fromShare), opacity: from === 'hidden' ? 0 : 1 }, { transform: at(from, fromShare), opacity: 0 }];
}

// ---- Choreography timings (the state machine is flaskAnimation's) ----

export interface PuzzleTiming {
  delay: number;
  duration: number;
}

/**
 * One level plays in 1.0 s (≈ 1.1 s on screen: each phase waits a frame or so for its animations
 * to report finished; the budget is 1.2): gather 200, snap + shimmer 380, hold 40 + fade to the
 * next picture's print 150, refill 230. Repeats of a multi-level write hold the assembled picture
 * 70 ms, fade 100 and refill 170.
 */
export function puzzlePhaseTiming(state: AnimationState): PuzzleTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 200 };
    case 'overflow':
      return { delay: 0, duration: 380 };
    case 'draining':
      return compressed ? { delay: 70, duration: 100 } : { delay: 40, duration: 150 };
    case 'refilling':
      return compressed ? { delay: 0, duration: 170 } : { delay: 0, duration: 230 };
    case 'idle':
      return { delay: 0, duration: 0 };
  }
}

/**
 * The level whose picture comes up at the reset of cycle `state` of a level-up from level `from`
 * to level `to`: the next one each cycle, the final one on the last (a longer write jumps there).
 */
export function cycleLevel(state: AnimationState, from: number, to: number): number {
  return state.cyclesLeft > 1 ? Math.min(to, from + state.cycle + 1) : to;
}

const DONE: Record<Exclude<AnimationState['phase'], 'idle'>, AnimationEvent> = {
  rising: { type: 'rose' },
  overflow: { type: 'overflowed' },
  draining: { type: 'drained' },
  refilling: { type: 'refilled' },
};

/** The phases a level-up plays, in order, with their timings (for tests and the loop below). */
export function puzzleScript(levels: number): { state: AnimationState; timing: PuzzleTiming }[] {
  const out: { state: AnimationState; timing: PuzzleTiming }[] = [];
  let state = nextPhase(IDLE, { type: 'start', levels });
  while (state.phase !== 'idle') {
    out.push({ state, timing: puzzlePhaseTiming(state) });
    state = nextPhase(state, DONE[state.phase]);
  }
  return out;
}

// ---- Marks ----

/** A mark sits on the left side of the frame at its height: bottom of the picture is 0, top is 1. */
export function markPoint(height: number): { x: number; y: number } {
  return { x: MARK_X, y: f2(Y1 - clamp(height) * (Y1 - Y0)) };
}

function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Caption y positions, at least CAPTION_GAP apart and inside the box. */
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

/** Vertical padding of caption `i` in px: grows towards a 44 px tap area when captions are apart. */
function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) - CAPTION_LINE : CAPTION_PAD_MAX;
  return Math.round(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

// ---- WAAPI helpers (as in progress/themes/flask.tsx) ----

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

// ---- Text ----

export const puzzleText: ProgressThemeText = {
  name: 'Пазл',
  levelNoun: 'Пазл',
  levelGenitive: 'пазла',
  levelForms: ['пазл', 'пазла', 'пазлов'],
  levelFormsOf: ['пазла', 'пазлов', 'пазлов'],
  completed: (n) => `Пазл ${n} собран`,
  fillLabel: (percent) => `Пазл собран на ${percent}%`,
  hint: 'Кусочки встают на свои места',
};

// ---- The hero ----

const VISIBLE: Record<PieceVisual, number> = { placed: 1, floating: 1, hidden: 0 };
/** The plaque counts a piece in once it has landed (prop-driven changes glide by CSS). */
const PLAQUE_LAG = 320;

interface View {
  fill: number;
  cleared: boolean;
  /** The level whose picture the pieces show. */
  level: number;
  /** The level whose faint print the board shows: the next one from the reset of a level-up. */
  board: number;
}

const placedIn = (v: View) => (v.cleared ? 0 : puzzlePlaced(v.fill));

function PuzzleHero({ fill, state = 'active', level, motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const id = `pz${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const lvl = levelNumber(level);

  const [override, setOverride] = useState<View | null>(null);
  const [scripted, setScripted] = useState(false);
  const playing = useRef(false);
  const playToken = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const levelRef = useRef(lvl);
  levelRef.current = lvl;
  const levelGiven = useRef(level !== undefined);
  levelGiven.current = level !== undefined;
  const view: View = override ?? { fill: target, cleared: false, level: lvl, board: lvl };
  const viewRef = useRef(view);
  viewRef.current = view;
  const stage = view.cleared ? { placed: 0, next: null, share: 0 } : puzzleStage(view.fill);
  const [plaque, setPlaque] = useState(stage.placed);

  const svgRef = useRef<SVGSVGElement>(null);
  const hangRef = useRef<SVGGElement>(null);
  const boardRef = useRef<SVGGElement>(null);
  const shineRef = useRef<SVGRectElement>(null);
  const pieceRefs = useRef<(SVGGElement | null)[]>([]);

  useEffect(installPauseWhenHidden, []);

  // Prop-driven changes glide by CSS transitions; a new picture or reduced motion crossfades.
  const previous = useRef({ target, lvl });
  useEffect(() => {
    const from = previous.current;
    previous.current = { target, lvl };
    if (playing.current || (from.target === target && from.lvl === lvl)) return;
    const shown = viewRef.current;
    const newPicture = pictureIndex(shown.level) !== pictureIndex(lvl) || pictureIndex(shown.board) !== pictureIndex(lvl);
    const changed = newPicture || shown.cleared || Math.abs(shown.fill - target) > 1e-6;
    setOverride(null);
    if (!changed || !(newPicture || motion === 'reduced')) return;
    // A level-up plays right after the app renders its new level: no crossfade under it.
    const frame = requestAnimationFrame(() => {
      if (!playing.current) animate(boardRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    });
    return () => cancelAnimationFrame(frame);
  }, [target, lvl, motion]);

  // The plaque follows the pieces: a prop-driven piece is counted as it lands. A choreography
  // counts each piece itself (see `go` below).
  useEffect(() => {
    if (playing.current) return;
    const timer = window.setTimeout(() => setPlaque(stage.placed), motion === 'reduced' ? 0 : PLAQUE_LAG);
    return () => window.clearTimeout(timer);
  }, [stage.placed, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        const board = boardRef.current;
        if (!board || typeof board.animate !== 'function') {
          onOverflow?.();
          return;
        }
        playing.current = true;
        const running: Animation[] = [];
        const track = (a: Animation | null) => (a && running.push(a), a);
        const end = clamp(toFill);
        const finished = levels >= 1 ? Math.floor(levels) : 0;
        // The app renders the new level at `toFill` before it plays (the contract's level rule):
        // the completed picture is `level − levels`, filled to `fromFill`. Without a `level` the
        // pictures move on from the one on screen by `levels`.
        const endLevel = levelGiven.current ? levelRef.current : viewRef.current.level + finished;
        const startLevel = levelGiven.current ? Math.max(1, endLevel - finished) : viewRef.current.level;
        let current: View = { fill: clamp(fromFill), cleared: false, level: startLevel, board: startLevel };
        flushSync(() => {
          setScripted(true);
          setOverride(current);
          setPlaque(placedIn(current));
        });
        const final: View = { fill: end, cleared: false, level: endLevel, board: endLevel };

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            flushSync(() => {
              setOverride(final);
              setPlaque(placedIn(final));
            });
            await done(track(animate(board, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })), 240);
            return;
          }
          const style = getComputedStyle(document.documentElement);
          const spring = style.getPropertyValue('--ease-spring').trim() || 'cubic-bezier(0.34, 1.56, 0.64, 1)';

          /**
           * Shows `next`, then plays each changed piece from its old look, staggered within
           * `duration`; the plaque counts each piece as it lands or leaves.
           */
          const go = async (next: View, duration: number, beat = false) => {
            const from = current;
            current = next;
            let count = placedIn(from);
            flushSync(() => {
              setOverride(next);
              setPlaque(count);
            });
            const a = puzzleStage(from.fill);
            const b = puzzleStage(next.fill);
            const moves: { k: number; from: PieceVisual; to: PieceVisual }[] = [];
            for (let k = 0; k < PIECES; k++) {
              const v0 = pieceVisual(k, from.fill, from.cleared);
              const v1 = pieceVisual(k, next.fill, next.cleared);
              if (v0 !== v1 || (v0 === 'floating' && a.share !== b.share)) moves.push({ k, from: v0, to: v1 });
            }
            if (next.cleared) moves.reverse();
            // A few pieces fly in from beside the frame one after another; a whole picture at
            // once (the repeats of a multi-level write) settles into its slots in a quick wave.
            const inPlace = moves.filter((m) => m.from === 'hidden' && m.to === 'placed').length > 3;
            const each = Math.min(duration, moves.length > 4 ? Math.max(120, duration * 0.6) : 200);
            const step = moves.length > 1 ? (duration - each) / (moves.length - 1) : 0;
            const waits = moves.map((m, i) => {
              const frames = pieceKeyframes(m.k, m.from, m.to, a.share, b.share, beat, inPlace);
              const easing = beat ? 'ease-out' : m.to === 'hidden' ? 'ease-in' : spring;
              const delta = Number(m.to === 'placed') - Number(m.from === 'placed');
              const moved = animate(pieceRefs.current[m.k], frames, { duration: each, delay: i * step, easing, fill: 'backwards' });
              return done(track(moved), each + i * step).then(() => {
                if (delta && !aborted()) setPlaque((count += delta));
              });
            });
            await Promise.all(waits);
          };

          let phase = nextPhase(IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = puzzlePhaseTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                // Every piece but the last one gathers in; the last hovers beside the frame.
                await go({ ...current, fill: Math.max(current.fill, (PIECES - 0.5) / PIECES) }, timing.duration);
                break;
              case 'overflow': {
                onOverflow?.();
                const d = timing.duration;
                const shine = animate(
                  shineRef.current,
                  [
                    { transform: 'translateX(-150px)', opacity: 0 },
                    { transform: 'translateX(-40px)', opacity: 1, offset: 0.45 },
                    { transform: 'translateX(80px)', opacity: 0 },
                  ],
                  { duration: d * 0.75, delay: d * 0.25, easing: 'ease-in-out', fill: 'backwards' },
                );
                const sway = animate(
                  hangRef.current,
                  [{ transform: 'rotate(0deg)' }, { transform: 'rotate(1.6deg)', offset: 0.45 }, { transform: 'rotate(-0.8deg)', offset: 0.75 }, { transform: 'rotate(0deg)' }],
                  { duration: d, easing: 'ease-out' },
                );
                track(shine);
                track(sway);
                await Promise.all([go({ ...current, fill: 1 }, d * 0.55, true), done(shine, d), done(sway, d)]);
                break;
              }
              case 'draining':
                // The pieces of the finished picture fade; under them waits the next one's print.
                await go({ ...current, fill: 1, cleared: true, board: cycleLevel(phase, startLevel, endLevel) }, timing.duration);
                break;
              case 'refilling':
                await go({ fill: refillTarget(phase, end), cleared: false, level: current.board, board: current.board }, timing.duration);
                break;
            }
            phase = nextPhase(phase, DONE[phase.phase]);
          }
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            flushSync(() => {
              setOverride(final);
              setPlaque(placedIn(final));
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

  const shownMarks = marks ?? [];
  const reserved = useRef(false);
  reserved.current = scripted ? reserved.current || shownMarks.length > 0 : shownMarks.length > 0;
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const captionY = captionYs(captioned.map((m) => markPoint(m.height).y));
  const percent = Math.floor((view.cleared ? 0 : view.fill) * 100);
  const pic = pictureIndex(view.level);
  const print = pictureIndex(view.board);

  const classes = ['puzzle', 'puzzle--hero', `puzzle--${state}`, reserved.current ? 'puzzle--marked' : '', scripted ? 'puzzle--scripted' : ''];

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <svg ref={svgRef} className="puzzle-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label ?? puzzleText.fillLabel(percent)}>
        <defs>
          <PictureDefs p={id} />
          <radialGradient id={`${id}-glow`}>
            <stop offset="0.3" className="pz-glow" stopOpacity="0.45" />
            <stop offset="1" className="pz-glow" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-shine`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" className="pz-glint" stopOpacity="0" />
            <stop offset="0.5" className="pz-glint" stopOpacity="0.9" />
            <stop offset="1" className="pz-glint" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${id}-inner`}>
            <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} />
          </clipPath>
          {PATHS.map((d, k) => (
            <clipPath key={k} id={`${id}-p${k}`}>
              <path d={d} />
            </clipPath>
          ))}
          {[...new Set([pic, print])].map((i) => (
            <g key={i} id={`${id}-pic${i}`} transform={`translate(${X0} ${Y0})`}>
              <PictureArt index={i} p={id} />
            </g>
          ))}
        </defs>
        <g ref={hangRef} className="pz-hang">
          <path d={`M${X0 + 18} ${Y0 - BORDER}L${NAIL.x} ${NAIL.y}L${X1 - 18} ${Y0 - BORDER}`} className="pz-wire" />
          <rect x={X0 - BORDER} y={Y0 - BORDER} width={X1 - X0 + 2 * BORDER} height={Y1 - Y0 + 2 * BORDER} rx="3" className="pz-frame" />
          <rect x={X0 - BORDER} y={Y0 - BORDER} width={X1 - X0 + 2 * BORDER} height={Y1 - Y0 + 2 * BORDER} rx="3" className="pz-frame-gold" />
          <rect x={X0 - BORDER + 2} y={Y0 - BORDER + 2} width={X1 - X0 + 2 * BORDER - 4} height={Y1 - Y0 + 2 * BORDER - 4} rx="2" className="pz-frame-bevel" />
          <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} className="pz-slots" />
          <g ref={boardRef}>
            <use href={`#${id}-pic${print}`} clipPath={`url(#${id}-inner)`} className="pz-ghost" />
            <path d={CUTS} className="pz-cuts" />
            {ORDER.map((_, k) => {
              const v: PieceVisual = view.cleared ? 'hidden' : k < stage.placed ? 'placed' : k === stage.placed ? 'floating' : 'hidden';
              const c = centre(k);
              const style: CSSProperties = { transform: pieceTransform(k, v, stage.share), transformOrigin: `${c.x}px ${c.y}px`, opacity: VISIBLE[v] };
              return (
                <g key={k} ref={(el) => void (pieceRefs.current[k] = el)} className={`pz-piece pz-piece--${v}`} style={style}>
                  <g className={v === 'floating' ? 'pz-bob anim-decor' : undefined}>
                    <circle cx={c.x} cy={c.y} r={S * 0.95} fill={`url(#${id}-glow)`} className="pz-piece-glow" />
                    <path d={PATHS[k]} className="pz-piece-back" />
                    <use href={`#${id}-pic${pic}`} clipPath={`url(#${id}-p${k})`} />
                    <path d={PATHS[k]} className="pz-piece-edge" />
                  </g>
                </g>
              );
            })}
          </g>
          <g clipPath={`url(#${id}-inner)`} aria-hidden="true">
            <g transform={`rotate(24 ${NAIL.x} ${(Y0 + Y1) / 2})`}>
              <rect ref={shineRef} x={X0 + 10} y={Y0 - 60} width="40" height={Y1 - Y0 + 120} fill={`url(#${id}-shine)`} className="pz-shine" />
            </g>
          </g>
          <circle cx={NAIL.x} cy={NAIL.y} r="3" className="pz-nail" />
        </g>
        <g className="pz-count" aria-hidden="true">
          <rect x={NAIL.x - 24} y={Y1 + BORDER + 10} width="48" height="18" rx="5" className="pz-plaque" />
          <text x={NAIL.x} y={Y1 + BORDER + 19.5} textAnchor="middle" dominantBaseline="central">
            {plaque} / {PIECES}
          </text>
        </g>
        {shownMarks.map((mark) => {
          const { x, y } = markPoint(mark.height);
          return (
            <g key={mark.id} className="pz-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              <rect x={x - 12} y={y - 14} width={X0 - x + 16} height="20" className="pz-mark-hit" />
              <line x1={x} x2={X0 + 3} y1={y} y2={y} className="pz-mark-tick" />
              <line x1={x} x2={x} y1={y + 1} y2={y - 12} className="pz-mark-pole" />
              <path d={`M${x} ${y - 12}L${x - 9} ${y - 8.5}L${x} ${y - 5}Z`} className="pz-mark-flag" />
            </g>
          );
        })}
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="pz-mark-caption"
          style={{ top: `${(captionY[i]! / VIEW_H) * 100}%`, paddingBlock: captionPad(captionY, i) }}
          aria-label={copy.marks.onFlask(mark.label)}
          onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}
        >
          {shortLabel(mark.label)}
        </button>
      ))}
    </div>
  );
}

// ---- Mini: the frame and its grid; the placed cells show the level's picture ----

const M = { x0: 8, y0: 4, s: 8 };

function PuzzleMini({ fill, state = 'active', level, size = 32, label }: ProgressMiniProps) {
  const id = `pzm${useId().replace(/[^\w-]/g, '')}`;
  const shown = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const placed = puzzlePlaced(shown);
  const w = COLS * M.s;
  const h = ROWS * M.s;
  return (
    <svg
      className={`puzzle puzzle--mini puzzle--${state}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={label ?? puzzleText.fillLabel(Math.floor(shown * 100))}
    >
      <defs>
        <PictureDefs p={id} />
        <clipPath id={`${id}-clip`}>
          {ORDER.slice(0, placed).map(([c, r]) => (
            <rect key={`${c}-${r}`} x={M.x0 + c * M.s} y={M.y0 + r * M.s} width={M.s} height={M.s} />
          ))}
        </clipPath>
      </defs>
      <rect x={M.x0 - 2.5} y={M.y0 - 2.5} width={w + 5} height={h + 5} rx="2" className="pz-frame" />
      <rect x={M.x0 - 2.5} y={M.y0 - 2.5} width={w + 5} height={h + 5} rx="2" className="pz-frame-gold" />
      <rect x={M.x0} y={M.y0} width={w} height={h} className="pz-slots" />
      <g clipPath={`url(#${id}-clip)`}>
        <g transform={`translate(${M.x0} ${M.y0}) scale(${w / PIC_W})`}>
          <PictureArt index={pictureIndex(level)} p={id} />
        </g>
      </g>
      <path
        d={`M${M.x0 + M.s} ${M.y0}v${h}M${M.x0 + 2 * M.s} ${M.y0}v${h}M${M.x0} ${M.y0 + M.s}h${w}M${M.x0} ${M.y0 + 2 * M.s}h${w}M${M.x0} ${M.y0 + 3 * M.s}h${w}`}
        className="pz-mini-grid"
      />
    </svg>
  );
}

export const puzzleTheme: ProgressThemeDefinition = {
  key: 'puzzle',
  text: puzzleText,
  available: true,
  Hero: PuzzleHero,
  Mini: PuzzleMini,
  markPoint,
};
