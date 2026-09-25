import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '../../../lib/format';
import { DONE_EVENT, FINISH_FALLBACK_MS, IDLE, nextPhase, refillTarget, type AnimationState, type PhaseTiming } from '../../components/flaskAnimation';
import { copy } from '../../copy';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMark, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import './book.css';

// «Книжка»: an open book seen from the front and a little from above. The read pages pile up
// on the left, the unread ones thin out on the right; each stack is one group moved by a single
// translateY and revealed above the cover by a clip, so its page edges (stacked lines) show
// exactly as thick as the stack is. The paper, the ink and the shelves keep their natural
// colours; the cover is the one detail in the skill colour, and a finished skill is a closed
// golden book. Every finished level is a book in the bookcase around it (`level` − 1 of them).
//
// The level-up reuses the flask's state machine (flaskAnimation.ts) with the book's timings:
//   rising    — the last pages pile up on the left (the stacks move to fill 1);
//   overflow  — the beat: the last page turns across the spine (scaleX 1 → −1 around the spine
//               with a skew for the lift), onOverflow fires here;
//   draining  — the reset: the left half folds onto the right (scaleX → 0), the front cover
//               swings over it, and the closed book flies into its slot in the bookcase;
//   refilling — a new open book appears and its stacks settle at `toFill`.
// Only transform and opacity animate. The idle page-corner lift is the one decorative loop.

const VIEW_W = 160;
const VIEW_H = 260;

/** Thickness of a stack at its thinnest (the cover's endpaper) and what the pages add. */
export const STACK_MIN = 2;
export const STACK_TRAVEL = 22;

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Heights of the read (left) and unread (right) page stacks in viewBox units for `fill`. */
export function stackHeights(fill: number): { read: number; unread: number } {
  const f = clamp(fill);
  return { read: STACK_MIN + f * STACK_TRAVEL, unread: STACK_MIN + (1 - f) * STACK_TRAVEL };
}

/** The line under the book: «стр. 45 из 100» with a capacity, «45 %» without. */
export function pageLabel(fill: number, capacity?: number): string {
  const f = clamp(fill);
  if (capacity !== undefined && Number.isFinite(capacity) && capacity > 0) {
    return `стр. ${formatNumber(Math.round(f * capacity))} из ${formatNumber(capacity)}`;
  }
  return `${Math.floor(f * 100)} %`;
}

// Marks: bookmark ribbons peeking out of the fore-edge of the page block, bottom → top.
const MARK_X = 152;
const MARK_BOTTOM = 166;
const MARK_TOP = 80;

export function markPoint(height: number): { x: number; y: number } {
  return { x: MARK_X, y: MARK_BOTTOM - clamp(height) * (MARK_BOTTOM - MARK_TOP) };
}

// ---- The bookcase: one closed book for every finished level ----
//
// The first books stand on a near shelf under the page label, full size. When it is full, a
// bookcase appears above the open book, further away: smaller spines on shelves added upward as
// the library grows; past two shelves it recedes into a denser tier of three. A book's size,
// colour, title band and lean come from its index alone, so a level always shows the same
// shelves and a new book never moves the ones before it (only the last one straightens up).

/** Books in the bookcase at `level` (1-based, the level being read now): one per level before. */
export function booksBefore(level?: number): number {
  return level !== undefined && Number.isFinite(level) ? Math.max(0, Math.floor(level) - 1) : 0;
}

/** A deterministic 0..1 for book `i` and property `k`. */
function rand(i: number, k: number): number {
  let h = Math.imul(i + 0x9e37, 0x85ebca6b) ^ Math.imul(k + 0x7f4a, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Natural cover colours are tones 0..5 (book.css); 6 and 7 are the skill colour. */
export const NATURAL_TONES = 6;

/** Neighbours never share a colour; every third or fourth book is in the skill colour. */
export function bookTone(i: number): number {
  const k = i % 7;
  if (k === 0 || k === 4) return NATURAL_TONES + (Math.floor(i / 7) % 2);
  return (2 * i + (rand(i, 2) < 0.5 ? 0 : 1)) % NATURAL_TONES;
}

interface RowSpec {
  /** The plank's top, where the books stand. */
  y: number;
  /** Scale of the books: 1 on the near shelf, smaller further away. */
  s: number;
}

const NEAR: RowSpec = { y: 246, s: 1 };
/** The bookcase above the book, shelves bottom → top; the second tier is the denser one. */
const FAR: RowSpec[][] = [
  [
    { y: 38, s: 0.56 },
    { y: 19, s: 0.4 },
  ],
  [
    { y: 38, s: 0.42 },
    { y: 23.5, s: 0.33 },
    { y: 11.5, s: 0.26 },
  ],
];
const FAR_TOP = 4;
const ROW_X0 = 14;
const ROW_X1 = 146;

export interface ShelfBook {
  i: number;
  /** Bottom-left corner on the plank (the pivot of a lean). */
  x: number;
  y: number;
  w: number;
  h: number;
  tone: number;
  /** Title band style 0..3. */
  band: number;
  /** Degrees, negative: leaning left onto the neighbour. */
  lean: number;
}

export interface ShelfRow {
  y: number;
  s: number;
  /** Where the shelf above (or the top of the bookcase) is. */
  top: number;
  books: ShelfBook[];
  /** x of a bookend after the last book, on a near shelf with room. */
  end: number | null;
}

export interface Bookcase {
  /** The near shelf first, then the bookcase's shelves bottom → top; empty without books. */
  rows: ShelfRow[];
  /** Tier of the bookcase above (−1: not there yet). */
  tier: number;
  /** Books drawn: all of them until even the dense tier is full. */
  shown: number;
}

function placeRow({ y, s }: RowSpec, top: number, from: number, count: number, near: boolean): ShelfRow {
  const books: ShelfBook[] = [];
  let x = ROW_X0;
  let i = from;
  for (; i < count; i++) {
    const w = (6 + 3.5 * rand(i, 0)) * s;
    if (x + w > ROW_X1) break;
    books.push({ i, x, y, w, h: (22 + 8 * rand(i, 1)) * s, tone: bookTone(i), band: Math.floor(rand(i, 3) * 4), lean: 0 });
    x += w + 0.8 * s;
  }
  let end: number | null = null;
  const last = books.at(-1);
  const prev = books.at(-2);
  if (last && i === count) {
    // Room left: the last book leans on its neighbour or stands against a bookend.
    const a = ((7 + 7 * rand(last.i, 5)) * Math.PI) / 180;
    const shift = prev ? Math.min(prev.h * Math.tan(a), last.h * Math.sin(a)) + 0.4 * s : 0;
    if (prev && rand(last.i, 4) < 0.5 && prev.x + prev.w + shift + last.w * Math.cos(a) < ROW_X1) {
      last.x = prev.x + prev.w + shift;
      last.lean = -(a * 180) / Math.PI;
    } else if (near && x + 4 < ROW_X1) end = x;
  }
  return { y, s, top, books, end };
}

/** The shelves for `count` books, oldest first: the near shelf, then the bookcase above. */
export function bookcase(count: number): Bookcase {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!n) return { rows: [], tier: -1, shown: 0 };
  const near = placeRow(NEAR, NEAR.y, 0, n, true);
  let far: ShelfRow[] = [];
  let tier = -1;
  let shown = near.books.length;
  for (let t = 0; t < FAR.length && shown < n; t++) {
    const specs = FAR[t]!;
    far = [];
    tier = t;
    shown = near.books.length;
    for (let r = 0; r < specs.length && shown < n; r++) {
      const row = placeRow(specs[r]!, specs[r + 1]?.y ?? FAR_TOP, shown, n, false);
      far.push(row);
      shown += row.books.length;
    }
  }
  return { rows: [near, ...far], tier, shown };
}

/**
 * Top of the bookcase above the book (null until it is there). It only ever rises: the denser
 * tier keeps the full height the first one reached.
 */
export function caseTop(layout: Bookcase): number | null {
  if (layout.rows.length < 2) return null;
  return layout.tier > 0 ? FAR_TOP : layout.rows.at(-1)!.top;
}

/** The newest book drawn: where a closed book lands. */
export function newestBook(layout: Bookcase): ShelfBook | null {
  return layout.rows.at(-1)?.books.at(-1) ?? null;
}

/** The closed book: the cover x 80..152, y 50..184 over its page block showing to 155, 187. */
const CLOSED = { x0: 80, x1: 155, y0: 50, y1: 187 };

/**
 * Where the closed book lands: its bottom-left corner on the book's pivot, turned by its lean
 * and scaled to its size. `flight()` writes it as a CSS transform (origin 0 0).
 */
export function landingTransform(book: ShelfBook): { x: number; y: number; r: number; sx: number; sy: number } {
  return { x: book.x, y: book.y, r: book.lean, sx: book.w / (CLOSED.x1 - CLOSED.x0), sy: book.h / (CLOSED.y1 - CLOSED.y0) };
}

export function flight({ x, y, r, sx, sy }: ReturnType<typeof landingTransform>): string {
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) translate(${-CLOSED.x0}px, ${-CLOSED.y1}px)`;
}

const AT_REST = flight({ x: CLOSED.x0, y: CLOSED.y1, r: 0, sx: 1, sy: 1 });

/**
 * Timings of the book's level-up: rise 150, page turn 300, close and shelve 500, new book 250 —
 * 1.2 s for one level; the repeats of a multi-level write run 300 + 180.
 */
export function bookPhaseTiming(state: AnimationState): PhaseTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 150, easing: 'out' };
    case 'overflow':
      return { delay: 0, duration: 300, easing: 'out' };
    case 'draining':
      return compressed ? { delay: 0, duration: 300, easing: 'in' } : { delay: 0, duration: 500, easing: 'in' };
    case 'refilling':
      return compressed ? { delay: 0, duration: 180, easing: 'out' } : { delay: 0, duration: 250, easing: 'spring' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

/** Keyframes of one page turning from the right stack (height `from`) onto the left (`to`). */
export function turnKeyframes(from: number, to: number): Keyframe[] {
  const lift = Math.max(from, to) + 12;
  return [
    { transform: `translate(0px, ${-from}px) skewY(0deg) scale(1, 1)`, opacity: 1 },
    { transform: `translate(0px, ${-(from + 6)}px) skewY(-12deg) scale(0.62, 1)`, opacity: 1, offset: 0.25 },
    { transform: `translate(0px, ${-lift}px) skewY(0deg) scale(0.02, 1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(0px, ${-(to + 6)}px) skewY(12deg) scale(-0.62, 1)`, opacity: 1, offset: 0.75 },
    { transform: `translate(0px, ${-to}px) skewY(0deg) scale(-1, 1)`, opacity: 1 },
  ];
}

// ---- Geometry (viewBox 0 0 160 260). Side 1 is the left half, −1 its mirror on the right. ----

type Side = 1 | -1;
const SIDES: Side[] = [1, -1];
const X = (s: Side, x: number) => (s === 1 ? x : VIEW_W - x);
/** The top page at stack height 0: its bottom edge dips into the gutter at the spine. */
const facePath = (s: Side) =>
  `M${X(s, 80)} 70C${X(s, 64)} 60 ${X(s, 36)} 58 ${X(s, 12)} 64V172C${X(s, 36)} 168 ${X(s, 64)} 168 ${X(s, 80)} 178Z`;
const baseCurve = (s: Side, dy: number) =>
  `M${X(s, 12)} ${172 + dy}C${X(s, 36)} ${168 + dy} ${X(s, 64)} ${168 + dy} ${X(s, 80)} ${178 + dy}`;
/** The page edges under the top page, deep enough for the thickest stack. */
const bandPath = (s: Side) => `${baseCurve(s, 0)}V204C${X(s, 64)} 194 ${X(s, 36)} 194 ${X(s, 12)} 198Z`;
/** Everything above the cover: a stack shows as much page edge as it is raised. */
const clipD = (s: Side) => `M${X(s, 0)} 0H${X(s, 80)}V178C${X(s, 64)} 168 ${X(s, 36)} 168 ${X(s, 12)} 172H${X(s, 0)}Z`;
const coverPath = (s: Side) =>
  `M${X(s, 80)} 64C${X(s, 62)} 54 ${X(s, 36)} 52 ${X(s, 6)} 60V179C${X(s, 36)} 175 ${X(s, 62)} 176 ${X(s, 80)} 186Z`;
/** The board's front edge under the pages. */
const boardPath = (s: Side) =>
  `M${X(s, 6)} 173C${X(s, 36)} 169 ${X(s, 62)} 170 ${X(s, 80)} 180V186C${X(s, 62)} 176 ${X(s, 36)} 175 ${X(s, 6)} 179Z`;
const EDGE_LINES = [3, 6, 9, 12, 15, 18, 21, 24];
/** Lines of «text» on a page: lengths, 9 units apart from y 84. */
const TEXT_LINES = [48, 44, 48, 30, 47, 48, 40, 48, 24];
const textLine = (s: Side, i: number) => {
  const x = s === 1 ? 22 : 90;
  const y = 84 + i * 9;
  return `M${x} ${y}H${x + TEXT_LINES[i]!}`;
};

// ---- Marks ----

const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const CAPTION_GAP = 18;
/** Left edge of the captions (viewBox units): just past the ribbons' tips. */
const CAPTION_X = 161;
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

// ---- WAAPI, guarded as in progress/themes/flask.tsx ----

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function done(animation: Animation | null, duration: number): Promise<void> {
  if (!animation) return Promise.resolve();
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
    return el.animate(keyframes, { ...options, easing: 'ease-out' });
  }
}

const lift = (h: number) => `translateY(${(-h).toFixed(2)}px)`;

// ---- Text ----

const text: ProgressThemeText = {
  name: 'Книжка',
  levelNoun: 'Книга',
  levelGenitive: 'книги',
  levelForms: ['книга', 'книги', 'книг'],
  levelFormsOf: ['книги', 'книг', 'книг'],
  completed: (n: number) => `Книга ${n} прочитана`,
  fillLabel: (percent: number) => `Книга прочитана на ${percent}%`,
  hint: 'Страницы перелистываются до последней',
};

// ---- Hero ----

/** One half's page stack: the page edges, the top page, its gutter shade and its lines of text. */
function Stack({ side, id, curl }: { side: Side; id: string; curl?: boolean }) {
  return (
    <>
      <path d={bandPath(side)} className="book-band" />
      {EDGE_LINES.map((dy) => (
        <path key={dy} d={baseCurve(side, dy)} className="book-edge-line" />
      ))}
      <path d={facePath(side)} className="book-page" />
      <path d={facePath(side)} fill={`url(#${id}-gutter${side})`} />
      {TEXT_LINES.map((_, i) => (
        <path key={i} d={textLine(side, i)} className="book-ink" />
      ))}
      {curl && <path d="M134 62.6Q142 66.5 148 76V64Q141 62 134 62.6Z" className="book-curl anim-decor" />}
    </>
  );
}

const n2 = (v: number) => Math.round(v * 100) / 100;

/** A spine on a shelf with its title band: two thin lines, one, a label, or a pair at the top. */
function Spine({ book: b, s }: { book: ShelfBook; s: number }) {
  const top = b.y - b.h;
  const x0 = n2(b.x);
  const x1 = n2(b.x + b.w);
  const at = (f: number) => n2(top + b.h * f);
  const band = [
    `M${x0} ${at(0.17)}H${x1}M${x0} ${at(0.85)}H${x1}`,
    `M${x0} ${at(0.3)}H${x1}`,
    `M${n2(b.x + b.w * 0.24)} ${at(0.34)}H${n2(b.x + b.w * 0.76)}`,
    `M${x0} ${at(0.12)}H${x1}M${x0} ${at(0.21)}H${x1}`,
  ][b.band];
  return (
    <g data-book={b.i} transform={b.lean ? `rotate(${n2(b.lean)} ${x0} ${b.y})` : undefined}>
      <rect x={x0} y={n2(top)} width={n2(b.w)} height={n2(b.h)} rx={n2(0.9 * s)} className={`book-tone-${b.tone}`} />
      <path d={band} className="book-title" strokeWidth={b.band === 2 ? n2(b.h * 0.13) : n2(Math.max(0.7, 1.1 * s))} />
    </g>
  );
}

/** The near shelf under the label and, once it is full, the bookcase above the open book. */
function Shelves({ layout }: { layout: Bookcase }) {
  const top = caseTop(layout);
  const far = top !== null;
  return (
    <>
      {far && (
        <g data-frame="" className="book-case-frame">
          <rect x="11.6" y={top} width="136.8" height={246 - top} className="book-case-back" />
          <path d={`M8 ${top - 2.6}h144v2.6H8ZM9 ${top}h2.6V246H9ZM148.4 ${top}h2.6V246h-2.6Z`} className="book-case-wood" />
        </g>
      )}
      {layout.rows.map((row, r) => (
        <g key={r} data-row={r} className={`book-row book-row--${r}`}>
          {r === 0 ? (
            <>
              <rect x="10" y={row.y} width="140" height="4.5" rx="1.5" className="book-plank" />
              {!far && <path d={`M22 ${row.y + 4.5}v5h5v-5M133 ${row.y + 4.5}v5h5v-5`} className="book-bracket" />}
            </>
          ) : (
            <rect x="10" y={row.y} width="140" height={n2(1 + 2.2 * row.s)} className="book-plank" />
          )}
          {row.books.map((b) => (
            <Spine key={b.i} book={b} s={row.s} />
          ))}
          {row.end !== null && <path d={`M${n2(row.end)} ${row.y}V${row.y - 13}Q${n2(row.end)} ${row.y - 17} ${n2(row.end + 4)} ${row.y - 17}V${row.y}Z`} className="book-end" />}
        </g>
      ))}
    </>
  );
}

function Hero({ fill, capacity, level, state = 'active', motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const id = `book${useId().replace(/[^\w-]/g, '')}`;
  const complete = state === 'complete';
  const target = complete ? 1 : state === 'empty' ? 0 : clamp(fill);

  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  // The bookcase holds a book per finished level. A level-up counts the books itself while it
  // plays (the app has already rendered the new `level`, before the book has flown); without a
  // `level` the books shelved while this hero is on screen stay.
  const [booksOverride, setBooksOverride] = useState<number | null>(null);
  const [shelvedHere, setShelvedHere] = useState(0);
  const [flyTone, setFlyTone] = useState(NATURAL_TONES);
  const books = booksOverride ?? (level === undefined ? shelvedHere : booksBefore(level));
  const booksRef = useRef(books);
  booksRef.current = books;
  const levelRef = useRef(level);
  levelRef.current = level;
  const layout = useMemo(() => bookcase(books), [books]);
  const playing = useRef(false);
  const playToken = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const shown = override ?? target;

  const svgRef = useRef<SVGSVGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const leftRef = useRef<SVGGElement>(null);
  const readRef = useRef<SVGGElement>(null);
  const unreadRef = useRef<SVGGElement>(null);
  const turnRef = useRef<SVGGElement>(null);
  const turnShadeRef = useRef<SVGPathElement>(null);
  const closedRef = useRef<SVGGElement>(null);
  const tintRef = useRef<SVGRectElement>(null);
  const labelRef = useRef<SVGTextElement>(null);
  const caseRef = useRef<SVGGElement>(null);
  const goldRef = useRef<SVGGElement>(null);

  useEffect(installPauseWhenHidden, []);

  // Prop-driven changes: a page turns while the stacks glide; a crossfade under reduced motion.
  const previous = useRef(target);
  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (playing.current || from === target) return;
    setOverride(null);
    if (complete) return;
    if (motion === 'reduced') {
      animate(bodyRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    if (target > from) {
      animate(turnRef.current, turnKeyframes(stackHeights(from).unread, stackHeights(target).read), { duration: 460, easing: 'ease-in-out' });
      animate(turnShadeRef.current, [{ opacity: 0 }, { opacity: 0.4 }, { opacity: 0 }], { duration: 460, easing: 'ease-in-out' });
    }
  }, [target, motion, complete]);

  // The golden book arrives when the skill is completed on screen (never on first load).
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || !complete) return;
    const keyframes =
      motion === 'reduced'
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translate(4px, 10px) scale(0.95)' },
            { opacity: 1, transform: 'translate(0px, 0px) scale(1)' },
          ];
    animate(goldRef.current, keyframes, { duration: motion === 'reduced' ? 240 : 500, easing: motion === 'reduced' ? 'ease-out' : easings().spring });
  }, [state, motion, complete]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => bodyRef.current ?? svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const body = bodyRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        const finished = Math.max(1, Math.floor(Number.isFinite(levels) ? levels : 1));
        // The books standing before this write. The app renders the new level before it plays
        // (the contract's level rule), so with a `level` they are the new level's minus the
        // finished ones; without one, the books on screen.
        const base = levelRef.current === undefined ? booksRef.current : Math.max(0, Math.min(booksRef.current, booksBefore(levelRef.current) - finished));
        /** After the play (or a jump past three books) `level` counts again: base + levels. */
        const settle = () => {
          setBooksOverride(null);
          setShelvedHere(base + finished);
          setFlyTone(NATURAL_TONES);
        };
        if (!body || typeof body.animate !== 'function') {
          onOverflow?.();
          settle();
          return;
        }
        playing.current = true;
        const running: Animation[] = [];
        // The open book's layers, dropped when the new book appears (the spines stay).
        let scene: Animation[] = [];
        const track = (a: Animation | null, keep = false): Animation | null => {
          if (a) {
            running.push(a);
            if (!keep) scene.push(a);
          }
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
          setBooksOverride(base);
        });
        let landed = 0;
        /**
         * Puts the next book into the bookcase (hidden until it lands) and returns its slot, its
         * element and what appears with it: a new shelf, the bookcase itself, a denser tier.
         */
        const shelve = () => {
          const before = bookcase(base + landed);
          landed += 1;
          const after = bookcase(base + landed);
          const slot = newestBook(after)!;
          flushSync(() => {
            setBooksOverride(base + landed);
            setFlyTone(slot.tone);
          });
          const box = caseRef.current;
          const fresh: Element[] = [];
          if (box) {
            if (after.tier !== before.tier) fresh.push(...box.querySelectorAll('[data-frame], [data-row]:not([data-row="0"])'));
            else for (let r = before.rows.length; r < after.rows.length; r++) fresh.push(...box.querySelectorAll(`[data-row="${r}"]`));
          }
          const spine = after.shown > before.shown ? (box?.querySelector(`[data-book="${slot.i}"]`) ?? null) : null;
          return { slot, spine, fresh };
        };

        try {
          if (motion === 'reduced') {
            onOverflow?.();
            flushSync(() => {
              setOverride(end);
              setBooksOverride(base + finished);
            });
            const fade = track(animate(body, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }));
            const shelves = track(animate(caseRef.current, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }));
            await Promise.all([done(fade, 240), done(shelves, 240)]);
            return;
          }
          const ease = easings();
          let current = start;

          const stacksTo = async (from: number, to: number, timing: PhaseTiming) => {
            const a = stackHeights(from);
            const b = stackHeights(to);
            const options: KeyframeAnimationOptions = { duration: timing.duration, easing: ease[timing.easing], fill: 'both' };
            await Promise.all([
              done(track(animate(readRef.current, [{ transform: lift(a.read) }, { transform: lift(b.read) }], options)), timing.duration),
              done(track(animate(unreadRef.current, [{ transform: lift(a.unread) }, { transform: lift(b.unread) }], options)), timing.duration),
            ]);
          };

          const turnLastPage = async (timing: PhaseTiming) => {
            const h = stackHeights(1);
            const options: KeyframeAnimationOptions = { duration: timing.duration, easing: 'ease-in-out' };
            await Promise.all([
              done(track(animate(turnRef.current, turnKeyframes(h.unread + STACK_TRAVEL * 0.04, h.read), options)), timing.duration),
              done(track(animate(turnShadeRef.current, [{ opacity: 0 }, { opacity: 0.45 }, { opacity: 0 }], options)), timing.duration),
            ]);
          };

          const closeAndShelve = async (timing: PhaseTiming) => {
            const { slot, spine, fresh } = shelve();
            const onShelf = flight(landingTransform(slot));
            const d = timing.duration;
            const options: KeyframeAnimationOptions = { duration: d, easing: 'linear', fill: 'forwards' };
            await Promise.all([
              // The left half folds onto the spine…
              done(
                track(
                  animate(
                    leftRef.current,
                    [
                      { transform: 'scaleX(1)', opacity: 1, easing: 'ease-in' },
                      { transform: 'scaleX(0.12)', opacity: 1, offset: 0.19 },
                      { transform: 'scaleX(0.001)', opacity: 0, offset: 0.22 },
                      { transform: 'scaleX(0.001)', opacity: 0 },
                    ],
                    options,
                  ),
                ),
                d,
              ),
              // …and swings over as the front cover of a closed book.
              done(
                track(
                  animate(
                    closedRef.current,
                    [
                      { transform: 'scaleX(0.001)', opacity: 0 },
                      { transform: 'scaleX(0.001)', opacity: 1, offset: 0.22, easing: 'ease-out' },
                      { transform: 'scaleX(1)', opacity: 1, offset: 0.36 },
                      { transform: 'scaleX(1)', opacity: 1 },
                    ],
                    options,
                  ),
                ),
                d,
              ),
              // The closed book flies into its slot, taking on its colour on the way…
              done(
                track(
                  animate(
                    body,
                    [
                      { transform: AT_REST, opacity: 1 },
                      { transform: AT_REST, opacity: 1, offset: 0.4, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' },
                      { transform: onShelf, opacity: 1, offset: 0.9 },
                      { transform: onShelf, opacity: 0 },
                    ],
                    options,
                  ),
                ),
                d,
              ),
              done(track(animate(tintRef.current, [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1, offset: 0.85 }, { opacity: 1 }], options)), d),
              // …and turns into its spine there; a new shelf fades in before it arrives.
              done(track(animate(spine, [{ opacity: 0 }, { opacity: 0, offset: 0.86 }, { opacity: 1 }], { ...options, fill: 'both' }), true), d),
              ...fresh.map((el) => {
                const to = Number(getComputedStyle(el).opacity) || 1;
                const frames = [{ opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: to, offset: 0.6 }, { opacity: to }];
                return done(track(animate(el, frames, { ...options, fill: 'both' }), true), d);
              }),
              done(track(animate(labelRef.current, [{ opacity: 1 }, { opacity: 0, offset: 0.25 }, { opacity: 0 }], options)), d),
            ]);
          };

          const openNewBook = async (to: number, timing: PhaseTiming) => {
            // The static layers now show the new book at `to`; the old book's layers go.
            flushSync(() => setOverride(to));
            scene.forEach((a) => a.cancel());
            scene = [];
            const d = timing.duration;
            // Appears from 94 % around the centre of the book, 10 units higher.
            const s = 0.94;
            const cx = 80;
            const cy = 120;
            const from = `translate(${((1 - s) * cx).toFixed(2)}px, ${((1 - s) * cy - 10).toFixed(2)}px) scale(${s}, ${s})`;
            const a = stackHeights(0);
            const b = stackHeights(to);
            const stackOptions: KeyframeAnimationOptions = { duration: d, easing: ease[timing.easing], fill: 'both' };
            await Promise.all([
              done(track(animate(body, [{ transform: from, opacity: 0 }, { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1 }], { duration: d * 0.7, easing: ease.out, fill: 'both' })), d),
              done(track(animate(readRef.current, [{ transform: lift(a.read) }, { transform: lift(b.read) }], stackOptions)), d),
              done(track(animate(unreadRef.current, [{ transform: lift(a.unread) }, { transform: lift(b.unread) }], stackOptions)), d),
              done(track(animate(labelRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: d, easing: 'ease-out', fill: 'both' })), d),
            ]);
          };

          let phase = nextPhase(IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = bookPhaseTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await stacksTo(current, 1, timing);
                current = 1;
                if (!aborted()) flushSync(() => setOverride(1));
                break;
              case 'overflow':
                onOverflow?.();
                await turnLastPage(timing);
                break;
              case 'draining':
                await closeAndShelve(timing);
                break;
              case 'refilling': {
                const to = refillTarget(phase, end);
                await openNewBook(to, timing);
                current = to;
                break;
              }
            }
            phase = nextPhase(phase, { type: DONE_EVENT[phase.phase] } as Parameters<typeof nextPhase>[1]);
          }
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            flushSync(() => {
              setOverride(end);
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

  // Marks are static; the room for captions stays while a choreography runs.
  const shownMarks = marks ?? [];
  const reserved = useRef(false);
  reserved.current = scripted ? reserved.current || shownMarks.length > 0 : shownMarks.length > 0;
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  /** A mark the reading has passed: in the skill colour; the ones ahead stay muted. */
  const reached = (mark: ProgressMark) => clamp(mark.height) <= shown + 1e-6;
  const captionY = captionYs(captioned.map((m) => markPoint(m.height).y));
  const heights = stackHeights(shown);

  const classes = ['book', 'book--hero', `book--${state}`, reserved.current ? 'book--marked' : '', scripted ? 'book--scripted' : ''].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
      <svg ref={svgRef} className="book-svg" viewBox="0 0 160 260" role="img" aria-label={label ?? text.fillLabel(Math.floor(shown * 100))}>
        <defs>
          {SIDES.map((s) => (
            <clipPath key={s} id={`${id}-clip${s}`}>
              <path d={clipD(s)} />
            </clipPath>
          ))}
          {SIDES.map((s) => (
            <linearGradient key={s} id={`${id}-gutter${s}`} gradientUnits="userSpaceOnUse" x1={X(s, 52)} x2={X(s, 80)} y1="0" y2="0">
              <stop offset="0" className="book-gutter-from" />
              <stop offset="1" className="book-gutter-to" />
            </linearGradient>
          ))}
          <linearGradient id={`${id}-gold`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" className="book-gold-from" />
            <stop offset="1" className="book-gold-to" />
          </linearGradient>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0" className="book-glow-from" />
            <stop offset="1" className="book-glow-to" />
          </radialGradient>
        </defs>

        <g ref={caseRef} className="book-case" aria-hidden="true">
          {layout.shown > 0 && <Shelves layout={layout} />}
        </g>

        {complete ? (
          <g ref={goldRef} className="book-gold">
            <circle cx="82" cy="108" r="78" fill={`url(#${id}-glow)`} />
            <rect x="46" y="48" width="80" height="124" rx="4" className="book-page" />
            <path d="M120 54V166M123 54V166" className="book-edge-line" />
            <rect x="38" y="42" width="82" height="126" rx="5" fill={`url(#${id}-gold)`} className="book-gold-cover" />
            <rect x="38" y="42" width="11" height="126" rx="4" className="book-gold-spine" />
            <rect x="58" y="56" width="50" height="98" rx="3" className="book-gold-frame" />
            <path d="M83 82l4.1 8.3 9.2 1.3-6.6 6.5 1.5 9.1-8.2-4.3-8.2 4.3 1.5-9.1-6.6-6.5 9.2-1.3z" className="book-gold-star" />
            <path d="M70 126H96M74 134H92" className="book-gold-title" />
            <path d="M100 166h7v20l-3.5-3.5-3.5 3.5z" className="book-ribbon" />
          </g>
        ) : (
          <g ref={bodyRef} className="book-body">
            <g ref={leftRef} className="book-half">
              <path d={coverPath(1)} className="book-cover" />
              <path d={boardPath(1)} className="book-board" />
              <g clipPath={`url(#${id}-clip1)`}>
                <g ref={readRef} className="book-stack" style={{ transform: lift(heights.read) }}>
                  <Stack side={1} id={id} />
                </g>
              </g>
            </g>
            <g className="book-half">
              <path d={coverPath(-1)} className="book-cover" />
              <path d={boardPath(-1)} className="book-board" />
              <g clipPath={`url(#${id}-clip-1)`}>
                <g ref={unreadRef} className="book-stack" style={{ transform: lift(heights.unread) }}>
                  <Stack side={-1} id={id} curl={state !== 'empty'} />
                </g>
              </g>
            </g>
            <g ref={turnRef} className="book-turn" aria-hidden="true">
              <path d={facePath(-1)} className="book-page" />
              {TEXT_LINES.map((_, i) => (
                <path key={i} d={textLine(-1, i)} className="book-ink" />
              ))}
              <path ref={turnShadeRef} d={facePath(-1)} className="book-turn-shade" />
            </g>
            <g ref={closedRef} className="book-closed" aria-hidden="true">
              <rect x="83" y="53" width="72" height="134" rx="2.5" className="book-page" />
              <path d="M85 184.5H152.5V56" className="book-edge-line" />
              <rect x="80" y="50" width="72" height="134" rx="3" className="book-cover" />
              <path d="M88 52V182" className="book-closed-hinge" />
              <rect x="100" y="78" width="40" height="18" rx="3" className="book-closed-plate" />
              <path d="M107 87H133" className="book-closed-title" />
              <rect ref={tintRef} x="80" y="50" width="75" height="137" rx="3" className={`book-closed-tint book-tone-${flyTone}`} />
            </g>
          </g>
        )}

        <text ref={labelRef} x="80" y="204" textAnchor="middle" className="book-label">
          {pageLabel(shown, capacity)}
        </text>

        {shownMarks.map((mark) => {
          const { x, y } = markPoint(mark.height);
          return (
            // Pointer only: the captions are the accessible way in.
            <g key={mark.id} className={reached(mark) ? 'book-mark book-mark--reached' : 'book-mark'} aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              <rect x={x - 14} y={y - 11} width="24" height="22" className="book-mark-hit" />
              <path d={`M${x - 6} ${y - 3.5}H${x + 7}L${x + 3.5} ${y}L${x + 7} ${y + 3.5}H${x - 6}Z`} className="book-mark-ribbon" />
            </g>
          );
        })}
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className={reached(mark) ? 'book-mark-caption book-mark-caption--reached' : 'book-mark-caption'}
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

// ---- Mini (viewBox 0 0 40 40) ----

const mX = (s: Side, x: number) => (s === 1 ? x : 40 - x);
const miniFace = (s: Side) => `M${mX(s, 20)} 16C${mX(s, 15)} 12.5 ${mX(s, 9)} 12 ${mX(s, 4)} 13.5V30C${mX(s, 9)} 29 ${mX(s, 15)} 29 ${mX(s, 20)} 32Z`;
const miniCurve = (s: Side, dy: number) => `M${mX(s, 4)} ${30 + dy}C${mX(s, 9)} ${29 + dy} ${mX(s, 15)} ${29 + dy} ${mX(s, 20)} ${32 + dy}`;
const miniBand = (s: Side) => `${miniCurve(s, 0)}V42C${mX(s, 15)} 39 ${mX(s, 9)} 39 ${mX(s, 4)} 40Z`;
const miniClip = (s: Side) => `M${mX(s, 0)} 0H${mX(s, 20)}V32C${mX(s, 15)} 29 ${mX(s, 9)} 29 ${mX(s, 4)} 30H${mX(s, 0)}Z`;
const miniCover = (s: Side) => `M${mX(s, 20)} 14.5C${mX(s, 15)} 11 ${mX(s, 9)} 10.5 ${mX(s, 2)} 12V33C${mX(s, 9)} 32 ${mX(s, 15)} 32 ${mX(s, 20)} 35.5Z`;

function Mini({ fill, state = 'active', size = 32, label }: ProgressMiniProps) {
  const id = `bookmini${useId().replace(/[^\w-]/g, '')}`;
  const complete = state === 'complete';
  const f = complete ? 1 : state === 'empty' ? 0 : clamp(fill);
  const read = 1 + f * 8;
  const unread = 1 + (1 - f) * 8;
  return (
    <svg
      className={`book book--mini book--${state}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={label ?? text.fillLabel(Math.floor(f * 100))}
    >
      {complete ? (
        <g>
          <rect x="12" y="5" width="19" height="29" rx="1.5" className="book-page" />
          <rect x="9" y="4" width="20" height="29" rx="2" className="book-gold-cover book-mini-gold" />
          <rect x="9" y="4" width="4" height="29" rx="1.5" className="book-gold-spine" />
          <path d="M20.5 12l1.9 3.8 4.1.6-3 2.9.7 4.1-3.7-1.9-3.7 1.9.7-4.1-3-2.9 4.1-.6z" className="book-gold-star" />
          <path d="M23 33h3v5l-1.5-1.5-1.5 1.5z" className="book-ribbon" />
        </g>
      ) : (
        <>
          <defs>
            {SIDES.map((s) => (
              <clipPath key={s} id={`${id}-clip${s}`}>
                <path d={miniClip(s)} />
              </clipPath>
            ))}
          </defs>
          {SIDES.map((s) => (
            <g key={s}>
              <path d={miniCover(s)} className="book-cover book-mini-cover" />
              <g clipPath={`url(#${id}-clip${s})`}>
                <g className="book-stack" style={{ transform: lift(s === 1 ? read : unread) }}>
                  <path d={miniBand(s)} className="book-band" />
                  <path d={miniCurve(s, 3)} className="book-edge-line book-mini-line" />
                  <path d={miniCurve(s, 6)} className="book-edge-line book-mini-line" />
                  <path d={miniFace(s)} className="book-page book-mini-page" />
                  {[19, 23, 27].map((y) => (
                    <path key={y} d={s === 1 ? `M7 ${y}H16` : `M24 ${y}H33`} className="book-ink book-mini-ink" />
                  ))}
                </g>
              </g>
            </g>
          ))}
        </>
      )}
    </svg>
  );
}

export const bookTheme: ProgressThemeDefinition = {
  key: 'book',
  text,
  available: true,
  Hero,
  Mini,
  markPoint,
};
