import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import {
  MAX_CYCLES,
  ROCKET_DONE_EVENT,
  ROCKET_IDLE,
  FLAME_SCALE,
  captionYs,
  flagTip,
  flightKeyframes,
  handoverScene,
  leaderPoints,
  launchTarget,
  makePlanet,
  makeRoute,
  markPoint,
  markPointOn,
  miniPose,
  nextRocketPhase,
  pathPoint,
  planetFor,
  rocketPose,
  rocketStage,
  rocketTheme,
  rocketTiming,
  routeFor,
  seeded,
  shortLabel,
  type RocketAnimationState,
  type RocketPhase,
} from './rocket';

const FILLS = [0, 0.25, 0.5, 0.75, 0.999, 1];
const inside = ({ x, y }: { x: number; y: number }, w = 160, h = 260) => x >= 0 && x <= w && y >= 0 && y <= h;

describe('rocket stages', () => {
  it('derives the stage from the fill', () => {
    expect(FILLS.map(rocketStage)).toEqual(['pad', 'liftoff', 'cruise', 'cruise', 'descent', 'landed']);
  });

  it('burns the flame hardest at lift-off and not at all on the pad or the Moon', () => {
    const flameScale = (fill: number) => FLAME_SCALE[rocketStage(fill)];
    expect(flameScale(0.25)).toBeGreaterThan(flameScale(0.5));
    expect(flameScale(0.5)).toBeGreaterThan(flameScale(0.999));
    expect(flameScale(0)).toBeLessThan(flameScale(0.999));
  });

  it('clamps odd input', () => {
    expect(rocketStage(-1)).toBe('pad');
    expect(rocketStage(Number.NaN)).toBe('pad');
    expect(rocketStage(7)).toBe('landed');
  });
});

describe('flight path', () => {
  it('starts on the launch pad and ends on top of the Moon', () => {
    expect(pathPoint(0)).toEqual({ x: 42, y: 226 });
    const end = pathPoint(1);
    expect(end.x).toBeCloseTo(116, 5);
    expect(end.y).toBeCloseTo(50, 5);
  });

  it('keeps the rocket inside the box at every stage', () => {
    for (const fill of FILLS) {
      const pose = rocketPose(fill);
      expect(inside(pose), `fill ${fill}`).toBe(true);
      // The nose, 28 units ahead of the tail along the heading.
      const rad = (pose.angle * Math.PI) / 180;
      expect(inside({ x: pose.x + 28 * Math.sin(rad), y: pose.y - 28 * Math.cos(rad) }), `nose at ${fill}`).toBe(true);
    }
  });

  it('points up on the pad, turns along the S, and stands upright on the Moon', () => {
    expect(Math.abs(rocketPose(0).angle)).toBeLessThan(5);
    expect(rocketPose(0.25).angle).toBeGreaterThan(10);
    expect(rocketPose(0.5).angle).toBeLessThan(0);
    expect(rocketPose(0.75).angle).toBeGreaterThan(30);
    expect(Math.abs(rocketPose(0.999).angle)).toBeLessThan(5);
    expect(rocketPose(1).angle).toBe(0);
  });

  it('moves at an even pace along the arc', () => {
    const steps = Array.from({ length: 21 }, (_, i) => pathPoint(i / 20));
    const gaps = steps.slice(1).map((p, i) => Math.hypot(p.x - steps[i]!.x, p.y - steps[i]!.y));
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.1);
  });

  it('turns smoothly: no heading jumps between close fills', () => {
    for (let i = 1; i <= 200; i++) expect(Math.abs(rocketPose(i / 200).angle - rocketPose((i - 1) / 200).angle)).toBeLessThan(12);
  });

  it('builds keyframes along the curve with offsets from 0 to 1', () => {
    const frames = flightKeyframes(0.2, 0.8);
    expect(frames.length).toBeGreaterThan(10);
    expect(frames[0]!.offset).toBe(0);
    expect(frames[frames.length - 1]!.offset).toBe(1);
    expect(frames[0]!.transform).toMatch(/^translate\([\d.]+px, [\d.]+px\) rotate\(-?[\d.]+deg\)$/);
  });

  it('keeps the mini rocket inside its square', () => {
    for (let level = 1; level <= 30; level++) {
      for (const fill of FILLS) {
        const pose = miniPose(fill, level);
        const rad = (pose.angle * Math.PI) / 180;
        expect(inside(pose, 40, 40), `level ${level}, fill ${fill}`).toBe(true);
        expect(inside({ x: pose.x + 12.3 * Math.sin(rad), y: pose.y - 12.3 * Math.cos(rad) }, 40, 40), `nose, level ${level}, fill ${fill}`).toBe(true);
      }
    }
  });
});

describe('marks', () => {
  const heights = Array.from({ length: 51 }, (_, i) => i / 50);

  it('sit inside the box', () => {
    for (const h of heights) expect(inside(markPoint(h)), `height ${h}`).toBe(true);
  });

  it('are monotonic along the path: each one further from the pad along the curve', () => {
    // Distance along the path, measured by walking the path in fine steps.
    const along = (h: number) => {
      const target = markPoint(h);
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i <= 1000; i++) {
        const p = pathPoint(i / 1000);
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      return best;
    };
    const positions = heights.map(along);
    for (let i = 1; i < positions.length; i++) expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    // Clear of the pad and of the Moon.
    expect(markPoint(0).y).toBeLessThan(224);
    expect(markPoint(1).y).toBeGreaterThan(20);
  });

  it('sit exactly where the rocket is when the fill reaches them', () => {
    for (let h = 0.1; h <= 0.85; h += 0.01) {
      expect(markPoint(h).x, `height ${h}`).toBeCloseTo(pathPoint(h).x, 6);
      expect(markPoint(h).y, `height ${h}`).toBeCloseTo(pathPoint(h).y, 6);
    }
  });

  it('lead each caption from its pennant without crossing the Moon', () => {
    const moon = { x: 116, y: 72, r: 22 };
    for (let h = 0; h <= 0.85; h += 0.01) {
      const tip = flagTip(markPoint(h));
      for (const others of [[], [h + 0.02], [h - 0.02, h + 0.02]]) {
        const ys = captionYs([tip.y, ...others.map((o) => flagTip(markPoint(o)).y)]);
        // No caption sits beside the Moon, where it would read as the Moon's name.
        for (const y of ys) expect(y <= moon.y - moon.r - 6 || y >= moon.y + moon.r + 6, `caption at ${y}`).toBe(true);
        const points = leaderPoints(tip, ys[0]!);
        expect(points[0]).toEqual(tip);
        expect(points[points.length - 1]).toEqual({ x: 140, y: ys[0] });
        for (let k = 1; k < points.length; k++) {
          for (let t = 0; t <= 1; t += 0.02) {
            const x = points[k - 1]!.x + (points[k]!.x - points[k - 1]!.x) * t;
            const y = points[k - 1]!.y + (points[k]!.y - points[k - 1]!.y) * t;
            expect(Math.hypot(x - moon.x, y - moon.y), `height ${h}`).toBeGreaterThan(moon.r);
          }
        }
      }
    }
  });

  it('shortens captions to 12 characters', () => {
    expect(shortLabel('Экзамен')).toBe('Экзамен');
    expect(shortLabel('Пробный тест')).toBe('Пробный тест');
    expect(shortLabel('Длинное название засечки')).toBe('Длинное наз…');
  });

  it('spreads captions at least 18 units apart inside the box, keeping their order', () => {
    const ys = captionYs([120, 125, 250, 252]);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(18);
    expect(ys[3]! - ys[2]!).toBeGreaterThanOrEqual(18);
    expect(Math.max(...ys)).toBeLessThanOrEqual(250);
    expect(captionYs([200, 100])).toEqual([200, 100]);
  });
});

describe('the journey: planets', () => {
  const LEVELS = Array.from({ length: 40 }, (_, i) => i + 1);

  it('draws the same planet for the same level, from a seeded generator', () => {
    for (const n of [1, 2, 3, 7, 12, 99]) {
      expect(makePlanet(n)).toEqual(makePlanet(n));
      expect(planetFor(n)).toEqual(makePlanet(n));
    }
    const a = seeded(5, 1);
    const b = seeded(5, 1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seeded(5, 1)()).not.toBe(seeded(6, 1)());
  });

  it('starts with the Moon', () => {
    const moon = planetFor(1);
    expect(moon.palette).toBe('moon');
    expect(moon.name).toBe('Луна');
    expect(moon.r).toBe(22);
  });

  it('varies: at least 8 palettes and 8 feature sets in levels 1–20, never the same palette twice in a row', () => {
    const planets = LEVELS.slice(0, 20).map(planetFor);
    expect(new Set(planets.map((p) => p.palette)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(planets.map((p) => `${p.palette}:${p.features.join(',')}`)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(planets.map((p) => p.features.join(','))).size).toBeGreaterThanOrEqual(8);
    for (let n = 2; n <= 200; n++) expect(planetFor(n).palette, `level ${n}`).not.toBe(planetFor(n - 1).palette);
    expect(new Set(planets.map((p) => p.name)).size).toBe(20);
  });

  it('keeps generated colours in a band that reads on light and dark pages', () => {
    for (let n = 2; n <= 100; n++) {
      const p = planetFor(n);
      const lightness = Number(/,(\d+)%\)$/.exec(p.base)![1]);
      expect(lightness, `level ${n}`).toBeGreaterThanOrEqual(34);
      expect(lightness, `level ${n}`).toBeLessThanOrEqual(76);
      expect(p.r).toBeGreaterThanOrEqual(16);
      expect(p.r).toBeLessThanOrEqual(28);
    }
  });
});

describe('the journey: routes', () => {
  const LEVELS = Array.from({ length: 120 }, (_, i) => i + 1);
  const ground = { cx: 62, cy: 420, r: 192 };

  it('draws the same route for the same level', () => {
    for (const n of [1, 2, 5, 12, 77]) {
      expect(makeRoute(n)).toEqual(makeRoute(n));
      expect(routeFor(n)).toEqual(makeRoute(n));
    }
  });

  it('flies level 1 from the Earth to the Moon and later levels from the last destination on', () => {
    const first = routeFor(1);
    expect(first.kind).toBe('moon');
    expect(first.dest).toEqual({ cx: 116, cy: 72, r: 22 });
    for (let n = 2; n <= 30; n++) {
      const route = routeFor(n);
      // Launch from the top of the ground, which is where the camera brings the landed rocket.
      expect(pathPoint(0, n)).toEqual({ x: 62, y: 228 });
      expect(route.dest.r).toBe(planetFor(n).r);
      const end = pathPoint(1, n);
      expect(end.x).toBeCloseTo(route.dest.cx, 5);
      expect(end.y).toBeCloseTo(route.dest.cy - route.dest.r, 5);
    }
  });

  it('takes at least 5 shapes in levels 1–12 and never the same shape twice in a row', () => {
    const kinds = LEVELS.slice(0, 12).map((n) => routeFor(n).kind);
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(5);
    for (let n = 3; n <= 120; n++) expect(routeFor(n).kind, `level ${n}`).not.toBe(routeFor(n - 1).kind);
  });

  it('stays inside the box, rocket and all', () => {
    for (const n of LEVELS) {
      for (const p of routeFor(n).table) expect(inside(p, 156, 256) && p.x >= 4 && p.y >= 4, `level ${n} at ${p.x},${p.y}`).toBe(true);
      for (let i = 0; i <= 50; i++) {
        const pose = rocketPose(i / 50, n);
        const rad = (pose.angle * Math.PI) / 180;
        expect(inside({ x: pose.x + 28 * Math.sin(rad), y: pose.y - 28 * Math.cos(rad) }), `nose, level ${n} at ${i / 50}`).toBe(true);
      }
    }
  });

  it('progresses monotonically from the ground at the bottom to the destination at the top', () => {
    for (const n of LEVELS) {
      const { table } = routeFor(n);
      for (let i = 1; i < table.length; i++) expect(table[i]!.s).toBeGreaterThan(table[i - 1]!.s);
      expect(pathPoint(0, n).y).toBeGreaterThan(220);
      expect(pathPoint(1, n).y).toBeLessThan(100);
      // An even pace: equal fills cover equal distances along the route.
      const steps = Array.from({ length: 401 }, (_, i) => pathPoint(i / 400, n));
      const gaps = Array.from({ length: 20 }, (_, j) => {
        let d = 0;
        for (let i = j * 20 + 1; i <= j * 20 + 20; i++) d += Math.hypot(steps[i]!.x - steps[i - 1]!.x, steps[i]!.y - steps[i - 1]!.y);
        return d;
      });
      expect(Math.max(...gaps) / Math.min(...gaps), `level ${n}`).toBeLessThan(1.05);
    }
  });

  it('keeps clear of the planets, their rings and moons, except at launch and landing', () => {
    for (const n of LEVELS) {
      const route = routeFor(n);
      const planet = planetFor(n);
      const { cx, cy, r } = route.dest;
      const k = r / 100;
      const start = pathPoint(0, n);
      const end = pathPoint(1, n);
      for (const p of route.table) {
        if (Math.hypot(p.x - start.x, p.y - start.y) < 20 || Math.hypot(p.x - end.x, p.y - end.y) < 22) continue;
        const at = `level ${n} (${route.kind}) at ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        expect(Math.hypot(p.x - cx, p.y - cy), at).toBeGreaterThan(r + 4);
        expect(Math.hypot(p.x - ground.cx, p.y - ground.cy), at).toBeGreaterThan(ground.r + 6);
        if (planet.ring) {
          // Outside the ring's ellipse (outer edge of its 13-unit band) in the ring's own frame.
          const a = (-planet.ring.tilt * Math.PI) / 180;
          const dx = (p.x - cx) / k;
          const dy = (p.y - cy) / k;
          const x = dx * Math.cos(a) - dy * Math.sin(a);
          const y = dx * Math.sin(a) + dy * Math.cos(a);
          expect((x / (planet.ring.rx + 20)) ** 2 + (y / (planet.ring.ry + 20)) ** 2, at).toBeGreaterThan(1);
        }
        if (planet.moon) expect(Math.hypot(p.x - (cx + planet.moon.x * k), p.y - (cy + planet.moon.y * k)), at).toBeGreaterThan(planet.moon.r * k + 4);
        if (route.moon) expect(Math.hypot(p.x - route.moon.x, p.y - route.moon.y), at).toBeGreaterThan(route.moon.r + 5);
      }
    }
  });

  it('keeps the destination and its rings inside the box, clear of the ground', () => {
    for (const n of LEVELS) {
      const { dest, reach } = routeFor(n);
      expect(dest.cx - reach).toBeGreaterThanOrEqual(4);
      expect(dest.cx + reach).toBeLessThanOrEqual(156);
      expect(dest.cy - dest.r).toBeGreaterThanOrEqual(44);
      expect(dest.cy + dest.r).toBeLessThan(140);
    }
  });

  it('places marks monotonically on the route on screen', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const heights = Array.from({ length: 41 }, (_, i) => i / 40);
      const along = heights.map((h) => {
        const target = markPointOn(n, h);
        let best = 0;
        let bestDistance = Infinity;
        for (let i = 0; i <= 1000; i++) {
          const p = pathPoint(i / 1000, n);
          const d = Math.hypot(p.x - target.x, p.y - target.y);
          if (d < bestDistance) {
            bestDistance = d;
            best = i;
          }
        }
        return best;
      });
      for (let i = 1; i < along.length; i++) expect(along[i]!, `level ${n}`).toBeGreaterThan(along[i - 1]!);
      for (const h of heights) expect(inside(markPointOn(n, h))).toBe(true);
    }
    // The contract's markPoint(height) answers for level 1.
    expect(markPoint(0.5)).toEqual(markPointOn(1, 0.5));
  });

  it('leads captions round any destination', () => {
    for (const n of LEVELS.slice(0, 30)) {
      const { dest } = routeFor(n);
      for (let h = 0; h <= 1; h += 0.05) {
        const tip = flagTip(markPointOn(n, h));
        const [y] = captionYs([tip.y], dest);
        expect(y! <= dest.cy - dest.r - 6 || y! >= dest.cy + dest.r + 6).toBe(true);
        const points = leaderPoints(tip, y!, dest);
        expect(points[points.length - 1]).toEqual({ x: 140, y });
        for (let k = 1; k < points.length; k++) {
          for (let t = 0; t <= 1; t += 0.02) {
            const x = points[k - 1]!.x + (points[k]!.x - points[k - 1]!.x) * t;
            const yy = points[k - 1]!.y + (points[k]!.y - points[k - 1]!.y) * t;
            expect(Math.hypot(x - dest.cx, yy - dest.cy), `level ${n}, height ${h}`).toBeGreaterThan(dest.r);
          }
        }
      }
    }
  });

  it('turns upright for the touchdown without spinning after an orbit or a loop', () => {
    for (const n of LEVELS) {
      const { upright } = routeFor(n);
      expect(Math.abs(rocketPose(0.999, n).angle - upright), `level ${n}`).toBeLessThan(8);
      expect(Math.abs(upright) % 360).toBe(0);
      // No jumps: the zig-zag's corners are sharp on purpose, every other shape turns gently.
      const limit = routeFor(n).kind === 'zigzag' ? 32 : 16;
      for (let i = 1; i <= 200; i++) expect(Math.abs(rocketPose(i / 200, n).angle - rocketPose((i - 1) / 200, n).angle), `level ${n}`).toBeLessThan(limit);
    }
  });
});

describe('level-up state machine', () => {
  const run = (levels: number) => {
    const phases: RocketPhase[] = [];
    let state = nextRocketPhase(ROCKET_IDLE, { type: 'start', levels });
    const targets: number[] = [];
    let total = 0;
    while (state.phase !== 'idle') {
      phases.push(state.phase);
      const timing = rocketTiming(state, 1);
      total += timing.delay + timing.duration;
      if (state.phase === 'launch') targets.push(launchTarget(state, 0.2));
      state = nextRocketPhase(state, { type: ROCKET_DONE_EVENT[state.phase as Exclude<RocketPhase, 'idle'>] });
    }
    return { phases, targets, total };
  };

  it('plays fly → land → handover → launch for one level, within 1.2 s', () => {
    const { phases, targets, total } = run(1);
    expect(phases).toEqual(['flying', 'landing', 'handover', 'launch']);
    expect(targets).toEqual([0.2]);
    expect(total).toBeLessThanOrEqual(1200);
  });

  it('repeats landings compressed for several levels, at most three, then goes to the final fill', () => {
    const two = run(2);
    expect(two.phases).toEqual(['flying', 'landing', 'handover', 'launch', 'landing', 'handover', 'launch']);
    expect(two.targets).toEqual([1, 0.2]);
    const many = run(12);
    expect(many.phases.filter((p) => p === 'landing')).toHaveLength(MAX_CYCLES);
    expect(many.targets).toEqual([1, 1, 0.2]);
    expect(many.total).toBeLessThanOrEqual(3 * 1200);
  });

  it('hands over to the next level, and on the last cycle straight to the final level', () => {
    const scenes: number[] = [];
    let state = nextRocketPhase(ROCKET_IDLE, { type: 'start', levels: 5 });
    let scene = 4;
    while (state.phase !== 'idle') {
      if (state.phase === 'handover') scenes.push((scene = handoverScene(state, scene, 9)));
      state = nextRocketPhase(state, { type: ROCKET_DONE_EVENT[state.phase as Exclude<RocketPhase, 'idle'>] });
    }
    expect(scenes).toEqual([5, 6, 9]);
  });

  it('ignores out-of-order events and a start without levels; abort returns to idle', () => {
    expect(nextRocketPhase(ROCKET_IDLE, { type: 'start', levels: 0 })).toBe(ROCKET_IDLE);
    expect(nextRocketPhase(ROCKET_IDLE, { type: 'landed' })).toBe(ROCKET_IDLE);
    const flying: RocketAnimationState = { phase: 'flying', cyclesLeft: 1, cycle: 0 };
    expect(nextRocketPhase(flying, { type: 'launched' })).toBe(flying);
    expect(nextRocketPhase(flying, { type: 'abort' })).toBe(ROCKET_IDLE);
  });

  it('flies a short remaining distance faster', () => {
    const flying: RocketAnimationState = { phase: 'flying', cyclesLeft: 1, cycle: 0 };
    expect(rocketTiming(flying, 0.1).duration).toBeLessThan(rocketTiming(flying, 1).duration);
  });
});

describe('rocket text', () => {
  const { text } = rocketTheme;
  const strings = [
    text.name,
    text.levelNoun,
    text.levelGenitive,
    ...text.levelForms,
    ...text.levelFormsOf,
    text.completed(3),
    text.fillLabel(45),
    text.hint,
  ];

  it('reads naturally in counts', () => {
    expect([1, 2, 5, 11, 21].map((n) => `${n} ${plural(n, text.levelForms)}`)).toEqual(['1 полёт', '2 полёта', '5 полётов', '11 полётов', '21 полёт']);
    expect([1, 3, 5, 21].map((n) => `из ${n} ${plural(n, text.levelFormsOf)}`)).toEqual(['из 1 полёта', 'из 3 полётов', 'из 5 полётов', 'из 21 полёта']);
    expect(`${text.levelNoun} 3`).toBe('Полёт 3');
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до полёта 4');
  });

  it('names completion and the fill', () => {
    expect(text.name).toBe('Ракета');
    expect(text.completed(3)).toBe('Полёт 3 завершён');
    expect(text.fillLabel(45)).toBe('Ракета пролетела 45% пути');
    expect(text.hint).toBe('Ракета летит от планеты к планете');
  });

  it('is free of forbidden words and exclamation marks', () => {
    for (const s of strings) {
      expect(s).not.toMatch(/просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i);
      expect(s).not.toContain('!');
    }
  });

  it('is available with the rocket key', () => {
    expect(rocketTheme.key).toBe('rocket');
    expect(rocketTheme.available).toBe(true);
  });
});
