import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'react-router';
import type { Progress } from '../../domain/progression';
import type { MutationResult } from '../../services/completions';
import { getSkillWithMilestone } from '../../services/queries';
import { haptics } from '../../platform/haptics';
import { logError } from '../../platform/errorLog';
import type { FlaskHandle } from '../components/Flask';
import { openSheetCount } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { flyPoints, onScreen } from '../hooks/usePointsFly';
import { MilestoneSheet } from './MilestoneSheet';
import { orderCelebrations, type CelebrationEvent, type LevelUpPlay } from './orderCelebrations';
import { TopCard, type TopCardContent } from './TopCard';

// One place for reward moments. Screens that show a skill's flask register a stage; mutations
// hold that stage before they write (so the live query cannot move the flask first) and hand
// the service result over. Then, in order: the points fly into the glass, the flask plays its
// level-up (or a TopCard says so where the flask is not on screen), the milestone sheet opens.
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
   * the write happened away from the flask («Задним числом»): a level-up shows the TopCard.
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

  const playLevelUp = useCallback(async (play: LevelUpPlay, ctx: CelebrateContext, stage: CelebrationStage | undefined, flask: FlaskHandle | null, withTopCard: boolean) => {
    const overflow = () => {
      haptics.levelUp(play.levels);
      if (ctx.after) stage?.show(ctx.after);
      stage?.announce(play.newFlask - 1, play.newFlask);
    };
    if (flask && onScreen(flask.element())) {
      await flask.playLevelUp({ fromFill: play.fromFill, toFill: play.toFill, levels: play.levels, onOverflow: overflow });
      return;
    }
    // The flask is not on screen (Today, «Задним числом», scrolled away): a card at the top.
    haptics.levelUp(play.levels);
    if (ctx.after) stage?.show(ctx.after);
    if (withTopCard) {
      topKey.current += 1;
      setTopCard({ key: topKey.current, fromFill: play.fromFill, flask: play.newFlask - 1, skillName: ctx.skillName ?? '' });
    }
  }, []);

  const run = useCallback(
    async (events: CelebrationEvent[], ctx: CelebrateContext, navigated: Promise<void> | null) => {
      if (navigated) await navigated;
      const stage = stages.current.get(ctx.skillId);
      const flask = ctx.flaskRef !== undefined ? ctx.flaskRef : (stage?.flask() ?? null);
      if (ctx.source && ctx.points !== undefined && flask) {
        await flyPoints(ctx.source, flask.element(), copy.stepRow.points(ctx.points));
      }
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
            setMilestone(event);
            break;
          case 'skillCompleted':
            // The flask turns gold and gets its cork from the live data (Flask state="complete").
            haptics.success();
            showToast(copy.toast.skillCompleted);
            break;
          case 'achievement':
            // Package 7: the achievement toast/sheet.
            break;
        }
      }
    },
    [playLevelUp, showToast],
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
      {topCard && <TopCard key={topCard.key} content={topCard} onDone={() => setTopCard(null)} />}
      <MilestoneSheet
        event={milestone}
        onClose={() => setMilestone(null)}
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
