/* SMYL · La Nube: archivo general de la clínica (carpetas, subir, vincular a paciente/cita, papelera y medidor).
   Todo pasa por RPC con permisos del servidor (cloud.read / cloud.upload / cloud.manage); lo clínico además exige clinical.read.
   Los archivos se verifican con el mismo circuito de archivos privados que el expediente antes de registrarse. */
(function (root, factory) {
  var api = factory(typeof window !== 'undefined' ? window : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylCloud = api;
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var BUCKET = 'smyl-cloud';
  var MAX_BYTES = 20 * 1024 * 1024;
  var MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  var CATEGORIES = [['photo', 'Foto'], ['xray', 'Rayos X'], ['document', 'Documento'], ['consent', 'Consentimiento'], ['other', 'Otro']];
  var CATEGORY_LABEL = { photo: 'Foto', xray: 'Rayos X', document: 'Documento', consent: 'Consentimiento', other: 'Otro' };
  var state = { summary: null, files: [], view: { kind: 'all', value: '' }, search: '', selectedId: '', mode: 'grid', loading: false, error: '', tenant: null,
    patients: {}, thumbs: {}, appointments: {}, uploading: false, notice: null, listToken: 0, shares: {}, sharedIds: [], sharesReady: null };

  function formatBytes(value) {
    var bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    if (bytes < 1073741824) { var mb = bytes / 1048576; return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB'; }
    return (Math.round(bytes / 1073741824 * 100) / 100) + ' GB';
  }
  function safeName(name) { return String(name || 'archivo').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120) || 'archivo'; }
  // Sugerencia sencilla por tipo de archivo; la persona siempre puede cambiarla.
  function guessCategory(file) { return file && file.type === 'application/pdf' ? 'document' : ''; }
  function checkFile(file) {
    if (!file) return 'Archivo no válido.';
    if (MIME.indexOf(file.type) === -1) return 'Formato no permitido (solo JPG, PNG, WebP o PDF).';
    if (file.size < 16) return 'El archivo está vacío.';
    if (file.size > MAX_BYTES) return 'Pesa más de 20 MB.';
    return '';
  }
  function patientLabel(person) { return person ? [person.nombre, person.apellido].filter(Boolean).join(' ') : ''; }
  function escapeLike(value) { return String(value || '').replace(/[\\%_,()]/g, ' ').trim(); }
  function dateLabel(value) {
    var date = value ? new Date(value) : null; if (!date || isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).replace('.', '');
  }
  function trashDaysLeft(value) {
    var date = value ? new Date(value) : null; if (!date || isNaN(date.getTime())) return 30;
    return Math.max(0, 30 - Math.floor((Date.now() - date.getTime()) / 86400000));
  }

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined && text !== null && text !== '') node.textContent = text; return node; }
  function btn(label, cls, run) { var node = el('button', cls || 'btn btn-secondary btn-sm', label); node.type = 'button'; if (run) node.onclick = run; return node; }
  function perms() { return (state.summary && state.summary.permissions) || {}; }
  function sb() { return win && win.sb; }
  async function rpc(name, args) { var result = await sb().rpc(name, args || {}); if (result.error) throw result.error; return result.data; }
  function friendly(error, fallback) {
    var code = error && error.code || ''; var message = String(error && error.message || '');
    if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(message)) return 'La Nube todavía no está activada en esta clínica.';
    if (code === '42501') return message || 'Tu rol no permite esta acción.';
    return message || fallback || 'No se pudo completar la acción.';
  }
  function notice(text, tone) { state.notice = text ? { text: text, tone: tone || 'info' } : null; renderNotice(); }
  function uuid() { return win.crypto && win.crypto.randomUUID ? win.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }

  // ---------- datos ----------
  async function loadSummary() { state.summary = await rpc('smyl_cloud_summary'); }

  async function loadFiles() {
    if (!perms().read) { state.files = []; return; }
    var token = ++state.listToken; var view = state.view;
    var query = sb().from('smyl_cloud_files').select('id,folder_id,category,patient_id,appointment_id,display_name,storage_path,mime_type,size_bytes,notes,status,created_at,trashed_at')
      .eq('tenant_id', state.tenant).eq('status', view.kind === 'trash' ? 'trashed' : 'active').order('created_at', { ascending: false }).limit(200);
    if (view.kind === 'recent') query = query.gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
    else if (view.kind === 'category') query = query.eq('category', view.value);
    else if (view.kind === 'unclassified') query = query.is('category', null);
    else if (view.kind === 'nopatient') query = query.is('patient_id', null);
    else if (view.kind === 'folder') query = query.eq('folder_id', view.value);
    else if (view.kind === 'patient') query = query.eq('patient_id', view.value);
    else if (view.kind === 'shared') { if (!state.sharedIds.length) { state.files = []; return; } query = query.in('id', state.sharedIds); }
    var term = escapeLike(state.search); if (term) query = query.ilike('display_name', '%' + term + '%');
    var result = await query; if (result.error) throw result.error;
    if (token !== state.listToken) return;
    state.files = result.data || [];
    await Promise.all([loadPatientNames(), loadThumbs()]);
  }

  async function loadPatientNames() {
    var ids = Array.from(new Set(state.files.map(function (f) { return f.patient_id; }).filter(function (id) { return id && !state.patients[id]; })));
    if (!ids.length) return;
    try {
      var result = await sb().from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id', state.tenant).in('id', ids);
      (result.data || []).forEach(function (person) { state.patients[person.id] = patientLabel(person); });
    } catch (_) {}
  }

  async function loadThumbs() {
    var wanted = state.files.filter(function (f) { return f.mime_type !== 'application/pdf' && !state.thumbs[f.id]; });
    if (!wanted.length) return;
    try {
      var result = await sb().storage.from(BUCKET).createSignedUrls(wanted.map(function (f) { return f.storage_path; }), 900);
      var byPath = {}; (result.data || []).forEach(function (item) { if (item.signedUrl) byPath[item.path] = item.signedUrl; });
      wanted.forEach(function (f) { if (byPath[f.storage_path]) state.thumbs[f.id] = byPath[f.storage_path]; });
    } catch (_) {}
  }

  async function refresh(opts) {
    if (!sb() || !win.tenantId) return;
    state.tenant = win.tenantId; state.loading = true; state.error = ''; render();
    try { await loadSummary(); await loadShares(); await loadFiles(); }
    catch (error) { state.error = friendly(error, 'No se pudo cargar la Nube.'); }
    finally { state.loading = false; render(); }
  }
  async function reloadList() {
    try { await loadFiles(); } catch (error) { state.error = friendly(error); }
    render();
  }

  // ---------- acciones ----------
  async function patchFile(id, patch) {
    try { await rpc('smyl_cloud_update_file', { p_id: id, p_patch: patch }); await Promise.all([loadSummary(), loadFiles()]); }
    catch (error) { notice(friendly(error), 'error'); }
    render();
  }
  async function trash(ids, trashed) {
    try {
      var changed = await rpc('smyl_cloud_set_trashed', { p_ids: ids, p_trashed: trashed });
      state.selectedId = ''; await Promise.all([loadSummary(), loadFiles()]);
      notice(trashed ? 'Enviado a la papelera. Se elimina definitivamente a los 30 días.' : 'Archivo restaurado.', changed ? 'success' : 'info');
    } catch (error) { notice(friendly(error), 'error'); }
    render();
  }
  async function deleteForever(ids) {
    if (!win.confirm(ids.length === 1 ? '¿Eliminar este archivo para siempre? No se puede deshacer.' : '¿Eliminar ' + ids.length + ' archivos para siempre? No se puede deshacer.')) return;
    try {
      var paths = await rpc('smyl_cloud_delete_forever', { p_ids: ids });
      if (paths && paths.length) await sb().storage.from(BUCKET).remove(paths).catch(function () {});
      state.selectedId = ''; await Promise.all([loadSummary(), loadFiles()]);
      notice('Eliminado definitivamente.', 'success');
    } catch (error) { notice(friendly(error), 'error'); }
    render();
  }
  async function saveFolder(id) {
    var current = id && (state.summary.folders || []).find(function (f) { return f.id === id; });
    var name = win.prompt(id ? 'Nuevo nombre de la carpeta' : 'Nombre de la nueva carpeta', current ? current.name : '');
    if (!name || !name.trim()) return;
    try { await rpc('smyl_cloud_folder_save', { p_id: id || null, p_name: name.trim() }); await loadSummary(); }
    catch (error) { notice(friendly(error), 'error'); }
    render();
  }
  async function deleteFolder(id) {
    if (!win.confirm('¿Eliminar esta carpeta? Debe estar vacía; los archivos de la papelera pasan a «Todos».')) return;
    try { await rpc('smyl_cloud_folder_delete', { p_id: id }); if (state.view.kind === 'folder' && state.view.value === id) state.view = { kind: 'all', value: '' }; await Promise.all([loadSummary(), loadFiles()]); }
    catch (error) { notice(friendly(error), 'error'); }
    render();
  }
  async function download(file) {
    try {
      var result = await sb().storage.from(BUCKET).createSignedUrl(file.storage_path, 120, { download: file.display_name });
      if (result.error) throw result.error;
      var link = document.createElement('a'); link.href = result.data.signedUrl; link.rel = 'noopener'; document.body.append(link); link.click(); link.remove();
    } catch (error) { notice(friendly(error, 'No se pudo preparar la descarga.'), 'error'); renderNotice(); }
  }
  async function loadAppointments(patientId) {
    if (!patientId || state.appointments[patientId]) return;
    try {
      var result = await sb().from('smyl_appointments').select('id,starts_at,status').eq('tenant_id', state.tenant).eq('patient_id', patientId).order('starts_at', { ascending: false }).limit(12);
      state.appointments[patientId] = result.data || [];
    } catch (_) { state.appointments[patientId] = []; }
    render();
  }
  async function searchPatients(term) {
    var text = escapeLike(term); if (text.length < 2) return [];
    var result = await sb().from('camila_pacientes').select('id,nombre,apellido,telefono').eq('tenant_id', state.tenant)
      .or('nombre.ilike.%' + text + '%,apellido.ilike.%' + text + '%,telefono.ilike.%' + text + '%').limit(8);
    if (result.error) throw result.error;
    (result.data || []).forEach(function (person) { state.patients[person.id] = patientLabel(person); });
    return result.data || [];
  }


  // ---------- compartir con enlace ----------
  function shareState(share) {
    if (share.revoked_at) return 'revoked';
    if (Date.parse(share.expires_at) <= Date.now()) return 'expired';
    if ((share.failed_attempts || 0) >= 5) return 'locked';
    return 'active';
  }
  async function loadShares() {
    state.shares = {}; state.sharedIds = [];
    if (!perms().share) { state.sharesReady = null; return; }
    try {
      var result = await sb().from('smyl_cloud_shares').select('id,file_id,requires_code,expires_at,revoked_at,failed_attempts,view_count,last_viewed_at,created_at')
        .eq('tenant_id', state.tenant).order('created_at', { ascending: false }).limit(500);
      if (result.error) throw result.error;
      state.sharesReady = true;
      (result.data || []).forEach(function (share) { (state.shares[share.file_id] = state.shares[share.file_id] || []).push(share); });
      state.sharedIds = Object.keys(state.shares).filter(function (id) { return state.shares[id].some(function (share) { return shareState(share) === 'active'; }); });
    } catch (_) { state.sharesReady = false; }
  }
  async function invokeShare(body) {
    var result = await sb().functions.invoke('cloud-share', { body: body });
    if (result.error) {
      var message = 'No se pudo completar la acción.';
      try { var detail = await result.error.context.json(); if (detail && detail.error) message = detail.error; } catch (_) {}
      throw new Error(message);
    }
    return result.data;
  }
  async function copyText(text) {
    try { await win.navigator.clipboard.writeText(text); return true; } catch (_) {}
    try { var area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select(); var ok = document.execCommand('copy'); area.remove(); return ok; } catch (_) { return false; }
  }
  function openShare(file) {
    var dialog = el('dialog', 'cloud-dialog'); var form = el('form'); form.method = 'dialog';
    form.append(el('h3', '', 'Compartir «' + file.display_name + '»'), el('p', 'cloud-dialog-copy', 'Crea un enlace privado para que otra persona vea el archivo sin entrar a SMYL. Solo puede verlo, no cambiarlo.'));
    var access = el('div', 'cloud-radios'); access.setAttribute('role', 'radiogroup'); access.setAttribute('aria-label', 'Quién puede abrirlo');
    [['link', 'Solo con el enlace', 'Quien tenga el enlace puede abrirlo.'], ['code', 'Con código de acceso', 'Además pide un código de 6 dígitos que le envías por separado.']].forEach(function (option, index) {
      var label = el('label', 'cloud-radio'); var radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'access'; radio.value = option[0]; radio.checked = index === 0;
      var copy = el('span'); copy.append(el('b', '', option[1]), el('small', '', option[2])); label.append(radio, copy); access.append(label);
    });
    var daysLabel = el('label', 'cloud-field-label', 'El enlace vence'); var days = document.createElement('select');
    [['1', 'En 1 día'], ['7', 'En 7 días'], ['30', 'En 30 días']].forEach(function (option) { days.append(new Option(option[1], option[0])); }); days.value = '7'; daysLabel.append(days);
    var warn = el('p', 'cloud-warn', (file.patient_id || ['photo', 'xray', 'consent'].indexOf(file.category) !== -1) ? 'Es un archivo clínico: queda registrado cuántas veces se abre y puedes revocar el enlace cuando quieras.' : 'Puedes revocar el enlace cuando quieras; queda registrado cuántas veces se abre.');
    var result = el('div', 'cloud-share-result'); result.setAttribute('role', 'status');
    var actions = el('div', 'cloud-dialog-actions'); var close = btn('Cerrar', 'btn btn-secondary', function () { dialog.close(); });
    var create = btn('Crear enlace', 'btn btn-primary'); create.type = 'submit'; actions.append(close, create);
    form.append(access, daysLabel, warn, result, actions); dialog.append(form); document.body.append(dialog);
    form.addEventListener('submit', async function (event) {
      event.preventDefault(); create.disabled = true; result.textContent = 'Creando enlace…';
      try {
        var withCode = form.querySelector('input[name="access"]:checked').value === 'code';
        var data = await invokeShare({ action: 'create', file_id: file.id, days: Number(days.value), with_code: withCode });
        result.textContent = '';
        var field = document.createElement('input'); field.type = 'text'; field.readOnly = true; field.value = data.url; field.setAttribute('aria-label', 'Enlace para compartir'); field.className = 'cloud-share-url';
        var copyButton = btn('Copiar enlace', 'btn btn-primary btn-sm', async function () { copyButton.textContent = (await copyText(data.url)) ? 'Enlace copiado' : 'Selecciona y copia'; field.select(); });
        result.append(field, copyButton);
        if (data.code) result.append(el('p', 'cloud-share-code', 'Código: ' + data.code), el('small', '', 'Envíalo por otro medio. Solo se muestra ahora; si lo pierdes, crea otro enlace.'));
        result.append(el('small', '', 'Vence el ' + dateLabel(data.expires_at) + '.'));
        create.remove(); await loadShares(); render();
      } catch (error) { result.textContent = error.message || 'No se pudo crear el enlace.'; create.disabled = false; }
    });
    dialog.addEventListener('close', function () { dialog.remove(); });
    dialog.showModal();
  }
  async function revokeShare(share) {
    if (!win.confirm('¿Revocar este enlace? Quien lo tenga dejará de poder abrir el archivo.')) return;
    try { await invokeShare({ action: 'revoke', share_id: share.id }); await loadShares(); notice('Enlace revocado.', 'success'); }
    catch (error) { notice(error.message, 'error'); }
    render();
  }

  // ---------- subir ----------
  function openUpload(initialFiles) {
    var dialog = el('dialog', 'cloud-dialog'); dialog.setAttribute('aria-labelledby', 'cloud-upload-title');
    var form = el('form'); form.method = 'dialog';
    form.append(el('h3', '', 'Subir archivos'), el('p', 'cloud-dialog-copy', 'JPG, PNG, WebP o PDF de hasta 20 MB. Se verifican antes de guardarse y cuentan en tu almacenamiento.'));
    var items = []; var pickedPatient = null;
    var drop = el('label', 'cloud-drop'); var input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = MIME.join(','); input.hidden = true;
    drop.append(document.createTextNode('Suelta tus archivos aquí o '), el('u', '', 'explora'), input);
    var list = el('div', 'cloud-upload-list');
    var meta = el('div', 'cloud-upload-meta');
    var folderSelect = document.createElement('select'); folderSelect.append(new Option('Sin carpeta', ''));
    ((state.summary && state.summary.folders) || []).forEach(function (folder) { folderSelect.append(new Option(folder.name, folder.id)); });
    var folderLabel = el('label', '', 'Carpeta'); folderLabel.append(folderSelect);
    var patientBox = el('div', 'cloud-field'); var patientLabelNode = el('label', '', 'Paciente (opcional)'); var patientInput = document.createElement('input'); patientInput.type = 'search'; patientInput.placeholder = 'Buscar paciente…'; patientInput.autocomplete = 'off';
    var patientHits = el('div', 'cloud-hits'); patientBox.append(patientLabelNode, patientInput, patientHits);
    if (!perms().clinical) { patientBox.hidden = true; }
    meta.append(folderLabel, patientBox);
    var status = el('p', 'cloud-upload-status'); status.setAttribute('role', 'status');
    var actions = el('div', 'cloud-dialog-actions'); var cancel = btn('Cancelar', 'btn btn-secondary', function () { dialog.close(); });
    var save = btn('Guardar', 'btn btn-primary'); save.disabled = true; save.type = 'submit'; actions.append(cancel, save);
    form.append(drop, list, meta, status, actions); dialog.append(form); document.body.append(dialog);

    function paint() {
      list.innerHTML = '';
      items.forEach(function (item, index) {
        var row = el('div', 'cloud-upload-row' + (item.error ? ' has-error' : '') + (item.done ? ' is-done' : ''));
        row.append(el('b', '', item.file.name), el('small', '', formatBytes(item.file.size) + (item.error ? ' · ' + item.error : item.done ? ' · Guardado' : '')));
        if (!item.error && !item.done) {
          var select = document.createElement('select'); select.setAttribute('aria-label', 'Tipo de ' + item.file.name); select.append(new Option('Sin clasificar', ''));
          CATEGORIES.forEach(function (entry) { if (!perms().clinical && ['photo', 'xray', 'consent'].indexOf(entry[0]) !== -1) return; select.append(new Option(entry[1], entry[0])); });
          select.value = item.category; select.onchange = function () { item.category = select.value; };
          var remove = btn('Quitar', 'cloud-link', function () { items.splice(index, 1); paint(); }); row.append(select, remove);
        }
        list.append(row);
      });
      var valid = items.filter(function (item) { return !item.error && !item.done; });
      save.disabled = state.uploading || !valid.length;
      var bytes = valid.reduce(function (sum, item) { return sum + item.file.size; }, 0);
      if (!state.uploading) status.textContent = valid.length ? 'Se guardarán ' + valid.length + (valid.length === 1 ? ' archivo' : ' archivos') + ' (' + formatBytes(bytes) + ').' : '';
    }
    function add(files) {
      Array.from(files || []).forEach(function (file) { items.push({ file: file, category: guessCategory(file), error: checkFile(file), done: false }); });
      paint();
    }
    input.onchange = function () { add(input.files); input.value = ''; };
    drop.addEventListener('dragover', function (event) { event.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
    drop.addEventListener('drop', function (event) { event.preventDefault(); drop.classList.remove('is-over'); add(event.dataTransfer && event.dataTransfer.files); });
    var timer = null;
    patientInput.oninput = function () {
      pickedPatient = null; clearTimeout(timer); patientHits.innerHTML = '';
      timer = setTimeout(async function () {
        try {
          var people = await searchPatients(patientInput.value); patientHits.innerHTML = '';
          people.forEach(function (person) {
            var hit = btn(patientLabel(person) + (person.telefono ? ' · ' + person.telefono : ''), 'cloud-hit', function () { pickedPatient = person.id; patientInput.value = patientLabel(person); patientHits.innerHTML = ''; });
            patientHits.append(hit);
          });
        } catch (_) {}
      }, 250);
    };
    form.addEventListener('submit', async function (event) {
      event.preventDefault(); if (state.uploading) return;
      var queue = items.filter(function (item) { return !item.error && !item.done; }); if (!queue.length) return;
      state.uploading = true; save.disabled = true; cancel.disabled = true;
      try {
        var check = await rpc('smyl_cloud_upload_check', { p_size: queue.reduce(function (sum, item) { return sum + item.file.size; }, 0) });
        if (check && check.ok === false) { status.textContent = 'No hay espacio suficiente. Libera espacio o amplía tu plan (Configuración → Almacenamiento).'; throw new Error('__full'); }
        for (var i = 0; i < queue.length; i++) {
          var item = queue[i]; status.textContent = 'Subiendo ' + (i + 1) + ' de ' + queue.length + '…';
          try { await uploadOne(item, { folder: folderSelect.value || null, patient: pickedPatient }); item.done = true; }
          catch (error) { item.error = friendly(error, 'No se pudo guardar.'); }
          paint();
        }
        var failed = queue.filter(function (item) { return item.error; }).length;
        await Promise.all([loadSummary(), loadFiles()]);
        render();
        if (!failed) { notice(queue.length === 1 ? 'Archivo guardado en la Nube.' : queue.length + ' archivos guardados en la Nube.', 'success'); dialog.close(); }
        else status.textContent = failed + ' no se pudo guardar. Revisa la lista.';
      } catch (error) { if (error.message !== '__full') status.textContent = friendly(error, 'No se pudo subir.'); }
      finally { state.uploading = false; cancel.disabled = false; paint(); }
    });
    dialog.addEventListener('close', function () { dialog.remove(); });
    dialog.showModal(); if (initialFiles && initialFiles.length) add(initialFiles); else paint();
  }

  async function uploadOne(item, target) {
    var file = item.file; var id = uuid(); var path = state.tenant + '/' + id + '/' + safeName(file.name); var registered = false;
    try {
      var sha = await win.SmylSecureFiles.sha256(file);
      var upload = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }); if (upload.error) throw upload.error;
      await win.SmylSecureFiles.verify(sb(), BUCKET, path, file, sha);
      await rpc('smyl_cloud_register_file', { p_id: id, p_display_name: file.name, p_storage_path: path, p_mime_type: file.type, p_size_bytes: file.size, p_sha256: sha,
        p_folder_id: target.folder, p_patient_id: target.patient, p_appointment_id: null, p_category: item.category || null });
      registered = true;
    } finally {
      if (!registered) { try { await sb().storage.from(BUCKET).remove([path]); } catch (_) {} }
    }
  }

  // ---------- pantalla ----------
  function setView(kind, value) { state.view = { kind: kind, value: value || '' }; state.selectedId = ''; reloadList(); }
  function isActive(kind, value) { return state.view.kind === kind && (value === undefined || state.view.value === value); }

  function renderSidebar(host) {
    var counts = (state.summary && state.summary.counts) || {}; var can = perms();
    host.innerHTML = '';
    var up = btn('＋ Subir archivos', 'btn btn-primary cloud-upload-btn', function () { openUpload(); }); up.disabled = !can.upload; if (!can.upload) up.title = 'Tu rol no permite subir archivos.'; host.append(up);
    function item(label, kind, value, count, extra) {
      var button = el('button', 'cloud-nav' + (isActive(kind, value) ? ' is-active' : '')); button.type = 'button'; button.append(el('span', '', label));
      if (count !== undefined && count !== null) button.append(el('em', '', String(count)));
      button.onclick = function () { setView(kind, value); }; if (extra) button.append(extra); return button;
    }
    var nav = el('nav', 'cloud-views'); nav.setAttribute('aria-label', 'Vistas de la Nube');
    nav.append(item('Todos los archivos', 'all', '', counts.total), item('Recientes', 'recent', '', counts.recent), item('Sin clasificar', 'unclassified', '', counts.unclassified), item('Sin paciente', 'nopatient', '', counts.no_patient));
    if (can.share && state.sharesReady) nav.append(item('Compartidos', 'shared', '', state.sharedIds.length));
    host.append(nav);
    var types = el('nav', 'cloud-views'); types.setAttribute('aria-label', 'Tipos de archivo'); types.append(el('h4', '', 'Tipos'));
    [['photo', 'Fotos'], ['xray', 'Rayos X'], ['document', 'Documentos'], ['consent', 'Consentimientos']].forEach(function (entry) { types.append(item(entry[1], 'category', entry[0], counts[entry[0]])); });
    host.append(types);
    var folders = el('nav', 'cloud-views'); folders.setAttribute('aria-label', 'Carpetas'); folders.append(el('h4', '', 'Carpetas'));
    ((state.summary && state.summary.folders) || []).forEach(function (folder) { folders.append(item(folder.name, 'folder', folder.id, folder.files)); });
    if (can.manage) folders.append(btn('＋ Nueva carpeta', 'cloud-link', function () { saveFolder(null); }));
    host.append(folders);
    var people = (state.summary && state.summary.patients) || [];
    if (people.length) { var byPatient = el('nav', 'cloud-views'); byPatient.setAttribute('aria-label', 'Por paciente'); byPatient.append(el('h4', '', 'Por paciente')); people.forEach(function (person) { byPatient.append(item(person.name || 'Paciente', 'patient', person.patient_id, person.files)); }); host.append(byPatient); }
    var other = el('nav', 'cloud-views'); other.append(item('Papelera', 'trash', '', counts.trashed)); host.append(other);
    var storage = (state.summary && state.summary.storage) || {}; var limit = Number(storage.limit_bytes) || 0; var used = Number(storage.used_bytes) || 0;
    var meter = el('div', 'cloud-meter'); meter.append(el('b', '', 'Almacenamiento'));
    if (limit) { var bar = el('div', 'cloud-meter-bar'); var fill = el('i'); fill.style.width = Math.min(100, used / limit * 100) + '%'; bar.append(fill); meter.append(bar, el('span', '', formatBytes(used) + ' de ' + formatBytes(limit))); }
    else meter.append(el('span', '', 'Nube: ' + formatBytes(counts.bytes || 0)));
    var detail = btn('Ver detalle', 'cloud-link', function () { if (win.ir) win.ir('almacenamiento'); }); meter.append(detail); host.append(meter);
  }

  function fileTile(file) {
    var tile = el('button', 'cloud-file' + (state.selectedId === file.id ? ' is-selected' : '')); tile.type = 'button'; tile.setAttribute('aria-pressed', state.selectedId === file.id ? 'true' : 'false');
    var preview = el('span', 'cloud-file-preview');
    if (state.thumbs[file.id]) { var img = document.createElement('img'); img.src = state.thumbs[file.id]; img.alt = ''; img.loading = 'lazy'; preview.append(img); } else preview.append(el('b', '', file.mime_type === 'application/pdf' ? 'PDF' : 'IMG'));
    var body = el('span', 'cloud-file-body'); body.append(el('b', '', file.display_name), el('small', '', dateLabel(file.created_at) + ' · ' + formatBytes(file.size_bytes)));
    var chips = el('span', 'cloud-chips');
    chips.append(el('i', 'cloud-chip' + (file.category ? '' : ' is-warn'), file.category ? CATEGORY_LABEL[file.category] : 'Sin clasificar'));
    chips.append(file.patient_id ? el('i', 'cloud-chip is-ok', state.patients[file.patient_id] || 'Paciente') : el('i', 'cloud-chip is-warn', 'Sin paciente'));
    if (state.sharedIds.indexOf(file.id) !== -1) chips.append(el('i', 'cloud-chip is-share', 'Compartido'));
    body.append(chips); tile.append(preview, body);
    tile.onclick = function () { state.selectedId = state.selectedId === file.id ? '' : file.id; if (file.patient_id) loadAppointments(file.patient_id); render(); };
    return tile;
  }

  function renderDetail(host) {
    host.innerHTML = '';
    var file = state.files.find(function (f) { return f.id === state.selectedId; });
    host.classList.toggle('is-open', Boolean(file));
    if (!file) { host.append(el('p', 'cloud-empty-detail', 'Elige un archivo para ver sus datos y vincularlo.')); return; }
    var can = perms(); var inTrash = file.status === 'trashed';
    var close = btn('Cerrar', 'cloud-link cloud-detail-close', function () { state.selectedId = ''; render(); }); host.append(close);
    var pv = el('div', 'cloud-detail-preview');
    if (state.thumbs[file.id]) { var img = document.createElement('img'); img.src = state.thumbs[file.id]; img.alt = file.display_name; pv.append(img); } else pv.append(el('b', '', file.mime_type === 'application/pdf' ? 'PDF' : 'Archivo'));
    host.append(pv, el('h3', '', file.display_name), el('small', 'cloud-detail-meta', dateLabel(file.created_at) + ' · ' + formatBytes(file.size_bytes)));
    if (inTrash) {
      host.append(el('p', 'cloud-trash-note', 'En la papelera. Se elimina definitivamente en ' + trashDaysLeft(file.trashed_at) + ' días.'));
      if (can.manage) { var row = el('div', 'cloud-detail-actions'); row.append(btn('Restaurar', 'btn btn-primary btn-sm', function () { trash([file.id], false); }), btn('Eliminar para siempre', 'btn btn-secondary btn-sm cloud-danger', function () { deleteForever([file.id]); })); host.append(row); }
      return;
    }
    var fields = el('div', 'cloud-fields');
    var typeSelect = document.createElement('select'); typeSelect.disabled = !can.manage; typeSelect.append(new Option('Sin clasificar', ''));
    CATEGORIES.forEach(function (entry) { typeSelect.append(new Option(entry[1], entry[0])); }); typeSelect.value = file.category || '';
    typeSelect.onchange = function () { patchFile(file.id, { category: typeSelect.value }); };
    var typeLabel = el('label', '', 'Tipo'); typeLabel.append(typeSelect);
    var folderSelect = document.createElement('select'); folderSelect.disabled = !can.manage; folderSelect.append(new Option('Sin carpeta', ''));
    ((state.summary && state.summary.folders) || []).forEach(function (folder) { folderSelect.append(new Option(folder.name, folder.id)); }); folderSelect.value = file.folder_id || '';
    folderSelect.onchange = function () { patchFile(file.id, { folder_id: folderSelect.value }); };
    var folderLabel = el('label', '', 'Carpeta'); folderLabel.append(folderSelect);
    fields.append(typeLabel, folderLabel);
    var patientBlock = el('div', 'cloud-field'); patientBlock.append(el('label', '', 'Paciente'));
    if (file.patient_id) {
      var line = el('div', 'cloud-linked'); line.append(el('b', '', state.patients[file.patient_id] || 'Paciente'));
      if (can.manage) line.append(btn('Quitar', 'cloud-link', function () { patchFile(file.id, { patient_id: '' }); })); patientBlock.append(line);
      var appts = state.appointments[file.patient_id] || [];
      var apptSelect = document.createElement('select'); apptSelect.disabled = !can.manage; apptSelect.setAttribute('aria-label', 'Cita vinculada'); apptSelect.append(new Option('Sin cita', ''));
      appts.forEach(function (appt) { apptSelect.append(new Option(dateLabel(appt.starts_at) + ' · ' + appt.status, appt.id)); }); apptSelect.value = file.appointment_id || '';
      apptSelect.onchange = function () { patchFile(file.id, { appointment_id: apptSelect.value }); };
      var apptLabel = el('label', '', 'Cita'); apptLabel.append(apptSelect); patientBlock.append(apptLabel);
    } else if (can.manage && can.clinical) {
      var search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Buscar paciente para vincular…'; search.autocomplete = 'off';
      var hits = el('div', 'cloud-hits'); var timer = null;
      search.oninput = function () { clearTimeout(timer); hits.innerHTML = ''; timer = setTimeout(async function () { try { (await searchPatients(search.value)).forEach(function (person) { hits.append(btn(patientLabel(person) + (person.telefono ? ' · ' + person.telefono : ''), 'cloud-hit', function () { patchFile(file.id, { patient_id: person.id }); })); }); } catch (_) {} }, 250); };
      patientBlock.append(search, hits);
    } else patientBlock.append(el('small', '', 'Sin paciente vinculado.'));
    fields.append(patientBlock);
    var notes = document.createElement('textarea'); notes.rows = 3; notes.maxLength = 1000; notes.value = file.notes || ''; notes.disabled = !can.manage; notes.placeholder = 'Notas del archivo';
    notes.onchange = function () { patchFile(file.id, { notes: notes.value }); };
    var notesLabel = el('label', '', 'Notas'); notesLabel.append(notes); fields.append(notesLabel);
    host.append(fields);
    if (can.share && state.sharesReady) {
      var shareBlock = el('div', 'cloud-field'); shareBlock.append(el('label', '', 'Enlaces para compartir'));
      var mine = (state.shares[file.id] || []).filter(function (share) { return shareState(share) === 'active'; });
      if (!mine.length) shareBlock.append(el('small', '', 'Este archivo no está compartido.'));
      mine.forEach(function (share) {
        var row = el('div', 'cloud-linked'); var info = el('span'); info.append(el('b', '', 'Vence ' + dateLabel(share.expires_at) + (share.requires_code ? ' · con código' : '')), el('small', '', share.view_count ? share.view_count + (share.view_count === 1 ? ' vez abierto' : ' veces abierto') : 'Sin abrir todavía'));
        row.append(info, btn('Revocar', 'cloud-link cloud-danger', function () { revokeShare(share); })); shareBlock.append(row);
      });
      host.append(shareBlock);
    }
    var actions = el('div', 'cloud-detail-actions'); actions.append(btn('Descargar', 'btn btn-secondary btn-sm', function () { download(file); }));
    if (can.share && state.sharesReady) actions.append(btn('Compartir', 'btn btn-primary btn-sm', function () { openShare(file); }));
    if (can.manage) {
      actions.append(btn('Renombrar', 'btn btn-secondary btn-sm', function () { var name = win.prompt('Nuevo nombre', file.display_name); if (name && name.trim()) patchFile(file.id, { display_name: name.trim() }); }));
      actions.append(btn('Mover a la papelera', 'btn btn-secondary btn-sm cloud-danger', function () { trash([file.id], true); }));
    }
    host.append(actions);
  }

  function renderNotice() {
    var host = document.getElementById('cloud-notice'); if (!host) return;
    host.innerHTML = ''; if (!state.notice) { host.hidden = true; return; }
    host.hidden = false; host.className = 'cloud-notice is-' + state.notice.tone; host.setAttribute('role', state.notice.tone === 'error' ? 'alert' : 'status'); host.textContent = state.notice.text;
  }

  function render() {
    var page = document.getElementById('p-nube'); if (!page) return;
    var sidebar = page.querySelector('[data-cloud-side]'); var main = page.querySelector('[data-cloud-main]'); var detail = page.querySelector('[data-cloud-detail]');
    if (state.loading && !state.summary) { main.innerHTML = ''; main.append(el('p', 'cloud-state', 'Abriendo la Nube…')); sidebar.innerHTML = ''; detail.innerHTML = ''; return; }
    if (state.error) { main.innerHTML = ''; var box = el('div', 'cloud-state is-warn'); box.append(el('p', '', state.error), btn('Reintentar', 'btn btn-secondary btn-sm', function () { refresh(); })); main.append(box); sidebar.innerHTML = ''; detail.innerHTML = ''; return; }
    if (!perms().read) { main.innerHTML = ''; main.append(el('p', 'cloud-state', 'Tu rol no tiene acceso a la Nube. Pide a quien administra la clínica el permiso «Ver la Nube».')); sidebar.innerHTML = ''; detail.innerHTML = ''; return; }
    renderSidebar(sidebar);
    main.innerHTML = '';
    var tools = el('div', 'cloud-tools'); var search = document.createElement('input'); search.type = 'search'; search.className = 'cloud-search'; search.placeholder = 'Buscar por nombre…'; search.value = state.search; search.setAttribute('aria-label', 'Buscar archivos');
    var timer = null; search.oninput = function () { state.search = search.value; clearTimeout(timer); timer = setTimeout(function () { reloadList().then(function () { var again = document.querySelector('#p-nube .cloud-search'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }); }, 300); };
    var modeBtn = btn(state.mode === 'grid' ? '☰ Lista' : '▦ Cuadrícula', 'btn btn-secondary btn-sm', function () { state.mode = state.mode === 'grid' ? 'list' : 'grid'; render(); });
    tools.append(search, modeBtn); main.append(tools);
    var title = { all: 'Todos los archivos', recent: 'Recientes', unclassified: 'Sin clasificar', nopatient: 'Sin paciente', trash: 'Papelera', shared: 'Compartidos', category: 'Tipo: ' + (CATEGORY_LABEL[state.view.value] || ''), folder: 'Carpeta', patient: 'Paciente' }[state.view.kind];
    if (state.view.kind === 'folder') { var folder = ((state.summary.folders) || []).find(function (f) { return f.id === state.view.value; }); title = 'Carpeta: ' + (folder ? folder.name : ''); }
    if (state.view.kind === 'patient') title = 'Paciente: ' + (state.patients[state.view.value] || '');
    var head = el('div', 'cloud-head'); head.append(el('h2', '', title));
    if (state.view.kind === 'folder' && perms().manage) { head.append(btn('Renombrar', 'cloud-link', function () { saveFolder(state.view.value); }), btn('Eliminar carpeta', 'cloud-link cloud-danger', function () { deleteFolder(state.view.value); })); }
    if (state.view.kind === 'trash' && perms().manage && state.files.length) head.append(btn('Vaciar papelera', 'cloud-link cloud-danger', function () { deleteForever(state.files.map(function (f) { return f.id; })); }));
    main.append(head);
    var live = el('div', 'cloud-notice'); live.id = 'cloud-notice'; live.hidden = true; main.append(live);
    if (!state.files.length) {
      var empty = el('div', 'cloud-empty');
      empty.append(el('strong', '', state.search ? 'No hay archivos con ese nombre.' : state.view.kind === 'trash' ? 'La papelera está vacía.' : 'Todavía no hay archivos aquí.'));
      if (!state.search && state.view.kind !== 'trash' && perms().upload) empty.append(el('p', '', 'Sube fotos, radiografías o documentos y vincúlalos a un paciente.'), btn('Subir archivos', 'btn btn-primary btn-sm', function () { openUpload(); }));
      main.append(empty);
    } else {
      var grid = el('div', 'cloud-grid' + (state.mode === 'list' ? ' is-list' : '')); state.files.forEach(function (file) { grid.append(fileTile(file)); }); main.append(grid);
    }
    renderNotice(); renderDetail(detail);
  }

  function build() {
    var page = el('section', 'pantalla cloud-page'); page.id = 'p-nube';
    var head = el('header', 'cloud-page-head'); var copy = el('div'); copy.append(el('span', 'pro-eyebrow', 'ARCHIVO DE LA CLÍNICA'), el('h1', '', 'Nube'), el('p', '', 'Fotos, radiografías y documentos en un solo lugar, ordenados y vinculados a tus pacientes.')); head.append(copy);
    var layout = el('div', 'cloud-layout'); var side = el('aside', 'cloud-side'); side.dataset.cloudSide = ''; var main = el('div', 'cloud-main'); main.dataset.cloudMain = ''; var detail = el('aside', 'cloud-detail'); detail.dataset.cloudDetail = '';
    layout.append(side, main, detail); page.append(head, layout);
    page.addEventListener('dragover', function (event) { if (perms().upload && event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1) event.preventDefault(); });
    page.addEventListener('drop', function (event) { if (!perms().upload || !event.dataTransfer || !event.dataTransfer.files.length) return; event.preventDefault(); openUpload(event.dataTransfer.files); });
    var host = document.querySelector('.contenido'); if (host) host.append(page);
  }

  function init() {
    if (!win || !win.ir || document.getElementById('p-nube')) return;
    if (win.TITULOS) win.TITULOS.nube = 'Nube';
    build();
    var previous = win.ir;
    win.ir = function (route) { var result = previous(route); if (route === 'nube') refresh(); return result; };
  }

  if (win && win.document) { if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', init); else init(); }
  return { formatBytes: formatBytes, safeName: safeName, guessCategory: guessCategory, checkFile: checkFile, trashDaysLeft: trashDaysLeft, escapeLike: escapeLike };
});
