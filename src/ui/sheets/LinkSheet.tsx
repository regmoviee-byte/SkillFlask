import { useRef } from 'react';
import { copyText } from '../../platform/clipboard';
import { Sheet } from '../components/Sheet';
import { copy } from '../copy';

const t = copy.skillLink;

/**
 * «Ссылка на навык» when the clipboard refused (the menu's copy): «Скопировать» tries again
 * inside its own tap, and where that fails too, selects the read-only link to copy by hand.
 */
export function LinkSheet({
  link,
  telegram,
  onClose,
  onCopied,
}: {
  link: string | null;
  telegram: boolean;
  onClose(): void;
  onCopied(): void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  // The link stays drawn while the sheet slides away.
  const last = useRef('');
  if (link !== null) last.current = link;

  function selectAll() {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.select();
    // iOS ignores select() on a read-only field without an explicit range.
    el.setSelectionRange(0, el.value.length);
  }

  async function copyLink() {
    if (link === null) return;
    // Selected first, still inside the tap (iOS may refuse focus after it): where the copy
    // fails, the link is ready for the system's own «Скопировать».
    selectAll();
    if (await copyText(link)) {
      onClose();
      onCopied();
    }
  }

  return (
    <Sheet
      open={link !== null}
      onClose={onClose}
      title={t.title}
      className="backup-text-sheet link-sheet"
      footer={
        <button type="button" className="button button-primary button-block" onClick={() => void copyLink()}>
          {t.copy}
        </button>
      }
    >
      <p className="hint small">{telegram ? t.hintTelegram : t.hintBrowser}</p>
      <textarea ref={field} className="input backup-text" readOnly rows={3} value={link ?? last.current} aria-label={t.field} spellCheck={false} />
    </Sheet>
  );
}
