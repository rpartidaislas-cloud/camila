/* Private dental workspace. Saved, confirmed photo observations are projected separately. */
(function(){
 'use strict';
 const M=window.SmylDentalModel,bucket='smyl-radiographs';let active=null;
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn)=>{const e=n('button','dr-button',text);e.type='button';e.onclick=fn;return e;};
 const types={panoramic:'Panorámica',periapical:'Periapical',bitewing:'Aleta de mordida',other:'Otra radiografía'};
 function input(label,value,max,tag='textarea'){
  const box=n('label','dr-field',label),e=n(tag);e.value=value||'';e.maxLength=max;if(tag==='textarea')e.rows=3;box.append(e);return {box,e};
 }
 const message=(ctx,text)=>{ctx.status.textContent=text;};
 const current=ctx=>active===ctx&&ctx.host.isConnected&&window.tenantId===ctx.tenant&&window.pacienteActual?.id===ctx.patient;
 async function checked(p){const r=await window.sbTimeout(p,20000);if(r.error)throw r.error;return r.data;}
 async function guard(ctx){
  const data=await checked(sb.auth.getUser());if(!current(ctx)||data?.user?.id!==ctx.tenant||data.user.is_anonymous!==false)throw new Error('La sesión cambió. Abre la ficha con la cuenta titular.');
 }
 function errorText(e){return e.code==='40001'?'La ficha cambió en otra sesión. Tus notas siguen aquí; recarga la ficha antes de guardar.':e.code==='PGRST205'||e.code==='42P01'||e.code==='PGRST202'?'Este espacio aún no está habilitado para guardar en la clínica.':e.code==='42501'?'Tu cuenta no tiene permiso para guardar en esta ficha.':e.message?.startsWith('Usa ')||e.message?.startsWith('El contenido')?e.message:'No pudimos confirmar la operación. Conserva esta pantalla y vuelve a intentar.';}
 function dispose(ctx){if(!ctx)return;ctx.urls.forEach(URL.revokeObjectURL);ctx.urls=[];ctx.dialogs.forEach(d=>d.remove());}
 function mayLeave(){if(!active)return true;if(active.busy){alert('Espera a que termine el guardado o la carga.');return false;}return !active.dirty||confirm('Hay observaciones dentales sin guardar. ¿Salir y descartarlas?');}
 function dirty(ctx){ctx.dirty=true;ctx.save.disabled=!ctx.ready;message(ctx,'Cambios sin guardar · pulsa Guardar observaciones.');}
 // Read-only UI progress. Counts never confer a diagnosis or approval.
 window.SmylDentalProgress={status(tenant,patient,caseId){
  const ctx=active;if(!ctx||!current(ctx)||ctx.tenant!==tenant||ctx.patient!==patient||window.miRolEquipo!=='dueño')return null;
  const review=(ctx.photoReviews||[]).find(r=>r.case_id===caseId),items=review?.document.items||[];
  const stages=review?.document.schema===3&&Array.isArray(review.document.workflow?.stages)?review.document.workflow.stages:[];
  const rxItems=(ctx.rxReviews||[]).flatMap(r=>r.document.items||[]);
  return {ready:ctx.ready,dirty:ctx.dirty,busy:ctx.busy,photoLoaded:ctx.photoLoaded===true,
   hasReview:!!review,pending:items.filter(i=>i.state==='pending').length,confirmed:items.filter(i=>i.state==='confirmed').length,
   rejected:items.filter(i=>i.state==='rejected').length,workflowTotal:stages.length,
   workflowCompleted:stages.filter(s=>s.state==='completed').length,
   workflowPending:stages.filter(s=>s.state!=='completed').length,studies:ctx.doc.studies.length,rxLoaded:ctx.rxLoaded===true,
   rxReviews:(ctx.rxReviews||[]).length,rxPending:rxItems.filter(i=>i.state==='pending').length,
   rxConfirmed:rxItems.filter(i=>i.state==='confirmed').length,rxRejected:rxItems.filter(i=>i.state==='rejected').length};
  },planContext(tenant,patient,caseId){
   const ctx=active;
   const snapshot=()=>{
    if(!ctx||!current(ctx)||ctx.tenant!==tenant||ctx.patient!==patient||window.miRolEquipo!=='dueño'||!SmylCaseModel.uuid(caseId))return null;
    const review=(ctx.photoReviews||[]).find(r=>r.case_id===caseId),photoItems=review?.document.items||[];
    const stages=review?.document.schema===3&&Array.isArray(review.document.workflow?.stages)?review.document.workflow.stages:[];
    const rxItems=(ctx.rxReviews||[]).flatMap(r=>r.document.items||[]);
    const pending=photoItems.filter(i=>i.state==='pending').length+stages.filter(s=>s.state!=='completed').length+rxItems.filter(i=>i.state==='pending').length;
    const evidence=[];
    for(const [tooth,note] of Object.entries(ctx.doc.teeth||{})){
     const text=[note.observation&&'Observación del dentista: '+note.observation,note.action&&'Acción propuesta por el dentista: '+note.action].filter(Boolean).join('\n');
     if(text.trim())evidence.push({source:'manual_map',tooth,text:text.slice(0,1200)});
    }
    for(const item of photoItems.filter(i=>i.state==='confirmed'))evidence.push({source:'photo_confirmed',tooth:item.tooth||'',text:item.text.slice(0,1200)});
    for(const item of rxItems.filter(i=>i.state==='confirmed'))evidence.push({source:'radiograph_confirmed',tooth:item.tooth||'',text:item.text.slice(0,1200)});
    const limitations=[...(review?.document.analysis?.report?.limitations||[]),...(ctx.rxReviews||[]).flatMap(r=>r.document.analysis?.report?.limitations||[])].filter((v,i,a)=>typeof v==='string'&&v.trim()&&a.indexOf(v)===i).slice(0,20).map(v=>v.slice(0,400));
    const data={ready:ctx.ready&&!ctx.busy&&!ctx.dirty&&ctx.photoLoaded===true&&ctx.rxLoaded===true&&!!review&&pending===0,pending,evidence,limitations,caseId};
    return {...data,fingerprint:JSON.stringify(data)};
   };
   const value=snapshot();if(!value)return null;
   return {...value,isCurrent:()=>{const next=snapshot();return !!next&&next.fingerprint===value.fingerprint;}};
  }};
 // Does not grant access or save remotely. Existing save/RLS/versioning remain authoritative.
 window.SmylDentalDraft={capture(tenant,patient){
  const ctx=active;
  const valid=()=>!!ctx&&current(ctx)&&ctx.tenant===tenant&&ctx.patient===patient&&ctx.ready&&window.miRolEquipo==='dueño'&&document.getElementById('p-paciente-detalle')?.classList.contains('activa');
  if(!valid())return null;
  return {isCurrent:valid,notes:()=>valid()?structuredClone(ctx.doc.teeth):{},async appendConfirmed(item,source){
   if(!valid()||ctx.busy)throw new Error('El mapa no está listo. Espera a que termine el guardado.');
   await guard(ctx);if(!valid()||ctx.busy)throw new Error('La ficha cambió. Vuelve a abrir la revisión.');
   const note=window.SmylPhotoFindings.recordNote(item,source),old=ctx.doc.teeth[item.tooth]||{observation:'',action:'',status:'pending'};
   const observation=[old.observation,note].filter(Boolean).join('\n\n');
   if(observation.length>2000)throw new Error('Esta pieza ya tiene muchas notas. No se sobrescribió nada. Cierra la revisión y resume sus observaciones antes de añadir otra.');
   ctx.doc.teeth[item.tooth]={...old,observation};dirty(ctx);renderTeeth(ctx);
  }};
 }};
 function dialog(ctx,title){const d=n('dialog','dr-dialog');d.setAttribute('aria-label',title);d.append(n('h2','',title));document.body.append(d);ctx.dialogs.push(d);return d;}
 function photoNotes(ctx,tooth){return (ctx.photoReviews||[]).flatMap(r=>r.document.items.filter(i=>i.tooth===tooth&&i.state==='confirmed').map(i=>({item:i,row:r})));}
 function photoCard(ctx,entry,closeDialog){
  const {item,row}=entry,card=n('article','dr-note');
  card.append(n('strong','','Diente '+item.tooth+' · observación confirmada'),n('p','',item.text),n('small','','Revisión fotográfica privada · '+new Date(row.updated_at).toLocaleDateString('es-MX')));
  card.append(button('Abrir revisión',()=>{if(!current(ctx))return;const target=document.querySelector('[data-review-case="'+row.case_id+'"]');if(target){closeDialog?.();target.click();}else message(ctx,'Espera a que carguen las simulaciones de esta ficha.');}));return card;
 }
 function radiographNotes(ctx,tooth){return (ctx.rxReviews||[]).flatMap(r=>r.document.items.filter(i=>i.tooth===tooth&&i.state==='confirmed').map(i=>({item:i,row:r,study:ctx.doc.studies.find(s=>s.id===r.study_id)}))).filter(x=>x.study);}
 function radiographCard(ctx,entry,closeDialog){
  const {item,row,study}=entry,card=n('article','dr-note dr-rx-note');
  card.append(n('strong','','Diente '+item.tooth+' · revisión radiográfica confirmada'),n('p','',item.text),n('small','',(study.label||types[study.type])+' · '+new Date(row.updated_at).toLocaleDateString('es-MX')));
  card.append(button('Abrir radiografía',()=>{closeDialog?.();viewStudy(ctx,study);}));return card;
 }
 async function loadPhotoReviews(ctx){
  const token=(ctx.photoLoad||0)+1;ctx.photoLoad=token;
  try{
   await guard(ctx);const rows=await checked(sb.from('smyl_photo_reviews').select('*').eq('tenant_id',ctx.tenant).eq('patient_id',ctx.patient));
   if(!current(ctx)||token!==ctx.photoLoad)return;
   if(!Array.isArray(rows)||rows.some(r=>r.tenant_id!==ctx.tenant||r.patient_id!==ctx.patient||r.updated_by!==ctx.tenant||!SmylCaseModel.uuid(r.case_id)||!Number.isInteger(r.revision)||r.revision<1||!Number.isFinite(Date.parse(r.updated_at))||!SmylPhotoReviewModel.validate(r.document)))throw new Error('Revisión no verificada');
    ctx.photoLoaded=true;ctx.photoReviews=rows;ctx.photoStatus.textContent=rows.length?'El mapa incluye observaciones fotográficas confirmadas. Las sugerencias pendientes permanecen en su revisión.':'';renderTeeth(ctx);dispatchEvent(new CustomEvent('smyl:dental-context-updated',{detail:{tenant:ctx.tenant,patient:ctx.patient}}));
  }catch(e){if(current(ctx)&&token===ctx.photoLoad){ctx.photoLoaded=false;ctx.photoReviews=[];renderTeeth(ctx);ctx.photoStatus.textContent=['42P01','PGRST205'].includes(e.code)?'El guardado de revisiones fotográficas aún no está activado.':'No se pudieron actualizar las revisiones fotográficas; no se muestran hasta verificar su estado. Las notas manuales siguen disponibles.';}}
 }
 async function loadRadiographReviews(ctx){
  const token=(ctx.rxLoad||0)+1;ctx.rxLoad=token;
  try{
   await guard(ctx);const rows=await checked(sb.from('smyl_radiograph_reviews').select('*').eq('tenant_id',ctx.tenant).eq('patient_id',ctx.patient));
   if(!current(ctx)||token!==ctx.rxLoad)return;
   if(!Array.isArray(rows)||rows.some(r=>{const study=ctx.doc.studies.find(s=>s.id===r.study_id);return !study||!SmylRadiographReviewModel.validRow(r,study,ctx.tenant,ctx.patient);} ))throw new Error('Revisión radiográfica no verificada');
    ctx.rxLoaded=true;ctx.rxReviews=rows;ctx.rxStatus.textContent=rows.length?'Las observaciones radiográficas confirmadas están vinculadas a su imagen original. Las pendientes permanecen en su revisión.':'La revisión asistida es opcional. Nada se añade al mapa sin tu confirmación.';renderTeeth(ctx);renderStudies(ctx);dispatchEvent(new CustomEvent('smyl:dental-context-updated',{detail:{tenant:ctx.tenant,patient:ctx.patient}}));
  }catch(e){if(current(ctx)&&token===ctx.rxLoad){ctx.rxLoaded=false;ctx.rxReviews=[];renderTeeth(ctx);renderStudies(ctx);ctx.rxStatus.textContent=['42P01','PGRST205','PGRST202'].includes(e.code)?'La revisión asistida está preparada, pero su guardado privado aún no está activado.':'No se pudieron verificar las revisiones radiográficas; no se muestran hasta recuperar su estado.';}}
 }
 function toothDialog(ctx,tooth){
  if(!ctx.ready||ctx.busy)return;
  const old=ctx.doc.teeth[tooth]||{observation:'',action:'',status:'pending'},d=dialog(ctx,'Diente '+tooth);
  photoNotes(ctx,tooth).forEach(entry=>d.append(photoCard(ctx,entry,()=>d.close())));
  radiographNotes(ctx,tooth).forEach(entry=>d.append(radiographCard(ctx,entry,()=>d.close())));
  const observation=input('Observación del dentista',old.observation,2000),action=input('Acción propuesta',old.action,2000);
  const state=n('select');state.setAttribute('aria-label','Estado');[['pending','Pendiente'],['following','En seguimiento'],['done','Realizado']].forEach(([v,t])=>state.add(new Option(t,v)));state.value=old.status;
  d.append(observation.box,action.box,state,n('p','dr-help','Se incorpora al borrador; guarda las observaciones al terminar.'));
  d.append(button('Volver',()=>d.close()),button('Aplicar al borrador',()=>{if(!current(ctx))return;ctx.doc.teeth[tooth]={observation:observation.e.value,action:action.e.value,status:state.value};dirty(ctx);renderTeeth(ctx);d.close();}));
  d.showModal();observation.e.focus();
 }
 function renderTeeth(ctx){
  ctx.map.replaceChildren();
  const svgNode=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));return e;};
  const arch=svgNode('svg',{viewBox:'0 0 520 760',class:'dr-arch-base','aria-hidden':'true'});
  const curve='M125 348 C110 269 111 178 142 121 C166 76 206 62 260 62 C314 62 354 76 378 121 C409 178 410 269 395 348';
  arch.append(svgNode('path',{d:curve}),svgNode('path',{d:curve,transform:'translate(0 760) scale(1 -1)'}));ctx.map.append(arch);
  ctx.map.append(n('span','dr-arch-label dr-upper','Arcada superior'),n('span','dr-arch-label dr-lower','Arcada inferior'));
  // Original schematic occlusal silhouettes; positions are presentation only.
  const positions=[[235,64,-5,42,40],[191,74,-20,36,38],[156,100,-38,37,42],[133,141,-65,40,43],[123,187,-80,42,45],[120,240,-88,50,51],[121,296,-90,49,49],[125,348,-92,45,47]];
  const shapes={
   incisor:['M12 9 Q30 4 48 9 Q53 13 50 26 L45 47 Q42 53 30 54 Q18 53 15 47 L10 26 Q7 13 12 9Z','M15 17 Q30 12 45 17 M19 42 Q30 48 41 42'],
   canine:['M30 5 Q39 7 47 17 Q53 27 47 43 Q42 54 30 56 Q18 54 13 43 Q7 27 13 17 Q21 7 30 5Z','M18 22 L30 13 L42 22 M19 43 Q30 49 41 43'],
   premolar:['M16 7 Q24 4 30 8 Q39 3 46 11 Q54 20 50 32 Q53 44 43 51 Q35 57 28 52 Q17 56 11 44 Q5 32 10 20 Q9 12 16 7Z','M17 18 Q25 12 30 20 Q37 12 44 20 M17 41 Q24 48 30 40 Q36 48 43 39'],
   molar:['M12 8 Q22 3 30 8 Q40 3 49 12 Q55 19 51 30 Q56 40 48 49 Q40 57 30 52 Q20 57 11 49 Q4 41 8 30 Q3 18 12 8Z','M16 17 Q23 12 29 19 L35 15 Q42 12 46 21 M14 39 Q20 47 28 41 L34 45 Q42 48 46 39 M12 29 L19 30 M42 30 L49 28']
  };
  for(const [row,ids] of [[0,M.upper],[1,M.lower]])ids.forEach((id,i)=>{
   const unit=id%10,[px,py,angle,w,h]=positions[unit-1],left=i<8,x=left?px:520-px,y=row?760-py:py;
   const kind=unit<3?'incisor':unit===3?'canine':unit<6?'premolar':'molar';
   const note=ctx.doc.teeth[id],reviewed=photoNotes(ctx,String(id)).length,rxReviewed=radiographNotes(ctx,String(id)).length,b=button('',()=>toothDialog(ctx,String(id)));
   b.className='dr-tooth'+(note?' dr-noted dr-'+note.status:rxReviewed?' dr-rx-reviewed':reviewed?' dr-photo-reviewed':'');b.style.left=x/5.2+'%';b.style.top=y/7.6+'%';b.style.width=w/5.2+'%';b.style.height=h/7.6+'%';
   const crown=svgNode('svg',{viewBox:'0 0 60 60','aria-hidden':'true',class:'dr-crown'});
   crown.style.transform='rotate('+((left?angle:-angle)*(row?-1:1)+(row?180:0))+'deg) scale(1.15)';
   crown.append(svgNode('path',{d:shapes[kind][0],class:'dr-enamel'}),svgNode('path',{d:shapes[kind][1],class:'dr-fissure'}));
   b.append(crown,n('span','dr-tooth-number',String(id)));b.dataset.toothKind=kind;
   b.setAttribute('aria-label','Diente '+id+(note||reviewed||rxReviewed?' · con observación':' · sin observaciones'));b.disabled=!ctx.ready;
   ctx.map.append(b);
  });
  const legend=n('div','dr-map-legend');[['plain','Sin anotación'],['pending','Pendiente'],['following','En seguimiento'],['done','Realizado']].forEach(([state,label])=>{const item=n('span','dr-key dr-key-'+state,label);legend.append(item);});
  if((ctx.photoReviews||[]).some(r=>r.document.items.some(i=>i.state==='confirmed')))legend.append(n('span','dr-key dr-key-photo-reviewed','Observación fotográfica confirmada'));
  if((ctx.rxReviews||[]).some(r=>r.document.items.some(i=>i.state==='confirmed')))legend.append(n('span','dr-key dr-key-rx-reviewed','Revisión radiográfica confirmada'));
  ctx.map.append(legend);
  ctx.notes.replaceChildren();
  for(const [id,note] of Object.entries(ctx.doc.teeth)){
   const item=n('article','dr-note');item.append(button('Diente '+id,()=>toothDialog(ctx,id)),n('p','',note.observation||'Sin observación escrita'),n('p','',note.action||'Sin acción propuesta'),n('small','',{'pending':'Pendiente','following':'En seguimiento','done':'Realizado'}[note.status]));ctx.notes.append(item);
  }
  for(const tooth of M.teeth)photoNotes(ctx,tooth).forEach(entry=>ctx.notes.append(photoCard(ctx,entry)));
  for(const tooth of M.teeth)radiographNotes(ctx,tooth).forEach(entry=>ctx.notes.append(radiographCard(ctx,entry)));
 }
 async function imageBlob(ctx,study){
  let blob=ctx.files.get(study.id);
  if(!blob){await guard(ctx);blob=await checked(sb.storage.from(bucket).download(study.asset.path));}
  if(!(blob instanceof Blob)||blob.size!==study.asset.bytes||await M.hash(await blob.arrayBuffer())!==study.asset.sha256)throw new Error('Imagen no verificada');
  if(!current(ctx))throw new Error('La sesión cambió');return blob;
 }
 async function imageUrl(ctx,study){const blob=await imageBlob(ctx,study),url=URL.createObjectURL(blob);ctx.urls.push(url);return {blob,url};
 }
 function markDialog(ctx,study,mark,refresh){
  const d=dialog(ctx,'Anotación en la radiografía'),note=input('Observación del dentista',mark.note,2000);
  const tooth=n('select');tooth.setAttribute('aria-label','Diente relacionado');tooth.add(new Option('Observación general',''));M.teeth.forEach(t=>tooth.add(new Option('Diente '+t,t)));tooth.value=mark.tooth;
  const xpos=input('Posición horizontal (%)',String(Math.round(mark.x*100)),3,'input'),ypos=input('Posición vertical (%)',String(Math.round(mark.y*100)),3,'input');
  [xpos,ypos].forEach(f=>{f.e.type='number';f.e.min=0;f.e.max=100;});
  d.append(note.box,tooth,xpos.box,ypos.box,button('Cancelar',()=>d.close()),button('Aplicar al borrador',()=>{
   if(!current(ctx)||!xpos.e.reportValidity()||!ypos.e.reportValidity())return;
   const next={...mark,note:note.e.value,tooth:tooth.value,x:Number(xpos.e.value)/100,y:Number(ypos.e.value)/100};
   const index=study.marks.findIndex(m=>m.id===mark.id);if(index<0){if(study.marks.length>=50)return;study.marks.push(next);}else study.marks[index]=next;
   dirty(ctx);refresh();d.close();
  }));d.showModal();note.e.focus();
 }
 async function viewStudy(ctx,study){
  const d=dialog(ctx,study.label||types[study.type]),loading=n('p','','Cargando imagen privada…');d.append(loading);d.append(button('Cerrar',()=>d.close()));d.showModal();
  let url,blob;
  d.addEventListener('close',()=>{if(url){URL.revokeObjectURL(url);ctx.urls=ctx.urls.filter(u=>u!==url);}},{once:true});
  try{
   const image=await imageUrl(ctx,study);url=image.url;blob=image.blob;if(!current(ctx)||!d.open){URL.revokeObjectURL(url);return;}loading.remove();
   const tools=n('div','dr-tools'),zoom=n('input');zoom.type='range';zoom.min=1;zoom.max=3;zoom.step=.25;zoom.value=1;zoom.setAttribute('aria-label','Ampliar radiografía');
   const viewport=n('div','dr-viewport'),stage=n('div','dr-image-stage'),img=n('img');img.src=url;img.alt='Radiografía original · '+(study.label||types[study.type]);stage.append(img);viewport.append(stage);
   const marks=n('div','dr-marks'),list=n('div','dr-mark-list');stage.append(marks);
   function refresh(){marks.replaceChildren();list.replaceChildren();study.marks.forEach((m,i)=>{
    const b=button(String(i+1),()=>markDialog(ctx,study,m,refresh));b.className='dr-mark';b.style.left=m.x*100+'%';b.style.top=m.y*100+'%';b.setAttribute('aria-label','Anotación '+(i+1));marks.append(b);
    const item=n('article','dr-note');item.append(n('strong','',(i+1)+'. '+(m.tooth?'Diente '+m.tooth:'General')),n('p','',m.note||'Sin texto'),button('Editar',()=>markDialog(ctx,study,m,refresh)),button('Quitar marca',()=>{study.marks=study.marks.filter(x=>x.id!==m.id);dirty(ctx);refresh();}));list.append(item);
   });}
   const add=(x,y)=>{if(study.marks.length<50)markDialog(ctx,study,{id:crypto.randomUUID(),x,y,tooth:'',note:''},refresh);};
   img.onclick=e=>{const r=img.getBoundingClientRect();add((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);};
   zoom.oninput=()=>stage.style.width=Number(zoom.value)*100+'%';
   const assisted=button('Revisar con apoyo de IA',()=>{if(ctx.files.has(study.id)||ctx.dirty){message(ctx,'Guarda primero la radiografía y cualquier cambio pendiente.');return;}d.close();window.SmylRadiographReview?.open({study,blob,tenant:ctx.tenant,patient:ctx.patient,current:()=>current(ctx)&&ctx.ready&&!ctx.dirty});});
   tools.append(n('span','','Ampliar'),zoom,button('Añadir marca',()=>add(.5,.5)),assisted);
   const notes=input('Observaciones de este estudio',study.notes,4000);notes.e.oninput=()=>{study.notes=notes.e.value;dirty(ctx);};
   d.append(tools,n('p','dr-help','Toca la imagen para marcar un punto, o utiliza Añadir marca. El original no se modifica.'),viewport,list,notes.box,n('p','dr-help','Cierra el visor y pulsa Guardar observaciones para conservar tus cambios.'));refresh();
  }catch(e){loading.textContent=errorText(e);}
 }
 function renderStudies(ctx){
  ctx.studies.replaceChildren();
  if(!ctx.doc.studies.length)ctx.studies.append(n('p','dr-help','Todavía no hay radiografías en esta ficha.'));
  ctx.doc.studies.forEach(s=>{const review=(ctx.rxReviews||[]).find(r=>r.study_id===s.id),items=review?.document.items||[],summary=review?items.filter(i=>i.state==='confirmed').length+' confirmadas · '+items.filter(i=>i.state==='pending').length+' por revisar':'';const card=n('article','dr-study');card.append(n('h4','',s.label||types[s.type]),n('p','',types[s.type]+(s.date?' · '+s.date:'')),n('small','',ctx.files.has(s.id)?'Pendiente de guardar':summary||'Original privado'),button('Abrir y anotar',()=>viewStudy(ctx,s)));ctx.studies.append(card);});
 }
 async function addFile(ctx,file){
  if(!file||ctx.busy||!ctx.ready||ctx.doc.studies.length>=20)return;
  ctx.busy=true;ctx.form.disabled=true;message(ctx,'Preparando imagen sin modificar el original…');
  try{
   await guard(ctx);const id=crypto.randomUUID(),asset=await M.asset(file,ctx.tenant,ctx.patient,id);
   // Decode locally to reject malformed images; never transcode original bytes.
   const url=URL.createObjectURL(file);try{await new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>{img.src='';reject(new Error('Imagen no legible'));},15000);img.onload=()=>{clearTimeout(timer);img.naturalWidth*img.naturalHeight<=80000000?resolve():reject(new Error('Imagen demasiado grande'));};img.onerror=()=>{clearTimeout(timer);reject(new Error('Imagen no legible'));};img.src=url;});}finally{URL.revokeObjectURL(url);}
   if(!current(ctx))return;
   ctx.doc.studies.push({id,type:ctx.type.value,label:ctx.label.value.trim(),date:ctx.date.value,asset,notes:'',marks:[]});ctx.files.set(id,file);dirty(ctx);renderStudies(ctx);
  }catch(e){message(ctx,errorText(e));}finally{ctx.busy=false;if(current(ctx)){ctx.form.disabled=!ctx.ready;ctx.file.value='';}}
 }
 async function save(ctx){
  if(!ctx.ready||ctx.busy||!ctx.dirty)return;ctx.busy=true;ctx.form.disabled=true;ctx.save.disabled=true;message(ctx,'Guardando observaciones e imágenes privadas…');
  try{
   await guard(ctx);const doc=structuredClone(ctx.doc);if(!M.validate(doc,ctx.tenant,ctx.patient))throw new Error('Documento no válido');
   for(const s of doc.studies){const file=ctx.files.get(s.id);if(!file)continue;await guard(ctx);
    try{await checked(sb.storage.from(bucket).upload(s.asset.path,file,{contentType:s.asset.mime,upsert:false}));}
    catch(e){const existing=await checked(sb.storage.from(bucket).download(s.asset.path));if(!(existing instanceof Blob)||existing.size!==s.asset.bytes||await M.hash(await existing.arrayBuffer())!==s.asset.sha256)throw e;}
   }
   await guard(ctx);const row=await checked(sb.rpc('smyl_save_dental_record',{p_patient_id:ctx.patient,p_expected_revision:ctx.revision,p_document:doc}));
   if(!current(ctx))return;if(!row||row.patient_id!==ctx.patient||row.tenant_id!==ctx.tenant||!M.validate(row.document,ctx.tenant,ctx.patient)||!SmylCaseModel.same(row.document,doc))throw new Error('Respuesta no confirmada');
    ctx.revision=row.revision;ctx.doc=row.document;ctx.dirty=false;ctx.files.clear();renderStudies(ctx);message(ctx,'Observaciones guardadas · versión '+row.revision+'. No se ha aprobado ningún tratamiento.');dispatchEvent(new CustomEvent('smyl:dental-context-updated',{detail:{tenant:ctx.tenant,patient:ctx.patient}}));
  }catch(e){if(current(ctx)){if(e.code==='40001')ctx.ready=false;message(ctx,errorText(e));}}
  finally{ctx.busy=false;if(current(ctx)){ctx.form.disabled=!ctx.ready;ctx.save.disabled=!ctx.ready||!ctx.dirty;}}
 }
 async function mount(){
  const screen=document.getElementById('p-paciente-detalle'),layout=screen?.querySelector('.clinic-layout');
  if(!layout||screen.querySelector('.dr-record')||!window.pacienteActual?.id)return;
  dispose(active);
  const host=n('section','dr-record'),ctx={host,tenant:window.tenantId,patient:pacienteActual.id,doc:M.empty(),revision:0,ready:false,busy:false,dirty:false,files:new Map(),urls:[],dialogs:[],rxReviews:[],photoReviews:[]};active=ctx;
  host.append(n('p','dr-eyebrow','EXPEDIENTE DEL PACIENTE'),n('h2','','Mapa dental y radiografías'));
  ctx.status=n('p','dr-status','Cargando…');ctx.status.setAttribute('role','status');host.append(ctx.status);
  const form=n('fieldset','dr-form');ctx.form=form;form.disabled=true;
  const details=n('details','dr-section');details.append(n('summary','','Mapa dental'));
  details.append(n('p','dr-help','Dentición permanente · numeración FDI. Toca un diente para registrar una observación. Sin marca no significa sano: significa sin anotación.'));
  const orientation=n('div','dr-orientation');orientation.append(n('span','','Derecha del paciente'),n('span','','Izquierda del paciente'));details.append(orientation);
  ctx.map=n('div','dr-map');ctx.notes=n('div','dr-notes');details.append(ctx.map,ctx.notes);form.append(details);
  ctx.photoStatus=n('p','dr-help');details.append(ctx.photoStatus);
  const picker=n('select');picker.setAttribute('aria-label','Seleccionar diente');picker.add(new Option('Seleccionar diente…',''));M.teeth.forEach(t=>picker.add(new Option('Diente '+t,t)));picker.onchange=()=>{if(picker.value)toothDialog(ctx,picker.value);picker.value='';};details.insertBefore(picker,ctx.map);
  const rx=n('details','dr-section');rx.append(n('summary','','Radiografías'),n('p','dr-help','Originales JPG o PNG, hasta 20 MB por imagen. PDF, DICOM y estudios 3D no se admiten en esta versión. El envío a IA siempre requiere autorización explícita para cada estudio.'));
  const fields=n('div','dr-upload-fields'),type=n('select');type.setAttribute('aria-label','Tipo de radiografía');Object.entries(types).forEach(([v,t])=>type.add(new Option(t,v)));ctx.type=type;
  const label=input('Nombre del estudio · opcional','',100,'input'),date=input('Fecha del estudio · opcional','',10,'input');date.e.type='date';ctx.label=label.e;ctx.date=date.e;
  const file=n('input');file.type='file';file.accept='image/png,image/jpeg';file.setAttribute('aria-label','Subir radiografía');file.onchange=()=>addFile(ctx,file.files[0]);ctx.file=file;
  fields.append(type,label.box,date.box,file);rx.append(fields);ctx.studies=n('div','dr-studies');rx.append(ctx.studies);
  const ai=n('aside','dr-ai');ai.append(n('strong','','Revisión asistida · bajo control del dentista'),n('p','','La IA puede sugerir zonas visibles para comprobar. Tú ubicas, corriges y confirmas cada observación; nunca se convierte automáticamente en diagnóstico ni se comparte con el paciente.'));ctx.rxStatus=n('p','dr-help','Comprobando disponibilidad del guardado privado…');ai.append(ctx.rxStatus);rx.append(ai);form.append(rx);
  ctx.save=button('Guardar observaciones',()=>save(ctx));ctx.save.classList.add('dr-primary');ctx.save.disabled=true;form.append(ctx.save);host.append(form);layout.before(host);
  if(pacienteActual._local||window.miRolEquipo!=='dueño'){message(ctx,'Disponible para la cuenta titular y pacientes guardados en la clínica.');return;}
  try{
   await guard(ctx);const row=await checked(sb.from('smyl_dental_records').select('*').eq('tenant_id',ctx.tenant).eq('patient_id',ctx.patient).maybeSingle());
   if(!current(ctx))return;if(row){if(row.tenant_id!==ctx.tenant||row.patient_id!==ctx.patient||!M.validate(row.document,ctx.tenant,ctx.patient))throw new Error('Registro no válido');ctx.doc=row.document;ctx.revision=row.revision;}
   ctx.ready=true;form.disabled=false;renderTeeth(ctx);renderStudies(ctx);message(ctx,row?'Observaciones guardadas · versión '+row.revision:'Sin anotaciones. No se guarda automáticamente.');
   loadPhotoReviews(ctx);loadRadiographReviews(ctx);
  }catch(e){if(current(ctx))message(ctx,errorText(e));}
 }
 function init(){
  const screen=document.getElementById('p-paciente-detalle');if(!screen)return;
  addEventListener('smyl:photo-review-saved',e=>{if(active&&current(active)&&e.detail?.tenant===active.tenant&&e.detail?.patient===active.patient)loadPhotoReviews(active);});
  addEventListener('smyl:radiograph-review-saved',e=>{if(active&&current(active)&&e.detail?.tenant===active.tenant&&e.detail?.patient===active.patient)loadRadiographReviews(active);});
  const prior=window.verPaciente;window.verPaciente=function(id){if(!mayLeave())return;return prior(id);};
  const logout=window.cerrarSesion;if(logout)window.cerrarSesion=function(...args){if(!mayLeave())return;return logout.apply(this,args);};
  const route=window.ir;window.ir=function(target){if(target!=='paciente-detalle'&&!mayLeave())return false;const result=route(target);if(result!==false&&target!=='paciente-detalle'){dispose(active);active=null;}return result;};
  addEventListener('beforeunload',e=>{if(active&&(active.dirty||active.busy)){e.preventDefault();e.returnValue='';}});
  sb.auth.onAuthStateChange?.((event,session)=>{if(active&&(session?.user?.id!==active.tenant||session.user.is_anonymous)){const ctx=active;dispose(ctx);active=null;ctx.host.replaceChildren(n('p','','La sesión cambió. Abre nuevamente la ficha.'));}});
  new MutationObserver(mount).observe(screen,{childList:true,subtree:true});mount();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
