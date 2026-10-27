/* Stage 3: clinician-owned plan with explicit AI drafting. AI never saves, approves or sends. */
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
  function patientClinicName() {
    var t = window.tenantData || {};
    return (t.config && t.config.consultorio) || t.nombre || '';
  }
  // Antes de llenar el formulario, pregunta a la base lo mismo que exigirá la
  // política de camila_pacientes: que la clínica de la sesión sea la de la
  // pantalla y que el rol tenga patients.manage. Si la base no tiene estas
  // funciones (PGRST202) no bloquea nada.
  async function patientPermissionCheck(tenant) {
    try {
      var results = await Promise.all([
        sbTimeout(sb.rpc('smyl_current_tenant'), 10000),
        sbTimeout(sb.rpc('smyl_has_permission', { p_tenant_id: tenant, p_permission: 'patients.manage' }), 10000)
      ]);
      var resolved = results[0], allowed = results[1];
      if ((resolved.error && resolved.error.code === 'PGRST202') || (allowed.error && allowed.error.code === 'PGRST202')) return null;
      if ((resolved.error && resolved.error.code === 'PGRST301') || (allowed.error && allowed.error.code === 'PGRST301')) return { ok: false, reason: 'session' };
      if (resolved.error || allowed.error) return null;
      if (resolved.data && resolved.data !== tenant) return { ok: false, reason: 'tenant' };
      return { ok: allowed.data === true, reason: allowed.data === true ? '' : 'permission' };
    } catch (_) { return null; }
  }
  function patientBlockMessage(reason) {
    if (reason === 'session') return 'Tu sesión expiró. Vuelve a iniciar sesión para dar de alta pacientes.';
    if (reason === 'tenant') return 'Tu cuenta está activa en una clínica distinta a la que muestra la pantalla. Cierra sesión y vuelve a entrar.';
    if (reason === 'scope') return 'Tu cuenta tiene permiso para dar de alta pacientes, pero el alcance de datos de tu rol no incluye la ficha nueva y la base la rechazó. Pide al propietario que revise el alcance de «Pacientes» de tu rol en Mi clínica → Equipo, roles y profesionales.';
    return 'Tu rol en esta clínica no permite dar de alta ni editar pacientes (permiso «Pacientes · gestionar»). Pide al propietario que lo active en Mi clínica → Equipo, roles y profesionales.';
  }
  var intakeCatalogs = { tenant: null, branches: [], professionals: [] };
  var duplicateTimer = null, duplicateAck = false, duplicateHits = [];
  // Misma regla que smyl_normalize_contact_phone() en la base, para que el aviso
  // de duplicado coincida con lo que luego usa la vinculación automática del chat.
  function phoneKey(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10) return digits;
    if (digits.length === 12 && digits.slice(0, 2) === '52') return digits.slice(2);
    if (digits.length === 13 && digits.slice(0, 3) === '521') return digits.slice(3);
    return digits.length >= 8 && digits.length <= 15 ? digits : '';
  }
  function composePhone(cc, national) {
    var digits = String(national || '').replace(/\D/g, '');
    if (!digits) return '';
    if (!cc) return String(national || '').trim();
    return '+' + cc + ' ' + digits;
  }
  function splitPhone(value) {
    var raw = String(value || '').trim();
    var select = document.getElementById('mp-tel-cc');
    var codes = Array.prototype.map.call(select.options, function (option) { return option.value; });
    var match = raw.match(/^\+(\d{1,3})[\s-]*(.*)$/);
    if (match && codes.indexOf(match[1]) >= 0) return { cc: match[1], national: match[2].replace(/\D/g, '') };
    if (match) return { cc: '', national: raw };
    var digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return { cc: '52', national: digits };
    return { cc: raw ? '' : '52', national: raw };
  }
  function readAlerts() {
    return Array.prototype.map.call(document.querySelectorAll('#mp-alertas .mp-chip'), function (chip) { return chip.dataset.value; });
  }
  function renderAlerts(values) {
    var host = document.getElementById('mp-alertas'); host.replaceChildren();
    (values || []).slice(0, 20).forEach(function (value) {
      var chip = el('span', 'mp-chip', value); chip.dataset.value = value;
      var remove = el('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Quitar ' + value);
      remove.addEventListener('click', function () { chip.remove(); });
      chip.append(remove); host.append(chip);
    });
  }
  function addAlert(value) {
    var text = String(value || '').trim().slice(0, 60);
    if (!text) return;
    var existing = readAlerts();
    if (existing.length >= 20 || existing.some(function (item) { return item.toLowerCase() === text.toLowerCase(); })) return;
    renderAlerts(existing.concat([text]));
  }
  async function loadIntakeCatalogs(tenant) {
    if (intakeCatalogs.tenant === tenant) return intakeCatalogs;
    var result = { tenant: tenant, branches: [], professionals: [] };
    try {
      var rows = await Promise.all([
        checked(sb.from('smyl_branches').select('id,name,is_default').eq('tenant_id', tenant).eq('active', true).order('name')),
        checked(sb.from('smyl_professionals').select('id,display_name').eq('tenant_id', tenant).eq('active', true).order('display_name'))
      ]);
      result.branches = rows[0] || []; result.professionals = rows[1] || [];
    } catch (_) { /* sin catálogos el alta sigue funcionando, solo sin sucursal ni profesional */ }
    intakeCatalogs = result; return result;
  }
  function fillIntakeSelects(catalogs, patient) {
    var branch = document.getElementById('mp-sucursal'), professional = document.getElementById('mp-profesional');
    branch.replaceChildren(new Option('Sin sucursal', ''));
    catalogs.branches.forEach(function (item) { branch.append(new Option(item.name, item.id)); });
    professional.replaceChildren(new Option('Por asignar', ''));
    catalogs.professionals.forEach(function (item) { professional.append(new Option(item.display_name, item.id)); });
    var preferred = catalogs.branches.find(function (item) { return item.is_default; }) || catalogs.branches[0];
    branch.value = (patient && patient.branch_id) || (catalogs.branches.length === 1 && preferred ? preferred.id : '');
    if (patient && patient.branch_id && branch.value !== patient.branch_id) branch.value = '';
    document.getElementById('mp-sucursal-fg').hidden = catalogs.branches.length < 2;
    professional.value = (patient && patient.professional_id) || '';
    if (patient && patient.professional_id && professional.value !== patient.professional_id) professional.value = '';
  }
  function renderDuplicates(hits) {
    var host = document.getElementById('mp-duplicados'); host.replaceChildren();
    duplicateHits = hits || [];
    if (!duplicateHits.length) return;
    var first = duplicateHits[0];
    var box = el('div', 'clinic-notice clinic-error mp-dup'); box.setAttribute('role', 'alert');
    box.append(el('strong', '', duplicateHits.length === 1 ? 'Ya existe un paciente con estos datos' : 'Ya existen ' + duplicateHits.length + ' pacientes con estos datos'));
    box.append(el('p', '', [first.name, first.match === 'telefono' ? 'mismo teléfono' : 'mismo correo', first.phone, first.email].filter(Boolean).join(' · ')));
    var actions = el('div', 'mp-dup-actions');
    actions.append(button('Abrir su ficha', function () { window.cerrarModalPaciente(); verPaciente(first.id); }, 'btn btn-primary btn-sm'));
    actions.append(button('Es otra persona, continuar', function () { duplicateAck = true; host.replaceChildren(); }, 'btn btn-secondary btn-sm'));
    box.append(actions); host.append(box);
  }
  async function findDuplicates(tenant, email, phone, excludeId) {
    var emailKey = String(email || '').trim().toLowerCase(), key = phoneKey(phone);
    if (!emailKey && !key) return [];
    var response = await sbTimeout(sb.rpc('smyl_patient_duplicates', { p_tenant_id: tenant, p_email: emailKey, p_telefono: phone, p_exclude_id: excludeId || null }), 10000);
    if (response.error && (response.error.code === 'PGRST202' || response.error.code === '42883')) {
      // La base aún no tiene la RPC: comparar con la lista ya cargada en pantalla.
      return todosLosPacientes.filter(function (p) {
        if (p._local || p.id === excludeId) return false;
        return (emailKey && String(p.email || '').trim().toLowerCase() === emailKey) || (key && phoneKey(p.telefono) === key);
      }).slice(0, 5).map(function (p) {
        return { id: p.id, name: fullName(p), email: p.email, phone: p.telefono, match: key && phoneKey(p.telefono) === key ? 'telefono' : 'email' };
      });
    }
    if (response.error) return [];
    return response.data || [];
  }
  function scheduleDuplicateCheck() {
    clearTimeout(duplicateTimer);
    duplicateAck = false;
    duplicateTimer = setTimeout(async function () {
      var tenant = tenantId, editing = editandoPacienteId;
      var email = document.getElementById('mp-email').value.trim();
      var phone = composePhone(document.getElementById('mp-tel-cc').value, document.getElementById('mp-tel').value);
      try {
        var hits = await findDuplicates(tenant, email, phone, editing);
        if (tenant === tenantId && document.getElementById('modal-paciente').classList.contains('visible')) renderDuplicates(hits);
      } catch (_) {}
    }, 450);
  }
  async function clinicalCapabilities(tenant) {
    if (miRolEquipo === 'dueño') return { canRead: true, canWrite: true, canApprove: true };
    var auth = await sb.auth.getUser(), actor = auth.data && auth.data.user && auth.data.user.id;
    if (!actor) return { canRead: false, canWrite: false, canApprove: false };
    var assignments = await checked(sb.from('smyl_member_roles').select('role_id').eq('tenant_id', tenant).eq('user_id', actor));
    var roleIds = (assignments || []).map(function (row) { return row.role_id; });
    if (!roleIds.length) return { canRead: false, canWrite: false, canApprove: false };
    var rows = await checked(sb.from('smyl_role_permissions').select('permission_key').eq('tenant_id', tenant).in('role_id', roleIds));
    var permissions = new Set((rows || []).map(function (row) { return row.permission_key; }));
    return { canRead: permissions.has('clinical.read'), canWrite: permissions.has('clinical.write'), canApprove: permissions.has('clinical.approve') };
  }
  function localPatients() {
    return [];
  }
  function leave() {
    if (current && current.saving) { alert('Espera a que termine el guardado.'); return false; }
    if (current && current.aiBusy) { alert('Espera a que termine el borrador con IA o cancélalo.'); return false; }
    if (current && current.dirty && !confirm('Hay cambios sin guardar en la ficha. ¿Quieres salir y descartarlos?')) return false;
    sequence++; current = null; return true;
  }
  function formDocument() {
    return model.normalize({
      reason: document.getElementById('clinic-reason').value,
      background: document.getElementById('clinic-background').value,
      assessment: document.getElementById('clinic-assessment').value,
      treatments: Array.from(document.querySelectorAll('.clinic-treatment')).map(function (row) {
        var service = row.dataset.serviceSnapshot ? JSON.parse(row.dataset.serviceSnapshot) : null;
        return {
          id: row.dataset.treatmentId, name: row.querySelector('[data-field="name"]').value,
          area: row.querySelector('[data-field="area"]').value, notes: row.querySelector('[data-field="notes"]').value,
          phase: row.querySelector('[data-field="phase"]').value, service_id: row.dataset.serviceId || null,
          service_revision: row.dataset.serviceRevision ? Number(row.dataset.serviceRevision) : null,
          service_snapshot: service, teeth: JSON.parse(row.dataset.teeth || '[]'), surfaces: JSON.parse(row.dataset.surfaces || '[]')
        };
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
        ctx.canApprove && document.getElementById('p-paciente-detalle').classList.contains('activa') &&
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
    if (current.aiDraft) clearAIDraft('La información cambió. Genera otro borrador si quieres volver a usar la IA.');
    status();
  }
  function status() {
    if (!current || !document.getElementById('clinic-form')) return;
    var savedReview = current.row && current.row.status === 'reviewed';
    var label = current.dirty ? 'Cambios sin guardar' : savedReview ? 'Revisado por el profesional' : current.row ? 'Borrador guardado' : 'Sin guardar';
    document.getElementById('clinic-state').textContent = label;
    document.getElementById('clinic-state').classList.toggle('clinic-reviewed', savedReview && !current.dirty);
    document.getElementById('clinic-save-status').textContent = current.saving ? 'Guardando…' : current.dirty && savedReview ? 'Al guardar, esta versión volverá a borrador. La revisión anterior permanece en el historial.' : current.row ? 'Versión ' + current.row.revision + ' · ' + date(current.row.updated_at) : 'No se guarda automáticamente. Tus notas no se envían al paciente ni al servicio de mensajería.';
    document.getElementById('clinic-save').disabled = !current.ready || !current.canWrite || current.saving || (!current.dirty && !!current.row);
    document.getElementById('clinic-review').disabled = !current.ready || !current.canWrite || !current.canApprove || current.saving || (savedReview && !current.dirty);
    document.getElementById('clinic-add').disabled = !current.ready || !current.canWrite || current.saving || document.querySelectorAll('.clinic-treatment').length >= 20;
    var proposal = document.getElementById('clinic-proposal');
    if (proposal) proposal.disabled = !current.canApprove || !savedReview || current.dirty || current.saving;
    var resume = document.getElementById('clinic-portal-return');
    if (resume) {
      var ready = !!capturePatientReview(current.tenant, current.patient);
      resume.querySelector('p').textContent = ready ? 'Listo. Tu valoración y plan ya están revisados.' : 'Falta completar la valoración y el tratamiento, y pulsar «Revisar plan». Después podrás continuar aquí.';
      resume.querySelector('button').disabled = !ready;
    }
    updateAIState();
  }
  var rowSequence = 0;
  function treatmentSummary(row) {
    var teeth = JSON.parse(row.dataset.teeth || '[]'), surfaces = JSON.parse(row.dataset.surfaces || '[]');
    var summary = row.querySelector('.clinic-treatment-target-summary');
    summary.textContent = teeth.length ? 'Piezas FDI ' + teeth.join(', ') + (surfaces.length ? ' · Superficies ' + surfaces.join(', ') : ' · Pieza completa') : 'Sin piezas seleccionadas · tratamiento general';
  }
  function editTreatmentTargets(row) {
    var teeth = new Set(JSON.parse(row.dataset.teeth || '[]')), surfaces = new Set(JSON.parse(row.dataset.surfaces || '[]'));
    var dialog = el('dialog','clinic-dialog clinic-target-dialog'), title = el('h2','','Piezas y superficies');
    dialog.setAttribute('aria-label','Seleccionar piezas y superficies');
    dialog.append(title,el('p','clinic-privacy','Marca únicamente lo confirmado por el profesional. Sin marca significa sin pieza asociada, no “sano”.'));
    var map = el('div','dr-map clinic-target-map');dialog.append(map);
    function draw(){SmylToothMap.render(map,{state:function(tooth){return {selected:teeth.has(tooth),className:teeth.has(tooth)?'pr-proposed':'',label:teeth.has(tooth)?'Seleccionado':'Sin seleccionar'};},onSelect:function(tooth){if(teeth.has(tooth))teeth.delete(tooth);else teeth.add(tooth);draw();}});}
    draw();
    var surfaceBox=el('fieldset','clinic-surface-picker'),legend=el('legend','','Superficies para las piezas seleccionadas');surfaceBox.append(legend);
    model.surfaces.forEach(function(entry){var label=el('label'),input=el('input');input.type='checkbox';input.value=entry[0];input.checked=surfaces.has(entry[0]);input.onchange=function(){if(input.checked)surfaces.add(input.value);else surfaces.delete(input.value);};label.append(input,document.createTextNode(entry[0]+' · '+entry[1]));surfaceBox.append(label);});
    var actions=el('div','clinic-actions');actions.append(button('Cancelar',function(){dialog.close();}),button('Aplicar selección',function(){row.dataset.teeth=JSON.stringify(Array.from(teeth));row.dataset.surfaces=JSON.stringify(teeth.size?Array.from(surfaces):[]);treatmentSummary(row);dialog.close();changed();},'btn btn-primary'));dialog.append(surfaceBox,actions);document.body.append(dialog);dialog.addEventListener('close',function(){dialog.remove();},{once:true});dialog.showModal();
  }
  function addTreatment(item) {
    item = item || {};
    if (document.querySelectorAll('.clinic-treatment').length >= 20) return;
    var row = el('article', 'clinic-treatment'); rowSequence++;
    row.dataset.treatmentId = item.id || crypto.randomUUID();
    row.dataset.serviceId = item.service_id || '';
    row.dataset.serviceRevision = item.service_revision || '';
    row.dataset.serviceSnapshot = item.service_snapshot ? JSON.stringify(model.snapshot(item.service_snapshot)) : '';
    row.dataset.teeth = JSON.stringify(item.teeth || []);row.dataset.surfaces = JSON.stringify(item.surfaces || []);
    var serviceField=el('div','clinic-field'),serviceLabel=el('label','','Servicio del catálogo · opcional'),service=el('select');service.dataset.field='service';serviceLabel.htmlFor='clinic-item-'+rowSequence+'-service';service.id=serviceLabel.htmlFor;service.append(new Option('Indicación clínica sin concepto comercial',''));
    (current.services||[]).forEach(function(s){var option=new Option(s.patient_name||s.name,s.id);option.disabled=!s.active;service.append(option);});
    if(item.service_id&&!Array.from(service.options).some(function(o){return o.value===item.service_id;})){var historical=new Option((item.service_snapshot&&item.service_snapshot.patient_name)||item.name,item.service_id);historical.disabled=true;service.append(historical);}
    service.value=item.service_id||'';service.onchange=function(){var selected=(current.services||[]).find(function(s){return s.id===service.value;});if(!selected){row.dataset.serviceId='';row.dataset.serviceRevision='';row.dataset.serviceSnapshot='';return changed();}row.dataset.serviceId=selected.id;row.dataset.serviceRevision=String(selected.catalog_revision);row.dataset.serviceSnapshot=JSON.stringify(model.snapshot(selected));row.querySelector('[data-field="name"]').value=selected.patient_name||selected.name;changed();};serviceField.append(serviceLabel,service);row.append(serviceField);
    var phaseField=el('div','clinic-field'),phaseLabel=el('label','','Fase'),phase=el('select');phase.id='clinic-item-'+rowSequence+'-phase';phaseLabel.htmlFor=phase.id;phase.dataset.field='phase';model.phases.forEach(function(entry){phase.add(new Option(entry[1],entry[0]));});phase.value=item.phase||'treat';phaseField.append(phaseLabel,phase);row.append(phaseField);
    [['Tratamiento o indicación','name',200],['Zona o piezas · opcional','area',200],['Detalles · opcional','notes',2000]].forEach(function (entry) {
      var f = field(entry[0], 'clinic-item-' + rowSequence + '-' + entry[1], item[entry[1]], entry[2], entry[1] === 'notes');
      f.lastElementChild.dataset.field = entry[1]; row.append(f);
    });
    var targets=el('div','clinic-treatment-targets'),summary=el('p','clinic-treatment-target-summary');targets.append(summary,button('Señalar en odontograma',function(){editTreatmentTargets(row);},'btn btn-secondary'));row.append(targets);treatmentSummary(row);
    var remove = button('Quitar', function () { row.remove(); changed(); }, 'clinic-remove');
    remove.setAttribute('aria-label', 'Quitar este tratamiento'); row.append(remove);
    document.getElementById('clinic-treatments').append(row);
  }
  function planContext(ctx) {
    if (!ctx || current !== ctx || !ctx.ready || ctx.saving || ctx.aiBusy) return {error:'El plan no está listo.'};
    var selected = window.SmylCaseWorkspace?.context(ctx.tenant, ctx.patient);
    if (!selected) return {error:'Selecciona primero una sesión en Evidencias.'};
    var dental = window.SmylDentalProgress?.planContext(ctx.tenant, ctx.patient, selected.caseId);
    if (!dental) return {error:'Espera a que termine de cargar la revisión clínica.'};
    if (!dental.ready) return {error:dental.pending ? 'Termina de revisar '+dental.pending+' observaciones antes de preparar el plan con IA.' : 'Guarda el mapa y comprueba la revisión clínica antes de continuar.'};
    var doc = formDocument(),raw=[];
    function add(source,tooth,text){text=String(text||'').trim();if(text&&raw.length<64)raw.push({source:source,tooth:tooth||'',text:text.slice(0,1200)});}
    add('patient_goal','',doc.reason);
    add('clinical_history','',doc.background);
    add('clinician_assessment','',doc.assessment);
    doc.treatments.forEach(function(t){add('clinician_assessment',/^[1-4][1-8]$/.test(t.area)?t.area:'',['Tratamiento ya registrado: '+t.name,t.area&&'Zona: '+t.area,t.notes].filter(Boolean).join('\n'));});
    dental.evidence.forEach(function(item){add(item.source,item.tooth,item.text);});
    if (!raw.length) return {error:'Registra el motivo de consulta o confirma al menos una observación antes de usar la IA.'};
    var input={schema:1,evidence:raw.map(function(item,index){return {id:'E'+(index+1),source:item.source,tooth:item.tooth,text:item.text};}),limitations:dental.limitations.slice(0,20)};
    if (!window.SmylTreatmentPlanModel?.validateInput(input)) return {error:'La información confirmada no está lista para generar un borrador.'};
    var formSnapshot=JSON.stringify(doc),fingerprint=dental.fingerprint;
    return {input:input,dental:dental,selected:selected,isCurrent:function(){return current===ctx&&ctx.ready&&!ctx.saving&&selected.isCurrent()&&dental.isCurrent()&&dental.fingerprint===fingerprint&&JSON.stringify(formDocument())===formSnapshot;}};
  }
  function clearAIDraft(message) {
    if (!current) return;
    current.aiDraft=null;
    var results=document.getElementById('clinic-ai-results');if(results)results.replaceChildren();
    var state=document.getElementById('clinic-ai-state');if(state&&message)state.textContent=message;
  }
  function updateAIState() {
    var ctx=current,generate=document.getElementById('clinic-ai-generate'),state=document.getElementById('clinic-ai-state'),consent=document.getElementById('clinic-ai-consent');
    if (!ctx||!generate||!state||!consent) return;
    if (ctx.aiBusy) { generate.disabled=false;generate.textContent='Cancelar';state.textContent='Preparando un borrador privado…';return; }
    generate.textContent='Preparar borrador con IA';
    var capture=planContext(ctx);
    generate.disabled=!!capture.error||!consent.checked||ctx.saving;
    if (!ctx.aiDraft) {
      if (capture.error) state.textContent=capture.error;
      else {
        var count=capture.input.evidence.length;
        state.textContent='Usará '+count+' '+(count===1?'dato confirmado':'datos confirmados')+'. No enviará nombres, fotos ni simulaciones.';
      }
    }
  }
  function sourceLabel(item) {
    var labels={patient_goal:'Motivo del paciente',clinical_history:'Antecedente clínico',clinician_assessment:'Criterio del dentista',manual_map:'Nota del mapa',photo_confirmed:'Fotografía confirmada',radiograph_confirmed:'Radiografía confirmada'};
    return (item.tooth?'Diente '+item.tooth+' · ':'')+(labels[item.source]||'Evidencia confirmada');
  }
  function renderAIDraft(ctx,result,capture) {
    if (current!==ctx||!capture.isCurrent()) return;
    ctx.aiDraft={result:result,capture:capture};
    var draft=result.draft,host=document.getElementById('clinic-ai-results');host.replaceChildren();
    var summary=el('section','clinic-ai-summary');summary.append(el('strong','','Valoración sugerida'),el('p','',draft.summary));
    var assessment=el('label','clinic-ai-choice'),assessmentCheck=el('input');assessmentCheck.type='checkbox';assessmentCheck.dataset.aiAssessment='true';assessmentCheck.checked=!document.getElementById('clinic-assessment').value.trim();
    assessment.append(assessmentCheck,document.createTextNode(document.getElementById('clinic-assessment').value.trim()?' Usar esta valoración y reemplazar la actual':' Usar esta valoración en el plan'));summary.append(assessment);host.append(summary);
    if(draft.goals.length){var goals=el('section','clinic-ai-list');goals.append(el('strong','','Objetivos sugeridos'));var goalList=el('ul');draft.goals.forEach(function(v){goalList.append(el('li','',v));});goals.append(goalList);host.append(goals);}
    var heading=el('div','clinic-ai-result-heading');heading.append(el('strong','','Opciones de tratamiento'),el('span','',draft.treatments.length+' sugeridas'));host.append(heading);
    if(!draft.treatments.length)host.append(notice('La información no permite sugerir tratamientos responsables. Revisa las preguntas pendientes.'));
    draft.treatments.forEach(function(item,index){
      var card=el('article','clinic-ai-treatment'),label=el('label','clinic-ai-choice'),check=el('input');check.type='checkbox';check.dataset.aiTreatment=String(index);check.checked=true;label.append(check,el('strong','',item.name));card.append(label);
      if(item.area)card.append(el('p','',item.area));card.append(el('p','',item.rationale));
      if(item.prerequisites.length)card.append(el('small','','Antes de avanzar: '+item.prerequisites.join('; ')));
      var basis=el('div','clinic-ai-basis');item.basis.forEach(function(id){var source=capture.input.evidence.find(v=>v.id===id);if(source)basis.append(el('span','',sourceLabel(source)));});card.append(basis);host.append(card);
    });
    if(draft.questions.length){var questions=el('section','clinic-ai-list');questions.append(el('strong','','Antes de decidir'));var questionList=el('ul');draft.questions.forEach(function(v){questionList.append(el('li','',v));});questions.append(questionList);host.append(questions);}
    var limits=[...capture.input.limitations,...draft.limitations].filter(function(v,i,a){return a.indexOf(v)===i;});
    if(limits.length){var limitations=el('details','clinic-ai-limitations');limitations.append(el('summary','','Limitaciones del borrador'));var limitList=el('ul');limits.forEach(function(v){limitList.append(el('li','',v));});limitations.append(limitList);host.append(limitations);}
    var apply=button('Incorporar selección al plan',function(){applyAIDraft(ctx);},'btn btn-primary');host.append(apply);
    document.getElementById('clinic-ai-state').textContent='Borrador listo · nada se ha guardado ni aprobado.';
  }
  function applyAIDraft(ctx) {
    var prepared=ctx.aiDraft;if(current!==ctx||!prepared||!prepared.capture.isCurrent()){clearAIDraft('La evidencia cambió. Genera un borrador nuevo.');return;}
    var host=document.getElementById('clinic-ai-results'),draft=prepared.result.draft,used=0;
    if(host.querySelector('[data-ai-assessment]')?.checked){document.getElementById('clinic-assessment').value=draft.summary;used++;}
    var existing=new Set(Array.from(document.querySelectorAll('.clinic-treatment')).map(function(row){return (row.querySelector('[data-field=name]').value+'|'+row.querySelector('[data-field=area]').value).trim().toLowerCase();}));
    host.querySelectorAll('[data-ai-treatment]:checked').forEach(function(box){
      if(document.querySelectorAll('.clinic-treatment').length>=20)return;var item=window.SmylTreatmentPlanModel.toPlanTreatment(draft.treatments[Number(box.dataset.aiTreatment)]),key=(item.name+'|'+item.area).trim().toLowerCase();if(existing.has(key))return;existing.add(key);addTreatment(item);used++;
    });
    if(!used){document.getElementById('clinic-ai-state').textContent='Selecciona al menos una sugerencia para incorporarla.';return;}
    clearAIDraft();changed();document.getElementById('clinic-feedback').replaceChildren(notice('Borrador incorporado. Revísalo y edítalo antes de guardar.'));document.getElementById('clinic-assessment').focus({preventScroll:true});
  }
  async function generateAIDraft() {
    var ctx=current;if(!ctx||ctx.saving)return;
    if(ctx.aiBusy){ctx.aiAbort?.abort();return;}
    var consent=document.getElementById('clinic-ai-consent'),state=document.getElementById('clinic-ai-state'),capture=planContext(ctx);
    if(capture.error){state.textContent=capture.error;updateAIState();return;}
    if(!consent.checked){state.textContent='Confirma el envío privado de estos datos antes de continuar.';return;}
    ctx.aiBusy=true;ctx.aiAbort=new AbortController();clearAIDraft();updateAIState();
    try{
      var result=await window.SmylTreatmentPlanClient.suggest({client:window.sb,tenant:ctx.tenant,input:capture.input,current:capture.isCurrent,endpoint:window.EDGE_URL,publicKey:window.SUPA_KEY,signal:ctx.aiAbort.signal});
      if(current===ctx&&capture.isCurrent())renderAIDraft(ctx,result,capture);
    }catch(error){if(current===ctx)state.textContent=error.name==='AbortError'?'Generación cancelada. No se aplicó ningún cambio.':error.message;}
    finally{if(current===ctx){ctx.aiBusy=false;ctx.aiAbort=null;consent.checked=false;updateAIState();}}
  }
  function renderEditor() {
    var host = document.getElementById('clinic-content'); host.replaceChildren();
    var doc = model.normalize(current.row && current.row.document);
    current.saved = JSON.stringify(doc); current.dirty = false;
    var form = el('fieldset', 'clinic-form'); form.id = 'clinic-form'; form.disabled = !current.ready || !current.canWrite;
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
    plan.append(el('h3', '', 'Plan de tratamiento'), el('p', '', 'La IA puede organizar un borrador desde la evidencia confirmada. Tú decides qué incorporar, corriges y apruebas.'));
    var ai=el('section','clinic-ai');ai.append(el('span','pro-eyebrow','COPILOTO CLÍNICO'),el('h4','','Borrador dirigido por IA'),el('p','','Usa únicamente el motivo de consulta, tus notas y observaciones ya confirmadas. No recibe nombres, fotografías ni simulaciones.'));
    var consent=el('label','clinic-ai-consent'),consentCheck=el('input');consentCheck.type='checkbox';consentCheck.id='clinic-ai-consent';consent.append(consentCheck,document.createTextNode(' Autorizo enviar estos datos clínicos confirmados para preparar este borrador.'));
    var aiState=el('p','clinic-ai-state');aiState.id='clinic-ai-state';aiState.setAttribute('role','status');
    var generate=button('Preparar borrador con IA',generateAIDraft,'btn btn-secondary');generate.id='clinic-ai-generate';
    var aiResults=el('div','clinic-ai-results');aiResults.id='clinic-ai-results';ai.append(consent,aiState,generate,aiResults);
    var list = el('div'); list.id = 'clinic-treatments';
    var add = button('+ Añadir tratamiento', function () { addTreatment(); changed(); document.querySelector('.clinic-treatment:last-child input').focus(); }); add.id = 'clinic-add';
    form.append(plan, ai, list, add);
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
    form.addEventListener('input', function(event){if(event.target.closest('.clinic-ai'))updateAIState();else changed();});
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
      item.append(el('p','',model.phases.find(function(x){return x[0]===t.phase;})[1]));
      var target=model.areaLabel(t);if(target) item.append(el('p','',target));
      if(t.notes) item.append(el('p','',t.notes));
      list.append(item);
    }); host.append(list);
  }
  async function savePlan(review) {
    if (!current || !current.ready || !current.canWrite || (review && !current.canApprove) || current.saving) return;
    var ctx = current, doc = formDocument(), activeForm = document.getElementById('clinic-form');
    if (review && (!document.getElementById('clinic-review-confirm').checked || model.reviewError(doc))) return;
    ctx.saving = true; document.getElementById('clinic-form').disabled = true; status();
    var confirmButton = document.getElementById('clinic-review-submit'); confirmButton.disabled = true;
    document.getElementById('clinic-review-dialog').close();
    document.getElementById('clinic-feedback').replaceChildren();
    try {
      var row = await checked(sb.rpc('smyl_save_clinical_plan_v2', {
        p_tenant_id: ctx.tenant, p_patient_id: ctx.patient,
        p_expected_revision: ctx.row ? ctx.row.revision : 0, p_document: doc, p_review: review
      }));
      if (Array.isArray(row)) row = row[0];
      if (!row || row.patient_id !== ctx.patient || row.tenant_id !== ctx.tenant || !row.revision) throw new Error('Unconfirmed save');
      if (current !== ctx || !activeForm.isConnected) return;
      ctx.row = row; ctx.saved = JSON.stringify(doc); ctx.dirty = false; clearAIDraft();
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
      if (current === ctx && activeForm.isConnected) { activeForm.disabled = !ctx.ready || !ctx.canWrite; status(); }
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
        var list = el('ul'); doc.treatments.forEach(function (t) { list.append(el('li', '', [t.name, model.areaLabel(t), t.notes].filter(Boolean).join(' · '))); });
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
    var ctx = { tenant: tenantId, patient: p.id, ready: false, canRead: false, canWrite: false, canApprove: false, row: null, services: [], dirty: false, saving: false, aiBusy: false, aiAbort: null, aiDraft: null }; current = ctx;
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
    content.append(notice('Cargando el expediente…'));
    try {
      var access = await clinicalCapabilities(ctx.tenant);
      if (current !== ctx || sequence !== token || tenantId !== ctx.tenant || !content.isConnected) return;
      ctx.canRead = access.canRead; ctx.canWrite = access.canWrite; ctx.canApprove = access.canApprove;
      if (!ctx.canRead) {
        state.textContent = 'Acceso limitado'; content.replaceChildren();
        feedback.append(notice('Tu rol no tiene permiso para consultar información clínica. Solicita acceso al administrador de la clínica.'));
        versions.hidden = true; return;
      }
      var loaded = await Promise.all([
        checked(sb.from('smyl_clinical_plans').select('*').eq('tenant_id', ctx.tenant).eq('patient_id', p.id).maybeSingle()),
        checked(sb.from('smyl_services').select('*').eq('tenant_id',ctx.tenant).order('name'))
      ]), data=loaded[0];ctx.services=loaded[1]||[];
      if (current !== ctx || sequence !== token || tenantId !== ctx.tenant || !content.isConnected) return;
      ctx.row = data; ctx.ready = true; renderEditor();
      if (!ctx.canWrite) feedback.append(notice('Consulta de solo lectura. Tu rol no puede modificar este plan.'));
    } catch (error) {
      if (current !== ctx || sequence !== token || !content.isConnected) return;
      state.textContent = 'No disponible'; content.replaceChildren();
      feedback.append(notice(model.errorMessage(error), true), button('Intentar de nuevo', function () { verPaciente(p.id); })); versions.hidden = true;
    }
  }
  async function loadPatients() {
    var tenant = tenantId, token = ++patientSequence;
    if (!tenant) return;
    var host = document.getElementById('tabla-pacientes-wrap');
    var loading = el('div', 'patient-loading');
    loading.setAttribute('role', 'status'); loading.setAttribute('aria-label', 'Cargando pacientes');
    loading.append(el('span'), el('span'), el('span'));
    host.replaceChildren(loading);
    var summary = document.getElementById('patient-directory-summary');
    if (summary) summary.textContent = 'Cargando pacientes…';
    patientMessage = ''; patientFailure = false;
    try {
      var all = await fetchAllPatients(tenant);
      if (token !== patientSequence || tenantId !== tenant) return;
      todosLosPacientes = all.rows;
      if (all.truncated) patientMessage = 'La clínica tiene más de 10,000 pacientes. Mostramos los más recientes.';
    } catch (error) {
      if (token !== patientSequence || tenantId !== tenant) return;
      todosLosPacientes = localPatients(); patientMessage = model.errorMessage(error); patientFailure = true;
      if (todosLosPacientes.length) patientMessage += ' Mostramos registros antiguos de este dispositivo, solo para consulta.';
    }
    renderTablaPacientes(todosLosPacientes);
    if (!patientFailure) loadAgendaInfo(tenant);
  }
  // PostgREST corta cada respuesta a 1,000 filas: se pide por páginas para no perder pacientes en silencio.
  async function fetchAllPatients(tenant) {
    var rows = [], size = 1000;
    for (var page = 0; page < 10; page += 1) {
      var chunk = await checked(sb.from('camila_pacientes').select('*').eq('tenant_id', tenant).order('created_at', { ascending: false }).order('id').range(page * size, page * size + size - 1)) || [];
      rows = rows.concat(chunk);
      if (chunk.length < size) return { rows: rows, truncated: false };
    }
    return { rows: rows, truncated: true };
  }
  // Próxima cita y última visita de cada paciente, solo lectura: si la agenda no está disponible, la lista funciona igual.
  var agendaInfo = { tenant: '', next: {}, last: {} };
  async function loadAgendaInfo(tenant) {
    try {
      var nowIso = new Date().toISOString();
      var parts = await Promise.all([
        checked(sb.from('smyl_appointments').select('patient_id,starts_at').eq('tenant_id', tenant).in('status', ['confirmed', 'arrived', 'in_progress']).gte('starts_at', nowIso).order('starts_at', { ascending: true }).limit(1000)),
        checked(sb.from('smyl_appointments').select('patient_id,starts_at').eq('tenant_id', tenant).eq('status', 'completed').order('starts_at', { ascending: false }).limit(1000))
      ]);
      if (tenant !== tenantId) return;
      var next = {}, last = {};
      (parts[0] || []).forEach(function (r) { if (r.patient_id && !next[r.patient_id]) next[r.patient_id] = r.starts_at; });
      (parts[1] || []).forEach(function (r) { if (r.patient_id && !last[r.patient_id]) last[r.patient_id] = r.starts_at; });
      agendaInfo = { tenant: tenant, next: next, last: last };
      if (typeof window.filtrarPacientes === 'function') window.filtrarPacientes();
    } catch (_) { /* sin permiso de agenda o sin conexión: la lista queda sin esa línea */ }
  }
  function shortTime(value) {
    return new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value)).replace(/\s*([ap])\.?\s?m\.?/i, function (m, x) { return ' ' + x.toLowerCase() + 'm'; });
  }
  function shortDay(value) { return new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(value)).replace(/\./g, '').replace(',', '').replace(/ de /g, ' '); }
  function agendaLine(p) {
    if (agendaInfo.tenant !== tenantId || p._local) return null;
    if (agendaInfo.next[p.id]) return { text: 'Próxima cita: ' + shortDay(agendaInfo.next[p.id]) + ' · ' + shortTime(agendaInfo.next[p.id]), tone: 'next' };
    if (agendaInfo.last[p.id]) return { text: 'Última visita: ' + shortDay(agendaInfo.last[p.id]), tone: 'last' };
    return { text: 'Sin citas todavía', tone: 'none' };
  }
  function plain(value) { return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  // Búsqueda tolerante: sin acentos, por varias palabras y por teléfono aunque se escriba con espacios o guiones.
  function filterPatients() {
    var input = document.getElementById('buscar-pac'), q = input ? input.value : '';
    var tokens = plain(q).split(/\s+/).filter(Boolean), digits = q.replace(/\D/g, '');
    var phone = /^[0-9\s()+.-]+$/.test(q.trim()) && digits.length >= 3;
    renderTablaPacientes(todosLosPacientes.filter(function (p) {
      if (!tokens.length) return true;
      if (phone) return String(p.telefono || '').replace(/\D/g, '').indexOf(digits) !== -1;
      var hay = plain([p.nombre, p.apellido, p.email, p.telefono].join(' '));
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    }));
  }
  function updatePatientSummary(list) {
    var summary = document.getElementById('patient-directory-summary');
    if (!summary) return;
    var total = todosLosPacientes.length, visible = list.length;
    if (patientFailure && !total) { summary.textContent = 'Directorio no disponible'; return; }
    if (visible !== total) {
      summary.textContent = visible + ' de ' + total + (total === 1 ? ' paciente' : ' pacientes');
      return;
    }
    var upcoming = list.filter(function (p) { return agendaInfo.tenant === tenantId && agendaInfo.next[p.id]; }).length;
    summary.textContent = total + (total === 1 ? ' paciente' : ' pacientes') + (upcoming ? ' · ' + upcoming + (upcoming === 1 ? ' con próxima cita' : ' con próxima cita') : '');
  }
  function patientEmptyState(title, copy, actionText, action) {
    var empty = el('section', 'clinic-patient-empty');
    var mark = el('div', 'clinic-patient-empty-mark');
    mark.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>';
    empty.append(mark, el('h3', '', title), el('p', '', copy));
    if (actionText && action) empty.append(button(actionText, action, 'btn btn-secondary'));
    return empty;
  }
  function renderPatients(list) {
    var host = document.getElementById('tabla-pacientes-wrap'); host.replaceChildren();
    updatePatientSummary(list);
    if (patientMessage) {
      var message = el('div', 'clinic-patient-message');
      message.append(notice(patientMessage, patientFailure), button('Volver a cargar', loadPatients, 'btn btn-secondary btn-sm'));
      host.append(message);
    }
    if (!list.length && !patientFailure) {
      if (todosLosPacientes.length) {
        host.append(patientEmptyState('Sin resultados', 'Prueba con otro nombre, teléfono o correo.', 'Limpiar búsqueda', function () {
          var input = document.getElementById('buscar-pac'); if (input) { input.value = ''; input.focus(); }
          filterPatients();
        }));
      } else {
        host.append(patientEmptyState('Aún no hay pacientes', 'Registra el nombre para abrir su expediente. Los demás datos pueden completarse después.'));
      }
    }
    if (list.length) {
      var table = el('table', 'clinic-patient-table'); table.setAttribute('aria-label', 'Directorio de pacientes');
      var thead = el('thead'), headRow = el('tr');
      ['Paciente', 'Contacto', 'Próxima atención', 'Estado', 'Acciones'].forEach(function (label) {
        var th = el('th', '', label); th.scope = 'col'; headRow.append(th);
      });
      thead.append(headRow); table.append(thead);
      var body = el('tbody');
    list.forEach(function (p) {
      var row = el('tr', 'clinic-patient-row');
      var patientCell = el('td', 'clinic-patient-identity'); patientCell.dataset.label = 'Paciente';
      var avatar = el('div', 'clinic-avatar', (p.nombre || '?').slice(0, 1).toUpperCase());
      avatar.setAttribute('aria-hidden', 'true');
      var name = el('div', 'clinic-patient-name'); name.append(el('strong', '', fullName(p) || 'Paciente sin nombre'));
      if (p._local) name.append(el('small', '', 'Solo en este dispositivo'));
      var identityInner = el('div', 'clinic-patient-identity-inner');
      identityInner.append(avatar, name); patientCell.append(identityInner);

      var contact = el('td', 'clinic-patient-contact'); contact.dataset.label = 'Contacto';
      var primaryContact = p.telefono || p.email || 'Por completar';
      contact.append(el('span', '', primaryContact));
      if (p.telefono && p.email) contact.append(el('small', '', p.email));

      var attention = el('td', 'clinic-patient-attention'); attention.dataset.label = 'Próxima atención';
      var line = agendaLine(p);
      var info = el('span', 'clinic-patient-agenda', line ? line.text : 'Agenda no disponible');
      info.dataset.tone = line ? line.tone : 'unavailable'; attention.append(info);

      var state = el('td', 'clinic-patient-state'); state.dataset.label = 'Estado';
      var complete = !!(p.telefono && p.email), status = el('span', 'clinic-patient-status', complete ? 'Datos completos' : 'Contacto pendiente');
      status.dataset.complete = String(complete); state.append(status);

      var actions = el('td', 'clinic-patient-actions'); actions.dataset.label = 'Acciones';
      var patientName = fullName(p) || 'paciente';
      if (!p._local && window.SmylSchedule && typeof window.SmylSchedule.bookFor === 'function') {
        var schedule = button('Agendar', function () { window.SmylSchedule.bookFor(p); }, 'btn btn-secondary btn-sm');
        schedule.setAttribute('aria-label', 'Agendar cita para ' + patientName); actions.append(schedule);
      }
      var open = button('Abrir expediente', function () { verPaciente(p.id); }, 'btn btn-secondary btn-sm clinic-patient-open');
      open.setAttribute('aria-label', 'Abrir expediente de ' + patientName); actions.append(open);
      row.append(patientCell, contact, attention, state, actions); body.append(row);
    });
      table.append(body); host.append(table);
    }
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
    addAlert(document.getElementById('mp-alerta-input').value); document.getElementById('mp-alerta-input').value = '';
    var phone = composePhone(document.getElementById('mp-tel-cc').value, document.getElementById('mp-tel').value);
    var data = { tenant_id: tenant, nombre: document.getElementById('mp-nombre').value.trim(), apellido: document.getElementById('mp-apellido').value.trim(), email: document.getElementById('mp-email').value.trim(), telefono: phone, fecha_nacimiento: document.getElementById('mp-fnac').value || null, genero: document.getElementById('mp-genero').value || null, notas: document.getElementById('mp-notas').value.trim() };
    if (!data.nombre) { feedback.append(notice('Escribe el nombre del paciente.', true)); return; }
    if (document.getElementById('mp-tel').value.trim() && !phoneKey(phone)) { feedback.append(notice('Revisa el teléfono: debe tener entre 8 y 15 dígitos.', true)); return; }
    var extra = {
      origen: document.getElementById('mp-origen').value || '',
      branch_id: document.getElementById('mp-sucursal').value || null,
      professional_id: document.getElementById('mp-profesional').value || null,
      alertas_medicas: readAlerts(),
      consentimiento_whatsapp: document.getElementById('mp-consent-wa').checked
    };
    if (!duplicateAck) {
      var hits = [];
      try { hits = await findDuplicates(tenant, data.email, data.telefono, editing); } catch (_) { hits = []; }
      if (hits.length) { renderDuplicates(hits); feedback.append(notice('Revisa el posible duplicado antes de guardar.', true)); return; }
    }
    patientAttempt = patientAttempt || crypto.randomUUID();
    savingPatient = true; document.querySelectorAll('#modal-paciente button,#modal-paciente input,#modal-paciente select,#modal-paciente textarea').forEach(function (b) { b.disabled = true; });
    try {
      var buildQuery = function (payload) {
        if (editing) {
          var q = sb.from('camila_pacientes').update(payload).eq('tenant_id', tenant).eq('id', editing);
          if (original.updated_at) q = q.eq('updated_at', original.updated_at);
          return q.select('*').single();
        }
        return sb.from('camila_pacientes').insert([Object.assign({ id: patientAttempt }, payload)]).select('*').single();
      };
      var saved, legacySchema = false;
      try { saved = await checked(buildQuery(Object.assign({}, data, extra))); }
      catch (error) {
        // PGRST204: la base aún no tiene las columnas de la alta v2 (migración
        // 20261020150000). Se guardan los datos básicos y se avisa.
        if (error.code !== 'PGRST204') throw error;
        legacySchema = true; saved = await checked(buildQuery(data));
      }
      if (!saved || !saved.id || saved.tenant_id !== tenant) throw new Error('Unconfirmed patient save');
      if (legacySchema) { patientMessage = 'Origen, sucursal, profesional, alertas y consentimiento se guardarán cuando se active la actualización de la base de pacientes (migración 20261020150000).'; patientFailure = false; }
      if (tenantId !== tenant) return;
      if (current) current.dirty = false;
      var index = todosLosPacientes.findIndex(function (p) { return p.id === saved.id; });
      if (index < 0) todosLosPacientes.unshift(saved); else todosLosPacientes[index] = saved;
      document.getElementById('modal-paciente').classList.remove('visible'); patientAttempt = null;
      await verPaciente(saved.id);
    } catch (error) {
      var failure;
      if (error.code === '42501') {
        // 42501 puede ser falta de permiso o de alcance de datos: la base rechaza
        // la fila si el rol no puede leerla de vuelta. Se vuelve a preguntar el
        // permiso para no culpar al permiso cuando sí existe.
        var recheck = await patientPermissionCheck(tenantId);
        failure = patientBlockMessage(recheck && recheck.ok ? 'scope' : recheck && recheck.reason ? recheck.reason : 'permission');
      }
      feedback.append(notice(error.code === '23505' || error.code === 'PGRST116' ? 'No se confirmó esta operación. Cierra el formulario y vuelve a cargar Pacientes antes de reintentar para evitar duplicados o sobrescribir cambios.'
        : failure ? failure
        : error.code === 'PGRST301' ? patientBlockMessage('session')
        : model.errorMessage(error), true));
    } finally { savingPatient = false; document.querySelectorAll('#modal-paciente button,#modal-paciente input,#modal-paciente select,#modal-paciente textarea').forEach(function (b) { b.disabled = false; }); }
  }
  async function loadPatientSelect() {
    var select = document.getElementById('f-caso-paciente'), tenant = tenantId, selected = select.value;
    select.disabled = true;
    try {
      var rows = [];
      for (var page = 0; page < 10; page += 1) {
        var chunk = await checked(sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id', tenant).order('nombre').order('id').range(page * 1000, page * 1000 + 999)) || [];
        rows = rows.concat(chunk);
        if (chunk.length < 1000) break;
      }
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
        var mounted = !!document.getElementById('clinic-form');
        var doc = ctx.ready && mounted ? formDocument() : null;
        return { ready: !!review, revision: review ? review.revision : null, dirty: ctx.dirty || ctx.saving,
          available: ctx.ready && mounted, saving: ctx.saving, saved: !!ctx.row,
          assessment: !!doc?.assessment.trim(), treatments: !!doc?.treatments.some(function (t) { return t.name.trim(); }) };
      },
      focus: function (tenant, patient, resume) {
        var ctx = current;
        if (!ctx || ctx.tenant !== tenant || ctx.patient !== patient || !ctx.canWrite) return false;
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
    window.cargarPacientes = loadPatients; window.renderTablaPacientes = renderPatients; window.filtrarPacientes = filterPatients;
    window.verPaciente = openPatient; window.guardarPaciente = savePatient;
    window.cargarPacientesSelect = loadPatientSelect;
    ['smyl:dental-context-updated','smyl:case-selection'].forEach(function(name){addEventListener(name,function(event){if(current&&event.detail?.tenant===current.tenant&&event.detail?.patient===current.patient)status();});});
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
      var clinicLine = document.getElementById('patient-clinic-line');
      if (clinicLine) clinicLine.textContent = patientClinicName() ? 'Se guardará en ' + patientClinicName() + '.' : '';
      var save = document.getElementById('patient-save-button');
      if (save) { save.disabled = false; save.textContent = id ? 'Guardar cambios' : 'Crear paciente'; }
      var patient = id ? todosLosPacientes.find(function (p) { return p.id === id; }) : null;
      var parts = splitPhone(patient ? patient.telefono : '');
      document.getElementById('mp-tel-cc').value = parts.cc; document.getElementById('mp-tel').value = parts.national;
      document.getElementById('mp-origen').value = (patient && patient.origen) || '';
      document.getElementById('mp-consent-wa').checked = !!(patient && patient.consentimiento_whatsapp);
      document.getElementById('mp-alerta-input').value = '';
      renderAlerts((patient && patient.alertas_medicas) || []);
      document.getElementById('mp-duplicados').replaceChildren(); clearTimeout(duplicateTimer); duplicateAck = false; duplicateHits = [];
      fillIntakeSelects(intakeCatalogs.tenant === tenantId ? intakeCatalogs : { tenant: tenantId, branches: [], professionals: [] }, patient);
      loadIntakeCatalogs(tenantId).then(function (catalogs) {
        if (catalogs.tenant === tenantId && document.getElementById('modal-paciente').classList.contains('visible')) fillIntakeSelects(catalogs, patient);
      });
      var tenant = tenantId;
      patientPermissionCheck(tenant).then(function (result) {
        if (!result || result.ok || tenant !== tenantId || savingPatient) return;
        if (!document.getElementById('modal-paciente').classList.contains('visible')) return;
        document.getElementById('patient-feedback').replaceChildren(notice(patientBlockMessage(result.reason), true));
        if (save) save.disabled = true;
      });
    };
    var oldClose = window.cerrarModalPaciente;
    window.cerrarModalPaciente = function () { if (!savingPatient) oldClose(); };
    var oldLogout = window.cerrarSesion;
    window.cerrarSesion = function () { if (leave()) oldLogout(); };
    addEventListener('beforeunload', function (event) { if ((current && (current.dirty || current.saving || current.aiBusy)) || savingPatient) { event.preventDefault(); event.returnValue = ''; } });
    var modal = document.getElementById('modal-paciente');
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-labelledby','modal-pac-title');
    document.getElementById('mp-nombre').required = true;
    [['mp-nombre',150],['mp-apellido',150],['mp-email',254],['mp-tel',40],['mp-notas',8000]].forEach(function (pair) { document.getElementById(pair[0]).maxLength = pair[1]; });
    modal.querySelectorAll('.fg').forEach(function (f) { var label = f.querySelector('label'), input = f.querySelector('input,textarea,select'); if (label && input && !label.htmlFor) label.htmlFor = input.id; });
    ['mp-tel', 'mp-email'].forEach(function (id) { document.getElementById(id).addEventListener('input', scheduleDuplicateCheck); });
    document.getElementById('mp-tel-cc').addEventListener('change', scheduleDuplicateCheck);
    var alertInput = document.getElementById('mp-alerta-input');
    alertInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addAlert(alertInput.value); alertInput.value = ''; }
    });
    alertInput.addEventListener('blur', function () { addAlert(alertInput.value); alertInput.value = ''; });
    var message = el('div'); message.id = 'patient-feedback'; modal.querySelector('.modal-footer').before(message);
    var clinicLine = document.getElementById('patient-clinic-line');
    if (!clinicLine) { clinicLine = el('p'); clinicLine.id = 'patient-clinic-line'; document.getElementById('modal-pac-title').after(clinicLine); }
    var saveButton = modal.querySelector('.modal-footer .btn-primary'); if (saveButton) saveButton.id = 'patient-save-button';
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
