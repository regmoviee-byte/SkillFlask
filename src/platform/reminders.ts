// Where «Напоминание в календаре» (v0.5 package 20) can put an event, by platform — detected from
// Telegram's `platform` and the browser's user agent, never guessed from screen size:
//
// - iOS (Telegram iOS, Safari, the installed app): only an https URL of an .ics file makes iOS
//   offer «Добавить в Календарь» — Telegram's WebView drops blob: and data: — so the static
//   files of the build (domain/reminder.ts): three day sets, the general title;
// - Telegram elsewhere (Android, desktop): Google Calendar's template link, and the static file
//   through the browser (Samsung and other calendars open it);
// - a browser elsewhere (Android, and a desktop one that must merely not break): Google Calendar,
//   and an .ics file made on the phone and downloaded (a blob download works there).
//
// A way that builds the event on the phone (Google, the download) takes any weekdays and a
// skill's own title and link; the static file cannot. The skill screen offers «Напоминание для
// навыка» only where such a way exists. The choice is a pure function tested with fakes.

import { isIos } from './homeScreen';
import { isTelegram, platform } from './telegram';

/** `calendar`: the static file as iOS's «Добавить в Календарь»; `fileLink`: the same file elsewhere. */
export type ReminderWay = 'calendar' | 'google' | 'fileLink' | 'download';

export interface ReminderEnv {
  telegram: boolean;
  os: 'ios' | 'android' | 'other';
}

export interface ReminderPlan {
  /** Best first. */
  ways: ReminderWay[];
  /** Chosen weekdays and a skill's own title: some way makes the event on the phone. */
  custom: boolean;
}

/** The static file: a preset day set and the general reminder only. */
export const isStaticWay = (way: ReminderWay): boolean => way === 'calendar' || way === 'fileLink';

export function reminderPlan(env: ReminderEnv): ReminderPlan {
  if (env.os === 'ios') return { ways: ['calendar'], custom: false };
  return { ways: env.telegram ? ['google', 'fileLink'] : ['google', 'download'], custom: true };
}

/** This page's platform: Telegram's own report inside it, the user agent outside. */
export function reminderEnv(): ReminderEnv {
  const telegram = isTelegram();
  if (telegram) {
    const p = platform();
    return { telegram, os: p === 'ios' ? 'ios' : p === 'android' || p === 'android_x' ? 'android' : 'other' };
  }
  return { telegram, os: isIos() ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'other' };
}
