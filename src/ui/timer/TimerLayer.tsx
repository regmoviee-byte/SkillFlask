import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { StepDefinition } from '../../domain/types';
import { getTimerView, startTimer, TimerRunningError } from '../../services/timer';
import { haptics } from '../../platform/haptics';
import { errorMessage } from '../completionFeedback';
import { showToast, useToast } from '../components/Toast';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';
import { TimerContext, type TimerApi, type TimerHostHandle, type TimerHostProps } from './context';

// The live timer (v0.5 package 15) in the first paint: a live query of the settings row (every
// tab and every reopening follows it) and the ▶ of the step rows. Everything a running timer
// shows — the pill above the tab bar, the sheet «Таймер», the finish flow — is the lazy
// TimerHost, loaded with the first timer and kept for the session, so a sheet that finishes a
// timer is not unmounted when the timer it records disappears.

/** The host's chunk did not load: the timer stays stored, the user is told once how to get it back. */
function TimerUnavailable(_props: TimerHostProps) {
  useEffect(() => showToast(copy.errors.timerChunk), []);
  return null;
}

const TimerHost = lazySafe<ComponentType<TimerHostProps>>(() => import('./TimerHost'), 'TimerHost', TimerUnavailable);

export function TimerLayer({ children }: { children: ReactNode }) {
  const view = useLiveQuery(getTimerView, []);
  const handle = useRef<TimerHostHandle | null>(null);
  const [hosted, setHosted] = useState(false);
  if (view && !hosted) setHosted(true);
  const { showToast: toast } = useToast();
  const current = useRef(view);
  current.current = view;

  const start = useCallback(
    (step: StepDefinition) => {
      const running = current.current;
      if (running) {
        if (running.timer.stepId === step.id) handle.current?.open();
        else handle.current?.replaceWith(step);
        return;
      }
      haptics.tap();
      // Another tab may have started one meanwhile: the live query shows it in a moment.
      startTimer(step.id).catch((error: unknown) => {
        if (!(error instanceof TimerRunningError)) toast(errorMessage(error));
      });
    },
    [toast],
  );

  const stepId = view?.timer.stepId ?? null;
  const api = useMemo<TimerApi>(() => ({ stepId, start }), [stepId, start]);

  return (
    <TimerContext.Provider value={api}>
      {children}
      {hosted && (
        <Suspense fallback={null}>
          <TimerHost view={view ?? null} handle={handle} />
        </Suspense>
      )}
    </TimerContext.Provider>
  );
}
