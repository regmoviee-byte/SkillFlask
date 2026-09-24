import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillFormData, listSkillSummaries } from '../../services/queries';
import { createStep, getStep, setStepActive, updateStep } from '../../services/steps';
import type { StepDefinition } from '../../domain/types';
import { flaskCapacity, pointsToFill } from '../../domain/progression';
import { useUnsavedGuard } from '../../platform/buttons';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { errorMessage } from '../completionFeedback';
import { Screen, useGoBack } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

const t = copy.stepForm;
const DEFAULT_POINTS = '5';

const digitsOnly = (value: string) => value.replace(/\D/g, '');

/** `/steps/new` (prefills ?skill, ?name, ?points; ?from=add returns to «Задним числом») and `/steps/:stepId/edit`. */
export function StepFormScreen() {
  const { stepId } = useParams();
  return stepId ? <EditStep key={stepId} stepId={stepId} /> : <CreateStep />;
}

function CreateStep() {
  const [params] = useSearchParams();
  const origin = params.get('skill') ?? '';
  const fromAdd = params.get('from') === 'add';
  const initialName = (params.get('name') ?? '').slice(0, 100);
  const initialPoints = digitsOnly(params.get('points') ?? '') || DEFAULT_POINTS;
  const skills = useLiveQuery(async () => (await listSkillSummaries()).filter((s) => s.skill.status === 'ACTIVE'));
  const [skillId, setSkillId] = useState(origin);
  const [name, setName] = useState(initialName);
  const [points, setPoints] = useState(initialPoints);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const goBack = useGoBack(origin ? `/skills/${origin}` : '/skills');
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedGuard(!busy && (name.trim() !== initialName.trim() || points !== initialPoints));

  // The query string is untrusted: fall back to the first active skill.
  const effectiveSkillId = skills?.some((s) => s.skill.id === skillId) ? skillId : (skills?.[0]?.skill.id ?? '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await createStep({ skillId: effectiveSkillId, name, points: Number(points) });
      haptics.success();
      showToast(t.created);
      if (fromAdd) {
        // This screen replaced «Задним числом»; replace it back with the new step pre-selected.
        navigate(`/skills/${effectiveSkillId}/add?step=${id}`, { replace: true });
      } else if (effectiveSkillId === origin) {
        goBack();
      } else {
        navigate(`/skills/${effectiveSkillId}`, { replace: true });
      }
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t.title}
      back={fromAdd ? `/skills/${origin}/add` : origin ? `/skills/${origin}` : '/skills'}
      replaceBack={fromAdd}
      primary={{ text: t.submit, onClick: () => formRef.current?.requestSubmit(), disabled: !effectiveSkillId, loading: busy }}
    >
      <form id="step-form" className="form" ref={formRef} onSubmit={submit}>
        <NameField value={name} onChange={setName} autoFocus={!initialName} />

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

        <PointsField value={points} onChange={setPoints} skillId={effectiveSkillId} />

        {error && <p className="error">{error}</p>}
      </form>
    </Screen>
  );
}

function EditStep({ stepId }: { stepId: string }) {
  const step = useLiveQuery(() => getStep(stepId), [stepId]);
  const skill = useLiveQuery(async () => (step ? (await getSkillFormData(step.skillId))?.skill : undefined), [step?.skillId]);

  if (step === null) {
    return (
      <Screen title={t.titleEdit} back="/skills">
        <p className="hint center">{t.notFound}</p>
      </Screen>
    );
  }
  return <EditStepForm step={step} active={skill ? skill.status === 'ACTIVE' : undefined} />;
}

function EditStepForm({ step, active }: { step: StepDefinition | undefined; active: boolean | undefined }) {
  // The loaded values plus the user's edits, so the form mounts before the step arrives.
  const [edits, setEdits] = useState<{ name?: string; points?: string }>({});
  const name = edits.name ?? step?.name ?? '';
  const points = edits.points ?? (step ? String(step.points) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = step ? `/skills/${step.skillId}` : '/skills';
  const goBack = useGoBack(back);
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const loading = step === undefined || active === undefined;
  const dirty = !busy && step !== undefined && (name.trim() !== step.name || points !== String(step.points));
  useUnsavedGuard(dirty);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!step) return;
    setBusy(true);
    setError(null);
    try {
      await updateStep(step.id, { name, points: Number(points) });
      haptics.success();
      showToast(copy.common.saved);
      goBack();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function toggleHidden() {
    if (!step || busy) return;
    if (step.isActive) {
      // Rule: dialogs.confirm runs synchronously in the click handler, before any await.
      const ok = await dialogs.confirm(t.confirmHide, { okLabel: t.hideConfirmButton, danger: true });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await setStepActive(step.id, !step.isActive);
      haptics.success();
      showToast(step.isActive ? t.hidden : copy.skill.unhidden);
      goBack();
    } catch (e) {
      haptics.error();
      showToast(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t.titleEdit}
      back={back}
      primary={!loading && active ? { text: copy.common.save, onClick: () => formRef.current?.requestSubmit(), loading: busy } : undefined}
    >
      <Skeleton layout="form" loading={loading}>
        {step && active === false ? (
          <p className="hint center">{t.readOnly}</p>
        ) : (
          step && (
            <form id="step-form" className="form" ref={formRef} onSubmit={submit}>
              <NameField value={name} onChange={(value) => setEdits((prev) => ({ ...prev, name: value }))} />
              <PointsField value={points} onChange={(value) => setEdits((prev) => ({ ...prev, points: value }))} skillId={step.skillId} />
              <p className="hint small field-hint">{t.futureHint}</p>

              {error && <p className="error">{error}</p>}

              <button type="button" className={`button button-block${step.isActive ? ' button-danger' : ''}`} disabled={busy} onClick={toggleHidden}>
                {step.isActive ? t.hide : t.unhide}
              </button>
            </form>
          )
        )}
      </Skeleton>
    </Screen>
  );
}

function NameField({ value, onChange, autoFocus = false }: { value: string; onChange(value: string): void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span className="field-label">{t.name}</span>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.namePlaceholder}
        maxLength={100}
        autoFocus={autoFocus}
        required
      />
    </label>
  );
}

/** Points with a live «≈ N выполнений» estimate against the skill's flask capacities. */
function PointsField({ value, onChange, skillId }: { value: string; onChange(value: string): void; skillId: string }) {
  const form = useLiveQuery(() => (skillId ? getSkillFormData(skillId) : null), [skillId]);
  const points = Number(value);
  let preview: string | null = null;
  if (form && points >= 1) {
    const config = { base: form.skill.capacityBase, increment: form.skill.capacityIncrement, manual: form.manual };
    const target = form.milestone?.targetFlaskNumber ?? 1;
    preview = t.preview(Math.ceil(flaskCapacity(1, config) / points), Math.ceil(pointsToFill(target, config) / points));
  }
  return (
    <div className="field">
      <label className="field">
        <span className="field-label">{t.points}</span>
        <input
          className="input"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onChange(digitsOnly(e.target.value))}
          aria-describedby="step-points-preview"
          required
        />
      </label>
      <span id="step-points-preview" className="hint small field-hint" aria-live="polite">
        {preview}
      </span>
    </div>
  );
}
