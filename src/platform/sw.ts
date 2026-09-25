import { useSyncExternalStore } from 'react';

// The service worker (public/sw.js) makes the installed browser app open offline. It is
// registered ONLY outside Telegram: Telegram's iOS WKWebView does not run one, and inside
// Telegram the app is always opened online by the client anyway. A new version installs in
// the background and waits; Settings → «Обновить приложение» then activates it and reloads.

/**
 * The launch URL's hash and query, taken when this module is evaluated — before React mounts:
 * by the window's `load` event StartRedirect may already have replaced `#tgWebAppData=…`.
 */
const launchUrl = typeof window === 'undefined' ? '' : window.location.hash + window.location.search;
const TG_LAUNCH = /tgWebApp(Data|Platform|Version)=/;

/** Inside Telegram, even when telegram-web-app.js did not load: its launch parameters are in the URL. */
export function launchedInTelegram(): boolean {
  const platform = window.Telegram?.WebApp?.platform;
  if (typeof platform === 'string' && platform !== '' && platform !== 'unknown') return true;
  return TG_LAUNCH.test(launchUrl) || TG_LAUNCH.test(window.location.hash + window.location.search);
}

/** Whether this page may register the worker: a production build, a browser that has them, not Telegram. */
export function shouldRegisterServiceWorker(env: { prod: boolean } = { prod: import.meta.env.PROD }): boolean {
  return env.prod && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext !== false && !launchedInTelegram();
}

let waiting: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
const listeners = new Set<() => void>();

function setWaiting(worker: ServiceWorker | null): void {
  waiting = worker;
  listeners.forEach((cb) => cb());
}

/** Follows a registration: a worker that finished installing while another controls the page is an update. */
export function watchRegistration(reg: ServiceWorkerRegistration): void {
  registration = reg;
  // Only an update waits behind a controller; the very first install activates at once.
  if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
    });
  });
}

/** Registers public/sw.js next to index.html (relative: the site lives under /SkillFlask/). */
export async function registerServiceWorker(env: { prod: boolean } = { prod: import.meta.env.PROD }): Promise<boolean> {
  if (!shouldRegisterServiceWorker(env)) return false;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    watchRegistration(reg);
    return true;
  } catch (error) {
    console.warn('[sw]', error);
    return false;
  }
}

/** Asks the server for a newer sw.js (Settings calls it when opened). */
export function checkForUpdate(): void {
  registration?.update().catch(() => {});
}

/**
 * Activates the waiting version and reloads once it controls the page; without one — a plain
 * reload, as «Обновить приложение» always did.
 */
export function applyUpdate(reload: () => void = () => window.location.reload()): void {
  const worker = waiting;
  if (!worker || !('serviceWorker' in navigator)) {
    reload();
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
  worker.postMessage({ type: 'SKIP_WAITING' });
  // A worker that never takes over (a browser quirk) must not leave the button dead.
  window.setTimeout(finish, 3000);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** True while a new version is installed and waiting for «Обновить приложение». */
export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(subscribe, () => waiting !== null, () => false);
}

/** Tests: forget the registration. */
export function resetServiceWorker(): void {
  waiting = null;
  registration = null;
}
