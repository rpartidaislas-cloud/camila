/* Alta de datos fiscales del paciente (cliente de facturación): captura a mano o desde la Constancia de Situación Fiscal.
 * Con la constancia, la IA (función fiscal-extract) solo SUGIERE: la persona revisa y guarda. El archivo no se almacena.
 * Las reglas del SAT viven en smyl-fiscal-rules.js. Guarda en smyl_patient_fiscal_profiles (la misma tabla que usa la ficha 360). */
(function () {
  'use strict';
  var MAX_BYTES = 4 * 1024 * 1024;
  var TYPES = { 'application/pdf': 1, 'image/jpeg': 1, 'image/png': 1 };

  function esc(value) { return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rules() { return window.SmylFiscalRules; }

  function readBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '').split(',')[1] || ''); };
      reader.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
      reader.readAsDataURL(file);
    });
  }
  async function extract(file) {
    var res = await window.sb.functions.invoke('fiscal-extract', { body: { file_base64: await readBase64(file), media_type: file.type } });
    var data = res && res.data, err = res && res.error;
    if (err && err.context && typeof err.context.json === 'function') { try { data = await err.context.json(); } catch (e) {} }
    if (!data || data.error) throw new Error((data && data.error) || 'No se pudo leer la constancia. Captura los datos a mano.');
    return data;
  }

  function regimenOptions(tipo, selected) {
    return '<option value="">Elige el régimen</option>' + rules().regimenesParaTipo(tipo).map(function (r) {
      return '<option value="' + r.code + '"' + (r.code === selected ? ' selected' : '') + '>' + r.code + ' · ' + esc(r.name) + '</option>';
    }).join('');
  }
  function usoOptions(regimen, rfc, selected) {
    return rules().usosParaRegimen(regimen, rfc).map(function (u) {
      return '<option value="' + u.code + '"' + (u.code === selected ? ' selected' : '') + '>' + u.code + ' · ' + esc(u.label) + '</option>';
    }).join('');
  }

  function open(options) {
    options = options || {};
    var R = rules(), current = options.current || {};
    if (!R || !window.sb) { if (typeof options.onError === 'function') options.onError('El módulo de datos fiscales todavía está cargando.'); return null; }
    var old = document.getElementById('fiscal-capture-dialog'); if (old) old.remove();
    var d = document.createElement('dialog'); d.id = 'fiscal-capture-dialog'; d.className = 'fiscal-capture';
    d.innerHTML = '<form novalidate><header><span>FACTURACIÓN</span><h2>Datos fiscales de ' + esc(options.patientName || 'el paciente') + '</h2><p>Se guardan como cliente de facturación y se usan para preparar su CFDI 4.0.</p></header>' +
      '<section class="fiscal-capture-upload"><div><strong>¿Tiene su constancia de situación fiscal?</strong><small>Súbela (PDF, JPG o PNG, máx. 4 MB) y la IA llena los datos. Tú los revisas antes de guardar. El archivo no se guarda.</small></div><label class="btn btn-secondary">Subir constancia<input type="file" name="constancia" accept="application/pdf,image/jpeg,image/png" hidden></label></section>' +
      '<p class="fiscal-capture-status" data-fiscal-status role="status" aria-live="polite"></p>' +
      '<div class="fiscal-capture-grid">' +
      '<label>RFC<input name="rfc" maxlength="13" autocomplete="off" value="' + esc(current.rfc || '') + '"><small data-err="rfc"></small></label>' +
      '<label>Código postal fiscal<input name="tax_postal_code" maxlength="5" inputmode="numeric" autocomplete="off" value="' + esc(current.tax_postal_code || '') + '"><small data-err="tax_postal_code"></small></label>' +
      '<label class="wide">Nombre o razón social (como en la constancia)<input name="legal_name" maxlength="240" autocomplete="off" value="' + esc(current.legal_name || '') + '"><small data-err="legal_name"></small></label>' +
      '<label class="wide">Régimen fiscal<select name="fiscal_regime"></select><small data-err="fiscal_regime"></small></label>' +
      '<label class="wide">Uso de la factura<select name="cfdi_use"></select><small data-err="cfdi_use"></small></label>' +
      '<label class="wide">Correo para enviar la factura<input name="email" type="email" maxlength="254" autocomplete="off" value="' + esc(current.email || '') + '"><small data-err="email"></small></label>' +
      '</div><ul class="fiscal-capture-notes" data-fiscal-notes></ul>' +
      '<p class="fiscal-capture-help">El SAT valida RFC, nombre, régimen y código postal contra su padrón al timbrar. Si un dato no coincide con la constancia, la factura se rechaza.</p>' +
      '<footer><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="submit" class="btn btn-primary" data-fiscal-save>Guardar datos fiscales</button></footer></form>';
    document.body.append(d);
    var form = d.querySelector('form'), status = d.querySelector('[data-fiscal-status]'), touched = {}, busy = false;

    function say(text, tone) { status.textContent = text || ''; status.dataset.tone = tone || ''; }
    function values() {
      return { rfc: form.elements.rfc.value, legal_name: form.elements.legal_name.value, fiscal_regime: form.elements.fiscal_regime.value, tax_postal_code: form.elements.tax_postal_code.value, cfdi_use: form.elements.cfdi_use.value, email: form.elements.email.value };
    }
    // Los menús dependen del RFC (física/moral) y del régimen; se reconstruyen conservando lo elegido mientras siga siendo válido.
    function refreshMenus(prefer) {
      prefer = prefer || {};
      var rfc = R.normalizarRfc(form.elements.rfc.value), tipo = R.tipoPersona(rfc);
      var regimen = prefer.regimen !== undefined ? prefer.regimen : form.elements.fiscal_regime.value;
      if (!R.regimenesParaTipo(tipo).some(function (r) { return r.code === regimen; })) regimen = '';
      form.elements.fiscal_regime.innerHTML = regimenOptions(tipo, regimen);
      var uso = prefer.uso !== undefined ? prefer.uso : form.elements.cfdi_use.value;
      var usos = R.usosParaRegimen(regimen, rfc);
      if (!usos.some(function (u) { return u.code === uso; })) uso = (usos[0] && usos[0].code) || 'G03';
      form.elements.cfdi_use.innerHTML = usoOptions(regimen, rfc, uso);
    }
    function validate(showAll) {
      var result = R.validarPerfil(values());
      d.querySelectorAll('[data-err]').forEach(function (el) {
        var key = el.dataset.err;
        el.textContent = (showAll || touched[key]) && result.errors[key] ? result.errors[key] : '';
      });
      var notes = d.querySelector('[data-fiscal-notes]');
      notes.innerHTML = result.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
      return result;
    }
    refreshMenus({ regimen: current.fiscal_regime || '', uso: current.cfdi_use || '' }); validate(false);
    form.addEventListener('input', function (event) {
      var name = event.target && event.target.name; if (name) touched[name] = true;
      if (name === 'rfc') { form.elements.rfc.value = R.normalizarRfc(form.elements.rfc.value); }
      if (name === 'rfc' || name === 'fiscal_regime') refreshMenus();
      validate(false);
    });
    form.elements.constancia.addEventListener('change', async function () {
      var file = form.elements.constancia.files[0]; form.elements.constancia.value = '';
      if (!file) return;
      if (!TYPES[file.type]) return say('Sube la constancia como PDF, JPG o PNG.', 'error');
      if (file.size > MAX_BYTES) return say('El archivo pesa más de 4 MB. Descarga de nuevo la constancia en PDF o reduce la imagen.', 'error');
      if (busy) return; busy = true; form.querySelector('[data-fiscal-save]').disabled = true; say('Leyendo la constancia…', '');
      try {
        var data = await extract(file);
        if (!data.is_constancia) { say((data.warnings && data.warnings[0]) || 'El archivo no parece una constancia de situación fiscal.', 'error'); return; }
        if (data.rfc) form.elements.rfc.value = data.rfc;
        if (data.legal_name) form.elements.legal_name.value = data.legal_name;
        if (data.tax_postal_code) form.elements.tax_postal_code.value = data.tax_postal_code;
        if (data.email && !form.elements.email.value) form.elements.email.value = data.email;
        refreshMenus({ regimen: data.fiscal_regime || '', uso: data.suggested_cfdi_use || 'G03' });
        ['rfc', 'legal_name', 'tax_postal_code', 'fiscal_regime', 'cfdi_use'].forEach(function (k) { touched[k] = true; });
        say('Datos leídos de la constancia. Revisa cada campo contra el documento antes de guardar.' + ((data.warnings || []).length ? ' ' + data.warnings.join(' ') : ''), 'ok');
        validate(true);
      } catch (e) { say(String(e && e.message || 'No se pudo leer la constancia. Captura los datos a mano.'), 'error'); }
      finally { busy = false; form.querySelector('[data-fiscal-save]').disabled = false; }
    });
    form.onsubmit = async function (event) {
      event.preventDefault();
      if (busy) return;
      var result = validate(true);
      if (!result.ok) { var first = Object.keys(result.errors)[0]; if (form.elements[first]) form.elements[first].focus(); say('Revisa los campos marcados.', 'error'); return; }
      busy = true; form.querySelector('[data-fiscal-save]').disabled = true; say('Guardando…', '');
      var row = { tenant_id: options.tenant, patient_id: options.patientId, legal_name: result.clean.legal_name, rfc: result.clean.rfc, fiscal_regime: result.clean.fiscal_regime, tax_postal_code: result.clean.tax_postal_code, cfdi_use: result.clean.cfdi_use, email: result.clean.email, updated_by: options.actor, updated_at: new Date().toISOString() };
      try {
        var res = await window.sb.from('smyl_patient_fiscal_profiles').upsert(row);
        if (res && res.error) throw res.error;
        d.close(); d.remove();
        if (typeof options.onSaved === 'function') await options.onSaved(row);
      } catch (e) {
        busy = false; form.querySelector('[data-fiscal-save]').disabled = false;
        say(/42501|row-level|permiso/i.test(String(e && e.message)) ? 'Tu rol no permite guardar datos fiscales.' : String(e && e.message || 'No se pudo guardar.'), 'error');
      }
    };
    d.querySelector('[data-close]').onclick = function () { d.close(); d.remove(); if (typeof options.onCancel === 'function') options.onCancel(); };
    d.addEventListener('cancel', function () { d.remove(); if (typeof options.onCancel === 'function') options.onCancel(); });
    d.showModal();
    return d;
  }

  window.SmylFiscalCapture = { open: open };
})();
