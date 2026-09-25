import { describe, expect, it } from 'vitest';
import { SKILL_COLORS } from '../../domain/appearance';

// Vitest serves CSS imports (even `?raw`) empty, and the project has no Node types: read the
// file through Node's builtin loader (Node 22+, as the theme tests do).
type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
const fs = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process?.getBuiltinModule?.('node:fs') as Fs | undefined;
if (!fs) throw new Error('palette.test.ts needs Node 22+ (process.getBuiltinModule)');
const css = fs.readFileSync(new URL('./palette.css', import.meta.url), 'utf8');

// Every skill colour must define its whole palette for a light and for a dark surface: a
// missing or misspelt variable would silently fall back to the Telegram accent in one mode.

const VARIABLES = ['--liquid-light', '--liquid-mid', '--liquid-deep', '--liquid-glow', '--liquid-soft'] as const;
const COLOR = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/i;

/** The declarations of the rule whose selector is exactly `selector`, or null when there is none. */
function block(selector: string): Map<string, string> | null {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = rules.find(([, sel]) => sel!.replace(/\/\*[\s\S]*?\*\//g, '').trim() === selector);
  if (!rule) return null;
  const declarations = new Map<string, string>();
  for (const [, name, value] of rule[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) declarations.set(name!, value!.trim());
  return declarations;
}

describe('palette.css', () => {
  for (const [mode, prefix] of [
    ['light', ''],
    ['dark', ":root[data-theme='dark'] "],
  ] as const) {
    it(`defines light/mid/deep (and the glow and soft track) of every colour on a ${mode} surface`, () => {
      for (const key of SKILL_COLORS) {
        const rule = block(`${prefix}[data-liquid-color='${key}']`);
        expect(rule, `${mode} ${key}`).not.toBeNull();
        for (const name of VARIABLES) expect(rule!.get(name), `${mode} ${key} ${name}`).toMatch(COLOR);
      }
    });
  }

  it('paints no colour the picker does not offer', () => {
    const keys = [...css.matchAll(/data-liquid-color='([\w-]+)'/g)].map(([, key]) => key);
    expect(keys.length).toBeGreaterThanOrEqual(SKILL_COLORS.length * 2);
    for (const key of keys) expect(SKILL_COLORS as readonly string[], key).toContain(key);
  });
});
