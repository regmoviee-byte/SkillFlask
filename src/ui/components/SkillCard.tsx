import { Link } from 'react-router';
import type { HomeSkillSummary } from '../../services/queries';
import { copy } from '../copy';
import { Icon } from './Icon';
import { Ring } from './Ring';

// A skill on the home screen (wireframe 1): the ring with the flask number, name and labels,
// the points of the current flask, a liquid bar, the milestone as dots and today's points.
// A completed skill shows a gold ring with a check, an archived one a muted ring and the date.

/** Up to this many flasks the milestone is drawn as dots; above it, a count. */
const DOTS_MAX = 12;

export function SkillCard({ summary }: { summary: HomeSkillSummary }) {
  const { skill, milestone, progress, todayPoints } = summary;
  const t = copy.home;
  const active = skill.status === 'ACTIVE';
  const completed = skill.status === 'COMPLETED';
  const archived = skill.status === 'ARCHIVED';
  const labels = [skill.startLabel, skill.targetLabel].filter(Boolean).join(' → ');
  const percent = Math.floor(progress.fill * 100);
  const target = milestone?.targetFlaskNumber ?? 0;
  const done = Math.min(progress.completedFlasks, target);
  const reached = active && milestone?.reachedAt != null;

  // An archived skill says since when under its name: on the right the date would squeeze
  // the name to a few letters on a phone.
  const value = completed ? t.flasksDone(progress.completedFlasks) : archived ? null : t.pointsOfCapacity(progress.pointsInCurrentFlask, progress.currentCapacity);
  const caption = archived ? [t.archivedSince(skill.archivedAt ?? skill.updatedAt), labels].filter(Boolean).join(' · ') : labels;

  return (
    <li>
      <Link to={`/skills/${skill.id}`} className={`card skill-card pressable is-${skill.status.toLowerCase()}`}>
        <div className="skill-card-top">
          <Ring
            value={completed ? 1 : progress.fill}
            size={48}
            tone={completed ? 'gold' : archived ? 'muted' : 'accent'}
            label={completed ? t.ringCompleted(progress.completedFlasks) : t.ringLabel(progress.currentFlask, percent)}
          >
            {completed ? <Icon name="check" size={22} /> : progress.currentFlask}
          </Ring>
          <span className="skill-card-title">
            <span className="skill-card-name t-title-s">{skill.name}</span>
            {caption && <span className="skill-card-labels t-caption">{caption}</span>}
          </span>
          {value && <span className="skill-card-value t-caption">{value}</span>}
        </div>
        {active && (
          <div className="liquid-bar" aria-hidden="true">
            <div className="liquid-bar-fill" style={{ width: `${progress.fill * 100}%` }} />
          </div>
        )}
        {(milestone || todayPoints > 0) && (
          <div className="skill-card-foot">
            {milestone &&
              (target <= DOTS_MAX ? (
                <span className="milestone-dots" role="img" aria-label={copy.milestone.progress(done, target)}>
                  {Array.from({ length: target }, (_, i) => (
                    <span key={i} className={`milestone-dot${i < done ? ' is-done' : ''}`} />
                  ))}
                </span>
              ) : (
                <span className="skill-card-count t-caption">{t.milestoneCount(done, target)}</span>
              ))}
            {reached && (
              <span className="laurel-chip">
                <Icon name="laurel" size={14} />
                {t.milestoneReached}
              </span>
            )}
            {todayPoints > 0 && <span className="skill-card-today t-caption">{t.todayPoints(todayPoints)}</span>}
          </div>
        )}
      </Link>
    </li>
  );
}
