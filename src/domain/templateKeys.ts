// The keys of the skill templates (v0.5 package 16). Only the keys live in the initial load:
// the deep link `new_<key>` and the routes `/skills/new/<key>` check them strictly before the
// catalogue itself (domain/templates.ts, a lazy chunk) is ever loaded. templates.test.ts keeps
// this list and the catalogue equal.

export const TEMPLATE_KEYS = [
  'english',
  'guitar',
  'piano',
  'vocal',
  'running',
  'strength',
  'yoga',
  'reading',
  'coding',
  'drawing',
  'meditation',
  'chess',
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** The route segment of «Свой навык»: the empty form, after the chooser. */
export const CUSTOM_TEMPLATE = 'custom';
