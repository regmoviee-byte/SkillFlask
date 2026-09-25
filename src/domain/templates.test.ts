import { describe, expect, it } from 'vitest';
import { copy } from '../ui/copy';
import { isProgressTheme, isSkillColor } from './appearance';
import { validateSchedule } from './schedule';
import { TEMPLATE_KEYS, isTemplateKey } from './templateKeys';
import { completionPoints, planBalance, plannedWeekdays, TEMPLATES, templateBalance, templateByKey, templateCapacities } from './templates';
import type { Weekday } from './types';

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

describe('the template catalogue', () => {
  it('has the twelve keys of templateKeys.ts, in that order', () => {
    expect(TEMPLATES.map((t) => t.key)).toEqual([...TEMPLATE_KEYS]);
    expect(TEMPLATES).toHaveLength(12);
    expect(templateByKey('running')?.name).toBe('Бег');
    expect(templateByKey('custom')).toBeNull();
    expect(isTemplateKey('chess')).toBe(true);
    expect(isTemplateKey('custom')).toBe(false);
    expect(isTemplateKey('toString')).toBe(false);
  });

  it('names the first run’s chips as the catalogue does', () => {
    for (const { key, name } of copy.firstRun.popular) expect(templateByKey(key)?.name).toBe(name);
  });

  it('fills every field the form shows, within the form’s limits', () => {
    for (const t of TEMPLATES) {
      expect(t.name.length, t.key).toBeLessThanOrEqual(100);
      expect(t.milestoneName.length, t.key).toBeLessThanOrEqual(100);
      expect(t.description.length, t.key).toBeLessThanOrEqual(60);
      for (const label of [t.startLabel, t.targetLabel]) {
        expect(label.length, t.key).toBeGreaterThan(0);
        expect(label.length, t.key).toBeLessThanOrEqual(40);
      }
      expect(isProgressTheme(t.theme), t.key).toBe(true);
      expect(isSkillColor(t.color), t.key).toBe(true);
      expect(Number.isInteger(t.capacityBase) && t.capacityBase >= 1, t.key).toBe(true);
      expect(Number.isInteger(t.capacityIncrement) && t.capacityIncrement >= 0, t.key).toBe(true);
      expect(Number.isInteger(t.milestoneTarget) && t.milestoneTarget >= 1, t.key).toBe(true);
    }
  });

  it('gives every template 2–4 actions a planned week can count', () => {
    for (const t of TEMPLATES) {
      expect(t.steps.length, t.key).toBeGreaterThanOrEqual(2);
      expect(t.steps.length, t.key).toBeLessThanOrEqual(4);
      expect(new Set(t.steps.map((s) => s.name)).size, t.key).toBe(t.steps.length);
      for (const step of t.steps) {
        expect(() => validateSchedule(step.schedule), step.name).not.toThrow();
        // No monthly quotas: the planned week could not count them.
        expect(step.schedule.kind, step.name).not.toBe('TIMES_PER_MONTH');
        if (step.type === 'TIMED') {
          // A timed action is planned at its usual minutes.
          expect(step.defaultMinutes, step.name).toBeGreaterThan(0);
          expect(step.points, step.name).toBeUndefined();
        } else {
          expect(step.pointsPerMinute, step.name).toBeUndefined();
        }
        expect(completionPoints(step), step.name).toBeGreaterThan(0);
      }
      // At least two actions are part of the plan (a MANUAL one is an extra).
      expect(t.steps.filter((s) => s.schedule.kind !== 'MANUAL').length, t.key).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the balance rule', () => {
  it('spreads a weekly quota over the week and plans the due days as they are', () => {
    expect(plannedWeekdays({ kind: 'DAILY' })).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plannedWeekdays({ kind: 'WEEKDAYS', days: [2, 6] })).toEqual([2, 6]);
    expect(plannedWeekdays({ kind: 'TIMES_PER_WEEK', times: 1 })).toEqual([1]);
    expect(plannedWeekdays({ kind: 'TIMES_PER_WEEK', times: 2 })).toEqual([1, 4]);
    expect(plannedWeekdays({ kind: 'TIMES_PER_WEEK', times: 3 })).toEqual([1, 3, 5]);
    expect(plannedWeekdays({ kind: 'TIMES_PER_WEEK', times: 7 })).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plannedWeekdays({ kind: 'TIMES_PER_WEEK', times: 12 })).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plannedWeekdays({ kind: 'MANUAL' })).toEqual([]);
    expect(plannedWeekdays({ kind: 'TIMES_PER_MONTH', times: 4 })).toEqual([]);
  });

  it('counts a timed action at its usual minutes, in exact tenths', () => {
    expect(completionPoints({ type: 'TIMED', pointsPerMinute: 0.25, defaultMinutes: 25 })).toBe(6.3);
    expect(completionPoints({ type: 'TIMED', pointsPerMinute: 0.5 })).toBe(0);
    expect(completionPoints({ type: 'BOOLEAN', points: 5 })).toBe(5);
  });

  it('simulates the planned days from the start weekday', () => {
    // 10 a day on Mon–Fri against a level of 30 and a milestone of 3 levels (30 + 40 + 50).
    const steps = [{ type: 'BOOLEAN' as const, points: 10, schedule: { kind: 'WEEKDAYS' as const, days: [1, 2, 3, 4, 5] as Weekday[] } }];
    const config = { base: 30, increment: 10, manual: [] };
    expect(planBalance(steps, config, 3, 1)).toEqual({ weekPoints: 50, firstLevelDays: 3, milestoneDays: 16 });
    // Started on a Saturday, the weekend brings nothing.
    expect(planBalance(steps, config, 3, 6).firstLevelDays).toBe(5);
    // Manual capacities count as the form has them.
    expect(planBalance(steps, { ...config, manual: [10] }, 1, 1).firstLevelDays).toBe(1);
    // A plan of extras only never gets anywhere.
    expect(planBalance([{ type: 'BOOLEAN', points: 10, schedule: { kind: 'MANUAL' } }], config, 3)).toEqual({ weekPoints: 0, firstLevelDays: Infinity, milestoneDays: Infinity });
  });

  // The rule documented in templates.ts: done as planned, level 1 fills in 7–10 days whatever
  // the start weekday, and the milestone comes in 2–4 months.
  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s: level 1 in 7–10 days, the milestone in 2–4 months', (_key, template) => {
    for (const start of WEEKDAYS) {
      const { firstLevelDays, milestoneDays, weekPoints } = templateBalance(template, start);
      expect(weekPoints).toBeGreaterThan(0);
      expect(firstLevelDays, `level 1, start ${start}`).toBeGreaterThanOrEqual(7);
      expect(firstLevelDays, `level 1, start ${start}`).toBeLessThanOrEqual(10);
      expect(milestoneDays, `milestone, start ${start}`).toBeGreaterThanOrEqual(60);
      expect(milestoneDays, `milestone, start ${start}`).toBeLessThanOrEqual(122);
    }
    expect(templateCapacities(template)).toEqual({ base: template.capacityBase, increment: template.capacityIncrement, manual: [] });
  });
});
