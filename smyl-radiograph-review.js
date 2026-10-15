/* Dentist-controlled radiograph review: consent, one AI call, manual placement and explicit confirmation. */
(function(){
 'use strict';let active=null;
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='rr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 function close(run=active,force=false){if(!run||run.closed)return;if(!force&&(run.busy||run.dirty)&&!confirm(run.busy?'¿Cerrar? La solicitud puede seguir procesándose y generar consumo.':'Hay cambios sin guardar. ¿Cerrar sin conservarlos?'))return;run.closed=true;run.abort?.abort();URL.revokeObjectURL(run.url);run.dialog.close();run.dialog.remove();if(active===run)active=null;run.focus?.focus?.({preventScroll:true});}
 async function open({study,blob,tenant,patient,current}){
  if(active){close();if(active)return;}if(!(blob instanceof Blob)||!current()){alert('Vuelve a abrir la radiografía desde la ficha.');return;}
  const dialog=n('dialog','rr-dialog'),bar=n('header','rr-bar'),host=n('div','rr-host'),run={dialog,host,study,blob,tenant,patient,current,url:URL.createObjectURL(blob),revision:0,doc:null,store:null,dirty:false,busy:false,closed:false,focus:document.activeElement,placing:null};active=run;
  const valid=()=>!run.closed&&current()&&window.miRolEquipo==='dueño'&&window.tenantId===tenant&&window.pacienteActual?.id===patient;
  bar.append(n('div','',null),button('Volver al expediente',()=>close(run)));bar.firstChild.append(n('span','rr-kicker','SMYL · RADIOGRAFÍA'),n('strong','','Revisión asistida'));dialog.append(bar,host);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();close(run);});dialog.addEventListener('close',()=>close(run,true));
  const status=(text,kind='')=>{let e=host.querySelector('.rr-feedback');if(!e){e=n('p','rr-feedback');e.setAttribute('role','status');host.prepend(e);}e.className='rr-feedback '+kind;e.textContent=text;};
  async function save(document){
   if(!valid()||!run.store||run.busy&&document===run.doc)return false;
   const saved=await run.store.save(document,run.revision);if(!valid())return false;run.doc=saved.document;run.revision=saved.revision;run.dirty=false;dispatchEvent(new CustomEvent('smyl:radiograph-review-saved',{detail:{tenant,patient,study:study.id}}));return true;
  }
  function imagePanel(doc,clickable=false){
   const wrap=n('div','rr-image-wrap'),stage=n('div','rr-image-stage'),img=n('img');img.src=run.url;img.alt='Radiografía original · '+(study.label||study.type);stage.append(img);wrap.append(stage);
   (doc?.items||[]).filter(i=>i.x!==null&&i.state!=='rejected').forEach((item,index)=>{const mark=button(String(index+1),()=>{run.placing=item.id;render();},'rr-mark rr-mark-'+item.state);mark.style.left=item.x*100+'%';mark.style.top=item.y*100+'%';mark.setAttribute('aria-label','Ubicación de observación '+(index+1));stage.append(mark);});
   if(clickable)img.onclick=e=>{if(!run.placing)return;const item=run.doc.items.find(i=>i.id===run.placing),r=img.getBoundingClientRect();if(!item)return;item.x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));item.y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));item.state='pending';run.placing=null;run.dirty=true;render();};
   return wrap;
  }
  function editItem(item,index){
   const card=n('article','rr-item rr-item-'+item.state),head=n('header');head.append(n('span','rr-number',String(index+1)),n('strong','',item.state==='confirmed'?'Confirmada':item.state==='rejected'?'Descartada':'Por revisar'));card.append(head);
   const source=run.doc.analysis.report.observations.find(o=>o.id===item.sourceId);card.append(n('p','rr-source',source.evidence));
   const label=n('label','','Diente relacionado'),select=n('select');select.add(new Option('Observación general',''));SmylDentalModel.teeth.forEach(t=>select.add(new Option('Diente '+t,t)));select.value=item.tooth;select.onchange=()=>{item.tooth=select.value;item.state='pending';run.dirty=true;render();};label.append(select);
   const text=n('textarea');text.rows=3;text.maxLength=600;text.value=item.text;text.setAttribute('aria-label','Texto de la observación '+(index+1));text.oninput=()=>{item.text=text.value;item.state='pending';run.dirty=true;};
   const locate=button(item.x===null?'Ubicar en la imagen':'Cambiar ubicación',()=>{run.placing=item.id;render();});
   const confirm=button('Confirmar',()=>{if(!item.text.trim()){status('Escribe qué observaste antes de confirmar.','rr-error');return;}if(item.x===null){run.placing=item.id;status('Toca en la radiografía el punto que corresponde a esta observación.','rr-error');render();return;}item.state='confirmed';run.placing=null;run.dirty=true;render();},'rr-primary');
   const reject=button('Descartar',()=>{item.state='rejected';run.placing=null;run.dirty=true;render();});
   card.append(label,text,n('small','',item.x===null?'Falta ubicarla en la imagen.':'Ubicación indicada por el dentista.'),n('div','rr-actions',null));card.lastChild.append(locate,confirm,reject);return card;
  }
  function render(){
   if(!valid())return close(run,true);host.replaceChildren();
   if(!run.store){host.append(n('section','rr-empty',null));host.firstChild.append(n('h1','','Revisión asistida preparada'),n('p','','El guardado privado de esta fase aún no está activado. La radiografía no se enviará a IA desde esta pantalla.'),n('p','rr-note','Puedes seguir usando “Abrir y anotar” para registrar observaciones manuales.'));return;}
   if(!run.doc){
    const intro=n('section','rr-intro');intro.append(n('p','rr-step','1 de 3 · Comprobar imagen'),n('h1','','Revisar esta radiografía con apoyo de IA'),n('p','','La IA puede señalar zonas para que las compruebes. No diagnostica, no decide tratamientos y no escribe directamente en el mapa dental.'),imagePanel(null));
    const privacy=n('div','rr-privacy');privacy.append(n('strong','','Qué se enviará'),n('p','','Una copia JPEG de esta radiografía, sin nombre, notas, fotografías ni simulaciones. Puede reducirse su resolución; el original privado no cambia. La copia se envía a Claude/Anthropic mediante el servicio de SMYL. Esta acción puede generar consumo.'));
    const consent=n('input');consent.type='checkbox';const permission=n('label','rr-consent');permission.append(consent,document.createTextNode('Confirmo que tengo autorización del paciente y que revisaré profesionalmente cada sugerencia.'));
    const start=button('Iniciar revisión asistida',async()=>{if(!consent.checked||run.busy||!valid())return;run.busy=true;start.disabled=true;status('Guardando el inicio antes de enviar la imagen…');run.abort=new AbortController();try{let doc=SmylRadiographReviewModel.create(study);await save(doc);doc=SmylRadiographReviewModel.requested(run.doc);await save(doc);status('Revisando la copia… No cierres esta ventana.');const result=await SmylRadiographAnalysisClient.analyze({client:window.sb,tenant,study,blob,consent:true,current:valid,endpoint:window.EDGE_URL,publicKey:window.SUPA_KEY,signal:run.abort.signal});await save(SmylRadiographReviewModel.completed(run.doc,result));render();}catch(e){if(valid()){try{if(run.doc?.workflow.state==='requested')await save(SmylRadiographReviewModel.unconfirmed(run.doc));}catch(_){}render();status(e instanceof TypeError?'No se pudo confirmar la respuesta. No se repetirá automáticamente.':e.message,'rr-error');}}finally{run.busy=false;run.abort=null;}},'rr-primary');start.disabled=true;consent.onchange=()=>start.disabled=!consent.checked;intro.append(privacy,permission,n('div','rr-actions',null));intro.lastChild.append(start,button('Continuar con anotación manual',()=>close(run)));host.append(intro);return;
   }
   if(run.doc.workflow.state!=='completed'){
    const message=run.doc.workflow.state==='unconfirmed'?'La solicitud anterior no tuvo una respuesta confirmada. Para evitar un segundo cobro o resultados duplicados, no se repetirá desde esta revisión.':'La solicitud quedó registrada y aún no tiene una respuesta confirmada.';
    host.append(n('section','rr-empty',null));host.firstChild.append(n('h1','','Revisión sin resultado confirmado'),n('p','',message),n('p','rr-note','Continúa con las anotaciones manuales sobre la imagen original.'));return;
   }
   const report=run.doc.analysis.report,top=n('section','rr-review');top.append(n('p','rr-step','2 de 3 · Revisar y ubicar'),n('h1','','Comprueba cada sugerencia'),n('p','rr-quality rr-quality-'+report.quality,({usable:'Imagen utilizable',limited:'Imagen limitada',unusable:'Imagen no utilizable'})[report.quality]),n('p','',report.qualityNote));
   if(report.limitations.length){const list=n('ul','rr-limitations');report.limitations.forEach(x=>list.append(n('li','',x)));top.append(list);}
   if(run.placing){top.append(n('p','rr-place','Toca en la radiografía dónde corresponde la sugerencia seleccionada.'));}
   top.append(imagePanel(run.doc,true));const grid=n('div','rr-items');run.doc.items.forEach((item,index)=>grid.append(editItem(item,index)));top.append(grid);
   if(!run.doc.items.length)top.append(n('p','rr-note','La IA no propuso zonas para revisar. Esto no demuestra ausencia de problemas; continúa con tu valoración clínica.'));
   const confirmed=run.doc.items.filter(i=>i.state==='confirmed').length,pending=run.doc.items.filter(i=>i.state==='pending').length,footer=n('footer','rr-save');footer.append(n('div','',null));footer.firstChild.append(n('strong','','3 de 3 · Guardar revisión'),n('span','',confirmed+' confirmadas · '+pending+' por revisar'));
   const saveButton=button('Guardar revisión',async()=>{if(run.busy||!run.dirty)return;run.busy=true;saveButton.disabled=true;try{await save(structuredClone(run.doc));render();status('Revisión guardada. Solo tus observaciones confirmadas aparecerán en el mapa dental.','rr-ok');}catch(e){status(e.code==='40001'?'La revisión cambió en otra sesión. No se sobrescribió.':'No pudimos confirmar el guardado. Tus cambios siguen en esta pantalla.','rr-error');}finally{run.busy=false;}},'rr-primary');saveButton.disabled=!run.dirty;footer.append(saveButton);top.append(footer,n('p','rr-note','Esta revisión es privada y no se comparte con el paciente ni se convierte automáticamente en diagnóstico.'));host.append(top);
  }
  host.append(n('p','rr-feedback','Abriendo la revisión privada…'));
  try{run.store=await SmylRadiographReviewStore.connect(window.sb,{tenant,patient,study,current:valid});const row=await run.store.load();if(!valid())return;run.doc=row?.document||null;run.revision=row?.revision||0;render();}catch(e){if(valid()){run.store=null;render();status(['42P01','PGRST205','PGRST202','42883'].includes(e.code)||e.message.includes('no habilitada')?'Esta fase está preparada localmente, pero el guardado aún no está activado en la clínica.':e.message,'rr-error');}}
 }
 addEventListener('pagehide',()=>close(active,true));
 window.SmylRadiographReview={open,close:()=>close(active,true)};
})();
