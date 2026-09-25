// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import indexHtml from '../../index.html?raw';
import {
  APPEARANCE_MIRROR_KEY,
  applyTheme,
  appearancePreference,
  contrastRatio,
  forcedAccent,
  forcedLink,
  MIN_LINK_CONTRAST,
  PALETTE,
  needsFixedLiquid,
  parseColor,
  relativeLuminance,
  resetAppearance,
  setAppearancePreference,
} from './theme';

let fake: FakeTelegram | undefined;
let dark = false;
const mediaListeners = new Set<(e: { matches: boolean }) => void>();

// One matchMedia for the whole file, like a browser: listeners survive across tests.
window.matchMedia = ((query: string) =>
  ({
    matches: query.includes('dark') ? dark : false,
    media: query,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => mediaListeners.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => mediaListeners.delete(cb),
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

/** Dispatches like the DOM: to a snapshot of the listeners. */
const dispatchMedia = (matches: boolean) => [...mediaListeners].forEach((cb) => cb({ matches }));

beforeEach(() => {
  dark = false;
  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
});

afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  localStorage.clear();
  resetAppearance();
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.liquid;
  delete root.dataset.appearance;
  root.removeAttribute('style');
});

describe('theme', () => {
  it('follows Telegram colorScheme and flips on themeChanged', () => {
    fake = installFakeTelegram('7.10');
    expect(applyTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#efeff4');

    (fake.tg as { colorScheme: string }).colorScheme = 'dark';
    fake.tg.themeParams.secondary_bg_color = '#0f0f0f';
    fake.emit('themeChanged');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#0f0f0f');
    expect(fake.calls).toContain('setBottomBarColor("secondary_bg_color")');
  });

  it('follows prefers-color-scheme outside Telegram', () => {
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
    dark = true;
    dispatchMedia(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#000000');
  });

  it('clamps the liquid for a dark or grey accent only', () => {
    fake = installFakeTelegram('7.10', { themeParams: { button_color: '#222' } } as never);
    applyTheme();
    expect(document.documentElement.dataset.liquid).toBe('fixed');

    fake.tg.themeParams.button_color = '#8774e1';
    fake.emit('themeChanged');
    expect(document.documentElement.dataset.liquid).toBeUndefined();

    fake.tg.themeParams.button_color = '#8e8e93';
    fake.emit('themeChanged');
    expect(document.documentElement.dataset.liquid).toBe('fixed');
  });

  it('parses colours and computes luminance', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(36, 129, 204)')).toEqual([36, 129, 204]);
    expect(parseColor('nonsense')).toBeNull();
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1);
    expect(needsFixedLiquid('#2481cc')).toBe(false);
    expect(needsFixedLiquid('#3e88f7')).toBe(false);
    expect(needsFixedLiquid('#ffffff')).toBe(true);
    expect(needsFixedLiquid('#1a6fb0')).toBe(false);
    expect(needsFixedLiquid('#2a7a3b')).toBe(false);
    expect(needsFixedLiquid('#1c1c1e')).toBe(true);
    expect(needsFixedLiquid('#0b2a4a')).toBe(true);
  });
});

describe('forced «Тема»', () => {
  const root = document.documentElement;
  const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content;

  it('each option sets data-theme and data-appearance, and mirrors itself', () => {
    applyTheme();
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.appearance).toBeUndefined();

    setAppearancePreference('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.appearance).toBe('dark');
    expect(localStorage.getItem(APPEARANCE_MIRROR_KEY)).toBe('dark');
    expect(meta()).toBe('#000000');

    setAppearancePreference('light');
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.appearance).toBe('light');
    expect(meta()).toBe('#f2f2f7');

    setAppearancePreference('auto');
    expect(root.dataset.appearance).toBeUndefined();
    expect(localStorage.getItem(APPEARANCE_MIRROR_KEY)).toBeNull();
    expect(appearancePreference()).toBe('auto');
  });

  it('survives Telegram’s themeChanged and a system switch while forced', () => {
    fake = installFakeTelegram('7.10');
    applyTheme();
    setAppearancePreference('dark');
    (fake.tg as { colorScheme: string }).colorScheme = 'light';
    fake.emit('themeChanged');
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.appearance).toBe('dark');
    dark = false;
    dispatchMedia(false);
    expect(root.dataset.theme).toBe('dark');

    setAppearancePreference('auto');
    expect(root.dataset.theme).toBe('light');
    (fake.tg as { colorScheme: string }).colorScheme = 'dark';
    fake.emit('themeChanged');
    expect(root.dataset.theme).toBe('dark');
  });

  it('paints Telegram’s header, background and bottom bar with the forced palette', () => {
    fake = installFakeTelegram('7.10');
    setAppearancePreference('dark');
    expect(fake.calls).toContain('setHeaderColor("#000000")');
    expect(fake.calls).toContain('setBackgroundColor("#000000")');
    expect(fake.calls).toContain('setBottomBarColor("#000000")');
    fake.uninstall();
    // Below 6.9 the header takes keywords only; the background already takes hex.
    fake = installFakeTelegram('6.1');
    resetAppearance();
    applyTheme();
    expect(fake.calls).toContain('setHeaderColor("secondary_bg_color")');
    expect(fake.calls).toContain('setBackgroundColor("#000000")');
  });

  it('keeps the Telegram accent only while it reads on the forced surfaces', () => {
    // #2481cc reads on light (3.7:1) and on black; a pale accent does not on white.
    expect(forcedAccent('light', '#2481cc')).toBe('#2481cc');
    expect(forcedAccent('dark', '#2481cc')).toBe('#2481cc');
    expect(forcedAccent('light', '#a8e0ff')).toBeNull();
    expect(forcedAccent('dark', '#8774e1')).toBe('#8774e1');
    expect(forcedAccent('dark', '#1c3a8a')).toBeNull();
    expect(forcedAccent('light', undefined)).toBeNull();
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);

    fake = installFakeTelegram('7.10', { themeParams: { button_color: '#a8e0ff', button_text_color: '#000000' } } as never);
    setAppearancePreference('light');
    expect(root.style.getPropertyValue('--sf-forced-accent')).toBe('');
    setAppearancePreference('dark');
    expect(root.style.getPropertyValue('--sf-forced-accent')).toBe('#a8e0ff');
    expect(root.style.getPropertyValue('--sf-forced-on-accent')).toBe('#000000');
    setAppearancePreference('auto');
    expect(root.style.getPropertyValue('--sf-forced-accent')).toBe('');
  });

  it('colours links with the Telegram accent only at 4.5:1 (a shade of it), buttons already at 3:1', () => {
    // Purple Telegram, forced light: 3.35:1 on #f2f2f7 — fine for a button, not for link text.
    expect(forcedAccent('light', '#8774e1')).toBe('#8774e1');
    expect(forcedAccent('light', '#8774e1', MIN_LINK_CONTRAST)).toBeNull();
    // Light Telegram's blue on the forced dark cards: 4.12:1.
    expect(forcedAccent('dark', '#2481cc', MIN_LINK_CONTRAST)).toBeNull();
    expect(forcedAccent('dark', '#8774e1', MIN_LINK_CONTRAST)).toBe('#8774e1');
    // The app's own forced link colours read on both of their surfaces.
    for (const scheme of ['light', 'dark'] as const) expect(forcedAccent(scheme, PALETTE[scheme].link, MIN_LINK_CONTRAST)).toBe(PALETTE[scheme].link);
    // The link keeps the accent's hue: darker on light, lighter on dark, and it reads.
    const onLight = forcedLink('light', '#8774e1')!;
    expect(forcedAccent('light', onLight, MIN_LINK_CONTRAST)).toBe(onLight);
    expect(relativeLuminance(parseColor(onLight)!)).toBeLessThan(relativeLuminance(parseColor('#8774e1')!));
    const onDark = forcedLink('dark', '#2481cc')!;
    expect(forcedAccent('dark', onDark, MIN_LINK_CONTRAST)).toBe(onDark);
    expect(relativeLuminance(parseColor(onDark)!)).toBeGreaterThan(relativeLuminance(parseColor('#2481cc')!));
    expect(forcedLink('dark', '#8774e1')).toBe('#8774e1');
    expect(forcedLink('light', undefined)).toBeNull();

    fake = installFakeTelegram('7.10', { themeParams: { button_color: '#8774e1', button_text_color: '#ffffff' } } as never);
    setAppearancePreference('light');
    expect(root.style.getPropertyValue('--sf-forced-accent')).toBe('#8774e1');
    expect(root.style.getPropertyValue('--sf-forced-link')).toBe(onLight);
    setAppearancePreference('dark');
    expect(root.style.getPropertyValue('--sf-forced-link')).toBe('#8774e1');
    // No kept accent (too pale for 3:1): the app's own link colour.
    fake.uninstall();
    fake = installFakeTelegram('7.10', { themeParams: { button_color: '#a8e0ff' } } as never);
    setAppearancePreference('light');
    expect(root.style.getPropertyValue('--sf-forced-link')).toBe('');
    setAppearancePreference('auto');
    expect(root.style.getPropertyValue('--sf-forced-link')).toBe('');
  });

  it('reads the mirror on the first applyTheme (a reload)', () => {
    localStorage.setItem(APPEARANCE_MIRROR_KEY, 'dark');
    expect(applyTheme()).toBe('dark');
    expect(root.dataset.appearance).toBe('dark');
  });

  it('the inline boot script in index.html reads the mirror before any stylesheet', () => {
    const script = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).find((text) => text.includes('sf_appearance'));
    expect(script).toBeDefined();
    const run = () => new Function(script!)();

    localStorage.setItem(APPEARANCE_MIRROR_KEY, 'dark');
    run();
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.appearance).toBe('dark');

    localStorage.setItem(APPEARANCE_MIRROR_KEY, 'light');
    dark = true;
    run();
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.appearance).toBe('light');

    localStorage.removeItem(APPEARANCE_MIRROR_KEY);
    delete root.dataset.appearance;
    run();
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.appearance).toBeUndefined();
  });
});
