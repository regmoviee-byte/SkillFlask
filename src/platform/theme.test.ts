// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { applyTheme, needsFixedLiquid, parseColor, relativeLuminance } from './theme';

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
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.liquid;
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
