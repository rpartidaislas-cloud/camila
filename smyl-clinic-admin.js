/* SMYL · Etapa 8: preparación operativa de clínica, sucursales, espacios y equipo. */
(function () {
  'use strict';

  var DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var ROOM_TYPES = {
    consultorio: 'Consultorio', sillon: 'Sillón dental', quirofano: 'Quirófano',
    rayos_x: 'Rayos X', esterilizacion: 'Esterilización', otro: 'Otro'
  };
  var PERMISSION_LABELS = {
    'clinic.read': 'Consultar clínica', 'clinic.manage': 'Configurar clínica',
    'team.read': 'Consultar equipo', 'team.manage': 'Gestionar profesionales', 'audit.read': 'Consultar auditoría',
    'patients.read': 'Consultar pacientes', 'patients.manage': 'Gestionar pacientes',
    'schedule.read': 'Consultar agenda', 'schedule.manage': 'Gestionar agenda',
    'clinical.read': 'Consultar expediente', 'clinical.write': 'Registrar atención',
    'clinical.approve': 'Aprobar decisiones clínicas',
    'proposal.read': 'Consultar cotizaciones', 'proposal.write': 'Preparar cotizaciones',
    'proposal.approve': 'Aprobar cotizaciones', 'proposal.followup': 'Dar seguimiento a cotizaciones',
    'messages.read': 'Consultar mensajes', 'messages.respond': 'Responder pacientes',
    'messages.manage': 'Organizar chat y asistente',
    'finance.read': 'Consultar finanzas', 'finance.manage': 'Gestionar cobros',
    'inventory.read': 'Consultar inventario', 'inventory.manage': 'Gestionar inventario',
    'settings.manage': 'Administrar configuración'
  };
  var PERMISSION_GROUPS = [
    { name: 'Clínica y equipo', keys: ['clinic.read', 'clinic.manage', 'team.read', 'team.manage', 'audit.read', 'settings.manage'] },
    { name: 'Pacientes y atención', keys: ['patients.read', 'patients.manage', 'clinical.read', 'clinical.write', 'clinical.approve'] },
    { name: 'Agenda', keys: ['schedule.read', 'schedule.manage'] },
    { name: 'Cotizaciones', keys: ['proposal.read', 'proposal.write', 'proposal.approve', 'proposal.followup'] },
    { name: 'Mensajes', keys: ['messages.read', 'messages.respond', 'messages.manage'] },
    { name: 'Caja e inventario', keys: ['finance.read', 'finance.manage', 'inventory.read', 'inventory.manage'] }
  ];
  var DATA_SCOPES = {
    own: 'Solo propio', care_team: 'Equipo tratante', branches: 'Sucursales asignadas', clinic: 'Toda la clínica'
  };
  var SCOPE_GROUPS = [
    { key: 'patients', label: 'Pacientes' }, { key: 'schedule', label: 'Agenda' },
    { key: 'clinical', label: 'Expediente clínico' }, { key: 'messages', label: 'Mensajes' },
    { key: 'finance', label: 'Finanzas' }
  ];
  var state = {
    tenant: null, actor: null, loading: false, loaded: false, mutating: false,
    tab: 'operacion', selectedBranch: null, branches: [], rooms: [], hours: [],
    users: [], roles: [], permissions: [], roleScopes: [], memberRoles: [], memberBranches: [],
    professionals: [], professionalBranches: [], invitations: [], canClinic: false, canTeam: false,
    canAssignRoles: false
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function navButton(text, route) {
    var button = el('button', 'nav-item', text);
    button.type = 'button';
    button.setAttribute('onclick', "ir('" + route + "')");
    return button;
  }

  function errorMessage(error) {
    var message = error && (error.message || error.error_description || error.error);
    if (!message) return 'No se pudo completar la operación.';
    if (/traslapa/i.test(message)) return 'Ese horario se cruza con otro bloque activo.';
    if (/duplicate|unique|23505/i.test(message)) return 'Ya existe un registro activo con esos datos.';
    if (/permission|permiso|42501|row-level/i.test(message)) return 'Tu rol no permite realizar esta acción.';
    return String(message).replace(/^Error:\s*/i, '');
  }

  async function query(builder) {
    var response = await (typeof window.sbTimeout === 'function' ? window.sbTimeout(builder) : builder);
    if (response && response.error) throw response.error;
    return response ? response.data : null;
  }

  function feedback(message, tone) {
    var host = document.getElementById('clinic-admin-feedback');
    if (!host) return;
    host.replaceChildren();
    if (!message) return;
    var notice = el('div', 'clinic-admin-notice');
    if (tone) notice.dataset.tone = tone;
    notice.append(el('span', '', message));
    var close = el('button', '', 'Cerrar');
    close.type = 'button';
    close.addEventListener('click', function () { host.replaceChildren(); });
    notice.append(close); host.append(notice);
  }

  function initials(name) {
    return String(name || 'SM').trim().split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0).toUpperCase();
    }).join('') || 'SM';
  }

  function timeLabel(value) {
    return String(value || '').slice(0, 5);
  }

  function selectedBranch() {
    return state.branches.find(function (branch) { return branch.id === state.selectedBranch; }) || null;
  }

  function roleFor(userId) {
    var assignment = state.memberRoles.find(function (row) { return row.user_id === userId; });
    return assignment ? state.roles.find(function (role) { return role.id === assignment.role_id; }) : null;
  }

  function branchForMember(userId) {
    var assignment = state.memberBranches.find(function (row) {
      return row.user_id === userId && row.is_primary;
    });
    return assignment ? state.branches.find(function (branch) { return branch.id === assignment.branch_id; }) : null;
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function memberByEmail(email) {
    var normalized = normalizeEmail(email);
    return state.users.find(function (user) { return normalizeEmail(user.email) === normalized; }) || null;
  }

  function professionalForMember(userId) {
    return state.professionals.find(function (professional) {
      return professional.active && professional.user_id === userId;
    }) || null;
  }

  function roleByCode(code) {
    return state.roles.find(function (role) { return role.active && role.code === code; }) || null;
  }

  function branchReadiness(branch) {
    var rooms = state.rooms.filter(function (row) { return row.active && row.branch_id === branch.id; });
    var hours = state.hours.filter(function (row) { return row.active && row.branch_id === branch.id; });
    return {
      rooms: rooms.length,
      blocks: hours.length,
      weekdays: new Set(hours.map(function (row) { return row.weekday; })).size,
      ready: rooms.length > 0 && hours.length > 0
    };
  }

  function readinessSnapshot() {
    var branches = state.branches.filter(function (row) { return row.active; });
    var incompleteBranches = branches.filter(function (branch) { return !branchReadiness(branch).ready; });
    var staff = state.users.filter(function (row) { return row.activo; });
    var staffMissingRole = staff.filter(function (row) { return row.rol !== 'dueño' && !roleFor(row.id); });
    var staffMissingBranch = staff.filter(function (row) { return !branchForMember(row.id); });
    var professionals = state.professionals.filter(function (row) { return row.active; });
    var professionalIds = new Set(state.professionalBranches.map(function (row) { return row.professional_id; }));
    var professionalsMissingBranch = professionals.filter(function (row) { return !professionalIds.has(row.id); });
    var checks = [
      { key: 'branches', title: 'Sucursal activa', detail: branches.length ? branches.length + (branches.length === 1 ? ' sede disponible' : ' sedes disponibles') : 'Crea la primera sede de atención', done: branches.length > 0, tab: 'operacion' },
      { key: 'operations', title: 'Espacios y horarios', detail: incompleteBranches.length ? incompleteBranches.length + (incompleteBranches.length === 1 ? ' sede requiere atención' : ' sedes requieren atención') : 'Todas las sedes tienen espacio y horario', done: branches.length > 0 && incompleteBranches.length === 0, tab: 'operacion', branch: incompleteBranches[0] && incompleteBranches[0].id },
      { key: 'professionals', title: 'Profesionales en agenda', detail: !professionals.length ? 'Registra al menos un profesional' : (professionalsMissingBranch.length ? professionalsMissingBranch.length + ' sin sede asignada' : professionals.length + ' con cobertura de sede'), done: professionals.length > 0 && professionalsMissingBranch.length === 0, tab: 'equipo' },
      { key: 'team', title: 'Equipo con responsabilidades', detail: staffMissingRole.length || staffMissingBranch.length ? (staffMissingRole.length + ' sin rol · ' + staffMissingBranch.length + ' sin sede') : staff.length + ' integrantes configurados', done: staff.length > 0 && !staffMissingRole.length && !staffMissingBranch.length, tab: 'equipo' }
    ];
    var completed = checks.filter(function (row) { return row.done; }).length;
    return { checks: checks, completed: completed, percent: Math.round((completed / checks.length) * 100), incompleteBranches: incompleteBranches, staffMissingRole: staffMissingRole, staffMissingBranch: staffMissingBranch, professionalsMissingBranch: professionalsMissingBranch };
  }

  function calculateCapabilities() {
    var owner = window.miRolEquipo === 'dueño';
    var assignments = state.memberRoles.filter(function (row) { return row.user_id === state.actor; });
    var roleIds = new Set(assignments.map(function (row) { return row.role_id; }));
    var permissions = new Set(state.permissions.filter(function (row) {
      return roleIds.has(row.role_id);
    }).map(function (row) { return row.permission_key; }));
    state.canClinic = owner || permissions.has('clinic.manage');
    state.canTeam = owner || permissions.has('team.manage');
    state.canAssignRoles = owner || permissions.has('team.manage');
  }

  function renderMetrics() {
    var host = document.getElementById('clinic-admin-metrics');
    if (!host) return;
    var branchCount = state.branches.filter(function (row) { return row.active; }).length;
    var roomCount = state.rooms.filter(function (row) { return row.active; }).length;
    var memberCount = state.users.filter(function (row) { return row.activo; }).length;
    var coverage = new Set(state.hours.filter(function (row) { return row.active; }).map(function (row) {
      return row.branch_id + ':' + row.weekday;
    })).size;
    host.innerHTML = [
      ['Sucursales', branchCount, branchCount === 1 ? 'Sede operativa' : 'Sedes operativas'],
      ['Espacios clínicos', roomCount, 'Sillones y consultorios'],
      ['Equipo activo', memberCount, state.professionals.filter(function (row) { return row.active; }).length + ' profesionales en agenda'],
      ['Cobertura semanal', coverage, 'Días configurados por sede']
    ].map(function (item) {
      return '<article class="clinic-admin-metric"><span>' + item[0] + '</span><strong>' + item[1] + '</strong><small>' + esc(item[2]) + '</small></article>';
    }).join('');
  }

  function renderReadiness() {
    var host = document.getElementById('clinic-admin-readiness');
    if (!host) return;
    var snapshot = readinessSnapshot();
    host.innerHTML = '<div class="clinic-admin-readiness-summary"><span class="pro-eyebrow">PREPARACIÓN OPERATIVA</span><div class="clinic-admin-readiness-score"><strong>' + snapshot.percent + '%</strong><span>' + snapshot.completed + ' de ' + snapshot.checks.length + ' áreas listas</span></div><div class="clinic-admin-progress" aria-label="' + snapshot.percent + '% de preparación operativa"><i style="width:' + snapshot.percent + '%"></i></div><p>Completa la configuración mínima para coordinar agenda, espacios y responsables con menos improvisación.</p></div><div class="clinic-admin-checklist">' + snapshot.checks.map(function (item) {
      return '<button type="button" class="clinic-admin-check" data-ca-readiness="' + item.key + '" data-ca-tab-target="' + item.tab + '"' + (item.branch ? ' data-ca-branch-target="' + item.branch + '"' : '') + '><span class="clinic-admin-check-icon" data-ready="' + item.done + '">' + (item.done ? '✓' : '!') + '</span><span><strong>' + esc(item.title) + '</strong><small>' + esc(item.detail) + '</small></span><b>' + (item.done ? 'Listo' : 'Revisar') + '</b></button>';
    }).join('') + '</div><p class="clinic-admin-readiness-note">Este indicador refleja únicamente la configuración visible en SMYL; no sustituye validaciones clínicas, laborales, fiscales ni sanitarias.</p>';
    host.querySelectorAll('[data-ca-readiness]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.dataset.caBranchTarget) state.selectedBranch = button.dataset.caBranchTarget;
        setTab(button.dataset.caTabTarget);
        if (state.tab === 'operacion') renderOperations(); else renderTeam();
        var target = document.querySelector('.clinic-admin-tabs');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderBranches() {
    var list = document.getElementById('clinic-admin-branch-list');
    if (!list) return;
    list.replaceChildren();
    var branches = state.branches.filter(function (branch) { return branch.active; });
    if (!branches.length) {
      list.append(el('div', 'clinic-admin-empty', 'No hay sucursales activas.'));
      return;
    }
    branches.forEach(function (branch) {
      var readiness = branchReadiness(branch);
      var button = el('button', 'clinic-admin-branch');
      button.type = 'button'; button.dataset.branchId = branch.id;
      button.setAttribute('aria-current', String(branch.id === state.selectedBranch));
      var subtitle = [branch.city || 'Ubicación pendiente', branch.is_default ? 'Principal' : 'Sucursal'].join(' · ');
      button.innerHTML = '<strong>' + esc(branch.name) + '</strong><small><i class="clinic-admin-dot" data-ready="' + readiness.ready + '"></i>' + esc(subtitle) + '</small><span class="clinic-admin-branch-state" data-ready="' + readiness.ready + '">' + (readiness.ready ? 'Lista para agenda' : 'Por completar') + '</span>';
      button.addEventListener('click', function () { state.selectedBranch = branch.id; renderOperations(); });
      list.append(button);
    });
  }

  function branchForm(branch) {
    var disabled = state.canClinic ? '' : ' disabled';
    return '<form id="clinic-admin-branch-form">' +
      '<div class="clinic-admin-form-grid">' +
        '<div class="clinic-admin-field"><label for="ca-branch-name">Nombre de la sucursal</label><input id="ca-branch-name" name="name" maxlength="100" required value="' + esc(branch.name) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-phone">Teléfono</label><input id="ca-branch-phone" name="phone" type="tel" maxlength="40" value="' + esc(branch.phone) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-branch-address">Dirección</label><input id="ca-branch-address" name="address_line" maxlength="180" value="' + esc(branch.address_line) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-city">Ciudad</label><input id="ca-branch-city" name="city" maxlength="90" value="' + esc(branch.city) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-state">Estado</label><input id="ca-branch-state" name="state" maxlength="90" value="' + esc(branch.state) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-postal">Código postal</label><input id="ca-branch-postal" name="postal_code" maxlength="16" value="' + esc(branch.postal_code) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-timezone">Zona horaria</label><select id="ca-branch-timezone" name="timezone"' + disabled + '>' +
          ['America/Mexico_City','America/Cancun','America/Monterrey','America/Chihuahua','America/Hermosillo','America/Tijuana'].map(function (zone) {
            return '<option value="' + zone + '"' + (zone === branch.timezone ? ' selected' : '') + '>' + zone.replace('America/', '') + '</option>';
          }).join('') + '</select></div>' +
      '</div>' +
      (state.canClinic ? '<div class="clinic-admin-actions">' +
        (!branch.is_default ? '<button type="button" class="btn btn-secondary" data-ca-default>Hacer principal</button><button type="button" class="btn btn-secondary danger" data-ca-deactivate-branch>Desactivar</button>' : '') +
        '<button type="submit" class="btn btn-primary">Guardar sucursal</button></div>' : '') +
    '</form>';
  }

  function roomSection(branch) {
    var rooms = state.rooms.filter(function (room) { return room.branch_id === branch.id && room.active; });
    var rows = rooms.length ? rooms.map(function (room) {
      return '<div class="clinic-admin-row"><div class="clinic-admin-row-main"><strong>' + esc(room.name) + '</strong><small>' + esc(ROOM_TYPES[room.room_type] || 'Espacio clínico') + (room.exclusive_use ? ' · Uso exclusivo' : ' · Recurso compartido') + '</small></div>' +
        (state.canClinic ? '<button type="button" data-ca-room-off="' + room.id + '">Desactivar</button>' : '') + '</div>';
    }).join('') : '<div class="clinic-admin-empty">Agrega sillones, consultorios o espacios que después podrán reservarse en la agenda.</div>';
    var form = state.canClinic ? '<form id="clinic-admin-room-form" class="clinic-admin-compact-form"><div class="clinic-admin-field"><label for="ca-room-name">Nombre</label><input id="ca-room-name" name="name" maxlength="80" placeholder="Ej. Sillón 1" required></div><div class="clinic-admin-field"><label for="ca-room-type">Tipo</label><select id="ca-room-type" name="room_type">' + Object.keys(ROOM_TYPES).map(function (key) { return '<option value="' + key + '">' + ROOM_TYPES[key] + '</option>'; }).join('') + '</select></div><button class="btn btn-secondary" type="submit">Agregar</button></form>' : '';
    return '<section class="clinic-admin-subsection"><h3>Espacios clínicos</h3><p>Evitan reservar dos citas en el mismo sillón o consultorio.</p><div class="clinic-admin-list">' + rows + '</div>' + form + '</section>';
  }

  function hoursSection(branch) {
    var hours = state.hours.filter(function (row) { return row.branch_id === branch.id && row.active; }).sort(function (a, b) {
      return a.weekday - b.weekday || String(a.starts_at).localeCompare(String(b.starts_at));
    });
    var rows = hours.length ? hours.map(function (row) {
      return '<div class="clinic-admin-row"><div class="clinic-admin-row-main"><strong>' + DAYS[row.weekday] + '</strong><small>' + timeLabel(row.starts_at) + '–' + timeLabel(row.ends_at) + '</small></div>' +
        (state.canClinic ? '<button type="button" data-ca-hour-off="' + row.id + '">Quitar</button>' : '') + '</div>';
    }).join('') : '<div class="clinic-admin-empty">Aún no hay horario de atención. La agenda no ofrecerá disponibilidad hasta configurarlo.</div>';
    var form = state.canClinic ? '<form id="clinic-admin-hours-form" class="clinic-admin-compact-form hours"><div class="clinic-admin-field"><label for="ca-hours-day">Día</label><select id="ca-hours-day" name="weekday">' + DAYS.map(function (day, index) { return '<option value="' + index + '"' + (index === 1 ? ' selected' : '') + '>' + day + '</option>'; }).join('') + '</select></div><div class="clinic-admin-field"><label for="ca-hours-start">Abre</label><input id="ca-hours-start" name="starts_at" type="time" value="09:00" required></div><div class="clinic-admin-field"><label for="ca-hours-end">Cierra</label><input id="ca-hours-end" name="ends_at" type="time" value="18:00" required></div><button class="btn btn-secondary" type="submit">Agregar</button></form>' : '';
    return '<section class="clinic-admin-subsection"><h3>Horario de atención</h3><p>Puedes crear dos bloques en un día; SMYL impide que se encimen.</p><div class="clinic-admin-list">' + rows + '</div>' + form + '</section>';
  }

  function renderBranchDetail() {
    var host = document.getElementById('clinic-admin-branch-detail');
    if (!host) return;
    var branch = selectedBranch();
    if (!branch) {
      host.innerHTML = '<div class="clinic-admin-card clinic-admin-empty">Selecciona o crea una sucursal.</div>';
      return;
    }
    var readiness = branchReadiness(branch);
    host.innerHTML = '<article class="clinic-admin-card"><div class="clinic-admin-section-head"><div><h2>' + esc(branch.name) + '</h2><p class="clinic-admin-card-intro">Datos operativos de esta sede.</p></div><div class="clinic-admin-badges">' + (branch.is_default ? '<span class="clinic-admin-pill">Sucursal principal</span>' : '') + '<span class="clinic-admin-pill" data-ready="' + readiness.ready + '">' + (readiness.ready ? 'Configuración mínima lista' : 'Configuración pendiente') + '</span></div></div><div class="clinic-admin-branch-overview"><span><strong>' + readiness.rooms + '</strong> espacios activos</span><span><strong>' + readiness.weekdays + '</strong> días con horario</span><span><strong>' + readiness.blocks + '</strong> bloques de atención</span></div>' + branchForm(branch) + '</article>' +
      '<article class="clinic-admin-card">' + roomSection(branch) + hoursSection(branch) + '</article>';
    bindBranchActions(branch);
  }

  function renderOperations() {
    renderBranches(); renderBranchDetail();
  }

  function renderTeam() {
    var members = document.getElementById('clinic-admin-members');
    var professionals = document.getElementById('clinic-admin-professionals');
    if (!members || !professionals) return;
    var activeBranches = state.branches.filter(function (row) { return row.active; });
    members.replaceChildren();
    state.users.forEach(function (user) {
      var currentRole = roleFor(user.id);
      var currentBranch = branchForMember(user.id);
      var professional = professionalForMember(user.id);
      var row = el('article', 'clinic-admin-member');
      row.dataset.active = String(Boolean(user.activo));
      row.append(el('div', 'clinic-admin-avatar', initials(user.nombre || user.email)));
      var meta = el('div', 'clinic-admin-member-meta');
      meta.innerHTML = '<div class="clinic-admin-member-title"><strong>' + esc(user.nombre || user.email || 'Integrante') + '</strong>' +
        (professional ? '<span class="clinic-admin-person-kind">Doctor</span>' : '<span class="clinic-admin-person-kind is-team">Equipo</span>') +
        (!user.activo ? '<span class="clinic-admin-person-kind is-off">Inactivo</span>' : '') + '</div><small>' + esc(user.email || '') + '</small>' +
        (professional ? '<p>' + esc([professional.specialty || 'Odontología general', professional.license_number ? 'Céd. ' + professional.license_number : ''].filter(Boolean).join(' · ')) + '</p>' : '');
      var roleField = el('label', 'clinic-admin-member-field is-role');
      roleField.append(el('span', '', 'Rol'));
      var roleSelect = el('select'); roleSelect.setAttribute('aria-label', 'Rol de ' + (user.nombre || user.email || 'integrante'));
      var availableRoles = state.roles.filter(function (role) { return role.active && (user.rol === 'dueño' ? role.code === 'propietario' : role.code !== 'propietario'); });
      availableRoles.forEach(function (role) { roleSelect.append(new Option(role.name, role.id)); });
      roleSelect.value = currentRole ? currentRole.id : '';
      roleSelect.disabled = !state.canAssignRoles || user.rol === 'dueño' || !user.activo;
      roleSelect.addEventListener('change', function () { setMemberRole(user.id, roleSelect.value); });
      roleField.append(roleSelect);
      var branchField = el('label', 'clinic-admin-member-field is-branch');
      branchField.append(el('span', '', 'Sede principal'));
      var branchSelect = el('select'); branchSelect.setAttribute('aria-label', 'Sede principal de ' + (user.nombre || user.email || 'integrante'));
      branchSelect.append(new Option('Sin sede principal', ''));
      activeBranches.forEach(function (branch) { branchSelect.append(new Option(branch.name, branch.id)); });
      branchSelect.value = currentBranch ? currentBranch.id : '';
      branchSelect.disabled = !state.canClinic || !user.activo || !activeBranches.length;
      branchSelect.addEventListener('change', function () {
        if (branchSelect.value) setMemberBranch(user.id, branchSelect.value); else branchSelect.value = currentBranch ? currentBranch.id : '';
      });
      branchField.append(branchSelect);
      row.append(meta, roleField, branchField);
      if (state.canAssignRoles && user.rol !== 'dueño') {
        var toggle = el('button', 'btn btn-secondary clinic-admin-member-action', user.activo ? 'Desactivar' : 'Reactivar');
        toggle.type = 'button'; toggle.addEventListener('click', function () { toggleMember(user.id, !user.activo); });
        row.append(toggle);
      } else row.append(el('span'));
      members.append(row);
    });
    if (!state.users.length) members.append(el('div', 'clinic-admin-empty', 'Todavía no hay integrantes en la clínica.'));

    professionals.replaceChildren();
    state.professionals.filter(function (row) { return row.active && !row.user_id; }).forEach(function (professional) {
      var row = el('article', 'clinic-admin-professional');
      row.append(el('div', 'clinic-admin-avatar', initials(professional.display_name)));
      var info = el('div');
      var locations = state.professionalBranches.filter(function (item) { return item.professional_id === professional.id; }).map(function (item) {
        var branch = state.branches.find(function (candidate) { return candidate.id === item.branch_id; });
        return branch ? branch.name : '';
      }).filter(Boolean);
      info.innerHTML = '<strong>' + esc(professional.display_name) + '</strong><small>' + esc([professional.specialty || 'Odontología general', professional.license_number ? 'Céd. ' + professional.license_number : '', locations.join(', ')].filter(Boolean).join(' · ')) + '</small><span class="clinic-admin-link-state" data-linked="false">Perfil sin acceso</span>';
      row.append(info);
      if (state.canTeam) {
        var off = el('button', 'btn btn-secondary', 'Desactivar'); off.type = 'button';
        off.addEventListener('click', function () { deactivateProfessional(professional.id); }); row.append(off);
      }
      professionals.append(row);
    });
    state.invitations.filter(function (row) { return row.member_kind === 'professional' && row.status === 'pending'; }).forEach(function (invitation) {
      var pending = el('article', 'clinic-admin-professional is-pending');
      pending.append(el('div', 'clinic-admin-avatar', initials(invitation.display_name)));
      var pendingInfo = el('div');
      var branch = state.branches.find(function (candidate) { return candidate.id === invitation.branch_id; });
      pendingInfo.innerHTML = '<strong>' + esc(invitation.display_name) + '</strong><small>' + esc([invitation.email, invitation.specialty, branch && branch.name].filter(Boolean).join(' · ')) + '</small><span class="clinic-admin-link-state" data-linked="false">Invitación pendiente</span>';
      pending.append(pendingInfo, el('span', 'clinic-admin-invite-expiry', 'Vence ' + new Date(invitation.expires_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })));
      professionals.append(pending);
    });
    if (!professionals.childElementCount) professionals.append(el('div', 'clinic-admin-empty', 'No hay accesos pendientes. Los doctores vinculados aparecen en la lista del equipo.'));

    var professionalButton = document.getElementById('clinic-admin-add-professional');
    if (professionalButton) professionalButton.hidden = !state.canTeam;
    var memberButton = document.getElementById('clinic-admin-add-member');
    if (memberButton) memberButton.hidden = !state.canAssignRoles;
    var roleButton = document.getElementById('clinic-admin-add-role');
    if (roleButton) roleButton.hidden = !state.canAssignRoles;
    renderRoleGuide();
  }

  function renderRoleGuide() {
    var host = document.getElementById('clinic-admin-role-guide');
    if (!host) return;
    var roles = state.roles.filter(function (role) { return role.active; });
    if (!roles.length) {
      host.innerHTML = '<div class="clinic-admin-empty">Los permisos de cada rol aparecerán cuando estén disponibles.</div>';
      return;
    }
    host.innerHTML = roles.map(function (role) {
      var permissions = state.permissions.filter(function (row) { return row.role_id === role.id; }).map(function (row) { return PERMISSION_LABELS[row.permission_key] || row.permission_key; });
      var scopes = state.roleScopes.filter(function (row) { return row.role_id === role.id; });
      var scopeSummary = SCOPE_GROUPS.map(function (group) {
        var item = scopes.find(function (row) { return row.domain === group.key; });
        return '<span title="' + esc(group.label) + '">' + esc(group.label) + ': ' + esc(DATA_SCOPES[item ? item.scope : 'own']) + '</span>';
      }).join('');
      var protectedRole = role.code === 'propietario';
      return '<details class="clinic-admin-role"><summary><span><strong>' + esc(role.name) + '</strong><small>' + esc(role.description || 'Responsabilidades definidas por la clínica') + '</small></span><b>' + permissions.length + ' funciones</b></summary><div class="clinic-admin-role-body"><div><div class="clinic-admin-role-pills">' + (permissions.length ? permissions.map(function (permission) { return '<span>' + esc(permission) + '</span>'; }).join('') : '<small>Sin funciones operativas asignadas.</small>') + '</div><div class="clinic-admin-scope-summary">' + scopeSummary + '</div></div>' + (state.canAssignRoles && !protectedRole ? '<button type="button" class="btn btn-secondary" data-ca-edit-role="' + role.id + '">Editar acceso</button>' : (protectedRole ? '<small class="clinic-admin-protected">Protegido</small>' : '')) + '</div></details>';
    }).join('');
    host.querySelectorAll('[data-ca-edit-role]').forEach(function (button) {
      button.addEventListener('click', function () { openRoleDialog(button.dataset.caEditRole); });
    });
  }

  function openRoleDialog(roleId) {
    if (!state.canAssignRoles) return;
    var role = roleId ? state.roles.find(function (item) { return item.id === roleId; }) : null;
    if (role && role.code === 'propietario') return;
    var enabled = new Set(role ? state.permissions.filter(function (row) { return row.role_id === role.id; }).map(function (row) { return row.permission_key; }) : []);
    var currentScopes = {};
    SCOPE_GROUPS.forEach(function (group) {
      var row = role && state.roleScopes.find(function (item) { return item.role_id === role.id && item.domain === group.key; });
      currentScopes[group.key] = row ? row.scope : 'own';
    });
    var dialog = document.getElementById('clinic-admin-dialog');
    var groups = PERMISSION_GROUPS.map(function (group) {
      return '<fieldset class="clinic-admin-permission-group"><legend>' + esc(group.name) + '</legend><div class="clinic-admin-permission-pills">' + group.keys.map(function (key) {
        return '<label class="clinic-admin-permission-pill"><input type="checkbox" name="permission" value="' + key + '"' + (enabled.has(key) ? ' checked' : '') + '><span>' + esc(PERMISSION_LABELS[key]) + '</span></label>';
      }).join('') + '</div></fieldset>';
    }).join('');
    var scopeFields = SCOPE_GROUPS.map(function (group) {
      return '<label class="clinic-admin-scope-field"><span>' + esc(group.label) + '</span><select name="scope_' + group.key + '">' + Object.keys(DATA_SCOPES).map(function (scope) { return '<option value="' + scope + '"' + (currentScopes[group.key] === scope ? ' selected' : '') + '>' + esc(DATA_SCOPES[scope]) + '</option>'; }).join('') + '</select></label>';
    }).join('');
    dialog.innerHTML = '<form id="clinic-admin-role-form"><div class="clinic-admin-dialog-heading"><div><span class="pro-eyebrow">ACCESO CONFIGURABLE</span><h2>' + (role ? 'Editar rol' : 'Crear nuevo rol') + '</h2></div>' + (role ? '<label class="clinic-admin-active-switch"><input type="checkbox" name="active"' + (role.active ? ' checked' : '') + '><span>Rol activo</span></label>' : '') + '</div><p>Activa las funciones y decide hasta dónde llega cada acceso. Podrás cambiarlo en cualquier momento.</p><div class="clinic-admin-form-grid"><div class="clinic-admin-field"><label for="ca-role-name">Nombre del rol</label><input id="ca-role-name" name="name" maxlength="80" required value="' + esc(role ? role.name : '') + '" placeholder="Ej. Coordinación clínica"></div><div class="clinic-admin-field"><label for="ca-role-description">Descripción</label><input id="ca-role-description" name="description" maxlength="240" value="' + esc(role ? role.description : '') + '" placeholder="Responsabilidades principales"></div></div><section class="clinic-admin-scope-editor"><div><h3>Alcance de la información</h3><p>Elige si este rol trabaja con información propia, del equipo, de sus sucursales o de toda la clínica.</p></div><div class="clinic-admin-scope-grid">' + scopeFields + '</div></section><div class="clinic-admin-role-editor">' + groups + '</div><div class="clinic-admin-role-count" aria-live="polite"></div><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary">Guardar rol</button></div></form>';
    var form = dialog.querySelector('form');
    var count = dialog.querySelector('.clinic-admin-role-count');
    function refreshCount() {
      var total = form.querySelectorAll('input[name="permission"]:checked').length;
      count.textContent = total + (total === 1 ? ' función habilitada' : ' funciones habilitadas');
    }
    form.querySelectorAll('input[name="permission"]').forEach(function (input) { input.addEventListener('change', refreshCount); });
    dialog.querySelector('[data-ca-close]').addEventListener('click', function () { dialog.close(); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var permissions = Array.from(form.querySelectorAll('input[name="permission"]:checked')).map(function (input) { return input.value; });
      var scopes = {};
      SCOPE_GROUPS.forEach(function (group) { scopes[group.key] = String(data.get('scope_' + group.key) || 'own'); });
      var ok = await mutate(function () {
        return query(window.sb.rpc('smyl_save_role_access', {
          p_role_id: role ? role.id : null,
          p_name: String(data.get('name') || '').trim(),
          p_description: String(data.get('description') || '').trim(),
          p_active: role ? data.get('active') === 'on' : true,
          p_permissions: permissions,
          p_scopes: scopes
        }));
      }, role ? 'Rol actualizado.' : 'Rol creado. Ya puedes asignarlo al equipo.');
      if (ok) dialog.close();
    });
    refreshCount(); dialog.showModal(); dialog.querySelector('input[name="name"]').focus();
  }

  function renderAll() {
    renderReadiness(); renderMetrics(); renderOperations(); renderTeam(); setTab(state.tab);
    var branchButton = document.getElementById('clinic-admin-add-branch');
    if (branchButton) branchButton.hidden = !state.canClinic;
  }

  function loadingView() {
    var detail = document.getElementById('clinic-admin-branch-detail');
    if (detail) detail.innerHTML = '<div class="clinic-admin-loading">Cargando la operación de tu clínica…</div>';
  }

  async function load(force) {
    var tenant = window.tenantId;
    if (!tenant || state.loading || (state.loaded && state.tenant === tenant && !force)) return;
    state.loading = true; state.tenant = tenant; loadingView();
    try {
      var auth = await window.sb.auth.getUser();
      state.actor = auth.data && auth.data.user ? auth.data.user.id : null;
      var results = await Promise.all([
        query(window.sb.from('smyl_branches').select('id,tenant_id,name,address_line,city,state,postal_code,phone,timezone,is_default,active,created_at').eq('tenant_id', tenant).order('is_default', { ascending: false }).order('name')),
        query(window.sb.from('smyl_rooms').select('id,tenant_id,branch_id,name,room_type,exclusive_use,active').eq('tenant_id', tenant).order('name')),
        query(window.sb.from('smyl_clinic_hours').select('id,tenant_id,branch_id,weekday,starts_at,ends_at,active').eq('tenant_id', tenant).order('weekday').order('starts_at')),
        query(window.sb.from('camila_usuarios').select('id,tenant_id,rol,nombre,email,activo,created_at').eq('tenant_id', tenant).order('created_at')),
        query(window.sb.from('smyl_roles').select('id,tenant_id,code,name,description,system_role,active').eq('tenant_id', tenant).order('name')),
        query(window.sb.from('smyl_role_permissions').select('role_id,permission_key').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_role_scopes').select('role_id,domain,scope').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_member_roles').select('user_id,role_id').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_member_branches').select('user_id,branch_id,is_primary').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_professionals').select('id,tenant_id,user_id,display_name,specialty,license_number,color_token,active').eq('tenant_id', tenant).order('display_name')),
        query(window.sb.from('smyl_professional_branches').select('professional_id,branch_id').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_staff_invitations').select('id,email,display_name,member_kind,specialty,license_number,branch_id,status,expires_at,invited_at').eq('tenant_id', tenant).in('status', ['pending', 'accepted']).order('invited_at', { ascending: false }))
      ]);
      if (tenant !== window.tenantId) return;
      state.branches = results[0] || []; state.rooms = results[1] || []; state.hours = results[2] || [];
      state.users = results[3] || []; state.roles = results[4] || []; state.permissions = results[5] || [];
      state.roleScopes = results[6] || []; state.memberRoles = results[7] || []; state.memberBranches = results[8] || [];
      state.professionals = results[9] || []; state.professionalBranches = results[10] || []; state.invitations = results[11] || [];
      var active = state.branches.filter(function (row) { return row.active; });
      if (!active.some(function (row) { return row.id === state.selectedBranch; })) {
        var defaultBranch = active.find(function (row) { return row.is_default; });
        state.selectedBranch = defaultBranch ? defaultBranch.id : (active[0] && active[0].id);
      }
      calculateCapabilities(); state.loaded = true; renderAll();
    } catch (error) {
      feedback('No se pudo cargar Mi clínica: ' + errorMessage(error), 'error');
      var detail = document.getElementById('clinic-admin-branch-detail');
      if (detail) detail.innerHTML = '<div class="clinic-admin-empty">No se pudo cargar la configuración. Intenta actualizar.</div>';
    } finally { state.loading = false; }
  }

  async function mutate(task, success) {
    if (state.mutating) return false;
    state.mutating = true;
    try {
      await task();
      await load(true);
      feedback(success || 'Cambio guardado.');
      return true;
    } catch (error) {
      feedback(errorMessage(error), 'error');
      return false;
    } finally { state.mutating = false; }
  }

  function bindBranchActions(branch) {
    var form = document.getElementById('clinic-admin-branch-form');
    if (form && state.canClinic) form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(form);
      mutate(function () {
        return query(window.sb.from('smyl_branches').update({
          name: String(data.get('name') || '').trim(), phone: String(data.get('phone') || '').trim(),
          address_line: String(data.get('address_line') || '').trim(), city: String(data.get('city') || '').trim(),
          state: String(data.get('state') || '').trim(), postal_code: String(data.get('postal_code') || '').trim(),
          timezone: String(data.get('timezone') || 'America/Mexico_City')
        }).eq('tenant_id', state.tenant).eq('id', branch.id).select('id').single());
      }, 'Sucursal actualizada.');
    });
    document.querySelector('[data-ca-default]')?.addEventListener('click', function () {
      mutate(function () { return query(window.sb.rpc('smyl_set_default_branch', { p_branch_id: branch.id })); }, 'Sucursal principal actualizada.');
    });
    document.querySelector('[data-ca-deactivate-branch]')?.addEventListener('click', function () {
      if (!window.confirm('¿Desactivar esta sucursal? Los registros históricos se conservarán.')) return;
      mutate(function () { return query(window.sb.from('smyl_branches').update({ active: false }).eq('tenant_id', state.tenant).eq('id', branch.id).select('id').single()); }, 'Sucursal desactivada.');
    });
    document.getElementById('clinic-admin-room-form')?.addEventListener('submit', function (event) {
      event.preventDefault(); var form = event.currentTarget; var data = new FormData(form);
      mutate(function () { return query(window.sb.from('smyl_rooms').insert({ tenant_id: state.tenant, branch_id: branch.id, name: String(data.get('name') || '').trim(), room_type: String(data.get('room_type') || 'sillon'), created_by: state.actor }).select('id').single()); }, 'Espacio clínico agregado.');
    });
    document.querySelectorAll('[data-ca-room-off]').forEach(function (button) {
      button.addEventListener('click', function () { mutate(function () { return query(window.sb.from('smyl_rooms').update({ active: false }).eq('tenant_id', state.tenant).eq('id', button.dataset.caRoomOff).select('id').single()); }, 'Espacio desactivado.'); });
    });
    document.getElementById('clinic-admin-hours-form')?.addEventListener('submit', function (event) {
      event.preventDefault(); var form = event.currentTarget; var data = new FormData(form);
      mutate(function () { return query(window.sb.from('smyl_clinic_hours').insert({ tenant_id: state.tenant, branch_id: branch.id, weekday: Number(data.get('weekday')), starts_at: data.get('starts_at'), ends_at: data.get('ends_at'), created_by: state.actor }).select('id').single()); }, 'Horario agregado.');
    });
    document.querySelectorAll('[data-ca-hour-off]').forEach(function (button) {
      button.addEventListener('click', function () { mutate(function () { return query(window.sb.from('smyl_clinic_hours').update({ active: false }).eq('tenant_id', state.tenant).eq('id', button.dataset.caHourOff).select('id').single()); }, 'Bloque de horario retirado.'); });
    });
  }

  function openBranchDialog() {
    var dialog = document.getElementById('clinic-admin-dialog');
    dialog.innerHTML = '<form id="clinic-admin-create-branch"><h2>Nueva sucursal</h2><p>Crea la sede y después agrega sus espacios y horarios.</p><div class="clinic-admin-form-grid"><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-new-branch-name">Nombre</label><input id="ca-new-branch-name" name="name" maxlength="100" placeholder="Ej. Sucursal Providencia" required></div><div class="clinic-admin-field"><label for="ca-new-branch-city">Ciudad</label><input id="ca-new-branch-city" name="city" maxlength="90"></div><div class="clinic-admin-field"><label for="ca-new-branch-phone">Teléfono</label><input id="ca-new-branch-phone" name="phone" type="tel" maxlength="40"></div></div><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary">Crear sucursal</button></div></form>';
    dialog.querySelector('[data-ca-close]').addEventListener('click', function () { dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', async function (event) {
      event.preventDefault(); var data = new FormData(event.currentTarget);
      var ok = await mutate(async function () {
        var branch = await query(window.sb.from('smyl_branches').insert({ tenant_id: state.tenant, name: String(data.get('name') || '').trim(), city: String(data.get('city') || '').trim(), phone: String(data.get('phone') || '').trim(), created_by: state.actor }).select('id').single());
        state.selectedBranch = branch.id;
      }, 'Sucursal creada.');
      if (ok) dialog.close();
    });
    dialog.showModal(); dialog.querySelector('input').focus();
  }

  async function setMemberRole(userId, roleId) {
    await mutate(function () { return query(window.sb.rpc('smyl_set_member_role', { p_user_id: userId, p_role_id: roleId })); }, 'Rol actualizado.');
  }

  async function setMemberBranch(userId, branchId) {
    await mutate(function () { return query(window.sb.rpc('smyl_set_member_primary_branch', { p_user_id: userId, p_branch_id: branchId })); }, 'Sede principal actualizada.');
  }

  async function toggleMember(userId, active) {
    if (!active && !window.confirm('¿Desactivar el acceso de este integrante? Sus registros se conservarán.')) return;
    await mutate(function () { return query(window.sb.from('camila_usuarios').update({ activo: active }).eq('tenant_id', state.tenant).eq('id', userId).select('id').single()); }, active ? 'Acceso reactivado.' : 'Acceso desactivado.');
  }

  function openProfessionalDialog() {
    var dialog = document.getElementById('clinic-admin-dialog');
    var branches = state.branches.filter(function (row) { return row.active; });
    if (!branches.length) { feedback('Crea una sucursal antes de agregar doctores.', 'error'); return; }
    dialog.innerHTML = '<form id="clinic-admin-create-professional"><div class="clinic-admin-dialog-heading"><div><span class="pro-eyebrow">EQUIPO CLÍNICO</span><h2>Agregar doctor</h2></div><span class="clinic-admin-dialog-step">Acceso + perfil</span></div><p>Si el correo ya pertenece a tu clínica, SMYL configurará su perfil y su rol sin enviar otro correo. Si es nuevo, recibirá una invitación segura.</p><div class="clinic-admin-form-grid"><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-prof-email">Correo de acceso</label><input id="ca-prof-email" name="email" type="email" maxlength="254" required autocomplete="email" placeholder="ana@clinica.com"><small>Usa el mismo correo con el que entra a SMYL.</small></div><div id="ca-prof-account-state" class="clinic-admin-account-state clinic-admin-field-wide" hidden aria-live="polite"></div><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-prof-name">Nombre profesional</label><input id="ca-prof-name" name="display_name" maxlength="120" required autocomplete="name" placeholder="Dra. Ana López"></div><div class="clinic-admin-field"><label for="ca-prof-specialty">Especialidad</label><input id="ca-prof-specialty" name="specialty" maxlength="120" placeholder="Ortodoncia"></div><div class="clinic-admin-field"><label for="ca-prof-license">Cédula profesional</label><input id="ca-prof-license" name="license_number" maxlength="80" inputmode="numeric" placeholder="Opcional"></div><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-prof-branch">Sede principal</label><select id="ca-prof-branch" name="branch_id" required><option value="">Selecciona una sede</option>' + branches.map(function (branch) { return '<option value="' + branch.id + '">' + esc(branch.name) + '</option>'; }).join('') + '</select></div></div><div class="clinic-admin-invite-note"><strong>Rol inicial</strong><span>Quedará como Odontólogo, con acceso a sus pacientes, su agenda y el expediente clínico según las funciones configuradas para ese rol.</span></div><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary" data-ca-submit>Continuar</button></div></form>';
    var emailInput = dialog.querySelector('#ca-prof-email');
    var nameInput = dialog.querySelector('#ca-prof-name');
    var accountState = dialog.querySelector('#ca-prof-account-state');
    var submit = dialog.querySelector('[data-ca-submit]');
    function describeAccount() {
      var member = memberByEmail(emailInput.value);
      accountState.hidden = !member;
      if (!member) {
        accountState.replaceChildren();
        submit.textContent = 'Enviar invitación';
        return;
      }
      var linked = professionalForMember(member.id);
      accountState.dataset.tone = linked ? 'linked' : 'existing';
      accountState.innerHTML = '<strong>' + (linked ? 'Doctor ya vinculado' : 'Cuenta encontrada en tu clínica') + '</strong><span>' + (linked ? 'No enviaremos otro correo. Puedes actualizar aquí su rol, sede y datos profesionales.' : 'No enviaremos correo. Crearemos el perfil profesional y asignaremos el rol Odontólogo.') + '</span>';
      if (!nameInput.value.trim()) nameInput.value = member.nombre || '';
      if (linked) {
        if (!dialog.querySelector('#ca-prof-specialty').value) dialog.querySelector('#ca-prof-specialty').value = linked.specialty || '';
        if (!dialog.querySelector('#ca-prof-license').value) dialog.querySelector('#ca-prof-license').value = linked.license_number || '';
      }
      var currentBranch = branchForMember(member.id);
      if (currentBranch) dialog.querySelector('#ca-prof-branch').value = currentBranch.id;
      submit.textContent = linked ? 'Actualizar doctor' : 'Crear perfil profesional';
    }
    emailInput.addEventListener('input', describeAccount);
    emailInput.addEventListener('blur', describeAccount);
    dialog.querySelector('[data-ca-close]').addEventListener('click', function () { dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', async function (event) {
      event.preventDefault(); var data = new FormData(event.currentTarget);
      var existing = memberByEmail(data.get('email'));
      submit.disabled = true; submit.textContent = 'Guardando…';
      var ok = existing ? await configureExistingDoctor(existing, data) : await sendInvitation({ email: data.get('email'), nombre: data.get('display_name'), member_kind: 'professional', specialty: data.get('specialty'), license_number: data.get('license_number'), branch_id: data.get('branch_id') });
      submit.disabled = false;
      if (ok) { dialog.close(); state.loaded = false; await load(true); }
      else describeAccount();
    });
    dialog.showModal(); emailInput.focus();
  }

  async function configureExistingDoctor(member, data) {
    var professional = professionalForMember(member.id);
    var dentistRole = roleByCode('odontologo');
    var branchId = String(data.get('branch_id') || '');
    if (!dentistRole) { feedback('No encontramos el rol Odontólogo. Crea o reactiva ese rol antes de continuar.', 'error'); return false; }
    return mutate(async function () {
      if (!member.activo) {
        await query(window.sb.from('camila_usuarios').update({ activo: true }).eq('tenant_id', state.tenant).eq('id', member.id).select('id').single());
      }
      if (!professional) {
        await query(window.sb.rpc('smyl_create_professional', {
          p_display_name: String(data.get('display_name') || member.nombre || member.email).trim(),
          p_specialty: String(data.get('specialty') || '').trim(),
          p_license_number: String(data.get('license_number') || '').trim(),
          p_user_id: member.id,
          p_branch_id: branchId || null
        }));
      } else {
        await query(window.sb.from('smyl_professionals').update({
          display_name: String(data.get('display_name') || professional.display_name).trim(),
          specialty: String(data.get('specialty') || '').trim(),
          license_number: String(data.get('license_number') || '').trim()
        }).eq('tenant_id', state.tenant).eq('id', professional.id).select('id').single());
        if (branchId && !state.professionalBranches.some(function (row) { return row.professional_id === professional.id && row.branch_id === branchId; })) {
          await query(window.sb.from('smyl_professional_branches').insert({ tenant_id: state.tenant, professional_id: professional.id, branch_id: branchId }).select('professional_id').single());
        }
      }
      if (!roleFor(member.id) || roleFor(member.id).id !== dentistRole.id) {
        await query(window.sb.rpc('smyl_set_member_role', { p_user_id: member.id, p_role_id: dentistRole.id }));
      }
      if (branchId) await query(window.sb.rpc('smyl_set_member_primary_branch', { p_user_id: member.id, p_branch_id: branchId }));
    }, professional ? 'Doctor actualizado. No fue necesario enviar otro correo.' : 'Perfil profesional creado y rol Odontólogo asignado.');
  }

  function openMemberDialog() {
    var dialog = document.getElementById('clinic-admin-dialog');
    dialog.innerHTML = '<form id="clinic-admin-invite-form"><div class="clinic-admin-dialog-heading"><div><span class="pro-eyebrow">EQUIPO ADMINISTRATIVO</span><h2>Invitar integrante</h2></div></div><p>Para recepción, administración u otras personas que no atienden pacientes como doctores.</p><div class="clinic-admin-form-grid"><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-invite-name">Nombre</label><input id="ca-invite-name" name="name" maxlength="120" required autocomplete="name" placeholder="Ana López"></div><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-invite-email">Correo de acceso</label><input id="ca-invite-email" name="email" type="email" maxlength="254" required autocomplete="email" placeholder="ana@clinica.com"><small>Si ya pertenece a esta clínica, administra su rol desde la lista.</small></div></div><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary" data-ca-submit>Enviar invitación</button></div></form>';
    dialog.querySelector('[data-ca-close]').addEventListener('click', function () { dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var submit = dialog.querySelector('[data-ca-submit]');
      submit.disabled = true; submit.textContent = 'Enviando…';
      var ok = await inviteMember(event);
      submit.disabled = false; submit.textContent = 'Enviar invitación';
      if (ok) dialog.close();
    });
    dialog.showModal(); dialog.querySelector('input').focus();
  }

  async function deactivateProfessional(id) {
    if (!window.confirm('¿Desactivar este profesional? Sus citas y registros históricos se conservarán.')) return;
    await mutate(function () { return query(window.sb.from('smyl_professionals').update({ active: false }).eq('tenant_id', state.tenant).eq('id', id).select('id').single()); }, 'Profesional desactivado.');
  }

  async function sendInvitation(input) {
    var email = normalizeEmail(input.email);
    var name = String(input.nombre || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { feedback('Escribe un correo válido.', 'error'); return; }
    var existing = memberByEmail(email);
    if (existing) {
      feedback(input.member_kind === 'professional' ? 'Ese correo ya pertenece a tu clínica. Usa “Agregar doctor” para configurar su perfil y su rol sin reenviar correo.' : 'Ese correo ya pertenece a tu equipo. Cambia su rol o su sede directamente en la lista.', 'info');
      return false;
    }
    if (state.mutating) return false; state.mutating = true;
    try {
      var session = await window.sb.auth.getSession();
      var token = session.data && session.data.session && session.data.session.access_token;
      if (!token) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
      var response = await fetch(window.SUPA_URL + '/functions/v1/invite-staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: window.SUPA_KEY },
        body: JSON.stringify({ email: email, nombre: name, member_kind: input.member_kind || 'staff', specialty: input.specialty || '', license_number: input.license_number || '', branch_id: input.branch_id || null })
      });
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(body.error || 'No se pudo enviar la invitación.');
      feedback('Invitación enviada a ' + email + '. El acceso se activará cuando la acepte.', 'success'); return true;
    } catch (error) {
      var message = errorMessage(error);
      if (/ya tiene una cuenta en smyl|no se puede reinvitar/i.test(message)) message = 'Ese correo ya usa SMYL. Si debe pertenecer a esta clínica, solicita vincular la cuenta existente; no crees una cuenta duplicada.';
      feedback(message, 'error'); return false;
    }
    finally { state.mutating = false; }
  }

  async function inviteMember(event) {
    event.preventDefault();
    var form = event.currentTarget; var data = new FormData(form);
    var ok = await sendInvitation({ email: data.get('email'), nombre: data.get('name'), member_kind: 'staff' });
    if (ok) { form.reset(); state.loaded = false; await load(true); }
    return ok;
  }

  function setTab(tab) {
    state.tab = tab === 'equipo' ? 'equipo' : 'operacion';
    document.querySelectorAll('.clinic-admin-tab').forEach(function (button) {
      var selected = button.dataset.caTab === state.tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('.clinic-admin-panel').forEach(function (panel) {
      panel.hidden = panel.dataset.caPanel !== state.tab;
    });
  }

  function buildPage() {
    var page = el('section', 'pantalla clinic-admin-page'); page.id = 'p-clinica';
    page.innerHTML = '<header class="clinic-admin-head"><div><span class="pro-eyebrow">OPERACIÓN DE LA CLÍNICA</span><h1>Mi clínica</h1><p>Organiza sedes, espacios, horarios y responsabilidades con una guía clara para preparar la operación diaria.</p></div><div class="clinic-admin-head-actions"><span class="clinic-admin-status">Datos protegidos en SMYL</span><button type="button" class="btn btn-secondary" id="clinic-admin-refresh">Actualizar</button></div></header><div id="clinic-admin-feedback" class="clinic-admin-feedback" aria-live="polite"></div><section id="clinic-admin-readiness" class="clinic-admin-readiness" aria-label="Preparación operativa"></section><section id="clinic-admin-metrics" class="clinic-admin-metrics" aria-label="Resumen de la clínica"></section><div class="clinic-admin-tabs" role="tablist" aria-label="Áreas de Mi clínica"><button type="button" class="clinic-admin-tab" role="tab" data-ca-tab="operacion" aria-selected="true">Sucursales y horarios</button><button type="button" class="clinic-admin-tab" role="tab" data-ca-tab="equipo" aria-selected="false">Equipo, roles y profesionales</button></div><section class="clinic-admin-panel" data-ca-panel="operacion"><div class="clinic-admin-layout"><aside class="clinic-admin-sidebar"><div class="clinic-admin-sidebar-head"><h2>Sucursales</h2><button type="button" class="clinic-admin-icon-button" id="clinic-admin-add-branch" aria-label="Agregar sucursal">+</button></div><div id="clinic-admin-branch-list" class="clinic-admin-branch-list"></div></aside><div id="clinic-admin-branch-detail" class="clinic-admin-main"><div class="clinic-admin-loading">Abre Mi clínica para cargar la operación.</div></div></div></section><section class="clinic-admin-panel" data-ca-panel="equipo" hidden><header class="clinic-admin-team-hero"><div><span class="pro-eyebrow">PERSONAS Y ACCESO</span><h2>Equipo de la clínica</h2><p>Administra una sola ficha por persona. El rol define qué puede hacer y la sede define dónde trabaja.</p></div><div class="clinic-admin-team-actions"><button type="button" class="btn btn-secondary" id="clinic-admin-add-member">Invitar integrante</button><button type="button" class="btn btn-primary" id="clinic-admin-add-professional">Agregar doctor</button></div></header><div class="clinic-admin-team-grid"><article class="clinic-admin-card clinic-admin-people-card"><div class="clinic-admin-section-head"><div><h2>Personas con acceso</h2><p class="clinic-admin-card-intro">Edita rol y sede directamente. Los doctores vinculados se identifican en la misma lista.</p></div></div><div id="clinic-admin-members" class="clinic-admin-people-list"></div></article><aside class="clinic-admin-card clinic-admin-pending-card"><div class="clinic-admin-section-head"><div><h2>Por completar</h2><p class="clinic-admin-card-intro">Invitaciones pendientes o perfiles profesionales sin acceso.</p></div></div><div id="clinic-admin-professionals"></div></aside><article class="clinic-admin-card clinic-admin-role-card"><div class="clinic-admin-section-head"><div><h2>Roles y funciones</h2><p class="clinic-admin-card-intro">Son plantillas editables: activa funciones y define el alcance de datos con pastillas.</p></div><button type="button" class="btn btn-secondary" id="clinic-admin-add-role">Crear rol</button></div><div id="clinic-admin-role-guide"></div></article></div></section><dialog id="clinic-admin-dialog" class="clinic-admin-dialog smyl-v2-dialog"></dialog>';
    document.querySelector('.contenido').append(page);
    page.querySelectorAll('[data-ca-tab]').forEach(function (button) { button.addEventListener('click', function () { setTab(button.dataset.caTab); }); });
    page.querySelector('#clinic-admin-refresh').addEventListener('click', function () { load(true); });
    page.querySelector('#clinic-admin-add-branch').addEventListener('click', openBranchDialog);
    page.querySelector('#clinic-admin-add-professional').addEventListener('click', openProfessionalDialog);
    page.querySelector('#clinic-admin-add-member').addEventListener('click', openMemberDialog);
    page.querySelector('#clinic-admin-add-role').addEventListener('click', function () { openRoleDialog(null); });
    page.querySelector('#clinic-admin-dialog').addEventListener('click', function (event) {
      if (event.target === event.currentTarget) event.currentTarget.close();
    });
  }

  function addNavigation() {
    window.TITULOS.clinica = 'Mi clínica';
    var primary = document.querySelector('.pro-primary-nav');
    if (primary && !primary.querySelector('[onclick="ir(\'clinica\')"]')) {
      var button = navButton('Mi clínica', 'clinica');
      var patients = primary.querySelector('[onclick="ir(\'pacientes\')"]');
      if (patients) patients.before(button); else primary.append(button);
    }
    var mobile = document.querySelector('.pro-mobile-nav');
    if (mobile && !mobile.querySelector('[onclick="ir(\'clinica\')"]')) {
      var mobileButton = navButton('Clínica', 'clinica');
      var mobilePatients = mobile.querySelector('[onclick="ir(\'pacientes\')"]');
      if (mobilePatients) mobilePatients.before(mobileButton); else mobile.append(mobileButton);
    }
  }

  function init() {
    buildPage(); addNavigation();
    var previous = window.ir;
    window.ir = function (route) {
      var result = previous(route);
      if (route === 'clinica') load(false);
      return result;
    };
    window.SmylClinicAdmin = Object.freeze({ reload: function () { return load(true); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
