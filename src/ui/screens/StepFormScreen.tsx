import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillFormData, listSkillSummaries } from '../../services/queries';
import { createStep, getStep, setStepActive, updateStep } from '../../services/steps';
import type { StepDefinition } from '../../domain/types';
import { useUnsavedGuard } from '../../platform/buttons';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { errorMessage } from '../completionFeedback';
import { Screen, useGoBack } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { DEFAULT_POINTS, draftOf, MAX_POINTS, patchOf, sameDraft, StepFields, type Draft } from '../components/StepFields';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

// The step form: name, type (fixed once created), what one completion is worth and the
// schedule (the fields and their previews: components/StepFields.tsx).

const t = copy.stepForm;

/** `/steps/new` (prefills ?skill, ?name, ?points; ?from=add returns to «Задним числом») and `/steps/:stepId/edit`. */
export function StepFormScreen() {
  const { stepId } = useParams();
  return stepId ? <EditStep key={stepId} stepId={stepId} /> : <CreateStep />;
}

function CreateStep() {
  const [params] = useSearchParams();
  const origin = params.get('skill') ?? '';
  const fromAdd = params.get('from') === 'add';
  const [initial] = useState<Draft>(() => {
    const points = Number((params.get('points') ?? '').replace(/\D/g, ''));
    return {
      name: (params.get('name') ?? '').slice(0, 100),
      type: 'BOOLEAN',
      points: points >= 1 ? Math.min(points, MAX_POINTS) : DEFAULT_POINTS,
      rate: '',
      minutes: null,
      schedule: { kind: 'MANUAL' },
    };
  });
  const skills = useLiveQuery(async () => (await listSkillSummaries()).filter((s) => s.skill.status === 'ACTIVE'));
  const [skillId, setSkillId] = useState(origin);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const goBack = useGoBack(origin ? `/skills/${origin}` : '/skills');
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedGuard(!busy && !sameDraft(draft, initial));

  // The query string is untrusted: fall back to the first active skill.
  const effectiveSkillId = skills?.some((s) => s.skill.id === skillId) ? skillId : (skills?.[0]?.skill.id ?? '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await createStep({ skillId: effectiveSkillId, ...patchOf(draft) });
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
      <form id="step-form" className="form" ref={formRef} onSubmit={submit} noValidate>
        <StepFields draft={draft} onChange={setDraft} skillId={effectiveSkillId} typeLocked={false} autoFocus={!initial.name}>
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
        </StepFields>

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
  const [edits, setEdits] = useState<Draft | null>(null);
  const loaded = step ? draftOf(step) : null;
  const draft = edits ?? loaded;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = step ? `/skills/${step.skillId}` : '/skills';
  const goBack = useGoBack(back);
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const loading = step === undefined || active === undefined;
  const dirty = draft !== null && loaded !== null && !sameDraft(draft, loaded);
  useUnsavedGuard(!busy && dirty);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!step || !draft) return;
    setBusy(true);
    setError(null);
    try {
      await updateStep(step.id, patchOf(draft));
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
    if (!step || !draft || busy) return;
    if (step.isActive) {
      // Rule: dialogs.confirm runs synchronously in the click handler, before any await.
      const ok = await dialogs.confirm(t.confirmHide, { okLabel: t.hideConfirmButton, danger: true });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      // Edits typed before «Убрать из списка» are kept, as the form's own «Сохранить» would.
      if (dirty) await updateStep(step.id, patchOf(draft));
      await setStepActive(step.id, !step.isActive);
      haptics.success();
      showToast(step.isActive ? t.hidden : copy.skill.unhidden);
      goBack();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
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
          step &&
          draft && (
            <form id="step-form" className="form" ref={formRef} onSubmit={submit} noValidate>
              <StepFields draft={draft} onChange={setEdits} skillId={step.skillId} typeLocked />
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
