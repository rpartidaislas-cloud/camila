/* SMYL · Vigilante de congelamientos (lado de la página).
 *
 * Lo carga smyl-sentry.js sólo si hay DSN. Crea un Worker y le manda:
 *  - un latido cada segundo (si deja de llegar, la página está congelada);
 *  - un resumen sin texto de la página: pantalla activa, último clic (etiqueta#id.clase) y cuántos
 *    cambios de DOM por segundo hay y en qué contenedor. Ese dato delata bucles de MutationObserver.
 * Ver docs/SMYL_SENTRY.md.
 */
(function () {
  'use strict';
  if (window.SmylFreezeWatchdog || typeof Worker === 'undefined' || !window.SmylSentry || typeof window.SmylSentry.config !== 'function') return;
  var cfg = window.SmylSentry.config();
  if (!cfg) return;

  var worker;
  try { worker = new Worker('smyl-freeze-watchdog-worker.js?v=1'); } catch (_) { return; }
  worker.onerror = function () { try { worker.terminate(); } catch (_) {} };

  var lastAction = '';
  var lastActionAt = 0;
  var mutationCount = 0;
  var mutationTarget = '';
  var windowStart = Date.now();
  var lastStateAt = 0;
  var lastRate = 0;

  function selectorOf(el) {
    if (!el || el.nodeType !== 1) el = el && el.parentElement;
    if (!el || !el.tagName) return '';
    var out = el.tagName.toLowerCase();
    if (el.id) out += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) out += '.' + el.className.trim().split(/\s+/)[0];
    return out.slice(0, 80);
  }

  function containerOf(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && !el.id && el.parentElement) el = el.parentElement;
    return selectorOf(el);
  }

  function activeRoute() {
    var panel = document.querySelector('.pantalla.activa');
    if (panel && panel.id) return panel.id;
    return String(location.pathname).split('/').pop() || 'index';
  }

  // Cambios de DOM por segundo en una ventana de ~1 s (se enrolla sola, aunque no corran temporizadores).
  function mutationRate(now) {
    var seconds = (now - windowStart) / 1000;
    if (seconds >= 1) { lastRate = mutationCount / seconds; mutationCount = 0; windowStart = now; seconds = 0; }
    return seconds >= 0.5 ? mutationCount / seconds : lastRate;
  }

  function snapshot() {
    var now = Date.now();
    return {
      route: activeRoute(),
      lastAction: lastAction,
      lastActionAgoS: lastActionAt ? (now - lastActionAt) / 1000 : 0,
      mutationsPerSecond: mutationRate(now),
      mutationTarget: mutationTarget,
      online: navigator.onLine !== false
    };
  }

  function post(type, extra) {
    try {
      var message = { type: type };
      if (extra) Object.keys(extra).forEach(function (k) { message[k] = extra[k]; });
      worker.postMessage(message);
    } catch (_) {}
  }

  post('init', cfg);

  // Latido: sólo un temporizador (macrotarea). Un bucle de microtareas lo deja sin ejecutarse.
  setInterval(function () {
    post('ping', { snapshot: snapshot() });
    var ctx = window.SmylSentry.config();
    if (ctx) post('context', { userId: ctx.userId, clinic: ctx.clinic, role: ctx.role });
  }, 1000);

  document.addEventListener('visibilitychange', function () {
    post('visibility', { visible: document.visibilityState !== 'hidden' });
  });
  post('visibility', { visible: document.visibilityState !== 'hidden' });

  document.addEventListener('click', function (ev) {
    lastAction = selectorOf(ev.target);
    lastActionAt = Date.now();
  }, true);

  // Un worker recibe mensajes aunque la página esté atascada: así llega el estado justo durante el bucle.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function (records) {
      mutationCount += records.length;
      var last = records[records.length - 1];
      if (last) mutationTarget = containerOf(last.target);
      var now = Date.now();
      if (now - lastStateAt > 250) {
        lastStateAt = now;
        post('state', { snapshot: snapshot() });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.SmylFreezeWatchdog = Object.freeze({ snapshot: snapshot });
})();
