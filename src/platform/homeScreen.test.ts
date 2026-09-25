// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { addToHomeScreen, homeScreenOffer, initHomeScreen, isIosNonSafari, offerForTelegramStatus, refreshHomeScreen, resetHomeScreen } from './homeScreen';
import { API, supports, tgCall } from './telegram';

let fake: FakeTelegram | undefined;
let stop: (() => void) | undefined;
const realUserAgent = navigator.userAgent;

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function setStandalone(standalone: boolean) {
  window.matchMedia = ((query: string) =>
    ({ matches: standalone && query.includes('standalone'), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => {
  stop?.();
  stop = undefined;
  fake?.uninstall();
  fake = undefined;
  resetHomeScreen();
  setUserAgent(realUserAgent);
  setStandalone(false);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('home screen in Telegram', () => {
  it('is gated at Bot API 8.0: absent methods are never called below it', () => {
    fake = installFakeTelegram('7.10');
    expect(supports(API.homeScreen)).toBe(false);
    expect(() => fake!.tg.addToHomeScreen()).toThrow(TypeError);
    stop = initHomeScreen();
    expect(homeScreenOffer()).toEqual({ kind: 'none' });
    expect(fake.calls).not.toContain('checkHomeScreenStatus()');
    const called = tgCall(
      API.homeScreen,
      (tg) => {
        tg.addToHomeScreen();
        return 'called';
      },
      'skipped',
    );
    expect(called).toBe('skipped');
  });

  it('offers the shortcut at 8.0 until one exists, and asks Telegram to add it', async () => {
    fake = installFakeTelegram('8.0');
    stop = initHomeScreen();
    expect(homeScreenOffer()).toEqual({ kind: 'none' }); // until the client answers
    await flush();
    expect(fake.calls).toContain('checkHomeScreenStatus()');
    expect(homeScreenOffer()).toEqual({ kind: 'telegram' });
    expect(await addToHomeScreen()).toBe('requested');
    expect(fake.calls).toContain('addToHomeScreen()');
    fake.emit('homeScreenAdded');
    expect(homeScreenOffer()).toEqual({ kind: 'added' });
  });

  it('shows «Уже на главном экране» and hides the row where the device cannot', async () => {
    fake = installFakeTelegram('8.0');
    fake.homeScreen.status = 'added';
    stop = initHomeScreen();
    await flush();
    expect(homeScreenOffer()).toEqual({ kind: 'added' });
    fake.homeScreen.status = 'unsupported';
    refreshHomeScreen();
    await flush();
    expect(homeScreenOffer()).toEqual({ kind: 'none' });
  });

  it('maps every status', () => {
    expect(offerForTelegramStatus('added')).toEqual({ kind: 'added' });
    expect(offerForTelegramStatus('missed')).toEqual({ kind: 'telegram' });
    expect(offerForTelegramStatus('unknown')).toEqual({ kind: 'telegram' });
    expect(offerForTelegramStatus('unsupported')).toEqual({ kind: 'none' });
    expect(offerForTelegramStatus(undefined)).toEqual({ kind: 'none' });
  });
});

describe('home screen in a browser', () => {
  it('replays Chrome’s install prompt from the row', async () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile');
    stop = initHomeScreen();
    expect(homeScreenOffer()).toEqual({ kind: 'instructions', os: 'other' });
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(homeScreenOffer()).toEqual({ kind: 'prompt' });
    expect(await addToHomeScreen()).toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('appinstalled'));
    expect(homeScreenOffer()).toEqual({ kind: 'added' });
  });

  it('shows Safari’s instructions on iOS', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
    stop = initHomeScreen();
    expect(homeScreenOffer()).toEqual({ kind: 'instructions', os: 'ios' });
    expect(await addToHomeScreen()).toBe('instructions');
  });

  it('words the steps generically in another iOS browser, and points to Safari', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',
    ]) {
      setUserAgent(ua);
      stop?.();
      resetHomeScreen();
      stop = initHomeScreen();
      expect(homeScreenOffer(), ua).toEqual({ kind: 'instructions', os: 'ios-other' });
    }
    // Chrome on Android is no iOS browser at all.
    setUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile');
    expect(isIosNonSafari()).toBe(false);
  });

  it('says «Уже на главном экране» in a browser tab of an installed app (getInstalledRelatedApps)', async () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile');
    const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
    try {
      nav.getInstalledRelatedApps = async () => [];
      stop = initHomeScreen();
      await flush();
      expect(homeScreenOffer()).toEqual({ kind: 'instructions', os: 'other' });
      stop();
      resetHomeScreen();
      nav.getInstalledRelatedApps = async () => [{ platform: 'webapp', url: 'https://example.org/manifest.webmanifest' }];
      stop = initHomeScreen();
      await flush();
      expect(homeScreenOffer()).toEqual({ kind: 'added' });
    } finally {
      delete nav.getInstalledRelatedApps;
    }
  });

  it('offers nothing inside the installed app', () => {
    setStandalone(true);
    stop = initHomeScreen();
    expect(homeScreenOffer()).toEqual({ kind: 'none' });
  });
});
