import { useEffect, useRef, useSyncExternalStore } from 'react';

// Typed wrapper over the Telegram Mini App API (https://core.telegram.org/bots/webapps).
// The SDK exposes every object on every client and lets unsupported methods throw
// synchronously, so `supports(version)` is the ONLY feature gate and every call goes through
// `tgCall`, which swallows and logs failures. Outside Telegram everything is a no-op, so the
// same build runs in a mobile browser.

export type ColorScheme = 'light' | 'dark';

export interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  section_separator_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

export interface SafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type TelegramEvent =
  | 'themeChanged'
  | 'viewportChanged'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged'
  | 'mainButtonClicked'
  | 'secondaryButtonClicked'
  | 'backButtonClicked'
  | 'settingsButtonClicked'
  | 'popupClosed'
  | 'activated'
  | 'deactivated'
  | 'fullscreenChanged'
  | 'homeScreenAdded'
  | 'homeScreenChecked';

/** What `checkHomeScreenStatus` reports (Bot API 8.0). */
export type HomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed';

/** The launch parameters Telegram passes unsigned; only what the app reads. */
export interface InitDataUnsafe {
  /** The `startapp` parameter of the link that opened the app ([A-Za-z0-9_-], ≤ 64). */
  start_param?: string;
}

export interface BottomButtonParams {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
  has_shine_effect?: boolean;
  position?: 'left' | 'right' | 'top' | 'bottom';
}

export interface BottomButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText(text: string): void;
  setParams(params: BottomButtonParams): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
}

export interface SimpleButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

export interface PopupButton {
  id?: string;
  type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
  text?: string;
}

export interface PopupParams {
  title?: string;
  message: string;
  buttons?: PopupButton[];
}

export interface HapticFeedback {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'success' | 'warning' | 'error'): void;
  selectionChanged(): void;
}

export interface CloudStorage {
  setItem(key: string, value: string, cb?: (error: string | null, ok?: boolean) => void): void;
  getItem(key: string, cb: (error: string | null, value?: string) => void): void;
  getItems(keys: string[], cb: (error: string | null, values?: Record<string, string>) => void): void;
  removeItem(key: string, cb?: (error: string | null, ok?: boolean) => void): void;
  removeItems(keys: string[], cb?: (error: string | null, ok?: boolean) => void): void;
  getKeys(cb: (error: string | null, keys?: string[]) => void): void;
}

export interface TelegramWebApp {
  version: string;
  platform: string;
  colorScheme: ColorScheme;
  themeParams: ThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  isClosingConfirmationEnabled: boolean;
  isVerticalSwipesEnabled?: boolean;
  isFullscreen?: boolean;
  isActive?: boolean;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: SafeAreaInset;
  headerColor?: string;
  backgroundColor?: string;
  bottomBarColor?: string;
  /** The signed launch data as a query string (its `hash` differs on every launch). */
  initData?: string;
  initDataUnsafe?: InitDataUnsafe;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;
  onEvent(event: TelegramEvent, cb: (...args: unknown[]) => void): void;
  offEvent(event: TelegramEvent, cb: (...args: unknown[]) => void): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor(color: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  enableVerticalSwipes(): void;
  disableVerticalSwipes(): void;
  requestFullscreen(): void;
  exitFullscreen(): void;
  showConfirm(message: string, cb?: (ok: boolean) => void): void;
  showAlert(message: string, cb?: () => void): void;
  showPopup(params: PopupParams, cb?: (buttonId?: string) => void): void;
  addToHomeScreen(): void;
  checkHomeScreenStatus(cb?: (status: HomeScreenStatus) => void): void;
  BackButton: SimpleButton;
  SettingsButton: SimpleButton;
  MainButton: BottomButton;
  SecondaryButton: BottomButton;
  HapticFeedback: HapticFeedback;
  CloudStorage: CloudStorage;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: Partial<TelegramWebApp> };
  }
}

/** Minimum Bot API version for each feature the app uses. */
export const API = Object.freeze({
  backButton: '6.1',
  haptics: '6.1',
  headerColor: '6.1',
  // setBackgroundColor takes #RRGGBB since 6.1, setHeaderColor only since 6.9 (keywords before).
  headerColorHex: '6.9',
  confirm: '6.2',
  popup: '6.2',
  closingConfirmation: '6.2',
  cloudStorage: '6.9',
  settingsButton: '7.0',
  verticalSwipes: '7.7',
  secondaryButton: '7.10',
  bottomBarColor: '7.10',
  fullscreen: '8.0',
  safeArea: '8.0',
  activation: '8.0',
  homeScreen: '8.0',
});

/** The WebApp object when the page runs inside a Telegram client. Typed as the full API: callers gate with `supports`. */
export function webApp(): TelegramWebApp | undefined {
  const tg = window.Telegram?.WebApp;
  // telegram-web-app.js reports platform "unknown" when opened outside Telegram.
  return tg && tg.platform && tg.platform !== 'unknown' ? (tg as TelegramWebApp) : undefined;
}

export const isTelegram = (): boolean => webApp() !== undefined;

export function platform(): string {
  return webApp()?.platform ?? 'browser';
}

export function isMobileTelegram(): boolean {
  const p = platform();
  return p === 'ios' || p === 'android' || p === 'android_x';
}

/** Compares dotted versions numerically: 7.10 ≥ 7.9, 8.0 ≥ 7.10. */
export function versionAtLeast(current: string, required: string): boolean {
  const a = current.split('.').map((n) => parseInt(n, 10) || 0);
  const b = required.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** The only feature gate: false outside Telegram or below `version`. */
export function supports(version: string): boolean {
  const tg = webApp();
  return tg !== undefined && typeof tg.version === 'string' && versionAtLeast(tg.version, version);
}

/**
 * Runs `fn` against the WebApp when the client supports `version`; a throwing SDK method is
 * logged and swallowed. Returns `fallback` when skipped or failed.
 */
export function tgCall<T>(version: string, fn: (tg: TelegramWebApp) => T, fallback?: T): T | undefined {
  const tg = webApp();
  if (!tg || !supports(version)) return fallback;
  try {
    return fn(tg);
  } catch (error) {
    console.warn('[telegram]', error);
    return fallback;
  }
}

/** Subscribes to a WebApp event; returns the unsubscribe function (a no-op outside Telegram). */
export function onTg(event: TelegramEvent, cb: (...args: unknown[]) => void): () => void {
  const tg = webApp();
  if (!tg) return () => {};
  try {
    tg.onEvent(event, cb);
  } catch (error) {
    console.warn('[telegram]', error);
    return () => {};
  }
  return () => {
    try {
      tg.offEvent(event, cb);
    } catch (error) {
      console.warn('[telegram]', error);
    }
  };
}

/** Foreground/background: `activated`/`deactivated` on Bot API ≥ 8.0, `visibilitychange` otherwise. */
export function useAppLifecycle(onResume?: () => void, onPause?: () => void): void {
  const resume = useRef(onResume);
  const pause = useRef(onPause);
  resume.current = onResume;
  pause.current = onPause;

  useEffect(() => {
    if (supports(API.activation)) {
      const offResume = onTg('activated', () => resume.current?.());
      const offPause = onTg('deactivated', () => pause.current?.());
      return () => {
        offResume();
        offPause();
      };
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? resume.current?.() : pause.current?.());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}

// ---- Sheet stack hook-up: the native back button closes the top sheet before the screen ----

let closeTopSheet: () => boolean = () => false;
let sheetCount = 0;
const sheetListeners = new Set<() => void>();

/** Sheet.tsx registers its stack here so the BackButton closes sheets first. */
export function registerSheetStack(api: { closeTop(): boolean; count(): number; subscribe(cb: () => void): () => void }): void {
  closeTopSheet = api.closeTop;
  api.subscribe(() => {
    sheetCount = api.count();
    sheetListeners.forEach((cb) => cb());
  });
  sheetCount = api.count();
}

function subscribeSheets(cb: () => void): () => void {
  sheetListeners.add(cb);
  return () => sheetListeners.delete(cb);
}

/** Shows Telegram's native back button while `onBack` is set or a sheet is open; a click closes the top sheet first. */
export function useTelegramBackButton(onBack: (() => void) | undefined): void {
  const handler = useRef(onBack);
  handler.current = onBack;
  const sheets = useSyncExternalStore(subscribeSheets, () => sheetCount);
  const visible = onBack !== undefined || sheets > 0;

  useEffect(() => {
    if (!visible || !supports(API.backButton)) return;
    const click = () => {
      if (closeTopSheet()) return;
      handler.current?.();
    };
    tgCall(API.backButton, (tg) => {
      tg.BackButton.onClick(click);
      tg.BackButton.show();
    });
    return () => {
      tgCall(API.backButton, (tg) => {
        tg.BackButton.offClick(click);
        tg.BackButton.hide();
      });
    };
  }, [visible]);
}

export function initTelegram(): void {
  const tg = webApp();
  if (!tg) return;
  document.documentElement.classList.add('in-telegram');
  tgCall('6.0', (t) => t.ready());
  tgCall('6.0', (t) => t.expand());
  // Keeps vertical scrolling from collapsing the mini app.
  tgCall(API.verticalSwipes, (t) => t.disableVerticalSwipes());
}
