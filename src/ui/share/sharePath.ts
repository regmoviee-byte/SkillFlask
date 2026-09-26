// How the share card leaves the app (v0.5 package 19). There is no server, so Telegram's own
// ways are out of reach: `shareMessage` needs a message prepared by the bot's backend,
// `shareToStory` and `downloadFile` a public https URL (a blob: or data: URL of a picture made
// on the phone is neither). What is left, best first:
//
// - the picture: the system share sheet with the file (Web Share with files: mobile browsers,
//   Telegram's iOS WebView where it has it); otherwise a download link in a browser; inside
//   Telegram without Web Share, the iOS WebView's own long-press menu saves the picture, the
//   desktop and web clients' right-click menu does, and on Android (its WebView has neither)
//   only a screenshot can — the sheet says which;
// - the link: Telegram's chat picker (`openTelegramLink` with t.me/share/url, one line of text
//   with it); in a browser, Web Share of the link, or the clipboard. The link is for someone
//   else, whose phone has none of the sender's data: the Mini App's own link (appShareLink).
//
// The choice is a pure function of what the environment offers (sharePlan), tested with fakes.

import { copyText } from '../../platform/clipboard';
import { skillStartParam, tgAppLink } from '../../platform/deeplink';
import { API, isTelegram, platform, supports, tgCall } from '../../platform/telegram';

export type ImageWay = 'share' | 'download' | 'hold' | 'rightClick' | 'screenshot';
export type LinkWay = 'telegram' | 'share' | 'copy';

export interface ShareEnv {
  /** navigator.canShare accepts the picture as a file. */
  canShareFiles: boolean;
  /** navigator.share exists (a link and a text are always shareable then). */
  canShareLink: boolean;
  telegram: boolean;
  /** Telegram's openTelegramLink is supported (Bot API 6.1). */
  telegramLink: boolean;
  /** Telegram's platform: 'ios', 'android', 'tdesktop'…; 'browser' outside it. */
  platform: string;
}

export interface SharePlan {
  image: ImageWay;
  link: LinkWay;
}

/**
 * Telegram's clients on a computer: the desktop apps (their WebViews keep the context menu with
 * «Save image») and Telegram Web, an iframe in an ordinary browser.
 */
const POINTER_PLATFORMS = new Set(['tdesktop', 'macos', 'unigram', 'weba', 'webk', 'web']);

/** The best way for the picture and for the link in this environment. */
export function sharePlan(env: ShareEnv): SharePlan {
  const image: ImageWay = env.canShareFiles
    ? 'share'
    : !env.telegram
      ? 'download'
      : env.platform === 'ios'
        ? 'hold'
        : POINTER_PLATFORMS.has(env.platform)
          ? 'rightClick'
          : 'screenshot';
  const link: LinkWay = env.telegram && env.telegramLink ? 'telegram' : env.canShareLink ? 'share' : 'copy';
  return { image, link };
}

/** What this page can do with `file` (the card) right now. */
export function shareEnv(file: File | null): ShareEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const canShareLink = typeof nav?.share === 'function';
  let canShareFiles = false;
  if (file && canShareLink && typeof nav?.canShare === 'function') {
    try {
      canShareFiles = nav.canShare({ files: [file] });
    } catch {
      canShareFiles = false;
    }
  }
  return { canShareFiles, canShareLink, telegram: isTelegram(), telegramLink: supports(API.telegramLink), platform: platform() };
}

/**
 * The link that goes to someone else. Inside Telegram — the Mini App with `startapp=skill_<id>`:
 * the sender lands on the skill, a friend (who has no such skill) on the usual first screen
 * (StartRedirect). In a browser the skill's own link (`#/skills/<id>`) would open «Навык не
 * найден» on the friend's phone, since the data lives in the sender's storage only, so the
 * link is the Mini App itself, the one on the card.
 */
export function appShareLink(skillId: string, telegram: boolean, appLink: string = tgAppLink()): string {
  const param = telegram ? skillStartParam(skillId) : null;
  return param ? `${appLink}?startapp=${param}` : appLink;
}

/** Telegram's chat picker for a link and one line of text. */
export function telegramShareUrl(link: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

async function webShare(data: ShareData): Promise<ShareOutcome> {
  try {
    await navigator.share(data);
    return 'shared';
  } catch (error) {
    // AbortError: the user closed the sheet; InvalidStateError: a sheet of ours is still open
    // (a second tap). NotAllowedError (the tap's activation is gone) or a WebView quirk: the
    // caller offers the other ways.
    const name = (error as { name?: unknown } | null)?.name;
    return name === 'AbortError' || name === 'InvalidStateError' ? 'cancelled' : 'failed';
  }
}

/** The system share sheet with the picture and its line; call it inside the tap. */
export function shareImage(file: File, text: string): Promise<ShareOutcome> {
  return webShare({ files: [file], text });
}

/** Saves the picture through a download link (browsers only: Telegram's WebViews ignore it). */
export function downloadImage(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export type LinkOutcome = ShareOutcome | 'opened' | 'copied';

/** Sends the link the planned way; call it inside the tap (the clipboard and Web Share need it). */
export async function sendLink(way: LinkWay, link: string, text: string): Promise<LinkOutcome> {
  switch (way) {
    case 'telegram': {
      const opened = tgCall(API.telegramLink, (tg) => {
        tg.openTelegramLink(telegramShareUrl(link, text));
        return true;
      });
      return opened ? 'opened' : 'failed';
    }
    case 'share':
      return webShare({ url: link, text });
    case 'copy':
      return (await copyText(link)) ? 'copied' : 'failed';
  }
}
