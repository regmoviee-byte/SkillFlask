import { useId, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkillFormData } from '../../services/queries';
import type { StepPatch } from '../../services/steps';
import type { StepDefinition, StepSchedule, StepType } from '../../domain/types';
import type { ProgressThemeKey } from '../../domain/appearance';
import { flaskCapacity, pointsToFill, type CapacityConfig } from '../../domain/progression';
import { isRate, MAX_MINUTES, timedPoints } from '../../domain/points';
import { parseDecimal } from '../../lib/format';
import { haptics } from '../../platform/haptics';
import { copy } from '../copy';
import { copyForSkill } from '../progress/registry';
import { ScheduleField } from './ScheduleField';
import { Stepper } from './Stepper';

// The fields of an action: name, type, what one completion is worth and the schedule. Every
// value previews what it means — «≈ 12 выполнений до колбы 1», «30 мин → 15 очков» — against
// the skill's own capacities, or, for an action of a skill not created yet (the template
// actions of the new-skill form, package 16), against the capacities typed in that form. The
// step form screens (StepFormScreen) and the template action sheet share them.

const t = copy.stepForm;
export const DEFAULT_POINTS = 5;
export const MAX_POINTS = 9999;
const POINT_PRESETS = [1, 3, 5, 10, 25];
const MINUTE_PRESETS = [15, 30, 45, 60];
/** Minutes the TIMED preview assumes while no usual duration is set. */
const PREVIEW_MINUTES = 30;
/** Below this rate a single minute rounds to 0 points. */
const LOW_RATE = 0.05;

export interface Draft {
  name: string;
  type: StepType;
  points: number | null;
  /** The rate as typed: «0,5» and «0.5» are both fine. */
  rate: string;
  minutes: number | null;
  schedule: StepSchedule;
}

export function draftOf(step: Pick<StepDefinition, 'name' | 'type' | 'points' | 'pointsPerMinute' | 'defaultMinutes' | 'schedule'>): Draft {
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
export function patchOf(draft: Draft): Required<Omit<StepPatch, 'type'>> & { type: StepType } {
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
export function sameDraft(a: Draft, b: Draft): boolean {
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

/** Capacities of a skill that does not exist yet: what the estimate compares against. */
export interface EstimatePlan {
  config: CapacityConfig;
  /** Levels to the milestone. */
  target: number;
  theme: ProgressThemeKey;
}

interface StepFieldsProps {
  draft: Draft;
  onChange(draft: Draft): void;
  skillId: string;
  /** Estimates against these capacities instead of the stored skill's (a skill not created yet). */
  plan?: EstimatePlan;
  /** The type is fixed once the step exists: its history would mean something else. */
  typeLocked: boolean;
  autoFocus?: boolean;
  /** Fields between the name and the type (the skill select of a new step). */
  children?: ReactNode;
}

export function StepFields({ draft, onChange, skillId, plan, typeLocked, autoFocus = false, children }: StepFieldsProps) {
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
        {draft.type === 'BOOLEAN' ? <PointsFields draft={draft} set={set} skillId={skillId} plan={plan} /> : <TimedFields draft={draft} set={set} skillId={skillId} plan={plan} />}
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

/** «≈ N выполнений до колбы 1 · веха через ≈ M» (the skill theme's noun) for `perCompletion` points, or null. */
function useEstimate(skillId: string, plan: EstimatePlan | undefined, perCompletion: number | null): string | null {
  const form = useLiveQuery(() => (skillId && !plan ? getSkillFormData(skillId) : null), [skillId, plan === undefined]);
  const source: EstimatePlan | null = plan
    ? plan
    : form
      ? {
          config: { base: form.skill.capacityBase, increment: form.skill.capacityIncrement, manual: form.manual },
          target: form.milestone?.targetFlaskNumber ?? 1,
          theme: form.skill.theme,
        }
      : null;
  if (!source || perCompletion === null || perCompletion <= 0) return null;
  const { config, target } = source;
  return copyForSkill(source).stepPreview(Math.ceil(flaskCapacity(1, config) / perCompletion), Math.ceil(pointsToFill(target, config) / perCompletion));
}

interface ValueFieldsProps {
  draft: Draft;
  set(patch: Partial<Draft>): void;
  skillId: string;
  plan: EstimatePlan | undefined;
}

function PointsFields({ draft, set, skillId, plan }: ValueFieldsProps) {
  const previewId = useId();
  const estimate = useEstimate(skillId, plan, draft.points !== null && draft.points >= 1 ? draft.points : null);
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
        {estimate}
      </span>
    </>
  );
}

function TimedFields({ draft, set, skillId, plan }: ValueFieldsProps) {
  const rateHintId = useId();
  const previewId = useId();
  const parsed = parseDecimal(draft.rate);
  const rate = parsed !== null && isRate(parsed) ? parsed : null;
  const minutes = draft.minutes !== null && draft.minutes >= 1 && draft.minutes <= MAX_MINUTES ? draft.minutes : PREVIEW_MINUTES;
  const perCompletion = rate === null ? null : timedPoints(minutes, rate);
  const estimate = useEstimate(skillId, plan, perCompletion);
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
            {estimate && <> · {estimate}</>}
          </>
        ) : (
          t.usualMinutesHint
        )}
      </p>
    </>
  );
}
