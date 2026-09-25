// The twenty pictures of the puzzle theme (puzzle.tsx): a new one every level, chosen by
// pictureIndex(level). Each is a small flat scene in the 3×4 picture box (PIC_W × PIC_H, local
// coordinates), drawn as a list of shapes: [colour, path, stroke width?, opacity?]. Colours are
// the theme's natural palette (`--pz-<name>` in puzzle.css, token mixes with literal fallbacks),
// the skill colour (`skill`, `skill-light`, `skill-deep` → --liquid-*) on one element per
// picture, or a shared gradient (`@name`, PictureDefs). Shapes of one colour share one path.

import type { CSSProperties } from 'react';

export const PIC_W = 108;
export const PIC_H = 144;

// ---- Primitives (path data; every closed shape runs counter-clockwise so merged ones union) ----

const r1 = (v: number) => Math.round(v * 10) / 10;

export const circ = (x: number, y: number, r: number) => `M${r1(x - r)} ${r1(y)}a${r} ${r} 0 1 0 ${r1(2 * r)} 0a${r} ${r} 0 1 0 ${r1(-2 * r)} 0z`;
const ell = (x: number, y: number, rx: number, ry: number) => `M${r1(x - rx)} ${y}a${rx} ${ry} 0 1 0 ${r1(2 * rx)} 0a${rx} ${ry} 0 1 0 ${r1(-2 * rx)} 0z`;
const box = (x: number, y: number, w: number, h: number) => `M${x} ${y}v${h}h${w}v${-h}z`;
const all = <T,>(items: T[], f: (item: T) => string) => items.map(f).join('');
/** A fluffy cloud: a flat base and two puffs. */
const cloud = (x: number, y: number, s = 1) => ell(x, y, 12 * s, 4 * s) + circ(x - 4 * s, y - 3 * s, 4.5 * s) + circ(x + 3 * s, y - 5 * s, 6 * s);
/** A two-tier fir tree standing at (x, y). */
const pine = (x: number, y: number, h: number, w: number) =>
  `M${x} ${r1(y - h)}L${r1(x - w * 0.7)} ${r1(y - h * 0.45)}H${r1(x + w * 0.7)}Z` + `M${x} ${r1(y - h * 0.7)}L${x - w} ${y}H${x + w}Z`;
/** A four-pointed sparkle. */
const star = (x: number, y: number, r: number) => `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;
/** Rolling water: `n` crests across the picture from height y, then down to the bottom. */
const waves = (y: number, n: number, a = 2.5) => `M0 ${y}${`q${r1(PIC_W / n / 2)} ${-a} ${r1(PIC_W / n)} 0`.repeat(n)}V${PIC_H}H0Z`;
/** A hill line from the left edge through a control point to the right edge, filled to the bottom. */
const hill = (y0: number, cx: number, cy: number, y1: number) => `M0 ${y0}Q${cx} ${cy} ${PIC_W} ${y1}V${PIC_H}H0Z`;
/** The disc (x, y, r) without the disc (x + ox, y + oy, r2): a crescent moon or a planet's shade. */
function crescent(x: number, y: number, r: number, ox: number, oy: number, r2: number): string {
  const d = Math.hypot(ox, oy);
  const a = (r * r - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(r * r - a * a);
  const mx = x + (a * ox) / d;
  const my = y + (a * oy) / d;
  const p = `${r1(mx + (h * oy) / d)} ${r1(my - (h * ox) / d)}`;
  const q = `${r1(mx - (h * oy) / d)} ${r1(my + (h * ox) / d)}`;
  return `M${p}A${r} ${r} 0 1 0 ${q}A${r2} ${r2} 0 0 1 ${p}Z`;
}
/** A windmill sail: an arm from the hub and a lattice panel along its trailing side. */
function sail(cx: number, cy: number, deg: number): [string, string] {
  const t = (deg * Math.PI) / 180;
  const [ux, uy, nx, ny] = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t)];
  const at = (l: number, w: number) => `${r1(cx + ux * l + nx * w)} ${r1(cy + uy * l + ny * w)}`;
  return [`M${cx} ${cy}L${at(36, 0)}`, `M${at(9, 0)}L${at(35, 0)}L${at(35, 7)}L${at(9, 5)}Z`];
}

export type Shape = readonly [colour: string, d: string, stroke?: number, opacity?: number];

export interface Picture {
  /** What the picture shows, for the preview and tests. */
  name: string;
  shapes: readonly Shape[];
}

const SUN = (x: number, y: number, r: number): Shape[] => [
  ['halo', circ(x, y, r * 1.8), 0, 0.35],
  ['halo', circ(x, y, r * 1.4), 0, 0.6],
  ['sun', circ(x, y, r)],
];

const blades = [45, 135, 225, 315].map((deg) => sail(54, 54, deg));

export const PICTURES: readonly Picture[] = [
  {
    name: 'Холм с деревом',
    shapes: [
      ['@sky', box(0, 0, 108, 144)],
      ...SUN(84, 24, 11),
      ['cloud', cloud(22, 40) + cloud(60, 62, 0.7)],
      ['meadow', 'M0 92Q40 62 78 86T108 78V144H0Z'],
      ['leaf', circ(86, 82, 4.5) + circ(93, 80, 5.5)],
      ['grass', hill(112, 56, 94, 120)],
      ['trunk', box(29, 90, 4, 16)],
      ['leaf', circ(31, 85, 10.5)],
      ['grass', circ(27, 81, 3.5), 0, 0.7],
      ['pink', all([[58, 126], [74, 133], [92, 125], [16, 134]], ([x, y]) => circ(x!, y!, 1.9))],
      ['snow', all([[66, 121], [84, 137], [40, 129], [100, 132]], ([x, y]) => circ(x!, y!, 1.6))],
    ],
  },
  {
    name: 'Море с парусником',
    shapes: [
      ['@dusk', box(0, 0, 108, 90)],
      ['halo', circ(28, 86, 22), 0, 0.4],
      ['sun', circ(28, 86, 12.5)],
      ['cloud', cloud(70, 26, 0.8) + cloud(26, 46, 0.6), 0, 0.9],
      ['ink', 'M76 50q3-3 6 0q3-3 6 0M86 40q2-2 4 0q2-2 4 0', 1.1, 0.7],
      ['sea', box(0, 86, 108, 58)],
      ['halo', 'M14 92h28M18 98h20M22 104h12', 1.6, 0.7],
      ['foam', 'M8 124q5-3 10 0M30 136q5-3 10 0M70 132q5-3 10 0M88 120q5-3 10 0', 1.4],
      ['trunk', 'M72 101V37', 1.8],
      ['skill', 'M74 39Q90 62 98 97H74Z'],
      ['skill-light', 'M70 46V97H50Q62 74 70 46Z'],
      ['red', 'M72 36l9 3-9 3z'],
      ['plank', 'M46 98H102L94 111H54Z'],
      ['cream', 'M50 102H98', 1.2, 0.8],
      ['sea', 'M44 110q7 3 14 0t14 0 14 0 14 0 14 0v6H44z'],
    ],
  },
  {
    name: 'Снежные горы',
    shapes: [
      ['@sky', box(0, 0, 108, 144)],
      ...SUN(22, 22, 8),
      ['cloud', cloud(82, 30, 0.8)],
      ['mount', 'M0 84L20 58L34 72L58 36L80 66L94 52L108 64V144H0Z'],
      ['snow', 'M58 36L50 47l4-1 4 4 4-4 5 2ZM94 52l-5 6 3 0 2 2 3-3 3 1Z'],
      ['rock', 'M-4 144L48 46L58 144Z'],
      ['slate', 'M48 46L110 144H58Z'],
      ['snow', 'M48 46L36 69l6-3 5 5 5-4 5 5 4-2Z'],
      ['snow', hill(126, 54, 110, 124)],
      ['leaf', pine(14, 134, 26, 9) + pine(27, 139, 18, 7) + pine(94, 138, 24, 8) + pine(82, 141, 15, 6)],
    ],
  },
  {
    name: 'Ночной город',
    shapes: [
      ['@night', box(0, 0, 108, 144)],
      ['moon', star(14, 16, 2.4) + star(46, 30, 1.8) + star(62, 10, 2) + star(28, 44, 1.5) + circ(34, 14, 0.9) + circ(8, 36, 0.8) + circ(56, 48, 0.8)],
      ['halo', circ(84, 26, 18), 0, 0.18],
      ['moon', crescent(84, 26, 11, 6, -4, 9)],
      ['city2', 'M0 144V86H8V74H20V90H28V60H33V50H38V60H44V92H52V76H66V94H74V66H86V88H96V72H108V144Z'],
      ['city2', 'M35.5 50V42', 1],
      ['city', 'M0 144V104H14V96H26V110H36V88H50V114H58V100H70V92H80V108H92V98H108V144Z'],
      [
        'sun',
        all(
          [[3, 108], [8, 114], [3, 120], [39, 92], [44, 98], [39, 104], [44, 110], [17, 100], [21, 106], [73, 96], [73, 102], [61, 104], [95, 102], [101, 108], [95, 114], [31, 66], [37, 72], [31, 78], [77, 70], [81, 76], [99, 78], [56, 82], [11, 80]],
          ([x, y]) => box(x!, y!, 2.6, 3),
        ),
      ],
    ],
  },
  {
    name: 'Маяк на скале',
    shapes: [
      ['@day', box(0, 0, 108, 144)],
      ['cloud', cloud(22, 22, 0.8) + cloud(94, 60, 0.6)],
      ['halo', 'M73 39L108 26V52ZM59 39L22 28V50Z', 0, 0.55],
      ['sea', waves(102, 6)],
      ['foam', 'M8 114q5-3 10 0M84 120q5-3 10 0M14 132q5-3 10 0', 1.4],
      ['rock', 'M32 144Q36 118 46 110Q58 100 74 104Q92 110 98 144Z'],
      ['slate', 'M74 104Q92 110 98 144H78Q82 122 74 104Z'],
      ['snow', 'M58 48H74L78 106H54Z'],
      ['skill', 'M57.2 60H74.8L75.7 72H56.3ZM55.5 84H76.5L77.3 96H54.7Z'],
      ['slate', box(55, 44, 22, 4)],
      ['sun', box(60, 34, 12, 10)],
      ['slate', 'M66 34V44', 1],
      ['red', 'M57 34L66 25L75 34Z'],
      ['plank', 'M63 106v-7a3 3 0 0 1 6 0v7z'],
      ['cloud', circ(34, 140, 4) + circ(40, 142, 3) + circ(96, 140, 4), 0, 0.9],
      ['ink', 'M24 70q3-3 6 0q3-3 6 0M36 80q2-2 4 0q2-2 4 0', 1.1, 0.7],
    ],
  },
  {
    name: 'Воздушный шар',
    shapes: [
      ['@day', box(0, 0, 108, 144)],
      ['cloud', cloud(88, 30, 0.8) + cloud(16, 70, 0.7)],
      ['meadow', hill(98, 50, 86, 96)],
      ['leaf', circ(18, 98, 4) + circ(25, 96, 5) + circ(92, 96, 4.5)],
      ['red', 'M72 106v-7l6-5 6 5v7z'],
      ['wheat', 'M0 112Q54 98 108 110V124Q54 112 0 128Z'],
      ['grass', 'M0 128Q54 112 108 124V144H0Z'],
      ['leaf', 'M10 140q20-8 40-10M58 138q22-6 44-6', 1, 0.35],
      ['skill', 'M54 12C38 12 30 24 30 37C30 51 42 58 49 67H59C66 58 78 51 78 37C78 24 70 12 54 12Z'],
      ['skill-light', 'M54 12C47 12 43 24 43 37C43 51 48 58 50.5 67H57.5C60 58 65 51 65 37C65 24 61 12 54 12Z'],
      ['skill-deep', 'M49 67H59L58 70H50Z'],
      ['ink', 'M50 70L51 77M58 70L57 77', 0.8],
      ['plank', 'M50 77h8v6a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 50 83z'],
    ],
  },
  {
    name: 'Зимний лес',
    shapes: [
      ['@sky', box(0, 0, 108, 144)],
      ['mount', pine(8, 92, 30, 9) + pine(26, 94, 22, 7) + pine(70, 92, 26, 8) + pine(86, 94, 20, 6)],
      ['snow', hill(100, 54, 86, 102)],
      ['frost', hill(126, 60, 114, 124)],
      ['leaf', pine(12, 116, 42, 13) + pine(97, 112, 38, 12) + pine(84, 120, 22, 8)],
      ['snow', 'M12 74l-4 6 4-2 4 2zM97 74l-4 6 4-2 4 2z'],
      ['frost', circ(53, 119, 14) + circ(52.5, 96.5, 10.2) + circ(52, 80.5, 7.2)],
      ['snow', circ(51, 118, 13.5) + circ(51, 96, 10) + circ(51, 80, 7)],
      ['ink', circ(48.5, 78, 1) + circ(53.5, 78, 1) + circ(51, 93, 1.1) + circ(51, 99, 1.1) + circ(51, 112, 1.2)],
      ['orange', 'M51 80.5l7 1.5-7 1.5z'],
      ['red', 'M44 86.5h14v4h-14zM53 89h4v9h-4z'],
      ['ink', 'M44 73.5h14v1.8h-14zM47 73.5v-9h8v9z'],
      ['trunk', 'M42 94l-10-7M60 94l10-8M34 88.5l-3-4', 1.4],
      ['snow', all([[20, 14], [44, 30], [70, 12], [92, 38], [30, 56], [78, 58], [8, 40], [60, 44]], ([x, y]) => circ(x!, y!, 1.4)), 0, 0.9],
    ],
  },
  {
    name: 'Цветочная поляна',
    shapes: [
      ['@day', box(0, 0, 108, 144)],
      ...SUN(88, 20, 10),
      ['cloud', cloud(24, 28, 0.8)],
      ['meadow', hill(88, 54, 76, 90)],
      ['grass', hill(104, 54, 94, 106)],
      ['leaf', 'M14 144V116M28 144V110M44 144V124M64 144V112M80 144V118M96 144V108M36 144V132M88 144V130', 1.4],
      ['red', circ(28, 108, 5) + circ(80, 116, 5) + circ(36, 130, 3.6)],
      ['ink', circ(28, 108, 1.6) + circ(80, 116, 1.6) + circ(36, 130, 1.2)],
      ['snow', all([[14, 114], [64, 110], [96, 106], [88, 128]], ([x, y]) => all([0, 72, 144, 216, 288], (a) => circ(x! + 3.4 * Math.cos((a * Math.PI) / 180), y! + 3.4 * Math.sin((a * Math.PI) / 180), 2.3)))],
      ['sun', circ(14, 114, 2) + circ(64, 110, 2) + circ(96, 106, 2) + circ(88, 128, 2)],
      ['pink', 'M40 124q0-7 4-9q4 2 4 9q-4 3-8 0zM4 128q0-6 3.5-8q3.5 2 3.5 8q-3.5 3-7 0z'],
      ['skill', 'M54 54C50 41 34 37 34 48C34 55 45 58 54 54ZM54 54C58 41 74 37 74 48C74 55 63 58 54 54Z'],
      ['skill-light', 'M54 54C47 58 40 67 45 70C50 72 54 63 54 54ZM54 54C61 58 68 67 63 70C58 72 54 63 54 54Z'],
      ['snow', circ(42, 47, 2.2) + circ(66, 47, 2.2), 0, 0.85],
      ['ink', 'M54 46V64', 2.2],
      ['ink', 'M54 47Q52 41 48 39M54 47Q56 41 60 39', 0.8],
    ],
  },
  {
    name: 'Подводный мир',
    shapes: [
      ['@water', box(0, 0, 108, 144)],
      ['cloud', 'M18 0H30L10 100H4ZM52 0H62L52 90H46ZM84 0H92L92 76H86Z', 0, 0.14],
      ['sand', hill(124, 54, 108, 126)],
      ['leaf', 'M14 126C6 112 20 100 12 84C22 98 10 110 20 126ZM24 128C22 114 30 106 26 94C34 104 28 116 31 128Z'],
      ['grass', 'M92 126C86 112 98 104 92 90C102 102 94 114 99 126Z'],
      ['pink', 'M70 126V112M70 117L64 108M70 114L76 106M64 108V103M76 106V101', 3],
      ['orange', 'M46 124l1.8 3.6 4 .3-3 2.6 1 3.9-3.8-2.1-3.8 2.1 1-3.9-3-2.6 4-.3z'],
      ['rock', 'M78 144Q80 130 94 129T108 134V144Z'],
      ['orange', ell(38, 56, 12, 7.5) + 'M48 56L58 48V64Z'],
      ['snow', 'M33 49.5Q31.5 56 33 62.5M42 49Q40.5 56 42 63', 2.2],
      ['ink', circ(30, 54, 1.4)],
      ['sun', ell(74, 88, 8, 5) + 'M67 88L60 82V94Z'],
      ['ink', circ(79, 87, 1)],
      ['pink', ell(84, 34, 5.5, 3.2) + 'M89 34L94 30.5V37.5Z'],
      ['cloud', circ(22, 40, 2) + circ(25, 32, 1.4) + circ(22, 25, 1) + circ(62, 76, 1.6) + circ(64, 68, 1.1), 0.8, 0.85],
    ],
  },
  {
    name: 'Космос',
    shapes: [
      ['@space', box(0, 0, 108, 144)],
      ['moon', star(12, 14, 2.2) + star(40, 18, 1.4) + star(96, 100, 2) + star(16, 72, 1.6) + star(60, 128, 1.6) + star(100, 136, 1.4) + star(100, 14, 1.4)],
      ['moon', circ(30, 58, 0.8) + circ(88, 118, 0.8) + circ(50, 96, 0.7) + circ(74, 10, 0.8) + circ(6, 110, 0.8) + circ(80, 88, 0.7)],
      ['rock', circ(20, 38, 6)],
      ['slate', circ(18, 36, 1.4) + circ(22.5, 41, 1)],
      ['wheat', 'M38.1 64A31 8 -15 0 1 97.9 48', 2.4],
      ['skill', circ(68, 56, 20)],
      ['skill-light', 'M49 50Q68 44 87 50Q68 47 49 55Z', 0, 0.8],
      ['skill-deep', crescent(68, 56, 20, -6, -6, 20), 0, 0.55],
      ['wheat', 'M38.1 64A31 8 -15 0 0 97.9 48', 2.4],
      ['cloud', circ(26, 131, 6) + circ(18, 135, 5) + circ(34, 135, 5), 0, 0.75],
      ['orange', 'M21.5 116Q26 134 30.5 116Z'],
      ['sun', 'M23.5 116Q26 126 28.5 116Z'],
      ['red', 'M21 100L14 116L21.5 113ZM31 100L38 116L30.5 113Z'],
      ['snow', 'M26 82C20 90 20 104 21 116H31C32 104 32 90 26 82Z'],
      ['red', 'M26 82C23.4 85 22.4 88 21.9 90.5H30.1C29.6 88 28.6 85 26 82Z'],
      ['slate', circ(26, 100, 3.8)],
      ['sea', circ(26, 100, 2.6)],
    ],
  },
  {
    name: 'Домик у озера',
    shapes: [
      ['@day', box(0, 0, 108, 144)],
      ['cloud', cloud(80, 22, 0.8)],
      ['mount', 'M0 70L24 44L44 64L66 38L90 60L108 48V144H0Z'],
      ['snow', 'M66 38l-6 7 3-1 3 3 3-3 4 1zM24 44l-5 6 3-1 2 2 3-2 3 1z'],
      ['meadow', hill(84, 54, 72, 82)],
      ['leaf', pine(10, 92, 22, 6) + pine(20, 94, 16, 5) + pine(92, 90, 24, 7) + pine(102, 92, 16, 5)],
      ['@water', 'M0 96Q54 90 108 96V124Q54 130 0 124Z'],
      ['skill-light', 'M12 104h16M58 110h22M32 116h14', 1.2, 0.9],
      ['slate', box(56, 64, 4, 8)],
      ['plank', box(40, 78, 22, 16)],
      ['red', 'M36 79L51 66L66 79Z'],
      ['trunk', box(48, 84, 6, 10)],
      ['sun', box(42, 82, 4.5, 4.5) + box(56, 82, 4.5, 4.5)],
      ['cloud', circ(60, 58, 2.6) + circ(64, 52, 3.2) + circ(70, 46, 3.8), 0, 0.8],
      ['red', 'M74 106h18l-3 4h-12z'],
      ['grass', 'M0 124Q54 132 108 122V144H0Z'],
      ['leaf', 'M10 132v-10M13 132v-13M16 132v-9M94 134v-12M97 134v-9', 1.2],
    ],
  },
  {
    name: 'Водопад',
    shapes: [
      ['@day', box(0, 0, 108, 144)],
      ['cloud', cloud(86, 14, 0.7)],
      ['rock', 'M0 32Q16 26 38 30V120H0ZM70 26Q90 22 108 30V120H70Z'],
      ['slate', 'M28 30Q34 29 38 30V120H28ZM70 26Q74 25.5 78 25.8V120H70Z', 0, 0.7],
      ['slate', 'M6 52h14M10 74h18M84 60h16M78 86h20', 1.2, 0.6],
      ['meadow', 'M0 32Q16 26 38 30V36Q16 32 0 38ZM70 26Q90 22 108 30V36Q90 28 70 32Z'],
      ['leaf', circ(9, 24, 6) + circ(19, 22, 7) + circ(97, 20, 6) + circ(87, 22, 5)],
      ['skill', 'M36 30Q54 25 72 27V116H36Z'],
      ['skill-light', 'M43 34V110M52 31V104M61 31V112M68 30V96', 1.8, 0.85],
      ['@water', 'M0 112Q54 102 108 112V144H0Z'],
      ['cloud', circ(40, 112, 6) + circ(50, 110, 7) + circ(60, 111, 7) + circ(70, 113, 6) + ell(54, 116, 22, 4)],
      ['skill-light', 'M12 126h14M80 130h16M40 134h24', 1.2],
      ['leaf', circ(4, 118, 8) + circ(14, 121, 6) + circ(104, 118, 8) + circ(94, 121, 5)],
    ],
  },
  {
    name: 'Осенний парк',
    shapes: [
      ['@sky', box(0, 0, 108, 144)],
      ['cloud', cloud(80, 22, 0.8)],
      ['wheat', hill(96, 54, 86, 96)],
      ['sand', 'M42 144Q56 118 62 96H68Q70 118 86 144Z'],
      ['trunk', box(55, 82, 2, 12) + box(15, 68, 5, 34) + box(89, 74, 4, 26)],
      ['sun', circ(56, 78, 7.5)],
      ['orange', circ(17, 58, 15) + circ(29, 68, 9)],
      ['sun', circ(11, 52, 4) + circ(22, 64, 3), 0, 0.8],
      ['red', circ(91, 64, 12.5)],
      ['orange', circ(87, 60, 3.5), 0, 0.8],
      ['trunk', 'M16 120v10M42 120v10M16 104v16M42 104v16', 1.6],
      ['plank', box(14, 104, 30, 3) + box(14, 109, 30, 3) + box(13, 116, 32, 3.5)],
      ['ink', 'M96 134V102', 1.6],
      ['halo', circ(96, 100, 7), 0, 0.5],
      ['sun', circ(96, 100, 3.5)],
      ['orange', ell(30, 40, 2, 1.2) + ell(70, 50, 2, 1.2) + ell(50, 30, 2, 1.2) + ell(24, 136, 2.4, 1.3) + ell(74, 132, 2.4, 1.3)],
      ['red', ell(62, 124, 2.4, 1.3) + ell(8, 128, 2.4, 1.3) + ell(80, 40, 2, 1.2) + ell(100, 124, 2.4, 1.3)],
    ],
  },
  {
    name: 'Кит в океане',
    shapes: [
      ['@day', box(0, 0, 108, 144)],
      ...SUN(88, 18, 8),
      ['cloud', cloud(22, 22, 0.8) + cloud(66, 36, 0.55)],
      ['@water', waves(68, 6, 2)],
      ['cloud', 'M40 62q-2-8-8-11M40 62V48M40 62q2-8 8-11', 1.8],
      ['cloud', circ(31, 49, 1.7) + circ(49, 49, 1.7) + circ(40, 45, 1.9)],
      ['whale', 'M20 88C20 72 34 64 52 66C66 68 74 74 82 72L90 60C96 58 100 64 94 72C101 71 104 78 96 80L86 80C80 92 64 98 46 98C30 98 20 96 20 88Z'],
      ['belly', 'M21 90C30 96 46 97 58 95C66 94 72 91 76 88C60 92 38 94 21 90Z'],
      ['ink', circ(33, 82, 1.7)],
      ['ink', 'M22 88q6 3 12 2', 1],
      ['skill', 'M0 94q6 3 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0V144H0Z', 0, 0.9],
      ['skill-light', 'M10 108q5-3 10 0M62 116q5-3 10 0M28 130q5-3 10 0M84 132q5-3 10 0', 1.4],
    ],
  },
  {
    name: 'Вулкан',
    shapes: [
      ['@sky', box(0, 0, 108, 144)],
      ['smoke', circ(54, 34, 10) + circ(66, 24, 9) + circ(44, 22, 8) + circ(78, 14, 8) + circ(58, 10, 7) + circ(90, 8, 6)],
      ['meadow', hill(118, 54, 108, 118)],
      ['slate', 'M2 136L42 58H66L106 136Z'],
      ['rock', 'M2 136L42 58H51L36 136Z'],
      ['orange', 'M42 58H66L63 63L60 78L57 72L54 90L51 76L48 84L46 64Z'],
      ['sun', 'M45 58H63L61 62H47Z'],
      ['orange', circ(40, 44, 2) + circ(70, 42, 2.2) + circ(56, 46, 1.8) + circ(32, 52, 1.4)],
      ['grass', hill(132, 54, 124, 134)],
      ['trunk', 'M92 140Q89 124 94 112', 2.2],
      ['leaf', 'M94 112q-11-3-16 4q9-6 16-4zM94 112q11-3 16 4q-9-6-16-4zM94 112q-4-9-13-9q9 3 13 9zM94 112q4-9 13-9q-9 3-13 9z', 0.9],
    ],
  },
  {
    name: 'Ветряная мельница',
    shapes: [
      ['@sky', box(0, 0, 108, 144)],
      ['cloud', cloud(18, 24, 0.8) + cloud(92, 76, 0.6)],
      ['meadow', hill(100, 54, 90, 100)],
      ['red', 'M0 112Q54 102 108 112V118Q54 108 0 118Z'],
      ['sun', 'M0 124Q54 114 108 124V130Q54 120 0 130Z'],
      ['pink', 'M0 136Q54 126 108 136V142Q54 132 0 142Z'],
      ['cream', 'M46 58H62L68 110H40Z'],
      ['trunk', 'M43 60Q54 42 65 60Z'],
      ['trunk', 'M50 110v-9a4 4 0 0 1 8 0v9z'],
      ['sea', circ(54, 76, 3)],
      ['cream', blades.map((b) => b[1]).join(''), 0, 0.95],
      ['trunk', blades.map((b) => b[0]).join('') + blades.map((b) => b[1]).join(''), 1],
      ['slate', circ(54, 54, 2.6)],
    ],
  },
  {
    name: 'Северное сияние',
    shapes: [
      ['@polar', box(0, 0, 108, 144)],
      ['moon', star(14, 14, 2) + star(92, 84, 1.6) + star(50, 8, 1.4) + star(100, 20, 1.4) + circ(30, 30, 0.8) + circ(76, 12, 0.8) + circ(8, 84, 0.8) + circ(64, 90, 0.7) + circ(40, 94, 0.7)],
      ['@aurora', 'M-2 26H110V62C90 70 74 64 54 72C34 80 18 70 -2 74Z', 0, 0.7],
      ['@aurora', 'M-2 6H110V50C94 44 80 44 60 54C40 64 20 68 -2 58Z'],
      ['skill-light', 'M8 60V38M18 63V44M30 63V40M42 60V42M54 55V34M66 51V30M78 47V28M90 46V26M100 48V30', 1.3, 0.55],
      ['skill-light', 'M-2 58C20 68 40 64 60 54C80 44 94 44 110 50', 1.3],
      ['mount', 'M0 110Q30 98 60 108T108 104V144H0Z'],
      ['frost', hill(126, 54, 116, 128)],
      ['city', pine(12, 124, 40, 11) + pine(27, 128, 26, 8) + pine(90, 122, 42, 12) + pine(101, 128, 24, 7) + pine(76, 128, 18, 6)],
      ['sun', box(52, 118, 2.4, 2.6), 0, 0.9],
    ],
  },
  {
    name: 'Кот на подоконнике',
    shapes: [
      ['cream', box(0, 0, 108, 144)],
      ['@day', box(18, 12, 72, 84)],
      ['cloud', cloud(34, 30, 0.7)],
      ...SUN(76, 28, 6),
      ['meadow', 'M18 82Q38 72 58 78T90 74V96H18Z'],
      ['plank', 'M18 12H90V96H18ZM54 12V96M18 54H90', 2.6],
      ['trunk', 'M4 7H104', 2.2],
      ['skill', 'M6 8H28Q23 52 30 97H6ZM102 8H80Q85 52 78 97H102Z'],
      ['skill-deep', 'M13 10Q11 52 14 96M21 10Q19 52 23 96M95 10Q97 52 94 96M87 10Q89 52 85 96', 1, 0.4],
      ['plank', box(2, 96, 104, 8)],
      ['trunk', box(2, 104, 104, 2.5), 0, 0.6],
      ['red', 'M82 96L80 85H94L92 96Z'],
      ['leaf', 'M87 85Q78 77 80 67Q88 75 87 85ZM87 85Q96 77 95 68Q87 75 87 85ZM87 85Q84 72 88 63Q91 72 87 85Z'],
      ['orange', 'M65 94Q74 100 71 112Q68 122 73 130', 3.6],
      ['orange', circ(54, 58, 9) + 'M45.5 57L46.5 42.5L55 51ZM62.5 57L61.5 42.5L53 51ZM54 63C42 63 37 82 39 96H69C71 82 66 63 54 63Z'],
      ['pink', 'M47.6 53L48 46.5L52.3 50.6ZM60.4 53L60 46.5L55.7 50.6Z'],
      ['trunk', 'M54 49.5v4.5M44.5 76q9.5 3 19 0M42.5 85q11.5 3 23 0M68.5 114l4.5-1M68.5 122l4.5 1', 1.4, 0.45],
    ],
  },
  {
    name: 'Пустыня',
    shapes: [
      ['@sky', box(0, 0, 108, 144)],
      ...SUN(80, 28, 12),
      ['dune', 'M8 92L26 70L44 92ZM38 92L50 77L62 92Z'],
      ['camel', 'M26 70L44 92H32ZM50 77L62 92H53Z', 0, 0.6],
      ['sand', 'M0 90Q30 82 60 90T108 86V144H0Z'],
      ['dune', hill(116, 54, 98, 120)],
      ['sand', 'M0 116Q54 98 108 120', 1.2, 0.7],
      ['camel', 'M38 106V123M44 107V124M60 107V124M66 106V123M34 100q-3 3-2 8', 3],
      ['camel', 'M34 102C34 96 40 94 46 94H62C68 94 71 98 71 102C71 106 67 109 60 109H42C37 109 34 106 34 102ZM39 96C39 83 50 83 50 95ZM52 95C52 83 63 83 63 96Z'],
      ['camel', 'M65 100C73 105 77 98 77 88', 5],
      ['camel', ell(80.5, 86.5, 6, 3.6)],
      ['ink', circ(80.5, 85.3, 0.9)],
      ['leaf', 'M96 130V106M96 118H90V112M96 114H101V108', 4.4],
    ],
  },
  {
    name: 'Радуга над деревней',
    shapes: [
      ['@day', box(0, 0, 108, 144)],
      ...(['red', 'orange', 'sun', 'grass', 'sea', 'violet'] as const).map((c, i): Shape => {
        const r = 64 - 5 * i;
        return [c, `M${54 - r} 110A${r} ${r} 0 0 1 ${54 + r} 110`, 5.2, 0.9];
      }),
      ['cloud', cloud(8, 98, 0.9) + cloud(102, 98, 0.9)],
      ['meadow', hill(100, 54, 90, 100)],
      ['grass', hill(120, 54, 112, 124)],
      ['leaf', circ(10, 110, 5) + circ(98, 110, 5) + circ(69, 106, 4)],
      ['cream', box(22, 100, 16, 12) + box(44, 96, 18, 16) + box(76, 102, 14, 11)],
      ['skill', 'M20 101L30 91L40 101ZM42 97L53 86L64 97ZM74 103L83 94L92 103Z'],
      ['sun', box(25, 104, 4, 4) + box(48, 100, 4, 4) + box(55, 100, 4, 4) + box(79, 106, 4, 4)],
      ['trunk', box(32, 105, 4, 7) + box(51, 105, 4, 7) + box(85, 107, 3, 6)],
    ],
  },
];

export const PICTURE_COUNT = PICTURES.length;

/** A level number as the theme uses it: whole and ≥ 1; omitted or invalid → 1. */
export const levelNumber = (level?: number): number => (level !== undefined && Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1);

/** Index in PICTURES of level `level` (1-based): the twenty cycle, level 21 is picture 1 again. */
export const pictureIndex = (level?: number): number => (levelNumber(level) - 1) % PICTURE_COUNT;

const paint = (c: string, p: string, stroke?: number, opacity?: number): CSSProperties => {
  const colour = c[0] === '@' ? `url(#${p}-${c.slice(1)})` : `var(--pz-${c})`;
  return stroke
    ? { fill: 'none', stroke: colour, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', opacity }
    : { fill: colour, opacity };
};

/** The shapes of picture `index` in local coordinates; `p` prefixes the gradient ids. */
export function PictureArt({ index, p }: { index: number; p: string }) {
  return (
    <>
      {PICTURES[index]!.shapes.map(([c, d, stroke, opacity], i) => (
        <path key={i} d={d} style={paint(c, p, stroke, opacity)} />
      ))}
    </>
  );
}

// Gradients the pictures share, in the pictures' own units so neighbouring shapes match.
const GRADIENTS: [name: string, y1: number, y2: number, stops: (string | [string, number])[]][] = [
  ['sky', 0, 130, ['var(--liquid-mid)', 'var(--liquid-light)']],
  ['water', 30, 144, ['var(--liquid-light)', 'var(--liquid-mid)', 'var(--liquid-deep)']],
  ['day', 0, 110, ['var(--pz-day-top)', 'var(--pz-day-bottom)']],
  ['dusk', 0, 90, ['var(--pz-dusk-top)', 'var(--pz-dusk-bottom)']],
  ['night', 0, 144, ['var(--pz-night-top)', 'var(--pz-night-bottom)']],
  ['space', 0, 144, ['var(--pz-space-top)', 'var(--pz-space-bottom)']],
  ['polar', 0, 144, ['var(--pz-polar-top)', 'var(--pz-polar-bottom)']],
  // Curtains of light: clear at the top, bright at their lower edge.
  ['aurora', 8, 78, [['var(--liquid-light)', 0], ['var(--liquid-light)', 0.95], 'var(--liquid-mid)']],
];

export const GRADIENT_NAMES = GRADIENTS.map(([name]) => name);

/** The shared gradients, once per SVG, ids `${p}-<name>`. */
export function PictureDefs({ p }: { p: string }) {
  return (
    <>
      {GRADIENTS.map(([name, y1, y2, stops]) => (
        <linearGradient key={name} id={`${p}-${name}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={y1} y2={y2}>
          {stops.map((stop, i) => {
            const [colour, opacity] = typeof stop === 'string' ? [stop] : stop;
            return <stop key={i} offset={i / (stops.length - 1)} style={{ stopColor: colour, stopOpacity: opacity }} />;
          })}
        </linearGradient>
      ))}
    </>
  );
}
