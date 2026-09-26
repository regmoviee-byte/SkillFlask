import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, migrateBackup, wipeAllData } from '../data/backup';
import { db } from '../data/db';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock } from '../test/harness';
import { getAchievementsView } from './achievements';
import { registerAfterCommitHook } from './afterWrite';
import { completeStep } from './completions';
import { getSkillForecast } from './insights';
import { archiveSkill, restartSkill, restoreSkill } from './lifecycle';
import { changePauseUntil, endPause, pauseMessages, pauseSkill, takeReturns } from './pauses';
import { getHomeView, getSkillDetails } from './queries';
import { getRecapView } from './recap';
import { completeSkill, createSkill, deleteSkill, type SkillInput } from './skills';
import { createStep } from './steps';
import { getDayPlan } from './today';

const input = (name: string): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 10,
  capacityBase: 1000,
  capacityIncrement: 0,
  manualCapacities: [],
});

// Thursday 24 September 2026, local time; the clock ticks 2 s per read.
const TODAY = '2026-09-24';
const MONDAY = '2026-09-21';
installFreshDb();
beforeEach(() => setClock(tickingClock(`${MONDAY}T08:00:00`)));
const at = (date: string) => setClock(tickingClock(`${date}T12:00:00`));

describe('pauseSkill', () => {
  it('starts today and lasts until the chosen day, or «пока не сниму»', async () => {
    const skill = await createSkill(input('Гитара'));
    at(TODAY);
    const pause = await pauseSkill(skill, '2026-09-30');
    expect(pause).toMatchObject({ skillId: skill, from: TODAY, until: '2026-09-30', endedAt: null });
    expect(await db.pauses.toArray()).toEqual([pause]);
    const open = await pauseSkill(await createSkill(input('Бег')), null);
    expect(open.until).toBeNull();
  });

  it('refuses a second pause while one runs, and one on a skill that is not active', async () => {
    const skill = await createSkill(input('Гитара'));
    at(TODAY);
    await pauseSkill(skill, null);
    await expect(pauseSkill(skill, '2026-10-01')).rejects.toThrow(pauseMessages.already);
    const archived = await createSkill(input('Бег'));
    await archiveSkill(archived);
    await expect(pauseSkill(archived, null)).rejects.toThrow('Навык не активен');
    expect(await db.pauses.count()).toBe(1);
  });

  it('refuses a last day before today or further than a year', async () => {
    const skill = await createSkill(input('Гитара'));
    at(TODAY);
    await expect(pauseSkill(skill, '2026-09-23')).rejects.toThrow(pauseMessages.date);
    await expect(pauseSkill(skill, '2027-09-25')).rejects.toThrow(pauseMessages.date);
    await expect(pauseSkill(skill, 'soon')).rejects.toThrow(pauseMessages.date);
    expect((await pauseSkill(skill, '2027-09-24')).until).toBe('2027-09-24');
  });

  it('may follow a pause that ran out, and closes it quietly', async () => {
    const skill = await createSkill(input('Гитара'));
    await pauseSkill(skill, '2026-09-22');
    at(TODAY);
    const next = await pauseSkill(skill, null);
    const rows = (await db.pauses.toArray()).sort((a, b) => (a.from < b.from ? -1 : 1));
    expect(rows.map((p) => [p.from, p.until])).toEqual([
      [MONDAY, '2026-09-22'],
      [TODAY, null],
    ]);
    expect(rows[0]!.endedAt).not.toBeNull();
    expect(next.endedAt).toBeNull();
    expect(await takeReturns(TODAY)).toEqual([]);
  });
});

describe('changePauseUntil and endPause', () => {
  it('move the last day sooner or later, never before today', async () => {
    const skill = await createSkill(input('Гитара'));
    await pauseSkill(skill, '2026-09-27');
    at(TODAY);
    expect((await changePauseUntil(skill, '2026-10-10')).until).toBe('2026-10-10');
    expect((await changePauseUntil(skill, null)).until).toBeNull();
    expect((await changePauseUntil(skill, TODAY)).until).toBe(TODAY);
    await expect(changePauseUntil(skill, '2026-09-23')).rejects.toThrow(pauseMessages.date);
    // The first day stays: the days already rested do not change.
    expect((await db.pauses.toArray()).map((p) => p.from)).toEqual([MONDAY]);
  });

  it('take a pause off: the days rested stay, today is back in the plan', async () => {
    const skill = await createSkill(input('Гитара'));
    await pauseSkill(skill, null);
    at(TODAY);
    await endPause(skill);
    const [row] = await db.pauses.toArray();
    expect(row).toMatchObject({ from: MONDAY, until: '2026-09-23' });
    expect(row!.endedAt).not.toBeNull();
    expect((await getSkillDetails(skill, TODAY))!.pause).toBeNull();
    await expect(endPause(skill)).rejects.toThrow(pauseMessages.none);
    await expect(changePauseUntil(skill, null)).rejects.toThrow(pauseMessages.none);
  });

  it('delete a pause set and taken off on the same day: it covered nothing', async () => {
    const skill = await createSkill(input('Гитара'));
    await pauseSkill(skill, '2026-09-28');
    await endPause(skill);
    expect(await db.pauses.count()).toBe(0);
  });

  it('keep every copy restorable when the date moves back after «Снять паузу»', async () => {
    const skill = await createSkill(input('Гитара'));
    await pauseSkill(skill, null);
    at(TODAY);
    await endPause(skill);
    // A flight west across midnight: yesterday again, and the pause taken off covers it.
    at('2026-09-23');
    const next = await changePauseUntil(skill, null);
    expect(next).toMatchObject({ from: MONDAY, until: null, endedAt: null });
    const file = await exportBackup();
    await wipeAllData();
    await importBackup(migrateBackup(JSON.parse(JSON.stringify(file))));
    expect(await db.pauses.toArray()).toEqual([next]);
  });

  it('change the pause covering today, and refuse a last day running into another pause', async () => {
    const skill = await createSkill(input('Гитара'));
    // Two pauses back to back; the date has moved back into the first one.
    await db.pauses.bulkAdd([
      { id: 'later', skillId: skill, from: '2026-09-26', until: null, createdAt: `${MONDAY}T08:00:00.000Z`, endedAt: null },
      { id: 'first', skillId: skill, from: MONDAY, until: '2026-09-25', createdAt: `${MONDAY}T08:00:00.000Z`, endedAt: '2026-09-26T08:00:00.000Z' },
    ]);
    at(TODAY);
    expect((await changePauseUntil(skill, '2026-09-24')).id).toBe('first');
    await expect(changePauseUntil(skill, '2026-09-27')).rejects.toThrow(pauseMessages.overlap);
    await expect(changePauseUntil(skill, null)).rejects.toThrow(pauseMessages.overlap);
    await endPause(skill);
    expect((await db.pauses.get('first'))!.until).toBe('2026-09-23');
    expect((await db.pauses.get('later'))!.until).toBeNull();
  });
});

describe('archive and completion', () => {
  it('take a running pause off: no «Отдых» in later recaps, and a restore brings no pause back', async () => {
    at('2026-08-31');
    const guitar = await createSkill(input('Гитара'));
    await createSkill(input('Бег'));
    at('2026-09-01');
    await pauseSkill(guitar, null);
    at('2026-09-03');
    await archiveSkill(guitar);
    expect(await db.pauses.toArray()).toEqual([expect.objectContaining({ from: '2026-09-01', until: '2026-09-02' })]);
    at(TODAY);
    expect((await getRecapView('2026-09-21', TODAY)).recap.rested).toEqual([]);
    expect((await getRecapView('2026-08-31', TODAY)).recap.rested).toEqual([{ skillId: guitar, days: 2 }]);
    await restoreSkill(guitar);
    expect((await getSkillDetails(guitar, TODAY))!.pause).toBeNull();
    expect((await getDayPlan(TODAY, TODAY)).paused).toEqual([]);
  });

  it('a completed skill rests no more either', async () => {
    const skill = await createSkill({ ...input('Бег'), milestoneTarget: 1, capacityBase: 100 });
    const step = await createStep({ skillId: skill, name: 'Пробежка', points: 100 });
    await completeStep(step);
    await pauseSkill(skill, null);
    at(TODAY);
    await completeSkill(skill);
    expect(await db.pauses.toArray()).toEqual([expect.objectContaining({ from: MONDAY, until: '2026-09-23' })]);
  });

  it('only the days in progress count in the recap, for a pause left open on an archived skill', async () => {
    at('2026-08-31');
    const guitar = await createSkill(input('Гитара'));
    at('2026-09-03');
    await archiveSkill(guitar);
    await db.pauses.add({ id: 'old', skillId: guitar, from: '2026-09-01', until: null, createdAt: '2026-09-01T08:00:00.000Z', endedAt: null });
    at(TODAY);
    expect((await getRecapView('2026-09-21', TODAY)).recap.rested).toEqual([]);
    expect((await getRecapView('2026-08-31', TODAY)).recap.rested).toEqual([{ skillId: guitar, days: 3 }]);
  });
});

describe('takeReturns', () => {
  it('tells each skill back in the plan once, oldest skill first', async () => {
    const guitar = await createSkill(input('Гитара'));
    const running = await createSkill(input('Бег'));
    const reading = await createSkill(input('Чтение'));
    await pauseSkill(running, '2026-09-22');
    await pauseSkill(guitar, '2026-09-23');
    await pauseSkill(reading, '2026-09-30');
    expect(await takeReturns(MONDAY)).toEqual([]);
    at(TODAY);
    expect(await takeReturns(TODAY)).toEqual([
      { id: guitar, name: 'Гитара' },
      { id: running, name: 'Бег' },
    ]);
    expect(await takeReturns(TODAY)).toEqual([]);
    // Telling changes no day: the pause still covered Monday to its last day.
    expect((await db.pauses.where('skillId').equals(guitar).first())).toMatchObject({ from: MONDAY, until: '2026-09-23' });
  });

  it('keeps an archived skill’s pause untold until the skill is back', async () => {
    const guitar = await createSkill(input('Гитара'));
    await archiveSkill(guitar);
    // A pause left open on an archived skill (written before the archive took pauses off).
    await db.pauses.add({ id: 'old', skillId: guitar, from: MONDAY, until: '2026-09-22', createdAt: `${MONDAY}T08:00:00.000Z`, endedAt: null });
    at(TODAY);
    expect(await takeReturns(TODAY)).toEqual([]);
    expect((await db.pauses.toArray())[0]!.endedAt).toBeNull();
  });

  it('schedules the backup for a quiet endedAt too, while another pause still rests the skill', async () => {
    const guitar = await createSkill(input('Гитара'));
    await db.pauses.bulkAdd([
      { id: 'a', skillId: guitar, from: MONDAY, until: '2026-09-22', createdAt: `${MONDAY}T08:00:00.000Z`, endedAt: null },
      { id: 'b', skillId: guitar, from: '2026-09-23', until: null, createdAt: `${MONDAY}T08:00:00.000Z`, endedAt: null },
    ]);
    let writes = 0;
    const off = registerAfterCommitHook(() => {
      writes += 1;
    });
    try {
      at(TODAY);
      expect(await takeReturns(TODAY)).toEqual([]);
      expect((await db.pauses.get('a'))!.endedAt).not.toBeNull();
      expect(writes).toBe(1);
      // Nothing left to tell: no write, no backup.
      expect(await takeReturns(TODAY)).toEqual([]);
      expect(writes).toBe(1);
    } finally {
      off();
    }
  });
});

describe('read models of a paused skill', () => {
  async function twoSkills() {
    const guitar = await createSkill(input('Гитара'));
    const chords = await createStep({ skillId: guitar, name: 'Аккорды', points: 5, schedule: { kind: 'DAILY' } });
    const songs = await createStep({ skillId: guitar, name: 'Песни', points: 5, schedule: { kind: 'TIMES_PER_WEEK', times: 3 } });
    await createStep({ skillId: guitar, name: 'Гаммы', points: 2 });
    const running = await createSkill(input('Бег'));
    const run = await createStep({ skillId: running, name: 'Пробежка', points: 5, schedule: { kind: 'DAILY' } });
    return { guitar, chords, songs, running, run };
  }

  it('«Сегодня»: nothing of the paused skill is planned, one line names it', async () => {
    const { guitar, chords, running, run } = await twoSkills();
    at('2026-09-22');
    await pauseSkill(guitar, '2026-09-30');
    at(TODAY);
    const plan = await getDayPlan(TODAY, TODAY);
    expect(plan.due.map((r) => r.step.id)).toEqual([run]);
    expect(plan.quota).toEqual([]);
    expect(plan.extra.flatMap((g) => g.steps.map((s) => s.step.skillId))).toEqual([]);
    expect(plan.skills.map((s) => s.skill.id)).toEqual([running]);
    expect(plan.paused).toEqual([expect.objectContaining({ skill: expect.objectContaining({ id: guitar }), pause: expect.objectContaining({ until: '2026-09-30' }) })]);
    // Only Guitar rests: the days are ordinary days for the strip.
    expect(plan.weekRest).toEqual([false, false, false, false, false, false, false]);
    // Monday, before the pause, the plan is as it was.
    const monday = await getDayPlan(MONDAY, TODAY);
    expect(monday.due.map((r) => r.step.id).sort()).toEqual([chords, run].sort());
    expect(monday.paused).toEqual([]);
  });

  it('draws the week strip neutral on the days the whole app rested, but not a day with practice', async () => {
    const { guitar, running, run } = await twoSkills();
    at('2026-09-22');
    await pauseSkill(guitar, null);
    await pauseSkill(running, null);
    at(TODAY);
    await completeStep(run, { date: '2026-09-23' });
    const plan = await getDayPlan(TODAY, TODAY);
    expect(plan.skills).toEqual([]);
    expect(plan.paused.map((p) => p.skill.name)).toEqual(['Бег', 'Гитара']);
    expect(plan.weekRest).toEqual([false, true, false, true, false, false, false]);
    expect((await getHomeView(TODAY)).weekRest).toEqual(plan.weekRest);
  });

  it('the home card and the skill screen carry the pause; no forecast while it rests', async () => {
    const { guitar, chords } = await twoSkills();
    for (const date of ['2026-09-10', '2026-09-12', '2026-09-14', '2026-09-16']) await completeStep(chords, { date });
    at(TODAY);
    expect((await getSkillDetails(guitar, TODAY))!.hasForecast).toBe(true);
    await pauseSkill(guitar, '2026-10-01');
    const home = await getHomeView(TODAY);
    expect(home.summaries.find((s) => s.skill.id === guitar)!.pause).toMatchObject({ until: '2026-10-01' });
    expect(home.summaries.find((s) => s.skill.id !== guitar)!.pause).toBeNull();
    const details = (await getSkillDetails(guitar, TODAY))!;
    expect(details.pause).toMatchObject({ from: TODAY, until: '2026-10-01' });
    expect(details.hasForecast).toBe(false);
    expect(await getSkillForecast(guitar, TODAY)).toBeNull();
    // After the pause, its days stay out of the pace: 26 days since the first row, 8 of them rested.
    const after = await getSkillForecast(guitar, '2026-10-05');
    expect(after!.pace.days).toBe(26 - 8);
  });

  it('bridges the streak for the achievements and the records, and the recap says who rested', async () => {
    at('2026-09-01');
    const { chords, guitar } = await twoSkills();
    at(TODAY);
    const running = (await db.skills.where('status').equals('ACTIVE').toArray()).find((s) => s.id !== guitar)!.id;
    for (const date of ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']) await completeStep(chords, { date });
    at('2026-09-13');
    // Both skills rest Sunday to Tuesday: the whole app rested.
    await pauseSkill(guitar, '2026-09-15');
    await pauseSkill(running, '2026-09-15');
    at(TODAY);
    const view = await getAchievementsView();
    expect(view.records.bestStreak).toEqual({ days: 7, start: '2026-09-10', end: '2026-09-19' });
    expect(view.ladders.find((l) => l.def.id === 'series')!.current).toBe(7);
    const recap = await getRecapView('2026-09-07', TODAY);
    expect(recap.recap.rested.map((r) => [recap.skillNames[r.skillId], r.days])).toEqual([
      ['Гитара', 1],
      ['Бег', 1],
    ]);
  });

  it('is deleted with its skill and never copied by «Начать заново»', async () => {
    const { guitar, running } = await twoSkills();
    await pauseSkill(guitar, null);
    await pauseSkill(running, null);
    // Archived later: the pause keeps the days it rested.
    at(TODAY);
    await archiveSkill(running);
    const copy = await restartSkill(running);
    expect(await db.pauses.where('skillId').equals(copy).count()).toBe(0);
    await deleteSkill(guitar);
    expect((await db.pauses.toArray()).map((p) => p.skillId)).toEqual([running]);
  });
});
