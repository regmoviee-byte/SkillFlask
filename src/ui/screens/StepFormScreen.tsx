import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { listSkillSummaries } from '../../services/queries';
import { createStep, ValidationError } from '../../services/skills';
import { haptic } from '../../telegram';
import { Screen, useGoBack } from '../components/Screen';
import { useToast } from '../components/Toast';

// A step created from the "Добавить действие" screen becomes pre-selected when the user returns there.
let pendingStepSelection: string | null = null;

export function peekPendingStepSelection(): string | null {
  return pendingStepSelection;
}

export function clearPendingStepSelection(): void {
  pendingStepSelection = null;
}

export function StepFormScreen() {
  const [params] = useSearchParams();
  const origin = params.get('skill') ?? '';
  const skills = useLiveQuery(async () => (await listSkillSummaries()).filter((s) => s.skill.status === 'ACTIVE'));
  const [skillId, setSkillId] = useState(origin);
  const [name, setName] = useState('');
  const [points, setPoints] = useState('5');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const goBack = useGoBack(origin ? `/skills/${origin}/add` : '/skills');
  const { showToast } = useToast();

  const effectiveSkillId = skillId || skills?.[0]?.skill.id || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await createStep({ skillId: effectiveSkillId, name, points: Number(points.trim()) });
      pendingStepSelection = id;
      showToast('Действие создано');
      if (effectiveSkillId === origin) goBack();
      else navigate(`/skills/${effectiveSkillId}/add`, { replace: true });
    } catch (e) {
      haptic('error');
      setError(e instanceof ValidationError ? e.message : 'Не удалось сохранить');
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Новое действие"
      back={origin ? `/skills/${origin}/add` : '/skills'}
      footer={
        <button type="submit" form="step-form" className="button button-primary button-block" disabled={busy || !effectiveSkillId}>
          Создать действие
        </button>
      }
    >
      <form id="step-form" className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Название</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, разговорная практика"
            maxLength={100}
            autoFocus
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Навык, к которому относится действие</span>
          <select className="input" value={effectiveSkillId} onChange={(e) => setSkillId(e.target.value)} required>
            {skills?.map(({ skill }) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label">Тип</span>
          <div className="segmented">
            <button type="button" className="active" aria-pressed="true">
              Выполнено / нет
            </button>
            <button type="button" disabled title="Скоро">
              По времени · скоро
            </button>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Повтор</span>
          <select className="input" value="MANUAL" onChange={() => {}}>
            <option value="MANUAL">Без расписания — отмечаю вручную</option>
            <option disabled>Каждый день · скоро</option>
            <option disabled>По дням недели · скоро</option>
            <option disabled>N раз в неделю · скоро</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">Количество баллов</span>
          <input
            className="input"
            inputMode="numeric"
            pattern="[0-9]*"
            value={points}
            onChange={(e) => setPoints(e.target.value.replace(/\D/g, ''))}
            required
          />
        </label>

        {error && <p className="error">{error}</p>}
      </form>
    </Screen>
  );
}
