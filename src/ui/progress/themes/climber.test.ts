import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { MAX_CYCLES } from '../../components/flaskAnimation';
import {
  LEVEL_MS,
  MOUNTAIN,
  SNOW_LINE,
  TRAIL,
  GHOST_SLOT,
  captionYs,
  choreography,
  climbStage,
  climberTheme,
  makeTrail,
  markHit,
  markPoint,
  shortLabel,
  trail,
  type Point,
} from './climber';

const FILLS = [0, 0.25, 0.5, 0.75, 0.999, 1];
const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

function inside(p: Point, polygon: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

describe('climbStage', () => {
  it('walks from the foot over the rock and the snow to the summit', () => {
    expect(FILLS.map(climbStage)).toEqual(['foot', 'trail', 'trail', 'trail', 'snow', 'summit']);
  });

  it('treats junk as the foot and anything past 1 as the summit', () => {
    expect(climbStage(Number.NaN)).toBe('foot');
    expect(climbStage(-1)).toBe('foot');
    expect(climbStage(3)).toBe('summit');
  });
});

describe('trail', () => {
  it('starts at the foot and ends on the summit', () => {
    expect(trail.at(0)).toMatchObject({ ...TRAIL[0], walked: 0 });
    expect(trail.at(1)).toMatchObject({ ...TRAIL[TRAIL.length - 1], walked: 1 });
  });

  it('maps fill to height climbed, so half the fill is half the way up', () => {
    const foot = TRAIL[0]!.y;
    const top = TRAIL[TRAIL.length - 1]!.y;
    for (const f of FILLS) expect(trail.at(f).y).toBeCloseTo(foot - f * (foot - top), 6);
    expect(trail.at(0.999).y).toBeLessThan(SNOW_LINE);
  });

  it('stays inside the mountain at every step', () => {
    for (let f = 0; f <= 1.0001; f += 0.01) expect(inside(trail.at(f), MOUNTAIN), `fill ${f}`).toBe(true);
  });

  it('walks a growing share of its length and faces the way each switchback leg goes', () => {
    const walked = FILLS.map((f) => trail.at(f).walked);
    expect([...walked].sort((a, b) => a - b)).toEqual(walked);
    expect(trail.at(0).facing).toBe(-1); // the first leg heads left
    expect(trail.at(0.25).facing).toBe(-1); // just past the right-hand corner
    expect(trail.at(0.5).facing).toBe(1);
    expect(trail.at(1).facing).toBe(1); // the last leg reaches the summit heading right
  });

  it('walks between two fills through every corner, offsets by distance', () => {
    const frames = trail.walk(0.9, 1);
    expect(frames[0]).toMatchObject({ offset: 0 });
    expect(frames[frames.length - 1]).toMatchObject({ offset: 1, x: 68 });
    const full = trail.walk(0, 1);
    expect(full.map(({ x, y }) => ({ x, y }))).toEqual(TRAIL.map(({ x, y }) => ({ x, y })));
    const offsets = full.map((f) => f.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(full.slice(0, -1).map((f) => f.facing)).toEqual([-1, 1, -1, 1, -1, 1, -1, 1]);
  });

  it('walks back down in reverse, facing downhill', () => {
    const down = trail.walk(0.5, 0.2);
    expect(down[0]!.walked).toBeGreaterThan(down[down.length - 1]!.walked);
    expect(down.map((f) => f.offset)).toEqual([...down.map((f) => f.offset)].sort((a, b) => a - b));
  });

  it('gives a still walk two identical frames', () => {
    const still = trail.walk(0.4, 0.4);
    expect(still).toHaveLength(2);
    expect(still[0]).toMatchObject({ x: still[1]!.x, y: still[1]!.y });
  });

  it('builds a trail from any climbing polyline', () => {
    const t = makeTrail([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]);
    expect(t.at(0.5)).toMatchObject({ x: 5, y: 5, walked: 0.5, facing: 1 });
  });
});

describe('markPoint', () => {
  it('is monotonic along the trail and inside the box', () => {
    let last = -1;
    for (let h = 0; h <= 1.0001; h += 0.02) {
      const p = markPoint(h);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(160);
      expect(p.y - 13).toBeGreaterThanOrEqual(0); // the pennant's top
      expect(p.y).toBeLessThanOrEqual(260);
      const walked = trail.at(h).walked;
      expect(walked).toBeGreaterThanOrEqual(last);
      last = walked;
    }
    expect(climberTheme.markPoint).toBe(markPoint);
  });

  it('gives every pennant a tap area of about 44 px inside the box', () => {
    for (const h of [0, 0.3, 0.6, 1]) {
      const p = markPoint(h);
      const hit = markHit(p);
      expect(hit.size * (140 / 160)).toBeGreaterThanOrEqual(43);
      expect(hit.x).toBeGreaterThanOrEqual(0);
      expect(hit.y).toBeGreaterThanOrEqual(0);
      expect(hit.x + hit.size).toBeLessThanOrEqual(160);
      expect(hit.y + hit.size).toBeLessThanOrEqual(260);
      expect(p.x).toBeGreaterThanOrEqual(hit.x);
      expect(p.x + 9).toBeLessThanOrEqual(hit.x + hit.size);
    }
  });

  it('keeps captions apart and short', () => {
    const ys = captionYs([100, 104, 250]);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(18);
    expect(Math.max(...ys)).toBeLessThanOrEqual(250);
    expect(shortLabel('Пробный тест')).toBe('Пробный тест');
    expect(shortLabel('Длинное название засечки')).toBe('Длинное наз…');
  });
});

describe('choreography', () => {
  const total = (levels: number) => choreography(levels).reduce((sum, p) => sum + p.timing.delay + p.timing.duration, 0);

  it('climbs, plants the flag, resets and walks on', () => {
    expect(choreography(1).map((p) => p.state.phase)).toEqual(['rising', 'overflow', 'draining', 'refilling']);
  });

  it('fits one level into 1.2 s', () => {
    expect(LEVEL_MS).toBe(1200);
    expect(total(1)).toBeLessThanOrEqual(LEVEL_MS);
    expect(choreography(1).map((p) => p.timing.delay + p.timing.duration)).toEqual([240, 340, 400, 220]);
  });

  it('gives the change of mountain time to read: sink, then grow, about 400 ms', () => {
    const [, , draining] = choreography(1);
    expect(draining!.timing.delay + draining!.timing.duration).toBeGreaterThanOrEqual(380);
    const repeat = choreography(3).filter((p) => p.state.phase === 'draining' && p.state.cycle > 0);
    for (const p of repeat) expect(p.timing.duration).toBeGreaterThanOrEqual(300);
  });

  it('parks the conquered peak on the far ridge, standing on the meadow', () => {
    const summit = MOUNTAIN.reduce((a, b) => (b.y < a.y ? b : a));
    const foot = Math.max(...MOUNTAIN.map((p) => p.y));
    expect(GHOST_SLOT.scale).toBeLessThan(0.6);
    expect(GHOST_SLOT.y + foot * GHOST_SLOT.scale).toBeCloseTo(foot, 0);
    const peakX = GHOST_SLOT.x + summit.x * GHOST_SLOT.scale;
    expect(peakX).toBeGreaterThan(126); // right of the new mountain
    expect(GHOST_SLOT.x + 126 * GHOST_SLOT.scale).toBeLessThanOrEqual(162);
  });

  it('compresses several levels into at most three cycles', () => {
    const phases = choreography(10).map((p) => p.state.phase);
    expect(phases.filter((p) => p === 'refilling')).toHaveLength(MAX_CYCLES);
    expect(phases.filter((p) => p === 'overflow')).toHaveLength(1);
    expect(total(10)).toBe(total(3));
    expect(total(3)).toBeLessThanOrEqual(LEVEL_MS * 3);
    expect(total(2)).toBeLessThan(total(3));
  });

  it('plays nothing for zero levels', () => {
    expect(choreography(0)).toEqual([]);
  });
});

describe('text', () => {
  const { text } = climberTheme;

  it('counts summits in Russian', () => {
    expect([1, 2, 5, 11, 21].map((n) => `${n} ${plural(n, text.levelForms)}`)).toEqual([
      '1 вершина',
      '2 вершины',
      '5 вершин',
      '11 вершин',
      '21 вершина',
    ]);
    expect([1, 3, 5, 21].map((n) => `из ${n} ${plural(n, text.levelFormsOf)}`)).toEqual(['из 1 вершины', 'из 3 вершин', 'из 5 вершин', 'из 21 вершины']);
  });

  it('names the level, its completion and the fill', () => {
    expect(`${text.levelNoun} 3`).toBe('Вершина 3');
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до вершины 4');
    expect(text.completed(3)).toBe('Вершина 3 покорена');
    expect(text.fillLabel(45)).toBe('Альпинист прошёл 45% подъёма');
    expect(text.name).toBe('Альпинист');
    expect(text.hint).toBe('Альпинист поднимается к вершине');
  });

  it('is calm: no forbidden words, no exclamation marks', () => {
    const strings = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.completed(2), text.fillLabel(50), text.hint];
    for (const s of strings) {
      expect(s).not.toMatch(FORBIDDEN);
      expect(s).not.toContain('!');
    }
  });

  it('is registered under its key and available', () => {
    expect(climberTheme.key).toBe('climber');
    expect(climberTheme.available).toBe(true);
  });
});
