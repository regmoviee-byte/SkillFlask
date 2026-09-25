import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillDetails } from '../../services/queries';
import { completeStep } from '../../services/completions';
import { localDate } from '../../lib/dates';
import { MAX_MINUTES, timedPoints } from '../../domain/points';
import { haptics } from '../../platform/haptics';
import { useCelebrations } from '../celebrations/CelebrationProvider';
import { announceCompletion, errorMessage } from '../completionFeedback';
import { EmptyState } from '../components/EmptyState';
import { copyForSkill } from '../progress/registry';
import { Screen, useGoBack } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { Stepper } from '../components/Stepper';
import { stepValue } from '../components/StepRow';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { useToday } from '../hooks/useToday';
import { minutePresets } from '../sheets/MinutesSheet';

export function AddActionScreen() {
  const { skillId = '' } = useParams();
  const [params] = useSearchParams();
  const today = useToday();
  const details = useLiveQuery(() => getSkillDetails(skillId, today), [skillId, today]);
  // A step just created from this screen arrives pre-selected via ?step=.
  const [selected, setSelected] = useState<string | null>(() => params.get('step'));
  const [date, setDate] = useState(localDate);
  // Minutes of a TIMED step; picking a step starts from its usual minutes.
  const [minutes, setMinutes] = useState<{ stepId: string | null; value: number | null }>({ stepId: null, value: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const { celebrateResult } = useCelebrations();
  const navigate = useNavigate();
  const goBack = useGoBack(`/skills/${skillId}`);
  const back = `/skills/${skillId}`;
  const t = copy.addAction;

  // One Screen for every state, so the skeleton stays mounted until the data replaces it.
  const loading = details === undefined;
  const available = details !== undefined && details !== null && details.skill.status === 'ACTIVE';
  const steps = available ? details.steps : [];
  // The query string is untrusted: only a step of this skill can be submitted.
  const selectedStep = steps.find((step) => step.id === selected);
  const timed = selectedStep?.type === 'TIMED';
  const typedMinutes = minutes.stepId === selectedStep?.id ? minutes.value : (selectedStep?.defaultMinutes ?? null);
  const validMinutes = typedMinutes !== null && typedMinutes >= 1 && typedMinutes <= MAX_MINUTES ? typedMinutes : null;
  // The step form replaces this entry and, on success, replaces itself with this screen again
  // (step pre-selected), so history never holds two "add" entries.
  const createNew = () => navigate(`/steps/new?skill=${skillId}&from=add`, { replace: true });

  async function submit() {
    if (!selectedStep) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeStep(selectedStep.id, { date, minutes: timed ? (validMinutes ?? undefined) : undefined });
      // The toast carries «Отменить» and outlives the navigation back to the skill; a filled
      // flask is told on the skill's hero once it is back on screen (the pill «Колба N»), by the
      // TopCard when it is not (the flask itself is not on this screen).
      announceCompletion(result, selectedStep.name, showToast, copyForSkill(details?.skill ?? {}));
      void celebrateResult(result, { skillId, flaskRef: null, afterNavigation: true });
      goBack();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t.title}
      back={back}
      primary={
        steps.length > 0
          ? {
              text: !timed ? t.submit : validMinutes === null ? t.submitNoMinutes : t.submitTimed(validMinutes, timedPoints(validMinutes, selectedStep!.pointsPerMinute ?? 0)),
              onClick: submit,
              disabled: !selectedStep || (timed && validMinutes === null),
              loading: busy,
            }
          : undefined
      }
      // 'bottom': stacked under the MainButton as in the HTML footer; side by side both labels truncate.
      secondary={available ? { text: t.createNew, onClick: createNew, disabled: busy, position: 'bottom' } : undefined}
    >
      <Skeleton layout="form" loading={loading}>
        {!available ? (
          <p className="hint center">{t.unavailable}</p>
        ) : (
          <>
            <p className="hint center skill-subtitle">{details.skill.name}</p>

            {steps.length === 0 ? (
              <EmptyState illustration="steps" title={t.emptyTitle} text={t.emptyHint} />
            ) : (
              <ul className="card list" role="radiogroup" aria-label={t.stepGroup}>
                {steps.map((step) => (
                  <li key={step.id}>
                    <label className="radio-row">
                      <input
                        type="radio"
                        name="step"
                        value={step.id}
                        checked={selected === step.id}
                        onChange={() => {
                          haptics.select();
                          setSelected(step.id);
                        }}
                      />
                      <span className="radio-mark" aria-hidden="true" />
                      <span className="radio-label">{step.name}</span>
                      <span className="radio-value">{step.type === 'TIMED' ? stepValue(step) : t.stepPoints(step.points)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {steps.length > 0 && (
              // One column: a lone .field would stretch to the screen's height (flex: 1).
              <div className="form">
                <label className="field">
                  <span className="field-label">{t.when}</span>
                  <input type="date" className="input" value={date} max={localDate()} onChange={(e) => setDate(e.target.value || localDate())} />
                </label>

                {timed && selectedStep && (
                  <Stepper
                    key={selectedStep.id}
                    label={t.duration}
                    value={typedMinutes}
                    onChange={(value) => setMinutes({ stepId: selectedStep.id, value })}
                    min={1}
                    max={MAX_MINUTES}
                    step={5}
                    presets={minutePresets(selectedStep.defaultMinutes)}
                    unit={copy.minutes.unit}
                    optional
                  />
                )}
              </div>
            )}

            {error && <p className="error">{error}</p>}
          </>
        )}
      </Skeleton>
    </Screen>
  );
}
