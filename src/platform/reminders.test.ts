// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { isStaticWay, reminderEnv, reminderPlan } from './reminders';

let fake: FakeTelegram | undefined;
const realAgent = navigator.userAgent;

function userAgent(value: string, touchPoints = 0) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  delete window.Telegram;
  userAgent(realAgent);
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

describe('reminderEnv: the platform from the fake Telegram, else the user agent', () => {
  it('Telegram iOS: the static file only, three presets, the general title', () => {
    // Even with an Android user agent: Telegram's own report wins inside it.
    userAgent(ANDROID);
    fake = installFakeTelegram('7.10', { platform: 'ios' });
    const env = reminderEnv();
    expect(env).toEqual({ telegram: true, os: 'ios' });
    expect(reminderPlan(env)).toEqual({ ways: ['calendar'], custom: false });
  });

  it('Telegram Android: Google Calendar first, then the static file', () => {
    fake = installFakeTelegram('7.10', { platform: 'android' });
    expect(reminderEnv()).toEqual({ telegram: true, os: 'android' });
    expect(reminderPlan(reminderEnv())).toEqual({ ways: ['google', 'fileLink'], custom: true });
    fake.uninstall();
    fake = installFakeTelegram('8.0', { platform: 'android_x' });
    expect(reminderEnv().os).toBe('android');
  });

  it('Telegram on a computer: the Android ways (openLink hands both to the browser)', () => {
    fake = installFakeTelegram('8.0', { platform: 'tdesktop' });
    expect(reminderEnv()).toEqual({ telegram: true, os: 'other' });
    expect(reminderPlan(reminderEnv()).ways).toEqual(['google', 'fileLink']);
  });

  it('platform "unknown" (telegram-web-app.js in a plain browser) is a browser: the user agent decides', () => {
    window.Telegram = { WebApp: { platform: 'unknown' } };
    userAgent(IPHONE);
    expect(reminderEnv()).toEqual({ telegram: false, os: 'ios' });
    expect(reminderPlan(reminderEnv())).toEqual({ ways: ['calendar'], custom: false });
    // An iPad reports itself as a Mac with touch.
    userAgent(IPAD, 5);
    expect(reminderEnv().os).toBe('ios');
    userAgent(ANDROID);
    expect(reminderEnv()).toEqual({ telegram: false, os: 'android' });
    expect(reminderPlan(reminderEnv())).toEqual({ ways: ['google', 'download'], custom: true });
  });

  it('a desktop browser (out of scope) still gets working ways', () => {
    userAgent(DESKTOP);
    expect(reminderEnv()).toEqual({ telegram: false, os: 'other' });
    expect(reminderPlan(reminderEnv()).ways).toEqual(['google', 'download']);
  });

  it('only the static ways are limited to presets and the general title', () => {
    expect(['calendar', 'google', 'fileLink', 'download'].filter((way) => isStaticWay(way as 'google'))).toEqual(['calendar', 'fileLink']);
  });
});
