import { Link } from 'react-router';
import { CUSTOM_TEMPLATE } from '../../domain/templateKeys';
import type { IllustrationName } from '../illustrations';
import { copy } from '../copy';
import { EmptyState } from './EmptyState';

// The empty state of a device without skills (home and «Сегодня», after the cloud-restore offer
// was declined or never shown): the templates first (v0.5 package 16) — a few popular ones as
// chips straight to their prefilled form, «Все шаблоны» to the chooser, «Свой навык» to the
// empty form. The chips' names live in copy.ts, so the catalogue stays a lazy chunk.

const t = copy.firstRun;

export function FirstRunEmpty({ illustration, title }: { illustration: IllustrationName; title: string }) {
  return (
    <EmptyState
      illustration={illustration}
      title={title}
      text={t.text}
      action={{ label: t.allTemplates, to: '/skills/new' }}
      secondary={
        <Link to={`/skills/new/${CUSTOM_TEMPLATE}`} className="text-button first-run-custom">
          {t.custom}
        </Link>
      }
    >
      <ul className="first-run-chips" aria-label={t.popularLabel}>
        {t.popular.map(({ key, name }) => (
          <li key={key}>
            <Link to={`/skills/new/${key}`} className="chip">
              {name}
            </Link>
          </li>
        ))}
      </ul>
    </EmptyState>
  );
}
