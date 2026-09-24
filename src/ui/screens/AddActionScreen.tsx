import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillDetails } from '../../services/queries';
import { completeStep } from '../../services/skills';
import { localDate } from '../../lib/dates';
import { haptics } from '../../platform/haptics';
import { EmptyState } from '../components/EmptyState';
import { Screen, useGoBack } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

export function AddActionScreen() {
  const { skillId = '' } = useParams();
  const [params] = useSearchParams();
  const details = useLiveQuery(() => getSkillDetails(skillId), [skillId]);
  // A step just created from this screen arrives pre-selected via ?step=.
  const [selected, setSelected] = useState<string | null>(() => params.get('step'));
  const [date, setDate] = useState(localDate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
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
  // The step form replaces this entry and, on success, replaces itself with this screen again
  // (step pre-selected), so history never holds two "add" entries.
  const createNew = () => navigate(`/steps/new?skill=${skillId}`, { replace: true });

  async function submit() {
    if (!selectedStep) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeStep(selectedStep.id, { date });
      if (result.milestoneReached) haptics.milestone();
      else if (result.levelChange > 0) haptics.levelUp(result.levelChange);
      else haptics.success();
      showToast(
        result.milestoneReached
          ? copy.toast.milestoneReached(result.pointsAwarded)
          : result.levelChange > 0
            ? copy.toast.flaskFilled(result.pointsAwarded, result.after.currentFlask, result.levelChange)
            : copy.toast.pointsAdded(result.pointsAwarded),
      );
      goBack();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : copy.errors.save);
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t.title}
      back={back}
      primary={steps.length > 0 ? { text: t.submit, onClick: submit, disabled: !selectedStep, loading: busy } : undefined}
      secondary={available ? { text: t.createNew, onClick: createNew, disabled: busy } : undefined}
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
                      <span className="radio-value">{t.stepPoints(step.points)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {steps.length > 0 && (
              <label className="field">
                <span className="field-label">{t.when}</span>
                <input type="date" className="input" value={date} max={localDate()} onChange={(e) => setDate(e.target.value || localDate())} />
              </label>
            )}

            {error && <p className="error">{error}</p>}
          </>
        )}
      </Skeleton>
    </Screen>
  );
}
