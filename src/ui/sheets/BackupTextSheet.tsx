import { useRef } from 'react';
import { Sheet } from '../components/Sheet';
import { copy } from '../copy';

const t = copy.backupText;

/** Last step of the export cascade: the backup as read-only text to copy by hand. */
export function BackupTextSheet({ text, onClose }: { text: string | null; onClose(): void }) {
  const field = useRef<HTMLTextAreaElement>(null);

  function selectAll() {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.select();
    // iOS ignores select() on a read-only field without an explicit range.
    el.setSelectionRange(0, el.value.length);
  }

  return (
    <Sheet
      open={text !== null}
      onClose={onClose}
      title={t.title}
      className="backup-text-sheet"
      footer={
        <button type="button" className="button button-primary button-block" onClick={selectAll}>
          {t.selectAll}
        </button>
      }
    >
      <p className="hint small">{t.hint}</p>
      <textarea ref={field} className="input backup-text" readOnly rows={8} value={text ?? ''} aria-label={t.field} spellCheck={false} />
    </Sheet>
  );
}
