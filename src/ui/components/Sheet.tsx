import { useCallback, useEffect, useId, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerSheetStack } from '../../platform/telegram';

// Bottom sheet primitive. Opaque elevated surface, spring entrance, drag-to-close, scrim tap,
// Escape, browser back and the Telegram BackButton all close it. While open the page behind
// is inert and scroll-locked. Every open sheet pushes one history entry carrying its id, so
// the back gesture closes the sheet instead of leaving the screen.

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** When false the scrim and the drag gesture do not close the sheet (back still does). */
  dismissible?: boolean;
  height?: 'auto' | 'full';
  /** Accessible name when there is no title (the body always describes the dialog). */
  ariaLabel?: string;
  /** Receives the user-style close (pops history first); ContextSheet closes itself with it. */
  closeRef?: MutableRefObject<() => void>;
  /** Extra class on the sheet surface. */
  className?: string;
  /**
   * Called once a closed sheet has slid out, unmounted and let go of the page's scroll (not when
   * the screen unmounts it): the moment to scroll the page, which the lock would otherwise undo.
   */
  onExited?(): void;
}

const EXIT_MS = 260;
const CLOSE_RATIO = 0.3;
const CLOSE_VELOCITY = 0.5; // px per ms
const DRAG_THRESHOLD = 4;

interface SheetEntry {
  id: string;
  /** User-initiated close: pops the history entry, which then calls onClose. */
  requestClose(): void;
  /** The parent's onClose; used when history already popped. */
  onClose(): void;
}

// ---- Module-level stack shared with the Telegram BackButton and popstate ----

const stack: SheetEntry[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((cb) => cb());
}

function pushEntry(entry: SheetEntry): void {
  stack.push(entry);
  notify();
}

function removeEntry(entry: SheetEntry): void {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  notify();
}

export function openSheetCount(): number {
  return stack.length;
}

/** Closes the topmost sheet; false when none is open. */
export function closeTopSheet(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.requestClose();
  return true;
}

registerSheetStack({
  closeTop: closeTopSheet,
  count: openSheetCount,
  subscribe: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
});

type SheetHistoryState = { idx?: number; sheet?: string } | null;

function historyState(): SheetHistoryState {
  return typeof window === 'undefined' ? null : (window.history.state as SheetHistoryState);
}

let popstateInstalled = false;
// Deferred history pops for sheets closed by their parent (see the history effect).
const pendingPops = new Map<string, number>();

/**
 * Called once at boot: a reload while a sheet was open leaves that sheet's history entry on
 * top, so the back gesture would land on the same URL. Strip the marker and step back to the
 * screen's own entry.
 */
export function dropStaleSheetEntry(): void {
  const state = historyState();
  if (!state?.sheet) return;
  window.history.replaceState({ ...state, sheet: undefined }, '');
  if ((state.idx ?? 0) > 0) window.history.back();
}

function installPopstate(): void {
  if (popstateInstalled || typeof window === 'undefined') return;
  popstateInstalled = true;
  window.addEventListener('popstate', () => {
    const top = stack[stack.length - 1];
    // The top sheet's entry is gone from history → the user went back: close it.
    if (top && historyState()?.sheet !== top.id) top.onClose();
  });
}

// ---- Body scroll lock (counted, so nested sheets lock once) ----

let lockCount = 0;
let savedScrollY = 0;

function lockBody(): void {
  if (lockCount++ > 0) return;
  savedScrollY = window.scrollY;
  document.body.style.top = `-${savedScrollY}px`;
  document.body.classList.add('sheet-lock');
  document.getElementById('root')?.setAttribute('inert', '');
}

function unlockBody(): void {
  if (--lockCount > 0) return;
  document.body.classList.remove('sheet-lock');
  document.body.style.top = '';
  document.getElementById('root')?.removeAttribute('inert');
  window.scrollTo(0, savedScrollY);
}

function sheetRoot(): HTMLElement {
  let el = document.getElementById('sheets');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sheets';
    document.body.appendChild(el);
  }
  return el;
}

/** Release rule: past 30 % of the height or a fast flick closes. */
export function shouldClose(dy: number, height: number, velocity: number): boolean {
  return dy > 0 && (dy > height * CLOSE_RATIO || velocity > CLOSE_VELOCITY);
}

interface Drag {
  startY: number;
  lastY: number;
  lastT: number;
  velocity: number;
  dy: number;
  active: boolean;
  fromBody: boolean;
}

export function Sheet({ open, onClose, title, children, footer, dismissible = true, height = 'auto', ariaLabel, closeRef, className, onExited }: SheetProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'closed' | 'open' | 'closing'>('closed');
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  /** Set when the exit timer unmounts the sheet, so the unlock that follows reports onExited. */
  const exited = useRef(false);
  // history.back() is asynchronous: until popstate arrives the top state still carries this
  // sheet's id, so a second tap (scrim, button, BackButton) would go back one entry too far.
  const closing = useRef(false);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (historyState()?.sheet === id) window.history.back();
    else onCloseRef.current();
  }, [id]);
  if (closeRef) closeRef.current = requestClose;

  // Mount and animate: closed → open on the next frame; open → closing → unmount after the exit.
  useEffect(() => {
    if (open) {
      closing.current = false;
      setMounted(true);
      if (typeof requestAnimationFrame !== 'function') {
        setState('open');
        return;
      }
      const raf = requestAnimationFrame(() => setState('open'));
      return () => cancelAnimationFrame(raf);
    }
    setState((prev) => (prev === 'closed' ? prev : 'closing'));
    if (sheetRef.current) sheetRef.current.style.transform = '';
    const timer = window.setTimeout(() => {
      exited.current = true;
      setMounted(false);
      setState('closed');
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // History entry + stack registration while open. A parent that closes the sheet itself
  // leaves a stale entry; the deferred check pops it (deferred so StrictMode's
  // cleanup/re-run pair cancels itself).
  useEffect(() => {
    if (!open) return;
    installPopstate();
    const state = historyState();
    if (state?.sheet !== id) window.history.pushState({ ...(state ?? {}), idx: (state?.idx ?? 0) + 1, sheet: id }, '');
    const entry: SheetEntry = { id, requestClose, onClose: () => onCloseRef.current() };
    pushEntry(entry);
    const pop = pendingPops.get(id);
    if (pop !== undefined) {
      window.clearTimeout(pop);
      pendingPops.delete(id);
    }
    return () => {
      closing.current = false;
      removeEntry(entry);
      pendingPops.set(
        id,
        window.setTimeout(() => {
          pendingPops.delete(id);
          if (historyState()?.sheet === id) window.history.back();
        }, 0),
      );
    };
  }, [open, id, requestClose]);

  // Scroll lock, focus and Escape while mounted.
  useEffect(() => {
    if (!mounted) return;
    lockBody();
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stack[stack.length - 1]?.id === id) requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlockBody();
      previous?.focus?.({ preventScroll: true });
      if (exited.current) {
        exited.current = false;
        onExitedRef.current?.();
      }
    };
  }, [mounted, id, requestClose]);

  // ---- Drag to close ----

  const dragStart = useCallback((y: number, fromBody: boolean) => {
    drag.current = { startY: y, lastY: y, lastT: performance.now(), velocity: 0, dy: 0, active: false, fromBody };
  }, []);

  /** Returns true while the gesture is owned by the sheet (the caller should preventDefault). */
  const dragMove = useCallback((y: number): boolean => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || !el) return false;
    let dy = y - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return false;
      d.active = true;
      el.classList.add('is-dragging');
    }
    // Pulling up meets resistance; the sheet only really moves down.
    if (dy < 0) dy /= 4;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.velocity = (y - d.lastY) / dt;
    d.lastY = y;
    d.lastT = now;
    d.dy = dy;
    el.style.transform = `translateY(${dy}px)`;
    return true;
  }, []);

  const dragEnd = useCallback(() => {
    const d = drag.current;
    const el = sheetRef.current;
    drag.current = null;
    if (!d || !el || !d.active) return;
    el.classList.remove('is-dragging');
    if (dismissibleRef.current && shouldClose(d.dy, el.offsetHeight || 1, d.velocity)) {
      // Keep the dragged position; the closing transition continues from it.
      requestClose();
    } else {
      el.style.transform = '';
    }
  }, [requestClose]);

  const handleProps = dismissible
    ? {
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragStart(event.clientY, false);
        },
        onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
          if (drag.current && !drag.current.fromBody) dragMove(event.clientY);
        },
        onPointerUp: dragEnd,
        onPointerCancel: dragEnd,
      }
    : {};

  // The body scrolls natively; only a downward pull from scrollTop 0 becomes a drag. The
  // non-passive touchmove listener (needed to stop the WebView from scrolling/bouncing during
  // the drag) is attached only for such a touch, so ordinary scrolling inside the sheet stays
  // passive and never waits for JS.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !mounted || !dismissible) return;
    const onMove = (event: TouchEvent) => {
      const d = drag.current;
      if (!d || !d.fromBody) return;
      const y = event.touches[0]!.clientY;
      if (!d.active && y < d.startY) {
        drag.current = null; // the user scrolls the content
        el.removeEventListener('touchmove', onMove);
        return;
      }
      if (dragMove(y) && event.cancelable) event.preventDefault();
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || el.scrollTop > 0) return;
      dragStart(event.touches[0]!.clientY, true);
      el.addEventListener('touchmove', onMove, { passive: false });
    };
    const onEnd = () => {
      el.removeEventListener('touchmove', onMove);
      if (drag.current?.fromBody) dragEnd();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [mounted, dismissible, dragStart, dragMove, dragEnd]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div className="sheet-scrim" data-state={state} onClick={dismissible ? requestClose : undefined} />
      <div
        ref={sheetRef}
        className={`sheet${height === 'full' ? ' is-full' : ''}${className ? ` ${className}` : ''}`}
        data-state={state}
        data-sheet-id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <div className="sheet-handle-area" {...handleProps}>
          <span className="sheet-handle" />
        </div>
        {title && (
          <div className="sheet-header" {...handleProps}>
            <h2 id={titleId} className="sheet-title">
              {title}
            </h2>
          </div>
        )}
        <div ref={bodyRef} id={bodyId} className="sheet-body">
          {children}
        </div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </>,
    sheetRoot(),
  );
}
