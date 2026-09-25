// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS } from '../domain/templateKeys';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import {
  decodeSkillId,
  DEFAULT_TG_APP_LINK,
  encodeSkillId,
  launchStartLink,
  launchStartParam,
  parseStartParam,
  resetLaunchStartLink,
  skillLink,
  skillStartParam,
  startLinkPath,
  tgAppLink,
} from './deeplink';

const UUID = '3f2b8c1e-9a4d-4e7f-8b6a-0c1d2e3f4a5b';
const COMPACT = '3f2b8c1e9a4d4e7f8b6a0c1d2e3f4a5b';

let fake: FakeTelegram | undefined;
afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  resetLaunchStartLink();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('start parameter', () => {
  it('maps the screen names to routes', () => {
    expect(parseStartParam('today')).toEqual({ kind: 'route', path: '/today' });
    expect(parseStartParam('skills')).toEqual({ kind: 'route', path: '/skills' });
    expect(parseStartParam('achievements')).toEqual({ kind: 'route', path: '/achievements' });
    expect(parseStartParam('recap')).toEqual({ kind: 'route', path: '/recap' });
  });

  it('opens a skill by its compact or full UUID, and its «Задним числом» by add_', () => {
    expect(parseStartParam(`skill_${COMPACT}`)).toEqual({ kind: 'skill', skillId: UUID, add: false });
    expect(parseStartParam(`skill_${UUID}`)).toEqual({ kind: 'skill', skillId: UUID, add: false });
    expect(parseStartParam(`add_${COMPACT}`)).toEqual({ kind: 'skill', skillId: UUID, add: true });
    expect(startLinkPath(parseStartParam(`skill_${COMPACT}`)!)).toBe(`/skills/${UUID}`);
    expect(startLinkPath(parseStartParam(`add_${COMPACT}`)!)).toBe(`/skills/${UUID}/add`);
    expect(startLinkPath(parseStartParam('recap')!)).toBe('/recap');
  });

  it('opens the template chooser by new and a template by new_<key>', () => {
    expect(parseStartParam('new')).toEqual({ kind: 'new', template: null });
    expect(parseStartParam('new_running')).toEqual({ kind: 'new', template: 'running' });
    expect(startLinkPath(parseStartParam('new')!)).toBe('/skills/new');
    expect(startLinkPath(parseStartParam('new_running')!)).toBe('/skills/new/running');
    // Every key of the catalogue fits Telegram's alphabet and length.
    for (const key of TEMPLATE_KEYS) {
      expect(parseStartParam(`new_${key}`), key).toEqual({ kind: 'new', template: key });
      expect(`new_${key}`).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  it('keeps an older id that is not a UUID as it is', () => {
    expect(parseStartParam('skill_skill-english')).toEqual({ kind: 'skill', skillId: 'skill-english', add: false });
  });

  it('rejects anything malformed or unknown', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'settings',
      'Today',
      'skill_',
      'skill',
      'add_',
      'edit_' + COMPACT,
      `skill_${COMPACT}/../settings`,
      'skill_abc def',
      'skill_%2Fsettings',
      `skill_${'a'.repeat(59)}`, // 65 characters: over Telegram's limit
      'recap?x=1',
      // Only the catalogue's keys: «Свой навык» and anything else is the usual entry.
      'new_',
      'new_custom',
      'new_Running',
      'new_running_',
      'new-running',
      'New',
      'new_constructor',
      'new___proto__',
      // Keys every object inherits: they fit the alphabet but are no screen.
      'constructor',
      'hasOwnProperty',
      '__proto__',
      'toString',
      'valueOf',
      'isPrototypeOf',
    ]) {
      expect(parseStartParam(raw), String(raw)).toBeNull();
    }
  });

  it('encodes ids within Telegram’s alphabet and length, or refuses', () => {
    expect(encodeSkillId(UUID)).toBe(COMPACT);
    expect(decodeSkillId(COMPACT)).toBe(UUID);
    expect(skillStartParam(UUID)).toBe(`skill_${COMPACT}`);
    expect(skillStartParam(UUID, true)).toBe(`add_${COMPACT}`);
    expect(skillStartParam(UUID)!.length).toBeLessThanOrEqual(64);
    expect(skillStartParam('skill-english')).toBe('skill_skill-english');
    // Characters Telegram refuses, a 32-hex id that would read back as a UUID, too long.
    expect(skillStartParam('навык 1')).toBeNull();
    expect(skillStartParam('a/b')).toBeNull();
    expect(skillStartParam(COMPACT)).toBeNull();
    expect(skillStartParam('x'.repeat(60))).toBeNull();
    // Every encoded UUID reads back to itself.
    for (let i = 0; i < 50; i++) {
      const id = crypto.randomUUID();
      expect(parseStartParam(skillStartParam(id))).toEqual({ kind: 'skill', skillId: id, add: false });
    }
  });
});

describe('links to a skill', () => {
  it('uses the Mini App link inside Telegram', () => {
    expect(skillLink(UUID, { telegram: true, pageUrl: 'https://x.github.io/SkillFlask/#/skills/1' })).toBe(
      `${DEFAULT_TG_APP_LINK}?startapp=skill_${COMPACT}`,
    );
    expect(skillLink(UUID, { telegram: true, pageUrl: 'https://x.github.io/', tgLink: 'https://t.me/Other_bot/go' })).toBe(
      `https://t.me/Other_bot/go?startapp=skill_${COMPACT}`,
    );
  });

  it('uses the page with the hash route in a browser, without Telegram’s launch parameters', () => {
    expect(skillLink(UUID, { telegram: false, pageUrl: 'https://x.github.io/SkillFlask/?tgWebAppStartParam=today#/settings' })).toBe(
      `https://x.github.io/SkillFlask/#/skills/${UUID}`,
    );
    // An id that cannot be a start parameter gets the page link even inside Telegram.
    expect(skillLink('a/b', { telegram: true, pageUrl: 'https://x.github.io/SkillFlask/' })).toBe('https://x.github.io/SkillFlask/#/skills/a%2Fb');
  });

  it('reads VITE_TG_APP_LINK, falling back to the default for empty or odd values', () => {
    expect(tgAppLink(undefined)).toBe(DEFAULT_TG_APP_LINK);
    expect(tgAppLink('')).toBe(DEFAULT_TG_APP_LINK);
    expect(tgAppLink('  ')).toBe(DEFAULT_TG_APP_LINK);
    expect(tgAppLink('http://t.me/x/app')).toBe(DEFAULT_TG_APP_LINK);
    expect(tgAppLink('https://t.me/x/app?startapp')).toBe(DEFAULT_TG_APP_LINK);
    expect(tgAppLink(' https://t.me/Dev_bot/app/ ')).toBe('https://t.me/Dev_bot/app');
    expect(tgAppLink('https://t.me/Dev_bot')).toBe('https://t.me/Dev_bot');
    // A fragment would swallow `?startapp=`; another host or path never takes it.
    expect(tgAppLink('https://t.me/x/app#a')).toBe(DEFAULT_TG_APP_LINK);
    expect(tgAppLink('https://example.com/x/app')).toBe(DEFAULT_TG_APP_LINK);
    expect(tgAppLink('https://t.me/x/app/more')).toBe(DEFAULT_TG_APP_LINK);
    expect(DEFAULT_TG_APP_LINK).toBe('https://t.me/SkillFlaskBot/app');
  });
});

describe('the launch parameter', () => {
  it('comes from the SDK first, then from the launch URL', () => {
    expect(launchStartParam()).toBeNull();
    window.history.replaceState(null, '', '/#tgWebAppData=x&tgWebAppStartParam=recap&tgWebAppVersion=8.0');
    expect(launchStartParam()).toBe('recap');
    window.history.replaceState(null, '', '/?tgWebAppStartParam=today#/');
    expect(launchStartParam()).toBe('today');
    fake = installFakeTelegram('8.0', { initDataUnsafe: { start_param: 'achievements' } } as never);
    expect(launchStartParam()).toBe('achievements');
  });

  it('is followed once per launch: not again in the same document, nor after a reload', () => {
    fake = installFakeTelegram('8.0', { initData: 'auth_date=1&hash=abc', initDataUnsafe: { start_param: `skill_${COMPACT}` } } as never);
    const link = { kind: 'skill', skillId: UUID, add: false };
    expect(launchStartLink()).toEqual(link);
    // StrictMode's second run, or another visit of `/` in the same document.
    expect(launchStartLink()).toEqual(link);
    // A reload of the same launch (a new document, the same sessionStorage).
    resetLaunchStartLink();
    expect(launchStartLink()).toBeNull();
    // A new launch (a new signature) follows its link again.
    resetLaunchStartLink();
    fake.tg.initData = 'auth_date=2&hash=def';
    expect(launchStartLink()).toEqual(link);
  });

  it('ignores a malformed parameter', () => {
    fake = installFakeTelegram('8.0', { initDataUnsafe: { start_param: 'skill_<script>' } } as never);
    expect(launchStartLink()).toBeNull();
  });
});
