import type { ComponentType, Ref } from 'react';
import type { MotionMode } from '../hooks/useMotion';

// The contract every progress theme («образ прогресса») implements. A theme is presentation
// only: it draws one level of a skill filling up (the flask, a flower growing, a pizza being
// eaten…) and plays the level-up beat. Points, levels, milestones and history never depend on
// it. Themes live in src/ui/progress/themes/<key>.tsx and register in the theme registry
// (src/ui/progress/registry.ts, package 11). See README.md next to this file for the rules.

export const PROGRESS_THEME_KEYS = [
  'flask',
  'flower',
  'pizza',
  'car',
  'book',
  'rocket',
  'ball',
  'chick',
  'climber',
  'puzzle',
  'moon',
  'tower',
  'rainbow',
] as const;

export type ProgressThemeKey = (typeof PROGRESS_THEME_KEYS)[number];

export const DEFAULT_PROGRESS_THEME: ProgressThemeKey = 'flask';

export type ProgressState = 'empty' | 'active' | 'complete';

/** A mark («засечка») as the hero draws it; `height` is 0..1 along the level's path. */
export interface ProgressMark {
  id: string;
  /** The mark's title; the caption shortens it to about 12 characters. */
  label: string;
  height: number;
}

export interface LevelUpOptions {
  /** Fill before the write, 0..1 of the level that was completed. */
  fromFill: number;
  /** Fill after the write, 0..1 of the new current level. */
  toFill: number;
  /** Levels completed by the write (≥ 1); above 3 the choreography compresses. */
  levels: number;
  /**
   * Called at the beat of completion (the flask overflows, the rocket lands…) — haptics fire here.
   * A theme may call it once per played level; the app acts on the first call.
   */
  onOverflow?(): void;
}

export interface ProgressHeroHandle {
  /** Plays the level-up choreography; resolves when the new level is shown at `toFill`. */
  playLevelUp(options: LevelUpOptions): Promise<void>;
  /** The main drawn object, the target for flying points. */
  element(): Element | null;
}

/** The hero on the skill screen: 140 px wide, viewBox 0 0 160 260, next to the numbers column. */
export interface ProgressHeroProps {
  /** Fill ratio of the current level, 0..1. */
  fill: number;
  /** Capacity of the current level in points, for absolute labels (ticks, «стр. 45 из 100»). */
  capacity?: number;
  state?: ProgressState;
  /**
   * Number of the current level (1-based): the level being filled now. Themes may use it to show
   * past levels (a skyline of finished towers, a shelf of read books). Omitted → 1.
   * When playLevelUp runs it already names the NEW level, rendered together with `toFill`
   * (README.md, «level during a level-up»).
   */
  level?: number;
  /** 'reduced': no choreography, only short crossfades; no idle motion. */
  motion?: MotionMode;
  /** Accessible name; the theme's `text.fillLabel(percent)` by default. */
  label?: string;
  /** Marks of the current level, oldest first; the newest four get a caption. */
  marks?: ProgressMark[];
  onMarkTap?(id: string): void;
  ref?: Ref<ProgressHeroHandle>;
}

/** The small version for the milestone rack, skill cards and lists (28–40 px). */
export interface ProgressMiniProps {
  fill: number;
  state?: ProgressState;
  /**
   * Number of the current level (1-based): the level being filled now. Themes may use it to show
   * past levels (a skyline of finished towers, a shelf of read books). Omitted → 1.
   */
  level?: number;
  motion?: MotionMode;
  /** Rendered size in px; default 32. */
  size?: number;
  label?: string;
}

/** Russian forms; every string must pass src/ui/copy.test.ts (no forbidden words). */
export interface ProgressThemeText {
  /** Name in the picker: «Колба», «Цветок», «Пицца». */
  name: string;
  /** Used as «<levelNoun> N»: «Колба 3», «Цветок 3», «Поездка 3». */
  levelNoun: string;
  /** Genitive singular for «ещё 5 до <levelGenitive> 3»: «колбы», «цветка», «поездки». */
  levelGenitive: string;
  /** Plural forms for counts, for lib/format plural(): ['колба', 'колбы', 'колб']. */
  levelForms: [string, string, string];
  /** Forms after «из»: «из 1 колбы», «из 3 колб» — ['колбы', 'колб', 'колб']. */
  levelFormsOf: [string, string, string];
  /** History badge and toast when level `n` is completed: «Колба 3 заполнена», «Пицца 3 съедена». */
  completed(n: number): string;
  /** Accessible name of the hero: «Колба заполнена на 45%», «Цветок вырос на 45%». */
  fillLabel(percent: number): string;
  /** One line for the picker card: what happens as points arrive. */
  hint: string;
}

export interface ProgressThemeDefinition {
  key: ProgressThemeKey;
  text: ProgressThemeText;
  /** Hidden from the picker until its theme file ships; a stored key still renders. */
  available: boolean;
  Hero: ComponentType<ProgressHeroProps>;
  Mini: ComponentType<ProgressMiniProps>;
  /**
   * Where a mark at `height` (0..1) sits on the hero, in viewBox units (0 0 160 260).
   * Monotonic along the level's path; tests check it stays inside the box.
   */
  markPoint(height: number): { x: number; y: number };
}
