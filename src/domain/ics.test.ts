import { describe, expect, it } from 'vitest';
import { parseIcs, props, unescapeText } from '../test/ics';
import { buildIcs, escapeText, foldLine, googleCalendarUrl, type CalendarEvent } from './ics';

const STAMP = new Date('2026-09-26T09:30:00.000Z');

const event = (patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'skill-flask-app-daily-1900@skill-flask',
  summary: 'Skill Flask: время заниматься',
  description: 'Откройте Skill Flask: https://t.me/SkillFlaskBot/app?startapp=today',
  url: 'https://t.me/SkillFlaskBot/app?startapp=today',
  date: '2026-09-26',
  time: '19:00',
  durationMinutes: 15,
  rrule: 'FREQ=DAILY',
  ...patch,
});

const octets = (line: string) => new TextEncoder().encode(line).length;

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and line breaks (RFC 5545 §3.3.11)', () => {
    expect(escapeText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeText('one\ntwo\r\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour');
    expect(escapeText('Английский — время заниматься')).toBe('Английский — время заниматься');
    // Round trip through the test reader.
    const text = 'Гитара, аккорды; «Am\\C»\nвторая строка';
    expect(unescapeText(escapeText(text))).toBe(text);
  });
});

describe('foldLine', () => {
  it('leaves a line of 75 octets alone and folds longer ones with a leading space', () => {
    const exact = 'X'.repeat(75);
    expect(foldLine(exact)).toBe(exact);
    const folded = foldLine('Y'.repeat(200));
    const lines = folded.split('\r\n');
    expect(lines.map(octets)).toEqual([75, 75, 52]);
    expect(lines.slice(1).every((line) => line.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe('Y'.repeat(200));
  });

  it('counts UTF-8 octets and never splits a character', () => {
    // Cyrillic letters take two octets, an emoji four.
    const line = `SUMMARY:${'Щ'.repeat(60)}🎉${'ж'.repeat(40)}`;
    const lines = foldLine(line).split('\r\n');
    expect(lines.length).toBeGreaterThan(2);
    for (const part of lines) {
      expect(octets(part)).toBeLessThanOrEqual(75);
      // No lone surrogate or broken sequence: the part round-trips through UTF-8.
      expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(part))).toBe(part);
    }
    expect(lines[0] + lines.slice(1).map((l) => l.slice(1)).join('')).toBe(line);
  });
});

describe('buildIcs', () => {
  it('writes one event with CRLF lines of at most 75 octets', () => {
    const text = buildIcs(event({ description: `Длинное описание, которое точно не влезет в одну строку; с запятыми и точкой с запятой. ${'ещё '.repeat(20)}` }), STAMP);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of text.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75);
    const lines = parseIcs(text);
    expect(lines.filter((line) => line.path.join('/') === 'VCALENDAR/VEVENT' && line.name === 'UID')).toHaveLength(1);
    expect(props(lines, 'VCALENDAR')).toMatchObject({ VERSION: '2.0', PRODID: '-//Skill Flask//Reminder//RU', METHOD: 'PUBLISH' });
    expect(unescapeText(props(lines, 'VEVENT').DESCRIPTION!)).toContain('с запятыми и точкой с запятой.');
  });

  it('uses floating local time (no TZID, no Z), a 15-minute event and a UTC DTSTAMP', () => {
    const text = buildIcs(event(), STAMP);
    const vevent = props(parseIcs(text), 'VEVENT');
    expect(vevent.DTSTART).toBe('20260926T190000');
    expect(vevent.DTEND).toBe('20260926T191500');
    expect(vevent.DTSTAMP).toBe('20260926T093000Z');
    expect(text).not.toMatch(/TZID|VTIMEZONE/);
    expect(vevent.UID).toBe('skill-flask-app-daily-1900@skill-flask');
    expect(vevent.URL).toBe('https://t.me/SkillFlaskBot/app?startapp=today');
    expect(unescapeText(vevent.SUMMARY!)).toBe('Skill Flask: время заниматься');
  });

  it('ends a 23:45 event at midnight of the next day', () => {
    const vevent = props(parseIcs(buildIcs(event({ date: '2026-12-31', time: '23:45' }), STAMP)), 'VEVENT');
    expect(vevent.DTSTART).toBe('20261231T234500');
    expect(vevent.DTEND).toBe('20270101T000000');
  });

  it('repeats by the rule and alarms at the start', () => {
    const lines = parseIcs(buildIcs(event({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }), STAMP));
    expect(props(lines, 'VEVENT').RRULE).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    const alarm = props(lines, 'VALARM');
    expect(alarm).toEqual({ ACTION: 'DISPLAY', DESCRIPTION: 'Skill Flask: время заниматься', TRIGGER: 'PT0M' });
    expect(lines.find((line) => line.name === 'TRIGGER')!.path).toEqual(['VCALENDAR', 'VEVENT', 'VALARM']);
  });

  it('escapes the skill name in the title', () => {
    const vevent = props(parseIcs(buildIcs(event({ summary: 'Код, тесты; и \\ слэш — время заниматься' }), STAMP)), 'VEVENT');
    expect(vevent.SUMMARY).toBe('Код\\, тесты\\; и \\\\ слэш — время заниматься');
  });
});

describe('googleCalendarUrl', () => {
  it('fills Google Calendar’s event template: floating dates, the rule, text and details', () => {
    const url = new URL(googleCalendarUrl(event({ summary: 'Английский — время заниматься', rrule: 'FREQ=WEEKLY;BYDAY=SA,SU', time: '07:30' })));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Английский — время заниматься');
    expect(url.searchParams.get('details')).toBe('Откройте Skill Flask: https://t.me/SkillFlaskBot/app?startapp=today');
    expect(url.searchParams.get('dates')).toBe('20260926T073000/20260926T074500');
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=SA,SU');
  });

  it('encodes spaces as %20, not +, and keeps the link intact', () => {
    const raw = googleCalendarUrl(event());
    expect(raw).not.toContain('+');
    expect(raw).toContain('text=Skill%20Flask%3A%20');
    expect(raw).toContain(encodeURIComponent('https://t.me/SkillFlaskBot/app?startapp=today'));
  });
});
