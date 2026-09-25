// A skill's appearance («Оформление»): the progress theme («образ прогресса») and the colour.
// Presentation only — points, levels, milestones, achievements and history never read it.
// Stored values are normalised at read time: a key this build does not know (a backup written
// by a newer release) falls back to the default instead of failing.

import { DEFAULT_PROGRESS_THEME, PROGRESS_THEME_KEYS, type ProgressThemeKey } from '../ui/progress/contract';

export { DEFAULT_PROGRESS_THEME, PROGRESS_THEME_KEYS, type ProgressThemeKey };

/** The skill colours; null («Как в теме») follows the Telegram accent. */
export const SKILL_COLORS = ['sky', 'teal', 'green', 'amber', 'coral', 'rose', 'violet', 'graphite'] as const;

export type SkillColor = (typeof SKILL_COLORS)[number];

export function isProgressTheme(value: unknown): value is ProgressThemeKey {
  return typeof value === 'string' && (PROGRESS_THEME_KEYS as readonly string[]).includes(value);
}

export function isSkillColor(value: unknown): value is SkillColor {
  return typeof value === 'string' && (SKILL_COLORS as readonly string[]).includes(value);
}

/** The stored theme as this build knows it: anything unknown or missing is the flask. */
export function normalizeTheme(value: unknown): ProgressThemeKey {
  return isProgressTheme(value) ? value : DEFAULT_PROGRESS_THEME;
}

/** The stored colour as this build knows it: anything unknown or missing follows the theme. */
export function normalizeColor(value: unknown): SkillColor | null {
  return isSkillColor(value) ? value : null;
}
