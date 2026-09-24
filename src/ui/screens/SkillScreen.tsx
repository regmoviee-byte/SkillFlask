import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { fromDeci, toDeci } from '../../domain/points';
import type { Progress } from '../../domain/progression';
import type { Skill } from '../../domain/types';
import { getSkillHistory, HISTORY_PAGE } from '../../services/history';
import { restartSkill, restoreSkill } from '../../services/lifecycle';
import { deleteSkill } from '../../services/skills';
import { getSkillDetails, type SkillDetails } from '../../services/queries';
import { setStepActive } from '../../services/steps';
import { formatNumber } from '../../lib/format';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { useCelebrationStage } from '../celebrations/CelebrationProvider';
import { errorMessage } from '../completionFeedback';
import { EmptyState } from '../components/EmptyState';
import { Flask, type FlaskHandle } from '../components/Flask';
import { Icon } from '../components/Icon';
import { MilestoneRack } from '../components/MilestoneRack';
import { Screen } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { scheduleCaption, StepRow, stepValue } from '../components/StepRow';
import { Timeline } from '../components/Timeline';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { useCountUp } from '../hooks/useCountUp';
import { useToday } from '../hooks/useToday';
import { CompletionSheet } from '../sheets/CompletionSheet';

// Wireframe 2: the flask as the hero with the flask number in big numerals, the milestone
// rack, the actions with their ✓ and the history as a timeline. What the hero shows can be
// frozen for a moment by a celebration (useCelebrationStage), so the points fly in first.

export function SkillScreen() {
  const { skillId = '' } = useParams();
  const today = useToday();
  const details = useLiveQuery(() => getSkillDetails(skillId, today), [skillId, today]);
  const navigate = useNavigate();
  const t = copy.skill;

  if (details === null) {
    return (
      <Screen title={copy.common.skill} back="/skills">
        <EmptyState illustration="skills" title={t.notFoundTitle} text={t.notFoundText} action={{ label: t.toSkills, to: '/skills', replace: true }} />
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
          <Link to={`/skills/${skill.id}/edit`} className="icon-button" aria-label={t.edit}>
            <Icon name="edit" size={22} />
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
        {details && <SkillContent details={details} today={today} />}
      </Skeleton>
    </Screen>
  );
}

function SkillContent({ details, today }: { details: SkillDetails; today: string }) {
  const { skill } = details;
  const active = skill.status === 'ACTIVE';
  const labels = [skill.startLabel, skill.targetLabel].filter(Boolean).join(' → ');
  const t = copy.skill;
  const [openCompletion, setOpenCompletion] = useState<string | null>(null);
  const [limit, setLimit] = useState(HISTORY_PAGE);
  // `today` re-keys the query so «Сегодня / Вчера» move on at midnight.
  const history = useLiveQuery(() => getSkillHistory(skill.id, limit), [skill.id, limit, today]);
  const stage = useCelebrationStage(skill.id, details.progress);
  const progress = stage.shown ?? details.progress;
  const hasOperations = history ? history.operations > 0 : true;
  const lifecycle = useLifecycle(skill);

  return (
    <>
      {(labels || skill.description) && <p className="t-caption skill-subtitle">{[labels, skill.description].filter(Boolean).join(' · ')}</p>}

      {skill.status === 'ARCHIVED' && <ArchivedBanner skill={skill} busy={lifecycle.busy} onRestore={lifecycle.restore} onRestart={lifecycle.restart} />}

      <Hero details={details} progress={progress} flaskRef={stage.flaskRef} pill={stage.pill} announcement={stage.announcement} />

      <MilestoneRack
        skill={skill}
        milestone={details.milestone}
        progress={progress}
        onRestart={skill.status === 'COMPLETED' ? lifecycle.restart : undefined}
        restartBusy={lifecycle.busy}
      />

      <ActionsCard details={details} />

      <section className="history">
        <h2 className="section-title">{t.history}</h2>
        {!history ? null : !hasOperations ? (
          <div className="card">
            <EmptyState illustration="history" title={t.historyEmptyTitle} text={active ? t.historyEmptyActive : t.historyEmptyInactive} />
          </div>
        ) : (
          <Timeline events={history.events} today={today} hasMore={history.hasMore} onMore={() => setLimit((n) => n + HISTORY_PAGE)} onOpen={setOpenCompletion} />
        )}
      </section>

      {/* An active skill is deleted from its form; an archived or completed one has no form
          to open, so «Удалить навык» closes its screen (section 6: any state → delete). */}
      {!active && (
        <div className="danger-zone">
          <button type="button" className="button button-block button-danger" disabled={lifecycle.busy} onClick={lifecycle.remove}>
            {copy.skillForm.remove}
          </button>
        </div>
      )}

      <CompletionSheet completionId={openCompletion} onClose={() => setOpenCompletion(null)} />
    </>
  );
}

/**
 * «Продолжить с этого места», «Начать заново» and «Удалить навык» (section 6). Restarting opens the copy's form
 * for a new name or target; the copy replaces this skill in the history, so «Назад» from the
 * copy leads home rather than to the skill it was made from.
 */
function useLifecycle(skill: Skill) {
  const t = copy.lifecycle;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  // Rule: a double tap must not queue two confirmations; the ref flips before the first await.
  const busyRef = useRef(false);

  async function guarded(action: () => Promise<void>) {
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function restore() {
    if (busyRef.current) return;
    void guarded(async () => {
      await restoreSkill(skill.id);
      haptics.success();
      showToast(t.restored);
    });
  }

  function restart() {
    if (busyRef.current) return;
    // dialogs.confirm runs synchronously in the click handler, before any await.
    const answer = dialogs.confirm(t.confirmRestart(skill.name, skill.status === 'ARCHIVED'), { okLabel: t.restart });
    void guarded(async () => {
      if (!(await answer)) return;
      const id = await restartSkill(skill.id);
      haptics.success();
      navigate(`/skills/${id}`, { replace: true });
      navigate(`/skills/${id}/edit`);
      showToast(t.restarted);
    });
  }

  function remove() {
    if (busyRef.current) return;
    const f = copy.skillForm;
    const answer = dialogs.confirm(f.confirmRemove, { okLabel: f.removeConfirmButton, danger: true });
    void guarded(async () => {
      if (!(await answer)) return;
      await deleteSkill(skill.id);
      showToast(f.removed);
      navigate('/skills', { replace: true });
    });
  }

  return { busy, restore, restart, remove };
}

function ArchivedBanner({ skill, busy, onRestore, onRestart }: { skill: Skill; busy: boolean; onRestore(): void; onRestart(): void }) {
  const t = copy.lifecycle;
  return (
    <section className="card card-padded archived-banner">
      <p className="archived-banner-title">
        <Icon name="archive" size={20} />
        {t.archivedSince(skill.archivedAt ?? skill.updatedAt)}
      </p>
      <p className="t-caption hint">{t.archivedText}</p>
      <div className="button-stack">
        <button type="button" className="button button-primary" disabled={busy} onClick={onRestore}>
          {t.restore}
        </button>
        <button type="button" className="button" disabled={busy} onClick={onRestart}>
          {t.restart}
        </button>
      </div>
    </section>
  );
}

interface HeroProps {
  details: SkillDetails;
  progress: Progress;
  flaskRef: RefObject<FlaskHandle | null>;
  pill: { key: number; flask: number } | null;
  announcement: string;
}

function Hero({ details: { skill, milestone }, progress: p, flaskRef, pill, announcement }: HeroProps) {
  const t = copy.skill;
  const completed = skill.status === 'COMPLETED';
  // Follows the progress on display, so the laurel appears when the flask gets there.
  const laurel = skill.status === 'ACTIVE' && milestone?.reachedAt != null && p.completedFlasks >= milestone.targetFlaskNumber;
  const percent = Math.floor(p.fill * 100);
  const left = fromDeci(toDeci(p.currentCapacity) - toDeci(p.pointsInCurrentFlask));

  return (
    <section className="hero">
      <div className="hero-flask">
        <Flask
          ref={flaskRef}
          size="hero"
          fill={p.fill}
          // A sealed flask has no current capacity to measure against.
          capacity={completed ? undefined : p.currentCapacity}
          state={completed ? 'complete' : p.totalPoints === 0 ? 'empty' : 'active'}
          label={completed ? t.completedFlaskLabel(p.completedFlasks) : t.flaskLabel(p.currentFlask, p.pointsInCurrentFlask, p.currentCapacity, percent)}
        />
        {pill && (
          <span key={pill.key} className="level-pill" aria-hidden="true">
            {t.levelPill(pill.flask)}
          </span>
        )}
      </div>
      <div className="hero-info">
        <span className="hero-eyebrow t-label">
          {completed ? t.reached : t.flask}
          {laurel && (
            <span className="hero-laurel" role="img" aria-label={t.milestoneReachedIcon}>
              <Icon name="laurel" size={16} />
            </span>
          )}
        </span>
        <RollNumber value={completed ? p.completedFlasks : p.currentFlask} />
        {completed ? (
          <p className="hero-points t-title-m">{t.flasksDone(p.completedFlasks)}</p>
        ) : (
          <>
            <p className="hero-points t-title-m">
              {/* A new flask starts its count from its own remainder, not from the old flask's points. */}
              <CountUp key={p.currentFlask} value={p.pointsInCurrentFlask} /> <span className="hero-capacity">/ {formatNumber(p.currentCapacity)}</span>
            </p>
            <p className="t-caption hint">{t.toNext(percent, left, p.currentFlask + 1)}</p>
          </>
        )}
        <span className="hero-total">{t.total(p.totalPoints)}</span>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}

function CountUp({ value }: { value: number }) {
  const shown = useCountUp(value);
  // Whole points count in whole steps; tenths only when the value has them.
  return <>{formatNumber(Number.isInteger(value) ? Math.round(shown) : Math.round(shown * 10) / 10)}</>;
}

const ROLL_MS = 300;

/** The flask number: rolls vertically (300 ms) when it changes; a crossfade under reduced motion. */
function RollNumber({ value }: { value: number }) {
  const [roll, setRoll] = useState<{ current: number; previous: number | null; up: boolean; key: number }>({
    current: value,
    previous: null,
    up: true,
    key: 0,
  });
  if (roll.current !== value) setRoll({ current: value, previous: roll.current, up: value > roll.current, key: roll.key + 1 });

  useEffect(() => {
    if (roll.previous === null) return;
    const timer = window.setTimeout(() => setRoll((r) => ({ ...r, previous: null })), ROLL_MS + 50);
    return () => window.clearTimeout(timer);
  }, [roll.key, roll.previous]);

  return (
    <span className={`roll t-display-xl${roll.up ? ' is-up' : ' is-down'}`}>
      {roll.previous !== null && (
        <span key={`out-${roll.key}`} className="roll-out" aria-hidden="true">
          {roll.previous}
        </span>
      )}
      <span key={`in-${roll.key}`} className={roll.key > 0 ? 'roll-in' : undefined}>
        {roll.current}
      </span>
    </span>
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
                    <span className="step-row-meta">{[stepValue(step), scheduleCaption(step)].filter(Boolean).join(' · ')}</span>
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
