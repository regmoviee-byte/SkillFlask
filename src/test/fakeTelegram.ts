// A fake `window.Telegram.WebApp` for platform tests. Like the real SDK it exposes every
// object at every version; methods introduced later than `version` are simply absent, so an
// ungated call throws TypeError — exactly what `supports()` must prevent.

import type { TelegramWebApp } from '../platform/telegram';

export type FakeButton = 'BackButton' | 'MainButton' | 'SecondaryButton' | 'SettingsButton';

export interface FakeTelegram {
  tg: TelegramWebApp;
  calls: string[];
  emit(event: string, ...args: unknown[]): void;
  /** Presses a native button: runs every handler registered through its onClick. */
  click(button: FakeButton): void;
  uninstall(): void;
}

type Listener = (...args: unknown[]) => void;

export function installFakeTelegram(version: string, overrides: Partial<TelegramWebApp> = {}): FakeTelegram {
  const calls: string[] = [];
  const listeners = new Map<string, Set<Listener>>();
  const handlers = new Map<string, Set<Listener>>();
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(args.length ? `${name}(${args.map((a) => JSON.stringify(a)).join(',')})` : `${name}()`);
    };
  // onClick/offClick keep the handlers (like the SDK's own listener list) so tests can press.
  const onClick = (name: string) => (cb: Listener) => {
    calls.push(`${name}.onClick()`);
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name)!.add(cb);
  };
  const offClick = (name: string) => (cb: Listener) => {
    calls.push(`${name}.offClick()`);
    handlers.get(name)?.delete(cb);
  };
  const button = (name: string) => ({
    text: '',
    isVisible: false,
    isActive: true,
    isProgressVisible: false,
    setText: record(`${name}.setText`),
    setParams: record(`${name}.setParams`),
    onClick: onClick(name),
    offClick: offClick(name),
    show: record(`${name}.show`),
    hide: record(`${name}.hide`),
    enable: record(`${name}.enable`),
    disable: record(`${name}.disable`),
    showProgress: record(`${name}.showProgress`),
    hideProgress: record(`${name}.hideProgress`),
  });
  const simple = (name: string) => ({
    isVisible: false,
    show: record(`${name}.show`),
    hide: record(`${name}.hide`),
    onClick: onClick(name),
    offClick: offClick(name),
  });
  const at = (v: string) => {
    const a = version.split('.').map(Number);
    const b = v.split('.').map(Number);
    for (let i = 0; i < 2; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    return true;
  };

  const tg = {
    version,
    platform: 'ios',
    colorScheme: 'light',
    themeParams: { button_color: '#2481cc', secondary_bg_color: '#efeff4' },
    isExpanded: false,
    viewportHeight: 800,
    viewportStableHeight: 800,
    isClosingConfirmationEnabled: false,
    ready: record('ready'),
    expand: record('expand'),
    close: record('close'),
    isVersionAtLeast: at,
    onEvent: (event: string, cb: Listener) => {
      calls.push(`onEvent(${event})`);
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    },
    offEvent: (event: string, cb: Listener) => {
      calls.push(`offEvent(${event})`);
      listeners.get(event)?.delete(cb);
    },
    BackButton: at('6.1') ? simple('BackButton') : undefined,
    MainButton: button('MainButton'),
    SecondaryButton: at('7.10') ? button('SecondaryButton') : undefined,
    SettingsButton: at('7.0') ? simple('SettingsButton') : undefined,
    HapticFeedback: at('6.1')
      ? { impactOccurred: record('haptic.impact'), notificationOccurred: record('haptic.notification'), selectionChanged: record('haptic.selection') }
      : undefined,
    CloudStorage: {},
    ...(at('6.1') ? { setHeaderColor: record('setHeaderColor'), setBackgroundColor: record('setBackgroundColor') } : {}),
    ...(at('6.2')
      ? {
          showConfirm: (message: string, cb?: (ok: boolean) => void) => {
            calls.push(`showConfirm(${JSON.stringify(message)})`);
            cb?.(true);
          },
          showPopup: (params: { buttons?: { id?: string }[] }, cb?: (id?: string) => void) => {
            calls.push('showPopup');
            cb?.(params.buttons?.[0]?.id);
          },
          enableClosingConfirmation: record('enableClosingConfirmation'),
          disableClosingConfirmation: record('disableClosingConfirmation'),
        }
      : {}),
    ...(at('7.7') ? { disableVerticalSwipes: record('disableVerticalSwipes'), enableVerticalSwipes: record('enableVerticalSwipes') } : {}),
    ...(at('7.10') ? { setBottomBarColor: record('setBottomBarColor') } : {}),
    ...(at('8.0') ? { safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 } } : {}),
    ...overrides,
  } as unknown as TelegramWebApp;

  window.Telegram = { WebApp: tg };
  return {
    tg,
    calls,
    emit: (event, ...args) => listeners.get(event)?.forEach((cb) => cb(...args)),
    click: (name) => handlers.get(name)?.forEach((cb) => cb()),
    uninstall: () => {
      delete window.Telegram;
    },
  };
}
