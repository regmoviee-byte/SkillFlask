import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import {
  arriveSplit,
  arriveTarget,
  biteCircles,
  CAPTION_LINE,
  captionPad,
  captionYs,
  eatingSchedule,
  MARK_GAP,
  MARK_SWEEP,
  markAngles,
  markPoint,
  nextPizzaPhase,
  PIZZA_DONE_EVENT,
  PIZZA_IDLE,
  PIZZA_MAX_CYCLES,
  pizzaPhaseTiming,
  pizzaStage,
  pizzaTheme,
  polar,
  sectorPath,
  shortLabel,
  SLICES,
  type PizzaAnimationState,
} from './pizza';

const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

describe('pizza stage', () => {
  it('derives the slices gone and the bite from the fill', () => {
    expect(pizzaStage(0)).toEqual({ gone: 0, bite: 0 });
    expect(pizzaStage(0.25)).toEqual({ gone: 2, bite: 0 });
    expect(pizzaStage(0.5)).toEqual({ gone: 4, bite: 0 });
    expect(pizzaStage(0.75)).toEqual({ gone: 6, bite: 0 });
    const almost = pizzaStage(0.999);
    expect(almost.gone).toBe(7);
    expect(almost.bite).toBeCloseTo(0.992, 3);
    expect(pizzaStage(1)).toEqual({ gone: SLICES, bite: 0 });
  });

  it('clamps out-of-range and non-finite fills', () => {
    expect(pizzaStage(-1)).toEqual({ gone: 0, bite: 0 });
    expect(pizzaStage(2)).toEqual({ gone: SLICES, bite: 0 });
    expect(pizzaStage(Number.NaN)).toEqual({ gone: 0, bite: 0 });
  });

  it('bites grow from the tip towards the crust and leave the crust arc at the end', () => {
    expect(biteCircles(0, 0)).toEqual([]);
    const inside = (circles: [number, number, number][], p: { x: number; y: number }) => circles.some(([x, y, r]) => Math.hypot(x - p.x, y - p.y) < r);
    const small = biteCircles(0, 0.1);
    const large = biteCircles(0, 1);
    expect(small).toHaveLength(4);
    // The tip (the pizza centre) goes with the first bite.
    expect(inside(small, polar(22.5, 2))).toBe(true);
    // A small bite leaves the middle of the slice, a large one takes the cheese there.
    expect(inside(small, polar(22.5, 30))).toBe(false);
    expect(inside(large, polar(22.5, 30))).toBe(true);
    // The crust (radius 52..56) stays until the level is done.
    expect(inside(large, polar(22.5, 53))).toBe(false);
    expect(inside(large, polar(10, 53))).toBe(false);
    expect(small[0]![2]).toBeLessThan(large[0]![2]);
  });

  it('draws sectors clockwise from 12 o’clock and a full circle at 360', () => {
    expect(sectorPath(0, 0, 10)).toBe('');
    expect(sectorPath(0, 360, 10)).toMatch(/^M80 80A10 10 0 1 1 80 100A10 10 0 1 1 80 80Z$/);
    expect(sectorPath(0, 90, 10)).toBe('M80 90L80 80A10 10 0 0 1 90 90Z');
    expect(sectorPath(0, 270, 10)).toMatch(/A10 10 0 1 1 /);
    const right = polar(90, 10);
    expect(right.x).toBeCloseTo(90);
    expect(right.y).toBeCloseTo(90);
  });
});

describe('pizza marks', () => {
  it('places marks on the rim, clockwise and inside the box', () => {
    let previousAngle = -1;
    for (let h = 0; h <= 1; h += 0.05) {
      const { x, y } = markPoint(h);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(160);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(260);
      expect(Math.hypot(x - 80, y - 90)).toBeCloseTo(61, 0);
      // Clockwise from 12 o'clock: the angle grows monotonically (and never wraps past MARK_SWEEP).
      const angle = (Math.atan2(x - 80, 90 - y) + 2 * Math.PI) % (2 * Math.PI);
      expect(angle).toBeGreaterThan(previousAngle - 1e-9);
      previousAngle = angle;
    }
    expect(markPoint(0)).toEqual({ x: 80, y: 29 });
    expect(markPoint(0.5).x).toBeGreaterThan(80);
    expect(pizzaTheme.markPoint).toBe(markPoint);
  });

  it('keeps the start and the end of the level apart', () => {
    const start = markPoint(0);
    const end = markPoint(1);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(20);
    expect(end.x).toBeLessThan(start.x);
  });

  it('nudges pennants that sit close together, keeping their order around the rim', () => {
    expect(markAngles([])).toEqual([]);
    expect(markAngles([0.5])).toEqual([MARK_SWEEP / 2]);
    // Oldest-first input order is kept in the output.
    expect(markAngles([0.06, 0.05, 0.5])).toEqual([17 + MARK_GAP, 17, 170]);
    expect(markAngles([0, 1])).toEqual([0, MARK_SWEEP]);
    expect(markAngles([0.99, 1])).toEqual([MARK_SWEEP - MARK_GAP, MARK_SWEEP]);
    const crowd = markAngles(Array.from({ length: 30 }, () => 0.5));
    for (let i = 1; i < crowd.length; i++) expect(crowd[i]! - crowd[i - 1]!).toBeGreaterThan(0);
    expect(Math.min(...crowd)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...crowd)).toBeLessThanOrEqual(MARK_SWEEP);
  });

  it('shortens captions to 12 characters', () => {
    expect(shortLabel('Пробный тест')).toBe('Пробный тест');
    expect(shortLabel('Длинное название засечки')).toBe('Длинное наз…');
  });

  it('spreads captions under the plate and grows the tap area when there is room', () => {
    expect(captionYs(0)).toEqual([]);
    expect(captionYs(1)).toEqual([193]);
    expect(captionYs(4)).toEqual([193, 211, 229, 247]);
    // Alone: a 44 px tap area.
    expect(CAPTION_LINE + 2 * captionPad(captionYs(1), 0)).toBe(44);
    expect(captionPad(captionYs(2), 0)).toBe(14.5);
  });

  it('never lets caption tap areas overlap or leave the 228 px hero box', () => {
    const scale = 140 / 160;
    for (let count = 1; count <= 4; count++) {
      const ys = captionYs(count);
      const boxes = ys.map((y, i) => {
        const half = CAPTION_LINE / 2 + captionPad(ys, i);
        return [y * scale - half, y * scale + half] as const;
      });
      for (let i = 0; i < boxes.length; i++) {
        // Under the ruler (y 178, its numbers reach about 184) and inside the box.
        expect(ys[i]! * scale - CAPTION_LINE / 2).toBeGreaterThan(183 * scale);
        expect(boxes[i]![1]).toBeLessThanOrEqual(228);
        if (i > 0) expect(boxes[i]![0]).toBeGreaterThanOrEqual(boxes[i - 1]![1] - 1e-9);
      }
    }
  });
});

describe('pizza text', () => {
  const { text } = pizzaTheme;

  it('names the level in every form', () => {
    expect(text.name).toBe('Пицца');
    expect(text.levelNoun).toBe('Пицца');
    expect(text.levelGenitive).toBe('пиццы');
    expect(`1 ${plural(1, text.levelForms)}`).toBe('1 пицца');
    expect(`2 ${plural(2, text.levelForms)}`).toBe('2 пиццы');
    expect(`5 ${plural(5, text.levelForms)}`).toBe('5 пицц');
    expect(`11 ${plural(11, text.levelForms)}`).toBe('11 пицц');
    expect(`21 ${plural(21, text.levelForms)}`).toBe('21 пицца');
    expect(`из 1 ${plural(1, text.levelFormsOf)}`).toBe('из 1 пиццы');
    expect(`из 3 ${plural(3, text.levelFormsOf)}`).toBe('из 3 пицц');
    expect(`из 21 ${plural(21, text.levelFormsOf)}`).toBe('из 21 пиццы');
    expect(text.completed(3)).toBe('Пицца 3 съедена');
    expect(text.fillLabel(45)).toBe('Пицца съедена на 45%');
    expect(text.hint).toBe('Кусочки съедаются один за другим');
  });

  it('keeps the tone: no forbidden words, no exclamation marks', () => {
    const strings = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.completed(3), text.fillLabel(45), text.hint];
    expect(strings.filter((s) => FORBIDDEN.test(s) || s.includes('!'))).toEqual([]);
  });

  it('is registered under its key and available', () => {
    expect(pizzaTheme.key).toBe('pizza');
    expect(pizzaTheme.available).toBe(true);
  });
});

/** Runs the machine to idle, answering every phase with its done event. */
function play(levels: number): { phases: string[]; targets: number[] } {
  let state = nextPizzaPhase(PIZZA_IDLE, { type: 'start', levels });
  const phases: string[] = [];
  const targets: number[] = [];
  for (let guard = 0; state.phase !== 'idle' && guard < 50; guard++) {
    phases.push(state.cycle > 0 ? `${state.phase}*` : state.phase);
    if (state.phase === 'arrive') targets.push(arriveTarget(state, 0.3));
    state = nextPizzaPhase(state, { type: PIZZA_DONE_EVENT[state.phase] } as never);
  }
  return { phases, targets };
}

describe('pizza level-up state machine', () => {
  it('plays eating → beat → away → arrive once for one pizza', () => {
    expect(play(1)).toEqual({ phases: ['eating', 'beat', 'away', 'arrive'], targets: [0.3] });
  });

  it('repeats the cycle compressed for more pizzas, the one in between arriving whole', () => {
    expect(play(2)).toEqual({
      phases: ['eating', 'beat', 'away', 'arrive', 'eating*', 'beat*', 'away*', 'arrive*'],
      targets: [0, 0.3],
    });
  });

  it('plays at most three cycles, then the last pizza arrives at the final fill', () => {
    const { phases, targets } = play(7);
    expect(phases.filter((p) => p.startsWith('beat'))).toHaveLength(PIZZA_MAX_CYCLES);
    expect(targets).toEqual([0, 0, 0.3]);
  });

  it('ignores out-of-order events and a start without levels; abort returns to idle', () => {
    const eating = nextPizzaPhase(PIZZA_IDLE, { type: 'start', levels: 1 });
    expect(nextPizzaPhase(eating, { type: 'gone' })).toBe(eating);
    expect(nextPizzaPhase(eating, { type: 'start', levels: 2 })).toBe(eating);
    expect(nextPizzaPhase(PIZZA_IDLE, { type: 'start', levels: 0 })).toBe(PIZZA_IDLE);
    expect(nextPizzaPhase(PIZZA_IDLE, { type: 'ate' })).toBe(PIZZA_IDLE);
    expect(nextPizzaPhase(eating, { type: 'abort' })).toBe(PIZZA_IDLE);
  });

  it('keeps one level within the budget and compresses the repeats', () => {
    const total = (cycle: number) =>
      (['eating', 'beat', 'away', 'arrive'] as const).reduce((sum, phase) => {
        const t = pizzaPhaseTiming({ phase, cyclesLeft: 1, cycle } as PizzaAnimationState);
        return sum + t.delay + t.duration;
      }, 0);
    expect(total(0)).toBeLessThanOrEqual(1200);
    expect(total(1)).toBeLessThanOrEqual(700);
    // Three compressed cycles for any number of levels: the whole write stays under 2.6 s.
    expect(total(0) + 2 * total(1)).toBeLessThanOrEqual(2600);
    expect(total(1)).toBeLessThan(total(0));
    expect(pizzaPhaseTiming(PIZZA_IDLE)).toEqual({ delay: 0, duration: 0, easing: 'out' });
  });

  it('serves the new pizza whole, then eats it down to its fill', () => {
    expect(arriveSplit(0, 480)).toEqual({ slide: 480, eat: 0, fade: 0 });
    // Under one slice: the bite fades in after the slide instead of popping.
    expect(arriveSplit(0.1, 480)).toEqual({ slide: 380, eat: 0, fade: 100 });
    expect(arriveSplit(0.1, 260)).toEqual({ slide: 182, eat: 0, fade: 78 });
    expect(arriveSplit(0.2, 480)).toEqual({ slide: 288, eat: 125, fade: 67 });
    expect(arriveSplit(0.25, 480)).toEqual({ slide: 288, eat: 192, fade: 0 });
    for (const fill of [0, 0.05, 0.2, 0.6, 0.999]) {
      for (const duration of [260, 480]) {
        const { slide, eat, fade } = arriveSplit(fill, duration);
        expect(slide + eat + fade).toBe(duration);
      }
    }
  });

  it('eases the arrival out without a spring (the plate stays clear of the stage clip)', () => {
    for (const cycle of [0, 1]) expect(pizzaPhaseTiming({ phase: 'arrive', cyclesLeft: 1, cycle }).easing).toBe('out');
  });

  it('schedules the remaining slices one after another inside the phase', () => {
    expect(eatingSchedule(8, 640)).toEqual([]);
    expect(eatingSchedule(7, 300)).toEqual([[0, 210]]);
    expect(eatingSchedule(0, 190, 1)).toEqual([[0, 133]]);
    expect(eatingSchedule(0, 190, 3)).toHaveLength(3);
    const all = eatingSchedule(0, 380);
    expect(eatingSchedule(0, 380, 8)).toEqual(all);
    expect(all).toHaveLength(8);
    expect(all[0]![0]).toBe(0);
    for (let i = 1; i < all.length; i++) expect(all[i]![0]).toBeGreaterThan(all[i - 1]![0]);
    const last = all[all.length - 1]!;
    expect(last[0] + last[1]).toBeLessThanOrEqual(381);
  });
});
