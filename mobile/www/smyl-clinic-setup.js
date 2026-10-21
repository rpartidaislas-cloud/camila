/* SMYL · Inicio: lista «Configura tu clínica» para el propietario.
   Cada paso se verifica con datos reales (solo lectura) y la lista desaparece cuando todo está listo. */
(function () {
  'use strict';

  var STEPS = [
    { id: 'hours', title: 'Define tu horario de atención', hint: 'Sin horario, los pacientes no pueden reservar.', action: 'Definir horario', route: 'agenda' },
    { id: 'patient', title: 'Registra tu primer paciente', hint: 'Desde aquí nace su expediente y su historial.', action: 'Registrar paciente', route: 'pacientes', open: 'patient' },
    { id: 'whatsapp', title: 'Conecta WhatsApp', hint: 'Para recibir y responder mensajes de tus pacientes.', action: 'Conectar', route: 'conexiones' },
    { id: 'template', title: 'Solicita tu primera plantilla', hint: 'Meta debe aprobarla para poder recordar citas.', action: 'Ver plantillas', route: 'plantillas' },
    { id: 'reminders', title: 'Activa los recordatorios de cita', hint: 'Avisan 24 horas antes y reducen las inasistencias.', action: 'Configurar', route: 'agenda' }
  ];
  var state = { loading: false, tenant: null, results: null, loadedAt: 0, collapsed: false };

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function route(name) { if (typeof window.ir === 'function') window.ir(name); }
  function storageKey() { return 'smyl_clinic_setup_collapsed_' + (window.tenantId || ''); }
  // Sin preferencia guardada, en celular los pasos empiezan plegados para llegar antes a la operación del día.
  function readCollapsed() {
    try { var saved = window.localStorage.getItem(storageKey()); if (saved === '1' || saved === '0') return saved === '1'; } catch (_) {}
    return Boolean(window.matchMedia && window.matchMedia('(max-width:700px)').matches);
  }
  function saveCollapsed(value) { try { window.localStorage.setItem(storageKey(), value ? '1' : '0'); } catch (_) {} }
  // Altura de la última vez: se reserva el espacio desde el primer cuadro para que la tarjeta no empuje el Inicio al llegar.
  var HEIGHT_KEY = 'smyl_clinic_setup_height';
  function readHeight() { try { return Math.max(0, Math.min(900, Number(window.localStorage.getItem(HEIGHT_KEY)) || 0)); } catch (_) { return 0; } }
  function saveHeight(value) { try { window.localStorage.setItem(HEIGHT_KEY, String(Math.round(value))); } catch (_) {} }
  function isOwner() { return window.miRolEquipo === 'dueño'; }

  async function count(builder) {
    var result = await Promise.resolve(typeof window.sbTimeout === 'function' ? window.sbTimeout(builder) : builder);
    if (result && result.error) throw result.error;
    return result && typeof result.count === 'number' ? result.count : 0;
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
      var channels = Array.isArray(data.channels) ? data.channels : [];
      return channels.some(function (item) { return item && item.channel === 'whatsapp' && item.connected; });
    } finally { clearTimeout(timer); }
  }

  async function templateState() {
    var result = await window.sb.functions.invoke('whatsapp-templates', { body: { action: 'list' } });
    if (result.error) throw result.error;
    var list = result.data && Array.isArray(result.data.templates) ? result.data.templates : [];
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
    if (!window.tenantId || !window.sb || state.loading || !isOwner()) return render();
    if (!force && state.results && state.tenant === window.tenantId && Date.now() - state.loadedAt < 60000) return render();
    state.loading = true; state.tenant = window.tenantId;
    try {
      var tenant = window.tenantId;
      var rows = await Promise.all([
        settle(count(window.sb.from('smyl_clinic_hours').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant).eq('active', true))),
        settle(count(window.sb.from('camila_pacientes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant))),
        settle(whatsappConnected()),
        settle(templateState()),
        settle(reminderState())
      ]);
      state.results = {
        hours: rows[0].ok ? { done: rows[0].value > 0 } : { unknown: true },
        patient: rows[1].ok ? { done: rows[1].value > 0 } : { unknown: true },
        whatsapp: rows[2].ok ? { done: rows[2].value } : { unknown: true },
        template: rows[3].ok ? { done: rows[3].value === 'done', waiting: rows[3].value === 'pending' } : { unknown: true },
        reminders: rows[4].ok ? { done: rows[4].value } : { unknown: true }
      };
      state.loadedAt = Date.now();
    } finally { state.loading = false; render(); }
  }

  function stepHint(step, result) {
    if (result.unknown) return 'No pudimos verificarlo ahora. Ábrelo para revisar.';
    if (step.id === 'template' && result.waiting) return 'Enviada: Meta la está revisando. Suele tardar de minutos a 48 horas.';
    return step.hint;
  }

  function render() {
    var host = document.getElementById('smyl-daily-home');
    var existing = document.getElementById('smyl-clinic-setup');
    var results = state.results;
    var pending = results ? STEPS.filter(function (step) { return !results[step.id].done; }) : [];
    if (!host || !isOwner() || !results || !pending.length) { if (existing) existing.remove(); if (host && results) saveHeight(0); return; }
    var done = STEPS.length - pending.length;
    var section = existing || el('section', 'clinic-setup');
    section.id = 'smyl-clinic-setup'; section.setAttribute('aria-labelledby', 'clinic-setup-title'); section.style.minHeight = ''; section.style.visibility = ''; section.removeAttribute('aria-hidden');
    section.dataset.collapsed = String(state.collapsed);
    section.innerHTML = '';

    var head = el('header', 'clinic-setup-head');
    var copy = el('div', 'clinic-setup-copy');
    copy.append(el('span', 'clinic-setup-eyebrow', 'PRIMEROS PASOS'));
    var title = el('h2', '', 'Configura tu clínica'); title.id = 'clinic-setup-title';
    copy.append(title, el('p', '', done + ' de ' + STEPS.length + ' pasos listos'));
    var bar = el('div', 'clinic-setup-bar'); bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(STEPS.length)); bar.setAttribute('aria-valuenow', String(done));
    var fill = el('i'); fill.style.width = Math.round(done * 100 / STEPS.length) + '%'; bar.append(fill);
    var toggle = el('button', 'clinic-setup-toggle', state.collapsed ? 'Ver pasos' : 'Ocultar pasos'); toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!state.collapsed));
    toggle.onclick = function () { state.collapsed = !state.collapsed; saveCollapsed(state.collapsed); render(); };
    head.append(copy, bar, toggle);
    section.append(head);

    var list = el('ol', 'clinic-setup-steps'); list.hidden = state.collapsed;
    var firstPending = pending[0].id;
    STEPS.forEach(function (step) {
      var result = results[step.id];
      var item = el('li', 'clinic-setup-step'); item.dataset.done = String(Boolean(result.done)); item.dataset.next = String(step.id === firstPending);
      item.append(el('span', 'clinic-setup-mark', result.done ? '✓' : ''));
      var text = el('div', 'clinic-setup-text');
      text.append(el('strong', '', step.title));
      if (!result.done) text.append(el('small', '', stepHint(step, result)));
      item.append(text);
      if (!result.done) {
        var button = el('button', 'clinic-setup-action', step.action); button.type = 'button';
        button.onclick = function () {
          route(step.route);
          if (step.open === 'patient') setTimeout(function () { if (typeof window.abrirModalPaciente === 'function') window.abrirModalPaciente(); }, 0);
        };
        item.append(button);
      }
      list.append(item);
    });
    section.append(list);
    if (!existing) {
      var hero = host.querySelector('.daily-home-hero');
      if (hero) hero.after(section); else host.prepend(section);
    }
    saveHeight(section.offsetHeight);
  }

  // Marcador de posición sincrónico: ocupa el hueco de la tarjeta antes de que lleguen los datos.
  function reserveSpace() {
    var host = document.getElementById('smyl-daily-home');
    var height = readHeight();
    if (!host || !height || document.getElementById('smyl-clinic-setup') || !isOwner()) return Boolean(host);
    var spacer = el('section', 'clinic-setup'); spacer.id = 'smyl-clinic-setup'; spacer.setAttribute('aria-hidden', 'true'); spacer.style.minHeight = height + 'px'; spacer.style.visibility = 'hidden';
    var hero = host.querySelector('.daily-home-hero');
    if (hero) hero.after(spacer); else host.prepend(spacer);
    return true;
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
    window.SmylClinicSetup = Object.freeze({ reload: function () { return load(true); } });
    // El Inicio se arma al cargar la página; si todavía no existe se espera, sin demorar la reserva de espacio.
    if (!reserveSpace()) {
      var observer = new MutationObserver(function () { if (reserveSpace()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { observer.disconnect(); }, 15000);
    }
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (document.getElementById('smyl-daily-home') && window.tenantId) { clearInterval(timer); state.collapsed = readCollapsed(); load(false); }
      else if (tries > 40) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
