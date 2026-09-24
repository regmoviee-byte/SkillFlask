import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillDetails, type HistoryEntry, type SkillDetails } from '../../services/queries';
import { completeSkill, continueAfterMilestone } from '../../services/skills';
import { setStepActive } from '../../services/steps';
import { canCompleteSkill } from '../../domain/milestone';
import { formatDate } from '../../lib/dates';
import { formatDelta, formatNumber } from '../../lib/format';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { errorMessage } from '../completionFeedback';
import { Flask } from '../components/Flask';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { StepRow } from '../components/StepRow';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { useToday } from '../hooks/useToday';
import { CompletionSheet } from '../sheets/CompletionSheet';

export function SkillScreen() {
  const { skillId = '' } = useParams();
  const today = useToday();
  const details = useLiveQuery(() => getSkillDetails(skillId, today), [skillId, today]);
  const navigate = useNavigate();
  const t = copy.skill;

  if (details === null) {
    return (
      <Screen title={copy.common.skill} back="/skills">
        <p className="hint center">{copy.common.skillNotFound}</p>
      </Screen>
    );
  }

  const skill = details?.skill;
  const active = skill?.status === 'ACTIVE';

  return (
    <Screen
      title={skill?.name ?? copy.common.skill}
      back="/skills"
      action={
        skill &&
        active && (
          <Link to={`/skills/${skill.id}/edit`} className="text-button">
            {t.edit}
          </Link>
        )
      }
      // With actions on screen the ✓ is the main path; the bottom button only starts the first
      // one, or a new one when every action was taken off the list.
      primary={
        skill && active && details.steps.length === 0
          ? {
              text: details.hiddenSteps.length > 0 ? t.newAction : t.firstAction,
              onClick: () => navigate(`/steps/new?skill=${skill.id}`),
            }
          : undefined
      }
    >
      <Skeleton layout="skill" loading={details === undefined}>
        {details && <SkillContent details={details} />}
      </Skeleton>
    </Screen>
  );
}

function SkillContent({ details }: { details: SkillDetails }) {
  const { skill, progress } = details;
  const active = skill.status === 'ACTIVE';
  const labels = [skill.startLabel, skill.targetLabel].filter(Boolean).join(' → ');
  const t = copy.skill;
  const [openCompletion, setOpenCompletion] = useState<string | null>(null);

  return (
    <>
      {(labels || skill.description) && (
        <p className="hint center skill-subtitle">{[labels, skill.description].filter(Boolean).join(' · ')}</p>
      )}

      <section className="flask-panel">
        <Flask fill={progress.fill} />
        <div className="flask-info">
          <span className="hint t-label">{t.flask}</span>
          <span className="flask-level">{progress.currentFlask}</span>
          <span className="flask-points">
            {formatNumber(progress.pointsInCurrentFlask)} <span className="hint">/ {formatNumber(progress.currentCapacity)}</span>
          </span>
          <span className="hint">{t.percentFilled(Math.floor(progress.fill * 100))}</span>
          <span className="hint small">{t.total(progress.totalPoints)}</span>
        </div>
      </section>

      <ActionsCard details={details} />

      <MilestoneCard details={details} />

      <section>
        <h2 className="section-title">{t.history}</h2>
        {details.history.length === 0 ? (
          <p className="hint card card-padded">{active ? t.historyEmptyActive : t.historyEmptyInactive}</p>
        ) : (
          <ul className="card list">
            {details.history.map((entry) => (
              <HistoryRow key={entry.transaction.id} entry={entry} onOpen={setOpenCompletion} />
            ))}
          </ul>
        )}
      </section>

      <CompletionSheet completionId={openCompletion} onClose={() => setOpenCompletion(null)} />
    </>
  );
}

function ActionsCard({ details: { skill, steps, hiddenSteps, todayCounts } }: { details: SkillDetails }) {
  const t = copy.skill;
  const [editing, setEditing] = useState(false);
  const { showToast } = useToast();
  const active = skill.status === 'ACTIVE';
  if (!active && steps.length === 0) return null;
  // With every action taken off the list there is nothing to edit: the hidden ones show openly.
  const allHidden = active && steps.length === 0 && hiddenSteps.length > 0;
  const canEdit = active && steps.length > 0;
  const isEditing = canEdit && editing;
  const newStep = `/steps/new?skill=${skill.id}`;

  async function unhide(stepId: string) {
    try {
      await setStepActive(stepId, true);
      haptics.success();
      showToast(t.unhidden);
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
    }
  }

  return (
    <section className="actions">
      <div className="section-head">
        <h2 className="section-title">{t.actions}</h2>
        {canEdit && (
          <button
            type="button"
            className="text-button"
            aria-pressed={isEditing}
            onClick={() => {
              haptics.select();
              setEditing(!isEditing);
            }}
          >
            {isEditing ? t.actionsDone : t.actionsEdit}
          </button>
        )}
      </div>
      <div className="card actions-card">
        {allHidden ? (
          <p className="actions-all-hidden hint">{t.allHidden}</p>
        ) : steps.length === 0 ? (
          <div className="actions-empty">
            <p>{t.actionsIntro}</p>
            <ul className="chips" aria-label={t.examplesLabel}>
              {t.examples.map((example) => (
                <li key={example.name}>
                  <Link
                    className="chip"
                    to={`${newStep}&name=${encodeURIComponent(example.name)}&points=${example.points}`}
                    onClick={() => haptics.tap()}
                  >
                    {t.exampleChip(example.name, example.points)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="list">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} skill={skill} todayCount={todayCounts[step.id] ?? 0} mode={isEditing ? 'edit' : 'complete'} />
            ))}
          </ul>
        )}
        {active && steps.length > 0 && (
          <Link to={newStep} className="ghost-row pressable-row">
            <Icon name="plus" size={20} />
            {t.newAction}
          </Link>
        )}
        {(isEditing || allHidden) && hiddenSteps.length > 0 && (
          <details className="disclosure hidden-steps" open={allHidden || undefined}>
            <summary>
              {t.hiddenSteps(hiddenSteps.length)}
              <Icon name="chevron-down" size={18} className="disclosure-chevron" />
            </summary>
            <ul className="list">
              {hiddenSteps.map((step) => (
                <li key={step.id} className="step-row">
                  <span className="step-row-main">
                    <span className="step-row-name">{step.name}</span>
                    <span className="step-row-meta">{copy.stepRow.meta(step.points, 0)}</span>
                  </span>
                  <button type="button" className="text-button" onClick={() => unhide(step.id)}>
                    {t.unhide}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {active && steps.length > 0 && (
        <Link to={`/skills/${skill.id}/add`} className="text-button backdate-link">
          <Icon name="calendar" size={18} />
          {t.backdate}
        </Link>
      )}
    </section>
  );
}

function MilestoneCard({ details: { skill, milestone, progress } }: { details: SkillDetails }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const t = copy.milestone;
  if (!milestone) return null;

  const done = Math.min(progress.completedFlasks, milestone.targetFlaskNumber);
  const reached = milestone.reachedAt !== null;
  const percent = Math.round((done / milestone.targetFlaskNumber) * 100);

  function fail(e: unknown) {
    haptics.error();
    showToast(e instanceof Error ? e.message : copy.errors.save);
  }

  async function finish() {
    // Rule: dialogs.confirm runs synchronously in the click handler, before any await, so the
    // native dialog keeps its user-gesture context (and Telegram's showConfirm is not queued).
    const ok = await dialogs.confirm(t.confirmFinish(skill.name), { okLabel: t.finish });
    if (!ok) return;
    setBusy(true);
    try {
      await completeSkill(skill.id);
      haptics.milestone();
      showToast(copy.toast.skillCompleted);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function keepGoing() {
    setBusy(true);
    try {
      await continueAfterMilestone(skill.id);
      haptics.tap();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  if (skill.status === 'COMPLETED') {
    return (
      <section className="card card-padded milestone milestone-done">
        <div className="milestone-head">
          <span className="milestone-name">
            <Icon name="trophy" size={20} />
            {milestone.name}
          </span>
        </div>
        <p className="hint">{t.completedAt(skill.completedAt!, progress.completedFlasks)}</p>
      </section>
    );
  }

  return (
    <section className={`card card-padded milestone${reached ? ' milestone-reached' : ''}`}>
      <div className="milestone-head">
        <span className="milestone-name">
          <Icon name="flag" size={20} />
          {milestone.name}
        </span>
        <span className="hint">{t.progress(done, milestone.targetFlaskNumber)}</span>
      </div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t.progress(done, milestone.targetFlaskNumber)}>
        <div className="bar-fill" style={{ width: `${percent}%` }} />
      </div>
      {reached && (
        <>
          <p className="milestone-text">
            {t.reachedAt(milestone.reachedAt!)} {milestone.decision === 'CONTINUE' ? t.continuing : t.decide}
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

function HistoryRow({ entry, onOpen }: { entry: HistoryEntry; onOpen(completionId: string): void }) {
  const { transaction, completion, after, levelChange } = entry;
  const t = copy.history;
  const isCompletion = transaction.reason === 'COMPLETION';
  const cancelled = isCompletion && completion?.status === 'CANCELLED';
  const name = !completion
    ? t.correction
    : transaction.reason === 'CANCELLATION'
      ? t.cancellationOf(completion.stepName)
      : transaction.reason === 'RESTORE'
        ? t.restoreOf(completion.stepName)
        : transaction.reason === 'CORRECTION'
          ? t.correctionOf(completion.stepName)
          : completion.stepName;
  // The completion row carries the day it was done; later rows the day they were written.
  const date = isCompletion && completion ? completion.date : transaction.createdAt;

  const content = (
    <>
      <span className="history-main">
        <span className="history-name">{name}</span>
        <span className="hint small">
          {formatDate(date)} · {t.flaskState(after.currentFlask, after.pointsInCurrentFlask, after.currentCapacity)}
        </span>
        {isCompletion && completion?.note && <span className="history-note">{completion.note}</span>}
        {(cancelled || levelChange !== 0) && (
          <span className="history-badges">
            {cancelled && <span className="badge badge-muted">{t.cancelledBadge}</span>}
            {levelChange > 0 && (
              <span className="badge">{levelChange === 1 ? t.flaskFilledBadge(after.completedFlasks) : t.flasksFilledBadge(levelChange)}</span>
            )}
            {levelChange < 0 && <span className="badge badge-muted">{t.flaskRollbackBadge(after.currentFlask)}</span>}
          </span>
        )}
      </span>
      <span className={`history-delta${transaction.delta < 0 ? ' negative' : ''}`}>{formatDelta(transaction.delta)}</span>
    </>
  );

  const className = `history-row${cancelled ? ' cancelled' : ''}`;
  if (!completion) return <li className={className}>{content}</li>;
  return (
    <li>
      <button type="button" className={`${className} pressable-row`} onClick={() => onOpen(completion.id)}>
        {content}
      </button>
    </li>
  );
}
