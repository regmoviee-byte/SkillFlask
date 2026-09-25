import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDayPlan, type DayPlan, type ExtraGroup, type PlanRow } from '../../services/today';
import { getSetting, setSetting } from '../../services/settings';
import { formatWeekdayDate, weekStart } from '../../lib/dates';
import { formatNumber, plural, POINTS } from '../../lib/format';
import { fromDeci, toDeci } from '../../domain/points';
import { logError } from '../../platform/errorLog';
import { CoachChip } from '../components/CoachChip';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { colorScope } from '../progress/registry';
import { Screen } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { BUSY_TAIL_MS, StepRow } from '../components/StepRow';
import { WeekPicker } from '../components/WeekStrip';
import { copy } from '../copy';
import { useLinger } from '../hooks/useLinger';
import { useStableOrder } from '../hooks/useStableOrder';
import { useToday } from '../hooks/useToday';
import { CompletionSheet } from '../sheets/CompletionSheet';

// «Сегодня» v2: what is left of today's plan and everything else one tap away. The plan comes
// from the schedules (services/today.ts) and is never stored: a day that passes with something
// undone just leaves fewer dots on the week strip — no overdue label, no red, no carry-over
// (FR-TD-003). Sections: «Осталось» (steps due today), quotas x/N «На этой неделе» / «В этом
// месяце» (never «for today», decision 14.5), «Ещё» (the v1 list by skill, folded while
// something is left) and «Сделано сегодня». A past day of the week can be picked on the strip:
// the ✓ then records on that date. A filled flask is told by the TopCard (no flask here).

const t = copy.today;
/** Buttons «К навыку …» when no active skill has an action yet. */
const MAX_SKILL_BUTTONS = 3;

export function TodayScreen() {
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  // A pick from a week that has since turned (the screen stayed open) falls back to today.
  const date = picked !== null && picked <= today && weekStart(picked) === weekStart(today) ? picked : today;
  // One query for the plan and the coach flag, so the chip never pops in above a row.
  const view = useLiveQuery(async () => ({ plan: await getDayPlan(date), coachSeen: await getSetting('coachTodaySeen', false) }), [date]);
  // While another day loads, the previous one stays on screen rather than a skeleton.
  const last = useRef(view);
  if (view) last.current = view;
  const shown = view ?? last.current;

  return (
    <Screen title={t.title} largeTitle>
      <p className="t-caption screen-date">{formatWeekdayDate(today)}</p>
      <Skeleton layout="today" loading={shown === undefined}>
        {/* Picking today again clears the pick, so the screen follows the calendar past midnight. */}
        {shown && <TodayContent plan={shown.plan} today={today} date={date} onPick={(d) => setPicked(d === today ? null : d)} coach={!shown.coachSeen} />}
      </Skeleton>
    </Screen>
  );
}

function seeCoach(): void {
  setSetting('coachTodaySeen', true).catch((error: unknown) => logError(error, 'coach'));
}

interface TodayContentProps {
  plan: DayPlan;
  today: string;
  /** The date picked on the strip (the plan may still be the previous one for a moment). */
  date: string;
  onPick(date: string): void;
  coach: boolean;
}

function TodayContent({ plan, today, date, onPick, coach }: TodayContentProps) {
  const isToday = plan.date === today;

  if (plan.skills.length === 0) {
    return <EmptyState illustration="today" title={t.emptyTitle} text={t.emptyText} action={{ label: t.create, to: '/skills/new' }} />;
  }

  if (plan.due.length === 0 && plan.quota.length === 0 && plan.extra.length === 0) {
    const [first, ...rest] = plan.skills.slice(0, MAX_SKILL_BUTTONS).map((s) => s.skill);
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

  const dayPoints = fromDeci(plan.done.reduce((sum, d) => sum + (d.completion.status === 'ACTIVE' ? toDeci(d.completion.pointsAwarded) : 0), 0));
  const activeToday = plan.done.some((d) => d.completion.status === 'ACTIVE');
  // Nothing planned: the long hint is for a day that has nothing yet; once something is
  // logged the day's points say enough and the line steps back to a quiet caption.
  const summary = !isToday
    ? t.summaryPast(plan.date)
    : plan.totalPlanned === 0
      ? activeToday
        ? null
        : t.summaryNothing
      : plan.totalDone >= plan.totalPlanned
        ? t.summaryAllDone
        : t.summaryProgress(plan.totalDone, plan.totalPlanned);
  const quiet = isToday && plan.totalPlanned === 0;

  return (
    <>
      {(summary !== null || dayPoints > 0) && (
        <div className="today-summary">
          {summary !== null && (
            <p className={`today-summary-text ${quiet ? 't-caption' : 't-body-strong'}`} aria-live="polite">
              {summary}
            </p>
          )}
          {dayPoints > 0 && (
            <span className="today-summary-points t-caption">
              +{formatNumber(dayPoints)} {plural(dayPoints, POINTS)}
            </span>
          )}
        </div>
      )}
      <WeekPicker today={today} selected={date} counts={plan.weekActivity} onSelect={onPick} />
      {/* Keyed by the day: lingering rows, the kept order and the «Ещё» fold belong to one day. */}
      <DayBody key={plan.date} plan={plan} today={today} coach={coach} />
    </>
  );
}

function DayBody({ plan, today, coach }: { plan: DayPlan; today: string; coach: boolean }) {
  const [openCompletion, setOpenCompletion] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const isToday = plan.date === today;
  const keyOfRow = (row: PlanRow) => row.step.id;
  // Rows keep their place while the screen is open; a completed one shows its ✓ before it goes.
  const due = useLinger(useStableOrder(plan.due, keyOfRow), keyOfRow, BUSY_TAIL_MS);
  const quota = useLinger(useStableOrder(plan.quota, keyOfRow), keyOfRow, BUSY_TAIL_MS);
  const groups = useStableOrder(plan.extra, (g) => g.summary.skill.id);
  const allSteps = useStableOrder(
    groups.flatMap((g) => g.steps),
    (s) => s.step.id,
  );
  const stepOrder = new Map(allSteps.map((s, i) => [s.step.id, i]));

  const weekQuota = quota.filter(({ item }) => item.step.schedule.kind === 'TIMES_PER_WEEK');
  const monthQuota = quota.filter(({ item }) => item.step.schedule.kind === 'TIMES_PER_MONTH');
  const planned = due.length > 0 || quota.length > 0;
  // The coach hint sits above the first button on screen, whichever section that is.
  const coachAt = !coach ? null : due.length > 0 ? 'due' : weekQuota.length > 0 ? 'week' : monthQuota.length > 0 ? 'month' : 'extra';
  const coachChip = (at: typeof coachAt) => (coachAt === at ? <CoachChip onDismiss={seeCoach} /> : null);
  const onResult = coach ? seeCoach : undefined;
  const done = groupDone(plan.done);
  const monthTitle = monthQuota[0] && monthQuota[0].item.period!.start.slice(0, 7) !== today.slice(0, 7)
    ? t.quotaMonthOf(Number(monthQuota[0].item.period!.start.slice(5, 7)))
    : t.quotaMonth;
  const extraCount = groups.reduce((n, g) => n + g.steps.length, 0);
  const moreIsOpen = moreOpen ?? due.length === 0;

  const rowsOf = (rows: typeof due, withQuota: boolean) => (
    <ul className="list">
      {rows.map(({ item, leaving }) => (
        <StepRow
          key={item.step.id}
          step={item.step}
          skill={item.skill}
          todayCount={item.count}
          mode="complete"
          date={plan.date}
          context={item.skill.name}
          quota={withQuota ? { done: item.done, target: item.target } : undefined}
          onResult={leaving ? undefined : onResult}
        />
      ))}
    </ul>
  );

  const extraGroups = groups.map((group) => (
    <SkillGroup key={group.summary.skill.id} group={group} order={stepOrder} date={plan.date} coach={coachAt === 'extra' && group === groups[0] ? coachChip('extra') : null} onResult={onResult} />
  ));

  return (
    <>
      {due.length > 0 && (
        <TodaySection title={isToday ? t.remaining : t.plannedPast} className="today-due">
          {coachChip('due')}
          <div className="card">{rowsOf(due, false)}</div>
        </TodaySection>
      )}
      {weekQuota.length > 0 && (
        <TodaySection title={t.quotaWeek} className="today-quota">
          {coachChip('week')}
          <div className="card">{rowsOf(weekQuota, true)}</div>
        </TodaySection>
      )}
      {monthQuota.length > 0 && (
        <TodaySection title={monthTitle} className="today-quota">
          {coachChip('month')}
          <div className="card">{rowsOf(monthQuota, true)}</div>
        </TodaySection>
      )}

      {groups.length > 0 &&
        (planned ? (
          <details className="disclosure today-more" open={moreIsOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
            <summary>
              {t.moreCount(extraCount)}
              <Icon name="chevron-down" size={18} className="disclosure-chevron" />
            </summary>
            <div className="today-more-body">{extraGroups}</div>
          </details>
        ) : (
          extraGroups
        ))}

      {/* Only what happened: an empty today shows nothing here; a past day says so plainly. */}
      {(done.length > 0 || !isToday) && (
        <section className="today-done">
          <h2 className="section-title">{isToday ? t.done : t.donePast}</h2>
          {done.length > 0 ? (
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
          ) : (
            <p className="card card-padded hint today-done-empty">{t.doneEmptyPast}</p>
          )}
        </section>
      )}

      <CompletionSheet completionId={openCompletion} onClose={() => setOpenCompletion(null)} />
    </>
  );
}

function TodaySection({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  return (
    <section className={`today-section ${className}`}>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
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
 * «Сделано» as one row per action and status, «×N» when it was done several times, in the
 * order of each row's newest completion. `done` comes newest first from getDayPlan.
 */
export function groupDone(done: DayPlan['done']): DoneRow[] {
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
  group: ExtraGroup;
  /** Stable position of every step on screen (useStableOrder). */
  order: Map<string, number>;
  date: string;
  coach: ReactNode;
  onResult?(): void;
}

function SkillGroup({ group: { summary, steps }, order, date, coach, onResult }: SkillGroupProps) {
  const { skill, progress } = summary;
  const sorted = [...steps].sort((a, b) => (order.get(a.step.id) ?? 0) - (order.get(b.step.id) ?? 0));
  const headingId = `today-${skill.id}`;
  return (
    // The group is painted in the skill's colour: its ring and the step rows' accents.
    <section className="today-group" aria-labelledby={headingId} {...colorScope(skill.color)}>
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
          {sorted.map(({ step, count }) => (
            <StepRow key={step.id} step={step} skill={skill} todayCount={count} mode="complete" date={date} onResult={onResult} />
          ))}
        </ul>
      </div>
    </section>
  );
}
