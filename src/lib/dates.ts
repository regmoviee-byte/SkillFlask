/** Local calendar date as YYYY-MM-DD, using the device time zone (FR-TD-006). */
export function localDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

let lastNow = 0;

/**
 * Current time as ISO string, strictly increasing within the session so that journal
 * entries created in the same millisecond still replay in the order they were written.
 */
export function nowIso(): string {
  lastNow = Math.max(Date.now(), lastNow + 1);
  return new Date(lastNow).toISOString();
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dateFormatWithYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/** "24 сентября" for the current year, "24 сентября 2025 г." otherwise. Accepts YYYY-MM-DD or ISO. */
export function formatDate(value: string): string {
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return (date.getFullYear() === new Date().getFullYear() ? dateFormat : dateFormatWithYear).format(date);
}
