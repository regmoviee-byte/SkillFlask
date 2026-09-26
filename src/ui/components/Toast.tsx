import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useScreenFooterHeight } from './Screen';
import { useHasTabBar } from './TabBar';

// One toast at a time: a new one replaces the old. Tap or swipe down dismisses; an action
// («Отменить») keeps it on screen longer. Positioned above the tab bar when there is one.
// Leaving the screen dismisses a plain toast (a skill-specific message would read as stale on
// another screen); a toast with an action stays until it is used or times out. A completion's
// toast has two: «Заметка» (the lighter one, first) and «Отменить».
//
// The toast floats over the bottom lane (thumb reach for «Отменить») and never moves content
// under the finger. Two guards keep it from hiding what the user needs next: it never covers
// the control that was just pressed or a section heading («История» right under the actions)
// — it rises just above them instead, never past the middle of the screen — and while it is
// shown the page end gets its height as extra room (--toast-room), so the last rows can
// always be scrolled out from under it. A running timer's pill (ui/timer) sits in the same lane
// just above the bars and publishes its height as --timer-room: the toast rises above it.

export interface ToastAction {
  label: string;
  onClick(): void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** A second, lighter action before the main one («Заметка» before «Отменить»); only with `action`. */
  secondary?: ToastAction;
  durationMs?: number;
  icon?: IconName;
}

export type ShowToast = (message: string, options?: ToastOptions) => void;

const DEFAULT_MS = 2600;
const WITH_ACTION_MS = 6000;
// A toast shown by the handler that also navigates («Навык удалён» → /skills) belongs to the
// new screen: it lands in the same render as the route change and is kept.
const SAME_NAVIGATION_MS = 100;
/** A press this recent is what the toast answers (a write takes a moment on a slow phone). */
const PRESS_MS = 2000;
const GAP = 8;

// The control pressed last, recorded for the toast that follows it.
let lastPress: { el: Element; at: number } | null = null;

function rememberPress(event: Event): void {
  if (event.target instanceof Element) lastPress = { el: event.target, at: performance.now() };
}

/**
 * The pressed control the toast must not cover: a recent press on the screen itself — not in
 * a sheet (it is closing), the footer or the tab bar (the toast already sits above those).
 */
function pressedControl(toast: Element): Element | null {
  if (!lastPress || performance.now() - lastPress.at > PRESS_MS || !lastPress.el.isConnected) return null;
  const el = lastPress.el.closest('button, a, [role="button"], label') ?? lastPress.el;
  if (toast.contains(el) || el.closest('.sheet, [role="dialog"], .screen-footer, .tab-bar, .timer-pill')) return null;
  return el;
}

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
    // Capture phase: recorded before the handler that shows the toast runs.
    document.addEventListener('click', rememberPress, true);
    return () => document.removeEventListener('click', rememberPress, true);
  }, []);

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
  const ref = useRef<HTMLDivElement>(null);
  // Bottom offset (px) that lifts the toast above the control just pressed; null: its lane.
  const [lift, setLift] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const root = document.documentElement;
    root.style.setProperty('--toast-room', `${Math.ceil(rect.height + 2 * GAP)}px`);
    const obstacles = [pressedControl(el), ...document.querySelectorAll('.screen-body .section-title')]
      .filter((o): o is Element => o !== null)
      .map((o) => o.getBoundingClientRect())
      .filter((r) => r.height > 0);
    // Rise above whatever sits in the lane, then check the new lane again.
    let bottom = rect.bottom;
    for (let moved = true; moved; ) {
      moved = false;
      for (const r of obstacles) {
        if (r.top < bottom && r.bottom > bottom - rect.height - GAP) {
          bottom = r.top - GAP;
          moved = true;
        }
      }
    }
    // Only from the lower half of the screen: it never climbs over the flask.
    if (bottom < rect.bottom && bottom - rect.height > window.innerHeight / 2) setLift(window.innerHeight - bottom);
    return () => {
      root.style.removeProperty('--toast-room');
    };
  }, []);

  const offset = lift !== null ? `${lift}px` : aboveFooter && footerHeight > 0 ? `calc(var(--kb) + ${footerHeight}px + var(--sp-4) + var(--timer-room, 0px))` : undefined;

  return (
    <div
      ref={ref}
      className={`toast${toast.action ? ' has-action' : ''}${toast.action && toast.secondary ? ' has-secondary' : ''}${hasTabBar ? ' above-tab-bar' : aboveFooter ? ' above-footer' : ''}`}
      style={offset ? { bottom: offset } : undefined}
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
      {toast.action && toast.secondary ? (
        // Kept together: when the message needs the row, both move under it.
        <span className="toast-actions">
          <ToastButton action={toast.secondary} secondary onDismiss={onDismiss} />
          <ToastButton action={toast.action} onDismiss={onDismiss} />
        </span>
      ) : (
        toast.action && <ToastButton action={toast.action} onDismiss={onDismiss} />
      )}
    </div>
  );
}

function ToastButton({ action, secondary, onDismiss }: { action: ToastAction; secondary?: boolean; onDismiss(): void }) {
  return (
    <button
      type="button"
      className={`toast-action${secondary ? ' toast-action--secondary' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onDismiss();
        action.onClick();
      }}
    >
      {action.label}
    </button>
  );
}

export const useToast = () => useContext(ToastContext);
