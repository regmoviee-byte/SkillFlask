import { useRef } from 'react';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

export interface ContextItem {
  icon?: IconName;
  label: string;
  tone?: 'danger';
  /**
   * Runs in the tap itself, before the sheet closes: for what needs the user's gesture (iOS
   * WebKit refuses the clipboard after it). `onSelect` still runs once the sheet has closed.
   */
  onTap?(): void;
  onSelect(): void;
}

interface ContextSheetProps {
  open: boolean;
  /** Called when the sheet closes; `selected` is the chosen item, undefined on dismissal. */
  onClose(selected?: ContextItem): void;
  title?: string;
  /** Optional text above the list (popups outside Telegram show their message here). */
  message?: string;
  items: ContextItem[];
}

/**
 * A list of actions. Picking one closes the sheet first (its history entry is popped) and
 * only then runs `onSelect`, so an action that navigates or opens another sheet sees a
 * consistent history.
 */
export function ContextSheet({ open, onClose, title, message, items }: ContextSheetProps) {
  const pending = useRef<ContextItem | null>(null);
  const closeRef = useRef<() => void>(() => {});

  return (
    <Sheet
      open={open}
      title={title}
      onClose={() => {
        const item = pending.current;
        pending.current = null;
        onClose(item ?? undefined);
        item?.onSelect();
      }}
      ariaLabel={message}
      closeRef={closeRef}
    >
      {message && <p className="confirm-message">{message}</p>}
      <ul className="context-list">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              className={`context-item pressable-row${item.tone === 'danger' ? ' tone-danger' : ''}`}
              onClick={() => {
                if (pending.current) return; // a second tap while closing keeps the first choice
                pending.current = item;
                item.onTap?.();
                closeRef.current();
              }}
            >
              {item.icon && <Icon name={item.icon} />}
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
