import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { copy } from '../copy';
import { useMotion, type MotionMode } from '../hooks/useMotion';
import { DONE_EVENT, FINISH_FALLBACK_MS, IDLE, nextPhase, phaseTiming, refillTarget, type PhaseTiming } from './flaskAnimation';

// The flask: the product's signature object. One glass, one liquid group moved by a single
// translateY, one idle wave and a static glow; bubbles only while the liquid rises. The
// level-up choreography (rise → overflow → drain → refill) is driven by the pure state machine
// in flaskAnimation.ts through WAAPI; only transform and opacity animate. Under reduced motion
// every change is a short crossfade, and html.paused stops the idle wave while the page is hidden.

// Geometry (viewBox 0 0 160 260): the liquid surface travels from y 226 (empty) to 34 (full).
const GLASS = 'M40 30 V186 A40 40 0 0 0 120 186 V30 Z';
const INNER = 'M45 30 V186 A35 35 0 0 0 115 186 V30 Z';
const SURFACE = 34;
const TRAVEL = 192;
const BOTTOM = SURFACE + TRAVEL;
// Two periods of 160 units, amplitude 6: translating by −160 loops seamlessly.
const WAVE = `M0 ${SURFACE} Q40 ${SURFACE - 12} 80 ${SURFACE} T160 ${SURFACE} T240 ${SURFACE} T320 ${SURFACE} V${SURFACE + 16} H0 Z`;
const TICKS = [0.25, 0.5, 0.75];
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

export type FlaskState = 'empty' | 'active' | 'complete';

export interface LevelUpOptions {
  fromFill: number;
  toFill: number;
  levels: number;
  /** Called at the overflow beat — the caller fires haptics.levelUp there. */
  onOverflow?(): void;
}

export interface FlaskHandle {
  playLevelUp(options: LevelUpOptions): Promise<void>;
  /** The glass, as the target for flying points. */
  element(): Element | null;
}

export interface FlaskProps {
  /** Fill ratio 0..1. */
  fill: number;
  /** Capacity of the current flask; labels the ticks with absolute values. */
  capacity?: number;
  size?: 'hero' | 'mini';
  state?: FlaskState;
  motion?: MotionMode;
  /** Accessible name; «Колба заполнена на N%» by default. */
  label?: string;
  ref?: Ref<FlaskHandle>;
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

let pauseInstalled = false;
/** html.paused while the page is hidden: idle animations (.anim-decor) stop burning frames. */
function installPauseWhenHidden(): void {
  if (pauseInstalled || typeof document === 'undefined') return;
  pauseInstalled = true;
  const sync = () => document.documentElement.classList.toggle('paused', document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', sync);
  sync();
}

export function Flask({ fill, capacity, size = 'hero', state = 'active', motion: motionProp, label, ref }: FlaskProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  // useId() may contain characters that break url(#id) references.
  const id = `flask${useId().replace(/[^\w-]/g, '')}`;
  const hero = size === 'hero';
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
    if (!hero) return;
    if (motion === 'reduced') {
      if (liquidRef.current) animate(liquidRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    if (target > from) {
      setFilling(true);
      window.clearTimeout(fillingTimer.current);
      fillingTimer.current = window.setTimeout(() => setFilling(false), 900);
    }
  }, [target, hero, motion]);
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
    if (state !== 'empty' || !hero || motion === 'reduced' || !dropletRef.current || !rippleRef.current) return;
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
    // Once per mount of the empty state, not on every motion or size change.
  }, [state === 'empty']);

  useImperativeHandle(
    ref,
    (): FlaskHandle => ({
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
        flushSync(() => {
          setScripted(true);
          setOverride(clamp(fromFill));
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
          let current = clamp(fromFill);
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

  const classes = [
    'flask',
    `flask--${size}`,
    `flask--${state}`,
    filling && hero ? 'liquid--filling' : '',
    scripted ? 'flask--scripted' : '',
  ].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
      {hero && <div className="flask-glow" ref={glowRef} style={{ opacity: 0.25 + shown * 0.55 }} aria-hidden="true" />}
      <svg
        ref={svgRef}
        className="flask-svg"
        viewBox="0 0 160 260"
        role="img"
        aria-label={label ?? copy.common.flaskFilled(Math.floor(shown * 100))}
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
              <path d={WAVE} className={`flask-wave${hero ? ' anim-decor' : ''}`} />
            </g>
            {hero && <ellipse cx="80" cy={SURFACE + 5} rx="22" ry="2.5" className="flask-caustic" />}
          </g>
          {hero && filling && state !== 'complete' && (
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
        {hero &&
          TICKS.map((mark) => {
            const y = BOTTOM - mark * TRAVEL;
            return (
              <g key={mark} className="flask-tick">
                <line x1="122" x2="129" y1={y} y2={y} />
                {capacity !== undefined && (
                  <text x="132" y={y} dominantBaseline="central">
                    {Math.round(capacity * mark)}
                  </text>
                )}
              </g>
            );
          })}
        {state === 'complete' && <rect ref={corkRef} x="58" y="2" width="44" height="18" rx="6" className="flask-cork" />}
        <rect x="26" y="16" width="108" height="16" rx="8" className="flask-rim" />
        {hero && (
          <g ref={dropsRef} className="flask-drops" aria-hidden="true">
            {DROPS.map(([x]) => (
              <circle key={x} cx={x} cy="20" r="3" />
            ))}
          </g>
        )}
        {hero && state === 'empty' && (
          <>
            <circle ref={dropletRef} cx="80" cy="24" r="4" className="flask-droplet" />
            <ellipse ref={rippleRef} cx="80" cy={BOTTOM - 14} rx="4" ry="1.2" className="flask-ripple" />
          </>
        )}
      </svg>
    </div>
  );
}
