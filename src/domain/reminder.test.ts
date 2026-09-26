import { describe, expect, it } from 'vitest';
import { reminderFiles } from '../../scripts/reminders-plugin.mjs';
import { precacheFiles } from '../../scripts/sw-plugin.mjs';
import { parseIcs, props, unescapeText } from '../test/ics';
import reminderStaticFiles from '../ui/reminder/staticFiles';
import {
  daysKey,
  DEFAULT_REMINDER,
  firstOccurrence,
  normalizeDays,
  parseReminderChoice,
  REMINDER_TIMES,
  reminderEvent,
  rruleFor,
  staticReminderPath,
} from './reminder';

// Node's own modules without @types/node (as in progress/palette.test.ts).
type Fs = {
  mkdtempSync(prefix: string): string;
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const builtin = (id: string) => (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process!.getBuiltinModule!(id);
const fs = builtin('node:fs') as Fs;
const { tmpdir } = builtin('node:os') as { tmpdir(): string };
const { join } = builtin('node:path') as { join(...parts: string[]): string };
/** The repository root: the plugin loads its entry from there. */
const ROOT = decodeURIComponent(new URL('../..', import.meta.url).pathname);

const APP = 'https://t.me/SkillFlaskBot/app';
const BUILT = new Date('2026-09-26T08:00:00.000Z'); // a Saturday

describe('day sets', () => {
  it('writes the rule of each preset and of chosen weekdays', () => {
    expect(rruleFor('daily')).toBe('FREQ=DAILY');
    expect(rruleFor('weekdays')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(rruleFor('weekend')).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
    expect(rruleFor([5, 1, 3, 3])).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(rruleFor([7])).toBe('FREQ=WEEKLY;BYDAY=SU');
    expect(rruleFor([1, 2, 3, 4, 5, 6, 7])).toBe('FREQ=DAILY');
    expect(() => rruleFor([])).toThrow(RangeError);
  });

  it('reads chosen weekdays that make up a preset as that preset', () => {
    expect(normalizeDays([6, 7])).toBe('weekend');
    expect(normalizeDays([5, 4, 3, 2, 1])).toBe('weekdays');
    expect(normalizeDays([1, 2, 3, 4, 5, 6, 7])).toBe('daily');
    expect(normalizeDays([2, 4])).toEqual([2, 4]);
    expect(daysKey([6, 7])).toBe('weekend');
    expect(daysKey([4, 2])).toBe('days-24');
  });

  it('starts the series on the first matching day from today', () => {
    // 2026-09-26 is a Saturday.
    expect(firstOccurrence('2026-09-26', 'daily')).toBe('2026-09-26');
    expect(firstOccurrence('2026-09-26', 'weekend')).toBe('2026-09-26');
    expect(firstOccurrence('2026-09-26', 'weekdays')).toBe('2026-09-28');
    expect(firstOccurrence('2026-09-26', [3])).toBe('2026-09-30');
    expect(firstOccurrence('2026-12-31', [5])).toBe('2027-01-01');
  });

  it('offers every 15 minutes from 05:00 to 23:45', () => {
    expect(REMINDER_TIMES).toHaveLength(76);
    expect(REMINDER_TIMES[0]).toBe('05:00');
    expect(REMINDER_TIMES[1]).toBe('05:15');
    expect(REMINDER_TIMES.at(-1)).toBe('23:45');
    expect(REMINDER_TIMES).toContain(DEFAULT_REMINDER.time);
  });

  it('reads a remembered choice back strictly', () => {
    expect(parseReminderChoice({ time: '07:30', days: 'weekend' })).toEqual({ time: '07:30', days: 'weekend' });
    expect(parseReminderChoice({ time: '07:30', days: [3, 1] })).toEqual({ time: '07:30', days: [1, 3] });
    expect(parseReminderChoice({ time: '07:30', days: [1, 2, 3, 4, 5] })).toEqual({ time: '07:30', days: 'weekdays' });
    for (const bad of [null, 'x', { time: '07:31', days: 'daily' }, { time: '03:00', days: 'daily' }, { time: '07:30', days: 'monthly' }, { time: '07:30', days: [] }, { time: '07:30', days: [0, 8] }]) {
      expect(parseReminderChoice(bad)).toEqual(DEFAULT_REMINDER);
    }
  });
});

describe('reminderEvent', () => {
  it('keeps one UID per reminder: whose, which days, what time', () => {
    const base = { from: '2026-09-26', title: 't', description: 'd', link: `${APP}?startapp=today` };
    const general = reminderEvent({ ...base, days: 'weekdays', time: '07:30', skillId: null });
    expect(general.uid).toBe('skill-flask-app-weekdays-0730@skill-flask');
    expect(general.date).toBe('2026-09-28');
    expect(reminderEvent({ ...base, days: [5, 1], time: '07:30', skillId: 'skill-english' }).uid).toBe('skill-flask-skill-skill-english-days-15-0730@skill-flask');
    // The same reminder made again (another day) is the same event.
    expect(reminderEvent({ ...base, from: '2026-10-05', days: 'weekdays', time: '07:30', skillId: null }).uid).toBe(general.uid);
  });
});

// The static files the build ships for iOS (dist/reminders/, scripts/reminders-plugin.mjs).
// GitHub Pages serves them as `text/calendar` (by the `.ics` extension, its MIME table), which is
// what makes iOS offer «Добавить в Календарь»; nothing in the file can set that, so it is an
// assumption checked on a device (docs/qa-checklist.md), and the walkthrough checks vite preview.
describe('static reminder files', () => {
  const files = reminderStaticFiles({}, BUILT);

  it('are 228: three day sets × 76 slots, named <days>-<HHMM>.ics', () => {
    expect(files).toHaveLength(228);
    expect(new Set(files.map((f) => f.path)).size).toBe(228);
    for (const file of files) expect(file.path).toMatch(/^reminders\/(daily|weekdays|weekend)-(0[5-9]|1\d|2[0-3])(00|15|30|45)\.ics$/);
    expect(files.map((f) => f.path)).toContain('reminders/weekend-2345.ics');
    expect(staticReminderPath('daily', '05:00')).toBe('reminders/daily-0500.ics');
  });

  it('each parses as one floating daily or weekly event with an alarm at the start, under 1 KB', () => {
    for (const file of files) {
      expect(new TextEncoder().encode(file.content).length).toBeLessThan(1024);
      const [, days, hh, mm] = /^reminders\/(\w+)-(\d\d)(\d\d)\.ics$/.exec(file.path)!;
      const lines = parseIcs(file.content);
      const event = props(lines, 'VEVENT');
      expect(event.DTSTART).toMatch(new RegExp(`^\\d{8}T${hh}${mm}00$`));
      expect(event.RRULE).toBe(rruleFor(days as 'daily'));
      expect(props(lines, 'VALARM').TRIGGER).toBe('PT0M');
      expect(unescapeText(event.SUMMARY!)).toBe('Skill Flask: время заниматься');
      expect(event.URL).toBe(`${APP}?startapp=today`);
      expect(unescapeText(event.DESCRIPTION!)).toContain(`${APP}?startapp=today`);
      expect(event.DTSTAMP).toBe('20260926T080000Z');
    }
    // Weekdays built on a Saturday start on Monday.
    expect(props(parseIcs(files.find((f) => f.path === 'reminders/weekdays-0700.ics')!.content), 'VEVENT').DTSTART).toBe('20260928T070000');
  });

  it('take the Mini App link of VITE_TG_APP_LINK, and only a valid one', () => {
    const other = reminderStaticFiles({ VITE_TG_APP_LINK: 'https://t.me/OtherBot/dev' }, BUILT);
    expect(props(parseIcs(other[0]!.content), 'VEVENT').URL).toBe('https://t.me/OtherBot/dev?startapp=today');
    const bad = reminderStaticFiles({ VITE_TG_APP_LINK: 'https://evil.example/app' }, BUILT);
    expect(props(parseIcs(bad[0]!.content), 'VEVENT').URL).toBe(`${APP}?startapp=today`);
  });

  it('are written by the build plugin next to the bundle and never precached', async () => {
    const outDir = fs.mkdtempSync(join(tmpdir(), 'sf-reminders-'));
    try {
      const plugin = reminderFiles() as unknown as {
        configResolved(config: unknown): void;
        closeBundle(): Promise<void>;
      };
      const env = { VITE_TG_APP_LINK: 'https://t.me/OtherBot/dev' };
      plugin.configResolved({ root: ROOT, mode: 'production', command: 'build', build: { outDir, ssr: false }, env, logger: { info() {} } });
      await plugin.closeBundle();
      const written = fs.readdirSync(join(outDir, 'reminders'));
      expect(written).toHaveLength(228);
      const daily = fs.readFileSync(join(outDir, 'reminders', 'daily-1900.ics'), 'utf8');
      const event = props(parseIcs(daily), 'VEVENT');
      expect(event.DTSTART).toMatch(/T190000$/);
      expect(event.URL).toBe('https://t.me/OtherBot/dev?startapp=today');
      // Even if they were ever emitted into the bundle, the worker's list leaves them out.
      const precache = precacheFiles(['assets/index-1.js', 'index.html', ...files.map((f) => f.path)], ['sw.js', 'favicon.svg']);
      expect(precache).toEqual(['assets/index-1.js', 'favicon.svg']);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
