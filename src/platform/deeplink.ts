// Deep links. Inside Telegram a link `https://t.me/SkillFlaskBot/app?startapp=<param>` opens
// the app with that parameter (`initDataUnsafe.start_param`, and `tgWebAppStartParam` in the
// launch URL); only the first route after the launch follows it (StartRedirect), later
// navigation is normal. Outside Telegram the hash routes (`#/skills/<id>`) are the links.
//
// Parameters: `today`, `skills`, `achievements`, `recap`, `skill_<id>` (the skill screen),
// `add_<id>` («Задним числом» for that skill), `new` (the template chooser) and `new_<key>`
// (the new-skill form filled from that template, domain/templateKeys.ts). Telegram allows
// [A-Za-z0-9_-], at most 64 characters, so a UUID travels without its dashes (32 hex characters).

import { isTemplateKey, type TemplateKey } from '../domain/templateKeys';

export type StartRoute = '/today' | '/skills' | '/achievements' | '/recap';

export type StartLink =
  | { kind: 'route'; path: StartRoute }
  | { kind: 'skill'; skillId: string; add: boolean }
  /** A new skill: the chooser (`template` null) or the form filled from a template. */
  | { kind: 'new'; template: TemplateKey | null };

/** What Telegram accepts as a start parameter. */
const PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMPACT_UUID = /^[0-9a-f]{32}$/;
/** An id that travels as it is: an older id such as `skill-english` (never 32 hex, see encodeSkillId). */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

const ROUTES: Record<string, StartRoute> = {
  today: '/today',
  skills: '/skills',
  achievements: '/achievements',
  recap: '/recap',
};

/** The id as it goes into a start parameter, or null when it cannot (characters Telegram refuses). */
export function encodeSkillId(id: string): string | null {
  if (UUID.test(id)) return id.replace(/-/g, '');
  // A 32-hex id that is not a UUID would read back as one: it gets no link instead.
  if (PLAIN_ID.test(id) && !COMPACT_UUID.test(id)) return id;
  return null;
}

/** The inverse of encodeSkillId; null for anything else. */
export function decodeSkillId(token: string): string | null {
  if (COMPACT_UUID.test(token)) {
    return `${token.slice(0, 8)}-${token.slice(8, 12)}-${token.slice(12, 16)}-${token.slice(16, 20)}-${token.slice(20)}`;
  }
  if (UUID.test(token)) return token;
  if (PLAIN_ID.test(token)) return token;
  return null;
}

/** `skill_<id>` / `add_<id>`, or null when the id cannot travel in 64 allowed characters. */
export function skillStartParam(id: string, add = false): string | null {
  const token = encodeSkillId(id);
  if (token === null) return null;
  const param = `${add ? 'add' : 'skill'}_${token}`;
  return PARAM.test(param) ? param : null;
}

/** Parses a start parameter strictly: anything unknown or malformed is null (the usual entry). */
export function parseStartParam(raw: string | null | undefined): StartLink | null {
  if (typeof raw !== 'string' || !PARAM.test(raw)) return null;
  // Own keys only: `constructor`, `toString`, `__proto__`… fit the alphabet too.
  if (Object.prototype.hasOwnProperty.call(ROUTES, raw)) return { kind: 'route', path: ROUTES[raw]! };
  if (raw === 'new') return { kind: 'new', template: null };
  if (raw.startsWith('new_')) {
    // Only a key of the catalogue: `new_`, `new_custom` or an unknown key is the usual entry.
    const key = raw.slice(4);
    return isTemplateKey(key) ? { kind: 'new', template: key } : null;
  }
  const match = /^(skill|add)_(.+)$/.exec(raw);
  if (!match) return null;
  const skillId = decodeSkillId(match[2]!);
  return skillId === null ? null : { kind: 'skill', skillId, add: match[1] === 'add' };
}

/** The app route a link opens. */
export function startLinkPath(link: StartLink): string {
  if (link.kind === 'route') return link.path;
  if (link.kind === 'new') return link.template ? `/skills/new/${link.template}` : '/skills/new';
  const path = `/skills/${encodeURIComponent(link.skillId)}`;
  return link.add ? `${path}/add` : path;
}

// ---- Links to share ----

/** The Mini App's direct link; VITE_TG_APP_LINK (CI: the TG_APP_LINK repository variable) overrides it. */
export const DEFAULT_TG_APP_LINK = 'https://t.me/SkillFlaskBot/app';

/** `https://t.me/<bot>` or `https://t.me/<bot>/<app>`: nothing else takes a `?startapp=`. */
const TG_APP_LINK = /^https:\/\/t\.me\/[A-Za-z0-9_]+(\/[A-Za-z0-9_]+)?$/;

/** The configured Mini App link without a trailing slash; an empty or any other value means the default. */
export function tgAppLink(configured: string | undefined = import.meta.env.VITE_TG_APP_LINK): string {
  const value = configured?.trim().replace(/\/+$/, '') ?? '';
  return TG_APP_LINK.test(value) ? value : DEFAULT_TG_APP_LINK;
}

/**
 * The link to a skill. Inside Telegram — the Mini App link with `startapp=skill_<id>`; in a
 * browser — the page itself with `#/skills/<id>`: the data lives in each app's own storage,
 * so a browser skill opened in Telegram (or the other way round) would not be found. An id
 * that cannot be a start parameter also gets the page link.
 */
export function skillLink(skillId: string, options: { telegram: boolean; pageUrl: string; tgLink?: string }): string {
  const param = skillStartParam(skillId);
  if (options.telegram && param) return `${options.tgLink ?? tgAppLink()}?startapp=${param}`;
  const url = new URL(options.pageUrl);
  // Telegram's own launch parameters live in the query and the hash; neither belongs in a link.
  url.search = '';
  url.hash = startLinkPath({ kind: 'skill', skillId, add: false });
  return url.toString();
}

// ---- The launch parameter ----

const USED_KEY = 'sf_start_param';

/** The start parameter of this launch: from the SDK, or from the launch URL if the SDK did not load. */
export function launchStartParam(): string | null {
  const fromSdk = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (typeof fromSdk === 'string' && fromSdk) return fromSdk;
  for (const part of [window.location.search, window.location.hash]) {
    const value = new URLSearchParams(part.replace(/^[?#]/, '')).get('tgWebAppStartParam');
    if (value) return value;
  }
  return null;
}

/** Telegram's signature of this launch (unique per launch); '' when there is none. */
function launchSignature(): string {
  const initData = window.Telegram?.WebApp?.initData;
  if (typeof initData === 'string' && initData) return new URLSearchParams(initData).get('hash') ?? initData.length.toString();
  return '';
}

let claimed: StartLink | null | undefined;

/**
 * The launch's link, read once per document. A reload of the same launch («Обновить
 * приложение», the webview restoring the page) finds it marked in sessionStorage and gets
 * null, so it stays where the user went instead of jumping back.
 */
export function launchStartLink(): StartLink | null {
  if (claimed !== undefined) return claimed;
  claimed = null;
  const raw = launchStartParam();
  if (!raw) return null;
  const marker = `${raw}|${launchSignature()}`;
  try {
    if (sessionStorage.getItem(USED_KEY) === marker) return null;
    sessionStorage.setItem(USED_KEY, marker);
  } catch {
    // No sessionStorage: the link is followed once per document, which is still right.
  }
  claimed = parseStartParam(raw);
  return claimed;
}

/** Tests: forget the claimed link. */
export function resetLaunchStartLink(): void {
  claimed = undefined;
}
