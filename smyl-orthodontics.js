/* Seguimiento ortodóntico longitudinal.
 *
 * Se monta dentro de Tratamiento > En tratamiento. No crea otra biblioteca de
 * imágenes ni una agenda paralela: usa notas clínicas, el Centro de evidencia
 * y la serie fotográfica guiada que ya existen en el expediente. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylOrthodontics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATES = typeof WeakMap === 'function' ? new WeakMap() : new Map();
  var VIEW_LABELS = { today: 'Hoy', controls: 'Controles', evidence: 'Evidencia', plan: 'Plan base' };
  var CONTROL_TYPES = {
    adjustment: 'Control y ajuste', aligner_delivery: 'Entrega de alineadores', aligner_change: 'Cambio de alineador',
    bonding: 'Colocación de aparatología', refinement: 'Refinamiento', emergency: 'Atención no programada',
    deband: 'Retiro de aparatología', retention: 'Retención', baseline: 'Registro inicial'
  };
  var PHASES = { records: 'Registros', planning: 'Planeación', active: 'Tratamiento activo', finishing: 'Acabado', retention: 'Retención', closed: 'Cerrado' };
  var APPLIANCES = { aligner: 'Alineadores', fixed: 'Brackets', mixed: 'Mixto', removable: 'Aparato removible', retention: 'Retenedor', other: 'Otro' };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(text, action, cls) {
    var node = el('button', cls || 'ortho-btn', text);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  }
  function clean(value, max) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return max && text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  }
  function list(value) {
    if (Array.isArray(value)) return value.map(function (item) { return clean(item, 300); }).filter(Boolean).slice(0, 24);
    return String(value || '').split(/\r?\n|;/).map(function (item) { return clean(item, 300); }).filter(Boolean).slice(0, 24);
  }
  function number(value) {
    if (value == null || String(value).trim() === '') return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  function date(value, withTime) {
    var parsed = new Date(value);
    if (isNaN(parsed.getTime())) return 'Sin fecha';
    var options = { day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime) { options.hour = 'numeric'; options.minute = '2-digit'; }
    return parsed.toLocaleDateString('es-MX', options).replace(/\./g, '');
  }
  function statusText(row) { return row && row.status === 'signed' ? 'Firmado' : 'Borrador'; }
  function orthoOf(row) { return row && (row.orthodontics || row.ortho || (row.document && row.document.orthodontics) || ((row.controlType || row.phase || row.appliance) && row)) || {}; }
  function valueOf(value, fallback) { return clean(value) || fallback; }
  function planItems(clinical) {
    var value = clinical && clinical.orthodontics && clinical.orthodontics.items;
    return Array.isArray(value) ? value.slice(0, 20) : [];
  }
  function eligible(clinical) { return !!(clinical && clinical.orthodontics && clinical.orthodontics.eligible); }
  function metric(label, value, detail) {
    var item = el('div', 'ortho-metric');
    item.append(el('dt', '', label), el('dd', '', valueOf(value, '—')), el('small', '', valueOf(detail, 'Sin registrar')));
    return item;
  }
  function field(label, control, wide, hint) {
    var wrap = el('label', 'ortho-field' + (wide ? ' is-wide' : ''));
    control.setAttribute('aria-label', label);
    wrap.append(el('span', '', label), control);
    if (hint) wrap.append(el('small', '', hint));
    return wrap;
  }
  function input(name, value, placeholder, type) {
    var node = el('input', '');
    node.name = name; node.type = type || 'text'; node.value = value || ''; node.placeholder = placeholder || '';
    if (node.type === 'text') node.maxLength = 240;
    return node;
  }
  function textarea(name, value, placeholder) {
    var node = el('textarea', '');
    node.name = name; node.value = value || ''; node.placeholder = placeholder || ''; node.rows = 3; node.maxLength = 4000;
    return node;
  }
  function select(name, options, selected) {
    var node = el('select', ''); node.name = name;
    options.forEach(function (pair) { var option = el('option', '', pair[1]); option.value = pair[0]; option.selected = pair[0] === selected; node.append(option); });
    return node;
  }
  function icon(name) {
    var span = el('span', 'ortho-icon'); span.setAttribute('aria-hidden', 'true'); span.dataset.icon = name; return span;
  }

  function noteLine(orthodontics) {
    var data = orthodontics && typeof orthodontics === 'object' ? orthodontics : {};
    var parts = [];
    if (data.phase) parts.push(PHASES[data.phase] || clean(data.phase, 60));
    var appliance = data.appliance && typeof data.appliance === 'object' ? data.appliance : {};
    if (appliance.type === 'aligner' && number(appliance.currentAligner) != null) {
      parts.push('Alineador ' + number(appliance.currentAligner) + (number(appliance.totalAligners) ? ' de ' + number(appliance.totalAligners) : ''));
    } else if (appliance.type) parts.push(APPLIANCES[appliance.type] || clean(appliance.type, 60));
    var changes = list(data.changes);
    if (changes.length) parts.push(changes[0]);
    return parts.length ? parts.join(' · ') : 'Control ortodóntico';
  }

  function activeTreatment(st) {
    return st.info && st.info.treatment && st.info.treatment.status === 'active' ? st.info.treatment : null;
  }
  function canCreate(st) { var row = caseForTreatment(st); return context(st).canWrite === true && eligible(st.info && st.info.clinical) && !!activeTreatment(st) && !st.canonicalError && (!row || row.phase !== 'closed'); }
  function controls(st) { return Array.isArray(st.info && st.info.controls) ? st.info.controls : []; }
  function context(st) { return st.info && st.info.controlContext || {}; }
  function evidence(st) { return st.info && st.info.evidence || { counts: {}, items: [] }; }
  function newest(st) { return controls(st).slice().sort(function (a, b) { return Date.parse(b.signedAt || b.signed_at || b.createdAt || b.created_at || 0) - Date.parse(a.signedAt || a.signed_at || a.createdAt || a.created_at || 0); })[0] || null; }
  function currentAppliance(st) {
    var data = orthoOf(newest(st)), appliance = data.appliance || {};
    if (appliance.type === 'aligner') {
      var current = number(appliance.currentAligner), total = number(appliance.totalAligners);
      return current != null ? ('Alineador ' + current + (total ? ' de ' + total : '')) : 'Alineadores';
    }
    if (appliance.upperWire || appliance.lowerWire) return [appliance.upperWire && 'Sup. ' + clean(appliance.upperWire, 40), appliance.lowerWire && 'Inf. ' + clean(appliance.lowerWire, 40)].filter(Boolean).join(' · ');
    return APPLIANCES[appliance.type] || '';
  }

  function rpcValue(result) {
    if (result && result.error) throw result.error;
    var value = result && result.data;
    if (Array.isArray(value)) return value[0] || null;
    return value || null;
  }
  async function rpc(name, args) {
    if (!window.sb || typeof window.sb.rpc !== 'function') throw new Error('No hay conexión con el expediente.');
    return rpcValue(await window.sb.rpc(name, args));
  }
  async function rpcRows(name, args) {
    if (!window.sb || typeof window.sb.rpc !== 'function') throw new Error('No hay conexión con el expediente.');
    var result = await window.sb.rpc(name, args);
    if (result && result.error) throw result.error;
    return Array.isArray(result && result.data) ? result.data : [];
  }
  function caseTreatmentId(row) { return clean(row && (row.treatment_chapter_id || row.treatmentChapterId)); }
  function caseForTreatment(st) {
    var treatment = activeTreatment(st), row = st.canonicalCase;
    return treatment && row && caseTreatmentId(row) === clean(treatment.id) ? row : null;
  }
  function canonicalPhase(st) {
    var row = caseForTreatment(st), phase = clean(row && row.phase);
    return PHASES[phase] ? phase : 'records';
  }
  function caseDocument(st, appliance) {
    var items = planItems(st.info && st.info.clinical);
    return {
      schema: 1,
      problemList: items.map(function (item) { return clean(item && item.name, 160); }).filter(Boolean),
      objectives: [],
      baseline: {
        dentition: '', overjetMm: null, overbitePercent: null, crowdingUpperMm: null, crowdingLowerMm: null,
        midlineUpperMm: null, midlineLowerMm: null, molarRight: '', molarLeft: '', canineRight: '', canineLeft: '', notes: ''
      },
      mechanics: {
        applianceType: clean(appliance && appliance.type), arches: clean(appliance && appliance.arches),
        extractions: [], ipr: [], anchorage: [], auxiliaries: [], estimatedMonths: null
      },
      retention: { upper: '', lower: '', duration: '', instructions: [] },
      limitations: []
    };
  }
  async function loadCanonicalCase(st, force) {
    var treatment = activeTreatment(st);
    if (!treatment || !st.ctx || !st.ctx.patient) return null;
    var key = clean(st.ctx.patient) + ':' + clean(treatment.id);
    if (!force && st.canonicalKey === key && st.canonicalLoaded) return caseForTreatment(st);
    if (st.canonicalLoading) return st.canonicalLoading;
    st.canonicalKey = key;
    st.canonicalError = '';
    st.canonicalLoading = rpc('smyl_get_orthodontic_case', { p_patient_id: st.ctx.patient }).then(function (row) {
      st.canonicalCase = row && caseTreatmentId(row) === clean(treatment.id) ? row : null;
      st.canonicalLoaded = true;
      st.canonicalError = '';
      if (st.root && st.root.isConnected) render(st);
      return st.canonicalCase;
    }).catch(function (error) {
      st.canonicalLoaded = false;
      st.canonicalError = clean(error && error.message, 240) || 'No se pudo consultar el caso ortodóntico.';
      if (st.root && st.root.isConnected) render(st);
      return null;
    }).finally(function () { st.canonicalLoading = null; });
    return st.canonicalLoading;
  }
  async function ensureCanonicalCase(st, appliance) {
    var treatment = activeTreatment(st), row = caseForTreatment(st) || await loadCanonicalCase(st, false);
    if (row) return row;
    if (!treatment) throw new Error('No hay un tratamiento activo para este control.');
    row = await rpc('smyl_create_orthodontic_case', {
      p_treatment_chapter_id: treatment.id,
      p_document: caseDocument(st, appliance)
    });
    if (!row || !clean(row.id) || caseTreatmentId(row) !== clean(treatment.id)) throw new Error('No se pudo confirmar el caso ortodóntico.');
    st.canonicalCase = row; st.canonicalLoaded = true; st.canonicalKey = clean(st.ctx.patient) + ':' + clean(treatment.id); st.canonicalError = '';
    return row;
  }

  function attach(ctx) {
    var root = el('section', 'ortho-root');
    root.hidden = true; root.setAttribute('aria-label', 'Seguimiento de ortodoncia');
    var st = { ctx: ctx, root: root, view: 'today', info: {}, feedback: '', feedbackTone: '', saving: false, canonicalCase: null, canonicalKey: '', canonicalLoaded: false, canonicalLoading: null, canonicalError: '' };
    STATES.set(ctx, st); render(st); return root;
  }
  function sync(ctx, info) {
    var st = STATES.get(ctx); if (!st) return false;
    st.info = info || {};
    var show = eligible(st.info.clinical) || controls(st).length > 0;
    st.root.hidden = !show;
    if (!show) ctx.orthodonticsPrimary = null;
    if (show) { render(st); loadCanonicalCase(st, false); }
    return show;
  }

  function render(st) {
    var root = st.root; root.replaceChildren(); st.ctx.orthodonticsPrimary = null;
    var head = el('header', 'ortho-head'), copy = el('div', 'ortho-head-copy');
    copy.append(el('span', 'ortho-kicker', 'ORTODONCIA LONGITUDINAL'), el('h3', '', 'Seguimiento del tratamiento'), el('p', '', 'Plan, controles y evidencia clínica en una sola secuencia.'));
    var state = el('span', 'ortho-state', controls(st).length ? controls(st).length + (controls(st).length === 1 ? ' control' : ' controles') : 'Preparado para iniciar');
    var headActions = el('div', 'ortho-head-actions'), register = button('Registrar control', function () { openWizard(st); }, 'ortho-btn ortho-primary');
    register.disabled = st.saving || !canCreate(st);
    if (!canCreate(st)) register.title = controls(st).length ? 'Historial disponible en modo de consulta. Activa y revisa un plan ortodóntico para registrar otro control.' : 'Se requiere un plan ortodóntico revisado y un tratamiento activo.';
    headActions.append(state, register); st.ctx.orthodonticsPrimary = canCreate(st) ? register : null;
    head.append(copy, headActions); root.append(head);

    var tabs = el('nav', 'ortho-tabs'); tabs.setAttribute('aria-label', 'Secciones del seguimiento ortodóntico');
    Object.keys(VIEW_LABELS).forEach(function (key) {
      var tab = button(VIEW_LABELS[key], function () { st.view = key; render(st); }, 'ortho-tab');
      tab.dataset.view = key; tab.setAttribute('aria-current', st.view === key ? 'page' : 'false'); tabs.append(tab);
    });
    root.append(tabs);
    var feedback = el('p', 'ortho-feedback', st.feedback); feedback.hidden = !st.feedback; feedback.dataset.tone = st.feedbackTone || 'info'; feedback.setAttribute('role', 'status'); root.append(feedback);
    if (st.canonicalError) {
      var loadError = el('aside', 'ortho-canonical-error'), errorCopy = el('div');
      errorCopy.append(el('strong', '', 'No pudimos cargar el seguimiento clínico'), el('p', '', st.canonicalError + ' Reintenta antes de registrar un control.'));
      loadError.append(errorCopy, button('Reintentar', function () { st.canonicalError = ''; render(st); loadCanonicalCase(st, true); }, 'ortho-btn'));
      loadError.setAttribute('role', 'alert'); root.append(loadError);
    }
    var panel = el('div', 'ortho-panel'); panel.dataset.view = st.view;
    if (st.view === 'controls') renderControls(st, panel);
    else if (st.view === 'evidence') renderEvidence(st, panel);
    else if (st.view === 'plan') renderPlan(st, panel);
    else renderToday(st, panel);
    root.append(panel);
  }

  function renderToday(st, panel) {
    var latest = newest(st), ortho = orthoOf(latest), appliance = ortho.appliance || {}, treatment = activeTreatment(st);
    var hero = el('section', 'ortho-today'), heroCopy = el('div', 'ortho-today-copy');
    heroCopy.append(el('span', 'ortho-kicker', latest ? 'CONTROL ACTUAL' : 'SIGUIENTE PASO'), el('h4', '', latest ? noteLine(ortho) : 'Registra el primer control'), el('p', '', latest ? (statusText(latest) + ' · ' + date(latest.signedAt || latest.signed_at || latest.createdAt || latest.created_at)) : 'Documenta el estado clínico, los ajustes y las indicaciones sin crear una cita automática.'));
    var controlsButton = button(latest ? 'Ver controles' : 'Cómo se registra', function () { st.view = 'controls'; render(st); }, 'ortho-btn');
    hero.append(heroCopy, controlsButton); panel.append(hero);
    var metrics = el('dl', 'ortho-metrics');
    metrics.append(
      metric('Modalidad', APPLIANCES[appliance.type] || planItems(st.info.clinical)[0] && planItems(st.info.clinical)[0].name, treatment ? 'Tratamiento en curso' : 'Plan revisado'),
      metric('Fase', PHASES[ortho.phase], ortho.controlType ? (CONTROL_TYPES[ortho.controlType] || ortho.controlType) : 'Sin control previo'),
      metric('Aparatología actual', currentAppliance(st), appliance.type === 'aligner' ? 'Avance objetivo por número de alineador' : 'Último registro firmado o en borrador'),
      metric('Último control', latest ? date(latest.signedAt || latest.signed_at || latest.createdAt || latest.created_at) : 'Sin controles', latest ? statusText(latest) : 'Pendiente')
    ); panel.append(metrics);
    var next = el('section', 'ortho-next'); next.append(icon('next'));
    var nextCopy = el('div');
    var nextControl = ortho.nextControl || {}, weeks = number(nextControl.recommendedWeeks), objectives = list(nextControl.objectives);
    nextCopy.append(el('span', 'ortho-kicker', 'PRÓXIMO CONTROL RECOMENDADO'), el('strong', '', weeks ? 'En ' + weeks + (weeks === 1 ? ' semana' : ' semanas') : 'A definir por el profesional'), el('p', '', objectives[0] || 'El intervalo es una recomendación clínica; no crea una cita en Agenda.'));
    next.append(nextCopy); panel.append(next);
    var recent = el('section', 'ortho-compact-list'), recentHead = el('div', 'ortho-section-head');
    recentHead.append(el('div', '', ''), button('Ver controles', function () { st.view = 'controls'; render(st); }, 'ortho-link'));
    recentHead.firstChild.append(el('span', 'ortho-kicker', 'HISTORIAL'), el('h4', '', latest ? 'Últimos controles' : 'Aún sin controles'));
    recent.append(recentHead);
    controls(st).slice(0, 3).forEach(function (row) { recent.append(controlRow(row)); });
    if (!controls(st).length) recent.append(el('p', 'ortho-empty', 'El primer borrador aparecerá aquí y deberá firmarse desde Consulta para quedar inmutable.'));
    panel.append(recent);
  }

  function controlRow(row) {
    var data = orthoOf(row), item = el('article', 'ortho-control-row'), marker = el('span', 'ortho-control-marker'); marker.dataset.status = row.status || 'draft';
    var copy = el('div', 'ortho-control-copy');
    copy.append(el('strong', '', CONTROL_TYPES[data.controlType] || 'Control ortodóntico'), el('p', '', noteLine(data)), el('small', '', date(row.signedAt || row.signed_at || row.createdAt || row.created_at, true)));
    var badge = el('span', 'ortho-badge', statusText(row)); badge.dataset.status = row.status || 'draft';
    item.append(marker, copy, badge); return item;
  }

  function renderControls(st, panel) {
    var head = el('section', 'ortho-section-head'), copy = el('div');
    copy.append(el('span', 'ortho-kicker', 'REGISTRO LONGITUDINAL'), el('h4', '', 'Controles clínicos'), el('p', '', 'Los borradores se distinguen de las notas firmadas e inmutables.'));
    head.append(copy); panel.append(head);
    var rows = controls(st).slice().sort(function (a, b) { return Date.parse(b.signedAt || b.signed_at || b.createdAt || b.created_at || 0) - Date.parse(a.signedAt || a.signed_at || a.createdAt || a.created_at || 0); });
    var listHost = el('section', 'ortho-control-list'); rows.forEach(function (row) { listHost.append(controlRow(row)); });
    if (!rows.length) listHost.append(el('p', 'ortho-empty', 'Todavía no hay controles ortodónticos. Registra el primero como borrador clínico.'));
    panel.append(listHost);
    var note = el('aside', 'ortho-safety'); note.append(icon('lock'), el('p', '', 'Guardar crea un borrador. Para que el control quede firmado e inmutable, revísalo y fírmalo en Consulta.'));
    var openNotes = button('Abrir Consulta', function () { window.SmylPatient360 && window.SmylPatient360.open && window.SmylPatient360.open('notes'); }, 'ortho-link'); note.append(openNotes); panel.append(note);
  }

  function countEvidence(data, names) {
    var counts = data && data.counts || {};
    return names.reduce(function (sum, key) { return sum + (Number(counts[key]) || 0); }, 0);
  }
  function renderEvidence(st, panel) {
    var data = evidence(st), photos = countEvidence(data, ['clinical_photo', 'photo']), radiographs = countEvidence(data, ['radiograph', 'xray']), documents = countEvidence(data, ['document', 'clinical_document', 'laboratory', 'consent', 'referral', 'prescription', 'other']);
    var head = el('section', 'ortho-section-head'), copy = el('div');
    copy.append(el('span', 'ortho-kicker', 'REGISTROS DEL EXPEDIENTE'), el('h4', '', 'Evidencia disponible en el expediente'), el('p', '', 'Usa los originales existentes. En esta versión se consultan aquí, pero todavía no quedan vinculados a un control específico.')); head.append(copy); panel.append(head);
    var grid = el('div', 'ortho-evidence-grid');
    [['photo', 'Fotografías clínicas', photos, 'Series iniciales y de progreso'], ['radiograph', 'Radiografías', radiographs, 'Panorámicas, cefalometrías y tomas'], ['document', 'Documentos', documents, 'Informes y archivos clínicos']].forEach(function (row) {
      var card = el('article', 'ortho-evidence-card'); card.append(icon(row[0]), el('span', 'ortho-kicker', row[1]), el('strong', '', String(row[2])), el('p', '', row[3])); grid.append(card);
    });
    panel.append(grid);
    var actions = el('div', 'ortho-evidence-actions');
    actions.append(button('Capturar serie intraoral', function () { window.SmylCaseWorkspace && window.SmylCaseWorkspace.openChairside && window.SmylCaseWorkspace.openChairside('guided-photos', st.ctx.tenant, st.ctx.patient); }, 'ortho-btn ortho-primary'));
    actions.append(button('Abrir Imágenes y estudios', function () { window.SmylPatient360 && window.SmylPatient360.open && window.SmylPatient360.open('files'); }, 'ortho-btn'));
    panel.append(actions);
    var compare = el('aside', 'ortho-compare'); compare.append(icon('compare'));
    var compareCopy = el('div'); compareCopy.append(el('strong', '', 'Compara siempre la misma vista'), el('p', '', 'Frontal con frontal, lateral con lateral y oclusal con oclusal. La simulación estética es una referencia y no sustituye esta evidencia.')); compare.append(compareCopy); panel.append(compare);
  }

  function renderPlan(st, panel) {
    var clinical = st.info.clinical || {}, items = planItems(clinical), treatment = activeTreatment(st);
    var head = el('section', 'ortho-section-head'), copy = el('div');
    copy.append(el('span', 'ortho-kicker', 'PLAN REVISADO'), el('h4', '', treatment && treatment.title ? clean(treatment.title, 120) : 'Plan base de ortodoncia'), el('p', '', 'Esta vista resume lo que ya fue revisado en el plan clínico; no crea un plan paralelo.'));
    var edit = button('Abrir plan de tratamiento', function () { window.SmylCaseWorkspace && window.SmylCaseWorkspace.open && window.SmylCaseWorkspace.open('plan'); }, 'ortho-btn'); head.append(copy, edit); panel.append(head);
    var listHost = el('div', 'ortho-plan-list');
    items.forEach(function (item, index) {
      var row = el('article', 'ortho-plan-row');
      row.append(el('span', 'ortho-plan-index', String(index + 1)), el('div', '', ''));
      row.lastChild.append(el('strong', '', clean(item.name, 160) || 'Procedimiento ortodóntico'), el('p', '', [item.phase && ('Fase: ' + clean(item.phase, 60)), Array.isArray(item.teeth) && item.teeth.length && ('Piezas: ' + item.teeth.slice(0, 12).join(', '))].filter(Boolean).join(' · ') || 'Incluido en el plan revisado'));
      listHost.append(row);
    });
    if (!items.length) listHost.append(el('p', 'ortho-empty', 'El tratamiento fue identificado como ortodóntico, pero el resumen del plan todavía no está disponible.'));
    panel.append(listHost);
    var canonical = caseForTreatment(st), phase = canonicalPhase(st);
    if (canonical && (phase === 'records' || phase === 'planning')) {
      var activation = el('aside', 'ortho-safety'); activation.append(icon('shield'));
      var activationCopy = el('div'); activationCopy.append(el('strong', '', 'Activa el seguimiento antes de los ajustes'), el('p', '', 'Vincula un consentimiento informado vigente. Mientras tanto sólo se permiten el registro inicial y las urgencias.'));
      var activate = button('Vincular consentimiento y activar', function () { openActivation(st); }, 'ortho-btn ortho-primary');
      activate.disabled = context(st).canApprove !== true;
      if (activate.disabled) activate.title = 'Se requiere autorización clínica para activar el caso.';
      activation.append(activationCopy, activate); panel.append(activation);
    }
    var limitations = el('aside', 'ortho-safety'); limitations.append(icon('shield'), el('p', '', 'Los objetivos, la mecánica, la retención y las limitaciones deben confirmarse en el plan clínico. Los controles sólo documentan su ejecución.')); panel.append(limitations);
  }

  async function openActivation(st) {
    var row = caseForTreatment(st);
    if (!row || context(st).canApprove !== true) return;
    var dlg = el('dialog', 'ortho-dialog'), form = el('form', 'ortho-wizard'); form.method = 'dialog';
    var header = el('header', 'ortho-dialog-head'), title = el('div'); title.append(el('span', 'ortho-kicker', 'ACTIVAR CASO'), el('h2', '', 'Vincular consentimiento informado'), el('p', '', 'Selecciona el documento que corresponde a este tratamiento. SMYL no lo elegirá por coincidencias de texto.'));
    var close = button('Cerrar', function () { dlg.close(); }, 'ortho-close'); close.setAttribute('aria-label', 'Cerrar activación'); header.append(title, close); form.append(header);
    var body = el('div', 'ortho-wizard-body'), status = el('p', 'ortho-empty', 'Consultando consentimientos vigentes…'); body.append(status); form.append(body);
    var feedback = el('p', 'ortho-dialog-feedback'); feedback.setAttribute('role', 'alert'); form.append(feedback);
    var actions = el('footer', 'ortho-dialog-actions'), cancel = button('Cancelar', function () { dlg.close(); }, 'ortho-btn'), confirm = button('Vincular y activar', null, 'ortho-btn ortho-primary'); confirm.type = 'submit'; confirm.disabled = true; actions.append(cancel, confirm); form.append(actions);
    dlg.append(form); document.body.append(dlg); dlg.addEventListener('close', function () { dlg.remove(); }); dlg.showModal();
    try {
      var rows = (await rpcRows('smyl_list_informed_consents', { p_patient_id: st.ctx.patient })).filter(function (item) { return item && !item.revoked_at; });
      status.remove();
      if (!rows.length) {
        body.append(el('p', 'ortho-empty', 'No hay un consentimiento vigente. Regístralo en Consulta y vuelve a esta sección.'));
        var openConsents = button('Abrir historia clínica', function () { dlg.close(); window.SmylPatient360 && window.SmylPatient360.open && window.SmylPatient360.open('history'); }, 'ortho-btn'); body.append(openConsents); return;
      }
      var options = [['', 'Selecciona un consentimiento']].concat(rows.map(function (item) { return [item.id, clean(item.procedure_title, 160) + ' · ' + date(item.signed_at)]; }));
      body.append(field('Consentimiento firmado', select('consentId', options, ''), true, 'El documento permanecerá inmutable en el expediente.'));
      confirm.disabled = false;
    } catch (error) {
      status.textContent = clean(error && error.message, 240) || 'No se pudieron consultar los consentimientos.';
    }
    form.addEventListener('submit', async function (event) {
      event.preventDefault(); var consentId = clean(form.elements.consentId && form.elements.consentId.value);
      if (!consentId) { feedback.textContent = 'Selecciona el consentimiento correspondiente.'; return; }
      confirm.disabled = true; confirm.textContent = 'Activando…'; feedback.textContent = '';
      try {
        var active = await rpc('smyl_activate_orthodontic_case', { p_id: row.id, p_expected_revision: row.revision, p_consent_id: consentId });
        st.canonicalCase = active; st.canonicalLoaded = true; st.feedback = 'Caso ortodóntico activado. Ya puedes registrar ajustes y controles de seguimiento.'; st.feedbackTone = 'success'; dlg.close(); render(st);
      } catch (error) {
        feedback.textContent = clean(error && error.message, 240) || 'No se pudo activar el caso.'; confirm.disabled = false; confirm.textContent = 'Vincular y activar';
      }
    });
  }

  function openWizard(st) {
    if (!canCreate(st) || st.saving) return;
    var dlg = el('dialog', 'ortho-dialog'), form = el('form', 'ortho-wizard'); form.method = 'dialog';
    var header = el('header', 'ortho-dialog-head'), title = el('div'); title.append(el('span', 'ortho-kicker', 'NUEVO CONTROL'), el('h2', '', 'Registrar control ortodóntico'), el('p', '', 'Se guardará como borrador clínico para revisión y firma.'));
    var close = button('Cerrar', function () { dlg.close(); }, 'ortho-close'); close.setAttribute('aria-label', 'Cerrar control'); header.append(title, close); form.append(header);
    var steps = el('ol', 'ortho-wizard-steps');
    ['Contexto', 'Revisión', 'Trabajo e indicaciones', 'Comprobar'].forEach(function (label, index) { var item = el('li', '', ''); item.dataset.step = String(index + 1); item.append(el('span', '', String(index + 1)), el('strong', '', label)); steps.append(item); }); form.append(steps);
    var body = el('div', 'ortho-wizard-body'), sections = [];
    sections.push(wizardContext(st)); sections.push(wizardReview()); sections.push(wizardWork()); sections.push(wizardConfirm());
    sections.forEach(function (section, index) { section.dataset.wizardPanel = String(index + 1); body.append(section); }); form.append(body);
    var feedback = el('p', 'ortho-dialog-feedback'); feedback.setAttribute('role', 'alert'); form.append(feedback);
    var actions = el('footer', 'ortho-dialog-actions'), back = button('Anterior', null, 'ortho-btn'), next = button('Siguiente', null, 'ortho-btn ortho-primary'), save = button('Guardar borrador', null, 'ortho-btn ortho-primary');
    save.type = 'submit'; actions.append(back, next, save); form.append(actions); dlg.append(form); document.body.append(dlg);
    var step = 1;
    function show() {
      sections.forEach(function (section, index) { section.hidden = index + 1 !== step; });
      Array.from(steps.children).forEach(function (item, index) { item.dataset.state = index + 1 === step ? 'current' : index + 1 < step ? 'done' : 'next'; });
      back.hidden = step === 1; next.hidden = step === sections.length; save.hidden = step !== sections.length;
      syncApplianceFields(form);
      if (step === sections.length) updateReview(form);
      body.scrollTop = 0;
      var first = sections[step - 1].querySelector('input,select,textarea'); if (first) requestAnimationFrame(function () { first.focus({ preventScroll: true }); });
    }
    back.addEventListener('click', function () { step = Math.max(1, step - 1); show(); });
    next.addEventListener('click', function () { if (!validateStep(form, step, feedback)) return; step = Math.min(sections.length, step + 1); show(); });
    form.addEventListener('change', function (event) { if (event.target.name === 'applianceType') syncApplianceFields(form); if (event.target.name !== 'reviewed') form.elements.reviewed.checked = false; });
    form.addEventListener('input', function (event) { if (event.target.name !== 'reviewed') form.elements.reviewed.checked = false; });
    form.addEventListener('submit', function (event) { event.preventDefault(); if (validateStep(form, 4, feedback)) saveControl(st, form, dlg, save, feedback); });
    dlg.addEventListener('close', function () { dlg.remove(); }); show(); dlg.showModal();
  }

  function wizardSection(kicker, title, copy) {
    var section = el('section', 'ortho-wizard-panel'), head = el('header', 'ortho-wizard-title');
    head.append(el('span', 'ortho-kicker', kicker), el('h3', '', title), el('p', '', copy)); section.append(head); return section;
  }
  function wizardContext(st) {
    var section = wizardSection('PASO 1', 'Contexto del control', 'Identifica el tipo de control y la fase. Una recomendación de semanas no crea una cita.');
    var grid = el('div', 'ortho-form-grid'), ctx = context(st), phase = canonicalPhase(st), initialOnly = phase === 'records' || phase === 'planning', professionals = [['', 'Sin asignar']].concat((ctx.professionals || []).map(function (row) { return [row.id, clean(row.name || row.displayName || row.display_name, 100) || 'Profesional']; }));
    var appointments = [['', 'Sin vincular a una cita']].concat((ctx.appointments || []).slice(0, 24).map(function (row) { return [row.id, date(row.startsAt || row.starts_at, true)]; }));
    var types = Object.keys(CONTROL_TYPES).filter(function (key) { return !initialOnly || key === 'baseline' || key === 'emergency'; }).map(function (key) { return [key, CONTROL_TYPES[key]]; });
    grid.append(field('Tipo de control', select('controlType', types, initialOnly ? 'baseline' : 'adjustment')));
    var phaseDisplay = select('phaseDisplay', Object.keys(PHASES).map(function (key) { return [key, PHASES[key]]; }), phase); phaseDisplay.disabled = true;
    grid.append(field('Fase del caso', phaseDisplay, false, initialOnly ? 'Vincula el consentimiento desde Plan base para activar el seguimiento.' : 'La fase se controla desde el caso clínico.'));
    var phaseValue = input('phase', phase, '', 'hidden'); section.append(phaseValue);
    grid.append(field('Profesional', select('professionalId', professionals, '')));
    grid.append(field('Cita relacionada (opcional)', select('appointmentId', appointments, '')));
    section.append(grid); return section;
  }
  function wizardReview() {
    var section = wizardSection('PASO 2', 'Revisión clínica', 'Registra lo observado hoy. No se convierte automáticamente en diagnóstico.');
    var grid = el('div', 'ortho-form-grid');
    grid.append(field('Aparatología', select('applianceType', Object.keys(APPLIANCES).map(function (key) { return [key, APPLIANCES[key]]; }), 'aligner')));
    grid.append(field('Arcadas', select('arches', [['both', 'Ambas arcadas'], ['upper', 'Superior'], ['lower', 'Inferior']], 'both')));
    var currentAligner = input('currentAligner', '', 'Ej. 12', 'number'); currentAligner.min = '0'; currentAligner.max = '500'; currentAligner.step = '1';
    var totalAligners = input('totalAligners', '', 'Ej. 24', 'number'); totalAligners.min = '0'; totalAligners.max = '500'; totalAligners.step = '1';
    var currentField = field('Alineador actual', currentAligner); currentField.dataset.appliance = 'aligner mixed';
    var totalField = field('Total de alineadores', totalAligners); totalField.dataset.appliance = 'aligner mixed';
    var upperField = field('Arco superior', input('upperWire', '', 'Ej. NiTi 0.016')); upperField.dataset.appliance = 'fixed mixed';
    var lowerField = field('Arco inferior', input('lowerWire', '', 'Ej. NiTi 0.016')); lowerField.dataset.appliance = 'fixed mixed';
    grid.append(currentField, totalField, upperField, lowerField);
    grid.append(field('Elásticos o auxiliares', input('elastics', '', 'Configuración e indicación actual'), true));
    grid.append(field('Higiene', select('hygiene', [['', 'Sin valorar'], ['good', 'Adecuada'], ['fair', 'Por mejorar'], ['poor', 'Deficiente']], '')));
    grid.append(field('Cooperación', select('cooperation', [['', 'Sin valorar'], ['good', 'Adecuada'], ['variable', 'Variable'], ['poor', 'Insuficiente']], '')));
    grid.append(field('Molestia referida', select('discomfort', [['', 'Sin registrar'], ['none', 'Ninguna'], ['mild', 'Leve'], ['moderate', 'Moderada'], ['severe', 'Intensa']], '')));
    grid.append(field('Lo referido por el paciente', textarea('subjective', '', 'Cambios percibidos, molestias y uso de auxiliares.'), true));
    grid.append(field('Hallazgos observados', textarea('objective', '', 'Ajuste, tejidos, aparatología, oclusión y hallazgos verificables.'), true));
    section.append(grid); return section;
  }
  function wizardWork() {
    var section = wizardSection('PASO 3', 'Trabajo e indicaciones', 'Separa lo realizado, la conclusión profesional y las instrucciones al paciente.');
    var grid = el('div', 'ortho-form-grid');
    grid.append(field('Cambios realizados', textarea('changes', '', 'Un cambio por línea.'), true));
    grid.append(field('Incidentes o pendientes', textarea('incidents', '', 'Un elemento por línea. Déjalo vacío si no aplica.'), true));
    grid.append(field('Conclusión clínica', textarea('assessment', '', 'Interpretación profesional del control.'), true));
    grid.append(field('Indicaciones al paciente', textarea('instructions', '', 'Una indicación por línea.'), true));
    var recommendedWeeks = input('recommendedWeeks', '', 'Semanas', 'number'); recommendedWeeks.min = '0'; recommendedWeeks.max = '104'; recommendedWeeks.step = '1';
    grid.append(field('Próximo control recomendado', recommendedWeeks, false, 'Es una recomendación; no crea una cita.'));
    grid.append(field('Objetivos del próximo control', textarea('nextObjectives', '', 'Un objetivo por línea.'), true));
    section.append(grid); return section;
  }
  function wizardConfirm() {
    var section = wizardSection('PASO 4', 'Comprobar antes de guardar', 'El control quedará como borrador. Después debe revisarse y firmarse en Consulta.');
    section.append(el('div', 'ortho-review')); var check = el('label', 'ortho-confirm');
    var inputNode = input('reviewed', '1', '', 'checkbox'); inputNode.required = true; check.append(inputNode, el('span', '', 'Confirmo que revisé estos datos y que corresponden al control actual.')); section.append(check); return section;
  }
  function syncApplianceFields(form) {
    var type = form.elements.applianceType && form.elements.applianceType.value || '';
    form.querySelectorAll('[data-appliance]').forEach(function (wrap) {
      var visible = String(wrap.dataset.appliance || '').split(' ').indexOf(type) >= 0;
      wrap.hidden = !visible;
      wrap.querySelectorAll('input,select,textarea').forEach(function (control) { control.disabled = !visible; });
    });
  }
  function selectedLabel(form, name, fallback) {
    var control = form.elements[name], option = control && control.options && control.options[control.selectedIndex];
    return option && clean(option.textContent, 160) || fallback;
  }
  function updateReview(form) {
    var host = form.querySelector('.ortho-review'), data = new FormData(form), appliance = clean(data.get('applianceType'));
    var applianceDetail = appliance === 'aligner' || appliance === 'mixed'
      ? [number(data.get('currentAligner')) != null && ('Alineador ' + number(data.get('currentAligner'))), number(data.get('totalAligners')) != null && ('de ' + number(data.get('totalAligners')))].filter(Boolean).join(' ')
      : [clean(data.get('upperWire')) && ('Superior: ' + clean(data.get('upperWire'), 80)), clean(data.get('lowerWire')) && ('Inferior: ' + clean(data.get('lowerWire'), 80))].filter(Boolean).join(' · ');
    var weeks = number(data.get('recommendedWeeks'));
    var rows = [
      ['Control', CONTROL_TYPES[data.get('controlType')] || 'Control ortodóntico'], ['Fase', PHASES[data.get('phase')] || 'Sin definir'],
      ['Profesional', selectedLabel(form, 'professionalId', 'Sin asignar')], ['Cita relacionada', selectedLabel(form, 'appointmentId', 'Sin vincular')],
      ['Aparatología', [APPLIANCES[appliance] || 'Sin definir', applianceDetail].filter(Boolean).join(' · ')], ['Arcadas', selectedLabel(form, 'arches', 'Sin definir')],
      ['Elásticos o auxiliares', clean(data.get('elastics'), 240) || 'Sin registrar'], ['Higiene · cooperación · molestia', [selectedLabel(form, 'hygiene', 'Sin valorar'), selectedLabel(form, 'cooperation', 'Sin valorar'), selectedLabel(form, 'discomfort', 'Sin registrar')].join(' · ')],
      ['Lo referido por el paciente', clean(data.get('subjective'), 240) || 'Sin registrar'], ['Hallazgos observados', clean(data.get('objective'), 240) || 'Sin registrar'],
      ['Cambios realizados', list(data.get('changes')).join(' · ') || 'Sin cambios registrados'], ['Incidentes o pendientes', list(data.get('incidents')).join(' · ') || 'Sin incidentes registrados'],
      ['Conclusión clínica', clean(data.get('assessment'), 240) || 'Pendiente de completar'], ['Indicaciones al paciente', list(data.get('instructions')).join(' · ') || 'Sin indicaciones registradas'],
      ['Próximo control', weeks != null ? (weeks + (weeks === 1 ? ' semana' : ' semanas')) : 'Sin intervalo recomendado'], ['Objetivos siguientes', list(data.get('nextObjectives')).join(' · ') || 'Sin objetivos registrados']
    ];
    host.replaceChildren(); rows.forEach(function (row) { var item = el('div'); item.append(el('span', '', row[0]), el('strong', '', row[1])); host.append(item); });
  }
  function validateStep(form, step, feedback) {
    feedback.textContent = '';
    if (step === 2) {
      var current = form.elements.currentAligner.disabled ? null : number(form.elements.currentAligner.value), total = form.elements.totalAligners.disabled ? null : number(form.elements.totalAligners.value);
      if ((current != null && current > 500) || (total != null && total > 500)) { feedback.textContent = 'Revisa el número de alineadores; el máximo permitido es 500.'; (current > 500 ? form.elements.currentAligner : form.elements.totalAligners).focus(); return false; }
      if (current != null && total != null && current > total) { feedback.textContent = 'El alineador actual no puede ser mayor que el total.'; form.elements.currentAligner.focus(); return false; }
    }
    if (step === 3 && !clean(form.elements.assessment.value) && !list(form.elements.changes.value).length) {
      feedback.textContent = 'Agrega la conclusión clínica o al menos un cambio realizado.'; form.elements.assessment.focus(); return false;
    }
    if (step === 4) {
      var weeks = number(form.elements.recommendedWeeks.value);
      if (weeks != null && weeks > 104) { feedback.textContent = 'Revisa el próximo control recomendado; el máximo permitido es 104 semanas.'; form.elements.recommendedWeeks.focus(); return false; }
      if (!form.elements.reviewed.checked) { feedback.textContent = 'Confirma que revisaste los datos antes de guardar.'; form.elements.reviewed.focus(); return false; }
    }
    return true;
  }

  async function saveControl(st, form, dlg, save, feedback) {
    if (st.saving) return;
    if (!canCreate(st)) { feedback.textContent = 'El plan ortodóntico ya no está vigente o el tratamiento no está activo. Actualiza el expediente antes de guardar.'; return; }
    st.saving = true; save.disabled = true; save.textContent = 'Guardando…'; feedback.textContent = '';
    var data = new FormData(form), treatment = activeTreatment(st), appliance = {
      type: clean(data.get('applianceType')), arches: clean(data.get('arches')), currentAligner: number(data.get('currentAligner')), totalAligners: number(data.get('totalAligners')),
      upperWire: clean(data.get('upperWire')), lowerWire: clean(data.get('lowerWire')), elastics: clean(data.get('elastics'))
    };
    var ortho = {
      schema: 1, treatmentId: treatment && treatment.id || null, controlType: clean(data.get('controlType')), phase: clean(data.get('phase')),
      appliance: appliance, changes: list(data.get('changes')), measurements: {}, cooperation: clean(data.get('cooperation')),
      hygiene: clean(data.get('hygiene')), discomfort: clean(data.get('discomfort')), incidents: list(data.get('incidents')), evidenceStudyIds: [],
      nextControl: { recommendedWeeks: number(data.get('recommendedWeeks')), objectives: list(data.get('nextObjectives')) }, patientInstructions: list(data.get('instructions'))
    };
    var doc = {
      subjective: clean(data.get('subjective'), 12000), objective: clean(data.get('objective'), 12000), assessment: clean(data.get('assessment'), 12000),
      diagnosis: '', diagnosis_code: '', prognosis: '', plan: list(data.get('instructions')).concat(list(data.get('nextObjectives'))).join('\n'), orthodontics: ortho
    };
    var id = form.dataset.noteId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'ortho-' + Date.now() + '-' + Math.random().toString(16).slice(2)); form.dataset.noteId = id;
    try {
      var caseRow = await ensureCanonicalCase(st, appliance);
      ortho.orthodonticCaseId = caseRow.id;
      var result = await rpc('smyl_create_orthodontic_control', {
        p_orthodontic_case_id: caseRow.id,
        p_clinical_note_id: id,
        p_appointment_id: clean(data.get('appointmentId')) || null,
        p_professional_id: clean(data.get('professionalId')) || null,
        p_control_type: ortho.controlType,
        p_occurred_at: new Date().toISOString(),
        p_document: doc
      });
      var savedId = clean(result && (result.clinical_note_id || result.clinicalNoteId || result.note_id || result.noteId || result.control && result.control.clinical_note_id || result.note && result.note.id));
      if (!savedId || savedId !== id) throw new Error('No se pudo confirmar el guardado. Reintenta: se conservará el mismo identificador para evitar duplicados.');
      st.saving = false; dlg.close(); st.feedback = 'Control guardado como borrador. Revísalo y fírmalo en Consulta para dejarlo inmutable.'; st.feedbackTone = 'success'; render(st);
      window.dispatchEvent(new CustomEvent('smyl:clinical-note-created', { detail: { tenant: st.ctx.tenant, patient: st.ctx.patient, noteId: id, source: 'orthodontics' } }));
    } catch (error) {
      feedback.textContent = clean(error && error.message, 240) || 'No se pudo guardar el control. Revisa la conexión e inténtalo de nuevo.';
    } finally { st.saving = false; if (save.isConnected) { save.disabled = false; save.textContent = 'Guardar borrador'; } }
  }

  return Object.freeze({ attach: attach, sync: sync, noteLine: noteLine, CONTROL_TYPES: Object.freeze(CONTROL_TYPES), PHASES: Object.freeze(PHASES) });
});
