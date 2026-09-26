// How a reminder leaves the app (v0.5 package 20): the link its event opens, and the tap that
// hands the event to the calendar — Telegram's openLink (the phone's browser takes the https
// URL: iOS offers «Добавить в Календарь» for an .ics file, Google Calendar opens its form), a
// plain link outside Telegram, or an .ics file downloaded in a browser. Every call runs inside
// the tap: openLink and a new tab need the gesture.

import { skillLink, skillStartParam, tgAppLink } from '../../platform/deeplink';
import { API, tgCall } from '../../platform/telegram';
import { downloadImage } from '../share/sharePath';

/**
 * What the event opens. Inside Telegram — the Mini App with `startapp=today` (or `skill_<id>`);
 * in a browser — this page with `#/today` (or `#/skills/<id>`): the data lives in each app's
 * own storage, like «Ссылка на навык».
 */
export function reminderLink(skillId: string | null, telegram: boolean, pageUrl: string, appLink: string = tgAppLink()): string {
  if (telegram) return `${appLink}?startapp=${(skillId !== null && skillStartParam(skillId)) || 'today'}`;
  if (skillId !== null) return skillLink(skillId, { telegram: false, pageUrl });
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '/today';
  return url.toString();
}

/** A file of the app by its path from the app's base (the static reminders). */
export function appFileUrl(path: string, base: string = document.baseURI): string {
  return new URL(path, base).href;
}

/**
 * Opens `url` outside the app: Telegram's browser hand-off inside Telegram; outside, a link in a
 * new tab (Google Calendar) or in this one (an .ics file: iOS shows its calendar sheet over the
 * page, and an installed app keeps its window).
 */
export function openOutside(url: string, telegram: boolean, newTab: boolean): boolean {
  if (telegram) {
    return (
      tgCall(API.openLink, (tg) => {
        tg.openLink(url);
        return true;
      }) ?? false
    );
  }
  const link = document.createElement('a');
  link.href = url;
  if (newTab) {
    link.target = '_blank';
    link.rel = 'noopener';
  }
  document.body.append(link);
  link.click();
  link.remove();
  return true;
}

/** Saves an .ics file made on the phone (browsers outside iOS). */
export function downloadIcs(content: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  downloadImage(url, name);
  // The download has taken its copy by the next task; a minute is plenty for a slow one.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
