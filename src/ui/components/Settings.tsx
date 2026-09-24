import { useId, type ReactNode } from 'react';
import { haptics } from '../../platform/haptics';
import { Icon, type IconName } from './Icon';

// Grouped settings list in the iOS/Telegram manner: a section title, one card of 52 px rows,
// an optional footnote. A row is plain text, a switch, or a button (accent or danger tone).

export function SettingsGroup({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={title ? id : undefined}>
      {title && (
        <h2 className="section-title" id={id}>
          {title}
        </h2>
      )}
      <ul className="card list settings-card">{children}</ul>
      {footer && <p className="settings-footer">{footer}</p>}
    </section>
  );
}

export interface ToggleSpec {
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
}

export interface SettingsRowProps {
  label: ReactNode;
  /** Second line under the label. */
  hint?: ReactNode;
  icon?: IconName;
  /** Right-hand value text. */
  value?: ReactNode;
  toggle?: ToggleSpec;
  /** Makes the row a button. */
  onClick?(): void;
  tone?: 'accent' | 'danger';
  chevron?: 'right' | 'down' | 'up';
  disabled?: boolean;
  /** aria-expanded of a disclosure row. */
  expanded?: boolean;
}

export function SettingsRow({ label, hint, icon, value, toggle, onClick, tone, chevron, disabled, expanded }: SettingsRowProps) {
  const labelId = useId();
  const hintId = useId();
  // The label names the control; the hint describes it (it is not part of the name).
  const a11y = { 'aria-labelledby': labelId, 'aria-describedby': hint ? hintId : undefined };
  const text = (
    <span className="settings-row-text">
      <span className="settings-row-label" id={labelId}>
        {label}
      </span>
      {hint && (
        <span className="settings-row-hint" id={hintId}>
          {hint}
        </span>
      )}
    </span>
  );
  const iconNode = icon && <Icon name={icon} size={22} className="settings-row-icon" />;

  if (toggle) {
    return (
      <li>
        <label className={`settings-row${toggle.disabled ? ' is-disabled' : ''}`}>
          {iconNode}
          {text}
          <input
            type="checkbox"
            role="switch"
            className="toggle"
            checked={toggle.checked}
            disabled={toggle.disabled}
            {...a11y}
            onChange={(event) => {
              toggle.onChange(event.target.checked);
              // After the change, so switching «Виброотклик» on is felt and off is silent.
              haptics.select();
            }}
          />
        </label>
      </li>
    );
  }

  const tail = (
    <>
      {value !== undefined && <span className="settings-row-value">{value}</span>}
      {chevron && <Icon name={chevron === 'right' ? 'chevron-right' : 'chevron-down'} size={18} className={`settings-row-chevron${chevron === 'up' ? ' is-up' : ''}`} />}
    </>
  );

  if (onClick) {
    return (
      <li>
        <button
          type="button"
          className={`settings-row settings-button pressable-row${tone ? ` tone-${tone}` : ''}`}
          onClick={onClick}
          disabled={disabled}
          aria-expanded={expanded}
          {...a11y}
        >
          {iconNode}
          {text}
          {tail}
        </button>
      </li>
    );
  }

  return (
    <li>
      <div className="settings-row">
        {iconNode}
        {text}
        {tail}
      </div>
    </li>
  );
}
