/* ============================================
   Book Your Pitch — Service Worker
   Offline-first caching with background sync support.
   ============================================ */

const CACHE_NAME = 'byp-cache-v4';

// Files to cache on install (the app shell)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js?v=6',
  '/manifest.json',
  '/icon.svg',
];

// Install: cache the app shell aggressively
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function() {
      // If any file fails, the install still succeeds (best-effort)
      console.log('[SW] App shell cached');
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches and take control
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) {
            return name !== CACHE_NAME;
          })
          .map(function(name) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch: cache-first for static assets, network-first for API calls
self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // For API calls — network first, fall back to a cached offline response
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).then(function(response) {
        return response;
      }).catch(function() {
        // Return a lightweight offline JSON response for API calls
        return new Response(
          JSON.stringify({
            success: false,
            offline: true,
            message: 'You are offline. Data will sync when connection returns.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // For static assets (JS, CSS, HTML, SVG, manifest) — cache first
  event.respondWith(
    caches.match(request).then(function(cachedResponse) {
      if (cachedResponse) {
        // Return cached version immediately, then refresh cache in background
        if (url.pathname !== '/') {
          fetch(request).then(function(networkResponse) {
            if (networkResponse && networkResponse.status === 200) {
              var clone = networkResponse.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(request, clone);
              });
            }
          }).catch(function() {
            // Network failed, cache is fine
          });
        }
        return cachedResponse;
      }

      // Not in cache — fetch from network
      return fetch(request).then(function(response) {
        if (!response || response.status !== 200) {
          return response;
        }
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, clone);
        });
        return response;
      }).catch(function() {
        // Both cache and network failed
        if (url.pathname.endsWith('.html') || url.pathname === '/') {
          return caches.match('/index.html');
        }
        return new Response(
          '<!DOCTYPE html><html><head><title>Offline</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f4f8fe;color:#475569}h1{font-size:24px;color:#0ea5e9}p{font-size:14px;line-height:1.6}</style></head><body><h1>Book Your Pitch</h1><p>You\'re offline.<br>Connect to the internet and try again.</p></body></html>',
          { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
        );
      });
    })
  );
});

// Background sync: when the browser re-connects, notify the client
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-bookings') {
    event.waitUntil(
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({
            type: 'SYNC_TRIGGERED',
            timestamp: Date.now(),
          });
        });
      })
    );
  }
});

// Listen for messages from the client
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
