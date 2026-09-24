import { describe, expect, it } from 'vitest';
import { DONE_EVENT, IDLE, MAX_CYCLES, nextPhase, phaseTiming, refillTarget, type AnimationState } from './flaskAnimation';

/** Runs the machine to idle, answering every phase with its done event. */
function play(levels: number): { phases: string[]; targets: number[] } {
  let state = nextPhase(IDLE, { type: 'start', levels });
  const phases: string[] = [];
  const targets: number[] = [];
  for (let guard = 0; state.phase !== 'idle' && guard < 50; guard++) {
    phases.push(state.cycle > 0 ? `${state.phase}*` : state.phase);
    if (state.phase === 'refilling') targets.push(refillTarget(state, 0.3));
    state = nextPhase(state, { type: DONE_EVENT[state.phase] } as never);
  }
  return { phases, targets };
}

describe('flask level-up state machine', () => {
  it('plays rise → overflow → drain → refill once for one flask', () => {
    expect(play(1)).toEqual({ phases: ['rising', 'overflow', 'draining', 'refilling'], targets: [0.3] });
  });

  it('repeats drain → refill compressed for more flasks, refilling to the brim in between', () => {
    expect(play(2)).toEqual({
      phases: ['rising', 'overflow', 'draining', 'refilling', 'draining*', 'refilling*'],
      targets: [1, 0.3],
    });
  });

  it('plays at most three cycles, then jumps to the final level', () => {
    const { phases, targets } = play(7);
    expect(phases.filter((p) => p.startsWith('draining'))).toHaveLength(MAX_CYCLES);
    expect(targets).toEqual([1, 1, 0.3]);
  });

  it('ignores out-of-order events and a start without levels', () => {
    const rising = nextPhase(IDLE, { type: 'start', levels: 1 });
    expect(nextPhase(rising, { type: 'drained' })).toBe(rising);
    expect(nextPhase(rising, { type: 'start', levels: 2 })).toBe(rising);
    expect(nextPhase(IDLE, { type: 'start', levels: 0 })).toBe(IDLE);
    expect(nextPhase(IDLE, { type: 'rose' })).toBe(IDLE);
  });

  it('aborts from any phase', () => {
    const states: AnimationState[] = [
      { phase: 'rising', cyclesLeft: 1, cycle: 0 },
      { phase: 'overflow', cyclesLeft: 2, cycle: 0 },
      { phase: 'draining', cyclesLeft: 1, cycle: 1 },
      { phase: 'refilling', cyclesLeft: 3, cycle: 0 },
    ];
    for (const state of states) expect(nextPhase(state, { type: 'abort' })).toEqual(IDLE);
  });

  it('compresses the timings of repeated cycles', () => {
    expect(phaseTiming({ phase: 'draining', cyclesLeft: 1, cycle: 0 })).toMatchObject({ delay: 350, duration: 380 });
    expect(phaseTiming({ phase: 'refilling', cyclesLeft: 1, cycle: 0 })).toMatchObject({ duration: 800 });
    expect(phaseTiming({ phase: 'draining', cyclesLeft: 1, cycle: 1 })).toMatchObject({ duration: 180 });
    expect(phaseTiming({ phase: 'refilling', cyclesLeft: 1, cycle: 2 })).toMatchObject({ duration: 320 });
  });
});
