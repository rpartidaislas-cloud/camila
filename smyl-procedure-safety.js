/* Procedimiento: verificación de seguridad y registro de anestesia, en una pantalla propia (v2).
 *
 * Se abre desde tres lugares y es la MISMA pantalla: la herramienta «Procedimiento» de Consultorio y Agenda
 * (smyl-clinical-tools.js), el botón «Registrar procedimiento» de la pestaña Consulta del expediente y la etapa
 * «En tratamiento» del plan. Cuando nace de una aceptación, conserva decisión, concepto, capítulo, consentimiento y
 * nota en `smyl_procedure_executions`. La aceptación económica nunca equivale a trabajo clínico realizado: sólo la
 * firma profesional de la nota convierte la ejecución en completada.
 *
 * Tres tipos, para no pedir de más:
 *   - Sin anestesia: sitio y alergias. La presión es opcional.
 *   - Con anestesia: además el anestésico y los cartuchos. La presión es obligatoria si el paciente es ASA II o más.
 *   - Cirugía: la presión siempre.
 * Dosis máximas: referencia habitual para adultos sanos (lidocaína 2% y articaína 4% con epinefrina, 7 mg/kg hasta 500 mg;
 * mepivacaína 3%, 6,6 mg/kg hasta 400 mg; cartucho de 1,8 ml). Es un aviso: el registro refleja lo que se administró y la
 * decisión clínica es del profesional. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylProcedureSafety = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ANESTHETICS = [
    { id: 'lidocaine', label: 'Lidocaína 2% con epinefrina', short: 'Lidocaína 2%', mgPerCartridge: 36, maxMgPerKg: 7, maxMg: 500 },
    { id: 'articaine', label: 'Articaína 4% con epinefrina', short: 'Articaína 4%', mgPerCartridge: 72, maxMgPerKg: 7, maxMg: 500 },
    { id: 'mepivacaine', label: 'Mepivacaína 3% sin vasoconstrictor', short: 'Mepivacaína 3%', mgPerCartridge: 54, maxMgPerKg: 6.6, maxMg: 400 }
  ];
  var MAX_CARTRIDGES = 12;
  var TYPES = [['none', 'Sin anestesia'], ['anesthesia', 'Con anestesia'], ['surgery', 'Cirugía']];
  var AREAS = ['Cuadrante superior derecho', 'Cuadrante superior izquierdo', 'Cuadrante inferior derecho', 'Cuadrante inferior izquierdo', 'Arcada superior', 'Arcada inferior', 'Boca completa'];
  var TOOTH = '(?:[1-4][1-8]|[5-8][1-5])'; // permanentes 11–48 y temporales 51–85
  var TOOTH_LIST = new RegExp('^' + TOOTH + '(?:\\s*(?:,|;|/|-| y )\\s*' + TOOTH + ')*$', 'i');

  function agent(id) { return ANESTHETICS.filter(function (a) { return a.id === id; })[0] || null; }
  function num(value) {
    if (value === '' || value == null) return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }
  function round1(n) { return Math.round(n * 10) / 10; }

  // Dosis administrada frente al máximo por peso. level: ok | warn (desde 75%) | over | noweight | none
  function dose(agentId, cartridges, weightKg) {
    var a = agent(agentId), c = Math.max(0, Math.min(MAX_CARTRIDGES, Math.floor(num(cartridges) || 0)));
    if (!a || !c) return { level: 'none', mg: 0, maxMg: null, pct: 0, cartridges: c };
    var mg = round1(a.mgPerCartridge * c), w = num(weightKg);
    if (!w || w < 1 || w > 400) return { level: 'noweight', mg: mg, maxMg: null, pct: 0, cartridges: c };
    var maxMg = round1(Math.min(a.maxMgPerKg * w, a.maxMg)), pct = Math.round(mg / maxMg * 100);
    return { level: pct > 100 ? 'over' : pct >= 75 ? 'warn' : 'ok', mg: mg, maxMg: maxMg, pct: pct, cartridges: c };
  }

  function bpFrom(sys, dia) {
    var s = num(sys), d = num(dia);
    if (s == null && d == null) return null;
    if (s == null || d == null || s < 50 || s > 260 || d < 30 || d > 160 || d >= s) return false;
    return { systolic: Math.round(s), diastolic: Math.round(d) };
  }
  // Aviso (no bloqueo) por presión fuera de rango para atender.
  function bpAlert(bp) {
    if (!bp) return null;
    if (bp.systolic >= 180 || bp.diastolic >= 110) return { kind: 'high', text: 'Presión alta (' + bp.systolic + '/' + bp.diastolic + '). Valora diferir un procedimiento electivo y pide valoración médica.' };
    if (bp.systolic < 90 || bp.diastolic < 60) return { kind: 'low', text: 'Presión baja (' + bp.systolic + '/' + bp.diastolic + '). Valora al paciente antes de anestesiar.' };
    return null;
  }
  // Sitio: una o varias piezas FDI (11–48, o temporales 51–85) o una zona de la lista.
  function siteError(text) {
    var t = String(text || '').trim();
    if (!t) return 'Escribe la pieza o elige una zona.';
    if (TOOTH_LIST.test(t) || AREAS.indexOf(t) >= 0) return '';
    return 'Escribe piezas válidas (11 a 48, o 51 a 85 si son temporales), separadas por comas, o elige una zona.';
  }
  function needsBp(type, asa) {
    if (type === 'surgery') return true;
    return type === 'anesthesia' && (asa === 'II' || asa === 'III' || asa === 'IV');
  }

  // values: {type, tooth, siteConfirmed, siteAt, allergiesReviewed, consentVerified, systolic, diastolic, agent, cartridges, anesthesiaAt, weightKg}
  // opts: {asa}. Devuelve {error} o {value}.
  function build(values, opts) {
    var v = values || {}, o = opts || {}, type = ['none', 'anesthesia', 'surgery'].indexOf(v.type) >= 0 ? v.type : 'anesthesia';
    var bad = siteError(v.tooth);
    if (bad) return { error: bad };
    if (!v.siteConfirmed) return { error: 'Confirma el sitio con el paciente antes de guardar.' };
    if (!v.allergiesReviewed) return { error: 'Confirma que revisaste las alergias del paciente.' };
    if (type === 'surgery' && !v.consentVerified) return { error: 'Vincula un consentimiento informado vigente antes de registrar una cirugía.' };
    var bp = bpFrom(v.systolic, v.diastolic);
    if (bp === false) return { error: 'Revisa la presión arterial: la sistólica debe ser mayor que la diastólica.' };
    if (!bp && needsBp(type, o.asa)) return { error: type === 'surgery' ? 'En una cirugía se registra la presión arterial de hoy.' : 'Registra la presión arterial de hoy (el paciente es ASA ' + o.asa + ').' };
    var out = { v: 2, type: type, site: { tooth: String(v.tooth).trim().slice(0, 60), confirmed: true }, checks: { allergies_reviewed: true, consent_verified: !!v.consentVerified } };
    if (v.siteAt) out.site.at = v.siteAt;
    if (bp) { out.bp = { systolic: bp.systolic, diastolic: bp.diastolic }; var al = bpAlert(bp); if (al) out.bp.alert = al.kind; }
    var a = type === 'none' ? null : agent(v.agent);
    if (type === 'anesthesia' && !a) return { error: 'Elige el anestésico que se usó.' };
    if (a) {
      var d = dose(a.id, v.cartridges, v.weightKg);
      if (!d.cartridges) return { error: 'Indica cuántos cartuchos de anestesia se usaron.' };
      out.anesthesia = { agent: a.id, agent_label: a.label, cartridges: d.cartridges, mg: d.mg, max_mg: d.maxMg, weight_kg: num(v.weightKg) };
      if (d.level === 'over') out.anesthesia.over_max = true;
      if (v.anesthesiaAt) out.anesthesia.at = v.anesthesiaAt;
    }
    return { value: out };
  }

  function line(procedure) {
    if (!procedure || typeof procedure !== 'object') return '';
    var parts = [];
    if (procedure.site && procedure.site.tooth) parts.push('Sitio ' + procedure.site.tooth + ' confirmado');
    if (procedure.bp) parts.push('PA ' + procedure.bp.systolic + '/' + procedure.bp.diastolic + (procedure.bp.alert === 'high' ? ' (alta)' : procedure.bp.alert === 'low' ? ' (baja)' : ''));
    var an = procedure.anesthesia;
    if (an) parts.push((an.agent_label || an.agent) + ' · ' + an.cartridges + (an.cartridges === 1 ? ' cartucho' : ' cartuchos') + ' (' + an.mg + ' mg)' + (an.over_max ? ' · sobre el máximo' : ''));
    else parts.push('sin anestesia');
    return parts.join(' · ');
  }
  // Texto objetivo de la nota, ya redactado.
  function objectiveText(procedure) {
    var l = line(procedure);
    if (!l) return '';
    var head = procedure.type === 'surgery' ? 'Procedimiento quirúrgico. ' : 'Procedimiento. ';
    return head + l + '. Alergias revisadas' + (procedure.checks && procedure.checks.consent_verified ? '; consentimiento informado firmado' : '') + '.';
  }

  /* ------------------------------------------------------------- interfaz */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var active = null;

  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : null; }
  function rpc(name, args) { return Promise.resolve(window.sb.rpc(name, args)).then(function (res) { if (res && res.error) throw res.error; return res ? res.data : null; }); }
  function acceptedLabel(row) { var item = row && row.item_snapshot || {}; return String(item.label || item.name || 'Procedimiento aceptado'); }
  function acceptedTarget(row) {
    var item = row && row.item_snapshot || {}, teeth = Array.isArray(item.teeth) ? item.teeth : [], surfaces = Array.isArray(item.surfaces) ? item.surfaces : [];
    return teeth.length ? teeth.join(', ') + (surfaces.length ? ' · ' + surfaces.join(', ') : '') : String(item.area || '').trim();
  }
  function typeFor(row) { return /cirug|extracci|implante|injerto/.test(acceptedLabel(row).toLowerCase()) ? 'surgery' : 'anesthesia'; }
  function statusText(status) { return { accepted: 'Aceptado · por realizar', in_progress: 'Borrador pendiente de firma', deferred: 'Pospuesto', cancelled: 'Cancelado', completed: 'Completado y firmado' }[status] || 'Por revisar'; }

  function dialogHtml(st) {
    return '<form class="ps-form" novalidate>'
      + '<header class="ps-head"><div><span class="ps-kicker">PROCEDIMIENTO</span><h2 id="ps-title">' + esc(st.patientName || 'Paciente') + '</h2></div><button type="button" class="ps-x" data-ps-close aria-label="Cerrar">×</button></header>'
      + '<div class="ps-body">'
      + (st.execution ? '<section class="ps-accepted"><span>CONCEPTO ACEPTADO</span><strong>' + esc(acceptedLabel(st.execution)) + '</strong><small>' + esc(acceptedTarget(st.execution) || 'Sin pieza específica') + '</small></section>' : '')
      + '<div class="ps-type p360-proc-pick" role="group" aria-label="Tipo de procedimiento">' + TYPES.map(function (t) { return '<button type="button" data-ps-type="' + t[0] + '" aria-pressed="' + (st.type === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>'
      + '<section class="ps-sec"><h3><span>1</span> Sitio</h3>'
      + '<label class="ps-field">Pieza o zona<input data-ps="tooth" maxlength="60" autocomplete="off" placeholder="Ej. 36, o 16, 17" value="' + esc(st.tooth) + '"></label>'
      + '<div class="ps-areas" data-ps-areas hidden>' + AREAS.map(function (a) { return '<button type="button" data-ps-area="' + esc(a) + '">' + esc(a) + '</button>'; }).join('') + '</div>'
      + '<button type="button" class="ps-link" data-ps-areas-toggle>Otra zona (cuadrante, arcada, boca completa)</button>'
      + '<label class="p360-proc-check is-key"><input type="checkbox" data-ps="site"> <span><strong>Confirmé el sitio con el paciente</strong><small>Pieza y lado correctos antes de empezar.</small></span></label></section>'
      + '<section class="ps-sec"><h3><span>2</span> Seguridad</h3>'
      + '<label class="p360-proc-check"><input type="checkbox" data-ps="allergy"> <span><strong>Revisé las alergias</strong><small data-ps-allergy-text>Consultando el expediente…</small></span></label>'
      + '<label class="ps-field">Consentimiento informado<select data-ps="consent"><option value="">No vinculado</option></select><small data-ps-consent-help>Se mostrarán únicamente documentos vigentes de este paciente.</small></label>'
      + '<div class="p360-proc-bp"><span>Presión arterial de hoy</span><div><input type="number" data-ps="sys" inputmode="numeric" min="50" max="260" aria-label="Sistólica"> / <input type="number" data-ps="dia" inputmode="numeric" min="30" max="160" aria-label="Diastólica"></div><small data-ps-bp-hint></small></div>'
      + '<p class="p360-proc-warn" data-ps-bp-alert role="alert" hidden></p></section>'
      + '<section class="ps-sec" data-ps-anest><h3><span>3</span> Anestesia</h3>'
      + '<div class="p360-proc-pick" role="group" aria-label="Anestésico">' + ANESTHETICS.map(function (a) { return '<button type="button" data-an="' + a.id + '" aria-pressed="false">' + esc(a.short) + '</button>'; }).join('') + '</div>'
      + '<div class="p360-proc-dose" data-proc-dose hidden><div class="p360-proc-stepper"><button type="button" data-ps-step="-1" aria-label="Menos cartuchos">−</button><output data-carts>1</output><button type="button" data-ps-step="1" aria-label="Más cartuchos">+</button></div><div class="p360-proc-dose-text" data-dose-text></div></div>'
      + '<div class="p360-proc-meter" data-meter aria-hidden="true" hidden><span></span></div>'
      + '<label class="p360-proc-weight" data-weight-box hidden>Peso del paciente (kg)<input type="number" data-ps="weight" step="0.1" min="1" max="400" inputmode="decimal"></label>'
      + '<p class="p360-proc-warn" data-dose-warn role="alert" hidden></p></section>'
      + '<section class="ps-sec"><h3><span data-ps-n4>4</span> Qué se hizo e indicaciones</h3>'
      + '<label class="ps-field">Se usará en la nota<textarea data-ps="did" maxlength="2000" rows="3" placeholder="Ej. Se realizó la apertura cameral. Indicaciones entregadas por WhatsApp."></textarea></label>'
      + '<p class="ps-hint">Para firmar la nota hace falta esta descripción; puedes completarla después.</p></section>'
      + '</div>'
      + '<p class="ps-error" data-ps-error role="alert" hidden></p>'
      + '<footer class="ps-foot"><button type="button" class="btn btn-secondary" data-ps-close>Cancelar</button><button type="submit" class="btn btn-primary" data-ps-save>Guardar como borrador de nota</button></footer>'
      + '</form>';
  }

  function open(opts) {
    var o = opts || {};
    if (!o.tenant || !o.patient) return false;
    if (active) { try { active.dialog.close(); } catch (_) { /* ya cerrado */ } }
    var st = { tenant: o.tenant, patient: o.patient, patientName: o.patientName || '', appointmentId: o.appointmentId || null, execution: o.execution || null, type: o.execution ? typeFor(o.execution) : 'anesthesia', tooth: o.plannedTooth || (o.execution ? acceptedTarget(o.execution).split(' · ')[0] : ''), agent: 'none', carts: 1, weightFromRecord: null, asa: null, siteAt: null, anesthesiaAt: null, busy: false, saved: false, consentId: null };
    var dialog = document.createElement('dialog');
    dialog.className = 'ps-dialog';
    dialog.setAttribute('aria-labelledby', 'ps-title');
    dialog.innerHTML = dialogHtml(st);
    st.dialog = dialog; active = st;
    document.body.append(dialog);
    var form = dialog.querySelector('form'), q = function (n) { return dialog.querySelector('[data-ps="' + n + '"]'); };

    function close() { try { dialog.close(); } catch (_) { /* ya cerrado */ } }
    dialog.addEventListener('close', function () { dialog.remove(); if (active === st) active = null; }, { once: true });
    dialog.querySelectorAll('[data-ps-close]').forEach(function (b) { b.onclick = close; });
    function showError(text) { var e = dialog.querySelector('[data-ps-error]'); e.hidden = !text; e.textContent = text || ''; if (text) e.scrollIntoView({ block: 'nearest' }); }

    function paint() {
      dialog.querySelectorAll('[data-ps-type]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.psType === st.type)); });
      var anest = dialog.querySelector('[data-ps-anest]'), has = st.agent !== 'none', hint = dialog.querySelector('[data-ps-bp-hint]');
      anest.hidden = st.type === 'none';
      dialog.querySelector('[data-ps-n4]').textContent = st.type === 'none' ? '3' : '4';
      hint.textContent = needsBp(st.type, st.asa) ? (st.type === 'surgery' ? 'Obligatoria en una cirugía.' : 'Obligatoria: el paciente es ASA ' + st.asa + '.') : 'Opcional si el paciente no es de riesgo.';
      dialog.querySelectorAll('[data-an]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.an === st.agent)); });
      var dose$ = dialog.querySelector('[data-proc-dose]'), warn = dialog.querySelector('[data-dose-warn]'), meter = dialog.querySelector('[data-meter]'), weightBox = dialog.querySelector('[data-weight-box]');
      dose$.hidden = !has || st.type === 'none'; meter.hidden = dose$.hidden; weightBox.hidden = dose$.hidden || st.weightFromRecord != null; warn.hidden = true;
      if (!dose$.hidden) {
        dialog.querySelector('[data-carts]').textContent = String(st.carts);
        var w = st.weightFromRecord != null ? st.weightFromRecord : num(q('weight').value), d = dose(st.agent, st.carts, w), a = agent(st.agent);
        dialog.querySelector('[data-dose-text]').innerHTML = '<strong>' + d.cartridges + (d.cartridges === 1 ? ' cartucho' : ' cartuchos') + ' · ' + d.mg + ' mg</strong><br><small>' + (d.maxMg ? 'Máximo para ' + w + ' kg: ' + Math.round(d.maxMg) + ' mg' + (st.weightFromRecord != null ? ' (peso de los signos vitales)' : '') : 'Escribe el peso para calcular el máximo.') + '</small>';
        meter.dataset.level = d.level; meter.firstChild.style.width = Math.min(100, d.pct || 0) + '%';
        if (d.level === 'over') { warn.hidden = false; warn.textContent = 'Supera la dosis máxima recomendada para el peso del paciente (' + Math.round(d.maxMg) + ' mg de ' + a.short + '). Registra lo que realmente se administró.'; }
        else if (d.level === 'warn') { warn.hidden = false; warn.textContent = 'Cerca del máximo recomendado para el peso del paciente.'; }
        else if (d.level === 'noweight') { warn.hidden = false; warn.textContent = 'Sin peso no se puede calcular el máximo. Regístralo en «Signos vitales» o escríbelo aquí.'; }
      }
      var bp = bpFrom(q('sys').value, q('dia').value), al = bpAlert(bp), bpWarn = dialog.querySelector('[data-ps-bp-alert]');
      bpWarn.hidden = !al; bpWarn.textContent = al ? al.text : '';
    }

    dialog.querySelectorAll('[data-ps-type]').forEach(function (b) { b.onclick = function () { st.type = b.dataset.psType; if (st.type === 'none') st.agent = 'none'; paint(); }; });
    q('tooth').oninput = function () { st.tooth = this.value; };
    dialog.querySelector('[data-ps-areas-toggle]').onclick = function () { var box = dialog.querySelector('[data-ps-areas]'); box.hidden = !box.hidden; };
    dialog.querySelectorAll('[data-ps-area]').forEach(function (b) { b.onclick = function () { q('tooth').value = b.dataset.psArea; st.tooth = b.dataset.psArea; }; });
    q('site').onchange = function () { st.siteAt = this.checked ? new Date().toISOString() : null; };
    dialog.querySelectorAll('[data-an]').forEach(function (b) { b.onclick = function () { st.agent = b.dataset.an; st.anesthesiaAt = new Date().toISOString(); paint(); }; });
    dialog.querySelectorAll('[data-ps-step]').forEach(function (b) { b.onclick = function () { st.carts = Math.max(1, Math.min(MAX_CARTRIDGES, st.carts + Number(b.dataset.psStep))); st.anesthesiaAt = new Date().toISOString(); paint(); }; });
    q('weight').oninput = paint; q('sys').oninput = paint; q('dia').oninput = paint;
    dialog.querySelector('.ps-body').addEventListener('click', function () { showError(''); });
    dialog.querySelector('.ps-body').addEventListener('input', function () { showError(''); });
    paint();

    // Datos del expediente: alergias, riesgo médico del tratamiento activo, presión y peso recientes.
    var allergyText = dialog.querySelector('[data-ps-allergy-text]');
    function allergies(tries) {
      try {
        var ctx = window.SmylPatient360 && window.SmylPatient360.context && window.SmylPatient360.context(st.tenant, st.patient);
        if (ctx) { allergyText.textContent = ctx.allergies && ctx.allergies.length ? 'En el expediente: ' + ctx.allergies.map(function (a) { return a.substance || a.summary; }).filter(Boolean).slice(0, 4).join(', ') + '.' : 'Sin alergias registradas en el expediente.'; return; }
      } catch (_) { /* reintenta */ }
      if (tries > 0 && dialog.isConnected) setTimeout(function () { allergies(tries - 1); }, 600); else allergyText.textContent = 'Revisa la historia clínica del paciente.';
    }
    allergies(4);
    var consent = q('consent'), consentHelp = dialog.querySelector('[data-ps-consent-help]');
    if (window.sb && typeof window.sb.rpc === 'function') {
      rpc('smyl_list_informed_consents', { p_patient_id: st.patient }).then(function (rows) {
        rows = Array.isArray(rows) ? rows.filter(function (row) { return !row.revoked_at; }) : [];
        rows.forEach(function (row) { var option = document.createElement('option'); option.value = row.id; option.textContent = row.procedure_title + ' · ' + new Date(row.signed_at).toLocaleDateString('es-MX'); consent.append(option); });
        consentHelp.textContent = rows.length ? rows.length + (rows.length === 1 ? ' documento vigente disponible.' : ' documentos vigentes disponibles.') : 'No hay documentos vigentes. Crea el consentimiento desde Historia clínica.';
      }).catch(function () { consentHelp.textContent = 'No se pudieron consultar los consentimientos; no se marcará como verificado.'; });
    }
    consent.onchange = function () { st.consentId = this.value || null; showError(''); };
    if (window.sb && typeof window.sb.rpc === 'function') {
      Promise.resolve(window.sb.rpc('smyl_list_treatments', { p_patient_id: st.patient })).then(function (res) {
        var list = res && Array.isArray(res.data) ? res.data : [], act = list.filter(function (t) { return t.status === 'active'; })[0];
        if (act && dialog.isConnected) { st.asa = act.asa || null; paint(); }
      }).catch(function () { /* sin tratamientos: el ASA no obliga la presión */ });
    }
    if (window.sb && typeof window.sb.from === 'function') {
      Promise.resolve(window.sb.from('smyl_patient_vital_signs').select('measured_at,systolic,diastolic,weight_kg').eq('tenant_id', st.tenant).eq('patient_id', st.patient).order('measured_at', { ascending: false }).limit(10)).then(function (res) {
        var rows = res && Array.isArray(res.data) ? res.data : [];
        if (!dialog.isConnected || !rows.length) return;
        var withW = rows.filter(function (r) { return r.weight_kg != null; })[0];
        if (withW) { st.weightFromRecord = Number(withW.weight_kg); }
        var withBp = rows.filter(function (r) { return r.systolic != null && r.diastolic != null; })[0], hint = dialog.querySelector('[data-ps-bp-hint]');
        if (withBp && !q('sys').value && !q('dia').value && new Date().toDateString() === new Date(withBp.measured_at).toDateString()) { q('sys').value = withBp.systolic; q('dia').value = withBp.diastolic; paint(); hint.textContent += ' Tomada hoy en Signos vitales.'; }
        else paint();
      }).catch(function () { /* se captura a mano */ });
    }

    form.onsubmit = async function (e) {
      e.preventDefault();
      if (st.busy) return;
      showError('');
      var built = build({
        type: st.type, tooth: st.tooth, siteConfirmed: q('site').checked, siteAt: st.siteAt, allergiesReviewed: q('allergy').checked, consentVerified: !!st.consentId,
        systolic: q('sys').value, diastolic: q('dia').value, agent: st.agent, cartridges: st.carts, anesthesiaAt: st.anesthesiaAt,
        weightKg: st.weightFromRecord != null ? st.weightFromRecord : num(q('weight').value)
      }, { asa: st.asa });
      if (built.error) { showError(built.error); return; }
      var proc = built.value; proc.saved_at = new Date().toISOString();
      st.busy = true;
      var save = dialog.querySelector('[data-ps-save]'); save.disabled = true; save.textContent = 'Guardando…';
      try {
        var professional = null;
        try {
          var actor = window.miUsuario && window.miUsuario.id;
          if (actor) {
            var r = await window.sb.from('smyl_professionals').select('id').eq('tenant_id', st.tenant).eq('user_id', actor).eq('active', true).limit(1);
            professional = r && Array.isArray(r.data) && r.data[0] ? r.data[0].id : null;
          }
        } catch (_) { professional = null; }
        var doc = { subjective: '', objective: objectiveText(proc), assessment: '', diagnosis: '', diagnosis_code: '', prognosis: '', plan: String(q('did').value || '').trim(), procedure: proc };
        var noteId = uuid(), saved;
        if (st.execution) saved = await rpc('smyl_create_procedure_note_v1', { p_execution_id: st.execution.id, p_note_id: noteId, p_appointment_id: st.appointmentId, p_professional_id: professional, p_informed_consent_id: st.consentId, p_document: doc });
        else saved = await rpc('smyl_create_clinical_note', { p_id: noteId, p_patient_id: st.patient, p_appointment_id: st.appointmentId, p_professional_id: professional, p_note_type: 'procedure', p_document: doc });
        st.saved = true;
        success(dialog, st, proc);
        window.dispatchEvent(new CustomEvent('smyl:clinical-note-created', { detail: { tenant: st.tenant, patient: st.patient, noteId: noteId, procedureExecutionId: st.execution && st.execution.id } }));
        window.dispatchEvent(new CustomEvent('smyl:procedure-execution-updated', { detail: { tenant: st.tenant, patient: st.patient, treatmentId: st.execution && st.execution.treatment_id } }));
        if (typeof o.onSaved === 'function') { try { o.onSaved(proc, saved); } catch (_) { /* no afecta al guardado */ } }
      } catch (error) {
        st.busy = false; save.disabled = false; save.textContent = 'Guardar como borrador de nota';
        showError((error && error.message) || 'No se pudo guardar el procedimiento. Inténtalo de nuevo.');
      }
    };
    dialog.addEventListener('cancel', function () { /* Esc cierra */ });
    dialog.showModal();
    q('tooth').focus();
    return true;
  }

  function success(dialog, st, proc) {
    var f = dialog.querySelector('form');
    f.innerHTML = '<header class="ps-head"><div><span class="ps-kicker">LISTO</span><h2 id="ps-title">Procedimiento registrado</h2></div><button type="button" class="ps-x" data-ps-close aria-label="Cerrar">×</button></header>'
      + '<div class="ps-body"><p class="ps-done">' + esc(line(proc)) + '</p><p class="ps-hint">Quedó como <strong>borrador clínico enlazado</strong>. El procedimiento seguirá “en curso” hasta que el profesional revise y firme la nota.</p></div>'
      + '<footer class="ps-foot"><button type="button" class="btn btn-secondary" data-ps-close>Cerrar</button><button type="button" class="btn btn-primary" data-ps-go>Ir a firmar la nota</button></footer>';
    f.querySelectorAll('[data-ps-close]').forEach(function (b) { b.onclick = function () { dialog.close(); }; });
    f.querySelector('[data-ps-go]').onclick = async function () {
      dialog.close();
      try {
        var current = window.pacienteActual && window.pacienteActual.id === st.patient;
        if (typeof window.verPaciente === 'function') await window.verPaciente(st.patient);
        setTimeout(function () { if (window.SmylPatient360 && window.SmylPatient360.open) window.SmylPatient360.open('visits'); }, current ? 500 : 1200);
      } catch (_) { /* el usuario puede abrir el expediente a mano */ }
    };
    f.querySelector('[data-ps-go]').focus();
  }

  async function executions(opts, write) {
    if (!opts || !opts.patient || !opts.treatmentId || !window.sb) return [];
    var name = write === false ? 'smyl_list_procedure_executions_v1' : 'smyl_sync_procedure_executions_v1';
    var rows = await rpc(name, { p_patient_id: opts.patient, p_treatment_id: opts.treatmentId });
    return Array.isArray(rows) ? rows : [];
  }

  function goNotes() {
    try { if (window.SmylPatient360 && window.SmylPatient360.open) window.SmylPatient360.open('visits'); }
    catch (_) { /* conserva la pantalla actual */ }
  }

  async function openNext(opts) {
    try {
      var rows = await executions(opts, opts.canWrite !== false);
      var row = rows.filter(function (item) { return item.status === 'accepted'; })[0] || rows.filter(function (item) { return item.status === 'deferred'; })[0];
      if (row && row.status === 'deferred' && opts.canWrite !== false) {
        await rpc('smyl_set_procedure_execution_status_v1', { p_execution_id: row.id, p_expected_revision: row.revision, p_status: 'accepted', p_reason: '' });
        row.status = 'accepted';
        row.revision += 1;
      }
      if (row) return open(Object.assign({}, opts, { execution: row }));
      if (rows.some(function (item) { return item.status === 'in_progress'; })) { goNotes(); return true; }
    } catch (_) { /* el registro libre sigue disponible si el backend aún no está activo */ }
    return open(opts);
  }

  function renderAccepted(host, opts) {
    if (!host || !opts || !opts.treatmentId) { if (host) host.hidden = true; return Promise.resolve([]); }
    host.hidden = false; host.replaceChildren(); host.setAttribute('aria-busy', 'true');
    var loading = document.createElement('p'); loading.className = 'cw-procedure-loading'; loading.textContent = 'Consultando procedimientos aceptados…'; host.append(loading);
    return executions(opts, opts.canWrite !== false).then(function (rows) {
      if (!host.isConnected) return rows;
      host.replaceChildren(); host.removeAttribute('aria-busy');
      var head = document.createElement('header'), copy = document.createElement('div');
      copy.innerHTML = '<span class="cw-kicker">PROCEDIMIENTOS ACEPTADOS</span><strong>Del presupuesto a la atención</strong><p>Cada concepto conserva su decisión, nota y estado clínico.</p>';
      var counter = document.createElement('span'); counter.className = 'cw-procedure-counter'; counter.textContent = rows.filter(function (r) { return r.status === 'completed'; }).length + ' de ' + rows.length + ' completados'; head.append(copy, counter); host.append(head);
      if (!rows.length) { var empty = document.createElement('p'); empty.className = 'cw-procedure-empty'; empty.textContent = 'Todavía no hay conceptos aceptados para este capítulo.'; host.append(empty); return rows; }
      var list = document.createElement('div'); list.className = 'cw-procedure-list';
      rows.forEach(function (row) {
        var card = document.createElement('article'); card.className = 'cw-procedure-card'; card.dataset.state = row.status;
        var marker = document.createElement('span'); marker.className = 'cw-procedure-marker'; marker.textContent = row.status === 'completed' ? '✓' : row.status === 'cancelled' ? '×' : '•';
        var info = document.createElement('div'); info.className = 'cw-procedure-copy'; var title = document.createElement('strong'); title.textContent = acceptedLabel(row); var target = document.createElement('p'); target.textContent = acceptedTarget(row) || 'Sin pieza específica'; var state = document.createElement('small'); state.textContent = statusText(row.status) + (row.status_reason ? ' · ' + row.status_reason : ''); info.append(title, target, state);
        var action = document.createElement('button'); action.type = 'button'; action.className = row.status === 'accepted' ? 'btn btn-primary' : 'btn btn-secondary';
        if (row.status === 'accepted' || row.status === 'deferred') {
          action.textContent = row.status === 'deferred' ? 'Reactivar y registrar' : 'Registrar'; action.disabled = opts.canWrite === false;
          action.onclick = function () {
            if (row.status === 'deferred') rpc('smyl_set_procedure_execution_status_v1', { p_execution_id: row.id, p_expected_revision: row.revision, p_status: 'accepted', p_reason: '' }).then(function (updated) { open(Object.assign({}, opts, { execution: updated })); }).catch(function (error) { alert(error.message || 'No se pudo reactivar.'); });
            else open(Object.assign({}, opts, { execution: row }));
          };
        } else if (row.status === 'in_progress') { action.textContent = 'Revisar y firmar'; action.onclick = goNotes; }
        else { action.textContent = row.status === 'completed' ? 'Ver nota' : 'Sin acción'; action.disabled = row.status === 'cancelled'; action.onclick = goNotes; }
        card.append(marker, info, action); list.append(card);
      });
      host.append(list); return rows;
    }).catch(function (error) {
      if (!host.isConnected) return [];
      host.removeAttribute('aria-busy'); host.replaceChildren(); var note = document.createElement('p'); note.className = 'cw-procedure-error'; note.textContent = (error && error.message) || 'No se pudieron consultar los procedimientos aceptados.'; host.append(note); return [];
    });
  }

  return {
    ANESTHETICS: ANESTHETICS, MAX_CARTRIDGES: MAX_CARTRIDGES, TYPES: TYPES, AREAS: AREAS,
    dose: dose, build: build, line: line, objectiveText: objectiveText, bpFrom: bpFrom, bpAlert: bpAlert, siteError: siteError, needsBp: needsBp,
    open: open, openNext: openNext, renderAccepted: renderAccepted, executions: executions,
    acceptedLabel: acceptedLabel, acceptedTarget: acceptedTarget, statusText: statusText
  };
});
