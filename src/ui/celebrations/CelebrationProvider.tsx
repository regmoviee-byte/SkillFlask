import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { AchievementState } from '../../domain/achievements/types';
import type { Progress } from '../../domain/progression';
import { nowIso } from '../../lib/dates';
import { filterStillUnlocked, markCelebrated, onAchievementsEarned } from '../../services/achievements';
import type { MutationResult } from '../../services/completions';
import { getSkillWithMilestone } from '../../services/queries';
import { haptics } from '../../platform/haptics';
import { logError } from '../../platform/errorLog';
import type { FlaskHandle } from '../components/Flask';
import { openSheetCount } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { flyPoints, onScreen } from '../hooks/usePointsFly';
import { AchievementCard, type AchievementCardContent } from './AchievementCard';
import { MilestoneSheet } from './MilestoneSheet';
import { levelUpPlace, orderCelebrations, type CelebrationEvent, type LevelUpPlay } from './orderCelebrations';
import { TopCard, type TopCardContent } from './TopCard';

// One place for reward moments. Screens that show a skill's flask register a stage; mutations
// hold that stage before they write (so the live query cannot move the flask first) and hand
// the service result over. Then, in order: the points fly into the glass, the flask plays its
// level-up (or, for a write made away from it, the pill on the hero it returns to; or a TopCard
// where no flask of the skill is on screen — levelUpPlace), the milestone sheet opens.
// New achievements come last, as cards at the top on a queue of their own (400 ms apart, one
// card for more than two from one write), so a quick next tap never waits for them; a card
// waits until no sheet is open, the TopCard has left and the pill «Колба N» has gone.
// Achievements of writes without a MutationResult (a new skill or step, completing a skill)
// arrive through onAchievementsEarned.
// Never an overlay, never confetti; nothing plays unless this session wrote something.

export interface CelebrationStage {
  flask(): FlaskHandle | null;
  /** Freeze the displayed progress at what is on screen now (nested holds are counted). */
  hold(): void;
  release(): void;
  /** Update the frozen progress, e.g. the flask number at the overflow beat. */
  show(progress: Progress): void;
  /** Pill «Колба N» above the rim and the aria-live «Колба N заполнена». */
  announce(filled: number, newFlask: number): void;
}

export interface CelebrateContext {
  skillId: string;
  /**
   * The flask to play on; the registered stage's flask when omitted. An explicit null means
   * the write happened away from the flask («Задним числом»): a level-up is told on the skill's
   * hero when the screen after the write shows it (levelUpPlace), by the TopCard otherwise.
   */
  flaskRef?: FlaskHandle | null;
  /** Where the «+N» flies from (the ✓); no flight without it. */
  source?: Element | null;
  points?: number;
  skillName?: string;
  /** Progress after the write, shown at the overflow beat of a level-up. */
  after?: Progress;
  /**
   * The caller navigates right after the write («Задним числом» goes back): play once the
   * route has changed, so the milestone sheet's history entry lands on the new screen.
   */
  afterNavigation?: boolean;
}

interface Celebrations {
  /** Freezes the skill's flask on screen until the returned release runs. */
  hold(skillId: string): () => void;
  celebrate(events: CelebrationEvent[], ctx: CelebrateContext): Promise<void>;
  /** Orders the result's celebrations (orderCelebrations) and plays them; resolves when done. */
  celebrateResult(result: MutationResult, ctx: CelebrateContext): Promise<void>;
  register(skillId: string, stage: CelebrationStage): () => void;
}

const noop = () => {};
const CelebrationContext = createContext<Celebrations>({
  hold: () => noop,
  celebrate: async () => {},
  celebrateResult: async () => {},
  register: () => noop,
});

export const useCelebrations = () => useContext(CelebrationContext);

type MilestoneEvent = Extract<CelebrationEvent, { kind: 'milestone' }>;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const NAVIGATION_TIMEOUT_MS = 1000;
const SHEET_WAIT_MS = 2000;
/** Pause between two achievement cards. */
const CARD_GAP_MS = 400;
/** More achievements than this from one write are told in one card: «… и ещё 2 ачивки». */
const CARD_MAX_SEPARATE = 2;
const POLL_MS = 100;
/** How long a write made away from the flask waits for the skill screen it returns to. */
const HERO_WAIT_MS = 1500;

/**
 * A sheet pushes a history entry; another sheet still closing (the completion sheet after
 * «Вернуть») pops one asynchronously. Opening the milestone sheet waits until no sheet is open
 * and the pop has landed, so the two never interleave.
 */
async function sheetsSettled(): Promise<void> {
  const until = performance.now() + SHEET_WAIT_MS;
  if (openSheetCount() === 0) return;
  while (openSheetCount() > 0 && performance.now() < until) await wait(50);
  await wait(100);
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationWaiters = useRef(new Set<() => void>());
  useEffect(() => {
    navigationWaiters.current.forEach((resolve) => resolve());
    navigationWaiters.current.clear();
  }, [location.key]);
  /** Resolves on the next route change, or after a second when none comes. */
  const nextNavigation = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer);
          navigationWaiters.current.delete(done);
          resolve();
        };
        const timer = window.setTimeout(done, NAVIGATION_TIMEOUT_MS);
        navigationWaiters.current.add(done);
      }),
    [],
  );
  const stages = useRef(new Map<string, CelebrationStage>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [milestone, setMilestone] = useState<MilestoneEvent | null>(null);
  const [topCard, setTopCard] = useState<(TopCardContent & { key: number }) | null>(null);
  const topKey = useRef(0);
  // Set together with the state (not from a render), so a card queued right after sees them.
  const topCardShown = useRef(false);
  const milestoneShown = useRef(false);
  /** Until when a stage's pill «Колба N» is on (performance.now()). */
  const pillUntil = useRef(0);

  // ---- Achievement cards: their own queue ----
  const cards = useRef<AchievementState[][]>([]);
  const pumping = useRef(false);
  const cardDone = useRef<(() => void) | null>(null);
  const [card, setCard] = useState<(AchievementCardContent & { key: number }) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pumpCards = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (let queued = cards.current.shift(); queued && mounted.current; queued = cards.current.shift()) {
        // Not over a sheet (the milestone sheet, a confirmation), the level-up card, nor the
        // hero while its pill «Колба N» is on: the card sits right over that flask.
        const busy = () => openSheetCount() > 0 || milestoneShown.current || topCardShown.current || performance.now() < pillUntil.current;
        while (mounted.current && busy()) await wait(POLL_MS);
        if (!mounted.current) break;
        // An undo in the meantime may have taken some of them away again.
        const batch = await filterStillUnlocked(queued);
        const first = batch[0];
        if (!first) continue;
        let skillName: string | null = null;
        if (batch.length === 1 && first.skillId) {
          skillName = (await getSkillWithMilestone(first.skillId).catch(() => null))?.skill.name ?? null;
        }
        const shown = new Promise<void>((resolve) => (cardDone.current = resolve));
        topKey.current += 1;
        setCard({ key: topKey.current, states: batch, skillName });
        haptics.press();
        markCelebrated(
          batch.map((s) => s.def.id),
          nowIso(),
        ).catch((error: unknown) => logError(error, 'markCelebrated'));
        await shown;
        await wait(CARD_GAP_MS);
      }
    } catch (error) {
      logError(error, 'achievement card');
    } finally {
      pumping.current = false;
    }
  }, []);

  /** Queues the cards of one write: one each for up to two, one for them all beyond that. */
  const queueCards = useCallback(
    (states: AchievementState[]) => {
      const earned = states.filter((s) => s.unlockedAt !== null);
      if (!earned.length) return;
      if (earned.length > CARD_MAX_SEPARATE) cards.current.push(earned);
      else cards.current.push(...earned.map((s) => [s]));
      void pumpCards();
    },
    [pumpCards],
  );

  useEffect(() => onAchievementsEarned(queueCards), [queueCards]);

  const register = useCallback((skillId: string, stage: CelebrationStage) => {
    stages.current.set(skillId, stage);
    return () => {
      if (stages.current.get(skillId) === stage) stages.current.delete(skillId);
    };
  }, []);

  const hold = useCallback((skillId: string) => {
    const stage = stages.current.get(skillId);
    stage?.hold();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      stage?.release();
    };
  }, []);

  /**
   * The skill's hero stage when its flask is on screen. After a navigation the screen may still
   * be loading its data, so a write made away from the flask waits for it a moment.
   */
  const heroStage = useCallback(async (skillId: string, patient: boolean): Promise<CelebrationStage | null> => {
    const until = performance.now() + (patient ? HERO_WAIT_MS : 0);
    for (;;) {
      const stage = stages.current.get(skillId);
      if (stage && onScreen(stage.flask()?.element())) return stage;
      if (performance.now() >= until) return null;
      await wait(POLL_MS);
    }
  }, []);

  const playLevelUp = useCallback(async (play: LevelUpPlay, ctx: CelebrateContext, stage: CelebrationStage | undefined, flask: FlaskHandle | null, withTopCard: boolean) => {
    const overflow = () => {
      haptics.levelUp(play.levels);
      if (ctx.after) stage?.show(ctx.after);
      if (stage) pillUntil.current = performance.now() + PILL_MS;
      stage?.announce(play.newFlask - 1, play.newFlask);
    };
    const hero = flask ? null : await heroStage(ctx.skillId, ctx.afterNavigation === true);
    const place = levelUpPlace({ flask: !flask ? 'none' : onScreen(flask.element()) ? 'on-screen' : 'off-screen', heroOnScreen: hero !== null });
    if (place === 'flask') {
      await flask!.playLevelUp({ fromFill: play.fromFill, toFill: play.toFill, levels: play.levels, onOverflow: overflow });
      return;
    }
    haptics.levelUp(play.levels);
    if (place === 'hero') {
      // The hero already shows the new flask (its data was read after the write): the pill
      // names it on the glass instead of a card over it.
      pillUntil.current = performance.now() + PILL_MS;
      hero!.announce(play.newFlask - 1, play.newFlask);
      return;
    }
    // The flask is not on screen (Today, scrolled away): a card at the top.
    if (ctx.after) stage?.show(ctx.after);
    if (withTopCard) {
      topKey.current += 1;
      topCardShown.current = true;
      setTopCard({ key: topKey.current, fromFill: play.fromFill, flask: play.newFlask - 1, skillName: ctx.skillName ?? '' });
    }
  }, [heroStage]);

  const run = useCallback(
    async (events: CelebrationEvent[], ctx: CelebrateContext, navigated: Promise<void> | null) => {
      if (navigated) await navigated;
      const stage = stages.current.get(ctx.skillId);
      const flask = ctx.flaskRef !== undefined ? ctx.flaskRef : (stage?.flask() ?? null);
      if (ctx.source && ctx.points !== undefined && flask) {
        await flyPoints(ctx.source, flask.element(), copy.stepRow.points(ctx.points));
      }
      const achievements: AchievementState[] = [];
      for (const event of events) {
        switch (event.kind) {
          case 'levelUp':
            await playLevelUp(event, ctx, stage, flask, true);
            break;
          case 'milestone':
            // The flask plays underneath first; the sheet is the one moment, so no TopCard.
            if (event.levelUp) await playLevelUp(event.levelUp, ctx, stage, flask, false);
            await sheetsSettled();
            haptics.milestone();
            milestoneShown.current = true;
            setMilestone(event);
            break;
          case 'skillCompleted':
            // The flask turns gold and gets its cork from the live data (Flask state="complete").
            haptics.success();
            showToast(copy.toast.skillCompleted);
            break;
          case 'achievement':
            achievements.push(event.state);
            break;
        }
      }
      // Last, and without holding up the next write's flask.
      queueCards(achievements);
    },
    [playLevelUp, showToast, queueCards],
  );

  const enqueue = useCallback(
    (events: CelebrationEvent[], ctx: CelebrateContext, navigated: Promise<void> | null) => {
      // One choreography at a time: a second completion waits for the first flask to settle.
      const next = queue.current.then(() => run(events, ctx, navigated)).catch((error: unknown) => logError(error, 'celebrate'));
      queue.current = next;
      return next;
    },
    [run],
  );

  const celebrate = useCallback(
    (events: CelebrationEvent[], ctx: CelebrateContext) => enqueue(events, ctx, ctx.afterNavigation ? nextNavigation() : null),
    [enqueue, nextNavigation],
  );

  const celebrateResult = useCallback(
    async (result: MutationResult, ctx: CelebrateContext) => {
      // Subscribe before the first await: the caller navigates right after this call.
      const navigated = ctx.afterNavigation ? nextNavigation() : null;
      let events: CelebrationEvent[] = [];
      let skillName = ctx.skillName;
      try {
        const loaded = await getSkillWithMilestone(ctx.skillId);
        if (loaded) {
          events = orderCelebrations(result, loaded.skill, loaded.milestone);
          skillName ??= loaded.skill.name;
        }
      } catch (error) {
        logError(error, 'celebrate');
      }
      await enqueue(events, { after: result.after, ...ctx, skillName }, navigated);
    },
    [enqueue, nextNavigation],
  );

  const value = useMemo(() => ({ hold, celebrate, celebrateResult, register }), [hold, celebrate, celebrateResult, register]);

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      {topCard && (
        <TopCard
          key={topCard.key}
          content={topCard}
          onDone={() => {
            topCardShown.current = false;
            setTopCard(null);
          }}
        />
      )}
      {card && (
        <AchievementCard
          key={card.key}
          content={card}
          yieldPlace={topCard !== null}
          onOpen={(id) => navigate(`/achievements?focus=${encodeURIComponent(id)}`)}
          onDone={() => {
            setCard(null);
            cardDone.current?.();
            cardDone.current = null;
          }}
        />
      )}
      <MilestoneSheet
        event={milestone}
        onClose={() => {
          milestoneShown.current = false;
          setMilestone(null);
        }}
        onCompleted={(skillId) => void celebrate([{ kind: 'skillCompleted', skillId }], { skillId })}
      />
    </CelebrationContext.Provider>
  );
}

const PILL_MS = 2000;

/**
 * A screen that shows the skill's flask: registers the stage and returns what to render —
 * the progress on display (frozen while a celebration holds it), the flask ref, the level
 * pill and the aria-live announcement.
 */
export function useCelebrationStage(
  skillId: string | undefined,
  live: Progress | undefined,
): { shown: Progress | undefined; flaskRef: RefObject<FlaskHandle | null>; pill: { key: number; flask: number } | null; announcement: string } {
  const { register } = useCelebrations();
  const flaskRef = useRef<FlaskHandle | null>(null);
  const [held, setHeld] = useState<Progress | null>(null);
  const [pill, setPill] = useState<{ key: number; flask: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const holds = useRef(0);
  const shown = held ?? live;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const pillTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!skillId) return;
    const unregister = register(skillId, {
      flask: () => flaskRef.current,
      hold: () => {
        if (holds.current++ === 0) setHeld(shownRef.current ?? null);
      },
      release: () => {
        holds.current = Math.max(0, holds.current - 1);
        if (holds.current === 0) setHeld(null);
      },
      show: (progress) => {
        if (holds.current > 0) setHeld(progress);
      },
      announce: (filled, newFlask) => {
        setPill({ key: Date.now(), flask: newFlask });
        setAnnouncement(copy.skill.flaskFilledLive(filled));
        window.clearTimeout(pillTimer.current);
        pillTimer.current = window.setTimeout(() => setPill(null), PILL_MS);
      },
    });
    return () => {
      unregister();
      holds.current = 0;
      window.clearTimeout(pillTimer.current);
    };
  }, [skillId, register]);

  return { shown, flaskRef, pill, announcement };
}
