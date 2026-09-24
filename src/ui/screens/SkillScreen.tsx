import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillDetails, type HistoryEntry, type SkillDetails } from '../../services/queries';
import { completeSkill, continueAfterMilestone } from '../../services/skills';
import { canCompleteSkill } from '../../domain/milestone';
import { formatDate } from '../../lib/dates';
import { FLASKS, formatDelta, formatNumber, formatPoints, plural } from '../../lib/format';
import { confirmDialog, haptic } from '../../telegram';
import { Flask } from '../components/Flask';
import { Screen } from '../components/Screen';
import { useToast } from '../components/Toast';

export function SkillScreen() {
  const { skillId = '' } = useParams();
  const details = useLiveQuery(() => getSkillDetails(skillId), [skillId]);

  if (details === undefined) return <Screen title="" back="/skills">{null}</Screen>;
  if (details === null) {
    return (
      <Screen title="Навык" back="/skills">
        <p className="hint center">Навык не найден</p>
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
            Изм.
          </Link>
        )
      }
      footer={
        active && (
          <Link to={`/skills/${skill.id}/add`} className="button button-primary button-block">
            Добавить действие
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
          <span className="hint">Колба</span>
          <span className="flask-level">{progress.currentFlask}</span>
          <span className="flask-points">
            {formatNumber(progress.pointsInCurrentFlask)} <span className="hint">/ {formatNumber(progress.currentCapacity)}</span>
          </span>
          <span className="hint">{Math.floor(progress.fill * 100)}% заполнено</span>
          <span className="hint small">Всего {formatPoints(progress.totalPoints)}</span>
        </div>
      </section>

      <MilestoneCard details={details} />

      <section>
        <h2 className="section-title">История</h2>
        {details.history.length === 0 ? (
          <p className="hint card card-padded">
            {active ? 'Отметьте первое действие — очки начнут заполнять колбу.' : 'Выполнений нет.'}
          </p>
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
  if (!milestone) return null;

  const done = Math.min(progress.completedFlasks, milestone.targetFlaskNumber);
  const reached = milestone.reachedAt !== null;

  async function finish() {
    const ok = await confirmDialog(`Завершить навык «${skill.name}»? Он станет достигнутым и перейдёт в режим просмотра.`);
    if (!ok) return;
    setBusy(true);
    try {
      await completeSkill(skill.id);
      haptic('success');
      showToast('Навык достигнут 🎉');
    } finally {
      setBusy(false);
    }
  }

  async function keepGoing() {
    setBusy(true);
    try {
      await continueAfterMilestone(skill.id);
    } finally {
      setBusy(false);
    }
  }

  if (skill.status === 'COMPLETED') {
    return (
      <section className="card card-padded milestone milestone-done">
        <div className="milestone-head">
          <span className="milestone-name">🏆 {milestone.name}</span>
        </div>
        <p className="hint">
          Навык достигнут {formatDate(skill.completedAt!)} · {progress.completedFlasks}{' '}
          {plural(progress.completedFlasks, FLASKS)}
        </p>
      </section>
    );
  }

  return (
    <section className={`card card-padded milestone${reached ? ' milestone-reached' : ''}`}>
      <div className="milestone-head">
        <span className="milestone-name">{reached ? '🎯 ' : ''}{milestone.name}</span>
        <span className="hint">
          {done} из {milestone.targetFlaskNumber} {plural(milestone.targetFlaskNumber, FLASKS)}
        </span>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${(done / milestone.targetFlaskNumber) * 100}%` }} />
      </div>
      {reached && (
        <>
          <p className="milestone-text">
            Веха достигнута {formatDate(milestone.reachedAt!)}.{' '}
            {milestone.decision === 'CONTINUE' ? 'Вы продолжаете развитие.' : 'Завершить навык или продолжить развитие?'}
          </p>
          {canCompleteSkill(skill, milestone) && (
            <div className="button-row">
              <button type="button" className="button button-primary" disabled={busy} onClick={finish}>
                Завершить
              </button>
              {milestone.decision !== 'CONTINUE' && (
                <button type="button" className="button" disabled={busy} onClick={keepGoing}>
                  Продолжить
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
  return (
    <li className="history-row">
      <div className="history-main">
        <span className="history-name">{completion?.stepName ?? 'Корректировка'}</span>
        <span className="hint small">
          {completion ? formatDate(completion.date) : formatDate(transaction.createdAt)} · Колба {after.currentFlask}:{' '}
          {formatNumber(after.pointsInCurrentFlask)}/{formatNumber(after.currentCapacity)}
        </span>
        {levelChange > 0 && (
          <span className="badge badge-level">
            {levelChange === 1 ? `Колба ${after.completedFlasks} заполнена` : `Заполнено колб: ${levelChange}`}
          </span>
        )}
        {levelChange < 0 && <span className="badge">Уровень понижен</span>}
      </div>
      <span className={`history-delta${transaction.delta < 0 ? ' negative' : ''}`}>{formatDelta(transaction.delta)}</span>
    </li>
  );
}
