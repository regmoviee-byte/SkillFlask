import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useBottomButtons, type ButtonSpec, type SecondaryButtonSpec } from '../../platform/buttons';
import { API, supports, useTelegramBackButton } from '../../platform/telegram';
import { copy } from '../copy';
import { Icon } from './Icon';
import { useHasTabBar } from './TabBar';

/** Goes back in app history, or to `fallback` when the screen was opened directly. */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

// ---- Sticky footer height, for overlays that must stay above it (the toast) ----
// Published by the mounted Screen and re-measured while its footer changes size (a second
// button, 130 % font scale); null when the current screen has no HTML footer.

let footerHeight: number | null = null;
const footerListeners = new Set<() => void>();

function publishFooterHeight(height: number | null): void {
  if (height === footerHeight) return;
  footerHeight = height;
  footerListeners.forEach((cb) => cb());
}

function subscribeFooter(cb: () => void): () => void {
  footerListeners.add(cb);
  return () => footerListeners.delete(cb);
}

/** Height of the current screen's sticky footer (safe-bottom padding included), null without one. */
export function useScreenFooterHeight(): number | null {
  return useSyncExternalStore(subscribeFooter, () => footerHeight);
}

interface ScreenProps {
  title: string;
  /** Fallback path for the back button; no back button when omitted. */
  back?: string;
  /** Back replaces the current entry with `back` instead of going through history (for screens that replaced their opener). */
  replaceBack?: boolean;
  /** Root screens: a 28px title in the body, the header title fades in after 40px of scroll. */
  largeTitle?: boolean;
  action?: ReactNode;
  children: ReactNode;
  /** Bottom buttons: native MainButton/SecondaryButton inside Telegram, HTML footer buttons otherwise. */
  primary?: ButtonSpec;
  secondary?: SecondaryButtonSpec;
  /** Custom footer content, always rendered as HTML. */
  footer?: ReactNode;
}

export function Screen({ title, back, replaceBack, largeTitle = false, action, children, primary, secondary, footer }: ScreenProps) {
  const navigate = useNavigate();
  const historyBack = useGoBack(back ?? '/');
  const goBack = replaceBack ? () => navigate(back ?? '/', { replace: true }) : historyBack;
  useTelegramBackButton(back !== undefined ? goBack : undefined);
  // Telegram ≥ 6.1 shows its own BackButton in the header; older clients keep the HTML one.
  const showBack = back !== undefined && !supports(API.backButton);
  const hasTabBar = useHasTabBar();
  const { native, nativeSecondary } = useBottomButtons({ main: primary, secondary });
  const htmlPrimary = primary && !native ? primary : undefined;
  const htmlSecondary = secondary && !nativeSecondary ? secondary : undefined;
  const showFooter = footer !== undefined && footer !== null && footer !== false;
  const hasFooter = showFooter || htmlPrimary !== undefined || htmlSecondary !== undefined;
  const titleId = useId();

  const footerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) {
      publishFooterHeight(null);
      return;
    }
    const measure = () => publishFooterHeight(el.offsetHeight);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      publishFooterHeight(null);
    };
  }, [hasFooter]);

  // Large-title screens: the compact header title appears once the sentinel scrolls under the header.
  const sentinel = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const [compactVisible, setCompactVisible] = useState(!largeTitle);
  useEffect(() => {
    if (!largeTitle) return;
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver !== 'function') return;
    const top = header.current?.getBoundingClientRect().height ?? 52;
    const observer = new IntersectionObserver(([entry]) => setCompactVisible(entry ? !entry.isIntersecting && entry.boundingClientRect.top < top : false), {
      rootMargin: `-${Math.round(top)}px 0px 0px 0px`,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [largeTitle]);

  return (
    <div className={`screen${hasTabBar ? ' has-tab-bar' : ''}${hasFooter ? ' has-footer' : ''}`}>
      <header className="screen-header" ref={header}>
        <div className="screen-header-side">
          {showBack && (
            <button type="button" className="icon-button" onClick={goBack} aria-label={copy.common.back}>
              <Icon name="chevron-left" />
            </button>
          )}
        </div>
        {largeTitle ? (
          <div className={`screen-title ${compactVisible ? 'is-visible' : 'is-hidden'}`} aria-hidden="true">
            {title}
          </div>
        ) : (
          <h1 className="screen-title" id={titleId}>
            {title}
          </h1>
        )}
        <div className="screen-header-side screen-header-action">{action}</div>
      </header>
      <main className="screen-body">
        {largeTitle && (
          <>
            <div className="screen-sentinel" ref={sentinel} aria-hidden="true" />
            <h1 className="t-title-l screen-large-title">{title}</h1>
          </>
        )}
        {children}
      </main>
      {hasFooter && (
        <div className="screen-footer" ref={footerRef}>
          {footer}
          {htmlPrimary && (
            <button type="button" className="button button-primary button-block" disabled={htmlPrimary.disabled || htmlPrimary.loading} onClick={htmlPrimary.onClick}>
              {htmlPrimary.text}
            </button>
          )}
          {htmlSecondary && (
            <button type="button" className="button button-secondary button-block" disabled={htmlSecondary.disabled || htmlSecondary.loading} onClick={htmlSecondary.onClick}>
              {htmlSecondary.text}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
