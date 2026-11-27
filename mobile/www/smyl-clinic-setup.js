/* SMYL · Puesta en marcha: lista de pasos para que la clínica quede 100 % integrada, con barra de avance.
   Cada paso se verifica solo, con datos reales y de solo lectura (nadie palomea a mano). Dos capas:
   · Inicio (propietario): tarjeta con el avance y UN siguiente paso; se oculta al completar los pasos obligatorios.
   · «Ver todos los pasos»: ventana con la lista agrupada (obligatorios + recomendados). */
(function () {
  'use strict';

  var GROUPS = [
    { id: 'clinic', title: 'Tu clínica' },
    { id: 'team', title: 'Tu equipo' },
    { id: 'services', title: 'Servicios' },
    { id: 'messages', title: 'Mensajes a pacientes' },
    { id: 'flow', title: 'Pacientes y agenda' },
    { id: 'extra', title: 'Recomendados' }
  ];
  // required: cuenta para el 100 %. Los ids hours, patient, whatsapp, template y reminders los usa también Configuración.
  var STEPS = [
    { id: 'branch', group: 'clinic', required: true, title: 'Registra tu sucursal con dirección', hint: 'Para que tus pacientes sepan dónde llegar.', action: 'Agregar sucursal', route: 'clinica' },
    { id: 'hours', group: 'clinic', required: true, title: 'Define tu horario de atención', hint: 'Sin horario, los pacientes no pueden reservar.', action: 'Definir horario', route: 'agenda' },
    { id: 'rooms', group: 'clinic', required: true, title: 'Agrega tus consultorios', hint: 'Los espacios o sillones donde se atiende.', action: 'Agregar consultorio', route: 'clinica' },
    { id: 'professional', group: 'team', required: true, title: 'Pon el horario de tus dentistas', hint: 'Cada dentista necesita sus días y horas para recibir citas.', action: 'Poner horario', route: 'agenda' },
    { id: 'team', group: 'team', required: true, title: 'Da rol y sede a tu equipo', hint: 'Que cada integrante tenga su rol y su sucursal.', action: 'Revisar equipo', route: 'clinica' },
    { id: 'services', group: 'services', required: true, title: 'Agrega tus servicios con precio', hint: 'Los tratamientos con su precio, para cotizar y cobrar.', action: 'Agregar servicios', route: 'precios' },
    { id: 'whatsapp', group: 'messages', required: true, title: 'Conecta WhatsApp', hint: 'Para recibir y responder mensajes de tus pacientes.', action: 'Conectar', route: 'conexiones' },
    { id: 'template', group: 'messages', required: true, title: 'Solicita las plantillas esenciales', hint: 'Las que la Agenda necesita para avisar solos a tus pacientes. Meta debe aprobarlas.', action: 'Solicitar', route: 'plantillas' },
    { id: 'reminders', group: 'messages', required: true, title: 'Activa los recordatorios de cita', hint: 'Configura los avisos para tus pacientes desde la agenda.', action: 'Configurar', route: 'agenda' },
    { id: 'patient', group: 'flow', required: true, title: 'Registra tu primer paciente', hint: 'Crea el expediente con sus datos de contacto.', action: 'Registrar paciente', route: 'pacientes', open: 'patient' },
    { id: 'appointment', group: 'flow', required: true, title: 'Agenda tu primera cita', hint: 'Así ves todo funcionando de principio a fin.', action: 'Agendar cita', route: 'agenda' },
    { id: 'sat', group: 'extra', required: false, title: 'Revisa el IVA y la clave SAT de tus servicios', hint: 'Necesario para poder facturar sin errores.', action: 'Revisar servicios', route: 'precios' },
    { id: 'invoicing', group: 'extra', required: false, title: 'Configura tu facturación', hint: 'Los datos fiscales de la clínica para emitir facturas.', action: 'Configurar', route: 'caja' },
    { id: 'noshow', group: 'extra', required: false, title: 'Activa el seguimiento si no vino', hint: 'Un mensaje automático para reagendar a quien no llegó.', action: 'Activar', route: 'agenda' },
    { id: 'gcal', group: 'extra', required: false, title: 'Conecta Google Calendar', hint: 'Sincroniza la agenda con el calendario de tu dentista.', action: 'Conectar', route: 'agenda' },
    { id: 'ai', group: 'extra', required: false, title: 'Activa la Agenda con IA', hint: 'Que el asistente sugiera horarios libres a tus pacientes.', action: 'Configurar', route: 'agenda' }
  ];
  var REQUIRED = STEPS.filter(function (step) { return step.required; });
  var state = { loading: false, tenant: null, results: null, compliance: null, loadedAt: 0, request: 0, dismissedDay: '', complianceDismissedDay: '', opener: null };

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function route(name) { if (typeof window.ir === 'function') window.ir(name); }
  function isOwner() { return window.miRolEquipo === 'dueño'; }
  // «Ocultar por hoy»: por dispositivo y solo hasta que cambie el día.
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hiddenKey() { return 'smyl_clinic_setup_hidden_' + (window.tenantId || ''); }
  function hiddenToday() { if (state.dismissedDay === today()) return true; try { return window.localStorage.getItem(hiddenKey()) === today(); } catch (_) { return false; } }
  function hideToday() { state.dismissedDay = today(); try { window.localStorage.setItem(hiddenKey(), state.dismissedDay); } catch (_) {} }
  function complianceHiddenKey() { return 'smyl_compliance_nudge_hidden_' + (window.tenantId || ''); }
  function complianceHiddenToday() { if (state.complianceDismissedDay === today()) return true; try { return window.localStorage.getItem(complianceHiddenKey()) === today(); } catch (_) { return false; } }
  function hideComplianceToday() { state.complianceDismissedDay = today(); try { window.localStorage.setItem(complianceHiddenKey(), state.complianceDismissedDay); } catch (_) {} }

  async function count(builder) {
    var result = await Promise.resolve(typeof window.sbTimeout === 'function' ? window.sbTimeout(builder) : builder);
    if (result && result.error) throw result.error;
    if (!result || typeof result.count !== 'number') throw new Error('Conteo no disponible');
    return result.count;
  }
  async function row(builder) {
    var result = await Promise.resolve(typeof window.sbTimeout === 'function' ? window.sbTimeout(builder) : builder);
    if (result && result.error) throw result.error;
    return result ? result.data : null;
  }
  function head(table) { return window.sb.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', window.tenantId); }

  async function sessionToken() {
    var session = await window.sb.auth.getSession();
    var token = session && session.data && session.data.session && session.data.session.access_token;
    if (!token) throw new Error('sin sesión');
    return token;
  }

  // Comparte la lectura en curso entre Inicio y Canales sin persistir nombres ni números.
  var channelRead = null;
  function readChannels() {
    var tenant = window.tenantId, actor = window.miUsuario && window.miUsuario.id;
    if (!tenant || !window.sb) return Promise.reject(new Error('Clínica no disponible'));
    if (channelRead && channelRead.tenant === tenant && channelRead.actor === actor) return channelRead.promise;
    var read = { tenant: tenant, actor: actor };
    channelRead = read;
    read.promise = fetchChannels().then(function (overview) {
      if (window.tenantId !== tenant || (window.miUsuario && window.miUsuario.id) !== actor) throw new Error('Cambió la sesión');
      return overview;
    }).finally(function () { if (channelRead === read) channelRead = null; });
    return read.promise;
  }

  async function fetchChannels() {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response = await fetch(SUPA_URL + '/functions/v1/lana-channels', { headers: { Authorization: 'Bearer ' + await sessionToken(), apikey: SUPA_KEY }, signal: controller.signal });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error('canales');
      if (!Array.isArray(data.channels)) throw new Error('Canales no disponibles');
      var accounts = {};
      data.channels.forEach(function (item) {
        if (!item || !['whatsapp','messenger','instagram'].includes(item.channel) || typeof item.connected !== 'boolean') return;
        accounts[item.channel] = { connected: item.connected, name: item.connected ? String(item.display_name || item.display_phone_number || '') : '' };
      });
      return { accounts: accounts, canManage: data.can_manage === true };
    } finally { clearTimeout(timer); }
  }

  async function templateState() {
    var result = await window.sb.functions.invoke('whatsapp-templates', { body: { action: 'list' } });
    if (result.error) throw result.error;
    if (!result.data || !Array.isArray(result.data.templates)) throw new Error('Plantillas no disponibles');
    var list = result.data.templates;
    // Con el módulo de plantillas sugeridas: el paso se cumple cuando las esenciales de la Agenda están aprobadas.
    var suggest = window.SmylTemplateSuggest;
    if (suggest && typeof suggest.essentialProgress === 'function') {
      var progress = suggest.essentialProgress('agenda', list);
      var note = progress.ready + ' de ' + progress.total + ' aprobadas' + (progress.pending ? ' · ' + progress.pending + ' en revisión de Meta' : '');
      return { state: progress.ready === progress.total ? 'done' : (progress.pending > 0 && progress.missing === 0 ? 'pending' : 'todo'), note: note };
    }
    if (list.some(function (item) { return item.status === 'APPROVED' && item.category === 'UTILITY'; })) return 'done';
    if (list.some(function (item) { return item.status === 'PENDING'; })) return 'pending';
    return 'todo';
  }

  async function reminderState() {
    var data = await row(window.sb.from('smyl_reminder_settings').select('enabled,no_show_enabled').eq('tenant_id', window.tenantId).maybeSingle());
    return { reminders: Boolean(data && data.enabled === true), noShow: Boolean(data && data.no_show_enabled === true) };
  }

  function settle(promise) {
    return promise.then(function (value) { return { ok: true, value: value }; }, function () { return { ok: false }; });
  }
  // Cada lectura se arma dentro de su propia función: si una tabla no existe o falla, solo ese paso queda «sin verificar».
  function guarded(build) { return settle((async function () { return build(); })()); }
  function counted(build) { return guarded(function () { return count(build()); }); }
  function flag(read, test) { return read.ok ? { done: Boolean(test(read.value)) } : { unknown: true }; }

  async function readAll(tenant) {
    var branchCount = counted(function () { return head('smyl_branches').eq('active', true).neq('address_line', ''); });
    var hoursCount = counted(function () { return head('smyl_clinic_hours').eq('active', true); });
    var roomCount = counted(function () { return head('smyl_rooms').eq('active', true); });
    var proHours = counted(function () { return head('smyl_professional_hours').eq('active', true); });
    var staff = counted(function () { return head('camila_usuarios').eq('activo', true).neq('rol', 'dueño'); });
    var memberRoles = counted(function () { return head('smyl_member_roles'); });
    var pricedServices = counted(function () { return head('smyl_services').eq('active', true).gt('reference_price', 0); });
    var allServices = counted(function () { return head('smyl_services').eq('active', true); });
    var taxPending = counted(function () { return head('smyl_services').eq('active', true).eq('tax_treatment', 'pending'); });
    var patients = counted(function () { return head('camila_pacientes'); });
    var appointments = counted(function () { return head('smyl_appointments'); });
    var channels = settle(readChannels());
    var templates = settle(templateState());
    var reminders = settle(reminderState());
    var invoicing = counted(function () { return window.sb.from('smyl_issuer_fiscal_profiles').select('tenant_id', { count: 'exact', head: true }).eq('tenant_id', tenant).eq('fiscal_status', 'reviewed'); });
    var calendar = counted(function () { return head('smyl_google_calendar_connections'); });
    var assistant = guarded(function () { return row(window.sb.from('smyl_ai_scheduling_settings').select('level').eq('tenant_id', tenant).maybeSingle()); });
    var all = await Promise.all([branchCount, hoursCount, roomCount, proHours, staff, memberRoles, pricedServices, allServices, taxPending, patients, appointments, channels, templates, reminders, invoicing, calendar, assistant]);
    var r = { branch: all[0], hours: all[1], rooms: all[2], pro: all[3], staff: all[4], roles: all[5], priced: all[6], services: all[7], tax: all[8], patients: all[9], appts: all[10], channels: all[11], templates: all[12], reminders: all[13], invoicing: all[14], calendar: all[15], assistant: all[16] };
    var results = {
      branch: flag(r.branch, function (n) { return n > 0; }),
      hours: flag(r.hours, function (n) { return n > 0; }),
      rooms: flag(r.rooms, function (n) { return n > 0; }),
      professional: flag(r.pro, function (n) { return n > 0; }),
      // Cada integrante (sin contar al propietario) necesita un rol. Con solo el propietario, el paso ya está listo.
      team: r.staff.ok && r.roles.ok ? { done: r.roles.value >= r.staff.value, note: r.roles.value < r.staff.value ? (r.staff.value - r.roles.value) + (r.staff.value - r.roles.value === 1 ? ' integrante sin rol' : ' integrantes sin rol') : '' } : { unknown: true },
      services: flag(r.priced, function (n) { return n > 0; }),
      whatsapp: r.channels.ok && r.channels.value.accounts.whatsapp ? { done: r.channels.value.accounts.whatsapp.connected } : { unknown: true },
      template: r.templates.ok ? (typeof r.templates.value === 'object' ? { done: r.templates.value.state === 'done', waiting: r.templates.value.state === 'pending', note: r.templates.value.state === 'done' ? '' : r.templates.value.note } : { done: r.templates.value === 'done', waiting: r.templates.value === 'pending' }) : { unknown: true },
      reminders: flag(r.reminders, function (v) { return v.reminders; }),
      patient: flag(r.patients, function (n) { return n > 0; }),
      appointment: flag(r.appts, function (n) { return n > 0; }),
      sat: r.services.ok && r.tax.ok ? { done: r.services.value > 0 && r.tax.value === 0, note: r.tax.value > 0 ? r.tax.value + (r.tax.value === 1 ? ' servicio por revisar' : ' servicios por revisar') : '' } : { unknown: true },
      invoicing: flag(r.invoicing, function (n) { return n > 0; }),
      noshow: flag(r.reminders, function (v) { return v.noShow; }),
      gcal: flag(r.calendar, function (n) { return n > 0; }),
      ai: flag(r.assistant, function (data) { return Boolean(data && data.level && data.level !== 'off'); })
    };
    return { results: results };
  }

  async function complianceSummary() {
    if (!window.sb || typeof window.sb.rpc !== 'function' || !window.SmylComplianceModel) throw new Error('Cumplimiento no disponible');
    var end = new Date(), start = new Date(end.getTime());
    start.setFullYear(start.getFullYear() - 1);
    var result = await window.sb.rpc('smyl_compliance_overview', {
      p_from: start.toISOString().slice(0, 10),
      p_to: end.toISOString().slice(0, 10)
    });
    if (result && result.error) throw result.error;
    return window.SmylComplianceModel.evaluate(result && result.data, end).summary;
  }

  async function load(force) {
    var tenant = isOwner() ? window.tenantId : null;
    if (tenant !== state.tenant) {
      state.request++; state.tenant = tenant; state.loading = false;
      state.results = null; state.compliance = null; state.loadedAt = 0; state.dismissedDay = ''; state.complianceDismissedDay = '';
      render();
    }
    if (!tenant || !window.sb || state.loading) return render();
    if (!force && state.results && Date.now() - state.loadedAt < 60000) return render();
    var request = ++state.request;
    state.loading = true;
    try {
      var reads = await Promise.all([readAll(tenant), settle(complianceSummary())]);
      if (request !== state.request || tenant !== window.tenantId || !isOwner()) return;
      state.results = reads[0].results;
      state.compliance = reads[1].ok ? reads[1].value : null;
      state.loadedAt = Date.now();
    } finally { if (request === state.request) { state.loading = false; render(); } }
  }

  // ── Resumen: avance de los pasos obligatorios y siguiente paso ──
  function summary(results) {
    var done = REQUIRED.filter(function (step) { return results[step.id] && results[step.id].done; }).length;
    var next = REQUIRED.find(function (step) { var r = results[step.id]; return r && !r.done && !r.waiting && !r.unknown; })
      || REQUIRED.find(function (step) { var r = results[step.id]; return r && !r.done; });
    return {
      total: REQUIRED.length, done: done, percent: Math.round(done / REQUIRED.length * 100), next: next || null,
      uncertain: REQUIRED.some(function (step) { return results[step.id] && results[step.id].unknown; })
    };
  }

  function stepHint(step, result) {
    if (result.unknown) return 'No pudimos verificarlo ahora. Ábrelo para revisar.';
    if (step.id === 'template' && result.waiting) return 'Meta está revisando tu solicitud.';
    return result.note ? result.note + ' · ' + step.hint : step.hint;
  }
  function go(step) {
    // Plantillas esenciales: se piden en bloque desde aquí (el propietario confirma una vez). Si no se puede, se lleva a Plantillas.
    if (step.id === 'template' && window.SmylTemplateSuggest && window.SmylTemplates && typeof window.SmylTemplates.requestMany === 'function') {
      Promise.resolve(window.SmylTemplates.requestMany(window.SmylTemplateSuggest.essentialsOf('agenda'))).then(function (outcome) {
        if (outcome && (outcome.requested.length || outcome.failed || outcome.cancelled)) load(true); else route(step.route);
      }, function () { route(step.route); });
      return;
    }
    route(step.route);
    if (step.open === 'patient') setTimeout(function () { if (typeof window.abrirModalPaciente === 'function') window.abrirModalPaciente(); }, 0);
  }

  function bar(info, label) {
    var wrap = el('div', 'setup-bar'); wrap.setAttribute('role', 'progressbar');
    wrap.setAttribute('aria-valuemin', '0'); wrap.setAttribute('aria-valuemax', '100'); wrap.setAttribute('aria-valuenow', String(info.percent));
    wrap.setAttribute('aria-label', label || 'Avance de la puesta en marcha');
    var fill = el('span', 'setup-bar-fill'); fill.style.width = info.percent + '%';
    wrap.append(fill); return wrap;
  }

  // ── Tarjeta de Inicio ──
  function createCard(host) {
    var section = el('section', 'clinic-setup'); section.id = 'smyl-clinic-setup';
    section.setAttribute('aria-labelledby', 'clinic-setup-title');
    host.append(section);
    return section;
  }

  function renderCard(host, results, info) {
    var section = document.getElementById('smyl-clinic-setup') || createCard(host);
    section.replaceChildren();
    var top = el('div', 'setup-top');
    var title = el('h2', 'setup-title', 'Puesta en marcha'); title.id = 'clinic-setup-title';
    var dismiss = el('button', 'setup-dismiss', 'Ocultar por hoy'); dismiss.type = 'button';
    dismiss.onclick = function () {
      var before = Array.from(host.querySelectorAll('button:not(:disabled)')).filter(function (button) { return !section.contains(button) && button.getClientRects().length; });
      hideToday(); render();
      if (before.length) before[before.length - 1].focus();
    };
    top.append(title, dismiss);
    var meter = el('div', 'setup-meter');
    var pct = el('strong', 'setup-percent', info.percent + ' %');
    var track = el('div', 'setup-meter-track'); track.append(bar(info));
    track.append(el('small', '', info.done + ' de ' + info.total + (info.uncertain ? ' verificados' : ' pasos listos')));
    meter.append(pct, track);
    section.append(top, meter);
    if (info.next) {
      var result = results[info.next.id];
      var next = el('div', 'setup-next'); next.dataset.state = result.waiting ? 'waiting' : result.unknown ? 'unknown' : 'todo';
      var copy = el('div', 'setup-next-copy');
      copy.append(el('span', 'setup-eyebrow', result.waiting ? 'En revisión' : 'Siguiente paso'), el('strong', '', info.next.title), el('small', '', stepHint(info.next, result)));
      var action = el('button', 'setup-action setup-action-primary', info.next.action); action.type = 'button';
      action.onclick = function () { go(info.next); };
      next.append(copy, action); section.append(next);
    }
    var all = el('button', 'setup-all', 'Ver todos los pasos'); all.type = 'button';
    all.append(el('span', 'setup-chevron'));
    all.onclick = function () { openDialog(all); };
    section.append(all);
  }

  // ── Ventana con la lista completa ──
  function stepRow(step, result, isNext) {
    var item = el('li', 'setup-step'); item.dataset.step = step.id;
    item.dataset.done = String(Boolean(result.done)); item.dataset.next = String(Boolean(isNext));
    var mark = el('span', 'setup-mark'); mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', result.done ? 'Completado' : result.unknown ? 'Sin verificar' : result.waiting ? 'En revisión' : 'Pendiente');
    mark.textContent = result.done ? '✓' : '';
    var copy = el('div', 'setup-step-copy');
    copy.append(el('strong', '', step.title));
    if (!result.done) copy.append(el('small', '', stepHint(step, result)));
    item.append(mark, copy);
    if (!result.done) {
      var button = el('button', 'setup-action', step.action); button.type = 'button';
      button.onclick = function () { var dialog = document.getElementById('smyl-setup-dialog'); if (dialog && dialog.open) dialog.close(); go(step); };
      item.append(button);
    }
    return item;
  }

  function renderDialog(dialog) {
    var results = state.results; if (!results) return;
    var info = summary(results);
    dialog.replaceChildren();
    var card = el('div', 'setup-dialog-card');
    var header = el('header', 'setup-dialog-head');
    var title = el('h2', '', 'Puesta en marcha'); title.id = 'setup-dialog-title';
    var close = el('button', 'setup-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Cerrar');
    close.onclick = function () { dialog.close(); };
    header.append(title, close);
    var meter = el('div', 'setup-meter');
    meter.append(el('strong', 'setup-percent', info.percent + ' %'));
    var track = el('div', 'setup-meter-track'); track.append(bar(info));
    track.append(el('small', '', info.done === info.total ? '¡Tu clínica está lista! Todo lo obligatorio está completo.' : info.done + ' de ' + info.total + ' pasos obligatorios listos'));
    meter.append(track);
    var body = el('div', 'setup-dialog-body');
    GROUPS.forEach(function (group) {
      var steps = STEPS.filter(function (step) { return step.group === group.id; });
      if (!steps.length) return;
      var section = el('section', 'setup-group'); section.dataset.group = group.id;
      var doneCount = steps.filter(function (step) { return results[step.id] && results[step.id].done; }).length;
      var heading = el('h3', 'setup-group-title');
      heading.append(el('span', '', group.title), el('small', '', group.id === 'extra' ? 'No cuentan para el 100 %' : doneCount + ' de ' + steps.length));
      var list = el('ol', 'setup-steps');
      steps.forEach(function (step) { list.append(stepRow(step, results[step.id] || { unknown: true }, info.next && info.next.id === step.id)); });
      section.append(heading, list); body.append(section);
    });
    card.append(header, meter, body); dialog.append(card);
  }

  function openDialog(opener) {
    if (!state.results) return;
    var dialog = document.getElementById('smyl-setup-dialog');
    if (!dialog) {
      dialog = el('dialog', 'setup-dialog'); dialog.id = 'smyl-setup-dialog'; dialog.setAttribute('aria-labelledby', 'setup-dialog-title');
      dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close', function () { var back = state.opener; state.opener = null; if (back && back.isConnected) back.focus(); });
      document.body.append(dialog);
    }
    state.opener = opener || null;
    renderDialog(dialog);
    if (!dialog.open) dialog.showModal();
    var first = dialog.querySelector('.setup-close'); if (first) first.focus();
  }

  function createComplianceNudge(host) {
    var section = el('section', 'clinic-compliance-nudge'); section.id = 'smyl-compliance-nudge';
    var copy = el('div', 'clinic-compliance-copy');
    copy.append(el('span', 'clinic-compliance-kicker', 'CUMPLIMIENTO DE LA CLÍNICA'), el('strong', 'clinic-compliance-title'), el('small', 'clinic-compliance-next'));
    var meter = el('span', 'clinic-compliance-meter'); meter.append(el('i'));
    var action = el('button', 'clinic-compliance-action', 'Continuar'); action.type = 'button';
    action.onclick = function () { route('cumplimiento'); };
    var dismiss = el('button', 'clinic-compliance-dismiss', 'Ocultar por hoy'); dismiss.type = 'button';
    dismiss.onclick = function () { hideComplianceToday(); render(); };
    section.append(copy, meter, action, dismiss); host.append(section); return section;
  }

  function renderCompliance(host) {
    var existing = document.getElementById('smyl-compliance-nudge');
    var report = state.tenant === window.tenantId ? state.compliance : null;
    if (!host || !isOwner() || !report || !report.pending || complianceHiddenToday()) { if (existing) existing.remove(); return; }
    var section = existing || createComplianceNudge(host);
    var next = report.pendingRows && report.pendingRows[0];
    var pct = report.total ? Math.round(report.ok * 100 / report.total) : 0;
    section.querySelector('.clinic-compliance-title').textContent = report.ok + ' de ' + report.total + ' requisitos al día';
    section.querySelector('.clinic-compliance-next').textContent = next ? 'Siguiente prioridad: ' + next.title : 'Revisa la documentación pendiente.';
    section.querySelector('.clinic-compliance-meter i').style.width = pct + '%';
    section.querySelector('.clinic-compliance-meter').setAttribute('aria-label', pct + '% de avance documental');
  }

  function render() {
    var host = document.getElementById('smyl-daily-home');
    var existing = document.getElementById('smyl-clinic-setup');
    renderCompliance(host);
    var results = state.tenant === window.tenantId && state.results;
    var info = results ? summary(results) : null;
    var dialog = document.getElementById('smyl-setup-dialog');
    if (dialog && dialog.open && results) renderDialog(dialog);
    if (!host || !isOwner() || !results || info.done >= info.total || hiddenToday()) {
      if (existing) existing.remove();
      return;
    }
    renderCard(host, results, info);
  }

  function init() {
    var previous = window.ir;
    if (typeof previous === 'function') {
      window.ir = function (name) {
        var result = previous.apply(this, arguments);
        if (name === 'dashboard') load(true);
        return result;
      };
    }
    window.SmylClinicSetup = Object.freeze({
      readChannels: readChannels,
      reload: function () { return load(true); },
      results: function () { return isOwner() && state.tenant === window.tenantId ? state.results : null; },
      summary: function () { return isOwner() && state.tenant === window.tenantId && state.results ? summary(state.results) : null; },
      open: function (opener) { return load(false).then(function () { openDialog(opener); }); }
    });
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (document.getElementById('smyl-daily-home') && window.tenantId) { clearInterval(timer); load(false); }
      else if (tries > 40) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
