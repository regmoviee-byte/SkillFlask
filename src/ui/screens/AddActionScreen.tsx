import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillDetails } from '../../services/queries';
import { completeStep } from '../../services/skills';
import { localDate } from '../../lib/dates';
import { formatPoints } from '../../lib/format';
import { haptic } from '../../telegram';
import { Screen, useGoBack } from '../components/Screen';
import { useToast } from '../components/Toast';
import { clearPendingStepSelection, peekPendingStepSelection } from './StepFormScreen';

export function AddActionScreen() {
  const { skillId = '' } = useParams();
  const details = useLiveQuery(() => getSkillDetails(skillId), [skillId]);
  const [selected, setSelected] = useState<string | null>(peekPendingStepSelection);
  useEffect(clearPendingStepSelection, []);
  const [date, setDate] = useState(localDate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const goBack = useGoBack(`/skills/${skillId}`);
  const back = `/skills/${skillId}`;

  if (details === undefined) return <Screen title="Добавить действие" back={back}>{null}</Screen>;
  if (details === null || details.skill.status !== 'ACTIVE') {
    return (
      <Screen title="Добавить действие" back={back}>
        <p className="hint center">Навык недоступен для новых действий</p>
      </Screen>
    );
  }

  const createLink = `/steps/new?skill=${skillId}`;

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeStep(selected, date);
      const levels = result.after.completedFlasks - result.before.completedFlasks;
      haptic('success');
      showToast(
        result.milestoneReached
          ? `+${result.pointsAwarded} · Веха достигнута! 🎯`
          : levels > 0
            ? `+${result.pointsAwarded} · Колба заполнена! Уровень ${result.after.currentFlask}`
            : `+${formatPoints(result.pointsAwarded)}`,
      );
      goBack();
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Добавить действие"
      back={back}
      footer={
        details.steps.length > 0 && (
          <button type="button" className="button button-primary button-block" disabled={!selected || busy} onClick={submit}>
            Отметить выполненным
          </button>
        )
      }
    >
      <p className="hint center skill-subtitle">{details.skill.name}</p>

      {details.steps.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Действий пока нет</p>
          <p className="hint">Создайте действие — например, «Разговорная практика» на 5 очков.</p>
        </div>
      ) : (
        <ul className="card list" role="radiogroup" aria-label="Действие">
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
                <span className="radio-value">+{formatPoints(step.points)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {details.steps.length > 0 && (
        <label className="field">
          <span className="field-label">Когда выполнено</span>
          <input type="date" className="input" value={date} max={localDate()} onChange={(e) => setDate(e.target.value || localDate())} />
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <Link to={createLink} className="button button-block button-secondary">
        Создать новое действие
      </Link>
    </Screen>
  );
}
