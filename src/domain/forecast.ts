// «Когда дойду» (v0.5 package 14): the pace of the last four weeks turned into dates. Pure, on
// deci-points like the rest of the journal code. The pace, the rule for when a forecast exists
// and the level date are in pace.ts (part of the first paint, re-exported here); this module
// adds what only the lazy «Прогноз» needs: the milestone date and «А если к дате?».

import { diffDays } from '../lib/dates';
import { DECI, timedPoints, toDeci } from './points';
import { dateAtPace, horizonDays, type ForecastDate, type Pace } from './pace';
import { flaskCapacity, type CapacityConfig } from './progression';
import type { StepDefinition } from './types';

export {
  HORIZON_YEARS,
  MIN_ACTIVE_DAYS,
  PACE_WINDOW_DAYS,
  canForecast,
  datedDeltas,
  forecastLevel,
  levelForecast,
  measurePace,
  type DatedDelta,
  type ForecastDate,
  type LevelForecast,
  type Pace,
  type PaceInput,
} from './pace';

/**
 * Deci-points still missing to fill levels 1..`target`, walking the capacity rule level by level
 * (flaskCapacity: manual thresholds, then the increment). Stops once the sum passes `cap`, so a
 * milestone of a thousand levels costs no more than the horizon it is compared with. Null when
 * the milestone is already reached; Infinity past `cap`.
 */
export function remainingToLevel(total: number, target: number, config: CapacityConfig, cap = Infinity): number | null {
  const have = toDeci(total);
  let need = 0;
  for (let level = 1; level <= target; level++) {
    need += toDeci(flaskCapacity(level, config));
    if (need - have > cap) return Infinity;
  }
  return need > have ? need - have : null;
}

/**
 * The date the milestone's target level is reached («Цель «B2» — примерно в марте 2027»); null
 * when it is reached already or lies past the horizon.
 */
export function forecastMilestone(total: number, target: number, config: CapacityConfig, pace: Pace, today: string): ForecastDate | null {
  if (pace.deci <= 0) return null;
  const cap = Math.ceil((pace.deci * horizonDays(today)) / pace.days);
  const remaining = remainingToLevel(total, target, config, cap);
  if (remaining === null || remaining === Infinity) return null;
  return dateAtPace(remaining, pace, today);
}

export interface RequiredPace {
  /** Whole points per week that reach the milestone by the date (rounded up). */
  perWeek: number;
  /** Days from today to the date. */
  days: number;
  /** The current pace gets there by the date already. */
  onPace: boolean;
}

/**
 * «А если к дате?»: the points per week that reach the milestone by `targetDate` — the inverse of
 * forecastMilestone, so a pace of exactly `perWeek` gives that date back. Null for a date that is
 * not after today and for a milestone already reached.
 */
export function requiredPace(
  total: number,
  target: number,
  config: CapacityConfig,
  today: string,
  targetDate: string,
  pace: Pace | null = null,
): RequiredPace | null {
  const days = diffDays(today, targetDate);
  if (!(days >= 1)) return null;
  const remaining = remainingToLevel(total, target, config);
  if (remaining === null) return null;
  return {
    perWeek: Math.max(1, Math.ceil((remaining * 7) / (days * DECI))),
    days,
    onPace: pace !== null && pace.deci > 0 && pace.deci * days >= remaining * pace.days,
  };
}

export interface StepPace {
  stepId: string;
  name: string;
  type: StepDefinition['type'];
  /** Points of one completion: the step's points, or its usual minutes × rate. */
  points: number;
  /** A TIMED step's usual minutes; null for BOOLEAN. */
  minutes: number | null;
  /** Completions per week of this step alone that cover the points (rounded up). */
  timesPerWeek: number;
}

/**
 * Translates points per week into actions: for each active step, how many times a week that
 * step alone would cover them. A TIMED step counts at its usual minutes («по 30 мин»); one
 * without usual minutes, or worth 0 points, cannot say and is left out.
 */
export function paceInActions(perWeek: number, steps: readonly StepDefinition[]): StepPace[] {
  const out: StepPace[] = [];
  for (const step of steps) {
    if (!step.isActive) continue;
    const minutes = step.type === 'TIMED' ? step.defaultMinutes : null;
    if (step.type === 'TIMED' && (minutes === null || step.pointsPerMinute === null)) continue;
    const points = step.type === 'TIMED' ? timedPoints(minutes!, step.pointsPerMinute!) : step.points;
    if (!(points > 0)) continue;
    out.push({
      stepId: step.id,
      name: step.name,
      type: step.type,
      points,
      minutes,
      timesPerWeek: Math.ceil(toDeci(perWeek) / toDeci(points)),
    });
  }
  return out;
}
