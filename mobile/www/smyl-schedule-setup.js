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
    var steps = [
      { id: 'branch', title: 'Una sucursal activa', done: branches.length > 0, detail: 'Agrégala en Mi clínica.' },
      { id: 'clinicHours', title: 'Horario de atención de la clínica', done: branches.length > 0 && !missingClinic.length, detail: 'Falta en: ' + names(missingClinic, 'name') + '.', needsHours: true },
      { id: 'professional', title: 'Un profesional asignado a una sucursal', done: professionals.length > 0, detail: 'Agrégalo o asígnalo en Mi clínica.' },
      { id: 'professionalHours', title: 'Horario de cada profesional', done: professionals.length > 0 && !missingProfessional.length, detail: 'Falta para: ' + names(missingProfessional, 'display_name') + '.', needsHours: true },
      { id: 'services', title: 'Un servicio con profesional asignado', done: assigned, detail: 'Créalo y asígnalo en Servicios y disponibilidad.' }
    ];
    return { steps: steps, ready: steps.every(function (s) { return s.done; }), missingClinic: missingClinic, missingProfessional: missingProfessional };
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
  function route(name) { if (typeof window.ir === 'function') window.ir(name); }
  function openSettingsTab() { var tab = document.querySelector('[data-schedule-tab="settings"]'); if (tab) tab.click(); }

  async function permissions(tenant) {
    var ask = function (permission) { return settle(window.sb.rpc('smyl_has_permission', { p_tenant_id: tenant, p_permission: permission })); };
    var rows = await Promise.all([ask('schedule.manage'), ask('clinic.manage')]);
    return { schedule: rows[0].ok && rows[0].value && rows[0].value.data === true, clinic: rows[1].ok && rows[1].value && rows[1].value.data === true };
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
        settle(run(t('smyl_services', 'id', active))),
        settle(run(t('smyl_clinic_hours', 'branch_id,weekday,starts_at,ends_at', active))),
        settle(run(t('smyl_professional_hours', 'professional_id,branch_id,weekday', active))),
        permissions(tenant)
      ]);
      if (state.tenant !== null && state.tenant !== tenant) state.data = null;
      state.tenant = tenant;
      if (rows.slice(0, 7).some(function (r) { return !r.ok; })) { state.data = null; state.assessed = null; return; }
      state.data = {
        branches: rows[0].value || [], professionals: rows[1].value || [], professionalBranches: rows[2].value || [],
        professionalServices: rows[3].value || [], services: rows[4].value || [], clinicHours: rows[5].value || [], professionalHours: rows[6].value || []
      };
      state.can = rows[7];
      state.assessed = assess(state.data);
    } finally { state.loading = false; render(); }
  }

  function render() {
    var page = document.getElementById('p-agenda');
    var existing = document.getElementById('schedule-setup');
    if (!page || !state.assessed || !state.can || !state.can.schedule || state.assessed.ready) { if (existing) existing.remove(); return; }
    var feedback = document.getElementById('schedule-feedback');
    if (!feedback) return;
    var a = state.assessed, done = a.steps.filter(function (s) { return s.done; }).length;
    var section = existing || el('section', 'schedule-setup');
    section.id = 'schedule-setup'; section.setAttribute('aria-labelledby', 'schedule-setup-title');
    section.innerHTML = '';
    var head = el('header', 'schedule-setup-head'), copy = el('div', 'schedule-setup-copy');
    copy.append(el('span', 'schedule-setup-eyebrow', 'PUESTA EN MARCHA'));
    var title = el('h2', '', 'Prepara tu Agenda para recibir citas'); title.id = 'schedule-setup-title';
    copy.append(title, el('p', '', done + ' de ' + a.steps.length + ' pasos listos. Mientras falte alguno, la Agenda rechaza las citas.'));
    var bar = el('div', 'schedule-setup-bar'); bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(a.steps.length)); bar.setAttribute('aria-valuenow', String(done));
    var fill = el('i'); fill.style.width = Math.round(done * 100 / a.steps.length) + '%'; bar.append(fill);
    head.append(copy, bar); section.append(head);

    var list = el('ol', 'schedule-setup-steps'), firstPending = a.steps.filter(function (s) { return !s.done; })[0];
    a.steps.forEach(function (step) {
      var item = el('li', 'schedule-setup-step'); item.dataset.done = String(step.done); item.dataset.next = String(step === firstPending);
      item.append(el('span', 'schedule-setup-mark', step.done ? '✓' : ''));
      var text = el('div', 'schedule-setup-text'); text.append(el('strong', '', step.title));
      if (!step.done) text.append(el('small', '', step.detail));
      item.append(text);
      if (!step.done) {
        var button = el('button', 'schedule-setup-action', step.needsHours ? 'Crear horario' : step.id === 'services' ? 'Ir a Servicios' : 'Ir a Mi clínica'); button.type = 'button';
        button.onclick = function () { if (step.needsHours) openWizard(); else if (step.id === 'services') openSettingsTab(); else route('clinica'); };
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
    window.SmylScheduleSetup = Object.freeze({ reload: load, assess: assess, plan: plan, dayRange: dayRange });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
