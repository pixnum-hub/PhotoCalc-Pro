// ============================================================
//  PhotoCalc Pro — Service Worker
//  © Manik Roy 2026
//  Strategy: Cache-first for static assets, network-first for
//  navigation. Automatic cache version bump on deploy.
// ============================================================

const CACHE_NAME = 'photocalc-pro-v1';
const STATIC_CACHE = 'photocalc-static-v1';
const DYNAMIC_CACHE = 'photocalc-dynamic-v1';

// Core app shell — cached on install
const APP_SHELL = [
  './photography-calculator.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// External fonts — cached on first fetch
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing PhotoCalc Pro v1');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching app shell');
        // addAll fails silently on missing optional resources
        return cache.addAll(APP_SHELL).catch(err => {
          console.warn('[SW] Some shell files unavailable:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating — cleaning old caches');
  const validCaches = [STATIC_CACHE, DYNAMIC_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !validCaches.includes(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and browser extension traffic
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // ── Fonts: cache-first with network fallback ──
  if (FONT_ORIGINS.some(origin => url.origin === new URL(origin).origin)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Same-origin navigation: network-first, fall back to cache ──
  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  // ── Same-origin static assets: cache-first ──
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Cross-origin (CDN, external): stale-while-revalidate ──
  event.respondWith(staleWhileRevalidate(request));
});

// ── STRATEGIES ──────────────────────────────────────────────

/**
 * Cache-first: serve from cache, fetch & cache on miss.
 */
async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return offlineFallback(request);
  }
}

/**
 * Network-first: try network, fall back to cache.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

/**
 * Stale-while-revalidate: serve cache immediately,
 * update cache in background.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await networkFetch || offlineFallback(request);
}

/**
 * Offline fallback — return cached main page for navigation,
 * or a minimal JSON error for API-like requests.
 */
async function offlineFallback(request) {
  if (request.mode === 'navigate') {
    const cached = await caches.match('./photography-calculator.html');
    if (cached) return cached;
  }
  return new Response(
    JSON.stringify({ error: 'offline', message: 'PhotoCalc Pro is offline. Open the app while online to cache it.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── BACKGROUND SYNC (future-proof stub) ─────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-settings') {
    console.log('[SW] Background sync: sync-settings');
    // Reserved for future settings sync
  }
});

// ── PUSH NOTIFICATIONS (future-proof stub) ──────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'PhotoCalc Pro';
  const options = {
    body: data.body || 'New update available.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png',
    tag: 'photocalc-notification',
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── MESSAGE HANDLER ──────────────────────────────────────────
self.addEventListener('message', event => {
  // Allow host page to force SW update
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Forced skip waiting');
    self.skipWaiting();
  }
  // Allow host page to query SW version
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});