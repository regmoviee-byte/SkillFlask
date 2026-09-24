// Ring buffer of the last runtime errors in localStorage: iOS has no WebView inspector, so
// Settings (package 4) shows this log instead.

export interface LoggedError {
  at: string;
  message: string;
  stack: string;
  version: string;
}

const STORAGE_KEY = 'sf_errors';
const LIMIT = 20;

const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const listeners = new Set<() => void>();

/** Calls `listener` after every logged or cleared error (Settings keeps its list live). */
export function onErrorsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function getErrors(): LoggedError[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LoggedError[]) : [];
  } catch {
    return [];
  }
}

export function clearErrors(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
  notify();
}

export function logError(error: unknown, context = ''): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : '';
  const entry: LoggedError = {
    at: new Date().toISOString(),
    message: context ? `${context}: ${message}` : message,
    stack: stack.slice(0, 2000),
    version,
  };
  try {
    const next = [...getErrors(), entry].slice(-LIMIT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode: the console still has it.
  }
  notify();
}

let installed = false;

export function installErrorLog(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event) => logError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => logError(event.reason, 'unhandled rejection'));
}
