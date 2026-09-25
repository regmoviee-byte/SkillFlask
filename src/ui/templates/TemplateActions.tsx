import { useEffect, useId, useRef, useState } from 'react';
import { describeSchedule } from '../../domain/schedule';
import { planBalance, templateByKey, type SkillTemplate, type TemplateStep } from '../../domain/templates';
import { isRate } from '../../domain/points';
import { isoWeekday, localDate } from '../../lib/dates';
import { parseDecimal } from '../../lib/format';
import { useBottomButtons } from '../../platform/buttons';
import { haptics } from '../../platform/haptics';
import { validateNewStep } from '../../services/steps';
import { errorMessage } from '../completionFeedback';
import { Sheet } from '../components/Sheet';
import { draftOf, patchOf, StepFields, type Draft, type EstimatePlan } from '../components/StepFields';
import { themeText } from '../progress/registry';
import { templatesCopy } from './strings';

// «Действия из шаблона» of the new-skill form (v0.5 package 16, a lazy chunk loaded with the
// template, ui/templates/lazy.tsx): the template's actions with a checkbox each (all on) and
// «Изменить», which opens the step form's own fields (components/StepFields) in a sheet — the
// same fields, previews and schedule as «Новое действие», estimated against the capacities typed
// in the form. Nothing is written here: the form creates the skill and the checked actions in
// one transaction (services/skills.ts createSkill). Under the list, what the checked actions
// bring when done as planned (domain/templates.ts planBalance), in the words of the chosen theme.

const t = templatesCopy.actions;

/** One template action in the form: on or off, and its fields as the step form edits them. */
export interface StepChoice {
  id: string;
  on: boolean;
  draft: Draft;
}

/** The form's starting point: the template and its actions, all on. */
export function templateChoices(template: SkillTemplate): StepChoice[] {
  return template.steps.map((step, i) => ({ id: `${template.key}-${i}`, on: true, draft: draftOfTemplate(step) }));
}

function draftOfTemplate(step: TemplateStep): Draft {
  return draftOf({
    name: step.name,
    type: step.type,
    points: step.points ?? 0,
    pointsPerMinute: step.pointsPerMinute ?? null,
    defaultMinutes: step.defaultMinutes ?? null,
    schedule: step.schedule,
  });
}

/** For the loader (lazy.tsx): the catalogue comes with this chunk. */
export { templateByKey };

/** The draft as a planned step, or null while a field is not a valid value. */
function plannedStep(draft: Draft): Pick<TemplateStep, 'type' | 'points' | 'pointsPerMinute' | 'defaultMinutes' | 'schedule'> | null {
  if (draft.type === 'BOOLEAN') return draft.points !== null && draft.points >= 1 ? { type: 'BOOLEAN', points: draft.points, schedule: draft.schedule } : null;
  const rate = parseDecimal(draft.rate);
  if (rate === null || !isRate(rate)) return null;
  return { type: 'TIMED', pointsPerMinute: rate, defaultMinutes: draft.minutes ?? undefined, schedule: draft.schedule };
}

function meta(draft: Draft): string {
  const schedule = describeSchedule(draft.schedule);
  if (draft.type === 'BOOLEAN') return t.metaPoints(draft.points ?? 0, schedule);
  return t.metaTimed(parseDecimal(draft.rate) ?? 0, draft.minutes, schedule);
}

export interface TemplateActionsProps {
  choices: readonly StepChoice[];
  onChange(next: StepChoice[]): void;
  /** The capacities and theme as the form has them now: the sheet's estimate and the plan line. */
  plan: EstimatePlan | null;
  disabled: boolean;
}

export default function TemplateActions({ choices, onChange, plan, disabled }: TemplateActionsProps) {
  const titleId = useId();
  const [editing, setEditing] = useState<StepChoice | null>(null);
  const [open, setOpen] = useState(false);
  const replace = (next: StepChoice) => onChange(choices.map((c) => (c.id === next.id ? next : c)));
  const checked = choices.filter((c) => c.on);

  let planLine: string | null = null;
  if (plan && checked.length > 0) {
    const steps = checked.map((c) => plannedStep(c.draft));
    if (steps.every((s) => s !== null)) {
      const balance = planBalance(steps, plan.config, plan.target, isoWeekday(localDate()));
      if (Number.isFinite(balance.milestoneDays)) planLine = t.plan(themeText(plan.theme), balance.firstLevelDays, balance.milestoneDays);
    }
  }

  return (
    <section className="form-section template-actions" aria-labelledby={titleId}>
      <h2 className="section-title" id={titleId}>
        {t.title}
      </h2>
      <ul className="card list template-action-list">
        {choices.map((choice) => (
          <li key={choice.id} className={`template-action${choice.on ? '' : ' is-off'}`}>
            <label className="template-action-main">
              <input
                type="checkbox"
                className="checkbox"
                checked={choice.on}
                disabled={disabled}
                onChange={(event) => {
                  haptics.select();
                  replace({ ...choice, on: event.target.checked });
                }}
              />
              <span className="template-action-text">
                <span className="template-action-name">{choice.draft.name}</span>
                <span className="template-action-meta">{meta(choice.draft)}</span>
              </span>
            </label>
            <button
              type="button"
              className="text-button template-action-edit"
              aria-label={t.editLabel(choice.draft.name)}
              disabled={disabled}
              onClick={() => {
                setEditing(choice);
                setOpen(true);
              }}
            >
              {t.edit}
            </button>
          </li>
        ))}
      </ul>
      <p className="hint small field-hint template-actions-plan" aria-live="polite">
        {checked.length === 0 ? t.none : (planLine ?? t.hint)}
      </p>
      <ActionSheet
        open={open}
        choice={editing}
        plan={plan ?? undefined}
        onClose={() => setOpen(false)}
        // Saving an action turns it on: it was edited to be used.
        onSave={(draft) => editing && replace({ ...editing, on: true, draft })}
      />
    </section>
  );
}

interface ActionSheetProps {
  open: boolean;
  choice: StepChoice | null;
  plan: EstimatePlan | undefined;
  onClose(): void;
  onSave(draft: Draft): void;
}

/** The step form's fields for one template action; «Готово» (the MainButton in Telegram) keeps them. */
function ActionSheet({ open, choice, plan, onClose, onSave }: ActionSheetProps) {
  const [draft, setDraft] = useState<Draft | null>(choice?.draft ?? null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<() => void>(() => {});
  // Every opening starts from the action as the list has it.
  useEffect(() => {
    if (!open || !choice) return;
    setDraft(choice.draft);
    setError(null);
  }, [open, choice]);

  function done() {
    if (!draft) return;
    try {
      // The service's own rules, before anything is written: the form's save must not fail on it.
      validateNewStep(patchOf(draft));
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
      return;
    }
    closeRef.current();
    onSave(draft);
  }

  const { native } = useBottomButtons({ main: open ? { text: templatesCopy.sheet.done, onClick: done } : undefined }, 1);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={templatesCopy.sheet.title}
      closeRef={closeRef}
      className="template-action-sheet"
      footer={
        native ? undefined : (
          <button type="button" className="button button-primary button-block" onClick={done}>
            {templatesCopy.sheet.done}
          </button>
        )
      }
    >
      {draft && (
        <div className="form">
          <StepFields draft={draft} onChange={setDraft} skillId="" plan={plan} typeLocked={false} />
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
