import { describe, expect, it } from 'vitest';
import { PROGRESS_THEME_KEYS, type ProgressThemeDefinition, type ProgressThemeKey } from './contract';
import { availableThemes, colorScope, copyForSkill, isShipped, loadTheme, registerTheme, skillTheme, themeText } from './registry';
import { THEME_TEXT } from './texts';
import { flaskTheme } from './themes/flask';

// Every theme file that ships, read eagerly here (the app loads them lazily).
const files = import.meta.glob<Record<string, unknown>>(['./themes/*.tsx', '!./themes/*.test.tsx'], { eager: true });
// A theme's helper file (themes/puzzle-pictures.tsx) is not a theme: only `<key>.tsx` of a known key is.
const shipped = Object.entries(files)
  .map(([path, mod]) => ({ key: path.slice('./themes/'.length, -'.tsx'.length) as ProgressThemeKey, mod }))
  .filter(({ key }) => (PROGRESS_THEME_KEYS as readonly string[]).includes(key))
  .map(({ key, mod }) => ({
    key,
    def: Object.values(mod).find((v) => typeof v === 'object' && v !== null && (v as { key?: unknown }).key === key) as ProgressThemeDefinition | undefined,
  }));

const VIEW_W = 160;
const VIEW_H = 260;
const heights = Array.from({ length: 21 }, (_, i) => i / 20);

describe('theme registry', () => {
  it('knows thirteen keys, ships the flask first and offers exactly the shipped themes', () => {
    expect(PROGRESS_THEME_KEYS).toHaveLength(13);
    expect(availableThemes()[0]).toBe('flask');
    expect(availableThemes()).toEqual(PROGRESS_THEME_KEYS.filter((key) => key === 'flask' || shipped.some((s) => s.key === key)));
    for (const key of availableThemes()) expect(themeText(key)).toBe(THEME_TEXT[key]);
  });

  it('offers all thirteen themes: every theme branch is integrated (packages 11 and 13)', () => {
    expect(shipped.map((s) => s.key).sort()).toEqual([...PROGRESS_THEME_KEYS].sort());
    expect(availableThemes()).toEqual([...PROGRESS_THEME_KEYS]);
  });

  it('draws and names a stored key it cannot draw as the flask, never failing', () => {
    expect(skillTheme('flask')).toBe('flask');
    expect(skillTheme('comet')).toBe('flask');
    expect(skillTheme(undefined)).toBe('flask');
    for (const key of PROGRESS_THEME_KEYS) expect(skillTheme(key)).toBe(isShipped(key) ? key : 'flask');
    expect(copyForSkill({ theme: 'comet' }).completed(2)).toBe('Колба 2 заполнена');
  });

  it('paints a scope only for a known colour', () => {
    expect(colorScope('coral')).toEqual({ 'data-liquid-color': 'coral' });
    expect(colorScope(null)).toEqual({});
    expect(colorScope('ultramarine')).toEqual({});
  });

  it('registers a stand-in theme through the same engine, and forgets it again', async () => {
    const standIn: ProgressThemeDefinition = { ...flaskTheme, key: 'rainbow', text: THEME_TEXT.rainbow };
    const already = isShipped('rainbow');
    const off = registerTheme(standIn);
    expect(isShipped('rainbow')).toBe(true);
    expect(skillTheme('rainbow')).toBe('rainbow');
    expect(copyForSkill({ theme: 'rainbow' }).completed(3)).toBe('Радуга 3 сияет');
    expect(await loadTheme('rainbow')).toBe(standIn);
    off();
    expect(isShipped('rainbow')).toBe(already);
  });
});

describe('every shipped theme file', () => {
  it('exports one definition of its own key, available, with the texts of texts.ts', () => {
    for (const { key, def } of shipped) {
      expect(def, key).toBeDefined();
      expect(def!.available, key).toBe(true);
      const own = def!.text;
      const table = THEME_TEXT[key];
      for (const field of ['name', 'levelNoun', 'levelGenitive', 'hint'] as const) expect(own[field], `${key}.${field}`).toBe(table[field]);
      expect(own.levelForms, key).toEqual(table.levelForms);
      expect(own.levelFormsOf, key).toEqual(table.levelFormsOf);
      for (const n of [1, 2, 11]) expect(own.completed(n), key).toBe(table.completed(n));
      for (const p of [0, 45, 100]) expect(own.fillLabel(p), key).toBe(table.fillLabel(p));
    }
  });

  it('places marks inside the hero box, clamping heights outside 0..1', () => {
    for (const { key, def } of shipped) {
      for (const h of [...heights, -0.5, 1.5]) {
        const { x, y } = def!.markPoint(h);
        expect(Number.isFinite(x) && Number.isFinite(y), `${key} ${h}`).toBe(true);
        expect(x, `${key} x at ${h}`).toBeGreaterThanOrEqual(0);
        expect(x, `${key} x at ${h}`).toBeLessThanOrEqual(VIEW_W);
        expect(y, `${key} y at ${h}`).toBeGreaterThanOrEqual(0);
        expect(y, `${key} y at ${h}`).toBeLessThanOrEqual(VIEW_H);
      }
      expect(def!.markPoint(-0.5), key).toEqual(def!.markPoint(0));
      expect(def!.markPoint(1.5), key).toEqual(def!.markPoint(1));
    }
  });
});

describe('the flask theme', () => {
  it('puts a mark higher on the glass the more points it stands for, on the inner right wall', () => {
    const points = heights.map((h) => flaskTheme.markPoint(h));
    for (let i = 1; i < points.length; i++) expect(points[i]!.y).toBeLessThanOrEqual(points[i - 1]!.y);
    // Kept clear of the rounded bottom and of the rim.
    expect(points[0]!.y).toBe(212);
    expect(points[points.length - 1]!.y).toBe(46);
    for (const p of points) expect(p.x).toBeGreaterThan(80);
  });
});
