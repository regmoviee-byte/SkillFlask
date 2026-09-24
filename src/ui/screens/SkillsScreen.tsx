import { useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { listSkillSummaries, type SkillSummary } from '../../services/queries';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { Screen } from '../components/Screen';
import { copy } from '../copy';

type Filter = 'ACTIVE' | 'COMPLETED';

const t = copy.skills;

export function SkillsScreen() {
  const summaries = useLiveQuery(listSkillSummaries);
  const [filter, setFilter] = useState<Filter>('ACTIVE');

  const addButton = (
    <Link to="/skills/new" className="icon-button" aria-label={t.newSkill}>
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </Link>
  );

  if (!summaries) return <Screen title={t.title} action={addButton}>{null}</Screen>;

  const completedCount = summaries.filter((s) => s.skill.status === 'COMPLETED').length;
  const shown: Filter = completedCount > 0 ? filter : 'ACTIVE';
  const visible = summaries.filter((s) => s.skill.status === shown);

  return (
    <Screen title={t.title} action={addButton}>
      {summaries.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{t.emptyTitle}</p>
          <p className="hint">{t.emptyHint}</p>
          <Link to="/skills/new" className="button button-primary">
            {t.create}
          </Link>
        </div>
      ) : (
        <>
          <Overview summaries={summaries} />
          {completedCount > 0 && (
            <div className="segmented" role="tablist">
              {(['ACTIVE', 'COMPLETED'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={shown === value}
                  className={shown === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {value === 'ACTIVE' ? t.filterActive : t.filterCompleted}
                </button>
              ))}
            </div>
          )}
          {visible.length === 0 ? (
            <p className="hint center">{shown === 'ACTIVE' ? t.noActive : t.noCompleted}</p>
          ) : (
            <ul className="card list">
              {visible.map((summary) => (
                <SkillRow key={summary.skill.id} summary={summary} />
              ))}
            </ul>
          )}
        </>
      )}
    </Screen>
  );
}

function Overview({ summaries }: { summaries: SkillSummary[] }) {
  const active = summaries.filter((s) => s.skill.status === 'ACTIVE').length;
  const flasks = summaries.reduce((sum, s) => sum + s.progress.completedFlasks, 0);
  const lastReached = summaries
    .filter((s) => s.milestone?.reachedAt)
    .sort((a, b) => (a.milestone!.reachedAt! < b.milestone!.reachedAt! ? 1 : -1))[0];

  return (
    <section className="card overview">
      <div className="stats">
        <div>
          <span className="stat-value">{active}</span>
          <span className="hint">{t.statActive}</span>
        </div>
        <div>
          <span className="stat-value">{formatNumber(flasks)}</span>
          <span className="hint">{t.statFlasks}</span>
        </div>
      </div>
      <p className="overview-last">
        {lastReached ? (
          <>
            {t.lastReached} <b>{lastReached.milestone!.name}</b> · {lastReached.skill.name},{' '}
            {formatDate(lastReached.milestone!.reachedAt!)}
          </>
        ) : (
          <span className="hint">{t.noReached}</span>
        )}
      </p>
    </section>
  );
}

function SkillRow({ summary: { skill, milestone, progress } }: { summary: SkillSummary }) {
  const completed = skill.status === 'COMPLETED';
  const labels = [skill.startLabel, skill.targetLabel].filter(Boolean).join(' → ');
  return (
    <li>
      <Link to={`/skills/${skill.id}`} className="skill-row">
        <div className="skill-row-level" aria-label={copy.common.flaskNumber(progress.currentFlask)}>
          {completed ? '✓' : progress.currentFlask}
        </div>
        <div className="skill-row-main">
          <div className="skill-row-top">
            <span className="skill-row-name">{skill.name}</span>
            <span className="skill-row-points">
              {completed
                ? copy.common.flasksCount(progress.completedFlasks)
                : t.pointsOfCapacity(progress.pointsInCurrentFlask, progress.currentCapacity)}
            </span>
          </div>
          {!completed && (
            <div className="bar">
              <div className="bar-fill" style={{ width: `${progress.fill * 100}%` }} />
            </div>
          )}
          <div className="hint small">
            {[
              labels,
              milestone &&
                t.milestoneProgress(milestone.name, Math.min(progress.completedFlasks, milestone.targetFlaskNumber), milestone.targetFlaskNumber),
            ]
              .filter(Boolean)
              .join(' · ')}
            {milestone?.reachedAt && !completed && <span className="badge">{t.milestoneBadge}</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}
