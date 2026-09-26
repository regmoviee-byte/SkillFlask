// «Пауза» (v0.5 package 18): a skill rests for a while — a holiday, an illness, an exam season —
// without being archived, and comes back by itself. Pure rules over the `pauses` rows; every
// effect is derived on read, nothing about a pause is written anywhere else.
//
// - A skill is paused on a local date d when one of its pauses has from ≤ d ≤ until (both
//   included; until null = «пока не сниму»). `endedAt` never changes which days are paused:
//   «Снять паузу» moves `until` to yesterday (so today is back in the plan at once) and stamps
//   endedAt; a pause set and taken off on the same day covers nothing and is deleted
//   (services/pauses.ts). A pause whose last day has passed is over by itself.
// - Pause is not a status: the skill stays ACTIVE and can be completed from its screen; a
//   completion during a pause does not end it, and that day counts as a day of practice.
// - «Сегодня»: a step of a skill paused on the plan's date is not planned — no row in
//   «Осталось», no quota block, nothing in «Ещё» (schedule.ts planForDate `isPaused`).
// - Quotas (N раз в неделю / в месяц): a period the skill rests through entirely is never shown
//   (every day of it is paused, the plan's date too); a period paused only in part keeps its
//   whole target — no silent maths — and counts every completion of the period as before.
// - Day streaks (streaks.ts, records «Лучшая серия», the ladder «Лучшая серия»): a rest day
//   (restDays below) neither breaks nor extends a run: active Mon, rest Tue–Thu, active Fri is a
//   run of two days. The streaks are of the whole app, so a day rests only when every skill that
//   was in progress on it was paused; a pause of one skill among several changes nothing.
// - The forecast (pace.ts) leaves the skill's paused days out of its window, and says nothing
//   while the skill rests today.

import { localDate } from '../lib/clock';
import { addDays, addMonths, diffDays } from '../lib/dates';
import type { Pause, Skill } from './types';

/** The lengths the pause sheet offers; «До даты…» passes a date instead. */
export type PauseLength = 'week' | 'twoWeeks' | 'month' | 'open';

export const PAUSE_LENGTHS: readonly PauseLength[] = ['week', 'twoWeeks', 'month', 'open'];

/** The last day of a pause of that length that starts on `from`: a week is seven days, `from` included. */
export function pauseUntil(length: PauseLength, from: string): string | null {
  switch (length) {
    case 'week':
      return addDays(from, 6);
    case 'twoWeeks':
      return addDays(from, 13);
    case 'month':
      return addDays(addMonths(from, 1), -1);
    case 'open':
      return null;
  }
}

/** The furthest last day a pause set on `today` may have: a year ahead. */
export function latestPauseUntil(today: string): string {
  return addMonths(today, 12);
}

/** The date the pause covers. */
export function covers(pause: Pick<Pause, 'from' | 'until'>, date: string): boolean {
  return pause.from <= date && (pause.until === null || date <= pause.until);
}

/** Two pauses share at least one day. */
export function overlaps(a: Pick<Pause, 'from' | 'until'>, b: Pick<Pause, 'from' | 'until'>): boolean {
  return (a.until === null || a.until >= b.from) && (b.until === null || b.until >= a.from);
}

/** The skill's pause covering `date`, or null. */
export function pauseOn(pauses: readonly Pause[], skillId: string, date: string): Pause | null {
  return pauses.find((p) => p.skillId === skillId && covers(p, date)) ?? null;
}

/** «Is this skill paused on this date?» for one skill, as the forecast's `excluded` wants it. */
export function pausedDays(pauses: readonly Pause[], skillId: string): (date: string) => boolean {
  const own = pauses.filter((p) => p.skillId === skillId);
  return (date) => own.some((p) => covers(p, date));
}

/** «Is the skill of this id paused on this date?» over every pause (planForDate's `isPaused`). */
export function pausedSkills(pauses: readonly Pause[]): (skillId: string, date: string) => boolean {
  return (skillId, date) => pauses.some((p) => p.skillId === skillId && covers(p, date));
}

/** A pause whose last day is before `today`: it has ended by itself. */
export function isOver(pause: Pick<Pause, 'until'>, today: string): boolean {
  return pause.until !== null && pause.until < today;
}

/** Over by itself and not yet told: the next open says «… снова в плане» once. */
export function returnDue(pause: Pause, today: string): boolean {
  return pause.endedAt === null && isOver(pause, today);
}

/** The first day back in the plan, null for «пока не сниму». */
export function backOn(pause: Pick<Pause, 'until'>): string | null {
  return pause.until === null ? null : addDays(pause.until, 1);
}

/** Days of the pause inside from..to (both included). */
export function pausedDaysIn(pause: Pick<Pause, 'from' | 'until'>, from: string, to: string): number {
  const start = pause.from > from ? pause.from : from;
  const end = pause.until !== null && pause.until < to ? pause.until : to;
  return end < start ? 0 : diffDays(start, end) + 1;
}

type SkillSpan = Pick<Skill, 'id' | 'createdAt' | 'status' | 'archivedAt' | 'completedAt'>;

/**
 * The local dates the skill was in progress: from its creation day, through the day it was
 * archived or completed (null — still in progress). The skill as the snapshot has it: one taken
 * out of the archive counts as in progress all along.
 */
export function progressSpan(skill: Omit<SkillSpan, 'id'>): { since: string; stoppedAt: string | null } {
  return {
    since: localDate(new Date(skill.createdAt)),
    stoppedAt:
      skill.status === 'ARCHIVED' && skill.archivedAt
        ? localDate(new Date(skill.archivedAt))
        : skill.status === 'COMPLETED' && skill.completedAt
          ? localDate(new Date(skill.completedAt))
          : null,
  };
}

/**
 * The days the skill rested inside from..to (both included) while it was in progress: a pause
 * left on an archived or completed skill (written before those closed it) rests nothing after.
 */
export function restedDaysIn(skill: Omit<SkillSpan, 'id'>, pauses: readonly Pick<Pause, 'from' | 'until'>[], from: string, to: string): number {
  const span = progressSpan(skill);
  const start = span.since > from ? span.since : from;
  const end = span.stoppedAt !== null && span.stoppedAt < to ? span.stoppedAt : to;
  if (end < start) return 0;
  return pauses.reduce((days, pause) => days + pausedDaysIn(pause, start, end), 0);
}

/**
 * The rest days of the whole app for the streaks: a date on which at least one skill was in
 * progress and every skill in progress was paused (in progress: progressSpan). Memoised per
 * date: the streak walk asks about the same days again.
 */
export function restDays(snapshot: { skills: readonly SkillSpan[]; pauses?: readonly Pause[] }): (date: string) => boolean {
  const pauses = snapshot.pauses ?? [];
  if (pauses.length === 0) return () => false;
  const skills = snapshot.skills.map((skill) => ({ id: skill.id, ...progressSpan(skill) }));
  const paused = pausedSkills(pauses);
  const memo = new Map<string, boolean>();
  return (date) => {
    const known = memo.get(date);
    if (known !== undefined) return known;
    let inProgress = 0;
    let rest = true;
    for (const skill of skills) {
      if (skill.since > date || (skill.stoppedAt !== null && skill.stoppedAt < date)) continue;
      inProgress += 1;
      if (!paused(skill.id, date)) {
        rest = false;
        break;
      }
    }
    const result = rest && inProgress > 0;
    memo.set(date, result);
    return result;
  };
}
