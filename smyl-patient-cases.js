/* Professional UI bridge. A missing backend is an explicit unavailable state,
 * never a demo result, local save or fallback to the legacy case endpoint. */
(function () {
  'use strict';
  const M = window.SmylCaseModel, C = window.SmylCaseClient;
  const $ = id => document.getElementById(id);
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n; };
  const button = (text, action, cls) => { const b = node('button', cls || 'pc-secondary', text); b.type = 'button'; b.addEventListener('click', action); return b; };
  const displayName = p => [p.nombre, p.apellido].filter(Boolean).join(' ');
  let busy = false, attempt = null, saved = null, api = null, snap = null, connectionTenant = null, sequence = 0;
  let linkedPatient = null, linkedTenant = null, autoAttempt = null, autoSnap = null, lastAutoSnap = null, autoBusy = false, autoFailed = false;
  const equalSnap = (a,b) => a && b && a.photos.length === b.photos.length && a.photos.every((p,i) => p.view === b.photos[i].view && p.original === b.photos[i].original && p.result === b.photos[i].result);
  function autoStatus(message) { if ($('pc-state')) $('pc-state').textContent = message; }
  async function autoSave(retry) {
    if (!linkedPatient || autoBusy || busy || !professionalStudio() || CFG.tenantId !== linkedTenant || CFG.userId !== linkedTenant || (autoFailed && !retry)) return;
    let next; try { next = M.snapshot(S); } catch (_) { return; }
    if (!autoAttempt && equalSnap(next,lastAutoSnap)) return;
    autoBusy = true; autoStatus('Guardando en ' + displayName(linkedPatient) + '…');
    try {
      const tenant = linkedTenant, patient = linkedPatient.id;
      const current = () => professionalStudio() && CFG.tenantId === tenant && CFG.userId === tenant && linkedTenant === tenant && linkedPatient?.id === patient;
      const client = await C.connect(window.sbAuth, tenant, current);
      if (!autoAttempt) { autoSnap = next; const id = crypto.randomUUID(); autoAttempt = {id,patient_id:patient,...await M.prepare(next,tenant,id)}; }
      await client.save(autoAttempt);
      lastAutoSnap = autoSnap; autoAttempt = null; autoFailed = false;
      autoStatus('Guardado en ' + displayName(linkedPatient) + ' · sin aprobar tratamiento');
      $('pc-save-entry').textContent = 'Abrir ficha del paciente';
    } catch (_) { autoFailed = true; autoStatus('No se pudo confirmar el guardado. Conserva esta pantalla.'); $('pc-save-entry').textContent = 'Reintentar guardado'; }
    finally { autoBusy = false; }
  }
  const inStudio = () => typeof CFG !== 'undefined' && typeof S !== 'undefined';
  const professionalStudio = () => inStudio() && !CFG.modoProspecto && (new URLSearchParams(location.search).get('workspace') === 'professional' || (!!CFG.userId && CFG.userId === CFG.tenantId));
  function studioCurrent() {
    return professionalStudio() && CFG.tenantId === connectionTenant && CFG.userId === connectionTenant;
  }
  function snapshotMatches() {
    try { return studioCurrent() && M.same(M.snapshot(S), snap); } catch (_) { return false; }
  }
  function feedback(error) { $('pc-save-feedback').textContent = M.message(error); }
  function mode() {
    const fresh = $('pc-mode-new').checked;
    $('pc-existing').hidden = fresh; $('pc-new').hidden = !fresh;
    $('pc-name').required = fresh; $('pc-name').disabled = !fresh;
    $('pc-patient').required = !fresh; $('pc-patient').disabled = fresh;
  }
  async function openSave() {
    if (!professionalStudio() || busy) return;
    if (saved && snapshotMatches()) { $('pc-save-dialog').showModal(); return; }
    $('pc-save-dialog').showModal();
    if (attempt) { $('pc-submit').disabled = false; return; }
    const token = ++sequence;
    saved = null; api = null;
    $('pc-form').hidden = false; $('pc-saved').hidden = true;
    $('pc-fields').disabled = true; $('pc-submit').disabled = true; $('pc-submit').textContent = 'Guardar en su ficha';
    $('pc-save-feedback').textContent = 'Preparando el guardado…';
    try {
      snap = M.snapshot(S); connectionTenant = CFG.tenantId;
      const client = await C.connect(window.sbAuth, connectionTenant, studioCurrent);
      const patients = await client.patients();
      if (token !== sequence || !$('pc-save-dialog').open) return;
      if (!snapshotMatches()) M.fail('CASE_CHANGED');
      api = client; $('pc-form').reset();
      $('pc-patient').replaceChildren(new Option('Selecciona un paciente', ''));
      patients.forEach(p => $('pc-patient').append(new Option(displayName(p) + ' · ' + p.id.slice(-6), p.id)));
      $('pc-fields').disabled = false; $('pc-submit').disabled = false; mode();
      $('pc-save-feedback').textContent = 'Se conservarán ' + snap.photos.length + ' vistas, con originales y resultados por separado. No se genera otra imagen.';
    } catch (error) {
      if (token === sequence) feedback(error);
    }
  }
  function closeSave() {
    if (busy) return;
    ++sequence; $('pc-save-dialog').close(); $('pc-save-entry').focus();
  }
  async function save(event) {
    event.preventDefault();
    if (!api || busy || saved) return;
    busy = true; $('pc-fields').disabled = true; $('pc-submit').disabled = true; $('pc-close').disabled = true;
    $('pc-save-feedback').textContent = 'Guardando tus imágenes y su vínculo con el paciente…';
    try {
      if (!snapshotMatches()) M.fail('CASE_CHANGED');
      if (!attempt) {
        const id = crypto.randomUUID(), patient = $('pc-patient').value, name = $('pc-name').value.trim();
        if ($('pc-mode-new').checked ? !name : !M.uuid(patient)) M.fail('CASE_INVALID');
        const payload = await M.prepare(snap, connectionTenant, id);
        attempt = { id, ...payload };
        if ($('pc-mode-new').checked) attempt.new_patient = { id: crypto.randomUUID(), nombre: name };
        else attempt.patient_id = patient;
      }
      if (!snapshotMatches()) M.fail('CASE_CHANGED');
      saved = await api.save(attempt); attempt = null;
      linkedPatient = {id:saved.patient_id,nombre:$('pc-mode-new').checked ? $('pc-name').value.trim() : $('pc-patient').selectedOptions[0].textContent}; linkedTenant = connectionTenant;
      lastAutoSnap = snap; autoStatus('Guardado en ' + displayName(linkedPatient) + ' · sin aprobar tratamiento');
      $('pc-save-entry').textContent = 'Abrir ficha del paciente';
      $('pc-form').hidden = true; $('pc-saved').hidden = false;
      $('pc-save-feedback').textContent = 'Simulación guardada en la ficha. No se ha creado ni aprobado un tratamiento.';
      // Hash contains only an opaque ID, not names or images. Remove after reading.
      $('pc-open-patient').href = 'app.html#patient=' + encodeURIComponent(saved.patient_id);
      $('pc-open-patient').focus();
    } catch (error) {
      feedback(error); $('pc-submit').textContent = attempt ? 'Reintentar guardado' : 'Volver a intentar';
      if (!attempt) $('pc-fields').disabled = false;
    } finally {
      busy = false; $('pc-submit').disabled = !studioCurrent(); $('pc-close').disabled = false;
    }
  }
  function initStudio() {
    const dialog = node('dialog', 'pc-dialog'); dialog.id = 'pc-save-dialog'; dialog.setAttribute('aria-labelledby','pc-save-title');
    dialog.innerHTML = '<p class="pc-eyebrow">CONTINÚA EL CASO</p><h2 id="pc-save-title">Guardar en un paciente</h2><p>Elige su ficha o empieza una nueva. Lo demás puede esperar.</p><form id="pc-form"><fieldset id="pc-fields" disabled><legend class="pc-sr">Paciente</legend><div class="pc-options"><label><input type="radio" name="pc-mode" checked> Ya tiene ficha</label><label><input id="pc-mode-new" type="radio" name="pc-mode"> Es nuevo</label></div><div id="pc-existing"><label for="pc-patient">Paciente</label><select id="pc-patient" required><option value="">Selecciona un paciente</option></select></div><div id="pc-new" hidden><label for="pc-name">Nombre</label><input id="pc-name" maxlength="150" autocomplete="off" disabled></div></fieldset><button id="pc-submit" class="pc-primary" disabled>Guardar en su ficha</button></form><div id="pc-saved" hidden><a id="pc-open-patient" class="pc-primary">Abrir ficha del paciente</a></div><p id="pc-save-feedback" role="status"></p>';
    const close = button('Volver a la simulación', closeSave); close.id = 'pc-close'; dialog.append(close); document.body.append(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); closeSave(); });
    $('pc-form').addEventListener('submit', save); dialog.querySelectorAll('[name="pc-mode"]').forEach(input => input.addEventListener('change', mode));
    const entry = node('section', 'pc-entry');
    const text = node('div'), status = node('p','','Sin guardar en paciente'); status.id = 'pc-state'; status.setAttribute('role','status');
    text.append(node('h2','','Tu simulación'),status);
    const start = button('Guardar en un paciente', () => {
      if (autoBusy) return;
      if (autoFailed) return autoSave(true);
      if (linkedPatient) { location.href = 'app.html#patient=' + encodeURIComponent(linkedPatient.id); return; }
      return openSave();
    }, 'pc-primary'); start.id = 'pc-save-entry'; entry.append(text,start);
    $('s-res').querySelector('.res-body').prepend(entry);
    // Only the professional workspace uses the new connector. Public lead/LANA
    // legacy flows remain untouched and are not called as fallback by this route.
    const previousSave = window.guardarCaso;
    window.guardarCaso = function () { return professionalStudio() ? openSave() : previousSave(); };
    const sync = () => { entry.hidden = !professionalStudio(); if ($('case-actions-box')) $('case-actions-box').hidden = professionalStudio(); };
    new MutationObserver(sync).observe(document.body, { attributes:true, attributeFilter:['class'], subtree:true }); sync();
    const params = new URLSearchParams(location.search), requestedPatient = params.get('patient'), requestedTenant = params.get('clinic');
    let linking = false;
    async function tick() {
      if (M.uuid(requestedPatient) && !linkedPatient && !linking && professionalStudio() && CFG.userId) {
        linking = true;
        try {
          if (CFG.tenantId !== requestedTenant || CFG.userId !== requestedTenant) throw new Error('Wrong clinic');
          const client = await C.connect(window.sbAuth, requestedTenant, () => CFG.tenantId === requestedTenant && CFG.userId === requestedTenant);
          const patients = await client.patients(); const patient = patients.find(p => p.id === requestedPatient);
          if (!patient) throw new Error('Missing patient');
          linkedPatient = patient; linkedTenant = requestedTenant;
          autoStatus('Paciente: ' + displayName(patient) + ' · las vistas aceptadas se guardarán automáticamente');
          $('pc-save-entry').textContent = 'Abrir ficha del paciente';
        } catch (_) { autoStatus('No se pudo verificar la ficha. Selecciona el paciente para guardar.'); }
      }
      await autoSave(false);
    }
    setInterval(tick,1500); tick();
    addEventListener('beforeunload', e => { let pending=false; try { pending=linkedPatient && !equalSnap(M.snapshot(S),lastAutoSnap); } catch (_) {} if (busy || attempt || autoBusy || autoAttempt || pending) { e.preventDefault(); e.returnValue = ''; } });
    if (window.sbAuth?.auth?.onAuthStateChange) sbAuth.auth.onAuthStateChange(() => {
      if (!connectionTenant || studioCurrent()) return;
      if (!busy) { attempt = null; saved = null; snap = null; api = null; }
      $('pc-fields').disabled = true; $('pc-submit').disabled = true; $('pc-saved').hidden = true; feedback({code:'CASE_CHANGED'});
    });
  }
  function initPanel() {
    let activeGallery = null, urls = [], thumbnails = [], viewerSequence = 0;
    let myPreview = null;
    function closeMyPreview(run = myPreview) {
      if (!run || run.closed) return;
      run.closed = true; clearInterval(run.watch); run.controller?.destroy(); run.composer?.destroy();
      run.review = null; run.reviewSource = null;
      run.dialog.close(); run.dialog.remove(); run.urls.forEach(URL.revokeObjectURL);
      if (myPreview === run) myPreview = null;
      if (run.focus?.isConnected) run.focus.focus({preventScroll:true});
    }
    async function openMyPreview(api, row, current) {
      closeMyPreview();
      if (!current() || !window.MySmyl || window.miRolEquipo !== 'dueño') return;
      const dialog = node('dialog','ms-preview-dialog'), bar = node('div','ms-preview-bar'), host = node('div');
      dialog.setAttribute('aria-label','Vista previa de mySmyl');
      const run = {dialog,urls:[],closed:false,focus:document.activeElement}; myPreview = run;
      const valid = () => !run.closed && current() && window.miRolEquipo === 'dueño' && $('p-paciente-detalle').classList.contains('activa') && (!run.reviewSource || run.reviewSource.isCurrent());
      const actions=node('div','ms-preview-actions');
      const prepare=button('Preparar mi revisión',()=>{
        if(!valid()){closeMyPreview(run);return;}
        run.reviewSource=run.reviewSource || window.SmylClinicalPreview?.capture(row.tenant_id,row.patient_id) || null;
        run.controller?.destroy();run.controller=null;prepare.hidden=true;
        run.composer=window.MySmylReview.mount(host,{
          source:run.reviewSource,previous:run.review,
          onCancel:()=>showPreview(run.review?'review':'smile'),
          onPreview:review=>{if(!valid()){closeMyPreview(run);return;}run.review=review;showPreview('review');},
          onRemove:()=>{if(!valid()){closeMyPreview(run);return;}run.review=null;showPreview('review');}
        });
        dialog.scrollTop=0;
      });prepare.disabled=true;
      actions.append(prepare,button('Volver al expediente',()=>closeMyPreview(run)));
      bar.append(node('span','','mySmyl · vista previa'),actions);
      function showPreview(initialTab='smile'){
        if(!valid()){closeMyPreview(run);return;}
        const fromComposer=!!run.composer;
        run.composer?.destroy();run.composer=null;
        run.controller=window.MySmyl.mount(host,{views:run.views,review:run.review,initialTab});
        prepare.hidden=false;prepare.disabled=!window.MySmylReview;
        prepare.textContent=run.review?'Editar mi revisión':'Preparar mi revisión';
        dialog.scrollTop=0;
        if(fromComposer||initialTab==='review')host.querySelector('[role="tab"][aria-selected="true"]')?.focus({preventScroll:true});
      }
      host.append(node('p','ms-preview-loading','Abriendo las imágenes de esta simulación…'));
      dialog.append(bar,host);document.body.append(dialog);dialog.showModal();
      dialog.addEventListener('cancel',e=>{e.preventDefault();closeMyPreview(run);});
      dialog.addEventListener('close',()=>closeMyPreview(run));
      run.watch=setInterval(()=>{if(!valid())closeMyPreview(run);},200);
      try {
        const views=[];
        // Only this saved case. Supporting photos without a simulation are not
        // offered as before/after pairs. No diagnosis, plan or internal notes.
        for (const view of row.document.views.filter(v=>v.result)) {
          const pair={view:view.view};
          for (const role of ['original','result']) {
            const url=await api.image(row,view[role]);
            if(!valid()){URL.revokeObjectURL(url);closeMyPreview(run);return;}
            run.urls.push(url);pair[role]=url;
          }
          views.push(pair);
        }
        if(valid()){run.views=views;showPreview();}
      } catch (_) {
        if(!valid()){closeMyPreview(run);return;}
        run.urls.forEach(URL.revokeObjectURL);run.urls=[];
        const error=node('div','ms-preview-loading');error.append(node('p','','No pudimos abrir esta vista previa. No se ha compartido ninguna fotografía.'),button('Reintentar',()=>openMyPreview(api,row,current)));host.replaceChildren(error);
      }
    }
    const clearThumbnails = () => { thumbnails.forEach(URL.revokeObjectURL); thumbnails = []; };
    const revoke = () => { urls.forEach(URL.revokeObjectURL); urls = []; };
    const viewer = node('dialog', 'pc-dialog pc-viewer'); viewer.setAttribute('aria-label','Comparación guardada');
    const viewerContent = node('div');
    viewer.append(button('Cerrar comparación', () => viewer.close()), viewerContent); document.body.append(viewer);
    function mount() {
      const screen = $('p-paciente-detalle'), layout = screen?.querySelector('.clinic-layout');
      if (!layout || screen.querySelector('.pc-gallery') || !window.pacienteActual?.id) return;
      if (activeGallery && !activeGallery.isConnected) { closeMyPreview(); viewer.close(); viewerContent.replaceChildren(); revoke(); clearThumbnails(); }
      const patient = pacienteActual.id, tenant = tenantId;
      const gallery = node('section','pc-gallery'); activeGallery = gallery; gallery.dataset.patientId = patient;
      gallery.append(node('h2','','Simulaciones')); const body = node('div','pc-case-list'); gallery.append(body); layout.before(gallery);
      if (!pacienteActual._local && window.miRolEquipo === 'dueño') {
        const launch = node('a','pc-primary','Nueva simulación');
        launch.href = 'simulacion-rapida.html?workspace=professional&patient=' + encodeURIComponent(patient) + '&clinic=' + encodeURIComponent(tenant);
        gallery.insertBefore(launch,body);
        const mainLaunch = document.querySelector('.topbar-right a.btn-primary'); if (mainLaunch) mainLaunch.href = launch.href;
      }
      const current = () => gallery.isConnected && tenantId === tenant && pacienteActual?.id === patient;
      async function load() {
        body.textContent = 'Consultando sus simulaciones…';
        if (pacienteActual._local || window.miRolEquipo !== 'dueño') { body.textContent = 'La consulta de simulaciones requiere una ficha en nube y la cuenta titular.'; return; }
        try {
          const api = await C.connect(window.sb, tenant, current);
          const rows = await api.list(patient);
          if (!current()) return;
          body.replaceChildren();
          if (!rows.length) body.append(node('p','','Todavía no hay simulaciones vinculadas a esta ficha.'));
          rows.forEach((row,index) => {
            const card = node('article','pc-card'), description = node('div');
            description.append(node('h3','','Simulación de sonrisa'),node('p','',row.document.views.map(v => M.label(v.view)).join(' · ')));
            if (index === 0) {
              const preview = node('div','pc-pair'); preview.setAttribute('aria-label','Última simulación'); description.append(preview);
              const view = row.document.views.find(v => v.result);
              (async () => { try {
                for (const role of ['original','result']) {
                  const url = await api.image(row,view[role]);
                  if (!current()) { URL.revokeObjectURL(url); return; }
                  thumbnails.push(url); const figure=node('figure'), img=node('img'); img.src=url; img.alt=role==='original'?'Antes · original':'Después · simulación';
                  figure.append(img,node('figcaption','',img.alt)); preview.append(figure);
                }
              } catch (_) { if(current()) preview.append(node('p','','No se pudo cargar la vista previa. Abre la comparación para reintentar.')); } })();
            }
            const actions=node('div','ms-preview-entry');
            if(window.MySmylPortal){
              actions.append(node('strong','','Propuesta para tu paciente'),button('Preparar propuesta para el paciente',()=>window.MySmylPortal.open({api,row,current}),'pc-primary'),node('small','','1 Preparar → 2 Revisar → 3 Compartir. Te indicaremos qué falta en cada paso.'));
            }
            const tools=node('details','pc-case-tools');tools.append(node('summary','','Revisar fotos y otras opciones'));actions.append(tools);
            const reviewEntry=button('Revisar fotos y dientes',()=>window.SmylPhotoAnalysis?.open({api,row,current}));reviewEntry.dataset.reviewCase=row.id;tools.append(reviewEntry);
            tools.append(button('Ver comparación', async () => {
              const token = ++viewerSequence;
              viewerContent.textContent = 'Cargando imágenes privadas…'; viewer.showModal(); revoke();
              try {
                const pairs = [];
                for (const view of row.document.views) {
                  const pair = node('section','pc-pair'); pair.append(node('h3','',M.label(view.view)));
                  for (const role of ['original','result']) {
                    const figure = node('figure');
                    if (view[role]) {
                      const url = await api.image(row, view[role]);
                      if (!current() || !viewer.open || token !== viewerSequence) { URL.revokeObjectURL(url); return; }
                      urls.push(url); const img = node('img'); img.src = url; img.alt = role === 'original' ? 'Fotografía original' : 'Simulación orientativa'; figure.append(img);
                    } else figure.append(node('p','','Esta vista solo se guardó como fotografía de apoyo.'));
                    figure.append(node('figcaption','',role === 'original' ? 'Original' : view.result ? 'Simulación · no es un resultado clínico' : 'Sin generar')); pair.append(figure);
                  }
                  pairs.push(pair);
                }
                if (current() && viewer.open && token === viewerSequence) viewerContent.replaceChildren(...pairs);
              } catch (error) { if (current() && viewer.open && token === viewerSequence) { revoke(); viewerContent.textContent = M.message(error); } }
            }));
            tools.append(button('Vista previa de mySmyl',()=>openMyPreview(api,row,current)),node('small','','Consulta rápida. Para enviar la propuesta, usa el recorrido de tres pasos.'));
            card.append(description,actions); body.append(card);
          });
        } catch (error) { if (current()) body.replaceChildren(node('p','',['PGRST202','42883','CASE_UNAVAILABLE'].includes(error.code) ? 'Las simulaciones vinculadas aún no están activadas. Los casos anteriores siguen disponibles en Casos.' : M.message(error)),button('Volver a consultar', load)); }
      }
      load();
    }
    viewer.addEventListener('close', () => { ++viewerSequence; viewerContent.replaceChildren(); revoke(); });
    addEventListener('pagehide',()=>closeMyPreview());
    if (window.sb?.auth?.onAuthStateChange) sb.auth.onAuthStateChange((event, session) => {
      if (session?.user?.id === window.tenantId && !session.user.is_anonymous) return;
      closeMyPreview(); ++viewerSequence; viewer.close(); viewerContent.replaceChildren(); revoke(); clearThumbnails();
      window.SmylPhotoAnalysis?.close(); window.MySmylPortal?.close(true);
      if (activeGallery) activeGallery.replaceChildren(node('p','','La sesión cambió. Vuelve a abrir la ficha con la cuenta autorizada.'));
    });
    new MutationObserver(mount).observe($('p-paciente-detalle'), { childList:true, subtree:true });
    const previous = window.ir;
    window.ir = function(route) { const result = previous(route); if (result !== false && route !== 'paciente-detalle') { closeMyPreview(); window.MySmylPortal?.close(true); viewer.close(); revoke(); const launch = document.querySelector('.topbar-right a.btn-primary'); if (launch) launch.href = 'simulacion-rapida.html?workspace=professional'; } return result; };
    const target = /^#patient=([a-f0-9-]+)$/.exec(location.hash)?.[1];
    if (M.uuid(target)) {
      history.replaceState(null, '', location.pathname + location.search);
      // The ID does not grant access; actual session/RLS must provide the record.
      let opening = false;
      const tryOpen = async () => {
        if (opening || !window.tenantId || !window.sb) return;
        opening = true;
        try {
          const result = await sb.from('camila_pacientes').select('*').eq('tenant_id',tenantId).eq('id',target).single();
          if (result.error || !result.data || result.data.tenant_id !== tenantId) return;
          if (!todosLosPacientes.some(p => p.id === target)) todosLosPacientes.push(result.data);
          await window.verPaciente(target);
        } finally { authObserver.disconnect(); }
      };
      const authObserver = new MutationObserver(tryOpen); authObserver.observe(document.body, {attributes:true,subtree:true,attributeFilter:['style','class']}); tryOpen();
    }
  }
  function init() { if (inStudio()) initStudio(); else if ($('p-paciente-detalle')) initPanel(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
