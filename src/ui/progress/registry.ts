import { useEffect, useSyncExternalStore } from 'react';
import { normalizeColor, normalizeTheme, PROGRESS_THEME_KEYS, type ProgressThemeKey, type SkillColor } from '../../domain/appearance';
import { logError } from '../../platform/errorLog';
import { levelCopy, type LevelCopy } from '../copy';
import type { ProgressThemeDefinition } from './contract';
import { THEME_TEXT, type LevelText } from './texts';
import { flaskTheme } from './themes/flask';

// The theme registry: which progress themes this build ships, their texts, and their drawings.
//
// - The flask is bundled with the app (the default, most skills use it). Every other theme is
//   a file of its own, `themes/<key>.tsx`, found by the glob below and built as a separate
//   chunk that loads the first time a skill with that theme (or the picker) is on screen. A
//   theme becomes selectable by its file shipping — nothing else to register; its nouns are in
//   texts.ts for all thirteen keys already.
// - A stored key this build cannot draw — unknown (a newer release's backup) or known but not
//   shipped yet — is drawn and named as the flask (skillTheme). Nothing ever crashes on it.
// - Colours are CSS only (progress/palette.css): `data-liquid-color` on a skill's scope sets
//   the --liquid-* variables every theme paints with (colorScope).

type ThemeModule = Record<string, unknown>;

const LAZY = import.meta.glob<ThemeModule>(['./themes/*.tsx', '!./themes/flask.tsx', '!./themes/*.test.tsx']);

const loaders = new Map<ProgressThemeKey, () => Promise<ThemeModule>>();
for (const [path, load] of Object.entries(LAZY)) {
  const key = path.slice('./themes/'.length, -'.tsx'.length);
  if ((PROGRESS_THEME_KEYS as readonly string[]).includes(key)) loaders.set(key as ProgressThemeKey, load);
}

/** Registered at run time (registerTheme): tests, a theme bundled some other way. */
const registered = new Set<ProgressThemeKey>();

/** True when this build has the theme's drawing. */
export function isShipped(key: ProgressThemeKey): boolean {
  return key === 'flask' || loaders.has(key) || registered.has(key);
}

/** The themes the picker offers, in catalogue order (the flask first). */
export function availableThemes(): ProgressThemeKey[] {
  return PROGRESS_THEME_KEYS.filter(isShipped);
}

/** The theme a skill is drawn and named with: its stored key when this build ships it, the flask otherwise. */
export function skillTheme(stored: unknown): ProgressThemeKey {
  const key = normalizeTheme(stored);
  return isShipped(key) ? key : 'flask';
}

export function themeText(key: ProgressThemeKey): LevelText {
  return THEME_TEXT[key];
}

const copies = new Map<ProgressThemeKey, LevelCopy>();

/** The level strings of a theme (copy.ts levelCopy), one object per theme. */
export function levelCopyOf(key: ProgressThemeKey): LevelCopy {
  let found = copies.get(key);
  if (!found) {
    found = levelCopy(THEME_TEXT[key]);
    copies.set(key, found);
  }
  return found;
}

/** The level strings of a skill, in its theme's nouns («Пицца 2 съедена»). */
export function copyForSkill(skill: { theme?: unknown }): LevelCopy {
  return levelCopyOf(skillTheme(skill.theme));
}

/** The attribute that paints a skill's scope in its colour; nothing for «Как в теме». */
export function colorScope(stored: unknown): { 'data-liquid-color'?: SkillColor } {
  const color = normalizeColor(stored);
  return color ? { 'data-liquid-color': color } : {};
}

// ---- Loading the drawings ----

const loaded = new Map<ProgressThemeKey, ProgressThemeDefinition>([['flask', flaskTheme]]);
const pending = new Map<ProgressThemeKey, Promise<ProgressThemeDefinition>>();
const listeners = new Set<() => void>();
let version = 0;

function isDefinition(value: unknown, key: ProgressThemeKey): value is ProgressThemeDefinition {
  return typeof value === 'object' && value !== null && (value as { key?: unknown }).key === key && 'Hero' in value && 'Mini' in value;
}

/**
 * Loads a theme's chunk (once). A chunk that fails to load (offline after an update) leaves
 * the flask in its place for this session instead of an empty space; the error is logged.
 */
export function loadTheme(key: ProgressThemeKey): Promise<ProgressThemeDefinition> {
  const ready = loaded.get(key);
  if (ready) return Promise.resolve(ready);
  let promise = pending.get(key);
  if (!promise) {
    const load = loaders.get(key);
    promise = (load ? load() : Promise.reject(new Error(`No theme file for ${key}`)))
      .then((mod) => {
        const def = Object.values(mod).find((value) => isDefinition(value, key));
        if (!def) throw new Error(`themes/${key}.tsx exports no definition for «${key}»`);
        return def;
      })
      .catch((error: unknown) => {
        logError(error, `theme ${key}`);
        return flaskTheme;
      })
      .then((def) => {
        loaded.set(key, def);
        pending.delete(key);
        version += 1;
        listeners.forEach((cb) => cb());
        return def;
      });
    pending.set(key, promise);
  }
  return promise;
}

/**
 * Makes a definition available without a theme file (the DOM tests draw a stand-in theme
 * through the real engine). A shipped theme's file still wins when it is loaded later.
 */
export function registerTheme(def: ProgressThemeDefinition): () => void {
  registered.add(def.key);
  loaded.set(def.key, def);
  version += 1;
  listeners.forEach((cb) => cb());
  return () => {
    registered.delete(def.key);
    if (loaded.get(def.key) === def) loaded.delete(def.key);
    version += 1;
    listeners.forEach((cb) => cb());
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The theme's definition once its chunk is in (at once for the flask); null while it loads. */
export function useThemeDefinition(key: ProgressThemeKey): ProgressThemeDefinition | null {
  useSyncExternalStore(subscribe, () => version, () => version);
  const def = loaded.get(key) ?? null;
  useEffect(() => {
    if (!def) void loadTheme(key);
  }, [key, def]);
  return def;
}
