(function () {
  'use strict';
  var functionName = 'google-calendar-oauth';
  var button = null, dialog = null, connection = null;

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }); }
  async function errorMessage(error, fallback) { try { if (error && error.context && typeof error.context.json === 'function') { var body = await error.context.json(); if (body && body.error) return String(body.error); } } catch (_) {} return fallback; }
  async function invoke(action, extra) {
    if (!window.sb || !window.sb.functions) throw new Error('La sesión todavía no está lista.');
    var result = await window.sb.functions.invoke(functionName, { body: Object.assign({ action: action }, extra || {}) });
    if (result.error) throw new Error(await errorMessage(result.error, 'No se pudo comunicar con Google Calendar.'));
    return result.data || {};
  }
  function ensureDialog() { if (dialog) return dialog; dialog = document.createElement('dialog'); dialog.className = 'google-calendar-dialog'; dialog.setAttribute('aria-labelledby', 'google-calendar-title'); dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); }); document.body.appendChild(dialog); return dialog; }
  function renderLoading() {
    ensureDialog().innerHTML = '<section class="google-calendar-panel"><header class="google-calendar-head"><div class="google-calendar-mark"><span>G</span><div><h2 id="google-calendar-title">Google Calendar</h2><p>Conexión segura</p></div></div><button class="google-calendar-close" type="button" aria-label="Cerrar">×</button></header><div class="google-calendar-body"><p>Consultando la conexión…</p></div></section>';
    dialog.querySelector('.google-calendar-close').onclick = function () { dialog.close(); };
  }
  function render(errorText) {
    var connected = Boolean(connection && connection.connected), name = connected ? (connection.calendar_name || 'Calendario principal') : 'Sin conectar', detail = connected ? 'Acceso autorizado' : 'Autoriza tu calendario de Google';
    dialog.innerHTML = '<section class="google-calendar-panel"><header class="google-calendar-head"><div class="google-calendar-mark"><span>G</span><div><h2 id="google-calendar-title">Google Calendar</h2><p>Conexión segura</p></div></div><button class="google-calendar-close" type="button" aria-label="Cerrar">×</button></header><div class="google-calendar-body"><p>' + (connected ? 'SMYL ya puede preparar la sincronización segura de tus citas.' : 'Conecta tu cuenta para reflejar después las citas de SMYL en Google Calendar.') + '</p><div class="google-calendar-state" data-connected="' + connected + '"><span aria-hidden="true"></span><div><strong>' + esc(name) + '</strong><small>' + esc(detail) + '</small></div></div><div class="google-calendar-note">SMYL conservará el control de la agenda. No se enviarán notas clínicas a Google.</div>' + (errorText ? '<p class="google-calendar-error" role="alert">' + esc(errorText) + '</p>' : '') + '</div><footer class="google-calendar-actions"><button type="button" class="btn btn-secondary" data-google-cancel>Cerrar</button>' + (connected ? '<button type="button" class="btn btn-secondary" data-google-disconnect>Desconectar</button>' : '<button type="button" class="btn btn-primary" data-google-connect>Conectar Google</button>') + '</footer></section>';
    dialog.querySelector('.google-calendar-close').onclick = dialog.querySelector('[data-google-cancel]').onclick = function () { dialog.close(); };
    var connect = dialog.querySelector('[data-google-connect]'); if (connect) connect.onclick = begin;
    var disconnect = dialog.querySelector('[data-google-disconnect]'); if (disconnect) disconnect.onclick = remove;
  }
  async function loadStatus() { connection = await invoke('status'); if (button) button.dataset.state = connection.connected ? 'connected' : 'disconnected'; return connection; }
  async function open() { renderLoading(); ensureDialog().showModal(); try { await loadStatus(); render(); } catch (error) { connection = { connected: false }; render(error.message); } }
  async function begin() { var connect = dialog.querySelector('[data-google-connect]'); if (connect) { connect.disabled = true; connect.textContent = 'Abriendo Google…'; } try { var data = await invoke('start', { return_url: window.location.origin + window.location.pathname }); if (!data.authorization_url) throw new Error('No se recibió la dirección de autorización.'); window.location.assign(data.authorization_url); } catch (error) { render(error.message); } }
  async function remove() { var disconnect = dialog.querySelector('[data-google-disconnect]'); if (disconnect) { disconnect.disabled = true; disconnect.textContent = 'Desconectando…'; } try { connection = await invoke('disconnect'); if (button) button.dataset.state = 'disconnected'; render(); } catch (error) { render(error.message); } }
  function attach() { var actions = document.querySelector('#p-agenda .schedule-head-actions'); if (!actions) return false; button = document.getElementById('schedule-google-calendar'); if (!button) { button = document.createElement('button'); button.type = 'button'; button.id = 'schedule-google-calendar'; button.className = 'btn btn-secondary schedule-google-calendar'; button.setAttribute('aria-haspopup', 'dialog'); button.textContent = 'Google Calendar'; actions.prepend(button); } if (button.dataset.googleReady === 'true') return true; button.dataset.googleReady = 'true'; button.addEventListener('click', open); loadStatus().catch(function () { button.dataset.state = 'unknown'; }); return true; }
  function handleCallback() { var url = new URL(window.location.href), outcome = url.searchParams.get('google_calendar'); if (!outcome) return; url.searchParams.delete('google_calendar'); window.history.replaceState({}, '', url.pathname + url.search + '#agenda'); window.setTimeout(function () { if (typeof window.ir === 'function') window.ir('agenda'); attach(); if (outcome !== 'connected') open(); }, 600); }
  document.addEventListener('DOMContentLoaded', function () { handleCallback(); if (attach()) return; var observer = new MutationObserver(function () { if (attach()) observer.disconnect(); }); observer.observe(document.body, { childList: true, subtree: true }); });
})();

