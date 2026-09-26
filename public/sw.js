// Skill Flask service worker — only for the installed browser app (platform/sw.ts never
// registers it inside Telegram). The build (vite.config.ts, serviceWorker plugin) writes the
// version and the list of files to precache into the copy in dist/; this source file runs in
// dev as it is, with an empty list.
//
// Strategies:
// - the page (the scope and index.html, navigations to them included): network first, the
//   cached page offline or when the network takes longer than NETWORK_TIMEOUT_MS;
// - hashed files under assets/: cache first (their names change with their content);
// - other files of the app (manifest, icons): network first, the cache offline; a navigation
//   to one of them (a tab opened on the icon) is left to the network, and so is every request
//   for a static reminder file (reminders/*.ics);
// - everything else (other origins, e.g. telegram.org, non-GET): not touched.
// A new version installs next to the old one and waits; the page shows «Обновить приложение»
// and posts SKIP_WAITING when the user taps it (platform/sw.ts).

const VERSION = '__SW_VERSION__';
const PRECACHE = /* __SW_PRECACHE__ */ [];
const CACHE_PREFIX = 'skill-flask-';
const CACHE = CACHE_PREFIX + VERSION;

/** How a request is served: 'page' | 'asset' | 'fresh' | 'network' (not intercepted). */
function strategyFor(request, scope) {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  const base = new URL(scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return 'network';
  const path = url.pathname.slice(base.pathname.length);
  if (path === '' || path === 'index.html') return 'page';
  // A tab opened on the icon, the manifest or the worker itself is not the app: stored under
  // the page's key it would replace the offline index.html with a PNG or JSON body.
  if (request.mode === 'navigate') return 'network';
  if (path === 'sw.js') return 'network';
  // The static reminder files (v0.5 package 20): opened now and then from a calendar button,
  // never needed offline — neither precached (scripts/sw-plugin.mjs) nor cached on the way.
  if (path.startsWith('reminders/')) return 'network';
  if (path.startsWith('assets/')) return 'asset';
  return 'fresh';
}

/** Every page request shares one cache entry: the scope itself (index.html). */
function cacheKey(request, strategy, scope) {
  return strategy === 'page' ? scope : request;
}

/** A redirected response cannot answer a navigation; a copy without the flag can. */
async function storable(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Servers answer with `Vary: Origin` (vite preview) or `Vary: Accept-Encoding`: the precached
// copy was fetched by the worker, the page's module scripts ask with an Origin, so a lookup
// that respected Vary would miss and the offline start would fail. The files are the same.
const MATCH = { ignoreVary: true };

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, await storable(response.clone()));
  return response;
}

// A network that answers slowly or never (Wi-Fi without an uplink, a captive portal, a weak
// cell) must not keep the installed app blank for the browser's full timeout: after this long
// the cached copy answers, and the network, when it comes, still refreshes it.
const NETWORK_TIMEOUT_MS = 3000;

/**
 * Network first, the cache offline or after NETWORK_TIMEOUT_MS. Returns the response and the
 * background refresh, which the fetch event keeps alive (waitUntil).
 */
function networkFirst(request, key) {
  const cachePromise = caches.open(CACHE);
  const network = cachePromise.then(async (cache) => {
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaqueredirect') await cache.put(key, await storable(response.clone()));
    return response;
  });
  const cached = () => cachePromise.then((cache) => cache.match(key, { ...MATCH, ignoreSearch: true }));
  const response = (async () => {
    let timer;
    const slow = new Promise((resolve) => {
      timer = setTimeout(resolve, NETWORK_TIMEOUT_MS, null);
    });
    try {
      const first = await Promise.race([network, slow]);
      if (first) return first;
      // Too slow: the copy, or (none yet) keep waiting for the network.
      return (await cached()) ?? (await network);
    } catch (error) {
      const hit = await cached();
      if (hit) return hit;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })();
  return { response, refresh: network.catch(() => {}) };
}

self.addEventListener('install', (event) => {
  const scope = self.registration.scope;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One missing file must not cost the whole offline copy.
      Promise.allSettled(
        PRECACHE.map(async (path) => {
          const url = new URL(path, scope).href;
          const response = await fetch(url, { cache: 'reload' });
          if (response.ok) await cache.put(url, await storable(response));
        }),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const scope = self.registration.scope;
  const strategy = strategyFor(event.request, scope);
  if (strategy === 'network') return;
  if (strategy === 'asset') {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  const { response, refresh } = networkFirst(event.request, cacheKey(event.request, strategy, scope));
  event.respondWith(response);
  event.waitUntil(refresh);
});
