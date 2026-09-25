import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { DONE_EVENT, IDLE, MAX_CYCLES, nextPhase, type AnimationState } from '../../components/flaskAnimation';
import {
  BLOCKS,
  CITY_LEFT,
  CITY_RIGHT,
  CITY_SLOTS,
  HANG,
  HAZE_COLS,
  LAMP_FADE,
  LAMP_PATTERNS,
  blockTop,
  cityBuilding,
  cityRandom,
  hangY,
  lampLitAt,
  skylineLayout,
  towerBlocks,
  towerRemainder,
  towerTheme,
  towerTiming,
  type CityBuilding,
} from './tower';

const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

describe('tower stages', () => {
  it('places floor(fill × 8) blocks', () => {
    expect([0, 0.25, 0.5, 0.75, 0.999, 1].map(towerBlocks)).toEqual([0, 2, 4, 6, 7, 8]);
    expect(towerBlocks(0.124)).toBe(0);
    expect(towerBlocks(0.125)).toBe(1);
    expect(towerBlocks(0.375)).toBe(3);
  });

  it('clamps odd input', () => {
    expect(towerBlocks(-1)).toBe(0);
    expect(towerBlocks(2)).toBe(BLOCKS);
    expect(towerBlocks(Number.NaN)).toBe(0);
  });

  it('lowers the next block as the remainder grows', () => {
    expect(towerRemainder(0)).toBe(0);
    expect(towerRemainder(0.25)).toBeCloseTo(0);
    expect(towerRemainder(0.3)).toBeCloseTo(0.4);
    expect(towerRemainder(0.999)).toBeCloseTo(0.992);
    expect(towerRemainder(1)).toBe(0);
    // Hanging HANG above its slot at the start of a share, almost in place at its end.
    expect(hangY(0)).toBeCloseTo(blockTop(0) - HANG);
    expect(hangY(0.25)).toBeCloseTo(blockTop(2) - HANG);
    expect(hangY(0.5)).toBeCloseTo(blockTop(4) - HANG);
    expect(hangY(0.75)).toBeCloseTo(blockTop(6) - HANG);
    expect(hangY(0.999)).toBeCloseTo(blockTop(7) - 0.008 * HANG);
    expect(hangY(1)).toBe(blockTop(7));
    // Within one share the block only goes down.
    for (let f = 0.5; f < 0.62; f += 0.01) expect(hangY(f + 0.005)).toBeGreaterThan(hangY(f));
  });

  it('stacks blocks upward inside the box and keeps the hanging block inside too', () => {
    expect(blockTop(0)).toBeGreaterThan(blockTop(1));
    expect(blockTop(BLOCKS - 1)).toBeGreaterThan(40);
    for (const f of [0, 0.25, 0.5, 0.75, 0.999, 1]) expect(hangY(f)).toBeGreaterThanOrEqual(0);
  });
});

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
/** The ground line: buildings stand behind it. */
const GROUND = blockTop(0) + 22;

describe('the city of finished towers', () => {
  it('stands level − 1 towers: the twelve newest as buildings, older ones in the haze', () => {
    for (const n of [0, 1, 2, 4, 11, 12, 13, 20, 39, 48, 70]) {
      const { buildings, haze } = skylineLayout(n);
      expect(buildings).toHaveLength(Math.min(n, CITY_SLOTS));
      expect(buildings.map((b) => b.index).sort((a, b) => a - b)).toEqual(range(Math.max(0, n - CITY_SLOTS), n));
      expect(haze?.columns.length ?? 0).toBe(Math.min(HAZE_COLS, Math.max(0, n - CITY_SLOTS)));
    }
    expect(skylineLayout(-2).buildings).toEqual([]);
    expect(skylineLayout(Number.NaN).buildings).toEqual([]);
  });

  it('is the same city every time, and a building never moves once it stands', () => {
    expect(skylineLayout(30)).toEqual(skylineLayout(30));
    expect(range(0, 50).map((k) => cityRandom(k, 7))).toEqual(range(0, 50).map((k) => cityRandom(k, 7)));
    for (const k of [0, 4, 11]) {
      for (const n of [k + 1, k + 6, k + CITY_SLOTS]) expect(skylineLayout(n).buildings.find((b) => b.index === k)).toEqual(cityBuilding(k));
    }
    // Tower k + 12 takes the slot of tower k, which melts into the haze.
    expect(cityBuilding(CITY_SLOTS + 3).x + cityBuilding(CITY_SLOTS + 3).w / 2).toBeCloseTo(cityBuilding(3).x + cityBuilding(3).w / 2, 0);
  });

  it('varies the buildings: widths, heights and roofs seeded by their index', () => {
    const all = range(0, 36).map(cityBuilding);
    expect(new Set(all.map((b) => b.roof)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(all.map((b) => b.w)).size).toBeGreaterThan(20);
    expect(new Set(all.map((b) => b.top)).size).toBeGreaterThan(30);
    for (const x of range(0, 200).map((k) => cityRandom(k, 3))) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('keeps every building, window and haze column inside the box, lower than the tower', () => {
    for (let n = 0; n <= 80; n++) {
      const { buildings, haze } = skylineLayout(n);
      for (const b of buildings) {
        expect(b.x).toBeGreaterThanOrEqual(CITY_LEFT);
        expect(b.x + b.w).toBeLessThanOrEqual(CITY_RIGHT);
        expect(b.peak).toBeLessThanOrEqual(b.top);
        expect(b.top).toBeLessThan(GROUND - 30);
        // Behind the finished tower (its top at blockTop(7)): the city never outgrows it.
        expect(b.peak).toBeGreaterThan(blockTop(BLOCKS - 1) + 30);
        for (const [x, y] of b.panes) {
          expect(x).toBeGreaterThanOrEqual(b.x);
          expect(x + b.pane[0]).toBeLessThanOrEqual(b.x + b.w);
          expect(y).toBeGreaterThanOrEqual(b.top);
          expect(y + b.pane[1]).toBeLessThanOrEqual(GROUND - 2);
        }
      }
      for (const c of haze?.columns ?? []) {
        expect(c.x).toBeGreaterThanOrEqual(CITY_LEFT);
        expect(c.x + c.w).toBeLessThanOrEqual(CITY_RIGHT);
        expect(c.top).toBeGreaterThan(blockTop(BLOCKS - 1) + 30);
      }
    }
  });

  it('never overlaps two buildings of one layer; near ones are larger than far ones', () => {
    for (const n of [5, 12, 13, 40, 77]) {
      const { buildings } = skylineLayout(n);
      for (const far of [false, true]) {
        const row = buildings.filter((b) => b.far === far).sort((a, b) => a.x - b.x);
        for (let i = 1; i < row.length; i++) expect(row[i]!.x - (row[i - 1]!.x + row[i - 1]!.w)).toBeGreaterThanOrEqual(1);
      }
    }
    const all = range(0, 48).map(cityBuilding);
    const near = all.filter((b) => !b.far);
    const far = all.filter((b) => b.far);
    const mean = (list: CityBuilding[], f: (b: CityBuilding) => number) => list.reduce((s, b) => s + f(b), 0) / list.length;
    expect(mean(near, (b) => b.w)).toBeGreaterThan(mean(far, (b) => b.w));
    expect(near[0]!.pane[0] * near[0]!.pane[1]).toBeGreaterThan(far[0]!.pane[0] * far[0]!.pane[1]);
  });

  it('keeps growing past twelve towers: the haze fills out, then rises', () => {
    const area = (n: number) => (skylineLayout(n).haze?.columns ?? []).reduce((s, c) => s + c.w * (GROUND - c.top), 0);
    for (let n = CITY_SLOTS + 1; n <= 62; n++) expect(area(n)).toBeGreaterThan(area(n - 1));
  });
});

describe('the lamps of the city', () => {
  const lamps = (n: number) => skylineLayout(n).buildings.flatMap((b) => b.lamps);
  const windows = (n: number) => skylineLayout(n).buildings.reduce((s, b) => s + b.panes.length, 0);
  const litShare = (n: number, t: number) => lamps(n).reduce((s, l) => s + (lampLitAt(l, t) ? l.panes.length : 0), 0) / windows(n);

  it('lights only a portion of the windows at any moment, and the portion changes', () => {
    for (const n of [4, 12, 40]) {
      const shares = range(0, 60).map((i) => litShare(n, i * 2.5));
      expect(Math.min(...shares)).toBeGreaterThanOrEqual(0.18);
      expect(Math.max(...shares)).toBeLessThanOrEqual(0.55);
      expect(Math.max(...shares) - Math.min(...shares)).toBeGreaterThan(0.005);
    }
  });

  it('switches slowly: long periods, fades over a second, spans of several seconds', () => {
    const live = range(0, 60).flatMap((k) => cityBuilding(k).lamps.filter((l) => l.live));
    expect(live.length).toBeGreaterThan(100);
    for (const lamp of live) {
      expect(lamp.period).toBeGreaterThanOrEqual(30);
      expect(lamp.period).toBeLessThanOrEqual(75);
      expect(LAMP_FADE * lamp.period).toBeGreaterThanOrEqual(1);
      expect(lamp.offset).toBeGreaterThanOrEqual(0);
      expect(lamp.offset).toBeLessThanOrEqual(lamp.period);
      const spans = LAMP_PATTERNS[lamp.pattern]!;
      for (const [on, off] of spans) expect((off - on) * lamp.period).toBeGreaterThanOrEqual(5);
    }
    // Every lamp keeps its own phase: they never switch in step.
    expect(new Set(live.map((l) => `${l.period}/${l.offset}`)).size).toBeGreaterThan(live.length * 0.9);
  });

  it('animates a bounded number of elements, calmly', () => {
    for (let n = 0; n <= 80; n += 4) {
      const live = lamps(n).filter((l) => l.live);
      expect(live.length).toBeLessThanOrEqual(150);
      // Switches per second across the whole city: a few, never a flicker.
      const rate = live.reduce((s, l) => s + (2 * LAMP_PATTERNS[l.pattern]!.length) / l.period, 0);
      expect(rate).toBeLessThanOrEqual(4);
    }
  });

  it('rests in a mix of lit and dark flats, and lights only a few by day', () => {
    const all = lamps(12);
    const live = all.filter((l) => l.live);
    const resting = live.filter((l) => l.rest).length / live.length;
    expect(resting).toBeGreaterThan(0.2);
    expect(resting).toBeLessThan(0.8);
    const day = all.filter((l) => l.day && !l.live).reduce((s, l) => s + l.panes.length, 0) + live.filter((l) => l.day).reduce((s, l) => s + l.panes.length, 0);
    expect(day / windows(12)).toBeGreaterThan(0);
    expect(day / windows(12)).toBeLessThan(0.15);
  });

  // Vitest serves CSS imports empty, and the project has no Node types: read the file through
  // Node's builtin loader (Node 22+), and skip where it is missing.
  type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
  const fs = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process?.getBuiltinModule?.('node:fs') as Fs | undefined;

  it.skipIf(!fs)('matches the keyframes in tower.css', () => {
    const css = fs!.readFileSync(new URL('./tower.css', import.meta.url), 'utf8');
    LAMP_PATTERNS.forEach((spans, i) => {
      const block = css.match(new RegExp(`@keyframes tower-lamp-${i} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
      const stops = (opacity: number) =>
        [...block.matchAll(/([\d.%,\s]+)\{\s*opacity: (\d);\s*\}/g)]
          .filter((m) => Number(m[2]) === opacity)
          .flatMap((m) => m[1]!.split(',').map((p) => Number.parseFloat(p)))
          .sort((a, b) => a - b);
      const pct = (v: number) => Math.round(v * 1000) / 10;
      expect(stops(1)).toEqual(spans.flatMap(([on, off]) => [pct(on + LAMP_FADE), pct(off)]).sort((a, b) => a - b));
      expect(stops(0)).toEqual([...new Set([0, 100, ...spans.flatMap(([on, off]) => [pct(on), pct(off + LAMP_FADE)])])].sort((a, b) => a - b));
    });
  });
});

describe('markPoint', () => {
  const heights = Array.from({ length: 101 }, (_, i) => i / 100);

  it('rises monotonically with the height', () => {
    const points = heights.map(towerTheme.markPoint);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.y).toBeLessThanOrEqual(points[i - 1]!.y);
      expect(points[i]!.x).toBe(points[0]!.x);
    }
    expect(points[100]!.y).toBeLessThan(points[0]!.y);
  });

  it('stays inside the box, pennant included', () => {
    for (const h of [...heights, -1, 2]) {
      const { x, y } = towerTheme.markPoint(h);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + 10).toBeLessThanOrEqual(160);
      expect(y - 12).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(260);
    }
  });
});

describe('level-up choreography', () => {
  /** Runs the flask state machine to the end, collecting the tower's timings. */
  function run(levels: number): { phases: AnimationState[]; total: number } {
    const phases: AnimationState[] = [];
    let state = nextPhase(IDLE, { type: 'start', levels });
    while (state.phase !== 'idle') {
      phases.push(state);
      state = nextPhase(state, { type: DONE_EVENT[state.phase] } as Parameters<typeof nextPhase>[1]);
    }
    const total = phases.reduce((sum, p) => sum + towerTiming(p).delay + towerTiming(p).duration, 0);
    return { phases, total };
  }

  it('tells the story rise → beat → reset → refill within 1.2 s for one level', () => {
    const { phases, total } = run(1);
    expect(phases.map((p) => p.phase)).toEqual(['rising', 'overflow', 'draining', 'refilling']);
    expect(total).toBeLessThanOrEqual(1200);
  });

  it('compresses repeats and caps them at three cycles', () => {
    const three = run(3);
    expect(three.phases.map((p) => p.phase)).toEqual(['rising', 'overflow', 'draining', 'refilling', 'draining', 'refilling', 'draining', 'refilling']);
    expect(three.total).toBeLessThanOrEqual(3 * 1200);
    const repeat = (p: AnimationState) => towerTiming(p).delay + towerTiming(p).duration;
    const compressed = three.phases.filter((p) => p.cycle > 0);
    expect(compressed.reduce((s, p) => s + repeat(p), 0)).toBeLessThan(1200);
    expect(run(10).phases.filter((p) => p.phase === 'draining')).toHaveLength(MAX_CYCLES);
  });

  it('has no timing for idle', () => {
    expect(towerTiming(IDLE)).toEqual({ delay: 0, duration: 0, easing: 'out' });
  });
});

describe('tower text', () => {
  const { text } = towerTheme;

  it('is the tower theme and available', () => {
    expect(towerTheme.key).toBe('tower');
    expect(towerTheme.available).toBe(true);
    expect(text.name).toBe('Башня');
    expect(text.levelNoun).toBe('Башня');
    expect(text.levelGenitive).toBe('башни');
  });

  it('declines the counts', () => {
    const count = (n: number) => `${n} ${plural(n, text.levelForms)}`;
    expect([1, 2, 5, 11, 21].map(count)).toEqual(['1 башня', '2 башни', '5 башен', '11 башен', '21 башня']);
    const of = (n: number) => `из ${n} ${plural(n, text.levelFormsOf)}`;
    expect([1, 2, 5, 11, 21].map(of)).toEqual(['из 1 башни', 'из 2 башен', 'из 5 башен', 'из 11 башен', 'из 21 башни']);
  });

  it('names the completion and the fill', () => {
    expect(text.completed(3)).toBe('Башня 3 построена');
    expect(text.fillLabel(45)).toBe('Башня построена на 45%');
    expect(text.hint).toBe('Кубики ставятся друг на друга');
  });

  it('keeps the tone rules: no forbidden words, no exclamation marks', () => {
    const strings = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.completed(1), text.completed(12), text.fillLabel(0), text.fillLabel(100), text.hint];
    for (const s of strings) {
      expect(s).not.toMatch(FORBIDDEN);
      expect(s).not.toContain('!');
    }
  });
});
