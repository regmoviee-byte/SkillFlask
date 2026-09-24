import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { listSkillSummaries } from '../../services/queries';
import { createStep, ValidationError } from '../../services/skills';
import { useUnsavedGuard } from '../../platform/buttons';
import { haptics } from '../../platform/haptics';
import { Screen } from '../components/Screen';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

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
  const { showToast } = useToast();
  const t = copy.stepForm;
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedGuard(!busy && name.trim() !== '');

  const effectiveSkillId = skillId || skills?.[0]?.skill.id || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await createStep({ skillId: effectiveSkillId, name, points: Number(points.trim()) });
      haptics.success();
      showToast(t.created);
      // This screen replaced the "Добавить действие" entry; replace it back with the new step
      // pre-selected via the query string, so the selection survives reloads and does not
      // live in module state.
      navigate(`/skills/${effectiveSkillId}/add?step=${id}`, { replace: true });
    } catch (e) {
      haptics.error();
      setError(e instanceof ValidationError ? e.message : copy.errors.save);
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t.title}
      back={origin ? `/skills/${origin}/add` : '/skills'}
      replaceBack={origin !== ''}
      primary={{ text: t.submit, onClick: () => formRef.current?.requestSubmit(), disabled: !effectiveSkillId, loading: busy }}
    >
      <form id="step-form" className="form" ref={formRef} onSubmit={submit}>
        <label className="field">
          <span className="field-label">{t.name}</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            maxLength={100}
            autoFocus
            required
          />
        </label>

        <label className="field">
          <span className="field-label">{t.skill}</span>
          <select className="input" value={effectiveSkillId} onChange={(e) => setSkillId(e.target.value)} required>
            {skills?.map(({ skill }) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label">{t.type}</span>
          <div className="segmented">
            <button type="button" className="active" aria-pressed="true" onClick={() => haptics.select()}>
              {t.typeBoolean}
            </button>
            <button type="button" disabled title={copy.common.soon}>
              {t.typeTimedSoon}
            </button>
          </div>
        </div>

        <label className="field">
          <span className="field-label">{t.repeat}</span>
          <select className="input" value="MANUAL" onChange={() => {}}>
            <option value="MANUAL">{t.repeatManual}</option>
            <option disabled>{t.repeatDailySoon}</option>
            <option disabled>{t.repeatWeekdaysSoon}</option>
            <option disabled>{t.repeatTimesPerWeekSoon}</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">{t.points}</span>
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
