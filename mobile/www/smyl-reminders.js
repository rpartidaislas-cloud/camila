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
    branch_whatsapp: 'WhatsApp de la sucursal (donde responde el paciente)',
    contact_phone: 'Teléfono de contacto (dentista si lo publicó; si no, la sucursal)',
    clinic: 'Nombre de la clínica',
    text: 'Texto fijo'
  };
  var SAMPLE = {
    patient_first_name: 'Ana', patient_name: 'Ana López', date: 'martes 21 de octubre', time: '10:30 am',
    service: 'Valoración', professional: 'Dra. Torres', branch: 'Sucursal Centro', branch_phone: '55 1234 5678', branch_whatsapp: '33 1111 1111', contact_phone: '33 1111 1111', clinic: 'tu clínica'
  };
  var DEFAULT_ORDER = ['patient_first_name', 'date', 'time', 'clinic', 'branch_phone', 'professional', 'service', 'branch'];
  var FEEDBACK_ORDER = ['patient_first_name', 'clinic', 'branch', 'service', 'professional', 'date', 'time', 'branch_phone'];
  var NO_SHOW_ORDER = ['patient_first_name', 'date', 'clinic', 'time', 'service', 'branch', 'professional', 'branch_phone'];
  var CONFIRMATION_ORDER = ['patient_first_name', 'clinic', 'date', 'time', 'contact_phone', 'service', 'branch', 'professional'];
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
    if (state.loading && !state.data) { body.innerHTML = window.SmylSkeleton ? window.SmylSkeleton.html('list', { rows: 3, avatar: false, plain: true, label: 'Consultando recordatorios' }) : '<p class="schedule-reminders-muted">Consultando recordatorios…</p>'; return; }
    if (state.error && !state.data) {
      body.innerHTML = '<p class="schedule-reminders-muted">' + esc(state.error) + '</p>';
      var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-secondary'; retry.textContent = 'Reintentar';
      retry.onclick = function () { loadSettings(true); }; actions.append(retry); return;
    }
    var data = state.data || {}; var settings = data.settings || {}; var overview = data.overview || {};
    var enabled = Boolean(settings.enabled), confirmOn = Boolean(settings.confirmation_enabled);
    function line(label, on, name) {
      return '<div class="schedule-reminders-status" data-enabled="' + on + '"><i aria-hidden="true"></i><strong>' + label + ': ' + (on ? 'activa' : 'desactivada') + '</strong>' +
        (name ? '<span>Plantilla «' + esc(name) + '»</span>' : '<span>Sin plantilla elegida</span>') + '</div>';
    }
    function stats(prefix) {
      return '<div class="schedule-reminders-stats">' + [['Programados', 'scheduled'], ['En espera', 'waiting'], ['Enviados', 'sent'], ['Con error', 'failed']].map(function (item) {
        return '<span><b>' + Number(overview[prefix + item[1]] || 0) + '</b>' + item[0] + '</span>';
      }).join('') + '</div>';
    }
    var whatsappInfo = settings.whatsapp_mode === 'per_branch' ? 'Cada sucursal usa su propio número de WhatsApp.' : 'Todas las sucursales usan el WhatsApp de la clínica' + (settings.whatsapp_phone ? ' (' + esc(settings.whatsapp_phone) + ')' : '') + '.';
    body.innerHTML =
      line('Confirmación al agendar', confirmOn, settings.confirmation_template_name) + stats('confirmation_') +
      line('Seguimiento de inasistencias', Boolean(settings.no_show_enabled), settings.no_show_template_name) + stats('no_show_') +
      line('Pregunta del motivo', Boolean(settings.feedback_enabled), settings.feedback_template_name) + stats('feedback_') +
      line(settings.reminder_48h_enabled ? 'Recordatorios 48 h y 24 h antes' : 'Recordatorio 24 h antes', enabled, settings.template_name) + stats('') +
      '<p class="schedule-reminders-muted">' + whatsappInfo + ' Últimos 7 días y próximas citas. Solo se envían a pacientes con una conversación de WhatsApp vinculada en Mensajes, entre las ' +
      esc(String(settings.send_window_start || '09:00').slice(0, 5)) + ' y las ' + esc(String(settings.send_window_end || '20:00').slice(0, 5)) + ' (hora de la sucursal)' + (settings.require_consent ? ' y solo con consentimiento registrado' : '') + '.</p>';
    if (data.can_configure) {
      var configure = document.createElement('button'); configure.type = 'button'; configure.className = 'btn btn-secondary'; configure.textContent = 'Configurar';
      configure.onclick = openSettings; actions.append(configure);
      if (enabled || confirmOn || settings.no_show_enabled || settings.feedback_enabled) {
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

  function variableRows(template, variables, order) {
    var count = Number(template && template.variable_count || 0);
    var rows = '';
    for (var i = 0; i < count; i += 1) {
      var variable = variables[i] || { source: (order || DEFAULT_ORDER)[i] || 'text' };
      rows += '<div class="schedule-reminders-variable" data-index="' + i + '"><label>Variable {{' + (i + 1) + '}}<select data-variable-source>' +
        Object.keys(SOURCE_LABELS).map(function (key) { return '<option value="' + key + '"' + (variable.source === key ? ' selected' : '') + '>' + esc(SOURCE_LABELS[key]) + '</option>'; }).join('') +
        '</select></label><label data-variable-text' + (variable.source === 'text' ? '' : ' hidden') + '>Texto<input data-variable-value maxlength="200" value="' + esc(variable.value || '') + '"></label></div>';
    }
    return rows || '<p class="schedule-reminders-muted">Esta plantilla no tiene variables.</p>';
  }

  function readVariables(scope) {
    return Array.prototype.map.call(scope.querySelectorAll('.schedule-reminders-variable'), function (row) {
      var source = row.querySelector('[data-variable-source]').value;
      var item = { source: source };
      if (source === 'text') item.value = row.querySelector('[data-variable-value]').value.trim();
      return item;
    });
  }

  // Una sección de plantilla (confirmación o recordatorio): interruptor, plantilla, variables y vista previa.
  function templateSection(key, title, intro, enabled, templateId, saved, order, list, error, extra) {
    return '<fieldset class="schedule-reminders-section" data-section="' + key + '"><legend>' + title + '</legend><p>' + intro + '</p>' +
      (error ? '<p class="schedule-reminders-alert">' + esc(error) + '</p>' : '') +
      '<label class="schedule-reminders-toggle"><input type="checkbox" name="' + key + '_enabled"' + (enabled ? ' checked' : '') + '><span>Enviar automáticamente</span></label>' + (extra || '') +
      '<label>Plantilla aprobada por Meta<select name="' + key + '_template"><option value="">Selecciona una plantilla</option>' +
        list.map(function (item) { return '<option value="' + esc(item.id) + '"' + (item.id === templateId ? ' selected' : '') + (usable(item) ? '' : ' disabled') + '>' + esc(item.name) + (item.language ? ' · ' + esc(item.language) : '') + (usable(item) ? '' : ' (no es de utilidad)') + '</option>'; }).join('') +
      '</select></label><div data-template-variables></div><div class="schedule-reminders-preview" data-template-preview hidden><span>Vista previa</span><p></p></div></fieldset>';
  }

  function wireSection(form, key, saved, order) {
    var scope = form.querySelector('[data-section="' + key + '"]');
    var select = form.elements[key + '_template'];
    function preview() {
      var template = templateById(select.value), box = scope.querySelector('[data-template-preview]');
      box.hidden = !template;
      if (template) box.querySelector('p').textContent = previewText(template, readVariables(scope));
    }
    function bind() {
      scope.querySelectorAll('.schedule-reminders-variable').forEach(function (row) {
        var source = row.querySelector('[data-variable-source]');
        source.onchange = function () { row.querySelector('[data-variable-text]').hidden = source.value !== 'text'; preview(); };
        row.querySelector('[data-variable-value]').oninput = preview;
      });
    }
    function refresh(keep) {
      var template = templateById(select.value);
      scope.querySelector('[data-template-variables]').innerHTML = template ? variableRows(template, keep ? saved : readVariables(scope), order) : '';
      bind(); preview();
    }
    select.onchange = function () { saved = []; refresh(false); };
    refresh(true);
    return { scope: scope, select: select };
  }

  function openSettings() {
    var d = document.getElementById('schedule-dialog');
    if (!d || !state.data) return;
    var data = state.data; var settings = data.settings || {}; var list = data.templates || [];
    var hm = function (value, fallback) { return String(value || fallback).slice(0, 5); };
    d.innerHTML = '<form class="schedule-reminders-form"><h2>Mensajes automáticos de citas</h2>' +
      '<p>SMYL le avisa al paciente por WhatsApp desde el número de tu clínica. Si la cita se mueve o se cancela, los avisos pendientes se cancelan solos, y las respuestas del paciente llegan a Mensajes.</p>' +
      (data.error ? '<p class="schedule-reminders-alert">' + esc(data.error) + '</p>' : '') +
      templateSection('confirmation', 'Confirmación al agendar', 'Se envía poco después de agendar una cita desde la Agenda o el portal (no a las que ya se hablaron en el chat) y cuando una cita cambia de fecha. Solo aplica a citas nuevas desde que la enciendes.', settings.confirmation_enabled, settings.confirmation_template_id, settings.confirmation_variables, CONFIRMATION_ORDER, list) +
      templateSection('reminder', 'Recordatorios por WhatsApp (24 h antes)', 'Se envía un día antes de la cita. Si la confirmación acaba de salir (menos de 6 horas antes), no se repite. Usa una plantilla con los botones «Confirmo mi asistencia» y «Necesito reprogramar» para que el paciente responda con un toque.', settings.enabled, settings.template_id, settings.variables, DEFAULT_ORDER, list, '',
        '<label class="schedule-reminders-toggle"><input type="checkbox" name="reminder_48h"' + (settings.reminder_48h_enabled ? ' checked' : '') + '><span>Enviar también un primer aviso 48 h antes (misma plantilla)</span></label>') +
      templateSection('no_show', 'Seguimiento de inasistencias («No vino»)', 'Unas 2 horas después de marcar una cita como «No vino», el paciente recibe un mensaje para reagendar. Solo aplica a inasistencias marcadas desde que lo enciendes. Usa la plantilla con el botón «Quiero reagendar»: si lo toca, la Agenda te lo avisa para que le ofrezcas horarios. Nunca agenda solo.', settings.no_show_enabled, settings.no_show_template_id, settings.no_show_variables, NO_SHOW_ORDER, list) +
      templateSection('feedback', '¿Por qué no reagendó? (retroalimentación)', 'Si pasan 3 días desde el seguimiento de «No vino» y el paciente no reagendó, recibe una pregunta con tres botones (el horario no me va · por el costo · otro motivo). Se guarda solo el motivo elegido, en su cita. Aplica a seguimientos enviados desde que lo enciendes.', settings.feedback_enabled, settings.feedback_template_id, settings.feedback_variables, FEEDBACK_ORDER, list) +
      (list.length ? '' : '<p class="schedule-reminders-muted">No hay plantillas aprobadas todavía. Solicita en tu panel de mensajería una de categoría Utilidad; en Mensajería → Plantillas de WhatsApp tienes propuestas listas para copiar, empezando por «cita_confirmada_v1» y «recordatorio_cita_24h_v1». <button type="button" class="schedule-reminders-link" data-open-templates>Ver plantillas propuestas</button></p>') +
      '<fieldset class="schedule-reminders-section" data-section="preferences"><legend>Cuándo y desde qué número</legend>' +
        '<div class="schedule-reminders-row"><label>Enviar desde<input type="time" name="window_start" value="' + hm(settings.send_window_start, '09:00') + '" required></label><label>Hasta<input type="time" name="window_end" value="' + hm(settings.send_window_end, '20:00') + '" required></label></div>' +
        '<p class="schedule-reminders-muted">Hora de cada sucursal. Fuera de este horario el aviso espera a que abra la ventana, para no avisar de madrugada.</p>' +
        '<label class="schedule-reminders-toggle"><input type="checkbox" name="require_consent"' + (settings.require_consent ? ' checked' : '') + '><span>Enviar solo a pacientes con consentimiento de WhatsApp registrado</span></label>' +
        '<div class="schedule-reminders-modes" role="radiogroup" aria-label="Número de WhatsApp"><label><input type="radio" name="whatsapp_mode" value="single"' + (settings.whatsapp_mode === 'per_branch' ? '' : ' checked') + '><span><strong>Un solo número para toda la clínica</strong><small>Todas las sucursales usan el mismo WhatsApp.</small></span></label>' +
        '<label><input type="radio" name="whatsapp_mode" value="per_branch"' + (settings.whatsapp_mode === 'per_branch' ? ' checked' : '') + '><span><strong>Un número por sucursal</strong><small>Cada sucursal usa el suyo; sus dentistas heredan el de su sucursal.</small></span></label></div>' +
        '<label>WhatsApp de la clínica<input name="whatsapp_phone" inputmode="tel" maxlength="40" placeholder="Ej. 33 1234 5678" value="' + esc(settings.whatsapp_phone || '') + '"></label>' +
        '<div data-branch-numbers hidden></div></fieldset>' +
      '<div class="schedule-dialog-actions"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-save>Guardar</button></div></form>';
    var form = d.querySelector('form');
    var confirmation = wireSection(form, 'confirmation', Array.isArray(settings.confirmation_variables) ? settings.confirmation_variables : [], CONFIRMATION_ORDER);
    var reminder = wireSection(form, 'reminder', Array.isArray(settings.variables) ? settings.variables : [], DEFAULT_ORDER);
    var feedback = wireSection(form, 'feedback', Array.isArray(settings.feedback_variables) ? settings.feedback_variables : [], FEEDBACK_ORDER);
    var noShow = wireSection(form, 'no_show', Array.isArray(settings.no_show_variables) ? settings.no_show_variables : [], NO_SHOW_ORDER);

    // Números por sucursal: se editan aquí mismo cuando la clínica elige «un número por sucursal».
    var branches = []; var branchBox = form.querySelector('[data-branch-numbers]');
    function drawBranches() {
      var perBranch = form.elements.whatsapp_mode.value === 'per_branch';
      branchBox.hidden = !perBranch || !branches.length;
      if (!perBranch || !branches.length) return;
      branchBox.innerHTML = '<p class="schedule-reminders-muted">Si una sucursal no tiene número propio, usa el de la clínica.</p>' + branches.map(function (b) {
        return '<label>' + esc(b.name) + '<input data-branch-whatsapp="' + esc(b.id) + '" inputmode="tel" maxlength="40" placeholder="WhatsApp de esta sucursal" value="' + esc(b.whatsapp_phone || '') + '"></label>';
      }).join('');
    }
    form.querySelectorAll('input[name="whatsapp_mode"]').forEach(function (radio) { radio.onchange = drawBranches; });
    if (window.sb && window.tenantId) {
      Promise.resolve(window.sb.from('smyl_branches').select('id,name,whatsapp_phone,active').eq('tenant_id', window.tenantId).eq('active', true).order('name')).then(function (result) {
        branches = (result && result.data) || []; drawBranches();
      }).catch(function () {});
    }
    d.querySelector('[data-close]').onclick = function () { d.close(); };
    var openTemplates = d.querySelector('[data-open-templates]');
    if (openTemplates) openTemplates.onclick = function () { d.close(); window.ir('plantillas'); };
    form.onsubmit = async function (event) {
      event.preventDefault();
      var save = form.querySelector('[data-save]'); save.disabled = true; save.textContent = 'Guardando…';
      try {
        var phone = function (value) { return String(value || '').replace(/[^0-9+()\-\s]/g, '').trim(); };
        await invoke({ action: 'save_settings', kind: 'preferences', send_window_start: form.elements.window_start.value, send_window_end: form.elements.window_end.value, require_consent: form.elements.require_consent.checked, whatsapp_mode: form.elements.whatsapp_mode.value, whatsapp_phone: phone(form.elements.whatsapp_phone.value) });
        // Números de las sucursales (solo los que cambiaron).
        var changed = 0;
        for (var i = 0; i < branches.length; i += 1) {
          var input = form.querySelector('[data-branch-whatsapp="' + branches[i].id + '"]');
          if (!input) continue;
          var next = phone(input.value);
          if (next === String(branches[i].whatsapp_phone || '')) continue;
          var saved = await window.sb.from('smyl_branches').update({ whatsapp_phone: next }).eq('tenant_id', window.tenantId).eq('id', branches[i].id);
          if (saved && saved.error) throw new Error('No se pudo guardar el WhatsApp de «' + branches[i].name + '». Pide a quien administra la clínica que lo capture en Mi clínica.');
          changed += 1;
        }
        var results = [];
        results.push(await invoke({ action: 'save_settings', kind: 'confirmation', enabled: form.elements.confirmation_enabled.checked, template_id: confirmation.select.value || null, variables: readVariables(confirmation.scope) }));
        results.push(await invoke({ action: 'save_settings', kind: 'reminder', reminder_48h: form.elements.reminder_48h.checked, enabled: form.elements.reminder_enabled.checked, template_id: reminder.select.value || null, variables: readVariables(reminder.scope) }));
        results.push(await invoke({ action: 'save_settings', kind: 'no_show', enabled: form.elements.no_show_enabled.checked, template_id: noShow.select.value || null, variables: readVariables(noShow.scope) }));
        results.push(await invoke({ action: 'save_settings', kind: 'feedback', enabled: form.elements.feedback_enabled.checked, template_id: feedback.select.value || null, variables: readVariables(feedback.scope) }));
        d.close();
        var on = [form.elements.confirmation_enabled.checked ? 'confirmaciones' : '', form.elements.reminder_enabled.checked ? 'recordatorios' : '', form.elements.no_show_enabled.checked ? 'seguimiento de inasistencias' : '', form.elements.feedback_enabled.checked ? 'pregunta del motivo' : ''].filter(Boolean);
        window.alert(on.length ? 'Guardado. Activos: ' + on.join(' y ') + '.' : 'Guardado. Los mensajes automáticos están desactivados; los que estaban en cola se cancelaron, también en WhatsApp.');
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
    card.innerHTML = '<div class="schedule-section-title"><div><h2>Mensajes automáticos de citas</h2><p>Confirmación al agendar, recordatorios 48 y 24 horas antes, y seguimiento si no vino, por WhatsApp.</p></div><div class="schedule-reminders-actions" data-reminders-actions></div></div><div data-reminders-body></div>';
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
