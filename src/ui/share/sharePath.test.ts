// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeTelegram, type FakeTelegram } from '../../test/fakeTelegram';
import { appShareLink, sendLink, shareEnv, shareImage, sharePlan, telegramShareUrl, type ShareEnv } from './sharePath';

const env = (over: Partial<ShareEnv> = {}): ShareEnv => ({
  canShareFiles: false,
  canShareLink: false,
  telegram: false,
  telegramLink: false,
  platform: 'browser',
  ...over,
});

const png = () => new File(['png'], 'skill-flask-2026-09-26.png', { type: 'image/png' });

let fake: FakeTelegram | undefined;
const stubbed: string[] = [];
/** Puts a Web Share API on jsdom's navigator (it has none). */
function stubNavigator(name: 'share' | 'canShare' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
  stubbed.push(name);
}

afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  for (const name of stubbed.splice(0)) delete (navigator as unknown as Record<string, unknown>)[name];
});

describe('sharePlan', () => {
  it('shares the picture through the system sheet wherever it takes files', () => {
    expect(sharePlan(env({ canShareFiles: true, canShareLink: true })).image).toBe('share');
    expect(sharePlan(env({ canShareFiles: true, canShareLink: true, telegram: true, telegramLink: true, platform: 'ios' }))).toEqual({
      image: 'share',
      link: 'telegram',
    });
  });

  it('downloads the picture in a browser without it, and shares or copies the link', () => {
    expect(sharePlan(env())).toEqual({ image: 'download', link: 'copy' });
    expect(sharePlan(env({ canShareLink: true }))).toEqual({ image: 'download', link: 'share' });
  });

  it('never promises a download inside Telegram: a long press on iOS, right click on a computer, a screenshot on Android', () => {
    expect(sharePlan(env({ telegram: true, telegramLink: true, platform: 'ios' }))).toEqual({ image: 'hold', link: 'telegram' });
    expect(sharePlan(env({ telegram: true, telegramLink: true, platform: 'android' }))).toEqual({ image: 'screenshot', link: 'telegram' });
    for (const platform of ['tdesktop', 'macos', 'unigram', 'weba', 'webk', 'web']) {
      expect(sharePlan(env({ telegram: true, telegramLink: true, platform })).image).toBe('rightClick');
    }
    // A client we do not know promises the least.
    expect(sharePlan(env({ telegram: true, telegramLink: true, platform: 'unknown' })).image).toBe('screenshot');
  });

  it('copies the link in a Telegram too old for openTelegramLink', () => {
    expect(sharePlan(env({ telegram: true, telegramLink: false, platform: 'android' })).link).toBe('copy');
  });
});

describe('shareEnv', () => {
  it('reads a browser without Web Share', () => {
    expect(shareEnv(png())).toEqual({ canShareFiles: false, canShareLink: false, telegram: false, telegramLink: false, platform: 'browser' });
  });

  it('asks canShare about the picture itself', () => {
    const canShare = vi.fn((data: ShareData) => (data.files ?? []).every((f) => f.type === 'image/png'));
    stubNavigator('share', vi.fn());
    stubNavigator('canShare', canShare);
    const file = png();
    expect(shareEnv(file)).toMatchObject({ canShareFiles: true, canShareLink: true });
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    expect(shareEnv(null).canShareFiles).toBe(false);
  });

  it('takes a throwing canShare for a no', () => {
    stubNavigator('share', vi.fn());
    stubNavigator('canShare', () => {
      throw new TypeError('files are not supported');
    });
    expect(shareEnv(png())).toMatchObject({ canShareFiles: false, canShareLink: true });
  });

  it('reads Telegram: its platform and openTelegramLink from Bot API 6.1', () => {
    fake = installFakeTelegram('7.10');
    expect(shareEnv(png())).toMatchObject({ telegram: true, telegramLink: true, platform: 'ios' });
    fake.uninstall();
    fake = installFakeTelegram('6.0');
    expect(shareEnv(png())).toMatchObject({ telegram: true, telegramLink: false });
  });
});

describe('appShareLink', () => {
  const uuid = '0b6a9c4e-1f2d-4e3a-9b8c-7d6e5f4a3b2c';

  it('inside Telegram: the Mini App with the skill as its start parameter', () => {
    expect(appShareLink(uuid, true, 'https://t.me/Bot/app')).toBe('https://t.me/Bot/app?startapp=skill_0b6a9c4e1f2d4e3a9b8c7d6e5f4a3b2c');
    expect(appShareLink('skill-english', true, 'https://t.me/Bot/app')).toBe('https://t.me/Bot/app?startapp=skill_skill-english');
  });

  it('in a browser, or for an id no start parameter carries: the Mini App itself, never the sender’s `#/skills/<id>`', () => {
    expect(appShareLink(uuid, false, 'https://t.me/Bot/app')).toBe('https://t.me/Bot/app');
    expect(appShareLink('id with spaces', true, 'https://t.me/Bot/app')).toBe('https://t.me/Bot/app');
    expect(appShareLink(uuid, false)).toBe('https://t.me/SkillFlaskBot/app');
  });
});

describe('sending', () => {
  it('opens Telegram’s chat picker with the link and the line', async () => {
    fake = installFakeTelegram('7.10');
    const link = 'https://t.me/SkillFlaskBot/app?startapp=skill_abc';
    await expect(sendLink('telegram', link, 'Уже 3 колбы в навыке «Английский»')).resolves.toBe('opened');
    expect(fake.calls).toContain(`openTelegramLink(${JSON.stringify(telegramShareUrl(link, 'Уже 3 колбы в навыке «Английский»'))})`);
    expect(telegramShareUrl(link, 'Уже 3 колбы')).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Уже 3 колбы')}`,
    );
  });

  it('reports a Telegram without openTelegramLink as failed (the sheet copies instead)', async () => {
    fake = installFakeTelegram('6.0');
    await expect(sendLink('telegram', 'https://t.me/x', 'text')).resolves.toBe('failed');
  });

  it('shares the link through Web Share, or copies it', async () => {
    const share = vi.fn(async () => {});
    stubNavigator('share', share);
    await expect(sendLink('share', 'https://example.org/#/skills/1', 'Уже 2 колбы')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ url: 'https://example.org/#/skills/1', text: 'Уже 2 колбы' });
    const writeText = vi.fn(async () => {});
    stubNavigator('clipboard', { writeText });
    await expect(sendLink('copy', 'https://example.org/#/skills/1', 'Уже 2 колбы')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://example.org/#/skills/1');
  });

  it('tells a closed share sheet from a refused one', async () => {
    stubNavigator('share', vi.fn(async () => Promise.reject(new DOMException('closed', 'AbortError'))));
    await expect(shareImage(png(), 'line')).resolves.toBe('cancelled');
    // A second call while our sheet is still open: nothing is broken.
    stubNavigator('share', vi.fn(async () => Promise.reject(new DOMException('in progress', 'InvalidStateError'))));
    await expect(shareImage(png(), 'line')).resolves.toBe('cancelled');
    stubNavigator('share', vi.fn(async () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'))));
    await expect(shareImage(png(), 'line')).resolves.toBe('failed');
    const share = vi.fn(async () => {});
    stubNavigator('share', share);
    const file = png();
    await expect(shareImage(file, 'line')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file], text: 'line' });
  });
});
