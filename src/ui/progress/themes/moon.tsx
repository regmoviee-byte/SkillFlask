import { memo, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { DONE_EVENT, FINISH_FALLBACK_MS, IDLE, nextPhase, refillTarget, type AnimationState, type PhaseTiming } from '../../components/flaskAnimation';
import { useMotion } from '../../hooks/useMotion';
import type { ProgressHeroHandle, ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeText } from '../contract';
import { installPauseWhenHidden } from '../pauseWhenHidden';
import './moon.css';

// «Луна»: a night sky panel with a large Moon that waxes from a new moon (fill 0, only a faint
// rim) through the first quarter (0.5) to the full Moon (1). The lit part is the skill colour
// (--liquid-*); the sky, the land and the stars are natural night colours (moon.css).
//
// Every level is one of twelve named full moons (moonName: «Волчья луна» … «Холодная луна»,
// January to December, cycling), and the land below the Moon is that month's: snowy hills with a
// howling wolf, deep snow, the thaw, blossoming trees … a frosty field with a lone fir. The sky
// remembers: each completed full moon leaves a star (level − 1 stars), seven stars make a
// constellation joined by faint lines, and past seven constellations the stars gather into a
// Milky Way that keeps thickening. Now and then a special moon rises (specialMoon): a blue moon
// every 13th level, a supermoon every 9th, a blood moon every 17th.
//
// At rest the lit part is one path (moonPhasePath: the right limb plus an elliptical terminator)
// in a mask over the lit surface. While it moves, a rig in the same mask — a right half-disc and
// two ellipses squeezed by scaleX — draws the same shape, so only transform and opacity animate.
// Level-up: wax to full → the full Moon glows and its star flies up to its place in the sky →
// it wanes to a new moon while the season changes → waxes to `toFill`. Idle: the newest star
// twinkles (.anim-decor). Marks are pennants on an orbit arc along the right rim.

// Geometry (viewBox 0 0 160 260).
const CX = 80;
const CY = 96;
const R = 50;
/** The marks' orbit: from below-right (height 0) round the right rim to above-right (height 1). */
const ORBIT = 60;
const ORBIT_FROM = (70 * Math.PI) / 180;
const VIEW_W = 160;
const VIEW_H = 260;

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const round = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The lit part of the Moon at `fill`, waxing from the right: the right limb from the top to the
 * bottom, then the terminator back up as a half ellipse with rx = r·|1 − 2·fill| — bulging right
 * (a crescent) below 0.5, a straight line at 0.5, bulging left (gibbous) above, the whole disc at 1.
 */
export function moonPhasePath(fill: number, cx = CX, cy = CY, r = R): string {
  const f = clamp(fill);
  const rx = round(r * Math.abs(1 - 2 * f));
  const top = `${cx} ${round(cy - r)}`;
  const bottom = `${cx} ${round(cy + r)}`;
  return `M${top}A${r} ${r} 0 0 1 ${bottom}A${rx} ${r} 0 0 ${f > 0.5 ? 1 : 0} ${top}Z`;
}

/** The moving rig: scaleX of the shadow ellipse (crescent) and of the lit ellipse (gibbous). */
export function phaseRig(fill: number): { shadow: number; light: number } {
  const f = clamp(fill);
  return { shadow: round(Math.max(0, 1 - 2 * f) * 1000) / 1000, light: round(Math.max(0, 2 * f - 1) * 1000) / 1000 };
}

/** The halo around the Moon at rest: faint at the new moon, soft at the full one. */
export function haloOpacity(fill: number): number {
  return round(0.1 + 0.55 * clamp(fill) ** 2);
}

// ---- The twelve moons and the special ones ----

const MONTHS = ['Волчья', 'Снежная', 'Червячная', 'Розовая', 'Цветочная', 'Клубничная', 'Оленья', 'Осетровая', 'Урожайная', 'Охотничья', 'Бобровая', 'Холодная'];

/** The level as a whole number ≥ 1; omitted or odd → 1. */
export function levelOf(level?: number): number {
  return level !== undefined && Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
}

/** The month of the level's full moon: 0 (January) … 11 (December), a new one every level. */
export function moonMonth(level?: number): number {
  return (levelOf(level) - 1) % 12;
}

/** The traditional name of the level's full moon: «Волчья луна» (January) … «Холодная луна». */
export function moonName(level?: number): string {
  return `${MONTHS[moonMonth(level)]} луна`;
}

export type SpecialMoon = 'blue' | 'super' | 'blood';

/** Rare moons: a blue moon every 13th level, else a supermoon every 9th, else a blood moon every 17th. */
export function specialMoon(level?: number): SpecialMoon | null {
  const l = levelOf(level);
  return l % 13 === 0 ? 'blue' : l % 9 === 0 ? 'super' : l % 17 === 0 ? 'blood' : null;
}

const SPECIAL_NAMES: Record<SpecialMoon, string> = { blue: 'Голубая луна', super: 'Суперлуние', blood: 'Кровавая луна' };

/** The caption under the Moon: a special moon's name, otherwise the month's. */
export function moonCaption(level?: number): string {
  const special = specialMoon(level);
  return special ? SPECIAL_NAMES[special] : moonName(level);
}

/**
 * How strongly a special moon's tint covers the skill colour: a blue moon always (the skill
 * colour still shows through), a blood moon only as it comes full; ordinary moons never.
 */
export function tintOpacity(special: SpecialMoon | null, fill: number): number {
  if (special === 'blue') return 0.72;
  if (special !== 'blood') return 0;
  const t = clamp((clamp(fill) - 0.8) / 0.2);
  return round(0.88 * t * t * (3 - 2 * t));
}

// ---- The sky that remembers ----

type Point = [number, number];
type SkyPoint = [number, number, number];

export const STARS_PER_CONSTELLATION = 7;

/**
 * Seven constellations of seven stars, in the order they light up (level 2 lights the first star
 * of the first one) and with the lines that join them once all seven shine. They keep clear of
 * the Moon (a supermoon included), of the marks' orbit on the right and of the caption below it.
 */
const CONSTELLATIONS: { stars: SkyPoint[]; lines: number[][] }[] = [
  // Большая Медведица, top left: the handle, then the bowl.
  { stars: [[11, 29, 2.5], [21, 21, 2.4], [31, 17, 2.6], [42, 16, 2], [45, 29, 2.3], [60, 26, 2.5], [57, 11, 2.8]], lines: [[0, 1, 2, 3, 4, 5, 6, 3]] },
  // Пегас и Андромеда, top right: the Great Square, then Andromeda's chain.
  { stars: [[113, 25, 2.4], [112, 10, 2.3], [128, 9, 2.7], [128, 24, 2.2], [137, 13, 2.1], [145, 19, 2.6], [151, 27, 2.3]], lines: [[0, 1, 2, 3, 0], [2, 4, 5, 6]] },
  // Орион, left: the shoulders, the belt, the feet.
  { stars: [[9, 44, 2.8], [27, 47, 2.3], [21, 63, 1.9], [17, 65, 2], [13, 67, 1.9], [9, 85, 2.2], [22, 83, 2.8]], lines: [[1, 0, 4, 3, 2, 1], [4, 5], [2, 6]] },
  // Северная Корона, lower right: an arc.
  { stars: [[129, 138, 2], [133, 144, 2.1], [139, 147, 2.2], [144, 147, 2.8], [150, 145, 2.1], [154, 141, 2], [155, 136, 2.1]], lines: [[0, 1, 2, 3, 4, 5, 6]] },
  // Лебедь, above the Moon: the long axis, then the wings.
  { stars: [[66, 16, 2.8], [78, 19, 2.3], [87, 21, 2], [95, 24, 2.3], [79, 7, 2], [77, 29, 2.1], [74, 36, 1.9]], lines: [[0, 1, 2, 3], [4, 1, 5, 6]] },
  // Малая Медведица, lower left: Polaris, the handle, the bowl.
  { stars: [[14, 99, 2.8], [17, 108, 1.9], [18, 117, 2], [16, 126, 2.1], [9, 136, 2.1], [19, 144, 2.2], [26, 133, 2.5]], lines: [[0, 1, 2, 3, 4, 5, 6, 3]] },
  // Плеяды, right: a small cluster.
  { stars: [[146, 54, 2.2], [151, 51, 1.8], [155, 56, 1.7], [150, 60, 1.9], [144, 61, 1.8], [140, 57, 1.9], [147, 66, 1.7]], lines: [[5, 0, 1, 2, 3, 0], [3, 4, 5], [4, 6]] },
];
/** Stars drawn one by one; the ones after them join the Milky Way. */
export const SKY_STARS = CONSTELLATIONS.length * STARS_PER_CONSTELLATION;

/** Faint stars that are always there, so the first night is not empty; the first one twinkles then. */
const FAINT: SkyPoint[] = [
  [38, 44, 3.4],
  [150, 88, 0.9],
  [4, 118, 0.8],
  [36, 150, 0.9],
  [112, 42, 0.8],
  [154, 128, 0.8],
  [50, 36, 0.7],
];

export interface SkyStar {
  x: number;
  y: number;
  r: number;
  /** The constellation (0..6). */
  group: number;
}

/** The first `count` remembered stars (at most SKY_STARS), constellation by constellation. */
export function skyStars(count: number): SkyStar[] {
  const n = Math.max(0, Math.min(SKY_STARS, Math.floor(count) || 0));
  const out: SkyStar[] = [];
  for (let i = 0; i < n; i++) {
    const group = Math.floor(i / STARS_PER_CONSTELLATION);
    const [x, y, r] = CONSTELLATIONS[group]!.stars[i % STARS_PER_CONSTELLATION]!;
    out.push({ x, y, r, group });
  }
  return out;
}

/** How bright constellation `group` shines when `count` stars are lit: the newest fully, older ones dimmer. */
export function groupOpacity(group: number, count: number): number {
  const newest = Math.floor((Math.max(1, count) - 1) / STARS_PER_CONSTELLATION);
  return round(Math.max(0.5, 1 - 0.1 * (Math.min(newest, CONSTELLATIONS.length - 1) - group)));
}

/** The lines of every finished constellation (a path per chain), with their opacity: older ones fade. */
export function constellationLines(count: number): { group: number; chains: string[]; opacity: number }[] {
  const done = Math.min(CONSTELLATIONS.length, Math.floor(Math.max(0, count) / STARS_PER_CONSTELLATION));
  const out = [];
  for (let group = 0; group < done; group++) {
    const { stars, lines } = CONSTELLATIONS[group]!;
    const chains = lines.map((chain) => chain.map((k, i) => `${i ? 'L' : 'M'}${stars[k]![0]} ${stars[k]![1]}`).join(''));
    out.push({ group, chains, opacity: round(Math.max(0.14, 0.42 - 0.06 * (done - 1 - group))) });
  }
  return out;
}

/** A deterministic 0..1 value for index `i` and stream `k`. */
function hash(i: number, k: number): number {
  let t = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// The Milky Way: a band through the Moon from the lower left to the upper right.
const MILKY_X = 80;
const MILKY_Y = 92;
const MILKY_ANGLE = -52;
const MILKY_MAX_DOTS = 260;
const MILKY_FULL = 150;
const SKY_BOTTOM = 172;

/** Whether a point of the sky shows: inside the panel, off the Moon, above the land and the caption. */
export function inSky(x: number, y: number): boolean {
  const offMoon = Math.hypot(x - CX, y - CY) >= R * 1.1 + 3;
  const offCaption = !(y > 156 && x > 34 && x < 126);
  return offMoon && offCaption && x >= 5 && x <= 155 && y >= 5 && y <= SKY_BOTTOM;
}

/**
 * Dot `i` of the Milky Way in the sky (the stars past SKY_STARS, one dot each): spread along the
 * band and gathered to its middle, always where it shows. Positions never change with the count.
 */
export function milkyDot(i: number): Point {
  const a = (MILKY_ANGLE * Math.PI) / 180;
  for (let k = 0; ; k++) {
    const along = (hash(i, k) - 0.5) * 300;
    const across = (hash(i, k + 101) + hash(i, k + 202) + hash(i, k + 303) - 1.5) * 22;
    const x = r1(MILKY_X + along * Math.cos(a) - across * Math.sin(a));
    const y = r1(MILKY_Y + along * Math.sin(a) + across * Math.cos(a));
    if (inSky(x, y)) return [x, y];
  }
}

/** The Milky Way for `count` stars: null while the constellations hold them; then it widens and brightens. */
export function milkyWay(count: number): { width: number; opacity: number; dots: Point[] } | null {
  const extra = Math.floor(count) - SKY_STARS;
  if (!(extra > 0)) return null;
  const s = Math.min(1, extra / MILKY_FULL);
  const dots: Point[] = [];
  for (let i = 0; i < Math.min(extra, MILKY_MAX_DOTS); i++) dots.push(milkyDot(i));
  return { width: round(18 + 34 * s), opacity: round(0.4 + 0.6 * s), dots };
}

/** Where star `index` (0-based) of the sky shines: a constellation star, then a Milky Way dot. */
export function starPoint(index: number): Point {
  if (index < SKY_STARS) {
    const [x, y] = CONSTELLATIONS[Math.floor(index / STARS_PER_CONSTELLATION)]!.stars[index % STARS_PER_CONSTELLATION]!;
    return [x, y];
  }
  return milkyDot(Math.min(index - SKY_STARS, MILKY_MAX_DOTS - 1));
}

/** The flight of a new star out of the Moon to its place: a gentle arc, growing, then settling. */
export function cometFrames(tx: number, ty: number): Keyframe[] {
  const a = Math.atan2(ty - CY, tx - CX);
  const sx = CX + R * 0.45 * Math.cos(a);
  const sy = CY + R * 0.45 * Math.sin(a);
  // Bend the arc away from the Moon's centre line, upwards on either side.
  const bend = tx < CX ? -0.28 : 0.28;
  const mx = (sx + tx) / 2 - (ty - sy) * bend;
  const my = (sy + ty) / 2 + (tx - sx) * bend;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = (1 - t) ** 2 * sx + 2 * (1 - t) * t * mx + t * t * tx;
    const y = (1 - t) ** 2 * sy + 2 * (1 - t) * t * my + t * t * ty;
    const scale = 0.5 + 1.1 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.5 * t;
    frames.push({ transform: `translate(${r1(x)}px, ${r1(y)}px) scale(${round(Math.max(0.5, scale))})`, opacity: i === 0 ? 0 : 1, offset: round(t) });
  }
  return frames;
}

// ---- The land: one scene per month ----

/** A layer of the land: colour, path, and a stroke width for strokes (fills have none). */
type Layer = [color: string, d: string, stroke?: number, transform?: string];

/** A smooth curve through the points (Catmull-Rom as cubic Béziers); a loop closes on itself. */
function spline(points: Point[], loop = false): string {
  const n = points.length;
  const at = (i: number) => points[loop ? (i + n) % n : Math.min(n - 1, Math.max(0, i))]!;
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 0; i < (loop ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
  }
  return loop ? `${d}Z` : d;
}

/** A ridge of land through the points, closed down below the box. */
const ridge = (points: Point[]) => `${spline(points)}V264H${points[0]![0]}Z`;

/** An irregular patch (melting snow, a puddle) around (x, y). */
function patch(x: number, y: number, rx: number, ry: number, seed: number): string {
  const points: Point[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 2 * Math.PI;
    const k = 0.7 + 0.5 * hash(i, seed);
    points.push([r1(x + rx * k * Math.cos(a)), r1(y + ry * k * Math.sin(a))]);
  }
  return spline(points, true);
}

/** A pointed leaf from (x, y), `len` long, at `angle` degrees. */
function leaf(x: number, y: number, len: number, angle: number, width = 0.4): string {
  const a = (angle * Math.PI) / 180;
  const [dx, dy] = [Math.cos(a) * len, Math.sin(a) * len];
  const [mx, my] = [x + dx / 2, y + dy / 2];
  const [px, py] = [-dy * width, dx * width];
  return `M${x} ${y}Q${r1(mx + px)} ${r1(my + py)} ${r1(x + dx)} ${r1(y + dy)}Q${r1(mx - px)} ${r1(my - py)} ${x} ${y}Z`;
}

/** An ellipse as a path (joins other dots in one element). */
const oval = (x: number, y: number, rx: number, ry = rx) => `M${r1(x - rx)} ${r1(y)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(2 * rx)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-2 * rx)} 0`;
const dots = (list: SkyPoint[]) => list.map(([x, y, r]) => oval(x, y, r)).join('');

/** A fir of three tiers standing at (x, y), `h` tall. */
function fir(x: number, y: number, h: number): string {
  const w = h * 0.3;
  const p = (dx: number, dy: number) => `${r1(x + dx * w)} ${r1(y - dy * h)}`;
  return `M${p(0, 1)}L${p(0.5, 0.62)}H${r1(x + 0.26 * w)}L${p(0.8, 0.32)}H${r1(x + 0.5 * w)}L${p(1, 0.06)}H${r1(x + 0.12 * w)}V${y}H${r1(x - 0.12 * w)}V${r1(y - 0.06 * h)}H${r1(x - w)}L${p(-0.5, 0.32)}H${r1(x - 0.8 * w)}L${p(-0.26, 0.62)}H${r1(x - 0.5 * w)}Z`;
}

/** Snow on a fir: a cap on the top and a drape along the edge of each tier. */
function firSnow(x: number, y: number, h: number): string {
  const w = h * 0.3;
  const p = (dx: number, dy: number) => `${r1(x + dx * w)} ${r1(y - dy * h)}`;
  const drape = (bw: number, by: number, d: number) => `M${p(-bw, by)}Q${p(0, by + d * 0.6)} ${p(bw, by)}Q${p(0, by + d * 0.2)} ${p(-bw, by)}Z`;
  return `M${p(0, 1)}L${p(0.24, 0.86)}Q${p(0, 0.8)} ${p(-0.24, 0.86)}Z${drape(0.5, 0.62, 0.3)}${drape(0.8, 0.32, 0.28)}${drape(1, 0.06, 0.26)}`;
}

/** A round crown of leaves or blossom: three overlapping dots around (x, y). */
const crown = (x: number, y: number, r: number) => oval(x, y - r * 0.35, r) + oval(x - r * 0.72, y + r * 0.22, r * 0.74) + oval(x + r * 0.72, y + r * 0.22, r * 0.74);

/** A trunk from the ground at (x, y) up by `h`, with two branches into the crown. */
const trunk = (x: number, y: number, h: number) => `M${x} ${y}V${y - h}M${x} ${r1(y - h * 0.55)}l${r1(-h * 0.28)} ${r1(-h * 0.3)}M${x} ${r1(y - h * 0.7)}l${r1(h * 0.26)} ${r1(-h * 0.28)}`;

/** A bare tree: a trunk and forked branches. */
const bare = (x: number, y: number, h: number) =>
  `M${x} ${y}V${y - h}M${x} ${r1(y - h * 0.45)}l${r1(-h * 0.35)} ${r1(-h * 0.35)}l${r1(-h * 0.08)} ${r1(-h * 0.2)}M${r1(x - h * 0.2)} ${r1(y - h * 0.65)}l${r1(h * 0.05)} ${r1(-h * 0.22)}M${x} ${r1(y - h * 0.6)}l${r1(h * 0.32)} ${r1(-h * 0.3)}l${r1(h * 0.1)} ${r1(-h * 0.15)}M${r1(x + h * 0.18)} ${r1(y - h * 0.77)}l${r1(-h * 0.02)} ${r1(-h * 0.2)}M${x} ${r1(y - h * 0.85)}l${r1(-h * 0.14)} ${r1(-h * 0.2)}`;

/** A tuft of grass at (x, y). */
const tuft = (x: number, y: number, s = 1) => `M${r1(x - 2.4 * s)} ${r1(y - 3.6 * s)}Q${r1(x - 0.6 * s)} ${r1(y - 1.6 * s)} ${x} ${y}Q${r1(x + 0.2 * s)} ${r1(y - 3 * s)} ${r1(x + 0.6 * s)} ${r1(y - 5 * s)}M${x} ${y}Q${r1(x + 0.8 * s)} ${r1(y - 1.6 * s)} ${r1(x + 2.6 * s)} ${r1(y - 3 * s)}`;

/** A four-pointed sparkle (stars, frost). */
const sparkle = (x: number, y: number, r: number) => {
  const k = r * 0.18;
  return `M${x} ${r1(y - r)}Q${r1(x + k)} ${r1(y - k)} ${r1(x + r)} ${y}Q${r1(x + k)} ${r1(y + k)} ${x} ${r1(y + r)}Q${r1(x - k)} ${r1(y + k)} ${r1(x - r)} ${y}Q${r1(x - k)} ${r1(y - k)} ${x} ${r1(y - r)}Z`;
};

/** A sheaf of wheat standing at (x, y), scaled by `s`; its band is a separate stroke. */
const sheaf = (x: number, y: number, s: number) =>
  `M${r1(x - 5 * s)} ${y}L${r1(x - 1.6 * s)} ${r1(y - 8 * s)}L${r1(x - 6 * s)} ${r1(y - 15 * s)}Q${r1(x - 3 * s)} ${r1(y - 20 * s)} ${x} ${r1(y - 19 * s)}Q${r1(x + 3 * s)} ${r1(y - 20 * s)} ${r1(x + 6 * s)} ${r1(y - 15 * s)}L${r1(x + 1.6 * s)} ${r1(y - 8 * s)}L${r1(x + 5 * s)} ${y}Z`;

/** A strawberry hanging from (x, y), `s` times 7 units wide. */
const berry = (x: number, y: number, s = 1) =>
  `M${x} ${r1(y + 6 * s)}C${r1(x - 2.8 * s)} ${r1(y + 4 * s)} ${r1(x - 3.8 * s)} ${r1(y + 0.4 * s)} ${r1(x - 1.8 * s)} ${y}Q${x} ${r1(y - 0.5 * s)} ${r1(x + 1.8 * s)} ${y}C${r1(x + 3.8 * s)} ${r1(y + 0.4 * s)} ${r1(x + 2.8 * s)} ${r1(y + 4 * s)} ${x} ${r1(y + 6 * s)}Z`;
/** The green star of sepals on a strawberry's top. */
const sepals = (x: number, y: number, s = 1) => leaf(x, y, 2.6 * s, 160) + leaf(x, y, 2.6 * s, 20) + leaf(x, y, 2.2 * s, 110) + leaf(x, y, 2.2 * s, 70) + leaf(x, y, 2 * s, -90, 0.15);
/** A strawberry's seeds. */
const seeds = (x: number, y: number, s = 1): SkyPoint[] => [[x - 1.3 * s, y + 1.8 * s, 0.3 * s], [x + 1.3 * s, y + 1.9 * s, 0.3 * s], [x, y + 3.2 * s, 0.3 * s], [x - 0.8 * s, y + 4.4 * s, 0.28 * s], [x + 0.9 * s, y + 4.3 * s, 0.28 * s]];
/** A strawberry plant: three leaves up from (x, y). */
const trefoil = (x: number, y: number, s = 1) => leaf(x, y, 7 * s, -95, 0.36) + leaf(x, y, 6.4 * s, -30, 0.36) + leaf(x, y, 6.4 * s, -155, 0.36);

/** Flowers of a meadow: `n` dots from the far edge (y0, small) to the front (y1, larger). */
function meadow(n: number, y0: number, y1: number, seed: number): SkyPoint[][] {
  const colors: SkyPoint[][] = [[], [], []];
  for (let i = 0; i < n; i++) {
    const depth = hash(i, seed) ** 0.8;
    const y = y0 + (y1 - y0) * depth;
    colors[i % 3]!.push([r1(8 + 144 * hash(i, seed + 1)), r1(y), r1(0.7 + 1.5 * depth)]);
  }
  return colors;
}

// Silhouettes, drawn around their own origin and placed with a transform.
/** A wolf sitting and howling, facing right; the tail tip at (0, 0) on the ground. */
const WOLF = 'M0 0C2 -1.2 4.5 -2.6 6.4 -4.2C6.7 -9 8 -12.6 9.8 -14.6L10.9 -18.9L11.2 -23.8L13 -20.8L14.7 -21.4L18.7 -25.4L19 -24.1L17.2 -22.6L18.3 -22.4L15.1 -19.1C14.4 -16 14.6 -13 15.1 -10L15.8 0L13.4 0L13.1 -3.4L12.1 -1.2L11.4 0Z';
/** A stag standing, facing left; hooves on y = 0. */
const DEER =
  'M-0.6 -18.4L2.4 -21.6L4.2 -22.3L6.4 -23.7L6 -21.3L7.8 -15.2C11 -14.3 16 -14.8 20 -13.8L21.2 -12.8L20.6 -11L20.5 0H19.2L18.8 -6.2L17.7 -6.6L17.4 0H16.2L16.2 -7.6C13 -8.3 10.2 -8.3 9.6 -7.9L9.4 0H8.2L8 -6.4L7.6 0H6.4L6.3 -9.2C6 -11.3 4.2 -15 3.2 -17.2L1.2 -17.5Z';
const ANTLERS = 'M4 -22.3C3.4 -25 1.6 -26.8 0 -28.8M2.5 -25.3L-0.4 -25.2M1.3 -27.2L2.2 -29.8M5 -22.8C6.2 -25.2 8.4 -26.6 10 -28.6M7.5 -25.6L10.4 -25.2M8.9 -27.2L8.4 -30';
/** A fish leaping, head to the right. */
const FISH = 'M14 0C10 -3.6 4 -3.8 0 0L-4.2 -3.4L-3.1 0L-4.2 3.4L0 0C4 3.8 10 3.6 14 0Z';

const MAY = meadow(60, 212, 256, 5);
const BERRIES: SkyPoint[] = [[30, 237, 1.5], [41, 242, 1.2], [96, 236, 1.4], [135, 240, 1.6], [123, 247, 1.2], [66, 247, 1.3]];

/** The twelve lands, January to December. Above y 175 nothing crosses the caption (x 34–126). */
const LANDS: Layer[][] = [
  // Январь, Волчья луна: snowy hills and firs; a wolf howls on the left crest.
  [
    ['snowfar', ridge([[0, 186], [20, 180], [42, 184], [74, 194], [112, 190], [140, 183], [160, 186]])],
    ['fir', fir(126, 191, 22) + fir(136, 189, 32) + fir(147, 189, 37) + fir(157, 190, 28)],
    ['snow', firSnow(126, 191, 22) + firSnow(136, 189, 32) + firSnow(147, 189, 37) + firSnow(157, 190, 28)],
    ['dark', WOLF, undefined, 'translate(6 182.5) scale(1.3)'],
    ['drift', ridge([[0, 206], [30, 200], [64, 208], [104, 202], [160, 206]])],
    ['snow', ridge([[0, 224], [38, 214], [82, 222], [126, 212], [160, 218]])],
    ['drift', 'M18 236q16 -5 34 -1M92 244q20 -6 44 -1M60 254q14 -3 26 0', 1.4],
  ],
  // Февраль, Снежная луна: deep snow, firs heavy with it, a buried fence, snow falling.
  [
    ['snowfar', ridge([[0, 190], [30, 184], [64, 190], [100, 181], [134, 188], [160, 184]])],
    ['fir', fir(24, 206, 36) + fir(39, 207, 24) + fir(134, 203, 40)],
    ['snow', firSnow(24, 206, 36) + firSnow(39, 207, 24) + firSnow(134, 203, 40)],
    ['drift', ridge([[0, 210], [34, 201], [78, 212], [118, 202], [160, 208]])],
    ['bark', 'M62 226v-5M74 227v-5.5M86 227.4v-5M98 227v-4.6M110 226v-4', 2.2],
    ['snow', oval(62, 221, 2.8, 1.4) + oval(74, 221.5, 2.8, 1.4) + oval(86, 222.4, 2.8, 1.4) + oval(98, 222.4, 2.8, 1.4) + oval(110, 222, 2.8, 1.4)],
    ['snow', ridge([[0, 234], [42, 222], [92, 229], [136, 219], [160, 224]])],
    ['snow', dots([[12, 152, 1.2], [30, 168, 1], [128, 164, 1.1], [150, 156, 1], [56, 184, 1.2], [96, 180, 1], [148, 176, 1.2], [8, 190, 1], [80, 196, 1.1], [112, 188, 0.9], [44, 180, 0.8], [64, 200, 0.8]])],
    ['drift', 'M20 242q18 -6 40 -1M100 248q18 -5 38 0', 1.4],
  ],
  // Март, Червячная луна: the thaw — dark earth, the last snow in patches, a puddle, first shoots.
  [
    ['earthfar', ridge([[0, 190], [34, 183], [72, 191], [112, 183], [160, 189]])],
    ['drift', patch(30, 189, 11, 2.2, 1) + patch(108, 188, 13, 2.2, 2) + patch(150, 191, 8, 1.8, 3)],
    ['bark', bare(132, 212, 30), 1.5],
    ['earth', ridge([[0, 218], [44, 211], [92, 220], [132, 212], [160, 216]])],
    ['snow', patch(26, 232, 16, 4, 4) + patch(112, 243, 20, 4.4, 5) + patch(146, 226, 10, 2.8, 6) + patch(56, 253, 14, 3.2, 7) + patch(88, 225, 8, 2.2, 8)],
    ['water', patch(66, 238, 15, 3.6, 13)],
    ['ice', 'M60 237.4h9M63 239.6h6', 1],
    ['meadow', tuft(44, 227) + tuft(94, 236, 0.9) + tuft(126, 231) + tuft(34, 249, 1.2) + tuft(138, 252, 1.2) + tuft(82, 250), 1.1],
  ],
  // Апрель, Розовая луна: blossoming trees on fresh grass, petals in the air.
  [
    ['grassfar', ridge([[0, 190], [40, 183], [80, 190], [120, 181], [160, 188]])],
    ['bark', trunk(84, 193, 8), 1.4],
    ['pink', crown(84, 186, 6)],
    ['grass', ridge([[0, 220], [40, 212], [88, 220], [130, 210], [160, 216]])],
    ['bark', trunk(26, 218, 22) + trunk(136, 214, 24), 2.4],
    ['pink', crown(26, 193, 12) + crown(136, 188, 13)],
    ['bloom', dots([[22, 185, 2.2], [31, 189, 1.6], [18, 195, 1.4], [132, 179, 2.4], [142, 183, 1.8], [128, 190, 1.6], [145, 192, 1.4], [86, 183, 1.3]])],
    ['pink', dots([[48, 200, 1], [56, 212, 0.9], [110, 196, 1], [104, 222, 1], [70, 234, 1.1], [44, 244, 1], [120, 238, 1.2], [150, 204, 1]])],
    ['meadow', tuft(52, 232) + tuft(96, 240) + tuft(140, 236) + tuft(20, 250, 1.2) + tuft(76, 252, 1.2), 1.1],
  ],
  // Май, Цветочная луна: a meadow in flower.
  [
    ['grassfar', ridge([[0, 194], [36, 186], [84, 194], [126, 184], [160, 190]])],
    ['grass', ridge([[0, 212], [50, 205], [100, 212], [160, 204]])],
    ['meadow', MAY.flatMap((c) => c.filter(([, , r]) => r > 1.6)).map(([x, y, r]) => `M${x} ${y}v${r1(r * 2.6)}`).join(''), 0.9],
    ['white', dots(MAY[0]!)],
    ['yellow', dots(MAY[1]!)],
    ['lilac', dots(MAY[2]!)],
    ['white', dots([[34, 246, 1.7], [38, 243, 1.7], [42, 246, 1.7], [36, 250, 1.7], [40, 250, 1.7], [116, 240, 1.5], [119.5, 237.5, 1.5], [123, 240, 1.5], [118, 243.5, 1.5], [121.5, 243.5, 1.5]])],
    ['yellow', dots([[38, 247, 1.6], [119.5, 241, 1.4]])],
  ],
  // Июнь, Клубничная луна: a green field, strawberries ripe among their leaves.
  [
    ['grassfar', ridge([[0, 190], [44, 184], [92, 192], [134, 182], [160, 188]])],
    ['grass', ridge([[0, 206], [60, 199], [110, 205], [160, 198]])],
    ['berry', dots([[24, 208, 0.8], [46, 212, 0.9], [70, 207, 0.8], [98, 210, 0.9], [122, 207, 0.8], [140, 213, 0.9], [34, 218, 1], [84, 216, 1], [112, 219, 1], [60, 221, 1]])],
    ['meadow', ridge([[0, 226], [54, 219], [104, 226], [160, 218]])],
    ['grass', trefoil(22, 238, 1.2) + trefoil(48, 244) + trefoil(90, 236, 1.1) + trefoil(128, 240, 1.3) + trefoil(146, 248) + trefoil(70, 250, 1.1)],
    ['berry', BERRIES.map(([x, y, s]) => berry(x, y, s)).join('')],
    ['yellow', dots(BERRIES.flatMap(([x, y, s]) => seeds(x, y, s)))],
    ['leaf', BERRIES.map(([x, y, s]) => sepals(x, y, s)).join('')],
    ['white', dots([[52, 234, 1.3], [110, 230, 1.3], [80, 244, 1.2], [10, 246, 1.2]])],
  ],
  // Июль, Оленья луна: a stag at the edge of the forest.
  [
    ['grassfar', ridge([[0, 186], [40, 182], [80, 194], [118, 203], [160, 196]])],
    ['fir', fir(6, 204, 48) + fir(18, 202, 52) + fir(31, 205, 30) + fir(44, 204, 27) + fir(56, 206, 22) + fir(68, 207, 17) + fir(80, 208, 12)],
    ['grass', ridge([[0, 222], [50, 213], [100, 207], [132, 207], [160, 213]])],
    ['dark', DEER, undefined, 'translate(104 208)'],
    ['dark', ANTLERS, 1.1, 'translate(104 208)'],
    ['meadow', tuft(48, 232) + tuft(92, 238) + tuft(140, 228) + tuft(22, 246, 1.2) + tuft(120, 250, 1.2) + tuft(70, 254, 1.2), 1.1],
  ],
  // Август, Осетровая луна: a river under the Moon, a fish leaping.
  [
    ['grassfar', ridge([[0, 188], [50, 182], [100, 190], [160, 184]])],
    ['fir', fir(18, 190, 14) + fir(28, 188, 18) + fir(38, 190, 12) + fir(130, 188, 16) + fir(141, 187, 20)],
    ['grass', ridge([[0, 200], [80, 197], [160, 200]])],
    ['water', 'M74 197C66 204 56 210 50 222C44 236 34 248 24 264H150C138 248 118 236 110 222C104 210 96 204 90 197Z'],
    ['ice', 'M78 202h5M76 208h9M73 216h14M71 226h18M68 240h24M66 254h28', 1.1],
    ['snow', FISH, undefined, 'translate(105 219) rotate(-38) scale(1.25)'],
    ['ice', oval(101, 236, 7, 1.6) + oval(101, 236, 12, 2.8), 0.9],
    ['ice', dots([[93, 228, 0.9], [109, 229, 0.9], [97, 224, 0.7]])],
    ['grassfar', 'M22 238v-22M28 240v-18M16 242v-16M140 236v-18M146 240v-22', 1.1],
    ['bark', oval(22, 214, 1.4, 3.2) + oval(28, 220, 1.3, 3) + oval(146, 216, 1.4, 3.2)],
  ],
  // Сентябрь, Урожайная луна: a harvested field with sheaves.
  [
    ['goldfar', ridge([[0, 190], [40, 184], [84, 192], [128, 182], [160, 188]])],
    ['fir', fir(116, 186, 12) + fir(124, 185, 16) + fir(132, 186, 12) + fir(20, 189, 12)],
    ['field', ridge([[0, 210], [60, 204], [110, 210], [160, 202]])],
    ['goldfar', 'M40 212L4 264M72 208L56 264M100 208L112 264M128 206L160 250', 1.2],
    ['gold', sheaf(40, 236, 1.2) + sheaf(84, 224, 0.9) + sheaf(126, 244, 1.4) + sheaf(146, 218, 0.7)],
    ['goldfar', 'M36.8 226.4h6.4M81.6 216.8h4.8M122.3 232.8h7.4M144 212.4h4', 1.6],
  ],
  // Октябрь, Охотничья луна: autumn trees in orange, leaves on the ground.
  [
    ['autumnfar', ridge([[0, 190], [36, 182], [80, 192], [124, 182], [160, 190]])],
    ['bark', trunk(86, 196, 8), 1.4],
    ['yellow', crown(86, 188, 6)],
    ['earth', ridge([[0, 220], [50, 212], [100, 220], [160, 212]])],
    ['bark', trunk(26, 218, 22) + trunk(136, 214, 24), 2.4],
    ['orange', crown(26, 193, 12)],
    ['rust', crown(136, 188, 13)],
    ['yellow', dots([[20, 185, 2.4], [30, 189, 1.8], [142, 180, 2.4], [130, 186, 1.8]])],
    ['orange', dots([[48, 230, 1.3], [60, 238, 1.2], [96, 234, 1.3], [112, 246, 1.4], [74, 250, 1.3], [140, 238, 1.2], [20, 244, 1.4]])],
    ['yellow', dots([[54, 244, 1.2], [88, 242, 1.2], [124, 232, 1.1], [36, 236, 1.2], [104, 254, 1.3]])],
  ],
  // Ноябрь, Бобровая луна: a still pond, a beaver swimming to its lodge, bare trees.
  [
    ['earthfar', ridge([[0, 188], [40, 182], [88, 190], [132, 180], [160, 186]])],
    ['bark', bare(18, 202, 26) + bare(40, 204, 18), 1.3],
    ['grass', ridge([[0, 208], [80, 204], [160, 208]])],
    ['water', oval(80, 226, 62, 13)],
    ['ice', 'M78 216h8M75 222h14M86 230h16', 1.1],
    ['bark', 'M106 231Q114 205 134 208Q154 212 156 231Z'],
    ['field', 'M114 224l14 -10M118 230l22 -16M132 230l18 -12M112 216l24 8M122 209l24 14M140 229l14 -4M128 204l3 8M142 205l-3 7M150 210l-6 6', 1.1],
    ['dark', 'M56 234a7 4.8 0 0 1 14 0Z' + oval(59, 229.8, 1.3)],
    ['ice', 'M55 234.4l-16 -4.4M55 234.4l-16 4', 1.2],
    ['grass', ridge([[0, 246], [40, 240], [100, 247], [160, 238]])],
    ['earthfar', 'M18 250v-12M24 248v-15M30 251v-10M132 246v-14M138 248v-10', 1.1],
  ],
  // Декабрь, Холодная луна: a frosty field, a lone fir, frost glittering.
  [
    ['snowfar', ridge([[0, 196], [50, 192], [110, 196], [160, 192]])],
    ['drift', ridge([[0, 210], [60, 206], [120, 211], [160, 206]])],
    ['ice', ridge([[0, 222], [60, 216], [110, 222], [160, 218]])],
    ['fir', fir(128, 226, 48)],
    ['snow', firSnow(128, 226, 48)],
    ['white', sparkle(30, 234, 2.6) + sparkle(62, 246, 2) + sparkle(92, 234, 2.4) + sparkle(150, 244, 2.2) + sparkle(106, 252, 2.6) + sparkle(20, 252, 1.8)],
    ['white', 'M44 240l-1.6 -4M46 240v-5M48 240l1.6 -4M76 252l-1.6 -4M78 252v-5M80 252l1.6 -4M140 252l-1.6 -4M142 252v-5M144 252l1.6 -4', 1],
  ],
];

// ---- Level-up ----

export type Ease = (t: number) => number;
export const EASE: Record<PhaseTiming['easing'], Ease> = {
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  // A soft back-out: the crescent overshoots a little and settles.
  spring: (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
};

export interface PhaseFrames {
  shadow: Keyframe[];
  light: Keyframe[];
  halo: Keyframe[];
  tint: Keyframe[];
}

/**
 * WAAPI keyframes (played with linear easing) that move the rig from one fill to another along
 * `ease`. When the path crosses the half moon, a frame is inserted exactly there, so the shadow
 * and the lit ellipse are never both visible. `tint` follows a special moon's tint (tintOpacity).
 */
export function phaseFrames(from: number, to: number, ease: Ease, steps = 16, special: SpecialMoon | null = null): PhaseFrames {
  const fillAt = (t: number) => from + (to - from) * ease(t);
  const times: number[] = [];
  for (let i = 0; i <= steps; i++) times.push(i / steps);
  const withCross: number[] = [times[0]!];
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1]!;
    const b = times[i]!;
    if ((fillAt(a) - 0.5) * (fillAt(b) - 0.5) < 0) {
      let lo = a;
      let hi = b;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if ((fillAt(lo) - 0.5) * (fillAt(mid) - 0.5) <= 0) hi = mid;
        else lo = mid;
      }
      withCross.push((lo + hi) / 2);
    }
    withCross.push(b);
  }
  const frames: PhaseFrames = { shadow: [], light: [], halo: [], tint: [] };
  for (const t of withCross) {
    const crossing = !times.includes(t);
    const f = crossing ? 0.5 : fillAt(t);
    const rig = crossing ? { shadow: 0, light: 0 } : phaseRig(f);
    const offset = round(t * 10000) / 10000;
    frames.shadow.push({ transform: `scaleX(${rig.shadow})`, offset });
    frames.light.push({ transform: `scaleX(${rig.light})`, offset });
    frames.halo.push({ opacity: haloOpacity(f), offset });
    frames.tint.push({ opacity: tintOpacity(special, f), offset });
  }
  return frames;
}

/**
 * Timings of the Moon's level-up (the flask's state machine, flaskAnimation.ts): wax to full
 * 220 ms → glow 360 ms while the new star flies up → wane 200 ms after 20 while the season
 * changes → wax 300 ms: 1.1 s in all. Each further level wanes and waxes in 380 ms, its star
 * flying and its season turning meanwhile.
 */
export function moonPhaseTiming(state: AnimationState): PhaseTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 220, easing: 'out' };
    case 'overflow':
      return { delay: 0, duration: 360, easing: 'out' };
    case 'draining':
      return compressed ? { delay: 10, duration: 150, easing: 'in' } : { delay: 20, duration: 200, easing: 'in' };
    case 'refilling':
      return compressed ? { delay: 0, duration: 220, easing: 'out' } : { delay: 0, duration: 300, easing: 'spring' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

/** How long the old sky stays after the level prop grows, waiting for playLevelUp. */
const HOLD_MS = 700;

const text: ProgressThemeText = {
  name: 'Луна',
  levelNoun: 'Луна',
  levelGenitive: 'луны',
  levelForms: ['луна', 'луны', 'лун'],
  levelFormsOf: ['луны', 'лун', 'лун'],
  completed: (n) => `Полнолуние ${n}`,
  fillLabel: (percent) => `Луна заполнена на ${percent}%`,
  hint: 'От новолуния к полнолунию',
};

/** A mark on the orbit arc: monotonic upward from below-right (0) to above-right (1). */
export function markPoint(height: number): { x: number; y: number } {
  const angle = ORBIT_FROM - clamp(height) * 2 * ORBIT_FROM;
  return { x: round(CX + ORBIT * Math.cos(angle)), y: round(CY + ORBIT * Math.sin(angle)) };
}

// Captions to the right of the box, like the flask's: ≤ 12 characters, at most four.
const MARK_CAPTIONS = 4;
const MARK_CAPTION_CHARS = 12;
const CAPTION_GAP = 18;
/** Left edge of the captions: just past the sky panel (160), ≈ 142 px on the 140 px hero. */
const CAPTION_X = 162;
const HERO_SCALE = 140 / VIEW_W;
const CAPTION_LINE = 16;
const CAPTION_PAD_MIN = 4;
const CAPTION_PAD_MAX = 14;

export function shortLabel(label: string): string {
  return label.length > MARK_CAPTION_CHARS ? `${label.slice(0, MARK_CAPTION_CHARS - 1).trimEnd()}…` : label;
}

/** Caption y positions, at least CAPTION_GAP apart and inside the box. */
export function captionYs(ys: number[]): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => Math.max(o.y, 12));
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + CAPTION_GAP);
  const max = VIEW_H - 12;
  if (placed.length && placed[placed.length - 1]! > max) {
    placed[placed.length - 1] = max;
    for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k]!, placed[k + 1]! - CAPTION_GAP);
  }
  const out = Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]!));
  return out;
}

/** Vertical padding (px) of caption `i`: grows towards a 44 px tap area when no caption is near. */
function captionPad(ys: number[], i: number): number {
  const gaps = ys.filter((_, j) => j !== i).map((y) => Math.abs(y - ys[i]!) * HERO_SCALE);
  const room = gaps.length ? Math.min(...gaps) - CAPTION_LINE : CAPTION_PAD_MAX;
  return Math.round(Math.min(CAPTION_PAD_MAX, Math.max(CAPTION_PAD_MIN, room)));
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const nextFrame = (cb: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : window.setTimeout(cb, 16));

/** Awaits an animation, or its duration plus a margin when `finished` never settles (old WebViews). */
function done(animation: Animation | null, duration: number): Promise<void> {
  if (!animation) return Promise.resolve();
  return Promise.race([animation.finished.then(() => undefined, () => undefined), wait(duration + FINISH_FALLBACK_MS)]);
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

// Craters: darker spots of the lit colour; on the unlit part they vanish into the shadow.
const CRATERS: SkyPoint[] = [
  [104, 78, 7],
  [114, 106, 4.5],
  [96, 124, 8],
  [72, 76, 10],
  [62, 110, 6],
  [84, 100, 3.5],
];

/** The remembered stars, the constellation lines and the Milky Way; the newest star twinkles. */
const StarField = memo(function StarField({ count, id }: { count: number; id: string }) {
  const stars = skyStars(count);
  const milky = milkyWay(count);
  const newest = (i: number) => (i === count - 1 ? 'moon-star moon-twinkle anim-decor' : 'moon-star');
  return (
    <>
      {milky && (
        <>
          <rect x="-170" y={-milky.width / 2} width="340" height={milky.width} fill={`url(#${id}-milky)`} transform={`translate(${MILKY_X} ${MILKY_Y}) rotate(${MILKY_ANGLE})`} style={{ opacity: milky.opacity }} />
          <path d={milky.dots.map(([x, y]) => `M${x} ${y}h0`).join('')} className="moon-dust" />
        </>
      )}
      <path d={dots(FAINT.slice(count > 0 ? 0 : 1).map(([x, y, r]) => [x, y, Math.min(r, 0.9)]))} className="moon-faint" />
      {count === 0 && <path d={sparkle(...FAINT[0]!)} className={newest(-1)} />}
      {constellationLines(count).map(({ group, chains, opacity }) =>
        chains.map((d, k) => <path key={`${group}-${k}`} d={d} pathLength={1} className="moon-line" data-lines={group} style={{ opacity }} />),
      )}
      {stars.map((s, i) => (
        <path key={i} d={sparkle(s.x, s.y, s.r)} className={newest(i)} data-star={i} style={{ opacity: groupOpacity(s.group, count) }} />
      ))}
      {milky && <path d={sparkle(...milky.dots.at(-1)!, 2.2)} className={newest(count - 1)} data-star={count - 1} />}
    </>
  );
});

/** One month's land. */
function Land({ level, ref }: { level: number; ref?: Ref<SVGGElement> }) {
  const month = moonMonth(level);
  return (
    <g ref={ref} className={`moon-land moon-land--${month + 1}`} data-level={level}>
      {LANDS[month]!.map(([color, d, stroke, transform], i) => (
        <path key={i} d={d} className={`moon-c-${color} ${stroke ? 'moon-s' : 'moon-f'}`} strokeWidth={stroke} transform={transform} />
      ))}
    </g>
  );
}

/** What the hero draws of the level: its land, its remembered stars, its Moon. */
interface SkyView {
  /** The level whose land and caption are drawn. */
  land: number;
  /** Stars lit in the sky: one per completed full moon. */
  stars: number;
  /** The level whose Moon is drawn (a special moon's tint and size). */
  moon: number;
  /** The land fading out while the season changes. */
  from?: number;
}

const viewOf = (level: number): SkyView => ({ land: level, stars: level - 1, moon: level });

interface Sweep {
  animations: Animation[];
  from: number;
  to: number;
  start: number;
  duration: number;
}

const SWEEP: PhaseTiming = { delay: 0, duration: 700, easing: 'out' };

function Hero({ fill, level, state = 'active', motion: motionProp, label, marks, onMarkTap, ref }: ProgressHeroProps) {
  const systemMotion = useMotion();
  const motion = motionProp ?? systemMotion;
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const id = `moon${useId().replace(/[^\w-]/g, '')}`;
  const target = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const lv = levelOf(level);

  // While a choreography runs (or the level-up is awaited) the Moon shows `override` and the sky
  // shows `view`; otherwise both follow the props. `rig` swaps the phase path for the moving rig.
  const [override, setOverride] = useState<number | null>(null);
  const [view, setView] = useState<SkyView | null>(null);
  const [rig, setRig] = useState(false);
  const playing = useRef(false);
  const playToken = useRef(0);
  const moveToken = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const levelRef = useRef(lv);
  levelRef.current = lv;
  const shown = override ?? target;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const sky = view ?? viewOf(lv);
  const skyRef = useRef(sky);
  skyRef.current = sky;

  const bodyRef = useRef<SVGGElement>(null);
  const litRef = useRef<SVGGElement>(null);
  const rigRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const lightRef = useRef<SVGEllipseElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const tintRef = useRef<SVGCircleElement>(null);
  const flashRef = useRef<SVGCircleElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const starsRef = useRef<SVGGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const landRef = useRef<SVGGElement>(null);
  const oldLandRef = useRef<SVGGElement>(null);
  const nameRef = useRef<SVGTextElement>(null);
  const oldNameRef = useRef<SVGTextElement>(null);
  const cometRef = useRef<SVGGElement>(null);

  useEffect(installPauseWhenHidden, []);

  /** Moves the rig from one fill to another; resolves when it arrives (animations stay `forwards`). */
  const sweep = (from: number, to: number, timing: PhaseTiming, track: (a: Animation | null) => void, waning = false) => {
    const special = state === 'complete' ? null : specialMoon(skyRef.current.moon);
    const frames = phaseFrames(from, to, EASE[timing.easing], 16, special);
    const options: KeyframeAnimationOptions = { duration: timing.duration, easing: 'linear', fill: 'forwards' };
    const all = [animate(shadowRef.current, frames.shadow, options), animate(lightRef.current, frames.light, options), animate(haloRef.current, frames.halo, options)];
    if (special === 'blood') all.push(animate(tintRef.current, frames.tint, options));
    // A waning Moon keeps its left side lit: the rig mirrored. Full and new moons look the same
    // either way, so the mirror comes and goes unseen.
    if (waning) all.push(animate(rigRef.current, [{ transform: 'scaleX(-1)' }, { transform: 'scaleX(-1)' }], { duration: timing.duration }));
    all.forEach(track);
    return Promise.all(all.map((a) => done(a, timing.duration)));
  };

  // Prop-driven sweeps. A newer sweep (or a level-up) cancels the one it overtakes and starts
  // from where that one had got to.
  const sweepRef = useRef<Sweep | null>(null);
  const sweepNow = () => {
    const s = sweepRef.current;
    if (!s) return shownRef.current;
    const t = Math.min(1, Math.max(0, (performance.now() - s.start) / s.duration));
    return s.from + (s.to - s.from) * EASE.out(t);
  };
  const cancelSweep = () => {
    sweepRef.current?.animations.forEach((a) => a.cancel());
    sweepRef.current = null;
  };
  const startSweep = (from: number, to: number) => {
    cancelSweep();
    if (from === to) return;
    if (motionRef.current === 'reduced') {
      animate(litRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      return;
    }
    const token = ++moveToken.current;
    const current: Sweep = { animations: [], from, to, start: performance.now(), duration: SWEEP.duration };
    sweepRef.current = current;
    setRig(true);
    void sweep(from, to, SWEEP, (a) => a && current.animations.push(a)).then(() => {
      if (token !== moveToken.current || playing.current) return;
      current.animations.forEach((a) => a.cancel());
      sweepRef.current = null;
      setRig(false);
    });
  };

  // The level-up rule: the app renders the new level with its fill, then calls playLevelUp. So
  // when the level grows, the sky and the Moon on screen are held for a moment; the level-up
  // starts from them. If it does not come (a jump between skills), the new sky fades in.
  const holdTimer = useRef<number | undefined>(undefined);
  const committed = useRef({ sky, fill: shown });
  const settle = () => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    const from = sweepRef.current ? sweepNow() : committed.current.fill;
    setView(null);
    setOverride(null);
    animate(sceneRef.current, [{ opacity: 0.3 }, { opacity: 1 }], { duration: motionRef.current === 'reduced' ? 240 : 420, easing: 'ease-out' });
    animate(starsRef.current, [{ opacity: 0.3 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
    startSweep(from, targetRef.current);
  };
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  const previousLevel = useRef(lv);
  const previous = useRef(target);
  useLayoutEffect(() => {
    const fromLevel = previousLevel.current;
    const from = previous.current;
    previousLevel.current = lv;
    previous.current = target;
    if (playing.current) return;
    if (fromLevel !== lv) {
      if (lv > fromLevel) {
        const held = sweepRef.current ? sweepNow() : committed.current.fill;
        cancelSweep();
        setRig(false);
        setView({ ...committed.current.sky, from: undefined });
        setOverride(held);
        window.clearTimeout(holdTimer.current);
        holdTimer.current = window.setTimeout(settle, HOLD_MS);
      } else settle();
      return;
    }
    // A fill change while the level-up is awaited: it plays to the latest fill anyway.
    if (holdTimer.current !== undefined || from === target) return;
    setOverride(null);
    startSweep(sweepRef.current ? sweepNow() : from, target);
  }, [lv, target]);

  // What was on screen after each commit (the hold above reads the previous one).
  useLayoutEffect(() => {
    committed.current = { sky, fill: shown };
  });

  // The Moon turns golden: one soft glow when the skill is completed on screen (never on load).
  const previousState = useRef(state);
  useLayoutEffect(() => {
    const from = previousState.current;
    previousState.current = state;
    if (from === state || state !== 'complete') return;
    if (motion === 'reduced') animate(litRef.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    else animate(flashRef.current, [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 0.9, transform: 'scale(1.15)', offset: 0.35 }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 700, easing: 'ease-out' });
  }, [state, motion]);

  useImperativeHandle(
    ref,
    (): ProgressHeroHandle => ({
      element: () => bodyRef.current,
      async playLevelUp({ fromFill, toFill, levels, onOverflow }) {
        const token = ++playToken.current;
        const aborted = () => token !== playToken.current;
        const end = clamp(toFill);
        window.clearTimeout(holdTimer.current);
        holdTimer.current = undefined;
        // Overlapping celebrations: start from what is on screen rather than jump up to `fromFill`.
        const start = Math.min(clamp(fromFill), sweepRef.current ? sweepNow() : shownRef.current);
        cancelSweep();
        if (!litRef.current || typeof litRef.current.animate !== 'function') {
          onOverflow?.();
          flushSync(() => {
            setView(null);
            setOverride(null);
          });
          return;
        }
        playing.current = true;
        moveToken.current++;
        const running: Animation[] = [];
        const track = (a: Animation | null) => {
          if (a) running.push(a);
          return a;
        };
        const scene: SkyView = { ...skyRef.current, from: undefined };
        flushSync(() => {
          setOverride(start);
          setView(scene);
          setRig(motion !== 'reduced');
        });
        const update = (patch: Partial<SkyView>) => {
          Object.assign(scene, patch);
          flushSync(() => setView({ ...scene }));
        };
        try {
          if (motion === 'reduced') {
            onOverflow?.();
            flushSync(() => {
              setOverride(end);
              setView(null);
            });
            const fades = [litRef.current, sceneRef.current, starsRef.current].map((el) => track(animate(el, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })));
            await Promise.all(fades.map((a) => done(a, 240)));
            return;
          }
          let current = start;
          const move = async (to: number, timing: PhaseTiming, waning = false) => {
            const from = current;
            current = to;
            await sweep(from, to, timing, track, waning);
          };
          const glow = async (timing: PhaseTiming) => {
            const d = timing.duration;
            const all = [
              animate(flashRef.current, [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'scale(1.12)', offset: 0.3 }, { opacity: 0, transform: 'scale(1.55)' }], { duration: d, easing: 'ease-out' }),
              animate(ringRef.current, [{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.45)' }], { duration: d, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }),
              animate(bodyRef.current, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: d, easing: 'ease-in-out' }),
            ];
            all.forEach(track);
            await Promise.all(all.map((a) => done(a, d)));
          };
          // The completed moon's star flies from the rim to its place and lights; a seventh star
          // draws its constellation's lines.
          const lightStar = async (toLevel: number, ms: number) => {
            const count = toLevel - 1;
            if (count <= scene.stars) return;
            const [x, y] = starPoint(count - 1);
            const flight = track(animate(cometRef.current, cometFrames(x, y), { duration: ms, easing: 'cubic-bezier(0.3, 0.1, 0.3, 1)' }));
            await done(flight, ms);
            if (aborted()) return;
            update({ stars: count });
            const star = starsRef.current?.querySelector(`[data-star="${count - 1}"]`);
            track(animate(star, [{ opacity: 0.3, transform: 'scale(2.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }));
            if (count % STARS_PER_CONSTELLATION === 0 && count <= SKY_STARS) {
              starsRef.current?.querySelectorAll(`[data-lines="${count / STARS_PER_CONSTELLATION - 1}"]`).forEach((line) => {
                track(animate(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 380, easing: 'ease-out' }));
              });
            }
          };
          // The season turns: the old land sinks away as the next one rises into place.
          const turnSeason = async (toLevel: number, ms: number) => {
            if (toLevel === scene.land) return;
            update({ from: scene.land, land: toLevel });
            const out = track(animate(oldLandRef.current, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(18px)' }], { duration: ms, easing: 'ease-in', fill: 'forwards' }));
            const into = track(animate(landRef.current, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: ms, easing: 'ease-out' }));
            track(animate(oldNameRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.4, easing: 'ease-in', fill: 'forwards' }));
            track(animate(nameRef.current, [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: ms, easing: 'ease-out' }));
            await Promise.all([done(out, ms), done(into, ms)]);
            if (!aborted()) update({ from: undefined });
          };
          const startLand = scene.land;
          /** The level cycle `cycle` leads to: the next one, or the level of the props on the last. */
          const goal = (cycle: number, last: boolean) => (last ? levelRef.current : Math.min(levelRef.current, startLand + cycle + 1));
          const side: Promise<void>[] = [];
          let next = startLand;

          let phase = nextPhase(IDLE, { type: 'start', levels });
          while (phase.phase !== 'idle' && !aborted()) {
            const timing = moonPhaseTiming(phase);
            const last = phase.cyclesLeft <= 1;
            if (timing.delay) await wait(timing.delay);
            if (aborted()) break;
            switch (phase.phase) {
              case 'rising':
                await move(1, timing);
                break;
              case 'overflow':
                onOverflow?.();
                next = goal(phase.cycle, last);
                side.push(wait(30).then(() => (aborted() ? undefined : lightStar(next, 300))));
                await glow(timing);
                break;
              case 'draining':
                if (phase.cycle > 0) {
                  next = goal(phase.cycle, last);
                  side.push(lightStar(next, 240));
                }
                side.push(turnSeason(next, phase.cycle > 0 ? 320 : 440));
                await move(0, timing, true);
                // The new moon: the next level's Moon (a special one's tint and size) takes over.
                if (!aborted() && scene.moon !== next) update({ moon: next });
                break;
              case 'refilling':
                await move(refillTarget(phase, end), timing);
                break;
            }
            phase = nextPhase(phase, { type: DONE_EVENT[phase.phase] } as Parameters<typeof nextPhase>[1]);
          }
          await Promise.all(side);
        } finally {
          if (aborted()) {
            running.forEach((a) => a.cancel());
          } else {
            // Commit the end state (the props' level), then drop the WAAPI layers and swap the rig
            // for the path: no jump.
            flushSync(() => {
              setOverride(end);
              setView(null);
            });
            running.forEach((a) => a.cancel());
            playing.current = false;
            nextFrame(() => {
              setRig(false);
              if (Math.abs(targetRef.current - end) > 1e-6) setOverride(null);
            });
          }
        }
      },
    }),
    [motion, state],
  );

  const shownMarks = marks ?? [];
  const captioned = shownMarks.slice(-MARK_CAPTIONS);
  const captionY = captionYs(captioned.map((m) => markPoint(m.height).y));
  const rest = phaseRig(shown);
  const complete = state === 'complete';
  const special = complete ? null : specialMoon(sky.moon);

  const classes = ['moon', 'moon--hero', `moon--${state}`, special ? `moon--${special}` : '', shownMarks.length ? 'moon--marked' : '', rig ? 'moon--rig' : ''].filter(Boolean);
  return (
    <div className={classes.join(' ')}>
      <svg className="moon-svg" viewBox="0 0 160 260" role="img" aria-label={label ?? text.fillLabel(Math.floor(shown * 100))}>
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="moon-sky-top" />
            <stop offset="1" className="moon-sky-low" />
          </linearGradient>
          <linearGradient id={`${id}-lit`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={CY - R} y2={CY + R}>
            <stop offset="0" className="moon-lit-top" />
            <stop offset="1" className="moon-lit-low" />
          </linearGradient>
          <linearGradient id={`${id}-tint`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={CY - R} y2={CY + R}>
            <stop offset="0" className="moon-tint-top" />
            <stop offset="1" className="moon-tint-low" />
          </linearGradient>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0.62" className="moon-halo-in" />
            <stop offset="1" className="moon-halo-out" />
          </radialGradient>
          <linearGradient id={`${id}-milky`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="moon-milky-edge" />
            <stop offset="0.5" className="moon-milky-mid" />
            <stop offset="1" className="moon-milky-edge" />
          </linearGradient>
          <clipPath id={`${id}-panel`}>
            <rect x="0" y="0" width={VIEW_W} height={VIEW_H} rx="22" />
          </clipPath>
        </defs>
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} rx="22" fill={`url(#${id}-sky)`} />
        <g clipPath={`url(#${id}-panel)`}>
          <g ref={starsRef}>
            <StarField count={sky.stars} id={id} />
          </g>
          <g ref={sceneRef}>
            {sky.from !== undefined && <Land key={`l${sky.from}`} level={sky.from} ref={oldLandRef} />}
            <Land key={`l${sky.land}`} level={sky.land} ref={landRef} />
            {/* The moon's name under it; while the season turns the old one fades before the new. */}
            {sky.from !== undefined && (
              <text key={`n${sky.from}`} ref={oldNameRef} x={CX} y="170" className="moon-name">
                {moonCaption(sky.from)}
              </text>
            )}
            <text key={`n${sky.land}`} ref={nameRef} x={CX} y="170" className="moon-name">
              {moonCaption(sky.land)}
            </text>
          </g>
          {/* Glows stay inside the sky panel. */}
          <g className="moon-size">
            <circle ref={haloRef} cx={CX} cy={CY} r={R * 1.45} fill={`url(#${id}-halo)`} className="moon-halo" style={{ opacity: complete ? 0.8 : haloOpacity(shown) }} />
            <circle ref={flashRef} cx={CX} cy={CY} r={R * 1.45} fill={`url(#${id}-halo)`} className="moon-flash" />
            <circle ref={ringRef} cx={CX} cy={CY} r={R + 3} className="moon-ring" />
          </g>
        </g>
        {shownMarks.length > 0 && <path d={`M${markPoint(0).x} ${markPoint(0).y}A${ORBIT} ${ORBIT} 0 0 0 ${markPoint(1).x} ${markPoint(1).y}`} className="moon-orbit" />}
        <g className="moon-size">
          <g ref={bodyRef} className="moon-body">
            <mask id={`${id}-phase`}>
              <path d={moonPhasePath(shown)} className="moon-lit moon-mask-on" />
              <g ref={rigRef} className="moon-rigging">
                <path d={`M${CX} ${CY - R - 1}A${R + 1} ${R + 1} 0 0 1 ${CX} ${CY + R + 1}Z`} className="moon-mask-on" />
                <ellipse ref={shadowRef} cx={CX} cy={CY} rx={R + 1} ry={R + 1} className="moon-mask-off moon-squeeze" style={{ transform: `scaleX(${rest.shadow})` }} />
                <ellipse ref={lightRef} cx={CX} cy={CY} rx={R} ry={R} className="moon-mask-on moon-squeeze" style={{ transform: `scaleX(${rest.light})` }} />
              </g>
            </mask>
            <circle cx={CX} cy={CY} r={R} className="moon-shadow" />
            {/* The lit surface (skill colour, a special moon's tint, craters) shows through the phase mask. */}
            <g ref={litRef} mask={`url(#${id}-phase)`}>
              <circle cx={CX} cy={CY} r={R} fill={`url(#${id}-lit)`} />
              <circle ref={tintRef} cx={CX} cy={CY} r={R} fill={`url(#${id}-tint)`} className="moon-tint" style={{ opacity: tintOpacity(special, shown) }} />
              <path d={dots(CRATERS)} className="moon-crater" />
            </g>
            <circle cx={CX} cy={CY} r={R} className="moon-rim" />
          </g>
        </g>
        <g ref={cometRef} className="moon-comet" aria-hidden="true">
          <circle r="6" className="moon-comet-glow" />
          <path d={sparkle(0, 0, 3.4)} className="moon-star" />
        </g>
        {shownMarks.map((mark) => {
          const { x, y } = markPoint(mark.height);
          return (
            // Pointer only: the captions are the accessible way in.
            <g key={mark.id} className="moon-mark" aria-hidden="true" onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}>
              {/* A 32-unit square around the pennant; markPoint x ≤ 140, so it stays inside the panel. */}
              <rect x={x - 12} y={y - 23} width={32} height={32} className="moon-mark-hit" />
              <circle cx={x} cy={y} r="1.8" className="moon-mark-foot" />
              <line x1={x} x2={x} y1={y} y2={y - 13} className="moon-mark-pole" />
              <path d={`M${x} ${y - 13}L${x + 9} ${y - 9.5}L${x} ${y - 6}Z`} className="moon-mark-flag" />
            </g>
          );
        })}
      </svg>
      {captioned.map((mark, i) => (
        <button
          key={mark.id}
          type="button"
          className="moon-mark-caption"
          style={{ left: `${(CAPTION_X / VIEW_W) * 100}%`, top: `${(captionY[i]! / VIEW_H) * 100}%`, paddingBlock: captionPad(captionY, i) }}
          aria-label={`Засечка: ${mark.label}`}
          onClick={onMarkTap ? () => onMarkTap(mark.id) : undefined}
        >
          {shortLabel(mark.label)}
        </button>
      ))}
    </div>
  );
}

// The mini: a night tile with the Moon (r 13 of 40), legible at 28 px; a special moon keeps its tint.
const MINI_R = 13.5;

function Mini({ fill, level, state = 'active', size = 32, label }: ProgressMiniProps) {
  const id = `moonmini${useId().replace(/[^\w-]/g, '')}`;
  const shown = state === 'complete' ? 1 : state === 'empty' ? 0 : clamp(fill);
  const special = state === 'complete' ? null : specialMoon(level);
  return (
    <svg
      className={`moon moon--mini moon--${state}${special ? ` moon--${special}` : ''}`}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label={label ?? text.fillLabel(Math.floor(shown * 100))}
    >
      <defs>
        <linearGradient id={`${id}-lit`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="moon-lit-top" />
          <stop offset="1" className="moon-lit-low" />
        </linearGradient>
        <linearGradient id={`${id}-tint`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="moon-tint-top" />
          <stop offset="1" className="moon-tint-low" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="40" height="40" rx="11" className="moon-mini-sky" />
      <g transform={special === 'super' ? 'matrix(1.1 0 0 1.1 -2 -2)' : undefined}>
        <circle cx="20" cy="20" r={MINI_R} className="moon-shadow" />
        <path d={moonPhasePath(shown, 20, 20, MINI_R)} fill={`url(#${id}-lit)`} />
        {special && special !== 'super' && <path d={moonPhasePath(shown, 20, 20, MINI_R)} fill={`url(#${id}-tint)`} style={{ opacity: tintOpacity(special, shown) }} />}
        <circle cx="20" cy="20" r={MINI_R} className="moon-rim moon-rim--mini" />
      </g>
    </svg>
  );
}

export const moonTheme: ProgressThemeDefinition = {
  key: 'moon',
  text,
  available: true,
  Hero,
  Mini,
  markPoint,
};
