/* SMYL · Inicio: lista «Configura tu clínica» para el propietario.
   Cada paso se verifica con datos reales (solo lectura) y la lista desaparece cuando todo está listo. */
(function () {
  'use strict';

  var STEPS = [
    { id: 'hours', title: 'Define tu horario de atención', hint: 'Sin horario, los pacientes no pueden reservar.', action: 'Definir horario', route: 'agenda' },
    { id: 'patient', title: 'Registra tu primer paciente', hint: 'Crea el expediente con sus datos de contacto.', action: 'Registrar paciente', route: 'pacientes', open: 'patient' },
    { id: 'whatsapp', title: 'Conecta WhatsApp', hint: 'Para recibir y responder mensajes de tus pacientes.', action: 'Conectar', route: 'conexiones' },
    { id: 'template', title: 'Solicita tu primera plantilla', hint: 'Meta debe aprobarla para poder recordar citas.', action: 'Ver plantillas', route: 'plantillas' },
    { id: 'reminders', title: 'Activa los recordatorios de cita', hint: 'Configura los avisos para tus pacientes desde la agenda.', action: 'Configurar', route: 'agenda' }
  ];
  var state = { loading: false, tenant: null, results: null, loadedAt: 0, collapsed: true, operating: false, request: 0, dismissedDay: '' };

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function route(name) { if (typeof window.ir === 'function') window.ir(name); }
  function storageKey() { return 'smyl_clinic_setup_collapsed_' + (window.tenantId || ''); }
  // La preferencia de apertura se conserva por consultorio.
  function readCollapsed() {
    try { var saved = window.localStorage.getItem(storageKey()); if (saved === '1' || saved === '0') return saved === '1'; } catch (_) {}
    return true;
  }
  function saveCollapsed(value) { try { window.localStorage.setItem(storageKey(), value ? '1' : '0'); } catch (_) {} }
  function isOwner() { return window.miRolEquipo === 'dueño'; }
  // «Ocultar por hoy»: por dispositivo y solo hasta que cambie el día.
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hiddenKey() { return 'smyl_clinic_setup_hidden_' + (window.tenantId || ''); }
  function hiddenToday() { if (state.dismissedDay === today()) return true; try { return window.localStorage.getItem(hiddenKey()) === today(); } catch (_) { return false; } }
  function hideToday() { state.dismissedDay = today(); try { window.localStorage.setItem(hiddenKey(), state.dismissedDay); } catch (_) {} }

  async function count(builder) {
    var result = await Promise.resolve(typeof window.sbTimeout === 'function' ? window.sbTimeout(builder) : builder);
    if (result && result.error) throw result.error;
    if (!result || typeof result.count !== 'number') throw new Error('Conteo no disponible');
    return result.count;
  }

  async function sessionToken() {
    var session = await window.sb.auth.getSession();
    var token = session && session.data && session.data.session && session.data.session.access_token;
    if (!token) throw new Error('sin sesión');
    return token;
  }

  async function whatsappConnected() {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response = await fetch(SUPA_URL + '/functions/v1/lana-channels', { headers: { Authorization: 'Bearer ' + await sessionToken(), apikey: SUPA_KEY }, signal: controller.signal });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error('canales');
      if (!Array.isArray(data.channels)) throw new Error('Canales no disponibles');
      var channels = data.channels;
      return channels.some(function (item) { return item && item.channel === 'whatsapp' && item.connected; });
    } finally { clearTimeout(timer); }
  }

  async function templateState() {
    var result = await window.sb.functions.invoke('whatsapp-templates', { body: { action: 'list' } });
    if (result.error) throw result.error;
    if (!result.data || !Array.isArray(result.data.templates)) throw new Error('Plantillas no disponibles');
    var list = result.data.templates;
    if (list.some(function (item) { return item.status === 'APPROVED' && item.category === 'UTILITY'; })) return 'done';
    if (list.some(function (item) { return item.status === 'PENDING'; })) return 'pending';
    return 'todo';
  }

  async function reminderState() {
    var result = await Promise.resolve(window.sbTimeout ? window.sbTimeout(window.sb.from('smyl_reminder_settings').select('enabled').eq('tenant_id', window.tenantId).maybeSingle()) : window.sb.from('smyl_reminder_settings').select('enabled').eq('tenant_id', window.tenantId).maybeSingle());
    if (result && result.error) throw result.error;
    return result && result.data && result.data.enabled === true;
  }

  function settle(promise) {
    return promise.then(function (value) { return { ok: true, value: value }; }, function () { return { ok: false }; });
  }

  async function load(force) {
    var tenant = isOwner() ? window.tenantId : null;
    if (tenant !== state.tenant) {
      state.request++; state.tenant = tenant; state.loading = false;
      state.results = null; state.loadedAt = 0; state.operating = false; state.dismissedDay = ''; state.collapsed = readCollapsed();
      render();
    }
    if (!tenant || !window.sb || state.loading) return render();
    if (!force && state.results && Date.now() - state.loadedAt < 60000) return render();
    var request = ++state.request;
    state.loading = true;
    try {
      var rows = await Promise.all([
        settle(count(window.sb.from('smyl_clinic_hours').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant).eq('active', true))),
        settle(count(window.sb.from('camila_pacientes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant))),
        settle(whatsappConnected()),
        settle(templateState()),
        settle(reminderState()),
        settle(count(window.sb.from('smyl_services').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant).eq('active', true))),
        settle(count(window.sb.from('smyl_appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant).eq('status', 'completed')))
      ]);
      if (request !== state.request || tenant !== window.tenantId || !isOwner()) return;
      state.results = {
        hours: rows[0].ok ? { done: rows[0].value > 0 } : { unknown: true },
        patient: rows[1].ok ? { done: rows[1].value > 0 } : { unknown: true },
        whatsapp: rows[2].ok ? { done: rows[2].value } : { unknown: true },
        template: rows[3].ok ? { done: rows[3].value === 'done', waiting: rows[3].value === 'pending' } : { unknown: true },
        reminders: rows[4].ok ? { done: rows[4].value } : { unknown: true }
      };
      // Clínica «en marcha»: horario, al menos un servicio activo y una cita ya terminada. Entonces la lista deja de estorbar.
      state.operating = rows[0].ok && rows[0].value > 0 && rows[5].ok && rows[5].value > 0 && rows[6].ok && rows[6].value > 0;
      state.loadedAt = Date.now();
    } finally { if (request === state.request) { state.loading = false; render(); } }
  }

  function stepHint(step, result) {
    if (result.unknown) return 'No pudimos verificarlo ahora. Ábrelo para revisar.';
    if (step.id === 'template' && result.waiting) return 'Meta está revisando tu solicitud.';
    return step.hint;
  }

  function setExpanded(section) {
    section.querySelector('.clinic-setup-toggle').setAttribute('aria-expanded', String(!state.collapsed));
    section.querySelector('.clinic-setup-details').hidden = state.collapsed;
  }

  function createSection(host) {
    var section = el('section', 'clinic-setup'); section.id = 'smyl-clinic-setup';
    section.setAttribute('aria-labelledby', 'clinic-setup-title');
    var head = el('h2', 'clinic-setup-head');
    var toggle = el('button', 'clinic-setup-toggle'); toggle.type = 'button';
    toggle.setAttribute('aria-controls', 'clinic-setup-details');
    var title = el('span', 'clinic-setup-title', 'Configura tu clínica'); title.id = 'clinic-setup-title';
    var progress = el('span', 'clinic-setup-progress');
    var arrow = el('span', 'clinic-setup-chevron'); arrow.setAttribute('aria-hidden', 'true');
    toggle.append(title, progress, arrow); head.append(toggle);
    var details = el('div', 'clinic-setup-details'); details.id = 'clinic-setup-details';
    var list = el('ol', 'clinic-setup-steps');
    STEPS.forEach(function (step) {
      var item = el('li', 'clinic-setup-step'); item.dataset.step = step.id;
      var mark = el('span', 'clinic-setup-mark'); mark.setAttribute('role', 'img');
      var copy = el('div', 'clinic-setup-text');
      copy.append(el('strong', '', step.title), el('small'));
      var action = el('button', 'clinic-setup-action', step.action); action.type = 'button';
      action.onclick = function () {
        route(step.route);
        if (step.open === 'patient') setTimeout(function () { if (typeof window.abrirModalPaciente === 'function') window.abrirModalPaciente(); }, 0);
      };
      item.append(mark, copy, action); list.append(item);
    });
    var footer = el('div', 'clinic-setup-foot');
    var dismiss = el('button', 'clinic-setup-dismiss', 'Ocultar por hoy'); dismiss.type = 'button';
    dismiss.onclick = function () {
      var before = Array.from(host.querySelectorAll('button:not(:disabled)')).filter(function (button) {
        return !section.contains(button) && button.getClientRects().length;
      });
      hideToday(); render();
      if (before.length) before[before.length - 1].focus();
    };
    toggle.onclick = function () { state.collapsed = !state.collapsed; saveCollapsed(state.collapsed); setExpanded(section); };
    footer.append(dismiss); details.append(list, footer); section.append(head, details);
    host.append(section);
    return section;
  }

  function render() {
    var host = document.getElementById('smyl-daily-home');
    var existing = document.getElementById('smyl-clinic-setup');
    var results = state.tenant === window.tenantId && state.results;
    var pending = results ? STEPS.filter(function (step) { return !results[step.id].done; }) : [];
    if (!host || !isOwner() || !results || !pending.length || state.operating || hiddenToday()) {
      if (existing) existing.remove();
      return;
    }
    var section = existing || createSection(host);
    var done = STEPS.length - pending.length;
    var next = pending.find(function (step) { return !results[step.id].waiting && !results[step.id].unknown; });
    var uncertain = pending.some(function (step) { return results[step.id].unknown; });
    section.querySelector('.clinic-setup-progress').textContent = done + ' de ' + STEPS.length + (uncertain ? ' verificados' : ' pasos listos');
    STEPS.forEach(function (step) {
      var result = results[step.id];
      var item = section.querySelector('[data-step="' + step.id + '"]');
      item.dataset.done = String(Boolean(result.done)); item.dataset.next = String(Boolean(next && step.id === next.id));
      var mark = item.querySelector('.clinic-setup-mark');
      mark.setAttribute('aria-label', result.done ? 'Completado' : result.unknown ? 'Sin verificar' : result.waiting ? 'En revisión' : 'Pendiente');
      mark.textContent = result.done ? '✓' : '';
      var hint = item.querySelector('small'); hint.hidden = Boolean(result.done); hint.textContent = result.done ? '' : stepHint(step, result);
      var button = item.querySelector('button');
      if (result.done && document.activeElement === button) section.querySelector('.clinic-setup-toggle').focus();
      button.hidden = Boolean(result.done);
    });
    setExpanded(section);
  }

  function init() {
    state.collapsed = readCollapsed();
    var previous = window.ir;
    if (typeof previous === 'function') {
      window.ir = function (name) {
        var result = previous.apply(this, arguments);
        if (name === 'dashboard') load(true);
        return result;
      };
    }
    window.SmylClinicSetup = Object.freeze({
      reload: function () { return load(true); },
      results: function () { return isOwner() && state.tenant === window.tenantId ? state.results : null; }
    });
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (document.getElementById('smyl-daily-home') && window.tenantId) { clearInterval(timer); state.collapsed = readCollapsed(); load(false); }
      else if (tries > 40) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
