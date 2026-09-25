import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDate } from '../../lib/dates';
import { nowDate } from '../../lib/clock';
import {
  formatElapsed,
  isLongTimer,
  isOldTimer,
  minutesToRecord,
  msUntilGoal,
  timerElapsedMs,
  timerProblem,
  type ActiveTimer,
} from '../../domain/timer';
import type { Skill, StepDefinition } from '../../domain/types';
import { startTimer, type TimerView } from '../../services/timer';
import { discardTimer, getTimerSkillProgress, pauseActiveTimer, recordTimer, resumeActiveTimer } from '../../services/timerControl';
import { useBottomButtons } from '../../platform/buttons';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { useCelebrations } from '../celebrations/CelebrationProvider';
import { errorMessage, writeCompletion } from '../completionFeedback';
import { Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { useScreenFooterHeight } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { useHasTabBar } from '../components/TabBar';
import { useToast } from '../components/Toast';
import { ProgressMini } from '../progress/ProgressHero';
import { colorScope, copyForSkill, skillTheme } from '../progress/registry';
import { MinutesSheet } from '../sheets/MinutesSheet';
import type { TimerHostProps } from './context';
import { timerCopy as t } from './strings';
import { useNow } from './tick';

// Everything a live timer shows (v0.5 package 15), a lazy chunk loaded with the first timer:
// - the pill above the tab bar or the bottom buttons on every screen: the action, mm:ss, ⏸/▶
//   and ■. It publishes its height as --timer-room, which lifts the toast above it and gives
//   the page end room, so it never covers a toast, the coach hint or the last row;
// - the sheet «Таймер»: large digits, the skill's mini, the usual minutes as a ring, pause and
//   resume, «Завершить» (the MainButton in Telegram) and «Сбросить»; the screen stays awake
//   while it is open (Screen Wake Lock, where the browser has it);
// - the finish flow: «Сколько минут?» with the timer's minutes and start day filled in, over
//   the timer sheet, so «Назад» returns to the timer; «Готово» records through the ordinary
//   completion (toast with «Отменить», celebrations, achievements);
// - the rules around it: a timer whose action or skill is gone is removed with a neutral toast;
//   the usual minutes, reached while the app is open, get haptics and a toast once.

interface Shown {
  timer: ActiveTimer;
  step: StepDefinition;
  skill: Skill;
}

/** The view when its timer can be shown and recorded. */
function shownOf(view: TimerView | null): Shown | null {
  if (!view || !view.step || !view.skill || timerProblem(view.step, view.skill)) return null;
  return { timer: view.timer, step: view.step, skill: view.skill };
}

interface Finish {
  shown: Shown;
  minutes: number;
  date: string;
  warning: string | null;
  /** The action whose ▶ asked to replace this timer: started once this one is recorded. */
  next: StepDefinition | null;
  open: boolean;
}

/** A goal toast this late (a WebView that slept through the moment) is not shown: the app was not open then. */
const GOAL_LATE_MS = 5000;

export default function TimerHost({ view, handle }: TimerHostProps) {
  const live = shownOf(view);
  const liveRef = useRef(live);
  liveRef.current = live;
  // The sheets keep the timer they were opened for while they close: once recorded it is gone.
  const kept = useRef<Shown | null>(null);
  if (live) kept.current = live;
  const shown = live ?? kept.current;

  const { showToast } = useToast();
  const celebrations = useCelebrations();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [finish, setFinish] = useState<Finish | null>(null);
  const sheetClose = useRef<() => void>(() => {});
  const pill = useRef<HTMLDivElement>(null);
  /** «Готово» was pressed in the finish sheet (not «Назад»): the timer sheet under it closes too. */
  const finished = useRef(false);

  // A timer that can no longer be recorded (the action left the list, the skill was archived,
  // completed or deleted, here or in another tab) is removed, once, with a neutral word.
  const dropped = useRef<string | null>(null);
  useEffect(() => {
    if (!view) return;
    const problem = timerProblem(view.step, view.skill);
    if (!problem || dropped.current === view.timer.startedAt) return;
    dropped.current = view.timer.startedAt;
    const message = problem === 'step' ? t.stepGone : t.skillInactive(view.skill?.name ?? '');
    discardTimer(view.timer.startedAt).then(
      () => showToast(message),
      (error: unknown) => showToast(errorMessage(error)),
    );
  }, [view, showToast]);

  // Gone while the timer sheet is open and no finish is under way (another tab finished it).
  const gone = live === null;
  useEffect(() => {
    if (gone && !finished.current) sheetClose.current();
  }, [gone]);

  // The usual minutes reached while the app is open: haptics and a toast, once per timer.
  const goal = live?.step.defaultMinutes ?? null;
  const timerKey = live ? `${live.timer.startedAt}|${live.timer.pausedAt}|${live.timer.pausedMs}` : null;
  useEffect(() => {
    const current = liveRef.current;
    if (!current || current.timer.pausedAt !== null || goal === null) return;
    const left = msUntilGoal(current.timer, goal, nowDate());
    if (left === null) return;
    const id = window.setTimeout(() => {
      const latest = liveRef.current;
      if (!latest || latest.timer.startedAt !== current.timer.startedAt || document.visibilityState === 'hidden') return;
      if (timerElapsedMs(latest.timer, nowDate()) - goal * 60_000 > GOAL_LATE_MS) return;
      haptics.success();
      showToast(t.goalReached(goal));
    }, left);
    return () => window.clearTimeout(id);
  }, [timerKey, goal, showToast]);

  function beginFinish(target: Shown, next: StepDefinition | null) {
    const elapsed = timerElapsedMs(target.timer, nowDate());
    const warning = isOldTimer(target.timer, localDate()) ? t.old(target.timer.date) : isLongTimer(elapsed) ? t.long : null;
    finished.current = false;
    haptics.tap();
    setFinish({ shown: target, minutes: minutesToRecord(elapsed), date: target.timer.date, warning, next, open: true });
  }

  async function record(target: Finish, minutes: number, date: string) {
    haptics.press();
    try {
      await writeCompletion(() => recordTimer(target.shown.timer, { minutes, date }), {
        skillId: target.shown.skill.id,
        stepName: target.shown.step.name,
        levels: copyForSkill(target.shown.skill),
        source: pill.current,
        showToast,
        celebrations,
      });
      if (target.next) await startTimer(target.next.id);
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
    }
  }

  function toggle(target: Shown) {
    haptics.select();
    const write = target.timer.pausedAt === null ? pauseActiveTimer : resumeActiveTimer;
    write(target.timer.startedAt).catch((error: unknown) => showToast(errorMessage(error)));
  }

  function reset() {
    const target = liveRef.current;
    if (!target) return;
    // dialogs.confirm runs synchronously in the click handler, before any await.
    const answer = dialogs.confirm(t.confirmReset, { okLabel: t.confirmResetOk, cancelLabel: t.keep, danger: true });
    void answer.then(async (ok) => {
      if (!ok) return;
      try {
        await discardTimer(target.timer.startedAt);
        haptics.warning();
        sheetClose.current();
        showToast(t.resetDone);
      } catch (error) {
        showToast(errorMessage(error));
      }
    });
  }

  // The step rows' ▶ while a timer exists.
  useEffect(() => {
    handle.current = {
      open: () => {
        haptics.tap();
        setSheetOpen(true);
      },
      replaceWith: (step) => {
        const current = liveRef.current;
        if (!current) return;
        const answer = dialogs.confirm(t.confirmReplace(current.step.name), { okLabel: t.confirmReplaceOk });
        void answer.then((ok) => {
          if (ok && liveRef.current?.timer.startedAt === current.timer.startedAt) beginFinish(current, step);
        });
      },
    };
    return () => {
      handle.current = null;
    };
  });

  return (
    <>
      {live && (
        <TimerPill
          shown={live}
          pillRef={pill}
          onOpen={() => {
            haptics.tap();
            setSheetOpen(true);
          }}
          onToggle={() => toggle(live)}
          onFinish={() => beginFinish(live, null)}
        />
      )}
      {shown && (
        <TimerSheet
          open={sheetOpen}
          shown={shown}
          closeRef={sheetClose}
          onClose={() => setSheetOpen(false)}
          onToggle={() => toggle(shown)}
          onFinish={() => beginFinish(shown, null)}
          onReset={reset}
        />
      )}
      {finish && (
        <MinutesSheet
          open={finish.open}
          step={finish.shown.step}
          initialMinutes={finish.minutes}
          initialDate={finish.date}
          warning={finish.warning}
          onClose={() => {
            setFinish((current) => (current ? { ...current, open: false } : current));
            // «Готово» closes the timer sheet under it too; «Назад» returns to the timer.
            if (finished.current) sheetClose.current();
            finished.current = false;
          }}
          onDone={(minutes, date) => {
            finished.current = true;
            void record(finish, minutes, date ?? finish.date);
          }}
        />
      )}
    </>
  );
}

interface PillProps {
  shown: Shown;
  pillRef: RefObject<HTMLDivElement | null>;
  onOpen(): void;
  onToggle(): void;
  onFinish(): void;
}

const GAP = 8;

function TimerPill({ shown: { timer, step, skill }, pillRef, onOpen, onToggle, onFinish }: PillProps) {
  const running = timer.pausedAt === null;
  const now = useNow(running);
  const time = formatElapsed(timerElapsedMs(timer, new Date(now)));
  const hasTabBar = useHasTabBar();
  const footer = useScreenFooterHeight();
  // Above the tab bar, above an HTML footer (its measured height; a native MainButton lives
  // outside the page), or at the bottom inset — the keyboard lifts the last two.
  const bottom = hasTabBar
    ? `calc(var(--tab-height) + var(--safe-bottom) + ${footer ?? 0}px + ${GAP}px)`
    : footer !== null
      ? `calc(var(--kb) + ${footer}px + ${GAP}px)`
      : `calc(var(--kb) + var(--safe-bottom) + ${GAP}px)`;

  // --timer-room: what the toast rises by and the page end gets, while the pill is on screen.
  useLayoutEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--timer-room', `${Math.ceil(el.offsetHeight + GAP)}px`);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--timer-room');
    };
  }, [pillRef]);

  return (
    <div ref={pillRef} className={`timer-pill${running ? '' : ' is-paused'}`} style={{ bottom }} {...colorScope(skill.color)}>
      <button type="button" className="timer-pill-open" aria-label={`${t.open(step.name)}, ${time}`} onClick={onOpen}>
        <span className="timer-pill-dot" aria-hidden="true" />
        <span className="timer-pill-name">{step.name}</span>
        <span className="timer-pill-time">{time}</span>
      </button>
      <button type="button" className="timer-pill-button" aria-label={running ? t.pause : t.resume} onClick={onToggle}>
        <Icon name={running ? 'pause' : 'play'} filled size={20} />
      </button>
      <button type="button" className="timer-pill-button" aria-label={t.finish} onClick={onFinish}>
        <Icon name="stop" filled size={18} />
      </button>
    </div>
  );
}

interface SheetProps {
  open: boolean;
  shown: Shown;
  closeRef: MutableRefObject<() => void>;
  onClose(): void;
  onToggle(): void;
  onFinish(): void;
  onReset(): void;
}

const DIAL = 216;

function TimerSheet({ open, shown: { timer, step, skill }, closeRef, onClose, onToggle, onFinish, onReset }: SheetProps) {
  const running = timer.pausedAt === null;
  // Ticks only while the sheet is open; the pill has its own subscriber to the same interval.
  const now = useNow(open && running);
  const elapsed = timerElapsedMs(timer, new Date(now));
  const progress = useLiveQuery(() => getTimerSkillProgress(skill.id), [skill.id]);
  const levels = copyForSkill(skill);
  const goal = step.defaultMinutes;
  const old = isOldTimer(timer, localDate());
  useWakeLock(open);
  const { native } = useBottomButtons({ main: open ? { text: t.finish, onClick: onFinish } : undefined }, 1);

  const digits = (
    <span className="timer-dial-text">
      <span className="timer-digits" role="timer">
        {formatElapsed(elapsed)}
      </span>
      <span className="timer-dial-caption" aria-live="polite">
        {running ? (goal ? t.goal(goal) : ' ') : t.paused}
      </span>
    </span>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t.title}
      closeRef={closeRef}
      className="timer-sheet"
      footer={
        native ? undefined : (
          <button type="button" className="button button-primary button-block" onClick={onFinish}>
            {t.finish}
          </button>
        )
      }
    >
      <div className="timer-sheet-body" {...colorScope(skill.color)}>
        <div className="timer-sheet-skill">
          {progress ? (
            <ProgressMini theme={skillTheme(skill.theme)} fill={progress.fill} level={progress.currentFlask} size={40} />
          ) : (
            <span className="progress-mini-placeholder" style={{ width: 40, height: 40 }} aria-hidden="true" />
          )}
          <span className="timer-sheet-names">
            <span className="timer-sheet-step t-body-strong">{step.name}</span>
            <span className="timer-sheet-level t-caption">
              {progress ? t.skillLine(skill.name, levels.state(progress.currentFlask, progress.pointsInCurrentFlask, progress.currentCapacity)) : skill.name}
            </span>
          </span>
        </div>
        <div className={`timer-dial${running ? '' : ' is-paused'}`}>
          {goal ? (
            <Ring value={elapsed / (goal * 60_000)} size={DIAL} stroke={8}>
              {digits}
            </Ring>
          ) : (
            <span className="timer-dial-plain" style={{ width: DIAL, height: DIAL }}>
              {digits}
            </span>
          )}
        </div>
        {old && <p className="timer-warning">{t.old(timer.date)}</p>}
        <div className="timer-sheet-actions">
          <button type="button" className="button button-block timer-toggle" onClick={onToggle}>
            <Icon name={running ? 'pause' : 'play'} filled size={20} />
            {running ? t.pause : t.resume}
          </button>
          <button type="button" className="text-button timer-reset" onClick={onReset}>
            {t.reset}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Keeps the screen on while `active` (Screen Wake Lock); silently nothing where it is missing or refused. */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    const wakeLock = active && typeof navigator !== 'undefined' && 'wakeLock' in navigator ? navigator.wakeLock : undefined;
    if (!wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;
    const request = () => {
      // A lock is released whenever the page hides; ask again when it is back.
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      wakeLock.request('screen').then(
        (lock) => {
          if (stopped) void lock.release().catch(() => {});
          else sentinel = lock;
        },
        () => {},
      );
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
