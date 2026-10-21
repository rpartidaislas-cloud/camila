/* SMYL · Agenda: asistente de puesta en marcha.
   Verifica con datos reales (solo lectura) lo que la Agenda necesita para aceptar citas y
   ofrece crear en bloque el horario estándar de la clínica y de cada profesional.
   Las reglas replican a smyl_create_appointment: sin horario de la sucursal y del
   profesional la base rechaza toda cita. */
(function () {
  'use strict';

  var DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var DEFAULT_DAYS = [1, 2, 3, 4, 5];
  var state = { tenant: null, data: null, assessed: null, can: null, loading: false, observer: null, timer: null };

  // ── Lógica pura (se prueba sin navegador) ──
  function toMin(value) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }
  function fromMin(total) { return ('0' + Math.floor(total / 60)).slice(-2) + ':' + ('0' + (total % 60)).slice(-2); }
  function key() { return Array.prototype.join.call(arguments, '|'); }
  function dayRange(days) {
    var sorted = DAY_ORDER.filter(function (d) { return days.indexOf(d) >= 0; });
    if (!sorted.length) return '';
    var runs = [], run = [sorted[0]];
    for (var i = 1; i < sorted.length; i++) {
      var prev = DAY_ORDER.indexOf(sorted[i - 1]), now = DAY_ORDER.indexOf(sorted[i]);
      if (now === prev + 1) run.push(sorted[i]); else { runs.push(run); run = [sorted[i]]; }
    }
    runs.push(run);
    return runs.map(function (r) { return r.length > 2 ? DAYS[r[0]] + ' a ' + DAYS[r[r.length - 1]] : r.map(function (d) { return DAYS[d]; }).join(', '); }).join(', ');
  }

  function assess(data) {
    var branches = data.branches || [], activeBranchIds = {};
    branches.forEach(function (b) { activeBranchIds[b.id] = true; });
    var links = (data.professionalBranches || []).filter(function (l) { return activeBranchIds[l.branch_id]; });
    var linkedIds = {};
    links.forEach(function (l) { (linkedIds[l.professional_id] = linkedIds[l.professional_id] || []).push(l.branch_id); });
    var professionals = (data.professionals || []).filter(function (p) { return linkedIds[p.id]; });
    var clinicBranches = {};
    (data.clinicHours || []).forEach(function (h) { clinicBranches[h.branch_id] = true; });
    var missingClinic = branches.filter(function (b) { return !clinicBranches[b.id]; });
    var withHours = {};
    (data.professionalHours || []).forEach(function (h) { if ((linkedIds[h.professional_id] || []).indexOf(h.branch_id) >= 0) withHours[h.professional_id] = true; });
    var missingProfessional = professionals.filter(function (p) { return !withHours[p.id]; });
    var activeServices = {}, activeProfessionals = {};
    (data.services || []).forEach(function (s) { activeServices[s.id] = true; });
    (data.professionals || []).forEach(function (p) { activeProfessionals[p.id] = true; });
    var assigned = (data.professionalServices || []).some(function (l) { return activeServices[l.service_id] && activeProfessionals[l.professional_id]; });
    var names = function (rows, field) { return rows.map(function (r) { return r[field]; }).join(', '); };
    var roomsByBranch = {};
    (data.rooms || []).forEach(function (r) { roomsByBranch[r.branch_id] = true; });
    var missingRooms = branches.filter(function (b) { return !roomsByBranch[b.id]; });
    var hasServices = (data.services || []).length > 0;
    var steps = [
      { id: 'branch', title: 'Una sucursal activa', done: branches.length > 0, detail: 'Agrégala en Mi clínica.' },
      { id: 'clinicHours', title: 'Horario de atención de la clínica', done: branches.length > 0 && !missingClinic.length, detail: 'Falta en: ' + names(missingClinic, 'name') + '.', needsHours: true },
      { id: 'professional', title: 'Un profesional asignado a una sucursal', done: professionals.length > 0, detail: 'Agrégalo o asígnalo en Mi clínica.' },
      { id: 'professionalHours', title: 'Horario de cada profesional', done: professionals.length > 0 && !missingProfessional.length, detail: 'Falta para: ' + names(missingProfessional, 'display_name') + '.', needsHours: true },
      { id: 'services', title: 'Un servicio con profesional asignado', done: assigned, detail: hasServices ? 'Hay servicios, pero ningún profesional los realiza.' : 'Aún no hay servicios. Puedes crear los más comunes del catálogo dental.', needsServices: true },
      { id: 'rooms', title: 'Sillones o consultorios', done: branches.length > 0 && !missingRooms.length, optional: true, detail: 'Sin sillones, las citas no ocupan espacio. Con sillones, cada cita debe elegir uno. Falta en: ' + names(missingRooms, 'name') + '.', needsRooms: true }
    ];
    return { steps: steps, ready: steps.every(function (s) { return s.done || s.optional; }), missingClinic: missingClinic, missingProfessional: missingProfessional, missingRooms: missingRooms };
  }

  function plan(data, options, can) {
    var days = (options.days || []).filter(function (d) { return d >= 0 && d <= 6; });
    var start = toMin(options.start), end = toMin(options.end);
    var empty = { clinic: [], professional: [], skipped: [], error: '' };
    if (!days.length) { empty.error = 'Elige al menos un día.'; return empty; }
    if (!isFinite(start) || !isFinite(end) || end <= start) { empty.error = 'La hora de cierre debe ser posterior a la de apertura.'; return empty; }
    var clinicRows = [], profRows = [], skipped = [], clinicBlocks = {}, profBlocks = {};
    (data.clinicHours || []).forEach(function (h) { (clinicBlocks[key(h.branch_id, h.weekday)] = clinicBlocks[key(h.branch_id, h.weekday)] || []).push({ s: toMin(h.starts_at), e: toMin(h.ends_at) }); });
    (data.professionalHours || []).forEach(function (h) { profBlocks[key(h.professional_id, h.branch_id, h.weekday)] = true; });
    if (can.clinic) {
      (data.branches || []).forEach(function (b) {
        days.forEach(function (d) {
          var k = key(b.id, d);
          if ((clinicBlocks[k] || []).length) return;
          clinicRows.push({ branch_id: b.id, weekday: d, starts_at: fromMin(start), ends_at: fromMin(end) });
          clinicBlocks[k] = [{ s: start, e: end }];
        });
      });
    }
    if (can.schedule) {
      var branchById = {}, linkedBranches = {};
      (data.branches || []).forEach(function (b) { branchById[b.id] = b; });
      (data.professionalBranches || []).forEach(function (l) { if (branchById[l.branch_id]) (linkedBranches[l.professional_id] = linkedBranches[l.professional_id] || []).push(l.branch_id); });
      (data.professionals || []).forEach(function (p) {
        (linkedBranches[p.id] || []).forEach(function (branchId) {
          days.forEach(function (d) {
            if (profBlocks[key(p.id, branchId, d)]) return;
            var pieces = (clinicBlocks[key(branchId, d)] || []).map(function (c) { return { s: Math.max(c.s, start), e: Math.min(c.e, end) }; }).filter(function (c) { return c.e > c.s; });
            if (!pieces.length) { skipped.push({ professional: p.display_name, branch: branchById[branchId].name, weekday: d }); return; }
            pieces.forEach(function (c) { profRows.push({ professional_id: p.id, professional: p.display_name, branch_id: branchId, weekday: d, starts_at: fromMin(c.s), ends_at: fromMin(c.e) }); });
          });
        });
      });
    }
    return { clinic: clinicRows, professional: profRows, skipped: skipped, error: '' };
  }

  function norm(v) { return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }
  // Servicios del catálogo dental: no se repite nombre ni plantilla (índices únicos de la base)
  // y se asignan a los profesionales activos que aún no los realizan.
  function planServices(data, selected, presets, options, can) {
    options = options || {}; can = can || {};
    var newId = options.newId || function () { return 'new-' + Math.random().toString(36).slice(2); };
    var names = {}, keys = {}, existingActive = [], assignedService = {}, pair = {};
    (data.services || []).forEach(function (sv) { names[norm(sv.name)] = true; if (sv.template_key) keys[sv.template_key] = true; existingActive.push(sv); });
    (data.professionalServices || []).forEach(function (l) { assignedService[l.service_id] = true; pair[key(l.professional_id, l.service_id)] = true; });
    var create = [], already = [];
    if (can.services) {
      (presets || []).filter(function (x) { return (selected || []).indexOf(x.key) >= 0; }).forEach(function (x) {
        if (keys[x.key] || names[norm(x.name)]) already.push(x); else create.push({ preset: x, id: newId() });
      });
    }
    var targets = create.map(function (c) { return { id: c.id, name: c.preset.name, isNew: true }; });
    existingActive.forEach(function (sv) { if (!assignedService[sv.id]) targets.push({ id: sv.id, name: sv.name, isNew: false }); });
    var assignments = [];
    if (options.assign !== false && can.schedule) {
      (data.professionals || []).forEach(function (pr) {
        targets.forEach(function (t) { if (!pair[key(pr.id, t.id)]) assignments.push({ professional_id: pr.id, professional: pr.display_name, service_id: t.id, service: t.name, isNew: t.isNew }); });
      });
    }
    return { create: create, already: already, assignments: assignments, existingTargets: targets.filter(function (t) { return !t.isNew; }) };
  }
  // Sillones: sólo en sucursales que aún no tienen ninguno; el nombre nunca repite uno activo.
  function planRooms(data, count) {
    var n = Math.max(1, Math.min(10, Math.floor(Number(count) || 1))), rows = [], taken = {};
    (data.rooms || []).forEach(function (r) { taken[key(r.branch_id, norm(r.name))] = true; });
    var haveRooms = {};
    (data.rooms || []).forEach(function (r) { haveRooms[r.branch_id] = true; });
    (data.branches || []).forEach(function (b) {
      if (haveRooms[b.id]) return;
      for (var i = 1; i <= n; i++) rows.push({ branch_id: b.id, branch: b.name, name: 'Sillón ' + i });
    });
    return rows;
  }

  // ── Interfaz ──
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function run(builder) {
    return Promise.resolve(typeof window.sbTimeout === 'function' ? window.sbTimeout(builder) : builder).then(function (r) {
      if (r && r.error) throw r.error;
      return r ? r.data : null;
    });
  }
  function settle(promise) { return promise.then(function (v) { return { ok: true, value: v }; }, function () { return { ok: false }; }); }
  function dismissKey() { return 'smyl_schedule_rooms_hint_' + (state.tenant || ''); }
  function dismissed() { try { return window.localStorage.getItem(dismissKey()) === '1'; } catch (_) { return false; } }
  function dismiss() { try { window.localStorage.setItem(dismissKey(), '1'); } catch (_) {} }
  function route(name) { if (typeof window.ir === 'function') window.ir(name); }
  function openSettingsTab() { var tab = document.querySelector('[data-schedule-tab="settings"]'); if (tab) tab.click(); }

  async function permissions(tenant) {
    var ask = function (permission) { return settle(window.sb.rpc('smyl_has_permission', { p_tenant_id: tenant, p_permission: permission })); };
    var rows = await Promise.all([ask('schedule.manage'), ask('clinic.manage'), ask('settings.manage')]);
    var yes = function (r) { return Boolean(r.ok && r.value && r.value.data === true); };
    return { schedule: yes(rows[0]), clinic: yes(rows[1]), services: yes(rows[2]) };
  }

  async function load() {
    var tenant = window.tenantId;
    if (!tenant || !window.sb || state.loading) return;
    state.loading = true;
    try {
      var t = function (name, columns, extra) { var q = window.sb.from(name).select(columns).eq('tenant_id', tenant); return extra ? extra(q) : q; };
      var active = function (q) { return q.eq('active', true); };
      var rows = await Promise.all([
        settle(run(t('smyl_branches', 'id,name', active))),
        settle(run(t('smyl_professionals', 'id,display_name', active))),
        settle(run(t('smyl_professional_branches', 'professional_id,branch_id'))),
        settle(run(t('smyl_professional_services', 'professional_id,service_id'))),
        settle(run(t('smyl_services', 'id,name,template_key', active))),
        settle(run(t('smyl_clinic_hours', 'branch_id,weekday,starts_at,ends_at', active))),
        settle(run(t('smyl_professional_hours', 'professional_id,branch_id,weekday', active))),
        settle(run(t('smyl_rooms', 'id,branch_id,name', active))),
        permissions(tenant)
      ]);
      if (state.tenant !== null && state.tenant !== tenant) state.data = null;
      state.tenant = tenant;
      if (rows.slice(0, 8).some(function (r) { return !r.ok; })) { state.data = null; state.assessed = null; return; }
      state.data = {
        branches: rows[0].value || [], professionals: rows[1].value || [], professionalBranches: rows[2].value || [],
        professionalServices: rows[3].value || [], services: rows[4].value || [], clinicHours: rows[5].value || [], professionalHours: rows[6].value || [], rooms: rows[7].value || []
      };
      state.can = rows[8];
      state.assessed = assess(state.data);
    } finally { state.loading = false; render(); }
  }

  function render() {
    var page = document.getElementById('p-agenda');
    var existing = document.getElementById('schedule-setup');
    if (!page || !state.assessed || !state.can || !state.can.schedule) { if (existing) existing.remove(); return; }
    var feedback = document.getElementById('schedule-feedback');
    if (!feedback) return;
    if (state.assessed.ready) {
      // Lo obligatorio está completo: sólo se ofrece, sin insistir, lo opcional que falte.
      var optional = state.assessed.steps.filter(function (x) { return x.optional && !x.done; })[0];
      if (!optional || dismissed()) { if (existing) existing.remove(); return; }
      var hint = existing || el('section', 'schedule-setup');
      hint.id = 'schedule-setup'; hint.dataset.compact = 'true'; hint.setAttribute('aria-labelledby', 'schedule-setup-title'); hint.innerHTML = '';
      var box = el('div', 'schedule-setup-copy'), heading = el('h2', '', 'Tu Agenda ya acepta citas'); heading.id = 'schedule-setup-title';
      box.append(el('span', 'schedule-setup-eyebrow', 'OPCIONAL'), heading, el('p', '', 'Agrega sillones o consultorios para que la agenda evite dobles reservas del mismo espacio. Con ellos, cada cita debe elegir uno.'));
      var actions = el('div', 'schedule-setup-actions'), add = el('button', 'btn btn-primary', 'Agregar sillones'), later = el('button', 'btn btn-secondary', 'Ahora no');
      add.type = 'button'; later.type = 'button';
      add.onclick = openRoomsWizard;
      later.onclick = function () { dismiss(); render(); };
      actions.append(add, later); hint.append(box, actions);
      if (!existing) feedback.after(hint);
      return;
    }
    if (existing) delete existing.dataset.compact;
    var a = state.assessed, required = a.steps.filter(function (s) { return !s.optional; }), done = required.filter(function (s) { return s.done; }).length;
    var section = existing || el('section', 'schedule-setup');
    section.id = 'schedule-setup'; section.setAttribute('aria-labelledby', 'schedule-setup-title');
    section.innerHTML = '';
    var head = el('header', 'schedule-setup-head'), copy = el('div', 'schedule-setup-copy');
    copy.append(el('span', 'schedule-setup-eyebrow', 'PUESTA EN MARCHA'));
    var title = el('h2', '', 'Prepara tu Agenda para recibir citas'); title.id = 'schedule-setup-title';
    copy.append(title, el('p', '', done + ' de ' + required.length + ' pasos listos. Mientras falte alguno, la Agenda rechaza las citas.'));
    var bar = el('div', 'schedule-setup-bar'); bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(required.length)); bar.setAttribute('aria-valuenow', String(done));
    var fill = el('i'); fill.style.width = Math.round(done * 100 / required.length) + '%'; bar.append(fill);
    head.append(copy, bar); section.append(head);

    var list = el('ol', 'schedule-setup-steps'), firstPending = a.steps.filter(function (s) { return !s.done && !s.optional; })[0];
    a.steps.forEach(function (step) {
      var item = el('li', 'schedule-setup-step'); item.dataset.done = String(step.done); item.dataset.next = String(step === firstPending); if (step.optional) item.dataset.optional = 'true';
      item.append(el('span', 'schedule-setup-mark', step.done ? '✓' : ''));
      var text = el('div', 'schedule-setup-text'); text.append(el('strong', '', step.title + (step.optional ? ' (opcional)' : '')));
      if (!step.done) text.append(el('small', '', step.detail));
      item.append(text);
      if (!step.done) {
        var label = step.needsHours ? 'Crear horario' : step.needsServices ? 'Crear servicios' : step.needsRooms ? 'Agregar sillones' : 'Ir a Mi clínica';
        var button = el('button', 'schedule-setup-action', label); button.type = 'button';
        button.onclick = function () { if (step.needsHours) openWizard(); else if (step.needsServices) openServicesWizard(); else if (step.needsRooms) openRoomsWizard(); else route('clinica'); };
        item.append(button);
      }
      list.append(item);
    });
    section.append(list);
    if (a.steps.some(function (s) { return !s.done && s.needsHours; })) {
      var foot = el('footer', 'schedule-setup-foot');
      var primary = el('button', 'btn btn-primary', 'Usar horario estándar'); primary.type = 'button'; primary.onclick = openWizard;
      foot.append(primary, el('span', '', 'Lunes a viernes de 9:00 a 18:00. Puedes cambiar días y horas, y respeta los horarios que ya tengas.'));
      section.append(foot);
    }
    if (!existing) feedback.after(section);
  }

  function dialogEl() { return document.getElementById('schedule-dialog'); }
  function notifyIn(dialog, text) {
    var box = dialog.querySelector('[data-setup-error]');
    if (!text) { if (box) box.remove(); return; }
    if (!box) { box = el('p', 'schedule-dialog-error'); box.setAttribute('role', 'alert'); box.dataset.setupError = 'true'; dialog.querySelector('.schedule-dialog-actions').before(box); }
    box.textContent = text;
  }

  function previewHtml(p, can) {
    if (p.error) return '<p class="schedule-setup-note" data-tone="warn">' + esc(p.error) + '</p>';
    var out = [];
    function group(rows, label) {
      var byKey = {};
      rows.forEach(function (r) { var k = label(r) + '|' + r.starts_at + '|' + r.ends_at; (byKey[k] = byKey[k] || { label: label(r), range: r.starts_at + '–' + r.ends_at, days: [] }).days.push(r.weekday); });
      return Object.keys(byKey).map(function (k) { return '<li><strong>' + esc(byKey[k].label) + '</strong><span>' + esc(dayRange(byKey[k].days) + ' · ' + byKey[k].range) + '</span></li>'; });
    }
    var items = group(p.clinic, function (r) { var b = (state.data.branches.filter(function (x) { return x.id === r.branch_id; })[0] || {}).name; return 'Clínica · ' + (b || 'Sucursal'); })
      .concat(group(p.professional, function (r) { return r.professional; }));
    if (items.length) out.push('<p class="schedule-setup-note">Se van a crear estos horarios:</p><ul class="schedule-setup-preview">' + items.join('') + '</ul>');
    else out.push('<p class="schedule-setup-note">No hay nada nuevo que crear con estas opciones: los días elegidos ya tienen horario.</p>');
    if (!can.clinic) out.push('<p class="schedule-setup-note" data-tone="warn">Tu rol no puede crear el horario de la clínica. Pide al propietario que lo cree; el del profesional sí puede crearse.</p>');
    if (p.skipped.length) {
      var names = {};
      p.skipped.forEach(function (s) { names[s.professional] = true; });
      out.push('<p class="schedule-setup-note" data-tone="warn">Se omiten los días en que la sucursal no abre en ese horario (' + esc(Object.keys(names).join(', ')) + '). La cita solo puede caer dentro del horario de la clínica.</p>');
    }
    return out.join('');
  }

  function openWizard() {
    var dialog = dialogEl();
    if (!dialog || !state.data || !state.can) return;
    var checks = DAY_ORDER.map(function (d) {
      return '<label class="schedule-setup-day"><input type="checkbox" name="day" value="' + d + '"' + (DEFAULT_DAYS.indexOf(d) >= 0 ? ' checked' : '') + '><span>' + DAYS[d] + '</span></label>';
    }).join('');
    dialog.innerHTML = '<form id="schedule-setup-form"><h2>Horario estándar</h2><p>Crea de una vez el horario de atención de la clínica y el de cada profesional. Los días que ya tienen horario no se tocan.</p>' +
      '<fieldset class="schedule-setup-days"><legend>Días de atención</legend><div>' + checks + '</div></fieldset>' +
      '<div class="schedule-form-grid"><label>Apertura<input name="start" type="time" value="09:00" step="900" required></label><label>Cierre<input name="end" type="time" value="18:00" step="900" required></label></div>' +
      '<section class="schedule-setup-result" data-setup-preview aria-live="polite"></section>' +
      '<div class="schedule-dialog-actions"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" type="submit" data-setup-submit>Crear horarios</button></div></form>';
    dialog.showModal();
    var form = dialog.querySelector('form'), preview = dialog.querySelector('[data-setup-preview]'), submit = dialog.querySelector('[data-setup-submit]'), current = null, saving = false;
    function options() {
      return { days: Array.prototype.map.call(form.querySelectorAll('input[name=day]:checked'), function (i) { return Number(i.value); }), start: form.elements.start.value, end: form.elements.end.value };
    }
    function refresh() {
      current = plan(state.data, options(), state.can);
      preview.innerHTML = previewHtml(current, state.can);
      submit.disabled = saving || Boolean(current.error) || (!current.clinic.length && !current.professional.length);
      notifyIn(dialog, '');
    }
    form.addEventListener('change', refresh); form.addEventListener('input', refresh);
    dialog.querySelector('[data-close]').onclick = function () { dialog.close(); };
    form.onsubmit = async function (event) {
      event.preventDefault();
      if (saving) return;
      refresh();
      if (submit.disabled) return;
      saving = true; submit.disabled = true; submit.textContent = 'Creando…';
      var tenant = state.tenant, actor = null, savedClinic = false;
      try {
        var auth = await window.sb.auth.getUser();
        actor = auth && auth.data && auth.data.user && auth.data.user.id || null;
        if (current.clinic.length) {
          await run(window.sb.from('smyl_clinic_hours').upsert(current.clinic.map(function (r) { return { tenant_id: tenant, branch_id: r.branch_id, weekday: r.weekday, starts_at: r.starts_at, ends_at: r.ends_at, active: true, created_by: actor }; }), { onConflict: 'tenant_id,branch_id,weekday,starts_at,ends_at' }).select('id'));
          savedClinic = true;
        }
        if (current.professional.length) {
          await run(window.sb.from('smyl_professional_hours').upsert(current.professional.map(function (r) { return { tenant_id: tenant, professional_id: r.professional_id, branch_id: r.branch_id, weekday: r.weekday, starts_at: r.starts_at, ends_at: r.ends_at, active: true, created_by: actor }; }), { onConflict: 'tenant_id,professional_id,branch_id,weekday,starts_at,ends_at' }).select('id'));
        }
        dialog.close();
        if (window.SmylSchedule && typeof window.SmylSchedule.reload === 'function') window.SmylSchedule.reload();
        await load();
        var feedback = document.getElementById('schedule-feedback');
        if (feedback) feedback.innerHTML = '<div class="schedule-notice" data-tone="success"><span>Horarios creados. Ya puedes agendar citas dentro de ese horario.</span><button type="button">Cerrar</button></div>';
        var close = feedback && feedback.querySelector('button'); if (close) close.onclick = function () { feedback.replaceChildren(); };
      } catch (error) {
        var code = error && error.code, text = String(error && (error.message || error) || '');
        var message = code === '42501' ? 'Tu rol no permite crear horarios. Pide al propietario que active el permiso de Agenda o de Mi clínica.'
          : code === 'PGRST301' ? 'Tu sesión expiró. Vuelve a iniciar sesión y repite la acción.'
          : /traslapa|overlap|23P01/i.test(text) ? 'Alguno de los horarios se traslapa con otro existente. Revisa Disponibilidad.'
          : (text || 'No se pudo crear el horario.');
        notifyIn(dialog, (savedClinic ? 'Se guardó el horario de la clínica, pero no el de los profesionales: ' : '') + message + (savedClinic ? ' Puedes volver a intentarlo: no se duplicará nada.' : ''));
        saving = false; submit.textContent = 'Crear horarios'; submit.disabled = false;
        if (savedClinic) load();
      }
    };
    refresh();
  }

  var STARTER_KEYS = ['diagnostic-initial', 'diagnostic-periodic', 'preventive-prophylaxis', 'restorative-resin-multi', 'surgery-extraction', 'endodontic-root-canal', 'aesthetic-whitening', 'prostho-crown', 'ortho-control', 'emergency-consult'];
  var STARTER_DEFAULT = ['diagnostic-initial', 'diagnostic-periodic', 'preventive-prophylaxis'];
  function catalog() { return window.SmylServiceCatalogModel || null; }
  function saveError(error, savedFirst, what) {
    var code = error && error.code, text = String(error && (error.message || error) || '');
    var message = code === '42501' ? 'Tu rol no permite esta acción. Pide al propietario que active el permiso correspondiente.'
      : code === 'PGRST301' ? 'Tu sesión expiró. Vuelve a iniciar sesión y repite la acción.'
      : code === '23505' ? 'Ya existe un registro con ese nombre. Cierra este diálogo y revisa lo que ya está creado.'
      : (text || 'No se pudo guardar.');
    return (savedFirst ? what + ' ' : '') + message + (savedFirst ? ' Puedes volver a intentarlo: no se duplicará nada.' : '');
  }
  function finish(dialog, text) {
    dialog.close();
    if (window.SmylSchedule && typeof window.SmylSchedule.reload === 'function') window.SmylSchedule.reload();
    return load().then(function () {
      var feedback = document.getElementById('schedule-feedback');
      if (!feedback) return;
      feedback.innerHTML = '<div class="schedule-notice" data-tone="success"><span>' + esc(text) + '</span><button type="button">Cerrar</button></div>';
      var close = feedback.querySelector('button'); if (close) close.onclick = function () { feedback.replaceChildren(); };
    });
  }

  function openServicesWizard() {
    var dialog = dialogEl(), model = catalog();
    if (!dialog || !state.data || !state.can) return;
    if (!model) { var f = document.getElementById('schedule-feedback'); if (f) f.textContent = 'El catálogo de servicios aún no cargó. Recarga la página e inténtalo de nuevo.'; return; }
    var presets = STARTER_KEYS.map(function (k) { return model.presets.filter(function (p) { return p.key === k; })[0]; }).filter(Boolean);
    var existingNames = {}, existingKeys = {};
    state.data.services.forEach(function (sv) { existingNames[norm(sv.name)] = true; if (sv.template_key) existingKeys[sv.template_key] = true; });
    var items = presets.map(function (p) {
      var exists = existingKeys[p.key] || existingNames[norm(p.name)], on = !exists && STARTER_DEFAULT.indexOf(p.key) >= 0 && state.data.services.length === 0;
      return '<label class="schedule-setup-option"' + (exists ? ' data-exists="true"' : '') + '><input type="checkbox" name="preset" value="' + esc(p.key) + '"' + (exists ? ' disabled' : on ? ' checked' : '') + '><span><strong>' + esc(p.name) + '</strong><small>' + p.duration_minutes + ' min' + (exists ? ' · ya existe' : '') + '</small></span></label>';
    }).join('');
    dialog.innerHTML = '<form id="schedule-setup-form"><h2>Servicios iniciales</h2><p>Elige lo que ofreces. Salen del catálogo dental de SMYL; el precio y los datos fiscales los completas después en Servicios y tarifas.</p>' +
      '<fieldset class="schedule-setup-days"><legend>Servicios del catálogo</legend><div class="schedule-setup-options">' + items + '</div></fieldset>' +
      '<label class="schedule-setup-check"><input type="checkbox" name="assign" checked' + (state.can.schedule ? '' : ' disabled') + '><span>Asignarlos a todos los profesionales activos</span></label>' +
      '<section class="schedule-setup-result" data-setup-preview aria-live="polite"></section>' +
      '<div class="schedule-dialog-actions"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" type="submit" data-setup-submit>Crear servicios</button></div></form>';
    dialog.showModal();
    var form = dialog.querySelector('form'), preview = dialog.querySelector('[data-setup-preview]'), submit = dialog.querySelector('[data-setup-submit]'), current = null, saving = false, ids = {};
    function newId() { var id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); }); return id; }
    function selected() { return Array.prototype.map.call(form.querySelectorAll('input[name=preset]:checked'), function (i) { return i.value; }); }
    function refresh() {
      current = planServices(state.data, selected(), presets, { assign: form.elements.assign.checked, newId: function () { return newId(); } }, state.can);
      var parts = [];
      if (!state.can.services) parts.push('<p class="schedule-setup-note" data-tone="warn">Tu rol no puede crear servicios (requiere el permiso de configuración). Pide al propietario que los cree; la asignación a profesionales sí puedes hacerla.</p>');
      if (current.create.length) parts.push('<p class="schedule-setup-note">Se crearán ' + current.create.length + ' servicio' + (current.create.length === 1 ? '' : 's') + ': ' + esc(current.create.map(function (c) { return c.preset.name; }).join(', ')) + '.</p>');
      if (current.existingTargets.length) parts.push('<p class="schedule-setup-note">También se asignarán servicios que ya existen y nadie realiza: ' + esc(current.existingTargets.map(function (t) { return t.name; }).join(', ')) + '.</p>');
      if (current.assignments.length) { var who = {}; current.assignments.forEach(function (a) { who[a.professional] = true; }); parts.push('<p class="schedule-setup-note">Los realizará: ' + esc(Object.keys(who).join(', ')) + '.</p>'); }
      if (!parts.length || (!current.create.length && !current.assignments.length)) parts.push('<p class="schedule-setup-note">No hay nada nuevo que crear con esta selección.</p>');
      preview.innerHTML = parts.join('');
      submit.disabled = saving || (!current.create.length && !current.assignments.length);
      notifyIn(dialog, '');
    }
    form.addEventListener('change', refresh);
    dialog.querySelector('[data-close]').onclick = function () { dialog.close(); };
    form.onsubmit = async function (event) {
      event.preventDefault();
      if (saving) return;
      refresh();
      if (submit.disabled) return;
      saving = true; submit.disabled = true; submit.textContent = 'Creando…';
      var tenant = state.tenant, savedServices = false;
      try {
        var auth = await window.sb.auth.getUser(), actor = auth && auth.data && auth.data.user && auth.data.user.id || null;
        if (current.create.length) {
          var rows = current.create.map(function (c) { var row = model.presetInsert(c.preset, tenant, actor); row.id = c.id; return row; });
          var invalid = rows.map(function (r) { return model.validate(r); }).filter(function (e) { return e.length; })[0];
          if (invalid) throw new Error(invalid[0]);
          await run(window.sb.from('smyl_services').insert(rows).select('id'));
          savedServices = true;
        }
        if (current.assignments.length) {
          await run(window.sb.from('smyl_professional_services').upsert(current.assignments.map(function (a) { return { tenant_id: tenant, professional_id: a.professional_id, service_id: a.service_id }; }), { onConflict: 'tenant_id,professional_id,service_id', ignoreDuplicates: true }).select('service_id'));
        }
        await finish(dialog, current.create.length ? 'Servicios creados y asignados. Completa precio y datos fiscales en Servicios y tarifas.' : 'Servicios asignados a los profesionales.');
      } catch (error) {
        notifyIn(dialog, saveError(error, savedServices, 'Se crearon los servicios, pero no se asignaron a los profesionales:'));
        saving = false; submit.textContent = 'Crear servicios'; submit.disabled = false;
        if (savedServices) load();
      }
    };
    refresh();
  }

  function openRoomsWizard() {
    var dialog = dialogEl();
    if (!dialog || !state.data || !state.can) return;
    dialog.innerHTML = '<form id="schedule-setup-form"><h2>Sillones o consultorios</h2><p>Crea los espacios de las sucursales que aún no tienen ninguno. Con sillones configurados, cada cita debe elegir uno; con ellos la agenda también evita dobles reservas del mismo sillón.</p>' +
      '<div class="schedule-form-grid"><label>Sillones por sucursal<input name="count" type="number" min="1" max="10" step="1" value="1" required></label></div>' +
      '<section class="schedule-setup-result" data-setup-preview aria-live="polite"></section>' +
      '<div class="schedule-dialog-actions"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" type="submit" data-setup-submit>Crear sillones</button></div></form>';
    dialog.showModal();
    var form = dialog.querySelector('form'), preview = dialog.querySelector('[data-setup-preview]'), submit = dialog.querySelector('[data-setup-submit]'), current = [], saving = false;
    function refresh() {
      current = planRooms(state.data, form.elements.count.value);
      var parts = [];
      if (!state.can.clinic) parts.push('<p class="schedule-setup-note" data-tone="warn">Tu rol no puede crear sillones. Pide al propietario que active el permiso de Mi clínica.</p>');
      if (!current.length) parts.push('<p class="schedule-setup-note">Todas las sucursales ya tienen sillones.</p>');
      else { var byBranch = {}; current.forEach(function (r) { (byBranch[r.branch] = byBranch[r.branch] || []).push(r.name); }); parts.push('<p class="schedule-setup-note">Se van a crear:</p><ul class="schedule-setup-preview">' + Object.keys(byBranch).map(function (b) { return '<li><strong>' + esc(b) + '</strong><span>' + esc(byBranch[b].join(', ')) + '</span></li>'; }).join('') + '</ul>'); }
      preview.innerHTML = parts.join('');
      submit.disabled = saving || !state.can.clinic || !current.length;
      notifyIn(dialog, '');
    }
    form.addEventListener('input', refresh);
    dialog.querySelector('[data-close]').onclick = function () { dialog.close(); };
    form.onsubmit = async function (event) {
      event.preventDefault();
      if (saving) return;
      refresh();
      if (submit.disabled) return;
      saving = true; submit.disabled = true; submit.textContent = 'Creando…';
      try {
        var auth = await window.sb.auth.getUser(), actor = auth && auth.data && auth.data.user && auth.data.user.id || null, tenant = state.tenant;
        await run(window.sb.from('smyl_rooms').insert(current.map(function (r) { return { tenant_id: tenant, branch_id: r.branch_id, name: r.name, room_type: 'sillon', created_by: actor }; })).select('id'));
        await finish(dialog, 'Sillones creados. Al agendar, cada cita elegirá uno.');
      } catch (error) {
        notifyIn(dialog, saveError(error, false, ''));
        saving = false; submit.textContent = 'Crear sillones'; submit.disabled = false;
      }
    };
    refresh();
  }

  function watch() {
    var page = document.getElementById('p-agenda');
    if (!page || state.observer) return;
    var schedule = function () { clearTimeout(state.timer); state.timer = setTimeout(function () { if (page.classList.contains('activa')) load(); }, 600); };
    ['schedule-hours-list', 'schedule-services-list'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) new MutationObserver(schedule).observe(node, { childList: true });
    });
    state.observer = true;
  }

  function init() {
    var previous = window.ir;
    if (typeof previous === 'function') {
      window.ir = function (name) {
        var result = previous.apply(this, arguments);
        if (name === 'agenda') { setTimeout(function () { watch(); load(); }, 250); }
        return result;
      };
    }
    window.SmylScheduleSetup = Object.freeze({ reload: load, assess: assess, plan: plan, planServices: planServices, planRooms: planRooms, dayRange: dayRange });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
