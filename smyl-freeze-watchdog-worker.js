/* SMYL · Vigilante de congelamientos (Worker).
 *
 * Una página congelada por un bucle (p. ej. dos observadores de DOM que se recrean sin fin) no lanza
 * ningún error, así que Sentry no la ve. Este Worker vive en otro hilo: la página le manda un "latido"
 * cada segundo; si deja de llegar mientras la pestaña está visible, avisa a Sentry por su cuenta.
 *
 * Sólo envía datos de una lista cerrada (nombre de pantalla, selector sin texto, contadores).
 * Nunca recibe ni envía contenido de la página.
 */
(function () {
  'use strict';

  var THRESHOLD_MS = 6000;      // sin latido durante este tiempo => congelada
  var TICK_MS = 1000;
  var SLEEP_GAP_MS = 4000;      // si el propio Worker se atrasó tanto, el equipo estuvo dormido: no es un congelamiento
  var MAX_REPORTS = 3;          // por carga de página
  var MIN_BETWEEN_MS = 30000;

  var cfg = null;
  var visible = true;
  var lastPing = Date.now();
  var lastTick = Date.now();
  var snapshot = {};
  var report = null;            // { startedAt, lastPing } mientras dure el congelamiento reportado
  var sent = 0;
  var lastSentAt = 0;

  function safeId(value, max) {
    return String(value == null ? '' : value).replace(/[^A-Za-z0-9._:@\u00C0-\u017F-]/g, '').slice(0, max || 80);
  }
  // Pantallas y selectores tienen una forma fija (etiqueta#id o etiqueta.clase); cualquier otra cosa se descarta.
  var SELECTOR_RE = /^[A-Za-z][A-Za-z0-9-]*(?:[#.][A-Za-z0-9_:-]+)?$/;
  var ROUTE_RE = /^[A-Za-z0-9_.-]{1,60}$/;
  function shaped(value, regex, max) {
    var text = String(value == null ? '' : value).slice(0, max);
    return text === '' ? '' : (regex.test(text) ? text : '[omitido]');
  }
  function safeNumber(value) {
    var n = Number(value);
    return isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  function cleanSnapshot(raw) {
    raw = raw || {};
    return {
      route: shaped(raw.route, ROUTE_RE, 60),
      lastAction: shaped(raw.lastAction, SELECTOR_RE, 80),
      lastActionAgoS: safeNumber(raw.lastActionAgoS),
      mutationsPerSecond: safeNumber(raw.mutationsPerSecond),
      mutationTarget: shaped(raw.mutationTarget, SELECTOR_RE, 80),
      online: raw.online !== false
    };
  }

  function eventId() {
    var out = '';
    for (var i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function buildEvent(outcome, seconds) {
    var snap = snapshot;
    var tags = {
      outcome: outcome,
      route: snap.route || 'desconocida',
      page: safeId(cfg.page, 60),
      platform: safeId(cfg.platform, 20)
    };
    if (cfg.clinic) tags.clinic = safeId(cfg.clinic, 64);
    if (cfg.role) tags.role = safeId(cfg.role, 20);
    var event = {
      event_id: eventId(),
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      message: outcome === 'recovered' ? 'Página congelada: se recuperó' : 'Página congelada (hilo principal bloqueado)',
      logger: 'smyl.freeze-watchdog',
      release: safeId(cfg.release, 80),
      environment: safeId(cfg.environment, 20),
      tags: tags,
      // Un solo issue por pantalla: la alerta "ongoing" y la "recovered" quedan agrupadas.
      fingerprint: ['smyl-freeze', cfg.page, snap.route || 'desconocida'],
      extra: {
        secondsWithoutResponse: safeNumber(seconds),
        route: snap.route,
        lastAction: snap.lastAction,
        lastActionSecondsBefore: snap.lastActionAgoS,
        domMutationsPerSecond: snap.mutationsPerSecond,
        domMutationTarget: snap.mutationTarget,
        online: snap.online
      },
      sdk: { name: 'smyl.freeze-watchdog', version: '1' }
    };
    if (cfg.userId) event.user = { id: safeId(cfg.userId, 64) };
    return event;
  }

  function send(event) {
    try {
      var header = { event_id: event.event_id, sent_at: new Date().toISOString(), dsn: cfg.dsn };
      var body = JSON.stringify(header) + '\n' + JSON.stringify({ type: 'event' }) + '\n' + JSON.stringify(event);
      // text/plain evita la comprobación previa de CORS; Sentry acepta el sobre igualmente.
      var request = fetch(cfg.endpoint, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true, mode: 'cors' });
      if (request && request.catch) request.catch(function () {});
    } catch (_) {}
  }

  function tick() {
    var now = Date.now();
    var workerGap = now - lastTick;
    lastTick = now;
    if (workerGap > SLEEP_GAP_MS) {      // el equipo durmió o el Worker se suspendió
      lastPing = now;
      report = null;
      return;
    }
    if (!cfg || !visible || report) return;
    var gap = now - lastPing;
    if (gap < THRESHOLD_MS) return;
    if (sent >= MAX_REPORTS || now - lastSentAt < MIN_BETWEEN_MS) return;
    report = { startedAt: now, lastPing: lastPing };
    sent += 1;
    lastSentAt = now;
    send(buildEvent('ongoing', gap / 1000));
  }

  function onMessage(ev) {
    var data = ev && ev.data;
    if (!data || typeof data.type !== 'string') return;
    var now = Date.now();
    if (data.type === 'init') {
      cfg = {
        endpoint: String(data.endpoint || ''), dsn: String(data.dsn || ''), release: data.release, environment: data.environment,
        platform: data.platform, page: data.page, userId: data.userId, clinic: data.clinic, role: data.role
      };
      if (!/^https:\/\/[^\/]+\/api\/\d+\/envelope\/\?sentry_key=[0-9a-f]+&sentry_version=7$/i.test(cfg.endpoint)) cfg = null;
      lastPing = now;
    } else if (data.type === 'state') {
      // Lo manda el observador de DOM aun cuando la página está atascada: no cuenta como latido.
      snapshot = cleanSnapshot(data.snapshot);
    } else if (data.type === 'ping') {
      snapshot = cleanSnapshot(data.snapshot);
      if (report && cfg) {
        send(buildEvent('recovered', (now - report.lastPing) / 1000));
        report = null;
      }
      lastPing = now;
    } else if (data.type === 'visibility') {
      visible = Boolean(data.visible);
      lastPing = now;
      report = null;
    } else if (data.type === 'context' && cfg) {
      cfg.userId = data.userId || cfg.userId;
      cfg.clinic = data.clinic || cfg.clinic;
      cfg.role = data.role || cfg.role;
    }
  }

  self.onmessage = onMessage;
  setInterval(tick, TICK_MS);
})();
