/* SMYL · Receta médica: preparación, revisión, emisión e impresión.
 *
 * La emisión la valida y registra smyl_issue_prescription. Esta interfaz no cambia
 * una receta emitida: reutilizar una anterior crea un borrador nuevo y editable.
 * IMPORTANTE: los requisitos legales NO se han contrastado con el texto oficial
 * (docs/RECETA_REQUISITOS.md). Validar con asesoría sanitaria antes del uso real.
 */
(function () {
  'use strict';
  var M = window.SmylPrescriptionModel, P = window.SmylPrescriptionPrint;
  if (!M || !P) { console.error('[SMYL] receta: faltan smyl-prescription-model.js o smyl-prescription-print.js'); return; }

  var ctx = null;

  function n(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = n('button', cls || 'btn btn-secondary', text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function when(v) { try { return new Date(v).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }
  function blankItem() { return { generic: '', brand: '', strength: '', form: '', dose: '', route: 'oral', frequency: '', duration_days: '', quantity: '' }; }
  function clean(v) { return String(v == null ? '' : v).trim(); }
  function current(local) { return !!ctx && ctx === local && ctx.dialog && ctx.dialog.isConnected; }

  function say(text, tone) {
    var host = ctx && ctx.status; if (!host) return; host.replaceChildren(); if (!text) return;
    var p = n('p', 'rx-note rx-' + (tone || 'info'), text); p.setAttribute('role', tone === 'error' ? 'alert' : 'status'); host.append(p);
  }

  async function rpc(name, args) {
    var res = await window.sb.rpc(name, args);
    if (res.error) throw new Error(res.error.message || 'No se pudo completar la acción.');
    return res.data;
  }

  function printRow(row) {
    var old = document.getElementById('rx-print-root'); if (old) old.remove();
    var root = n('div', 'rx-print-root'); root.id = 'rx-print-root'; root.append(P.render(M.toSheet(row)));
    document.body.append(root); document.body.classList.add('rx-printing');
    var done = function () { document.body.classList.remove('rx-printing'); root.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 80);
  }

  function field(label, key, item, attrs, list, cls) {
    var wrap = n('label', 'rx-field' + (cls ? ' ' + cls : '')); wrap.append(n('span', '', label));
    var input = n('input'); input.value = item[key] == null ? '' : item[key]; input.dataset.key = key;
    Object.keys(attrs || {}).forEach(function (k) { input.setAttribute(k, attrs[k]); });
    if (list) input.setAttribute('list', list);
    input.addEventListener('input', function () { item[key] = input.value; say(''); refreshChecks(); renderDraftSummary(); });
    wrap.append(input); return wrap;
  }

  function itemTitle(item, index) { var name = clean(item.generic); return name || 'Medicamento ' + (index + 1); }

  function medicationLine(item) {
    var name = [clean(item.generic), clean(item.strength), clean(item.form)].filter(Boolean).join(' · ');
    var use = [clean(item.dose), clean(item.route) ? 'vía ' + clean(item.route) : '', clean(item.frequency), clean(item.duration_days) ? clean(item.duration_days) + (Number(item.duration_days) === 1 ? ' día' : ' días') : ''].filter(Boolean).join(', ');
    return { name: name || 'Medicamento por completar', use: use, quantity: clean(item.quantity) };
  }

  function renderItems() {
    var host = ctx.itemsHost; host.replaceChildren();
    ctx.items.forEach(function (item, i) {
      var box = n('fieldset', 'rx-item'); box.dataset.itemIndex = String(i);
      var legend = n('legend', 'rx-item-head'), number = n('span', 'rx-item-number', String(i + 1)), copy = n('span', 'rx-item-heading');
      copy.append(n('strong', '', itemTitle(item, i)), n('small', '', 'Prescripción e instrucciones de uso'));
      legend.append(number, copy);
      if (ctx.items.length > 1) { var remove = btn('Quitar', 'rx-link rx-danger', function () { ctx.items.splice(i, 1); renderItems(); refreshChecks(); renderDraftSummary(); }); remove.setAttribute('aria-label', 'Quitar medicamento ' + (i + 1)); legend.append(remove); }
      box.append(legend);
      var identity = n('div', 'rx-grid rx-grid-identity');
      identity.append(
        field('Nombre genérico *', 'generic', item, { maxlength: '120', autocomplete: 'off', placeholder: 'Ej. Amoxicilina' }, 'rx-suggest', 'rx-span-2'),
        field('Concentración', 'strength', item, { maxlength: '60', placeholder: 'Ej. 500 mg' }),
        field('Presentación *', 'form', item, { maxlength: '60', placeholder: 'Ej. cápsulas' }, 'rx-forms'),
        field('Marca (opcional)', 'brand', item, { maxlength: '120', placeholder: 'Nombre comercial' })
      );
      var instruction = n('div', 'rx-grid rx-grid-instruction');
      instruction.append(
        field('Dosis *', 'dose', item, { maxlength: '120', placeholder: 'Ej. 1 cápsula' }),
        field('Vía *', 'route', item, { maxlength: '60' }, 'rx-routes'),
        field('Frecuencia *', 'frequency', item, { maxlength: '80', placeholder: 'Ej. cada 8 horas' }),
        field('Duración *', 'duration_days', item, { type: 'number', min: '1', max: '365', inputmode: 'numeric', placeholder: 'Días' }),
        field('Cantidad a surtir *', 'quantity', item, { maxlength: '60', placeholder: 'Ej. 21 cápsulas' })
      );
      var tag = n('p', 'rx-item-tag'); tag.dataset.item = String(i); tag.hidden = true;
      box.append(identity, n('p', 'rx-grid-label', 'Cómo debe usarlo el paciente'), instruction, tag); host.append(box);
    });
    ctx.add.disabled = ctx.items.length >= M.MAX_ITEMS;
  }

  function renderDraftSummary() {
    if (!ctx || !ctx.summary) return;
    var count = ctx.items.filter(function (item) { return clean(item.generic); }).length;
    ctx.summary.replaceChildren();
    var head = n('div', 'rx-summary-head'); head.append(n('span', 'rx-eyebrow', 'BORRADOR ACTUAL'), n('strong', '', count + (count === 1 ? ' medicamento' : ' medicamentos'))); ctx.summary.append(head);
    var list = n('ol', 'rx-summary-list');
    ctx.items.forEach(function (item) { var line = medicationLine(item), li = n('li'); li.append(n('strong', '', line.name)); if (line.use) li.append(n('small', '', line.use)); if (line.quantity) li.append(n('small', '', 'Surtir: ' + line.quantity)); list.append(li); });
    ctx.summary.append(list);
    if (clean(ctx.diagnosis.value)) ctx.summary.append(n('p', 'rx-summary-context', 'Diagnóstico: ' + clean(ctx.diagnosis.value)));
    if (clean(ctx.indications.value)) ctx.summary.append(n('p', 'rx-summary-context', 'Indicaciones adicionales capturadas.'));
  }

  function refreshChecks() {
    if (!ctx) return;
    ctx.itemsHost.querySelectorAll('.rx-item-tag').forEach(function (tag) {
      var item = ctx.items[Number(tag.dataset.item)] || {}, c = M.classify(item.generic, item.brand), text = '', tone = '';
      if (c.controlled.length) { text = 'Posible medicamento controlado: SMYL no lo puede emitir en esta receta.'; tone = 'error'; }
      else if (c.antibiotic) { text = 'Antibiótico: revisa indicación, duración y cantidad. El límite configurado es ' + M.ANTIBIOTIC_MAX_DAYS + ' días.'; tone = 'warn'; }
      tag.textContent = text; tag.dataset.tone = tone; tag.hidden = !text;
    });
    var warns = M.allergyWarnings(ctx.items, ctx.allergy);
    ctx.allergyWarn.replaceChildren(); ctx.allergyWarn.hidden = !warns.length;
    warns.forEach(function (w) { ctx.allergyWarn.append(n('p', 'rx-note rx-error', 'Medicamento ' + w.item + ' ' + w.reason + ': ' + w.allergy + '. Confirma con el paciente antes de emitir.')); });
  }

  async function loadAllergies(local) {
    try {
      var res = await window.sb.from('smyl_patient_histories').select('document').eq('tenant_id', window.tenantId).eq('patient_id', local.patientId).maybeSingle();
      local.allergy = res.error ? null : M.allergiesOf(res.data && res.data.document);
    } catch (_) { local.allergy = null; }
    if (!current(local)) return;
    local.allergyNote.textContent = M.allergyNote(local.allergy); local.allergyCard.dataset.state = local.allergy && local.allergy.names.length ? 'alert' : local.allergy && local.allergy.status === 'no' ? 'clear' : 'pending'; refreshChecks();
  }

  async function loadHistory(local) {
    try {
      var res = await window.sb.from('smyl_prescriptions').select('id,folio,status,issued_at,has_antibiotic,void_reason,snapshot,issued_by')
        .eq('tenant_id', window.tenantId).eq('patient_id', local.patientId).order('issued_at', { ascending: false }).limit(20);
      if (res.error) throw res.error; local.history = res.data || [];
    } catch (_) { local.history = null; }
    if (current(local)) renderHistory();
  }

  function useAsBase(row) {
    var draft = M.draftFromPrescription(row);
    if (!draft.items.length) { say('La receta elegida no contiene medicamentos reutilizables.', 'error'); return; }
    ctx.items = draft.items; ctx.diagnosis.value = draft.diagnosis; ctx.indications.value = draft.indications;
    ctx.declare.checked = false; ctx.reviewed.checked = false; renderItems(); refreshChecks(); renderDraftSummary(); setStep('prepare');
    say('Contenido copiado a un borrador nuevo. Revisa cada medicamento antes de emitir.', 'ok');
    var first = ctx.itemsHost.querySelector('input'); if (first) first.focus();
  }

  function renderHistory() {
    if (!ctx) return; var host = ctx.historyHost; host.replaceChildren();
    if (ctx.history === null) { host.append(n('p', 'rx-empty', 'No pudimos consultar el historial. La receta actual no se perdió.')); return; }
    if (!ctx.history || !ctx.history.length) { host.append(n('p', 'rx-empty', 'Este paciente aún no tiene recetas emitidas.')); return; }
    ctx.history.forEach(function (row) {
      var card = n('article', 'rx-prev'), voided = row.status === 'voided', snapshot = row.snapshot || {};
      var top = n('div', 'rx-prev-top'), info = n('div'), state = n('span', 'rx-state', voided ? 'Anulada' : 'Emitida'); state.dataset.state = voided ? 'voided' : 'issued';
      var meds = (snapshot.items || []).map(function (i) { return i.generic; }).filter(Boolean).join(', ');
      info.append(n('strong', '', snapshot.folio || 'Receta'), n('small', '', when(row.issued_at)), n('p', '', meds || 'Sin medicamentos visibles'));
      top.append(info, state); card.append(top);
      if (voided && row.void_reason) card.append(n('p', 'rx-prev-reason', 'Motivo: ' + row.void_reason));
      var actions = n('div', 'rx-prev-acts');
      if (!voided) actions.append(btn('Usar como base', 'rx-history-primary', function () { useAsBase(row); }));
      actions.append(btn('Imprimir', 'rx-link', function () { printRow(row); }));
      if (!voided) actions.append(btn('Anular', 'rx-link rx-danger', function () { voidDialog(row, card); }));
      card.append(actions); host.append(card);
    });
  }

  function voidDialog(row, anchor) {
    var old = anchor.querySelector('.rx-void'); if (old) { old.remove(); return; }
    var box = n('div', 'rx-void'), label = n('label'), input = n('input'); input.maxLength = 300; input.placeholder = 'Describe el motivo (mínimo 5 caracteres)';
    label.append(n('span', '', 'Motivo de la anulación'), input);
    var go = btn('Confirmar anulación', 'rx-link rx-danger', async function () {
      go.disabled = true;
      try { await rpc('smyl_void_prescription', { p_id: row.id, p_reason: input.value }); say('Receta anulada. El historial conserva el documento original.', 'ok'); await loadHistory(ctx); }
      catch (e) { go.disabled = false; say(e.message, 'error'); }
    });
    box.append(label, go); anchor.append(box); input.focus();
  }

  function setStep(step) {
    if (!ctx) return; ctx.step = step;
    ctx.shell.dataset.step = step;
    ctx.editor.hidden = step !== 'prepare'; ctx.review.hidden = step !== 'review'; ctx.done.hidden = step !== 'issued'; ctx.aside.hidden = step !== 'prepare';
    ctx.steps.forEach(function (item) { var active = item.dataset.step === step, complete = (step === 'review' && item.dataset.step === 'prepare') || step === 'issued'; item.dataset.state = active ? 'active' : complete ? 'complete' : 'pending'; item.setAttribute('aria-current', active ? 'step' : 'false'); });
    if (step === 'review') renderReview();
  }

  function renderReview() {
    ctx.review.replaceChildren();
    var head = n('header', 'rx-review-head'); head.append(n('span', 'rx-eyebrow', 'REVISIÓN FINAL'), n('h3', '', 'Confirma la receta antes de emitirla'), n('p', '', 'Después de emitirla no se puede editar; si hay un error tendrás que anularla y crear otra.')); ctx.review.append(head);
    var patient = n('section', 'rx-review-patient'); patient.append(n('small', '', 'PACIENTE'), n('strong', '', ctx.patientName || 'Paciente'));
    var allergy = n('span', 'rx-review-allergy', M.allergyNote(ctx.allergy)); allergy.dataset.state = ctx.allergy && ctx.allergy.names.length ? 'alert' : 'neutral'; patient.append(allergy); ctx.review.append(patient);
    var list = n('section', 'rx-review-list'); list.append(n('h4', '', 'Medicamentos'));
    ctx.items.forEach(function (item, i) { var line = medicationLine(item), row = n('article'); row.append(n('span', 'rx-review-number', String(i + 1)), n('div')); row.lastChild.append(n('strong', '', line.name), n('p', '', line.use), n('small', '', 'Cantidad a surtir: ' + (line.quantity || '—'))); list.append(row); });
    ctx.review.append(list);
    if (clean(ctx.diagnosis.value) || clean(ctx.indications.value)) {
      var notes = n('section', 'rx-review-notes');
      if (clean(ctx.diagnosis.value)) { var dx = n('div'); dx.append(n('small', '', 'DIAGNÓSTICO'), n('p', '', clean(ctx.diagnosis.value))); notes.append(dx); }
      if (clean(ctx.indications.value)) { var ind = n('div'); ind.append(n('small', '', 'INDICACIONES ADICIONALES'), n('p', '', clean(ctx.indications.value))); notes.append(ind); }
      ctx.review.append(notes);
    }
    var confirmations = n('section', 'rx-confirmations'); confirmations.append(n('h4', '', 'Confirmación profesional'));
    ctx.reviewed.checked = false; ctx.declare.checked = false;
    var reviewedLabel = n('label', 'rx-check'); reviewedLabel.append(ctx.reviewed, n('span', '', 'Revisé paciente, alergias, medicamento, dosis, frecuencia, duración y cantidad.'));
    var declareLabel = n('label', 'rx-check'); declareLabel.append(ctx.declare, n('span', '', 'Confirmo que esta receta no incluye medicamentos controlados (estupefacientes ni psicotrópicos).'));
    confirmations.append(reviewedLabel, declareLabel); ctx.review.append(confirmations);
    var actions = n('footer', 'rx-review-actions'); actions.append(btn('Volver a editar', 'btn btn-secondary', function () { setStep('prepare'); }), ctx.submit); ctx.review.append(actions);
  }

  function reviewDraft() {
    var problems = M.issues(ctx.items, true);
    if (problems.length) { say(problems[0], 'error'); return; }
    say(''); setStep('review'); ctx.review.scrollIntoView({ block: 'start' });
  }

  function renderIssued(row) {
    ctx.done.replaceChildren();
    var mark = n('span', 'rx-done-mark', '✓'), snapshot = row && row.snapshot || {};
    ctx.done.append(mark, n('span', 'rx-eyebrow', 'RECETA EMITIDA'), n('h3', '', snapshot.folio || 'Receta guardada'), n('p', '', 'La copia quedó congelada en el expediente. Puedes imprimirla nuevamente desde el historial.'));
    var actions = n('div', 'rx-done-actions'); actions.append(btn('Imprimir receta', 'btn btn-primary', function () { printRow(row); }), btn('Preparar otra', 'btn btn-secondary', startNew), btn('Cerrar', 'rx-link', function () { ctx.dialog.close(); })); ctx.done.append(actions);
  }

  async function issue() {
    var problems = M.issues(ctx.items, ctx.declare.checked);
    if (!ctx.reviewed.checked) problems.unshift('Confirma que revisaste los datos clínicos y la prescripción.');
    if (problems.length) { say(problems[0], 'error'); return; }
    ctx.submit.disabled = true; ctx.submit.textContent = 'Emitiendo…'; say('Guardando la receta en el expediente…', 'info');
    try {
      var row = await rpc('smyl_issue_prescription', {
        p_id: ctx.rxId, p_idempotency_key: ctx.key, p_patient_id: ctx.patientId, p_branch_id: ctx.branchId || null, p_appointment_id: ctx.appointmentId || null,
        p_diagnosis: ctx.diagnosis.value, p_indications: ctx.indications.value, p_items: M.payload(ctx.items), p_declare_not_controlled: ctx.declare.checked
      });
      row = Array.isArray(row) ? row[0] : row; ctx.issuedRow = row; say('Receta emitida y guardada.', 'ok'); setStep('issued'); renderIssued(row); await loadHistory(ctx); printRow(row);
    } catch (e) { say(e.message, 'error'); }
    ctx.submit.disabled = false; ctx.submit.textContent = 'Emitir e imprimir';
  }

  function startNew() {
    if (!ctx) return; ctx.rxId = crypto.randomUUID(); ctx.key = crypto.randomUUID(); ctx.items = [blankItem()]; ctx.issuedRow = null;
    ctx.diagnosis.value = ''; ctx.indications.value = ''; ctx.declare.checked = false; ctx.reviewed.checked = false; renderItems(); refreshChecks(); renderDraftSummary(); say(''); setStep('prepare');
  }

  function makeStepper() {
    var nav = n('ol', 'rx-stepper'); nav.setAttribute('aria-label', 'Proceso de receta'); ctx.steps = [];
    [['prepare', '1', 'Preparar'], ['review', '2', 'Revisar'], ['issued', '3', 'Emitir']].forEach(function (entry) { var li = n('li'); li.dataset.step = entry[0]; li.append(n('span', '', entry[1]), n('strong', '', entry[2])); nav.append(li); ctx.steps.push(li); });
    return nav;
  }

  function open(opts) {
    opts = opts || {}; if (!window.sb || !window.tenantId || !opts.patientId) return;
    if (ctx && ctx.dialog) ctx.dialog.remove();
    var dlg = n('dialog', 'rx-dialog'); dlg.setAttribute('aria-labelledby', 'rx-dialog-title');
    var local = ctx = { dialog: dlg, patientId: opts.patientId, patientName: opts.patientName || '', branchId: opts.branchId || null, appointmentId: opts.appointmentId || null,
      items: [blankItem()], allergy: null, history: undefined, rxId: crypto.randomUUID(), key: crypto.randomUUID(), step: 'prepare' };
    var form = n('form', 'rx-form'); form.addEventListener('submit', function (e) { e.preventDefault(); });
    var head = n('header', 'rx-dlg-head'), title = n('div', 'rx-title'); title.append(n('span', 'rx-eyebrow', 'EXPEDIENTE DEL PACIENTE'), n('h2', '', 'Nueva receta'), n('p', '', local.patientName)); title.querySelector('h2').id = 'rx-dialog-title';
    var close = btn('×', 'rx-close', function () { dlg.close(); }); close.setAttribute('aria-label', 'Cerrar receta'); head.append(title, close);
    local.status = n('div', 'rx-status'); local.status.setAttribute('aria-live', 'polite');
    var shell = local.shell = n('div', 'rx-shell'); local.editor = n('main', 'rx-editor'); local.review = n('main', 'rx-review'); local.done = n('main', 'rx-done'); local.aside = n('aside', 'rx-aside');

    local.allergyCard = n('section', 'rx-allergy-card'); var allergyIcon = n('span', 'rx-allergy-icon', '!'), allergyCopy = n('div'); allergyCopy.append(n('small', '', 'SEGURIDAD CLÍNICA')); local.allergyNote = n('p', '', 'Consultando alergias…'); allergyCopy.append(local.allergyNote); local.allergyCard.append(allergyIcon, allergyCopy);
    local.allergyWarn = n('div', 'rx-allergy-warnings'); local.allergyWarn.hidden = true;
    var context = n('section', 'rx-editor-section'); context.append(n('div', 'rx-section-head')); context.firstChild.append(n('span', 'rx-section-number', '01'), n('div')); context.firstChild.lastChild.append(n('h3', '', 'Contexto de la receta'), n('p', '', 'El diagnóstico es opcional y sólo se imprime si lo capturas.'));
    var dx = n('label', 'rx-field'); dx.append(n('span', '', 'Diagnóstico (opcional)')); local.diagnosis = n('input'); local.diagnosis.maxLength = 240; local.diagnosis.placeholder = 'Diagnóstico relacionado con esta prescripción'; local.diagnosis.addEventListener('input', renderDraftSummary); dx.append(local.diagnosis); context.append(dx);
    var medication = n('section', 'rx-editor-section'); var medHead = n('div', 'rx-section-head'); medHead.append(n('span', 'rx-section-number', '02'), n('div')); medHead.lastChild.append(n('h3', '', 'Medicamentos'), n('p', '', 'Completa la prescripción y las instrucciones que recibirá el paciente.')); medication.append(medHead); local.itemsHost = n('div'); local.add = btn('+ Agregar medicamento', 'btn btn-secondary rx-add', function () { if (local.items.length < M.MAX_ITEMS) { local.items.push(blankItem()); renderItems(); refreshChecks(); renderDraftSummary(); } }); medication.append(local.itemsHost, local.add);
    var notes = n('section', 'rx-editor-section'); var noteHead = n('div', 'rx-section-head'); noteHead.append(n('span', 'rx-section-number', '03'), n('div')); noteHead.lastChild.append(n('h3', '', 'Indicaciones adicionales'), n('p', '', 'Cuidados o instrucciones que no pertenecen a un medicamento específico.')); notes.append(noteHead); var ind = n('label', 'rx-field'); ind.append(n('span', '', 'Indicaciones al paciente')); local.indications = n('textarea'); local.indications.rows = 4; local.indications.maxLength = 900; local.indications.placeholder = 'Ej. tomar con alimentos, cuidados posteriores o cuándo volver a consulta.'; local.indications.addEventListener('input', renderDraftSummary); ind.append(local.indications); notes.append(ind);
    var editorActions = n('footer', 'rx-editor-actions'); editorActions.append(n('p', '', 'Nada se guarda hasta que revises y emitas la receta.'), btn('Revisar receta', 'btn btn-primary', reviewDraft));
    local.editor.append(local.allergyCard, local.allergyWarn, context, medication, notes, editorActions);

    local.summary = n('section', 'rx-draft-summary');
    var history = n('section', 'rx-history'); var historyHead = n('header'); historyHead.append(n('span', 'rx-eyebrow', 'HISTORIAL'), n('h3', '', 'Recetas anteriores'), n('p', '', 'Reimprime o usa una receta emitida como base de un nuevo borrador.')); history.append(historyHead); local.historyHost = n('div', 'rx-history-list'); history.append(local.historyHost); local.aside.append(local.summary, history);

    local.review.hidden = true; local.done.hidden = true; shell.append(local.editor, local.review, local.done, local.aside);
    local.declare = n('input'); local.declare.type = 'checkbox'; local.declare.addEventListener('change', function () { say(''); });
    local.reviewed = n('input'); local.reviewed.type = 'checkbox'; local.reviewed.addEventListener('change', function () { say(''); });
    local.submit = btn('Emitir e imprimir', 'btn btn-primary', issue);
    var lists = n('div'); lists.hidden = true;
    [['rx-suggest', M.SUGGESTIONS], ['rx-forms', M.FORMS], ['rx-routes', M.ROUTES]].forEach(function (pair) { var dl = n('datalist'); dl.id = pair[0]; pair[1].forEach(function (v) { var o = n('option'); o.value = v; dl.append(o); }); lists.append(dl); });
    form.append(head, makeStepper(), local.status, shell, lists); dlg.append(form); document.body.append(dlg);
    dlg.addEventListener('close', function () { dlg.remove(); if (ctx === local) ctx = null; });
    renderItems(); renderDraftSummary(); setStep('prepare'); dlg.showModal(); loadAllergies(local); loadHistory(local);
  }

  window.SmylPrescriptions = { open: open };
})();
