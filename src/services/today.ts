// «Сегодня» v2 as a read model: what a date holds (domain/schedule.ts planForDate) and what
// was done on it. The plan is computed on every read and never stored (FR-TD-002/003): a date
// that passes with something undone simply stops being shown, with no status and no trace.
// `date` is today (from useToday) or a past day picked on the week strip. A skill paused on the
// date (package 18, domain/pause.ts) is out of the plan altogether — no row in «Осталось», no
// quota, nothing in «Ещё» — and is named once in `paused` instead.

import { db } from '../data/db';
import { addDays, localDate, monthStart, weekStart } from '../lib/dates';
import { compareJournalOrder } from '../domain/progression';
import { pausedSkills, restDays } from '../domain/pause';
import { planForDate, type PlannedItem } from '../domain/schedule';
import type { Pause, Skill, StepCompletion, StepDefinition } from '../domain/types';
import { byActivity, lastActivityBySkill, overviewTables, readSummaryRows, skillSummaries, type HomeSkillSummary } from './queries';

/** A planned step with its skill and its ACTIVE completions dated on the plan's date. */
export interface PlanRow extends PlannedItem {
  skill: Skill;
  count: number;
}

export interface TodayStep {
  step: StepDefinition;
  /** ACTIVE completions of the step dated on the plan's date. */
  count: number;
  /** Local date of the step's latest ACTIVE completion, null without one. */
  lastDoneAt: string | null;
}

export interface ExtraGroup {
  summary: HomeSkillSummary;
  /** Most recently done first, then oldest first. Never empty. */
  steps: TodayStep[];
}

export interface DayPlan {
  date: string;
  /** «Осталось»: DAILY/WEEKDAYS steps due on the date and not done yet. */
  due: PlanRow[];
  /** Quota steps whose period still asks for more (x/N), week quotas and month quotas together. */
  quota: PlanRow[];
  /**
   * «Ещё»: every other active step of an active skill, grouped by skill as in «Сегодня» v1 —
   * MANUAL steps, due steps already done, met quotas, steps not planned on the date.
   */
  extra: ExtraGroup[];
  /** Completions dated on the date, cancelled ones included, newest first. */
  done: Array<{ completion: StepCompletion; skillName: string }>;
  /**
   * Steps due on the date (DAILY/WEEKDAYS), done or not. Quotas are not «for today» (decision
   * 14.5): they have their own x/N block and never count here.
   */
  totalPlanned: number;
  /** Of those, the ones done on the date. */
  totalDone: number;
  /** ACTIVE completions per day, Monday..Sunday of the date's week. */
  weekActivity: number[];
  /**
   * Monday..Sunday: a rest day of the whole app (every skill in progress paused, domain/pause.ts
   * restDays) without a completion, up to the plan's week's today — the strip draws it neutral.
   */
  weekRest: boolean[];
  /** Active skills in the plan (not paused on the date), most recently worked on first (the empty states name them). */
  skills: HomeSkillSummary[];
  /** Active skills paused on the date, in the same order, with their pause: «На паузе: Гитара до 10 октября». */
  paused: { skill: Skill; pause: Pause }[];
  /** Any skill on the device, archived and completed ones too: without one «Сегодня» is the first run. */
  hasSkills: boolean;
}

/** ACTIVE completions per date of the week starting `monday`, from rows that cover it. */
function countWeek(completions: readonly StepCompletion[], monday: string): number[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const counts = new Map<string, number>();
  for (const c of completions) if (c.status === 'ACTIVE') counts.set(c.date, (counts.get(c.date) ?? 0) + 1);
  return days.map((d) => counts.get(d) ?? 0);
}

/** ACTIVE completions per day of the week starting `monday` (Monday..Sunday). */
export async function getWeekActivity(monday: string): Promise<number[]> {
  const rows = await db.completions.where('[status+date]').between(['ACTIVE', monday], ['ACTIVE', addDays(monday, 6)], true, true).toArray();
  return countWeek(rows, monday);
}

/**
 * The plan of `date` for every active step of every active skill, with one indexed range read
 * of completions: from the earliest quota period start (the Monday or the 1st) to the end of
 * the date's week (the strip's dots; nothing is dated after today). The reads run in two
 * parallel rounds: Dexie keeps a transaction alive across native awaits for a bounded number
 * of microtasks only, so the chain of awaits inside it stays short. `today` bounds the rest days
 * of the strip (a day ahead is no rest yet).
 */
export async function getDayPlan(date: string, today: string = localDate()): Promise<DayPlan> {
  return db.transaction('r', overviewTables(), async () => {
    const monday = weekStart(date);
    const from = monday < monthStart(date) ? monday : monthStart(date);
    const [range, allSteps, summaryRows] = await Promise.all([
      db.completions.where('date').between(from, addDays(monday, 6), true, true).toArray(),
      db.steps.filter((s) => s.isActive).toArray(),
      readSummaryRows(),
    ]);
    const onDate = range.filter((c) => c.date === date);
    const isPaused = pausedSkills(summaryRows.pauses);
    const skillById = new Map(summaryRows.skills.filter((s) => s.status === 'ACTIVE' && !isPaused(s.id, date)).map((s) => [s.id, s]));
    const steps = allSteps.filter((step) => skillById.has(step.skillId));

    const count = new Map<string, number>();
    for (const c of onDate) if (c.status === 'ACTIVE') count.set(c.stepId, (count.get(c.stepId) ?? 0) + 1);
    const rows: PlanRow[] = planForDate(steps, range, date).map((item) => ({
      ...item,
      skill: skillById.get(item.step.skillId)!,
      count: count.get(item.step.id) ?? 0,
    }));
    const pending = rows.filter((row) => row.state === 'DUE');
    const listed = new Set(pending.map((row) => row.step.id));
    const dueOnDate = rows.filter((row) => row.period === null);

    // «Ещё» keeps v1's order: the latest ACTIVE completion per step through the [stepId+date] index.
    const rest = steps.filter((step) => !listed.has(step.id));
    const [lastActivity, lastDates] = await Promise.all([
      lastActivityBySkill(summaryRows.transactions),
      Promise.all(
        rest.map((step) =>
          db.completions
            .where('[stepId+date]')
            .between([step.id, ''], [step.id, '￿'])
            .reverse()
            .filter((c) => c.status === 'ACTIVE')
            .first(),
        ),
      ),
    ]);
    const summaries = skillSummaries(summaryRows, lastActivity, onDate, date);
    const active = summaries.filter((s) => s.skill.status === 'ACTIVE' && s.pause === null);
    const paused = summaries.flatMap((s) => (s.skill.status === 'ACTIVE' && s.pause ? [{ skill: s.skill, pause: s.pause }] : []));
    const lastDone = new Map<string, string>();
    rest.forEach((step, i) => {
      const c = lastDates[i];
      if (c) lastDone.set(step.id, c.date);
    });
    const extra = active
      .map((summary) => ({
        summary,
        steps: rest
          .filter((step) => step.skillId === summary.skill.id)
          .map((step) => ({ step, count: count.get(step.id) ?? 0, lastDoneAt: lastDone.get(step.id) ?? null }))
          .sort(byActivity((s: TodayStep) => s.lastDoneAt, (s) => s.step)),
      }))
      .filter((group) => group.steps.length > 0);

    const names = new Map(summaries.map((s) => [s.skill.id, s.skill.name]));
    const weekActivity = countWeek(range, monday);
    const restDay = restDays(summaryRows);
    const done = [...onDate]
      .sort((a, b) => compareJournalOrder(b, a))
      .map((completion) => ({ completion, skillName: names.get(completion.skillId) ?? '' }));

    return {
      date,
      due: pending.filter((row) => row.period === null),
      quota: pending.filter((row) => row.period !== null),
      extra,
      done,
      totalPlanned: dueOnDate.length,
      totalDone: dueOnDate.filter((row) => row.state === 'DONE').length,
      weekActivity,
      weekRest: weekActivity.map((n, i) => {
        const day = addDays(monday, i);
        return n === 0 && day <= today && restDay(day);
      }),
      skills: active,
      paused,
      hasSkills: summaryRows.skills.length > 0,
    };
  });
}
