import { useId, useRef, useState } from 'react';
import type { Progress } from '../../domain/progression';
import type { Milestone, Skill } from '../../domain/types';
import { canCompleteSkill } from '../../domain/milestone';
import { completeSkill, continueAfterMilestone } from '../../services/skills';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { useCelebrations } from '../celebrations/CelebrationProvider';
import { errorMessage } from '../completionFeedback';
import { copy } from '../copy';
import { Icon } from './Icon';
import { useToast } from './Toast';

// The milestone card of the skill screen: a shelf of mini flasks up to the target (a bar when
// the target is above 12), and once the milestone is reached the choice «Завершить» /
// «Продолжить», which never has to be made right away (FR-MS-005).

const SHELF_MAX = 12;

interface MilestoneRackProps {
  skill: Skill;
  milestone: Milestone | undefined;
  /** The progress on display (frozen while a celebration plays). */
  progress: Progress;
}

export function MilestoneRack({ skill, milestone, progress }: MilestoneRackProps) {
  const { showToast } = useToast();
  const { celebrate } = useCelebrations();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const clipId = `rack${useId().replace(/[^\w-]/g, '')}`;
  const t = copy.milestone;
  if (!milestone) return null;

  const target = milestone.targetFlaskNumber;
  const done = Math.min(progress.completedFlasks, target);

  if (skill.status === 'COMPLETED') {
    return (
      <section className="card card-padded rack rack--completed">
        <div className="rack-head">
          <span className="rack-name">
            <Icon name="trophy" size={20} />
            {milestone.name}
          </span>
        </div>
        <p className="rack-text">{t.completedAt(skill.completedAt ?? skill.updatedAt, progress.completedFlasks, progress.totalPoints)}</p>
      </section>
    );
  }

  const active = skill.status === 'ACTIVE';
  const reached = milestone.reachedAt !== null;

  // Rule: a double tap must not queue two confirmations; the ref flips before the first await.
  async function guarded(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function finish() {
    if (busyRef.current) return;
    // dialogs.confirm runs synchronously in the click handler, before any await.
    const answer = dialogs.confirm(t.confirmFinish(skill.name), { okLabel: t.finish });
    void guarded(async () => {
      if (!(await answer)) return;
      await completeSkill(skill.id);
      void celebrate([{ kind: 'skillCompleted', skillId: skill.id }], { skillId: skill.id });
    });
  }

  const keepGoing = () =>
    guarded(async () => {
      await continueAfterMilestone(skill.id);
      haptics.tap();
      showToast(copy.celebration.continued);
    });

  return (
    <section className={`card card-padded rack${reached && active ? ' rack--reached' : ''}`}>
      <div className="rack-head">
        <span className="rack-name">
          <Icon name="flag" size={20} />
          {milestone.name}
          {reached && (
            <span className="rack-laurel" role="img" aria-label={copy.skill.milestoneReachedIcon}>
              <Icon name="laurel" size={16} />
            </span>
          )}
        </span>
        <span className="t-caption hint">{t.progress(done, target)}</span>
      </div>
      {target <= SHELF_MAX ? (
        <div className="rack-shelf" role="img" aria-label={t.progress(done, target)}>
          <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
            <clipPath id={clipId}>
              <path d={MINI_INNER} />
            </clipPath>
          </svg>
          {Array.from({ length: target }, (_, i) => (
            <MiniFlask key={i} clipId={clipId} fill={i < progress.completedFlasks ? 1 : i === progress.completedFlasks ? progress.fill : 0} />
          ))}
        </div>
      ) : (
        <div className="bar rack-bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={done} aria-label={t.progress(done, target)}>
          <div className="bar-fill" style={{ width: `${(done / target) * 100}%` }} />
        </div>
      )}
      {reached && (
        <>
          <p className="rack-text">
            {t.reachedAt(milestone.reachedAt!)}
            {/* The decision is only offered while the skill is active (an archived one waits). */}
            {active && ` ${milestone.decision === 'CONTINUE' ? t.continuing : t.decide}`}
          </p>
          {canCompleteSkill(skill, milestone) && (
            <div className="button-row">
              <button type="button" className="button button-primary" disabled={busy} onClick={finish}>
                {t.finish}
              </button>
              {milestone.decision !== 'CONTINUE' && (
                <button type="button" className="button" disabled={busy} onClick={keepGoing}>
                  {t.keepGoing}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// 18 × 30: a small tube with a rounded bottom; the liquid is a rect clipped to its inside.
const MINI_GLASS = 'M4 3 V21 A5 5 0 0 0 14 21 V3 Z';
const MINI_INNER = 'M5.5 3 V21 A3.5 3.5 0 0 0 12.5 21 V3 Z';
const MINI_TOP = 3;
const MINI_BOTTOM = 26;

function MiniFlask({ fill, clipId }: { fill: number; clipId: string }) {
  const f = Math.min(1, Math.max(0, fill));
  const y = MINI_BOTTOM - f * (MINI_BOTTOM - MINI_TOP);
  return (
    <svg className={`mini-flask${f >= 1 ? ' is-full' : ''}`} viewBox="0 0 18 30" aria-hidden="true" focusable="false">
      <path d={MINI_GLASS} className="mini-flask-glass" />
      {f > 0 && <rect x="0" y={y} width="18" height={MINI_BOTTOM - y + 1} className="mini-flask-liquid" clipPath={`url(#${clipId})`} />}
      <rect x="2" y="1.5" width="14" height="3" rx="1.5" className="mini-flask-rim" />
    </svg>
  );
}
