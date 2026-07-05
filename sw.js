// SMYLE PWA Service Worker
// Versión del cache — incrementar cuando se actualicen archivos
const CACHE_VERSION = 'smyle-v3';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';

// Archivos que se cachean al instalar
const STATIC_FILES = [
  '/camila/simulacion.html',
  '/camila/manifest.json',
  '/camila/app.html',
  '/camila/manifest-app.json',
  '/camila/icons/smyl_pwa.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,700;1,600&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
];

// ── INSTALL ──
self.addEventListener('install', function(e) {
  console.log('[SW] Installing CAMILA v1...');
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(STATIC_FILES.map(function(url) {
        return new Request(url, { cache: 'reload' });
      })).catch(function(err) {
        console.warn('[SW] Some files failed to cache:', err);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', function(e) {
  console.log('[SW] Activating...');
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== STATIC_CACHE && key !== DYNAMIC_CACHE;
        }).map(function(key) {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH ──
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // No cachear llamadas a APIs (Supabase, Anthropic, Google)
  if (url.includes('supabase.co') || 
      url.includes('anthropic.com') || 
      url.includes('googleapis.com/v1beta') ||
      url.includes('openai.com')) {
    return; // Fetch normal, sin cache
  }

  // Network first para HTML (siempre versión más reciente)
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        var clone = response.clone();
        caches.open(STATIC_CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/camila/simulacion.html');
        });
      })
    );
    return;
  }

  // Cache first para assets estáticos (fonts, icons)
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return new Response('', { status: 408 });
      });
    })
  );
});

// ── PUSH NOTIFICATIONS (futuro) ──
self.addEventListener('push', function(e) {
  if (!e.data) return;
  var data = e.data.json();
  self.registration.showNotification(data.title || 'SMYLE', {
    body: data.body || 'Tienes una nueva simulación lista',
    icon: '/camila/icons/smyl_pwa.png',
    badge: '/camila/icons/smyl_pwa.png',
    data: { url: data.url || '/camila/simulacion.html' }
  });
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data.url || '/camila/simulacion.html')
  );
});
