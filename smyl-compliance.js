/* SMYL · Cumplimiento sanitario: bitácoras y carpeta para una visita de COFEPRIS.
 *
 * Una sola pantalla (Configuración › Cuenta y seguridad › Cumplimiento sanitario):
 *   - resumen de qué está al día y qué falta, con lo que SMYL ya registra (notas firmadas, consentimientos, citas);
 *   - bitácora de esterilización (ciclos y testigo biológico cada 2 meses) y de residuos RPBI, en un toque;
 *   - requisitos del consultorio (aviso de funcionamiento, contrato de RPBI, etc.) con folio y vigencia;
 *   - «Generar reporte»: una hoja imprimible o para guardar como PDF, con fecha y responsable.
 * Las reglas viven en smyl-compliance-model.js (lógica pura). El servidor es smyl_compliance_overview / smyl_log_* /
 * smyl_set_compliance_item (migración 20261126200000). Si la migración no está aplicada, la pantalla lo dice y no rompe nada.
 * Este reporte resume registros de la clínica; no sustituye los documentos originales ni una asesoría sanitaria. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (win) {
  'use strict';
  var M = win && win.SmylComplianceModel;
  if (!win || !win.document || !M) return {};

  var state = { loading: false, loaded: false, error: '', missing: false, data: null, from: null };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtDate(v, withTime) {
    var d = new Date(String(v).length === 10 ? v + 'T12:00:00' : v);
    if (isNaN(d.getTime())) return '';
    var o = { day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; }
    return d.toLocaleDateString('es-MX', o).replace(/\./g, '');
  }
  function clinicName() { return (win.tenantData && win.tenantData.nombre) || 'Consultorio'; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function periodFrom() { var d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); }

  async function rpc(name, args) {
    var res = await win.sb.rpc(name, args);
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  }
  function friendly(error) {
    var text = String((error && error.message) || '');
    if (error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(text))) return 'missing';
    return text || 'No se pudo completar la acción.';
  }

  async function load(force) {
    if (state.loading || (state.loaded && !force) || !win.sb) return;
    state.loading = true; state.error = ''; render();
    try {
      state.data = await rpc('smyl_compliance_overview', { p_from: state.from || periodFrom(), p_to: today() });
      state.loaded = true; state.missing = false;
    } catch (error) {
      var f = friendly(error);
      if (f === 'missing') state.missing = true; else state.error = f;
    }
    state.loading = false; render();
  }

  /* ---------------------------------------------------------------- diálogos pequeños */
  function ask(opts) {
    var d = el('dialog', 'cp-dialog'); d.setAttribute('aria-labelledby', 'cp-dialog-title');
    var form = el('form', 'cp-form'); form.noValidate = true;
    var head = el('header', 'cp-form-head'), copy = el('div');
    var title = el('h2', '', opts.title); title.id = 'cp-dialog-title'; copy.append(title);
    if (opts.help) copy.append(el('p', 'cp-help', opts.help));
    var x = el('button', 'cp-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Cerrar'); x.onclick = function () { d.close(); };
    head.append(copy, x); form.append(head);
    var body = el('div', 'cp-form-body'); form.append(body);
    var err = el('p', 'cp-error'); err.setAttribute('role', 'alert'); err.hidden = true; form.append(err);
    var foot = el('footer', 'cp-form-foot'), cancel = el('button', 'btn btn-secondary', 'Cancelar'); cancel.type = 'button'; cancel.onclick = function () { d.close(); };
    var ok = el('button', 'btn btn-primary', opts.submit || 'Guardar'); ok.type = 'submit';
    foot.append(cancel); (opts.extra || []).forEach(function (b) { foot.append(b); }); foot.append(ok); form.append(foot);
    opts.build(body, d);
    d.append(form); document.body.append(d);
    function showError(t) { err.hidden = !t; err.textContent = t || ''; }
    form.onsubmit = async function (e) {
      e.preventDefault(); showError('');
      var values = opts.read ? opts.read(body) : {}, bad = opts.validate ? opts.validate(values) : '';
      if (bad) { showError(bad); return; }
      ok.disabled = true; var label = ok.textContent; ok.textContent = 'Guardando…';
      try { await opts.onSubmit(values); d.close(); }
      catch (error) { showError(friendly(error) === 'missing' ? 'Falta aplicar la actualización de la base de datos de SMYL.' : friendly(error)); ok.disabled = false; ok.textContent = label; }
    };
    d.addEventListener('close', function () { d.remove(); }, { once: true });
    d.showModal();
    var first = body.querySelector('input,select,textarea,button'); if (first) first.focus();
    return d;
  }
  function field(label, input, hint) {
    var l = el('label', 'cp-field'); l.append(el('span', '', label), input); if (hint) l.append(el('small', '', hint)); return l;
  }
  function input(type, attrs) { var i = el('input'); i.type = type; Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); }); return i; }
  function choice(name, options, current) {
    var wrap = el('div', 'cp-choice'); wrap.setAttribute('role', 'radiogroup');
    options.forEach(function (o) {
      var l = el('label', 'cp-choice-opt'), r = input('radio', { name: name, value: o[0] }); r.checked = current === o[0];
      var c = el('span', ''); c.append(el('strong', '', o[1])); if (o[2]) c.append(el('small', '', o[2]));
      l.append(r, c); wrap.append(l);
    });
    return wrap;
  }

  function askCycle() {
    ask({
      title: 'Registrar ciclo de autoclave', help: 'Fecha y hora se ponen solas. Quien lo registra queda como responsable.', submit: 'Registrar ciclo',
      build: function (b) {
        b.append(field('Autoclave (opcional)', input('text', { name: 'device', maxlength: 60, placeholder: 'Ej. Autoclave 1' })));
        var row = el('div', 'cp-row'); row.append(field('Temperatura °C', input('number', { name: 'temperature_c', inputmode: 'numeric', min: 100, max: 200, placeholder: '134' })), field('Minutos', input('number', { name: 'minutes', inputmode: 'numeric', min: 1, max: 120, placeholder: '18' }))); b.append(row);
        var ind = el('div', 'cp-field'); ind.append(el('span', '', 'Indicador químico del paquete'), choice('indicator_ok', [['yes', 'Correcto', 'Cambió de color como se espera.'], ['no', 'Incorrecto', 'Reprocesar el instrumental.']], 'yes')); b.append(ind);
        b.append(field('Notas (opcional)', input('text', { name: 'notes', maxlength: 500 })));
      },
      read: function (b) { var q = function (n) { return b.querySelector('[name=' + n + ']'); }; return { device: q('device').value, temperature_c: q('temperature_c').value, minutes: q('minutes').value, indicator_ok: b.querySelector('[name=indicator_ok]:checked').value === 'yes', notes: q('notes').value }; },
      validate: M.cycleError,
      onSubmit: async function (v) { await rpc('smyl_log_sterilization', { p_kind: 'cycle', p_values: M.sanitizeCycle(v) }); await load(true); }
    });
  }
  function askBio() {
    ask({
      title: 'Registrar testigo biológico', help: 'Se aplica cada 2 meses como control de calidad de la esterilización (NOM-013-SSA2-2015, 8.24).', submit: 'Registrar testigo',
      build: function (b) {
        var res = el('div', 'cp-field'); res.append(el('span', '', 'Resultado'), choice('bio_result', [['negative', 'Negativo', 'La esterilización funciona.'], ['positive', 'Positivo', 'Hay que revisar el ciclo y repetirlo.']], 'negative')); b.append(res);
        b.append(field('Fecha del resultado', input('date', { name: 'when', max: today(), value: today() })));
        b.append(field('Notas (opcional)', input('text', { name: 'notes', maxlength: 500 })));
      },
      read: function (b) { var q = function (n) { return b.querySelector('[name=' + n + ']'); }; return { bio_result: b.querySelector('[name=bio_result]:checked').value, when: q('when').value, notes: q('notes').value }; },
      validate: function (v) { return v.when && v.when > today() ? 'La fecha no puede ser futura.' : ''; },
      onSubmit: async function (v) {
        var values = { bio_result: v.bio_result, notes: String(v.notes || '').trim() };
        if (v.when && v.when !== today()) values.occurred_at = v.when + 'T12:00:00';
        await rpc('smyl_log_sterilization', { p_kind: 'biological_test', p_values: values }); await load(true);
      }
    });
  }
  function askRpbi() {
    ask({
      title: 'Registrar recolección de RPBI', help: 'El número de manifiesto es la evidencia que revisa el verificador.', submit: 'Registrar recolección',
      build: function (b) {
        b.append(field('Número de manifiesto', input('text', { name: 'manifest', maxlength: 60, placeholder: 'Ej. M-0871' })));
        b.append(field('Empresa recolectora', input('text', { name: 'company', maxlength: 120 })));
        var row = el('div', 'cp-row'); row.append(field('Fecha', input('date', { name: 'collected_at', max: today(), value: today() })), field('Kilos (opcional)', input('number', { name: 'kg', step: '0.1', min: 0, max: 9999, inputmode: 'decimal' }))); b.append(row);
      },
      read: function (b) { var q = function (n) { return b.querySelector('[name=' + n + ']'); }; return { manifest: q('manifest').value, company: q('company').value, collected_at: q('collected_at').value, kg: q('kg').value }; },
      validate: function (v) { return M.rpbiError(v) || (v.collected_at && v.collected_at > today() ? 'La fecha no puede ser futura.' : ''); },
      onSubmit: async function (v) {
        var values = { manifest: String(v.manifest).trim(), company: String(v.company || '').trim(), collected_at: v.collected_at || today() };
        if (v.kg !== '') values.kg = Number(v.kg);
        await rpc('smyl_log_rpbi', { p_values: values }); await load(true);
      }
    });
  }
  function askItem(row, draft) {
    var existing = row.row, suggested = draft || {}, kind = suggested.status || (existing ? existing.status : 'have');
    var clear = el('button', 'btn btn-secondary cp-clear', 'Quitar'); clear.type = 'button'; clear.hidden = !existing;
    var dlg = ask({
      title: row.title, help: row.source, submit: 'Guardar', extra: existing ? [clear] : [],
      build: function (b) {
        b.append(choice('status', [['have', 'Lo tengo', 'Anota el folio o dónde está.'], ['not_applicable', 'No aplica en mi consultorio', 'Por ejemplo, un servicio que no ofreces.']], kind));
        b.append(field('Folio o referencia', input('text', { name: 'reference', maxlength: 120, value: suggested.reference || (existing ? existing.reference || '' : ''), placeholder: row.hint || '' })));
        if (row.validity) b.append(field('Vigencia hasta', input('date', { name: 'valid_until', value: suggested.valid_until || (existing && existing.valid_until ? String(existing.valid_until).slice(0, 10) : '') }), 'Te avisamos 30 días antes de que venza.'));
        b.append(field('Notas (opcional)', input('text', { name: 'notes', maxlength: 500, value: suggested.notes || (existing ? existing.notes || '' : '') })));
      },
      read: function (b) { var q = function (n) { return b.querySelector('[name=' + n + ']'); }; return { status: b.querySelector('[name=status]:checked').value, reference: q('reference').value, valid_until: q('valid_until') ? q('valid_until').value : '', notes: q('notes').value }; },
      validate: function () { return ''; },
      onSubmit: async function (v) { await rpc('smyl_set_compliance_item', { p_key: row.key, p_status: v.status, p_reference: v.reference.trim(), p_valid_until: v.valid_until || null, p_notes: v.notes.trim() }); await load(true); }
    });
    clear.onclick = async function () { try { await rpc('smyl_set_compliance_item', { p_key: row.key, p_status: 'clear' }); dlg.close(); await load(true); } catch (error) { var e = dlg.querySelector('.cp-error'); e.hidden = false; e.textContent = friendly(error); } };
  }

  /* ---------------------------------------------------------------- preparación asistida */
  function manualRows() {
    if (!state.data) return [];
    return M.evaluate(state.data, new Date()).groups.reduce(function (all, group) {
      return all.concat(group.rows.filter(function (row) { return row.manual; }));
    }, []);
  }
  async function milaDraft(context) {
    var rows = manualRows();
    var payload = rows.map(function (row) {
      return {
        key: row.key, title: row.title, hint: row.hint || '', cadence: row.cadence || 'setup',
        validity: !!row.validity, current_status: row.row ? row.row.status : '',
        current_reference: row.row ? row.row.reference || '' : '', current_notes: row.row ? row.row.notes || '' : ''
      };
    });
    var result = await win.sb.functions.invoke('compliance-assistant', { body: {
      clinic_name: clinicName(), context: String(context || '').trim().slice(0, 6000), items: payload
    } });
    if (result.error) throw result.error;
    if (!result.data || !Array.isArray(result.data.suggestions)) throw new Error('MILA no devolvió un borrador utilizable.');
    return result.data;
  }
  function assistantStatus(s) {
    return s.status === 'have' ? 'Parece que lo tienes' : s.status === 'not_applicable' ? 'Podría no aplicar' : 'Necesita un dato';
  }
  function renderMilaReview(dialog, data) {
    var rows = manualRows(), byKey = {}; rows.forEach(function (row) { byKey[row.key] = row; });
    var form = dialog.querySelector('.cp-form'), body = dialog.querySelector('.cp-form-body'), foot = dialog.querySelector('.cp-form-foot');
    body.replaceChildren(); foot.replaceChildren();
    body.append(el('div', 'cp-ai-summary', data.overview || 'MILA preparó un borrador para que lo revises.'));
    var suggestions = data.suggestions.filter(function (s) { return s && byKey[s.key]; });
    suggestions.forEach(function (s) {
      var row = byKey[s.key], item = el('article', 'cp-ai-suggestion'); item.dataset.status = s.status;
      var top = el('div', 'cp-ai-suggestion-head'), check = input('checkbox', { name: 'apply', value: s.key });
      check.disabled = !['have', 'not_applicable'].includes(s.status);
      var copy = el('div'); copy.append(el('strong', '', row.title), el('span', 'cp-ai-label', assistantStatus(s)));
      top.append(check, copy); item.append(top);
      if (s.explanation) item.append(el('p', 'cp-help', s.explanation));
      if (!check.disabled) {
        item.dataset.proposedStatus = s.status;
        item.append(field('Folio o referencia', input('text', { name: 'reference', maxlength: 120, value: s.reference || '', placeholder: row.hint || '' })));
        if (row.validity) item.append(field('Vigencia hasta', input('date', { name: 'valid_until', value: s.valid_until || '' })));
        item.append(field('Notas', input('text', { name: 'notes', maxlength: 500, value: s.notes || '' })));
      }
      var revise = el('button', 'cp-ai-revise', 'Revisar por separado'); revise.type = 'button';
      revise.onclick = function () { dialog.close(); askItem(row, s); };
      item.append(revise); body.append(item);
    });
    if (Array.isArray(data.questions) && data.questions.length) {
      var questions = el('div', 'cp-ai-questions'); questions.append(el('strong', '', 'Lo único que MILA todavía necesita de ti'));
      var list = el('ul'); data.questions.slice(0, 6).forEach(function (q) { list.append(el('li', '', q)); }); questions.append(list); body.append(questions);
    }
    var confirmation = el('label', 'cp-ai-confirm'), confirm = input('checkbox', { name: 'confirm_review' });
    confirmation.append(confirm, el('span', '', 'Confirmo que revisé los datos seleccionados. MILA sólo preparó el borrador.')); body.append(confirmation);
    var error = dialog.querySelector('.cp-error');
    var cancel = el('button', 'btn btn-secondary', 'Cerrar'); cancel.type = 'button'; cancel.onclick = function () { dialog.close(); };
    var save = el('button', 'btn btn-primary', 'Guardar seleccionados'); save.type = 'button';
    save.onclick = async function () {
      error.hidden = true;
      var selected = Array.from(body.querySelectorAll('[name=apply]:checked'));
      if (!selected.length) { error.hidden = false; error.textContent = 'Selecciona al menos un borrador para guardar.'; return; }
      if (!confirm.checked) { error.hidden = false; error.textContent = 'Confirma que revisaste los datos antes de guardarlos.'; return; }
      save.disabled = true; save.textContent = 'Guardando…';
      try {
        for (var i = 0; i < selected.length; i++) {
          var article = selected[i].closest('.cp-ai-suggestion'), status = article.dataset.proposedStatus;
          var reference = article.querySelector('[name=reference]'), valid = article.querySelector('[name=valid_until]'), notes = article.querySelector('[name=notes]');
          if (status === 'have' && !String(reference.value || '').trim()) throw new Error('Agrega el folio o la referencia de “' + byKey[selected[i].value].title + '”.');
          if (status === 'not_applicable' && String(notes.value || '').trim().length < 8) throw new Error('Explica por qué no aplica “' + byKey[selected[i].value].title + '”.');
          await rpc('smyl_set_compliance_item', { p_key: selected[i].value, p_status: status, p_reference: String(reference.value || '').trim(), p_valid_until: valid && valid.value ? valid.value : null, p_notes: String(notes.value || '').trim() });
        }
        dialog.close(); await load(true);
      } catch (err) { error.hidden = false; error.textContent = friendly(err); save.disabled = false; save.textContent = 'Guardar seleccionados'; }
    };
    foot.append(cancel, save); form.onsubmit = function (e) { e.preventDefault(); save.click(); };
  }
  function askMila() {
    var d = el('dialog', 'cp-dialog cp-ai-dialog'); d.setAttribute('aria-labelledby', 'cp-mila-title');
    var form = el('form', 'cp-form'); form.noValidate = true;
    var head = el('header', 'cp-form-head'), copy = el('div');
    var title = el('h2', '', 'Preparar con MILA'); title.id = 'cp-mila-title';
    copy.append(title, el('p', 'cp-help', 'MILA ordena lo que SMYL ya sabe y prepara borradores. Tú decides qué guardar.'));
    var x = el('button', 'cp-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Cerrar'); x.onclick = function () { d.close(); };
    head.append(copy, x); form.append(head);
    var body = el('div', 'cp-form-body');
    var note = el('div', 'cp-ai-safe'); note.append(el('strong', '', 'No inventa ni aprueba documentos.'), el('span', '', 'Sólo propone datos a partir de lo que escribas. Cada propuesta queda pendiente de tu revisión.'));
    var context = el('textarea', 'cp-ai-context'); context.name = 'context'; context.maxLength = 6000; context.rows = 7;
    context.placeholder = 'Ejemplo: Tengo aviso de funcionamiento con folio…, contrato de RPBI con la empresa… vigente hasta…, no opero equipo de rayos X…';
    body.append(note, field('Cuéntale qué documentos y controles ya tiene la clínica', context, 'Puedes pegar varios folios, fechas y notas en un solo texto. No incluyas datos de pacientes.'));
    form.append(body);
    var err = el('p', 'cp-error'); err.setAttribute('role', 'alert'); err.hidden = true; form.append(err);
    var foot = el('footer', 'cp-form-foot'), cancel = el('button', 'btn btn-secondary', 'Cancelar'); cancel.type = 'button'; cancel.onclick = function () { d.close(); };
    var prepare = el('button', 'btn btn-primary', 'Preparar borrador con MILA'); prepare.type = 'submit';
    foot.append(cancel, prepare); form.append(foot); d.append(form); document.body.append(d);
    form.onsubmit = async function (event) {
      event.preventDefault(); err.hidden = true; prepare.disabled = true; prepare.textContent = 'MILA está preparando…';
      try { renderMilaReview(d, await milaDraft(context.value)); }
      catch (error) { err.hidden = false; err.textContent = friendly(error); prepare.disabled = false; prepare.textContent = 'Preparar borrador con MILA'; }
    };
    d.addEventListener('close', function () { d.remove(); }, { once: true }); d.showModal(); context.focus();
  }

  /* ---------------------------------------------------------------- pantalla */
  function chip(status, label) { var c = el('span', 'cp-chip', label); c.dataset.status = status; return c; }
  function rowEl(r) {
    var li = el('li', 'cp-row-item'); li.dataset.status = r.status;
    var copy = el('div', 'cp-row-copy'); copy.append(el('strong', '', r.title));
    var detail = r.detail || r.hint; if (detail) copy.append(el('small', '', detail));
    copy.append(el('small', 'cp-source', r.source + (r.level === 'confirm' ? ' · por confirmar' : r.level === 'recommended' ? ' · recomendado' : '')));
    li.append(copy, chip(r.status, r.label));
    var act = null;
    if (r.manual) act = el('button', 'btn btn-secondary btn-sm', r.row ? 'Editar' : 'Marcar'), act.onclick = function () { askItem(r); };
    else if (r.action === 'bio') act = el('button', 'btn btn-secondary btn-sm', 'Registrar'), act.onclick = askBio;
    else if (r.action === 'cycle') act = el('button', 'btn btn-secondary btn-sm', 'Registrar'), act.onclick = askCycle;
    else if (r.action === 'rpbi') act = el('button', 'btn btn-secondary btn-sm', 'Registrar'), act.onclick = askRpbi;
    if (act) { act.type = 'button'; li.append(act); }
    return li;
  }
  function card(title, sub) { var c = el('section', 'cp-card'), h = el('header', 'cp-card-head'), t = el('div'); t.append(el('h2', '', title)); if (sub) t.append(el('p', 'cp-help', sub)); h.append(t); c.append(h); c.head = h; return c; }
  function rowsWithCadence(ev, values) {
    return ev.groups.reduce(function (all, group) { return all.concat(group.rows); }, []).filter(function (row) { return values.includes(row.cadence); });
  }
  function cadenceCard(title, sub, eyebrow, rows, open) {
    var details = el('details', 'cp-card cp-cadence'); details.open = !!open;
    var summary = el('summary', 'cp-cadence-head'), copy = el('div');
    copy.append(el('span', 'cp-cadence-eyebrow', eyebrow), el('h2', '', title), el('p', 'cp-help', sub));
    var pending = rows.filter(function (row) { return !['ok', 'info', 'na'].includes(row.status); }).length;
    summary.append(copy, chip(pending ? 'missing' : 'ok', pending ? pending + ' por revisar' : 'Al día'));
    var listRows = el('ul', 'cp-rows'); rows.forEach(function (row) { listRows.append(rowEl(row)); });
    details.append(summary, listRows); return details;
  }

  function render() {
    var host = document.getElementById('cp-content'); if (!host) return;
    host.replaceChildren();
    if (state.loading && !state.data) { host.append(el('p', 'cp-help', 'Cargando el cumplimiento de tu consultorio…')); return; }
    if (state.missing) { var m = el('div', 'cp-note'); m.append(el('strong', '', 'Falta una actualización de la base de datos.'), el('p', '', 'Esta pantalla estará disponible cuando se aplique la migración de cumplimiento sanitario de SMYL.')); host.append(m); return; }
    if (state.error && !state.data) { var e = el('p', 'cp-error', state.error); e.setAttribute('role', 'alert'); var retry = el('button', 'btn btn-secondary', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { load(true); }; host.append(e, retry); return; }
    if (!state.data) return;
    var ev = M.evaluate(state.data, new Date()), s = ev.summary, steril = state.data.sterilization || {}, rpbi = state.data.rpbi || {};

    var sum = card('Tu avance');
    var big = el('div', 'cp-summary'); big.append(el('strong', '', s.ok + ' de ' + s.total), el('span', '', ' requisitos al día'));
    var bar = el('div', 'cp-bar'); bar.setAttribute('aria-hidden', 'true'); var fill = el('i', ''); fill.style.width = (s.total ? Math.round(s.ok / s.total * 100) : 0) + '%'; bar.append(fill);
    sum.append(big, bar);
    if (s.pending) {
      var todo = el('ul', 'cp-todo'); s.pendingRows.slice(0, 3).forEach(function (r) { var li = el('li', ''); li.dataset.status = r.status; li.append(el('span', '', r.title), chip(r.status, r.label)); todo.append(li); });
      sum.append(el('h3', 'cp-sub', 'Lo siguiente que conviene resolver'), todo);
    } else sum.append(el('p', 'cp-help', 'Todo lo que SMYL puede comprobar está al día.'));
    host.append(sum);

    var guide = el('div', 'cp-rhythm-guide');
    [['01', 'Configura una vez', 'Documentos, equipo y avisos de la clínica.'], ['02', 'Mantén al día', 'Controles diarios, mensuales o anuales.'], ['03', 'SMYL lo registra', 'Actividad clínica que se comprueba automáticamente.']].forEach(function (item) {
      var tile = el('div', ''); tile.append(el('span', '', item[0]), el('strong', '', item[1]), el('small', '', item[2])); guide.append(tile);
    });
    host.append(guide);
    host.append(cadenceCard('Configura la clínica una sola vez', 'Completa estos datos al iniciar; después sólo los revisas si algo cambia.', 'PRIMERA VEZ', rowsWithCadence(ev, ['setup']), true));
    var routineRows = rowsWithCadence(ev, ['routine', 'periodic']);
    var routine = cadenceCard('Rutinas y vencimientos', 'Aquí vive lo diario, periódico y todo lo que requiere una nueva evidencia.', 'MANTENER AL DÍA', routineRows, true);
    var history = el('details', 'cp-history'); history.append(el('summary', '', 'Ver registros recientes'));
    var logs = el('div', 'cp-history-grid');
    var ster = el('section'); ster.append(el('h3', '', 'Esterilización'), list(steril.recent, function (r) { return [fmtDate(r.occurred_at, true), r.kind === 'cycle' ? 'Ciclo' + (r.device ? ' · ' + r.device : '') : 'Testigo biológico · ' + (r.bio_result === 'negative' ? 'negativo' : 'positivo')]; }, 'Sin registros en el periodo.'));
    var waste = el('section'); waste.append(el('h3', '', 'RPBI'), list(rpbi.recent, function (r) { return [fmtDate(r.collected_at), 'Manifiesto ' + r.manifest + (r.company ? ' · ' + r.company : '')]; }, 'Sin recolecciones en el periodo.'));
    logs.append(ster, waste); history.append(logs); routine.append(history); host.append(routine);
    host.append(cadenceCard('Lo que SMYL registra automáticamente', 'Se actualiza con la agenda, las notas firmadas, los consentimientos y los procedimientos.', 'SIN CAPTURA DOBLE', rowsWithCadence(ev, ['automatic']), false));
    host.append(el('p', 'cp-foot', 'Este resumen se arma con los registros de tu consultorio. No sustituye los documentos originales ni una asesoría sanitaria.'));
  }
  function list(rows, cols, empty) {
    if (!rows || !rows.length) return el('p', 'cp-help', empty);
    var ul = el('ul', 'cp-log');
    rows.slice(0, 8).forEach(function (r) { var c = cols(r), li = el('li', ''); li.append(el('time', '', c[0]), el('span', '', c[1])); ul.append(li); });
    if (rows.length > 8) ul.append(el('li', 'cp-more', '… y ' + (rows.length - 8) + ' más en el reporte.'));
    return ul;
  }

  /* ---------------------------------------------------------------- reporte imprimible */
  function reportHtml() {
    var d = state.data || {}, ev = M.evaluate(d, new Date()), steril = d.sterilization || {}, rpbi = d.rpbi || {}, act = d.activity || {};
    var h = '<header class="cp-r-head"><div><h1>Carpeta de cumplimiento sanitario</h1><p><strong>' + esc(clinicName()) + '</strong></p></div><div class="cp-r-meta">Periodo: ' + esc(fmtDate(d.from)) + ' al ' + esc(fmtDate(d.to)) + '<br>Generado el ' + esc(fmtDate(new Date().toISOString(), true)) + '</div></header>';
    h += '<section><h2>Resumen</h2><p>' + ev.summary.ok + ' de ' + ev.summary.total + ' requisitos al día' + (ev.summary.pending ? ' · ' + ev.summary.pending + ' pendientes' : '') + '.</p></section>';
    ev.groups.forEach(function (g) {
      if (!g.rows.length) return;
      h += '<section><h2>' + esc(g.name) + '</h2><table><thead><tr><th>Requisito</th><th>Estado</th><th>Detalle</th><th>Fundamento</th></tr></thead><tbody>' + g.rows.map(function (r) { return '<tr><td>' + esc(r.title) + '</td><td>' + esc(r.label) + '</td><td>' + esc(r.detail || '') + '</td><td>' + esc(r.source) + (r.level === 'confirm' ? ' (por confirmar)' : '') + '</td></tr>'; }).join('') + '</tbody></table></section>';
    });
    h += '<section><h2>Bitácora de esterilización</h2>' + (steril.recent && steril.recent.length ? '<table><thead><tr><th>Fecha</th><th>Registro</th></tr></thead><tbody>' + steril.recent.map(function (r) { return '<tr><td>' + esc(fmtDate(r.occurred_at, true)) + '</td><td>' + (r.kind === 'cycle' ? 'Ciclo' + (r.device ? ' · ' + esc(r.device) : '') + (r.temperature_c ? ' · ' + r.temperature_c + ' °C' : '') + (r.minutes ? ' · ' + r.minutes + ' min' : '') + ' · indicador ' + (r.indicator_ok ? 'correcto' : 'incorrecto') : 'Testigo biológico · ' + (r.bio_result === 'negative' ? 'negativo' : 'positivo')) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p>Sin registros en el periodo.</p>') + '</section>';
    h += '<section><h2>Bitácora de residuos peligrosos (RPBI)</h2>' + (rpbi.recent && rpbi.recent.length ? '<table><thead><tr><th>Fecha</th><th>Manifiesto</th><th>Empresa</th><th>Kg</th></tr></thead><tbody>' + rpbi.recent.map(function (r) { return '<tr><td>' + esc(fmtDate(r.collected_at)) + '</td><td>' + esc(r.manifest) + '</td><td>' + esc(r.company || '') + '</td><td>' + esc(r.kg == null ? '' : r.kg) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p>Sin recolecciones en el periodo.</p>') + '</section>';
    h += '<section><h2>Actividad clínica del periodo</h2><table><tbody><tr><td>Citas atendidas</td><td>' + (act.visits || 0) + '</td></tr><tr><td>Notas de evolución firmadas</td><td>' + (act.signed_notes || 0) + '</td></tr><tr><td>Notas en borrador sin firmar</td><td>' + (act.draft_notes || 0) + '</td></tr><tr><td>Consentimientos informados firmados</td><td>' + (act.consents_signed || 0) + '</td></tr><tr><td>Procedimientos con verificación de seguridad</td><td>' + (act.verified_procedures || 0) + '</td></tr></tbody></table></section>';
    h += '<footer class="cp-r-foot"><div class="cp-r-sign"><span></span>Responsable sanitario</div><p>Este reporte resume los registros del consultorio en SMYL. No sustituye los documentos originales ni una asesoría sanitaria.</p></footer>';
    return h;
  }
  function printReport() {
    if (!state.data) return;
    var old = document.getElementById('cp-print-root'); if (old) old.remove();
    var root = el('div', 'cp-print-root'); root.id = 'cp-print-root'; root.innerHTML = reportHtml();
    document.body.append(root); document.body.classList.add('cp-printing');
    var done = function () { document.body.classList.remove('cp-printing'); root.remove(); win.removeEventListener('afterprint', done); };
    win.addEventListener('afterprint', done);
    setTimeout(function () { win.print(); }, 60);
  }

  function build() {
    var page = el('section', 'pantalla cp-page'); page.id = 'p-cumplimiento';
    var head = el('header', 'cp-head'), copy = el('div');
    copy.append(el('span', 'pro-eyebrow', 'CONFIGURACIÓN · CUENTA Y SEGURIDAD'), el('h1', '', 'Cumplimiento sanitario'), el('p', '', 'SMYL ordena lo que se hace una vez, lo que debes mantener y lo que ya se registra solo.'));
    var actions = el('div', 'cp-actions');
    var refresh = el('button', 'btn btn-secondary', 'Actualizar'); refresh.type = 'button'; refresh.onclick = function () { load(true); };
    var report = el('button', 'btn btn-secondary', 'Generar reporte'); report.type = 'button'; report.id = 'cp-report'; report.onclick = printReport;
    var assistant = el('button', 'btn btn-primary cp-mila', 'Preparar con MILA'); assistant.type = 'button'; assistant.onclick = askMila;
    actions.append(refresh, report, assistant); head.append(copy, actions); page.append(head);
    var content = el('div', 'cp-content'); content.id = 'cp-content'; content.setAttribute('aria-live', 'polite'); page.append(content);
    var host = document.querySelector('.contenido'); if (host) host.append(page);
  }

  function init() {
    if (!win.ir || document.getElementById('p-cumplimiento')) return;
    if (win.TITULOS) win.TITULOS.cumplimiento = 'Cumplimiento sanitario';
    build();
    var previous = win.ir;
    win.ir = function (route) { var result = previous.apply(this, arguments); if (route === 'cumplimiento') load(state.loaded); return result; };
  }
  if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', init); else init();
  return { load: load, render: render };
});
