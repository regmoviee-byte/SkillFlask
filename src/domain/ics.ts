// A recurring calendar event as an iCalendar file (RFC 5545) and as a Google Calendar
// template link (v0.5 package 20, «Напоминание в календаре»). Pure: no storage, no DOM, so the
// build (vite.config.ts) writes the static reminder files with the same code the app runs.
//
// The event's time is FLOATING — `DTSTART:20260926T190000` with no TZID and no `Z` — so it
// follows whatever zone the phone is in: 19:00 stays 19:00 after a flight, like the app's own
// days (FR-TD-006). The alarm fires at the start (TRIGGER:PT0M).

import { addDays } from '../lib/dates';

export interface CalendarEvent {
  /** Stable per reminder: the same reminder added again replaces itself where a calendar honours UID. */
  uid: string;
  summary: string;
  description: string;
  /** Opens the app (URL property; also in the description, which every calendar shows). */
  url: string;
  /** Local date of the first occurrence, YYYY-MM-DD. */
  date: string;
  /** Local start time, HH:MM. */
  time: string;
  durationMinutes: number;
  /** The recurrence rule without its `RRULE:` name, e.g. `FREQ=WEEKLY;BYDAY=MO,WE`. */
  rrule: string;
}

const CRLF = '\r\n';
/** RFC 5545 §3.1: a content line is at most 75 octets, excluding the line break. */
const LINE_OCTETS = 75;

/** TEXT value escaping (RFC 5545 §3.3.11): backslash, semicolon, comma, and line breaks as `\n`. */
export function escapeText(value: string): string {
  return value.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r\n|\r|\n/g, '\\n');
}

function utf8Length(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/**
 * Folds a content line into lines of at most 75 octets (UTF-8), each continuation starting with
 * one space (RFC 5545 §3.1). Never splits a character: Cyrillic takes two octets, an emoji four.
 */
export function foldLine(line: string): string {
  const lines: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0)!);
    // The continuation's leading space counts towards its 75 octets.
    const limit = lines.length === 0 ? LINE_OCTETS : LINE_OCTETS - 1;
    if (octets + size > limit) {
      lines.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  lines.push(current);
  return lines.join(`${CRLF} `);
}

/** `20260926T190000`: a floating local date-time. */
function floating(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/** Local date and time `minutes` after the start (23:45 + 15 min → 00:00 of the next day). */
function endOf(date: string, time: string, minutes: number): { date: string; time: string } {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  const day = Math.floor(total / 1440);
  const rest = total - day * 1440;
  const hh = String(Math.floor(rest / 60)).padStart(2, '0');
  const mm = String(rest % 60).padStart(2, '0');
  return { date: addDays(date, day), time: `${hh}:${mm}` };
}

/** `20260926T160000Z`: DTSTAMP is always UTC. */
function utcStamp(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/** The event as an .ics file: CRLF line breaks, folded lines, escaped text, one alarm at the start. */
export function buildIcs(event: CalendarEvent, stamp: Date): string {
  const end = endOf(event.date, event.time, event.durationMinutes);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Skill Flask//Reminder//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(stamp)}`,
    `DTSTART:${floating(event.date, event.time)}`,
    `DTEND:${floating(end.date, end.time)}`,
    `RRULE:${event.rrule}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    // A URI value: not TEXT, so not escaped (RFC 5545 §3.8.4.6).
    `URL:${event.url}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(event.summary)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * Google Calendar's «new event» page, filled in: `dates` without `Z` is floating (the calendar's
 * own zone), `recur` repeats it. The link cannot set an alarm: the event gets the calendar's
 * default notification.
 */
export function googleCalendarUrl(event: CalendarEvent): string {
  const end = endOf(event.date, event.time, event.durationMinutes);
  const params: [string, string][] = [
    ['action', 'TEMPLATE'],
    ['text', event.summary],
    ['details', event.description],
    ['dates', `${floating(event.date, event.time)}/${floating(end.date, end.time)}`],
    ['recur', `RRULE:${event.rrule}`],
  ];
  return `https://calendar.google.com/calendar/render?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}
