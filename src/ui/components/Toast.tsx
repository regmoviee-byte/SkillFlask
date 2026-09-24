import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useScreenFooterHeight } from './Screen';
import { useHasTabBar } from './TabBar';

// One toast at a time: a new one replaces the old. Tap or swipe down dismisses; an action
// («Отменить») keeps it on screen longer. Positioned above the tab bar when there is one.
// Leaving the screen dismisses a plain toast (a skill-specific message would read as stale on
// another screen); a toast with an action stays until it is used or times out.

export interface ToastOptions {
  action?: { label: string; onClick(): void };
  durationMs?: number;
  icon?: IconName;
}

export type ShowToast = (message: string, options?: ToastOptions) => void;

const DEFAULT_MS = 2600;
const WITH_ACTION_MS = 6000;
// A toast shown by the handler that also navigates («Навык удалён» → /skills) belongs to the
// new screen: it lands in the same render as the route change and is kept.
const SAME_NAVIGATION_MS = 100;

interface ToastState extends ToastOptions {
  key: number;
  message: string;
  shownAt: number;
}

const ToastContext = createContext<{ showToast: ShowToast }>({ showToast: () => {} });

let globalShow: ShowToast = () => {};

/** Module-level entry point for code outside React (services, platform). */
export const showToast: ShowToast = (message, options) => globalShow(message, options);

export function ToastProvider({ children, routeKey }: { children: ReactNode; routeKey?: string }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const counter = useRef(0);
  const previousRoute = useRef(routeKey);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback<ShowToast>((message, options = {}) => {
    window.clearTimeout(timer.current);
    counter.current += 1;
    setToast({ key: counter.current, message, shownAt: performance.now(), ...options });
    const ms = options.durationMs ?? (options.action ? WITH_ACTION_MS : DEFAULT_MS);
    timer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(() => {
    if (previousRoute.current === routeKey) return;
    previousRoute.current = routeKey;
    setToast((current) => (current && !current.action && performance.now() - current.shownAt > SAME_NAVIGATION_MS ? null : current));
  }, [routeKey]);

  useEffect(() => {
    globalShow = show;
    return () => {
      globalShow = () => {};
    };
  }, [show]);

  return (
    <ToastContext.Provider value={{ showToast: show }}>
      {children}
      {toast && <ToastView key={toast.key} toast={toast} onDismiss={dismiss} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastState; onDismiss(): void }) {
  const hasTabBar = useHasTabBar();
  // A nested screen with a sticky footer (one or two HTML bottom buttons) needs the toast
  // above it. The height comes from the mounted Screen and follows it live: a toast shown by
  // a handler that navigates outlives the screen it started on, and the next screen's footer
  // may appear only once its data loads. The CSS rule is the fallback without layout (0).
  const footerHeight = useScreenFooterHeight();
  const aboveFooter = !hasTabBar && footerHeight !== null;
  const startY = useRef<number | null>(null);

  return (
    <div
      className={`toast${toast.action ? ' has-action' : ''}${hasTabBar ? ' above-tab-bar' : aboveFooter ? ' above-footer' : ''}`}
      style={aboveFooter && footerHeight > 0 ? { bottom: `calc(var(--kb) + ${footerHeight}px + var(--sp-4))` } : undefined}
      role="status"
      onClick={onDismiss}
      onTouchStart={(event) => {
        startY.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchMove={(event) => {
        const y = event.touches[0]?.clientY;
        if (startY.current !== null && y !== undefined && y - startY.current > 24) {
          startY.current = null;
          onDismiss();
        }
      }}
    >
      {toast.icon && (
        <span className="toast-icon">
          <Icon name={toast.icon} size={20} />
        </span>
      )}
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
            toast.action!.onClick();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
