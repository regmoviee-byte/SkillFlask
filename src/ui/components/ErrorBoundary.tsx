import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../../platform/errorLog';
import { copy } from '../copy';
import { Illustration } from '../illustrations';

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
      </div>
    );
  }
}
