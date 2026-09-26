import { Link } from 'react-router';
import type { HomeSkillSummary } from '../../services/queries';
import { copy } from '../copy';
import { ProgressMini } from '../progress/ProgressHero';
import { colorScope, copyForSkill, skillTheme } from '../progress/registry';
import { Icon } from './Icon';

// A skill on the home screen (wireframe 1): the mini of its progress theme with the level
// number, name and labels, the points of the current level, a liquid bar, the milestone as dots
// and today's points — all in the skill's colour. A completed skill shows the gold mini with a
// check, an archived one a muted mini and the date; a skill on pause (package 18) the pill «На
// паузе до 10 октября».

/** Up to this many flasks the milestone is drawn as dots; above it, a count. */
const DOTS_MAX = 12;

export function SkillCard({ summary }: { summary: HomeSkillSummary }) {
  const { skill, milestone, progress, todayPoints, pause } = summary;
  const t = copy.home;
  const lc = copyForSkill(skill);
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
  const value = completed ? lc.levels(progress.completedFlasks) : archived ? null : t.pointsOfCapacity(progress.pointsInCurrentFlask, progress.currentCapacity);
  const caption = archived ? [t.archivedSince(skill.archivedAt ?? skill.updatedAt), labels].filter(Boolean).join(' · ') : labels;

  return (
    <li>
      <Link to={`/skills/${skill.id}`} className={`card skill-card pressable is-${skill.status.toLowerCase()}`} {...colorScope(skill.color)}>
        <div className="skill-card-top">
          <span
            className={`skill-card-mini${archived ? ' is-muted' : ''}`}
            role="img"
            aria-label={completed ? lc.completedLabel(progress.completedFlasks) : lc.cardLabel(progress.currentFlask, percent)}
          >
            <ProgressMini
              theme={skillTheme(skill.theme)}
              fill={completed ? 1 : progress.fill}
              state={completed ? 'complete' : progress.totalPoints === 0 ? 'empty' : 'active'}
              size={44}
              level={progress.currentFlask}
            />
            <span className={`skill-card-level${completed ? ' is-gold' : ''}`} aria-hidden="true">
              {completed ? <Icon name="check" size={14} /> : progress.currentFlask}
            </span>
          </span>
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
        {/* A row of its own: beside the dots and «+5 сегодня» it would wrap on a narrow phone. */}
        {pause && (
          <span className="pause-pill pause-pill--card">
            <Icon name="pause" filled size={12} />
            <span className="pause-pill-text">{copy.pause.pill(pause.until)}</span>
          </span>
        )}
        {(milestone || todayPoints > 0) && (
          <div className="skill-card-foot">
            {milestone &&
              (target <= DOTS_MAX ? (
                <span className="milestone-dots" role="img" aria-label={lc.milestoneProgress(done, target)}>
                  {Array.from({ length: target }, (_, i) => (
                    <span key={i} className={`milestone-dot${i < done ? ' is-done' : ''}`} />
                  ))}
                </span>
              ) : (
                <span className="skill-card-count t-caption">{lc.milestoneCount(done, target)}</span>
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
