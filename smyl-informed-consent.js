/* SMYL · Consentimiento informado por procedimiento (NOM-004-SSA3-2012).
 * Sección «Consentimientos informados» en la historia clínica del paciente: lista los firmados y permite recabar uno
 * nuevo desde una plantilla editable (procedimiento, beneficios, riesgos, alternativas, cuidados). El paciente firma en
 * pantalla; el profesional confirma su identidad (SmylAuthGuard.reauthenticate) y el servidor guarda su nombre y cédula.
 * Las plantillas son un punto de partida: el profesional debe adaptarlas al caso. Todo texto entra escapado. */
(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.SmylInformedConsent = api; })(globalThis, function () {
  'use strict';

  var ANESTESIA = 'Anestesia local: puede causar adormecimiento prolongado, hematoma o dolor en el sitio de punción y, en raras ocasiones, reacciones alérgicas o lesión transitoria de un nervio.';
  var TEMPLATES = [
    { key: 'profilaxis', title: 'Limpieza dental (profilaxis y destartraje)',
      description: 'Remoción de placa y sarro de las superficies de los dientes con instrumentos manuales o ultrasónicos y pulido final.',
      benefits: 'Disminuir la inflamación de las encías, el sangrado y el riesgo de caries y enfermedad periodontal.',
      risks: 'Sensibilidad dental temporal, sangrado leve de encías, molestia durante o después del procedimiento.',
      alternatives: 'No realizar el procedimiento (con riesgo de progresión de la enfermedad de las encías) o tratamiento periodontal más amplio si el profesional lo indica.',
      care: 'Cepillado suave y uso de hilo dental; evitar alimentos muy fríos o calientes si hay sensibilidad.' },
    { key: 'resina', title: 'Restauración con resina',
      description: 'Remoción del tejido dental afectado y reconstrucción del diente con resina del color del diente.',
      benefits: 'Recuperar la forma y la función del diente y detener el avance del daño.',
      risks: ANESTESIA + ' Sensibilidad postoperatoria, necesidad de ajuste de la mordida, desgaste o fractura de la restauración con el tiempo y, si el daño era profundo, posible necesidad de tratamiento de conductos.',
      alternatives: 'Restauración con otro material (amalgama, incrustación o corona) o no tratar (con riesgo de que el daño avance).',
      care: 'Evitar morder objetos duros; acudir si persiste el dolor o la mordida se siente alta.' },
    { key: 'endodoncia', title: 'Tratamiento de conductos (endodoncia)',
      description: 'Limpieza, desinfección y sellado de los conductos internos del diente.',
      benefits: 'Conservar el diente y eliminar el dolor o la infección de su interior.',
      risks: ANESTESIA + ' Dolor o inflamación posterior, fractura de instrumentos dentro del conducto, perforación, persistencia de la infección que requiera retratamiento o cirugía, y fractura del diente si no se restaura adecuadamente.',
      alternatives: 'Extracción del diente y, en su caso, reposición con prótesis o implante; o no tratar (con riesgo de infección y pérdida del diente).',
      care: 'No masticar con ese lado hasta la restauración definitiva; tomar solo los medicamentos que indique el profesional.' },
    { key: 'extraccion', title: 'Extracción dental',
      description: 'Retiro del diente indicado, con o sin cirugía según su posición.',
      benefits: 'Eliminar una fuente de dolor, infección o problema que no puede resolverse conservando el diente.',
      risks: ANESTESIA + ' Sangrado, inflamación, dolor, infección o alveolitis, lesión de dientes vecinos, fractura de la raíz o del hueso, comunicación con el seno maxilar en dientes superiores y alteración de la sensibilidad del labio o la lengua.',
      alternatives: 'Tratamiento para conservar el diente cuando sea posible o no realizar la extracción (con riesgo de que el problema avance).',
      care: 'Morder la gasa, no enjuagar ni escupir con fuerza las primeras 24 horas, no fumar y seguir las indicaciones por escrito.' },
    { key: 'carillas', title: 'Carillas dentales',
      description: 'Preparación mínima de la cara visible de los dientes y colocación de carillas de resina o cerámica.',
      benefits: 'Mejorar el color, la forma y la armonía de la sonrisa.',
      risks: ANESTESIA + ' Sensibilidad, desgaste irreversible de esmalte, fractura o despegado de la carilla, diferencias de color con dientes vecinos e inflamación de encías. La simulación o el diseño previo son orientativos y no garantizan un resultado idéntico.',
      alternatives: 'Blanqueamiento, restauraciones con resina, ortodoncia o no realizar el tratamiento.',
      care: 'Evitar morder objetos duros, usar guarda si lo indica el profesional y acudir a revisiones.' },
    { key: 'blanqueamiento', title: 'Blanqueamiento dental',
      description: 'Aplicación de un gel aclarador sobre los dientes en el consultorio o con guardas en casa.',
      benefits: 'Aclarar el color de los dientes naturales.',
      risks: 'Sensibilidad dental temporal, irritación de encías y resultados variables según cada persona. No cambia el color de resinas, carillas o coronas.',
      alternatives: 'Carillas, restauraciones estéticas o no realizar el tratamiento.',
      care: 'Evitar alimentos y bebidas con pigmento (café, vino, refrescos de cola) durante el tiempo indicado.' },
    { key: 'implante', title: 'Colocación de implante dental',
      description: 'Colocación quirúrgica de un implante en el hueso para reponer un diente, que después llevará una corona.',
      benefits: 'Reponer un diente perdido sin desgastar dientes vecinos.',
      risks: ANESTESIA + ' Dolor, inflamación, sangrado e infección; falta de integración del implante, lesión de nervios con alteración de la sensibilidad, comunicación con el seno maxilar y necesidad de injertos o de repetir la cirugía.',
      alternatives: 'Puente fijo, prótesis removible o no reponer el diente.',
      care: 'Dieta blanda, no fumar, higiene cuidadosa y asistir a todas las revisiones.' },
    { key: 'ortodoncia', title: 'Tratamiento de ortodoncia',
      description: 'Movimiento de los dientes con brackets o alineadores durante el tiempo que indique el profesional.',
      benefits: 'Mejorar la posición de los dientes, la mordida y la estética.',
      risks: 'Molestias, llagas, manchas o caries si la higiene es deficiente, reabsorción de raíces, recidiva sin retenedores y duración mayor a la estimada.',
      alternatives: 'Tratamientos estéticos sin movimiento dental o no realizar el tratamiento.',
      care: 'Higiene cuidadosa, evitar alimentos duros o pegajosos y usar los retenedores indicados.' },
    { key: 'custom', title: 'Otro procedimiento', description: '', benefits: '', risks: '', alternatives: '', care: '' }
  ];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function template(key) { return TEMPLATES.find(function (t) { return t.key === key; }) || TEMPLATES[TEMPLATES.length - 1]; }

  /** Texto completo que el paciente lee y firma (se guarda tal cual, con su huella). */
  function compose(f) {
    var lines = [
      'CONSENTIMIENTO INFORMADO',
      'Procedimiento: ' + f.title,
      'Clínica: ' + (f.clinic || '—'),
      'Paciente: ' + f.patient + (f.relation === 'guardian' ? ' · Firma su tutor o representante: ' + f.signer : ''),
      'Fecha: ' + f.date,
      '',
      'En qué consiste: ' + f.description,
      'Beneficios esperados: ' + f.benefits,
      'Riesgos y posibles complicaciones: ' + f.risks,
      'Alternativas: ' + f.alternatives,
      'Cuidados posteriores: ' + (f.care || 'Los que indique el profesional.'),
      ''
    ];
    if (f.notes) lines.push('Información particular de este caso: ' + f.notes, '');
    lines.push('Declaro que el profesional me explicó en lenguaje claro en qué consiste el procedimiento, sus beneficios, riesgos y alternativas; que pude hacer preguntas y fueron respondidas; y que autorizo su realización de forma libre. Sé que puedo revocar este consentimiento en cualquier momento antes del procedimiento.');
    lines.push('Este documento forma parte de mi expediente clínico conforme a la NOM-004-SSA3-2012.');
    return lines.join('\n');
  }

  function validate(f) {
    if (!f.title || f.title.trim().length < 3) return 'Escribe el nombre del procedimiento.';
    var required = [['description', 'en qué consiste'], ['benefits', 'los beneficios'], ['risks', 'los riesgos'], ['alternatives', 'las alternativas']];
    for (var i = 0; i < required.length; i++) if (!f[required[i][0]] || f[required[i][0]].trim().length < 10) return 'Describe ' + required[i][1] + '.';
    if (!f.signer || f.signer.trim().length < 2) return 'Escribe el nombre de quien firma.';
    if (!f.explained) return 'Confirma que explicaste el procedimiento y resolviste las dudas.';
    if (!f.inked) return 'Falta la firma del paciente.';
    return '';
  }

  /* ── Navegador ── */
  function fmtDate(v) { try { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v)); } catch (e) { return String(v); } }

  function signaturePad(canvas) {
    var ctx = canvas.getContext('2d'), drawing = false, inked = false, last = null;
    function size() { var r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1; canvas.width = Math.max(1, r.width * d); canvas.height = Math.max(1, r.height * d); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a'; }
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener('pointerdown', function (e) { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
    canvas.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; inked = true; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { canvas.addEventListener(n, function () { drawing = false; }); });
    requestAnimationFrame(size);
    return {
      inked: function () { return inked; },
      clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); inked = false; },
      png: function () { var out = document.createElement('canvas'); out.width = 600; out.height = 200; var c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 600, 200); c.drawImage(canvas, 0, 0, 600, 200); return out.toDataURL('image/png'); }
    };
  }

  function rpc(name, args) { return globalThis.sb.rpc(name, args).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function errText(err) {
    var msg = String(err && err.message || ''), code = err && err.code;
    if (/PGRST202|42883|schema cache/i.test(code + ' ' + msg)) return 'Falta aplicar la migración de consentimiento informado en la base de datos.';
    return msg || 'No se pudo completar. Intenta de nuevo.';
  }

  function printConsent(row) {
    var w = window.open('', '_blank', 'noopener=no');
    if (!w) { window.alert('Permite las ventanas emergentes para imprimir el consentimiento.'); return; }
    var html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Consentimiento informado</title><style>body{font:13px/1.55 Georgia,serif;color:#111;max-width:720px;margin:32px auto;padding:0 20px}pre{white-space:pre-wrap;font:inherit}.firmas{display:flex;gap:32px;margin-top:28px;flex-wrap:wrap}.firmas div{flex:1;min-width:240px;border-top:1px solid #333;padding-top:6px}img{max-width:260px;display:block}small{color:#555}</style></head><body>'
      + '<pre>' + esc(row.document_text) + '</pre>'
      + '<div class="firmas"><div><img src="' + esc(row.signature_png) + '" alt="Firma"><b>' + esc(row.signer_name) + '</b><br><small>' + (row.signer_relation === 'guardian' ? 'Tutor o representante' : 'Paciente') + ' · ' + esc(fmtDate(row.signed_at)) + '</small></div>'
      + '<div><b>' + esc(row.professional_name) + '</b><br><small>Cédula profesional ' + esc(row.professional_license) + ' · Informó y recabó el consentimiento</small></div></div>'
      + (row.revoked_at ? '<p><b>Revocado</b> el ' + esc(fmtDate(row.revoked_at)) + ': ' + esc(row.revoked_reason) + '</p>' : '')
      + '<p><small>Huella del documento (SHA-256): ' + esc(row.document_sha256) + '</small></p></body></html>';
    w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
  }

  function openNew(o) {
    var doc = document, d = doc.createElement('dialog'); d.className = 'ic-dialog';
    var patient = (globalThis.pacienteActual || {}), patientName = [patient.nombre, patient.apellido].filter(Boolean).join(' ') || 'Paciente';
    var clinic = (globalThis.tenantData && (globalThis.tenantData.nombre || globalThis.tenantData.nombre_consultorio)) || '';
    d.innerHTML = '<form class="ic-box"><header><h2>Nuevo consentimiento informado</h2><button type="button" class="ic-x" aria-label="Cerrar">×</button></header>'
      + '<p class="ic-help">Elige una plantilla y adáptala a este caso. El paciente debe leerla completa antes de firmar.</p>'
      + '<label>Procedimiento<select name="tpl">' + TEMPLATES.map(function (t) { return '<option value="' + t.key + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>'
      + '<label>Nombre del procedimiento<input name="title" maxlength="160" required></label>'
      + '<label>En qué consiste<textarea name="description" rows="2"></textarea></label>'
      + '<label>Beneficios esperados<textarea name="benefits" rows="2"></textarea></label>'
      + '<label>Riesgos y posibles complicaciones<textarea name="risks" rows="4"></textarea></label>'
      + '<label>Alternativas<textarea name="alternatives" rows="2"></textarea></label>'
      + '<label>Cuidados posteriores<textarea name="care" rows="2"></textarea></label>'
      + '<label>Información particular de este caso (opcional)<textarea name="notes" rows="2" maxlength="2000"></textarea></label>'
      + '<div class="ic-row"><label>Firma<select name="relation"><option value="patient">El paciente</option><option value="guardian">Su tutor o representante</option></select></label><label>Nombre de quien firma<input name="signer" maxlength="150" required></label></div>'
      + '<label class="ic-check"><input type="checkbox" name="explained"> Expliqué el procedimiento, sus riesgos y alternativas, y resolví las dudas del paciente.</label>'
      + '<div class="ic-pad"><canvas aria-label="Espacio para la firma del paciente" role="img"></canvas><button type="button" class="ic-clear">Borrar firma</button></div>'
      + '<p class="ic-feedback" role="status"></p>'
      + '<div class="ic-actions"><button type="button" class="btn btn-secondary ic-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Firmar como profesional y guardar</button></div></form>';
    doc.body.append(d);
    var form = d.querySelector('form'), feedback = d.querySelector('.ic-feedback'), pad = signaturePad(d.querySelector('canvas'));
    form.signer.value = patientName;
    function fill(key) { var t = template(key); form.title.value = t.key === 'custom' ? '' : t.title; ['description', 'benefits', 'risks', 'alternatives', 'care'].forEach(function (k) { form[k].value = t[k]; }); }
    fill(TEMPLATES[0].key);
    form.tpl.onchange = function () { fill(form.tpl.value); };
    form.relation.onchange = function () { if (form.relation.value === 'patient') form.signer.value = patientName; else if (form.signer.value === patientName) form.signer.value = ''; };
    function close() { try { d.close(); } catch (e) {} d.remove(); }
    d.querySelector('.ic-x').onclick = close; d.querySelector('.ic-cancel').onclick = close;
    d.querySelector('.ic-clear').onclick = function () { pad.clear(); };
    d.querySelector('canvas').addEventListener('pointerdown', function () { feedback.textContent = ''; });
    form.onsubmit = async function (e) {
      e.preventDefault();
      var f = { title: form.title.value.trim(), description: form.description.value.trim(), benefits: form.benefits.value.trim(), risks: form.risks.value.trim(), alternatives: form.alternatives.value.trim(), care: form.care.value.trim(), notes: form.notes.value.trim(), relation: form.relation.value, signer: form.signer.value.trim(), explained: form.explained.checked, inked: pad.inked(), patient: patientName, clinic: clinic, date: fmtDate(new Date()) };
      var problem = validate(f); if (problem) { feedback.textContent = problem; return; }
      var submit = form.querySelector('[type=submit]'); submit.disabled = true; feedback.textContent = '';
      try {
        if (globalThis.SmylAuthGuard && !(await globalThis.SmylAuthGuard.reauthenticate(globalThis.sb, 'firmar el consentimiento'))) { submit.disabled = false; return; }
        await rpc('smyl_record_informed_consent', { p_patient_id: o.patient, p_template_key: form.tpl.value, p_procedure_title: f.title, p_document_text: compose(f), p_signer_name: f.signer, p_signer_relation: f.relation, p_signature_png: pad.png() });
        close(); if (o.refresh) o.refresh();
      } catch (err) { feedback.textContent = errText(err); submit.disabled = false; }
    };
    d.showModal();
  }

  function render(rows, number, canAct) {
    var list = rows === null ? '<p class="ic-empty">No se pudieron consultar los consentimientos.</p>'
      : !rows.length ? '<p class="ic-empty">Aún no hay consentimientos informados. Recaba uno antes de cada procedimiento que lo requiera.</p>'
      : '<ul class="ic-list">' + rows.map(function (r) {
        return '<li data-state="' + (r.revoked_at ? 'revoked' : 'ok') + '"><div><b>' + esc(r.procedure_title) + '</b><small>Firmó ' + esc(r.signer_name) + (r.signer_relation === 'guardian' ? ' (tutor)' : '') + ' · ' + esc(fmtDate(r.signed_at)) + ' · Informó ' + esc(r.professional_name) + ' (Céd. ' + esc(r.professional_license) + ')' + (r.revoked_at ? ' · Revocado' : '') + '</small></div>'
          + '<div class="ic-li-acts"><button type="button" class="p360-hc-edit" data-ic-print="' + esc(r.id) + '">Ver e imprimir</button>' + (canAct && !r.revoked_at ? '<button type="button" class="p360-hc-edit" data-ic-revoke="' + esc(r.id) + '">Revocar</button>' : '') + '</div></li>';
      }).join('') + '</ul>';
    return '<section class="p360-hc-band" id="p360-hc-consents" data-tone="consents" tabindex="-1" aria-labelledby="p360-hc-consents-t">'
      + '<header class="p360-hc-band-h"><div class="p360-hc-title"><span class="p360-hc-num" aria-hidden="true">' + Number(number) + '</span><div><h3 id="p360-hc-consents-t">Consentimientos informados</h3><small>Por procedimiento, firmados por el paciente y el profesional.</small></div></div>'
      + (canAct ? '<div class="pp-actions"><button type="button" class="p360-hc-edit" data-ic-new>Nuevo consentimiento</button></div>' : '') + '</header>' + list + '</section>';
  }

  function mount(o) {
    var doc = globalThis.document;
    if (!o || !o.host || !globalThis.sb || !doc) return Promise.resolve(false);
    var host = o.host, main = host.querySelector('.p360-hc-main'), index = host.querySelector('.p360-hc-index');
    if (!main || !index) return Promise.resolve(false);
    o.refresh = function () { var b = host.querySelector('#p360-hc-consents'), g = host.querySelector('[data-hc-goto="consents"]'); if (b) b.remove(); if (g) g.remove(); mount(o); };
    return rpc('smyl_list_informed_consents', { p_patient_id: o.patient }).catch(function () { return null; }).then(function (rows) {
      if (o.isCurrent && !o.isCurrent()) return false;
      if (!host.isConnected || host.querySelector('#p360-hc-consents')) return false;
      var number = host.querySelectorAll('.p360-hc-band').length + 1, tpl = doc.createElement('template');
      tpl.innerHTML = render(rows, number, !!o.canAct);
      main.insertBefore(tpl.content, main.querySelector('.p360-hc-footer') || null);
      var itpl = doc.createElement('template');
      itpl.innerHTML = '<button type="button" data-hc-goto="consents"><span class="p360-hc-dot" data-state="' + (rows && rows.length ? 'ok' : 'neutral') + '" aria-hidden="true"></span>' + number + ' · Consentimientos</button>';
      index.insertBefore(itpl.content, index.querySelector('.p360-hc-progress') || null);
      var band = host.querySelector('#p360-hc-consents');
      index.querySelector('[data-hc-goto="consents"]').onclick = function () { band.scrollIntoView({ block: 'start' }); band.focus({ preventScroll: true }); };
      var add = band.querySelector('[data-ic-new]'); if (add) add.onclick = function () { openNew(o); };
      band.querySelectorAll('[data-ic-print]').forEach(function (b) { b.onclick = function () { rpc('smyl_get_informed_consent', { p_id: b.dataset.icPrint }).then(printConsent, function (e) { window.alert(errText(e)); }); }; });
      band.querySelectorAll('[data-ic-revoke]').forEach(function (b) { b.onclick = function () { var reason = window.prompt('¿Por qué se revoca este consentimiento? (por ejemplo: el paciente decidió no realizarse el procedimiento)'); if (!reason) return; rpc('smyl_revoke_informed_consent', { p_id: b.dataset.icRevoke, p_reason: reason }).then(o.refresh, function (e) { window.alert(errText(e)); }); }; });
      return true;
    });
  }

  return { TEMPLATES: TEMPLATES, compose: compose, validate: validate, render: render, mount: mount, esc: esc };
});
