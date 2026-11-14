/* SMYL · Sentry: avisos de errores del navegador, sin datos de pacientes.
 *
 * - Sin DSN no hace nada (no descarga la librería ni abre conexiones).
 * - Sólo errores: sin trazas de rendimiento ni grabación de pantalla.
 * - Antes de enviar, todo texto pasa por scrubText(): correos, teléfonos, tokens,
 *   imágenes en base64 y las partes ?consulta y #fragmento de cualquier URL
 *   (los enlaces de pacientes llevan credenciales en el fragmento).
 * - Ver docs/SMYL_SENTRY.md para activarlo, probarlo y qué se envía exactamente.
 */
(function () {
  'use strict';

  var CONFIG = {
    // El DSN de Sentry es público por diseño (sólo permite ENVIAR eventos). Pegarlo aquí activa la integración.
    dsn: 'https://7dc513205b42f8422ecdff466f07011c@o4512394436083712.ingest.us.sentry.io/4512394468786176',
    release: 'smyl-web@2026-11-08',
    library: 'vendor/sentry-browser-10.78.0.min.js?v=1',
    watchdog: 'smyl-freeze-watchdog.js?v=1',
    maxEventsPerPage: 30,
    dedupeMs: 60000,
    maxDepth: 8
  };

  var dsn = CONFIG.dsn || window.SMYL_SENTRY_DSN || '';
  var state = { enabled: false, ready: false, sent: 0, seen: {}, buffer: [], context: {} };

  // ── Limpieza de texto ────────────────────────────────────────────────
  var URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;
  var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  var JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
  var BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi;
  var DATA_URL_RE = /data:[a-z0-9.+\/-]+;base64,[A-Za-z0-9+\/=]+/gi;
  var BLOB_RE = /\b(?:blob:|filesystem:)[^\s"'<>)]+/gi;
  var LONG_TOKEN_RE = /\b[A-Za-z0-9+\/_-]{40,}={0,2}/g;
  var SECRET_PARAM_RE = /\b(access_token|refresh_token|id_token|token|apikey|api_key|key|code|password|secret)=[^\s&"'<>]+/gi;
  var PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

  function scrubUrl(value) {
    return String(value).replace(/[?#].*$/, '');
  }

  var UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

  function scrubPlain(value) {
    return value
      .replace(DATA_URL_RE, '[imagen]')
      .replace(BLOB_RE, '[archivo]')
      .replace(URL_RE, function (url) { return scrubUrl(url); })
      .replace(SECRET_PARAM_RE, '$1=[omitido]')
      .replace(JWT_RE, '[token]')
      .replace(BEARER_RE, '$1 [token]')
      .replace(EMAIL_RE, '[correo]')
      .replace(LONG_TOKEN_RE, function (token) { return /\d/.test(token) ? '[token]' : token; })
      .replace(PHONE_RE, function (match) {
        return match.replace(/\D/g, '').length >= 8 ? '[teléfono]' : match;
      });
  }

  // Los UUID son identificadores opacos útiles para depurar: se conservan tal cual y el resto se limpia.
  function scrubText(value) {
    if (typeof value !== 'string' || !value) return value;
    return value.split(UUID_RE).map(function (part, index) {
      return index % 2 === 1 ? part : scrubPlain(part);
    }).join('');
  }

  var DROPPED_KEYS = /^(cookies?|authorization|api[-_]?key|apikey|password|passwd|token|secret|email|phone|telefono|nombre)$/i;
  // Metadatos del propio evento: no contienen datos del paciente y la limpieza los estropearía (fechas de versión, ids de evento).
  var SAFE_KEYS = /^(release|environment|event_id|timestamp|platform|level|sdk|lineno|colno|in_app|handled|mechanism)$/;
  var URL_KEYS = /^(url|from|to|href|referrer|referer|origin|transaction|query_string)$/i;

  function scrubValue(value, key, depth) {
    if (SAFE_KEYS.test(key || '')) return value;
    if (depth > CONFIG.maxDepth) return '[profundidad]';
    if (typeof value === 'string') return URL_KEYS.test(key || '') ? scrubText(scrubUrl(value)) : scrubText(value);
    if (Array.isArray(value)) return value.map(function (item) { return scrubValue(item, key, depth + 1); });
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) {
        if (DROPPED_KEYS.test(k)) { out[k] = '[omitido]'; return; }
        out[k] = scrubValue(value[k], k, depth + 1);
      });
      return out;
    }
    return value;
  }

  function scrubEvent(event) {
    if (!event || typeof event !== 'object') return event;
    // Nombre de tipo de error (p. ej. "TypeError") y nombres de archivo/función no son datos del paciente: se conservan.
    var keep = { type: event.exception && event.exception.values && event.exception.values.map(function (v) { return v.type; }) };
    var user = event.user;
    var request = event.request;
    delete event.user;
    delete event.request;
    var clean = scrubValue(event, '', 0);
    if (keep.type && clean.exception && clean.exception.values) {
      clean.exception.values.forEach(function (v, i) { if (keep.type[i]) v.type = keep.type[i]; });
    }
    // Sólo se conserva un identificador opaco, nunca correo, nombre ni IP.
    var id = (user && user.id) || state.context.userId;
    if (id) clean.user = { id: String(id) };
    if (request && request.url) clean.request = { url: scrubText(scrubUrl(request.url)) };
    clean.tags = Object.assign({}, clean.tags, state.context.tags);
    return clean;
  }

  function scrubBreadcrumb(crumb) {
    if (!crumb) return null;
    // La consola y lo escrito en campos pueden contener nombres o notas clínicas.
    if (crumb.category === 'console' || crumb.category === 'ui.input') return null;
    return scrubValue(crumb, '', 0);
  }

  // ── Filtros y límites ────────────────────────────────────────────────
  function isNoise(event, hint) {
    var original = hint && hint.originalException;
    var message = (original && original.message) || (event.exception && event.exception.values && event.exception.values[0] && event.exception.values[0].value) || event.message || '';
    if (/ResizeObserver loop/i.test(message)) return true;
    if (/^Script error\.?$/i.test(message)) return true;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return false;
  }

  function fingerprint(event) {
    var value = event.exception && event.exception.values && event.exception.values[0];
    var frames = value && value.stacktrace && value.stacktrace.frames;
    var top = frames && frames[frames.length - 1];
    return [value ? value.type : '', value ? String(value.value || '').slice(0, 120) : event.message || '', top ? top.filename + ':' + top.lineno : ''].join('|');
  }

  function beforeSend(event, hint) {
    if (isNoise(event, hint)) return null;
    var clean = scrubEvent(event);
    var key = fingerprint(clean);
    var now = Date.now();
    if (state.seen[key] && now - state.seen[key] < CONFIG.dedupeMs) return null;
    if (state.sent >= CONFIG.maxEventsPerPage) return null;
    state.seen[key] = now;
    state.sent += 1;
    return clean;
  }

  // ── Arranque ─────────────────────────────────────────────────────────
  function environment() {
    var host = String(location.hostname || '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return window.Capacitor ? 'mobile' : 'development';
    return window.Capacitor ? 'mobile' : 'production';
  }

  function startLibrary() {
    var lib = window.SmylSentryLib;
    if (!lib) return;
    lib.init({
      dsn: dsn,
      release: CONFIG.release,
      environment: environment(),
      sendDefaultPii: false,
      attachStacktrace: true,
      maxBreadcrumbs: 30,
      tracesSampleRate: 0,
      defaultIntegrations: false,
      integrations: [
        lib.inboundFiltersIntegration(),
        lib.functionToStringIntegration(),
        lib.linkedErrorsIntegration(),
        lib.dedupeIntegration(),
        lib.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
        lib.browserApiErrorsIntegration(),
        lib.breadcrumbsIntegration({ console: false, dom: true, fetch: true, history: true, xhr: true })
      ],
      stackParser: lib.defaultStackParser,
      transport: lib.makeFetchTransport,
      allowUrls: [location.origin, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\//],
      beforeSend: beforeSend,
      beforeBreadcrumb: scrubBreadcrumb
    });
    if (window.Capacitor) lib.setTag('platform', 'capacitor');
    lib.setTag('page', String(location.pathname).split('/').pop() || 'index');
    state.ready = true;
    window.removeEventListener('error', onEarlyError, true);
    window.removeEventListener('unhandledrejection', onEarlyRejection);
    state.buffer.splice(0).forEach(function (item) { lib.captureException(item); });
  }

  // Errores ocurridos mientras se descarga la librería: se guardan unos pocos y se reenvían.
  function onEarlyError(ev) {
    if (ev.target && ev.target !== window) return; // fallo de carga de una imagen o script, no un error de código
    if (state.buffer.length < 10) state.buffer.push(ev.error instanceof Error ? ev.error : new Error(String(ev.message || 'error')));
  }
  function onEarlyRejection(ev) {
    if (state.buffer.length < 10) state.buffer.push(ev.reason instanceof Error ? ev.reason : new Error('Promesa rechazada: ' + String(ev.reason)));
  }

  function loadLibrary() {
    window.addEventListener('error', onEarlyError, true);
    window.addEventListener('unhandledrejection', onEarlyRejection);
    var script = document.createElement('script');
    script.src = CONFIG.library;
    script.async = true;
    script.onload = startLibrary;
    script.onerror = function () { state.enabled = false; };
    (document.head || document.documentElement).appendChild(script);
  }

  // El vigilante de congelamientos se descarga al terminar de cargar la página para no competir con ella.
  function loadFreezeWatchdog() {
    function inject() {
      var script = document.createElement('script');
      script.src = CONFIG.watchdog;
      script.async = true;
      (document.head || document.documentElement).appendChild(script);
    }
    if (document.readyState === 'complete') inject();
    else window.addEventListener('load', function () { setTimeout(inject, 0); });
  }

  // ── API pública ──────────────────────────────────────────────────────
  function lib() { return state.ready ? window.SmylSentryLib : null; }

  var api = {
    get enabled() { return state.enabled; },
    get ready() { return state.ready; },
    // Identificadores opacos de la sesión (id de usuario/clínica y rol). Nunca correo ni nombre.
    setContext: function (info) {
      info = info || {};
      state.context.userId = info.userId || state.context.userId;
      state.context.tags = Object.assign({}, state.context.tags, {
        clinic: info.tenantId ? String(info.tenantId) : (state.context.tags || {}).clinic,
        role: info.role ? String(info.role) : (state.context.tags || {}).role
      });
      var l = lib();
      if (l) {
        if (state.context.userId) l.setUser({ id: String(state.context.userId) });
        if (state.context.tags.clinic) l.setTag('clinic', state.context.tags.clinic);
        if (state.context.tags.role) l.setTag('role', state.context.tags.role);
      }
    },
    // Para errores que la app atrapa con try/catch pero que conviene conocer.
    capture: function (error, context) {
      var l = lib();
      if (!l) return false;
      var err = error instanceof Error ? error : new Error(String(error));
      l.withScope(function (scope) {
        if (context && context.area) scope.setTag('area', String(context.area));
        l.captureException(err);
      });
      return true;
    },
    // Envía un error de prueba para comprobar que llega a Sentry.
    test: function () {
      var l = lib();
      if (!l) return false;
      state.seen = {};
      l.captureException(new Error('Prueba de Sentry desde SMYL'));
      return true;
    },
    // Datos que necesita el vigilante de congelamientos (corre en un Worker y envía por su cuenta).
    config: function () {
      var m = /^https:\/\/([0-9a-f]+)@([^\/]+)\/(\d+)$/i.exec(dsn || '');
      if (!m) return null;
      return {
        endpoint: 'https://' + m[2] + '/api/' + m[3] + '/envelope/?sentry_key=' + m[1] + '&sentry_version=7',
        dsn: dsn,
        release: CONFIG.release,
        environment: environment(),
        platform: window.Capacitor ? 'capacitor' : 'web',
        page: String(location.pathname).split('/').pop() || 'index',
        userId: state.context.userId || '',
        clinic: (state.context.tags || {}).clinic || '',
        role: (state.context.tags || {}).role || ''
      };
    },
    flush: function () { var l = lib(); return l ? l.flush(2000) : Promise.resolve(false); },
    _scrubText: scrubText,
    _scrubEvent: scrubEvent,
    _scrubBreadcrumb: scrubBreadcrumb,
    _beforeSend: beforeSend
  };
  window.SmylSentry = api;

  if (!dsn) return;
  state.enabled = true;
  if (typeof document !== 'undefined') {
    loadLibrary();
    loadFreezeWatchdog();
  }
})();
