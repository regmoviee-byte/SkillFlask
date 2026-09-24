import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { isTelegram, useTelegramBackButton } from '../../telegram';
import { copy } from '../copy';

/** Goes back in app history, or to `fallback` when the screen was opened directly. */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

interface ScreenProps {
  title: string;
  /** Fallback path for the back button; no back button when omitted. */
  back?: string;
  /** Back replaces the current entry with `back` instead of going through history (for screens that replaced their opener). */
  replaceBack?: boolean;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function Screen({ title, back, replaceBack, action, children, footer }: ScreenProps) {
  const navigate = useNavigate();
  const historyBack = useGoBack(back ?? '/');
  const goBack = replaceBack ? () => navigate(back ?? '/', { replace: true }) : historyBack;
  useTelegramBackButton(back !== undefined ? goBack : undefined);
  // Inside Telegram the native back button in the header is used instead.
  const showBack = back !== undefined && !isTelegram();

  return (
    <div className="screen">
      <header className="screen-header">
        <div className="screen-header-side">
          {showBack && (
            <button type="button" className="icon-button" onClick={goBack} aria-label={copy.common.back}>
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        <h1 className="screen-title">{title}</h1>
        <div className="screen-header-side screen-header-action">{action}</div>
      </header>
      <main className="screen-body">{children}</main>
      {footer && <div className="screen-footer">{footer}</div>}
    </div>
  );
}
