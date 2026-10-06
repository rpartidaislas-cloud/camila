/* Professional entry: choose originals, consent, one request, dentist review. */
(function(){
 'use strict';
 let active=null;
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='pr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 function close(run=active,force=false){
  if(!run||run.closed)return;
  if(!force&&(run.busy||run.dirty||run.saving)&&!confirm(run.busy?'¿Cerrar? La solicitud enviada puede seguir procesándose y generar consumo.':'Hay cambios sin confirmar en la nube. ¿Cerrar sin conservar estos últimos cambios?'))return;
  run.closed=true;clearInterval(run.watch);clearTimeout(run.saveTimer);run.abort?.abort();run.review?.destroy();run.doc=null;run.attempt=null;run.dialog.close();run.dialog.remove();run.urls.forEach(URL.revokeObjectURL);run.urls=[];run.photos=[];
  if(active===run)active=null;if(run.focus?.isConnected)run.focus.focus({preventScroll:true});
 }
 async function open({api,row,current}){
  if(active){close();if(active)return;}
  const draft=window.SmylDentalDraft?.capture(row.tenant_id,row.patient_id);
  if(!current()||window.miRolEquipo!=='dueño'||!draft){alert('Espera a que cargue el mapa dental de esta ficha. Si no está disponible, revisa su conexión antes de analizar.');return;}
  const dialog=n('dialog','pr-dialog'),bar=n('header','pr-bar'),host=n('div');dialog.setAttribute('aria-label','Revisión de fotos y dientes');
  const run={dialog,urls:[],photos:[],closed:false,busy:false,dirty:false,saving:false,failed:false,revision:0,focus:document.activeElement};active=run;
  const valid=()=>!run.closed&&current()&&draft.isCurrent()&&window.miRolEquipo==='dueño';
  bar.append(n('span','','SMYL · Revisión profesional'),button('Volver al expediente',()=>close(run)));dialog.append(bar,host);document.body.append(dialog);dialog.showModal();
  dialog.addEventListener('cancel',e=>{e.preventDefault();close(run);});dialog.addEventListener('close',()=>close(run,true));
  run.watch=setInterval(()=>{if(!valid())close(run,true);},200);
  host.append(n('p','pr-app','Abriendo las fotos originales de esta simulación…'));
  function status(){run.review?.setSaveState({dirty:run.dirty,saving:run.saving,failed:run.failed,conflict:run.conflict,revision:run.revision,available:!!run.store,savedDocument:run.savedDocument,message:run.message||''});}
  function changed(doc){
   if(!valid())return;run.doc=doc;run.dirty=true;status();clearTimeout(run.saveTimer);
   if(run.store&&!run.failed)run.saveTimer=setTimeout(()=>save(false),800);
  }
  async function save(explicit=true){
   clearTimeout(run.saveTimer);if(!valid()||!run.store||run.saving||(!explicit&&run.failed))return;
   run.saving=true;run.message='';status();
   try{
    while(valid()&&run.dirty){
     // Preserve an uncertain attempt for exact retry, even if the editor changed meanwhile.
     const attempt=run.attempt||(run.attempt={document:structuredClone(run.doc),revision:run.revision});
     const saved=await run.store.save(attempt.document,attempt.revision);if(!valid())return;
     run.revision=saved.revision;run.savedDocument=structuredClone(saved.document);run.attempt=null;run.failed=false;run.dirty=!SmylPhotoReviewModel.same(run.doc,saved.document);
     dispatchEvent(new CustomEvent('smyl:photo-review-saved',{detail:{tenant:row.tenant_id,patient:row.patient_id}}));
    }
   }catch(e){if(valid()){
    run.failed=true;run.message=e.code==='40001'?'Esta revisión cambió en otra sesión. No se sobrescribió. Conserva tus cambios y abre la versión guardada en otra pestaña antes de decidir.':'No pudimos confirmar el guardado. Tus cambios siguen aquí. Pulsa Guardar revisión para reintentar, sin repetir la IA.';
    if(e.code==='40001')run.conflict=true;
   }}finally{run.saving=false;if(valid())status();}
  }
  function review(photos,document){
   if(!valid())return;run.doc=structuredClone(document);
   run.review=SmylPhotoReview.mount(host,{photos,document:run.doc,multiEvidence:run.store?.multiEvidence===true,current:valid,onChange:changed,onSave:()=>{if(!run.conflict)save(true);},contextNotes:()=>draft.notes()});
   status();dialog.scrollTop=0;host.querySelector('h1')?.setAttribute('tabindex','-1');host.querySelector('h1')?.focus({preventScroll:true});
  }
  function choose(){
   const page=n('section','pr-app'),header=n('header','pr-heading');header.append(n('p','pr-kicker','FOTOGRAFÍAS ORIGINALES'),n('h1','','Observa. Comprueba. Decide.'),n('p','','Elige las fotos que quieres revisar. La IA puede sugerir detalles por comprobar; tú decides qué añadir al mapa dental.'));page.append(header);
   page.append(n('p','pr-status','Apoyo experimental, no un diagnóstico automático. Precisión clínica aún no validada. Solo dentición permanente; las radiografías se revisan por separado.'));
   if(!run.store)page.append(n('p','pr-storage-warning','El guardado privado de revisiones aún no está habilitado. Puedes explorar la revisión manual, pero no conservará el avance al cerrar. El análisis de IA está desactivado hasta habilitar el guardado.'));
   else page.append(n('p','pr-status','Las sugerencias y tus cambios se guardarán de forma privada para retomar esta revisión sin repetir el análisis. Solo las observaciones que confirmes aparecerán en el mapa del expediente.'));
   const fieldset=n('fieldset','pr-selection'),legend=n('legend','','Fotos para esta revisión');fieldset.append(legend);
   const grid=n('div','pr-choices'),inputs=[];
   run.photos.forEach(p=>{const label=n('label','pr-choice'),img=n('img'),check=n('input');img.src=p.url;img.alt=SmylCaseModel.label(p.view)+' · original';check.type='checkbox';check.checked=true;check.value=p.view;inputs.push(check);label.append(img,check,n('span','',SmylCaseModel.label(p.view)),n('small','','Original · sin simulación'));grid.append(label);});fieldset.append(grid);
   const privacy=n('section','pr-privacy');privacy.append(n('h2','','Antes de enviar'),n('p','','Se enviará una copia de las fotos seleccionadas a Claude/Anthropic mediante el servicio Supabase de SMYL. Puede reducirse su resolución; el original guardado no cambia. Las fotos pueden identificar al paciente. No se adjuntan nombres, historia clínica ni imágenes generadas.'),n('p','','Cada análisis puede generar consumo de IA. No hay reintentos automáticos. Cerrar durante el análisis no garantiza cancelar el procesamiento.'));
   const permission=n('label','pr-confirm'),consent=n('input');consent.type='checkbox';permission.append(consent,document.createTextNode('Confirmo que las fotos son del mismo paciente, corresponden a dentición permanente y cuento con autorización para enviarlas a Claude/Anthropic.'));privacy.append(permission);fieldset.append(privacy);
   const feedback=n('p','pr-feedback');feedback.setAttribute('role','status');page.append(fieldset,feedback);
   const selected=()=>run.photos.filter(p=>inputs.some(i=>i.checked&&i.value===p.view));
   const actions=n('div','pr-start-actions'),manual=button('Revisar sin IA',()=>{if(valid()&&!run.busy){review(selected(),SmylPhotoReviewModel.create(selected()));}});
   const analyze=button('Analizar fotos seleccionadas',async()=>{
    if(!valid()||!run.store||run.busy||!consent.checked||!selected().length)return;
    const photos=selected();run.busy=true;fieldset.disabled=true;manual.disabled=analyze.disabled=true;run.abort=new AbortController();
    feedback.textContent='Analizando los originales… Puede tardar alrededor de un minuto. No cierres esta ventana.';
    try{
     const result=await SmylPhotoAnalysisClient.analyze({client:window.sb,tenant:row.tenant_id,photos,consent:true,current:valid,endpoint:window.EDGE_URL,publicKey:window.SUPA_KEY,signal:run.abort.signal});
     if(valid()){review(photos,SmylPhotoReviewModel.create(photos,result));run.dirty=true;await save(true);}
    }catch(e){if(valid())feedback.textContent=e.name==='AbortError'?'Se interrumpió la espera. La solicitud pudo haberse procesado.':e instanceof TypeError?'No se pudo confirmar la respuesta. La solicitud pudo haberse procesado; no se reintentó.':e.message;}
    finally{run.busy=false;if(valid()){fieldset.disabled=false;consent.checked=false;sync();}}
   },'pr-primary');
   function sync(){analyze.disabled=!run.store||run.busy||!consent.checked||!selected().length;manual.disabled=run.busy||!selected().length;analyze.textContent='Analizar '+selected().length+' foto'+(selected().length===1?'':'s');}
   inputs.forEach(i=>i.onchange=()=>{consent.checked=false;sync();});consent.onchange=sync;actions.append(manual,analyze);page.append(actions,n('p','pr-footer','Las intraorales son opcionales: pueden aportar más detalle. No se envía nada al paciente; primero revisas tú.'));host.replaceChildren(page);sync();
  }
  try{
   // Load only original assets, including intraorals used as optional support.
   for(const v of row.document.views){
    const url=await api.image(row,v.original);if(!valid()){URL.revokeObjectURL(url);close(run,true);return;}
    run.urls.push(url);run.photos.push({view:v.view,role:'original',url,sha256:v.original.sha256,bytes:v.original.bytes});
   }
   try{run.store=await SmylPhotoReviewStore.connect(window.sb,row,valid);}catch(e){
    if(!['PGRST202','PGRST205','42P01','42883'].includes(e.code)&&e.message!=='Guardado de revisiones no habilitado.')throw e;
    run.store=null;
   }
   if(!valid())return;
   if(run.store){const saved=await run.store.load();if(!valid())return;if(saved){run.revision=saved.revision;run.savedDocument=structuredClone(saved.document);review(run.photos.filter(p=>saved.document.photos.some(s=>s.view===p.view)),saved.document);return;}}
   choose();
  }catch(_){if(valid())host.replaceChildren(n('p','pr-app','No pudimos verificar las fotos o la revisión guardada. No se reemplazó ni se envió nada a IA. Cierra y vuelve a abrir cuando tengas conexión.'));}
 }
 addEventListener('pagehide',()=>close(active,true));
 addEventListener('beforeunload',e=>{if(active&&(active.busy||active.dirty||active.saving)){e.preventDefault();e.returnValue='';}});
 window.SmylPhotoAnalysis={open,close:()=>close(active,true)};
})();
