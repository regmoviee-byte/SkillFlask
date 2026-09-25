import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillFormData } from '../../services/queries';
import { archiveSkill } from '../../services/lifecycle';
import { createSkill, deleteSkill, updateSkill, ValidationError, type SkillInput } from '../../services/skills';
import type { SkillStatus } from '../../domain/types';
import { DEFAULT_PROGRESS_THEME, isProgressTheme, isSkillColor, normalizeColor } from '../../domain/appearance';
import { DEFAULT_MILESTONE_FLASKS } from '../../domain/milestone';
import { DEFAULT_CAPACITY_BASE, DEFAULT_CAPACITY_INCREMENT, flaskCapacity, pointsToFill } from '../../domain/progression';
import { formatNumber } from '../../lib/format';
import { useUnsavedGuard } from '../../platform/buttons';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { Icon } from '../components/Icon';
import { Screen, useGoBack } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { AppearancePicker, type Appearance } from '../progress/AppearancePicker';
import { levelCopyOf, skillTheme } from '../progress/registry';

const t = copy.skillForm;

interface FormState {
  name: string;
  description: string;
  startLabel: string;
  targetLabel: string;
  milestoneName: string;
  milestoneTarget: string;
  capacityBase: string;
  capacityIncrement: string;
  manualCapacities: string;
  /** The stored progress theme key (a key this build does not know is kept until another is picked). */
  theme: string;
  /** The colour key, '' for «Как в теме». */
  color: string;
}

const emptyForm: FormState = {
  name: '',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: '',
  milestoneTarget: String(DEFAULT_MILESTONE_FLASKS),
  capacityBase: String(DEFAULT_CAPACITY_BASE),
  capacityIncrement: String(DEFAULT_CAPACITY_INCREMENT),
  manualCapacities: '',
  theme: DEFAULT_PROGRESS_THEME,
  color: '',
};

function parseManual(value: string): number[] | null {
  const parts = value.split(/[\s,;]+/).filter(Boolean);
  const numbers = parts.map(Number);
  return numbers.every((n) => Number.isInteger(n) && n > 0) ? numbers : null;
}

function toInput(form: FormState): SkillInput {
  const manual = parseManual(form.manualCapacities);
  if (!manual) throw new ValidationError(t.manualInvalid);
  return {
    name: form.name,
    description: form.description,
    startLabel: form.startLabel,
    targetLabel: form.targetLabel,
    milestoneName: form.milestoneName.trim() || t.defaultMilestoneName(form.targetLabel.trim()),
    milestoneTarget: Number(form.milestoneTarget || NaN),
    capacityBase: Number(form.capacityBase || NaN),
    capacityIncrement: Number(form.capacityIncrement || NaN),
    manualCapacities: manual,
    // A stored key this build does not know (a newer release's backup) is omitted, so the
    // update keeps it until the owner picks another theme (a colour change alone keeps it).
    theme: isProgressTheme(form.theme) ? form.theme : undefined,
    color: form.color === '' ? null : isSkillColor(form.color) ? form.color : undefined,
  };
}

/** `?template=english` on /skills/new: a filled-in example the user only has to confirm. */
function templateForm(name: string | null): FormState {
  if (name !== 'english') return emptyForm;
  const template = t.templates.english;
  return {
    ...emptyForm,
    name: template.name,
    startLabel: template.startLabel,
    targetLabel: template.targetLabel,
    milestoneName: template.milestoneName,
    milestoneTarget: String(template.milestoneTarget),
  };
}

export function SkillFormScreen() {
  const { skillId } = useParams();
  const [params] = useSearchParams();
  const editing = skillId !== undefined;
  const existing = useLiveQuery(async () => (skillId ? getSkillFormData(skillId) : null), [skillId]);

  if (editing && existing === null) {
    return (
      <Screen title={copy.common.skill} back="/skills">
        <p className="hint center">{copy.common.skillNotFound}</p>
      </Screen>
    );
  }
  // Archived and completed skills are read-only: the form is not offered, not even by URL.
  if (editing && existing && existing.skill.status !== 'ACTIVE') return <Navigate to={`/skills/${skillId}`} replace />;

  // Undefined while the skill is still loading: the form renders its skeleton meanwhile.
  const initial: FormState | undefined = existing
    ? {
        name: existing.skill.name,
        description: existing.skill.description,
        startLabel: existing.skill.startLabel,
        targetLabel: existing.skill.targetLabel,
        milestoneName: existing.milestone?.name ?? '',
        milestoneTarget: String(existing.milestone?.targetFlaskNumber ?? DEFAULT_MILESTONE_FLASKS),
        capacityBase: String(existing.skill.capacityBase),
        capacityIncrement: String(existing.skill.capacityIncrement),
        manualCapacities: existing.manual.join(', '),
        theme: typeof existing.skill.theme === 'string' ? existing.skill.theme : DEFAULT_PROGRESS_THEME,
        color: typeof existing.skill.color === 'string' ? existing.skill.color : '',
      }
    : editing
      ? undefined
      : templateForm(params.get('template'));
  // Capacities re-interpret the whole journal; they stay fixed once a skill left the active state.
  const capacityLocked = existing ? existing.skill.status !== 'ACTIVE' : false;

  return <SkillForm key={skillId ?? 'new'} skillId={skillId} initial={initial} capacityLocked={capacityLocked} status={existing?.skill.status} />;
}

interface SkillFormProps {
  skillId: string | undefined;
  initial: FormState | undefined;
  capacityLocked: boolean;
  /** Status of the edited skill; «Архивировать навык» is offered only for an active one. */
  status: SkillStatus | undefined;
}

function SkillForm({ skillId, initial, capacityLocked, status }: SkillFormProps) {
  // The form is the loaded values plus the user's edits, so it can mount (and keep its
  // skeleton mounted) before the values arrive; nothing can be typed while they are hidden.
  const [edits, setEdits] = useState<Partial<FormState>>({});
  const form: FormState = { ...(initial ?? emptyForm), ...edits };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const back = skillId ? `/skills/${skillId}` : '/skills';
  const goBack = useGoBack(back);
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const loading = initial === undefined;
  const dirty = !busy && !loading && JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedGuard(dirty);

  // Functional updates: two fields changed in the same tick must not overwrite each other.
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setEdits((prev) => ({ ...prev, [key]: value }));
  };
  const digits = (key: keyof FormState) => (e: { target: { value: string } }) => {
    const value = e.target.value.replace(/\D/g, '');
    setEdits((prev) => ({ ...prev, [key]: value }));
  };
  // The picker shows what this build draws; the level words follow the chosen theme.
  const appearance: Appearance = { theme: skillTheme(form.theme), color: normalizeColor(form.color) };
  // Only a theme the owner changed goes into the edits: the picker reports the normalised key
  // (a stored key this build cannot draw reads as 'flask'), and a colour change alone must not
  // overwrite that key — the same rule as AppearanceSheet.
  const setAppearance = (next: Appearance) =>
    setEdits((prev) => ({ ...prev, ...(next.theme !== appearance.theme && { theme: next.theme }), color: next.color ?? '' }));
  const lc = levelCopyOf(appearance.theme);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = toInput(form);
      if (skillId) {
        await updateSkill(skillId, input);
        showToast(copy.common.saved);
        goBack();
      } else {
        const id = await createSkill(input);
        haptics.success();
        navigate(`/skills/${id}`, { replace: true });
      }
    } catch (e) {
      haptics.error();
      setError(e instanceof ValidationError ? e.message : copy.errors.save);
      setBusy(false);
    }
  }

  async function remove() {
    if (!skillId || busy) return;
    // Rule: dialogs.confirm runs synchronously in the click handler, before any await, so the
    // native dialog keeps its user-gesture context (and Telegram's showConfirm is not queued).
    const ok = await dialogs.confirm(t.confirmRemove, { okLabel: t.removeConfirmButton, danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteSkill(skillId);
      showToast(t.removed);
      navigate('/skills', { replace: true });
    } catch (e) {
      haptics.error();
      showToast(e instanceof Error ? e.message : copy.errors.save);
      setBusy(false);
    }
  }

  // A fast double tap must not queue two confirmations: the ref flips before the first await.
  const confirming = useRef(false);

  async function archive() {
    if (!skillId || busy || !initial || confirming.current) return;
    const l = copy.lifecycle;
    // Typed but unsaved edits are saved with the archiving rather than dropped silently.
    const pending = dirty;
    confirming.current = true;
    const ok = await dialogs.confirm(l.confirmArchive(form.name.trim() || initial.name), { okLabel: l.archiveOk });
    confirming.current = false;
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      if (pending) await updateSkill(skillId, toInput(form));
      await archiveSkill(skillId);
      haptics.success();
      showToast(l.archived);
      navigate('/skills', { replace: true });
    } catch (e) {
      haptics.error();
      setError(e instanceof ValidationError ? e.message : copy.errors.save);
      setBusy(false);
    }
  }

  return (
    <Screen
      title={skillId ? t.titleEdit : t.titleNew}
      back={back}
      primary={loading ? undefined : { text: skillId ? copy.common.save : t.create, onClick: () => formRef.current?.requestSubmit(), loading: busy }}
    >
      <Skeleton layout="form" loading={loading}>
        {/* noValidate: a required field may sit inside the closed disclosure, where the browser
            cannot show its bubble; the service validates and the error shows under the form. */}
        <form id="skill-form" className="form" ref={formRef} onSubmit={submit} noValidate>
          <label className="field">
            <span className="field-label">{t.name}</span>
            <input className="input" value={form.name} onChange={set('name')} placeholder={t.namePlaceholder} maxLength={100} required />
          </label>
          <div className="field-row labels-row">
            <label className="field">
              <span className="field-label">{t.startLabel}</span>
              <input className="input" value={form.startLabel} onChange={set('startLabel')} placeholder={t.startPlaceholder} maxLength={40} />
            </label>
            <Icon name="arrow-right" size={20} className="labels-arrow" />
            <label className="field">
              <span className="field-label">{t.targetLabel}</span>
              <input className="input" value={form.targetLabel} onChange={set('targetLabel')} placeholder={t.targetPlaceholder} maxLength={40} />
            </label>
          </div>
          <CapacityPreview form={form} />

          <section className="form-section" aria-labelledby="appearance-title">
            <h2 className="section-title" id="appearance-title">
              {copy.appearance.title}
            </h2>
            <AppearancePicker value={appearance} onChange={setAppearance} disabled={busy} />
          </section>

          {/* Defaults live in the form state, so the skill can be created with this closed. */}
          <details className="disclosure" open={skillId !== undefined}>
            <summary>
              {t.advanced}
              <Icon name="chevron-down" size={18} className="disclosure-chevron" />
            </summary>
            <div className="disclosure-body form">
              <label className="field">
                <span className="field-label">{t.description}</span>
                <textarea className="input" rows={2} value={form.description} onChange={set('description')} placeholder={copy.common.optional} />
              </label>

              <h2 className="section-title">{t.milestoneSection}</h2>
              <div className="field-row">
                <label className="field field-grow">
                  <span className="field-label">{t.milestoneName}</span>
                  <input
                    className="input"
                    value={form.milestoneName}
                    onChange={set('milestoneName')}
                    placeholder={t.defaultMilestoneName(form.targetLabel.trim())}
                    maxLength={100}
                  />
                </label>
                <label className="field field-narrow">
                  <span className="field-label">{lc.formMilestoneLevels}</span>
                  <input className="input" inputMode="numeric" value={form.milestoneTarget} onChange={digits('milestoneTarget')} required />
                </label>
              </div>

              <h2 className="section-title">{t.capacitySection}</h2>
              <fieldset className="fieldset form" disabled={capacityLocked} aria-describedby="capacity-hint">
                <div className="field-row">
                  <label className="field">
                    <span className="field-label">{t.capacityBase}</span>
                    <input className="input" inputMode="numeric" value={form.capacityBase} onChange={digits('capacityBase')} required />
                  </label>
                  <label className="field">
                    <span className="field-label">{t.capacityIncrement}</span>
                    <input className="input" inputMode="numeric" value={form.capacityIncrement} onChange={digits('capacityIncrement')} required />
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">{t.manualCapacities}</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={form.manualCapacities}
                    onChange={set('manualCapacities')}
                    placeholder={t.manualPlaceholder}
                    aria-describedby="manual-capacities-hint"
                  />
                  <span id="manual-capacities-hint" className="hint small field-hint">
                    {t.manualHint}
                  </span>
                </label>
              </fieldset>
              <p id="capacity-hint" className="hint small field-hint">
                {t.capacityHint}
              </p>
            </div>
          </details>

          {error && <p className="error">{error}</p>}

          {skillId && (
            <div className="danger-zone">
              {status === 'ACTIVE' && (
                <button type="button" className="button button-block" disabled={busy} onClick={archive}>
                  <Icon name="archive" size={20} />
                  {copy.lifecycle.archive}
                </button>
              )}
              <button type="button" className="button button-block button-danger" disabled={busy} onClick={remove}>
                {t.remove}
              </button>
            </div>
          )}
        </form>
      </Skeleton>
    </Screen>
  );
}

/** «Веха: 10 колб · 100 · 150 · … · 550 · всего 3 250 очков» (the chosen theme's noun), always visible under the labels. */
function CapacityPreview({ form }: { form: FormState }) {
  const manual = parseManual(form.manualCapacities);
  const base = Number(form.capacityBase);
  const increment = Number(form.capacityIncrement || 0);
  const target = Number(form.milestoneTarget);
  if (!manual || !(base > 0) || !(target > 0)) return null;

  const config = { base, increment, manual };
  const shown = Math.min(target, 3);
  const capacities = Array.from({ length: shown }, (_, i) => formatNumber(flaskCapacity(i + 1, config)));
  if (target > shown) capacities.push('…', formatNumber(flaskCapacity(target, config)));

  return <p className="preview">{levelCopyOf(skillTheme(form.theme)).formPreview(target, capacities.join(' · '), pointsToFill(target, config))}</p>;
}
