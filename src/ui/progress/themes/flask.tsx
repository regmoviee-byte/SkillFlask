import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatNumber } from '../../../lib/format';
import { PLAIN_TICKS, scaleTicks } from '../../components/flaskScale';
import { DONE_EVENT, FINISH_FALLBACK_MS, IDLE, nextPhase, phaseTiming, refillTarget, type PhaseTiming } from '../../components/flaskAnimation';
import { copy } from '../../copy';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMark, ProgressMiniProps, ProgressThemeDefinition } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import { THEME_TEXT } from '../texts';

// «Колба», the default progress theme and the reference implementation of the contract: the
// product's signature object. One glass, one liquid group moved by a single translateY, one
// idle wave and a static glow; bubbles only while the liquid rises. The level-up choreography
// (rise → overflow → drain → refill) is driven by the pure state machine in flaskAnimation.ts
// through WAAPI; only transform and opacity animate. Under reduced motion every change is a
// short crossfade, and html.paused stops the idle wave while the page is hidden. Styles live in
// src/ui/flask.css (with the ring). Bundled with the app: every other theme is a lazy chunk.

// Geometry (viewBox 0 0 160 260): the liquid surface travels from y 226 (empty) to 34 (full).
const GLASS = 'M40 30 V186 A40 40 0 0 0 120 186 V30 Z';
const INNER = 'M45 30 V186 A35 35 0 0 0 115 186 V30 Z';
const SURFACE = 34;
const TRAVEL = 192;
const BOTTOM = SURFACE + TRAVEL;
// Two periods of 160 units, amplitude 6: translating by −160 loops seamlessly.
const WAVE = `M0 ${SURFACE} Q40 ${SURFACE - 12} 80 ${SURFACE} T160 ${SURFACE} T240 ${SURFACE} T320 ${SURFACE} V${SURFACE + 16} H0 Z`;
const BUBBLES = [
  { cx: 58, r: 2, delay: 0 },
  { cx: 72, r: 3, delay: 180 },
  { cx: 86, r: 2.5, delay: 90 },
  { cx: 97, r: 4, delay: 300 },
  { cx: 66, r: 3.5, delay: 420 },
  { cx: 104, r: 2, delay: 240 },
];
// Overflow droplets at the rim: [x, dx, dy].
const DROPS: [number, number, number][] = [
  [30, -26, 70],
  [38, -19, 55],
  [46, -12, 40],
  [114, 12, 40],
  [122, 19, 55],
  [130, 26, 70],
];

// Marks («засечки») on the hero: a tick on the right inner wall, a pennant outside it and a
// caption to the right. The capacity scale moves to the left wall while marks are drawn.
const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
/** Lowest tick: above this y the rounded bottom leaves the wall too close to the centre. */
const MARK_LOWEST = 212;
/** Highest tick: the pennant (12 units tall) stays clear of the rim (y 16–32). */
const MARK_HIGHEST = 46;
/** Minimum distance between two captions (viewBox units, ≈ 16 px). */
const CAPTION_GAP = 18;
/** Left edge of the captions (viewBox units): past the outer wall and the pennant. */
const CAPTION_X = 132;
const VIEW_W = 160;
const VIEW_H = 260;

const markY = (height: number) => Math.min(Math.max(BOTTOM - clamp(height) * TRAVEL, MARK_HIGHEST), MARK_LOWEST);
/** x of a wall at `y`: straight down to y 186, then the half circle of the bottom around (80, 186). */
const wallX = (y: number, r: number) => (y <= 186 ? 80 + r : 80 + Math.sqrt(Math.max(0, r * r - (y - 186) ** 2)));

/** «Пробный тест» fits; longer titles end with «…» (the list under the flask has them in full). */
function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Caption y positions, top to bottom, at least CAPTION_GAP apart and inside the flask. */
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

/** Hero px per viewBox unit (the hero is 140 px wide, flask.css). */
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
/** Up to 44 px tall (the touch-target guideline) when no other caption is near. */
const CAPTION_PAD_MAX = 14;

/**
 * Vertical padding of caption `i` in px: its tap area grows towards 44 px but never reaches
 * over the text of the nearest caption.
 */
function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) - CAPTION_LINE : CAPTION_PAD_MAX;
  return Math.round(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const offset = (fill: number) => `translateY(${((1 - clamp(fill)) * TRAVEL).toFixed(2)}px)`;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Awaits an animation, or its duration plus a margin when `finished` never settles (old WebViews). */
function done(animation: Animation, duration: number): Promise<void> {
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration + FINISH_FALLBACK_MS)]);
}

let cachedEasing: Record<PhaseTiming['easing'], string> | null = null;
/** The motion tokens as WAAPI easing strings (WAAPI cannot read var()). */
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

function animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    // An easing the engine does not parse: plain ease-out keeps the choreography going.
    return el.animate(keyframes, { ...options, easing: 'ease-out' });
  }
}

/** The hero flask (contract: ProgressHeroProps). `marks` are the current flask's, oldest first. */
function FlaskHero({ fill, capacity, state = 'active', motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  // useId() may contain characters that break url(#id) references.
  const id = `flask${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);

  // While a choreography runs (and right after it) the liquid shows `override`, not the prop.
  const [override, setOverride] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  const [filling, setFilling] = useState(false);
  const playing = useRef(false);
  // Each playLevelUp takes a token; a newer call aborts the older one, which then leaves the
  // flask to it instead of committing its own end state.
  const playToken = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const shown = override ?? target;

  const svgRef = useRef<SVGSVGElement>(null);
  const liquidRef = useRef<SVGGElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const dropsRef = useRef<SVGGElement>(null);
  const corkRef = useRef<SVGRectElement>(null);
  const dropletRef = useRef<SVGCircleElement>(null);
  const rippleRef = useRef<SVGEllipseElement>(null);

  useEffect(installPauseWhenHidden, []);

  // Prop-driven changes: bubbles while the liquid rises, a crossfade under reduced motion.
  const previous = useRef(target);
  const fillingTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (playing.current || from === target) return;
    setOverride(null);
    if (motion === 'reduced') {
      if (liquidRef.current) animate(liquidRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    if (target > from) {
      setFilling(true);
      window.clearTimeout(fillingTimer.current);
      fillingTimer.current = window.setTimeout(() => setFilling(false), 900);
    }
  }, [target, motion]);
  useEffect(() => () => window.clearTimeout(fillingTimer.current), []);

  // Sealing: the cork drops in when the skill becomes completed on screen (never on first load).
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete' || !corkRef.current) return;
    const keyframes = motion === 'reduced' ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateY(-36px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }];
    animate(corkRef.current, keyframes, { duration: motion === 'reduced' ? 240 : 500, easing: motion === 'reduced' ? 'ease-out' : easings().spring });
  }, [state, motion]);

  // The empty flask: one droplet falls from the rim once, with a faint ripple.
  useEffect(() => {
    if (state !== 'empty' || motion === 'reduced' || !dropletRef.current || !rippleRef.current) return;
    const drop = animate(
      dropletRef.current,
      [
        { transform: 'translateY(0)', opacity: 0 },
        { transform: 'translateY(12px)', opacity: 1, offset: 0.1 },
        // From the rim (y 24) to the dashed ring at the bottom (y BOTTOM − 14), where it ripples.
        { transform: `translateY(${BOTTOM - 14 - 24 - 4}px)`, opacity: 1, offset: 0.92 },
        { transform: `translateY(${BOTTOM - 14 - 24}px)`, opacity: 0 },
      ],
      { duration: 600, delay: 250, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
    );
    const ripple = animate(rippleRef.current, [{ transform: 'scale(1)', opacity: 0.7 }, { transform: 'scale(5)', opacity: 0 }], {
      duration: 520,
      delay: 820,
      easing: 'ease-out',
    });
    return () => {
      drop?.cancel();
      ripple?.cancel();
    };
    // Once per mount of the empty state, not on every motion change.
  }, [state === 'empty']);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => svgRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const liquid = liquidRef.current;
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        if (!liquid || typeof liquid.animate !== 'function') {
          onOverflow?.();
          return;
        }
        playing.current = true;
        const running: Animation[] = [];
        const track = (a: Animation | null): Animation | null => {
          if (a) running.push(a);
          return a;
        };
        // The app has already rendered the new level at `toFill` (the contract's rule); the
        // rise starts from `fromFill`, the fill of the level being completed (the caller lowers
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
            const fade = track(animate(liquid, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }));
            if (fade) await done(fade, 240);
            return;
          }
          const ease = easings();
          let current = start;
          const move = async (to: number, timing: PhaseTiming) => {
            const a = track(animate(liquid, [{ transform: offset(current) }, { transform: offset(to) }], { duration: timing.duration, easing: ease[timing.easing], fill: 'forwards' }));
            current = to;
            if (a) await done(a, timing.duration);
          };
          const burst = async (timing: PhaseTiming) => {
            const drops = Array.from(dropsRef.current?.children ?? []);
            const waits = drops.map((drop, i) => {
              const [, dx, dy] = DROPS[i]!;
              const a = track(
                animate(
                  drop,
                  [
                    { transform: 'translate(0, 0)', opacity: 1 },
                    { transform: `translate(${dx * 0.6}px, -8px)`, opacity: 1, offset: 0.3 },
                    { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
                  ],
                  { duration: timing.duration, delay: i * 40, easing: 'ease-out' },
                ),
              );
              return a ? done(a, timing.duration + i * 40) : Promise.resolve();
            });
            const glow = glowRef.current;
            if (glow) {
              const rest = { opacity: Number(glow.style.opacity) || 0.8, transform: 'scale(1)' };
              const a = track(animate(glow, [rest, { opacity: 1, transform: 'scale(1.15)', offset: 0.45 }, rest], { duration: timing.duration, easing: 'ease-in-out' }));
              if (a) waits.push(done(a, timing.duration));
            }
            await Promise.all(waits);
          };

          let phase = nextPhase(IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = phaseTiming(phase);
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                setFilling(true);
                await move(1, timing);
                break;
              case 'overflow':
                onOverflow?.();
                await burst(timing);
                break;
              case 'draining':
                setFilling(false);
                await move(0, timing);
                break;
              case 'refilling':
                setFilling(true);
                await move(refillTarget(phase, clamp(toFill)), timing);
                break;
            }
            phase = nextPhase(phase, { type: DONE_EVENT[phase.phase] } as Parameters<typeof nextPhase>[1]);
          }
        } finally {
          if (aborted()) {
            // A newer choreography owns the flask now; its layers sit above these.
            running.forEach((a) => a.cancel());
          } else {
            // Commit the end state with transitions off, then drop the WAAPI layers: no jump.
            flushSync(() => {
              setOverride(clamp(toFill));
              setFilling(false);
            });
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

  // Static: marks never animate, and the caller decides which flask they belong to (they leave
  // with their flask at the overflow beat). The room for captions and the scale on the left
  // wall stay until the choreography ends, so nothing beside the flask jumps mid-animation.
  const shownMarks: ProgressMark[] = marks ?? [];
  const reserved = useRef(false);
  reserved.current = scripted ? reserved.current || shownMarks.length > 0 : shownMarks.length > 0;
  const marked = reserved.current;
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const captionY = captionYs(captioned.map((m) => markY(m.height)));

  const classes = [
    'flask',
    'flask--hero',
    `flask--${state}`,
    marked ? 'flask--marked' : '',
    filling ? 'liquid--filling' : '',
    scripted ? 'flask--scripted' : '',
  ].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
      <div className="flask-glow" ref={glowRef} style={{ opacity: 0.25 + shown * 0.55 }} aria-hidden="true" />
      <svg
        ref={svgRef}
        className="flask-svg"
        viewBox="0 0 160 260"
        role="img"
        aria-label={label ?? THEME_TEXT.flask.fillLabel(Math.floor(shown * 100))}
        style={{ ['--liquid-height' as string]: `${Math.round(shown * TRAVEL)}px` }}
      >
        <defs>
          <clipPath id={`${id}-clip`}>
            <path d={INNER} />
          </clipPath>
          <linearGradient id={`${id}-liquid`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="flask-stop-top" />
            <stop offset="1" className="flask-stop-bottom" />
          </linearGradient>
        </defs>
        <path d={GLASS} className="flask-glass" />
        {state === 'empty' && <ellipse cx="80" cy={BOTTOM - 14} rx="24" ry="5" className="flask-empty-ring" />}
        <g clipPath={`url(#${id}-clip)`}>
          {/* An empty flask shows no liquid, unless a choreography fills it right now. */}
          <g className="liquid" ref={liquidRef} style={{ transform: offset(shown) }} opacity={state === 'empty' && override === null ? 0 : 1}>
            <rect x="0" y={SURFACE} width="160" height={TRAVEL + 8} fill={`url(#${id}-liquid)`} />
            <g className="flask-wave-wrap">
              <path d={WAVE} className="flask-wave anim-decor" />
            </g>
            <ellipse cx="80" cy={SURFACE + 5} rx="22" ry="2.5" className="flask-caustic" />
          </g>
          {filling && state !== 'complete' && (
            <g className="flask-bubbles" aria-hidden="true">
              {BUBBLES.map((b) => (
                <circle key={b.cx} cx={b.cx} cy={BOTTOM - 10} r={b.r} style={{ animationDelay: `${b.delay}ms` }} />
              ))}
            </g>
          )}
          <rect x="50" y="40" width="6" height="150" rx="3" className="flask-highlight" />
          <rect x="104" y="30" width="12" height="200" className="flask-shade" />
        </g>
        <path d={GLASS} className="flask-outline" />
        {(capacity !== undefined ? scaleTicks(capacity) : PLAIN_TICKS.map((share) => ({ share, value: null }))).map(({ share, value }) => {
            const y = BOTTOM - share * TRAVEL;
            return (
              <g key={share} className="flask-tick">
                {marked ? <line x1="31" x2="38" y1={y} y2={y} /> : <line x1="122" x2="129" y1={y} y2={y} />}
                {value !== null && (
                  <text x={marked ? 28 : 132} y={y} dominantBaseline="central" textAnchor={marked ? 'end' : 'start'}>
                    {formatNumber(value)}
                  </text>
                )}
              </g>
            );
          })}
        {shownMarks.map((mark) => {
          const y = markY(mark.height);
          const inner = wallX(y, 35);
          const pole = wallX(y, 40) + 3;
          return (
            // Pointer only: the captions below are the accessible way in, and so is the list.
            <g key={mark.id} className="flask-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              <rect x={inner - 14} y={y - 13} width={pole - inner + 26} height={20} className="flask-mark-hit" />
              <line x1={inner - 10} x2={inner} y1={y} y2={y} className="flask-mark-tick" />
              <line x1={pole} x2={pole} y1={y + 1} y2={y - 12} className="flask-mark-pole" />
              <path d={`M${pole} ${y - 12}L${pole + 9} ${y - 8.5}L${pole} ${y - 5}Z`} className="flask-mark-flag" />
            </g>
          );
        })}
        {state === 'complete' && <rect ref={corkRef} x="58" y="2" width="44" height="18" rx="6" className="flask-cork" />}
        <rect x="26" y="16" width="108" height="16" rx="8" className="flask-rim" />
        <g ref={dropsRef} className="flask-drops" aria-hidden="true">
          {DROPS.map(([x]) => (
            <circle key={x} cx={x} cy="20" r="3" />
          ))}
        </g>
        {state === 'empty' && (
          <>
            <circle ref={dropletRef} cx="80" cy="24" r="4" className="flask-droplet" />
            <ellipse ref={rippleRef} cx="80" cy={BOTTOM - 14} rx="4" ry="1.2" className="flask-ripple" />
          </>
        )}
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="flask-mark-caption"
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

// ---- Mini: the milestone rack, skill cards, the home tile ----

// A small tube with a rounded bottom (18 × 30 units) centred in a square; the liquid is a rect
// clipped to its inside. Gold when the skill is completed (the rim stays; only the hero gets a cork).
const MINI_GLASS = 'M4 3 V21 A5 5 0 0 0 14 21 V3 Z';
const MINI_INNER = 'M5.5 3 V21 A3.5 3.5 0 0 0 12.5 21 V3 Z';
const MINI_TOP = 3;
const MINI_BOTTOM = 26;

function FlaskMini({ fill, state = 'active', size = 32, label }: ProgressMiniProps) {
  const clipId = `mini${useId().replace(/[^\w-]/g, '')}`;
  const f = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const y = MINI_BOTTOM - f * (MINI_BOTTOM - MINI_TOP);
  const classes = ['mini-flask', f >= 1 ? 'is-full' : '', state === 'complete' ? 'is-complete' : ''].filter(Boolean).join(' ');
  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="-6 0 30 30"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={MINI_INNER} />
        </clipPath>
      </defs>
      <path d={MINI_GLASS} className="mini-flask-glass" />
      {f > 0 && <rect x="0" y={y} width="18" height={MINI_BOTTOM - y + 1} className="mini-flask-liquid" clipPath={`url(#${clipId})`} />}
      <rect x="2" y="1.5" width="14" height="3" rx="1.5" className="mini-flask-rim" />
    </svg>
  );
}

/** A mark's pennant sits on the inner right wall at the height of its points. */
function markPoint(height: number): { x: number; y: number } {
  const y = markY(height);
  return { x: wallX(y, 35), y };
}

export const flaskTheme: ProgressThemeDefinition = {
  key: 'flask',
  text: THEME_TEXT.flask,
  available: true,
  Hero: FlaskHero,
  Mini: FlaskMini,
  markPoint,
};
