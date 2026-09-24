import { useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { listSkillSummaries, type SkillSummary } from '../../services/queries';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { haptics } from '../../platform/haptics';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { copy } from '../copy';

type Filter = 'ACTIVE' | 'COMPLETED';

const t = copy.skills;

export function SkillsScreen() {
  const summaries = useLiveQuery(listSkillSummaries);
  const [filter, setFilter] = useState<Filter>('ACTIVE');

  const addButton = (
    <Link to="/skills/new" className="icon-button" aria-label={t.newSkill}>
      <Icon name="plus" size={26} />
    </Link>
  );

  return (
    <Screen title={t.title} largeTitle action={addButton}>
      <Skeleton layout="home" loading={summaries === undefined}>
        {summaries && <SkillsContent summaries={summaries} filter={filter} onFilter={setFilter} />}
      </Skeleton>
    </Screen>
  );
}

function SkillsContent({ summaries, filter, onFilter }: { summaries: SkillSummary[]; filter: Filter; onFilter(next: Filter): void }) {
  const completedCount = summaries.filter((s) => s.skill.status === 'COMPLETED').length;
  const shown: Filter = completedCount > 0 ? filter : 'ACTIVE';
  const visible = summaries.filter((s) => s.skill.status === shown);

  if (summaries.length === 0) {
    return <EmptyState illustration="skills" title={t.emptyTitle} text={t.emptyHint} action={{ label: t.create, to: '/skills/new' }} />;
  }

  return (
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
              onClick={() => {
                haptics.select();
                onFilter(value);
              }}
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
  const percent = Math.round(progress.fill * 100);
  return (
    <li>
      <Link to={`/skills/${skill.id}`} className="skill-row pressable pressable-row">
        <div className="skill-row-level" aria-label={completed ? copy.common.flasksCount(progress.completedFlasks) : copy.common.flaskNumber(progress.currentFlask)}>
          {completed ? <Icon name="check" size={22} /> : progress.currentFlask}
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
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={copy.common.flaskFilled(percent)}>
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
