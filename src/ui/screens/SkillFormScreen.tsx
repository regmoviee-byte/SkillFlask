import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillFormData } from '../../services/queries';
import { createSkill, deleteSkill, updateSkill, ValidationError, type SkillInput } from '../../services/skills';
import { DEFAULT_MILESTONE_FLASKS } from '../../domain/milestone';
import { DEFAULT_CAPACITY_BASE, DEFAULT_CAPACITY_INCREMENT, flaskCapacity, pointsToFill } from '../../domain/progression';
import { FLASKS, formatNumber, formatPoints, plural } from '../../lib/format';
import { confirmDialog, haptic } from '../../telegram';
import { Screen, useGoBack } from '../components/Screen';
import { useToast } from '../components/Toast';

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

function defaultMilestoneName(form: FormState): string {
  const target = form.targetLabel.trim();
  return target ? `Достичь ${target}` : 'Главная цель';
}

function parseManual(value: string): number[] | null {
  const parts = value.split(/[\s,;]+/).filter(Boolean);
  const numbers = parts.map(Number);
  return numbers.every((n) => Number.isInteger(n) && n > 0) ? numbers : null;
}

function toInput(form: FormState): SkillInput {
  const manual = parseManual(form.manualCapacities);
  if (!manual) throw new ValidationError('Свои ёмкости: целые положительные числа через запятую');
  return {
    name: form.name,
    description: form.description,
    startLabel: form.startLabel,
    targetLabel: form.targetLabel,
    milestoneName: form.milestoneName.trim() || defaultMilestoneName(form),
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

  if (editing && existing === undefined) return <Screen title="Навык" back={`/skills/${skillId}`}>{null}</Screen>;
  if (editing && !existing) {
    return (
      <Screen title="Навык" back="/skills">
        <p className="hint center">Навык не найден</p>
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

  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const digits = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value.replace(/\D/g, '') });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = toInput(form);
      if (skillId) {
        await updateSkill(skillId, input);
        showToast('Сохранено');
        goBack();
      } else {
        const id = await createSkill(input);
        haptic('success');
        navigate(`/skills/${id}`, { replace: true });
      }
    } catch (e) {
      haptic('error');
      setError(e instanceof ValidationError ? e.message : 'Не удалось сохранить');
      setBusy(false);
    }
  }

  async function remove() {
    if (!skillId) return;
    const ok = await confirmDialog('Навык и вся его история будут удалены без возможности восстановления. Удалить?');
    if (!ok) return;
    await deleteSkill(skillId);
    showToast('Навык удалён');
    navigate('/skills', { replace: true });
  }

  return (
    <Screen
      title={skillId ? 'Настройка навыка' : 'Новый навык'}
      back={back}
      footer={
        <button type="submit" form="skill-form" className="button button-primary button-block" disabled={busy}>
          {skillId ? 'Сохранить' : 'Создать навык'}
        </button>
      }
    >
      <form id="skill-form" className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Название</span>
          <input className="input" value={form.name} onChange={set('name')} placeholder="Например, английский" maxLength={100} required />
        </label>
        <label className="field">
          <span className="field-label">Описание</span>
          <textarea className="input" rows={2} value={form.description} onChange={set('description')} placeholder="Необязательно" />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Сейчас</span>
            <input className="input" value={form.startLabel} onChange={set('startLabel')} placeholder="B1" maxLength={40} />
          </label>
          <label className="field">
            <span className="field-label">Цель</span>
            <input className="input" value={form.targetLabel} onChange={set('targetLabel')} placeholder="C1" maxLength={40} />
          </label>
        </div>

        <h2 className="section-title">Веха</h2>
        <div className="field-row">
          <label className="field field-grow">
            <span className="field-label">Название вехи</span>
            <input
              className="input"
              value={form.milestoneName}
              onChange={set('milestoneName')}
              placeholder={defaultMilestoneName(form)}
              maxLength={100}
            />
          </label>
          <label className="field field-narrow">
            <span className="field-label">Колб</span>
            <input className="input" inputMode="numeric" value={form.milestoneTarget} onChange={digits('milestoneTarget')} required />
          </label>
        </div>

        <h2 className="section-title">Ёмкость колб</h2>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Первая колба</span>
            <input className="input" inputMode="numeric" value={form.capacityBase} onChange={digits('capacityBase')} required />
          </label>
          <label className="field">
            <span className="field-label">Прирост за уровень</span>
            <input className="input" inputMode="numeric" value={form.capacityIncrement} onChange={digits('capacityIncrement')} required />
          </label>
        </div>
        <div className="field">
          <label className="field">
            <span className="field-label">Свои значения по колбам</span>
            <input
              className="input"
              inputMode="numeric"
              value={form.manualCapacities}
              onChange={set('manualCapacities')}
              placeholder="Необязательно, например: 50, 80, 120"
              aria-describedby="manual-capacities-hint"
            />
          </label>
          <span id="manual-capacities-hint" className="hint small">
            После последнего значения ёмкость растёт на «прирост за уровень».
          </span>
        </div>
        <CapacityPreview form={form} />

        {error && <p className="error">{error}</p>}

        {skillId && (
          <button type="button" className="button button-block button-danger" onClick={remove}>
            Удалить навык
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
      <span className="hint">
        До вехи: {target} {plural(target, FLASKS)}, {formatPoints(pointsToFill(target, config))}
      </span>
    </p>
  );
}
