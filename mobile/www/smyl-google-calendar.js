(function () {
  'use strict';
  var oauthFunction = 'google-calendar-oauth', syncFunction = 'google-calendar-sync';
  var button = null, dialog = null, connection = null, syncing = false;

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }); }
  async function errorMessage(error, fallback) { try { if (error && error.context && typeof error.context.json === 'function') { var body = await error.context.json(); if (body && body.error) return String(body.error); } } catch (_) {} return fallback; }
  async function invoke(name, action, extra) {
    if (!window.sb || !window.sb.functions) throw new Error('La sesión todavía no está lista.');
    var result = await window.sb.functions.invoke(name, { body: Object.assign({ action: action }, extra || {}) });
    if (result.error) throw new Error(await errorMessage(result.error, 'No se pudo comunicar con Google Calendar.'));
    return result.data || {};
  }
  function fmt(value) { if (!value) return ''; return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  function ensureDialog() { if (dialog) return dialog; dialog = document.createElement('dialog'); dialog.className = 'google-calendar-dialog'; dialog.setAttribute('aria-labelledby', 'google-calendar-title'); dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); }); document.body.appendChild(dialog); return dialog; }
  function renderLoading() {
    ensureDialog().innerHTML = '<section class="google-calendar-panel"><header class="google-calendar-head"><div class="google-calendar-mark"><span>G</span><div><h2 id="google-calendar-title">Google Calendar</h2><p>Sincronización segura</p></div></div><button class="google-calendar-close" type="button" aria-label="Cerrar">×</button></header><div class="google-calendar-body"><p>Consultando la conexión…</p></div></section>';
    dialog.querySelector('.google-calendar-close').onclick = function () { dialog.close(); };
  }
  function render(errorText) {
    var connected = Boolean(connection && connection.connected), name = connected ? (connection.calendar_name || 'Calendario principal') : 'Sin conectar';
    var detail = connected ? (connection.last_sync_at ? 'Última sincronización: ' + fmt(connection.last_sync_at) : 'Listo para sincronizar') : 'Autoriza tu calendario de Google';
    dialog.innerHTML = '<section class="google-calendar-panel"><header class="google-calendar-head"><div class="google-calendar-mark"><span>G</span><div><h2 id="google-calendar-title">Google Calendar</h2><p>Tu calendario profesional</p></div></div><button class="google-calendar-close" type="button" aria-label="Cerrar">×</button></header><div class="google-calendar-body"><p>' + (connected ? 'SMYL envía tus citas. Los cambios de Google esperan tu revisión.' : 'Conecta la cuenta que usas como dentista.') + '</p><div class="google-calendar-state" data-connected="' + connected + '"><span aria-hidden="true"></span><div><strong>' + esc(name) + '</strong><small>' + esc(detail) + '</small></div></div><div class="google-calendar-note"><strong>SMYL conserva el control.</strong> No se comparten pacientes ni notas clínicas.</div>' + (errorText ? '<p class="google-calendar-error" role="alert">' + esc(errorText) + '</p>' : '') + '</div><footer class="google-calendar-actions"><button type="button" class="btn btn-secondary" data-google-cancel>Cerrar</button>' + (connected ? '<button type="button" class="btn btn-secondary" data-google-disconnect>Desconectar</button><button type="button" class="btn btn-primary" data-google-sync>' + (syncing ? 'Sincronizando…' : 'Sincronizar ahora') + '</button>' : '<button type="button" class="btn btn-primary" data-google-connect>Conectar Google</button>') + '</footer></section>';
    dialog.querySelector('.google-calendar-close').onclick = dialog.querySelector('[data-google-cancel]').onclick = function () { dialog.close(); };
    var connect = dialog.querySelector('[data-google-connect]'); if (connect) connect.onclick = begin;
    var disconnect = dialog.querySelector('[data-google-disconnect]'); if (disconnect) disconnect.onclick = remove;
    var sync = dialog.querySelector('[data-google-sync]'); if (sync) { sync.disabled = syncing; sync.onclick = syncNow; }
  }
  async function loadStatus() { connection = await invoke(oauthFunction, 'status'); if (button) button.dataset.state = connection.connected ? 'connected' : 'disconnected'; return connection; }
  async function open() { renderLoading(); ensureDialog().showModal(); try { await loadStatus(); render(); } catch (error) { connection = { connected: false }; render(error.message); } }
  async function begin() { var connect = dialog.querySelector('[data-google-connect]'); if (connect) { connect.disabled = true; connect.textContent = 'Abriendo Google…'; } try { var data = await invoke(oauthFunction, 'start', { return_url: window.location.origin + window.location.pathname }); if (!data.authorization_url) throw new Error('No se recibió la dirección de autorización.'); window.location.assign(data.authorization_url); } catch (error) { render(error.message); } }
  async function remove() { var disconnect = dialog.querySelector('[data-google-disconnect]'); if (disconnect) { disconnect.disabled = true; disconnect.textContent = 'Desconectando…'; } try { connection = await invoke(oauthFunction, 'disconnect'); if (button) button.dataset.state = 'disconnected'; render(); await renderChanges(); } catch (error) { render(error.message); } }
  async function runSync(silent) {
    if (syncing || !connection || !connection.connected) return;
    syncing = true; if (!silent && dialog && dialog.open) render();
    try { await invoke(syncFunction, 'run'); await loadStatus(); await renderChanges(); if (!silent && dialog && dialog.open) render(); }
    catch (error) { if (!silent && dialog && dialog.open) render(error.message); }
    finally { syncing = false; if (!silent && dialog && dialog.open) render(); }
  }
  async function syncNow() { await runSync(false); }
  function ensureReviewPanel() {
    var tabs = document.querySelector('#p-agenda .schedule-tabs'); if (!tabs) return null;
    var tab = tabs.querySelector('[data-schedule-tab="google"]');
    if (!tab) { tab = document.createElement('button'); tab.type = 'button'; tab.dataset.scheduleTab = 'google'; tab.innerHTML = 'Por revisar <span id="schedule-google-count"></span>'; tabs.querySelector('[data-schedule-tab="settings"]').before(tab); tab.onclick = function () { document.querySelectorAll('#p-agenda [data-schedule-tab]').forEach(function (node) { node.setAttribute('aria-selected', String(node === tab)); }); document.querySelectorAll('#p-agenda [data-schedule-panel]').forEach(function (node) { node.hidden = node.dataset.schedulePanel !== 'google'; }); renderChanges(); }; }
    var panel = document.querySelector('#p-agenda [data-schedule-panel="google"]');
    if (!panel) { panel = document.createElement('section'); panel.dataset.schedulePanel = 'google'; panel.hidden = true; panel.innerHTML = '<div class="schedule-section-title"><div><h2>Cambios de Google</h2><p>Acepta o rechaza antes de cambiar SMYL.</p></div><button class="btn btn-secondary" type="button" data-google-refresh>Actualizar</button></div><div id="schedule-google-changes"></div>'; document.querySelector('#p-agenda [data-schedule-panel="settings"]').before(panel); panel.querySelector('[data-google-refresh]').onclick = function () { runSync(true).then(renderChanges); }; }
    return panel;
  }
  function changeCopy(change) {
    if (change.change_type === 'cancel') return { title: 'Cancelar cita', detail: 'Google eliminó este evento.' };
    if (change.change_type === 'reschedule') return { title: 'Cambiar horario', detail: fmt(change.proposed_start) + (change.proposed_end ? ' — ' + fmt(change.proposed_end) : '') };
    return { title: 'Evento nuevo', detail: fmt(change.proposed_start) + ' · Completa paciente, servicio y sede.' };
  }
  async function renderChanges() {
    var panel = ensureReviewPanel(), host = document.getElementById('schedule-google-changes'), count = document.getElementById('schedule-google-count'); if (!panel || !host) return;
    if (!connection || !connection.connected) { host.innerHTML = '<div class="schedule-google-empty"><strong>Conecta Google Calendar</strong><p>Los cambios externos aparecerán aquí.</p><button class="btn btn-primary" type="button" data-open-google>Conectar</button></div>'; host.querySelector('[data-open-google]').onclick = open; if (count) count.textContent = ''; return; }
    host.innerHTML = '<div class="schedule-google-empty"><p>Buscando cambios…</p></div>';
    try {
      var data = await invoke(syncFunction, 'list_changes'), changes = data.changes || []; if (count) count.textContent = changes.length || '';
      if (!changes.length) { host.innerHTML = '<div class="schedule-google-empty"><strong>Todo al día</strong><p>No hay cambios de Google por revisar.</p></div>'; return; }
      host.innerHTML = '<div class="schedule-google-list">' + changes.map(function (change) { var copy = changeCopy(change); return '<article data-google-change="' + esc(change.id) + '"><div class="schedule-google-change-icon" data-kind="' + esc(change.change_type) + '">G</div><div><span>' + esc(change.google_summary || 'Evento de Google') + '</span><strong>' + esc(copy.title) + '</strong><p>' + esc(copy.detail) + '</p></div><div class="schedule-google-change-actions">' + (change.change_type === 'create' ? '<button class="btn btn-primary" type="button" data-google-book="' + esc(change.proposed_start || '') + '">Agendar en SMYL</button>' : '<button class="btn btn-primary" type="button" data-google-decision="accept">Aceptar</button>') + '<button class="btn btn-secondary" type="button" data-google-decision="reject">' + (change.change_type === 'create' ? 'Descartar' : 'Rechazar') + '</button></div></article>'; }).join('') + '</div>';
      host.querySelectorAll('[data-google-decision]').forEach(function (action) { action.onclick = async function () { var article = action.closest('[data-google-change]'); article.dataset.loading = 'true'; try { await invoke(syncFunction, 'review', { change_id: article.dataset.googleChange, decision: action.dataset.googleDecision }); await runSync(true); } catch (error) { article.dataset.loading = 'false'; window.alert(error.message); } }; });
      host.querySelectorAll('[data-google-book]').forEach(function (action) { action.onclick = function () { var article = action.closest('[data-google-change]'); if (window.SmylSchedule && window.SmylSchedule.bookAt) window.SmylSchedule.bookAt({ start: action.dataset.googleBook, changeId: article.dataset.googleChange }); }; });
    } catch (error) { host.innerHTML = '<div class="schedule-google-empty" data-error="true"><strong>No pudimos consultar Google</strong><p>' + esc(error.message) + '</p></div>'; }
  }
  function attach() {
    var actions = document.querySelector('#p-agenda .schedule-head-actions'); if (!actions) return false; ensureReviewPanel(); button = document.getElementById('schedule-google-calendar');
    if (!button) { button = document.createElement('button'); button.type = 'button'; button.id = 'schedule-google-calendar'; button.className = 'btn btn-secondary schedule-google-calendar'; button.setAttribute('aria-haspopup', 'dialog'); button.textContent = 'Google Calendar'; actions.prepend(button); }
    if (button.dataset.googleReady === 'true') return true; button.dataset.googleReady = 'true'; button.addEventListener('click', open);
    loadStatus().then(function () { renderChanges(); if (connection.connected) runSync(true); }).catch(function () { button.dataset.state = 'unknown'; }); return true;
  }
  function handleCallback() { var url = new URL(window.location.href), outcome = url.searchParams.get('google_calendar'); if (!outcome) return; url.searchParams.delete('google_calendar'); window.history.replaceState({}, '', url.pathname + url.search + '#agenda'); window.setTimeout(function () { if (typeof window.ir === 'function') window.ir('agenda'); attach(); if (outcome === 'connected') runSync(true); else open(); }, 600); }
  window.SmylGoogleCalendar = Object.freeze({ sync: function () { return runSync(true); }, refreshChanges: renderChanges, completeCreate: async function (changeId, appointmentId) { await invoke(syncFunction, 'review', { change_id: changeId, decision: 'accept', appointment_id: appointmentId }); await runSync(true); } });
  document.addEventListener('DOMContentLoaded', function () { handleCallback(); if (attach()) return; var observer = new MutationObserver(function () { if (attach()) observer.disconnect(); }); observer.observe(document.body, { childList: true, subtree: true }); window.setInterval(function () { var page = document.getElementById('p-agenda'); if (page && !page.hidden && connection && connection.connected) renderChanges(); }, 60000); });
})();
