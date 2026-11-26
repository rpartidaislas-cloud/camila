/* SMYL · Agenda con IA (ajustes). Apagado por defecto. Nivel «sugerir»: el asistente de LANA consulta horarios libres reales
   (Edge Function lana-scheduling) y propone hasta 3 opciones; no agenda ni aparta nada. Nivel «request» (opcional): además, con la
   autorización del paciente, deja una SOLICITUD en «Agenda → Por aprobar»; nunca se confirma sola. Nivel «book» (opcional, con candados): confirma
   la cita cuando el paciente acepta un horario ofrecido, solo si el chat está vinculado a un paciente y bajo un tope diario. Aquí la clínica lo enciende y elige los servicios. */
(function () {
  'use strict';
  var state = { settings: null, services: [], selected: [], loading: false, saving: false, error: '', ok: '', canManage: false };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function db() { return window.sb; }
  function tenant() { return window.tenantId; }
  async function q(p) { var r = await p; if (r.error) throw r.error; return r.data || []; }

  async function load() {
    if (!db() || !tenant() || state.loading) return;
    state.loading = true; state.error = ''; render();
    try {
      var t = tenant();
      var res = await Promise.all([
        q(db().from('smyl_ai_scheduling_settings').select('*').eq('tenant_id', t).limit(1)),
        q(db().from('smyl_ai_scheduling_services').select('service_id').eq('tenant_id', t)),
        q(db().from('smyl_services').select('id,name,duration_minutes,active').eq('tenant_id', t).eq('active', true).order('name'))
      ]);
      state.settings = res[0][0] || { level: 'off', min_lead_hours: 2, horizon_days: 14 };
      if (!state.settings.book_daily_cap) state.settings.book_daily_cap = 10;
      state.selected = res[1].map(function (r) { return r.service_id; });
      state.services = res[2];
      state.canManage = true; // el permiso real (settings.manage) lo exige la función de base de datos
    } catch (e) {
      state.error = /does not exist|schema cache|42P01|PGRST/i.test(String((e && (e.message || e.code)) || '')) ? 'Esta función todavía no está activada en tu cuenta.' : 'No se pudo cargar. Intenta de nuevo.';
    }
    state.loading = false; render();
  }

  async function save(card) {
    if (state.saving) return;
    var on = card.querySelector('[data-ai-on]').checked;
    var wantsRequest = !!(card.querySelector('[data-ai-request]') || {}).checked;
    var wantsBook = !!(card.querySelector('[data-ai-book]') || {}).checked;
    var cap = parseInt((card.querySelector('[data-ai-cap]') || {}).value, 10) || 10;
    var ids = Array.prototype.map.call(card.querySelectorAll('[data-ai-service]:checked'), function (i) { return i.value; });
    var lead = parseInt(card.querySelector('[data-ai-lead]').value, 10);
    var horizon = parseInt(card.querySelector('[data-ai-horizon]').value, 10);
    state.error = ''; state.ok = '';
    if (on && !ids.length) { state.error = 'Elige al menos un servicio que la IA pueda ofrecer.'; return render(); }
    var level = on ? (wantsBook ? 'book' : (wantsRequest ? 'request' : 'suggest')) : 'off';
    // Pasar a «agendar solo» es una decisión importante: se pide confirmación una vez.
    if (level === 'book' && (state.settings || {}).level !== 'book' && !window.confirm('La IA podrá CONFIRMAR citas sin que nadie las apruebe, solo con pacientes ya vinculados y hasta ' + cap + ' por día. Las verás marcadas «Agendada por la IA» y podrás cancelarlas o moverlas. ¿Activarlo?')) return;
    state.saving = true; render();
    try {
      var r = await db().rpc('smyl_set_ai_scheduling', { p_level: level, p_min_lead_hours: lead, p_horizon_days: horizon, p_service_ids: ids, p_book_cap: level === 'book' ? cap : null });
      if (r.error) throw r.error;
      state.settings = { level: level, min_lead_hours: lead, horizon_days: horizon, book_daily_cap: level === 'book' ? cap : (state.settings || {}).book_daily_cap || 10 };
      state.selected = ids; state.ok = level === 'book' ? 'Listo. La IA puede confirmar citas de estos servicios con pacientes vinculados (hasta ' + cap + ' por día) y deja marcadas las que agenda.' : level === 'request' ? 'Listo. La IA puede sugerir horarios y dejar solicitudes en «Por aprobar» para estos servicios.' : (on ? 'Listo. La IA ya puede sugerir horarios de estos servicios.' : 'Apagado. La IA ya no consulta tu agenda.');
    } catch (e) { state.error = 'No se pudo guardar. Revisa tus permisos e intenta de nuevo.'; }
    state.saving = false; render();
  }

  function render() {
    var card = document.getElementById('schedule-ai-card'); if (!card) return;
    var body = card.querySelector('[data-ai-body]');
    if (state.loading && !state.settings) { body.innerHTML = '<p class="ai-note">Cargando…</p>'; return; }
    if (!state.settings) { body.innerHTML = state.error ? '<p class="ai-note" role="alert">' + esc(state.error) + '</p>' : ''; return; }
    var s = state.settings, on = s.level !== 'off', dis = state.canManage ? '' : ' disabled';
    body.innerHTML =
      '<label class="ai-switch"><input type="checkbox" data-ai-on' + (on ? ' checked' : '') + dis + '> <span><strong>Que la IA sugiera horarios</strong><small>Propone hasta 3 opciones con tu disponibilidad real. No agenda por sí sola: tú confirmas.</small></span></label>' +
      '<label class="ai-switch ai-switch-sub"><input type="checkbox" data-ai-request' + (s.level === 'request' || s.level === 'book' ? ' checked' : '') + (on ? '' : ' disabled') + dis + '> <span><strong>También puede dejar la solicitud en «Por aprobar»</strong><small>El paciente elige uno de los horarios y, con su autorización, el asistente deja una solicitud con su nombre y medio de contacto. Tú la aceptas o la rechazas: nunca se confirma sola.</small></span></label>' +
      '<label class="ai-switch ai-switch-sub ai-switch-book"><input type="checkbox" data-ai-book' + (s.level === 'book' ? ' checked' : '') + (s.level === 'request' || s.level === 'book' ? '' : ' disabled') + dis + '> <span><strong>Puede confirmar la cita por sí sola</strong><small>Cuando el paciente acepta un horario que la IA le ofreció, la cita queda confirmada al momento, sin que nadie la apruebe. Solo si el chat ya está vinculado a un paciente; si no, queda en «Por aprobar». Las citas quedan marcadas «Agendada por la IA» y puedes cancelarlas o moverlas.</small>' +
      '<label class="ai-cap">Máximo de citas por día <select data-ai-cap' + (s.level === 'book' ? '' : ' disabled') + dis + '>' + [3, 5, 10, 15, 20, 30].map(function (n) { return '<option value="' + n + '"' + ((s.book_daily_cap || 10) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></span></label>' +
      '<fieldset class="ai-services"' + dis + '><legend>Servicios que puede ofrecer</legend>' +
      (state.services.length ? state.services.map(function (sv) { return '<label><input type="checkbox" data-ai-service value="' + esc(sv.id) + '"' + (state.selected.indexOf(sv.id) >= 0 ? ' checked' : '') + '> ' + esc(sv.name) + (sv.duration_minutes ? ' <small>' + esc(sv.duration_minutes) + ' min</small>' : '') + '</label>'; }).join('') : '<p class="ai-note">Aún no tienes servicios activos.</p>') +
      '</fieldset><p class="ai-note">Recomendado al empezar: solo la valoración inicial.</p>' +
      '<div class="ai-row"><label>Anticipación mínima <select data-ai-lead' + dis + '>' + [1, 2, 4, 8, 24, 48].map(function (h) { return '<option value="' + h + '"' + (s.min_lead_hours === h ? ' selected' : '') + '>' + h + ' h</option>'; }).join('') + '</select></label>' +
      '<label>Hasta cuántos días <select data-ai-horizon' + dis + '>' + [7, 14, 21, 30].map(function (d) { return '<option value="' + d + '"' + (s.horizon_days === d ? ' selected' : '') + '>' + d + ' días</option>'; }).join('') + '</select></label></div>' +
      (state.error ? '<p class="ai-note ai-error" role="alert">' + esc(state.error) + '</p>' : '') + (state.ok ? '<p class="ai-note ai-ok" role="status">' + esc(state.ok) + '</p>' : '') +
      (state.canManage ? '<button class="btn primary" type="button" data-ai-save' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Guardando…' : 'Guardar') + '</button>' : '<p class="ai-note">Solo quien administra la clínica puede cambiar esto.</p>');
    var onBox = body.querySelector('[data-ai-on]'), reqBox = body.querySelector('[data-ai-request]'), bookBox = body.querySelector('[data-ai-book]'), capSel = body.querySelector('[data-ai-cap]');
    // Cada nivel exige el anterior: sugerir → solicitud → agendar. Al apagar uno se apagan los siguientes.
    function sync() {
      if (!onBox.checked) { reqBox.checked = false; }
      if (!reqBox.checked && bookBox) bookBox.checked = false;
      reqBox.disabled = !onBox.checked || !state.canManage;
      if (bookBox) bookBox.disabled = !reqBox.checked || !state.canManage;
      if (capSel) capSel.disabled = !bookBox || !bookBox.checked || !state.canManage;
    }
    if (onBox && reqBox) { onBox.addEventListener('change', sync); reqBox.addEventListener('change', sync); if (bookBox) bookBox.addEventListener('change', sync); }
    var b = body.querySelector('[data-ai-save]'); if (b) b.addEventListener('click', function () { save(card); });
  }

  function mount() {
    var grid = document.querySelector('[data-schedule-panel="settings"] .schedule-settings-grid');
    if (!grid || document.getElementById('schedule-ai-card')) return Boolean(grid);
    var card = document.createElement('article');
    card.className = 'schedule-card schedule-ai-card'; card.id = 'schedule-ai-card';
    card.innerHTML = '<div class="schedule-section-title"><div><h2>Agenda con IA</h2><p>El asistente sugiere horarios libres a los pacientes. Apagado por defecto.</p></div></div><div data-ai-body></div>';
    grid.appendChild(card); render(); return true;
  }

  function init() {
    if (!mount()) setTimeout(mount, 0);
    var previous = window.ir;
    if (typeof previous === 'function') window.ir = function (route) { var r = previous.apply(this, arguments); if (route === 'agenda') { mount(); load(); } return r; };
  }
  window.SmylAiScheduling = Object.freeze({ reload: load });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
