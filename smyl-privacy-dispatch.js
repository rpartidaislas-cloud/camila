/* SMYL · Dispara el envío automático del aviso de privacidad a pacientes nuevos (Edge Function privacy-notice-dispatch).
 * Corre en segundo plano, solo para quien puede gestionar pacientes, como máximo una vez cada 10 minutos y solo si la clínica lo
 * tiene encendido. Si algo falla no avisa ni estorba: se reintenta en la siguiente apertura. */
(function (root, factory) { var api = factory(root); if (typeof module === 'object' && module.exports) module.exports = api; else root.SmylPrivacyDispatch = api; })(globalThis, function (win) {
  'use strict';
  var EVERY_MS = 10 * 60 * 1000, ROUTES = ['consultorio', 'inbox', 'pacientes', 'inicio'];
  var state = { last: 0, running: false, tenant: '', enabled: null };
  function due(now, last, every) { return !last || now - last >= (every || EVERY_MS); }
  function shouldRun(route) { return ROUTES.indexOf(route) >= 0; }
  async function run() {
    if (!win.sb || !win.tenantId || state.running) return null;
    if (state.tenant !== win.tenantId) { state.tenant = win.tenantId; state.last = 0; state.enabled = null; }
    if (!due(Date.now(), state.last)) return null;
    state.running = true; state.last = Date.now();
    try {
      if (state.enabled === null || state.enabled === false) {
        var s = await win.sb.rpc('smyl_get_privacy_settings', {});
        if (s.error || !s.data) { state.enabled = null; return null; }   // sin permiso o sin migración: no hace nada
        state.enabled = s.data.auto_send_notice === true;
      }
      if (!state.enabled) return null;
      var r = await win.sb.functions.invoke('privacy-notice-dispatch', { body: { action: 'dispatch' } });
      return r && r.data ? r.data : null;
    } catch (e) { return null; }
    finally { state.running = false; }
  }
  function reset() { state.last = 0; state.enabled = null; }
  function init() {
    if (!win || !win.document || typeof win.ir !== 'function') return;
    var previous = win.ir;
    win.ir = function (route) { var result = previous.apply(this, arguments); if (shouldRun(route)) setTimeout(run, 2500); return result; };
    setTimeout(run, 8000);
  }
  if (win && win.document) { if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', init); else init(); }
  return { run: run, reset: reset, due: due, shouldRun: shouldRun, EVERY_MS: EVERY_MS };
});
