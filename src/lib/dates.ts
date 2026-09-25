// Calendar-date helpers. Every function works on 'YYYY-MM-DD' strings and does its
// arithmetic on Date.UTC parts, so DST changes in the device time zone never shift a day.

export { localDate, nowIso } from './clock';
import { localDate, nowDate } from './clock';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** True for a real calendar date in YYYY-MM-DD form ('2026-13-45' and '2026-02-30' are not). */
export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return fromUtc(Date.UTC(y, m - 1, d + n));
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** ISO weekday: Monday = 1 … Sunday = 7 (FR-TD-007). */
export function isoWeekday(date: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const [y, m, d] = parts(date);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (day === 0 ? 7 : day) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const [y, m] = parts(date);
  return fromUtc(Date.UTC(y, m, 0));
}

/** The same day `n` months later, kept inside the month: 31 January + 1 → 28 (29) February. */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}

/** «в сентябре»: the prepositional case after «в». */
export const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dateFormatWithYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

function toDate(value: string): Date {
  return value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
}

/** "24 сентября" for the current year, "24 сентября 2025 г." otherwise. Accepts YYYY-MM-DD or ISO. */
export function formatDate(value: string): string {
  const date = toDate(value);
  return (date.getFullYear() === nowDate().getFullYear() ? dateFormat : dateFormatWithYear).format(date);
}

/**
 * A span of local dates, the year only when it is not the current one: «15–21 сентября»,
 * «29 сентября – 5 октября», «29 декабря 2025 г. – 4 января 2026 г.». Accepts YYYY-MM-DD.
 */
export function formatDateRange(from: string, to: string): string {
  if (!isValidLocalDate(from) || !isValidLocalDate(to)) throw new RangeError(`Invalid date range ${from}..${to}`);
  if (from === to) return formatDate(to);
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(to);
  if (fy !== ty) return `${dateFormatWithYear.format(toDate(from))} – ${dateFormatWithYear.format(toDate(to))}`;
  if (fm !== tm) return `${dateFormat.format(toDate(from))} – ${formatDate(to)}`;
  return `${Number(from.slice(8))}–${formatDate(to)}`;
}

/** `days` consecutive dates from `start` (formatDateRange): «5–7 сентября» for three. */
export function formatDaySpan(start: string, days: number): string {
  if (!isValidLocalDate(start)) throw new RangeError(`Invalid date ${start}`);
  return formatDateRange(start, addDays(start, Math.max(1, days) - 1));
}

/** A Monday..Sunday week named by its Monday: «14–20 сентября». */
export function formatWeek(monday: string): string {
  return formatDaySpan(monday, 7);
}

/** «в марте» in the current year, «в марте 2027» in another one. Accepts YYYY-MM-DD. */
export function formatMonthIn(date: string): string {
  const [y, m] = parts(date);
  return `в ${MONTHS_IN[m - 1]}${y === nowDate().getFullYear() ? '' : ` ${y}`}`;
}

/** «четверг, 24 сентября» — the second line of «Сегодня». Accepts YYYY-MM-DD. */
export function formatWeekdayDate(date: string): string {
  return weekdayFormat.format(toDate(date));
}

/** "24 сентября, 14:02" in the device time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${formatDate(iso)}, ${timeFormat.format(date)}`;
}

/** «сегодня в 14:02» / «вчера в 09:15» / «24 сентября в 14:02», in the device time zone. */
export function formatDateTimeRelative(iso: string, today: string = localDate()): string {
  const date = new Date(iso);
  const day = localDate(date);
  const label = day === today ? 'сегодня' : day === addDays(today, -1) ? 'вчера' : formatDate(iso);
  return `${label} в ${timeFormat.format(date)}`;
}

/** «Сегодня» / «Вчера» / formatted date, relative to the local calendar. */
export function formatDayLabel(date: string, today: string = localDate()): string {
  if (date === today) return 'Сегодня';
  if (date === addDays(today, -1)) return 'Вчера';
  return formatDate(date);
}
