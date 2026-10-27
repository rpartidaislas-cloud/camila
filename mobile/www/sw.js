// SMYL PWA Service Worker
// Versión del cache — incrementar cuando se actualicen archivos
const CACHE_VERSION = 'smyl-v263-lana-connection-recovery-google-calendar-bidirectional-review-professional-invitations-appointment-negotiations-whatsapp-callbacks-patients-visual-v32-history-ux-v32-whatsapp-template-categories-treatment-ux-v32-smart-odontogram-v33-evidence-history-v34-simplified-navigation-patient-intake-v33-no-new-design-primary-evidence-ai-v35-evolution-closure-v36-daily-workbench-v12-meta-cards-v13-source-workspace-v37-clinical-task-panel-v38-single-odontogram-v39-radiograph-ui-v40-reading-workbench-v42';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';

// Archivos que se cachean al instalar
const STATIC_FILES = [
  '/camila/smyl-browser-privacy.js?v=1',
  '/camila/smyl-secure-files.js?v=2',
  '/camila/smyl-security-center.js?v=1',
  '/camila/smyl-security-center.css?v=1',
  '/camila/mila.html',
  '/camila/consumos.html',
  '/camila/smyl-consumption.js?v=6',
  '/camila/smyl-consumption.css?v=6',
  '/camila/smyl-dental-model.js?v=1',
  '/camila/smyl-radiograph-review-model.js?v=1',
  '/camila/smyl-radiograph-review-store.js?v=1',
  '/camila/smyl-radiograph-analysis-client.js?v=1',
  '/camila/smyl-radiograph-review.js?v=3',
  '/camila/smyl-radiograph-review.css?v=1',
  '/camila/smyl-radiograph-workbench.css?v=2',
  '/camila/smyl-dental-record.js?v=15',
  '/camila/smyl-analysis-workflow.js?v=2',
  '/camila/smyl-photo-review-model.js?v=3',
  '/camila/smyl-photo-review-store.js?v=4',
  '/camila/smyl-photo-findings.js?v=1',
  '/camila/smyl-tooth-map.js?v=2',
  '/camila/smyl-review-evidence.js?v=2',
  '/camila/smyl-photo-review.js?v=5',
  '/camila/smyl-photo-review.css?v=3',
  '/camila/smyl-photo-analysis-client.js?v=3',
  '/camila/smyl-photo-analysis.js?v=5',
  '/camila/smyl-dental-record.css?v=4',
  '/camila/smyl-case-model.js?v=2',
  '/camila/smyl-case-client.js?v=2',
  '/camila/smyl-patient-cases.js?v=9',
  '/camila/my-smyl-document.js?v=1',
  '/camila/my-smyl-portal.js?v=4',
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
  '/camila/smyl-gmail.js?v=1',
  '/camila/smyl-gmail.css?v=1',
  '/camila/icons/ui/my-smyl-example-before.svg',
  '/camila/icons/ui/my-smyl-example-after.svg',
  '/camila/smyl-patient-cases.css?v=2',
  '/camila/smyl-proposals.css?v=9',
  '/camila/smyl-proposals.js?v=12',
  '/camila/smyl-proposal-model.js?v=2',
  '/camila/smyl-proposal-print.js?v=4',
  '/camila/smyl-treatment-quote-stage3.js?v=1',
  '/camila/smyl-treatment-quote-stage3.css?v=1',
  '/camila/smyl-treatment-plan-model.js?v=1',
  '/camila/smyl-treatment-plan-client.js?v=1',
  '/camila/smyl-clinic.js?v=15',
  '/camila/smyl-patient-360.js?v=12',
  '/camila/smyl-patient-360.css?v=8',
  '/camila/smyl-patient-record-stage2.js?v=2',
  '/camila/smyl-patient-record-stage2.css?v=2',
  '/camila/smyl-case-workspace.js?v=18',
  '/camila/smyl-case-workspace.css?v=15',
  '/camila/smyl-clinic.css?v=8',
  '/camila/smyl-clinical-model.js?v=3',
  '/camila/smyl-panel.js?v=6',
  '/camila/smyl-panel.css?v=5',
  '/camila/smyl-clinic-admin.js?v=5',
  '/camila/smyl-clinic-admin.css?v=6',
  '/camila/smyl-professional-directory.js?v=12',
  '/camila/smyl-professional-directory.css?v=12',
  '/camila/smyl-design-system-v2.css?v=2',
  '/camila/smyl-ui-template-v3.css?v=5',
  '/camila/smyl-public-profile.css?v=1',
  '/camila/dentista.html',
  '/camila/resena.html',
  '/camila/smyl-dialog-system.js?v=1',
  '/camila/smyl-dialog-system.css?v=2',
  '/camila/smyl-schedule-grid.js?v=2',
  '/camila/smyl-schedule-slots.js?v=1',
  '/camila/smyl-schedule.js?v=27',
  '/camila/smyl-google-calendar.js?v=2',
  '/camila/smyl-schedule-message.js?v=2',
  '/camila/smyl-schedule-setup.js?v=2',
  '/camila/smyl-reminders.js?v=2',
  '/camila/smyl-templates.css?v=4',
  '/camila/smyl-template-catalog.js?v=3',
  '/camila/smyl-templates.js?v=4',
  '/camila/smyl-schedule.css?v=18',
  '/camila/smyl-google-calendar.css?v=2',
  '/camila/smyl-schedule-setup.css?v=2',
  '/camila/smyl-service-catalog-model.js?v=1',
  '/camila/smyl-service-catalog.js?v=3',
  '/camila/smyl-service-catalog.css?v=1',
  '/camila/smyl-service-catalog-stage1.css?v=1',
  '/camila/smyl-inventory.js?v=7',
  '/camila/smyl-inventory.css?v=6',
  '/camila/smyl-finance.js?v=8',
  '/camila/smyl-finance.css?v=6',
  '/camila/smyl-reports.js?v=4',
  '/camila/smyl-reports.css?v=4',
  '/camila/smyl-readiness.js?v=1',
  '/camila/smyl-readiness.css?v=2',
  '/camila/smyl-connections.js?v=13',
  '/camila/smyl-connections.css?v=8',
  '/camila/smyl-lana-handoff.js?v=5',
  '/camila/smyl-lana-handoff.css?v=1',
  '/camila/smyl-lana-attention.js?v=4',
  '/camila/smyl-lana-attention.css?v=1',
  '/camila/smyl-daily-home.js?v=11',
  '/camila/smyl-daily-home.css?v=12',
  '/camila/smyl-clinic-setup.js?v=5',
  '/camila/smyl-clinic-setup.css?v=2',
  '/camila/smyl-settings-hub.js?v=3',
  '/camila/smyl-settings-hub.css?v=3',
  '/camila/smyl-task-center.js?v=5',
  '/camila/smyl-task-center.css?v=1',
  '/camila/smyl-resilience.js?v=1',
  '/camila/smyl-resilience.css?v=1',
  '/camila/smyl-inbox.js?v=38',
  '/camila/smyl-inbox.css?v=35',
  '/camila/smyl-navigation.js?v=15',
  '/camila/smyl-navigation.css?v=3',
  '/camila/smyl-professional-v3.js?v=6',
  '/camila/smyl-professional-v3.css?v=7',
  '/camila/smyl-command-menu.js?v=3',
  '/camila/smyl-command-menu.css?v=1',
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

// Las rutas de STATIC_FILES se escriben con el prefijo /camila/ (GitHub Pages). En un dominio propio la app vive en
// la raíz, así que el prefijo se sustituye por el alcance real del service worker.
var SCOPE_PATH = new URL(self.registration.scope).pathname;
function scoped(url) {
  return url.indexOf('/camila/') === 0 ? SCOPE_PATH + url.slice('/camila/'.length) : url;
}

// ── INSTALL ──
self.addEventListener('install', function(e) {
  console.log('[SW] Installing SMYL PWA update...');
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      // Un recurso externo no debe impedir que se actualice toda la PWA.
      return Promise.all(STATIC_FILES.map(function(url) {
        return cache.add(new Request(scoped(url), { cache: 'reload' })).catch(function(err) {
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
          return cached || caches.match('/camila/simulacion-rapida.html').then(function(fallback) { return fallback || caches.match(scoped('/camila/simulacion-rapida.html')); });
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
