// The level-up choreography of the flask as a pure state machine, so its order and the
// compressed repeats for multi-flask fills are unit-tested without a DOM:
//   idle → rising → overflow → draining → refilling → idle
// A fill of several flasks repeats draining → refilling (the flask in between fills to the
// brim again) with shorter timings, at most MAX_CYCLES times, then jumps to the final level.

export type Phase = 'idle' | 'rising' | 'overflow' | 'draining' | 'refilling';

export interface AnimationState {
  phase: Phase;
  /** Drain → refill cycles still to play, the current one included. */
  cyclesLeft: number;
  /** 0 for the first cycle, then 1, 2… — later cycles run compressed. */
  cycle: number;
}

export type AnimationEvent =
  | { type: 'start'; levels: number }
  | { type: 'rose' }
  | { type: 'overflowed' }
  | { type: 'drained' }
  | { type: 'refilled' }
  | { type: 'abort' };

export const MAX_CYCLES = 3;

export const IDLE: AnimationState = { phase: 'idle', cyclesLeft: 0, cycle: 0 };

/** The event that ends each running phase. */
export const DONE_EVENT: Record<Exclude<Phase, 'idle'>, AnimationEvent['type']> = {
  rising: 'rose',
  overflow: 'overflowed',
  draining: 'drained',
  refilling: 'refilled',
};

/** Unknown or out-of-order events leave the state unchanged; 'abort' always returns to idle. */
export function nextPhase(state: AnimationState, event: AnimationEvent): AnimationState {
  if (event.type === 'abort') return IDLE;
  switch (state.phase) {
    case 'idle':
      if (event.type !== 'start' || !(event.levels >= 1)) return state;
      return { phase: 'rising', cyclesLeft: Math.min(MAX_CYCLES, Math.floor(event.levels)), cycle: 0 };
    case 'rising':
      return event.type === 'rose' ? { ...state, phase: 'overflow' } : state;
    case 'overflow':
      return event.type === 'overflowed' ? { ...state, phase: 'draining' } : state;
    case 'draining':
      return event.type === 'drained' ? { ...state, phase: 'refilling' } : state;
    case 'refilling':
      if (event.type !== 'refilled') return state;
      return state.cyclesLeft > 1 ? { phase: 'draining', cyclesLeft: state.cyclesLeft - 1, cycle: state.cycle + 1 } : IDLE;
  }
}

/** Where the refill of this cycle ends: the brim while more flasks follow, `toFill` on the last. */
export function refillTarget(state: AnimationState, toFill: number): number {
  return state.cyclesLeft > 1 ? 1 : toFill;
}

export interface PhaseTiming {
  /** Pause before the phase starts, ms. */
  delay: number;
  duration: number;
  easing: 'spring' | 'in' | 'out';
}

/** Timings from the spec: rise 700, overflow 500, drain 380 after a 350 pause, refill 800; repeats 180/320. */
export function phaseTiming(state: AnimationState): PhaseTiming {
  const compressed = state.cycle > 0;
  switch (state.phase) {
    case 'rising':
      return { delay: 0, duration: 700, easing: 'spring' };
    case 'overflow':
      return { delay: 0, duration: 500, easing: 'out' };
    case 'draining':
      return compressed ? { delay: 60, duration: 180, easing: 'in' } : { delay: 350, duration: 380, easing: 'in' };
    case 'refilling':
      return compressed ? { delay: 0, duration: 320, easing: 'out' } : { delay: 0, duration: 800, easing: 'spring' };
    case 'idle':
      return { delay: 0, duration: 0, easing: 'out' };
  }
}

/** A `finished` promise that never settles (old WebViews) must not stall the choreography. */
export const FINISH_FALLBACK_MS = 450;
