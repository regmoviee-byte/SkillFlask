import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { backupStats, type BackupFile } from '../../data/backup';
import { importFromFile, parseBackupText, readBackupFile } from '../../services/exportFile';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { errorMessage } from '../completionFeedback';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { copy } from '../copy';

// «Загрузить из файла»: a file picker or pasted text → parse and migrate → a preview of what
// the copy holds → confirm → replace. Nothing is written before the confirmation.

const t = copy.backupImport;

export function ImportSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<BackupFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<() => void>(() => {});
  // Runs once the sheet has closed (its history entry popped), so navigating is safe.
  const afterClose = useRef<(() => void) | null>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    if (!open) return;
    setText('');
    setFile(null);
    setError(null);
    setBusy(false);
  }, [open]);

  async function load(read: () => Promise<BackupFile>) {
    setBusy(true);
    setError(null);
    setFile(null);
    try {
      setFile(await read());
      haptics.tap();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    // Choosing the same file again must fire change again.
    event.target.value = '';
    if (!chosen) return;
    // One source at a time: the pasted text would read as part of the file's preview.
    setText('');
    void load(() => readBackupFile(chosen));
  }

  async function replace() {
    if (!file || busy) return;
    // Rule: dialogs.confirm runs synchronously in the click handler, before any await.
    const ok = await dialogs.confirm(t.confirm(file.exportedAt), { okLabel: t.confirmOk, danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await importFromFile(file);
      haptics.success();
      afterClose.current = () => {
        showToast(t.imported);
        navigate('/skills');
      };
      closeRef.current();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const stats = file ? backupStats(file) : null;

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
        const next = afterClose.current;
        afterClose.current = null;
        next?.();
      }}
      title={t.title}
      closeRef={closeRef}
      className="import-sheet"
      footer={
        file ? (
          <button type="button" className="button button-primary button-block" disabled={busy} onClick={replace}>
            {t.replace}
          </button>
        ) : undefined
      }
    >
      <label className={`button button-block file-button${busy ? ' is-disabled' : ''}`}>
        <Icon name="upload" size={20} />
        {t.chooseFile}
        <input type="file" accept=".json,application/json" className="visually-hidden" disabled={busy} onChange={onFile} />
      </label>

      <label className="field">
        <span className="field-label">{t.pasteLabel}</span>
        <textarea
          className="input paste-input"
          rows={3}
          value={text}
          placeholder={t.pastePlaceholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => {
            setText(e.target.value);
            // Editing the text drops a checked file or text: «Заменить данные» must import what is shown.
            setFile(null);
            setError(null);
          }}
        />
      </label>
      <button type="button" className="button button-block" disabled={!text.trim() || busy} onClick={() => void load(async () => parseBackupText(text))}>
        {t.check}
      </button>

      <div aria-live="polite">
        {busy && !file && <p className="hint small center">{t.reading}</p>}
        {error && <p className="error">{error}</p>}
        {file && stats && (
          <div className="backup-preview">
            <Icon name="archive" size={24} className="backup-preview-icon" />
            <div>
              <p className="backup-preview-title">{t.previewTitle}</p>
              <p className="hint small">{t.preview(stats.skills, stats.completions, stats.lastDate, file.exportedAt)}</p>
              <p className="hint small">{t.replaceHint}</p>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
