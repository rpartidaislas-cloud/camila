/* Alta de datos fiscales del paciente (cliente de facturación): captura a mano o desde la Constancia de Situación Fiscal.
 * Con la constancia, la IA (función fiscal-extract) solo SUGIERE: la persona revisa y guarda. El archivo no se almacena.
 * Las reglas del SAT viven en smyl-fiscal-rules.js. Guarda en smyl_patient_fiscal_profiles (la misma tabla que usa la ficha 360). */
(function () {
  'use strict';
  var MAX_BYTES = 4 * 1024 * 1024;
  var TYPES = { 'application/pdf': 1, 'image/jpeg': 1, 'image/png': 1 };

  function esc(value) { return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rules() { return window.SmylFiscalRules; }
  // Domicilio fiscal y estatus en el padrón: opcionales (el CFDI 4.0 solo exige el código postal).
  var ADDRESS = [['street', 'Calle', 120, 'wide'], ['exterior_number', 'Núm. exterior', 20, ''], ['interior_number', 'Núm. interior', 20, ''], ['neighborhood', 'Colonia', 120, ''], ['locality', 'Localidad', 120, ''], ['municipality', 'Municipio o alcaldía', 120, ''], ['state', 'Estado', 120, '']];
  function addressHtml(current) {
    var filled = ADDRESS.some(function (f) { return current[f[0]]; }) || current.sat_status;
    return '<details class="fiscal-capture-address"' + (filled ? ' open' : '') + '><summary>Domicilio fiscal <small>Opcional · se llena con la constancia</small></summary><div class="fiscal-capture-grid">' +
      ADDRESS.map(function (f) { return '<label' + (f[3] ? ' class="' + f[3] + '"' : '') + '>' + f[1] + '<input name="' + f[0] + '" maxlength="' + f[2] + '" autocomplete="off" value="' + esc(current[f[0]] || '') + '"></label>'; }).join('') +
      '<label>Estatus en el padrón<input name="sat_status" maxlength="40" autocomplete="off" placeholder="ACTIVO" value="' + esc(current.sat_status || '') + '"></label></div></details>';
  }
  function optionalValues(form) {
    var out = {}; ADDRESS.concat([['sat_status']]).forEach(function (f) { out[f[0]] = String(form.elements[f[0]].value || '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, f[2] || 40); }); return out;
  }
  // Antes de aplicar la migración del domicilio, la tabla no tiene esas columnas: se guarda lo obligatorio.
  function missingColumn(error) { var text = String(error && (error.message || error.details) || ''); return (error && error.code === 'PGRST204') || /column .* does not exist|schema cache/i.test(text); }

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

  // Archivos que el paciente mandó por el chat (LANA): fotos y documentos de sus conversaciones vinculadas.
  async function readInvoke(res, fallback) {
    var data = res && res.data, err = res && res.error;
    if (err && err.context && typeof err.context.json === 'function') { try { data = await err.context.json(); } catch (e) {} }
    if (!data || data.error) throw new Error((data && data.error) || fallback);
    return data;
  }
  async function chatFiles(tenant, patientId) {
    var links = await window.sb.from('camila_lana_handoffs').select('lana_conversation_id,lana_channel,updated_at').eq('tenant_id', tenant).eq('patient_id', patientId).order('updated_at', { ascending: false }).limit(5);
    if (links.error || !(links.data || []).length) return { linked: false, items: [] };
    var lists = await Promise.all(links.data.map(function (link) {
      return window.sb.functions.invoke('lana-inbox?action=shared&limit=60&conversation_id=' + encodeURIComponent(link.lana_conversation_id), { method: 'GET' })
        .then(function (res) { return readInvoke(res, 'No se pudieron consultar los archivos del chat.'); })
        .then(function (data) { return (data.items || []).filter(function (item) { return (item.media_type === 'image' || item.media_type === 'document') && item.media_url && !item.deleted; }).map(function (item) { return Object.assign({ conversation_id: link.lana_conversation_id, channel: link.lana_channel }, item); }); })
        .catch(function () { return []; });
    }));
    var items = [].concat.apply([], lists).sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    return { linked: true, items: items.slice(0, 40) };
  }
  async function extractFromChat(patientId, item) {
    var res = await window.sb.functions.invoke('lana-inbox', { body: { action: 'fiscal_document', conversation_id: item.conversation_id, patient_id: patientId, message_id: item.id } });
    return readInvoke(res, 'No se pudo leer el archivo del chat. Captura los datos a mano.');
  }
  function shortDate(value) { var d = value ? new Date(value) : null; return d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '') : ''; }

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
      '<section class="fiscal-capture-upload"><div><strong>¿Tiene su constancia de situación fiscal?</strong><small>Súbela (PDF, JPG o PNG, máx. 4 MB) y la IA llena los datos. Tú los revisas antes de guardar. El archivo no se guarda.</small></div><div class="fiscal-capture-sources"><label class="btn btn-secondary">Subir constancia<input type="file" name="constancia" accept="application/pdf,image/jpeg,image/png" hidden></label><button type="button" class="btn btn-secondary" data-fiscal-chat hidden>Elegir del chat</button></div></section>' +
      '<section class="fiscal-capture-chat" data-fiscal-chat-panel hidden><header><strong>Archivos que el paciente mandó por el chat</strong><button type="button" class="fiscal-capture-chat-close" data-fiscal-chat-close>Cerrar</button></header><div class="fiscal-capture-chat-list" data-fiscal-chat-list></div></section>' +
      '<p class="fiscal-capture-status" data-fiscal-status role="status" aria-live="polite"></p>' +
      '<div class="fiscal-capture-grid">' +
      '<label>RFC<input name="rfc" maxlength="13" autocomplete="off" value="' + esc(current.rfc || '') + '"><small data-err="rfc"></small></label>' +
      '<label>Código postal fiscal<input name="tax_postal_code" maxlength="5" inputmode="numeric" autocomplete="off" value="' + esc(current.tax_postal_code || '') + '"><small data-err="tax_postal_code"></small></label>' +
      '<label class="wide">Nombre o razón social (como en la constancia)<input name="legal_name" maxlength="240" autocomplete="off" value="' + esc(current.legal_name || '') + '"><small data-err="legal_name"></small></label>' +
      '<label class="wide">Régimen fiscal<select name="fiscal_regime"></select><small data-err="fiscal_regime"></small></label>' +
      '<label class="wide">Uso de la factura<select name="cfdi_use"></select><small data-err="cfdi_use"></small></label>' +
      '<label class="wide">Correo para enviar la factura<input name="email" type="email" maxlength="254" autocomplete="off" value="' + esc(current.email || '') + '"><small data-err="email"></small></label>' +
      '</div>' + addressHtml(current) + '<ul class="fiscal-capture-notes" data-fiscal-notes></ul>' +
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
    function applyExtract(data) {
        if (!data.is_constancia) { say((data.warnings && data.warnings[0]) || 'El archivo no parece una constancia de situación fiscal.', 'error'); return; }
        if (data.rfc) form.elements.rfc.value = data.rfc;
        if (data.legal_name) form.elements.legal_name.value = data.legal_name;
        if (data.tax_postal_code) form.elements.tax_postal_code.value = data.tax_postal_code;
        if (data.email && !form.elements.email.value) form.elements.email.value = data.email;
        var address = data.address || {}, gotAddress = false;
        ADDRESS.forEach(function (f) { if (address[f[0]]) { form.elements[f[0]].value = address[f[0]]; gotAddress = true; } });
        if (data.sat_status) { form.elements.sat_status.value = data.sat_status; gotAddress = true; }
        if (gotAddress) d.querySelector('.fiscal-capture-address').open = true;
        refreshMenus({ regimen: data.fiscal_regime || '', uso: data.suggested_cfdi_use || 'G03' });
        ['rfc', 'legal_name', 'tax_postal_code', 'fiscal_regime', 'cfdi_use'].forEach(function (k) { touched[k] = true; });
        say('Datos leídos de la constancia. Revisa cada campo contra el documento antes de guardar.' + ((data.warnings || []).length ? ' ' + data.warnings.join(' ') : ''), 'ok');
        validate(true);
    }
    // «Elegir del chat»: solo si el paciente tiene un chat vinculado; la lectura la hace el servidor con el archivo del mensaje.
    var chatButton = d.querySelector('[data-fiscal-chat]'), chatPanel = d.querySelector('[data-fiscal-chat-panel]'), chatList = d.querySelector('[data-fiscal-chat-list]'), chatCache = null;
    if (options.patientId && options.tenant) {
      window.sb.from('camila_lana_handoffs').select('lana_conversation_id', { count: 'exact', head: true }).eq('tenant_id', options.tenant).eq('patient_id', options.patientId)
        .then(function (r) { if (!r.error && r.count) chatButton.hidden = false; }, function () {});
    }
    function renderChat(result) {
      if (!result.items.length) { chatList.innerHTML = '<p class="fiscal-capture-chat-empty">El paciente no ha enviado fotos ni documentos por el chat.</p>'; return; }
      chatList.innerHTML = result.items.map(function (item, i) {
        var thumb = item.media_type === 'image' ? '<img src="' + esc(item.media_url) + '" alt="" loading="lazy">' : '<b>' + esc(/\.pdf$/i.test(item.media_filename || '') || !item.media_filename ? 'PDF' : 'DOC') + '</b>';
        var name = item.media_type === 'image' ? 'Foto' : (item.media_filename || 'Documento');
        return '<button type="button" class="fiscal-capture-chat-item" data-chat-index="' + i + '"><span class="fiscal-capture-chat-thumb">' + thumb + '</span><span><strong>' + esc(name) + '</strong><small>' + esc(shortDate(item.created_at)) + '</small></span></button>';
      }).join('');
      chatList.querySelectorAll('[data-chat-index]').forEach(function (button) {
        button.onclick = async function () {
          if (busy) return; var item = result.items[Number(button.dataset.chatIndex)];
          busy = true; form.querySelector('[data-fiscal-save]').disabled = true; chatPanel.hidden = true; say('Leyendo el archivo del chat…', '');
          try { applyExtract(await extractFromChat(options.patientId, item)); }
          catch (e) { say(String(e && e.message || 'No se pudo leer el archivo del chat. Captura los datos a mano.'), 'error'); }
          finally { busy = false; form.querySelector('[data-fiscal-save]').disabled = false; }
        };
      });
    }
    chatButton.onclick = async function () {
      chatPanel.hidden = false; chatList.innerHTML = '<p class="fiscal-capture-chat-empty">Buscando archivos del chat…</p>';
      try { chatCache = chatCache || await chatFiles(options.tenant, options.patientId); renderChat(chatCache); }
      catch (e) { chatList.innerHTML = '<p class="fiscal-capture-chat-empty">No se pudieron consultar los archivos del chat.</p>'; }
    };
    d.querySelector('[data-fiscal-chat-close]').onclick = function () { chatPanel.hidden = true; };
    form.elements.constancia.addEventListener('change', async function () {
      var file = form.elements.constancia.files[0]; form.elements.constancia.value = '';
      if (!file) return;
      if (!TYPES[file.type]) return say('Sube la constancia como PDF, JPG o PNG.', 'error');
      if (file.size > MAX_BYTES) return say('El archivo pesa más de 4 MB. Descarga de nuevo la constancia en PDF o reduce la imagen.', 'error');
      if (busy) return; busy = true; form.querySelector('[data-fiscal-save]').disabled = true; say('Leyendo la constancia…', '');
      try { applyExtract(await extract(file)); }
      catch (e) { say(String(e && e.message || 'No se pudo leer la constancia. Captura los datos a mano.'), 'error'); }
      finally { busy = false; form.querySelector('[data-fiscal-save]').disabled = false; }
    });
    form.onsubmit = async function (event) {
      event.preventDefault();
      if (busy) return;
      var result = validate(true);
      if (!result.ok) { var first = Object.keys(result.errors)[0]; if (form.elements[first]) form.elements[first].focus(); say('Revisa los campos marcados.', 'error'); return; }
      busy = true; form.querySelector('[data-fiscal-save]').disabled = true; say('Guardando…', '');
      var row = { tenant_id: options.tenant, patient_id: options.patientId, legal_name: result.clean.legal_name, rfc: result.clean.rfc, fiscal_regime: result.clean.fiscal_regime, tax_postal_code: result.clean.tax_postal_code, cfdi_use: result.clean.cfdi_use, email: result.clean.email, updated_by: options.actor, updated_at: new Date().toISOString() };
      var full = Object.assign({}, row, optionalValues(form)), partial = false;
      try {
        var res = await window.sb.from('smyl_patient_fiscal_profiles').upsert(full);
        if (res && res.error && missingColumn(res.error)) { partial = true; res = await window.sb.from('smyl_patient_fiscal_profiles').upsert(row); }
        if (res && res.error) throw res.error;
        d.close(); d.remove();
        if (typeof options.onSaved === 'function') await options.onSaved(partial ? row : full, { addressSaved: !partial });
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
