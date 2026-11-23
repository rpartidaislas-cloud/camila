/* Five professional views, one private patient-file original per capture. */
(function () {
  'use strict';
  const views = [
    ['intraoral_frontal', 'Frontal', 'Centra ambas arcadas y alinea la toma con la línea media.'],
    ['intraoral_right', 'Lateral derecha', 'Encuadra los dientes del lado derecho del paciente.'],
    ['intraoral_left', 'Lateral izquierda', 'Encuadra los dientes del lado izquierdo del paciente.'],
    ['occlusal_upper', 'Oclusal superior', 'Centra la arcada superior e incluye sus superficies oclusales.'],
    ['occlusal_lower', 'Oclusal inferior', 'Centra la arcada inferior e incluye sus superficies oclusales.']
  ];
  const marker = /^Serie fotográfica guiada ([a-f0-9-]{36})\nVista: ([a-z_]+)$/;
  const mime = 'image/jpeg,image/png,image/webp';
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  function button(text, action, primary) {
    const node = el('button', primary ? 'gphoto-primary' : 'gphoto-secondary', text);
    node.type = 'button'; node.onclick = action; return node;
  }
  function restore(files, studies, tenant, patient) {
    const indexed = new Set(studies.filter(study => study.tenant_id === tenant && study.patient_id === patient && study.original?.status === 'active')
      .map(study => study.original.id+'|'+study.subtype));
    const rows = files.filter(row => row.tenant_id === tenant && row.patient_id === patient && row.status === 'active')
      .map(row => ({row, match:marker.exec(row.notes)}))
      .filter(({match}) => match && views.some(view => view[0] === match[2]))
      .sort((a,b) => String(b.row.created_at).localeCompare(String(a.row.created_at)));
    const id = rows[0]?.match[1] || crypto.randomUUID(), shots = new Map();
    for (const {row, match} of rows) {
      if (match[1] === id && !shots.has(match[2])) shots.set(match[2], {row, indexed:indexed.has(row.id+'|'+match[2])});
    }
    return {id,shots};
  }
  async function open({tenant, patient, patientName, current, mayOpen}) {
    const files = window.SmylPatientFiles, service = window.SmylClinicalPhotoService;
    const authorized = () => current() && files.access(tenant,patient)?.canWrite === true;
    if (!authorized() || !files.saveGuidedPhoto || !service?.indexPatientFile || !service?.list) throw new Error('No se pudo abrir la captura fotográfica con los permisos actuales.');
    let history;
    try { history = await service.list(tenant, patient, {force:true}); }
    catch (_) { throw new Error('No se pudo consultar el avance de las fotografías. Vuelve a intentarlo.'); }
    if (!authorized() || !mayOpen()) throw new Error('Cambió el expediente o se canceló la apertura.');
    if (!history.available) throw new Error(history.reason || 'La clasificación de fotografías no está disponible.');
    let series = restore(files.guidedOriginals(tenant,patient),history.studies,tenant,patient);
    let selected = null, previewUrl = '', uploadId = '', busy = false, alive = true;
    const dialog = el('dialog','gphoto-dialog');
    dialog.setAttribute('aria-labelledby','gphoto-title');
    const header = el('header','gphoto-header'), copy = el('div'), title = el('h2','','Fotografías guiadas');
    title.id = 'gphoto-title';
    copy.append(title,el('p','gphoto-patient',patientName));
    const close = button('Cerrar',() => { if (!busy) dialog.close(); });
    header.append(copy,close);
    const body = el('section','gphoto-body'), feedback = el('p','gphoto-feedback');
    feedback.setAttribute('role','status');
    const steps = el('ol','gphoto-steps'); steps.setAttribute('aria-label','Vistas de la serie');
    const summary = el('p','gphoto-count');
    const stage = el('section','gphoto-stage'), actions = el('footer','gphoto-actions');
    body.append(summary,steps,stage); dialog.append(header,body,feedback,actions);
    function clearSelection() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl=''; selected=null; uploadId='';
    }
    function dispose() {
      if (!alive) return;
      alive=false;clearSelection();
      if (dialog.open) dialog.close();
      dialog.remove();
    }
    function available() { return alive && authorized(); }
    function announce(message) { feedback.textContent=message; }
    function inputChoice(label,camera,onFile) {
      const field=el('label','gphoto-choice',label), input=el('input');
      input.type='file';input.accept=mime;
      if(camera) input.setAttribute('capture','environment');
      input.onchange=()=>{if(available() && !busy && input.files[0])onFile(input.files[0]);};
      field.append(input);return field;
    }
    function render(focus = false) {
      if (!available()) { dispose();return; }
      const count=views.filter(([key])=>series.shots.get(key)?.indexed).length;
      const index=views.findIndex(([key])=>!series.shots.get(key)?.indexed);
      summary.textContent=count+' de '+views.length+' vistas guardadas';
      steps.replaceChildren();stage.replaceChildren();actions.replaceChildren();
      for (const [i,[key,label]] of views.entries()) {
        const done=!!series.shots.get(key)?.indexed, item=el('li');
        item.dataset.state=done?'done':index===i?'current':'pending';
        if (index===i) item.setAttribute('aria-current','step');
        item.append(el('span','gphoto-step-number',done?'✓':String(i+1)),el('span','',label));
        if(done)item.setAttribute('aria-label',label+' guardada');
        steps.append(item);
      }
      const heading=el('h3'); heading.tabIndex=-1;
      stage.append(heading);close.disabled=busy;
      if(index<0){
        heading.textContent='Serie completa';
        stage.append(el('p','','Las cinco vistas están en los archivos clínicos de '+patientName+'.'));
        actions.append(button('Iniciar otra serie',()=>{series={id:crypto.randomUUID(),shots:new Map()};announce('');render(true);}),
          button('Terminar',()=>dialog.close(),true));
      }else{
        const [key,label,hint]=views[index], shot=series.shots.get(key);
        heading.textContent='Toma '+(index+1)+' · '+label;
        stage.append(el('p','',hint));
        if(shot?.row){
          stage.append(el('p','gphoto-pending','Original guardado. Falta confirmar su clasificación.'));
        }else{
          if(selected && previewUrl){
            const img=el('img','gphoto-preview');img.src=previewUrl;img.alt='Vista previa de '+label.toLowerCase();
            stage.append(img,el('p','gphoto-filename',selected.name));
          }
          function choose(file) {
            if(!mime.split(',').includes(file.type)||!file.size||file.size>10485760){announce('Elige una imagen JPG, PNG o WebP de hasta 10 MB.');return;}
            clearSelection();selected=file;previewUrl=URL.createObjectURL(file);uploadId=crypto.randomUUID();
            announce('Revisa la toma antes de guardarla.');render();
            actions.querySelector('.gphoto-primary')?.focus({preventScroll:true});
          }
          const choices=el('div','gphoto-choices');
          choices.append(inputChoice('Tomar con cámara',true,choose),inputChoice('Elegir archivo',false,choose));
          choices.querySelectorAll('input').forEach(input=>{input.disabled=busy;});stage.append(choices);
        }
        const save=button(busy?'Guardando…':shot?.row?'Confirmar clasificación':index===views.length-1?'Guardar última vista':'Guardar y continuar',async()=>{
          if(busy || !available() || (!selected && !shot?.row))return;
          busy=true;announce('Guardando la vista '+label.toLowerCase()+'…');render();
          let row=shot?.row;
          try{
            if(!row){
              row=await files.saveGuidedPhoto(tenant,patient,selected,{id:uploadId,notes:'Serie fotográfica guiada '+series.id+'\nVista: '+key,capturedAt:new Date().toISOString(),isCurrent:available});
              if (!available()) return;
              series.shots.set(key,{row,indexed:false});clearSelection();
            }
            if(!available())return;
            await service.indexPatientFile({tenant,patient,row,payload:{subtype:key,title:label,metadata:{guidedSeries:series.id}}});
            if(!available())return;
            series.shots.set(key,{row,indexed:true});announce(label+' guardada.');
          }catch(error){
            if(available())announce(row?'El original está guardado. Reintenta la clasificación para continuar.':error?.message||'No se pudo guardar esta toma. Reintenta con la misma imagen.');
          }finally{busy=false;if(alive)render(true);}
        },true);
        save.disabled=busy||(!selected&&!shot?.row);actions.append(save);
      }
      if(focus)heading.focus({preventScroll:true});
    }
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',dispose,{once:true});
    document.body.append(dialog);render();dialog.showModal();close.focus({preventScroll:true});
    return {dispose};
  }
  window.SmylGuidedPhotos=Object.freeze({open});
})();
