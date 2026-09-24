// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { API, initTelegram, isMobileTelegram, isTelegram, onTg, supports, tgCall, versionAtLeast, webApp } from './telegram';
import { applyTheme } from './theme';
import { haptics } from './haptics';
import { dialogs } from './dialogs';

let fake: FakeTelegram | undefined;
afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  haptics.cancel();
});

describe('version comparison', () => {
  it('compares dotted versions numerically', () => {
    expect(versionAtLeast('7.10', '7.9')).toBe(true);
    expect(versionAtLeast('7.10', '7.10')).toBe(true);
    expect(versionAtLeast('8.0', '7.10')).toBe(true);
    expect(versionAtLeast('6.9', '6.10')).toBe(false);
    expect(versionAtLeast('6.1', '6.2')).toBe(false);
  });

  it('is false outside Telegram', () => {
    expect(isTelegram()).toBe(false);
    expect(supports('6.0')).toBe(false);
    expect(webApp()).toBeUndefined();
    expect(isMobileTelegram()).toBe(false);
  });
});

/** Every gated call the app makes; none of them may throw at any version. */
function exerciseAll(): void {
  initTelegram();
  applyTheme();
  haptics.select();
  haptics.tap();
  haptics.levelUp(3);
  haptics.milestone();
  haptics.error();
  tgCall(API.closingConfirmation, (tg) => tg.enableClosingConfirmation());
  tgCall(API.secondaryButton, (tg) => tg.SecondaryButton.setParams({ text: 'x' }));
  tgCall(API.backButton, (tg) => tg.BackButton.show());
  const off = onTg('themeChanged', () => {});
  off();
}

describe.each([
  ['6.0', { backButton: false, confirm: false, verticalSwipes: false, secondaryButton: false, safeArea: false }],
  ['7.10', { backButton: true, confirm: true, verticalSwipes: true, secondaryButton: true, safeArea: false }],
  ['8.0', { backButton: true, confirm: true, verticalSwipes: true, secondaryButton: true, safeArea: true }],
] as const)('Bot API %s', (version, gates) => {
  it('gates every feature by version and never throws', () => {
    fake = installFakeTelegram(version);
    expect(isTelegram()).toBe(true);
    expect(isMobileTelegram()).toBe(true);
    expect(supports(API.backButton)).toBe(gates.backButton);
    expect(supports(API.confirm)).toBe(gates.confirm);
    expect(supports(API.verticalSwipes)).toBe(gates.verticalSwipes);
    expect(supports(API.secondaryButton)).toBe(gates.secondaryButton);
    expect(supports(API.safeArea)).toBe(gates.safeArea);
    expect(() => exerciseAll()).not.toThrow();
    expect(fake.calls).toContain('ready()');
    expect(fake.calls).toContain('expand()');
    expect(fake.calls.includes('disableVerticalSwipes()')).toBe(gates.verticalSwipes);
    expect(fake.calls.some((c) => c.startsWith('BackButton.show'))).toBe(gates.backButton);
    expect(fake.calls.some((c) => c.startsWith('SecondaryButton.setParams'))).toBe(gates.secondaryButton);
    expect(fake.calls.some((c) => c.startsWith('haptic.'))).toBe(gates.backButton);
    expect(fake.calls.includes('setHeaderColor("secondary_bg_color")')).toBe(gates.backButton);
    expect(fake.calls.includes('setBottomBarColor("secondary_bg_color")')).toBe(gates.secondaryButton);
  });

  it('routes confirm to showConfirm only when supported', async () => {
    fake = installFakeTelegram(version);
    const original = window.confirm;
    window.confirm = () => false;
    try {
      const ok = await dialogs.confirm('Точно?');
      expect(ok).toBe(gates.confirm);
      expect(fake.calls.some((c) => c.startsWith('showConfirm'))).toBe(gates.confirm);
    } finally {
      window.confirm = original;
    }
  });
});

describe('tgCall', () => {
  it('swallows and logs a throwing SDK method', () => {
    fake = installFakeTelegram('8.0', { expand: () => { throw new Error('boom'); } } as never);
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      expect(() => initTelegram()).not.toThrow();
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      console.warn = original;
    }
  });

  it('onTg returns a working unsubscribe', () => {
    fake = installFakeTelegram('8.0');
    let hits = 0;
    const off = onTg('themeChanged', () => hits++);
    fake.emit('themeChanged');
    off();
    fake.emit('themeChanged');
    expect(hits).toBe(1);
  });
});

describe('haptics', () => {
  it('falls back to navigator.vibrate outside Telegram and respects the switch', () => {
    const patterns: unknown[] = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p: unknown) => patterns.push(p) });
    haptics.tap();
    expect(patterns).toEqual([[8]]);
    localStorage.setItem('sf_haptics', 'off');
    haptics.tap();
    expect(patterns).toHaveLength(1);
    localStorage.removeItem('sf_haptics');
  });
});
