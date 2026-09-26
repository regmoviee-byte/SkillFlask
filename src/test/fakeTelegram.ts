// A fake `window.Telegram.WebApp` for platform tests. Like the real SDK it exposes every
// object at every version; methods introduced later than `version` are simply absent, so an
// ungated call throws TypeError — exactly what `supports()` must prevent.

import type { HomeScreenStatus, TelegramWebApp } from '../platform/telegram';

export type FakeButton = 'BackButton' | 'MainButton' | 'SecondaryButton' | 'SettingsButton';

export interface FakeTelegram {
  tg: TelegramWebApp;
  calls: string[];
  /** CloudStorage contents (Bot API ≥ 6.9); tests may seed or tamper with it directly. */
  cloud: FakeCloud;
  /** What checkHomeScreenStatus answers (Bot API ≥ 8.0); tests may change it. */
  homeScreen: { status: HomeScreenStatus };
  emit(event: string, ...args: unknown[]): void;
  /** Presses a native button: runs every handler registered through its onClick. */
  click(button: FakeButton): void;
  uninstall(): void;
}

type Listener = (...args: unknown[]) => void;

export interface FakeCloud {
  store: Map<string, string>;
  /** setItem / removeItems in call order, e.g. 'set sf_meta', 'remove sf_a_003'. */
  log: string[];
  /** Makes the next matching call fail with this error string (then clears itself). */
  failNext: { method: string; error: string } | null;
}

const CLOUD_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const CLOUD_VALUE_MAX = 4096;
const CLOUD_KEYS_MAX = 1024;

/**
 * CloudStorage with the documented limits: keys [A-Za-z0-9_-]{1,128}, values ≤ 4 096
 * characters, ≤ 1 024 keys; a missing key reads as ''. Callbacks run asynchronously (in a
 * microtask, so fake timers do not stall them), `(error, result)` like the SDK.
 */
export function fakeCloudStorage(cloud: FakeCloud) {
  const reply = <T>(method: string, cb: ((error: string | null, result?: T) => void) | undefined, run: () => T) => {
    queueMicrotask(() => {
      if (cloud.failNext?.method === method) {
        const { error } = cloud.failNext;
        cloud.failNext = null;
        cb?.(error);
        return;
      }
      let result: T;
      try {
        result = run();
      } catch (error) {
        cb?.((error as Error).message);
        return;
      }
      cb?.(null, result);
    });
  };
  const checkKey = (key: string) => {
    if (!CLOUD_KEY.test(key)) throw new Error('KEY_INVALID');
  };
  return {
    setItem: (key: string, value: string, cb?: (error: string | null, ok?: boolean) => void) =>
      reply('setItem', cb, () => {
        checkKey(key);
        if (value.length > CLOUD_VALUE_MAX) throw new Error('VALUE_INVALID');
        if (!cloud.store.has(key) && cloud.store.size >= CLOUD_KEYS_MAX) throw new Error('STORAGE_KEYS_LIMIT');
        cloud.store.set(key, value);
        cloud.log.push(`set ${key}`);
        return true;
      }),
    getItem: (key: string, cb: (error: string | null, value?: string) => void) =>
      reply('getItem', cb, () => {
        checkKey(key);
        return cloud.store.get(key) ?? '';
      }),
    getItems: (keys: string[], cb: (error: string | null, values?: Record<string, string>) => void) =>
      reply('getItems', cb, () => {
        keys.forEach(checkKey);
        return Object.fromEntries(keys.map((key) => [key, cloud.store.get(key) ?? '']));
      }),
    removeItem: (key: string, cb?: (error: string | null, ok?: boolean) => void) =>
      reply('removeItem', cb, () => {
        cloud.store.delete(key);
        cloud.log.push(`remove ${key}`);
        return true;
      }),
    removeItems: (keys: string[], cb?: (error: string | null, ok?: boolean) => void) =>
      reply('removeItems', cb, () => {
        keys.forEach(checkKey);
        for (const key of keys) {
          cloud.store.delete(key);
          cloud.log.push(`remove ${key}`);
        }
        return true;
      }),
    getKeys: (cb: (error: string | null, keys?: string[]) => void) => reply('getKeys', cb, () => [...cloud.store.keys()]),
  };
}

export function installFakeTelegram(version: string, overrides: Partial<TelegramWebApp> = {}): FakeTelegram {
  const calls: string[] = [];
  const cloud: FakeCloud = { store: new Map(), log: [], failNext: null };
  const homeScreen: { status: HomeScreenStatus } = { status: 'missed' };
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
    // The object exists on every client; its methods only from 6.9 (they throw below it).
    CloudStorage: at('6.9') ? fakeCloudStorage(cloud) : {},
    ...(at('6.1')
      ? { setHeaderColor: record('setHeaderColor'), setBackgroundColor: record('setBackgroundColor'), openTelegramLink: record('openTelegramLink') }
      : {}),
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
    ...(at('8.0')
      ? {
          addToHomeScreen: record('addToHomeScreen'),
          // Answers asynchronously, like the client (it asks the OS).
          checkHomeScreenStatus: (cb?: (status: HomeScreenStatus) => void) => {
            calls.push('checkHomeScreenStatus()');
            queueMicrotask(() => cb?.(homeScreen.status));
          },
        }
      : {}),
    ...(at('8.0') ? { safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 } } : {}),
    ...overrides,
  } as unknown as TelegramWebApp;

  window.Telegram = { WebApp: tg };
  return {
    tg,
    calls,
    cloud,
    homeScreen,
    emit: (event, ...args) => listeners.get(event)?.forEach((cb) => cb(...args)),
    click: (name) => handlers.get(name)?.forEach((cb) => cb()),
    uninstall: () => {
      delete window.Telegram;
    },
  };
}
