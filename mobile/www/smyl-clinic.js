/* Stage 3: patient registry and clinician-owned plan. No AI or outbound sends. */
(function () {
  'use strict';
  var model = window.SmylClinicalModel;
  var current = null, sequence = 0, patientSequence = 0, savingPatient = false, patientAttempt = null;
  var patientMessage = '', patientFailure = false;
  function el(tag, cls, text) {
    var n = document.createElement(tag); if (cls) n.className = cls;
    if (text != null) n.textContent = text; return n;
  }
  function button(text, fn, cls) {
    var n = el('button', cls || 'btn btn-secondary', text); n.type = 'button';
    n.addEventListener('click', fn); return n;
  }
  function field(label, id, value, limit, multiline) {
    var box = el('div', 'clinic-field'), lbl = el('label', '', label);
    var input = el(multiline ? 'textarea' : 'input'); input.id = id;
    lbl.htmlFor = id; input.value = value || ''; input.maxLength = limit;
    if (multiline) input.rows = 3;
    box.append(lbl, input); return box;
  }
  function notice(text, error) {
    var n = el('p', 'clinic-notice' + (error ? ' clinic-error' : ''), text);
    n.setAttribute('role', error ? 'alert' : 'status'); return n;
  }
  function fullName(p) { return [p.nombre, p.apellido].filter(Boolean).join(' '); }
  function date(value) { return value ? new Date(value).toLocaleString('es-MX') : ''; }
  async function checked(query) {
    var response = await sbTimeout(query, 20000);
    if (response.error) throw response.error;
    return response.data;
  }
  function localPatients() {
    try {
      var rows = JSON.parse(localStorage.getItem('camila_pacientes_' + tenantId) || '[]');
      return Array.isArray(rows) ? rows.map(function (p) { return Object.assign({}, p, { _local: true }); }) : [];
    } catch (_) { return []; }
  }
  function leave() {
    if (current && current.saving) { alert('Espera a que termine el guardado.'); return false; }
    if (current && current.dirty && !confirm('Hay cambios sin guardar en la ficha. ¿Quieres salir y descartarlos?')) return false;
    sequence++; current = null; return true;
  }
  function formDocument() {
    return model.normalize({
      reason: document.getElementById('clinic-reason').value,
      background: document.getElementById('clinic-background').value,
      assessment: document.getElementById('clinic-assessment').value,
      treatments: Array.from(document.querySelectorAll('.clinic-treatment')).map(function (row) {
        return { name: row.querySelector('[data-field="name"]').value, area: row.querySelector('[data-field="area"]').value, notes: row.querySelector('[data-field="notes"]').value };
      })
    });
  }
  // Local professional-preview adapter, NOT patient authorization or publishing.
  // Never expose the full clinical document to the patient-facing renderer.
  function capturePatientReview(tenant, patient) {
    var ctx = current, row = ctx && ctx.row;
    function available() {
      return current === ctx && ctx && ctx.ready && document.getElementById('clinic-form') && !ctx.dirty && !ctx.saving &&
        ctx.tenant === tenant && ctx.patient === patient && tenantId === tenant &&
        pacienteActual && pacienteActual.id === patient && !pacienteActual._local &&
        miRolEquipo === 'dueño' && document.getElementById('p-paciente-detalle').classList.contains('activa') &&
        ctx.row === row && row && JSON.stringify(formDocument()) === ctx.saved && row.tenant_id === tenant && row.patient_id === patient &&
        row.status === 'reviewed' && Number.isInteger(row.revision) && row.revision > 0 &&
        row.reviewed_by && row.reviewed_at && Number.isFinite(Date.parse(row.reviewed_at));
    }
    if (!available()) return null;
    var assessment = model.normalize(row.document).assessment;
    if (!assessment.trim()) return null;
    var revision = row.revision, reviewedAt = row.reviewed_at;
    return Object.freeze({
      assessment: assessment, revision: revision, reviewedAt: reviewedAt,
      isCurrent: function () {
        return !!available() && row.revision === revision && row.reviewed_at === reviewedAt &&
          model.normalize(row.document).assessment === assessment;
      }
    });
  }
  function changed() {
    if (!current || !current.ready) return;
    current.dirty = JSON.stringify(formDocument()) !== current.saved;
    document.getElementById('clinic-review-confirm').checked = false;
    status();
  }
  function status() {
    if (!current || !document.getElementById('clinic-form')) return;
    var savedReview = current.row && current.row.status === 'reviewed';
    var label = current.dirty ? 'Cambios sin guardar' : savedReview ? 'Revisado por el profesional' : current.row ? 'Borrador guardado' : 'Sin guardar';
    document.getElementById('clinic-state').textContent = label;
    document.getElementById('clinic-state').classList.toggle('clinic-reviewed', savedReview && !current.dirty);
    document.getElementById('clinic-save-status').textContent = current.saving ? 'Guardando…' : current.dirty && savedReview ? 'Al guardar, esta versión volverá a borrador. La revisión anterior permanece en el historial.' : current.row ? 'Versión ' + current.row.revision + ' · ' + date(current.row.updated_at) : 'No se guarda automáticamente. Tus notas no se envían al paciente ni a LANA.';
    document.getElementById('clinic-save').disabled = !current.ready || current.saving || (!current.dirty && !!current.row);
    document.getElementById('clinic-review').disabled = !current.ready || current.saving || (savedReview && !current.dirty);
    document.getElementById('clinic-add').disabled = !current.ready || current.saving || document.querySelectorAll('.clinic-treatment').length >= 20;
    var proposal = document.getElementById('clinic-proposal');
    if (proposal) proposal.disabled = !savedReview || current.dirty || current.saving;
    var resume = document.getElementById('clinic-portal-return');
    if (resume) {
      var ready = !!capturePatientReview(current.tenant, current.patient);
      resume.querySelector('p').textContent = ready ? 'Listo. Tu valoración y plan ya están revisados.' : 'Falta completar la valoración y el tratamiento, y pulsar «Revisar plan». Después podrás continuar aquí.';
      resume.querySelector('button').disabled = !ready;
    }
  }
  var rowSequence = 0;
  function addTreatment(item) {
    item = item || {};
    if (document.querySelectorAll('.clinic-treatment').length >= 20) return;
    var row = el('article', 'clinic-treatment'); rowSequence++;
    [['Tratamiento o indicación','name',200],['Zona o piezas · opcional','area',200],['Detalles · opcional','notes',2000]].forEach(function (entry) {
      var f = field(entry[0], 'clinic-item-' + rowSequence + '-' + entry[1], item[entry[1]], entry[2], entry[1] === 'notes');
      f.lastElementChild.dataset.field = entry[1]; row.append(f);
    });
    var remove = button('Quitar', function () { row.remove(); changed(); }, 'clinic-remove');
    remove.setAttribute('aria-label', 'Quitar este tratamiento'); row.append(remove);
    document.getElementById('clinic-treatments').append(row);
  }
  function renderEditor() {
    var host = document.getElementById('clinic-content'); host.replaceChildren();
    var doc = model.normalize(current.row && current.row.document);
    current.saved = JSON.stringify(doc); current.dirty = false;
    var form = el('fieldset', 'clinic-form'); form.id = 'clinic-form'; form.disabled = !current.ready;
    form.append(field('¿Qué desea mejorar el paciente?', 'clinic-reason', doc.reason, 2000, true));
    form.querySelector('#clinic-reason').placeholder = 'Escribe el motivo de la consulta.';
    var background = el('details', 'clinic-secondary');
    background.append(el('summary', '', 'Antecedentes y observaciones'), field('Información clínica relevante', 'clinic-background', doc.background, 8000, true));
    form.append(background);
    var heading = el('div', 'clinic-section-heading');
    heading.append(el('span', 'pro-eyebrow', 'TU CRITERIO CLÍNICO'), el('h3', '', 'Valoración'), el('p', '', 'Registra lo que observaste y tu diagnóstico. La simulación es orientativa, no evidencia clínica.'));
    form.append(heading, field('Valoración del profesional', 'clinic-assessment', doc.assessment, 8000, true));
    form.querySelector('#clinic-assessment').placeholder = 'Tus hallazgos y valoración tras revisar al paciente. Puedes guardar un borrador y completarlo después.';
    var plan = el('div', 'clinic-section-heading');
    plan.append(el('h3', '', 'Plan de tratamiento'), el('p', '', 'Puedes proponer lo que el paciente necesita, aunque sea distinto de la simulación.'));
    var list = el('div'); list.id = 'clinic-treatments';
    var add = button('+ Añadir tratamiento', function () { addTreatment(); changed(); document.querySelector('.clinic-treatment:last-child input').focus(); }); add.id = 'clinic-add';
    form.append(plan, list, add);
    var foot = el('div', 'clinic-savebar');
    var saveState = el('p'); saveState.id = 'clinic-save-status'; saveState.setAttribute('role', 'status');
    var actions = el('div', 'clinic-actions');
    var save = button('Guardar borrador', function () { savePlan(false); }); save.id = 'clinic-save';
    var review = button('Revisar plan', function () {
      var problem = model.reviewError(formDocument());
      if (problem) { document.getElementById('clinic-feedback').replaceChildren(notice(problem, true)); return; }
      renderReview(formDocument());
      document.getElementById('clinic-review-confirm').checked = false;
      document.getElementById('clinic-review-submit').disabled = true;
      document.getElementById('clinic-review-dialog').showModal();
    }, 'btn btn-primary'); review.id = 'clinic-review';
    actions.append(save, review); foot.append(saveState, actions); form.append(foot);
    var proposal = button('Preparar presupuesto · opcional', function () { if (window.SmylProposals) SmylProposals.forPatient(current.patient); });
    proposal.id = 'clinic-proposal'; foot.append(proposal);
    host.append(form);
    doc.treatments.forEach(addTreatment);
    form.addEventListener('input', changed);
    status();
  }
  function renderReview(doc) {
    var host = document.getElementById('clinic-review-summary'); host.replaceChildren();
    var patient = todosLosPacientes.find(function (p) { return p.id === current.patient; });
    host.append(el('p','clinic-review-patient',patient ? fullName(patient) : 'Paciente seleccionado'));
    [['Motivo de consulta',doc.reason],['Antecedentes',doc.background],['Tu valoración',doc.assessment]].forEach(function (entry) {
      if (entry[1]) host.append(el('h3','',entry[0]),el('p','',entry[1]));
    });
    host.append(el('h3','','Tratamientos e indicaciones'));
    var list = el('ol');
    doc.treatments.forEach(function (t) {
      var item = el('li'); item.append(el('strong','',t.name));
      if(t.area) item.append(el('p','',t.area));
      if(t.notes) item.append(el('p','',t.notes));
      list.append(item);
    }); host.append(list);
  }
  async function savePlan(review) {
    if (!current || !current.ready || current.saving) return;
    var ctx = current, doc = formDocument(), activeForm = document.getElementById('clinic-form');
    if (review && (!document.getElementById('clinic-review-confirm').checked || model.reviewError(doc))) return;
    ctx.saving = true; document.getElementById('clinic-form').disabled = true; status();
    var confirmButton = document.getElementById('clinic-review-submit'); confirmButton.disabled = true;
    document.getElementById('clinic-review-dialog').close();
    document.getElementById('clinic-feedback').replaceChildren();
    try {
      var row = await checked(sb.rpc('smyl_save_clinical_plan', {
        p_tenant_id: ctx.tenant, p_patient_id: ctx.patient,
        p_expected_revision: ctx.row ? ctx.row.revision : 0, p_document: doc, p_review: review
      }));
      if (Array.isArray(row)) row = row[0];
      if (!row || row.patient_id !== ctx.patient || row.tenant_id !== ctx.tenant || !row.revision) throw new Error('Unconfirmed save');
      if (current !== ctx || !activeForm.isConnected) return;
      ctx.row = row; ctx.saved = JSON.stringify(doc); ctx.dirty = false;
      document.getElementById('clinic-feedback').replaceChildren(notice(review ? 'Plan revisado y guardado. No se ha enviado a nadie.' : 'Borrador guardado en la clínica.'));
      document.getElementById('clinic-history').open = false;
      document.getElementById('clinic-history-list').replaceChildren();
    } catch (error) {
      if (current === ctx && activeForm.isConnected) {
        var feedback = document.getElementById('clinic-feedback');
        feedback.replaceChildren(notice(model.errorMessage(error), true));
        if (error.code === '40001') {
          ctx.ready = false;
          feedback.append(button('Recargar ficha', function () { verPaciente(ctx.patient); }));
        }
      }
    } finally {
      ctx.saving = false; confirmButton.disabled = false;
      if (current === ctx && activeForm.isConnected) { activeForm.disabled = !ctx.ready; status(); }
    }
  }
  async function history() {
    var host = document.getElementById('clinic-history-list'), ctx = current;
    if (!ctx || !ctx.ready || !document.getElementById('clinic-history').open) return;
    host.replaceChildren(notice('Cargando versiones…'));
    try {
      var rows = await checked(sb.from('smyl_clinical_versions').select('*').eq('tenant_id', ctx.tenant).eq('patient_id', ctx.patient).order('revision', { ascending: false }).limit(25));
      if (current !== ctx) return;
      host.replaceChildren();
      if (!rows.length) host.append(notice('Todavía no hay versiones guardadas.'));
      rows.forEach(function (row) {
        var item = el('details', 'clinic-version');
        item.append(el('summary', '', 'Versión ' + row.revision + ' · ' + (row.status === 'reviewed' ? 'Revisada' : 'Borrador') + ' · ' + date(row.updated_at)));
        var doc = model.normalize(row.document);
        item.append(el('p', '', 'Motivo: ' + (doc.reason || 'Sin registrar')), el('p', '', 'Antecedentes: ' + (doc.background || 'Sin registrar')), el('p', '', 'Valoración: ' + (doc.assessment || 'Sin registrar')));
        var list = el('ul'); doc.treatments.forEach(function (t) { list.append(el('li', '', [t.name, t.area, t.notes].filter(Boolean).join(' · '))); });
        item.append(list, el('small', '', 'Registro del profesional · ' + row.updated_by)); host.append(item);
      });
      host.append(el('small', '', 'Se muestran las 25 versiones más recientes. Consultar una versión no modifica el plan actual.'));
    } catch (error) { if (current === ctx) host.replaceChildren(notice('No se pudo cargar el historial. Puedes intentarlo de nuevo.', true)); }
  }
  async function openPatient(id) {
    var p = todosLosPacientes.find(function (row) { return row.id === id; });
    if (!p || !leave()) return;
    pacienteActual = p;
    window.ir('paciente-detalle');
    var ctx = { tenant: tenantId, patient: p.id, ready: false, row: null, dirty: false, saving: false }; current = ctx;
    var token = ++sequence;
    var screen = document.getElementById('p-paciente-detalle'); screen.replaceChildren();
    screen.append(button('← Pacientes', function () { ir('pacientes'); }, 'clinic-back'));
    var top = el('header', 'clinic-patient-heading');
    var identity = el('div'); identity.append(el('p', 'pro-eyebrow', 'FICHA DEL PACIENTE'), el('h1', '', fullName(p)));
    var edit = button('Editar datos', function () { abrirModalPaciente(p.id); }); edit.disabled = !!p._local;
    top.append(identity, edit); screen.append(top);
    var layout = el('div', 'clinic-layout'), aside = el('aside', 'clinic-patient-card');
    aside.append(el('div', 'clinic-avatar', (p.nombre || '?').slice(0, 1).toUpperCase()), el('h2', '', 'Datos de contacto'));
    [['Teléfono',p.telefono],['Correo',p.email],['Fecha de nacimiento',p.fecha_nacimiento]].forEach(function (pair) {
      aside.append(el('span', 'clinic-caption', pair[0]), el('p', '', pair[1] || 'Sin registrar'));
    });
    if (p.notas) { var previousNotes = el('details', 'clinic-secondary'); previousNotes.append(el('summary', '', 'Notas del registro anterior'), el('p', '', p.notas)); aside.append(previousNotes); }
    aside.append(el('p', 'clinic-privacy', 'Información privada de la clínica.'));
    // Preserve access to historical local entries by exact ID, never by name.
    try {
      var oldCases = JSON.parse(localStorage.getItem('camila_cotizaciones_' + ctx.tenant) || '[]');
      oldCases = Array.isArray(oldCases) ? oldCases.filter(function (c) { return c.paciente_id === p.id; }) : [];
      if (oldCases.length) {
        var activity = el('details', 'clinic-secondary'); activity.append(el('summary', '', 'Actividad anterior · este dispositivo'));
        oldCases.forEach(function (c) { activity.append(el('p', '', (c.nombre || 'Diseño') + ' · ' + (c.fecha || 'Sin fecha'))); }); aside.append(activity);
      }
    } catch (_) { /* Do not discard or rewrite an unreadable legacy archive. */ }
    var main = el('section', 'clinic-workspace');
    var heading = el('div', 'clinic-workspace-heading'); var title = el('div');
    title.append(el('p', 'pro-eyebrow', 'ESPACIO DEL DENTISTA'), el('h2', '', 'Valoración y tratamiento'));
    var state = el('span', 'clinic-state', 'Cargando…'); state.id = 'clinic-state'; state.setAttribute('role', 'status');
    heading.append(title, state); main.append(heading);
    var feedback = el('div'); feedback.id = 'clinic-feedback'; var content = el('div'); content.id = 'clinic-content';
    main.append(feedback, content);
    var versions = el('details', 'clinic-secondary'); versions.id = 'clinic-history';
    versions.append(el('summary', '', 'Versiones guardadas')); var versionList = el('div'); versionList.id = 'clinic-history-list'; versions.append(versionList); versions.addEventListener('toggle', history); main.append(versions);
    layout.append(aside, main); screen.append(layout);
    if (p._local) {
      state.textContent = 'Solo en este dispositivo';
      feedback.append(notice('Este registro antiguo no está sincronizado. No se creará un expediente en nube ni se asociará por nombre. Su traslado requiere revisión.'));
      versions.hidden = true; return;
    }
    if (miRolEquipo !== 'dueño') {
      state.textContent = 'Acceso limitado';
      feedback.append(notice('La edición clínica está habilitada para el titular de la clínica. Los permisos para otros profesionales se configurarán por separado.'));
      versions.hidden = true; return;
    }
    content.append(notice('Cargando el expediente…'));
    try {
      var data = await checked(sb.from('smyl_clinical_plans').select('*').eq('tenant_id', ctx.tenant).eq('patient_id', p.id).maybeSingle());
      if (current !== ctx || sequence !== token || tenantId !== ctx.tenant || !content.isConnected) return;
      ctx.row = data; ctx.ready = true; renderEditor();
    } catch (error) {
      if (current !== ctx || sequence !== token || !content.isConnected) return;
      state.textContent = 'No disponible'; content.replaceChildren();
      feedback.append(notice(model.errorMessage(error), true), button('Intentar de nuevo', function () { verPaciente(p.id); })); versions.hidden = true;
    }
  }
  async function loadPatients() {
    var tenant = tenantId, token = ++patientSequence;
    if (!tenant) return;
    var host = document.getElementById('tabla-pacientes-wrap'); host.replaceChildren(notice('Cargando pacientes…'));
    patientMessage = ''; patientFailure = false;
    try {
      var data = await checked(sb.from('camila_pacientes').select('*').eq('tenant_id', tenant).order('created_at', { ascending: false }));
      if (token !== patientSequence || tenantId !== tenant) return;
      todosLosPacientes = data || [];
    } catch (error) {
      if (token !== patientSequence || tenantId !== tenant) return;
      todosLosPacientes = localPatients(); patientMessage = model.errorMessage(error); patientFailure = true;
      if (todosLosPacientes.length) patientMessage += ' Mostramos registros antiguos de este dispositivo, solo para consulta.';
    }
    renderTablaPacientes(todosLosPacientes);
  }
  function renderPatients(list) {
    var host = document.getElementById('tabla-pacientes-wrap'); host.replaceChildren();
    if (patientMessage) host.append(notice(patientMessage, patientFailure), button('Volver a cargar', loadPatients));
    if (!list.length && !patientFailure) host.append(notice(todosLosPacientes.length ? 'No encontramos pacientes con esa búsqueda.' : 'Empieza con un nombre. Los demás datos puedes añadirlos después.'));
    var grid = el('div', 'clinic-patient-list');
    list.forEach(function (p) {
      var card = el('article', 'clinic-patient-row');
      var avatar = el('div', 'clinic-avatar', (p.nombre || '?').slice(0, 1).toUpperCase());
      var name = el('div'); name.append(el('h3', '', fullName(p)), el('p', '', p.telefono || p.email || 'Contacto pendiente'));
      if (p._local) name.append(el('small', '', 'Solo en este dispositivo'));
      card.append(avatar, name, button('Abrir ficha', function () { verPaciente(p.id); })); grid.append(card);
    });
    host.append(grid);
    var legacy = localPatients();
    if (!patientFailure && legacy.length) {
      var old = el('details', 'clinic-secondary');
      old.append(el('summary', '', legacy.length + ' registros antiguos en este dispositivo'), notice('No están vinculados automáticamente a las fichas de la clínica. Conservamos el archivo local; su traslado requiere revisión.'));
      legacy.forEach(function (p) { old.append(el('p', '', fullName(p) + ' · ' + (p.telefono || p.email || 'Sin contacto'))); }); host.append(old);
    }
  }
  async function savePatient() {
    if (savingPatient) return;
    var feedback = document.getElementById('patient-feedback'); feedback.replaceChildren();
    var ids = ['mp-nombre','mp-apellido','mp-email','mp-tel','mp-fnac','mp-genero','mp-notas'];
    for (var id of ids) { if (!document.getElementById(id).reportValidity()) return; }
    if (!tenantId) { feedback.append(notice('Inicia sesión para guardar en tu clínica.', true)); return; }
    if (current && current.dirty && !confirm('Editar los datos recargará la ficha y descartará las notas clínicas sin guardar. ¿Continuar?')) return;
    var tenant = tenantId, editing = editandoPacienteId;
    var original = todosLosPacientes.find(function (p) { return p.id === editing; });
    if (editing && (!original || original._local)) { feedback.append(notice('Este registro no está disponible para editar en nube.', true)); return; }
    var data = { tenant_id: tenant, nombre: document.getElementById('mp-nombre').value.trim(), apellido: document.getElementById('mp-apellido').value.trim(), email: document.getElementById('mp-email').value.trim(), telefono: document.getElementById('mp-tel').value.trim(), fecha_nacimiento: document.getElementById('mp-fnac').value || null, genero: document.getElementById('mp-genero').value || null, notas: document.getElementById('mp-notas').value.trim() };
    if (!data.nombre) { feedback.append(notice('Escribe el nombre del paciente.', true)); return; }
    patientAttempt = patientAttempt || crypto.randomUUID();
    savingPatient = true; document.querySelectorAll('#modal-paciente button,#modal-paciente input,#modal-paciente select,#modal-paciente textarea').forEach(function (b) { b.disabled = true; });
    try {
      var q;
      if (editing) {
        q = sb.from('camila_pacientes').update(data).eq('tenant_id', tenant).eq('id', editing);
        if (original.updated_at) q = q.eq('updated_at', original.updated_at);
      } else { data.id = patientAttempt; q = sb.from('camila_pacientes').insert([data]); }
      var saved = await checked(q.select('*').single());
      if (!saved || !saved.id || saved.tenant_id !== tenant) throw new Error('Unconfirmed patient save');
      if (tenantId !== tenant) return;
      if (current) current.dirty = false;
      var index = todosLosPacientes.findIndex(function (p) { return p.id === saved.id; });
      if (index < 0) todosLosPacientes.unshift(saved); else todosLosPacientes[index] = saved;
      document.getElementById('modal-paciente').classList.remove('visible'); patientAttempt = null;
      await verPaciente(saved.id);
    } catch (error) {
      feedback.append(notice(error.code === '23505' || error.code === 'PGRST116' ? 'No se confirmó esta operación. Cierra el formulario y vuelve a cargar Pacientes antes de reintentar para evitar duplicados o sobrescribir cambios.' : model.errorMessage(error), true));
    } finally { savingPatient = false; document.querySelectorAll('#modal-paciente button,#modal-paciente input,#modal-paciente select,#modal-paciente textarea').forEach(function (b) { b.disabled = false; }); }
  }
  async function loadPatientSelect() {
    var select = document.getElementById('f-caso-paciente'), tenant = tenantId, selected = select.value;
    select.disabled = true;
    try {
      var rows = await checked(sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id', tenant).order('nombre'));
      if (tenant !== tenantId) return;
      select.replaceChildren(new Option('Seleccionar paciente…',''));
      rows.forEach(function (p) { select.append(new Option(fullName(p), p.id)); });
      select.value = selected; select.disabled = false;
    } catch (_) { select.replaceChildren(new Option('No se pudieron cargar los pacientes','')); }
  }
  function init() {
    window.SmylClinicalPreview = Object.freeze({ capture: capturePatientReview });
    // A guided return to mySmyl. Never saves or approves on the dentist's behalf.
    window.SmylClinicalWorkflow = Object.freeze({
      status: function (tenant, patient) {
        var ctx = current;
        if (!ctx || ctx.tenant !== tenant || ctx.patient !== patient) return null;
        var review = capturePatientReview(tenant, patient);
        var doc = ctx.ready ? formDocument() : null;
        return { ready: !!review, revision: review ? review.revision : null, dirty: ctx.dirty || ctx.saving,
          available: ctx.ready, saving: ctx.saving, saved: !!ctx.row,
          assessment: !!doc?.assessment.trim(), treatments: !!doc?.treatments.some(function (t) { return t.name.trim(); }) };
      },
      focus: function (tenant, patient, resume) {
        var ctx = current;
        if (!ctx || ctx.tenant !== tenant || ctx.patient !== patient || miRolEquipo !== 'dueño') return false;
        var host = document.getElementById('clinic-content');
        if (!host || !document.getElementById('clinic-form')) return false;
        window.SmylCaseWorkspace?.open('plan');
        document.getElementById('clinic-portal-return')?.remove();
        var guide = el('section', 'clinic-notice'); guide.id = 'clinic-portal-return';
        guide.append(el('strong', '', '1 · Preparar la propuesta'), el('p'), button('Continuar con mySmyl', function () {
          if (current === ctx && capturePatientReview(tenant, patient)) resume();
        }, 'btn btn-primary'));
        host.prepend(guide); status();
        guide.scrollIntoView({ block: 'center' });
        var target = document.getElementById('clinic-assessment');
        target?.focus({ preventScroll: true });
        return true;
      }
    });
    window.cargarPacientes = loadPatients; window.renderTablaPacientes = renderPatients;
    window.verPaciente = openPatient; window.guardarPaciente = savePatient;
    window.cargarPacientesSelect = loadPatientSelect;
    TITULOS['paciente-detalle'] = 'Ficha del paciente';
    var priorRoute = window.ir;
    window.ir = function (route) {
      if (current && route !== 'paciente-detalle' && !leave()) return false;
      priorRoute(route);
      if (route === 'paciente-detalle') document.querySelectorAll('.pro-primary-nav .nav-item,.pro-mobile-nav .nav-item').forEach(function (n) { if (n.getAttribute('onclick') === "ir('pacientes')") n.setAttribute('aria-current','page'); });
      return true;
    };
    var oldOpen = window.abrirModalPaciente;
    window.abrirModalPaciente = function (id) {
      if (current && current.saving) return;
      if (id && todosLosPacientes.some(function (p) { return p.id === id && p._local; })) return;
      oldOpen(id); patientAttempt = null; document.getElementById('patient-feedback').replaceChildren();
      document.getElementById('mp-nombre').focus();
    };
    var oldClose = window.cerrarModalPaciente;
    window.cerrarModalPaciente = function () { if (!savingPatient) oldClose(); };
    var oldLogout = window.cerrarSesion;
    window.cerrarSesion = function () { if (leave()) oldLogout(); };
    addEventListener('beforeunload', function (event) { if ((current && (current.dirty || current.saving)) || savingPatient) { event.preventDefault(); event.returnValue = ''; } });
    var modal = document.getElementById('modal-paciente');
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-labelledby','modal-pac-title');
    var fields = modal.querySelector('.form-grid'), optional = el('details', 'clinic-secondary clinic-patient-extra');
    optional.append(el('summary', '', 'Más datos · opcional'));
    var extra = el('div', 'form-grid');
    ['mp-fnac','mp-genero','mp-notas'].forEach(function (id) { extra.append(document.getElementById(id).closest('.fg')); });
    optional.append(extra); fields.after(optional);
    document.getElementById('mp-nombre').required = true;
    [['mp-nombre',150],['mp-apellido',150],['mp-email',254],['mp-tel',60],['mp-notas',8000]].forEach(function (pair) { document.getElementById(pair[0]).maxLength = pair[1]; });
    modal.querySelectorAll('.fg').forEach(function (f) { var input = f.querySelector('input,textarea,select'); f.querySelector('label').htmlFor = input.id; });
    document.getElementById('mp-notas').placeholder = 'Notas de contacto. Registra antecedentes en la ficha clínica.';
    var message = el('div'); message.id = 'patient-feedback'; modal.querySelector('.modal-footer').before(message);
    var dialog = el('dialog', 'clinic-dialog'); dialog.id = 'clinic-review-dialog'; dialog.setAttribute('aria-labelledby','clinic-review-title');
    var reviewTitle = el('h2', '', 'Revisar este plan'); reviewTitle.id = 'clinic-review-title';
    var label = el('label', 'clinic-confirm'); var check = el('input'); check.type = 'checkbox'; check.id = 'clinic-review-confirm';
    label.append(check, document.createTextNode('Revisé la valoración y el plan. Como profesional, me hago responsable de su contenido.'));
    var actions = el('div', 'clinic-actions');
    var approve = button('Guardar como revisado', function () { savePlan(true); }, 'btn btn-primary'); approve.id = 'clinic-review-submit';
    approve.disabled = true; check.addEventListener('change', function () { approve.disabled = !check.checked; });
    actions.append(button('Volver al plan', function () { dialog.close(); }), approve);
    var summary = el('section','clinic-review-summary'); summary.id = 'clinic-review-summary';
    dialog.append(reviewTitle, el('p', '', 'Comprueba el contenido antes de confirmar. Se conservarán las versiones anteriores. No se enviará nada al paciente.'), summary, label, actions); document.body.append(dialog);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
