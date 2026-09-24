import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillDetails, type HistoryEntry, type SkillDetails } from '../../services/queries';
import { completeSkill, continueAfterMilestone } from '../../services/skills';
import { canCompleteSkill } from '../../domain/milestone';
import { formatDate } from '../../lib/dates';
import { formatDelta, formatNumber } from '../../lib/format';
import { confirmDialog, haptic } from '../../telegram';
import { Flask } from '../components/Flask';
import { Screen } from '../components/Screen';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

export function SkillScreen() {
  const { skillId = '' } = useParams();
  const details = useLiveQuery(() => getSkillDetails(skillId), [skillId]);
  const t = copy.skill;

  if (details === undefined) return <Screen title={copy.common.skill} back="/skills">{null}</Screen>;
  if (details === null) {
    return (
      <Screen title={copy.common.skill} back="/skills">
        <p className="hint center">{copy.common.skillNotFound}</p>
      </Screen>
    );
  }

  const { skill, progress } = details;
  const active = skill.status === 'ACTIVE';
  const labels = [skill.startLabel, skill.targetLabel].filter(Boolean).join(' → ');

  return (
    <Screen
      title={skill.name}
      back="/skills"
      action={
        active && (
          <Link to={`/skills/${skill.id}/edit`} className="text-button">
            {t.edit}
          </Link>
        )
      }
      footer={
        active && (
          <Link to={`/skills/${skill.id}/add`} className="button button-primary button-block">
            {t.addAction}
          </Link>
        )
      }
    >
      {(labels || skill.description) && (
        <p className="hint center skill-subtitle">{[labels, skill.description].filter(Boolean).join(' · ')}</p>
      )}

      <section className="flask-panel">
        <Flask fill={progress.fill} />
        <div className="flask-info">
          <span className="hint">{t.flask}</span>
          <span className="flask-level">{progress.currentFlask}</span>
          <span className="flask-points">
            {formatNumber(progress.pointsInCurrentFlask)} <span className="hint">/ {formatNumber(progress.currentCapacity)}</span>
          </span>
          <span className="hint">{t.percentFilled(Math.floor(progress.fill * 100))}</span>
          <span className="hint small">{t.total(progress.totalPoints)}</span>
        </div>
      </section>

      <MilestoneCard details={details} />

      <section>
        <h2 className="section-title">{t.history}</h2>
        {details.history.length === 0 ? (
          <p className="hint card card-padded">{active ? t.historyEmptyActive : t.historyEmptyInactive}</p>
        ) : (
          <ul className="card list">
            {details.history.map((entry) => (
              <HistoryRow key={entry.transaction.id} entry={entry} />
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

function MilestoneCard({ details: { skill, milestone, progress } }: { details: SkillDetails }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const t = copy.milestone;
  if (!milestone) return null;

  const done = Math.min(progress.completedFlasks, milestone.targetFlaskNumber);
  const reached = milestone.reachedAt !== null;

  function fail(e: unknown) {
    haptic('error');
    showToast(e instanceof Error ? e.message : copy.errors.save);
  }

  async function finish() {
    // Rule: confirmDialog runs synchronously in the click handler, before any await, so the
    // native dialog keeps its user-gesture context (and Telegram's showConfirm is not queued).
    const ok = await confirmDialog(t.confirmFinish(skill.name));
    if (!ok) return;
    setBusy(true);
    try {
      await completeSkill(skill.id);
      haptic('success');
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
          <span className="milestone-name">{milestone.name}</span>
        </div>
        <p className="hint">{t.completedAt(skill.completedAt!, progress.completedFlasks)}</p>
      </section>
    );
  }

  return (
    <section className={`card card-padded milestone${reached ? ' milestone-reached' : ''}`}>
      <div className="milestone-head">
        <span className="milestone-name">{milestone.name}</span>
        <span className="hint">{t.progress(done, milestone.targetFlaskNumber)}</span>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${(done / milestone.targetFlaskNumber) * 100}%` }} />
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

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const { transaction, completion, after, levelChange } = entry;
  const t = copy.history;
  return (
    <li className="history-row">
      <div className="history-main">
        <span className="history-name">{completion?.stepName ?? t.correction}</span>
        <span className="hint small">
          {completion ? formatDate(completion.date) : formatDate(transaction.createdAt)} ·{' '}
          {t.flaskState(after.currentFlask, after.pointsInCurrentFlask, after.currentCapacity)}
        </span>
        {levelChange > 0 && (
          <span className="badge badge-level">
            {levelChange === 1 ? t.flaskFilledBadge(after.completedFlasks) : t.flasksFilledBadge(levelChange)}
          </span>
        )}
        {levelChange < 0 && <span className="badge">{t.flaskRollbackBadge(after.currentFlask)}</span>}
      </div>
      <span className={`history-delta${transaction.delta < 0 ? ' negative' : ''}`}>{formatDelta(transaction.delta)}</span>
    </li>
  );
}
