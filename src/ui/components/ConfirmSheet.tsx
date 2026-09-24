import { useRef } from 'react';
import { copy } from '../copy';
import { Sheet } from './Sheet';

interface ConfirmSheetProps {
  open: boolean;
  message: string;
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Called once with the choice; dismissing (scrim, back) counts as cancel. */
  onResult(ok: boolean): void;
}

/**
 * In-app replacement for Telegram's showConfirm outside Telegram. A button answer closes the
 * sheet first (its history entry is popped) and reports the choice from the sheet's onClose,
 * so a caller that navigates on the answer sees a consistent history.
 */
export function ConfirmSheet({ open, message, title, okLabel, cancelLabel, danger, onResult }: ConfirmSheetProps) {
  const answer = useRef(false);
  const pending = useRef(false);
  const closeRef = useRef<() => void>(() => {});
  // The first tap decides; a second one while the sheet is still closing must not change it.
  const choose = (ok: boolean) => {
    if (pending.current) return;
    pending.current = true;
    answer.current = ok;
    closeRef.current();
  };

  return (
    <Sheet
      open={open}
      title={title}
      ariaLabel={copy.sheet.confirmLabel}
      onClose={() => {
        const ok = answer.current;
        answer.current = false;
        pending.current = false;
        onResult(ok);
      }}
      closeRef={closeRef}
      footer={
        <div className="button-row">
          <button type="button" className="button" onClick={() => choose(false)}>
            {cancelLabel ?? copy.sheet.cancel}
          </button>
          <button type="button" className={`button ${danger ? 'button-danger' : 'button-primary'}`} style={{ marginTop: 0 }} onClick={() => choose(true)}>
            {okLabel ?? copy.sheet.ok}
          </button>
        </div>
      }
    >
      <p className="confirm-message">{message}</p>
    </Sheet>
  );
}
