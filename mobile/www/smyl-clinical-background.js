/* SMYL · Antecedentes y exploración (NOM-004-SSA3-2012 6.1; NOM-013-SSA2-2015).
 * Sección de la historia clínica con: ficha de identificación complementaria (domicilio y CURP), antecedentes
 * heredofamiliares, interrogatorio por aparatos y sistemas, embarazo/lactancia, exploración de tejidos blandos y ATM,
 * y un registro fechado de signos vitales. Lee con RLS (clinical.read) y escribe solo con funciones de la base.
 * Todo texto entra escapado. Las reglas puras (FAMILY, SYSTEMS, summary, validateVitals) se prueban en Node. */
(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.SmylClinicalBackground = api; })(globalThis, function () {
  'use strict';
  var FAMILY = [['diabetes', 'Diabetes'], ['hypertension', 'Hipertensión'], ['heart', 'Cardiopatías'], ['cancer', 'Cáncer'], ['bleeding', 'Trastornos de coagulación'], ['psychiatric', 'Enfermedades mentales'], ['other', 'Otros']];
  var SYSTEMS = [['cardiovascular', 'Cardiovascular'], ['respiratory', 'Respiratorio'], ['digestive', 'Digestivo'], ['renal', 'Renal y urinario'], ['endocrine', 'Endocrino'], ['hematologic', 'Hematológico'], ['neurologic', 'Neurológico'], ['musculoskeletal', 'Musculoesquelético'], ['skin', 'Piel y mucosas']];
  var SOFT = [['lips', 'Labios'], ['cheeks', 'Carrillos'], ['tongue', 'Lengua'], ['palate', 'Paladar'], ['floor', 'Piso de boca'], ['gums', 'Encías'], ['salivary', 'Glándulas salivales']];
  var VITALS = [['systolic', 'Sistólica', 'mmHg', 50, 260], ['diastolic', 'Diastólica', 'mmHg', 30, 160], ['heart_rate', 'Frecuencia cardiaca', 'lpm', 20, 250], ['respiratory_rate', 'Frecuencia respiratoria', 'rpm', 4, 80], ['temperature', 'Temperatura', '°C', 30, 45], ['weight_kg', 'Peso', 'kg', 1, 400], ['height_cm', 'Talla', 'cm', 30, 250]];
  var CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}[0-9]{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z][0-9]$/;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function fmtDate(v) { try { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v)); } catch (e) { return String(v); } }

  /** Líneas de lectura de una sección de mapa {clave: texto}. */
  function mapLines(obj, catalog) { obj = obj || {}; return catalog.filter(function (c) { return txt(obj[c[0]]); }).map(function (c) { return c[1] + ': ' + txt(obj[c[0]]); }); }
  function summary(doc, patient) {
    doc = doc || {}; patient = patient || {};
    var rows = [];
    rows.push(['Domicilio', txt(patient.domicilio) ? [txt(patient.domicilio)] : []]);
    rows.push(['CURP', txt(patient.curp) ? [txt(patient.curp)] : []]);
    rows.push(['Heredofamiliares', mapLines(doc.family_history, FAMILY).concat(txt(doc.family_notes) ? [txt(doc.family_notes)] : [])]);
    rows.push(['Aparatos y sistemas', mapLines(doc.systems_review, SYSTEMS)]);
    var gyn = [];
    if (txt(doc.pregnancy)) gyn.push('Embarazo: ' + txt(doc.pregnancy));
    if (txt(doc.lactation)) gyn.push('Lactancia: ' + txt(doc.lactation));
    if (txt(doc.gyneco)) gyn.push(txt(doc.gyneco));
    rows.push(['Gineco-obstétricos', gyn]);
    rows.push(['Tejidos blandos', mapLines(doc.soft_tissue, SOFT)]);
    rows.push(['ATM', txt(doc.tmj) ? [txt(doc.tmj)] : []]);
    return rows;
  }
  function validateVitals(v) {
    var any = false;
    for (var i = 0; i < VITALS.length; i++) {
      var raw = txt(v[VITALS[i][0]]); if (!raw) continue; any = true;
      var n = Number(raw.replace(',', '.'));
      if (!isFinite(n) || n < VITALS[i][3] || n > VITALS[i][4]) return VITALS[i][1] + ' fuera de rango (' + VITALS[i][3] + '–' + VITALS[i][4] + ' ' + VITALS[i][2] + ').';
    }
    return any ? '' : 'Registra al menos un signo vital.';
  }
  function vitalsLine(r) {
    var parts = [];
    if (r.systolic || r.diastolic) parts.push('TA ' + (r.systolic || '—') + '/' + (r.diastolic || '—') + ' mmHg');
    if (r.heart_rate) parts.push('FC ' + r.heart_rate + ' lpm');
    if (r.respiratory_rate) parts.push('FR ' + r.respiratory_rate + ' rpm');
    if (r.temperature) parts.push(r.temperature + ' °C');
    if (r.weight_kg) parts.push(r.weight_kg + ' kg');
    if (r.height_cm) parts.push(r.height_cm + ' cm');
    return parts.join(' · ');
  }

  function render(o, data, number) {
    var rows = summary(data.doc, data.patient).map(function (r) {
      return '<div class="p360-hc-row" data-state="' + (r[1].length ? 'ok' : 'pending') + '"><dt>' + esc(r[0]) + '</dt><dd class="p360-hc-v">' + (r[1].length ? r[1].map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') : '<span>Sin registrar</span>') + '</dd><dd class="p360-hc-st"></dd></div>';
    }).join('');
    var vitals = data.vitals === null ? '<p class="ic-empty">No se pudieron consultar los signos vitales.</p>'
      : !data.vitals.length ? '<p class="ic-empty">Sin signos vitales registrados.</p>'
      : '<ul class="ic-list">' + data.vitals.slice(0, 5).map(function (r) { return '<li><div><b>' + esc(vitalsLine(r)) + '</b><small>' + esc(fmtDate(r.measured_at)) + (r.notes ? ' · ' + esc(r.notes) : '') + '</small></div></li>'; }).join('') + '</ul>';
    return '<section class="p360-hc-band" id="p360-hc-background" data-tone="background" tabindex="-1" aria-labelledby="p360-hc-background-t">'
      + '<header class="p360-hc-band-h"><div class="p360-hc-title"><span class="p360-hc-num" aria-hidden="true">' + Number(number) + '</span><div><h3 id="p360-hc-background-t">Antecedentes y exploración</h3><small>Heredofamiliares, aparatos y sistemas, tejidos blandos, signos vitales y ficha de identificación.</small></div></div>'
      + (o.canAct ? '<div class="pp-actions"><button type="button" class="p360-hc-edit" data-bg-edit>Editar</button><button type="button" class="p360-hc-edit" data-bg-vitals>Registrar signos vitales</button></div>' : '') + '</header>'
      + '<dl class="p360-hc-rows">' + rows + '</dl><div class="bg-vitals-h">Signos vitales</div>' + vitals + '</section>';
  }

  /* ── Navegador ── */
  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function errText(err) {
    var msg = String(err && err.message || ''), code = err && err.code;
    if (/PGRST20|42883|42P01|schema cache|does not exist/i.test(code + ' ' + msg)) return 'Falta aplicar la migración de antecedentes en la base de datos.';
    return msg || 'No se pudo guardar. Intenta de nuevo.';
  }
  function fieldGroup(title, catalog, values, prefix) {
    values = values || {};
    return '<fieldset class="rx-item"><legend>' + esc(title) + '</legend><div class="rx-grid">' + catalog.map(function (c) { return '<label>' + esc(c[1]) + '<input name="' + prefix + c[0] + '" maxlength="1000" value="' + esc(values[c[0]] || '') + '"></label>'; }).join('') + '</div></fieldset>';
  }

  function openEdit(o, data) {
    var doc = document, d = doc.createElement('dialog'); d.className = 'ic-dialog'; var cur = data.doc || {}, pt = data.patient || {};
    d.innerHTML = '<form class="ic-box"><header><h2>Antecedentes y exploración</h2><button type="button" class="ic-x" aria-label="Cerrar">×</button></header>'
      + '<p class="ic-help">Escribe «Negado» cuando el paciente lo niegue; deja en blanco lo que no se ha preguntado.</p>'
      + '<fieldset class="rx-item"><legend>Ficha de identificación</legend><div class="rx-grid"><label class="rx-wide">Domicilio<input name="domicilio" maxlength="300" value="' + esc(pt.domicilio || '') + '"></label><label>CURP<input name="curp" maxlength="18" value="' + esc(pt.curp || '') + '" style="text-transform:uppercase"></label></div></fieldset>'
      + fieldGroup('Antecedentes heredofamiliares', FAMILY, cur.family_history, 'fh_')
      + fieldGroup('Interrogatorio por aparatos y sistemas', SYSTEMS, cur.systems_review, 'sr_')
      + '<fieldset class="rx-item"><legend>Gineco-obstétricos (si aplica)</legend><div class="rx-grid"><label>Embarazo<input name="pregnancy" maxlength="200" value="' + esc(cur.pregnancy || '') + '" placeholder="No / Sí, semanas"></label><label>Lactancia<input name="lactation" maxlength="200" value="' + esc(cur.lactation || '') + '"></label><label class="rx-wide">Otros<input name="gyneco" maxlength="1000" value="' + esc(cur.gyneco || '') + '"></label></div></fieldset>'
      + fieldGroup('Exploración de tejidos blandos', SOFT, cur.soft_tissue, 'st_')
      + '<label>Articulación temporomandibular (ATM)<input name="tmj" maxlength="1000" value="' + esc(cur.tmj || '') + '"></label>'
      + '<p class="ic-feedback" role="status"></p><div class="ic-actions"><button type="button" class="btn btn-secondary ic-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div></form>';
    doc.body.append(d);
    var form = d.querySelector('form'), feedback = d.querySelector('.ic-feedback');
    function close() { try { d.close(); } catch (e) {} d.remove(); }
    d.querySelector('.ic-x').onclick = close; d.querySelector('.ic-cancel').onclick = close;
    form.addEventListener('input', function () { feedback.textContent = ''; });
    form.onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(form), curp = txt(f.get('curp')).toUpperCase();
      if (curp && !CURP_RE.test(curp)) { feedback.textContent = 'La CURP no tiene un formato válido (18 caracteres).'; return; }
      function pick(prefix, catalog) { var out = {}; catalog.forEach(function (c) { var v = txt(f.get(prefix + c[0])); if (v) out[c[0]] = v; }); return out; }
      var next = { family_history: pick('fh_', FAMILY), systems_review: pick('sr_', SYSTEMS), soft_tissue: pick('st_', SOFT), pregnancy: txt(f.get('pregnancy')), lactation: txt(f.get('lactation')), gyneco: txt(f.get('gyneco')), tmj: txt(f.get('tmj')) };
      var submit = form.querySelector('[type=submit]'); submit.disabled = true;
      try {
        if (txt(f.get('domicilio')) !== txt(pt.domicilio) || curp !== txt(pt.curp)) await q(globalThis.sb.rpc('smyl_set_patient_identification', { p_patient_id: o.patient, p_domicilio: txt(f.get('domicilio')), p_curp: curp }));
        await q(globalThis.sb.rpc('smyl_save_clinical_background', { p_patient_id: o.patient, p_expected_revision: data.revision || 0, p_document: next }));
        close(); o.refresh();
      } catch (err) { feedback.textContent = errText(err); submit.disabled = false; }
    };
    d.showModal();
  }

  function openVitals(o) {
    var doc = document, d = doc.createElement('dialog'); d.className = 'ic-dialog';
    d.innerHTML = '<form class="ic-box"><header><h2>Signos vitales</h2><button type="button" class="ic-x" aria-label="Cerrar">×</button></header><div class="rx-grid">'
      + VITALS.map(function (v) { return '<label>' + esc(v[1]) + ' (' + esc(v[2]) + ')<input name="' + v[0] + '" inputmode="decimal" maxlength="6"></label>'; }).join('')
      + '<label class="rx-wide">Notas (opcional)<input name="notes" maxlength="500"></label></div>'
      + '<p class="ic-feedback" role="status"></p><div class="ic-actions"><button type="button" class="btn btn-secondary ic-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Guardar medición</button></div></form>';
    doc.body.append(d);
    var form = d.querySelector('form'), feedback = d.querySelector('.ic-feedback');
    function close() { try { d.close(); } catch (e) {} d.remove(); }
    d.querySelector('.ic-x').onclick = close; d.querySelector('.ic-cancel').onclick = close;
    form.addEventListener('input', function () { feedback.textContent = ''; });
    form.onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(form), values = {};
      VITALS.forEach(function (v) { var raw = txt(f.get(v[0])).replace(',', '.'); if (raw) values[v[0]] = raw; });
      var problem = validateVitals(values); if (problem) { feedback.textContent = problem; return; }
      if (txt(f.get('notes'))) values.notes = txt(f.get('notes'));
      try { await q(globalThis.sb.rpc('smyl_add_vital_signs', { p_patient_id: o.patient, p_measured_at: new Date().toISOString(), p_values: values })); close(); o.refresh(); }
      catch (err) { feedback.textContent = errText(err); }
    };
    d.showModal();
  }

  function mount(o) {
    var doc = globalThis.document, sb = globalThis.sb;
    if (!o || !o.host || !sb || !doc) return Promise.resolve(false);
    var host = o.host, main = host.querySelector('.p360-hc-main'), index = host.querySelector('.p360-hc-index');
    if (!main || !index) return Promise.resolve(false);
    o.refresh = function () { var b = host.querySelector('#p360-hc-background'), g = host.querySelector('[data-hc-goto="background"]'); if (b) b.remove(); if (g) g.remove(); mount(o); };
    return Promise.all([
      q(sb.from('smyl_patient_clinical_background').select('document,revision').eq('tenant_id', o.tenant).eq('patient_id', o.patient).maybeSingle()).catch(function () { return undefined; }),
      q(sb.from('smyl_patient_vital_signs').select('measured_at,systolic,diastolic,heart_rate,respiratory_rate,temperature,weight_kg,height_cm,notes').eq('tenant_id', o.tenant).eq('patient_id', o.patient).order('measured_at', { ascending: false }).limit(20)).catch(function () { return null; }),
      q(sb.from('camila_pacientes').select('domicilio,curp').eq('tenant_id', o.tenant).eq('id', o.patient).maybeSingle()).catch(function () { return {}; })
    ]).then(function (res) {
      if (o.isCurrent && !o.isCurrent()) return false;
      if (res[0] === undefined && res[1] === null) return false; // la migración aún no está aplicada: no se muestra la sección
      if (!host.isConnected || host.querySelector('#p360-hc-background')) return false;
      var data = { doc: res[0] && res[0].document || {}, revision: res[0] ? res[0].revision : 0, vitals: res[1], patient: res[2] || {} };
      var number = host.querySelectorAll('.p360-hc-band').length + 1, tpl = doc.createElement('template');
      tpl.innerHTML = render(o, data, number);
      main.insertBefore(tpl.content, main.querySelector('.p360-hc-footer') || null);
      var itpl = doc.createElement('template');
      itpl.innerHTML = '<button type="button" data-hc-goto="background"><span class="p360-hc-dot" data-state="neutral" aria-hidden="true"></span>' + number + ' · Antecedentes</button>';
      index.insertBefore(itpl.content, index.querySelector('.p360-hc-progress') || null);
      var band = host.querySelector('#p360-hc-background');
      index.querySelector('[data-hc-goto="background"]').onclick = function () { band.scrollIntoView({ block: 'start' }); band.focus({ preventScroll: true }); };
      var edit = band.querySelector('[data-bg-edit]'); if (edit) edit.onclick = function () { openEdit(o, data); };
      var vit = band.querySelector('[data-bg-vitals]'); if (vit) vit.onclick = function () { openVitals(o); };
      return true;
    });
  }

  return { FAMILY: FAMILY, SYSTEMS: SYSTEMS, SOFT: SOFT, VITALS: VITALS, CURP_RE: CURP_RE, summary: summary, validateVitals: validateVitals, vitalsLine: vitalsLine, render: render, mount: mount, esc: esc };
});
