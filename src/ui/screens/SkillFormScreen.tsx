import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillFormData } from '../../services/queries';
import { createSkill, deleteSkill, updateSkill, ValidationError, type SkillInput } from '../../services/skills';
import { DEFAULT_MILESTONE_FLASKS } from '../../domain/milestone';
import { DEFAULT_CAPACITY_BASE, DEFAULT_CAPACITY_INCREMENT, flaskCapacity, pointsToFill } from '../../domain/progression';
import { formatNumber } from '../../lib/format';
import { confirmDialog, haptic } from '../../telegram';
import { Screen, useGoBack } from '../components/Screen';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

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
  };
}

export function SkillFormScreen() {
  const { skillId } = useParams();
  const editing = skillId !== undefined;
  const existing = useLiveQuery(async () => (skillId ? getSkillFormData(skillId) : null), [skillId]);

  if (editing && existing === undefined) return <Screen title={copy.common.skill} back={`/skills/${skillId}`}>{null}</Screen>;
  if (editing && !existing) {
    return (
      <Screen title={copy.common.skill} back="/skills">
        <p className="hint center">{copy.common.skillNotFound}</p>
      </Screen>
    );
  }

  const initial: FormState = existing
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
      }
    : emptyForm;

  return <SkillForm key={skillId ?? 'new'} skillId={skillId} initial={initial} />;
}

function SkillForm({ skillId, initial }: { skillId: string | undefined; initial: FormState }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const back = skillId ? `/skills/${skillId}` : '/skills';
  const goBack = useGoBack(back);
  const { showToast } = useToast();

  // Functional updates: two fields changed in the same tick must not overwrite each other.
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const digits = (key: keyof FormState) => (e: { target: { value: string } }) => {
    const value = e.target.value.replace(/\D/g, '');
    setForm((prev) => ({ ...prev, [key]: value }));
  };

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
        haptic('success');
        navigate(`/skills/${id}`, { replace: true });
      }
    } catch (e) {
      haptic('error');
      setError(e instanceof ValidationError ? e.message : copy.errors.save);
      setBusy(false);
    }
  }

  async function remove() {
    if (!skillId || busy) return;
    // Rule: confirmDialog runs synchronously in the click handler, before any await, so the
    // native dialog keeps its user-gesture context (and Telegram's showConfirm is not queued).
    const ok = await confirmDialog(t.confirmRemove);
    if (!ok) return;
    setBusy(true);
    try {
      await deleteSkill(skillId);
      showToast(t.removed);
      navigate('/skills', { replace: true });
    } catch (e) {
      haptic('error');
      showToast(e instanceof Error ? e.message : copy.errors.save);
      setBusy(false);
    }
  }

  return (
    <Screen
      title={skillId ? t.titleEdit : t.titleNew}
      back={back}
      footer={
        <button type="submit" form="skill-form" className="button button-primary button-block" disabled={busy}>
          {skillId ? copy.common.save : t.create}
        </button>
      }
    >
      <form id="skill-form" className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">{t.name}</span>
          <input className="input" value={form.name} onChange={set('name')} placeholder={t.namePlaceholder} maxLength={100} required />
        </label>
        <label className="field">
          <span className="field-label">{t.description}</span>
          <textarea className="input" rows={2} value={form.description} onChange={set('description')} placeholder={copy.common.optional} />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t.startLabel}</span>
            <input className="input" value={form.startLabel} onChange={set('startLabel')} placeholder={t.startPlaceholder} maxLength={40} />
          </label>
          <label className="field">
            <span className="field-label">{t.targetLabel}</span>
            <input className="input" value={form.targetLabel} onChange={set('targetLabel')} placeholder={t.targetPlaceholder} maxLength={40} />
          </label>
        </div>

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
            <span className="field-label">{t.milestoneFlasks}</span>
            <input className="input" inputMode="numeric" value={form.milestoneTarget} onChange={digits('milestoneTarget')} required />
          </label>
        </div>

        <h2 className="section-title">{t.capacitySection}</h2>
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
        <div className="field">
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
          </label>
          <span id="manual-capacities-hint" className="hint small">
            {t.manualHint}
          </span>
        </div>
        <CapacityPreview form={form} />

        {error && <p className="error">{error}</p>}

        {skillId && (
          <button type="button" className="button button-block button-danger" disabled={busy} onClick={remove}>
            {t.remove}
          </button>
        )}
      </form>
    </Screen>
  );
}

function CapacityPreview({ form }: { form: FormState }) {
  const manual = parseManual(form.manualCapacities);
  const base = Number(form.capacityBase);
  const increment = Number(form.capacityIncrement || 0);
  const target = Number(form.milestoneTarget);
  if (!manual || !(base > 0) || !(target > 0)) return null;

  const config = { base, increment, manual };
  const shown = Math.min(target, 5);
  const capacities = Array.from({ length: shown }, (_, i) => formatNumber(flaskCapacity(i + 1, config)));
  if (target > shown) capacities.push('…', formatNumber(flaskCapacity(target, config)));

  return (
    <p className="preview">
      {capacities.join(' · ')}
      <br />
      <span className="hint">{t.preview(target, pointsToFill(target, config))}</span>
    </p>
  );
}
