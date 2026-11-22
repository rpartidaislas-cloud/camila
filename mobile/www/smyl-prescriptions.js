/* SMYL · Receta médica: captura, emisión e impresión desde la consulta.
 *
 * La emisión la valida y la registra la función SQL smyl_issue_prescription (profesional de la sesión con cédula, domicilio del
 * consultorio, datos de cada medicamento, sin controlados, antibióticos ≤ 30 días, folio consecutivo, receta inmutable). Aquí solo se
 * captura, se avisa antes de enviar y se imprime la copia congelada. IMPORTANTE: los requisitos legales NO se han contrastado con el
 * texto oficial (docs/RECETA_REQUISITOS.md): validar con un abogado o asesor sanitario antes de usarla con pacientes reales.
 */
(function () {
  'use strict';
  var M = window.SmylPrescriptionModel, P = window.SmylPrescriptionPrint;
  if (!M || !P) { console.error('[SMYL] receta: faltan smyl-prescription-model.js o smyl-prescription-print.js'); return; }

  var ctx = null;

  function n(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = n('button', cls || 'btn btn-secondary', text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function when(v) { try { return new Date(v).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function say(text, tone) { var host = ctx && ctx.status; if (!host) return; host.replaceChildren(); if (!text) return; var p = n('p', 'rx-note rx-' + (tone || 'info'), text); p.setAttribute('role', tone === 'error' ? 'alert' : 'status'); host.append(p); }

  async function rpc(name, args) {
    var res = await window.sb.rpc(name, args);
    if (res.error) throw new Error(res.error.message || 'No se pudo completar la acción.');
    return res.data;
  }

  // Impresión: se monta SOLO la hoja y las reglas de impresión de smyl-prescription.css ocultan el resto de la página.
  function printRow(row) {
    var old = document.getElementById('rx-print-root'); if (old) old.remove();
    var root = n('div', 'rx-print-root'); root.id = 'rx-print-root'; root.append(P.render(M.toSheet(row)));
    document.body.append(root); document.body.classList.add('rx-printing');
    var done = function () { document.body.classList.remove('rx-printing'); root.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 60);
  }

  function blankItem() { return { generic: '', brand: '', strength: '', form: '', dose: '', route: 'oral', frequency: '', duration_days: '', quantity: '' }; }

  function field(label, key, item, attrs, list) {
    var wrap = n('label', 'rx-field'); wrap.append(n('span', '', label));
    var input = n('input'); input.value = item[key] == null ? '' : item[key];
    Object.keys(attrs || {}).forEach(function (k) { input.setAttribute(k, attrs[k]); });
    if (list) input.setAttribute('list', list);
    input.addEventListener('input', function () { item[key] = input.value; say(''); refreshChecks(); });
    wrap.append(input); return wrap;
  }

  function renderItems() {
    var host = ctx.itemsHost; host.replaceChildren();
    ctx.items.forEach(function (item, i) {
      var box = n('fieldset', 'rx-item'); box.append(n('legend', '', 'Medicamento ' + (i + 1)));
      var grid = n('div', 'rx-grid');
      grid.append(
        field('Nombre genérico *', 'generic', item, { maxlength: '120', autocomplete: 'off' }, 'rx-suggest'),
        field('Marca (opcional)', 'brand', item, { maxlength: '120' }),
        field('Concentración', 'strength', item, { maxlength: '60', placeholder: 'Ej. 500 mg' }),
        field('Presentación *', 'form', item, { maxlength: '60', placeholder: 'tabletas, cápsulas…' }, 'rx-forms'),
        field('Dosis *', 'dose', item, { maxlength: '120', placeholder: 'Ej. 1 cápsula' }),
        field('Vía *', 'route', item, { maxlength: '60' }, 'rx-routes'),
        field('Frecuencia *', 'frequency', item, { maxlength: '80', placeholder: 'Ej. cada 8 horas' }),
        field('Duración (días) *', 'duration_days', item, { type: 'number', min: '1', max: '365', inputmode: 'numeric' }),
        field('Cantidad a surtir *', 'quantity', item, { maxlength: '60', placeholder: 'Ej. 21 cápsulas' })
      );
      box.append(grid);
      var tag = n('p', 'rx-item-tag'); tag.dataset.item = String(i); box.append(tag);
      if (ctx.items.length > 1) box.append(btn('Quitar', 'rx-link', function () { ctx.items.splice(i, 1); renderItems(); refreshChecks(); }));
      host.append(box);
    });
    ctx.add.disabled = ctx.items.length >= M.MAX_ITEMS;
  }

  // Avisos en vivo: antibiótico, controlado y alergias. Informan; el servidor es quien decide.
  function refreshChecks() {
    if (!ctx) return;
    ctx.itemsHost.querySelectorAll('.rx-item-tag').forEach(function (tag) {
      var item = ctx.items[Number(tag.dataset.item)] || {}, c = M.classify(item.generic, item.brand), text = '', tone = '';
      if (c.controlled.length) { text = 'Parece un medicamento controlado: SMYL no emite recetas con estupefacientes ni psicotrópicos.'; tone = 'error'; }
      else if (c.antibiotic) { text = 'Antibiótico: máximo ' + M.ANTIBIOTIC_MAX_DAYS + ' días. La farmacia puede retener esta receta.'; tone = 'warn'; }
      tag.textContent = text; tag.dataset.tone = tone; tag.hidden = !text;
    });
    var warns = M.allergyWarnings(ctx.items, ctx.allergy);
    ctx.allergyWarn.replaceChildren(); ctx.allergyWarn.hidden = !warns.length;
    warns.forEach(function (w) { ctx.allergyWarn.append(n('p', 'rx-note rx-error', 'Medicamento ' + w.item + ' ' + w.reason + ': ' + w.allergy + '. Confirma con el paciente antes de emitir.')); });
  }

  async function loadAllergies() {
    try {
      var res = await window.sb.from('smyl_patient_histories').select('document').eq('tenant_id', window.tenantId).eq('patient_id', ctx.patientId).maybeSingle();
      ctx.allergy = res.error ? null : M.allergiesOf(res.data && res.data.document);
    } catch (e) { ctx.allergy = null; }
    if (!ctx) return;
    ctx.allergyNote.textContent = M.allergyNote(ctx.allergy); refreshChecks();
  }

  async function loadHistory() {
    try {
      var res = await window.sb.from('smyl_prescriptions').select('id,folio,status,issued_at,has_antibiotic,void_reason,snapshot,issued_by')
        .eq('tenant_id', window.tenantId).eq('patient_id', ctx.patientId).order('issued_at', { ascending: false }).limit(20);
      if (res.error) throw res.error;
      ctx.history = res.data || [];
    } catch (e) { ctx.history = null; }
    renderHistory();
  }

  function renderHistory() {
    if (!ctx) return; var host = ctx.historyHost; host.replaceChildren();
    if (ctx.history === null) { host.append(n('p', 'rx-note rx-info', 'No se pudo consultar el historial de recetas.')); return; }
    if (!ctx.history.length) { host.append(n('p', 'rx-note rx-info', 'Este paciente aún no tiene recetas.')); return; }
    ctx.history.forEach(function (row) {
      var item = n('div', 'rx-prev'), voided = row.status === 'voided';
      var meds = (row.snapshot && row.snapshot.items || []).map(function (i) { return i.generic; }).join(', ');
      var info = n('div'); info.append(n('strong', '', (row.snapshot && row.snapshot.folio || 'Receta') + (voided ? ' · ANULADA' : '')), n('small', '', when(row.issued_at) + (meds ? ' · ' + meds : '') + (voided && row.void_reason ? ' · Motivo: ' + row.void_reason : '')));
      var acts = n('div', 'rx-prev-acts');
      acts.append(btn('Reimprimir', 'rx-link', function () { printRow(row); }));
      if (!voided) acts.append(btn('Anular', 'rx-link rx-danger', function () { voidDialog(row, item); }));
      item.append(info, acts); host.append(item);
    });
  }

  function voidDialog(row, anchor) {
    var old = anchor.querySelector('.rx-void'); if (old) { old.remove(); return; }
    var box = n('div', 'rx-void'), input = n('input'); input.maxLength = 300; input.placeholder = 'Motivo de la anulación (mínimo 5 caracteres)'; input.setAttribute('aria-label', 'Motivo de la anulación');
    var go = btn('Confirmar anulación', 'rx-link rx-danger', async function () {
      go.disabled = true;
      try { await rpc('smyl_void_prescription', { p_id: row.id, p_reason: input.value }); say('Receta anulada.', 'ok'); await loadHistory(); }
      catch (e) { go.disabled = false; say(e.message, 'error'); }
    });
    box.append(input, go); anchor.append(box); input.focus();
  }

  async function issue() {
    var problems = M.issues(ctx.items, ctx.declare.checked);
    if (problems.length) { say(problems[0], 'error'); return; }
    ctx.submit.disabled = true; say('Emitiendo receta…', 'info');
    try {
      var row = await rpc('smyl_issue_prescription', {
        p_id: ctx.rxId, p_idempotency_key: ctx.key, p_patient_id: ctx.patientId, p_branch_id: ctx.branchId || null, p_appointment_id: ctx.appointmentId || null,
        p_diagnosis: ctx.diagnosis.value, p_indications: ctx.indications.value, p_items: M.payload(ctx.items), p_declare_not_controlled: ctx.declare.checked
      });
      row = Array.isArray(row) ? row[0] : row;
      say('Receta ' + (row.snapshot && row.snapshot.folio || '') + ' emitida. Se abrirá la impresión.', 'ok');
      ctx.rxId = crypto.randomUUID(); ctx.key = crypto.randomUUID(); // la siguiente receta usa otra llave; ante un error se reintenta con la misma
      ctx.items = [blankItem()]; ctx.diagnosis.value = ''; ctx.indications.value = ''; ctx.declare.checked = false; renderItems(); refreshChecks();
      await loadHistory(); printRow(row);
    } catch (e) { say(e.message, 'error'); }
    ctx.submit.disabled = false;
  }

  function open(opts) {
    opts = opts || {};
    if (!window.sb || !window.tenantId || !opts.patientId) return;
    if (ctx && ctx.dialog) ctx.dialog.remove();
    var dlg = n('dialog', 'rx-dialog'); dlg.setAttribute('aria-label', 'Receta médica');
    ctx = { dialog: dlg, patientId: opts.patientId, branchId: opts.branchId || null, appointmentId: opts.appointmentId || null, items: [blankItem()], allergy: null, history: undefined,
      rxId: crypto.randomUUID(), key: crypto.randomUUID() };
    var form = n('form'); form.method = 'dialog';
    var head = n('div', 'rx-dlg-head'); head.append(n('h2', '', 'Receta médica'), n('p', '', opts.patientName || ''), btn('Cerrar', 'rx-link', function () { dlg.close(); }));
    ctx.allergyNote = n('p', 'rx-note rx-info', 'Consultando alergias…'); ctx.allergyWarn = n('div'); ctx.allergyWarn.hidden = true;
    ctx.status = n('div'); ctx.status.setAttribute('aria-live', 'polite');
    ctx.itemsHost = n('div');
    ctx.add = btn('+ Agregar medicamento', 'btn btn-secondary', function () { if (ctx.items.length < M.MAX_ITEMS) { ctx.items.push(blankItem()); renderItems(); refreshChecks(); } });
    var dx = n('label', 'rx-field'); dx.append(n('span', '', 'Diagnóstico (opcional)')); ctx.diagnosis = n('input'); ctx.diagnosis.maxLength = 240; dx.append(ctx.diagnosis);
    var ind = n('label', 'rx-field'); ind.append(n('span', '', 'Indicaciones al paciente')); ctx.indications = n('textarea'); ctx.indications.rows = 3; ctx.indications.maxLength = 900; ind.append(ctx.indications);
    var dec = n('label', 'rx-check'); ctx.declare = n('input'); ctx.declare.type = 'checkbox'; ctx.declare.addEventListener('change', function () { say(''); }); dec.append(ctx.declare, n('span', '', 'Confirmo que esta receta no incluye medicamentos controlados (estupefacientes ni psicotrópicos).'));
    ctx.submit = btn('Emitir e imprimir', 'btn btn-primary'); ctx.submit.type = 'submit';
    var lists = n('div'); lists.hidden = true;
    [['rx-suggest', M.SUGGESTIONS], ['rx-forms', M.FORMS], ['rx-routes', M.ROUTES]].forEach(function (pair) {
      var dl = n('datalist'); dl.id = pair[0]; pair[1].forEach(function (v) { var o = n('option'); o.value = v; dl.append(o); }); lists.append(dl);
    });
    ctx.historyHost = n('div');
    form.append(head, ctx.allergyNote, ctx.allergyWarn, dx, ctx.itemsHost, ctx.add, ind, dec, ctx.status, ctx.submit, n('h3', '', 'Recetas anteriores'), ctx.historyHost, lists);
    form.addEventListener('submit', function (e) { e.preventDefault(); issue(); });
    dlg.append(form); document.body.append(dlg);
    dlg.addEventListener('close', function () { dlg.remove(); if (ctx && ctx.dialog === dlg) ctx = null; });
    renderItems(); dlg.showModal(); loadAllergies(); loadHistory();
  }

  window.SmylPrescriptions = { open: open };
})();
