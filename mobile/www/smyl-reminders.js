/* SMYL · Recordatorios automáticos de cita por WhatsApp (fase 4 del chat).
   La entrega real ocurre en la Edge Function appointment-reminders y en el
   trabajador de LANA; este módulo sólo la configura y la pone en marcha. */
(function () {
  'use strict';

  var FUNCTION_NAME = 'appointment-reminders';
  var SOURCE_LABELS = {
    patient_first_name: 'Nombre del paciente',
    patient_name: 'Nombre completo del paciente',
    date: 'Fecha de la cita',
    time: 'Hora de la cita',
    service: 'Servicio',
    professional: 'Profesional',
    branch: 'Sucursal',
    branch_phone: 'Teléfono de la sucursal',
    clinic: 'Nombre de la clínica',
    text: 'Texto fijo'
  };
  var SAMPLE = {
    patient_first_name: 'Ana', patient_name: 'Ana López', date: 'martes 21 de octubre', time: '10:30 a.m.',
    service: 'Valoración', professional: 'Dra. Torres', branch: 'Sucursal Centro', branch_phone: '55 1234 5678', clinic: 'tu clínica'
  };
  var DEFAULT_ORDER = ['patient_first_name', 'date', 'time', 'clinic', 'branch_phone', 'professional', 'service', 'branch'];
  var state = { data: null, loading: false, error: '', loadedAt: 0, lastDispatch: 0, dispatching: false };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  async function invoke(body) {
    if (!window.sb || !window.sb.functions) throw new Error('La sesión todavía no está lista.');
    var result = await window.sb.functions.invoke(FUNCTION_NAME, { body: body });
    if (result.error) {
      var detail = '';
      try { detail = result.error.context && typeof result.error.context.json === 'function' ? ((await result.error.context.json()) || {}).error : ''; } catch (_) {}
      throw new Error(detail || 'El servicio de recordatorios no está disponible todavía.');
    }
    return result.data || {};
  }

  // Entrega los pendientes a LANA. Sin "force" se limita a una vez cada 5 minutos por pestaña.
  async function dispatch(force) {
    if (state.dispatching || !window.sb) return null;
    if (!force && Date.now() - state.lastDispatch < 5 * 60 * 1000) return null;
    state.dispatching = true; state.lastDispatch = Date.now();
    try {
      var data = await invoke({ action: 'dispatch', force: Boolean(force) });
      var summary = data.summary;
      if (summary && (summary.scheduled || summary.failed || summary.synced)) {
        var agenda = document.getElementById('p-agenda');
        if (agenda && agenda.classList.contains('activa') && window.SmylSchedule) window.SmylSchedule.reload();
        if (state.data) loadSettings(true);
      }
      return data;
    } catch (_) { return null; }
    finally { state.dispatching = false; }
  }

  function templateById(id) {
    var list = state.data && state.data.templates || [];
    return list.find(function (item) { return item.id === id; }) || null;
  }

  function usable(template) {
    return !template.category || /utility|utilidad/i.test(template.category);
  }

  function previewText(template, variables) {
    if (!template) return '';
    return String(template.body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, function (match, index) {
      var variable = variables[Number(index) - 1];
      if (!variable) return match;
      return variable.source === 'text' ? (variable.value || '…') : (SAMPLE[variable.source] || match);
    });
  }

  function renderCard() {
    var card = document.getElementById('schedule-reminders-card');
    if (!card) return;
    var body = card.querySelector('[data-reminders-body]');
    var actions = card.querySelector('[data-reminders-actions]');
    actions.innerHTML = '';
    if (state.loading && !state.data) { body.innerHTML = '<p class="schedule-reminders-muted">Consultando recordatorios…</p>'; return; }
    if (state.error && !state.data) {
      body.innerHTML = '<p class="schedule-reminders-muted">' + esc(state.error) + '</p>';
      var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-secondary'; retry.textContent = 'Reintentar';
      retry.onclick = function () { loadSettings(true); }; actions.append(retry); return;
    }
    var data = state.data || {}; var settings = data.settings || {}; var overview = data.overview || {};
    var enabled = Boolean(settings.enabled);
    body.innerHTML =
      '<div class="schedule-reminders-status" data-enabled="' + enabled + '"><i aria-hidden="true"></i><strong>' + (enabled ? 'Activos' : 'Desactivados') + '</strong>' +
      (settings.template_name ? '<span>Plantilla «' + esc(settings.template_name) + '»' + (settings.template_language ? ' · ' + esc(settings.template_language) : '') + '</span>' : '<span>Sin plantilla elegida</span>') + '</div>' +
      '<div class="schedule-reminders-stats">' +
        [['Programados', overview.scheduled], ['En espera', overview.waiting], ['Enviados', overview.sent], ['Con error', overview.failed]].map(function (item) {
          return '<span><b>' + Number(item[1] || 0) + '</b>' + item[0] + '</span>';
        }).join('') +
      '</div>' +
      '<p class="schedule-reminders-muted">Últimos 7 días y próximas citas. Solo se envían a pacientes con una conversación de WhatsApp vinculada en Mensajes.</p>';
    if (data.can_configure) {
      var configure = document.createElement('button'); configure.type = 'button'; configure.className = 'btn btn-secondary'; configure.textContent = 'Configurar';
      configure.onclick = openSettings; actions.append(configure);
      if (enabled) {
        var now = document.createElement('button'); now.type = 'button'; now.className = 'btn btn-secondary'; now.textContent = 'Revisar pendientes';
        now.onclick = async function () {
          now.disabled = true; now.textContent = 'Revisando…';
          var result = await dispatch(true);
          now.disabled = false; now.textContent = 'Revisar pendientes';
          var summary = result && result.summary;
          if (summary) window.alert(summary.scheduled + ' programados en WhatsApp · ' + summary.waiting + ' en espera · ' + summary.failed + ' con error.');
          else if (result && result.skipped === 'recent') window.alert('Se revisaron hace menos de un minuto.');
          loadSettings(true);
        };
        actions.append(now);
      }
    }
  }

  async function loadSettings(force) {
    if (state.loading || (!force && Date.now() - state.loadedAt < 60 * 1000)) return;
    state.loading = true; state.error = ''; renderCard();
    try { state.data = await invoke({ action: 'settings' }); state.loadedAt = Date.now(); }
    catch (error) { state.error = error.message; }
    finally { state.loading = false; renderCard(); }
  }

  function variableRows(template, variables) {
    var count = Number(template && template.variable_count || 0);
    var rows = '';
    for (var i = 0; i < count; i += 1) {
      var variable = variables[i] || { source: DEFAULT_ORDER[i] || 'text' };
      rows += '<div class="schedule-reminders-variable" data-index="' + i + '"><label>Variable {{' + (i + 1) + '}}<select data-variable-source>' +
        Object.keys(SOURCE_LABELS).map(function (key) { return '<option value="' + key + '"' + (variable.source === key ? ' selected' : '') + '>' + esc(SOURCE_LABELS[key]) + '</option>'; }).join('') +
        '</select></label><label data-variable-text' + (variable.source === 'text' ? '' : ' hidden') + '>Texto<input data-variable-value maxlength="200" value="' + esc(variable.value || '') + '"></label></div>';
    }
    return rows || '<p class="schedule-reminders-muted">Esta plantilla no tiene variables.</p>';
  }

  function readVariables(form) {
    return Array.prototype.map.call(form.querySelectorAll('.schedule-reminders-variable'), function (row) {
      var source = row.querySelector('[data-variable-source]').value;
      var item = { source: source };
      if (source === 'text') item.value = row.querySelector('[data-variable-value]').value.trim();
      return item;
    });
  }

  function openSettings() {
    var d = document.getElementById('schedule-dialog');
    if (!d || !state.data) return;
    var data = state.data; var settings = data.settings || {}; var list = data.templates || [];
    var saved = Array.isArray(settings.variables) ? settings.variables : [];
    d.innerHTML = '<form class="schedule-reminders-form"><h2>Recordatorios por WhatsApp</h2>' +
      '<p>SMYL envía a cada paciente un recordatorio 24 horas antes de su cita. Si la cita se mueve o se cancela, el recordatorio se cancela solo.</p>' +
      (data.error ? '<p class="schedule-reminders-alert">' + esc(data.error) + '</p>' : '') +
      '<label class="schedule-reminders-toggle"><input type="checkbox" name="enabled"' + (settings.enabled ? ' checked' : '') + '><span>Enviar recordatorios automáticos</span></label>' +
      '<label>Plantilla aprobada por Meta<select name="template"><option value="">Selecciona una plantilla</option>' +
        list.map(function (item) { return '<option value="' + esc(item.id) + '"' + (item.id === settings.template_id ? ' selected' : '') + (usable(item) ? '' : ' disabled') + '>' + esc(item.name) + (item.language ? ' · ' + esc(item.language) : '') + (usable(item) ? '' : ' (no es de utilidad)') + '</option>'; }).join('') +
      '</select></label>' +
      (list.length ? '' : '<p class="schedule-reminders-muted">No hay plantillas disponibles. Solicita en LANA una plantilla de categoría Utilidad, por ejemplo: «Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}} en {{4}}».</p>') +
      '<div data-template-variables></div>' +
      '<div class="schedule-reminders-preview" data-template-preview hidden><span>Vista previa</span><p></p></div>' +
      '<div class="schedule-dialog-actions"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-save>Guardar</button></div></form>';
    var form = d.querySelector('form');
    var select = form.elements.template;
    function refresh(keep) {
      var template = templateById(select.value);
      var current = keep ? saved : readVariables(form);
      form.querySelector('[data-template-variables]').innerHTML = template ? variableRows(template, current) : '';
      bindVariables(); updatePreview();
    }
    function updatePreview() {
      var template = templateById(select.value);
      var box = form.querySelector('[data-template-preview]');
      box.hidden = !template;
      if (template) box.querySelector('p').textContent = previewText(template, readVariables(form));
    }
    function bindVariables() {
      form.querySelectorAll('.schedule-reminders-variable').forEach(function (row) {
        var source = row.querySelector('[data-variable-source]');
        source.onchange = function () { row.querySelector('[data-variable-text]').hidden = source.value !== 'text'; updatePreview(); };
        row.querySelector('[data-variable-value]').oninput = updatePreview;
      });
    }
    select.onchange = function () { saved = []; refresh(false); };
    refresh(true);
    d.querySelector('[data-close]').onclick = function () { d.close(); };
    form.onsubmit = async function (event) {
      event.preventDefault();
      var save = form.querySelector('[data-save]'); save.disabled = true; save.textContent = 'Guardando…';
      try {
        var result = await invoke({ action: 'save_settings', enabled: form.elements.enabled.checked, template_id: select.value || null, variables: readVariables(form) });
        d.close();
        var summary = result.summary;
        window.alert(form.elements.enabled.checked
          ? 'Recordatorios activos.' + (summary ? ' ' + summary.scheduled + ' programados en WhatsApp, ' + summary.waiting + ' en espera.' : '')
          : 'Recordatorios desactivados. Los que estaban en cola se cancelaron, también en WhatsApp.');
        loadSettings(true);
        if (window.SmylSchedule) window.SmylSchedule.reload();
      } catch (error) {
        save.disabled = false; save.textContent = 'Guardar';
        window.alert(error.message);
      }
    };
    d.showModal();
  }

  function mountCard() {
    var grid = document.querySelector('[data-schedule-panel="settings"] .schedule-settings-grid');
    if (!grid || document.getElementById('schedule-reminders-card')) return Boolean(grid);
    var card = document.createElement('article');
    card.className = 'schedule-card schedule-reminders-card';
    card.id = 'schedule-reminders-card';
    card.innerHTML = '<div class="schedule-section-title"><div><h2>Recordatorios por WhatsApp</h2><p>Aviso automático 24 horas antes de cada cita.</p></div><div class="schedule-reminders-actions" data-reminders-actions></div></div><div data-reminders-body></div>';
    grid.prepend(card);
    renderCard();
    return true;
  }

  function init() {
    if (!mountCard()) setTimeout(mountCard, 0);
    var previous = window.ir;
    if (typeof previous === 'function') {
      window.ir = function (route) {
        var result = previous.apply(this, arguments);
        if (route === 'agenda') { mountCard(); loadSettings(false); dispatch(false); }
        else if (route === 'inbox') dispatch(false);
        return result;
      };
    }
    // Barrido oportunista al iniciar sesión: entrega lo que quedó pendiente aunque nadie abra la Agenda.
    if (window.sb && window.sb.auth) {
      var sweep = function () { setTimeout(function () { dispatch(false); }, 4000); };
      window.sb.auth.getSession().then(function (result) { if (result && result.data && result.data.session) sweep(); }).catch(function () {});
      window.sb.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_IN') sweep(); });
    }
  }

  window.SmylReminders = Object.freeze({ dispatch: dispatch, openSettings: openSettings, reload: function () { return loadSettings(true); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
