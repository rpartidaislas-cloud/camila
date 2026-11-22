/* SMYL · Lista de espera (pantalla y datos).
   Pestaña «Lista de espera» en Agenda, alta de pacientes (desde Agenda o desde el chat) y, cuando se libera un horario al cancelar o
   mover una cita, un aviso con a quién ofrecérselo. «Ofrecer» deja el mensaje escrito en el chat del paciente: una persona lo revisa
   y lo envía. Nada se agenda ni se envía solo. La lógica de quién encaja vive en smyl-waitlist-core.js (pura y probada). */
(function () {
  'use strict';
  var Core = window.SmylWaitlistCore;
  var state = { loaded: false, at: 0, loading: null, entries: [], patients: {}, services: [], branches: [], professionals: [], pairs: [], canManage: false };
  var CACHE_MS = 20000;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function db() { return window.sb; }
  function tenant() { return window.tenantId; }
  async function q(promise) { var r = await promise; if (r && r.error) throw r.error; return r ? r.data : null; }
  function byId(list, id) { for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i]; return null; }
  function patientName(id) { var p = state.patients[id]; return p ? [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || 'Paciente' : 'Paciente'; }
  function lookup() {
    return {
      service: function (id) { var s = byId(state.services, id); return s && s.name; },
      branch: function (id) { var b = byId(state.branches, id); return b && b.name; },
      professional: function (id) { var p = byId(state.professionals, id); return p && p.display_name; },
    };
  }
  function message(error) { return String((error && (error.message || error.details)) || error || 'No se pudo completar la acción.'); }

  // ── datos ──
  async function load(force) {
    if (!db() || !tenant()) throw new Error('sin conexión');
    if (!force && state.loaded && Date.now() - state.at < CACHE_MS) return state;
    if (state.loading) return state.loading;
    state.loading = (async function () {
      var t = tenant();
      var results = await Promise.all([
        q(db().from('smyl_waitlist_entries').select('*').eq('tenant_id', t).in('status', ['waiting', 'offered']).order('created_at', { ascending: true }).limit(300)),
        q(db().from('smyl_services').select('id,name,duration_minutes,active').eq('tenant_id', t)),
        q(db().from('smyl_branches').select('id,name,timezone,active').eq('tenant_id', t)),
        q(db().from('smyl_professionals').select('id,display_name,active').eq('tenant_id', t)),
        q(db().from('smyl_professional_services').select('professional_id,service_id').eq('tenant_id', t)),
      ]);
      var now = Date.now();
      state.entries = (results[0] || []).filter(function (e) { return !e.expires_at || new Date(e.expires_at).getTime() > now; });
      state.services = results[1] || []; state.branches = results[2] || []; state.professionals = results[3] || []; state.pairs = results[4] || [];
      var ids = state.entries.map(function (e) { return e.patient_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      if (ids.length) {
        var patients = await q(db().from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id', t).in('id', ids)).catch(function () { return []; });
        (patients || []).forEach(function (p) { state.patients[p.id] = p; });
      }
      state.loaded = true; state.at = Date.now();
      return state;
    })().finally(function () { state.loading = null; });
    return state.loading;
  }
  function changed() { state.loaded = false; window.dispatchEvent(new CustomEvent('smyl:waitlist-changed')); }
  function rpc(name, args) { return q(db().rpc(name, args)); }

  async function conversationFor(patientId) {
    try {
      var rows = await q(db().from('camila_lana_handoffs').select('lana_conversation_id').eq('tenant_id', tenant()).eq('patient_id', patientId).eq('lana_channel', 'whatsapp').order('updated_at', { ascending: false }).limit(1));
      return rows && rows[0] ? rows[0].lana_conversation_id : '';
    } catch (_) { return ''; }
  }
  async function patientForConversation(conversationId) {
    try {
      var rows = await q(db().from('camila_lana_handoffs').select('patient_id').eq('tenant_id', tenant()).eq('lana_conversation_id', conversationId).limit(1));
      return rows && rows[0] ? rows[0].patient_id : '';
    } catch (_) { return ''; }
  }

  // ── avisos discretos ──
  function toast(text, action) {
    var old = document.getElementById('waitlist-toast'); if (old) old.remove();
    var box = el('div', 'waitlist-toast'); box.id = 'waitlist-toast'; box.setAttribute('role', 'status');
    box.append(el('p', '', text));
    if (action) { var go = el('button', 'btn btn-secondary btn-sm', action.label); go.type = 'button'; go.onclick = function () { box.remove(); action.run(); }; box.append(go); }
    var close = el('button', 'waitlist-toast-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Cerrar aviso'); close.onclick = function () { box.remove(); };
    box.append(close); document.body.append(box);
    if (!action) setTimeout(function () { if (box.isConnected) box.remove(); }, 6000);
  }

  function dialog() {
    var d = document.getElementById('waitlist-dialog');
    if (!d) { d = el('dialog', 'smyl-v2-dialog waitlist-dialog'); d.id = 'waitlist-dialog'; d.addEventListener('click', function (e) { if (e.target.closest('[data-wl-close]')) d.close(); }); document.body.append(d); }
    return d;
  }

  // ── pestaña de Agenda ──
  var statusChip = function (entry) {
    if (entry.status === 'offered') return '<span class="wl-chip" data-tone="offered">Se le ofreció ' + esc(Core.waitingSince({ created_at: entry.offered_at })) + '</span>';
    return '<span class="wl-chip" data-tone="waiting">En espera</span>';
  };
  function renderList(host, canManage) {
    var rows = state.entries.slice().sort(function (a, b) { return (b.priority === 'urgent') - (a.priority === 'urgent') || new Date(a.created_at) - new Date(b.created_at); });
    var look = lookup(), now = new Date();
    var head = '<div class="wl-head"><div><h2>Lista de espera</h2><p>Pacientes que quieren un horario más pronto. Cuando se libera uno, aquí sabrás a quién ofrecérselo.</p></div>' + (canManage ? '<button type="button" class="btn btn-primary" data-wl-add>Agregar paciente</button>' : '') + '</div>';
    if (!rows.length) { host.innerHTML = head + '<div class="wl-empty"><strong>Nadie está esperando</strong><p>Cuando un paciente no encuentre horario o quiera uno más pronto, agrégalo aquí o desde el chat con «Poner en lista de espera».</p></div>'; bind(host); return; }
    host.innerHTML = head + '<div class="wl-list">' + rows.map(function (e) {
      return '<article class="wl-card" data-id="' + esc(e.id) + '"><div class="wl-main"><strong>' + esc(patientName(e.patient_id)) + (e.priority === 'urgent' ? ' <em class="wl-urgent">Urgente</em>' : '') + '</strong><small>' + esc(Core.describe(e, look)) + '</small><small class="wl-meta">En espera ' + esc(Core.waitingSince(e, now)) + (e.note ? ' · ' + esc(e.note) : '') + '</small></div><div class="wl-state">' + statusChip(e) + '</div>' +
        (canManage ? '<div class="wl-actions">' + (e.status === 'offered' ? '<button type="button" class="btn btn-secondary btn-sm" data-wl-back="' + esc(e.id) + '">Volver a esperar</button>' : '') + '<button type="button" class="btn btn-secondary btn-sm" data-wl-booked="' + esc(e.id) + '">Ya se agendó</button><button type="button" class="btn btn-secondary btn-sm is-danger" data-wl-remove="' + esc(e.id) + '">Quitar</button></div>' : '') + '</article>';
    }).join('') + '</div>';
    bind(host);
  }
  function bind(host) {
    var add = host.querySelector('[data-wl-add]'); if (add) add.onclick = function () { openAdd({}); };
    function act(attr, status, done) {
      host.querySelectorAll('[' + attr + ']').forEach(function (b) {
        b.onclick = async function () {
          b.disabled = true;
          try { await rpc('smyl_waitlist_set_status', { p_id: b.getAttribute(attr), p_status: status }); changed(); toast(done, null); await refresh(host); }
          catch (e) { b.disabled = false; toast(message(e), null); }
        };
      });
    }
    act('data-wl-booked', 'booked', 'Listo: salió de la lista de espera.');
    act('data-wl-remove', 'cancelled', 'Se quitó de la lista de espera.');
    act('data-wl-back', 'waiting', 'Volvió a la lista de espera.');
  }
  var currentHost = null, currentCan = false;
  async function refresh(host) {
    host = host || currentHost; if (!host) return;
    try { await load(true); renderList(host, currentCan); } catch (e) { host.innerHTML = '<div class="wl-empty"><strong>No pudimos cargar la lista de espera</strong><p>' + esc(message(e)) + '</p></div>'; }
    updateBadge();
  }
  function render(host, opts) {
    currentHost = host; currentCan = !!(opts && opts.canManage);
    host.innerHTML = '<p class="wl-note">Cargando…</p>';
    return refresh(host);
  }
  function updateBadge() {
    var badge = document.getElementById('schedule-waitlist-count'); if (!badge) return;
    badge.textContent = state.entries.length ? '(' + state.entries.length + ')' : '';
  }
  async function loadCount() { try { await load(false); updateBadge(); } catch (_) {} }

  // ── alta ──
  async function openAdd(opts) {
    opts = opts || {};
    try { await load(false); } catch (e) { toast(message(e), null); return; }
    var patientId = opts.patientId || '';
    if (!patientId && opts.conversationId) patientId = await patientForConversation(opts.conversationId);
    if (opts.conversationId && !patientId) { toast('Primero vincula esta conversación con un paciente para ponerlo en la lista de espera.', null); return; }
    if (patientId && !state.patients[patientId]) {
      var rows = await q(db().from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id', tenant()).eq('id', patientId)).catch(function () { return []; });
      (rows || []).forEach(function (p) { state.patients[p.id] = p; });
    }
    var services = state.services.filter(function (s) { return s.active !== false; });
    var d = dialog();
    d.innerHTML = '<form class="wl-form" novalidate><h2>Agregar a la lista de espera</h2><p>Cuando se libere un horario que le acomode, aparecerá aquí para ofrecérselo.</p><div class="wl-grid">' +
      '<div class="wl-field wl-wide" data-wl-patient>' + (patientId ? '<span class="wl-label">Paciente</span><strong>' + esc(patientName(patientId)) + '</strong>' : '<label class="wl-label" for="wl-search">Paciente</label><input id="wl-search" type="search" autocomplete="off" placeholder="Busca por nombre o teléfono"><ul class="wl-results" data-wl-results hidden></ul><small data-wl-picked></small>') + '<input type="hidden" name="patient" value="' + esc(patientId) + '"></div>' +
      '<label class="wl-field wl-wide"><span class="wl-label">Servicio</span><select name="service" required><option value="">Elige un servicio</option>' + services.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === opts.serviceId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="wl-field"><span class="wl-label">Sucursal</span><select name="branch"><option value="">Cualquiera</option>' + state.branches.filter(function (b) { return b.active !== false; }).map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === opts.branchId ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="wl-field"><span class="wl-label">Profesional</span><select name="professional"><option value="">Cualquiera</option>' + state.professionals.filter(function (p) { return p.active !== false; }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === opts.professionalId ? ' selected' : '') + '>' + esc(p.display_name) + '</option>'; }).join('') + '</select></label>' +
      '<fieldset class="wl-field wl-wide"><legend class="wl-label">Horario que le acomoda</legend><div class="wl-radios"><label><input type="radio" name="daypart" value="any" checked> Cualquiera</label><label><input type="radio" name="daypart" value="morning"> Por la mañana</label><label><input type="radio" name="daypart" value="afternoon"> Por la tarde</label></div></fieldset>' +
      '<label class="wl-field"><span class="wl-label">Hasta el día <em>(opcional)</em></span><input type="date" name="until"></label>' +
      '<label class="wl-field wl-check"><input type="checkbox" name="urgent"> Es urgente (dolor o molestia)</label>' +
      '<label class="wl-field wl-wide"><span class="wl-label">Nota <em>(opcional)</em></span><textarea name="note" maxlength="300" rows="2" placeholder="Ej. Solo puede salir del trabajo después de las 5."></textarea></label></div>' +
      '<div class="wl-error" data-wl-error hidden></div><div class="wl-actions-row"><button type="button" class="btn btn-secondary" data-wl-close>Cancelar</button><button class="btn btn-primary" type="submit">Agregar</button></div></form>';
    var f = d.querySelector('form'), err = f.querySelector('[data-wl-error]');
    if (!patientId) wireSearch(f);
    f.onsubmit = async function (e) {
      e.preventDefault(); err.hidden = true;
      var patient = f.elements.patient.value, service = f.elements.service.value;
      if (!patient) { err.textContent = 'Elige al paciente de la lista.'; err.hidden = false; return; }
      if (!service) { err.textContent = 'Elige el servicio que necesita.'; err.hidden = false; return; }
      var submit = f.querySelector('[type=submit]'); submit.disabled = true; submit.textContent = 'Agregando…';
      try {
        await rpc('smyl_waitlist_add', { p_patient_id: patient, p_service_id: service, p_branch_id: f.elements.branch.value || null, p_professional_id: f.elements.professional.value || null,
          p_daypart: f.elements.daypart.value, p_not_before: null, p_not_after: f.elements.until.value || null, p_priority: f.elements.urgent.checked ? 'urgent' : 'normal', p_note: f.elements.note.value.trim(), p_source: opts.source || 'manual' });
        d.close(); changed(); toast('Agregado a la lista de espera.', null);
        if (currentHost) refresh(currentHost); else loadCount();
      } catch (ex) { submit.disabled = false; submit.textContent = 'Agregar'; err.textContent = message(ex); err.hidden = false; }
    };
    if (!d.open) d.showModal();
  }
  function wireSearch(form) {
    var input = form.querySelector('#wl-search'), list = form.querySelector('[data-wl-results]'), hidden = form.elements.patient, picked = form.querySelector('[data-wl-picked]'), timer = 0, seq = 0;
    input.addEventListener('input', function () {
      hidden.value = ''; picked.textContent = ''; clearTimeout(timer);
      var term = input.value.trim(); if (term.length < 2) { list.hidden = true; return; }
      timer = setTimeout(async function () {
        var mine = ++seq;
        try {
          var rows = await rpc('smyl_search_patients', { p_tenant_id: tenant(), p_query: term, p_limit: 8 });
          if (mine !== seq) return;
          list.innerHTML = ''; (rows || []).forEach(function (p) {
            var li = el('li'); var b = el('button', '', [p.nombre, p.apellido].filter(Boolean).join(' ') || 'Paciente'); b.type = 'button';
            b.onclick = function () { state.patients[p.id] = p; hidden.value = p.id; input.value = b.textContent; picked.textContent = 'Paciente elegido.'; list.hidden = true; };
            li.append(b); list.append(li);
          });
          if (!(rows || []).length) { var none = el('li', 'wl-none', 'Sin resultados'); list.append(none); }
          list.hidden = false;
        } catch (_) { list.hidden = true; }
      }, 250);
    });
  }

  // ── hueco liberado ──
  function slotContext(slot) {
    var branch = byId(state.branches, slot.branch_id), durations = {};
    state.services.forEach(function (s) { durations[s.id] = Number(s.duration_minutes) || 0; });
    return { slot: Object.assign({ timezone: branch && branch.timezone }, slot), ctx: { now: new Date(), durations: durations, professionalServices: state.pairs } };
  }
  async function onSlotFreed(opts) {
    try {
      if (!opts || !opts.slot || !opts.canManage || !db() || !tenant() || !Core) return;
      await load(true);
      var prepared = slotContext(opts.slot), found = Core.matches(state.entries, prepared.slot, prepared.ctx);
      updateBadge();
      if (!found.length) return;
      var when = window.SmylVisitMessage ? window.SmylVisitMessage.whenText(prepared.slot.starts_at, prepared.slot.timezone) : prepared.slot.starts_at;
      toast('Se liberó un horario (' + when + '). ' + (found.length === 1 ? 'Hay 1 paciente en espera que encaja.' : 'Hay ' + found.length + ' pacientes en espera que encajan.'), { label: 'Ver quién', run: function () { openFreed(prepared.slot, found); } });
    } catch (_) { /* un aviso de más o de menos nunca debe estorbar a la Agenda */ }
  }
  async function openFreed(slot, found) {
    var look = lookup(), d = dialog(), branch = byId(state.branches, slot.branch_id);
    var when = window.SmylVisitMessage ? window.SmylVisitMessage.whenText(slot.starts_at, slot.timezone) : slot.starts_at;
    var conversations = await Promise.all(found.slice(0, 5).map(function (c) { return conversationFor(c.entry.patient_id); }));
    d.innerHTML = '<div class="wl-freed"><header><h2>Se liberó un horario</h2><p><strong>' + esc(when) + '</strong><br>' + esc([look.professional(slot.professional_id), look.branch(slot.branch_id), look.service(slot.service_id)].filter(Boolean).join(' · ')) + '</p></header><p class="wl-note">Estas personas esperan un horario como este. Ofrécelo a una a la vez: el mensaje queda escrito en su chat para que lo revises y lo envíes.</p><ol class="wl-candidates">' +
      found.slice(0, 5).map(function (c, i) {
        var e = c.entry, conv = conversations[i];
        return '<li data-i="' + i + '"><div><strong>' + esc(patientName(e.patient_id)) + '</strong><small>' + esc(Core.describe(e, look)) + '</small><span class="wl-reasons">' + c.reasons.map(function (r) { return '<em>' + esc(r) + '</em>'; }).join('') + '</span></div><button type="button" class="btn ' + (i === 0 ? 'btn-primary' : 'btn-secondary') + '" data-wl-offer="' + i + '"' + (conv ? '' : ' disabled title="Este paciente no tiene un chat de WhatsApp vinculado."') + '>' + (conv ? 'Ofrecer' : 'Sin chat') + '</button></li>';
      }).join('') + '</ol><div class="wl-error" data-wl-error hidden></div><div class="wl-actions-row"><button type="button" class="btn btn-secondary" data-wl-close>Ahora no</button></div></div>';
    d.querySelectorAll('[data-wl-offer]').forEach(function (b) {
      b.onclick = async function () {
        var i = Number(b.dataset.wlOffer), c = found[i], conv = conversations[i], err = d.querySelector('[data-wl-error]'); err.hidden = true; b.disabled = true; b.textContent = 'Preparando…';
        try {
          await rpc('smyl_waitlist_offer', { p_id: c.entry.id, p_offered_start: slot.starts_at });
          var svc = look.service(c.entry.service_id);
          var text = Core.offerMessage({ firstName: String(patientName(c.entry.patient_id)).split(' ')[0], service: svc, when: when, professional: look.professional(slot.professional_id), branch: branch && branch.name });
          changed();
          d.close();
          if (window.SmylInbox && typeof window.SmylInbox.compose === 'function') {
            var ok = await window.SmylInbox.compose(conv, text);
            toast(ok ? 'Quedó escrito el mensaje en el chat. Revísalo y envíalo.' : 'Se registró la oferta, pero no pudimos abrir el chat.', null);
          } else toast('Se registró la oferta, pero no pudimos abrir el chat.', null);
        } catch (ex) { b.disabled = false; b.textContent = 'Ofrecer'; err.textContent = message(ex); err.hidden = false; }
      };
    });
    if (!d.open) d.showModal();
  }

  window.SmylWaitlist = { render: render, openAdd: openAdd, onSlotFreed: onSlotFreed, loadCount: loadCount, reload: function () { state.loaded = false; return currentHost ? refresh(currentHost) : loadCount(); }, _state: state };
})();
