import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { completeStep, type MutationResult } from '../../services/completions';
import type { Skill, StepDefinition } from '../../domain/types';
import { describeSchedule } from '../../domain/schedule';
import { localDate } from '../../lib/dates';
import { DoubleSubmitError, SAME_TAP_MS } from '../../services/core';
import { haptics } from '../../platform/haptics';
import { useCelebrations } from '../celebrations/CelebrationProvider';
import { errorMessage, writeCompletion } from '../completionFeedback';
import { copy } from '../copy';
import { copyForSkill } from '../progress/registry';
import { MinutesSheet } from '../sheets/MinutesSheet';
import { useTimer } from '../timer/context';
import { Icon } from './Icon';
import { useToast } from './Toast';

// One action of a skill: name, a caption («каждый день · сегодня ×2») and a 44px button «+5»
// that records a completion in one tap: the points fly into the flask, the button shows ✓ for
// a moment. A TIMED action shows its rate («0,5/мин») and asks «Сколько минут?» first; beside
// it a ▶ starts the live timer (package 15; not on a past day picked on «Сегодня»: a timer
// records the day it runs). Shared by the skill screen and «Сегодня» (where it may record on a
// past day and show a quota x/N).

/**
 * The green «done» state lasts this long after the write settles. The ✓ itself stays busy at
 * least that long and until the service's same-tap window (SAME_TAP_MS from the tap) has
 * passed, so a second tap never reaches the guard and never replaces the undo toast.
 */
export const BUSY_TAIL_MS = 600;

/** What one completion of the step is worth, as its ✓ shows it: «+5» or «0,5/мин». */
export function stepValue(step: Pick<StepDefinition, 'type' | 'points' | 'pointsPerMinute'>): string {
  return step.type === 'TIMED' ? copy.stepRow.rate(step.pointsPerMinute ?? 0) : copy.stepRow.points(step.points);
}

/** The schedule as a caption, or null for a manual step (most steps: the caption would be noise). */
export function scheduleCaption(step: Pick<StepDefinition, 'schedule'>): string | null {
  return step.schedule.kind === 'MANUAL' ? null : describeSchedule(step.schedule);
}

export interface StepRowProps {
  step: StepDefinition;
  /** Its status gates the ✓; its theme names the level in the undo toast. */
  skill: Pick<Skill, 'status'> & Partial<Pick<Skill, 'theme'>>;
  /** ACTIVE completions of the step on the row's date (today unless `date` says otherwise). */
  todayCount: number;
  /** 'edit' turns the row into a link to the step form. */
  mode: 'complete' | 'edit';
  onResult?(result: MutationResult): void;
  /** The local date the ✓ records on: a past day picked on «Сегодня»; today when omitted. */
  date?: string;
  /** Leads the caption: the skill's name where rows of several skills meet («Сегодня»). */
  context?: string;
  /** A quota row: done of target in the current period, with a segmented bar instead of the schedule. */
  quota?: { done: number; target: number };
  /** Drawn at the start of the caption: the skill's colour dot on a busy «Сегодня» (package 18). */
  marker?: ReactNode;
}

export function StepRow({ step, skill, todayCount, mode, onResult, date, context, quota, marker }: StepRowProps) {
  const { showToast } = useToast();
  const celebrations = useCelebrations();
  const timer = useTimer();
  const button = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [askMinutes, setAskMinutes] = useState(false);
  // The state update lands on the next render; the ref closes the gap for a fast second tap.
  const busyRef = useRef(false);
  const doneTimer = useRef<number | undefined>(undefined);
  const busyTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(doneTimer.current);
      window.clearTimeout(busyTimer.current);
    },
    [],
  );

  const active = skill.status === 'ACTIVE';
  const editing = mode === 'edit' && active;
  const timed = step.type === 'TIMED';
  const past = date !== undefined && date !== localDate();
  const count = todayCount > 0 ? (past ? copy.stepRow.onDate(todayCount) : copy.stepRow.today(todayCount)) : null;
  // With the ✓ on screen the value sits on it; otherwise the caption starts with it.
  const parts = [
    editing || !active ? stepValue(step) : null,
    context ?? null,
    quota ? copy.today.quotaProgress(quota.done, quota.target) : scheduleCaption(step),
    count,
  ].filter(Boolean);
  const text = (
    <span className="step-row-main">
      <span className="step-row-name">{step.name}</span>
      {parts.length > 0 && (
        <span className="step-row-meta">
          {marker}
          {parts.join(' · ')}
        </span>
      )}
      {quota && <QuotaBar done={quota.done} target={quota.target} />}
    </span>
  );

  if (editing) {
    return (
      <li>
        <Link to={`/steps/${step.id}/edit`} className="step-row pressable-row">
          {text}
          <Icon name="chevron-right" size={20} className="step-row-chevron" />
        </Link>
      </li>
    );
  }

  function tap() {
    if (busyRef.current) return;
    if (timed) {
      haptics.tap();
      setAskMinutes(true);
      return;
    }
    void record();
  }

  /** `minutes` and `note` come from «Сколько минут?» (a TIMED action), which has its own note field. */
  async function record(minutes?: number, note?: string | null) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    haptics.press();
    const tapStart = Date.now();
    try {
      const result = await writeCompletion(() => completeStep(step.id, { date, minutes, note }), {
        skillId: step.skillId,
        stepName: step.name,
        levels: copyForSkill(skill),
        source: button.current,
        showToast,
        celebrations,
        noteField: minutes !== undefined,
      });
      setDone(true);
      onResult?.(result);
    } catch (error) {
      // A double submit that slipped past the busy flag (another row of the same step, a slow
      // device): the first completion landed and its toast with «Отменить» stays on screen.
      if (!(error instanceof DoubleSubmitError)) {
        haptics.error();
        showToast(errorMessage(error));
      }
    } finally {
      doneTimer.current = window.setTimeout(() => setDone(false), BUSY_TAIL_MS);
      busyTimer.current = window.setTimeout(
        () => {
          busyRef.current = false;
          setBusy(false);
        },
        Math.max(BUSY_TAIL_MS, SAME_TAP_MS - (Date.now() - tapStart)),
      );
    }
  }

  const timing = timer.stepId === step.id;
  return (
    <li className={`step-row${quota ? ' quota-row' : ''}`}>
      {text}
      {timed && active && !past && (
        <button
          type="button"
          className={`timer-button${timing ? ' is-running' : ''}`}
          aria-label={timing ? copy.stepRow.openTimer(step.name) : copy.stepRow.startTimer(step.name)}
          // The confirm «Остановить таймер …?» must open inside the tap (Telegram's popup).
          onClick={() => timer.start(step)}
        >
          <Icon name="play" filled size={20} />
        </button>
      )}
      {active && (
        <button
          ref={button}
          type="button"
          className={`check-button${done ? ' done' : ''}`}
          aria-label={timed ? copy.stepRow.checkTimed(step.name, step.pointsPerMinute ?? 0) : copy.stepRow.check(step.name, step.points)}
          aria-busy={busy}
          aria-haspopup={timed ? 'dialog' : undefined}
          onClick={tap}
        >
          {/* The value keeps the button's width; the ✓ covers it while it is green. */}
          <span className="check-points">{stepValue(step)}</span>
          {done && <Icon name="check" size={22} className="check-icon" />}
        </button>
      )}
      {timed && active && (
        <MinutesSheet open={askMinutes} step={step} onClose={() => setAskMinutes(false)} onDone={(minutes, { note }) => void record(minutes, note)} />
      )}
    </li>
  );
}

/** Up to ten segments for x of N; a plain bar beyond that. Never red: an empty segment is just empty. */
const MAX_SEGMENTS = 10;

export function QuotaBar({ done, target }: { done: number; target: number }) {
  const label = copy.today.quotaBar(done, target);
  if (target > MAX_SEGMENTS) {
    return (
      <span className="quota-bar bar" role="img" aria-label={label}>
        <span className="bar-fill" style={{ width: `${Math.min(100, (done / target) * 100)}%` }} />
      </span>
    );
  }
  return (
    <span className="quota-bar quota-segments" role="img" aria-label={label}>
      {Array.from({ length: target }, (_, i) => (
        <span key={i} className={`quota-segment${i < done ? ' is-done' : ''}`} />
      ))}
    </span>
  );
}
