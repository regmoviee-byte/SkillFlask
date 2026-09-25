// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Progress } from '../../domain/progression';
import { ToastProvider } from '../components/Toast';
import { CelebrationProvider, useCelebrations, useCelebrationStage } from '../celebrations/CelebrationProvider';
import { PROGRESS_THEME_KEYS, type ProgressHeroHandle, type ProgressHeroProps, type ProgressThemeDefinition, type ProgressThemeKey } from './contract';

// The one rule every theme lives by during a level-up (README.md, «level during a level-up»):
// the app renders the NEW level together with the new fill (toFill) in the same commit, then
// calls playLevelUp({ fromFill, toFill, levels }). When the choreography has resolved, the
// hero must look exactly like a fresh hero at that level and fill. Checked here for every theme
// file that ships, directly and through the app's own path (CelebrationProvider +
// useCelebrationStage), which must commit the new props before the theme plays (flushSync).

vi.mock('../../services/queries', () => ({ getSkillWithMilestone: vi.fn() }));
vi.mock('../../services/skills', () => ({ completeSkill: vi.fn(), continueAfterMilestone: vi.fn() }));
vi.mock('../../services/achievements', () => ({
  markCelebrated: vi.fn(async () => {}),
  onAchievementsEarned: vi.fn(() => () => {}),
  filterStillUnlocked: vi.fn(async (states: unknown[]) => states),
}));
vi.mock('../../platform/haptics', () => ({
  haptics: { levelUp: vi.fn(), milestone: vi.fn(), success: vi.fn(), error: vi.fn(), tap: vi.fn(), press: vi.fn(), select: vi.fn() },
}));

const files = import.meta.glob<Record<string, unknown>>(['./themes/*.tsx', '!./themes/*.test.tsx'], { eager: true });
const themes = Object.entries(files)
  .map(([path, mod]) => ({ key: path.slice('./themes/'.length, -'.tsx'.length), mod }))
  .filter(({ key }) => (PROGRESS_THEME_KEYS as readonly string[]).includes(key))
  .map(({ key, mod }) => Object.values(mod).find((v) => typeof v === 'object' && v !== null && (v as { key?: unknown }).key === key) as ProgressThemeDefinition)
  .sort((a, b) => PROGRESS_THEME_KEYS.indexOf(a.key) - PROGRESS_THEME_KEYS.indexOf(b.key));

/** The markup with every generated id (useId, clip paths, gradients) replaced by its order. */
function normalized(el: Element): string {
  let html = el.innerHTML;
  // Numbered in document order; replaced longest first, so no id eats a part of a longer one.
  const ids = [...new Set(Array.from(el.querySelectorAll('[id]'), (node) => node.id))].map((id, i) => ({ id, i }));
  for (const { id, i } of ids.sort((a, b) => b.id.length - a.id.length)) html = html.split(id).join(`#id${i}#`);
  // The phase of an idle loop is not state: an element that joined during the choreography
  // (a chick walking into the yard) may start its loop at 0 rather than at its seeded phase.
  html = html.replace(/animation-delay: -?[\d.]+m?s;/g, 'animation-delay: *;');
  // One element per line, so a failure shows a readable diff.
  return html.replace(/></g, '>\n<');
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Lets the end of a choreography settle: the rAF follow-ups and short timers themes use. */
async function settle() {
  await frame();
  await frame();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await frame();
}

beforeEach(() => {
  // WAAPI that finishes at once.
  (Element.prototype as { animate?: unknown }).animate = function animate() {
    return { finished: Promise.resolve(), cancel() {}, finish() {}, play() {}, pause() {}, onfinish: null } as unknown as Animation;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (Element.prototype as { animate?: unknown }).animate;
  document.getElementById('sheets')?.remove();
});

const CASES = [
  { from: 4, to: 5, levels: 1 },
  { from: 4, to: 7, levels: 3 },
] as const;

it('covers every theme key that ships a file, the flask included', () => {
  expect(themes.map((t) => t.key)).toContain('flask');
  expect(themes.length).toBeGreaterThan(1);
});

describe.each(themes.map((def) => [def.key, def] as const))('theme %s', (_key, def) => {
  const { Hero } = def;

  for (const { from, to, levels } of CASES) {
    it(`ends a level-up ${from} → ${to} exactly as a fresh hero at level ${to}, fill 0.1`, async () => {
      const ref = createRef<ProgressHeroHandle>();
      const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={from} capacity={100} />);
      const onOverflow = vi.fn();
      const label = () => container.querySelector('[role="img"]')?.getAttribute('aria-label');
      let startLabel: string | null | undefined;
      await act(async () => {
        flushSync(() => rerender(<Hero ref={ref} fill={0.1} level={to} capacity={100} />));
        const played = ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels, onOverflow });
        // The choreography starts from the completed level's fill, not from the new props' toFill.
        startLabel = label();
        await played;
        await settle();
      });
      // The first piece may already be moving (the puzzle's first step is synchronous), so the
      // check is that the hero does not start at the new props.
      const atToFill = render(<Hero fill={0.1} level={to} capacity={100} />);
      expect(startLabel).not.toBe(atToFill.container.querySelector('[role="img"]')?.getAttribute('aria-label'));
      atToFill.unmount();
      expect(onOverflow).toHaveBeenCalled();
      const fresh = render(<Hero fill={0.1} level={to} capacity={100} />);
      expect(normalized(container)).toBe(normalized(fresh.container));
    });
  }
});

// ---- Through the app: CelebrationProvider + useCelebrationStage ----

const progress = (completed: number, points: number): Progress => ({
  totalPoints: completed * 100 + points,
  completedFlasks: completed,
  currentFlask: completed + 1,
  pointsInCurrentFlask: points,
  currentCapacity: 100,
  fill: points / 100,
});

interface Rendered {
  level: number | undefined;
  fill: number;
}

let api: ReturnType<typeof useCelebrations>;

/** The skill screen's hero wiring (SkillScreen Hero), recording the props each play starts with. */
function Stage({ def, live, lastRender, atPlay }: { def: ProgressThemeDefinition; live: Progress; lastRender: { current: Rendered | null }; atPlay: Rendered[] }) {
  api = useCelebrations();
  const stage = useCelebrationStage('s1', live);
  const p = stage.shown ?? live;
  const props: ProgressHeroProps = { fill: stage.hero?.fill ?? p.fill, level: stage.hero?.level ?? p.currentFlask, capacity: p.currentCapacity };
  lastRender.current = { level: props.level, fill: props.fill };
  const { Hero } = def;
  const heroRef = (handle: ProgressHeroHandle | null) => {
    stage.flaskRef.current = handle && {
      element: () => handle.element(),
      playLevelUp: (options) => {
        atPlay.push({ ...lastRender.current! });
        return handle.playLevelUp(options);
      },
    };
  };
  useEffect(() => () => void (stage.flaskRef.current = null), [stage.flaskRef]);
  return (
    <div data-testid="hero">
      <Hero ref={heroRef} {...props} />
    </div>
  );
}

function tree(def: ProgressThemeDefinition, live: Progress, lastRender: { current: Rendered | null }, atPlay: Rendered[]) {
  return (
    <MemoryRouter>
      <ToastProvider>
        <CelebrationProvider>
          <Stage def={def} live={live} lastRender={lastRender} atPlay={atPlay} />
        </CelebrationProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe.each(themes.map((def) => [def.key, def] as const))('theme %s on the skill screen', (key: ProgressThemeKey, def) => {
  for (const { from, to, levels } of CASES) {
    it(`gets level ${to} and fill 0.1 committed before its level-up plays, and settles there`, async () => {
      // The celebrations only play on a hero that is on screen.
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 100, top: 100, left: 0, right: 140, bottom: 360, width: 140, height: 260, toJSON: () => ({}) });
      const before = progress(from - 1, 90);
      const after = progress(to - 1, 10);
      const lastRender = { current: null as Rendered | null };
      const atPlay: Rendered[] = [];
      const { getByTestId, rerender } = render(tree(def, before, lastRender, atPlay));
      // A write: the stage is held, the live data moves on, the service result is celebrated.
      const release = api.hold('s1');
      rerender(tree(def, after, lastRender, atPlay));
      await act(() => api.celebrate([{ kind: 'levelUp', skillId: 's1', levels, fromFill: 0.9, toFill: 0.1, newFlask: to, remainder: 10 }], { skillId: 's1', after }));
      await act(async () => {
        release();
        await settle();
      });
      expect(atPlay, key).toEqual([{ level: to, fill: 0.1 }]);
      const fresh = render(<def.Hero fill={0.1} level={to} capacity={100} />);
      expect(normalized(getByTestId('hero'))).toBe(normalized(fresh.container));
    });
  }
});
