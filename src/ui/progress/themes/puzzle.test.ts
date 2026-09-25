import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import {
  captionYs,
  cycleLevel,
  edgePath,
  markPoint,
  ORDER,
  PIECES,
  pieceKeyframes,
  piecePath,
  pieceTransform,
  pieceVisual,
  puzzlePhaseTiming,
  puzzlePlaced,
  puzzleScript,
  puzzleStage,
  puzzleTheme,
} from './puzzle';
import { GRADIENT_NAMES, levelNumber, PIC_H, PIC_W, PICTURE_COUNT, pictureIndex, PICTURES } from './puzzle-pictures';

const FILLS = [0, 0.25, 0.5, 0.75, 0.999, 1];
const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

describe('puzzle stages', () => {
  it('places whole twelfths and keeps the last piece for the beat', () => {
    expect(FILLS.map(puzzlePlaced)).toEqual([0, 3, 6, 9, 11, 12]);
    expect(puzzlePlaced(-1)).toBe(0);
    expect(puzzlePlaced(Number.NaN)).toBe(0);
    expect(puzzlePlaced(2)).toBe(12);
    // Exact twelfths must not fall to the piece below through float error.
    for (let n = 0; n < PIECES; n++) expect(puzzlePlaced(n / PIECES)).toBe(n);
  });

  it('names the hovering piece and how far its share went', () => {
    expect(FILLS.map((f) => puzzleStage(f).next)).toEqual([0, 3, 6, 9, 11, null]);
    expect(puzzleStage(0).share).toBe(0);
    expect(puzzleStage(0.5 + 1 / 24).share).toBe(0.5);
    expect(puzzleStage(0.999).share).toBeCloseTo(0.99, 2);
    expect(puzzleStage(1)).toEqual({ placed: 12, next: null, share: 0 });
  });

  it('shows each piece placed, hovering or hidden', () => {
    expect(ORDER.map((_, k) => pieceVisual(k, 0.25))).toEqual([
      'placed', 'placed', 'placed', 'floating', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden',
    ]);
    expect(ORDER.map((_, k) => pieceVisual(k, 1)).every((v) => v === 'placed')).toBe(true);
    expect(ORDER.map((_, k) => pieceVisual(k, 1, true)).every((v) => v === 'hidden')).toBe(true);
    expect(pieceVisual(11, 0.999)).toBe('floating');
  });

  it('orders the pieces bottom-up, one cell each, ending with the top-right piece', () => {
    expect(new Set(ORDER.map(([c, r]) => `${c},${r}`)).size).toBe(PIECES);
    const rows = ORDER.map(([, r]) => r);
    expect(rows).toEqual([...rows].sort((a, b) => b - a));
    expect(ORDER[PIECES - 1]).toEqual([2, 0]);
  });
});

describe('puzzle geometry', () => {
  it('draws straight edges and knobs', () => {
    expect(edgePath(0, 0, 36, 0, 0)).toBe('L36 0');
    expect(edgePath(0, 0, 36, 0, 1)).toContain('0 1 1');
    expect(edgePath(0, 0, 36, 0, -1)).toContain('0 1 0');
  });

  it('closes every piece and gives neighbours matching tabs and blanks', () => {
    for (const [c, r] of ORDER) expect(piecePath(c, r)).toMatch(/^M.*Z$/);
    // A tab of one piece (sweep 1) is a blank of its neighbour (sweep 0): the knobs interlock.
    const arcs = (d: string) => (d.match(/A[^L]*/g) ?? []).length;
    expect(arcs(piecePath(1, 1))).toBe(4);
    expect(arcs(piecePath(0, 0))).toBe(2);
  });

  it('moves a hovering piece beside the frame and turns it towards its slot', () => {
    expect(pieceTransform(0, 'placed')).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
    const early = pieceTransform(3, 'floating', 0);
    const late = pieceTransform(3, 'floating', 1);
    expect(early).toMatch(/rotate\(16deg\)/);
    expect(late).toMatch(/rotate\(5deg\)/);
  });

  it('builds keyframes with matching transform lists', () => {
    const cases: [Parameters<typeof pieceKeyframes>[1], Parameters<typeof pieceKeyframes>[2]][] = [
      ['hidden', 'placed'],
      ['floating', 'placed'],
      ['hidden', 'floating'],
      ['floating', 'floating'],
      ['placed', 'hidden'],
      ['floating', 'hidden'],
    ];
    for (const [from, to] of cases) {
      const frames = pieceKeyframes(4, from, to, 0.2, 0.6);
      expect(frames.length).toBeGreaterThanOrEqual(2);
      for (const f of frames) expect(String(f.transform)).toMatch(/^translate\(.*\) rotate\(.*\) scale\(.*\)$/);
      expect(frames.at(-1)!.opacity).toBe(to === 'hidden' ? 0 : 1);
    }
    expect(pieceKeyframes(11, 'floating', 'placed', 0.9, 0, true)).toHaveLength(3);
    // A whole picture at once settles into its slots instead of flying in from the side.
    const settle = pieceKeyframes(4, 'hidden', 'placed', 0, 0, false, true);
    expect(settle.map((f) => f.transform)).toEqual([pieceTransform(4, 'placed', 0, 1.1), pieceTransform(4, 'placed')]);
  });
});

describe('puzzle choreography', () => {
  const total = (levels: number) => puzzleScript(levels).reduce((sum, p) => sum + p.timing.delay + p.timing.duration, 0);

  it('plays rise → beat → reset → refill in 1.0 s for one level, headroom under the 1.2 s budget', () => {
    expect(puzzleScript(1).map((p) => p.state.phase)).toEqual(['rising', 'overflow', 'draining', 'refilling']);
    // Each phase also waits a frame or so for its animations to finish: ≈ 1.1 s on screen.
    expect(total(1)).toBeLessThanOrEqual(1000);
  });

  it('compresses several levels into at most three cycles', () => {
    expect(puzzleScript(3).map((p) => p.state.phase)).toEqual(['rising', 'overflow', 'draining', 'refilling', 'draining', 'refilling', 'draining', 'refilling']);
    expect(puzzleScript(10)).toHaveLength(puzzleScript(3).length);
    expect(total(3)).toBeLessThanOrEqual(3 * 1200);
    expect(total(10)).toBe(total(3));
    expect(puzzlePhaseTiming(puzzleScript(3)[4]!.state).duration).toBeLessThan(puzzlePhaseTiming(puzzleScript(3)[2]!.state).duration);
  });

  it('plays nothing for zero levels', () => {
    expect(puzzleScript(0)).toEqual([]);
  });

  it('brings up the next picture at each reset and lands on the final one', () => {
    const resets = (from: number, levels: number) =>
      puzzleScript(levels)
        .filter(({ state }) => state.phase === 'draining')
        .map(({ state }) => cycleLevel(state, from, from + levels));
    expect(resets(1, 1)).toEqual([2]);
    expect(resets(4, 3)).toEqual([5, 6, 7]);
    // Longer writes show two next pictures, then jump to the final level's.
    expect(resets(1, 7)).toEqual([2, 3, 8]);
    expect(resets(19, 2)).toEqual([20, 21]);
  });
});

describe('puzzle pictures', () => {
  // Vitest serves CSS as empty text, so the stylesheet is read from disk (Node 22 in CI).
  type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
  const { readFileSync } = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): Fs } }).process.getBuiltinModule('node:fs');
  const css = readFileSync(new URL('./puzzle.css', import.meta.url), 'utf8');

  it('reads the stylesheet', () => {
    expect(css).toContain('.puzzle {');
  });

  it('has twenty named pictures, each at most 40 shapes', () => {
    expect(PICTURE_COUNT).toBe(20);
    expect(new Set(PICTURES.map((p) => p.name)).size).toBe(20);
    for (const picture of PICTURES) {
      expect(picture.shapes.length).toBeGreaterThan(4);
      expect(picture.shapes.length).toBeLessThanOrEqual(40);
    }
  });

  it('chooses the picture by level, cycling 1..20..1', () => {
    const levels = Array.from({ length: 41 }, (_, i) => i + 1);
    expect(levels.map(pictureIndex)).toEqual([...Array.from({ length: 20 }, (_, i) => i), ...Array.from({ length: 20 }, (_, i) => i), 0]);
    expect(pictureIndex()).toBe(0);
    expect(pictureIndex(0)).toBe(0);
    expect(pictureIndex(-3)).toBe(0);
    expect(pictureIndex(Number.NaN)).toBe(0);
    expect(pictureIndex(2.7)).toBe(1);
    expect(levelNumber(undefined)).toBe(1);
    expect(levelNumber(7.9)).toBe(7);
  });

  it('draws with valid paths inside the picture box', () => {
    for (const { name, shapes } of PICTURES)
      for (const [, d] of shapes) {
        expect(d, name).toMatch(/^M/);
        expect(d, name).not.toMatch(/NaN|undefined|Infinity/);
        // Coordinates may overhang the box a little (a hill running off the edge), never far.
        const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        for (const n of numbers) expect(Math.abs(n), name).toBeLessThanOrEqual(Math.max(PIC_W, PIC_H) + 12);
      }
  });

  it('uses only colours the stylesheet defines, with a literal fallback and a token mix', () => {
    const colours = new Set(PICTURES.flatMap((p) => p.shapes.map(([c]) => c)));
    for (const c of colours) {
      if (c.startsWith('@')) {
        expect(GRADIENT_NAMES).toContain(c.slice(1));
        continue;
      }
      const declarations = css.match(new RegExp(`--pz-${c}:[^;]+;`, 'g')) ?? [];
      expect(declarations.length, c).toBeGreaterThanOrEqual(1);
      if (c.startsWith('skill')) expect(declarations.join(''), c).toContain('var(--liquid-');
      else {
        expect(declarations.some((d) => /#[0-9a-f]{6};/.test(d)), c).toBe(true);
        expect(declarations.some((d) => d.includes('color-mix(')), c).toBe(true);
      }
    }
  });

  it('puts the skill colour on every picture', () => {
    for (const { name, shapes } of PICTURES) expect(shapes.some(([c]) => /^skill|^@(sky|water|night|aurora)$/.test(c)), name).toBe(true);
  });

  it('keeps bare black and white out of the stylesheet', () => {
    expect(css).not.toMatch(/#000\b|#000000|#fff\b|#ffffff/i);
  });
});

describe('puzzle marks', () => {
  it('is monotonic along the left side of the frame and stays in the box', () => {
    const heights = Array.from({ length: 41 }, (_, i) => i / 40);
    const points = heights.map(markPoint);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(160);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(260);
    }
    for (let i = 1; i < points.length; i++) expect(points[i]!.y).toBeLessThan(points[i - 1]!.y);
    expect(markPoint(-1)).toEqual(markPoint(0));
    expect(markPoint(2)).toEqual(markPoint(1));
  });

  it('matches the assembled rows: half the points, half the picture', () => {
    expect(markPoint(0.5).y).toBe((markPoint(0).y + markPoint(1).y) / 2);
  });

  it('spreads close captions apart', () => {
    const ys = captionYs([100, 102, 104]);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(18);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(18);
    expect(Math.max(...captionYs([250, 252]))).toBeLessThanOrEqual(250);
  });
});

describe('puzzle text', () => {
  const { text } = puzzleTheme;

  it('reads naturally', () => {
    expect(text.name).toBe('Пазл');
    expect(text.completed(3)).toBe('Пазл 3 собран');
    expect(text.fillLabel(45)).toBe('Пазл собран на 45%');
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до пазла 4');
  });

  it('declines with lib/format plural', () => {
    expect([1, 2, 5, 11, 21].map((n) => `${n} ${plural(n, text.levelForms)}`)).toEqual(['1 пазл', '2 пазла', '5 пазлов', '11 пазлов', '21 пазл']);
    expect([1, 3, 5, 21].map((n) => `из ${n} ${plural(n, text.levelFormsOf)}`)).toEqual(['из 1 пазла', 'из 3 пазлов', 'из 5 пазлов', 'из 21 пазла']);
  });

  it('keeps forbidden words and exclamation marks out', () => {
    const strings = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.completed(7), text.fillLabel(50), text.hint];
    for (const s of strings) {
      expect(s).not.toMatch(FORBIDDEN);
      expect(s).not.toContain('!');
    }
  });

  it('is registered under its key and available', () => {
    expect(puzzleTheme.key).toBe('puzzle');
    expect(puzzleTheme.available).toBe(true);
  });
});
