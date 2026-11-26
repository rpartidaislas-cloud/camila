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
    'finance.cash': 'Abrir y operar su caja', 'finance.cash.supervise': 'Supervisar cajas del equipo',
    'finance.invoice': 'Preparar facturas', 'finance.refund': 'Reembolsar y cancelar cargos',
    'inventory.read': 'Consultar inventario', 'inventory.manage': 'Gestionar inventario',
    'inventory.consume': 'Registrar consumo', 'inventory.adjust': 'Ajustar inventario', 'inventory.purchase': 'Comprar y recibir',
    'catalog.manage': 'Gestionar servicios', 'catalog.prices': 'Cambiar precios',
    'settings.manage': 'Administrar configuración',
    'cloud.read': 'Ver la Nube', 'cloud.upload': 'Subir a la Nube', 'cloud.manage': 'Organizar y borrar en la Nube', 'cloud.share': 'Compartir desde la Nube'
  };
  var PERMISSION_GROUPS = [
    { name: 'Clínica y equipo', keys: ['clinic.read', 'clinic.manage', 'team.read', 'team.manage', 'audit.read', 'settings.manage'] },
    { name: 'Pacientes y atención', keys: ['patients.read', 'patients.manage', 'clinical.read', 'clinical.write', 'clinical.approve'] },
    { name: 'Agenda', keys: ['schedule.read', 'schedule.manage'] },
    { name: 'Cotizaciones', keys: ['proposal.read', 'proposal.write', 'proposal.approve', 'proposal.followup'] },
    { name: 'Servicios y tarifas', keys: ['catalog.manage', 'catalog.prices'] },
    { name: 'Cobros y caja', keys: ['finance.read', 'finance.manage', 'finance.cash', 'finance.cash.supervise', 'finance.refund'] },
    { name: 'Facturación', keys: ['finance.invoice'] },
    { name: 'Inventario', keys: ['inventory.read', 'inventory.manage', 'inventory.consume', 'inventory.adjust', 'inventory.purchase'] },
    { name: 'Nube', keys: ['cloud.read', 'cloud.upload', 'cloud.manage', 'cloud.share'] }
  ];
  var DATA_SCOPES = {
    own: 'Solo propio', care_team: 'Equipo tratante', branches: 'Sucursales asignadas', clinic: 'Toda la clínica'
  };
  var SCOPE_GROUPS = [
    { key: 'patients', label: 'Pacientes' }, { key: 'schedule', label: 'Agenda' },
    { key: 'clinical', label: 'Expediente clínico' }, { key: 'messages', label: 'Chat de quien coordina' },
    { key: 'finance', label: 'Finanzas' }
  ];
  var state = { branchStep: {},
    tenant: null, actor: null, loading: false, loaded: false, mutating: false,
    tab: 'operacion', teamView: 'people', selectedBranch: null, branchFilter: 'active', branchQuery: '', branches: [], rooms: [], hours: [],
    users: [], roles: [], permissions: [], roleScopes: [], memberRoles: [], memberBranches: [],
    professionals: [], professionalBranches: [], invitations: [], canClinic: false, canTeam: false,
    canAssignRoles: false, canScheduleRead: false, canScheduleManage: false, hoursDraft: null,
    people: [], personFilter: 'all', personQuery: '', professionalQuery: '', person: null, editing: false,
    proHours: [], profiles: [], conflicts: [], services: [], professionalServices: [], phoneSupported: true, contactSupported: false, institutionSupported: false, travelSupported: false, travelMargin: 45
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

  function updateSectionCount(id, count, singular, plural) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = count + ' ' + (count === 1 ? singular : plural);
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
    if (/failed to fetch|networkerror|load failed|network request failed|timeout|timed out/i.test(message)) return 'No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo.';
    if (/smyl_professionals_contact_phone_check|contact_phone/i.test(message)) return 'El WhatsApp solo puede llevar números y los signos + ( ) - .';
    if (/smyl_professionals_phone_check/i.test(message)) return 'El teléfono solo puede llevar números y los signos + ( ) - .';
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

  // Datos que enriquecen la ficha pero no son indispensables (horarios, perfil público, reglas): si fallan o aún no existen en la base, la pantalla sigue.
  function soft(promise, fallback) {
    return promise.then(null, function () { return fallback; });
  }

  // Credenciales para recetas (institución del título y cédula de especialidad): se leen aparte y se mezclan,
  // para que la lista funcione igual si la base aún no tiene esas columnas.
  async function withCredentials(rows, tenant) {
    try {
      var creds = await query(window.sb.from('smyl_professionals').select('id,license_institution,specialty_license').eq('tenant_id', tenant));
      var byId = {}; (creds || []).forEach(function (c) { byId[c.id] = c; });
      state.credentialsSupported = true; state.institutionSupported = true;
      return (rows || []).map(function (r) { var c = byId[r.id] || {}; return Object.assign({}, r, { license_institution: c.license_institution || '', specialty_license: c.specialty_license || '' }); });
    } catch (e) { state.credentialsSupported = false; state.institutionSupported = false; return rows; }
  }

  async function loadProfessionals(tenant) {
    return withCredentials(await loadProfessionalRows(tenant), tenant);
  }

  async function loadProfessionalRows(tenant) {
    var base = 'id,tenant_id,user_id,display_name,specialty,license_number,color_token,active';
    try {
      // WhatsApp del profesional (migración de mensajes de citas): si la base aún no lo tiene, se lee sin él.
      var withContact = await query(window.sb.from('smyl_professionals').select(base + ',phone,contact_phone,contact_phone_public').eq('tenant_id', tenant).order('display_name'));
      state.phoneSupported = true; state.contactSupported = true;
      return withContact;
    } catch (contactError) { state.contactSupported = false; }
    try {
      var rows = await query(window.sb.from('smyl_professionals').select(base + ',phone').eq('tenant_id', tenant).order('display_name'));
      state.phoneSupported = true;
      return rows;
    } catch (error) {
      // Mientras la base no tenga la columna del teléfono interno, la lista de doctores se lee sin ella.
      if (!/phone|42703|column/i.test(String(error && (error.message || error.code || '')))) throw error;
      state.phoneSupported = false;
      return query(window.sb.from('smyl_professionals').select(base).eq('tenant_id', tenant).order('display_name'));
    }
  }

  function feedback(message, tone, retry) {
    var host = document.getElementById('clinic-admin-feedback');
    if (!host) return;
    host.replaceChildren();
    if (!message) return;
    var notice = el('div', 'clinic-admin-notice');
    if (tone) notice.dataset.tone = tone;
    if (tone === 'error') notice.setAttribute('role', 'alert');
    notice.append(el('span', '', message));
    var actions = el('span', 'clinic-admin-notice-actions');
    if (typeof retry === 'function') {
      var again = el('button', '', 'Reintentar');
      again.type = 'button';
      again.addEventListener('click', function () { host.replaceChildren(); retry(); });
      actions.append(again);
    }
    var close = el('button', '', 'Cerrar');
    close.type = 'button';
    close.addEventListener('click', function () { host.replaceChildren(); });
    actions.append(close); notice.append(actions); host.append(notice);
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

  function professionalProfileForMember(userId) {
    return state.professionals.find(function (professional) {
      return professional.user_id === userId;
    }) || null;
  }

  function roleByCode(code) {
    return state.roles.find(function (role) { return role.active && role.code === code; }) || null;
  }

  function branchReadiness(branch) {
    var rooms = state.rooms.filter(function (row) { return row.active && row.branch_id === branch.id; });
    var hours = state.hours.filter(function (row) { return row.active && row.branch_id === branch.id; });
    var address = Boolean(String(branch.address_line || '').trim() && String(branch.city || '').trim());
    var team = state.memberBranches.filter(function (row) { return row.branch_id === branch.id; }).length +
      state.professionalBranches.filter(function (row) { return row.branch_id === branch.id; }).length;
    return {
      rooms: rooms.length,
      blocks: hours.length,
      weekdays: new Set(hours.map(function (row) { return row.weekday; })).size,
      address: address,
      team: team,
      ready: address && rooms.length > 0 && hours.length > 0
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
    state.canScheduleManage = owner || permissions.has('schedule.manage');
    state.canScheduleRead = owner || permissions.has('schedule.read') || permissions.has('schedule.manage');
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
      [branchCount, branchCount === 1 ? 'sucursal' : 'sucursales'],
      [roomCount, roomCount === 1 ? 'espacio clínico' : 'espacios clínicos'],
      [memberCount, memberCount === 1 ? 'persona en el equipo' : 'personas en el equipo'],
      [coverage, 'días con horario por sede']
    ].map(function (item) {
      return '<span class="clinic-admin-metric"><strong>' + item[0] + '</strong> ' + esc(item[1]) + '</span>';
    }).join('');
  }

  function renderReadiness() {
    var host = document.getElementById('clinic-admin-readiness');
    if (!host) return;
    var snapshot = readinessSnapshot();
    var foldBody = '<div class="clinic-admin-readiness-summary"><span class="pro-eyebrow">PREPARACIÓN OPERATIVA</span><div class="clinic-admin-readiness-score"><strong>' + snapshot.percent + '%</strong><span>' + snapshot.completed + ' de ' + snapshot.checks.length + ' áreas listas</span></div><div class="clinic-admin-progress" aria-label="' + snapshot.percent + '% de preparación operativa"><i style="width:' + snapshot.percent + '%"></i></div><p>Completa la configuración mínima para coordinar agenda, espacios y responsables con menos improvisación.</p></div><div class="clinic-admin-checklist">' + snapshot.checks.map(function (item) {
      return '<button type="button" class="clinic-admin-check" data-ca-readiness="' + item.key + '" data-ca-tab-target="' + item.tab + '"' + (item.branch ? ' data-ca-branch-target="' + item.branch + '"' : '') + '><span class="clinic-admin-check-icon" data-ready="' + item.done + '">' + (item.done ? '✓' : '!') + '</span><span><strong>' + esc(item.title) + '</strong><small>' + esc(item.detail) + '</small></span><b>' + (item.done ? 'Listo' : 'Revisar') + '</b></button>';
    }).join('') + '</div><p class="clinic-admin-readiness-note">Este indicador refleja únicamente la configuración visible en SMYL; no sustituye validaciones clínicas, laborales, fiscales ni sanitarias.</p>';
    var allDone = snapshot.percent >= 100;
    var missing = snapshot.checks.filter(function (row) { return !row.done; }).map(function (row) { return row.title; });
    host.innerHTML = '<details class="clinic-admin-readiness-fold" data-done="' + allDone + '"' + '' + '><summary><span class="clinic-admin-readiness-icon" data-ready="' + allDone + '">' + (allDone ? '✓' : '!') + '</span><strong>' + (allDone ? 'Todo listo para operar' : 'Falta: ' + esc(missing.join(', '))) + '</strong><small>' + snapshot.completed + ' de ' + snapshot.checks.length + ' áreas listas</small><span class="clinic-admin-readiness-more">Ver detalle</span></summary><div class="clinic-admin-readiness-body">' + foldBody + '</div></details>';
    host.querySelectorAll('[data-ca-readiness]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.dataset.caBranchTarget) state.selectedBranch = button.dataset.caBranchTarget;
        goTab(button.dataset.caTabTarget);
        if (state.tab === 'operacion') renderOperations(); else renderTeam();
        var target = document.querySelector('.clinic-admin-tabs');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderBranches() {
    var list = document.getElementById('clinic-admin-branch-list');
    var filters = document.getElementById('clinic-admin-branch-filters');
    if (!list) return;
    list.replaceChildren();
    if (filters) {
      var activeCount = state.branches.filter(function (branch) { return branch.active; }).length;
      var archivedCount = state.branches.length - activeCount;
      filters.innerHTML = '<button type="button" data-ca-branch-filter="active" aria-pressed="' + (state.branchFilter === 'active') + '">Activas <span>' + activeCount + '</span></button>' +
        '<button type="button" data-ca-branch-filter="archived" aria-pressed="' + (state.branchFilter === 'archived') + '">Archivadas <span>' + archivedCount + '</span></button>';
      filters.querySelectorAll('[data-ca-branch-filter]').forEach(function (button) {
        button.addEventListener('click', function () {
          state.branchFilter = button.dataset.caBranchFilter;
          var visible = state.branches.filter(function (branch) { return state.branchFilter === 'archived' ? !branch.active : branch.active; });
          state.selectedBranch = visible[0] ? visible[0].id : null;
          renderOperations();
        });
      });
    }
    var term = plain(state.branchQuery).trim();
    var branches = state.branches.filter(function (branch) {
      var statusMatches = state.branchFilter === 'archived' ? !branch.active : branch.active;
      if (!statusMatches) return false;
      return !term || plain([branch.name, branch.city, branch.address_line].join(' ')).indexOf(term) !== -1;
    });
    if (!branches.length) {
      list.append(el('div', 'clinic-admin-empty', term ? 'Ninguna sucursal coincide con «' + state.branchQuery.trim() + '».' : (state.branchFilter === 'archived' ? 'No hay sucursales archivadas.' : 'No hay sucursales activas.')));
      return;
    }
    branches.forEach(function (branch) {
      var readiness = branchReadiness(branch);
      var row = el('div', 'clinic-admin-branch-row');
      var button = el('button', 'clinic-admin-branch');
      button.type = 'button'; button.dataset.branchId = branch.id;
      button.setAttribute('aria-current', String(branch.id === state.selectedBranch));
      var subtitle = [branch.city || 'Ubicación pendiente', branch.is_default ? 'Principal' : (branch.active ? 'Sucursal' : 'Fuera de operación')].join(' · ');
      button.innerHTML = '<strong>' + esc(branch.name) + '</strong><small><i class="clinic-admin-dot" data-ready="' + (branch.active && readiness.ready) + '"></i>' + esc(subtitle) + '</small><span class="clinic-admin-branch-state" data-ready="' + (branch.active && readiness.ready) + '" data-archived="' + (!branch.active) + '">' + (!branch.active ? 'Archivada' : readiness.ready ? 'Lista para agenda' : 'Por completar') + '</span>';
      button.addEventListener('click', function () { state.selectedBranch = branch.id; renderOperations(); });
      row.append(button);
      if (state.canClinic) row.insertAdjacentHTML('beforeend', branchActionsMenu(branch, true));
      bindBranchActionsMenu(row, branch);
      list.append(row);
    });
  }

  function branchActionsMenu(branch, compact) {
    if (!state.canClinic) return '';
    var label = compact ? '<span aria-hidden="true">•••</span>' : '<span>Más acciones</span>';
    var actions = '';
    if (!branch.active) {
      actions = '<button type="button" role="menuitem" data-ca-restore-branch><strong>Reactivar sucursal</strong><small>Volver a mostrarla en la operación</small></button>';
    } else {
      actions = branch.is_default
        ? '<button type="button" role="menuitem" aria-disabled="true" data-ca-primary-current><strong>Sucursal principal</strong><small>Esta es la sede principal actual</small></button>'
        : '<button type="button" role="menuitem" data-ca-default><strong>Hacer sucursal principal</strong><small>Usarla como sede predeterminada</small></button>';
      actions += branch.is_default
        ? '<button type="button" role="menuitem" class="is-danger" aria-disabled="true" data-ca-archive-blocked><strong>Archivar sucursal</strong><small>Primero elige otra sucursal principal</small></button>'
        : '<button type="button" role="menuitem" class="is-danger" data-ca-deactivate-branch><strong>Archivar sucursal</strong><small>Quitar de la operación sin borrar historial</small></button>';
    }
    return '<details class="clinic-admin-branch-menu" data-compact="' + compact + '"><summary aria-label="Más acciones de ' + esc(branch.name) + '">' + label + '</summary><div class="clinic-admin-branch-menu-popover" role="menu">' + actions + '</div></details>';
  }

  function bindBranchActionsMenu(scope, branch) {
    function close(button) { var menu = button.closest('details'); if (menu) menu.removeAttribute('open'); }
    scope.querySelectorAll('[data-ca-default]').forEach(function (button) {
      button.addEventListener('click', function () {
        close(button);
        mutate(function () { return query(window.sb.rpc('smyl_set_default_branch', { p_branch_id: branch.id })); }, 'Sucursal principal actualizada.');
      });
    });
    scope.querySelectorAll('[data-ca-deactivate-branch]').forEach(function (button) {
      button.addEventListener('click', function () { close(button); archiveBranch(branch); });
    });
    scope.querySelectorAll('[data-ca-restore-branch]').forEach(function (button) {
      button.addEventListener('click', function () { close(button); restoreBranch(branch); });
    });
    scope.querySelectorAll('[data-ca-primary-current]').forEach(function (button) {
      button.addEventListener('click', function () { close(button); feedback('Esta ya es la sucursal principal de la clínica.'); });
    });
    scope.querySelectorAll('[data-ca-archive-blocked]').forEach(function (button) {
      button.addEventListener('click', function () { close(button); feedback('Primero establece otra sucursal como principal. Después podrás archivar esta sede.', 'error'); });
    });
  }

  function branchForm(branch) {
    var disabled = state.canClinic ? '' : ' disabled';
    return '<form id="clinic-admin-branch-form">' +
      '<div class="clinic-admin-form-grid">' +
        '<div class="clinic-admin-field"><label for="ca-branch-name">Nombre de la sucursal</label><input id="ca-branch-name" name="name" maxlength="100" required value="' + esc(branch.name) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-phone">Teléfono</label><input id="ca-branch-phone" name="phone" type="tel" maxlength="40" value="' + esc(branch.phone) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-branch-address">Dirección</label><input id="ca-branch-address" name="address_line" maxlength="180" value="' + esc(branch.address_line) + '"' + disabled + '></div>' +
        (Object.prototype.hasOwnProperty.call(branch, 'arrival_notes') ? '<div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-branch-arrival">Cómo llegar o estacionarse <em>(opcional)</em></label><input id="ca-branch-arrival" name="arrival_notes" maxlength="300" placeholder="Ej. Estacionamiento en el sótano; sube al piso 2." value="' + esc(branch.arrival_notes) + '"' + disabled + '><small>Se incluye en el mensaje de confirmación que recibe el paciente.</small></div>' : '') +
        '<div class="clinic-admin-field"><label for="ca-branch-city">Ciudad</label><input id="ca-branch-city" name="city" maxlength="90" value="' + esc(branch.city) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-state">Estado</label><input id="ca-branch-state" name="state" maxlength="90" value="' + esc(branch.state) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-postal">Código postal</label><input id="ca-branch-postal" name="postal_code" maxlength="16" value="' + esc(branch.postal_code) + '"' + disabled + '></div>' +
        '<div class="clinic-admin-field"><label for="ca-branch-timezone">Zona horaria</label><select id="ca-branch-timezone" name="timezone"' + disabled + '>' +
          ['America/Mexico_City','America/Cancun','America/Monterrey','America/Chihuahua','America/Hermosillo','America/Tijuana'].map(function (zone) {
            return '<option value="' + zone + '"' + (zone === branch.timezone ? ' selected' : '') + '>' + zone.replace('America/', '') + '</option>';
          }).join('') + '</select></div>' +
      '</div>' +
      (state.canClinic ? '<div class="clinic-admin-actions clinic-admin-branch-form-actions">' +
        '<button type="submit" class="btn btn-primary">Guardar y continuar</button></div>' : '') +
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
    var presets = state.canClinic ? '<div class="clinic-admin-presets"><span>Atajos:</span><button type="button" data-ca-hours-preset="1,2,3,4,5|09:00|18:00">Lun–Vie 9:00–18:00</button><button type="button" data-ca-hours-preset="1,2,3,4,5,6|09:00|14:00">Lun–Sáb 9:00–14:00</button></div>' : '';
    return '<section class="clinic-admin-subsection"><h3>Horario de atención</h3><p>Puedes crear dos bloques en un día; SMYL impide que se encimen.</p>' + presets + '<div class="clinic-admin-list">' + rows + '</div>' + form + '</section>';
  }

  var STEPS = [
    { key: 'datos', label: 'Datos y dirección' },
    { key: 'operacion', label: 'Operación' },
    { key: 'equipo', label: 'Equipo' },
    { key: 'resumen', label: 'Resumen' }
  ];
  function stepDone(readiness, key) {
    return key === 'datos' ? readiness.address : key === 'operacion' ? readiness.rooms > 0 && readiness.blocks > 0 : key === 'espacios' ? readiness.rooms > 0 : key === 'horarios' ? readiness.blocks > 0 : key === 'equipo' ? readiness.team > 0 : readiness.ready;
  }
  function firstPendingStep(readiness) {
    var found = STEPS.find(function (step) { return step.key !== 'equipo' && step.key !== 'resumen' && !stepDone(readiness, step.key); });
    return found ? found.key : 'resumen';
  }
  function goStep(branchId, key) { state.branchStep[branchId] = key; renderBranchDetail(); }

  function teamSection(branch) {
    var linked = state.professionalBranches.filter(function (row) { return row.branch_id === branch.id; }).map(function (row) {
      return state.professionals.find(function (candidate) { return candidate.id === row.professional_id && candidate.active; });
    }).filter(Boolean).sort(function (a, b) { return a.display_name.localeCompare(b.display_name, 'es'); });
    var administrative = state.memberBranches.filter(function (row) {
      if (row.branch_id !== branch.id) return false;
      var professional = professionalProfileForMember(row.user_id);
      return !professional || !professional.active;
    }).length;
    var rows = linked.length ? linked.map(function (professional) {
      var summary = state.canScheduleRead ? hoursSummary(professional, branch) : 'Horario disponible según permisos';
      var hasHours = state.proHours.some(function (row) { return row.professional_id === professional.id && row.branch_id === branch.id; });
      return '<div class="clinic-admin-branch-person"><span class="clinic-admin-avatar">' + esc(initials(professional.display_name)) + '</span><div><strong>' + esc(professional.display_name) + '</strong><small>' + esc(professional.specialty || 'Odontología general') + '</small><span class="clinic-admin-branch-person-hours" data-ready="' + hasHours + '">' + esc(summary) + '</span></div><div class="clinic-admin-branch-person-actions">' +
        '<button type="button" data-ca-open-professional="' + professional.id + '">Ver ficha</button>' +
        (state.canClinic ? '<button type="button" class="is-danger" data-ca-remove-professional="' + professional.id + '">Desvincular</button>' : '') +
        '</div></div>';
    }).join('') : '<div class="clinic-admin-empty"><strong>Esta sede todavía no tiene profesionales</strong><span>Vincula a quienes atenderán aquí y después configura sus horarios.</span></div>';
    return '<section class="clinic-admin-subsection clinic-admin-branch-team"><div class="clinic-admin-subsection-head"><div><h3>Profesionales de esta sede</h3><p>Administra aquí quién atiende, sin cambiar de sección.</p></div><span class="clinic-admin-section-count">' + linked.length + (linked.length === 1 ? ' profesional' : ' profesionales') + '</span></div><div class="clinic-admin-list">' + rows + '</div>' +
      (administrative ? '<p class="clinic-admin-hint">Además, ' + administrative + (administrative === 1 ? ' integrante administrativo tiene' : ' integrantes administrativos tienen') + ' esta sede como principal.</p>' : '') +
      (state.canClinic || state.canTeam ? '<div class="clinic-admin-actions clinic-admin-branch-team-actions">' + (state.canTeam ? '<button type="button" class="clinic-admin-link" data-ca-go-team>Roles y accesos →</button><button type="button" class="btn btn-secondary" data-ca-new-professional>+ Nuevo profesional</button>' : '') + (state.canClinic ? '<button type="button" class="btn btn-primary" data-ca-manage-team>Vincular profesionales</button>' : '') + '</div>' : '') + '</section>';
  }

  function archivedBranchSection(branch) {
    var professionals = state.professionalBranches.filter(function (row) { return row.branch_id === branch.id; }).length;
    var rooms = state.rooms.filter(function (row) { return row.branch_id === branch.id && row.active; }).length;
    var blocks = state.hours.filter(function (row) { return row.branch_id === branch.id && row.active; }).length;
    return '<article class="clinic-admin-card clinic-admin-archived"><div class="clinic-admin-archived-icon" aria-hidden="true">✓</div><span class="pro-eyebrow">SUCURSAL ARCHIVADA</span><h2>' + esc(branch.name) + '</h2><p>Está fuera de la agenda y no acepta nuevas operaciones. Su historial clínico, citas, cobros y configuración permanecen protegidos.</p><div class="clinic-admin-archive-summary"><span><strong>' + professionals + '</strong> profesionales vinculados</span><span><strong>' + rooms + '</strong> espacios conservados</span><span><strong>' + blocks + '</strong> bloques de horario</span></div>' + (state.canClinic ? '<button type="button" class="btn btn-primary" data-ca-restore-branch>Reactivar sucursal</button>' : '') + '</article>';
  }

  function summarySection(branch, readiness) {
    var items = [
      ['datos', 'datos', 'Datos y dirección', readiness.address ? [branch.address_line, branch.city].filter(Boolean).join(', ') : 'Falta la dirección y la ciudad'],
      ['espacios', 'operacion', 'Espacios', readiness.rooms ? readiness.rooms + (readiness.rooms === 1 ? ' espacio activo' : ' espacios activos') : 'Agrega al menos un sillón o consultorio'],
      ['horarios', 'operacion', 'Horarios', readiness.blocks ? readiness.weekdays + (readiness.weekdays === 1 ? ' día' : ' días') + ' con horario' : 'Define cuándo atiende esta sede'],
      ['equipo', 'equipo', 'Equipo', readiness.team ? readiness.team + (readiness.team === 1 ? ' persona asignada' : ' personas asignadas') : 'Sin personas asignadas todavía (opcional)']
    ];
    return '<section class="clinic-admin-subsection"><h3>' + (readiness.ready ? 'Esta sucursal está lista para agenda' : 'Falta poco para activar esta sucursal') + '</h3><p>' + (readiness.ready ? 'Ya aparece con disponibilidad en la agenda. Puedes ajustar cualquier paso cuando quieras.' : 'Completa los pasos marcados para que la agenda pueda ofrecer citas aquí.') + '</p><div class="clinic-admin-list">' + items.map(function (item) {
      var done = stepDone(readiness, item[0]);
      return '<div class="clinic-admin-row"><span class="clinic-admin-check-icon" data-ready="' + done + '">' + (done ? '✓' : '!') + '</span><div class="clinic-admin-row-main"><strong>' + item[2] + '</strong><small>' + esc(item[3]) + '</small></div><button type="button" data-ca-step-go="' + item[1] + '">' + (done ? 'Editar' : 'Completar') + '</button></div>';
    }).join('') + '</div></section>';
  }

  function renderBranchDetail() {
    var host = document.getElementById('clinic-admin-branch-detail');
    if (!host) return;
    var branch = selectedBranch();
    if (!branch) {
      host.innerHTML = '<div class="clinic-admin-card clinic-admin-empty">Selecciona o crea una sucursal.</div>';
      return;
    }
    if (!branch.active) {
      host.innerHTML = archivedBranchSection(branch);
      host.querySelector('[data-ca-restore-branch]')?.addEventListener('click', function () { restoreBranch(branch); });
      return;
    }
    var readiness = branchReadiness(branch);
    var current = state.branchStep[branch.id] || firstPendingStep(readiness);
    var index = Math.max(0, STEPS.findIndex(function (step) { return step.key === current; }));
    current = STEPS[index].key;
    var steps = '<ol class="clinic-admin-steps" aria-label="Pasos de la sucursal">' + STEPS.map(function (step, i) {
      var done = step.key !== 'resumen' && stepDone(readiness, step.key);
      return '<li><button type="button" data-ca-step-go="' + step.key + '" data-state="' + (step.key === current ? 'current' : done ? 'done' : 'pending') + '"' + (step.key === current ? ' aria-current="step"' : '') + '><b>' + (done && step.key !== current ? '✓' : (i + 1)) + '</b><span>' + step.label + '</span></button></li>';
    }).join('') + '</ol>';
    var body = current === 'datos' ? branchForm(branch) : current === 'operacion' ? '<div class="clinic-admin-operation-grid">' + roomSection(branch) + hoursSection(branch) + '</div>' : current === 'equipo' ? teamSection(branch) : summarySection(branch, readiness);
    var nav = '<div class="clinic-admin-step-nav">' + (index > 0 ? '<button type="button" class="btn btn-secondary" data-ca-step-go="' + STEPS[index - 1].key + '">← Atrás</button>' : '<span></span>') +
      (current !== 'datos' && index < STEPS.length - 1 ? '<button type="button" class="btn btn-primary" data-ca-step-go="' + STEPS[index + 1].key + '">' + (current === 'equipo' ? 'Ver resumen →' : 'Continuar →') + '</button>' : '') + '</div>';
    host.innerHTML = '<article class="clinic-admin-card clinic-admin-wizard"><div class="clinic-admin-section-head clinic-admin-branch-head"><div><span class="pro-eyebrow">SUCURSAL ACTIVA</span><h2>' + esc(branch.name) + '</h2></div><div class="clinic-admin-branch-head-actions"><div class="clinic-admin-badges">' + (branch.is_default ? '<span class="clinic-admin-pill">Sucursal principal</span>' : '') + '<span class="clinic-admin-pill" data-ready="' + readiness.ready + '">' + (readiness.ready ? 'Lista para agenda' : 'Configuración pendiente') + '</span></div>' + (state.canClinic ? '<button type="button" class="btn btn-secondary" data-ca-manage-team>Administrar equipo</button>' + branchActionsMenu(branch, false) : '') + '</div></div>' + steps + '<div class="clinic-admin-step-panel">' + body + '</div>' + nav + '</article>';
    bindBranchActionsMenu(host, branch);
    host.querySelectorAll('[data-ca-step-go]').forEach(function (button) { button.addEventListener('click', function () { goStep(branch.id, button.dataset.caStepGo); }); });
    host.querySelectorAll('[data-ca-manage-team]').forEach(function (button) { button.addEventListener('click', function () { openBranchTeamDialog(branch); }); });
    host.querySelector('[data-ca-go-team]')?.addEventListener('click', function () { goTab('equipo'); });
    host.querySelector('[data-ca-new-professional]')?.addEventListener('click', function () { openProfessionalDialog(branch.id); });
    host.querySelectorAll('[data-ca-open-professional]').forEach(function (button) {
      button.addEventListener('click', function () { openProfessionalById(button.dataset.caOpenProfessional); });
    });
    host.querySelectorAll('[data-ca-remove-professional]').forEach(function (button) {
      button.addEventListener('click', function () {
        var professional = state.professionals.find(function (row) { return row.id === button.dataset.caRemoveProfessional; });
        if (professional) removeProfessionalBranch(professional, branch);
      });
    });
    bindBranchActions(branch);
  }

  function renderOperations() {
    renderBranches(); renderBranchDetail();
  }

  function openProfessionalById(professionalId) {
    if (!state.people.length) state.people = buildPeople();
    var person = state.people.find(function (candidate) {
      return candidate.professional && candidate.professional.id === professionalId;
    });
    if (!person) { feedback('No encontramos la ficha de ese profesional.', 'error'); return; }
    openPerson(person.key);
  }

  async function upcomingAppointments(branchId, professionalId) {
    var builder = window.sb.from('smyl_appointments').select('id,starts_at').eq('tenant_id', state.tenant).eq('branch_id', branchId)
      .gte('starts_at', new Date().toISOString()).in('status', ['confirmed', 'arrived', 'in_progress']).order('starts_at').limit(6);
    if (professionalId) builder = builder.eq('professional_id', professionalId);
    return await query(builder) || [];
  }

  function openBranchTeamDialog(branch) {
    var dialog = document.getElementById('clinic-admin-dialog');
    var professionals = state.professionals.filter(function (row) { return row.active; }).sort(function (a, b) {
      return a.display_name.localeCompare(b.display_name, 'es');
    });
    var assigned = new Set(state.professionalBranches.filter(function (row) { return row.branch_id === branch.id; }).map(function (row) { return row.professional_id; }));
    if (!professionals.length) {
      dialog.innerHTML = '<div class="clinic-admin-dialog-heading"><div><span class="pro-eyebrow">EQUIPO DE LA SUCURSAL</span><h2>Primero agrega un profesional</h2></div></div><p>Cuando esté dado de alta podrás vincularlo a una o varias sucursales y definir un horario diferente en cada una.</p><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cerrar</button><button type="button" class="btn btn-primary" data-ca-create-professional>Agregar profesional</button></div>';
      dialog.querySelector('[data-ca-close]').addEventListener('click', function () { dialog.close(); });
      dialog.querySelector('[data-ca-create-professional]').addEventListener('click', function () { dialog.close(); openProfessionalDialog(branch.id); });
      dialog.showModal(); return;
    }
    dialog.innerHTML = '<form id="clinic-admin-branch-team-form"><div class="clinic-admin-dialog-heading"><div><span class="pro-eyebrow">EQUIPO DE LA SUCURSAL</span><h2>Profesionales en ' + esc(branch.name) + '</h2></div><span class="clinic-admin-dialog-step" data-ca-selection-count>' + assigned.size + ' vinculados</span></div><p>Selecciona quién atiende aquí. Cada profesional puede pertenecer a varias sucursales y conservar un horario distinto en cada una.</p><label class="clinic-admin-search clinic-admin-dialog-search"><span class="clinic-admin-sr">Buscar profesionales</span><input type="search" data-ca-team-search placeholder="Buscar por nombre o especialidad" autocomplete="off"></label><div class="clinic-admin-assignment-list">' + professionals.map(function (professional) {
      var checked = assigned.has(professional.id);
      var hasHours = state.proHours.some(function (row) { return row.professional_id === professional.id && row.branch_id === branch.id; });
      return '<label class="clinic-admin-assignment" data-search="' + esc(plain(professional.display_name + ' ' + professional.specialty)) + '"><input type="checkbox" name="professional" value="' + professional.id + '"' + (checked ? ' checked' : '') + '><span class="clinic-admin-assignment-check" aria-hidden="true">✓</span><span class="clinic-admin-avatar">' + esc(initials(professional.display_name)) + '</span><span class="clinic-admin-assignment-main"><strong>' + esc(professional.display_name) + '</strong><small>' + esc(professional.specialty || 'Odontología general') + '</small></span><span class="clinic-admin-assignment-state" data-ready="' + hasHours + '">' + (checked ? (hasHours ? 'Con horario' : 'Falta horario') : 'Sin vincular') + '</span></label>';
    }).join('') + '</div><p class="clinic-admin-dialog-note">Al desvincular, SMYL conserva citas e historial. Si existen citas futuras, primero tendrás que reasignarlas o cancelarlas.</p><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary" data-ca-save-team>Guardar equipo</button></div></form>';
    var form = dialog.querySelector('form');
    var search = dialog.querySelector('[data-ca-team-search]');
    var count = dialog.querySelector('[data-ca-selection-count]');
    function refreshSelection() {
      var selected = form.querySelectorAll('input[name="professional"]:checked').length;
      count.textContent = selected + (selected === 1 ? ' vinculado' : ' vinculados');
      form.querySelectorAll('.clinic-admin-assignment').forEach(function (row) {
        var input = row.querySelector('input');
        var badge = row.querySelector('.clinic-admin-assignment-state');
        row.dataset.selected = input.checked;
        if (!input.checked) badge.textContent = 'Sin vincular';
        else badge.textContent = badge.dataset.ready === 'true' ? 'Con horario' : 'Falta horario';
      });
    }
    form.querySelectorAll('input[name="professional"]').forEach(function (input) { input.addEventListener('change', refreshSelection); });
    search.addEventListener('input', function () {
      var term = plain(search.value).trim();
      form.querySelectorAll('.clinic-admin-assignment').forEach(function (row) { row.hidden = !!term && row.dataset.search.indexOf(term) === -1; });
    });
    dialog.querySelector('[data-ca-close]').addEventListener('click', function () { dialog.close(); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var selected = new Set(Array.from(form.querySelectorAll('input[name="professional"]:checked')).map(function (input) { return input.value; }));
      var additions = professionals.filter(function (professional) { return selected.has(professional.id) && !assigned.has(professional.id); });
      var removals = professionals.filter(function (professional) { return !selected.has(professional.id) && assigned.has(professional.id); });
      if (!additions.length && !removals.length) { dialog.close(); return; }
      if (removals.length && !window.confirm('¿Desvincular a ' + removals.map(function (row) { return row.display_name; }).join(', ') + ' de esta sucursal? Sus citas e historial se conservarán.')) return;
      var save = dialog.querySelector('[data-ca-save-team]'); save.disabled = true; save.textContent = 'Guardando…';
      var ok = await mutate(async function () {
        for (var i = 0; i < removals.length; i += 1) {
          var appointments = await upcomingAppointments(branch.id, removals[i].id);
          if (appointments.length) throw new Error(removals[i].display_name + ' tiene citas futuras en esta sucursal. Reasígnalas o cancélalas antes de desvincular.');
        }
        for (var a = 0; a < additions.length; a += 1) {
          await query(window.sb.from('smyl_professional_branches').insert({ tenant_id: state.tenant, professional_id: additions[a].id, branch_id: branch.id }).select('professional_id').single());
        }
        for (var r = 0; r < removals.length; r += 1) {
          await query(window.sb.from('smyl_professional_branches').delete().eq('tenant_id', state.tenant).eq('professional_id', removals[r].id).eq('branch_id', branch.id).select('professional_id'));
        }
      }, 'Equipo de ' + branch.name + ' actualizado.');
      save.disabled = false; save.textContent = 'Guardar equipo';
      if (ok) dialog.close();
    });
    refreshSelection(); dialog.showModal(); search.focus();
  }

  async function archiveBranch(branch) {
    if (branch.is_default) { feedback('Elige otra sucursal como principal antes de archivar esta.', 'error'); return; }
    try {
      var appointments = await upcomingAppointments(branch.id);
      if (appointments.length) { feedback('Esta sucursal tiene citas futuras. Reasígnalas o cancélalas antes de archivarla.', 'error'); return; }
    } catch (error) { feedback('No pudimos comprobar las citas futuras. ' + errorMessage(error), 'error'); return; }
    var professionals = state.professionalBranches.filter(function (row) { return row.branch_id === branch.id; }).length;
    var message = '¿Archivar ' + branch.name + '? Dejará de aparecer en la agenda y se conservarán su historial, ' + professionals + (professionals === 1 ? ' profesional vinculado' : ' profesionales vinculados') + ', espacios y horarios.';
    if (!window.confirm(message)) return;
    state.selectedBranch = null;
    await mutate(function () { return query(window.sb.from('smyl_branches').update({ active: false }).eq('tenant_id', state.tenant).eq('id', branch.id).select('id').single()); }, 'Sucursal archivada. Puedes reactivarla desde Archivadas.');
  }

  async function restoreBranch(branch) {
    state.branchFilter = 'active'; state.selectedBranch = branch.id;
    await mutate(function () { return query(window.sb.from('smyl_branches').update({ active: true }).eq('tenant_id', state.tenant).eq('id', branch.id).select('id').single()); }, 'Sucursal reactivada. Revisa sus horarios antes de abrir agenda.');
  }

  // ── Equipo: una sola lista de personas, ficha de cada una y regla de traslado entre sedes ─────────────────────
  var PERSON_STATUS = { active: 'Activo', inactive: 'Inactivo', noaccess: 'Sin acceso', invited: 'Invitación pendiente' };
  var PERSON_FILTERS = [['all', 'Todos'], ['active', 'Activos'], ['pending', 'Invitaciones'], ['inactive', 'Inactivos']];
  var PROFILE_STATUS = { draft: 'Borrador', review: 'En revisión', published: 'Publicado', paused: 'En pausa' };
  var WEEK_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  function plain(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function branchById(id) {
    return state.branches.find(function (branch) { return branch.id === id; }) || null;
  }

  function branchesOfProfessional(professionalId) {
    return state.professionalBranches.filter(function (row) { return row.professional_id === professionalId; })
      .map(function (row) { return branchById(row.branch_id); }).filter(Boolean);
  }

  function minutesOf(time) {
    var parts = String(time || '').split(':');
    return Number(parts[0]) * 60 + Number(parts[1] || 0);
  }

  function conflictsFor(professionalId) {
    return state.conflicts.filter(function (row) { return row.professional_id === professionalId; });
  }

  function buildPeople() {
    var people = [];
    var users = state.users;
    if (state.canTeam && state.tenant && !users.some(function (user) { return user.id === state.tenant; })) {
      users = [{ id: state.tenant, nombre: 'Titular de la clínica', rol: 'dueño', activo: true, legacyTitular: true }].concat(users);
    }
    users.forEach(function (user) {
      var professional = professionalProfileForMember(user.id);
      var role = roleFor(user.id);
      var primary = branchForMember(user.id);
      var branches = professional ? branchesOfProfessional(professional.id) : (primary ? [primary] : []);
      people.push({
        key: 'u:' + user.id, kind: 'user', user: user, professional: professional, doctor: Boolean(professional),
        name: user.nombre || (professional && professional.display_name) || user.email || 'Integrante', email: user.email || '',
        specialty: professional ? (professional.specialty || 'Odontología general') : '', license: professional ? professional.license_number : '',
        roleName: role ? role.name : (user.rol === 'dueño' ? 'Propietario' : 'Sin rol'), branches: branches, status: user.activo ? 'active' : 'inactive', professionalInactive: Boolean(professional && !professional.active)
      });
    });
    state.professionals.filter(function (row) { return !row.user_id; }).forEach(function (professional) {
      people.push({
        key: 'p:' + professional.id, kind: 'profile', professional: professional, doctor: true, name: professional.display_name, email: '',
        specialty: professional.specialty || 'Odontología general', license: professional.license_number, roleName: '',
        branches: branchesOfProfessional(professional.id), status: professional.active ? 'noaccess' : 'inactive', professionalInactive: !professional.active
      });
    });
    state.invitations.filter(function (row) { return row.status === 'pending'; }).forEach(function (invitation) {
      var branch = branchById(invitation.branch_id);
      people.push({
        key: 'i:' + invitation.id, kind: 'invite', invitation: invitation, doctor: invitation.member_kind === 'professional',
        name: invitation.display_name || invitation.email, email: invitation.email || '', specialty: invitation.specialty || '',
        license: invitation.license_number || '', roleName: '', branches: branch ? [branch] : [], status: 'invited'
      });
    });
    return people;
  }

  function matchesFilter(person, filter) {
    if (filter === 'active') return person.kind === 'user' && person.status === 'active';
    if (filter === 'pending') return person.status === 'noaccess' || person.status === 'invited';
    if (filter === 'inactive') return person.status === 'inactive' || person.professionalInactive;
    return true;
  }

  function branchChips(branches, limit) {
    var wrap = el('span', 'clinic-admin-chips');
    branches.slice(0, limit).forEach(function (branch) { wrap.append(el('span', 'clinic-admin-chip', branch.name)); });
    if (branches.length > limit) wrap.append(el('span', 'clinic-admin-chip is-more', '+' + (branches.length - limit)));
    return wrap;
  }

  function personRow(person) {
    var row = el('button', 'clinic-admin-person-row');
    row.type = 'button'; row.dataset.person = person.key; row.dataset.status = person.status;
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', 'Abrir la ficha de ' + person.name);
    row.append(el('span', 'clinic-admin-avatar', initials(person.name)));
    var main = el('span', 'clinic-admin-person-main');
    var title = el('span', 'clinic-admin-person-title');
    title.append(el('strong', '', person.name), el('span', 'clinic-admin-person-kind' + (person.doctor ? '' : ' is-team'), person.doctor ? 'Atiende pacientes' : 'Integrante'));
    var detail = person.doctor ? [person.specialty, person.license ? 'Céd. ' + person.license : ''] : [person.roleName || person.email];
    main.append(title, el('small', '', detail.filter(Boolean).join(' · ') || person.email));
    row.append(main);
    var where = el('span', 'clinic-admin-person-where');
    if (person.branches.length) where.append(branchChips(person.branches, 2));
    else where.append(el('span', 'clinic-admin-muted', person.doctor || person.kind === 'invite' ? 'Sin sede asignada' : ''));
    row.append(where);
    var flags = el('span', 'clinic-admin-person-flags');
    if (person.professional && conflictsFor(person.professional.id).length) {
      var warn = el('span', 'clinic-admin-flag is-warning', 'Horarios muy juntos'); warn.title = 'Tiene horarios en dos sedes con poco margen de traslado.'; flags.append(warn);
    }
    var prep = readiness(person);
    if (prep && !prep.ready) {
      var lack = el('span', 'clinic-admin-flag is-warning', 'Falta ' + prep.missing.map(function (item) { return item.key === 'branch' ? 'sede' : 'horario'; }).join(' y '));
      lack.title = 'No puede recibir citas hasta completarlo.'; flags.append(lack);
    }
    if (person.professionalInactive && person.status !== 'inactive') {
      var inactiveProfessional = el('span', 'clinic-admin-flag', 'Profesional inactivo'); inactiveProfessional.dataset.status = 'inactive'; flags.append(inactiveProfessional);
    }
    var status = el('span', 'clinic-admin-flag', PERSON_STATUS[person.status]); status.dataset.status = person.status; flags.append(status);
    row.append(flags, el('span', 'clinic-admin-person-go', '›'));
    row.addEventListener('click', function () { openPerson(person.key); });
    return row;
  }

  function renderPeople() {
    var host = document.getElementById('clinic-admin-people');
    var filters = document.getElementById('clinic-admin-filters');
    if (!host || !filters) return;
    var people = buildPeople();
    state.people = people;
    filters.replaceChildren();
    PERSON_FILTERS.forEach(function (item) {
      var count = people.filter(function (person) { return matchesFilter(person, item[0]); }).length;
      var button = el('button', 'clinic-admin-filter', item[1] + ' · ' + count);
      button.type = 'button'; button.dataset.filter = item[0];
      button.setAttribute('aria-pressed', String(state.personFilter === item[0]));
      button.addEventListener('click', function () { state.personFilter = item[0]; renderPeople(); });
      filters.append(button);
    });
    var term = plain(state.personQuery).trim();
    var shown = people.filter(function (person) {
      if (!matchesFilter(person, state.personFilter)) return false;
      if (!term) return true;
      return plain([person.name, person.email, person.specialty, person.license, person.roleName, person.branches.map(function (branch) { return branch.name; }).join(' ')].join(' ')).indexOf(term) !== -1;
    });
    host.replaceChildren();
    host.setAttribute('role', 'list'); host.setAttribute('aria-label', 'Personas de la clínica');
    shown.forEach(function (person) { host.append(personRow(person)); });
    if (!shown.length) {
      host.removeAttribute('role');
      host.append(el('div', 'clinic-admin-empty', term ? 'Nadie coincide con «' + state.personQuery.trim() + '».' : (state.personFilter === 'all' ? 'Todavía no hay personas en la clínica.' : 'No hay personas en esta vista.')));
    }
    updateSectionCount('clinic-admin-member-count', shown.length, 'persona', 'personas');
    refreshPerson();
  }

  function renderProfessionals() {
    var host = document.getElementById('clinic-admin-professionals');
    if (!host) return;
    if (!state.people.length) state.people = buildPeople();
    var term = plain(state.professionalQuery).trim();
    var professionals = state.people.filter(function (person) {
      if (!person.doctor) return false;
      if (!term) return true;
      return plain([person.name, person.email, person.specialty, person.license, person.branches.map(function (branch) { return branch.name; }).join(' ')].join(' ')).indexOf(term) !== -1;
    });
    host.replaceChildren();
    host.setAttribute('role', 'list'); host.setAttribute('aria-label', 'Profesionales de la clínica');
    professionals.forEach(function (person) { host.append(personRow(person)); });
    if (!professionals.length) {
      host.removeAttribute('role');
      host.append(el('div', 'clinic-admin-empty', term ? 'Ningún profesional coincide con «' + state.professionalQuery.trim() + '».' : 'Todavía no hay profesionales. Invita al primero para configurar sus sedes y horarios.'));
    }
    updateSectionCount('clinic-admin-professional-count', professionals.length, 'profesional', 'profesionales');
  }

  function renderTravel() {
    var card = document.getElementById('clinic-admin-travel-card');
    var host = document.getElementById('clinic-admin-travel');
    if (!card || !host) return;
    card.hidden = !state.travelSupported;
    if (!state.travelSupported) return;
    host.replaceChildren();
    var row = el('div', 'clinic-admin-travel-row');
    var label = el('label', '', 'Margen de traslado'); label.setAttribute('for', 'clinic-admin-travel-minutes');
    var input = el('input'); input.type = 'number'; input.id = 'clinic-admin-travel-minutes'; input.min = '0'; input.max = '240'; input.step = '5';
    input.value = String(state.travelMargin); input.disabled = !state.canClinic;
    row.append(label, input, el('span', 'clinic-admin-muted', 'minutos'));
    if (state.canClinic) {
      var save = el('button', 'btn btn-secondary', 'Guardar margen'); save.type = 'button';
      save.addEventListener('click', function () {
        var minutes = Number(input.value);
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) { feedback('El margen debe estar entre 0 y 240 minutos.', 'error'); return; }
        mutate(function () { return query(window.sb.rpc('smyl_set_professional_travel_margin', { p_minutes: minutes })); }, 'Margen de traslado actualizado.');
      });
      row.append(save);
    }
    host.append(row);
    if (!state.canClinic) host.append(el('p', 'clinic-admin-hint', 'Solo el administrador puede cambiar este margen.'));
    if (!state.canScheduleRead) return;
    if (!state.conflicts.length) { host.append(el('p', 'clinic-admin-ok', 'Ningún profesional tiene horarios muy juntos entre sedes.')); return; }
    var list = el('div', 'clinic-admin-conflicts');
    list.append(el('strong', '', state.conflicts.length === 1 ? 'Hay 1 horario por corregir' : 'Hay ' + state.conflicts.length + ' horarios por corregir'));
    var seen = {};
    state.conflicts.forEach(function (item) {
      var professional = state.professionals.find(function (candidate) { return candidate.id === item.professional_id; });
      if (!professional || seen[professional.id]) return;
      seen[professional.id] = true;
      var open = el('button', 'clinic-admin-conflict', professional.display_name + ' · ver detalle'); open.type = 'button';
      open.addEventListener('click', function () {
        var person = (state.people || []).find(function (candidate) { return candidate.professional && candidate.professional.id === professional.id; });
        if (person) openPerson(person.key);
      });
      list.append(open);
    });
    host.append(list);
  }

  function setTeamView(view, activateTab) {
    state.teamView = ['people', 'roles', 'professionals'].indexOf(view) !== -1 ? view : 'people';
    if (activateTab !== false) setTab('equipo');
    document.querySelectorAll('[data-ca-team-view]').forEach(function (button) {
      var selected = button.dataset.caTeamView === state.teamView;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-ca-team-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.caTeamPanel !== state.teamView;
    });
  }

  function renderTeam() {
    renderPeople();
    renderProfessionals();
    renderTravel();
    var professionalButton = document.getElementById('clinic-admin-add-professional');
    if (professionalButton) professionalButton.hidden = !state.canTeam;
    var memberButton = document.getElementById('clinic-admin-add-member');
    if (memberButton) memberButton.hidden = !state.canAssignRoles;
    var roleButton = document.getElementById('clinic-admin-add-role');
    if (roleButton) roleButton.hidden = !state.canAssignRoles;
    renderRoleGuide();
    setTeamView(state.teamView, false);
  }

  // ── Ficha de una persona ──────────────────────────────────────────────────────────────────────────────────────
  function sheet() { return document.getElementById('clinic-admin-person'); }

  function currentPerson() {
    return (state.people || []).find(function (person) { return person.key === state.person; }) || null;
  }

  function openPerson(key) {
    state.chatProfile = null;
    state.person = key; state.editing = false; state.hoursDraft = null;
    var dialog = sheet();
    if (!dialog || !currentPerson()) return;
    renderPerson();
    if (!dialog.open) dialog.showModal();
  }

  function closePerson() {
    var dialog = sheet();
    state.chatProfile = null;
    state.person = null; state.editing = false; state.hoursDraft = null;
    if (dialog && dialog.open) dialog.close();
  }

  // Tras cualquier cambio la lista se vuelve a pintar: la ficha abierta se actualiza o, si la persona ya no está, se cierra.
  function refreshPerson() {
    var dialog = sheet();
    if (!dialog || !dialog.open || !state.person) return;
    if (!currentPerson()) { closePerson(); return; }
    renderPerson();
  }

  function sheetSection(title, hint) {
    var section = el('section', 'clinic-admin-sheet-section');
    section.append(el('h3', '', title));
    if (hint) section.append(el('p', 'clinic-admin-hint', hint));
    return section;
  }

  var CHAT_PROFILES = {
    none: ['Sin acceso', 'Esta persona queda fuera de Mensajes.'],
    agent: ['Atiende', 'Ve sus conversaciones asignadas, responde y puede transferirlas con una nota privada.'],
    coordinator: ['Coordina', 'Distribuye conversaciones sin asignar y da seguimiento a las del equipo dentro de su alcance.']
  };

  function memberChatSection(person) {
    var previous = state.chatProfile;
    if (previous && previous.userId === person.user.id && previous.tenant === state.tenant && previous.actor === state.actor) return previous.section;
    var section = sheetSection('Chat');
    var session = { userId: person.user.id, tenant: state.tenant, actor: state.actor, section: section };
    state.chatProfile = session;
    var row, team, busy = false;
    var controls = el('div', 'clinic-admin-chat-controls');
    var status = el('p', 'clinic-admin-hint'); status.setAttribute('role', 'status');
    section.append(controls, status);

    function current() {
      return state.chatProfile === session && state.person === person.key && state.canTeam &&
        window.tenantId === session.tenant && state.actor === session.actor;
    }

    function showFields() {
      var label = el('label', 'clinic-admin-sheet-field');
      var select = el('select'); select.name = 'chat_profile';
      Object.keys(CHAT_PROFILES).forEach(function (mode) { select.append(new Option(CHAT_PROFILES[mode][0], mode)); });
      select.value = row.chat_mode;
      label.append(el('span', '', 'Perfil de chat'), select);
      var hint = el('p', 'clinic-admin-hint');
      var destination = el('label', 'clinic-admin-sheet-field');
      var target = el('select'); target.name = 'chat_destination';
      var count = Number(row.assigned_count);
      var chats = count === 1 ? '1 conversación asignada' : count + ' conversaciones asignadas';
      destination.append(el('span', '', 'Destino de ' + (count === 1 ? 'la conversación asignada' : 'las ' + count + ' conversaciones asignadas')), target);
      target.append(new Option('Elige un destino', ''), new Option('Devolver a Sin asignar', 'queue'));
      var recipients = el('optgroup'); recipients.label = 'Transferir a';
      team.filter(function (item) {
        return item.active && item.user_id !== session.userId && (item.chat_mode === 'agent' || item.chat_mode === 'coordinator');
      }).forEach(function (item) { recipients.append(new Option(item.name, item.user_id)); });
      if (recipients.children.length) target.append(recipients);
      var save = el('button', 'btn btn-primary'); save.type = 'button';
      function update() {
        var mode = select.value;
        var needsDestination = mode === 'none' && count > 0;
        hint.textContent = CHAT_PROFILES[mode][1] + (count > 0 ? ' Actualmente tiene ' + chats + '.' : '');
        destination.hidden = !needsDestination;
        save.hidden = mode === row.chat_mode;
        save.disabled = busy || (needsDestination && !target.value);
        save.textContent = needsDestination && target.value ? (target.value === 'queue' ? 'Devolver chats y quitar acceso' : 'Transferir chats y quitar acceso') : 'Guardar perfil de chat';
      }
      select.addEventListener('change', function () { target.value = ''; status.textContent = ''; update(); });
      target.addEventListener('change', update);
      save.addEventListener('click', async function () {
        if (!current() || save.disabled || save.hidden || busy) return;
        busy = true;
        var mode = select.value;
        var dest = !destination.hidden ? target.value : '';
        select.disabled = target.disabled = save.disabled = true;
        status.textContent = 'Guardando perfil…';
        try {
          var result = await query(window.sb.rpc('smyl_set_chat_access', {
            p_user_id: session.userId, p_mode: mode, p_expected_mode: row.chat_mode,
            p_disposition: dest ? (dest === 'queue' ? 'queue' : 'transfer') : null,
            p_replacement_id: dest && dest !== 'queue' ? dest : null
          }));
          if (!result || result.user_id !== session.userId || result.chat_mode !== mode) throw new Error('unconfirmed');
          window.dispatchEvent(new CustomEvent('smyl:chat-access-changed', { detail: { userId: session.userId } }));
          if (!current()) return;
          var moved = Number(result.moved);
          var message = 'Perfil guardado.';
          if (moved > 0) {
            var recipient = team.find(function (item) { return item.user_id === dest; });
            message += ' ' + (moved === 1 ? '1 conversación pasó' : moved + ' conversaciones pasaron') + ' a ' + (recipient ? recipient.name : 'Sin asignar') + '.';
          }
          await loadSettings(message);
        } catch (error) {
          if (!current()) return;
          var message = error && error.code === '42501' ? 'Tu cuenta no tiene permiso para este cambio.' :
            error && error.code === '40001' ? 'La asignación cambió. Revisa el perfil y el destino antes de guardar.' :
            'No pudimos confirmar el cambio. Revisa la configuración antes de volver a guardar.';
          await loadSettings(message);
        }
      });
      controls.replaceChildren(label, hint, destination, save);
      update();
    }

    async function loadSettings(message) {
      busy = true;
      controls.replaceChildren(); status.textContent = 'Consultando perfil de chat…'; if (window.SmylSkeleton) controls.append(window.SmylSkeleton.node('text', { lines: 2, label: 'Consultando perfil de chat' }));
      try {
        var rows = await query(window.sb.rpc('smyl_chat_team_settings'));
        if (!current()) return;
        team = Array.isArray(rows) ? rows : [];
        row = team.find(function (item) { return item.user_id === session.userId && item.active; });
        if (!row || !Object.hasOwn(CHAT_PROFILES, row.chat_mode)) throw new Error('unavailable');
        busy = false;
        showFields();
        status.textContent = message || '';
        if (message) controls.querySelector('select').focus();
      } catch (error) {
        if (!current()) return;
        busy = false;
        status.textContent = (message ? message + ' ' : '') + 'No pudimos consultar el perfil de chat.';
        var retry = el('button', 'btn btn-secondary', 'Volver a consultar'); retry.type = 'button';
        retry.addEventListener('click', function () { if (!busy && current()) loadSettings(); });
        controls.replaceChildren(retry);
      }
    }
    loadSettings();
    return section;
  }

  function sheetRow(label, value, href) {
    var row = el('div', 'clinic-admin-sheet-row');
    row.append(el('span', '', label));
    var content;
    if (value && href) { content = el('a', '', value); content.href = href; } else { content = el('strong', '', value || 'Sin registrar'); if (!value) content.className = 'is-empty'; }
    row.append(content);
    return row;
  }

  function goToAgendaSettings() {
    closePerson();
    if (typeof window.ir !== 'function') return;
    window.ir('agenda');
    var tries = 0;
    (function ready() {
      var tab = document.querySelector('.pantalla.activa [data-schedule-tab="settings"]');
      if (tab) return tab.click();
      if (tries++ < 60) setTimeout(ready, 50);
    })();
  }

  function hoursSummary(professional, branch) {
    var blocks = state.proHours.filter(function (row) { return row.professional_id === professional.id && row.branch_id === branch.id; })
      .sort(function (a, b) { return (a.weekday - b.weekday) || minutesOf(a.starts_at) - minutesOf(b.starts_at); });
    if (!blocks.length) return 'Sin horario configurado';
    return blocks.map(function (row) { return WEEK_SHORT[row.weekday] + ' ' + timeLabel(row.starts_at) + '–' + timeLabel(row.ends_at); }).join(' · ');
  }

  function conflictText(item) {
    var a = branchById(item.branch_a), b = branchById(item.branch_b);
    var gap = Number(item.gap_minutes);
    var days = DAYS[item.weekday];
    var how = gap < 0 ? 'se traslapan' : 'solo hay ' + gap + ' min entre ellos';
    return days + ': ' + (a ? a.name : 'una sede') + ' (' + timeLabel(item.starts_a) + '–' + timeLabel(item.ends_a) + ') y ' + (b ? b.name : 'otra sede') + ' (' + timeLabel(item.starts_b) + '–' + timeLabel(item.ends_b) + '): ' + how + '. Se necesitan ' + item.required_minutes + ' min.';
  }

  // ── Horario semanal del profesional en una sede (se edita desde su ficha) ──
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function startHoursDraft(professional, branch) {
    var days = {};
    WEEK_ORDER.forEach(function (day) { days[day] = []; });
    state.proHours.filter(function (row) { return row.professional_id === professional.id && row.branch_id === branch.id; })
      .sort(function (a, b) { return minutesOf(a.starts_at) - minutesOf(b.starts_at); })
      .forEach(function (row) { days[row.weekday].push({ id: row.id, start: timeLabel(row.starts_at), end: timeLabel(row.ends_at) }); });
    state.hoursDraft = { professionalId: professional.id, branchId: branch.id, days: days };
  }

  function branchHoursText(branch) {
    var rows = state.hours.filter(function (row) { return row.active && row.branch_id === branch.id; })
      .sort(function (a, b) { return ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || minutesOf(a.starts_at) - minutesOf(b.starts_at); });
    if (!rows.length) return 'La sucursal aún no tiene horario: configúralo en Sucursales antes de asignar horas.';
    return 'Horario de la sucursal: ' + rows.map(function (row) { return WEEK_SHORT[row.weekday] + ' ' + timeLabel(row.starts_at) + '–' + timeLabel(row.ends_at); }).join(' · ');
  }

  function draftProblem(draft) {
    for (var i = 0; i < WEEK_ORDER.length; i += 1) {
      var day = WEEK_ORDER[i], blocks = draft.days[day].slice().sort(function (a, b) { return minutesOf(a.start) - minutesOf(b.start); });
      for (var j = 0; j < blocks.length; j += 1) {
        if (!blocks[j].start || !blocks[j].end) return DAYS[day] + ': completa la hora de inicio y de fin.';
        if (minutesOf(blocks[j].end) <= minutesOf(blocks[j].start)) return DAYS[day] + ': la hora de fin debe ser después del inicio.';
        if (j && minutesOf(blocks[j].start) < minutesOf(blocks[j - 1].end)) return DAYS[day] + ': dos bloques se traslapan.';
      }
    }
    return '';
  }

  function hoursEditor(professional, branch) {
    var draft = state.hoursDraft;
    var box = el('div', 'clinic-admin-hours-editor');
    box.append(el('p', 'clinic-admin-hint', branchHoursText(branch)));
    var list = el('div', 'clinic-admin-hours-days');
    WEEK_ORDER.forEach(function (day) {
      var blocks = draft.days[day];
      var row = el('div', 'clinic-admin-hours-day' + (blocks.length ? '' : ' is-off'));
      var label = el('label', 'clinic-admin-hours-toggle');
      var check = el('input'); check.type = 'checkbox'; check.checked = blocks.length > 0; check.setAttribute('aria-label', 'Atiende el ' + DAYS[day].toLowerCase());
      check.addEventListener('change', function () {
        draft.days[day] = check.checked ? [{ start: '09:00', end: '14:00' }] : [];
        renderPerson();
      });
      label.append(check, el('strong', '', WEEK_SHORT[day]));
      row.append(label);
      var cells = el('div', 'clinic-admin-hours-blocks');
      if (!blocks.length) cells.append(el('span', 'clinic-admin-muted', 'No atiende'));
      blocks.forEach(function (block, index) {
        var line = el('div', 'clinic-admin-hours-block');
        var from = el('input'); from.type = 'time'; from.value = block.start; from.setAttribute('aria-label', 'Desde, ' + DAYS[day]);
        var to = el('input'); to.type = 'time'; to.value = block.end; to.setAttribute('aria-label', 'Hasta, ' + DAYS[day]);
        from.addEventListener('change', function () { block.start = from.value; });
        to.addEventListener('change', function () { block.end = to.value; });
        line.append(from, el('span', '', 'a'), to);
        if (blocks.length > 1) {
          var drop = el('button', 'clinic-admin-link-danger', 'Quitar'); drop.type = 'button';
          drop.addEventListener('click', function () { blocks.splice(index, 1); renderPerson(); });
          line.append(drop);
        }
        cells.append(line);
      });
      if (blocks.length && blocks.length < 3) {
        var more = el('button', 'clinic-admin-link', '+ Otro bloque'); more.type = 'button';
        more.addEventListener('click', function () {
          var last = blocks[blocks.length - 1];
          var start = Math.min(minutesOf(last.end) + 60, 22 * 60), end = Math.min(start + 180, 23 * 60 + 59);
          function hm(total) { return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0'); }
          blocks.push({ start: hm(start), end: hm(end) }); renderPerson();
        });
        cells.append(more);
      }
      row.append(cells); list.append(row);
    });
    box.append(list);
    var tools = el('div', 'clinic-admin-hours-tools');
    var copy = el('button', 'clinic-admin-link', 'Copiar el lunes a martes–viernes'); copy.type = 'button';
    copy.addEventListener('click', function () {
      var monday = draft.days[1].map(function (block) { return { start: block.start, end: block.end }; });
      [2, 3, 4, 5].forEach(function (day) { draft.days[day] = monday.map(function (block) { return { start: block.start, end: block.end }; }); });
      renderPerson();
    });
    tools.append(copy); box.append(tools);
    var actions = el('div', 'clinic-admin-sheet-actions');
    var save = el('button', 'btn btn-primary', 'Guardar horario'); save.type = 'button';
    var cancel = el('button', 'btn btn-secondary', 'Cancelar'); cancel.type = 'button';
    cancel.addEventListener('click', function () { state.hoursDraft = null; renderPerson(); });
    save.addEventListener('click', function () { saveHours(professional, branch); });
    actions.append(save, cancel); box.append(actions);
    return box;
  }

  async function saveHours(professional, branch) {
    var draft = state.hoursDraft; if (!draft) return;
    var problem = draftProblem(draft);
    if (problem) { feedback(problem, 'error'); return; }
    var current = state.proHours.filter(function (row) { return row.professional_id === professional.id && row.branch_id === branch.id; });
    var wanted = [];
    WEEK_ORDER.forEach(function (day) { draft.days[day].forEach(function (block) { wanted.push({ weekday: day, starts_at: block.start, ends_at: block.end }); }); });
    function same(row, item) { return row.weekday === item.weekday && timeLabel(row.starts_at) === item.starts_at && timeLabel(row.ends_at) === item.ends_at; }
    var removed = current.filter(function (row) { return !wanted.some(function (item) { return same(row, item); }); });
    var added = wanted.filter(function (item) { return !current.some(function (row) { return same(row, item); }); });
    if (!removed.length && !added.length) { state.hoursDraft = null; renderPerson(); return; }
    var ok = await mutate(async function () {
      var ids = removed.map(function (row) { return row.id; });
      if (ids.length) await query(window.sb.from('smyl_professional_hours').update({ active: false }).eq('tenant_id', state.tenant).in('id', ids).select('id'));
      if (added.length) {
        try {
          await query(window.sb.from('smyl_professional_hours').upsert(added.map(function (item) {
            return { tenant_id: state.tenant, professional_id: professional.id, branch_id: branch.id, weekday: item.weekday, starts_at: item.starts_at, ends_at: item.ends_at, active: true };
          }), { onConflict: 'tenant_id,professional_id,branch_id,weekday,starts_at,ends_at' }).select('id'));
        } catch (error) {
          // Si el cambio no cabe (traslape, fuera del horario de la sucursal), se devuelven los bloques que se habían quitado.
          if (ids.length) await soft(query(window.sb.from('smyl_professional_hours').update({ active: true }).eq('tenant_id', state.tenant).in('id', ids).select('id')), null);
          throw error;
        }
      }
    }, 'Horario de ' + professional.display_name + ' guardado en ' + branch.name + '.');
    if (ok) { state.hoursDraft = null; refreshPerson(); }
  }

  function personEditForm(person) {
    var professional = person.professional;
    var form = el('form', 'clinic-admin-sheet-form');
    function field(id, label, value, attrs) {
      var wrap = el('label', 'clinic-admin-sheet-field'); wrap.append(el('span', '', label));
      var input = el('input'); input.name = id; input.value = value || '';
      Object.keys(attrs || {}).forEach(function (key) { input.setAttribute(key, attrs[key]); });
      wrap.append(input); form.append(wrap); return input;
    }
    field('display_name', 'Nombre', professional.display_name, { required: 'required', minlength: '2', maxlength: '120', autocomplete: 'off' });
    field('specialty', 'Especialidad', professional.specialty, { maxlength: '80' });
    field('license_number', 'Cédula profesional', professional.license_number, { maxlength: '30' });
    if (state.credentialsSupported) {
      field('license_institution', 'Institución que expidió el título', professional.license_institution, { maxlength: '120', placeholder: 'Ej. Universidad de Guadalajara' });
      field('specialty_license', 'Cédula de especialidad (si aplica)', professional.specialty_license, { maxlength: '30' });
      form.append(el('p', 'clinic-admin-hint', 'Aparecen en tus recetas, en tus notas firmadas y en tu perfil público (la Ley General de Salud, art. 83, pide mostrar la institución que expidió el título).'));
    }
    if (state.phoneSupported) field('phone', 'Teléfono interno', professional.phone, { type: 'tel', inputmode: 'tel', maxlength: '40', pattern: '[0-9 +.\\(\\)\\-]{0,40}', placeholder: 'Ej. 33 1234 5678', autocomplete: 'off' });
    if (state.contactSupported) {
      field('contact_phone', 'WhatsApp del profesional', professional.contact_phone, { type: 'tel', inputmode: 'tel', maxlength: '40', pattern: '[0-9 +.\\(\\)\\-]{0,40}', placeholder: 'Ej. 33 1234 5678', autocomplete: 'off' });
      form.append(el('p', 'clinic-admin-hint', 'Es el número donde SMYL le avisará de sus citas para que atienda el chat. No se muestra a los pacientes.'));
      var shareWrap = el('label', 'clinic-admin-sheet-check');
      var share = el('input'); share.type = 'checkbox'; share.name = 'contact_phone_public'; share.checked = !!professional.contact_phone_public;
      shareWrap.append(share, el('span', '', 'Compartir este número con los pacientes en los mensajes de cita'));
      form.append(shareWrap);
    }
    var actions = el('div', 'clinic-admin-sheet-actions');
    var save = el('button', 'btn btn-primary', 'Guardar'); save.type = 'submit';
    var cancel = el('button', 'btn btn-secondary', 'Cancelar'); cancel.type = 'button';
    cancel.addEventListener('click', function () { state.editing = false; renderPerson(); });
    actions.append(save, cancel); form.append(actions);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var changes = {
        display_name: String(data.get('display_name') || '').trim(),
        specialty: String(data.get('specialty') || '').trim(),
        license_number: String(data.get('license_number') || '').trim()
      };
      if (state.phoneSupported) changes.phone = String(data.get('phone') || '').trim();
      if (state.credentialsSupported) {
        changes.license_institution = String(data.get('license_institution') || '').trim();
        changes.specialty_license = String(data.get('specialty_license') || '').trim();
      }
      if (state.contactSupported) {
        changes.contact_phone = String(data.get('contact_phone') || '').trim();
        changes.contact_phone_public = data.get('contact_phone_public') === 'on' && !!changes.contact_phone;
      }
      if (changes.display_name.length < 2) { feedback('Escribe el nombre del profesional.', 'error'); return; }
      var ok = await mutate(function () {
        return query(window.sb.from('smyl_professionals').update(changes).eq('tenant_id', state.tenant).eq('id', professional.id).select('id').single());
      }, 'Datos del profesional guardados.');
      if (ok) { state.editing = false; refreshPerson(); }
    });
    return form;
  }

  // ── ¿Está listo el doctor para recibir citas? (sede + horario son indispensables; WhatsApp y acceso se recomiendan) ──
  function readiness(person) {
    var professional = person.professional;
    if (!professional || !person.doctor || !professional.active) return null;
    var assigned = branchesOfProfessional(professional.id);
    var items = [{ key: 'branch', required: true, ok: assigned.length > 0, label: 'Sede asignada', todo: 'Asígnalo a una sede en «Dónde trabaja».' }];
    if (state.canScheduleRead) {
      var withHours = assigned.filter(function (branch) {
        return state.proHours.some(function (row) { return row.professional_id === professional.id && row.branch_id === branch.id; });
      });
      items.push({ key: 'hours', required: true, ok: withHours.length > 0, label: 'Horario de atención', todo: assigned.length ? 'Define sus días y horas con «Editar horario».' : 'Primero asígnalo a una sede.' });
    }
    if (state.contactSupported) items.push({ key: 'whatsapp', required: false, ok: !!String(professional.contact_phone || '').trim(), label: 'WhatsApp para avisos', todo: 'Captúralo en «Editar datos» para avisarle de sus citas.' });
    items.push({ key: 'access', required: false, ok: person.kind === 'user', label: 'Acceso a SMYL', todo: 'Invítalo para que atienda el chat desde SMYL.' });
    var missing = items.filter(function (item) { return item.required && !item.ok; });
    return { items: items, ready: missing.length === 0, missing: missing };
  }

  function readinessSection(person) {
    var state_ = readiness(person);
    if (!state_) return null;
    var section = sheetSection(state_.ready ? 'Listo para recibir citas' : 'Falta para recibir citas', state_.ready ? 'Ya aparece disponible al agendar.' : 'Hasta completarlo no se le podrán agendar citas.');
    section.className += ' clinic-admin-ready' + (state_.ready ? ' is-ready' : '');
    var list = el('ul', 'clinic-admin-ready-list');
    state_.items.forEach(function (item) {
      var line = el('li', item.ok ? 'is-ok' : (item.required ? 'is-missing' : 'is-optional'));
      line.append(el('span', 'clinic-admin-ready-mark', item.ok ? '✓' : (item.required ? '!' : '•')));
      var text = el('span', 'clinic-admin-ready-text'); text.append(el('strong', '', item.label + (item.required || item.ok ? '' : ' (recomendado)')));
      if (!item.ok) text.append(el('small', '', item.todo));
      line.append(text); list.append(line);
    });
    section.append(list);
    return section;
  }

  function renderPerson() {
    var dialog = sheet(); var person = currentPerson();
    if (!dialog || !person) return;
    var professional = person.professional;
    // Al redibujar la ficha (marcar un día, quitar un bloque, cambiar un servicio…) se conserva el desplazamiento y el foco: antes todo saltaba arriba.
    var previous = dialog.querySelector('.clinic-admin-sheet-body');
    var keepTop = previous && dialog.dataset.personKey === String(person.key || person.name) ? previous.scrollTop : 0;
    var active = document.activeElement && dialog.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    dialog.dataset.personKey = String(person.key || person.name);
    dialog.replaceChildren();
    dialog.setAttribute('aria-label', 'Ficha de ' + person.name);

    var head = el('header', 'clinic-admin-sheet-head');
    head.append(el('span', 'clinic-admin-avatar is-large', initials(person.name)));
    var who = el('div', 'clinic-admin-sheet-who');
    var name = el('h2', '', person.name); name.id = 'clinic-admin-person-title';
    var meta = el('div', 'clinic-admin-sheet-meta');
    meta.append(el('span', 'clinic-admin-person-kind' + (person.doctor ? '' : ' is-team'), person.doctor ? 'Profesional' : 'Equipo'));
    var status = el('span', 'clinic-admin-flag', PERSON_STATUS[person.status]); status.dataset.status = person.status; meta.append(status);
    if (person.professionalInactive && person.status !== 'inactive') {
      var professionalStatus = el('span', 'clinic-admin-flag', 'Profesional inactivo'); professionalStatus.dataset.status = 'inactive'; meta.append(professionalStatus);
    }
    who.append(name, meta);
    var close = el('button', 'clinic-admin-sheet-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Cerrar la ficha');
    close.addEventListener('click', closePerson);
    head.append(who, close);
    dialog.append(head);

    var body = el('div', 'clinic-admin-sheet-body');
    var ready = readinessSection(person);
    if (ready) body.append(ready);

    // Datos de contacto y profesionales
    var data = sheetSection('Datos');
    if (state.editing && professional && state.canTeam) data.append(personEditForm(person));
    else {
      if (person.doctor) {
        data.append(sheetRow('Especialidad', person.specialty), sheetRow('Cédula profesional', person.license));
        if (state.contactSupported && professional) data.append(sheetRow('WhatsApp (avisos de citas)', professional.contact_phone ? professional.contact_phone + (professional.contact_phone_public ? ' · visible para pacientes' : ' · solo uso interno') : '', ''));
        if (state.phoneSupported && professional) data.append(sheetRow('Teléfono interno', professional.phone, professional.phone ? 'tel:' + professional.phone.replace(/[^0-9+]/g, '') : ''));
      }
      data.append(sheetRow('Correo', person.email, person.email ? 'mailto:' + person.email : ''));
      if (person.roleName) data.append(sheetRow('Rol', person.roleName));
      if (professional && state.canTeam) {
        var edit = el('button', 'btn btn-secondary clinic-admin-sheet-edit', 'Editar datos'); edit.type = 'button';
        edit.addEventListener('click', function () { state.editing = true; renderPerson(); });
        data.append(edit);
      }
    }
    body.append(data);
    if (state.canTeam && person.kind === 'user' && person.user.activo) body.append(memberChatSection(person));
    else state.chatProfile = null;

    // Dónde trabaja
    if (professional) {
      var where = sheetSection('Dónde trabaja', 'Sedes donde atiende y su horario en cada una.');
      var assigned = branchesOfProfessional(professional.id);
      if (!assigned.length) where.append(el('p', 'clinic-admin-muted', 'Todavía no tiene sedes asignadas.'));
      assigned.forEach(function (branch) {
        var item = el('div', 'clinic-admin-sheet-branch');
        var text = el('div'); text.append(el('strong', '', branch.name), el('small', '', state.canScheduleRead ? hoursSummary(professional, branch) : 'Horario no disponible para tu rol'));
        item.append(text);
        if (state.canScheduleManage && state.canScheduleRead && !(state.hoursDraft && state.hoursDraft.branchId === branch.id)) {
          var editHours = el('button', 'clinic-admin-link', 'Editar horario'); editHours.type = 'button';
          editHours.setAttribute('aria-label', 'Editar el horario de ' + professional.display_name + ' en ' + branch.name);
          editHours.addEventListener('click', function () { startHoursDraft(professional, branch); renderPerson(); });
          item.append(editHours);
        }
        if (state.canClinic) {
          var remove = el('button', 'clinic-admin-link-danger', 'Quitar'); remove.type = 'button';
          remove.setAttribute('aria-label', 'Quitar a ' + professional.display_name + ' de ' + branch.name);
          remove.addEventListener('click', function () { removeProfessionalBranch(professional, branch); });
          item.append(remove);
        }
        where.append(item);
        if (state.hoursDraft && state.hoursDraft.branchId === branch.id && state.hoursDraft.professionalId === professional.id) where.append(hoursEditor(professional, branch));
      });
      var free = state.branches.filter(function (branch) { return branch.active && !assigned.some(function (item) { return item.id === branch.id; }); });
      if (state.canClinic && free.length) {
        var add = el('div', 'clinic-admin-sheet-add');
        var select = el('select'); select.setAttribute('aria-label', 'Sede a asignar');
        select.append(new Option('Agregar a una sede…', ''));
        free.forEach(function (branch) { select.append(new Option(branch.name, branch.id)); });
        var addButton = el('button', 'btn btn-secondary', 'Asignar'); addButton.type = 'button';
        addButton.addEventListener('click', function () { if (select.value) addProfessionalBranch(professional.id, select.value); });
        add.append(select, addButton); where.append(add);
      }
      conflictsFor(professional.id).forEach(function (item) { var warn = el('p', 'clinic-admin-callout', conflictText(item)); warn.setAttribute('role', 'status'); where.append(warn); });
      var agenda = el('button', 'clinic-admin-link', 'Editar horarios en la Agenda →'); agenda.type = 'button';
      agenda.addEventListener('click', goToAgendaSettings); where.append(agenda);
      body.append(where);
      body.append(servicesSection(professional));
    }

    // Acceso a SMYL
    var access = sheetSection('Acceso a SMYL');
    if (person.kind === 'user') {
      var user = person.user;
      var roleField = el('label', 'clinic-admin-sheet-field'); roleField.append(el('span', '', 'Rol'));
      var roleSelect = el('select'); roleSelect.setAttribute('aria-label', 'Rol de ' + person.name);
      var currentRole = roleFor(user.id);
      state.roles.filter(function (role) { return role.active && (user.rol === 'dueño' ? role.code === 'propietario' : role.code !== 'propietario'); })
        .forEach(function (role) { roleSelect.append(new Option(role.name, role.id)); });
      roleSelect.value = currentRole ? currentRole.id : '';
      roleSelect.disabled = !state.canAssignRoles || user.rol === 'dueño' || !user.activo;
      roleSelect.addEventListener('change', function () { setMemberRole(user.id, roleSelect.value); });
      roleField.append(roleSelect); access.append(roleField);
      var branchField = el('label', 'clinic-admin-sheet-field'); branchField.append(el('span', '', 'Sede principal'));
      var branchSelect = el('select'); branchSelect.setAttribute('aria-label', 'Sede principal de ' + person.name);
      var currentBranch = branchForMember(user.id);
      branchSelect.append(new Option('Sin sede principal', ''));
      state.branches.filter(function (branch) { return branch.active; }).forEach(function (branch) { branchSelect.append(new Option(branch.name, branch.id)); });
      branchSelect.value = currentBranch ? currentBranch.id : '';
      branchSelect.disabled = !state.canClinic || !user.activo || !!user.legacyTitular;
      branchSelect.addEventListener('change', function () {
        if (branchSelect.value) setMemberBranch(user.id, branchSelect.value); else branchSelect.value = currentBranch ? currentBranch.id : '';
      });
      branchField.append(branchSelect); access.append(branchField);
      if (!state.canAssignRoles) access.append(el('p', 'clinic-admin-hint', 'Solo el administrador puede cambiar el rol y la sede principal.'));
    } else if (person.kind === 'profile') {
      access.append(el('p', 'clinic-admin-muted', 'Este perfil profesional no tiene acceso a SMYL. Puedes invitarlo desde Agenda > Profesionales.'));
    } else {
      var expires = person.invitation.expires_at ? new Date(person.invitation.expires_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : '';
      access.append(el('p', 'clinic-admin-muted', 'Invitación enviada a ' + person.email + (expires ? '. Vence el ' + expires + '.' : '.')));
    }
    body.append(access);

    // Perfil público del directorio
    if (professional) {
      var pub = sheetSection('Perfil público');
      var profile = state.profiles.find(function (row) { return row.professional_id === professional.id; });
      pub.append(sheetRow('Directorio profesional', profile ? (PROFILE_STATUS[profile.status] || profile.status) : 'Sin perfil'));
      var open = el('button', 'clinic-admin-link', 'Abrir el directorio profesional →'); open.type = 'button';
      open.addEventListener('click', function () { closePerson(); if (typeof window.ir === 'function') window.ir('directorio'); });
      pub.append(open); body.append(pub);
    }

    // Zona delicada: los accesos y la disponibilidad profesional se administran por separado.
    var canDeactivate = state.canTeam && !(person.user && person.user.rol === 'dueño') && (person.kind === 'user' || person.kind === 'profile');
    if (canDeactivate) {
      var danger = sheetSection('Zona delicada', 'Nada se borra: los registros y las citas anteriores se conservan.');
      danger.className += ' is-danger';
      if (person.kind === 'user') {
        var accessToggle = el('button', 'btn btn-secondary', person.user.activo ? 'Desactivar acceso' : 'Reactivar acceso'); accessToggle.type = 'button';
        accessToggle.addEventListener('click', function () { toggleMember(person.user.id, !person.user.activo); });
        danger.append(accessToggle);
      }
      if (professional) {
        var professionalToggle = el('button', 'btn btn-secondary', professional.active ? 'Desactivar como profesional' : 'Reactivar profesional'); professionalToggle.type = 'button';
        professionalToggle.addEventListener('click', function () { toggleProfessional(professional, !professional.active); });
        danger.append(professionalToggle);
      }
      body.append(danger);
    }

    dialog.append(body);
    body.scrollTop = keepTop;
    if (active) {
      var again = Array.prototype.find.call(dialog.querySelectorAll('[aria-label]'), function (node) { return node.getAttribute('aria-label') === active && node.focus; });
      if (again) try { again.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  // Servicios que realiza: solo los activos del catálogo de la clínica. La agenda (y el asistente de chat) solo ofrece citas con este profesional para estos servicios.
  // La escritura es optimista (no se recarga todo el panel, así no se pierde el desplazamiento) y se serializa; si falla se revierte y se avisa.
  var servicesQueue = Promise.resolve();
  function servicesSection(professional) {
    var section = sheetSection('Servicios que realiza', 'Marca los servicios de la clínica que atiende. Al buscar horarios (agenda y asistente de chat) solo se le ofrecen estos; sin ninguno marcado no recibe citas nuevas por esa vía.');
    if (!state.services.length) { section.append(el('p', 'clinic-admin-muted', 'Primero activa los servicios de la clínica en Servicios y tarifas.')); return section; }
    var canEdit = state.canScheduleManage;
    var head = el('div', 'clinic-admin-services-head');
    var counter = el('strong', 'clinic-admin-services-count'); counter.setAttribute('aria-live', 'polite');
    head.append(counter);
    var list = el('div', 'clinic-admin-sheet-services'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Servicios de ' + professional.display_name);
    var rows = [];
    function mine() { return new Set(state.professionalServices.filter(function (row) { return row.professional_id === professional.id; }).map(function (row) { return row.service_id; })); }
    function refresh() {
      var on = mine();
      rows.forEach(function (row) { row.box.checked = on.has(row.service.id); row.label.classList.toggle('is-on', row.box.checked); });
      counter.textContent = on.size + ' de ' + state.services.length + ' servicios';
    }
    function apply(ids, enabled) {
      var wanted = new Set(ids);
      if (enabled) {
        var have = mine();
        ids.forEach(function (id) { if (!have.has(id)) state.professionalServices.push({ professional_id: professional.id, service_id: id }); });
      } else state.professionalServices = state.professionalServices.filter(function (row) { return !(row.professional_id === professional.id && wanted.has(row.service_id)); });
      refresh();
      servicesQueue = servicesQueue.then(function () { return writeProfessionalServices(professional.id, ids, enabled); }).then(function () {
        feedback(enabled ? (ids.length > 1 ? 'Servicios asignados.' : 'Servicio asignado.') : (ids.length > 1 ? 'Servicios quitados.' : 'Servicio quitado.'));
      }, function (error) {
        // Revierte lo que no se pudo guardar y lo dice.
        if (enabled) state.professionalServices = state.professionalServices.filter(function (row) { return !(row.professional_id === professional.id && wanted.has(row.service_id)); });
        else ids.forEach(function (id) { state.professionalServices.push({ professional_id: professional.id, service_id: id }); });
        refresh(); feedback('No se pudo guardar el cambio. ' + errorMessage(error), 'error');
      });
    }
    if (canEdit) {
      var all = el('button', 'clinic-admin-link', 'Marcar todos'); all.type = 'button';
      all.addEventListener('click', function () { var on = mine(); var ids = state.services.map(function (x) { return x.id; }).filter(function (id) { return !on.has(id); }); if (ids.length) apply(ids, true); });
      var none = el('button', 'clinic-admin-link-danger', 'Quitar todos'); none.type = 'button';
      none.addEventListener('click', function () {
        var ids = state.services.map(function (x) { return x.id; }).filter(function (id) { return mine().has(id); });
        if (ids.length && window.confirm('¿Quitar los ' + ids.length + ' servicios de ' + professional.display_name + '? No recibirá citas nuevas por agenda ni por el asistente.')) apply(ids, false);
      });
      head.append(all, none);
    }
    section.append(head);
    if (state.services.length > 8) {
      var search = el('input', 'clinic-admin-services-search'); search.type = 'search'; search.placeholder = 'Buscar servicio…'; search.setAttribute('aria-label', 'Buscar servicio');
      search.addEventListener('input', function () { var q = search.value.trim().toLowerCase(); rows.forEach(function (row) { row.label.hidden = !!q && row.service.name.toLowerCase().indexOf(q) < 0; }); });
      section.append(search);
    }
    state.services.forEach(function (service) {
      var label = el('label', 'clinic-admin-sheet-service');
      var box = el('input'); box.type = 'checkbox'; box.disabled = !canEdit;
      box.addEventListener('change', function () { apply([service.id], box.checked); });
      label.append(box, el('span', '', service.name)); list.append(label); rows.push({ service: service, label: label, box: box });
    });
    section.append(list); refresh();
    if (!canEdit) section.append(el('p', 'clinic-admin-hint', 'Tu rol no puede cambiar los servicios de un profesional.'));
    return section;
  }

  function writeProfessionalServices(professionalId, ids, enabled) {
    if (enabled) return query(window.sb.from('smyl_professional_services').upsert(ids.map(function (id) { return { tenant_id: state.tenant, professional_id: professionalId, service_id: id }; }), { onConflict: 'tenant_id,professional_id,service_id', ignoreDuplicates: true }).select('professional_id'));
    return query(window.sb.from('smyl_professional_services').delete().eq('tenant_id', state.tenant).eq('professional_id', professionalId).in('service_id', ids).select('professional_id'));
  }

  async function addProfessionalBranch(professionalId, branchId) {
    await mutate(function () {
      return query(window.sb.from('smyl_professional_branches').insert({ tenant_id: state.tenant, professional_id: professionalId, branch_id: branchId }).select('professional_id').single());
    }, 'Sede asignada.');
  }

  async function removeProfessionalBranch(professional, branch) {
    var blocks = state.proHours.filter(function (row) { return row.professional_id === professional.id && row.branch_id === branch.id; }).length;
    var message = '¿Quitar a ' + professional.display_name + ' de ' + branch.name + '?' + (blocks ? ' También se eliminan sus ' + blocks + (blocks === 1 ? ' bloque' : ' bloques') + ' de horario en esa sede.' : '');
    if (!window.confirm(message)) return;
    try {
      var appointments = await upcomingAppointments(branch.id, professional.id);
      if (appointments.length) { feedback(professional.display_name + ' tiene citas futuras en esta sucursal. Reasígnalas o cancélalas antes de desvincular.', 'error'); return; }
    } catch (error) { feedback('No pudimos comprobar las citas futuras. ' + errorMessage(error), 'error'); return; }
    await mutate(function () {
      return query(window.sb.from('smyl_professional_branches').delete().eq('tenant_id', state.tenant).eq('professional_id', professional.id).eq('branch_id', branch.id).select('professional_id'));
    }, 'Sede quitada.');
  }

  function renderRoleGuide() {
    var host = document.getElementById('clinic-admin-role-guide');
    if (!host) return;
    var roles = state.roles.filter(function (role) { return role.active; });
    updateSectionCount('clinic-admin-role-count-summary', roles.length, 'rol', 'roles');
    if (!roles.length) {
      host.innerHTML = '<div class="clinic-admin-empty">Los permisos de cada rol aparecerán cuando estén disponibles.</div>';
      return;
    }
    host.innerHTML = roles.map(function (role) {
      var permissions = state.permissions.filter(function (row) { return row.role_id === role.id && !row.permission_key.startsWith('messages.'); }).map(function (row) { return PERMISSION_LABELS[row.permission_key] || row.permission_key; });
      var scopes = state.roleScopes.filter(function (row) { return row.role_id === role.id; });
      var scopeSummary = SCOPE_GROUPS.map(function (group) {
        var item = scopes.find(function (row) { return row.domain === group.key; });
        var scope = item ? item.scope : 'own';
        if (group.key === 'messages') scope = role.code === 'propietario' || scope === 'clinic' ? 'clinic' : 'branches';
        return '<span title="' + esc(group.label) + '">' + esc(group.label) + ': ' + esc(DATA_SCOPES[scope]) + '</span>';
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
      var choices = group.key === 'messages' ? ['branches', 'clinic'] : Object.keys(DATA_SCOPES);
      return '<label class="clinic-admin-scope-field"><span>' + esc(group.label) + '</span><select name="scope_' + group.key + '">' + choices.map(function (scope) { return '<option value="' + scope + '"' + (currentScopes[group.key] === scope ? ' selected' : '') + '>' + esc(DATA_SCOPES[scope]) + '</option>'; }).join('') + '</select></label>';
    }).join('');
    dialog.innerHTML = '<form id="clinic-admin-role-form"><div class="clinic-admin-dialog-heading"><div><span class="pro-eyebrow">ACCESO CONFIGURABLE</span><h2>' + (role ? 'Editar rol' : 'Crear nuevo rol') + '</h2></div>' + (role ? '<label class="clinic-admin-active-switch"><input type="checkbox" name="active"' + (role.active ? ' checked' : '') + '><span>Rol activo</span></label>' : '') + '</div><p>Activa las funciones y decide hasta dónde llega cada acceso. Podrás cambiarlo en cualquier momento.</p><div class="clinic-admin-form-grid"><div class="clinic-admin-field"><label for="ca-role-name">Nombre del rol</label><input id="ca-role-name" name="name" maxlength="80" required value="' + esc(role ? role.name : '') + '" placeholder="Ej. Coordinación clínica"></div><div class="clinic-admin-field"><label for="ca-role-description">Descripción</label><input id="ca-role-description" name="description" maxlength="240" value="' + esc(role ? role.description : '') + '" placeholder="Responsabilidades principales"></div></div><section class="clinic-admin-scope-editor"><div><h3>Alcance de la información</h3><p>Elige si este rol trabaja con información propia, del equipo, de sus sucursales o de toda la clínica.</p></div><div class="clinic-admin-scope-grid">' + scopeFields + '</div></section><div class="clinic-admin-role-editor">' + groups + '</div><div class="clinic-admin-role-count" aria-live="polite"></div><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary">Guardar rol</button></div></form>';
    var form = dialog.querySelector('form');
    var accessHint = el('p', 'clinic-admin-hint', 'El perfil para atender o coordinar el chat se elige en la ficha de cada integrante de Equipo.');
    form.querySelector('.clinic-admin-scope-grid').after(accessHint);
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
      enabled.forEach(function (key) { if (key.startsWith('messages.')) permissions.push(key); });
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
    var metrics = document.getElementById('clinic-admin-metrics');
    if (metrics && !state.loaded && window.SmylSkeleton) metrics.innerHTML = window.SmylSkeleton.html('kpis', { count: 4, label: 'Cargando indicadores de la clínica' });
    var detail = document.getElementById('clinic-admin-branch-detail');
    if (detail) detail.innerHTML = window.SmylSkeleton ? window.SmylSkeleton.html('detail', { label: 'Cargando la operación de tu clínica' }) : '<div class="clinic-admin-loading">Cargando la operación de tu clínica…</div>';
  }

  async function load(force) {
    var tenant = window.tenantId;
    if (!tenant || state.loading || (state.loaded && state.tenant === tenant && !force)) return;
    state.loading = true; state.tenant = tenant; loadingView();
    try {
      var auth = await window.sb.auth.getUser();
      state.actor = auth.data && auth.data.user ? auth.data.user.id : null;
      var results = await Promise.all([
        query(window.sb.from('smyl_branches').select('*').eq('tenant_id', tenant).order('is_default', { ascending: false }).order('name')),
        query(window.sb.from('smyl_rooms').select('id,tenant_id,branch_id,name,room_type,exclusive_use,active').eq('tenant_id', tenant).order('name')),
        query(window.sb.from('smyl_clinic_hours').select('id,tenant_id,branch_id,weekday,starts_at,ends_at,active').eq('tenant_id', tenant).order('weekday').order('starts_at')),
        query(window.sb.from('camila_usuarios').select('id,tenant_id,rol,nombre,email,activo,created_at').eq('tenant_id', tenant).order('created_at')),
        query(window.sb.from('smyl_roles').select('id,tenant_id,code,name,description,system_role,active').eq('tenant_id', tenant).order('name')),
        query(window.sb.from('smyl_role_permissions').select('role_id,permission_key').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_role_scopes').select('role_id,domain,scope').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_member_roles').select('user_id,role_id').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_member_branches').select('user_id,branch_id,is_primary').eq('tenant_id', tenant)),
        loadProfessionals(tenant),
        query(window.sb.from('smyl_professional_branches').select('professional_id,branch_id').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_staff_invitations').select('id,email,display_name,member_kind,specialty,license_number,branch_id,status,expires_at,invited_at').eq('tenant_id', tenant).in('status', ['pending', 'accepted']).order('invited_at', { ascending: false }))
      ]);
      if (tenant !== window.tenantId) return;
      state.branches = results[0] || []; state.rooms = results[1] || []; state.hours = results[2] || [];
      state.users = results[3] || []; state.roles = results[4] || []; state.permissions = results[5] || [];
      state.roleScopes = results[6] || []; state.memberRoles = results[7] || []; state.memberBranches = results[8] || [];
      state.professionals = results[9] || []; state.professionalBranches = results[10] || []; state.invitations = results[11] || [];
      var extra = await Promise.all([
        soft(query(window.sb.from('smyl_professional_hours').select('id,professional_id,branch_id,weekday,starts_at,ends_at').eq('tenant_id', tenant).eq('active', true)), []),
        soft(query(window.sb.from('smyl_professional_profiles').select('professional_id,status').eq('tenant_id', tenant)), []),
        query(window.sb.from('smyl_schedule_rules').select('professional_travel_margin_minutes').eq('tenant_id', tenant).maybeSingle()).then(function (row) { return { ok: true, row: row }; }, function () { return { ok: false }; }),
        soft(query(window.sb.rpc('smyl_professional_travel_conflicts')), []),
        soft(query(window.sb.from('smyl_services').select('id,name,active').eq('tenant_id', tenant).eq('active', true).order('name')), []),
        soft(query(window.sb.from('smyl_professional_services').select('professional_id,service_id').eq('tenant_id', tenant)), [])
      ]);
      if (tenant !== window.tenantId) return;
      state.proHours = extra[0] || []; state.profiles = extra[1] || []; state.conflicts = extra[3] || []; state.services = extra[4] || []; state.professionalServices = extra[5] || [];
      state.travelSupported = extra[2].ok; state.travelMargin = extra[2].row ? Number(extra[2].row.professional_travel_margin_minutes) : 45;
      var visibleBranches = state.branches.filter(function (row) { return state.branchFilter === 'archived' ? !row.active : row.active; });
      if (!visibleBranches.some(function (row) { return row.id === state.selectedBranch; })) {
        var defaultBranch = visibleBranches.find(function (row) { return row.is_default; });
        state.selectedBranch = defaultBranch ? defaultBranch.id : (visibleBranches[0] && visibleBranches[0].id);
      }
      calculateCapabilities(); state.loaded = true; renderAll();
    } catch (error) {
      feedback('No se pudo cargar Mi clínica. ' + errorMessage(error), 'error', function () { load(true); });
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
        return query(window.sb.from('smyl_branches').update(Object.assign({
          name: String(data.get('name') || '').trim(), phone: String(data.get('phone') || '').trim(),
          address_line: String(data.get('address_line') || '').trim(), city: String(data.get('city') || '').trim(),
          state: String(data.get('state') || '').trim(), postal_code: String(data.get('postal_code') || '').trim(),
          timezone: String(data.get('timezone') || 'America/Mexico_City')
        }, Object.prototype.hasOwnProperty.call(branch, 'arrival_notes') ? { arrival_notes: String(data.get('arrival_notes') || '').trim().slice(0, 300) } : {})).eq('tenant_id', state.tenant).eq('id', branch.id).select('id').single());
      }, 'Sucursal actualizada.').then(function (ok) { if (ok) { state.branchStep[branch.id] = 'operacion'; renderBranchDetail(); } });
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
    document.querySelectorAll('[data-ca-hours-preset]').forEach(function (button) {
      button.addEventListener('click', function () {
        var parts = button.dataset.caHoursPreset.split('|');
        var taken = new Set(state.hours.filter(function (row) { return row.branch_id === branch.id && row.active; }).map(function (row) { return row.weekday; }));
        var days = parts[0].split(',').map(Number).filter(function (day) { return !taken.has(day); });
        if (!days.length) { feedback('Esos días ya tienen horario. Quita un bloque si quieres reemplazarlo.', 'error'); return; }
        mutate(function () {
          return query(window.sb.from('smyl_clinic_hours').insert(days.map(function (day) {
            return { tenant_id: state.tenant, branch_id: branch.id, weekday: day, starts_at: parts[1], ends_at: parts[2], created_by: state.actor };
          })).select('id'));
        }, days.length === 1 ? 'Horario agregado.' : 'Horario agregado a ' + days.length + ' días.');
      });
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
    if (!active && !window.confirm('¿Desactivar a esta persona y devolver sus chats a Sin asignar? Si prefieres transferirlos a alguien, cancela y elige Sin acceso en su perfil de chat.')) return;
    await mutate(function () { return query(window.sb.from('camila_usuarios').update({ activo: active }).eq('tenant_id', state.tenant).eq('id', userId).select('id').single()); }, active ? 'Acceso reactivado.' : 'Acceso desactivado.');
  }

  function openProfessionalDialog(preselectedBranchId) {
    var dialog = document.getElementById('clinic-admin-dialog');
    var branches = state.branches.filter(function (row) { return row.active; });
    if (!branches.length) { feedback('Crea una sucursal antes de agregar profesionales.', 'error'); return; }
    dialog.innerHTML = '<form id="clinic-admin-create-professional"><div class="clinic-admin-dialog-heading"><div><span class="pro-eyebrow">EQUIPO CLÍNICO</span><h2>Agregar profesional</h2></div><span class="clinic-admin-dialog-step">Acceso + perfil</span></div><p>Si el correo ya pertenece a tu clínica, SMYL configurará su perfil y su rol sin enviar otro correo. Si es nuevo, recibirá una invitación segura.</p><div class="clinic-admin-form-grid"><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-prof-email">Correo de acceso</label><input id="ca-prof-email" name="email" type="email" maxlength="254" required autocomplete="email" placeholder="ana@clinica.com"><small>Usa el mismo correo con el que entra a SMYL.</small></div><div id="ca-prof-account-state" class="clinic-admin-account-state clinic-admin-field-wide" hidden aria-live="polite"></div><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-prof-name">Nombre profesional</label><input id="ca-prof-name" name="display_name" maxlength="120" required autocomplete="name" placeholder="Dra. Ana López"></div><div class="clinic-admin-field"><label for="ca-prof-specialty">Especialidad</label><input id="ca-prof-specialty" name="specialty" maxlength="120" placeholder="Ortodoncia"></div><div class="clinic-admin-field"><label for="ca-prof-license">Cédula profesional</label><input id="ca-prof-license" name="license_number" maxlength="80" inputmode="numeric" placeholder="Necesaria para firmar notas y recetas"></div>' + (state.contactSupported ? '<div id="ca-prof-whatsapp" class="clinic-admin-field clinic-admin-field-wide"><label for="ca-prof-contact">WhatsApp del profesional</label><input id="ca-prof-contact" name="contact_phone" type="tel" inputmode="tel" maxlength="40" pattern="[0-9 +.\\(\\)\\-]{0,40}" autocomplete="off" placeholder="Ej. 33 1234 5678"><small>Es el número donde SMYL le avisará de sus citas para que atienda el chat. No se muestra a los pacientes.</small><label class="clinic-admin-sheet-check"><input type="checkbox" name="contact_phone_public"><span>Compartir este número con los pacientes en los mensajes de cita</span></label></div>' : '') + '<div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-prof-branch">Sede inicial</label><select id="ca-prof-branch" name="branch_id" required><option value="">Selecciona una sede</option>' + branches.map(function (branch) { return '<option value="' + branch.id + '"' + (branch.id === preselectedBranchId ? ' selected' : '') + '>' + esc(branch.name) + '</option>'; }).join('') + '</select><small>Después podrás vincularlo a otras sucursales y definir un horario distinto en cada una.</small></div></div><div class="clinic-admin-invite-note"><strong>Rol inicial</strong><span>Quedará como Odontólogo, con acceso a sus pacientes, su agenda y el expediente clínico según las funciones configuradas para ese rol.</span></div><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary" data-ca-submit>Continuar</button></div></form>';
    dialog.querySelector('.pro-eyebrow').textContent = 'AGENDA Y ATENCIÓN';
    dialog.querySelector('h2').textContent = 'Invitar profesional';
    dialog.querySelector('form > p').textContent = 'Si el correo ya pertenece a tu clínica, SMYL completará su perfil sin enviar otra invitación. Si es nuevo, recibirá un acceso seguro.';
    var emailInput = dialog.querySelector('#ca-prof-email');
    var nameInput = dialog.querySelector('#ca-prof-name');
    var accountState = dialog.querySelector('#ca-prof-account-state');
    var submit = dialog.querySelector('[data-ca-submit]');
    var whatsappWrap = dialog.querySelector('#ca-prof-whatsapp');
    var whatsappInput = dialog.querySelector('#ca-prof-contact'), whatsappShare = dialog.querySelector('[name="contact_phone_public"]');
    function describeAccount() {
      var member = memberByEmail(emailInput.value);
      accountState.hidden = !member;
      if (!member) {
        accountState.replaceChildren();
        submit.textContent = 'Enviar invitación';
        return;
      }
      var linked = professionalProfileForMember(member.id);
      accountState.dataset.tone = linked ? 'linked' : 'existing';
      accountState.innerHTML = '<strong>' + (linked ? 'Profesional ya vinculado' : 'Cuenta encontrada en tu clínica') + '</strong><span>' + (linked ? 'No enviaremos otro correo. Puedes actualizar aquí su rol, sede y datos profesionales.' : 'No enviaremos correo. Crearemos el perfil profesional y asignaremos el rol Odontólogo.') + '</span>';
      if (!nameInput.value.trim()) nameInput.value = member.nombre || '';
      if (linked) {
        if (!dialog.querySelector('#ca-prof-specialty').value) dialog.querySelector('#ca-prof-specialty').value = linked.specialty || '';
        if (!dialog.querySelector('#ca-prof-license').value) dialog.querySelector('#ca-prof-license').value = linked.license_number || '';
        if (whatsappWrap && !whatsappInput.value) { whatsappInput.value = linked.contact_phone || ''; whatsappShare.checked = !!linked.contact_phone_public; }
      }
      var currentBranch = branchForMember(member.id);
      if (currentBranch) dialog.querySelector('#ca-prof-branch').value = currentBranch.id;
      submit.textContent = linked ? 'Actualizar profesional' : 'Crear perfil profesional';
    }
    emailInput.addEventListener('input', describeAccount);
    emailInput.addEventListener('blur', describeAccount);
    dialog.querySelector('[data-ca-close]').addEventListener('click', function () { dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', async function (event) {
      event.preventDefault(); var data = new FormData(event.currentTarget);
      var existing = memberByEmail(data.get('email'));
      submit.disabled = true; submit.textContent = 'Guardando…';
      var ok = existing ? await configureExistingDoctor(existing, data) : await sendInvitation({ email: data.get('email'), nombre: data.get('display_name'), member_kind: 'professional', specialty: data.get('specialty'), license_number: data.get('license_number'), branch_id: data.get('branch_id'), contact_phone: data.get('contact_phone'), contact_phone_public: data.get('contact_phone_public') === 'on' });
      submit.disabled = false;
      if (ok) { dialog.close(); state.loaded = false; await load(true); }
      else describeAccount();
    });
    dialog.showModal(); emailInput.focus();
  }

  async function configureExistingDoctor(member, data) {
    var professional = professionalProfileForMember(member.id);
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
          license_number: String(data.get('license_number') || '').trim(),
          active: true
        }).eq('tenant_id', state.tenant).eq('id', professional.id).select('id').single());
        if (branchId && !state.professionalBranches.some(function (row) { return row.professional_id === professional.id && row.branch_id === branchId; })) {
          await query(window.sb.from('smyl_professional_branches').insert({ tenant_id: state.tenant, professional_id: professional.id, branch_id: branchId }).select('professional_id').single());
        }
      }
      if (state.contactSupported && data.has('contact_phone')) {
        // Mismo dato que «WhatsApp del profesional» en su ficha: smyl_professionals.contact_phone(_public).
        var contactPhone = String(data.get('contact_phone') || '').trim();
        await query(window.sb.from('smyl_professionals').update({
          contact_phone: contactPhone,
          contact_phone_public: data.get('contact_phone_public') === 'on' && !!contactPhone
        }).eq('tenant_id', state.tenant).eq('user_id', member.id).select('id'));
      }
      if (!roleFor(member.id) || roleFor(member.id).id !== dentistRole.id) {
        await query(window.sb.rpc('smyl_set_member_role', { p_user_id: member.id, p_role_id: dentistRole.id }));
      }
      if (branchId) await query(window.sb.rpc('smyl_set_member_primary_branch', { p_user_id: member.id, p_branch_id: branchId }));
    }, professional ? 'Profesional actualizado. No fue necesario enviar otro correo.' : 'Perfil profesional creado y rol Odontólogo asignado.');
  }

  function openMemberDialog() {
    var dialog = document.getElementById('clinic-admin-dialog');
    dialog.innerHTML = '<form id="clinic-admin-invite-form"><div class="clinic-admin-dialog-heading"><div><span class="pro-eyebrow">EQUIPO ADMINISTRATIVO</span><h2>Invitar integrante</h2></div></div><p>Para recepción, administración u otras personas que no atienden pacientes como profesionales.</p><div class="clinic-admin-form-grid"><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-invite-name">Nombre</label><input id="ca-invite-name" name="name" maxlength="120" required autocomplete="name" placeholder="Ana López"></div><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-invite-email">Correo de acceso</label><input id="ca-invite-email" name="email" type="email" maxlength="254" required autocomplete="email" placeholder="ana@clinica.com"><small>Si ya pertenece a esta clínica, administra su rol desde la lista.</small></div></div><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary" data-ca-submit>Enviar invitación</button></div></form>';
    dialog.querySelector('.pro-eyebrow').textContent = 'EQUIPO DE LA CLÍNICA';
    dialog.querySelector('form > p').textContent = 'Invita a cualquier integrante. Si atenderá pacientes, completa después su perfil desde Agenda > Profesionales.';
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

  async function toggleProfessional(professional, active) {
    if (!active) {
      var appointments = [];
      try {
        var builder = window.sb.from('smyl_appointments').select('id,starts_at').eq('tenant_id', state.tenant).eq('professional_id', professional.id)
          .gte('starts_at', new Date().toISOString()).in('status', ['confirmed', 'arrived', 'in_progress']).order('starts_at').limit(6);
        appointments = await query(builder) || [];
      } catch (error) { feedback('No pudimos comprobar las citas futuras. ' + errorMessage(error), 'error'); return; }
      if (appointments.length) { feedback(professional.display_name + ' tiene citas futuras. Reasígnalas o cancélalas antes de desactivarlo.', 'error'); return; }
      if (!window.confirm('¿Desactivar a ' + professional.display_name + ' como profesional? Dejará de recibir citas nuevas; su acceso y todo el historial se conservarán.')) return;
    }
    await mutate(function () {
      return query(window.sb.from('smyl_professionals').update({ active: active }).eq('tenant_id', state.tenant).eq('id', professional.id).select('id').single());
    }, active ? 'Profesional reactivado.' : 'Profesional desactivado.');
  }

  async function sendInvitation(input) {
    var email = normalizeEmail(input.email);
    var name = String(input.nombre || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { feedback('Escribe un correo válido.', 'error'); return; }
    var existing = memberByEmail(email);
    if (existing) {
      feedback(input.member_kind === 'professional' ? 'Ese correo ya pertenece a tu clínica. Abre Agenda > Profesionales para completar su perfil sin reenviar la invitación.' : 'Ese correo ya pertenece a tu equipo. Cambia su rol o su sede directamente en la lista.', 'info');
      return false;
    }
    if (state.mutating) return false; state.mutating = true;
    try {
      var session = await window.sb.auth.getSession();
      var token = session.data && session.data.session && session.data.session.access_token;
      if (!token) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
      var response = await fetch(window.SUPA_URL + '/functions/v1/invite-staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: window.SUPA_KEY },
        body: JSON.stringify({ email: email, nombre: name, member_kind: input.member_kind || 'staff', specialty: input.specialty || '', license_number: input.license_number || '', branch_id: input.branch_id || null, contact_phone: String(input.contact_phone || '').trim(), contact_phone_public: !!input.contact_phone_public })
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

  // Dentro de Configuración cada responsabilidad abre su propio espacio sin duplicar datos ni pantallas.
  // al cambiar de área se abre la tarjeta correspondiente para que el encabezado siempre diga dónde estás.
  var HUB_ITEMS = { operacion: ['clinica', 'Sucursales y espacios'], equipo: ['equipo', 'Integrantes'] };
  function goTab(tab) {
    var page = document.getElementById('p-clinica');
    var embedded = page && page.closest && page.closest('.settings-hub-embed');
    var hub = window.SmylSettingsHub;
    if (embedded && hub && typeof hub.openItem === 'function' && HUB_ITEMS[tab] && tab !== state.tab) { hub.openItem(HUB_ITEMS[tab][0], HUB_ITEMS[tab][1]); return; }
    setTab(tab);
  }

  function setTab(tab) {
    state.tab = tab === 'equipo' ? 'equipo' : 'operacion';
    // El resumen de preparación y las cifras son de Sucursales y horarios: en Equipo estorban.
    ['clinic-admin-readiness', 'clinic-admin-metrics'].forEach(function (id) { var node = document.getElementById(id); if (node) node.hidden = state.tab === 'equipo'; });
    if (state.tab !== 'equipo') closePerson();
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
    page.innerHTML = '<header class="clinic-admin-head"><div><span class="pro-eyebrow">OPERACIÓN DE LA CLÍNICA</span><h1>Mi clínica</h1><p>Organiza sedes, espacios, horarios y responsabilidades con una guía clara para preparar la operación diaria.</p></div><div class="clinic-admin-head-actions"><span class="clinic-admin-status">Datos protegidos en SMYL</span><button type="button" class="btn btn-secondary" id="clinic-admin-refresh">Actualizar</button></div></header>' +
      '<div id="clinic-admin-feedback" class="clinic-admin-feedback" aria-live="polite"></div><section id="clinic-admin-readiness" class="clinic-admin-readiness" aria-label="Preparación operativa"></section><section id="clinic-admin-metrics" class="clinic-admin-metrics" aria-label="Resumen de la clínica"></section>' +
      '<div class="clinic-admin-tabs" role="tablist" aria-label="Áreas de Mi clínica"><button type="button" class="clinic-admin-tab" role="tab" data-ca-tab="operacion" aria-selected="true">Sucursales y horarios</button><button type="button" class="clinic-admin-tab" role="tab" data-ca-tab="equipo" aria-label="Equipo de la clínica" aria-selected="false">Equipo</button></div>' +
      '<section class="clinic-admin-panel" data-ca-panel="operacion"><div class="clinic-admin-layout"><aside class="clinic-admin-sidebar"><div class="clinic-admin-sidebar-head"><div><span class="pro-eyebrow">SEDES</span><h2>Sucursales</h2></div><button type="button" class="btn btn-primary clinic-admin-add-branch" id="clinic-admin-add-branch">+ Nueva</button></div><label class="clinic-admin-branch-search"><span class="clinic-admin-sr">Buscar sucursales</span><input type="search" id="clinic-admin-branch-search" placeholder="Buscar sucursal" autocomplete="off"></label><div id="clinic-admin-branch-filters" class="clinic-admin-branch-filters" role="group" aria-label="Filtrar sucursales"></div><div id="clinic-admin-branch-list" class="clinic-admin-branch-list"></div></aside><div id="clinic-admin-branch-detail" class="clinic-admin-main"><div class="clinic-admin-loading">Abre Mi clínica para cargar la operación.</div></div></div></section>' +
      '<section class="clinic-admin-panel clinic-admin-team-panel" data-ca-panel="equipo" hidden>' +
        '<nav class="clinic-admin-team-views" role="tablist" aria-label="Configuración de personas"><button type="button" role="tab" data-ca-team-view="people" aria-selected="true">Integrantes</button><button type="button" role="tab" data-ca-team-view="roles" aria-selected="false">Roles y permisos</button><button type="button" role="tab" data-ca-team-view="professionals" aria-selected="false">Profesionales</button></nav>' +
        '<section class="clinic-admin-team-view-panel" data-ca-team-panel="people"><header class="clinic-admin-team-hero"><div><span class="pro-eyebrow">PERSONAS</span><h2>Integrantes</h2><p>Administra quién pertenece a la clínica. Cada persona conserva una sola ficha de acceso.</p></div><div class="clinic-admin-team-actions"><button type="button" class="btn btn-primary" id="clinic-admin-add-member">Invitar integrante</button></div></header><article class="clinic-admin-card clinic-admin-people-card"><div class="clinic-admin-section-head"><div><h2>Equipo de la clínica</h2><p class="clinic-admin-card-intro">Abre una ficha para revisar contacto, rol y estado de acceso.</p></div><span class="clinic-admin-section-count" id="clinic-admin-member-count" aria-live="polite">0 personas</span></div><div class="clinic-admin-team-toolbar"><label class="clinic-admin-search"><span class="clinic-admin-sr">Buscar integrantes</span><input type="search" id="clinic-admin-people-search" placeholder="Buscar por nombre, correo o sede" autocomplete="off"></label><div class="clinic-admin-filters" id="clinic-admin-filters" role="group" aria-label="Filtrar integrantes"></div></div><div id="clinic-admin-people" class="clinic-admin-people-list"></div></article></section>' +
        '<section class="clinic-admin-team-view-panel" data-ca-team-panel="roles" hidden><header class="clinic-admin-team-hero"><div><span class="pro-eyebrow">ACCESO</span><h2>Roles y permisos</h2><p>Define qué información puede consultar y qué acciones puede realizar cada rol.</p></div><div class="clinic-admin-team-actions"><button type="button" class="btn btn-primary" id="clinic-admin-add-role">Crear rol</button></div></header><article class="clinic-admin-card clinic-admin-role-card"><div class="clinic-admin-section-head"><div><h2>Roles de la clínica</h2><p class="clinic-admin-card-intro">Las personas reciben un rol; aquí configuras sus permisos, no sus datos.</p></div><span class="clinic-admin-section-count" id="clinic-admin-role-count-summary" aria-live="polite">0 roles</span></div><div id="clinic-admin-role-guide"></div></article></section>' +
        '<section class="clinic-admin-team-view-panel" data-ca-team-panel="professionals" hidden><header class="clinic-admin-team-hero"><div><span class="pro-eyebrow">AGENDA Y ATENCIÓN</span><h2>Profesionales</h2><p>Configura quién atiende pacientes, en qué sedes y si está listo para recibir citas.</p></div><div class="clinic-admin-team-actions"><button type="button" class="btn btn-primary" id="clinic-admin-add-professional">Invitar profesional</button></div></header><div class="clinic-admin-team-grid"><article class="clinic-admin-card clinic-admin-professionals-card"><div class="clinic-admin-section-head"><div><h2>Profesionales de la clínica</h2><p class="clinic-admin-card-intro">Abre una ficha para asignar sedes, revisar disponibilidad y completar su perfil clínico.</p></div><span class="clinic-admin-section-count" id="clinic-admin-professional-count" aria-live="polite">0 profesionales</span></div><div class="clinic-admin-team-toolbar"><label class="clinic-admin-search"><span class="clinic-admin-sr">Buscar profesionales</span><input type="search" id="clinic-admin-professional-search" placeholder="Buscar por nombre, especialidad o sede" autocomplete="off"></label></div><div id="clinic-admin-professionals" class="clinic-admin-people-list"></div></article><article class="clinic-admin-card clinic-admin-travel-card" id="clinic-admin-travel-card" hidden><div class="clinic-admin-section-head"><div><h2>Traslado entre sedes</h2><p class="clinic-admin-card-intro">Aplica a toda la clínica y evita horarios sin tiempo suficiente para cambiar de sede.</p></div></div><div id="clinic-admin-travel"></div></article></div></section>' +
      '</section><dialog id="clinic-admin-dialog" class="clinic-admin-dialog smyl-v2-dialog"></dialog><dialog id="clinic-admin-person" class="clinic-admin-sheet" aria-labelledby="clinic-admin-person-title"></dialog>';
    document.querySelector('.contenido').append(page);
    page.querySelectorAll('[data-ca-tab]').forEach(function (button) { button.addEventListener('click', function () { setTab(button.dataset.caTab); }); });
    page.querySelectorAll('[data-ca-team-view]').forEach(function (button) { button.addEventListener('click', function () { setTeamView(button.dataset.caTeamView); }); });
    page.querySelector('#clinic-admin-refresh').addEventListener('click', function () { load(true); });
    page.querySelector('#clinic-admin-people-search').addEventListener('input', function (event) { state.personQuery = event.target.value; renderPeople(); });
    page.querySelector('#clinic-admin-professional-search').addEventListener('input', function (event) { state.professionalQuery = event.target.value; renderProfessionals(); });
    page.querySelector('#clinic-admin-branch-search').addEventListener('input', function (event) { state.branchQuery = event.target.value; renderBranches(); });
    var personSheet = page.querySelector('#clinic-admin-person');
    personSheet.addEventListener('click', function (event) { if (event.target === personSheet) closePerson(); });
    personSheet.addEventListener('close', function () { state.person = null; state.editing = false; state.hoursDraft = null; state.chatProfile = null; });
    page.querySelector('#clinic-admin-add-branch').addEventListener('click', openBranchDialog);
    page.querySelector('#clinic-admin-add-professional').addEventListener('click', function () { openProfessionalDialog(); });
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
