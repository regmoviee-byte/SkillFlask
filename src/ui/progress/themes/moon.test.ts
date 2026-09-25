import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { DONE_EVENT, IDLE, nextPhase } from '../../components/flaskAnimation';
import {
  EASE,
  SKY_STARS,
  STARS_PER_CONSTELLATION,
  captionYs,
  cometFrames,
  constellationLines,
  groupOpacity,
  haloOpacity,
  inSky,
  levelOf,
  milkyWay,
  moonCaption,
  moonMonth,
  moonName,
  moonPhasePath,
  moonPhaseTiming,
  moonTheme,
  phaseFrames,
  phaseRig,
  shortLabel,
  skyStars,
  specialMoon,
  starPoint,
  tintOpacity,
} from './moon';

const FILLS = [0, 0.25, 0.5, 0.75, 0.999, 1];
const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

/** The terminator arc of a phase path: [rx, sweep]. */
function terminator(path: string): [number, number] {
  const arcs = [...path.matchAll(/A([\d.]+) ([\d.]+) 0 0 (\d) /g)];
  expect(arcs).toHaveLength(2);
  return [Number(arcs[1]![1]), Number(arcs[1]![3])];
}

describe('moon phase', () => {
  it('draws the right limb and an elliptical terminator at every stage', () => {
    expect(FILLS.map((f) => terminator(moonPhasePath(f)))).toEqual([
      [50, 0], // new moon: the terminator lies on the limb, nothing is lit
      [25, 0], // crescent: bulges right
      [0, 0], // first quarter: a straight line
      [25, 1], // gibbous: bulges left
      [49.9, 1],
      [50, 1], // full moon: the whole disc
    ]);
    expect(moonPhasePath(0.5)).toBe('M80 46A50 50 0 0 1 80 146A0 50 0 0 0 80 46Z');
    expect(moonPhasePath(1, 20, 20, 13)).toBe('M20 7A13 13 0 0 1 20 33A13 13 0 0 1 20 7Z');
  });

  it('clamps odd fills', () => {
    expect(moonPhasePath(-1)).toBe(moonPhasePath(0));
    expect(moonPhasePath(2)).toBe(moonPhasePath(1));
    expect(moonPhasePath(Number.NaN)).toBe(moonPhasePath(0));
  });

  it('squeezes the shadow ellipse to the half moon, then grows the lit one', () => {
    expect(FILLS.map(phaseRig)).toEqual([
      { shadow: 1, light: 0 },
      { shadow: 0.5, light: 0 },
      { shadow: 0, light: 0 },
      { shadow: 0, light: 0.5 },
      { shadow: 0, light: 0.998 },
      { shadow: 0, light: 1 },
    ]);
  });

  it('brightens the halo with the fill', () => {
    const halos = FILLS.map(haloOpacity);
    expect(halos[0]).toBeGreaterThan(0);
    for (let i = 1; i < halos.length; i++) expect(halos[i]!).toBeGreaterThanOrEqual(halos[i - 1]!);
    expect(halos[3]!).toBeGreaterThan(halos[1]!);
    expect(halos[5]).toBeLessThanOrEqual(1);
  });

  it('builds keyframes that never show both ellipses, with a frame exactly at the half moon', () => {
    for (const [from, to] of [
      [0.9, 1],
      [1, 0],
      [0, 0.2],
      [0, 0.75],
      [0.3, 0.8],
    ] as [number, number][]) {
      const frames = phaseFrames(from, to, EASE.out);
      const scale = (k: Keyframe) => Number(/scaleX\(([-\d.]+)\)/.exec(String(k.transform))![1]);
      expect(frames.shadow[0]!.offset).toBe(0);
      expect(frames.shadow.at(-1)!.offset).toBe(1);
      frames.shadow.forEach((k, i) => {
        expect(scale(k) === 0 || scale(frames.light[i]!) === 0).toBe(true);
        if (i > 0) expect(Number(k.offset)).toBeGreaterThan(Number(frames.shadow[i - 1]!.offset));
      });
      expect(frames.shadow.at(-1)!.transform).toBe(`scaleX(${phaseRig(to).shadow})`);
      expect(frames.light.at(-1)!.transform).toBe(`scaleX(${phaseRig(to).light})`);
      const crosses = (from - 0.5) * (to - 0.5) < 0;
      const halfFrames = frames.shadow.filter((k, i) => scale(k) === 0 && scale(frames.light[i]!) === 0);
      expect(halfFrames.length > 0).toBe(crosses || from === 0.5 || to === 0.5);
    }
  });

  it('eases from 0 to 1', () => {
    for (const ease of Object.values(EASE)) {
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
    }
  });
});

describe('moon level-up timing', () => {
  const total = (levels: number) => {
    let state = nextPhase(IDLE, { type: 'start', levels });
    let ms = 0;
    const phases: string[] = [];
    while (state.phase !== 'idle') {
      const t = moonPhaseTiming(state);
      ms += t.delay + t.duration;
      phases.push(state.phase);
      state = nextPhase(state, { type: DONE_EVENT[state.phase] } as never);
    }
    return { ms, phases };
  };

  it('waxes, glows, wanes and waxes again within 1.2 s for one level', () => {
    expect(total(1)).toEqual({ ms: 1100, phases: ['rising', 'overflow', 'draining', 'refilling'] });
  });

  it('compresses further levels and stops at three cycles', () => {
    expect(total(2).ms).toBeLessThanOrEqual(2 * 1200);
    expect(total(3).ms).toBeLessThanOrEqual(3 * 1200);
    expect(total(9)).toEqual(total(3));
    expect(total(3).phases).toHaveLength(8);
  });
});

describe('the twelve moons', () => {
  const NAMES = ['Волчья', 'Снежная', 'Червячная', 'Розовая', 'Цветочная', 'Клубничная', 'Оленья', 'Осетровая', 'Урожайная', 'Охотничья', 'Бобровая', 'Холодная'];

  it('names the full moon of every level after its month, January to December, cycling', () => {
    for (let level = 1; level <= 36; level++) {
      expect(moonMonth(level)).toBe((level - 1) % 12);
      expect(moonName(level)).toBe(`${NAMES[(level - 1) % 12]} луна`);
    }
    expect(moonName(1)).toBe('Волчья луна');
    expect(moonName(12)).toBe('Холодная луна');
    expect(moonName(13)).toBe('Волчья луна');
    expect(new Set(Array.from({ length: 12 }, (_, i) => moonName(i + 1))).size).toBe(12);
  });

  it('reads an omitted or odd level as the first', () => {
    expect([undefined, 0, -3, Number.NaN, Infinity].map(levelOf)).toEqual([1, 1, 1, 1, 1]);
    expect(levelOf(4.7)).toBe(4);
    expect(moonName()).toBe('Волчья луна');
    expect(moonMonth(undefined)).toBe(0);
  });

  it('keeps the names calm', () => {
    for (let level = 1; level <= 40; level++) {
      expect(moonCaption(level)).not.toMatch(FORBIDDEN);
      expect(moonCaption(level)).not.toContain('!');
    }
  });
});

describe('special moons', () => {
  it('rises a blue moon every 13th level, a supermoon every 9th, a blood moon every 17th', () => {
    const specials = Array.from({ length: 120 }, (_, i) => [i + 1, specialMoon(i + 1)] as const).filter(([, s]) => s);
    expect(specials.slice(0, 8)).toEqual([
      [9, 'super'],
      [13, 'blue'],
      [17, 'blood'],
      [18, 'super'],
      [26, 'blue'],
      [27, 'super'],
      [34, 'blood'],
      [36, 'super'],
    ]);
    // The blue moon wins over the others, the supermoon over the blood moon.
    expect(specialMoon(117)).toBe('blue');
    expect(specialMoon(221)).toBe('blue');
    expect(specialMoon(153)).toBe('super');
    expect([1, 2, 3, 8, 10, 12, 14, 16].map((l) => specialMoon(l))).toEqual(Array(8).fill(null));
    expect(specialMoon()).toBeNull();
  });

  it('names the special moons in the caption instead of the month', () => {
    expect(moonCaption(9)).toBe('Суперлуние');
    expect(moonCaption(13)).toBe('Голубая луна');
    expect(moonCaption(17)).toBe('Кровавая луна');
    expect(moonCaption(14)).toBe('Снежная луна');
  });

  it('tints a blue moon throughout and a blood moon only as it comes full', () => {
    expect(FILLS.map((f) => tintOpacity(null, f))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(FILLS.map((f) => tintOpacity('super', f))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(new Set(FILLS.map((f) => tintOpacity('blue', f))).size).toBe(1);
    expect(tintOpacity('blue', 1)).toBeLessThan(1); // the skill colour still shows through
    const blood = FILLS.map((f) => tintOpacity('blood', f));
    expect(blood.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(blood[5]).toBeGreaterThan(0.8);
    expect(blood[5]).toBeLessThan(1);
    const frames = phaseFrames(0, 1, EASE.out, 16, 'blood');
    expect(frames.tint[0]!.opacity).toBe(0);
    expect(frames.tint.at(-1)!.opacity).toBe(tintOpacity('blood', 1));
  });
});

describe('the sky that remembers', () => {
  it('lights one star per completed moon, at the same places every time', () => {
    expect(skyStars(0)).toEqual([]);
    expect(skyStars(5)).toHaveLength(5);
    expect(skyStars(5)).toEqual(skyStars(49).slice(0, 5));
    expect(skyStars(SKY_STARS)).toEqual(skyStars(SKY_STARS));
    expect(skyStars(500)).toHaveLength(SKY_STARS);
    expect(SKY_STARS).toBe(49);
  });

  it('keeps every star in the open sky: off the Moon, above the land, clear of the caption and apart', () => {
    const stars = skyStars(SKY_STARS);
    for (const { x, y, r } of stars) {
      expect(inSky(x, y)).toBe(true);
      expect(Math.hypot(x - 80, y - 96)).toBeGreaterThanOrEqual(55 + r); // a supermoon's disc
      expect(x - r).toBeGreaterThan(0);
      expect(x + r).toBeLessThan(160);
      expect(y - r).toBeGreaterThan(0);
      expect(y).toBeLessThanOrEqual(150); // the land's tallest firs stop below
    }
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) expect(Math.hypot(stars[i]!.x - stars[j]!.x, stars[i]!.y - stars[j]!.y)).toBeGreaterThan(4);
    }
  });

  it('gathers every seven stars into a constellation, joined once all seven shine', () => {
    const stars = skyStars(SKY_STARS);
    stars.forEach((s, i) => expect(s.group).toBe(Math.floor(i / STARS_PER_CONSTELLATION)));
    expect(constellationLines(6)).toEqual([]);
    expect(constellationLines(7).map((c) => c.group)).toEqual([0]);
    expect(constellationLines(13).map((c) => c.group)).toEqual([0]);
    expect(constellationLines(14).map((c) => c.group)).toEqual([0, 1]);
    expect(constellationLines(300).map((c) => c.group)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // The lines run through the constellation's own stars.
    for (const { group, chains } of constellationLines(SKY_STARS)) {
      const own = stars.filter((s) => s.group === group).map((s) => `${s.x} ${s.y}`);
      for (const chain of chains) for (const point of chain.split(/[ML]/).filter(Boolean)) expect(own).toContain(point);
    }
  });

  it('dims older constellations', () => {
    const lines = constellationLines(35);
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.opacity).toBeGreaterThan(lines[i - 1]!.opacity);
    expect(groupOpacity(4, 35)).toBe(1);
    expect(groupOpacity(0, 35)).toBeLessThan(groupOpacity(3, 35));
    expect(groupOpacity(0, 3)).toBe(1);
    expect(groupOpacity(0, 300)).toBeGreaterThanOrEqual(0.5);
  });

  it('then fills a Milky Way that keeps thickening', () => {
    expect(milkyWay(0)).toBeNull();
    expect(milkyWay(SKY_STARS)).toBeNull();
    const ways = [50, 60, 99, 150, 199, 400].map((n) => milkyWay(n)!);
    for (let i = 1; i < ways.length; i++) {
      expect(ways[i]!.width).toBeGreaterThanOrEqual(ways[i - 1]!.width);
      expect(ways[i]!.opacity).toBeGreaterThanOrEqual(ways[i - 1]!.opacity);
      expect(ways[i]!.dots.length).toBeGreaterThanOrEqual(ways[i - 1]!.dots.length);
      // Dots never move: a later sky keeps the earlier dots.
      expect(ways[i]!.dots.slice(0, ways[i - 1]!.dots.length)).toEqual(ways[i - 1]!.dots);
    }
    expect(ways[2]!.dots).toHaveLength(50);
    expect(ways[5]!.opacity).toBe(1);
    for (const [x, y] of ways[5]!.dots) expect(inSky(x, y)).toBe(true);
  });

  it('knows where each star flies to', () => {
    const stars = skyStars(SKY_STARS);
    stars.forEach((s, i) => expect(starPoint(i)).toEqual([s.x, s.y]));
    expect(starPoint(SKY_STARS + 9)).toEqual(milkyWay(SKY_STARS + 10)!.dots.at(-1));
  });

  it('flies a new star out of the Moon to its place', () => {
    for (const i of [0, 6, 20, 30, 48, 60]) {
      const [x, y] = starPoint(i);
      const frames = cometFrames(x, y);
      const at = (k: Keyframe) => /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(String(k.transform))!.slice(1).map(Number);
      const [sx, sy] = at(frames[0]!);
      expect(Math.hypot(sx! - 80, sy! - 96)).toBeLessThan(50);
      expect(frames[0]!.opacity).toBe(0);
      expect(at(frames.at(-1)!)).toEqual([x, y]);
      expect(frames.at(-1)!.transform).toContain('scale(1)');
    }
  });
});

describe('moon marks', () => {
  it('rises monotonically along the orbit and stays inside the box', () => {
    let last = Infinity;
    for (let i = 0; i <= 100; i++) {
      const { x, y } = moonTheme.markPoint(i / 100);
      expect(y).toBeLessThan(last);
      last = y;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + 9).toBeLessThanOrEqual(160); // the pennant's flag
      expect(y - 13).toBeGreaterThanOrEqual(0); // the pennant's pole
      expect(y).toBeLessThanOrEqual(260);
    }
    expect(moonTheme.markPoint(0.5)).toEqual({ x: 140, y: 96 });
    expect(moonTheme.markPoint(-1)).toEqual(moonTheme.markPoint(0));
  });

  it('shortens captions and keeps them apart', () => {
    expect(shortLabel('Пробный тест')).toBe('Пробный тест');
    expect(shortLabel('Длинное название засечки')).toBe('Длинное наз…');
    const ys = captionYs([100, 96, 98, 250]);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(18);
    expect(Math.max(...ys)).toBeLessThanOrEqual(248);
  });
});

describe('moon text', () => {
  const { text } = moonTheme;

  it('names levels naturally', () => {
    expect(text.name).toBe('Луна');
    expect(text.completed(3)).toBe('Полнолуние 3');
    expect(text.fillLabel(45)).toBe('Луна заполнена на 45%');
    expect(text.hint).toBe('От новолуния к полнолунию');
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до луны 4');
    expect([1, 2, 5, 11, 21].map((n) => `${n} ${plural(n, text.levelForms)}`)).toEqual(['1 луна', '2 луны', '5 лун', '11 лун', '21 луна']);
    expect([1, 2, 5, 11, 21].map((n) => `из ${n} ${plural(n, text.levelFormsOf)}`)).toEqual(['из 1 луны', 'из 2 лун', 'из 5 лун', 'из 11 лун', 'из 21 луны']);
  });

  it('stays calm: no forbidden words, no exclamation marks', () => {
    const strings = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.hint, text.completed(7), text.fillLabel(0), text.fillLabel(100)];
    for (const s of strings) {
      expect(s).not.toMatch(FORBIDDEN);
      expect(s).not.toContain('!');
    }
  });

  it('is available under its key', () => {
    expect(moonTheme.key).toBe('moon');
    expect(moonTheme.available).toBe(true);
  });
});
