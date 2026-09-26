import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDayPlan, type DayPlan, type ExtraGroup, type PlanRow } from '../../services/today';
import { getSetting, setSetting } from '../../services/settings';
import { formatWeekdayDate, weekStart } from '../../lib/dates';
import { formatNumber, plural, POINTS } from '../../lib/format';
import { fromDeci, toDeci } from '../../domain/points';
import { haptics } from '../../platform/haptics';
import { logError } from '../../platform/errorLog';
import { CoachChip } from '../components/CoachChip';
import { EmptyState } from '../components/EmptyState';
import { FirstRunEmpty } from '../components/FirstRun';
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
//
// v0.5 package 18: a skill on pause is out of the plan, and one quiet line at the end names it
// («На паузе: Гитара до 10 октября, Бег»). With COMPACT_SKILLS or more skills in the plan the
// screen stays short: «Сделано» folds into one line «Отмечено: 7 · +54 очка» (the fold is
// remembered on the device), «Ещё» stays folded, and «Осталось» lists its rows skill by skill —
// the skill with the most rows first, each row with the skill's colour dot — showing the first
// DUE_SHOWN of a skill with more than that and «Ещё N» for the rest. Below that nothing changes.

const t = copy.today;
/** Buttons «К навыку …» when no active skill has an action yet. */
const MAX_SKILL_BUTTONS = 3;
/** Skills in the plan from which «Сегодня» is compact. */
export const COMPACT_SKILLS = 5;
/** Rows of one skill shown in a compact «Осталось» before «Ещё N» (only from DUE_SHOWN + 1 rows). */
const DUE_SHOWN = 3;

export function TodayScreen() {
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  // A pick from a week that has since turned (the screen stayed open) falls back to today.
  const date = picked !== null && picked <= today && weekStart(picked) === weekStart(today) ? picked : today;
  // One query for the plan and the coach flag, so the chip never pops in above a row.
  const view = useLiveQuery(
    async () => ({
      plan: await getDayPlan(date, today),
      coachSeen: await getSetting('coachTodaySeen', false),
      doneOpen: await getSetting('todayDoneOpen', false),
    }),
    [date, today],
  );
  // While another day loads, the previous one stays on screen rather than a skeleton.
  const last = useRef(view);
  if (view) last.current = view;
  const shown = view ?? last.current;

  return (
    <Screen title={t.title} largeTitle>
      <p className="t-caption screen-date">{formatWeekdayDate(today)}</p>
      <Skeleton layout="today" loading={shown === undefined}>
        {/* Picking today again clears the pick, so the screen follows the calendar past midnight. */}
        {shown && (
          <TodayContent
            plan={shown.plan}
            today={today}
            date={date}
            onPick={(d) => setPicked(d === today ? null : d)}
            coach={!shown.coachSeen}
            doneOpen={shown.doneOpen === true}
          />
        )}
      </Skeleton>
    </Screen>
  );
}

function seeCoach(): void {
  setSetting('coachTodaySeen', true).catch((error: unknown) => logError(error, 'coach'));
}

/** The fold of a compact «Сделано», remembered on the device. */
function rememberDoneOpen(open: boolean): void {
  setSetting('todayDoneOpen', open).catch((error: unknown) => logError(error, 'todayDoneOpen'));
}

interface TodayContentProps {
  plan: DayPlan;
  today: string;
  /** The date picked on the strip (the plan may still be the previous one for a moment). */
  date: string;
  onPick(date: string): void;
  coach: boolean;
  /** A compact «Сделано» is unfolded (the device's setting). */
  doneOpen: boolean;
}

function TodayContent({ plan, today, date, onPick, coach, doneOpen }: TodayContentProps) {
  const isToday = plan.date === today;
  // Every active skill rests on this date: no plan, the pause line and what was done anyway.
  const allPaused = plan.skills.length === 0 && plan.paused.length > 0;

  if (plan.skills.length === 0 && !allPaused) {
    // The templates' first run only on a device without any skill; a returning owner whose skills
    // are all archived or reached gets one way to a new skill.
    if (!plan.hasSkills) return <FirstRunEmpty illustration="today" title={t.emptyTitle} />;
    return <EmptyState illustration="today" title={t.noActiveTitle} text={t.noActiveText} action={{ label: copy.home.newSkill, to: '/skills/new' }} />;
  }

  if (!allPaused && plan.due.length === 0 && plan.quota.length === 0 && plan.extra.length === 0) {
    const [first, ...rest] = plan.skills.slice(0, MAX_SKILL_BUTTONS).map((s) => s.skill);
    return (
      <>
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
        <PausedLine paused={plan.paused} />
      </>
    );
  }

  const dayPoints = fromDeci(plan.done.reduce((sum, d) => sum + (d.completion.status === 'ACTIVE' ? toDeci(d.completion.pointsAwarded) : 0), 0));
  const activeToday = plan.done.some((d) => d.completion.status === 'ACTIVE');
  // Nothing planned: the long hint is for a day that has nothing yet; once something is
  // logged the day's points say enough and the line steps back to a quiet caption.
  const summary = !isToday
    ? t.summaryPast(plan.date)
    : plan.totalPlanned === 0
      ? activeToday || allPaused
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
      <WeekPicker today={today} selected={date} counts={plan.weekActivity} rest={plan.weekRest} onSelect={onPick} />
      {allPaused && <EmptyState illustration="today" title={t.allPausedTitle} text={t.allPausedText(plan.paused.every((p) => p.pause.until !== null))} />}
      {/* Keyed by the day: lingering rows, the kept order and the «Ещё» fold belong to one day. */}
      <DayBody key={plan.date} plan={plan} today={today} coach={coach} compact={plan.skills.length >= COMPACT_SKILLS} doneOpen={doneOpen} />
    </>
  );
}

/**
 * «Осталось» of a busy day in its first order: the skill with the most rows first, then in the
 * read model's order, the rows of a skill together in their own order. useStableOrder keeps
 * this first order while the screen is open, so a row completed never reorders the skills.
 */
export function bySkillLoad(rows: readonly PlanRow[]): PlanRow[] {
  const load = new Map<string, number>();
  const first = new Map<string, number>();
  rows.forEach((row, i) => {
    load.set(row.skill.id, (load.get(row.skill.id) ?? 0) + 1);
    if (!first.has(row.skill.id)) first.set(row.skill.id, i);
  });
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const sa = a.row.skill.id;
      const sb = b.row.skill.id;
      return load.get(sb)! - load.get(sa)! || first.get(sa)! - first.get(sb)! || a.i - b.i;
    })
    .map(({ row }) => row);
}

type Shown<T> = { item: T; leaving: boolean };

/** The rows of «Осталось» grouped by skill, in the order each skill first appears. */
function groupBySkill(rows: readonly Shown<PlanRow>[]): { skillId: string; rows: Shown<PlanRow>[] }[] {
  const groups = new Map<string, Shown<PlanRow>[]>();
  for (const row of rows) {
    const list = groups.get(row.item.skill.id);
    if (list) list.push(row);
    else groups.set(row.item.skill.id, [row]);
  }
  return [...groups.entries()].map(([skillId, list]) => ({ skillId, rows: list }));
}

interface DayBodyProps {
  plan: DayPlan;
  today: string;
  coach: boolean;
  /** A busy day (COMPACT_SKILLS skills or more): the folds and the grouped «Осталось». */
  compact: boolean;
  doneOpen: boolean;
}

function DayBody({ plan, today, coach, compact, doneOpen }: DayBodyProps) {
  const [openCompletion, setOpenCompletion] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  // Skills whose «Осталось» rows were unfolded with «Ещё N».
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const [doneShown, setDoneShown] = useState(doneOpen);
  const isToday = plan.date === today;
  const keyOfRow = (row: PlanRow) => row.step.id;
  // Rows keep their place while the screen is open; a completed one shows its ✓ before it goes.
  const due = useLinger(useStableOrder(compact ? bySkillLoad(plan.due) : plan.due, keyOfRow), keyOfRow, BUSY_TAIL_MS);
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
  // A busy day keeps «Ещё» folded; otherwise it unfolds once nothing is left.
  const moreIsOpen = moreOpen ?? (compact ? false : due.length === 0);

  const row = ({ item, leaving }: Shown<PlanRow>, withQuota: boolean) => (
    <StepRow
      key={item.step.id}
      step={item.step}
      skill={item.skill}
      todayCount={item.count}
      mode="complete"
      date={plan.date}
      context={item.skill.name}
      quota={withQuota ? { done: item.done, target: item.target } : undefined}
      marker={compact ? <span className="step-row-dot" aria-hidden="true" {...colorScope(item.skill.color)} /> : undefined}
      onResult={leaving ? undefined : onResult}
    />
  );
  const rowsOf = (rows: typeof due, withQuota: boolean) => <ul className="list">{rows.map((r) => row(r, withQuota))}</ul>;

  /** A busy day's «Осталось»: skill by skill, a long skill folded after DUE_SHOWN rows. */
  const dueBySkill = () => (
    <ul className="list">
      {groupBySkill(due).flatMap(({ skillId, rows }) => {
        if (rows.length <= DUE_SHOWN || unfolded.has(skillId)) return rows.map((r) => row(r, false));
        const hidden = rows.length - DUE_SHOWN;
        return [
          ...rows.slice(0, DUE_SHOWN).map((r) => row(r, false)),
          <li key={`more:${skillId}`}>
            <button
              type="button"
              className="due-more pressable-row"
              aria-label={t.dueMoreLabel(hidden, rows[0]!.item.skill.name)}
              onClick={() => {
                haptics.select();
                setUnfolded((set) => new Set(set).add(skillId));
              }}
            >
              <span className="step-row-dot" aria-hidden="true" {...colorScope(rows[0]!.item.skill.color)} />
              {t.dueMore(hidden)}
              <Icon name="chevron-down" size={18} className="disclosure-chevron" />
            </button>
          </li>,
        ];
      })}
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
          <div className="card">{compact ? dueBySkill() : rowsOf(due, false)}</div>
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
        (planned || compact ? (
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

      {/* Only what happened: an empty today shows nothing here; a past day says so plainly. A
          busy day folds it into one line, «Отмечено: 7 · +54 очка», remembered on the device —
          only while something counts: cancelled rows alone keep the plain section. */}
      {compact && done.some((r) => !r.cancelled) ? (
        <details
          className="disclosure today-done today-done-fold"
          open={doneShown}
          onToggle={(e) => {
            const open = e.currentTarget.open;
            if (open === doneShown) return;
            setDoneShown(open);
            rememberDoneOpen(open);
          }}
        >
          <summary>
            <span className="today-done-line">{doneLine(plan, isToday)}</span>
            <Icon name="chevron-down" size={18} className="disclosure-chevron" />
          </summary>
          {doneList(done, setOpenCompletion)}
        </details>
      ) : (
        (done.length > 0 || !isToday) && (
          <section className="today-done">
            <h2 className="section-title">{isToday ? t.done : t.donePast}</h2>
            {done.length > 0 ? doneList(done, setOpenCompletion) : <p className="card card-padded hint today-done-empty">{t.doneEmptyPast}</p>}
          </section>
        )
      )}

      <PausedLine paused={plan.paused} />

      <CompletionSheet completionId={openCompletion} onClose={() => setOpenCompletion(null)} />
    </>
  );
}

/**
 * «Отмечено: 7 · +54 очка»: every ACTIVE completion of the day and its points — a paused
 * skill's and those of «Ещё» too, so not the plan's «Сделано N из M» above.
 */
function doneLine(plan: DayPlan, isToday: boolean): string {
  let n = 0;
  let deci = 0;
  for (const { completion } of plan.done) {
    if (completion.status !== 'ACTIVE') continue;
    n += 1;
    deci += toDeci(completion.pointsAwarded);
  }
  return isToday ? t.doneSummary(n, fromDeci(deci)) : t.doneSummaryPast(n, fromDeci(deci));
}

/** «Сделано»: one row per action and status; a row opens its latest completion. */
function doneList(done: DoneRow[], open: (id: string) => void) {
  return (
    <ul className="card list">
      {done.map((row) => (
        <li key={row.key}>
          {/* Opens the latest completion of the row; older ones are in the skill's history. */}
          <button type="button" className={`done-row pressable-row${row.cancelled ? ' is-cancelled' : ''}`} onClick={() => open(row.latestId)}>
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
  );
}

/**
 * «На паузе: Гитара до 10 октября, Бег» at the end of the day (package 18): the skills resting
 * on it, each a link to its screen, where the pause is taken off. Nothing without one.
 */
function PausedLine({ paused }: { paused: DayPlan['paused'] }) {
  if (paused.length === 0) return null;
  return (
    <p className="today-paused">
      <Icon name="pause" filled size={14} className="today-paused-icon" />
      <span>
        {t.pausedLine}{' '}
        {paused.map(({ skill, pause }, i) => (
          <span key={skill.id} className="today-paused-item">
            <Link to={`/skills/${skill.id}`}>{skill.name}</Link>
            {pause.until !== null && ` ${t.pausedUntil(pause.until)}`}
            {i < paused.length - 1 && ', '}
          </span>
        ))}
      </span>
    </p>
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
