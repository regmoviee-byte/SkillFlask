import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getTodayView, type TodayGroup, type TodayView } from '../../services/queries';
import { getSetting, setSetting } from '../../services/settings';
import { formatWeekdayDate } from '../../lib/dates';
import { fromDeci, toDeci } from '../../domain/points';
import { logError } from '../../platform/errorLog';
import { CoachChip } from '../components/CoachChip';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { Screen } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { StepRow } from '../components/StepRow';
import { Tile, TileNumber, TodayTile } from '../components/Tile';
import { copy } from '../copy';
import { useStableOrder } from '../hooks/useStableOrder';
import { useToday } from '../hooks/useToday';
import { CompletionSheet } from '../sheets/CompletionSheet';

// «Сегодня» v1, without schedules: the daily entry point. Every action of every active skill
// is one tap away (StepRow: ✓, toast with «Отменить»), and what was done today is listed below.
// Nothing is ever overdue: a day holds only what happened in it (FR-TD-003), so there is no
// red, no «осталось», and no text at all about what was not done. A filled flask is told by
// the TopCard, since no flask is on this screen.

const t = copy.today;
/** Buttons «К навыку …» when no active skill has an action yet. */
const MAX_SKILL_BUTTONS = 3;

export function TodayScreen() {
  const today = useToday();
  const view = useLiveQuery(() => getTodayView(today), [today]);
  const coachSeen = useLiveQuery(() => getSetting('coachTodaySeen', false));

  return (
    <Screen title={t.title} largeTitle>
      <p className="t-caption screen-date">{formatWeekdayDate(today)}</p>
      <Skeleton layout="today" loading={view === undefined}>
        {view && <TodayContent view={view} coach={coachSeen === false} />}
      </Skeleton>
    </Screen>
  );
}

function seeCoach(): void {
  setSetting('coachTodaySeen', true).catch((error: unknown) => logError(error, 'coach'));
}

function TodayContent({ view, coach }: { view: TodayView; coach: boolean }) {
  const [openCompletion, setOpenCompletion] = useState<string | null>(null);
  const groups = useStableOrder(
    view.groups.filter((g) => g.steps.length > 0),
    (g) => g.summary.skill.id,
  );
  const allSteps = useStableOrder(
    groups.flatMap((g) => g.steps),
    (s) => s.step.id,
  );
  const stepOrder = new Map(allSteps.map((s, i) => [s.step.id, i]));

  if (view.groups.length === 0) {
    return <EmptyState illustration="today" title={t.emptyTitle} text={t.emptyText} action={{ label: t.create, to: '/skills/new' }} />;
  }

  if (groups.length === 0) {
    const [first, ...rest] = view.groups.slice(0, MAX_SKILL_BUTTONS).map((g) => g.summary.skill);
    return (
      <EmptyState
        illustration="steps"
        title={t.noStepsTitle}
        text={t.noStepsText}
        action={{ label: t.toSkill(first!.name), to: `/skills/${first!.id}` }}
        secondary={rest.map((skill) => (
          <Link key={skill.id} to={`/skills/${skill.id}`} className="button button-secondary empty-state-action">
            {t.toSkill(skill.name)}
          </Link>
        ))}
      />
    );
  }

  const doneCount = view.done.filter((d) => d.completion.status === 'ACTIVE').length;
  const done = groupDone(view.done);

  return (
    <>
      <div className="bento">
        <TodayTile points={view.todayPoints} week={view.weekActivity} today={view.today} />
        <Tile label={t.tileActions}>
          <TileNumber value={doneCount} caption={t.actionsCaption} />
        </Tile>
      </div>

      {groups.map((group, i) => (
        <SkillGroup
          key={group.summary.skill.id}
          group={group}
          order={stepOrder}
          coach={coach && i === 0 ? <CoachChip onDismiss={seeCoach} /> : null}
          onResult={coach ? seeCoach : undefined}
        />
      ))}

      {/* Only what happened: an empty day shows nothing here, not a message about it. */}
      {done.length > 0 && (
        <section className="today-done">
          <h2 className="section-title">{t.done}</h2>
          <ul className="card list">
            {done.map((row) => (
              <li key={row.key}>
                {/* Opens the latest completion of the row; older ones are in the skill's history. */}
                <button type="button" className={`done-row pressable-row${row.cancelled ? ' is-cancelled' : ''}`} onClick={() => setOpenCompletion(row.latestId)}>
                  <span className="done-row-main">
                    <span className="done-row-name">{row.stepName}</span>
                    <span className="done-row-meta">{row.cancelled ? `${row.skillName} · ${t.doneCancelled}` : row.skillName}</span>
                  </span>
                  {row.count > 1 && <span className="done-row-count">{t.doneCount(row.count)}</span>}
                  <span className="done-row-points">{t.donePoints(row.points)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CompletionSheet completionId={openCompletion} onClose={() => setOpenCompletion(null)} />
    </>
  );
}

export interface DoneRow {
  key: string;
  stepName: string;
  skillName: string;
  cancelled: boolean;
  /** Completions in the row (×N) and their points together. */
  count: number;
  points: number;
  /** The newest completion of the row: the one its sheet opens. */
  latestId: string;
}

/**
 * «Сделано сегодня» as one row per action and status, «×N» when it was done several times, in
 * the order of each row's newest completion. `done` comes newest first from getTodayView.
 */
export function groupDone(done: TodayView['done']): DoneRow[] {
  const rows = new Map<string, DoneRow & { deci: number }>();
  for (const { completion, skillName } of done) {
    const cancelled = completion.status === 'CANCELLED';
    const key = `${completion.stepId}:${cancelled ? 'c' : 'a'}`;
    const row = rows.get(key);
    const deci = toDeci(completion.pointsAwarded);
    if (row) {
      row.count += 1;
      row.deci += deci;
      row.points = fromDeci(row.deci);
    } else {
      // The first one seen is the newest: its name is the one the step had most recently.
      rows.set(key, { key, stepName: completion.stepName, skillName, cancelled, count: 1, deci, points: completion.pointsAwarded, latestId: completion.id });
    }
  }
  return [...rows.values()].map(({ deci: _deci, ...row }) => row);
}

interface SkillGroupProps {
  group: TodayGroup;
  /** Stable position of every step on screen (useStableOrder). */
  order: Map<string, number>;
  coach: ReactNode;
  onResult?(): void;
}

function SkillGroup({ group: { summary, steps }, order, coach, onResult }: SkillGroupProps) {
  const { skill, progress } = summary;
  const sorted = [...steps].sort((a, b) => (order.get(a.step.id) ?? 0) - (order.get(b.step.id) ?? 0));
  const headingId = `today-${skill.id}`;
  return (
    <section className="today-group" aria-labelledby={headingId}>
      <div className="today-group-head">
        <Link to={`/skills/${skill.id}`} className="today-group-skill">
          <Ring value={progress.fill} size={32} stroke={3}>
            {progress.currentFlask}
          </Ring>
          <span className="today-group-name t-body-strong" id={headingId}>
            {skill.name}
          </span>
          <span className="today-group-points t-caption">{t.groupPoints(progress.pointsInCurrentFlask, progress.currentCapacity)}</span>
        </Link>
        {/* Icon only: the skill name gets the row; the label names the skill for screen readers. */}
        <Link to={`/skills/${skill.id}/add`} className="icon-button today-backdate" aria-label={t.backdateLabel(skill.name)}>
          <Icon name="calendar" size={22} />
        </Link>
      </div>
      {coach}
      <div className="card">
        <ul className="list">
          {sorted.map(({ step, todayCount }) => (
            <StepRow key={step.id} step={step} skill={skill} todayCount={todayCount} mode="complete" onResult={onResult} />
          ))}
        </ul>
      </div>
    </section>
  );
}
