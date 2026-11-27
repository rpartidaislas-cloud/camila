/* Tratamientos como capítulos del expediente (migración 20261126180000_smyl_treatments.sql).
 *
 * Cada visita por algo distinto abre un tratamiento nuevo; los anteriores quedan cerrados y consultables.
 * La historia clínica, el odontograma y los archivos son del paciente y se comparten; el plan es de cada tratamiento.
 * Este módulo pinta la franja de capítulos dentro de Tratamiento (smyl-case-workspace.js la monta con attach/sync).
 * Si la migración aún no está aplicada, la franja se oculta sola y el resto del expediente sigue como siempre. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylTreatments = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS = { active: 'En curso', closed: 'Terminado', abandoned: 'Abandonado', cancelled: 'Cancelado' };
  var OUTCOMES = [
    ['closed', 'Terminado', 'Se hizo lo acordado.'],
    ['abandoned', 'El paciente no regresó', 'Queda una nota de egreso con la fase en que quedó.'],
    ['cancelled', 'Se canceló', 'No se llegó a realizar.']
  ];
  var RISK = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
  var RECALL_BY_RISK = { low: 12, medium: 6, high: 3 };
  var PHASES = { evaluate: 'Evaluación', prevent: 'Prevención', stabilize: 'Estabilización', treat: 'Tratamiento', maintain: 'Mantenimiento' };

  function statusLabel(status) { return STATUS[status] || 'Tratamiento'; }
  function suggestedRecall(risk) { return RECALL_BY_RISK[risk] || null; }
  function titleFrom(text) {
    var clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (clean.length < 3) return '';
    return clean.length > 120 ? clean.slice(0, 117).trimEnd() + '…' : clean;
  }
  function closeError(outcome, note) {
    if (!STATUS[outcome] || outcome === 'active') return 'Elige cómo termina el tratamiento.';
    if (outcome === 'abandoned' && String(note || '').trim().length < 10) {
      return 'Escribe en qué fase quedó el tratamiento y lo que falta (mínimo 10 caracteres).';
    }
    if (String(note || '').length > 2000) return 'La nota es demasiado larga.';
    return '';
  }
  function monthYear(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }).replace('.', '');
  }
  function fullDate(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
  }
  function chapterMeta(t) {
    if (t.status === 'active') return 'En curso · desde ' + monthYear(t.opened_at);
    return statusLabel(t.status) + ' · ' + (monthYear(t.closed_at) || monthYear(t.opened_at));
  }
  // Resumen del plan congelado al cerrar (documento v2 de smyl_clinical_plans).
  function snapshotSummary(doc) {
    var d = doc && typeof doc === 'object' ? doc : {};
    var items = Array.isArray(d.treatments) ? d.treatments : [];
    return {
      reason: String(d.reason || ''),
      assessment: String(d.assessment || ''),
      items: items.map(function (item) {
        var teeth = Array.isArray(item && item.teeth) ? item.teeth.map(String) : [];
        return { name: String((item && item.name) || 'Tratamiento sin nombre'), teeth: teeth, phase: PHASES[item && item.phase] || '' };
      })
    };
  }
  // Hallazgos «nuevos» (de este tratamiento) y «de antes» (ya estaban cuando se abrió). Se compara contra los ids de la
  // versión del odontograma vigente al abrir el tratamiento; el primer tratamiento del paciente no tiene «de antes».
  function splitFindings(findings, baselineIds) {
    var base = baselineIds instanceof Set ? baselineIds : new Set(baselineIds || []);
    var fresh = [], before = [];
    (findings || []).forEach(function (f) { (base.has(f.id) ? before : fresh).push(f); });
    return { fresh: fresh, before: before };
  }
  function baselineIdsFrom(document) {
    var events = document && document.findings && Array.isArray(document.findings.events) ? document.findings.events : [];
    return events.map(function (e) { return e && e.id; }).filter(Boolean);
  }
  function findingText(f) {
    var model = typeof window !== 'undefined' ? window.SmylDentalModel : null;
    if (model && typeof model.findingLabel === 'function') { try { return model.findingLabel(f); } catch (_) { /* usa el texto simple */ } }
    return ['Pieza ' + f.tooth, f.surface, f.condition].filter(Boolean).join(' · ');
  }
  function listError(error) {
    var code = error && (error.code || '');
    var text = String((error && error.message) || '');
    if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(text)) return 'missing';
    return 'error';
  }

  /* ---------------------------------------------------------------- interfaz */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, onClick, cls) {
    var b = el('button', cls || 'cw-ch-btn', text);
    b.type = 'button';
    b.onclick = onClick;
    return b;
  }
  function rpc(name, args) {
    if (!window.sb || typeof window.sb.rpc !== 'function') return Promise.resolve({ data: null, error: { code: 'NO_CLIENT', message: 'Sin conexión.' } });
    return Promise.resolve(window.sb.rpc(name, args));
  }
  // Constancia de «seguí sin completar el diagnóstico» (una por revisión del plan). Si la función aún no existe, no pasa nada.
  function waiveDiagnosis(patientId, revision, note) {
    return rpc('smyl_waive_diagnosis', { p_patient_id: patientId, p_plan_revision: Number(revision) || 0, p_pending_note: String(note || '') }).then(function () {}, function () {});
  }
  function alive(ctx) { return !!(ctx && ctx.root && ctx.root.isConnected && ctx.treatments); }
  function activeOf(st) { return (st.list || []).filter(function (t) { return t.status === 'active'; })[0] || null; }
  function emptyForm() { return { title: '', text: '', outcome: 'closed', note: '', carry: {}, request: null }; }
  function carryItemIds(items, selected) {
    var allowed = new Set((items || []).map(function (item) { return String(item && item.id || ''); }).filter(Boolean));
    return Object.keys(selected || {}).filter(function (id) { return selected[id] && allowed.has(id); }).sort();
  }
  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  // Último tratamiento activo conocido por paciente (lo consulta el bloque de verificación de las notas).
  var CURRENT = {};
  function current(patientId) { return CURRENT[patientId] || null; }

  function attach(ctx) {
    var st = { list: null, loading: false, unavailable: false, error: '', viewing: null, panel: null, busy: false, details: {}, transition: null, form: emptyForm() };
    ctx.treatments = st;
    st.host = el('section', 'cw-chapters');
    st.host.setAttribute('aria-label', 'Tratamientos del paciente');
    st.host.hidden = true;
    load(ctx);
    return st.host;
  }

  async function load(ctx) {
    var st = ctx.treatments;
    if (!st || st.loading) return;
    st.loading = true;
    var result;
    try { result = await rpc('smyl_list_treatments', { p_patient_id: ctx.patient }); }
    catch (error) { result = { data: null, error: error }; }
    st.loading = false;
    if (!alive(ctx)) return;
    if (result.error) {
      st.unavailable = listError(result.error) === 'missing' || (result.error.code === '42501');
      st.error = st.unavailable ? '' : 'No se pudieron cargar los tratamientos.';
      st.list = st.list || [];
    } else {
      st.unavailable = false; st.error = '';
      st.list = Array.isArray(result.data) ? result.data : [];
      if (st.viewing && !st.list.some(function (t) { return t.id === st.viewing; })) st.viewing = null;
      CURRENT[ctx.patient] = activeOf(st);
    }
    render(ctx);
    if (ctx.treatmentFindings && window.SmylDentalProgress && typeof window.SmylDentalProgress.map === 'function') {
      ctx.treatmentFindings.key = '';
      syncFindings(ctx, window.SmylDentalProgress.map(ctx.tenant, ctx.patient, ctx.selected && ctx.selected.row && ctx.selected.row.id));
    }
  }

  // El flujo principal avisa si ya se guardó el primer plan: si no había tratamientos, se vuelve a consultar.
  function sync(ctx, info) {
    var st = ctx && ctx.treatments;
    if (!st || st.loading || st.unavailable) return;
    if (st.list && !st.list.length && info && info.planSaved) load(ctx);
  }

  function reload(ctx) {
    // Abrir o cerrar un tratamiento cambia el plan de trabajo: se reconstruye el expediente para que el editor lo recargue.
    if (typeof window.verPaciente === 'function') return window.verPaciente(ctx.patient);
    return load(ctx);
  }

  function render(ctx) {
    var st = ctx.treatments, host = st.host;
    host.hidden = !!st.unavailable;
    ctx.root.classList.toggle('cw-viewing-closed', !!st.viewing);
    host.replaceChildren();
    if (st.unavailable) return;
    var list = st.list || [], active = activeOf(st);

    var head = el('div', 'cw-ch-head');
    var title = el('div', 'cw-ch-title');
    title.append(el('span', 'cw-kicker', 'TRATAMIENTOS'), el('strong', '', list.length ? 'Un capítulo por cada motivo de visita' : 'Aún sin tratamientos'));
    head.append(title);
    var actions = el('div', 'cw-ch-actions');
    if (active && !st.viewing) actions.append(button('Cerrar tratamiento', function () { st.panel = st.panel === 'close' ? null : 'close'; render(ctx); }));
    actions.append(button('+ Nuevo tratamiento', function () {
      st.panel = st.panel === 'new' ? null : 'new'; st.error = '';
      render(ctx);
      if (st.panel === 'new' && active) loadTransitionPlan(ctx, active);
    }, 'cw-ch-btn cw-ch-primary'));
    head.append(actions);
    host.append(head);

    if (list.length) {
      var row = el('div', 'cw-ch-row');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Elegir tratamiento');
      list.forEach(function (t) {
        var selected = st.viewing ? st.viewing === t.id : t.status === 'active';
        var chip = el('button', 'cw-ch-chip');
        chip.type = 'button';
        chip.setAttribute('aria-pressed', String(selected));
        chip.dataset.status = t.status;
        chip.append(el('strong', '', t.title), el('small', '', chapterMeta(t)));
        chip.onclick = function () { st.viewing = t.status === 'active' ? null : t.id; st.panel = null; render(ctx); if (st.viewing) loadDetail(ctx, t.id); };
        row.append(chip);
      });
      host.append(row);
    }
    if (st.error) { var err = el('p', 'cw-ch-error', st.error); err.setAttribute('role', 'alert'); host.append(err); }

    if (st.panel === 'new') host.append(newPanel(ctx, active));
    else if (st.panel === 'close' && active) host.append(closePanel(ctx, active));

    if (st.viewing) host.append(closedCard(ctx));
    else if (active && !st.panel) host.append(dataRow(ctx, active));
  }

  function outcomeChoices(ctx, name) {
    var st = ctx.treatments, wrap = el('div', 'cw-ch-outcomes');
    wrap.setAttribute('role', 'radiogroup');
    OUTCOMES.forEach(function (o) {
      var label = el('label', 'cw-ch-outcome'), input = document.createElement('input');
      input.type = 'radio'; input.name = name; input.value = o[0]; input.checked = st.form.outcome === o[0];
      input.onchange = function () { st.form.outcome = o[0]; render(ctx); };
      var copy = el('span', ''); copy.append(el('strong', '', o[1]), el('small', '', o[2]));
      label.append(input, copy);
      wrap.append(label);
    });
    return wrap;
  }
  function noteField(ctx) {
    var st = ctx.treatments, box = el('label', 'cw-ch-field');
    var required = st.form.outcome === 'abandoned';
    box.append(el('span', '', required ? 'Nota de egreso (obligatoria)' : 'Nota de cierre (opcional)'));
    var area = document.createElement('textarea');
    area.maxLength = 2000; area.rows = 3; area.value = st.form.note;
    area.placeholder = required ? 'Fase en que quedó el tratamiento y lo que falta.' : 'Algo que deba saberse de este tratamiento.';
    area.oninput = function () { st.form.note = area.value; };
    box.append(area);
    return box;
  }
  function submitBar(ctx, label, onSubmit) {
    var st = ctx.treatments, bar = el('div', 'cw-ch-submit');
    bar.append(button('Cancelar', function () { st.panel = null; render(ctx); }));
    var ok = button(st.busy ? 'Guardando…' : label, onSubmit, 'cw-ch-btn cw-ch-primary');
    ok.disabled = st.busy;
    bar.append(ok);
    return bar;
  }
  function message(ctx, text) {
    var st = ctx.treatments;
    st.error = text; st.busy = false; render(ctx);
  }

  async function loadTransitionPlan(ctx, active) {
    var st = ctx.treatments, key = active && active.id;
    if (!key || st.transition && st.transition.key === key && (st.transition.loading || st.transition.ready)) return;
    st.transition = { key: key, loading: true, ready: false, error: '', revision: null, items: [] };
    render(ctx);
    if (!window.sb || typeof window.sb.from !== 'function') {
      st.transition = { key: key, loading: false, ready: false, error: 'No hay conexión para consultar el plan actual.', revision: null, items: [] };
      return render(ctx);
    }
    var result;
    try {
      result = await window.sb.from('smyl_clinical_plans').select('revision,status,document')
        .eq('tenant_id', ctx.tenant).eq('patient_id', ctx.patient).maybeSingle();
    } catch (error) { result = { data: null, error: error }; }
    if (!alive(ctx) || st.panel !== 'new' || activeOf(st) && activeOf(st).id !== key) return;
    if (result.error || !result.data) {
      st.transition = { key: key, loading: false, ready: false, error: result.error && result.error.message || 'No se pudo consultar el plan actual.', revision: null, items: [] };
      return render(ctx);
    }
    var doc = result.data.document && typeof result.data.document === 'object' ? result.data.document : {};
    var items = (Array.isArray(doc.treatments) ? doc.treatments : []).map(function (item) {
      return {
        id: String(item && item.id || ''), name: String(item && item.name || 'Procedimiento sin nombre'),
        area: String(item && item.area || ''), phase: PHASES[item && item.phase] || '',
        teeth: Array.isArray(item && item.teeth) ? item.teeth.map(String) : []
      };
    }).filter(function (item) { return !!item.id; });
    st.transition = { key: key, loading: false, ready: true, error: '', revision: Number(result.data.revision), status: result.data.status, items: items };
    render(ctx);
  }

  function transitionPlan(ctx, active) {
    var st = ctx.treatments, box = el('section', 'cw-ch-carry');
    box.setAttribute('aria-labelledby', 'cw-carry-title');
    var head = el('div', 'cw-ch-carry-head');
    var copy = el('div', ''); copy.append(el('strong', '', '2 · Decide qué procedimientos continúan'), el('small', '', 'Nada se traslada automáticamente. Marca únicamente lo que seguirá en el nuevo tratamiento.'));
    copy.querySelector('strong').id = 'cw-carry-title';
    head.append(copy); box.append(head);
    var transition = st.transition;
    if (!transition || transition.key !== active.id || transition.loading) {
      var loading = el('p', 'cw-help', 'Consultando el plan actual…'); loading.setAttribute('role', 'status'); box.append(loading); return box;
    }
    if (transition.error || !transition.ready) {
      var error = el('div', 'cw-ch-inline-error');
      error.append(el('span', '', transition.error || 'No se pudo preparar la continuidad.'), button('Reintentar', function () { st.transition = null; loadTransitionPlan(ctx, active); }));
      box.append(error); return box;
    }
    if (!transition.items.length) {
      box.append(el('p', 'cw-help', 'El plan actual no tiene procedimientos. El nuevo tratamiento comenzará vacío.'));
      return box;
    }
    var list = el('div', 'cw-ch-carry-list');
    transition.items.forEach(function (item) {
      var label = el('label', 'cw-ch-carry-item'), input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!st.form.carry[item.id]; input.value = item.id;
      input.onchange = function () { st.form.carry[item.id] = input.checked; st.form.request = null; render(ctx); };
      var itemCopy = el('span', '');
      itemCopy.append(el('strong', '', item.name));
      var detail = [item.phase, item.area, item.teeth.length ? 'Piezas ' + item.teeth.join(', ') : ''].filter(Boolean).join(' · ');
      if (detail) itemCopy.append(el('small', '', detail));
      label.append(input, itemCopy); list.append(label);
    });
    box.append(list);
    var chosen = carryItemIds(transition.items, st.form.carry).length;
    var summary = el('p', 'cw-ch-carry-summary', chosen ? chosen + (chosen === 1 ? ' procedimiento continuará en el nuevo capítulo.' : ' procedimientos continuarán en el nuevo capítulo.') : 'Ningún procedimiento seleccionado.');
    summary.setAttribute('aria-live', 'polite'); box.append(summary);
    return box;
  }

  function newPanel(ctx, active) {
    var st = ctx.treatments, panel = el('div', 'cw-ch-panel');
    panel.append(el('h3', '', active ? 'Cerrar y abrir un nuevo tratamiento' : 'Abrir el primer tratamiento'));
    panel.append(el('p', 'cw-help', 'La historia clínica, el odontograma y los archivos del paciente se conservan. El capítulo anterior queda congelado y consultable.'));
    if (active) {
      panel.append(el('strong', 'cw-ch-step-title', '1 · Cierra «' + active.title + '»'));
      panel.append(outcomeChoices(ctx, 'cw-new-outcome'));
      panel.append(noteField(ctx));
      panel.append(transitionPlan(ctx, active));
    }
    panel.append(el('strong', 'cw-ch-step-title', active ? '3 · Identifica el nuevo tratamiento' : 'Motivo del tratamiento'));
    var name = el('label', 'cw-ch-field');
    name.append(el('span', '', 'Nombre breve'));
    var input = document.createElement('input'); input.type = 'text'; input.maxLength = 120; input.value = st.form.title;
    input.placeholder = 'Ej. Rehabilitación posterior'; input.oninput = function () { st.form.title = input.value; st.form.request = null; };
    name.append(input); panel.append(name);
    var why = el('label', 'cw-ch-field');
    why.append(el('span', '', 'Motivo y objetivo'));
    var area = document.createElement('textarea');
    area.maxLength = 2000; area.rows = 2; area.value = st.form.text; area.placeholder = 'Ej. Recuperar función y controlar molestias en el sector posterior.';
    area.oninput = function () { st.form.text = area.value; st.form.request = null; };
    why.append(area);
    panel.append(why);
    panel.append(submitBar(ctx, active ? 'Cerrar y abrir tratamiento' : 'Abrir tratamiento', function () { submitNew(ctx, active); }));
    return panel;
  }
  async function submitNew(ctx, active) {
    var st = ctx.treatments, title = titleFrom(st.form.title || st.form.text), reason = st.form.text.trim();
    if (!title) return message(ctx, 'Escribe un nombre o motivo para el nuevo tratamiento (mínimo 3 caracteres).');
    if (active) { var bad = closeError(st.form.outcome, st.form.note); if (bad) return message(ctx, bad); }
    var workflow = window.SmylClinicalWorkflow && window.SmylClinicalWorkflow.status && window.SmylClinicalWorkflow.status(ctx.tenant, ctx.patient);
    if (active && workflow && workflow.dirty) return message(ctx, 'Guarda o descarta los cambios del plan antes de cambiar de tratamiento.');
    st.busy = true; st.error = ''; render(ctx);
    if (active) {
      var plan = st.transition;
      if (!plan || plan.key !== active.id || !plan.ready || !Number.isInteger(plan.revision)) return message(ctx, 'Espera a que cargue el plan actual antes de continuar.');
      var core = {
        current: active.id, treatmentRevision: Number(active.revision || 1), planRevision: plan.revision,
        outcome: st.form.outcome, note: st.form.note.trim() || null, title: title, reason: reason,
        carry: carryItemIds(plan.items, st.form.carry)
      };
      var signature = JSON.stringify(core);
      if (!st.form.request || st.form.request.signature !== signature) st.form.request = { signature: signature, newId: uuid(), idempotencyKey: uuid() };
      var changed = await rpc('smyl_transition_treatment_v1', {
        p_current_id: core.current, p_expected_treatment_revision: core.treatmentRevision,
        p_expected_plan_revision: core.planRevision, p_outcome: core.outcome, p_note: core.note,
        p_new_id: st.form.request.newId, p_new_title: core.title, p_new_reason: core.reason,
        p_carry_item_ids: core.carry, p_idempotency_key: st.form.request.idempotencyKey
      });
      if (!alive(ctx)) return;
      if (changed.error) return message(ctx, changed.error.message || 'No se pudo cambiar de tratamiento. El capítulo actual sigue abierto.');
      st.form = emptyForm(); st.transition = null;
      window.dispatchEvent(new CustomEvent('smyl:treatment-changed', { detail: { patientId: ctx.patient, treatmentId: changed.data && changed.data.new_treatment_id || null, carried: core.carry.length } }));
      return reload(ctx);
    }
    var opened = await rpc('smyl_open_treatment', { p_patient_id: ctx.patient, p_title: title, p_reason: reason });
    if (!alive(ctx)) return;
    if (opened.error) return message(ctx, opened.error.message || 'No se pudo abrir el tratamiento.');
    st.form = emptyForm();
    window.dispatchEvent(new CustomEvent('smyl:treatment-changed', { detail: { patientId: ctx.patient, treatmentId: opened.data || null, carried: 0 } }));
    reload(ctx);
  }

  function closePanel(ctx, active) {
    var st = ctx.treatments, panel = el('div', 'cw-ch-panel');
    panel.append(el('h3', '', 'Cerrar «' + active.title + '»'));
    panel.append(el('p', 'cw-help', 'El plan queda guardado tal como está y el tratamiento ya no se puede modificar. Podrás consultarlo cuando quieras.'));
    panel.append(outcomeChoices(ctx, 'cw-close-outcome'));
    panel.append(noteField(ctx));
    panel.append(submitBar(ctx, 'Cerrar tratamiento', async function () {
      var bad = closeError(st.form.outcome, st.form.note);
      if (bad) return message(ctx, bad);
      st.busy = true; st.error = ''; render(ctx);
      var result = await rpc('smyl_close_treatment', { p_id: active.id, p_outcome: st.form.outcome, p_note: st.form.note.trim() || null });
      if (!alive(ctx)) return;
      if (result.error) return message(ctx, result.error.message || 'No se pudo cerrar el tratamiento.');
      st.form = emptyForm();
      reload(ctx);
    }));
    return panel;
  }

  // Riesgo médico, riesgo de caries y próxima revisión: tres toques, sin formulario.
  function dataRow(ctx, active) {
    var st = ctx.treatments, row = el('div', 'cw-ch-data');
    function group(label, key, options, current, onPick) {
      var g = el('div', 'cw-ch-group'); g.append(el('span', 'cw-ch-group-label', label));
      var pick = el('div', 'cw-ch-pick'); pick.setAttribute('role', 'group'); pick.setAttribute('aria-label', label);
      options.forEach(function (o) {
        var b = el('button', 'cw-ch-pill', o[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(current === o[0]));
        b.onclick = function () { onPick(o[0]); };
        pick.append(b);
      });
      g.append(pick);
      return g;
    }
    function save(patch, local) {
      var previous = {}; Object.keys(local).forEach(function (k) { previous[k] = active[k]; });
      Object.keys(local).forEach(function (k) { active[k] = local[k]; });
      render(ctx);
      rpc('smyl_update_treatment', patch).then(function (result) {
        if (!alive(ctx) || !result.error) return;
        Object.keys(previous).forEach(function (k) { active[k] = previous[k]; });
        st.error = result.error.message || 'No se pudo guardar.';
        render(ctx);
      });
    }
    row.append(group('Riesgo médico (ASA)', 'asa', [['I', 'I'], ['II', 'II'], ['III', 'III'], ['IV', 'IV']], active.asa,
      function (v) { save({ p_id: active.id, p_asa: v }, { asa: v }); }));
    row.append(group('Riesgo de caries', 'caries_risk', [['low', 'Bajo'], ['medium', 'Medio'], ['high', 'Alto']], active.caries_risk,
      function (v) {
        var months = suggestedRecall(v);
        save({ p_id: active.id, p_caries_risk: v, p_recall_months: months }, { caries_risk: v, recall_months: months });
      }));
    row.append(group('Próxima revisión', 'recall_months', [[3, '3 meses'], [6, '6 meses'], [12, '12 meses']], active.recall_months,
      function (v) { save({ p_id: active.id, p_recall_months: v }, { recall_months: v }); }));
    var hint = active.caries_risk ? 'Sugerido por riesgo de caries ' + RISK[active.caries_risk].toLowerCase() + '.' : 'Se sugiere según el riesgo de caries.';
    row.append(el('p', 'cw-help', hint));
    return row;
  }

  async function loadDetail(ctx, id) {
    var st = ctx.treatments;
    if (st.details[id]) return;
    var result = await rpc('smyl_get_treatment', { p_id: id });
    if (!alive(ctx)) return;
    if (result.error) { st.details[id] = { error: result.error.message || 'No se pudo cargar el tratamiento.' }; }
    else st.details[id] = { row: result.data };
    render(ctx);
  }

  function closedCard(ctx) {
    var st = ctx.treatments, t = (st.list || []).filter(function (x) { return x.id === st.viewing; })[0];
    var card = el('article', 'cw-ch-card');
    if (!t) return card;
    var head = el('header', 'cw-ch-card-head'), copy = el('div', '');
    copy.append(el('h3', '', t.title), el('p', 'cw-help', statusLabel(t.status) + ' · abrió el ' + fullDate(t.opened_at) + (t.closed_at ? ' · cerró el ' + fullDate(t.closed_at) : '')));
    head.append(copy, button('Volver al tratamiento actual', function () { st.viewing = null; render(ctx); }));
    card.append(head);
    var facts = el('dl', 'cw-ch-facts');
    function fact(label, value) { if (!value) return; var d = el('div', ''); d.append(el('dt', '', label), el('dd', '', value)); facts.append(d); }
    fact('Motivo de la visita', t.reason);
    fact('Riesgo médico (ASA)', t.asa);
    fact('Riesgo de caries', t.caries_risk ? RISK[t.caries_risk] : '');
    fact('Próxima revisión', t.recall_months ? 'En ' + t.recall_months + ' meses' : '');
    fact(t.status === 'abandoned' ? 'Nota de egreso' : 'Nota de cierre', t.closure_note);
    card.append(facts);
    var detail = st.details[t.id];
    if (!detail) card.append(el('p', 'cw-help', 'Cargando el plan…'));
    else if (detail.error) { var err = el('p', 'cw-ch-error', detail.error); err.setAttribute('role', 'alert'); card.append(err); }
    else {
      var sum = snapshotSummary(detail.row && detail.row.plan_snapshot);
      if (sum.assessment) { card.append(el('h4', '', 'Valoración')); card.append(el('p', '', sum.assessment)); }
      card.append(el('h4', '', 'Plan de tratamiento'));
      if (!sum.items.length) card.append(el('p', 'cw-help', 'Este tratamiento no tuvo procedimientos registrados en el plan.'));
      else {
        var ul = el('ul', 'cw-ch-plan');
        sum.items.forEach(function (i) {
          var li = el('li', ''); li.append(el('strong', '', i.name), el('small', '', [i.teeth.length ? 'Pieza' + (i.teeth.length > 1 ? 's' : '') + ' ' + i.teeth.join(', ') : '', i.phase].filter(Boolean).join(' · ')));
          ul.append(li);
        });
        card.append(ul);
      }
    }
    card.append(el('p', 'cw-help', 'Solo lectura: un tratamiento cerrado no se modifica. Las notas y cotizaciones de esas fechas siguen en sus pestañas.'));
    return card;
  }

  function attachFindings(ctx) {
    var host = el('section', 'cw-ch-findings');
    host.setAttribute('aria-label', 'Hallazgos de este tratamiento');
    host.hidden = true;
    ctx.treatmentFindings = { host: host, key: '', busy: false, baselines: {} };
    return host;
  }

  async function baselineFor(ctx, treatment) {
    var cache = ctx.treatmentFindings.baselines;
    if (treatment.seq <= 1) return new Set();
    if (cache[treatment.id]) return cache[treatment.id];
    if (!window.sb || typeof window.sb.from !== 'function') return null;
    var result;
    try {
      result = await window.sb.from('smyl_dental_versions').select('revision,document')
        .eq('tenant_id', ctx.tenant).eq('patient_id', ctx.patient).lte('updated_at', treatment.opened_at)
        .order('revision', { ascending: false }).limit(1);
    } catch (_) { return null; }
    if (!result || result.error) return null;
    var row = Array.isArray(result.data) ? result.data[0] : result.data;
    var ids = new Set(row ? baselineIdsFrom(row.document) : []);
    cache[treatment.id] = ids;
    return ids;
  }

  // Se llama con cada refresco del expediente: solo recalcula si cambió el tratamiento activo o el odontograma.
  async function syncFindings(ctx, map) {
    var st = ctx && ctx.treatments, box = ctx && ctx.treatmentFindings;
    if (!box || !st || st.unavailable || !st.list) { if (box) box.host.hidden = true; return; }
    var active = activeOf(st);
    if (!active || !map || !map.teeth || !window.SmylDentalProgress || typeof window.SmylDentalProgress.findingsForTooth !== 'function') { box.host.hidden = true; return; }
    var teeth = Object.keys(map.teeth).filter(function (t) { return map.teeth[t] && map.teeth[t].findings > 0; });
    var key = [active.id, map.revision, teeth.map(function (t) { return t + ':' + map.teeth[t].findings; }).join(',')].join('|');
    if (box.key === key || box.busy) return;
    box.busy = true;
    var findings = [];
    teeth.forEach(function (tooth) {
      var snap = window.SmylDentalProgress.findingsForTooth(ctx.tenant, ctx.patient, tooth);
      (snap && snap.findings || []).forEach(function (f) { if (!f.superseded && f.state !== 'resolved') findings.push(f); });
    });
    var baseline = await baselineFor(ctx, active);
    box.busy = false;
    if (!alive(ctx)) return;
    if (!baseline) { box.host.hidden = true; return; }
    box.key = key;
    renderFindings(ctx, active, splitFindings(findings, baseline));
  }

  function renderFindings(ctx, active, groups) {
    var host = ctx.treatmentFindings.host;
    host.hidden = false;
    host.replaceChildren();
    var head = el('div', 'cw-ch-find-head'), title = el('div', '');
    title.append(el('span', 'cw-kicker', 'DE ESTE TRATAMIENTO'), el('strong', '', 'Hallazgos de «' + active.title + '»'));
    var chips = el('div', 'cw-ch-find-chips');
    var fresh = el('span', 'cw-ch-find-chip', groups.fresh.length + (groups.fresh.length === 1 ? ' nuevo' : ' nuevos')); fresh.dataset.kind = 'new';
    chips.append(fresh);
    if (groups.before.length) { var old = el('span', 'cw-ch-find-chip', groups.before.length + ' de antes'); old.dataset.kind = 'old'; chips.append(old); }
    head.append(title, chips);
    host.append(head);
    if (!groups.fresh.length && !groups.before.length) {
      host.append(el('p', 'cw-help', 'Todavía no hay hallazgos. Toca una pieza del odontograma para registrar el primero.'));
      return;
    }
    function list(items, cls) {
      var ul = el('ul', 'cw-ch-find-list ' + cls);
      items.forEach(function (f) {
        var li = el('li', '');
        li.append(el('span', 'cw-ch-find-tooth', f.tooth), el('span', 'cw-ch-find-label', f.condition + (f.surface ? ' · ' + f.surface : '')));
        if (f.draft) li.append(el('span', 'cw-ch-find-draft', 'Sin guardar'));
        ul.append(li);
      });
      return ul;
    }
    if (groups.fresh.length) host.append(list(groups.fresh, 'is-new'));
    else host.append(el('p', 'cw-help', 'Aún no hay hallazgos nuevos en este tratamiento.'));
    if (groups.before.length) {
      var d = el('details', 'cw-ch-find-old'), sum = el('summary', '', 'De antes (' + groups.before.length + ') · quedan en el odontograma, no se borran');
      d.append(sum, list(groups.before, 'is-old'));
      host.append(d);
    }
  }

  return {
    splitFindings: splitFindings, baselineIdsFrom: baselineIdsFrom, findingText: findingText,
    attachFindings: attachFindings, syncFindings: syncFindings, current: current,
    statusLabel: statusLabel, suggestedRecall: suggestedRecall, titleFrom: titleFrom, closeError: closeError,
    chapterMeta: chapterMeta, snapshotSummary: snapshotSummary, listError: listError, carryItemIds: carryItemIds, OUTCOMES: OUTCOMES,
    attach: attach, sync: sync, waiveDiagnosis: waiveDiagnosis
  };
});
