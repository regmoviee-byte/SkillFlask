import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillDetails } from '../../services/queries';
import { completeStep } from '../../services/skills';
import { localDate } from '../../lib/dates';
import { haptic } from '../../telegram';
import { Screen, useGoBack } from '../components/Screen';
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
  const goBack = useGoBack(`/skills/${skillId}`);
  const back = `/skills/${skillId}`;
  const t = copy.addAction;

  if (details === undefined) return <Screen title={t.title} back={back}>{null}</Screen>;
  if (details === null || details.skill.status !== 'ACTIVE') {
    return (
      <Screen title={t.title} back={back}>
        <p className="hint center">{t.unavailable}</p>
      </Screen>
    );
  }

  const createLink = `/steps/new?skill=${skillId}`;
  // The query string is untrusted: only a step of this skill can be submitted.
  const selectedStep = details.steps.find((step) => step.id === selected);

  async function submit() {
    if (!selectedStep) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeStep(selectedStep.id, { date });
      haptic('success');
      showToast(
        result.milestoneReached
          ? copy.toast.milestoneReached(result.pointsAwarded)
          : result.levelChange > 0
            ? copy.toast.flaskFilled(result.pointsAwarded, result.after.currentFlask, result.levelChange)
            : copy.toast.pointsAdded(result.pointsAwarded),
      );
      goBack();
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : copy.errors.save);
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t.title}
      back={back}
      footer={
        details.steps.length > 0 && (
          <button type="button" className="button button-primary button-block" disabled={!selectedStep || busy} onClick={submit}>
            {t.submit}
          </button>
        )
      }
    >
      <p className="hint center skill-subtitle">{details.skill.name}</p>

      {details.steps.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{t.emptyTitle}</p>
          <p className="hint">{t.emptyHint}</p>
        </div>
      ) : (
        <ul className="card list" role="radiogroup" aria-label={t.stepGroup}>
          {details.steps.map((step) => (
            <li key={step.id}>
              <label className="radio-row">
                <input
                  type="radio"
                  name="step"
                  value={step.id}
                  checked={selected === step.id}
                  onChange={() => setSelected(step.id)}
                />
                <span className="radio-mark" aria-hidden="true" />
                <span className="radio-label">{step.name}</span>
                <span className="radio-value">{t.stepPoints(step.points)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {details.steps.length > 0 && (
        <label className="field">
          <span className="field-label">{t.when}</span>
          <input type="date" className="input" value={date} max={localDate()} onChange={(e) => setDate(e.target.value || localDate())} />
        </label>
      )}

      {error && <p className="error">{error}</p>}

      {/* The form replaces this entry and, on success, replaces itself with this screen again
          (step pre-selected), so history never holds two "add" entries. */}
      <Link to={createLink} className="button button-block button-secondary" replace>
        {t.createNew}
      </Link>
    </Screen>
  );
}
