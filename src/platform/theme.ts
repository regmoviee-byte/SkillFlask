import { useSyncExternalStore } from 'react';
import { API, onTg, tgCall, webApp, type ColorScheme } from './telegram';

// Theme: inside Telegram `colorScheme` is trusted (a user may run a dark Telegram on a light
// system); outside, prefers-color-scheme decides. The liquid palette is derived from the
// accent by tokens.css, but an accent that is too dark, too light or grey is clamped to the
// signature cyan via data-liquid="fixed".

const LIGHT_BG = '#f2f2f7';
const DARK_BG = '#000000';

let current: ColorScheme = 'light';
const listeners = new Set<() => void>();
let unwatch: (() => void) | null = null;

function mediaQuery(): MediaQueryList | undefined {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
}

export function currentScheme(): ColorScheme {
  const tg = webApp();
  if (tg) return tg.colorScheme === 'dark' ? 'dark' : 'light';
  return mediaQuery()?.matches ? 'dark' : 'light';
}

/** Parses #rgb / #rrggbb / rgb(a) into 0..255 channels. */
export function parseColor(input: string): [number, number, number] | null {
  const value = input.trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** WCAG relative luminance, 0..1. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** HSL saturation, 0..1. */
export function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}

/** True when the accent cannot carry the liquid (too dark, too light or grey). */
export function needsFixedLiquid(accent: string): boolean {
  const rgb = parseColor(accent);
  if (!rgb) return false;
  const lum = relativeLuminance(rgb);
  return lum < 0.18 || lum > 0.82 || saturation(rgb) < 0.15;
}

function resolvedAccent(): string {
  const fromTg = webApp()?.themeParams?.button_color;
  if (fromTg) return fromTg;
  const css = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  if (css && !css.includes('var(')) return css;
  return current === 'dark' ? '#3e88f7' : '#2481cc';
}

function resolvedBackground(): string {
  const fromTg = webApp()?.themeParams?.secondary_bg_color;
  if (fromTg) return fromTg;
  const css = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
  if (css && !css.includes('var(')) return css;
  return current === 'dark' ? DARK_BG : LIGHT_BG;
}

// Bound once per WebApp object / matchMedia implementation: a replaced SDK (tests install
// fakes) is followed, but a change event never re-binds from inside its own dispatch — the
// SDK iterates its handler array by index, so re-adding a handler there would never end.
let watchedTg: unknown = null;
let watchedMatchMedia: unknown = null;

function watch(): void {
  const tg = webApp() ?? null;
  const mm = typeof matchMedia === 'function' ? matchMedia : null;
  if (unwatch && tg === watchedTg && mm === watchedMatchMedia) return;
  watchedTg = tg;
  watchedMatchMedia = mm;
  unwatch?.();
  const offTg = onTg('themeChanged', () => applyTheme());
  const mq = mediaQuery();
  const onChange = () => applyTheme();
  mq?.addEventListener?.('change', onChange);
  unwatch = () => {
    offTg();
    mq?.removeEventListener?.('change', onChange);
  };
}

/**
 * Applies the current theme to the document (data-theme, data-liquid, theme-color meta,
 * Telegram header/background/bottom bar colours) and subscribes to changes once.
 */
export function applyTheme(): ColorScheme {
  const root = document.documentElement;
  current = currentScheme();
  root.dataset.theme = current;
  if (needsFixedLiquid(resolvedAccent())) root.dataset.liquid = 'fixed';
  else delete root.dataset.liquid;

  // index.html ships one meta per colour scheme; inside Telegram the scheme may differ from
  // prefers-color-scheme, so every meta gets the resolved background and whichever the
  // browser picks is right.
  const background = resolvedBackground();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = background;
  });

  tgCall(API.headerColor, (tg) => {
    tg.setHeaderColor('secondary_bg_color');
    tg.setBackgroundColor('secondary_bg_color');
  });
  tgCall(API.bottomBarColor, (tg) => tg.setBottomBarColor('secondary_bg_color'));

  watch();
  listeners.forEach((cb) => cb());
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The applied colour scheme; re-renders on themeChanged / prefers-color-scheme changes. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, () => current, () => 'light');
}
