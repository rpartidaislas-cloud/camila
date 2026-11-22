/* Verificación antes del procedimiento y registro de anestesia, dentro de la nota de evolución.
 *
 * Se agrega al formulario de la nota (smyl-patient-360.js · openNote) como un bloque opcional: «Esta nota incluye un
 * procedimiento». Si se activa, se guarda en `document.procedure` de la nota; al firmarla, la huella SHA-256 de la nota
 * lo cubre y ya no se modifica. No necesita migración: el documento de la nota es libre y la firma valida solo su texto.
 *
 * Dosis máximas: referencia habitual para adultos sanos (lidocaína 2% con epinefrina y articaína 4% con epinefrina,
 * 7 mg/kg hasta 500 mg; mepivacaína 3%, 6,6 mg/kg hasta 400 mg; cartucho de 1,8 ml). Es un aviso para el dentista,
 * no una orden: el registro refleja lo que se administró y la decisión clínica es del profesional.
 * NOM-004-SSA3-2012 y NOM-013-SSA2-2015 (puntos 8.13 y 9.3). */
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

  function agent(id) { return ANESTHETICS.filter(function (a) { return a.id === id; })[0] || null; }
  function num(value) {
    if (value === '' || value == null) return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }
  function round1(n) { return Math.round(n * 10) / 10; }

  // Dosis administrada frente al máximo recomendado por peso. level: ok | warn (desde 75%) | over | noweight | none
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

  // values: {tooth, siteConfirmed, allergiesReviewed, consentVerified, systolic, diastolic, anesthesia:{agent,cartridges}, weightKg}
  // opts: {requireBp} (paciente ASA II o más). Devuelve {error} o {value}.
  function build(values, opts) {
    var v = values || {}, o = opts || {};
    var tooth = String(v.tooth || '').trim().slice(0, 40);
    if (!tooth) return { error: 'Escribe la pieza o el sitio del procedimiento.' };
    if (!v.siteConfirmed) return { error: 'Confirma el sitio con el paciente antes de guardar.' };
    if (!v.allergiesReviewed) return { error: 'Confirma que revisaste las alergias del paciente.' };
    var bp = bpFrom(v.systolic, v.diastolic);
    if (bp === false) return { error: 'Revisa la presión arterial: la sistólica debe ser mayor que la diastólica.' };
    if (!bp && o.requireBp) return { error: 'Registra la presión arterial de hoy (el paciente es ASA II o más).' };
    var out = { v: 1, site: { tooth: tooth, confirmed: true }, checks: { allergies_reviewed: true, consent_verified: !!v.consentVerified } };
    if (bp) out.bp = bp;
    var an = v.anesthesia, a = an && agent(an.agent);
    if (a) {
      var d = dose(a.id, an.cartridges, v.weightKg);
      if (!d.cartridges) return { error: 'Indica cuántos cartuchos de anestesia se usaron.' };
      out.anesthesia = { agent: a.id, agent_label: a.label, cartridges: d.cartridges, mg: d.mg, max_mg: d.maxMg, weight_kg: num(v.weightKg) };
      if (d.level === 'over') out.anesthesia.over_max = true;
    }
    return { value: out };
  }

  function line(procedure) {
    if (!procedure || typeof procedure !== 'object') return '';
    var parts = [];
    if (procedure.site && procedure.site.tooth) parts.push('Sitio ' + procedure.site.tooth + ' confirmado');
    if (procedure.bp) parts.push('PA ' + procedure.bp.systolic + '/' + procedure.bp.diastolic);
    var an = procedure.anesthesia;
    if (an) parts.push((an.agent_label || an.agent) + ' · ' + an.cartridges + (an.cartridges === 1 ? ' cartucho' : ' cartuchos') + ' (' + an.mg + ' mg)' + (an.over_max ? ' · sobre el máximo' : ''));
    else parts.push('sin anestesia');
    return parts.join(' · ');
  }

  /* ------------------------------------------------------------- interfaz */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function fieldsetHtml(existing) {
    var an = existing && existing.anesthesia || {}, bp = existing && existing.bp || {};
    return '<fieldset class="p360-proc" data-proc>'
      + '<legend class="p360-proc-legend">Procedimiento</legend>'
      + '<label class="p360-proc-switch"><input type="checkbox" name="proc_on"' + (existing ? ' checked' : '') + '> <span><strong>Esta nota incluye un procedimiento</strong><small>Verificación de seguridad y anestesia. Queda firmado dentro de la nota.</small></span></label>'
      + '<div class="p360-proc-body" data-proc-body' + (existing ? '' : ' hidden') + '>'
      + '<div class="p360-proc-grid">'
      + '<label>Pieza o sitio<input name="proc_tooth" maxlength="40" placeholder="Ej. 36 o «cuadrante inferior izquierdo»" value="' + esc(existing && existing.site && existing.site.tooth) + '"></label>'
      + '<div class="p360-proc-bp"><span>Presión arterial de hoy</span><div><input type="number" name="proc_sys" inputmode="numeric" min="50" max="260" aria-label="Sistólica" value="' + esc(bp.systolic) + '"> / <input type="number" name="proc_dia" inputmode="numeric" min="30" max="160" aria-label="Diastólica" value="' + esc(bp.diastolic) + '"></div><small data-proc-bp-hint></small></div>'
      + '</div>'
      + '<div class="p360-proc-checks">'
      + '<label class="p360-proc-check is-key"><input type="checkbox" name="proc_site"' + (existing ? ' checked' : '') + '> <span><strong>Confirmé el sitio con el paciente</strong><small data-proc-site-text>Pieza y lado correctos antes de empezar.</small></span></label>'
      + '<label class="p360-proc-check"><input type="checkbox" name="proc_allergy"' + (existing ? ' checked' : '') + '> <span><strong>Revisé las alergias</strong><small data-proc-allergy-text>Consultando el expediente…</small></span></label>'
      + '<label class="p360-proc-check"><input type="checkbox" name="proc_consent"' + (existing && existing.checks && existing.checks.consent_verified ? ' checked' : '') + '> <span><strong>Hay consentimiento informado firmado</strong><small>Para este procedimiento (NOM-004 y NOM-013).</small></span></label>'
      + '</div>'
      + '<div class="p360-proc-anest"><span class="p360-proc-h">Anestesia</span>'
      + '<div class="p360-proc-pick" role="group" aria-label="Anestésico"><button type="button" data-an="none" aria-pressed="' + (an.agent ? 'false' : 'true') + '">Sin anestesia</button>'
      + ANESTHETICS.map(function (a) { return '<button type="button" data-an="' + a.id + '" aria-pressed="' + (an.agent === a.id ? 'true' : 'false') + '">' + esc(a.short) + '</button>'; }).join('')
      + '</div>'
      + '<div class="p360-proc-dose" data-proc-dose hidden><div class="p360-proc-stepper"><button type="button" data-proc-step="-1" aria-label="Menos cartuchos">−</button><output data-carts>' + esc(an.cartridges || 1) + '</output><button type="button" data-proc-step="1" aria-label="Más cartuchos">+</button></div>'
      + '<div class="p360-proc-dose-text" data-dose-text></div></div>'
      + '<div class="p360-proc-meter" data-meter aria-hidden="true" hidden><span></span></div>'
      + '<label class="p360-proc-weight" data-weight-box hidden>Peso del paciente (kg)<input type="number" name="proc_weight" step="0.1" min="1" max="400" inputmode="decimal" value="' + esc(an.weight_kg) + '"></label>'
      + '<p class="p360-proc-warn" data-dose-warn role="alert" hidden></p>'
      + '</div></div></fieldset>';
  }

  // Inserta el bloque en el formulario de la nota y lo conecta con el expediente del paciente.
  function enhance(form, info) {
    if (!form || form.querySelector('[data-proc]')) return;
    var i = info || {}, existing = i.existing && typeof i.existing === 'object' ? i.existing : null;
    var holder = document.createElement('div');
    holder.innerHTML = fieldsetHtml(existing);
    var box = holder.firstChild, actions = form.querySelector('.p360-actions');
    if (actions) actions.parentNode.insertBefore(box, actions); else form.append(box);
    var on = box.querySelector('[name=proc_on]'), body = box.querySelector('[data-proc-body]');
    var state = { agent: existing && existing.anesthesia ? existing.anesthesia.agent : 'none', carts: existing && existing.anesthesia ? existing.anesthesia.cartridges : 1, weight: existing && existing.anesthesia ? existing.anesthesia.weight_kg : null, requireBp: false, readonly: !!i.readonly };
    form.__procedure = state;
    on.onchange = function () { body.hidden = !on.checked; };

    function paint() {
      var dose$ = box.querySelector('[data-proc-dose]'), warn = box.querySelector('[data-dose-warn]'), meter = box.querySelector('[data-meter]'), weightBox = box.querySelector('[data-weight-box]');
      box.querySelectorAll('[data-an]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.an === state.agent)); });
      var has = state.agent !== 'none';
      dose$.hidden = !has; meter.hidden = !has;
      weightBox.hidden = !has || (state.weightFromRecord != null);
      warn.hidden = true;
      if (!has) return;
      box.querySelector('[data-carts]').textContent = String(state.carts);
      var w = state.weightFromRecord != null ? state.weightFromRecord : num(box.querySelector('[name=proc_weight]').value);
      var d = dose(state.agent, state.carts, w), text = box.querySelector('[data-dose-text]'), a = agent(state.agent);
      var head = '<strong>' + d.cartridges + (d.cartridges === 1 ? ' cartucho' : ' cartuchos') + ' · ' + d.mg + ' mg</strong>';
      text.innerHTML = head + '<br><small>' + (d.maxMg ? 'Máximo para ' + w + ' kg: ' + Math.round(d.maxMg) + ' mg' + (state.weightFromRecord != null ? ' (peso de los signos vitales)' : '') : 'Escribe el peso para calcular el máximo.') + '</small>';
      meter.dataset.level = d.level;
      meter.firstChild.style.width = Math.min(100, d.pct || 0) + '%';
      if (d.level === 'over') { warn.hidden = false; warn.textContent = 'Supera la dosis máxima recomendada para el peso del paciente (' + Math.round(d.maxMg) + ' mg de ' + a.short + '). Registra lo que realmente se administró.'; }
      else if (d.level === 'warn') { warn.hidden = false; warn.textContent = 'Cerca del máximo recomendado para el peso del paciente.'; }
      else if (d.level === 'noweight') { warn.hidden = false; warn.textContent = 'Sin peso no se puede calcular el máximo. Regístralo en «Signos vitales» o escríbelo aquí.'; }
    }
    box.querySelectorAll('[data-an]').forEach(function (b) { b.onclick = function () { state.agent = b.dataset.an; if (state.agent !== 'none' && !state.carts) state.carts = 1; paint(); }; });
    box.querySelectorAll('[data-proc-step]').forEach(function (b) { b.onclick = function () { state.carts = Math.max(1, Math.min(MAX_CARTRIDGES, state.carts + Number(b.dataset.procStep))); paint(); }; });
    box.querySelector('[name=proc_weight]').oninput = paint;
    paint();

    // Datos del expediente: alergias, presión y peso recientes, y riesgo médico del tratamiento activo.
    try {
      var ctx = window.SmylPatient360 && window.SmylPatient360.context && window.SmylPatient360.context(i.tenant, i.patient);
      var allergyText = box.querySelector('[data-proc-allergy-text]');
      if (ctx && ctx.allergies && ctx.allergies.length) allergyText.textContent = 'En el expediente: ' + ctx.allergies.map(function (a) { return a.substance || a.summary; }).filter(Boolean).slice(0, 4).join(', ') + '.';
      else if (ctx) allergyText.textContent = 'Sin alergias registradas en el expediente.';
      else allergyText.textContent = 'Revisa la historia clínica del paciente.';
    } catch (_) { /* el texto por defecto basta */ }
    var tr = window.SmylTreatments && window.SmylTreatments.current && window.SmylTreatments.current(i.patient);
    state.requireBp = !!(tr && (tr.asa === 'II' || tr.asa === 'III' || tr.asa === 'IV'));
    var hint = box.querySelector('[data-proc-bp-hint]');
    hint.textContent = state.requireBp ? 'Obligatoria: el paciente es ASA ' + tr.asa + '.' : 'Opcional si el paciente no es de riesgo.';
    if (window.sb && typeof window.sb.from === 'function' && i.tenant && i.patient) {
      Promise.resolve(window.sb.from('smyl_patient_vital_signs').select('measured_at,systolic,diastolic,weight_kg')
        .eq('tenant_id', i.tenant).eq('patient_id', i.patient).order('measured_at', { ascending: false }).limit(10)).then(function (res) {
        var rows = res && Array.isArray(res.data) ? res.data : [];
        if (!box.isConnected || !rows.length) return;
        var withW = rows.filter(function (r) { return r.weight_kg != null; })[0];
        if (withW) { state.weightFromRecord = Number(withW.weight_kg); paint(); }
        var withBp = rows.filter(function (r) { return r.systolic != null && r.diastolic != null; })[0];
        var sys = box.querySelector('[name=proc_sys]'), dia = box.querySelector('[name=proc_dia]');
        if (withBp && !sys.value && !dia.value) {
          var today = new Date().toDateString() === new Date(withBp.measured_at).toDateString();
          if (today) { sys.value = withBp.systolic; dia.value = withBp.diastolic; hint.textContent = 'Tomada hoy en Signos vitales.' + (state.requireBp ? ' Obligatoria: ASA ' + tr.asa + '.' : ''); }
          else hint.textContent = (state.requireBp ? 'Obligatoria: ASA ' + tr.asa + '. ' : '') + 'La última registrada es de otro día; mídela de nuevo.';
        }
      }).catch(function () { /* sin signos vitales: se captura a mano */ });
    }
  }

  // Lee el bloque al guardar la nota. null = la nota no incluye procedimiento. {error} = falta algo. {value} = listo.
  function collect(form) {
    var box = form && form.querySelector('[data-proc]');
    if (!box || !box.querySelector('[name=proc_on]').checked) return null;
    var st = form.__procedure || {}, q = function (n) { return box.querySelector('[name=' + n + ']'); };
    var weight = st.weightFromRecord != null ? st.weightFromRecord : num(q('proc_weight').value);
    return build({
      tooth: q('proc_tooth').value, siteConfirmed: q('proc_site').checked, allergiesReviewed: q('proc_allergy').checked,
      consentVerified: q('proc_consent').checked, systolic: q('proc_sys').value, diastolic: q('proc_dia').value,
      anesthesia: st.agent && st.agent !== 'none' ? { agent: st.agent, cartridges: st.carts } : null, weightKg: weight
    }, { requireBp: !!st.requireBp });
  }

  return { ANESTHETICS: ANESTHETICS, MAX_CARTRIDGES: MAX_CARTRIDGES, dose: dose, build: build, line: line, bpFrom: bpFrom, enhance: enhance, collect: collect };
});
