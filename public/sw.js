const CACHE_NAME = 'laan-cache-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  '/js/utils/indexed-db-storage.js',
  '/js/state.js',
  '/js/mobile-nav.js',
  '/js/public-chat.js',
  '/js/universities.js',
  '/js/profile-settings.js',
  '/js/online-panel.js',
  '/js/profile-panel.js',
  '/js/modals.js',
  '/js/startup-onboarding.js',
  '/js/pwa-register.js',
  '/assets/icons/favicon.png',
  '/assets/icons/logo.png',
  '/assets/icons/maskable_icon_x48.png',
  '/assets/icons/maskable_icon_x72.png',
  '/assets/icons/maskable_icon_x96.png',
  '/assets/icons/maskable_icon_x128.png',
  '/assets/icons/maskable_icon_x192.png',
  '/assets/icons/maskable_icon_x384.png',
  '/assets/icons/maskable_icon_x512.png'
];

// Install: Pre-cache App Shell assets and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.warn('[SW] Pre-caching failed:', error);
      })
  );
});

// Activate: Clean up older cache versions and take control of all clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: Strategy dispatcher
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Ignore non-http(s) schemes (e.g., chrome-extension://)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Network-Only for dynamic API endpoints and authentication
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/login' ||
    url.pathname === '/add-subroom'
  ) {
    return;
  }

  // 1. Navigation (HTML Pages) -> Network-First with Offline Cache Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || caches.match('/index.html') || caches.match('/');
          });
        })
    );
    return;
  }

  // 2. Static Assets (CSS, JS, UI Icons, Symbols, Fonts, Manifest) -> Stale-While-Revalidate
  const isStaticAsset =
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/assets/icons/') ||
    url.pathname.startsWith('/assets/symbols/') ||
    url.pathname === '/manifest.json' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';

  if (isStaticAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (
                networkResponse &&
                (networkResponse.status === 200 || networkResponse.type === 'opaque')
              ) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => {
              // If network fetch fails in background, return cached response if available
              return cachedResponse;
            });

          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // Default fallback for any other GET requests: Cache-First, then Network
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
      );
    })
  );
});
