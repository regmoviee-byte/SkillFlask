import { Suspense, type ComponentType } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { CUSTOM_TEMPLATE, type TemplateKey } from '../../domain/templateKeys';
import { logError } from '../../platform/errorLog';
import { Screen } from '../components/Screen';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';
import type { SkillTemplate } from '../../domain/templates';
import type { StepChoice, TemplateActionsProps } from './TemplateActions';

// The entry points of the skill templates (v0.5 package 16) in the initial load: the chooser
// (`/skills/new`) and the template of the new-skill form (`/skills/new/<key>`) come from lazy
// chunks — the catalogue (domain/templates.ts), the chooser's cards and the form's «Действия из
// шаблона» with their strings — loaded the first time someone starts a new skill.

/**
 * A chooser chunk that fails to load leaves the empty form: a new skill can always be started.
 * Coming back from a form (its «Назад» puts the chooser back with `?chosen=`) goes on to the
 * skills, as the chooser's own «Назад» would: redirecting to the form again would trap the owner
 * between the two, and the form has no tab bar to leave by.
 */
function EmptyFormInstead() {
  const [params] = useSearchParams();
  if (params.has('chosen')) return <Navigate to="/skills" replace />;
  return <Navigate to={`/skills/new/${CUSTOM_TEMPLATE}`} replace />;
}

const Chooser = lazySafe(() => import('./TemplateChooser'), 'TemplateChooser', EmptyFormInstead);

/** `/skills/new`: the template chooser; its header (title, «Назад») stands while the chunk loads. */
export function TemplateChooserRoute() {
  return (
    <Suspense fallback={<Screen title={copy.skillForm.titleNew} back="/skills">{null}</Screen>}>
      <Chooser />
    </Suspense>
  );
}

/** A template for the form: its fields, its actions (all on) and the section that lists them. */
export interface LoadedTemplate {
  template: SkillTemplate;
  choices: StepChoice[];
  Actions: ComponentType<TemplateActionsProps>;
}

/**
 * Loads a template with the form's «Действия из шаблона» in one chunk, so the form renders the
 * section together with its fields instead of popping it in. Null when the chunk fails to load
 * (logged): the form then opens empty and says so (SkillFormScreen).
 */
export function loadTemplate(key: TemplateKey): Promise<LoadedTemplate | null> {
  return import('./TemplateActions').then(
    (module) => {
      const template = module.templateByKey(key);
      return template ? { template, choices: module.templateChoices(template), Actions: module.default } : null;
    },
    (error: unknown) => {
      logError(error, 'chunk TemplateActions');
      return null;
    },
  );
}
