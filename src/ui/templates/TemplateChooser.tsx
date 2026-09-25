import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { TEMPLATES } from '../../domain/templates';
import { CUSTOM_TEMPLATE } from '../../domain/templateKeys';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { copy } from '../copy';
import { ProgressMini } from '../progress/ProgressHero';
import { colorScope } from '../progress/registry';
import type { ProgressThemeKey } from '../progress/contract';
import { clearDrafts } from './drafts';
import { templatesCopy } from './strings';

// «Новый навык» (v0.5 package 16, a lazy chunk): what the new skill will be about, before the
// form. The first card is «Свой навык» — the empty form as before; then the twelve templates,
// each with its suggested theme's mini at 40 % in its colour on a tile of that colour (the tiles
// keep the grid even whatever the drawing), its name and one line. A card
// opens the new-skill form prefilled from the template (`/skills/new/<key>`) in place of the
// chooser; the form's «Назад» comes back here with that card marked (`?chosen=<key>`), in view
// and focused, so the choice is not lost — and the same card brings the form's edits back.

const t = templatesCopy.chooser;

/**
 * Names with a word wider than a card on a 320–390 px phone, with the places it may break (U+00AD,
 * drawn as a hyphen only at a line end): not every WebView hyphenates Russian by itself. Only
 * for the card: the form gets the name as it is.
 */
const CARD_NAMES: Readonly<Record<string, string>> = { Программирование: 'Про\u00adграм\u00adми\u00adро\u00adва\u00adние' };

/**
 * The minis are drawn at 40 %; a few only read as themselves further on (the flower is a
 * sprout at 40 %, the tower a bare column of empty slots), so they show a fuller picture.
 */
const CARD_FILL: Partial<Record<ProgressThemeKey, number>> = { flower: 0.75, tower: 0.75 };
const DEFAULT_CARD_FILL = 0.4;

export default function TemplateChooser() {
  const [params] = useSearchParams();
  const chosen = params.get('chosen');
  const chosenRef = useRef<HTMLAnchorElement>(null);

  // A new «Новый навык» (not a return from a form) starts every template afresh (ui/templates/drafts).
  useEffect(() => {
    if (chosen === null) clearDrafts();
    // Once, for the chooser as it opened.
  }, []);

  useEffect(() => {
    const card = chosenRef.current;
    if (!card) return;
    card.scrollIntoView?.({ block: 'center' });
    card.focus({ preventScroll: true });
  }, []);

  const cardProps = (key: string) =>
    key === chosen ? { ref: chosenRef, 'aria-current': true as const, className: 'template-card pressable is-chosen' } : { className: 'template-card pressable' };

  return (
    <Screen title={copy.skillForm.titleNew} back="/skills">
      <p className="hint template-intro">{t.intro}</p>
      <ul className="template-grid" aria-label={t.listLabel}>
        <li>
          <Link to={`/skills/new/${CUSTOM_TEMPLATE}`} replace {...cardProps(CUSTOM_TEMPLATE)}>
            <span className="template-card-art template-card-art--custom" aria-hidden="true">
              <Icon name="plus" size={26} />
            </span>
            <span className="template-card-name">{t.customName}</span>
            <span className="template-card-text">{t.customText}</span>
          </Link>
        </li>
        {TEMPLATES.map((template) => (
          <li key={template.key} {...colorScope(template.color)}>
            <Link to={`/skills/new/${template.key}`} replace {...cardProps(template.key)}>
              <span className="template-card-art" aria-hidden="true">
                <ProgressMini theme={template.theme} fill={CARD_FILL[template.theme] ?? DEFAULT_CARD_FILL} size={40} />
              </span>
              <span className="template-card-name">{CARD_NAMES[template.name] ?? template.name}</span>
              <span className="template-card-text">{template.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
