// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import swSource from '../../public/sw.js?raw';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { applyUpdate, launchedInTelegram, registerServiceWorker, resetServiceWorker, shouldRegisterServiceWorker, useUpdateWaiting, watchRegistration } from './sw';
import { renderHook, act } from '@testing-library/react';

let fake: FakeTelegram | undefined;
const nav = navigator as unknown as { serviceWorker?: unknown };

afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  delete window.Telegram;
  delete nav.serviceWorker;
  resetServiceWorker();
  window.history.replaceState(null, '', '/');
});

/** A navigator.serviceWorker whose register() is recorded. */
function stubContainer(controller: object | null = null) {
  const listeners = new Map<string, () => void>();
  const container = {
    controller,
    register: vi.fn(async () => ({ waiting: null, installing: null, addEventListener() {}, update: async () => {} })),
    addEventListener: (type: string, cb: () => void) => listeners.set(type, cb),
    fire: (type: string) => listeners.get(type)?.(),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  return container;
}

describe('registration', () => {
  it('registers outside Telegram in a production build, relative to the page', async () => {
    const container = stubContainer();
    // telegram-web-app.js reports platform "unknown" in a plain browser.
    window.Telegram = { WebApp: { platform: 'unknown' } };
    expect(shouldRegisterServiceWorker({ prod: true })).toBe(true);
    expect(await registerServiceWorker({ prod: true })).toBe(true);
    expect(container.register).toHaveBeenCalledWith('./sw.js', { scope: './' });
  });

  it('never registers inside Telegram, nor in dev', async () => {
    const container = stubContainer();
    fake = installFakeTelegram('8.0');
    expect(launchedInTelegram()).toBe(true);
    expect(await registerServiceWorker({ prod: true })).toBe(false);
    fake.uninstall();
    fake = undefined;
    // The SDK did not load, but Telegram's launch parameters are in the URL.
    window.history.replaceState(null, '', '/#tgWebAppData=x&tgWebAppVersion=8.0&tgWebAppPlatform=android');
    expect(launchedInTelegram()).toBe(true);
    expect(await registerServiceWorker({ prod: true })).toBe(false);
    window.history.replaceState(null, '', '/');
    expect(await registerServiceWorker({ prod: false })).toBe(false);
    expect(container.register).not.toHaveBeenCalled();
  });

  it('remembers the launch URL: a route replacing Telegram’s hash before `load` keeps it off', async () => {
    window.history.replaceState(null, '', '/#tgWebAppData=x&tgWebAppVersion=8.0&tgWebAppPlatform=android');
    vi.resetModules();
    const fresh = await import('./sw');
    // StartRedirect has moved on to `#/today` by the time the page has loaded.
    window.history.replaceState(null, '', '/#/today');
    const container = stubContainer();
    expect(fresh.launchedInTelegram()).toBe(true);
    expect(await fresh.registerServiceWorker({ prod: true })).toBe(false);
    expect(container.register).not.toHaveBeenCalled();
  });

  it('is off where the browser has no service workers', () => {
    expect(shouldRegisterServiceWorker({ prod: true })).toBe(false);
  });
});

describe('update flow', () => {
  function registration() {
    const listeners = new Map<string, () => void>();
    const worker = { state: 'installing', postMessage: vi.fn(), addEventListener: (_: string, cb: () => void) => listeners.set('state', cb) };
    const reg = {
      waiting: null,
      installing: worker,
      addEventListener: (type: string, cb: () => void) => listeners.set(type, cb),
      update: async () => {},
    };
    return { reg, worker, fire: (type: string) => listeners.get(type)?.() };
  }

  it('a new version waits until «Обновить приложение», which activates it and reloads', () => {
    const container = stubContainer({});
    const { reg, worker, fire } = registration();
    const { result } = renderHook(() => useUpdateWaiting());
    watchRegistration(reg as unknown as ServiceWorkerRegistration);
    expect(result.current).toBe(false);
    act(() => {
      fire('updatefound');
      worker.state = 'installed';
      fire('state');
    });
    expect(result.current).toBe(true);

    const reload = vi.fn();
    applyUpdate(reload);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.fire('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the first install is not an update; without one the row just reloads', () => {
    stubContainer(null);
    const { reg, worker, fire } = registration();
    const { result } = renderHook(() => useUpdateWaiting());
    watchRegistration(reg as unknown as ServiceWorkerRegistration);
    act(() => {
      fire('updatefound');
      worker.state = 'installed';
      fire('state');
    });
    expect(result.current).toBe(false);
    const reload = vi.fn();
    applyUpdate(reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});

// ---- public/sw.js itself, run against fake caches and network ----

type Handler = (event: Record<string, unknown>) => void;

const SCOPE = 'https://owner.github.io/SkillFlask/';

class FakeCache {
  entries = new Map<string, Response>();
  /** Strict about Vary: a response that varies only matches with ignoreVary (the request headers differ). */
  async match(key: string | Request, options?: { ignoreSearch?: boolean; ignoreVary?: boolean }) {
    let url = typeof key === 'string' ? key : key.url;
    if (options?.ignoreSearch) url = url.split('?')[0]!;
    const hit = this.entries.get(url);
    if (hit?.headers.has('Vary') && !options?.ignoreVary) return undefined;
    return hit?.clone();
  }
  async put(key: string | Request, response: Response) {
    this.entries.set(typeof key === 'string' ? key : key.url, response);
  }
}

/** Evaluates the worker source with `self`, `caches` and `fetch` of our own. */
function loadWorker(source: string, network: (url: string) => Promise<Response>) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, FakeCache>();
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name)!;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self = {
    registration: { scope: SCOPE },
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, cb: Handler) => handlers.set(type, cb),
  };
  const fetch = vi.fn((input: string | Request) => network(typeof input === 'string' ? input : input.url));
  const api = new Function('self', 'caches', 'fetch', `${source}\nreturn { strategyFor, VERSION, CACHE };`)(self, caches, fetch) as {
    strategyFor(request: { method: string; url: string; mode?: string }, scope: string): string;
    VERSION: string;
    CACHE: string;
  };
  /** Fires an event; returns its respondWith promise and its waitUntil promises, unawaited. */
  const fire = (type: string, extra: Record<string, unknown> = {}) => {
    let response: Promise<unknown> | undefined;
    const waits: Promise<unknown>[] = [];
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<unknown>) => (response = p),
    };
    handlers.get(type)!(event);
    return { response, waits };
  };
  /** Dispatches an event; `result` is its response, or else what its waitUntil settles to. */
  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const { response, waits } = fire(type, extra);
    const result = response ? await response : (await Promise.all(waits))[0];
    await Promise.all(waits);
    return { responded: response !== undefined, result };
  };
  return { api, self, stores, fetch, dispatch, fire };
}

const built = swSource
  .replace('__SW_VERSION__', '0.1.0-abc')
  .replace('/* __SW_PRECACHE__ */ []', JSON.stringify(['./', './assets/index-1.js', './manifest.webmanifest', './missing.png']));

// Like vite preview (and many hosts): every response varies by Origin.
const ok = (body: string) => Promise.resolve(new Response(body, { status: 200, headers: { Vary: 'Origin' } }));
const offline = () => Promise.reject(new TypeError('Failed to fetch'));
const request = (url: string, mode = 'no-cors', method = 'GET') => ({ url, mode, method });

describe('public/sw.js', () => {
  it('runs unbuilt (dev) with an empty precache list', () => {
    const { api } = loadWorker(swSource, ok);
    expect(api.VERSION).toBe('__SW_VERSION__');
  });

  it('picks a strategy per request', () => {
    const { api } = loadWorker(built, ok);
    expect(api.strategyFor(request(`${SCOPE}#/today`, 'navigate'), SCOPE)).toBe('page');
    expect(api.strategyFor(request(`${SCOPE}?tgWebAppStartParam=x`, 'navigate'), SCOPE)).toBe('page');
    expect(api.strategyFor(request(`${SCOPE}index.html`), SCOPE)).toBe('page');
    expect(api.strategyFor(request(`${SCOPE}assets/index-1.js`), SCOPE)).toBe('asset');
    expect(api.strategyFor(request(`${SCOPE}icons/icon-192.png`), SCOPE)).toBe('fresh');
    expect(api.strategyFor(request(`${SCOPE}manifest.webmanifest`), SCOPE)).toBe('fresh');
    expect(api.strategyFor(request(`${SCOPE}sw.js`), SCOPE)).toBe('network');
    // A tab opened on a file of the app is not the page: it must never replace the cached index.html.
    expect(api.strategyFor(request(`${SCOPE}icons/icon-192.png`, 'navigate'), SCOPE)).toBe('network');
    expect(api.strategyFor(request(`${SCOPE}manifest.webmanifest`, 'navigate'), SCOPE)).toBe('network');
    expect(api.strategyFor(request(`${SCOPE}sw.js`, 'navigate'), SCOPE)).toBe('network');
    expect(api.strategyFor(request('https://telegram.org/js/telegram-web-app.js'), SCOPE)).toBe('network');
    expect(api.strategyFor(request('https://owner.github.io/Other/app.js'), SCOPE)).toBe('network');
    expect(api.strategyFor(request(`${SCOPE}assets/index-1.js`, 'cors', 'POST'), SCOPE)).toBe('network');
  });

  it('precaches the build on install, a missing file does not fail it', async () => {
    const { dispatch, stores, api } = loadWorker(built, (url) => (url.endsWith('missing.png') ? Promise.resolve(new Response('', { status: 404 })) : ok(url)));
    await dispatch('install');
    const cache = stores.get(api.CACHE)!;
    expect([...cache.entries.keys()].sort()).toEqual([SCOPE, `${SCOPE}assets/index-1.js`, `${SCOPE}manifest.webmanifest`].sort());
  });

  it('opens offline: the page from the cache, hashed assets cache-first', async () => {
    let online = true;
    const worker = loadWorker(built, (url) => (online ? ok(`net ${url}`) : offline()));
    await worker.dispatch('install');
    online = false;

    const page = await worker.dispatch('fetch', { request: request(`${SCOPE}?relaunch#/skills`, 'navigate') });
    expect(page.responded).toBe(true);
    expect(await (page.result as Response).text()).toBe(`net ${SCOPE}`);

    const asset = await worker.dispatch('fetch', { request: request(`${SCOPE}assets/index-1.js`) });
    expect(await (asset.result as Response).text()).toBe(`net ${SCOPE}assets/index-1.js`);

    const other = await worker.dispatch('fetch', { request: request('https://telegram.org/js/telegram-web-app.js') });
    expect(other.responded).toBe(false);
  });

  it('online: the page comes from the network (and refreshes the copy), assets are not fetched again', async () => {
    let version = 1;
    const worker = loadWorker(built, (url) => ok(`v${version} ${url}`));
    await worker.dispatch('install');
    version = 2;
    const page = await worker.dispatch('fetch', { request: request(SCOPE, 'navigate') });
    expect(await (page.result as Response).text()).toBe(`v2 ${SCOPE}`);
    expect(await (await worker.stores.get(worker.api.CACHE)!.match(SCOPE, { ignoreVary: true }))!.text()).toBe(`v2 ${SCOPE}`);
    worker.fetch.mockClear();
    const asset = await worker.dispatch('fetch', { request: request(`${SCOPE}assets/index-1.js`) });
    expect(await (asset.result as Response).text()).toBe(`v1 ${SCOPE}assets/index-1.js`);
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it('a network that hangs: the cached page after 3 s, and the late answer still refreshes it', async () => {
    vi.useFakeTimers();
    try {
      let release: (response: Response) => void = () => {};
      let hang = false;
      const worker = loadWorker(built, (url) => (hang ? new Promise<Response>((resolve) => (release = resolve)) : ok(`v1 ${url}`)));
      await worker.dispatch('install');
      hang = true;
      const { response, waits } = worker.fire('fetch', { request: request(`${SCOPE}#/today`, 'navigate') });
      let answered: Response | undefined;
      void response!.then((r) => (answered = r as Response));
      await vi.advanceTimersByTimeAsync(2900);
      expect(answered).toBeUndefined();
      await vi.advanceTimersByTimeAsync(100);
      expect(await answered!.text()).toBe(`v1 ${SCOPE}`);

      release(new Response(`v2 ${SCOPE}`, { status: 200 }));
      await Promise.all(waits);
      expect(await (await worker.stores.get(worker.api.CACHE)!.match(SCOPE, { ignoreVary: true }))!.text()).toBe(`v2 ${SCOPE}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a slow network with nothing cached yet is still waited for', async () => {
    vi.useFakeTimers();
    try {
      let release: (response: Response) => void = () => {};
      const worker = loadWorker(swSource, () => new Promise<Response>((resolve) => (release = resolve)));
      const { response } = worker.fire('fetch', { request: request(SCOPE, 'navigate') });
      await vi.advanceTimersByTimeAsync(10_000);
      release(new Response('late', { status: 200 }));
      expect(await ((await response!) as Response).text()).toBe('late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('activating drops older versions’ caches; SKIP_WAITING activates a waiting version', async () => {
    const worker = loadWorker(built, ok);
    await worker.stores.set('skill-flask-0.0.9-old', new FakeCache());
    await worker.stores.set('someone-else', new FakeCache());
    await worker.dispatch('install');
    await worker.dispatch('activate');
    expect([...worker.stores.keys()].sort()).toEqual([worker.api.CACHE, 'someone-else'].sort());
    expect(worker.self.clients.claim).toHaveBeenCalled();
    await worker.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });
});
