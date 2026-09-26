// The share card as a PNG (v0.5 package 19): 1080 × 1350 drawn on a canvas in the client.
//
// - The picture is the skill's own progress theme at its level and fill: the theme's hero,
//   rendered off screen by the share sheet (ShareSheet.tsx), serialized with its computed
//   styles inlined (svgInline.ts) and drawn through an <img> from a blob URL. When that fails —
//   an exception, a tainted canvas, or no picture within ART_TIMEOUT_MS — the flask is drawn
//   with canvas paths instead, so a card is always produced (artOrFlask).
// - The texts (cardLayout.ts) are drawn with canvas text in the system font stack, which has
//   Cyrillic on every phone; the fonts are awaited first (document.fonts.ready).
// - Two card styles follow the app's appearance: light and dark surfaces of the app's own
//   palette (never a Telegram theme's colours: the picture is seen outside it), the skill
//   colour as the accent.

import { logError } from '../../platform/errorLog';
import { STROKE } from '../components/Icon';
import { fitLines, wrapLines, type CardModel, type Measure } from './cardLayout';
import { inlineSvg } from './svgInline';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
/** How long the theme's picture may take before the flask is drawn instead. */
export const ART_TIMEOUT_MS = 2000;

const PAD = 88;
/** The hero's box is 160 × 260 (progress/README.md, rule 1). */
const ART_W = 336;
const ART_H = 546;
const COL_X = PAD + ART_W + 64;
const COL_W = CARD_WIDTH - PAD - COL_X;
const TILE_H = 210;
const TILE_GAP = 24;
const FOOTER_Y = CARD_HEIGHT - 96;

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Roboto, "Segoe UI", "Noto Sans", "Helvetica Neue", Arial, sans-serif';

export type CardStyle = 'light' | 'dark';

/** The surfaces of a card style: the app's own light and dark palette (tokens.css). */
export const CARD_SURFACES: Record<CardStyle, { background: string; surface: string; sunken: string; fg: string; secondary: string; tertiary: string; border: string; track: string }> = {
  light: {
    background: '#f4f4f8',
    surface: '#ffffff',
    sunken: '#ececf1',
    fg: '#1c1c1e',
    secondary: '#5c5c61',
    tertiary: '#6b6b70',
    border: 'rgba(60, 60, 67, 0.14)',
    track: 'rgba(28, 28, 30, 0.09)',
  },
  dark: {
    background: '#0e0e11',
    surface: '#1c1c1e',
    sunken: '#2a2a2d',
    fg: '#ffffff',
    secondary: '#b0b0b6',
    tertiary: '#9a9aa0',
    border: 'rgba(84, 84, 88, 0.6)',
    track: 'rgba(255, 255, 255, 0.13)',
  },
};

/**
 * The design tokens of a card style, set on the off-screen stage the hero renders in, so the
 * theme's outlines and surfaces match the card they are drawn on.
 */
export function stageTokens(style: CardStyle): Record<string, string> {
  const s = CARD_SURFACES[style];
  return {
    '--color-bg': s.background,
    '--color-bg-elevated': s.surface,
    '--color-bg-sunken': s.sunken,
    '--color-fg': s.fg,
    '--color-fg-secondary': s.secondary,
    '--color-fg-tertiary': s.tertiary,
    '--color-border': s.border,
  };
}

export interface CardPalette {
  style: CardStyle;
  /** The skill colour (resolved --liquid-*). */
  liquidLight: string;
  liquidMid: string;
  liquidDeep: string;
  gold: string;
}

/** The skill colour as the stage resolves it (the scope's --liquid-*), with the app's cyan where a value does not resolve. */
export function cardPalette(stage: HTMLElement, style: CardStyle): CardPalette {
  const probe = document.createElement('span');
  stage.append(probe);
  const check = document.createElement('canvas').getContext('2d');
  // A colour the canvas cannot parse (an engine without oklch()) would throw in a gradient.
  const drawable = (value: string, fallback: string) => {
    if (!check || !value) return fallback;
    check.fillStyle = '#010203';
    check.fillStyle = value;
    return check.fillStyle === '#010203' ? fallback : value;
  };
  const read = (value: string, fallback: string) => {
    probe.style.color = fallback;
    probe.style.color = value;
    return drawable(getComputedStyle(probe).color, fallback);
  };
  try {
    return {
      style,
      liquidLight: read('var(--liquid-light)', '#8fd3ff'),
      liquidMid: read('var(--liquid-mid)', '#4fb8ec'),
      liquidDeep: read('var(--liquid-deep)', '#2a8fcf'),
      gold: style === 'dark' ? '#f6cf5f' : '#b57712',
    };
  } finally {
    probe.remove();
  }
}

// ---- The picture ----

/** Rejects after `ms` unless `work` settles first. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The theme's picture, or the flask when it cannot be had: `theme` throws or rejects (a
 * tainted canvas throws SecurityError), or takes longer than `timeoutMs`. The failure is logged.
 */
export async function artOrFlask<T>(theme: () => Promise<T>, flask: () => T, timeoutMs = ART_TIMEOUT_MS): Promise<{ art: T; fallback: boolean }> {
  try {
    return { art: await withTimeout(Promise.resolve().then(theme), timeoutMs), fallback: false };
  } catch (error) {
    logError(error, 'share card art');
    return { art: flask(), fallback: true };
  }
}

function canvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  return { canvas: el, ctx };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The picture did not load as an image'));
    img.src = url;
  });
}

/** An SVG document drawn on a canvas of its own; throws where the canvas turns tainted. */
export async function rasterizeSvg(markup: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const { canvas: out, ctx } = canvas(width, height);
    ctx.drawImage(img, 0, 0, width, height);
    // A tainted canvas refuses to be read (SecurityError): the card could not be exported.
    ctx.getImageData(0, 0, 1, 1);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits (frame by frame) until the stage shows the theme's drawing, no longer than the art may take. */
async function stageSvg(stage: HTMLElement): Promise<SVGSVGElement> {
  const until = Date.now() + ART_TIMEOUT_MS;
  for (;;) {
    const svg = stage.querySelector('svg');
    if (svg) return svg;
    if (Date.now() > until) throw new Error('The theme did not draw on the stage');
    await frame();
  }
}

/**
 * The theme's hero as the stage draws it, at the card's size: finite animations (a crossfade
 * of the first render) are finished first, idle ones are caught where they are.
 */
export async function themeArt(stage: HTMLElement): Promise<HTMLCanvasElement> {
  const svg = await stageSvg(stage);
  await frame();
  await frame();
  for (const animation of stage.getAnimations?.({ subtree: true }) ?? []) {
    try {
      if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
    } catch {
      // An animation that cannot finish stays where it is.
    }
  }
  return rasterizeSvg(inlineSvg(svg, { width: ART_W, height: ART_H }), ART_W, ART_H);
}

// Geometry of the flask theme (themes/flask.tsx), viewBox 0 0 160 260.
const GLASS = 'M40 30 V186 A40 40 0 0 0 120 186 V30 Z';
const INNER = 'M45 30 V186 A35 35 0 0 0 115 186 V30 Z';

/** The flask drawn with canvas paths: the picture that is always there. */
export function flaskArt(model: CardModel, palette: CardPalette): HTMLCanvasElement {
  const { canvas: out, ctx } = canvas(ART_W, ART_H);
  const s = CARD_SURFACES[palette.style];
  const complete = model.hero.state === 'complete';
  const fill = complete ? 1 : model.hero.state === 'empty' ? 0 : Math.min(1, Math.max(0, model.hero.fill));
  ctx.scale(ART_W / 160, ART_H / 260);
  const glass = new Path2D(GLASS);
  ctx.fillStyle = s.surface;
  ctx.fill(glass);
  if (fill > 0) {
    ctx.save();
    ctx.clip(new Path2D(INNER));
    const top = 226 - fill * 192;
    const gradient = ctx.createLinearGradient(0, top, 0, 226);
    gradient.addColorStop(0, complete ? '#f6cf5f' : palette.liquidLight);
    gradient.addColorStop(1, complete ? '#b57712' : palette.liquidDeep);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, top, 160, 260 - top);
    ctx.restore();
  }
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = s.fg;
  ctx.lineWidth = 3;
  ctx.stroke(glass);
  ctx.globalAlpha = 1;
  roundRect(ctx, 26, 16, 108, 16, 8);
  ctx.fillStyle = s.surface;
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.stroke();
  ctx.globalAlpha = 1;
  return out;
}

// ---- The card ----

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

type Weight = 500 | 600 | 700 | 800;

function font(ctx: CanvasRenderingContext2D, size: number, weight: Weight, spacing = 0): Measure {
  ctx.font = `${weight} ${size}px ${FONT}`;
  // letterSpacing is recent (Chrome 99, Safari 18): elsewhere the eyebrow is simply tighter.
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  return (text) => ctx.measureText(text).width;
}

/** Ascent and descent of a line of Cyrillic text at `size` (Й's breve, у's tail). */
const ascent = (size: number) => size * 0.95;
const descent = (size: number) => size * 0.28;
/** Digits have neither accents nor tails. */
const digitAscent = (size: number) => size * 0.74;

/** Draws the card; `art` is the theme's picture or the flask, ART_W × ART_H. */
export function drawCard(model: CardModel, art: CanvasImageSource, palette: CardPalette): HTMLCanvasElement {
  const { canvas: out, ctx } = canvas(CARD_WIDTH, CARD_HEIGHT);
  const s = CARD_SURFACES[palette.style];
  const dark = palette.style === 'dark';
  const accent = model.hero.state === 'complete' ? palette.gold : dark ? palette.liquidMid : palette.liquidDeep;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = s.background;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // The name: two lines at most, smaller before it is cut.
  let y = 96;
  const name = fitLines(model.name, CARD_WIDTH - 2 * PAD, 2, [76, 64, 56], (size) => font(ctx, size, 700));
  font(ctx, name.size, 700);
  ctx.fillStyle = s.fg;
  for (const line of name.lines) {
    y += ascent(name.size);
    ctx.fillText(line, PAD, y);
    y += descent(name.size);
  }
  if (model.status) {
    const measure = font(ctx, 34, 500);
    y += 14 + ascent(34);
    ctx.fillStyle = s.secondary;
    ctx.fillText(wrapLines(model.status, CARD_WIDTH - 2 * PAD, measure, 1)[0] ?? '', PAD, y);
    y += descent(34);
  }

  // The picture and the numbers, then the tiles, centred between the header and the footer.
  const contentH = ART_H + (model.tiles.length > 0 ? 40 + TILE_H : 0);
  const regionTop = y + 40;
  const regionBottom = FOOTER_Y - 64;
  const top = Math.max(regionTop, regionTop + (regionBottom - regionTop - contentH) / 2);
  const artX = PAD + 8;

  // A soft glow of the skill colour behind the picture, as behind the hero on screen.
  const glowColor = model.hero.state === 'complete' ? '#f6cf5f' : dark ? palette.liquidMid : palette.liquidLight;
  drawGlow(ctx, artX + ART_W / 2, top + ART_H / 2, 330, glowColor, dark ? 0.3 : 0.5);
  ctx.drawImage(art, artX, top, ART_W, ART_H);

  drawNumbers(ctx, model, top, accent, palette);
  if (model.tiles.length > 0) drawTiles(ctx, model, top + ART_H + 40, palette);
  drawFooter(ctx, model, palette, accent);
  return out;
}

/**
 * A radial glow of `color` fading to nothing: the colour fills a layer and a radial alpha mask
 * cuts it (a gradient from the colour to «transparent» would pass through grey).
 */
function drawGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string, alpha: number): void {
  const size = radius * 2;
  const { canvas: layer, ctx: g } = canvas(size, size);
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  mask.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
  mask.addColorStop(0.55, `rgba(0, 0, 0, ${alpha * 0.45})`);
  mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, size, size);
  ctx.drawImage(layer, cx - radius, cy - radius);
}

/** The column beside the picture: the level noun, the big number, the points, the milestone. */
function drawNumbers(ctx: CanvasRenderingContext2D, model: CardModel, artTop: number, accent: string, palette: CardPalette): void {
  const s = CARD_SURFACES[palette.style];
  // Laid out first, drawn at the height that centres it against the picture.
  const rows: { height: number; draw(y: number): void }[] = [];
  const gap = (height: number) => rows.push({ height, draw: () => {} });

  const eyebrow = model.eyebrow.toUpperCase();
  rows.push({
    height: ascent(30) + descent(30),
    draw: (y) => {
      const measure = font(ctx, 30, 600, 3);
      ctx.fillStyle = s.secondary;
      ctx.fillText(wrapLines(eyebrow, COL_W, measure, 1)[0] ?? '', COL_X, y + ascent(30));
    },
  });
  gap(18);
  // The number shrinks for a long one (a level past 999).
  const levelMeasure = font(ctx, 180, 800);
  const levelSize = levelMeasure(model.level) > COL_W ? Math.floor((180 * COL_W) / levelMeasure(model.level)) : 180;
  rows.push({
    height: digitAscent(levelSize),
    draw: (y) => {
      font(ctx, levelSize, 800);
      ctx.fillStyle = accent;
      ctx.fillText(model.level, COL_X - levelSize * 0.04, y + digitAscent(levelSize));
    },
  });
  gap(34);
  if (model.points) {
    const points = model.points;
    rows.push({
      height: digitAscent(56) + 6,
      draw: (y) => {
        const base = y + digitAscent(56);
        const value = font(ctx, 56, 700)(points.value);
        ctx.fillStyle = s.fg;
        ctx.fillText(points.value, COL_X, base);
        font(ctx, 40, 600);
        ctx.fillStyle = s.secondary;
        ctx.fillText(points.capacity, COL_X + value, base);
      },
    });
    gap(20);
  }
  const detail = wrapLines(model.detail, COL_W, font(ctx, 30, 500), 2);
  rows.push({
    height: detail.length * 38,
    draw: (y) => {
      font(ctx, 30, 500);
      ctx.fillStyle = s.secondary;
      detail.forEach((line, i) => ctx.fillText(line, COL_X, y + i * 38 + ascent(30)));
    },
  });
  gap(16);
  const total = wrapLines(model.total, COL_W, font(ctx, 32, 600), 1)[0] ?? '';
  rows.push({
    height: ascent(32) + descent(32),
    draw: (y) => {
      font(ctx, 32, 600);
      ctx.fillStyle = s.fg;
      ctx.fillText(total, COL_X, y + ascent(32));
    },
  });
  if (model.milestone) {
    const milestone = model.milestone;
    const lines = wrapLines(milestone.text, COL_W, font(ctx, 28, 500), 2);
    gap(34);
    rows.push({
      height: lines.length * 36 + 18 + 14,
      draw: (y) => {
        font(ctx, 28, 500);
        ctx.fillStyle = s.secondary;
        lines.forEach((line, i) => ctx.fillText(line, COL_X, y + i * 36 + ascent(28)));
        const barY = y + lines.length * 36 + 18;
        roundRect(ctx, COL_X, barY, COL_W, 14, 7);
        ctx.fillStyle = s.track;
        ctx.fill();
        const share = Math.min(1, Math.max(0, milestone.share));
        if (share > 0) {
          roundRect(ctx, COL_X, barY, Math.max(14, COL_W * share), 14, 7);
          ctx.fillStyle = accent;
          ctx.fill();
        }
      },
    });
  }

  const height = rows.reduce((sum, row) => sum + row.height, 0);
  let y = artTop + Math.max(0, (ART_H - height) / 2);
  for (const row of rows) {
    row.draw(y);
    y += row.height;
  }
}

/** «12 дней подряд · лучшая серия», «18 активных дней · за последние 30 дней». */
function drawTiles(ctx: CanvasRenderingContext2D, model: CardModel, top: number, palette: CardPalette): void {
  const s = CARD_SURFACES[palette.style];
  const count = model.tiles.length;
  const width = (CARD_WIDTH - 2 * PAD - TILE_GAP * (count - 1)) / count;
  model.tiles.forEach((tile, i) => {
    const x = PAD + i * (width + TILE_GAP);
    ctx.save();
    if (palette.style === 'light') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.06)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
    }
    roundRect(ctx, x, top, width, TILE_H, 36);
    ctx.fillStyle = s.surface;
    ctx.fill();
    ctx.restore();
    const inner = width - 2 * 36;
    font(ctx, 72, 800);
    ctx.fillStyle = s.fg;
    ctx.fillText(tile.value, x + 36, top + 34 + digitAscent(72));
    const caption = wrapLines(tile.caption, inner, font(ctx, 30, 600), 1)[0] ?? '';
    ctx.fillStyle = s.fg;
    ctx.fillText(caption, x + 36, top + 34 + digitAscent(72) + 16 + ascent(30));
    const note = wrapLines(tile.note, inner, font(ctx, 28, 500), 1)[0] ?? '';
    ctx.fillStyle = s.secondary;
    ctx.fillText(note, x + 36, top + 34 + digitAscent(72) + 16 + ascent(30) + 40);
  });
}

/** The wordmark with the app's flask glyph, and the app's link. */
function drawFooter(ctx: CanvasRenderingContext2D, model: CardModel, palette: CardPalette, accent: string): void {
  const s = CARD_SURFACES[palette.style];
  const icon = 44;
  ctx.save();
  ctx.translate(PAD, FOOTER_Y - icon / 2 - 4);
  ctx.scale(icon / 24, icon / 24);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(STROKE.flask));
  ctx.restore();

  const brandX = PAD + icon + 14;
  const brandWidth = font(ctx, 40, 700)(model.brand);
  ctx.fillStyle = s.fg;
  ctx.fillText(model.brand, brandX, FOOTER_Y + 14);

  const space = CARD_WIDTH - PAD - (brandX + brandWidth + 32);
  const link = wrapLines(model.link, space, font(ctx, 32, 500), 1)[0] ?? '';
  ctx.fillStyle = s.secondary;
  ctx.textAlign = 'right';
  ctx.fillText(link, CARD_WIDTH - PAD, FOOTER_Y + 12);
  ctx.textAlign = 'left';
}

function toPng(el: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    el.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The card did not encode as PNG'))), 'image/png');
  });
}

/** Resolves when the page's fonts are ready, or after a second: a slow font never holds the card. */
async function fontsReady(): Promise<void> {
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (!fonts) return;
  await withTimeout(fonts.ready, 1000).catch(() => {});
}

/**
 * The card of `model` as a PNG: the theme's picture from the stage (the flask when it fails),
 * the texts, the style's surfaces. `fallback` tells that the flask stood in.
 */
export async function makeShareCard(model: CardModel, stage: HTMLElement, style: CardStyle): Promise<{ blob: Blob; fallback: boolean }> {
  await fontsReady();
  const palette = cardPalette(stage, style);
  const { art, fallback } = await artOrFlask<CanvasImageSource>(() => themeArt(stage), () => flaskArt(model, palette));
  return { blob: await toPng(drawCard(model, art, palette)), fallback };
}
