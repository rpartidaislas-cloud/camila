/* Selected photos generate together. No backend, prompts or clinical gates change. */
(function(root){
  'use strict';
  let active=false;
  const source=p=>p.dataUrl||'data:'+(p.mimeType||'image/jpeg')+';base64,'+p.b64;
  const label=view=>CASE_VIEW_GROUPS.flatMap(g=>g.views).find(v=>v[0]===view)?.[1]||view;
  const targets=()=>S.photos.filter((p,i,all)=>!p.referenceOnly&&all.findIndex(other=>other.view===p.view)===i);
  const settings=()=>JSON.stringify([SmylSmileModes.normalize(S.smileDesign),S.vitaMode,S.vitaTone,S.vitaFinish,S.vitaIntensity,S.vitaConstruction]);
  const owner=()=>JSON.stringify([progressKey(),CFG.userId,CFG.tenantId,S.casoId]);
  function hash(text){let a=2166136261,b=5381;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}return text.length+':'+(a>>>0).toString(36)+':'+(b>>>0).toString(36);}
  function key(photo){
    const ref=referenciaDentalMaestraParaVista(photo.view);
    return hash(JSON.stringify([owner(),photo.view,source(photo),settings(),ref?.role==='original-anatomy'?ref.result:'']));
  }
  function state(photo){
    const receipt=S.photoBatchReceipts?.[photo.view];
    if(!receipt||receipt.key!==key(photo))return 'new';
    if(receipt.status==='accepted'&&S.results?.[photo.view])return 'ready';
    const pending=S.pendingGeneratedByView?.[photo.view];
    if(pending?.batchKey===receipt.key&&pending.photoSignature===firmaFotoParaRevalidacion(photo)&&pending.mode==='visual-preview-v3-tooth-lock')return 'review';
    return 'new';
  }
  function summary(){const photos=targets();return {count:photos.length,ready:photos.filter(p=>state(p)==='ready').length,review:photos.filter(p=>state(p)==='review').length};}
  function element(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;}
  function button(text,action,cls='flow-secondary'){const el=element('button',cls,text);el.type='button';el.onclick=action;return el;}
  async function run(){
    if(active||DEVICE_DIAG_ACTIVE)return;
    const photos=targets();if(!photos.length)return;
    active=true;
    const actor=owner(),config=settings(),snapshot=S.photos.map(p=>({photo:p,src:source(p),referenceOnly:!!p.referenceOnly}));
    const current=()=>owner()===actor&&settings()===config&&snapshot.length===S.photos.length&&snapshot.every(s=>S.photos.includes(s.photo)&&source(s.photo)===s.src&&!!s.photo.referenceOnly===s.referenceOnly);
    const rows=photos.map(photo=>({photo,key:key(photo),status:state(photo),candidate:null,error:null}));
    if(rows.every(row=>row.status==='ready')){
      try{S.baVistaActual=rows[0].photo.view;S.result=S.results[S.baVistaActual];await showResult();saveProgress('s-res');}
      finally{active=false;}
      return;
    }
    const previous=document.activeElement,dialog=element('dialog','smyl-batch');dialog.id='smyl-photo-batch';dialog.setAttribute('aria-labelledby','smyl-batch-title');
    const heading=element('h2','','Genera todas tus fotos');heading.id='smyl-batch-title';
    const description=element('p','smyl-batch-description');
    const list=element('div','smyl-batch-list');
    rows.forEach(row=>{const item=element('div','smyl-batch-photo');item.dataset.batchView=row.photo.view;const img=element('img');img.src=source(row.photo);img.alt='';const copy=element('div');row.statusEl=element('small');copy.append(element('strong','',label(row.photo.view)),row.statusEl);item.append(img,copy);list.append(item);});
    const refs=S.photos.filter(p=>p.referenceOnly),referenceList=element('details','smyl-batch-references');
    if(refs.length){referenceList.append(element('summary','',refs.length+' '+(refs.length===1?'foto solo de referencia':'fotos solo de referencia')));refs.forEach(photo=>{const item=element('figure');const img=element('img');img.src=source(photo);img.alt='';item.append(img,element('figcaption','',label(photo.view)));referenceList.append(item);});}
    const consent=element('label','smyl-batch-consent'),check=element('input');check.type='checkbox';check.id='smyl-batch-consent';
    consent.append(check,element('span','','Tengo autorización para enviar estas fotos y sus recortes dentales a OpenAI mediante SMYL. Las intraorales pueden servir de apoyo. Cada nueva imagen consume una simulación y puede tener coste.'));
    const status=element('p','smyl-batch-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const actions=element('div','smyl-batch-actions');
    dialog.append(heading,description,list);if(refs.length)dialog.append(referenceList);dialog.append(consent,status,actions);document.body.append(dialog);
    const names={new:'Por generar',ready:'Lista · se conserva',review:'Generada · falta revisar',generating:'Generando…',accepted:'Lista',failed:'Pendiente · no se completó',discarded:'Descartada · original conservado',stopped:'Pendiente · sin iniciar'};
    function paint(){rows.forEach(row=>{row.statusEl.textContent=names[row.status];row.statusEl.dataset.status=row.status;row.statusEl.title=row.error?.message||'';});}
    let processing=false,stop=false;
    let cancelWait=()=>{};
    const watch=setInterval(()=>{if(!current()){stop=true;dialog.close();dialog.hidden=true;cancelWait(false);}},200);
    function close(){dialog.close();dialog.remove();if(previous?.isConnected)previous.focus();}
    async function viewResults(){
      const row=rows.find(r=>['accepted','ready'].includes(r.status)&&S.results?.[r.photo.view]);
      if(row&&current()){S.baVistaActual=row.photo.view;S.result=S.results[row.photo.view];await showResult();saveProgress('s-res');}
    }
    try{
      const newCount=rows.filter(r=>r.status==='new').length,waiting=rows.filter(r=>r.status==='review').length;
      description.textContent=newCount?'Se generarán '+newCount+' '+(newCount===1?'foto':'fotos')+', una por una. Después revisarás los resultados. Las que ya están listas se conservan.':waiting?'Tus imágenes ya están generadas. Revísalas sin volver a llamar a la IA.':'Todas las fotos seleccionadas ya tienen su simulación.';
      consent.hidden=!newCount;
      const authorized=await new Promise(resolve=>{
        cancelWait=resolve;
        const cancel=button('Volver a las fotos',()=>resolve(false));
        const start=button(newCount?'Generar '+newCount+' '+(newCount===1?'foto':'fotos'):waiting?'Revisar generadas':'Ver simulaciones',()=>{if(!newCount||check.checked)resolve(true);},'flow-primary');start.id='smyl-batch-start';start.disabled=!!newCount;
        check.onchange=()=>{start.disabled=!check.checked;};actions.append(cancel,start);
        dialog.oncancel=e=>{e.preventDefault();resolve(false);};paint();dialog.showModal();cancel.focus();
      });
      if(!authorized||!current())return;
      cancelWait=()=>{};
      if(rows.every(r=>r.status==='ready')){await viewResults();return;}
      processing=true;heading.textContent='Preparando tus simulaciones';consent.hidden=true;referenceList.hidden=true;
      actions.replaceChildren(button('Detener después de esta foto',()=>{stop=true;status.textContent='Terminaremos la foto en curso. No se iniciará otra.';}));
      dialog.oncancel=e=>{e.preventDefault();stop=true;status.textContent='Terminaremos la foto en curso. No se iniciará otra.';};
      solicitarWakeLock();
      for(let index=0;index<rows.length;index++){
        const row=rows[index];if(row.status==='ready')continue;
        if(stop||!current()){row.status='stopped';paint();continue;}
        const cached=row.status==='review';
        row.status='generating';paint();
        status.textContent=(cached?'Preparando revisión':'Generando')+' '+(index+1)+' de '+rows.length+' · '+label(row.photo.view);
        S.photoBatchReceipts=S.photoBatchReceipts||{};
        S.photoBatchReceipts[row.photo.view]={key:row.key,status:'pending'};
        try{
          row.candidate=await generateSimulation('',row.photo,{
            requestId:cached?S.pendingGeneratedByView[row.photo.view].generation?.requestId||crearIdSolicitudIA():crearIdSolicitudIA(),
            reason:'fotos_seleccionadas',revalidateCached:cached,requireVisibleChange:true,
            batch:{isCurrent:current,key:row.key},onGenerated:registrarDiagnosticoUsado
          });
          if(!current())throw new Error('La sesión o las fotografías cambiaron.');
          row.status='review';
        }catch(error){
          row.status='failed';row.error=error;
          // No automatic retry after timeouts or errors. Stop the queue on a
          // quota/session error, but let independent photo errors keep others.
          if([401,402,403,429].includes(Number(error.status)))stop=true;
        }
        if(current())saveProgress('s-vita');paint();
      }
      liberarWakeLock();actions.replaceChildren();
      description.textContent='Revisa cada comparación antes de usarla. Aceptar o descartar no genera otra imagen.';
      heading.textContent='Revisa tus simulaciones';
      dialog.oncancel=e=>e.preventDefault();
      for(const row of rows){
        if(!row.candidate||!current())continue;
        status.textContent='Revisando · '+label(row.photo.view);
        try{
          const result=await row.candidate.review();
          if(!current())break;
          S.results=S.results||{};S.veneerBaseByView=S.veneerBaseByView||{};
          S.results[row.photo.view]=result;S.veneerBaseByView[row.photo.view]=result;
          // Local tone belongs to the previous result, never to these pixels.
          if(S.localToneByView)delete S.localToneByView[row.photo.view];
          if(S.alignedPreviewByView)delete S.alignedPreviewByView[row.photo.view];
          S.photoBatchReceipts[row.photo.view]={key:row.key,status:'accepted'};
          S.result=result;S.baVistaActual=row.photo.view;S.diagnosis=null;S.testPairedGeneration=false;
          S.dentalDesignMaster={view:row.photo.view,revision:Date.now()};row.status='accepted';
        }catch(error){row.status=error.discarded?'discarded':'failed';row.error=error;}
        if(current())saveProgress('s-vita');paint();
      }
      if(!current())return;
      processing=false;paint();heading.textContent='Tus fotos, en un solo lugar';
      const ready=rows.filter(r=>r.status==='ready'||r.status==='accepted').length;
      status.textContent=ready+' de '+rows.length+' simulaciones listas.';
      const failures=rows.filter(r=>r.status==='failed');
      description.textContent=ready===rows.length?'Puedes cambiar de vista para comparar cada antes y después.':'Las simulaciones aceptadas se conservan. Vuelve a las fotos para continuar con las pendientes. Un intento interrumpido puede haber consumido cupo; no lo repetimos automáticamente.';
      if(failures.length){const errors=element('ul','smyl-batch-errors');failures.forEach(row=>errors.append(element('li','',label(row.photo.view)+': '+String(row.error.message||'No se completó la imagen.').slice(0,300))));description.after(errors);}
      await new Promise(resolve=>{
        cancelWait=resolve;
        actions.append(button('Volver a las fotos',()=>resolve(false)));
        if(ready)actions.append(button('Ver simulaciones',()=>resolve(true),'flow-primary'));
        dialog.oncancel=e=>{e.preventDefault();resolve(false);};
      }).then(async view=>{if(view)await viewResults();});
    }finally{
      clearInterval(watch);if(processing)liberarWakeLock();active=false;close();
    }
  }
  root.SmylPhotoBatch={run,summary,targets,state,isActive:()=>active};
})(window);
