import { createContext, useContext, type MutableRefObject } from 'react';
import type { StepDefinition } from '../../domain/types';
import type { TimerView } from '../../services/timer';

// What the step rows know of the live timer (package 15): whose timer runs, and the ▶. Its own
// module so that TimerLayer (first paint) and the lazy TimerHost both import it without the
// lazy chunk importing the module that loads it.

export interface TimerApi {
  /** The action whose timer runs or is paused; null without a timer. */
  stepId: string | null;
  /**
   * The ▶ of a TIMED action: starts its timer; opens the timer when it is this action's; asks
   * «Остановить таймер …?» first when another action's timer runs. Call it inside the tap.
   */
  start(step: StepDefinition): void;
}

/** What TimerLayer hands to the lazy host for the cases the host handles. */
export interface TimerHostHandle {
  /** Opens the sheet «Таймер». */
  open(): void;
  /** Finish the running timer (asked first), then start `step`'s. */
  replaceWith(step: StepDefinition): void;
}

export interface TimerHostProps {
  /** The stored timer with its action and skill; null without one. */
  view: TimerView | null;
  /** The host fills it in; the step rows' ▶ goes through it while a timer exists. */
  handle: MutableRefObject<TimerHostHandle | null>;
}

export const TimerContext = createContext<TimerApi>({ stepId: null, start: () => {} });

export const useTimer = () => useContext(TimerContext);
