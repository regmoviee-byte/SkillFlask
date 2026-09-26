// «Напоминание в календаре» (v0.5 package 20): which days and at what time the phone's calendar
// reminds, as a recurring event (domain/ics.ts). There is no server, so the app never learns
// whether the event was added, and the calendar cannot know whether the user already practised.
//
// iOS opens an .ics file only from an https URL (Telegram's WebView drops blob: and data:), so
// the build ships one static file per 15-minute slot and day set (staticReminderFiles, written
// to dist/reminders/ by scripts/reminders-plugin.mjs). Custom weekdays and a skill's own title
// exist only where the event is made on the phone: a Google Calendar link, or a file downloaded
// in a browser.

import { isoWeekday, addDays } from '../lib/dates';
import { buildIcs, type CalendarEvent } from './ics';
import type { Weekday } from './types';

export type ReminderPreset = 'daily' | 'weekdays' | 'weekend';
/** A preset, or chosen weekdays (Monday = 1 … Sunday = 7, FR-TD-007). */
export type ReminderDays = ReminderPreset | Weekday[];

export const REMINDER_PRESETS: readonly ReminderPreset[] = ['daily', 'weekdays', 'weekend'];

const PRESET_DAYS: Record<ReminderPreset, Weekday[]> = {
  daily: [1, 2, 3, 4, 5, 6, 7],
  weekdays: [1, 2, 3, 4, 5],
  weekend: [6, 7],
};

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** The weekdays of a day set, sorted. */
export function daysOf(days: ReminderDays): Weekday[] {
  return typeof days === 'string' ? PRESET_DAYS[days] : [...new Set(days)].sort((a, b) => a - b);
}

/** Chosen weekdays that make up a preset are that preset (its static file, its name). */
export function normalizeDays(days: ReminderDays): ReminderDays {
  if (typeof days === 'string') return days;
  const list = daysOf(days);
  const same = REMINDER_PRESETS.find((preset) => PRESET_DAYS[preset].join() === list.join());
  return same ?? list;
}

/** `FREQ=DAILY`, or `FREQ=WEEKLY;BYDAY=…` for the chosen days. */
export function rruleFor(days: ReminderDays): string {
  const list = daysOf(days);
  if (list.length === 0) throw new RangeError('A reminder needs at least one day');
  if (list.length === 7) return 'FREQ=DAILY';
  return `FREQ=WEEKLY;BYDAY=${list.map((day) => BYDAY[day - 1]).join(',')}`;
}

/** A short stable name of the day set: `daily`, `weekend`, `days-135`. */
export function daysKey(days: ReminderDays): string {
  const normal = normalizeDays(days);
  return typeof normal === 'string' ? normal : `days-${normal.join('')}`;
}

// ---- Time: 15-minute slots from 05:00 to 23:45 (the static files cover exactly these) ----

export const SLOT_MINUTES = 15;
const FIRST_MINUTE = 5 * 60;
const LAST_MINUTE = 23 * 60 + 45;

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Every time the picker offers: 05:00, 05:15 … 23:45 (76 slots). */
export const REMINDER_TIMES: readonly string[] = Array.from({ length: (LAST_MINUTE - FIRST_MINUTE) / SLOT_MINUTES + 1 }, (_, i) =>
  hhmm(FIRST_MINUTE + i * SLOT_MINUTES),
);

export function isReminderTime(value: unknown): value is string {
  return typeof value === 'string' && REMINDER_TIMES.includes(value);
}

/** The first day on or after `from` that the set contains. */
export function firstOccurrence(from: string, days: ReminderDays): string {
  const list = daysOf(days);
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i);
    if (list.includes(isoWeekday(date))) return date;
  }
  throw new RangeError('A reminder needs at least one day');
}

// ---- The event ----

export const REMINDER_MINUTES = 15;

export interface ReminderEventInput {
  days: ReminderDays;
  time: string;
  /** The event starts on the first matching day from here (the local date of today). */
  from: string;
  title: string;
  description: string;
  /** Opens the app: the Mini App with `startapp=…`, or the page with `#/…`. */
  link: string;
  /** Whose reminder: a skill id, or null for the app's general one (part of the UID). */
  skillId: string | null;
}

export function reminderEvent(input: ReminderEventInput): CalendarEvent {
  const owner = input.skillId === null ? 'app' : `skill-${input.skillId}`;
  return {
    uid: `skill-flask-${owner}-${daysKey(input.days)}-${input.time.replace(':', '')}@skill-flask`,
    summary: input.title,
    description: input.description,
    url: input.link,
    date: firstOccurrence(input.from, input.days),
    time: input.time,
    durationMinutes: REMINDER_MINUTES,
    rrule: rruleFor(input.days),
  };
}

// ---- The static files ----

/** `reminders/weekdays-0730.ics`, relative to the app's base. */
export function staticReminderPath(preset: ReminderPreset, time: string): string {
  return `reminders/${preset}-${time.replace(':', '')}.ics`;
}

export interface ReminderTexts {
  title: string;
  description(link: string): string;
}

/**
 * Every static reminder file: 3 day sets × 76 slots = 228 files, each the general reminder
 * (the app's title, `startapp=today`). `now` is the build: DTSTAMP, and the day the series
 * starts from.
 */
export function staticReminderFiles(appLink: string, texts: ReminderTexts, now: Date): { path: string; content: string }[] {
  const link = `${appLink}?startapp=today`;
  const from = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  return REMINDER_PRESETS.flatMap((days) =>
    REMINDER_TIMES.map((time) => ({
      path: staticReminderPath(days, time),
      content: buildIcs(reminderEvent({ days, time, from, title: texts.title, description: texts.description(link), link, skillId: null }), now),
    })),
  );
}

// ---- The form's memory (a device setting: the app cannot know what the calendar kept) ----

export interface ReminderChoice {
  time: string;
  days: ReminderDays;
}

export const DEFAULT_REMINDER: ReminderChoice = { time: '19:00', days: 'daily' };

/** A stored choice read back strictly; anything malformed is the default. */
export function parseReminderChoice(raw: unknown): ReminderChoice {
  if (!raw || typeof raw !== 'object') return DEFAULT_REMINDER;
  const { time, days } = raw as { time?: unknown; days?: unknown };
  if (!isReminderTime(time)) return DEFAULT_REMINDER;
  if (typeof days === 'string' && (REMINDER_PRESETS as readonly string[]).includes(days)) return { time, days: days as ReminderPreset };
  if (Array.isArray(days) && days.length > 0 && days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) {
    return { time, days: normalizeDays(days as Weekday[]) };
  }
  return DEFAULT_REMINDER;
}
