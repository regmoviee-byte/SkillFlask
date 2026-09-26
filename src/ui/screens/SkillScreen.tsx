import { Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type RefObject } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { markHeight, marksForFlask } from '../../domain/marks';
import { fromDeci, toDeci } from '../../domain/points';
import { flaskCapacity, type Progress } from '../../domain/progression';
import type { Pause, Skill } from '../../domain/types';
import { getSkillHistory, HISTORY_PAGE } from '../../services/history';
import { restartSkill, restoreSkill } from '../../services/lifecycle';
import { endPause } from '../../services/pauses';
import { deleteSkill } from '../../services/skills';
import { getSkillDetails, type SkillDetails } from '../../services/queries';
import { setStepActive } from '../../services/steps';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { copyText } from '../../platform/clipboard';
import { skillLink } from '../../platform/deeplink';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { isTelegram } from '../../platform/telegram';
import { useCelebrationStage, type HeroLevelUp } from '../celebrations/CelebrationProvider';
import { errorMessage } from '../completionFeedback';
import { ContextSheet, type ContextItem } from '../components/ContextSheet';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { MilestoneRack } from '../components/MilestoneRack';
import { Screen } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { scheduleCaption, StepRow, stepValue } from '../components/StepRow';
import { Timeline } from '../components/Timeline';
import { useToast } from '../components/Toast';
import { copy, type LevelCopy } from '../copy';
import { useCountUp } from '../hooks/useCountUp';
import { useToday } from '../hooks/useToday';
import { lazySafe } from '../lazySafe';
import { SkillActivity, SkillForecast } from '../insights/lazy';
import { SkillHistorySearch } from '../search/lazy';
import type { ProgressHeroHandle, ProgressMark } from '../progress/contract';
import { ProgressHero } from '../progress/ProgressHero';
import { colorScope, copyForSkill, skillTheme } from '../progress/registry';
import { AppearanceSheet } from '../sheets/AppearanceSheet';
import { CompletionSheet } from '../sheets/CompletionSheet';
import { MarkSheet, type MarkSheetTarget } from '../sheets/MarkSheet';
import { PauseSheet } from '../pause/lazy';
import { ShareSheet } from '../share/lazy';

// The link fallback is a lazy chunk (v0.5 package 14 won back the initial load with it): it
// starts loading with the screen, long before a refused clipboard could need it. Where the chunk
// does not load, the link cannot be shown: a toast says so instead of the tap doing nothing.
function LinkUnavailable({ link, onClose }: { link: string | null; onClose(): void }) {
  const { showToast } = useToast();
  useEffect(() => {
    if (link === null) return;
    showToast(copy.errors.sheetChunk);
    onClose();
  }, [link, onClose, showToast]);
  return null;
}

type LinkSheetProps = Parameters<typeof import('../sheets/LinkSheet').LinkSheet>[0];

const LinkSheet = lazySafe<ComponentType<LinkSheetProps>>(
  () => import('../sheets/LinkSheet').then((m) => ({ default: m.LinkSheet })),
  'LinkSheet',
  LinkUnavailable,
);

// Wireframe 2: the skill's progress theme as the hero (the flask by default, ProgressHero) with
// the level number in big numerals, the forecast line («В таком темпе…», ui/insights), the
// milestone rack, the marks («Засечки»), the actions with their ✓, the heat map «Активность» and
// the history as a timeline. What the hero shows can be frozen for a moment by a
// celebration (useCelebrationStage), so the points fly in first. The whole screen is painted in
// the skill's colour (colorScope). The header ⋯ opens the skill's menu: edit it, its
// appearance («Оформление»), add a mark, copy a link that opens it («Ссылка на навык»).
// «История» starts with «Поиск по истории» (ui/search, package 17); a result of the global
// search opens this screen with its completion's (or mark's) sheet on top (SkillOpenRequest).
// A skill on pause (package 18) says so under its name — «На паузе до 10 октября» with «Снять
// паузу» — and can still be completed here; the menu sets the pause or changes its last day.
// «Поделиться прогрессом» (package 19, ui/share) makes a picture of the skill's progress; a
// completed skill keeps a ⋯ menu for it and for its link.

/** Navigation state from the global search: the sheet to open on arrival, once. */
export interface SkillOpenRequest {
  completion?: string;
  mark?: string;
}

export function SkillScreen() {
  const { skillId = '' } = useParams();
  const today = useToday();
  const details = useLiveQuery(() => getSkillDetails(skillId, today), [skillId, today]);
  const navigate = useNavigate();
  const t = copy.skill;
  const [menuOpen, setMenuOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [markTarget, setMarkTarget] = useState<MarkSheetTarget | null>(null);
  const [linkShown, setLinkShown] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const closePause = useCallback(() => setPauseOpen(false), []);
  const [shareOpen, setShareOpen] = useState(false);
  const closeShare = useCallback(() => setShareOpen(false), []);
  const unpausing = useRef(false);
  const copying = useRef<Promise<boolean> | null>(null);
  const { showToast } = useToast();

  const linkTo = (id: string) => skillLink(id, { telegram: isTelegram(), pageUrl: window.location.href });

  function linkCopied() {
    haptics.success();
    showToast(t.linkCopied, { icon: 'link' });
  }

  /**
   * «Ссылка на навык»: the copy starts in the tap (startCopy — iOS WebKit refuses the clipboard
   * once the gesture is over) and is reported after the menu has closed; where the clipboard
   * refuses, the link is shown to copy by hand.
   */
  function startCopy(id: string) {
    copying.current = copyText(linkTo(id));
  }

  async function finishCopy(id: string) {
    const started = copying.current;
    copying.current = null;
    if (await (started ?? copyText(linkTo(id)))) linkCopied();
    else setLinkShown(linkTo(id));
  }

  if (details === null) {
    return (
      <Screen title={copy.common.skill} back="/skills">
        <EmptyState illustration="skills" title={t.notFoundTitle} text={t.notFoundText} action={{ label: t.toSkills, to: '/skills', replace: true }} />
      </Screen>
    );
  }

  const skill = details?.skill;
  const active = skill?.status === 'ACTIVE';
  // A completed skill has no form or pause, but its progress and link are worth sharing.
  const hasMenu = active || skill?.status === 'COMPLETED';
  const pause = details?.pause ?? null;

  /** «Снять паузу»: back in the plan today, from the menu or the line under the name; a double tap ends it once. */
  async function unpause(id: string) {
    if (unpausing.current) return;
    unpausing.current = true;
    try {
      await endPause(id);
      haptics.success();
      showToast(copy.pause.ended, { icon: 'play' });
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
    } finally {
      unpausing.current = false;
    }
  }

  return (
    <Screen
      title={skill?.name ?? copy.common.skill}
      back="/skills"
      action={
        skill &&
        hasMenu && (
          <button
            type="button"
            className="icon-button"
            aria-label={t.menu}
            aria-haspopup="dialog"
            onClick={() => {
              haptics.select();
              setMenuOpen(true);
            }}
          >
            <Icon name="more" size={24} />
          </button>
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
        {details && (
          <div className="liquid-scope" {...colorScope(details.skill.color)}>
            <SkillContent details={details} today={today} onMark={setMarkTarget} onUnpause={() => void unpause(details.skill.id)} />
          </div>
        )}
      </Skeleton>
      {skill && (
        <ContextSheet
          open={menuOpen && hasMenu}
          title={skill.name}
          onClose={() => setMenuOpen(false)}
          items={skillMenu(
            skill.id,
            active,
            navigate,
            () => setAppearanceOpen(true),
            () => setMarkTarget({ kind: 'new' }),
            {
              start: () => startCopy(skill.id),
              finish: () => void finishCopy(skill.id),
            },
            { paused: pause !== null, open: () => setPauseOpen(true), end: () => void unpause(skill.id) },
            () => setShareOpen(true),
          )}
        />
      )}
      <Suspense fallback={null}>
        <LinkSheet link={linkShown} telegram={isTelegram()} onClose={() => setLinkShown(null)} onCopied={linkCopied} />
      </Suspense>
      {skill && active && <AppearanceSheet skill={skill} open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />}
      {skill && active && <PauseSheet skill={skill} pause={pause} open={pauseOpen} today={today} onClose={closePause} />}
      {skill && hasMenu && <ShareSheet skill={skill} open={shareOpen} today={today} onClose={closeShare} />}
      {details && (
        <MarkSheet
          target={markTarget}
          skillId={details.skill.id}
          levels={copyForSkill(details.skill)}
          marks={details.marks}
          capacityOf={(n) => flaskCapacity(n, details.config)}
          editable={active}
          onClose={() => setMarkTarget(null)}
        />
      )}
    </Screen>
  );
}

/**
 * The ⋯ menu: everything for an active skill, only sharing and the link for a completed one.
 * Items run after the menu has closed (ContextSheet).
 */
function skillMenu(
  skillId: string,
  active: boolean,
  navigate: ReturnType<typeof useNavigate>,
  appearance: () => void,
  addMark: () => void,
  copyLink: { start(): void; finish(): void },
  pause: { paused: boolean; open(): void; end(): void },
  share: () => void,
): ContextItem[] {
  const t = copy.pause;
  const shareItems: ContextItem[] = [
    { icon: 'share', label: copy.skill.share, onSelect: share },
    { icon: 'link', label: copy.skill.link, onTap: copyLink.start, onSelect: copyLink.finish },
  ];
  if (!active) return shareItems;
  return [
    { icon: 'edit', label: copy.skill.edit, onSelect: () => navigate(`/skills/${skillId}/edit`) },
    { icon: 'palette', label: copy.appearance.title, onSelect: appearance },
    { icon: 'pennant', label: copy.marks.add, onSelect: addMark },
    ...(pause.paused
      ? [
          { icon: 'play', label: t.menuEnd, onSelect: pause.end } satisfies ContextItem,
          { icon: 'calendar', label: t.menuChange, onSelect: pause.open } satisfies ContextItem,
        ]
      : [{ icon: 'pause', label: t.menuPause, onSelect: pause.open } satisfies ContextItem]),
    ...shareItems,
  ];
}

function SkillContent({ details, today, onMark, onUnpause }: { details: SkillDetails; today: string; onMark(target: MarkSheetTarget): void; onUnpause(): void }) {
  const { skill } = details;
  const active = skill.status === 'ACTIVE';
  const labels = [skill.startLabel, skill.targetLabel].filter(Boolean).join(' → ');
  const t = copy.skill;
  const [openCompletion, setOpenCompletion] = useState<string | null>(null);
  const [limit, setLimit] = useState(HISTORY_PAGE);
  // `today` re-keys the query so «Сегодня / Вчера» move on at midnight.
  const history = useLiveQuery(() => getSkillHistory(skill.id, limit), [skill.id, limit, today]);
  const stage = useCelebrationStage(skill.id, details.progress, copyForSkill(skill));
  const progress = stage.shown ?? details.progress;
  // A mark alone is history too: the list shows it rather than the empty state.
  const hasOperations = history ? history.operations > 0 || details.marks.length > 0 : true;
  const openMark = (id: string) => onMark({ kind: 'mark', id });
  const lifecycle = useLifecycle(skill);
  // A day of the home screen's heat map opens the skill at its history, once: the entry then
  // forgets it, so coming back to this screen later starts at the top as usual.
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { focus?: string; open?: SkillOpenRequest } | null;
  const focusHistory = state?.focus === 'history';
  const historyRef = useRef<HTMLElement>(null);
  const historyReady = history !== undefined;
  useEffect(() => {
    if (!focusHistory || !historyReady) return;
    historyRef.current?.scrollIntoView({ block: 'start' });
    navigate({ pathname: location.pathname, search: location.search }, { replace: true });
  }, [focusHistory, historyReady, navigate, location.pathname, location.search]);
  // A result of the global search: its sheet opens over the screen, once (the entry forgets it
  // before the sheet adds its own history entry, so «Назад» closes the sheet, then the screen).
  const openCompletionId = state?.open?.completion;
  const openMarkId = state?.open?.mark;
  useEffect(() => {
    if (!openCompletionId && !openMarkId) return;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    if (openCompletionId) setOpenCompletion(openCompletionId);
    if (openMarkId) onMark({ kind: 'mark', id: openMarkId });
  }, [openCompletionId, openMarkId, onMark, navigate, location.pathname, location.search]);

  return (
    <>
      {(labels || skill.description) && <p className="t-caption skill-subtitle">{[labels, skill.description].filter(Boolean).join(' · ')}</p>}

      {skill.status === 'ARCHIVED' && <ArchivedBanner skill={skill} busy={lifecycle.busy} onRestore={lifecycle.restore} onRestart={lifecycle.restart} />}

      {details.pause && <PauseLine pause={details.pause} onEnd={onUnpause} />}

      <Hero
        details={details}
        progress={progress}
        heroRef={stage.flaskRef}
        heroLevelUp={stage.hero}
        pill={stage.pill}
        announcement={stage.announcement}
        onMarkTap={openMark}
      />

      {active && details.hasForecast && <SkillForecast skillId={skill.id} today={today} />}

      <MilestoneRack
        skill={skill}
        milestone={details.milestone}
        progress={progress}
        onRestart={skill.status === 'COMPLETED' ? lifecycle.restart : undefined}
        restartBusy={lifecycle.busy}
      />

      <MarksCard details={details} onOpen={openMark} onAdd={() => onMark({ kind: 'new' })} />

      <ActionsCard details={details} />

      <SkillActivity skillId={skill.id} active={active} today={today} />

      <section ref={historyRef} className="history">
        <h2 className="section-title">{t.history}</h2>
        {!history ? null : !hasOperations ? (
          <div className="card">
            <EmptyState illustration="history" title={t.historyEmptyTitle} text={active ? t.historyEmptyActive : t.historyEmptyInactive} />
          </div>
        ) : (
          <SkillHistorySearch skill={skill} today={today} hasMarks={details.marks.length > 0} onOpen={setOpenCompletion} onOpenMark={openMark}>
            <Timeline
              events={history.events}
              levels={copyForSkill(skill)}
              today={today}
              hasMore={history.hasMore}
              onMore={() => setLimit((n) => n + HISTORY_PAGE)}
              onOpen={setOpenCompletion}
              onOpenMark={openMark}
            />
          </SkillHistorySearch>
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
 * «Продолжить с этого места», «Начать заново» and «Удалить навык» (section 6). Restarting
 * opens the copy's form for a new name or target; the copy replaces this skill in the history,
 * so «Назад» from the copy leads to the active skills rather than to the skill it was made from.
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
      // The entry below may be home filtered to «Достигнутые» or «Архив», where the new
      // ACTIVE copy is not listed: «Назад» from the copy leads to the plain active list.
      navigate('/skills', { replace: true });
      navigate(`/skills/${id}`);
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

/** «На паузе до 10 октября» under the name, with «Снять паузу» beside it (package 18). */
function PauseLine({ pause, onEnd }: { pause: Pause; onEnd(): void }) {
  return (
    <div className="pause-line">
      <span className="pause-pill">
        <Icon name="pause" filled size={14} />
        {copy.pause.pill(pause.until)}
      </span>
      <button type="button" className="text-button pause-end" onClick={onEnd}>
        {copy.pause.end}
      </button>
    </div>
  );
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
  heroRef: RefObject<ProgressHeroHandle | null>;
  /** The level and fill the hero draws while a level-up plays (set before the choreography), else null. */
  heroLevelUp: HeroLevelUp | null;
  pill: { key: number; flask: number } | null;
  announcement: string;
  onMarkTap(markId: string): void;
}

/**
 * Marks drawn on the hero: the ones of the flask on display (the frozen one during a
 * celebration, so they leave with it at the overflow beat), at their stored points against
 * that flask's capacity today. A sealed flask shows none; the list below has them all.
 */
function heroMarks(details: SkillDetails, progress: Progress): ProgressMark[] {
  if (details.skill.status === 'COMPLETED') return [];
  return marksForFlask(details.marks, progress.currentFlask).map((mark) => ({
    id: mark.id,
    label: mark.title,
    height: markHeight(mark, flaskCapacity(mark.flaskNumber, details.config)),
  }));
}

function Hero({ details, progress: p, heroRef, heroLevelUp, pill, announcement, onMarkTap }: HeroProps) {
  const { skill, milestone } = details;
  const t = copy.skill;
  const lc = copyForSkill(skill);
  const completed = skill.status === 'COMPLETED';
  const marks = heroMarks(details, p);
  // Follows the progress on display, so the laurel appears when the flask gets there.
  const laurel = skill.status === 'ACTIVE' && milestone?.reachedAt != null && p.completedFlasks >= milestone.targetFlaskNumber;
  const percent = Math.floor(p.fill * 100);
  const left = fromDeci(toDeci(p.currentCapacity) - toDeci(p.pointsInCurrentFlask));

  return (
    <section className={`hero${marks.length > 0 ? ' hero--marks' : ''}`}>
      <div className="hero-flask">
        <ProgressHero
          ref={heroRef}
          theme={skillTheme(skill.theme)}
          fill={heroLevelUp?.fill ?? p.fill}
          // A completed level has no current capacity to measure against.
          capacity={completed ? undefined : p.currentCapacity}
          state={completed ? 'complete' : p.totalPoints === 0 ? 'empty' : 'active'}
          label={completed ? lc.completedLabel(p.completedFlasks) : lc.heroLabel(p.currentFlask, p.pointsInCurrentFlask, p.currentCapacity, percent)}
          marks={marks}
          onMarkTap={onMarkTap}
          level={heroLevelUp?.level ?? p.currentFlask}
        />
        {pill && (
          <span key={pill.key} className="level-pill" aria-hidden="true">
            {lc.noun(pill.flask)}
          </span>
        )}
      </div>
      <div className="hero-info">
        <span className="hero-eyebrow t-label">
          {completed ? t.reached : lc.name}
          {laurel && (
            <span className="hero-laurel" role="img" aria-label={t.milestoneReachedIcon}>
              <Icon name="laurel" size={16} />
            </span>
          )}
        </span>
        <RollNumber value={completed ? p.completedFlasks : p.currentFlask} />
        {completed ? (
          <p className="hero-points t-title-m">{lc.levels(p.completedFlasks)}</p>
        ) : (
          <>
            <p className="hero-points t-title-m">
              {/* A new flask starts its count from its own remainder, not from the old flask's points. */}
              <CountUp key={p.currentFlask} value={p.pointsInCurrentFlask} /> <span className="hero-capacity">/ {formatNumber(p.currentCapacity)}</span>
            </p>
            <p className="t-caption hint">{lc.toNext(percent, left, p.currentFlask + 1)}</p>
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

/**
 * «Засечки»: every mark of the skill, newest first: the title, «Колба N» (the theme's noun) under it and the
 * date. An active skill without marks gets a short invitation instead, once it has an action:
 * on a brand-new skill the first action is the one thing to do (the ⋯ menu still adds a
 * mark). A read-only skill without marks shows nothing.
 */
function MarksCard({ details: { skill, marks, steps, hiddenSteps }, onOpen, onAdd }: { details: SkillDetails; onOpen(id: string): void; onAdd(): void }) {
  const t = copy.marks;
  const lc: LevelCopy = copyForSkill(skill);
  const active = skill.status === 'ACTIVE';
  if (marks.length === 0 && (!active || steps.length + hiddenSteps.length === 0)) return null;

  return (
    <section className="marks">
      <h2 className="section-title">{t.title}</h2>
      <div className="card marks-card">
        {marks.length === 0 ? (
          <div className="marks-empty">
            <p className="hint">{t.empty}</p>
            <button type="button" className="button button-secondary marks-add" onClick={onAdd}>
              <Icon name="pennant" size={18} />
              {t.add}
            </button>
          </div>
        ) : (
          <ul className="list">
            {marks.map((mark) => (
              <li key={mark.id}>
                <button type="button" className="mark-row pressable-row" onClick={() => onOpen(mark.id)}>
                  <Icon name="pennant" size={20} className="mark-row-icon" />
                  <span className="mark-row-main">
                    <span className="mark-row-title">{mark.title}</span>
                    <span className="mark-row-flask">{lc.noun(mark.flaskNumber)}</span>
                  </span>
                  <span className="mark-row-date">{formatDate(mark.date)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {active && marks.length > 0 && (
          <button type="button" className="ghost-row pressable-row" onClick={onAdd}>
            <Icon name="plus" size={20} />
            {t.add}
          </button>
        )}
      </div>
    </section>
  );
}
