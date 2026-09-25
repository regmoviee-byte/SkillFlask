import { useSyncExternalStore } from 'react';
import { API, onTg, supports, tgCall, webApp, type HomeScreenStatus } from './telegram';

// «Добавить на главный экран» (Settings). Inside Telegram ≥ 8.0 the client adds a shortcut
// itself (addToHomeScreen; checkHomeScreenStatus says whether one exists or the device cannot).
// In a browser: Chrome's `beforeinstallprompt` is captured at boot and replayed from the row;
// Safari has no prompt, so the row opens instructions. A page already running as the installed
// app (display-mode: standalone) offers nothing; a browser tab of an installed app (known where
// getInstalledRelatedApps exists) says «Уже на главном экране».

export type HomeScreenOffer =
  /** No row: an older Telegram, an unsupported device, or the installed app itself. */
  | { kind: 'none' }
  /** «Уже на главном экране». */
  | { kind: 'added' }
  /** Telegram's addToHomeScreen. */
  | { kind: 'telegram' }
  /** The browser's own install prompt. */
  | { kind: 'prompt' }
  /** Instructions: Safari's «Поделиться → На экран „Домой“», another iOS browser's, or the browser menu. */
  | { kind: 'instructions'; os: InstallPlatform };

/** Whose instructions: Safari, another iOS browser (Chrome, Firefox, an in-app browser…), the rest. */
export type InstallPlatform = 'ios' | 'ios-other' | 'other';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: HomeScreenOffer = { kind: 'none' };
let deferredPrompt: InstallPromptEvent | null = null;
let installedHere = false;
const listeners = new Set<() => void>();
let started = false;

function set(next: HomeScreenOffer): void {
  offer = next;
  listeners.forEach((cb) => cb());
}

/** Maps Telegram's status to the row. */
export function offerForTelegramStatus(status: HomeScreenStatus | undefined): HomeScreenOffer {
  if (status === 'added') return { kind: 'added' };
  if (status === 'missed' || status === 'unknown') return { kind: 'telegram' };
  return { kind: 'none' };
}

export function isStandalone(): boolean {
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone and iPad (an iPad reports itself as a Mac with touch). */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * An iOS browser other than Safari: its «Поделиться» sits elsewhere (Chrome, Firefox and Edge
 * put it by the address bar), and an in-app browser may have no «На экран „Домой“» at all.
 */
export function isIosNonSafari(): boolean {
  return isIos() && /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\/|Instagram|FBAN|FBAV|Line\/|Telegram/.test(navigator.userAgent);
}

/** The browser's offer from what is known right now. */
function browserOffer(): HomeScreenOffer {
  if (isStandalone()) return { kind: 'none' };
  if (installedHere) return { kind: 'added' };
  if (deferredPrompt) return { kind: 'prompt' };
  return { kind: 'instructions', os: isIos() ? (isIosNonSafari() ? 'ios-other' : 'ios') : 'other' };
}

/** Counts homeScreenAdded events, so an answer asked for before one does not undo it. */
let addedEvents = 0;

function checkTelegram(): void {
  const before = addedEvents;
  tgCall(API.homeScreen, (tg) =>
    tg.checkHomeScreenStatus((status) => {
      if (addedEvents === before) set(offerForTelegramStatus(status));
    }),
  );
}

/**
 * Starts listening; called once at boot (the browser fires `beforeinstallprompt` early, before
 * Settings is ever opened). Returns a function that stops (for tests).
 */
export function initHomeScreen(): () => void {
  started = true;
  if (webApp()) {
    set({ kind: 'none' });
    if (!supports(API.homeScreen)) return () => {};
    const offAdded = onTg('homeScreenAdded', () => {
      addedEvents += 1;
      set({ kind: 'added' });
    });
    checkTelegram();
    return offAdded;
  }
  const onPrompt = (event: Event) => {
    // Kept for the Settings row instead of Chrome's mini-infobar.
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    set(browserOffer());
  };
  const onInstalled = () => {
    deferredPrompt = null;
    installedHere = true;
    set(browserOffer());
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  set(browserOffer());
  // A browser tab of an app that is already installed: Chrome never fires beforeinstallprompt
  // there, so the row would offer instructions for installing it again. Chrome on Android
  // answers through getInstalledRelatedApps (the manifest lists itself in
  // related_applications); elsewhere the method is absent and nothing changes.
  let stopped = false;
  const related = (navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> }).getInstalledRelatedApps;
  if (typeof related === 'function') {
    related.call(navigator).then(
      (apps) => {
        if (stopped || !Array.isArray(apps) || apps.length === 0) return;
        installedHere = true;
        set(browserOffer());
      },
      () => {},
    );
  }
  return () => {
    stopped = true;
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

/** Settings opened: Telegram is asked again (the user may have removed the shortcut). */
export function refreshHomeScreen(): void {
  if (!started) return;
  if (webApp()) checkTelegram();
  else set(browserOffer());
}

export type AddOutcome = 'requested' | 'accepted' | 'dismissed' | 'instructions';

/**
 * The row's action. Telegram shows its own dialog (the result arrives as homeScreenAdded);
 * the browser prompt resolves with the user's choice; otherwise the caller shows instructions.
 */
export async function addToHomeScreen(): Promise<AddOutcome> {
  if (offer.kind === 'telegram') {
    tgCall(API.homeScreen, (tg) => tg.addToHomeScreen());
    return 'requested';
  }
  if (offer.kind === 'prompt' && deferredPrompt) {
    const event = deferredPrompt;
    // A prompt can be shown once; Chrome fires a new beforeinstallprompt if it may ask again.
    deferredPrompt = null;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      set(browserOffer());
      return choice.outcome;
    } catch {
      set(browserOffer());
      return 'instructions';
    }
  }
  return 'instructions';
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function homeScreenOffer(): HomeScreenOffer {
  return offer;
}

export function useHomeScreenOffer(): HomeScreenOffer {
  return useSyncExternalStore(subscribe, () => offer, () => offer);
}

/** Tests: back to the state before initHomeScreen. */
export function resetHomeScreen(): void {
  offer = { kind: 'none' };
  deferredPrompt = null;
  installedHere = false;
  started = false;
}
