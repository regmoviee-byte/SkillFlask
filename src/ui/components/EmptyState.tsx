import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Illustration, type IllustrationName } from '../illustrations';

interface EmptyStateProps {
  illustration: IllustrationName;
  title: string;
  text?: string;
  /** One primary button: a link when `to` is set, otherwise a click handler. */
  action?: { label: string; to?: string; onClick?(): void; replace?: boolean };
  secondary?: ReactNode;
  /** Content between the text and the button (the first run's template chips). */
  children?: ReactNode;
}

export function EmptyState({ illustration, title, text, action, secondary, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Illustration name={illustration} />
      <p className="t-title-m">{title}</p>
      {text && <p className="empty-state-text">{text}</p>}
      {children}
      {action &&
        (action.to ? (
          <Link to={action.to} className="button button-primary empty-state-action" replace={action.replace}>
            {action.label}
          </Link>
        ) : (
          <button type="button" className="button button-primary empty-state-action" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
      {secondary}
    </div>
  );
}
