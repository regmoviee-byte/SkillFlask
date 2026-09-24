// Calendar-date helpers. Every function works on 'YYYY-MM-DD' strings and does its
// arithmetic on Date.UTC parts, so DST changes in the device time zone never shift a day.

export { localDate, nowIso } from './clock';
import { localDate } from './clock';

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

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dateFormatWithYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

function toDate(value: string): Date {
  return value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
}

/** "24 сентября" for the current year, "24 сентября 2025 г." otherwise. Accepts YYYY-MM-DD or ISO. */
export function formatDate(value: string): string {
  const date = toDate(value);
  return (date.getFullYear() === new Date().getFullYear() ? dateFormat : dateFormatWithYear).format(date);
}

/** "24 сентября, 14:02" in the device time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${formatDate(iso)}, ${timeFormat.format(date)}`;
}

/** «Сегодня» / «Вчера» / formatted date, relative to the local calendar. */
export function formatDayLabel(date: string, today: string = localDate()): string {
  if (date === today) return 'Сегодня';
  if (date === addDays(today, -1)) return 'Вчера';
  return formatDate(date);
}
