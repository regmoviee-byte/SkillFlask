// «Пауза» as a service (v0.5 package 18): set, change and take off a skill's pause, and tell the
// owner when one ran out by itself. The rules of what a pause does live in domain/pause.ts; the
// rows only say which days rest. Every write that changes the paused days re-runs the
// achievement sync in its transaction: rest days bridge «Лучшая серия», so a pause can open (or
// a shorter one close) that ladder's tiers — quietly, with their historical dates.

import { db } from '../data/db';
import { addDays, isValidLocalDate, localDate, nowIso } from '../lib/dates';
import { newId } from '../lib/ids';
import { covers, isOver, latestPauseUntil, overlaps, returnDue } from '../domain/pause';
import type { Pause } from '../domain/types';
import { afterWrite, syncInTransaction } from './afterWrite';
import { journalTables, requireActiveSkill, requireSkill, ValidationError } from './core';

export const pauseMessages = {
  already: 'Навык уже на паузе',
  none: 'Навык сейчас не на паузе',
  date: 'Выберите дату не раньше сегодняшней и не дальше чем через год',
  overlap: 'На эти дни у навыка уже есть другая пауза',
} as const;

/**
 * The skill's pause that is not over on `today`: the one covering it first, else one starting
 * later. The app never writes a pause that starts after the day it is set, but the local date
 * can move back (a flight west across midnight, a clock fixed by hand), and then a pause taken
 * off «tomorrow» or a later row counts as not over again — the covering one is the running one.
 */
function openPause(pauses: readonly Pause[], today: string): Pause | undefined {
  return pauses.find((p) => covers(p, today)) ?? pauses.find((p) => !isOver(p, today));
}

/**
 * Takes the skill's running pause off inside the caller's transaction: it keeps the days it
 * has rested (last day yesterday, `endedAt` now), and one that covers nothing before today is
 * deleted. Returns false when the skill has no running pause. «Снять паузу», and the archive
 * and the completion of a skill: a skill out of progress has nothing left to rest from, and a
 * forgotten «пока не сниму» must neither fill every later «Итоги недели» nor come back with a
 * restore.
 */
export async function closePauseInTransaction(skillId: string, today: string, now: string): Promise<boolean> {
  const current = openPause(await db.pauses.where('skillId').equals(skillId).toArray(), today);
  if (!current) return false;
  if (current.from >= today) await db.pauses.delete(current.id);
  else await db.pauses.update(current.id, { until: addDays(today, -1), endedAt: now });
  return true;
}

/** A last day for a pause set or changed on `today`: today at the earliest, a year ahead at the latest. */
function requireUntil(until: string | null, today: string, from: string): string | null {
  if (until === null) return null;
  if (!isValidLocalDate(until) || until < today || until < from || until > latestPauseUntil(today)) throw new ValidationError(pauseMessages.date);
  return until;
}

/**
 * «Поставить на паузу»: the pause starts today and lasts until `until` included (null — «пока
 * не сниму»). Only an active skill rests, and one pause at a time: a second one is refused.
 * A pause that ran out without being told yet is closed quietly first.
 */
export async function pauseSkill(skillId: string, until: string | null): Promise<Pause> {
  const now = nowIso();
  const today = localDate();
  const pause = await db.transaction('rw', journalTables(), async () => {
    requireActiveSkill(await requireSkill(skillId));
    const pauses = await db.pauses.where('skillId').equals(skillId).toArray();
    if (openPause(pauses, today)) throw new ValidationError(pauseMessages.already);
    const stale = pauses.filter((p) => returnDue(p, today));
    if (stale.length) await db.pauses.bulkUpdate(stale.map((p) => ({ key: p.id, changes: { endedAt: now } })));
    const row: Pause = { id: newId(), skillId, from: today, until: requireUntil(until, today, today), createdAt: now, endedAt: null };
    await db.pauses.add(row);
    await syncInTransaction({ skillId, now });
    return row;
  });
  await afterWrite();
  return pause;
}

/**
 * «Изменить дату»: a new last day for the running pause (sooner or later, today at the earliest),
 * or null to rest «пока не сниму». The days already rested stay as they were.
 */
export async function changePauseUntil(skillId: string, until: string | null): Promise<Pause> {
  const now = nowIso();
  const today = localDate();
  const pause = await db.transaction('rw', journalTables(), async () => {
    requireActiveSkill(await requireSkill(skillId));
    const pauses = await db.pauses.where('skillId').equals(skillId).toArray();
    const current = openPause(pauses, today);
    if (!current) throw new ValidationError(pauseMessages.none);
    // Running again from here on: a pause taken off before the date moved back loses its
    // `endedAt` (a pause without a last day has never ended), and it tells its return anew.
    const next: Pause = { ...current, until: requireUntil(until, today, current.from), endedAt: null };
    if (pauses.some((p) => p.id !== current.id && overlaps(p, next))) throw new ValidationError(pauseMessages.overlap);
    await db.pauses.put(next);
    await syncInTransaction({ skillId, now });
    return next;
  });
  await afterWrite();
  return pause;
}

/**
 * «Снять паузу»: the skill is back in the plan today. The pause keeps the days it has rested —
 * its last day becomes yesterday, `endedAt` says when it was taken off; one set today covers
 * nothing yet and is simply deleted. Allowed on an archived or completed skill too, for a pause
 * written before the archive and the completion started closing it (closePauseInTransaction).
 */
export async function endPause(skillId: string): Promise<void> {
  const now = nowIso();
  const today = localDate();
  await db.transaction('rw', journalTables(), async () => {
    await requireSkill(skillId);
    if (!(await closePauseInTransaction(skillId, today, now))) throw new ValidationError(pauseMessages.none);
    await syncInTransaction({ skillId, now });
  });
  await afterWrite();
}

/**
 * The first open after a pause's last day: every active skill whose pause ran out by itself and
 * was not told yet is marked (endedAt) and returned, oldest skill first — the app says «Гитара
 * снова в плане» once. Paused days do not change, so the achievements need no sync. An archived
 * or completed skill is not in any plan: its pause stays untold until it is active again.
 */
export async function takeReturns(today: string = localDate()): Promise<{ id: string; name: string }[]> {
  const now = nowIso();
  const { back, wrote } = await db.transaction('rw', [db.skills, db.pauses], async () => {
    const due = (await db.pauses.toArray()).filter((p) => returnDue(p, today));
    if (due.length === 0) return { back: [], wrote: false };
    const skills = new Map((await db.skills.bulkGet([...new Set(due.map((p) => p.skillId))])).flatMap((s) => (s ? [[s.id, s] as const] : [])));
    const told = due.filter((p) => skills.get(p.skillId)?.status === 'ACTIVE');
    // Still resting under a later pause (another row covering today): nothing to tell yet.
    const all = await db.pauses.toArray();
    const returning = told.filter((p) => !all.some((other) => other.skillId === p.skillId && covers(other, today)));
    if (told.length) await db.pauses.bulkUpdate(told.map((p) => ({ key: p.id, changes: { endedAt: now } })));
    const ids = [...new Set(returning.map((p) => p.skillId))];
    const back = ids
      .map((id) => skills.get(id)!)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map((s) => ({ id: s.id, name: s.name }));
    return { back, wrote: told.length > 0 };
  });
  // Every write schedules the backup, a quiet `endedAt` too.
  if (wrote) await afterWrite();
  return back;
}
