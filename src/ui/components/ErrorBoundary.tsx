import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../../platform/errorLog';
import { exportToFile } from '../../services/exportFile';
import { errorMessage } from '../completionFeedback';
import { copy } from '../copy';
import { Illustration } from '../illustrations';
import { useToast } from './Toast';

interface State {
  error: Error | null;
}

/** Catches render errors so a broken screen never leaves a blank page; the data is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError(error, info.componentStack ? `render${info.componentStack.split('\n')[1] ?? ''}` : 'render');
  }

  render() {
    if (!this.state.error) return this.props.children;
    const t = copy.errorBoundary;
    return (
      <div className="error-screen" role="alert">
        <Illustration name="history" />
        <p className="t-title-m">{t.title}</p>
        <p className="hint">{t.text}</p>
        <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
          {t.reload}
        </button>
        <SaveCopyButton />
      </div>
    );
  }
}

/** «Сохранить копию данных»: the file export cascade; its last step shows the text in place. */
function SaveCopyButton() {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      const outcome = await exportToFile();
      if (outcome.kind === 'text') setText(outcome.text);
      else if (outcome.kind === 'clipboard') showToast(copy.settings.fileCopied(outcome.kb), { durationMs: 6000 });
      else if (outcome.kind !== 'cancelled') showToast(copy.settings.fileSaved);
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (text !== null) {
    return <textarea className="input backup-text" readOnly rows={6} value={text} aria-label={copy.backupText.field} onFocus={(e) => e.currentTarget.select()} />;
  }
  return (
    <button type="button" className="button" disabled={busy} onClick={() => void save()}>
      {copy.errorBoundary.saveCopy}
    </button>
  );
}
