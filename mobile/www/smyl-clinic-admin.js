/* SMYL · Etapa 1: operación de clínica, sucursales, espacios y equipo. */
(function () {
  'use strict';

  var DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var ROOM_TYPES = {
    consultorio: 'Consultorio', sillon: 'Sillón dental', quirofano: 'Quirófano',
    rayos_x: 'Rayos X', esterilizacion: 'Esterilización', otro: 'Otro'
  };
  var state = {
    tenant: null, actor: null, loading: false, loaded: false, mutating: false,
    tab: 'operacion', selectedBranch: null, branches: [], rooms: [], hours: [],
    users: [], roles: [], permissions: [], memberRoles: [], memberBranches: [],
    professionals: [], professionalBranches: [], canClinic: false, canTeam: false,
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

  function calculateCapabilities() {
    var owner = window.miRolEquipo === 'dueño';
    var assignments = state.memberRoles.filter(function (row) { return row.user_id === state.actor; });
    var roleIds = new Set(assignments.map(function (row) { return row.role_id; }));
    var permissions = new Set(state.permissions.filter(function (row) {
      return roleIds.has(row.role_id);
    }).map(function (row) { return row.permission_key; }));
    state.canClinic = owner || permissions.has('clinic.manage');
    state.canTeam = owner || permissions.has('team.manage');
    state.canAssignRoles = owner;
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
      var button = el('button', 'clinic-admin-branch');
      button.type = 'button'; button.dataset.branchId = branch.id;
      button.setAttribute('aria-current', String(branch.id === state.selectedBranch));
      var subtitle = [branch.city || 'Ubicación pendiente', branch.is_default ? 'Principal' : 'Sucursal'].join(' · ');
      button.innerHTML = '<strong>' + esc(branch.name) + '</strong><small><i class="clinic-admin-dot"></i>' + esc(subtitle) + '</small>';
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
    host.innerHTML = '<article class="clinic-admin-card"><div class="clinic-admin-section-head"><div><h2>' + esc(branch.name) + '</h2><p class="clinic-admin-card-intro">Datos operativos de esta sede.</p></div>' + (branch.is_default ? '<span class="clinic-admin-pill">Sucursal principal</span>' : '') + '</div>' + branchForm(branch) + '</article>' +
      '<article class="clinic-admin-card">' + roomSection(branch) + hoursSection(branch) + '</article>';
    bindBranchActions(branch);
  }

  function renderOperations() {
    renderBranches(); renderBranchDetail();
  }

  function renderTeam() {
    var members = document.getElementById('clinic-admin-members');
    var professionals = document.getElementById('clinic-admin-professionals');
    var invite = document.getElementById('clinic-admin-invite');
    if (!members || !professionals || !invite) return;
    var activeBranches = state.branches.filter(function (row) { return row.active; });
    members.replaceChildren();
    state.users.forEach(function (user) {
      var currentRole = roleFor(user.id);
      var currentBranch = branchForMember(user.id);
      var row = el('article', 'clinic-admin-member');
      var meta = el('div', 'clinic-admin-member-meta');
      meta.innerHTML = '<strong>' + esc(user.nombre || user.email || 'Integrante') + '</strong><small>' + esc(user.email || '') + (user.activo ? '' : ' · Inactivo') + '</small>';
      var roleSelect = el('select'); roleSelect.setAttribute('aria-label', 'Rol de ' + (user.nombre || user.email || 'integrante'));
      var availableRoles = state.roles.filter(function (role) { return role.active && (user.rol === 'dueño' ? role.code === 'propietario' : role.code !== 'propietario'); });
      availableRoles.forEach(function (role) { roleSelect.append(new Option(role.name, role.id)); });
      roleSelect.value = currentRole ? currentRole.id : '';
      roleSelect.disabled = !state.canAssignRoles || user.rol === 'dueño' || !user.activo;
      roleSelect.addEventListener('change', function () { setMemberRole(user.id, roleSelect.value); });
      var branchSelect = el('select'); branchSelect.setAttribute('aria-label', 'Sede principal de ' + (user.nombre || user.email || 'integrante'));
      branchSelect.append(new Option('Sin sede principal', ''));
      activeBranches.forEach(function (branch) { branchSelect.append(new Option(branch.name, branch.id)); });
      branchSelect.value = currentBranch ? currentBranch.id : '';
      branchSelect.disabled = !state.canClinic || !user.activo || !activeBranches.length;
      branchSelect.addEventListener('change', function () {
        if (branchSelect.value) setMemberBranch(user.id, branchSelect.value); else branchSelect.value = currentBranch ? currentBranch.id : '';
      });
      row.append(meta, roleSelect, branchSelect);
      if (state.canAssignRoles && user.rol !== 'dueño') {
        var toggle = el('button', 'btn btn-secondary', user.activo ? 'Desactivar' : 'Reactivar');
        toggle.type = 'button'; toggle.addEventListener('click', function () { toggleMember(user.id, !user.activo); });
        row.append(toggle);
      } else row.append(el('span'));
      members.append(row);
    });
    if (!state.users.length) members.append(el('div', 'clinic-admin-empty', 'Todavía no hay integrantes en la clínica.'));

    professionals.replaceChildren();
    state.professionals.filter(function (row) { return row.active; }).forEach(function (professional) {
      var row = el('article', 'clinic-admin-professional');
      row.append(el('div', 'clinic-admin-avatar', initials(professional.display_name)));
      var info = el('div');
      var locations = state.professionalBranches.filter(function (item) { return item.professional_id === professional.id; }).map(function (item) {
        var branch = state.branches.find(function (candidate) { return candidate.id === item.branch_id; });
        return branch ? branch.name : '';
      }).filter(Boolean);
      info.innerHTML = '<strong>' + esc(professional.display_name) + '</strong><small>' + esc([professional.specialty || 'Odontología general', professional.license_number ? 'Céd. ' + professional.license_number : '', locations.join(', ')].filter(Boolean).join(' · ')) + '</small>';
      row.append(info);
      if (state.canTeam) {
        var off = el('button', 'btn btn-secondary', 'Desactivar'); off.type = 'button';
        off.addEventListener('click', function () { deactivateProfessional(professional.id); }); row.append(off);
      }
      professionals.append(row);
    });
    if (!professionals.childElementCount) professionals.append(el('div', 'clinic-admin-empty', 'Registra a quienes podrán aparecer como profesionales en la agenda.'));

    invite.hidden = !state.canAssignRoles;
    var professionalButton = document.getElementById('clinic-admin-add-professional');
    if (professionalButton) professionalButton.hidden = !state.canTeam;
  }

  function renderAll() {
    renderMetrics(); renderOperations(); renderTeam(); setTab(state.tab);
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
        query(window.sb.from('smyl_roles').select('id,tenant_id,code,name,description,active').eq('tenant_id', tenant).order('name')),
        query(window.sb.from('smyl_role_permissions').select('role_id,permission_key').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_member_roles').select('user_id,role_id').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_member_branches').select('user_id,branch_id,is_primary').eq('tenant_id', tenant)),
        query(window.sb.from('smyl_professionals').select('id,tenant_id,user_id,display_name,specialty,license_number,color_token,active').eq('tenant_id', tenant).order('display_name')),
        query(window.sb.from('smyl_professional_branches').select('professional_id,branch_id').eq('tenant_id', tenant))
      ]);
      if (tenant !== window.tenantId) return;
      state.branches = results[0] || []; state.rooms = results[1] || []; state.hours = results[2] || [];
      state.users = results[3] || []; state.roles = results[4] || []; state.permissions = results[5] || [];
      state.memberRoles = results[6] || []; state.memberBranches = results[7] || [];
      state.professionals = results[8] || []; state.professionalBranches = results[9] || [];
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
    var linkedUsers = new Set(state.professionals.filter(function (row) { return row.active && row.user_id; }).map(function (row) { return row.user_id; }));
    var users = state.users.filter(function (row) { return row.activo && !linkedUsers.has(row.id); });
    var branches = state.branches.filter(function (row) { return row.active; });
    dialog.innerHTML = '<form id="clinic-admin-create-professional"><h2>Agregar profesional</h2><p>Podrá aparecer en la agenda y asociarse a tratamientos, citas y resultados clínicos.</p><div class="clinic-admin-form-grid"><div class="clinic-admin-field clinic-admin-field-wide"><label for="ca-prof-name">Nombre profesional</label><input id="ca-prof-name" name="display_name" maxlength="120" required placeholder="Dra. Ana López"></div><div class="clinic-admin-field"><label for="ca-prof-specialty">Especialidad</label><input id="ca-prof-specialty" name="specialty" maxlength="120" placeholder="Ortodoncia"></div><div class="clinic-admin-field"><label for="ca-prof-license">Cédula profesional</label><input id="ca-prof-license" name="license_number" maxlength="80"></div><div class="clinic-admin-field"><label for="ca-prof-user">Cuenta de acceso</label><select id="ca-prof-user" name="user_id"><option value="">Sin vincular</option>' + users.map(function (user) { return '<option value="' + user.id + '">' + esc(user.nombre || user.email) + '</option>'; }).join('') + '</select></div><div class="clinic-admin-field"><label for="ca-prof-branch">Primera sede</label><select id="ca-prof-branch" name="branch_id"><option value="">Sin sede</option>' + branches.map(function (branch) { return '<option value="' + branch.id + '">' + esc(branch.name) + '</option>'; }).join('') + '</select></div></div><div class="clinic-admin-actions"><button type="button" class="btn btn-secondary" data-ca-close>Cancelar</button><button type="submit" class="btn btn-primary">Agregar profesional</button></div></form>';
    dialog.querySelector('[data-ca-close]').addEventListener('click', function () { dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', async function (event) {
      event.preventDefault(); var data = new FormData(event.currentTarget);
      var ok = await mutate(function () { return query(window.sb.rpc('smyl_create_professional', { p_display_name: String(data.get('display_name') || '').trim(), p_specialty: String(data.get('specialty') || '').trim(), p_license_number: String(data.get('license_number') || '').trim(), p_user_id: data.get('user_id') || null, p_branch_id: data.get('branch_id') || null })); }, 'Profesional agregado.');
      if (ok) dialog.close();
    });
    dialog.showModal(); dialog.querySelector('input').focus();
  }

  async function deactivateProfessional(id) {
    if (!window.confirm('¿Desactivar este profesional? Sus citas y registros históricos se conservarán.')) return;
    await mutate(function () { return query(window.sb.from('smyl_professionals').update({ active: false }).eq('tenant_id', state.tenant).eq('id', id).select('id').single()); }, 'Profesional desactivado.');
  }

  async function inviteMember(event) {
    event.preventDefault();
    var form = event.currentTarget; var data = new FormData(form);
    var email = String(data.get('email') || '').trim().toLowerCase();
    var name = String(data.get('name') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { feedback('Escribe un correo válido.', 'error'); return; }
    if (state.mutating) return; state.mutating = true;
    try {
      var session = await window.sb.auth.getSession();
      var token = session.data && session.data.session && session.data.session.access_token;
      if (!token) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
      var response = await fetch(window.SUPA_URL + '/functions/v1/invite-staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: window.SUPA_KEY },
        body: JSON.stringify({ email: email, nombre: name })
      });
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(body.error || 'No se pudo enviar la invitación.');
      form.reset(); feedback('Invitación enviada a ' + email + '. El rol podrá ajustarse cuando acepte.');
    } catch (error) { feedback(errorMessage(error), 'error'); }
    finally { state.mutating = false; }
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
    page.innerHTML = '<header class="clinic-admin-head"><div><span class="pro-eyebrow">OPERACIÓN DE LA CLÍNICA</span><h1>Mi clínica</h1><p>Organiza sucursales, espacios, horarios y responsabilidades del equipo. Esta información será la base de la agenda, el inventario y la operación diaria.</p></div><div class="clinic-admin-head-actions"><span class="clinic-admin-status">Datos protegidos en SMYL</span><button type="button" class="btn btn-secondary" id="clinic-admin-refresh">Actualizar</button></div></header><div id="clinic-admin-feedback" class="clinic-admin-feedback" aria-live="polite"></div><section id="clinic-admin-metrics" class="clinic-admin-metrics" aria-label="Resumen de la clínica"></section><div class="clinic-admin-tabs" role="tablist" aria-label="Áreas de Mi clínica"><button type="button" class="clinic-admin-tab" role="tab" data-ca-tab="operacion" aria-selected="true">Sucursales y horarios</button><button type="button" class="clinic-admin-tab" role="tab" data-ca-tab="equipo" aria-selected="false">Equipo y profesionales</button></div><section class="clinic-admin-panel" data-ca-panel="operacion"><div class="clinic-admin-layout"><aside class="clinic-admin-sidebar"><div class="clinic-admin-sidebar-head"><h2>Sucursales</h2><button type="button" class="clinic-admin-icon-button" id="clinic-admin-add-branch" aria-label="Agregar sucursal">+</button></div><div id="clinic-admin-branch-list" class="clinic-admin-branch-list"></div></aside><div id="clinic-admin-branch-detail" class="clinic-admin-main"><div class="clinic-admin-loading">Abre Mi clínica para cargar la operación.</div></div></div></section><section class="clinic-admin-panel" data-ca-panel="equipo" hidden><div class="clinic-admin-team-grid"><article class="clinic-admin-card"><div class="clinic-admin-section-head"><div><h2>Equipo y responsabilidades</h2><p class="clinic-admin-card-intro">Cada integrante tiene un rol operativo y una sede principal.</p></div></div><div id="clinic-admin-members"></div></article><div class="clinic-admin-main"><article class="clinic-admin-card"><div class="clinic-admin-section-head"><div><h2>Profesionales</h2><p class="clinic-admin-card-intro">Quienes aparecerán en agenda y expedientes.</p></div><button type="button" class="clinic-admin-icon-button" id="clinic-admin-add-professional" aria-label="Agregar profesional">+</button></div><div id="clinic-admin-professionals"></div></article><article class="clinic-admin-card" id="clinic-admin-invite"><h2>Invitar integrante</h2><p class="clinic-admin-card-intro">Recibirá su propio acceso. Después podrás asignarle rol y sede.</p><form id="clinic-admin-invite-form"><div class="clinic-admin-form-grid"><div class="clinic-admin-field"><label for="ca-invite-name">Nombre</label><input id="ca-invite-name" name="name" maxlength="120" placeholder="Dra. Ana López"></div><div class="clinic-admin-field"><label for="ca-invite-email">Correo</label><input id="ca-invite-email" name="email" type="email" maxlength="254" required placeholder="ana@clinica.com"></div></div><div class="clinic-admin-actions"><button type="submit" class="btn btn-primary">Enviar invitación</button></div></form></article></div></div></section><dialog id="clinic-admin-dialog" class="clinic-admin-dialog"></dialog>';
    document.querySelector('.contenido').append(page);
    page.querySelectorAll('[data-ca-tab]').forEach(function (button) { button.addEventListener('click', function () { setTab(button.dataset.caTab); }); });
    page.querySelector('#clinic-admin-refresh').addEventListener('click', function () { load(true); });
    page.querySelector('#clinic-admin-add-branch').addEventListener('click', openBranchDialog);
    page.querySelector('#clinic-admin-add-professional').addEventListener('click', openProfessionalDialog);
    page.querySelector('#clinic-admin-invite-form').addEventListener('submit', inviteMember);
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
