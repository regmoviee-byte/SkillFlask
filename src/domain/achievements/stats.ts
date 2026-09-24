// The accumulator the achievement rules read: one pass over the replay events (events.ts)
// updates it in place. Every rule of the catalogue is a cheap read of these numbers, so
// evaluating all of them after every event stays O(events × rules).

import { DayRecords } from '../streaks';
import type { HistorySnapshot, ReplayEvent } from './events';

export interface SkillStats {
  name: string;
  /** Status in the snapshot (the end of the history). */
  status: string;
  completedFlasks: number;
  totalPoints: number;
  milestoneTarget: number;
  /** Steps created so far that are still on the list at the end of the history. */
  activeSteps: number;
  /** Effective (ACTIVE) completions. */
  completions: number;
  /** Most flasks one effective completion filled. */
  maxLevelChange: number;
  /** Effective completions that filled a flask to the brim: nothing carried into the next. */
  exactFills: number;
  /** Distinct steps done per date. */
  datesToSteps: Map<string, Set<string>>;
}

export interface GlobalStats {
  skillsCreated: number;
  completions: number;
  totalCompletedFlasks: number;
  maxCompletedFlasksInSkill: number;
  completedSkills: number;
  /** Skills with at least as many filled flasks as their milestone asks. */
  milestonesReached: number;
  /** Skills with a flask filled beyond the milestone. */
  skillsBeyondMilestone: number;
  skillsWithFlask: number;
  maxActiveStepsInSkill: number;
  maxLevelChange: number;
  exactFills: number;
  /** Effective completions per date. */
  dateCounts: Map<string, number>;
  dateSkills: Map<string, Set<string>>;
  maxCompletionsInDay: number;
  maxDistinctSkillsInDay: number;
  maxDistinctStepsOneSkillInDay: number;
  /** The date records below, kept incrementally. */
  days: DayRecords;
  activeDays: number;
  /** Longest run of consecutive active dates: a record, never a current streak. */
  bestDayStreak: number;
  /** Weeks (Monday..Sunday) with at least three active dates. */
  rhythmWeeks: number;
}

export interface Stats {
  perSkill: Map<string, SkillStats>;
  global: GlobalStats;
  /** The skill of the event applied last: what a per-skill unlock is credited to. */
  eventSkillId: string | null;
}

const RHYTHM_DAYS = 3;

export function createStats(snapshot: Pick<HistorySnapshot, 'skills' | 'milestones'>): Stats {
  const perSkill = new Map<string, SkillStats>();
  for (const skill of snapshot.skills) {
    const milestone = snapshot.milestones.find((m) => m.skillId === skill.id);
    perSkill.set(skill.id, {
      name: skill.name,
      status: skill.status,
      completedFlasks: 0,
      totalPoints: 0,
      // A skill without a milestone row never counts as having reached one.
      milestoneTarget: milestone?.targetFlaskNumber ?? Number.POSITIVE_INFINITY,
      activeSteps: 0,
      completions: 0,
      maxLevelChange: 0,
      exactFills: 0,
      datesToSteps: new Map(),
    });
  }
  return {
    perSkill,
    eventSkillId: null,
    global: {
      skillsCreated: 0,
      completions: 0,
      totalCompletedFlasks: 0,
      maxCompletedFlasksInSkill: 0,
      completedSkills: 0,
      milestonesReached: 0,
      skillsBeyondMilestone: 0,
      skillsWithFlask: 0,
      maxActiveStepsInSkill: 0,
      maxLevelChange: 0,
      exactFills: 0,
      dateCounts: new Map(),
      dateSkills: new Map(),
      maxCompletionsInDay: 0,
      maxDistinctSkillsInDay: 0,
      maxDistinctStepsOneSkillInDay: 0,
      days: new DayRecords(RHYTHM_DAYS),
      activeDays: 0,
      bestDayStreak: 0,
      rhythmWeeks: 0,
    },
  };
}

/** Flask aggregates over all skills; recomputed only when a skill's flask count changed. */
function recountFlasks(stats: Stats): void {
  const g = stats.global;
  g.totalCompletedFlasks = 0;
  g.maxCompletedFlasksInSkill = 0;
  g.milestonesReached = 0;
  g.skillsBeyondMilestone = 0;
  g.skillsWithFlask = 0;
  for (const s of stats.perSkill.values()) {
    g.totalCompletedFlasks += s.completedFlasks;
    g.maxCompletedFlasksInSkill = Math.max(g.maxCompletedFlasksInSkill, s.completedFlasks);
    if (s.completedFlasks >= s.milestoneTarget) g.milestonesReached += 1;
    if (s.completedFlasks >= s.milestoneTarget + 1) g.skillsBeyondMilestone += 1;
    if (s.completedFlasks >= 1) g.skillsWithFlask += 1;
  }
}

/** Applies one replay event in place. */
export function applyEvent(stats: Stats, event: ReplayEvent): void {
  const g = stats.global;
  switch (event.kind) {
    case 'SKILL_CREATED':
      g.skillsCreated += 1;
      stats.eventSkillId = event.skill.id;
      return;
    case 'STEP_CREATED': {
      stats.eventSkillId = event.step.skillId;
      // A step hidden later never counts: «Набор инструментов» is about the list as it is.
      const s = stats.perSkill.get(event.step.skillId);
      if (!s || !event.step.isActive) return;
      s.activeSteps += 1;
      g.maxActiveStepsInSkill = Math.max(g.maxActiveStepsInSkill, s.activeSteps);
      return;
    }
    case 'SKILL_COMPLETED':
      g.completedSkills += 1;
      stats.eventSkillId = event.skill.id;
      return;
    case 'TX': {
      const { tx, after, completion } = event;
      stats.eventSkillId = tx.skillId;
      const s = stats.perSkill.get(tx.skillId);
      if (!s) return;
      s.totalPoints = after.totalPoints;
      if (s.completedFlasks !== after.completedFlasks) {
        s.completedFlasks = after.completedFlasks;
        recountFlasks(stats);
      }
      if (!event.effective || !completion) return;

      s.completions += 1;
      g.completions += 1;
      if (event.levelChange > s.maxLevelChange) s.maxLevelChange = event.levelChange;
      if (event.levelChange > g.maxLevelChange) g.maxLevelChange = event.levelChange;
      if (event.levelChange >= 1 && after.pointsInCurrentFlask === 0) {
        s.exactFills += 1;
        g.exactFills += 1;
      }

      const date = completion.date;
      const count = (g.dateCounts.get(date) ?? 0) + 1;
      g.dateCounts.set(date, count);
      g.maxCompletionsInDay = Math.max(g.maxCompletionsInDay, count);
      const skills = g.dateSkills.get(date) ?? new Set<string>();
      skills.add(tx.skillId);
      g.dateSkills.set(date, skills);
      g.maxDistinctSkillsInDay = Math.max(g.maxDistinctSkillsInDay, skills.size);
      const steps = s.datesToSteps.get(date) ?? new Set<string>();
      steps.add(completion.stepId);
      s.datesToSteps.set(date, steps);
      g.maxDistinctStepsOneSkillInDay = Math.max(g.maxDistinctStepsOneSkillInDay, steps.size);

      if (count === 1) {
        g.days.add(date);
        g.activeDays = g.days.activeDays;
        g.bestDayStreak = g.days.bestDayStreak;
        g.rhythmWeeks = g.days.rhythmWeeks;
      }
      return;
    }
  }
}
