import { useRef, useState, type CSSProperties } from 'react';
import type { Progress } from '../../domain/progression';
import type { Milestone, Skill } from '../../domain/types';
import { canCompleteSkill } from '../../domain/milestone';
import { completeSkill, continueAfterMilestone } from '../../services/skills';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { useCelebrations } from '../celebrations/CelebrationProvider';
import { errorMessage } from '../completionFeedback';
import { copy } from '../copy';
import { ProgressMini } from '../progress/ProgressHero';
import { copyForSkill, skillTheme } from '../progress/registry';
import { Icon } from './Icon';
import { useToast } from './Toast';

// The milestone card of the skill screen: a shelf of the theme's minis up to the target (a bar
// when the target is above 12; two tiers above 6), and once the milestone is reached the choice «Завершить» /
// «Продолжить», which never has to be made right away (FR-MS-005).

const SHELF_MAX = 12;
/** Up to this many minis stand in one row; more go on two tiers of equal length. */
const ROW_MAX = 6;
const MINI_SIZE = 28;

interface MilestoneRackProps {
  skill: Skill;
  milestone: Milestone | undefined;
  /** The progress on display (frozen while a celebration plays). */
  progress: Progress;
  /** «Начать заново» on the card of a completed skill (section 6). */
  onRestart?(): void;
  restartBusy?: boolean;
}

export function MilestoneRack({ skill, milestone, progress, onRestart, restartBusy = false }: MilestoneRackProps) {
  const { showToast } = useToast();
  const { celebrate } = useCelebrations();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const t = copy.milestone;
  const lc = copyForSkill(skill);
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
        <p className="rack-text">{lc.completedAt(skill.completedAt ?? skill.updatedAt, progress.completedFlasks, progress.totalPoints)}</p>
        {onRestart && (
          <button type="button" className="button button-block rack-restart" disabled={restartBusy} onClick={onRestart}>
            {copy.lifecycle.restart}
          </button>
        )}
      </section>
    );
  }

  const active = skill.status === 'ACTIVE';
  // Reached as far as the flask on screen shows: while a celebration holds the progress below
  // the target, the ring, laurel and buttons wait for the flask (and the milestone sheet).
  const reached = milestone.reachedAt !== null && progress.completedFlasks >= target;

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
        <span className="t-caption hint">{lc.milestoneProgress(done, target)}</span>
      </div>
      {target <= SHELF_MAX ? (
        <div
          className="rack-shelf"
          role="img"
          aria-label={lc.milestoneProgress(done, target)}
          style={{ '--rack-columns': target > ROW_MAX ? Math.ceil(target / 2) : target } as CSSProperties}
        >
          {Array.from({ length: target }, (_, i) => {
            const fill = i < progress.completedFlasks ? 1 : i === progress.completedFlasks ? progress.fill : 0;
            return (
              <span key={i} className={`rack-slot${fill >= 1 ? ' is-full' : ''}`} aria-hidden="true">
                <ProgressMini theme={skillTheme(skill.theme)} fill={fill} state={fill > 0 ? 'active' : 'empty'} size={MINI_SIZE} level={i + 1} />
              </span>
            );
          })}
        </div>
      ) : (
        <div className="bar rack-bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={done} aria-label={lc.milestoneProgress(done, target)}>
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
