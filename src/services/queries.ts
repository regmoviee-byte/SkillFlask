import { db } from '../data/db';
import { addDays, localDate, weekStart } from '../lib/dates';
import { fromDeci, toDeci } from '../domain/points';
import { compareJournalOrder, computeProgress, foldJournal, type CapacityConfig, type Progress } from '../domain/progression';
import type { LevelThreshold, Milestone, PointTransaction, Skill, StepCompletion, StepDefinition } from '../domain/types';

// Read models for the UI. Everything is derived from the journal on every read (principle 8),
// inside a read transaction so a mutation in flight never produces a half-updated view.

export interface SkillSummary {
  skill: Skill;
  milestone: Milestone | undefined;
  progress: Progress;
}

export interface SkillDetails extends SkillSummary {
  config: CapacityConfig;
  /** Active steps, oldest first. */
  steps: StepDefinition[];
  /** Steps removed from the list («Убранные действия»), most recently changed first. */
  hiddenSteps: StepDefinition[];
  /** ACTIVE completions dated today, per active step id (steps without any are absent). */
  todayCounts: Record<string, number>;
  /** Local date of the latest ACTIVE completion per step id (active and hidden), null without one. */
  lastDoneAt: Record<string, string | null>;
}

function configOf(skill: Skill, manual: number[]): CapacityConfig {
  return { base: skill.capacityBase, increment: skill.capacityIncrement, manual };
}

function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

type SummaryRows = {
  skills: Skill[];
  milestones: Milestone[];
  thresholds: LevelThreshold[];
  transactions: PointTransaction[];
};

/** Progress of every skill from rows read in one transaction; skills keep their given order. */
function summarize({ skills, milestones, thresholds, transactions }: SummaryRows): SkillSummary[] {
  const sorted = [...transactions].sort(compareJournalOrder);
  return skills.map((skill) => {
    const manual = thresholds
      .filter((t) => t.skillId === skill.id)
      .sort((a, b) => a.flaskNumber - b.flaskNumber)
      .map((t) => t.requiredPoints);
    const total = foldJournal(sorted.filter((t) => t.skillId === skill.id).map((t) => t.delta));
    return {
      skill,
      milestone: milestones.find((m) => m.skillId === skill.id),
      progress: computeProgress(total, configOf(skill, manual)),
    };
  });
}

async function readSummaryRows(): Promise<SummaryRows> {
  const [skills, milestones, thresholds, transactions] = await Promise.all([
    db.skills.orderBy('createdAt').toArray(),
    db.milestones.toArray(),
    db.levelThresholds.toArray(),
    db.transactions.toArray(),
  ]);
  return { skills, milestones, thresholds, transactions };
}

export async function listSkillSummaries(): Promise<SkillSummary[]> {
  return db.transaction('r', [db.skills, db.milestones, db.levelThresholds, db.transactions], async () => summarize(await readSummaryRows()));
}

// ---- Home and Today ----

export interface HomeSkillSummary extends SkillSummary {
  /** Points of the skill's ACTIVE completions dated today. */
  todayPoints: number;
  /** createdAt of the latest ACTIVE completion (when the skill was last worked on), null without one. */
  lastActivityAt: string | null;
}

export interface HomeView {
  /** Active skills first by last activity, then completed and archived ones (see sortSkills). */
  summaries: HomeSkillSummary[];
  /** Points of all ACTIVE completions dated today. */
  todayPoints: number;
  /** Monday..Sunday of the current week: true on a date with at least one ACTIVE completion. */
  weekActivity: boolean[];
  /** Filled flasks over every skill, completed and archived ones included. */
  totalFlasks: number;
  lastMilestone: { skillId: string; skillName: string; name: string; reachedAt: string } | null;
}

export interface TodayStep {
  step: StepDefinition;
  /** ACTIVE completions of the step dated today. */
  todayCount: number;
  /** Local date of the step's latest ACTIVE completion, null without one. */
  lastDoneAt: string | null;
}

export interface TodayGroup {
  summary: HomeSkillSummary;
  /** Active steps, most recently done first, then oldest first. May be empty. */
  steps: TodayStep[];
}

export interface TodayView {
  today: string;
  todayPoints: number;
  weekActivity: boolean[];
  /** ACTIVE skills only, most recently worked on first; nothing planned is stored. */
  groups: TodayGroup[];
  /** Completions dated today, cancelled ones included, newest first. */
  done: Array<{ completion: StepCompletion; skillName: string }>;
}

const newestFirst = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);

/** Most recent activity first; never-used ones after them, oldest created first. */
function byActivity<T>(activity: (item: T) => string | null, created: (item: T) => { createdAt: string }) {
  return (a: T, b: T) => newestFirst(activity(a), activity(b)) || byCreatedAt(created(a), created(b));
}

const STATUS_ORDER: Record<Skill['status'], number> = { ACTIVE: 0, COMPLETED: 1, ARCHIVED: 2 };

/** Active skills by last activity; completed ones by completion and archived ones by archiving date, newest first. */
function sortSkills(summaries: HomeSkillSummary[]): HomeSkillSummary[] {
  const stamp = (s: HomeSkillSummary) =>
    s.skill.status === 'ACTIVE' ? s.lastActivityAt : s.skill.status === 'COMPLETED' ? s.skill.completedAt : s.skill.archivedAt;
  return [...summaries].sort(
    (a, b) => STATUS_ORDER[a.skill.status] - STATUS_ORDER[b.skill.status] || byActivity(stamp, (s) => s.skill)(a, b),
  );
}

/** Monday..Sunday of the week of `today`, as dates. */
export function weekDates(today: string): string[] {
  const monday = weekStart(today);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * createdAt of every skill's latest ACTIVE completion. The journal is in memory already (the
 * progress needs all of it), so the newest COMPLETION rows name the candidates and only those
 * completions are read, a round per cancelled one met, instead of every completion ever made.
 */
async function lastActivityBySkill(transactions: PointTransaction[]): Promise<Map<string, string>> {
  const candidates = new Map<string, string[]>();
  for (const t of [...transactions].sort((a, b) => compareJournalOrder(b, a))) {
    if (t.reason !== 'COMPLETION' || !t.completionId) continue;
    const list = candidates.get(t.skillId);
    if (list) list.push(t.completionId);
    else candidates.set(t.skillId, [t.completionId]);
  }
  const last = new Map<string, string>();
  let round = 0;
  let pending = [...candidates.keys()];
  while (pending.length > 0) {
    const found = await db.completions.bulkGet(pending.map((skillId) => candidates.get(skillId)![round]!));
    round += 1;
    pending = pending.filter((skillId, i) => {
      const c = found[i];
      if (c?.status === 'ACTIVE') {
        last.set(skillId, c.createdAt);
        return false;
      }
      return round < candidates.get(skillId)!.length;
    });
  }
  return last;
}

/**
 * Everything both screens need. Completions are read by index for this week and today only;
 * the journal is read whole, as for every progress.
 */
async function readOverview(today: string) {
  const week = weekDates(today);
  const [rows, weekActive, todayAll] = await Promise.all([
    readSummaryRows(),
    db.completions.where('[status+date]').between(['ACTIVE', week[0]!], ['ACTIVE', week[6]!], true, true).toArray(),
    db.completions.where('date').equals(today).toArray(),
  ]);
  const lastActivity = await lastActivityBySkill(rows.transactions);
  const activeDates = new Set(weekActive.map((c) => c.date));
  const todayDeci = new Map<string, number>();
  for (const c of todayAll) {
    if (c.status === 'ACTIVE') todayDeci.set(c.skillId, (todayDeci.get(c.skillId) ?? 0) + toDeci(c.pointsAwarded));
  }
  const summaries = sortSkills(
    summarize(rows).map((s) => ({
      ...s,
      todayPoints: fromDeci(todayDeci.get(s.skill.id) ?? 0),
      lastActivityAt: lastActivity.get(s.skill.id) ?? null,
    })),
  );
  const todayPoints = fromDeci([...todayDeci.values()].reduce((sum, d) => sum + d, 0));
  return { summaries, todayCompletions: todayAll, todayPoints, weekActivity: week.map((d) => activeDates.has(d)) };
}

const overviewTables = () => [db.skills, db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions];

/**
 * The home screen in one live query: the skills with their flask, today's points and the
 * week's active days, the flasks filled so far and the last milestone reached.
 */
export async function getHomeView(today: string = localDate()): Promise<HomeView> {
  return db.transaction('r', overviewTables(), async () => {
    const { summaries, todayPoints, weekActivity } = await readOverview(today);
    const reached = summaries
      .filter((s) => s.milestone?.reachedAt)
      .sort((a, b) => newestFirst(a.milestone!.reachedAt, b.milestone!.reachedAt))[0];
    return {
      summaries,
      todayPoints,
      weekActivity,
      totalFlasks: summaries.reduce((sum, s) => sum + s.progress.completedFlasks, 0),
      lastMilestone: reached
        ? { skillId: reached.skill.id, skillName: reached.skill.name, name: reached.milestone!.name, reachedAt: reached.milestone!.reachedAt! }
        : null,
    };
  });
}

/**
 * «Сегодня» v1, without schedules: every active step of every active skill, one tap away, and
 * what was done today. Nothing is planned or stored for a day, so a day without completions
 * leaves no trace (FR-TD-003). `today` comes from useToday() so the view turns at midnight.
 */
export async function getTodayView(today: string = localDate()): Promise<TodayView> {
  return db.transaction('r', overviewTables(), async () => {
    const [{ summaries, todayCompletions, todayPoints, weekActivity }, allSteps] = await Promise.all([
      readOverview(today),
      db.steps.filter((s) => s.isActive).toArray(),
    ]);
    const activeSkills = new Set(summaries.filter((s) => s.skill.status === 'ACTIVE').map((s) => s.skill.id));
    const steps = allSteps.filter((step) => activeSkills.has(step.skillId));
    const todayCount = new Map<string, number>();
    for (const c of todayCompletions) {
      if (c.status === 'ACTIVE') todayCount.set(c.stepId, (todayCount.get(c.stepId) ?? 0) + 1);
    }
    // The latest ACTIVE completion per step, newest date first through the [stepId+date] index.
    const lastDates = await Promise.all(
      steps.map((step) =>
        db.completions
          .where('[stepId+date]')
          .between([step.id, ''], [step.id, '\uffff'])
          .reverse()
          .filter((c) => c.status === 'ACTIVE')
          .first(),
      ),
    );
    const lastDone = new Map<string, string>();
    steps.forEach((step, i) => {
      const c = lastDates[i];
      if (c) lastDone.set(step.id, c.date);
    });
    const groups = summaries
      .filter((s) => s.skill.status === 'ACTIVE')
      .map((summary) => ({
        summary,
        steps: steps
          .filter((step) => step.skillId === summary.skill.id)
          .map((step) => ({ step, todayCount: todayCount.get(step.id) ?? 0, lastDoneAt: lastDone.get(step.id) ?? null }))
          .sort(byActivity((s: TodayStep) => s.lastDoneAt, (s) => s.step)),
      }));
    const names = new Map(summaries.map((s) => [s.skill.id, s.skill.name]));
    const done = [...todayCompletions]
      .sort((a, b) => compareJournalOrder(b, a))
      .map((completion) => ({ completion, skillName: names.get(completion.skillId) ?? '' }));
    return { today, todayPoints, weekActivity, groups, done };
  });
}

/** Where the app opens: «Сегодня» once an active skill has an action to tap, the skills otherwise. */
export async function hasActiveSteps(): Promise<boolean> {
  return db.transaction('r', [db.skills, db.steps], async () => {
    const active = new Set((await db.skills.where('status').equals('ACTIVE').primaryKeys()) as string[]);
    return (await db.steps.filter((s) => s.isActive && active.has(s.skillId)).count()) > 0;
  });
}

/**
 * `today` is the local date the view is for: screens pass it from useToday() and list it in
 * the live query's deps, so a screen left open across midnight re-reads «сегодня ×N».
 */
export async function getSkillDetails(id: string, today: string = localDate()): Promise<SkillDetails | null> {
  return db.transaction(
    'r',
    [db.skills, db.milestones, db.levelThresholds, db.steps, db.completions, db.transactions],
    async () => {
      const skill = await db.skills.get(id);
      if (!skill) return null;
      const [milestone, thresholds, steps, completions, transactions] = await Promise.all([
        db.milestones.where('skillId').equals(id).first(),
        db.levelThresholds.where('skillId').equals(id).sortBy('flaskNumber'),
        db.steps.where('skillId').equals(id).toArray(),
        db.completions.where('skillId').equals(id).toArray(),
        db.transactions.where('skillId').equals(id).toArray(),
      ]);
      const activeSteps = steps.filter((s) => s.isActive).sort(byCreatedAt);
      const doneToday = activeSteps.length
        ? await db.completions
            .where('[stepId+date]')
            .anyOf(activeSteps.map((s) => [s.id, today]))
            .filter((c) => c.status === 'ACTIVE')
            .toArray()
        : [];
      const todayCounts: Record<string, number> = {};
      for (const c of doneToday) todayCounts[c.stepId] = (todayCounts[c.stepId] ?? 0) + 1;
      const lastDoneAt: Record<string, string | null> = Object.fromEntries(steps.map((s) => [s.id, null]));
      for (const c of completions) {
        const last = lastDoneAt[c.stepId];
        if (c.status === 'ACTIVE' && (last == null || c.date > last)) lastDoneAt[c.stepId] = c.date;
      }

      const config = configOf(skill, thresholds.map((t) => t.requiredPoints));
      // The history list has its own read model (services/history.ts).
      const total = foldJournal(transactions.sort(compareJournalOrder).map((t) => t.delta));
      return {
        skill,
        milestone,
        config,
        progress: computeProgress(total, config),
        steps: activeSteps,
        hiddenSteps: steps.filter((s) => !s.isActive).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
        todayCounts,
        lastDoneAt,
      };
    },
  );
}

export async function getSkillFormData(id: string): Promise<{ skill: Skill; milestone: Milestone | undefined; manual: number[] } | null> {
  return db.transaction('r', [db.skills, db.milestones, db.levelThresholds], async () => {
    const skill = await db.skills.get(id);
    if (!skill) return null;
    const [milestone, thresholds] = await Promise.all([
      db.milestones.where('skillId').equals(id).first(),
      db.levelThresholds.where('skillId').equals(id).sortBy('flaskNumber'),
    ]);
    return { skill, milestone, manual: thresholds.map((t) => t.requiredPoints) };
  });
}

export interface DataOverview {
  skills: number;
  /** Active steps (hidden ones are not counted). */
  steps: number;
  /** ACTIVE completions. */
  completions: number;
  /** Distinct dates with an ACTIVE completion in the 14 days ending `today` (the MVP criterion). */
  activeDays14: number;
}

/** Counts for the «Данные» and «О приложении» settings groups. */
export async function getDataOverview(today: string = localDate()): Promise<DataOverview> {
  return db.transaction('r', [db.skills, db.steps, db.completions], async () => {
    const from = addDays(today, -13);
    const [skills, steps, completions, recent] = await Promise.all([
      db.skills.count(),
      db.steps.filter((s) => s.isActive).count(),
      db.completions.where('[status+date]').between(['ACTIVE', ''], ['ACTIVE', '\uffff']).count(),
      db.completions.where('[status+date]').between(['ACTIVE', from], ['ACTIVE', today], true, true).toArray(),
    ]);
    return { skills, steps, completions, activeDays14: new Set(recent.map((c) => c.date)).size };
  });
}

/** The skill and its milestone as stored right now: what a celebration needs after a write. */
export async function getSkillWithMilestone(id: string): Promise<{ skill: Skill; milestone: Milestone | undefined } | null> {
  return db.transaction('r', [db.skills, db.milestones], async () => {
    const skill = await db.skills.get(id);
    if (!skill) return null;
    return { skill, milestone: await db.milestones.where('skillId').equals(id).first() };
  });
}
