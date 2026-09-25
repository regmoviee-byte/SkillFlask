import type { StepChoice } from './TemplateActions';

// What the owner changed on a new-skill form (a template's or «Свой навык»), per template key,
// for this session only (memory, not storage). «Назад» from the form puts the chooser back with
// the card marked; choosing that card again brings the edits back instead of a fresh template —
// the unchecked actions stay off, the edited ones stay edited. A new pass through the chooser
// (opened without `?chosen=`) starts clean, and a created skill takes its draft with it.

export interface NewSkillDraft<F> {
  /** The form fields the owner changed. */
  edits: Partial<F>;
  /** The template's actions as the owner left them; null — as the template has them. */
  stepEdits: StepChoice[] | null;
}

const drafts = new Map<string, NewSkillDraft<unknown>>();

export function draftOf<F>(key: string): NewSkillDraft<F> | undefined {
  return drafts.get(key) as NewSkillDraft<F> | undefined;
}

/** Keeps the form's edits; a form without edits leaves no draft. */
export function keepDraft<F>(key: string, draft: NewSkillDraft<F>): void {
  if (Object.keys(draft.edits).length === 0 && draft.stepEdits === null) drafts.delete(key);
  else drafts.set(key, draft);
}

export function dropDraft(key: string): void {
  drafts.delete(key);
}

export function clearDrafts(): void {
  drafts.clear();
}
