import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillFormData, listSkillSummaries } from '../../services/queries';
import { createStep, getStep, setStepActive, updateStep, type StepPatch } from '../../services/steps';
import type { StepDefinition, StepSchedule, StepType } from '../../domain/types';
import { flaskCapacity, pointsToFill } from '../../domain/progression';
import { isRate, MAX_MINUTES, timedPoints } from '../../domain/points';
import { parseDecimal } from '../../lib/format';
import { useUnsavedGuard } from '../../platform/buttons';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { errorMessage } from '../completionFeedback';
import { ScheduleField } from '../components/ScheduleField';
import { Screen, useGoBack } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { Stepper } from '../components/Stepper';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

// The step form: name, type (fixed once created), what one completion is worth and the
// schedule. Every value previews what it means — «≈ 12 выполнений до первой колбы»,
// «30 мин → 15 очков» — against the skill's own flask capacities.

const t = copy.stepForm;
const DEFAULT_POINTS = 5;
const MAX_POINTS = 9999;
const POINT_PRESETS = [1, 3, 5, 10, 25];
const MINUTE_PRESETS = [15, 30, 45, 60];
/** Minutes the TIMED preview assumes while no usual duration is set. */
const PREVIEW_MINUTES = 30;
/** Below this rate a single minute rounds to 0 points. */
const LOW_RATE = 0.05;

interface Draft {
  name: string;
  type: StepType;
  points: number | null;
  /** The rate as typed: «0,5» and «0.5» are both fine. */
  rate: string;
  minutes: number | null;
  schedule: StepSchedule;
}

function draftOf(step: StepDefinition): Draft {
  return {
    name: step.name,
    type: step.type,
    points: step.type === 'BOOLEAN' ? step.points : DEFAULT_POINTS,
    // As a Russian keyboard types it: «0,25».
    rate: step.pointsPerMinute === null ? '' : String(step.pointsPerMinute).replace('.', ','),
    minutes: step.defaultMinutes,
    schedule: step.schedule,
  };
}

/** The service input; a malformed rate goes through as NaN so the service names the problem. */
function patchOf(draft: Draft): Required<Omit<StepPatch, 'type'>> & { type: StepType } {
  return {
    name: draft.name,
    type: draft.type,
    points: draft.points ?? NaN,
    pointsPerMinute: draft.type === 'TIMED' ? (parseDecimal(draft.rate) ?? NaN) : null,
    defaultMinutes: draft.type === 'TIMED' ? draft.minutes : null,
    schedule: draft.schedule,
  };
}

/** What the user changed, type-aware: the fields of the other type do not count. */
function sameDraft(a: Draft, b: Draft): boolean {
  const pa = patchOf(a);
  const pb = patchOf(b);
  const same = (x: unknown, y: unknown) => Object.is(x, y) || JSON.stringify(x) === JSON.stringify(y);
  return (
    a.name.trim() === b.name.trim() &&
    a.type === b.type &&
    (a.type === 'TIMED' ? same(pa.pointsPerMinute, pb.pointsPerMinute) && a.minutes === b.minutes : a.points === b.points) &&
    same(a.schedule, b.schedule)
  );
}

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

interface StepFieldsProps {
  draft: Draft;
  onChange(draft: Draft): void;
  skillId: string;
  /** The type is fixed once the step exists: its history would mean something else. */
  typeLocked: boolean;
  autoFocus?: boolean;
  /** Fields between the name and the type (the skill select of a new step). */
  children?: ReactNode;
}

function StepFields({ draft, onChange, skillId, typeLocked, autoFocus = false, children }: StepFieldsProps) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <label className="field">
        <span className="field-label">{t.name}</span>
        <input
          className="input"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={t.namePlaceholder}
          maxLength={100}
          autoFocus={autoFocus}
          required
        />
      </label>
      {children}

      <FormSection title={t.typeSection}>
        <div className="segmented" role="group" aria-label={t.typeSection}>
          {(['BOOLEAN', 'TIMED'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={draft.type === type ? 'active' : undefined}
              aria-pressed={draft.type === type}
              disabled={typeLocked}
              onClick={() => {
                if (draft.type === type) return;
                haptics.select();
                set({ type });
              }}
            >
              {type === 'BOOLEAN' ? t.typeBoolean : t.typeTimed}
            </button>
          ))}
        </div>
        {typeLocked && <p className="hint small field-hint">{t.typeLocked}</p>}
        {draft.type === 'BOOLEAN' ? <PointsFields draft={draft} set={set} skillId={skillId} /> : <TimedFields draft={draft} set={set} skillId={skillId} />}
      </FormSection>

      <FormSection title={t.scheduleSection}>
        <ScheduleField value={draft.schedule} onChange={(schedule) => set({ schedule })} />
      </FormSection>
    </>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

/** «≈ N выполнений до первой колбы · веха через ≈ M» for `perCompletion` points, or null. */
function useEstimate(skillId: string, perCompletion: number | null): { perFlask: number; perMilestone: number } | null {
  const form = useLiveQuery(() => (skillId ? getSkillFormData(skillId) : null), [skillId]);
  if (!form || perCompletion === null || perCompletion <= 0) return null;
  const config = { base: form.skill.capacityBase, increment: form.skill.capacityIncrement, manual: form.manual };
  const target = form.milestone?.targetFlaskNumber ?? 1;
  return { perFlask: Math.ceil(flaskCapacity(1, config) / perCompletion), perMilestone: Math.ceil(pointsToFill(target, config) / perCompletion) };
}

interface ValueFieldsProps {
  draft: Draft;
  set(patch: Partial<Draft>): void;
  skillId: string;
}

function PointsFields({ draft, set, skillId }: ValueFieldsProps) {
  const previewId = useId();
  const estimate = useEstimate(skillId, draft.points !== null && draft.points >= 1 ? draft.points : null);
  return (
    <>
      <Stepper
        label={t.points}
        value={draft.points}
        onChange={(points) => set({ points })}
        min={1}
        max={MAX_POINTS}
        presets={POINT_PRESETS}
        describedBy={previewId}
      />
      <span id={previewId} className="hint small field-hint" aria-live="polite">
        {estimate && t.preview(estimate.perFlask, estimate.perMilestone)}
      </span>
    </>
  );
}

function TimedFields({ draft, set, skillId }: ValueFieldsProps) {
  const rateHintId = useId();
  const previewId = useId();
  const parsed = parseDecimal(draft.rate);
  const rate = parsed !== null && isRate(parsed) ? parsed : null;
  const minutes = draft.minutes !== null && draft.minutes >= 1 && draft.minutes <= MAX_MINUTES ? draft.minutes : PREVIEW_MINUTES;
  const perCompletion = rate === null ? null : timedPoints(minutes, rate);
  const estimate = useEstimate(skillId, perCompletion);
  return (
    <>
      <label className="field">
        <span className="field-label">{t.rate}</span>
        <input
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={draft.rate}
          placeholder={t.ratePlaceholder}
          aria-describedby={rateHintId}
          onChange={(e) => set({ rate: e.target.value.replace(/[^\d.,]/g, '').slice(0, 8) })}
        />
      </label>
      <span id={rateHintId} className="hint small field-hint" aria-live="polite">
        {rate !== null && rate < LOW_RATE ? t.rateLow : null}
      </span>
      <Stepper
        label={t.usualMinutes}
        value={draft.minutes}
        onChange={(value) => set({ minutes: value })}
        min={1}
        max={MAX_MINUTES}
        step={5}
        presets={MINUTE_PRESETS}
        unit={copy.minutes.unit}
        optional
        describedBy={previewId}
      />
      <p id={previewId} className="hint small field-hint" aria-live="polite">
        {perCompletion !== null ? (
          <>
            <span className="timed-preview">{t.timedPreview(minutes, perCompletion)}</span>
            {estimate && <> · {t.preview(estimate.perFlask, estimate.perMilestone)}</>}
          </>
        ) : (
          t.usualMinutesHint
        )}
      </p>
    </>
  );
}
