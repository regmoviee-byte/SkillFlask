// The window of the «Активность» heat maps (v0.5 package 14): half a year of ISO weeks ending
// with the current one. Apart from the rest of the heat map code (domain/activity.ts,
// services/insights.ts, lazy) because the home screen needs it at first paint: its tile only
// appears when something happened inside this window.

import { addDays, weekStart } from '../lib/dates';

/** Weeks of the heat map: half a year, ending with the current week. */
export const ACTIVITY_WEEKS = 26;

/** The first date of the heat map: the Monday ACTIVITY_WEEKS − 1 weeks before this week's. */
export function activityStart(today: string): string {
  return addDays(weekStart(today), -7 * (ACTIVITY_WEEKS - 1));
}
