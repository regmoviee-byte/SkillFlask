import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { completeStep, type MutationResult } from '../../services/completions';
import type { Skill, StepDefinition } from '../../domain/types';
import { DoubleSubmitError, SAME_TAP_MS } from '../../services/core';
import { haptics } from '../../platform/haptics';
import { useCelebrations } from '../celebrations/CelebrationProvider';
import { announceCompletion, errorMessage } from '../completionFeedback';
import { copy } from '../copy';
import { Icon } from './Icon';
import { useToast } from './Toast';

// One action of a skill: name, «сегодня ×2» and a 44px button «+5» that records a completion
// in one tap: the points fly into the flask, the button shows ✓ for a moment. Shared by the
// skill screen and (package 6) the Today tab.

/**
 * The green «done» state lasts this long after the write settles. The ✓ itself stays busy at
 * least that long and until the service's same-tap window (SAME_TAP_MS from the tap) has
 * passed, so a second tap never reaches the guard and never replaces the undo toast.
 */
export const BUSY_TAIL_MS = 600;

export interface StepRowProps {
  step: StepDefinition;
  skill: Pick<Skill, 'status'>;
  todayCount: number;
  /** 'edit' turns the row into a link to the step form. */
  mode: 'complete' | 'edit';
  onResult?(result: MutationResult): void;
}

export function StepRow({ step, skill, todayCount, mode, onResult }: StepRowProps) {
  const { showToast } = useToast();
  const celebrations = useCelebrations();
  const button = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
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
  // With the ✓ on screen the points sit on it; the line under the name counts today only.
  const meta = editing || !active ? copy.stepRow.meta(step.points, todayCount) : todayCount > 0 ? copy.stepRow.today(todayCount) : null;
  const text = (
    <span className="step-row-main">
      <span className="step-row-name">{step.name}</span>
      {meta && <span className="step-row-meta">{meta}</span>}
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

  async function complete() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    haptics.press();
    const tapStart = Date.now();
    // Freeze the flask on screen before the write, so the live query cannot move it before
    // the points have flown in.
    const release = celebrations.hold(step.skillId);
    try {
      const result = await completeStep(step.id);
      setDone(true);
      announceCompletion(result, step.name, showToast);
      void celebrations
        .celebrateResult(result, { skillId: step.skillId, source: button.current, points: result.pointsAwarded })
        .finally(release);
      onResult?.(result);
    } catch (error) {
      release();
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

  return (
    <li className="step-row">
      {text}
      {active && (
        <button
          ref={button}
          type="button"
          className={`check-button${done ? ' done' : ''}`}
          aria-label={copy.stepRow.check(step.name, step.points)}
          aria-busy={busy}
          onClick={complete}
        >
          {/* The points keep the button's width; the ✓ covers them while it is green. */}
          <span className="check-points">{copy.stepRow.points(step.points)}</span>
          {done && <Icon name="check" size={22} className="check-icon" />}
        </button>
      )}
    </li>
  );
}
