import { useSyncExternalStore } from 'react';
import { API, onTg, supports, tgCall, webApp, type ColorScheme } from './telegram';

// Theme: inside Telegram `colorScheme` is trusted (a user may run a dark Telegram on a light
// system); outside, prefers-color-scheme decides. The liquid palette is derived from the
// accent by tokens.css, but an accent that is too dark, too light or grey is clamped to the
// signature cyan via data-liquid="fixed".
//
// Settings → «Тема» can force the app's own light or dark palette ('auto' is the rule above).
// Forced, <html> gets data-appearance="light|dark" and tokens.css pins every semantic colour
// to the app's literals, so a dark app inside a light Telegram theme never mixes Telegram's
// light --tg-theme-* colours in; the Telegram accent stays only while it keeps 3:1 on the
// forced surfaces. The choice lives in the settings table (`appearance`) and is mirrored in
// localStorage (`sf_appearance`) for the inline script in index.html, which sets data-theme
// before any stylesheet loads.

export type AppearancePreference = 'auto' | 'light' | 'dark';

/** localStorage key of the mirror the inline boot script in index.html reads. */
export const APPEARANCE_MIRROR_KEY = 'sf_appearance';

/** The app's own palettes; tokens.css pins the same literals under data-appearance. */
export const PALETTE = Object.freeze({
  // The forced light link is a shade darker than the accent: #2481cc has only 3.7:1 on #f2f2f7.
  light: { bg: '#f2f2f7', elevated: '#ffffff', accent: '#2481cc', link: '#1a6fb0' },
  dark: { bg: '#000000', elevated: '#1c1c1e', accent: '#3e88f7', link: '#3e88f7' },
});

/** Large UI (buttons, the ✓, icons) needs 3:1 against the surface it sits on (WCAG 1.4.11). */
const MIN_ACCENT_CONTRAST = 3;
/** Links are text of the usual size: 4.5:1 (WCAG 1.4.3). */
export const MIN_LINK_CONTRAST = 4.5;

const LIGHT_BG = PALETTE.light.bg;
const DARK_BG = PALETTE.dark.bg;

let current: ColorScheme = 'light';
/** The forced scheme; undefined until the mirror has been read. */
let forced: ColorScheme | null | undefined;
const listeners = new Set<() => void>();
let unwatch: (() => void) | null = null;

function mediaQuery(): MediaQueryList | undefined {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
}

export function isAppearance(value: unknown): value is AppearancePreference {
  return value === 'auto' || value === 'light' || value === 'dark';
}

function readMirror(): AppearancePreference {
  try {
    const value = localStorage.getItem(APPEARANCE_MIRROR_KEY);
    return isAppearance(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

function writeMirror(preference: AppearancePreference): void {
  try {
    if (preference === 'auto') localStorage.removeItem(APPEARANCE_MIRROR_KEY);
    else localStorage.setItem(APPEARANCE_MIRROR_KEY, preference);
  } catch {
    // No storage (private mode): the choice still applies for this session.
  }
}

function forcedScheme(): ColorScheme | null {
  if (forced === undefined) {
    const mirror = readMirror();
    forced = mirror === 'auto' ? null : mirror;
  }
  return forced;
}

/** The chosen «Тема»: 'auto' follows Telegram / the system. */
export function appearancePreference(): AppearancePreference {
  return forcedScheme() ?? 'auto';
}

/**
 * Applies a «Тема» choice at once (no reload) and mirrors it for the next boot. `animate`
 * crossfades the switch where the View Transitions API exists (the caller passes false for
 * reduced motion and for the silent sync at start-up).
 */
export function setAppearancePreference(preference: AppearancePreference, options: { animate?: boolean } = {}): void {
  const next = preference === 'auto' ? null : preference;
  const previous = forcedScheme();
  writeMirror(preference);
  if (next === previous) return;
  forced = next;
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  if (options.animate && typeof doc.startViewTransition === 'function') {
    try {
      doc.startViewTransition(() => void applyTheme());
      return;
    } catch {
      // Falls through to the instant switch.
    }
  }
  applyTheme();
}

/** Tests: forget the forced scheme so the next applyTheme reads the mirror again. */
export function resetAppearance(): void {
  forced = undefined;
}

export function currentScheme(): ColorScheme {
  const pinned = forcedScheme();
  if (pinned) return pinned;
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
  // Relative luminance runs far below perceived lightness for blues and greens, so the dark
  // floor sits at 0.10: #1a6fb0 (0.147) still makes a fine liquid, near-black accents do not.
  return lum < 0.1 || lum > 0.82 || saturation(rgb) < 0.15;
}

/** WCAG contrast ratio of two colours, 1..21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The Telegram accent (and its text colour) kept in a forced scheme, or null when it has no
 * `min` contrast (3:1 for buttons and icons; MIN_LINK_CONTRAST for link text) on the forced
 * page and card surfaces — then the app's own colour is used.
 */
export function forcedAccent(scheme: ColorScheme, accent: string | undefined, min: number = MIN_ACCENT_CONTRAST): string | null {
  const rgb = accent ? parseColor(accent) : null;
  if (!rgb) return null;
  const { bg, elevated } = PALETTE[scheme];
  const ok = [bg, elevated].every((surface) => contrastRatio(rgb, parseColor(surface)!) >= min);
  return ok ? accent! : null;
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The Telegram accent as forced-scheme link text: the accent itself at 4.5:1 on the page and
 * card surfaces, otherwise its shade mixed towards black (light) or white (dark) until it
 * reads — the link keeps the theme's hue. Null without a usable accent.
 */
export function forcedLink(scheme: ColorScheme, accent: string | undefined): string | null {
  const rgb = accent ? parseColor(accent) : null;
  if (!rgb) return null;
  const target = scheme === 'light' ? 0 : 255;
  for (let step = 0; step <= 20; step++) {
    const shade = rgb.map((c) => c + (target - c) * (step / 20)) as [number, number, number];
    const hex = toHex(shade);
    if (forcedAccent(scheme, hex, MIN_LINK_CONTRAST)) return step === 0 ? accent! : hex;
  }
  return null;
}

/** The accent pair (fill, text on it) of a forced scheme: Telegram's while it reads, else the app's. */
function forcedAccentPair(scheme: ColorScheme): { accent: string; onAccent: string } {
  const tg = webApp()?.themeParams;
  const accent = forcedAccent(scheme, tg?.button_color);
  return accent ? { accent, onAccent: tg?.button_text_color ?? '#ffffff' } : { accent: PALETTE[scheme].accent, onAccent: '#ffffff' };
}

export interface NativeButtonColors {
  main: { color: string; text_color: string };
  secondary: { color: string; text_color: string };
}

/**
 * Colours for Telegram's native bottom buttons under a forced «Тема», matching the HTML
 * .button-primary / .button-secondary: the MainButton in the resolved accent, the
 * SecondaryButton a card-coloured pill with accent text on the forced bottom bar. Null in
 * 'auto', where the SDK's defaults (Telegram's theme) are right.
 */
export function forcedButtonColors(): NativeButtonColors | null {
  const pinned = forcedScheme();
  if (!pinned) return null;
  const { accent, onAccent } = forcedAccentPair(pinned);
  return { main: { color: accent, text_color: onAccent }, secondary: { color: PALETTE[pinned].elevated, text_color: accent } };
}

function resolvedAccent(): string {
  const pinned = forcedScheme();
  if (pinned) return forcedAccent(pinned, webApp()?.themeParams?.button_color) ?? PALETTE[pinned].accent;
  const fromTg = webApp()?.themeParams?.button_color;
  if (fromTg) return fromTg;
  const css = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  if (css && !css.includes('var(')) return css;
  return current === 'dark' ? '#3e88f7' : '#2481cc';
}

function resolvedBackground(): string {
  const pinned = forcedScheme();
  if (pinned) return PALETTE[pinned].bg;
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
  const pinned = forcedScheme();
  if (pinned) {
    root.dataset.appearance = pinned;
    // The Telegram accent and its text colour, only when they read on the forced surfaces.
    const tg = webApp()?.themeParams;
    const accent = forcedAccent(pinned, tg?.button_color);
    if (accent) {
      root.style.setProperty('--sf-forced-accent', accent);
      root.style.setProperty('--sf-forced-on-accent', forcedAccentPair(pinned).onAccent);
    } else {
      root.style.removeProperty('--sf-forced-accent');
      root.style.removeProperty('--sf-forced-on-accent');
    }
    // Links are body-size text: a kept accent colours them in a shade that reaches 4.5:1.
    const link = accent ? forcedLink(pinned, accent) : null;
    if (link) root.style.setProperty('--sf-forced-link', link);
    else root.style.removeProperty('--sf-forced-link');
  } else {
    delete root.dataset.appearance;
    for (const name of ['--sf-forced-accent', '--sf-forced-on-accent', '--sf-forced-link']) root.style.removeProperty(name);
  }
  if (needsFixedLiquid(resolvedAccent())) root.dataset.liquid = 'fixed';
  else delete root.dataset.liquid;

  // index.html ships one meta per colour scheme; inside Telegram the scheme may differ from
  // prefers-color-scheme, so every meta gets the resolved background and whichever the
  // browser picks is right.
  const background = resolvedBackground();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = background;
  });

  // Telegram's chrome: its own secondary background, or the forced palette's (hex) so the
  // header and the bottom bar match the page. Below 6.9 the header takes keywords only.
  const chrome = pinned ? background : 'secondary_bg_color';
  tgCall(API.headerColor, (tg) => {
    tg.setHeaderColor(pinned && supports(API.headerColorHex) ? background : 'secondary_bg_color');
    tg.setBackgroundColor(chrome);
  });
  tgCall(API.bottomBarColor, (tg) => tg.setBottomBarColor(chrome));

  watch();
  listeners.forEach((cb) => cb());
  return current;
}

/** Called after every applyTheme (a «Тема» switch, themeChanged, a system switch). */
export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The chosen «Тема»; re-renders when it changes (Settings shows it pressed at once). */
export function useAppearancePreference(): AppearancePreference {
  return useSyncExternalStore(subscribeTheme, appearancePreference, () => 'auto');
}

/** The applied colour scheme; re-renders on themeChanged / prefers-color-scheme changes. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribeTheme, () => current, () => 'light');
}
