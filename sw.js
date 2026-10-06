// SMYL PWA Service Worker
// Versión del cache — incrementar cuando se actualicen archivos
const CACHE_VERSION = 'smyl-v156-linked-evidence';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';

// Archivos que se cachean al instalar
const STATIC_FILES = [
  '/camila/smyl-dental-model.js?v=1',
  '/camila/smyl-dental-record.js?v=5',
  '/camila/smyl-photo-review-model.js?v=2',
  '/camila/smyl-photo-review-store.js?v=3',
  '/camila/smyl-photo-findings.js?v=1',
  '/camila/smyl-tooth-map.js?v=2',
  '/camila/smyl-review-evidence.js?v=2',
  '/camila/smyl-photo-review.js?v=4',
  '/camila/smyl-photo-review.css?v=4',
  '/camila/smyl-photo-analysis-client.js?v=1',
  '/camila/smyl-photo-analysis.js?v=3',
  '/camila/smyl-dental-record.css?v=3',
  '/camila/smyl-case-model.js?v=2',
  '/camila/smyl-case-client.js?v=1',
  '/camila/smyl-patient-cases.js?v=8',
  '/camila/my-smyl-document.js?v=1',
  '/camila/my-smyl-portal.js?v=3',
  '/camila/my-smyl-portal.css?v=2',
  '/camila/my-smyl.html',
  '/camila/my-smyl.js?v=3',
  '/camila/my-smyl-presentation.js?v=1',
  '/camila/my-smyl-presentation.css?v=1',
  '/camila/my-smyl-review.js?v=1',
  '/camila/my-smyl-review.css?v=1',
  '/camila/my-smyl.css?v=1',
  '/camila/my-smyl-studio.js?v=2',
  '/camila/my-smyl-studio.css?v=1',
  '/camila/icons/ui/my-smyl-example-before.svg',
  '/camila/icons/ui/my-smyl-example-after.svg',
  '/camila/smyl-patient-cases.css?v=2',
  '/camila/smyl-proposals.css?v=1',
  '/camila/smyl-proposals.js?v=4',
  '/camila/smyl-proposal-model.js?v=1',
  '/camila/smyl-proposal-print.js?v=1',
  '/camila/smyl-clinic.js?v=5',
  '/camila/smyl-case-workspace.js?v=1',
  '/camila/smyl-case-workspace.css?v=1',
  '/camila/smyl-clinic.css?v=1',
  '/camila/smyl-clinical-model.js?v=1',
  '/camila/smyl-panel.js?v=1',
  '/camila/smyl-panel.css?v=1',
  '/camila/smyl-studio.js?v=18',
  '/camila/smyl-photo-batch.js?v=1',
  '/camila/smyl-result-viewer.js?v=1',
  '/camila/smyl-result-viewer.css?v=1',
  '/camila/smyl-analysis-model.js?v=1',
  '/camila/smyl-analysis-guides.js?v=1',
  '/camila/smyl-analysis-guides.css?v=2',
  '/camila/smyl-studio.css?v=19',
  '/camila/icons/capture-frontal-v2.webp',
  '/camila/icons/capture-left-v2.webp',
  '/camila/icons/capture-right-v2.webp',
  '/camila/icons/capture-three-quarter-v2.webp',
  '/camila/icons/capture-extraoral-v3.webp',
  '/camila/icons/capture-intraoral-v3.webp',
  '/camila/icons/ui/capture-intraoral-left-v1.webp',
  '/camila/icons/ui/capture-intraoral-right-v1.webp',
  '/camila/icons/ui/dental-miniature-v1.webp',
  '/camila/smyl-vita-samples.js?v=1',
  '/camila/smyl-shade-carousel.js?v=2',
  '/camila/smyl-tooth-selection.js?v=1',
  '/camila/smyl-local-tone.js?v=4',
  '/camila/smyl-local-tone.css?v=3',
  '/camila/case-views.js?v=3',
  '/camila/simulacion.html',
  '/camila/simulacion-rapida.html',
  '/camila/lana-quick-bridge.js?v=1',
  '/camila/smile-modes.js?v=13',
  '/camila/visual-composition.js?v=5',
  '/camila/visual-simulation.js?v=29',
  '/camila/photo-reference.js?v=1',
  '/camila/dental-transfer.js?v=1',
  '/camila/dental-transfer.css?v=1',
  '/camila/visual-simulation.css?v=5',
  '/camila/contour-review.js?v=2',
  '/camila/contour-review.css?v=1',
  '/camila/tooth-boundaries.js?v=1',
  '/camila/photo-adjust.js',
  '/camila/photo-adjust.js?v=3',
  '/camila/manifest.json',
  '/camila/app.html',
  '/camila/calibracion.html',
  '/camila/biblioteca-carillas.html',
  '/camila/manifest-app.json',
  '/camila/icons/smyl_pwa.png',
  '/camila/icons/smyl_logo.png',
  '/camila/icons/vita/vita-master-photo.webp',
  '/camila/icons/vita/veneer-ceramic-v2.webp',
  'https://raw.githubusercontent.com/rpartidaislas-cloud/camila/claude/camila-claude-clinical-analysis-sywxjv/mobile/www/assets/dental-library/natural-a1-v1/central-v3.png',
  'https://raw.githubusercontent.com/rpartidaislas-cloud/camila/claude/camila-claude-clinical-analysis-sywxjv/mobile/www/assets/dental-library/natural-a1-v1/lateral-v3.png',
  'https://raw.githubusercontent.com/rpartidaislas-cloud/camila/claude/camila-claude-clinical-analysis-sywxjv/mobile/www/assets/dental-library/natural-a1-v1/canine-v3.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,700;1,600&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
];

// ── INSTALL ──
self.addEventListener('install', function(e) {
  console.log('[SW] Installing SMYL PWA update...');
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      // Un recurso externo no debe impedir que se actualice toda la PWA.
      return Promise.all(STATIC_FILES.map(function(url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function(err) {
          console.warn('[SW] File not cached:', url, err);
        });
      }));
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

  // Patient credentials are fragments; data/photos are POST no-store to Edge.
  // Never supply an offline simulator or cached navigation for this portal.
  if (new URL(url).pathname.endsWith('/my-smyl-private.html')) {
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(function(){
      return new Response('Conéctate a internet y abre nuevamente el enlace de tu clínica.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    }));
    return;
  }

  // No cachear llamadas a APIs (Supabase, Anthropic, Google)
  if (url.includes('supabase.co') || 
      url.includes('anthropic.com') || 
      url.includes('googleapis.com/v1beta') ||
      url.includes('openai.com')) {
    return; // Fetch normal, sin cache
  }

  // Network first para HTML (siempre versión más reciente) -- cache:
  // 'no-store' para que ni el navegador use una copia intermedia de su
  // propio caché HTTP; sin esto, "red primero" podía seguir sirviendo un
  // HTML no tan fresco dentro de la ventana de cache-control del servidor.
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(function(response) {
        var clone = response.clone();
        caches.open(STATIC_CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/camila/simulacion-rapida.html');
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
  self.registration.showNotification(data.title || 'SMYL', {
    body: data.body || 'Tienes una nueva simulación lista',
    icon: '/camila/icons/smyl_pwa.png',
    badge: '/camila/icons/smyl_pwa.png',
    data: { url: data.url || '/camila/simulacion-rapida.html' }
  });
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data.url || '/camila/simulacion-rapida.html')
  );
});
