/* SMYL radiografía asistida — mesa de revisión por pieza v2 (plan Etapa 4).
   Una tarjeta por candidato (pieza o señal), recortes derivados al vuelo del original, contorno
   visible/editable/reversible, y cuatro bloques por tarjeta: Base visual sugerida, Confianza del
   modelo, Limitaciones y Valoración profesional. Acciones explícitas: Confirmar, Guardar corrección,
   Descartar, Comparar con anterior (sólo cuando exista un estudio comparable; Etapa 6).
   Ninguna señal pendiente llega al odontograma ni al informe; cada decisión la registra el servidor
   con revisión, autor y fecha (smyl_radiograph_decide_candidate). El estado nunca se indica sólo
   con color: siempre texto + símbolo + patrón de trazo. Detrás de la bandera radiograph.qc_v2. */
(function(){
 'use strict';
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='rr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 const svgEl=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs||{}))e.setAttribute(k,String(v));return e;};
 const typeLabel={panoramic:'Panorámica',periapical:'Periapical',bitewing:'Aleta de mordida',intraoral_series:'Serie intraoral',unknown:'Tipo por confirmar',other:'Radiografía'};
 const toV2Type=t=>({panoramic:'panoramic',periapical:'periapical',bitewing:'bitewing'})[t]||'unknown';
 const qualityLabel={usable:'Imagen utilizable',limited:'Imagen limitada',unusable:'Imagen no utilizable'};
 const flagLabel={motion_blur:'Movimiento / desenfoque',anterior_blur:'Desenfoque anterior',anatomical_cropping:'Recorte anatómico',underexposure:'Subexposición',overexposure:'Sobreexposición',low_contrast:'Bajo contraste',overlap:'Superposición',compression_artifacts:'Artefactos de compresión',orientation_suspect:'Orientación sospechosa',foreign_object:'Objeto extraño',unknown_study_class:'Tipo de estudio incierto'};
 const severityLabel={low:'leve',moderate:'moderada',high:'alta'};
 const analysisLabel={tooth_localization:'Localizar piezas',finding_candidates:'Buscar señales'};
 const categoryLabel={restoration:'Restauración aparente',crown:'Corona aparente',implant:'Implante aparente',endodontic:'Tratamiento endodóntico aparente',apparently_missing:'Pieza aparentemente no visible',density:'Cambio de densidad',contour:'Cambio de contorno',support:'Soporte periodontal',development:'Desarrollo dental',other:'Señal por revisar'};
 const stateLabel={pending:'Por confirmar',confirmed:'Confirmada',corrected:'Corregida',rejected:'Descartada'};
 const stateMark={pending:'○',confirmed:'✓',corrected:'✎',rejected:'✕'};
 const visibilityLabel={complete:'Completa',partial:'Parcial',not_evaluable:'No evaluable'};
 let active=null,seq=0;
 const C=()=>window.SmylRadiographContracts,M2=()=>window.SmylRadiographReviewModelV2;
 const errText=e=>{const code=e?.code||'';if(code==='PT409')return 'La decisión cambió en otra sesión. Se recargó la revisión; vuelve a decidir.';if(code==='42501')return e.message||'Tu rol no tiene permiso para esta acción.';if(code==='23514')return e.message||'La acción no es válida en este estado.';if(!navigator.onLine||e instanceof TypeError)return 'Sin conexión. Tus cambios siguen en esta pantalla; vuelve a intentarlo cuando recuperes la red.';return e?.message||'No se pudo completar la acción.';};
 // --- disponibilidad (cacheada por sesión): bandera qc_v2 + lectura clínica --------------------
 const availability=new Map();
 function available(client){
  if(!client)return Promise.resolve(false);if(availability.has(client))return availability.get(client);
  const p=(async()=>{try{const r=await window.sbTimeout(client.rpc('smyl_radiograph_ai_capabilities'),15000);const caps=r?.data;return !r.error&&caps?.schema===1&&caps.flags?.['radiograph.qc_v2']===true&&caps.clinicalRead===true;}catch(_){return false;}})();
  availability.set(client,p);return p;
 }
 // --- acceso a datos: el servidor decide permisos, banderas, idempotencia y versiones ----------
 async function connect(client,{tenant,patient,study,current}){
  const checked=async p=>{const r=await window.sbTimeout(p,20000);if(!current())throw Error('La ficha cambió.');if(r.error)throw r.error;return r.data;};
  const user=await checked(client.auth.getUser());if(!user?.user||user.user.is_anonymous!==false)throw Error('Abre la ficha con tu cuenta profesional.');
  const caps=await checked(client.rpc('smyl_radiograph_ai_capabilities'));
  if(caps?.schema!==1||caps.tenant_id!==tenant||caps.flags?.['radiograph.qc_v2']!==true||caps.clinicalRead!==true)throw Object.assign(Error('La revisión por pieza no está habilitada en esta clínica.'),{code:'disabled'});
  const rows=(table,sourceId)=>checked(client.from(table).select('*').eq('source_id',sourceId));
  return {caps,userId:user.user.id,
   source:()=>checked(client.from('smyl_radiograph_sources').select('*').eq('patient_id',patient).eq('study_id',study.id).eq('sha256',study.asset.sha256).maybeSingle()),
   register:acceptedAt=>checked(client.rpc('smyl_radiograph_register_source',{p_source_id:crypto.randomUUID(),p_patient_id:patient,p_study_id:study.id,p_study_type:toV2Type(study.type),p_consent:{version:1,acceptedAt,acceptedBy:user.user.id},p_captured_at:study.date?study.date+'T00:00:00Z':null})),
   async state(sourceId){const [runs,candidates,decisions,corrections]=await Promise.all([rows('smyl_radiograph_ai_runs',sourceId),rows('smyl_radiograph_candidates',sourceId),rows('smyl_radiograph_decisions',sourceId),rows('smyl_radiograph_source_corrections',sourceId)]);return {runs:runs||[],candidates:candidates||[],decisions:decisions||[],corrections:corrections||[]};},
   async invoke(name,body){const r=await window.sbTimeout(client.functions.invoke(name,{body}),130000);if(!current())throw Error('La ficha cambió.');if(r.error){let detail=null;try{detail=await r.error.context?.json?.();}catch(_){}throw Object.assign(Error(detail?.error||r.error.message||'El servidor no respondió.'),{code:detail?.code||''});}return r.data;},
   decide:(candidateId,revision,state,payload,note)=>checked(client.rpc('smyl_radiograph_decide_candidate',{p_candidate_id:candidateId,p_expected_revision:revision,p_state:state,p_payload:payload,p_note:note})),
   correctType:(sourceId,value,reason)=>checked(client.rpc('smyl_radiograph_correct_study_type',{p_source_id:sourceId,p_value:value,p_reason:reason})),
   logOpen:sourceId=>client.rpc('smyl_radiograph_log_access',{p_source_id:sourceId,p_action:'open'}).catch(()=>{}),
   // Etapa 6: fuentes comparables (veredicto y motivo del servidor), estado de otra fuente y su archivo privado.
   comparable:sourceId=>checked(client.rpc('smyl_radiograph_comparable_sources',{p_source_id:sourceId})),
   disclosure:()=>checked(client.rpc('smyl_radiograph_model_disclosure')),
   sourceById:sourceId=>checked(client.from('smyl_radiograph_sources').select('*').eq('id',sourceId).maybeSingle()),
   link:(a,b,kind,reason)=>checked(client.rpc('smyl_radiograph_link_studies',{p_source_a:a,p_source_b:b,p_link_kind:kind,p_reason:reason})),
   async download(source){const r=await window.sbTimeout(client.storage.from(source.bucket||'smyl-radiographs').download(source.storage_path),60000);if(!current())throw Error('La ficha cambió.');if(r.error||!r.data)throw Error('No se pudo abrir el archivo privado del estudio anterior.');return r.data;}
  };
 }
 function notice(title,message){const dialog=n('dialog','rr-confirm-dialog'),id='rv2-notice-'+(++seq),h=n('h2','',title),actions=n('div','rr-confirm-actions');h.id=id;dialog.setAttribute('aria-labelledby',id);actions.append(button('Entendido',()=>dialog.close(),'rr-primary'));dialog.append(h,n('p','',message),actions);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();actions.firstChild.focus();}
 function confirmClose(run){
  if(run.confirmDialog?.open)return;const dialog=n('dialog','rr-confirm-dialog'),id='rv2-confirm-'+(++seq),h=n('h2','',run.busy?'Análisis en proceso':'Cambios sin guardar'),actions=n('div','rr-confirm-actions');h.id=id;dialog.setAttribute('aria-labelledby',id);
  actions.append(button('Continuar revisando',()=>dialog.close()),button('Salir sin guardar',()=>{dialog.close();close(run,true);},'rr-primary'));
  dialog.append(h,n('p','',run.busy?'La solicitud al motor sigue registrada en el servidor y no se repetirá automáticamente.':'Hay una corrección o contorno editado que aún no se registró como decisión. Si sales, se perderá sólo ese borrador; lo ya decidido está guardado.'),actions);document.body.append(dialog);run.confirmDialog=dialog;dialog.addEventListener('close',()=>{dialog.remove();if(run.confirmDialog===dialog)run.confirmDialog=null;},{once:true});dialog.showModal();actions.firstChild.focus();
 }
 const isDirty=run=>run.drafts.size>0||!!run.editing;
 function close(run=active,force=false){if(!run||run.closed)return false;if(!force&&(run.busy||isDirty(run))){confirmClose(run);return false;}run.closed=true;run.confirmDialog?.close();URL.revokeObjectURL(run.url);run.dialog.close();run.dialog.remove();if(active===run)active=null;run.focus?.focus?.({preventScroll:true});return true;}
 const bbox=g=>{const xs=g.points.map(p=>p[0]),ys=g.points.map(p=>p[1]);return {x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)};};
 const shapePoints=g=>g.kind==='bbox'?[[g.points[0][0],g.points[0][1]],[g.points[1][0],g.points[0][1]],[g.points[1][0],g.points[1][1]],[g.points[0][0],g.points[1][1]]]:g.points;
 async function open({study,blob,tenant,patient,current,client}){
  if(active){close();if(active)return;}
  client=client||window.sb;
  if(!(blob instanceof Blob)||typeof current!=='function'||!current()||!C()||!M2()||!window.SmylRadiographReview?.viewportNavigation){notice('No pudimos abrir la revisión','Vuelve a abrir la radiografía desde la ficha del paciente.');return;}
  const dialog=n('dialog','rr-dialog rv2-dialog'),bar=n('header','rr-bar'),host=n('div','rr-host'),run={dialog,host,study,blob,tenant,patient,current,client,url:URL.createObjectURL(blob),api:null,source:null,state:null,map:null,findings:[],qc:null,qcRun:null,selected:null,filter:'all',drafts:new Map(),editing:null,busy:false,closed:false,focus:document.activeElement,view:{zoom:1,brightness:100,contrast:100,invert:false,centerX:.5,centerY:.5},img:null,comparable:null,disclosure:null};
  active=run;
  const valid=()=>!run.closed&&current()&&window.tenantId===tenant&&window.pacienteActual?.id===patient;
  const titleId='rv2-title-'+(++seq),dialogTitle=n('strong','',study.label||typeLabel[study.type]||'Revisión por pieza');dialogTitle.id=titleId;dialog.setAttribute('aria-labelledby',titleId);
  bar.append(n('div','rr-identity',null),button('Volver al expediente',()=>close(run)));bar.firstChild.append(n('span','rr-kicker','SMYL · RADIOGRAFÍA · REVISIÓN POR PIEZA'),dialogTitle,n('span','rr-study-meta',typeLabel[study.type]||'Radiografía'));
  dialog.append(bar,host);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();close(run);});dialog.addEventListener('close',()=>close(run,true));
  const status=(text,kind='')=>{let e=host.querySelector('.rr-feedback');if(!e){e=n('p','rr-feedback');e.setAttribute('role','status');e.setAttribute('aria-live','polite');host.prepend(e);}e.className='rr-feedback '+kind;e.textContent=text;};
  // --- carga -----------------------------------------------------------------------------------
  async function reload(){
   run.source=await run.api.source();if(!run.source){run.state=null;run.map=null;run.qc=null;return;}
   run.state=await run.api.state(run.source.id);
   const qcRuns=run.state.runs.filter(r=>r.kind==='qc').sort((a,b)=>String(b.requested_at).localeCompare(String(a.requested_at)));run.qcRun=qcRuns[0]||null;run.qc=qcRuns.find(r=>r.status==='completed')?.output||null;
   run.map=M2().toothMap(run.state);
   // Etapa 7: motor, validación y límites visibles junto a la calidad (si el RPC existe).
   try{run.disclosure=await run.api.disclosure();}catch(_){run.disclosure=null;}
   run.comparable=null;if(run.api.caps.flags['radiograph.longitudinal_v1']===true){try{run.comparable=await run.api.comparable(run.source.id);}catch(_){run.comparable=null;}}
   const decisions=new Map(run.state.decisions.map(d=>[d.candidate_id,d]));
   run.findings=run.state.candidates.filter(c=>c.kind==='finding').map(c=>{const d=decisions.get(c.id)||{state:'pending',revision:1,payload:{}};const corr=d.state==='corrected'?d.payload:{};return {candidateId:c.id,kind:'finding',payload:c.payload,fdi:Object.hasOwn(corr,'fdi')?corr.fdi:c.payload.toothCandidate,fdiModel:c.payload.toothCandidate,geometry:corr.geometry||c.payload.regions[0],geometryModel:c.payload.regions[0],label:corr.label||'',state:d.state,revision:d.revision,decidedBy:d.decided_by||null,decidedAt:d.decided_at||null,note:d.note||'',band:M2().band(c.payload.confidence),confidence:c.payload.confidence,engine:(run.state.runs.find(r=>r.id===c.run_id)||{}).engine||null,evaluable:true};});
  }
  const entries=()=>[...(run.map?.entries||[]).map(e=>Object.assign({kind:'tooth'},e)),...run.findings];
  const completedRun=kind=>run.state?.runs.find(r=>r.kind===kind&&r.status==='completed');
  const liveRun=kind=>run.state?.runs.find(r=>r.kind===kind&&['requested','unconfirmed'].includes(r.status));
  // --- visor y overlay -------------------------------------------------------------------------
  function applyImageView(stage,img){stage.style.width=(run.view.zoom*100)+'%';img.style.filter='brightness('+run.view.brightness+'%) contrast('+run.view.contrast+'%) invert('+(run.view.invert?1:0)+')';}
  function viewToolbar(stage,img,viewport){
   const tools=n('div','rr-view-tools'),zoom=n('input'),contrast=n('input'),brightness=n('input');
   Object.assign(zoom,{type:'range',min:1,max:3,step:.25,value:run.view.zoom});zoom.setAttribute('aria-label','Ampliar radiografía');
   Object.assign(contrast,{type:'range',min:60,max:180,step:5,value:run.view.contrast});contrast.setAttribute('aria-label','Contraste');
   Object.assign(brightness,{type:'range',min:60,max:160,step:5,value:run.view.brightness});brightness.setAttribute('aria-label','Brillo');
   const navigation=window.SmylRadiographReview.viewportNavigation(viewport,stage,{getZoom:()=>run.view.zoom,setZoom:v=>{run.view.zoom=v;zoom.value=v;},apply:()=>applyImageView(stage,img),blocked:()=>!!run.dragging,remember:(x,y)=>{run.view.centerX=x;run.view.centerY=y;}});
   const invert=button('Invertir',()=>{run.view.invert=!run.view.invert;invert.setAttribute('aria-pressed',String(run.view.invert));applyImageView(stage,img);},'rr-tool');invert.setAttribute('aria-pressed',String(run.view.invert));
   const reset=button('Vista original',()=>{Object.assign(run.view,{brightness:100,contrast:100,invert:false,centerX:.5,centerY:.5});contrast.value=100;brightness.value=100;invert.setAttribute('aria-pressed','false');navigation.reset();applyImageView(stage,img);},'rr-tool');
   zoom.oninput=()=>navigation.zoomAt(zoom.value);contrast.oninput=()=>{run.view.contrast=Number(contrast.value);applyImageView(stage,img);};brightness.oninput=()=>{run.view.brightness=Number(brightness.value);applyImageView(stage,img);};
   const restore=()=>navigation.restore(run.view.centerX,run.view.centerY);if(img.complete)restore();else img.addEventListener('load',restore,{once:true});
   const control=(label,input)=>{const box=n('label','rr-tool-range');box.append(n('span','',label),input);return box;};tools.append(control('Zoom',zoom),control('Contraste',contrast),control('Brillo',brightness),invert,reset);return tools;
  }
  function draftGeometry(entry){return run.drafts.get(entry.candidateId)?.geometry||entry.geometry;}
  function overlay(list){
   const svg=svgEl('svg',{class:'rv2-overlay',viewBox:'0 0 1000 1000',preserveAspectRatio:'none','aria-hidden':'true'});
   list.forEach((entry,index)=>{
    if(entry.state==='rejected'&&run.filter!=='rejected')return;const g=draftGeometry(entry);if(!g)return;const pts=shapePoints(g),selected=run.selected===entry.candidateId;
    const poly=svgEl('polygon',{class:'rv2-shape rv2-shape-'+entry.state+(selected?' is-selected':'')+(entry.kind==='finding'?' rv2-shape-finding':''),points:pts.map(p=>(p[0]*1000).toFixed(1)+','+(p[1]*1000).toFixed(1)).join(' '),'vector-effect':'non-scaling-stroke'});
    poly.addEventListener('pointerdown',e=>{if(run.editing)return;e.stopPropagation();selectEntry(entry.candidateId);});svg.append(poly);
    // Etiqueta arriba para piezas y debajo para señales (suelen estar dentro de una pieza): no se superponen.
    const b=bbox({points:pts}),label=svgEl('text',{class:'rv2-shape-label',x:(b.x0*1000+6).toFixed(1),y:(entry.kind==='finding'?b.y1*1000+32:b.y0*1000-8).toFixed(1)});label.textContent=stateMark[entry.state]+' '+(index+1);svg.append(label);
    if(run.editing===entry.candidateId&&g.kind!=='bbox'){
     pts.forEach((p,i)=>{const h=svgEl('circle',{class:'rv2-vertex',cx:(p[0]*1000).toFixed(1),cy:(p[1]*1000).toFixed(1),r:9});h.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();run.dragging={entry,index:i,svg};h.setPointerCapture?.(e.pointerId);});svg.append(h);});
    }
   });
   svg.addEventListener('pointermove',e=>{if(!run.dragging)return;e.preventDefault();const r=svg.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)),{entry,index}=run.dragging,d=run.drafts.get(entry.candidateId)||{},g=structuredClone(d.geometry||entry.geometry);g.points[index]=[Math.round(x*1000)/1000,Math.round(y*1000)/1000];run.drafts.set(entry.candidateId,Object.assign(d,{geometry:g}));const poly=svg.querySelectorAll('.rv2-shape')[list.filter(x=>!(x.state==='rejected'&&run.filter!=='rejected')&&draftGeometry(x)).indexOf(entry)];if(poly)poly.setAttribute('points',g.points.map(p=>(p[0]*1000).toFixed(1)+','+(p[1]*1000).toFixed(1)).join(' '));const v=svg.querySelectorAll('.rv2-vertex')[index];if(v){v.setAttribute('cx',(x*1000).toFixed(1));v.setAttribute('cy',(y*1000).toFixed(1));}});
   const stop=()=>{if(!run.dragging)return;run.dragging=null;renderCards();};svg.addEventListener('pointerup',stop);svg.addEventListener('pointercancel',stop);
   return svg;
  }
  function imagePanel(list){
   const canvas=n('section','rr-canvas'),head=n('header','rr-canvas-head'),copy=n('div'),wrap=n('div','rr-image-wrap'),stage=n('div','rr-image-stage rv2-stage'),img=n('img');
   copy.append(n('span','rr-section-label','IMAGEN ORIGINAL'),n('strong','',study.label||typeLabel[study.type]||'Radiografía'),n('small','',run.editing?'Arrastra los vértices del contorno. Deshacer vuelve a la propuesta del modelo.':'Toca un contorno para abrir su tarjeta. El original se conserva sin modificaciones.'));
   head.append(copy);img.src=run.url;img.alt='Radiografía original · '+(study.label||study.type);run.img=img;stage.append(img,overlay(list));wrap.append(stage);applyImageView(stage,img);canvas.append(head,viewToolbar(stage,img,wrap),wrap);
   const legend=n('div','rr-image-legend');[['pending','Por confirmar · trazo discontinuo'],['confirmed','Confirmada · trazo continuo'],['corrected','Corregida · trazo punteado']].forEach(([s,t])=>legend.append(n('span','rr-key rv2-key rv2-key-'+s,stateMark[s]+' '+t)));legend.append(n('span','rr-gesture-hint','Arrastra para recorrer · pellizca para ampliar'));canvas.append(legend);return canvas;
  }
  function crop(entry){
   const g=draftGeometry(entry),img=run.img;if(!g||!img||!img.naturalWidth)return null;const b=bbox({points:shapePoints(g)}),padX=(b.x1-b.x0)*.2+.01,padY=(b.y1-b.y0)*.2+.01,x0=Math.max(0,b.x0-padX),y0=Math.max(0,b.y0-padY),x1=Math.min(1,b.x1+padX),y1=Math.min(1,b.y1+padY);
   const sw=(x1-x0)*img.naturalWidth,sh=(y1-y0)*img.naturalHeight,scale=Math.min(1,320/Math.max(sw,1),200/Math.max(sh,1)),c=n('canvas','rv2-crop');c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));
   try{const ctx=c.getContext('2d');ctx.drawImage(img,x0*img.naturalWidth,y0*img.naturalHeight,sw,sh,0,0,c.width,c.height);ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.setLineDash(entry.state==='pending'?[6,4]:entry.state==='corrected'?[2,4]:[]);ctx.beginPath();shapePoints(g).forEach((p,i)=>{const px=(p[0]-x0)/(x1-x0)*c.width,py=(p[1]-y0)/(y1-y0)*c.height;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();ctx.stroke();}catch(_){return null;}
   c.setAttribute('role','img');c.setAttribute('aria-label','Recorte de la región candidata, derivado del original');return c;
  }
  // --- tarjetas --------------------------------------------------------------------------------
  function selectEntry(id){run.selected=id;run.editing=null;renderWorkspace();requestAnimationFrame(()=>host.querySelector('[data-rv2-card="'+id+'"]')?.focus({preventScroll:true}));}
  function correctionPayload(entry){
   const d=run.drafts.get(entry.candidateId)||{},p={};
   if(d.fdi!==undefined&&d.fdi!==entry.fdi)p.fdi=d.fdi;if(d.visibility&&d.visibility!==entry.visibility)p.visibility=d.visibility;if(d.geometry)p.geometry=d.geometry;if(d.label&&d.label!==entry.label)p.label=d.label;
   return p;
  }
  async function decide(entry,state){
   if(run.busy||!valid())return;const d=run.drafts.get(entry.candidateId)||{};let payload={};
   if(state==='corrected'){payload=correctionPayload(entry);if(!Object.keys(payload).length){status('No hay cambios que corregir. Si la propuesta es correcta, confírmala.','rr-error');return;}try{payload=C().parseDecisionPayload('corrected',payload);}catch(e){status(e.message,'rr-error');return;}}
   run.busy=true;renderWorkspace();
   try{await run.api.decide(entry.candidateId,entry.revision,state,payload,d.note||'');run.drafts.delete(entry.candidateId);run.editing=null;await reload();status(({confirmed:'Confirmada y registrada con tu autoría.',corrected:'Corrección registrada. La propuesta original del modelo se conserva.',rejected:'Descartada. Puedes reconsiderarla; cada cambio queda versionado.'})[state],'rr-ok');dispatchEvent(new CustomEvent('smyl:radiograph-v2-decided',{detail:{tenant,patient,study:study.id}}));}
   catch(e){if(e?.code==='PT409'){try{await reload();}catch(_){}}status(errText(e),'rr-error');}
   finally{run.busy=false;renderWorkspace();}
  }
  function card(entry,index){
   const selected=run.selected===entry.candidateId,el=n('article','rr-item rr-item-'+entry.state+(selected?' is-selected':'')+(entry.kind==='finding'?' rv2-item-finding':''));el.dataset.rv2Card=entry.candidateId;el.dataset.state=entry.state;el.tabIndex=selected?0:-1;el.setAttribute('aria-current',String(selected));el.setAttribute('role','option');el.setAttribute('aria-selected',String(selected));
   const head=n('button','rr-item-head'),title=n('span','rr-item-title');head.type='button';head.tabIndex=-1;
   const name=entry.kind==='tooth'?'Pieza FDI '+entry.fdi+(entry.renumbered?' (modelo: '+entry.fdiModel+')':''):categoryLabel[entry.payload.category]||'Señal';
   title.append(n('span','rr-number',String(index+1)),n('span','',null));title.lastChild.append(n('strong','',name),n('span','rr-item-location',entry.kind==='tooth'?'Visibilidad: '+(visibilityLabel[entry.visibility]||entry.visibility):(entry.fdi?'Pieza FDI '+entry.fdi:'Región general')));
   const badge=n('span','rr-state rr-state-'+entry.state+' rv2-state',stateMark[entry.state]+' '+stateLabel[entry.state]);badge.setAttribute('aria-label','Estado: '+stateLabel[entry.state]);head.append(title,badge);head.onclick=()=>selectEntry(entry.candidateId);el.append(head);
   if(!selected)return el;
   const body=n('div','rr-item-body rv2-body'),d=run.drafts.get(entry.candidateId)||{};
   const cropEl=crop(entry);if(cropEl){const fig=n('figure','rv2-figure');fig.append(cropEl,n('figcaption','','Recorte derivado del original · no se guarda'));body.append(fig);}
   const block=(label,content)=>{const box=n('section','rr-source rv2-block');box.append(n('span','',label));if(typeof content==='string')box.append(n('p','',content));else box.append(content);return box;};
   if(entry.kind==='tooth'){const alt=entry.alternatives.length?' Alternativas del modelo: '+entry.alternatives.map(a=>a.fdi+' ('+Math.round(a.probability*100)+'%)').join(', ')+'.':'';body.append(block('Base visual sugerida','El modelo localizó un contorno y propuso la pieza '+entry.fdiModel+' con visibilidad '+(visibilityLabel[entry.visibilityModel]||entry.visibilityModel).toLowerCase()+'.'+alt));}
   else body.append(block('Base visual sugerida',(entry.payload.label||'')+' — '+(entry.payload.explanation||'')));
   const conf=entry.kind==='tooth'?entry.fdiProbability:entry.confidence;body.append(block('Confianza del modelo','Confianza '+entry.band+' · '+Math.round(conf*100)+'% · nivel de evidencia: candidato del modelo'+(entry.engine?' · '+entry.engine.name+' '+entry.engine.version:'')));
   const limits=n('ul','rv2-limits');(entry.kind==='finding'?entry.payload.limitations:[]).forEach(l=>limits.append(n('li','',l)));limits.append(n('li','',entry.kind==='tooth'?'La localización no evalúa patología ni estado de la pieza.':'Señal candidata: no es diagnóstico ni urgencia.'));(run.qc?.quality.flags||[]).forEach(f=>limits.append(n('li','','Calidad: '+(flagLabel[f.code]||f.code)+' ('+severityLabel[f.severity]+').')));body.append(block('Limitaciones',limits));
   const form=n('div','rv2-form');
   const fdiLabel=n('label','rr-field',entry.kind==='tooth'?'Pieza FDI (renumerar)':'Pieza relacionada'),fdiSelect=n('select');if(entry.kind==='finding')fdiSelect.add(new Option('Región general',''));(window.SmylDentalModel?.teeth||[]).forEach(t=>fdiSelect.add(new Option('Pieza '+t,t)));fdiSelect.value=d.fdi!==undefined?(d.fdi||''):(entry.fdi||'');fdiSelect.onchange=()=>{const v=fdiSelect.value||null;run.drafts.set(entry.candidateId,Object.assign(run.drafts.get(entry.candidateId)||{},{fdi:v}));renderCards();};fdiLabel.append(fdiSelect);form.append(fdiLabel);
   if(entry.kind==='tooth'){const visLabel=n('label','rr-field','Visibilidad'),vis=n('select');Object.entries(visibilityLabel).forEach(([v,l])=>vis.add(new Option(l,v)));vis.value=d.visibility||entry.visibility;vis.onchange=()=>{run.drafts.set(entry.candidateId,Object.assign(run.drafts.get(entry.candidateId)||{},{visibility:vis.value}));renderCards();};visLabel.append(vis);form.append(visLabel);}
   const noteLabel=n('label','rr-field','Valoración profesional'),note=n('textarea');note.rows=3;note.maxLength=600;note.value=d.note!==undefined?d.note:entry.note;note.placeholder='Describe únicamente lo que comprobaste en la imagen.';note.oninput=()=>{run.drafts.set(entry.candidateId,Object.assign(run.drafts.get(entry.candidateId)||{},{note:note.value}));};noteLabel.append(note);form.append(noteLabel);
   const history=n('small','rr-location',entry.state==='pending'?'Sin decisión profesional todavía.':'Decisión registrada · revisión '+entry.revision+(entry.decidedAt?' · '+new Date(entry.decidedAt).toLocaleString('es-MX'):''));form.append(history);body.append(block('Valoración profesional',form));
   const actions=n('div','rr-actions rv2-actions'),changes=Object.keys(correctionPayload(entry)).length>0;
   actions.append(button('Confirmar',()=>decide(entry,'confirmed'),'rr-primary'));
   const save=button(changes?'Guardar corrección':'Guardar corrección (sin cambios)',()=>decide(entry,'corrected'));save.disabled=!changes;actions.append(save);
   actions.append(button('Descartar',()=>decide(entry,'rejected'),'rr-tertiary'));
   if(draftGeometry(entry)?.kind!=='bbox'){const edit=button(run.editing===entry.candidateId?'Terminar edición de contorno':'Editar contorno',()=>{run.editing=run.editing===entry.candidateId?null:entry.candidateId;renderWorkspace();},'rr-tool');edit.setAttribute('aria-pressed',String(run.editing===entry.candidateId));actions.append(edit);}
   if(d.geometry){actions.append(button('Deshacer contorno',()=>{const x=run.drafts.get(entry.candidateId);delete x.geometry;if(!Object.keys(x).length)run.drafts.delete(entry.candidateId);renderWorkspace();},'rr-tool'));}
   const comparableList=Array.isArray(run.comparable)?run.comparable:null,hasComparable=!!comparableList?.some(c=>c.verdict==='comparable'&&c.link_kind!=='incompatible');
   const compare=button('Comparar con anterior'+(comparableList?.length?' ('+comparableList.length+')':''),()=>openComparePicker(),'rr-tool');
   if(!hasComparable){compare.disabled=true;compare.setAttribute('aria-disabled','true');compare.title=!comparableList?'Disponible cuando la historia longitudinal esté habilitada y exista un estudio anterior del mismo paciente.':comparableList.length?'Hay estudios anteriores pero ninguno comparable: '+comparableList.map(c=>(window.SmylRadiographLongitudinal?.reasonText(c.link_kind==='incompatible'?'professional_incompatible':c.reason)||c.reason)).join(' ')
    :'No hay estudios anteriores registrados para este paciente.';}
   actions.append(compare);
   if(run.busy)actions.querySelectorAll('button').forEach(b=>{b.disabled=true;});
   body.append(actions,n('small','rr-location','Confirmar y corregir registran tu autoría; descartar conserva el candidato original.'));el.append(body);return el;
  }
  function cardsPanel(list){
   const panel=n('aside','rr-signal-panel'),head=n('header','rr-panel-head'),counts=n('div','rr-counts'),filters=n('div','rr-filters rv2-filters'),items=n('div','rr-items rv2-items');items.setAttribute('role','listbox');items.setAttribute('aria-label','Candidatos por pieza y señal');
   const count=s=>list.filter(e=>e.state===s).length;head.append(n('span','rr-section-label','CANDIDATOS DEL MODELO'),n('h2','','Revisión por pieza'),n('p','','Confirma, corrige o descarta cada candidato. Nada pendiente entra al expediente.'));
   counts.append(n('span','rr-count rr-count-pending',stateMark.pending+' '+count('pending')+' por confirmar'),n('span','rr-count rr-count-confirmed',stateMark.confirmed+' '+(count('confirmed')+count('corrected'))+' verificadas'),n('span','rr-count',list.length+' totales'));
   [['all','Todas'],['pending','Por confirmar'],['confirmed','Confirmadas'],['corrected','Corregidas'],['rejected','Descartadas']].forEach(([v,l])=>{const f=button(l,()=>{run.filter=v;run.selected=null;renderWorkspace();},'rr-filter');f.setAttribute('aria-pressed',String(run.filter===v));filters.append(f);});
   const visible=list.filter(e=>run.filter==='all'||e.state===run.filter);if(visible.length&&!visible.some(e=>e.candidateId===run.selected))run.selected=visible[0].candidateId;
   visible.forEach((e,i)=>items.append(card(e,list.indexOf(e))));
   if(!visible.length){const empty=n('div','rr-panel-empty');empty.append(n('strong','','No hay candidatos en este estado'),n('p','','Cambia el filtro para revisar los demás.'));items.append(empty);}
   items.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const idx=visible.findIndex(x=>x.candidateId===run.selected),next=e.key==='Home'?0:e.key==='End'?visible.length-1:Math.max(0,Math.min(visible.length-1,idx+(e.key==='ArrowDown'?1:-1)));if(visible[next])selectEntry(visible[next].candidateId);});
   if(run.map?.conflicts?.length){const warn=n('p','rr-note rv2-conflict');warn.setAttribute('role','status');warn.textContent='⚠ Conflicto: '+run.map.conflicts.map(c=>'pieza '+c.fdi+' tiene '+c.candidateIds.length+' candidatos vivos').join('; ')+'. Descarta o renumera uno.';panel.append(head,counts,filters,warn,items);}else panel.append(head,counts,filters,items);
   return panel;
  }
  function renderCards(){const list=entries(),panel=host.querySelector('.rr-signal-panel');if(panel)panel.replaceWith(cardsPanel(list));}
  // Seleccionar, editar o deshacer sólo reemplaza el overlay: la imagen no se recarga ni salta el scroll.
  function renderOverlay(list){const stage=host.querySelector('.rv2-stage');if(!stage)return false;const old=stage.querySelector('.rv2-overlay'),fresh=overlay(list);old?old.replaceWith(fresh):stage.append(fresh);const hint=host.querySelector('.rr-canvas-head small');if(hint)hint.textContent=run.editing?'Arrastra los vértices del contorno. Deshacer vuelve a la propuesta del modelo.':'Toca un contorno para abrir su tarjeta. El original se conserva sin modificaciones.';return true;}
  function renderWorkspace(){const list=entries(),ws=host.querySelector('.rr-workspace');if(!ws)return render();if(renderOverlay(list)){const panel=ws.querySelector('.rr-signal-panel');panel?panel.replaceWith(cardsPanel(list)):ws.append(cardsPanel(list));}else ws.replaceChildren(imagePanel(list),cardsPanel(list));ws.dataset.mode=run.editing?'editing':'review';}
  // --- pasos previos: registro, QC, análisis ---------------------------------------------------
  async function runStep(label,fn){if(run.busy||!valid())return;run.busy=true;render();status(label+'… No cierres esta ventana.');let text,kind;try{await fn();await reload();text=label+': listo.';kind='rr-ok';}catch(e){try{await reload();}catch(_){}text=errText(e);kind='rr-error';}finally{run.busy=false;render();status(text,kind);}}
  function qcCard(){
   const box=n('section','rv2-qc'),q=run.qc;
   if(!q){const live=run.qcRun;const text=live?.status==='unconfirmed'?'La comprobación anterior no tuvo respuesta confirmada. No se repite automáticamente; puedes solicitarla de nuevo de forma explícita.':live?.status==='failed'?'La comprobación falló ('+(live.failure_code||'error')+'). Puedes intentarla de nuevo.':'Antes de localizar piezas o buscar señales, el servidor comprueba tipo y calidad de la imagen.';box.append(n('span','rr-section-label','1 · CALIDAD DEL ESTUDIO'),n('p','',text));
    const go=button(live?.status==='unconfirmed'?'Solicitar comprobación de nuevo':'Comprobar calidad',()=>runStep('Comprobando calidad',()=>run.api.invoke('radiograph-qc',{sourceId:run.source.id})),'rr-primary');go.disabled=run.busy;box.append(go);return box;}
   const current=run.state.corrections.filter(c=>c.field==='study_type').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]?.value||run.source.study_type_declared;
   const summary=n('div','rr-quality-card rr-quality-'+q.quality.status+' rv2-quality');summary.append(n('span','rr-section-label','1 · CALIDAD DEL ESTUDIO'),n('strong','',qualityLabel[q.quality.status]+' · '+(typeLabel[q.studyClass.value]||q.studyClass.value)+' ('+Math.round(q.studyClass.probability*100)+'%)'),n('p','',q.quality.flags.length?q.quality.flags.map(f=>(flagLabel[f.code]||f.code)+' ('+severityLabel[f.severity]+')').join(' · '):'Sin banderas técnicas.'));
   if(q.blockedAnalyses.length)summary.append(n('p','rv2-blocked','Bloqueado: '+q.blockedAnalyses.map(b=>analysisLabel[b.code]+' — '+b.reason).join(' · ')));
   const typeLabelEl=n('label','rr-field rv2-type','Tipo de estudio (corrección profesional)'),typeSelect=n('select');['panoramic','periapical','bitewing','intraoral_series','unknown'].forEach(t=>typeSelect.add(new Option(typeLabel[t],t)));typeSelect.value=current;typeSelect.onchange=()=>runStep('Registrando el tipo de estudio',()=>run.api.correctType(run.source.id,typeSelect.value,'Corregido desde la revisión por pieza'));typeLabelEl.append(typeSelect);
   const steps=n('div','rv2-steps');['tooth_localization','finding_candidates'].forEach(kind=>{const done=completedRun(kind),live=liveRun(kind),ok=q.applicableAnalyses.includes(kind)&&run.api.caps.flags['radiograph.tooth_ai_v1']===true;const b=button(done?analysisLabel[kind]+' · listo ('+(done.output?.candidates?.length||0)+')':live?analysisLabel[kind]+' · sin confirmar':analysisLabel[kind],()=>runStep(analysisLabel[kind],()=>run.api.invoke('radiograph-analyze',{sourceId:run.source.id,kind})),done?'rr-tool':'rr-primary');b.disabled=run.busy||!!done||!ok;if(!ok)b.title=q.applicableAnalyses.includes(kind)?'La localización asistida no está habilitada en esta clínica.':'Bloqueado por la calidad de la imagen.';steps.append(b);});
   box.append(summary,typeLabelEl,steps);
   // Divulgación (Etapa 7): qué motor, si es simulado, último informe de validación y fecha. Nunca credenciales.
   const V=window.SmylRadiographValidation;if(run.disclosure&&V?.disclosureSummary){const d=V.disclosureSummary(run.disclosure),disc=n('div','rv2-disclosure');disc.setAttribute('role','note');disc.append(n('strong','',d.simulated?'Motor simulado · sin validación clínica':'Motor y validación'),n('span','',d.engines),n('span','',d.validation));if(d.openIncidents)disc.append(n('span','rv2-blocked','⚠ '+d.openIncidents+' incidente(s) abierto(s)'));
    if(run.api.caps.clinicalApprove===true&&typeof V.open==='function'){disc.append(button('Validación del motor',()=>V.open({client,caps:run.api.caps,source:run.source,tenant}),'rr-tool'));}box.append(disc);}
   return box;
  }
  // Etapa 6: el usuario elige con qué estudio comparar; los incompatibles se listan con su motivo y no se abren.
  function openComparePicker(){
   const L=window.SmylRadiographLongitudinal;if(!L?.open||!Array.isArray(run.comparable))return;
   const d=n('dialog','rr-confirm-dialog rl-picker-dialog'),id='rv2-picker-'+(++seq),h=n('h2','','Comparar con un estudio anterior'),list=n('div','rl-picker');h.id=id;d.setAttribute('aria-labelledby',id);
   run.comparable.forEach(c=>{const item=n('div','rl-picker-item'),ok=c.verdict==='comparable'&&c.link_kind!=='incompatible';item.dataset.verdict=ok?'comparable':'incompatible';item.append(n('strong','',(typeLabel[c.study_type]||c.study_type)+' · '+(c.captured_at||c.created_at||'').slice(0,10)),n('small','',ok?'Comparable: mismo tipo de estudio y calidad comprobada.'+(c.link_kind==='comparable'?' Par ya registrado.':''):'No comparable: '+(L.reasonText(c.link_kind==='incompatible'?'professional_incompatible':c.reason)||c.reason)));
    const b=button(ok?'Comparar':'No disponible',()=>{d.close();openComparison(c);},ok?'rr-primary':'rr-tool');b.disabled=!ok;item.append(b);list.append(item);});
   const actions=n('div','rr-confirm-actions');actions.append(button('Cerrar',()=>d.close()));d.append(h,list,actions);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();
  }
  async function openComparison(c){
   const L=window.SmylRadiographLongitudinal;if(run.busy||!valid())return;run.busy=true;renderWorkspace();status('Abriendo el estudio anterior…');
   try{
    const prevSource=await run.api.sourceById(c.source_id);if(!prevSource)throw Error('El estudio anterior no está disponible.');
    const [prevState,prevBlob]=await Promise.all([run.api.state(prevSource.id),run.api.download(prevSource)]);
    const prevQc=prevState.runs.filter(r=>r.kind==='qc'&&r.status==='completed').sort((a,b)=>String(b.completed_at).localeCompare(String(a.completed_at)))[0]?.output||null;
    const prevStudy=(window.pacienteActual?.id===patient&&Array.isArray(window.SmylDentalRecordStudies)?window.SmylDentalRecordStudies:[]).find(s=>s.id===prevSource.study_id)||{label:(typeLabel[c.study_type]||'Estudio anterior'),date:(c.captured_at||c.created_at||'').slice(0,10)};
    const previous={source:prevSource,state:prevState,qc:prevQc,blob:prevBlob,study:prevStudy,studyType:c.study_type,qcStatus:c.qc_status,linkKind:c.link_kind};
    const currentSide={source:run.source,state:run.state,qc:run.qc,blob:run.blob,study,studyType:(run.state.corrections.filter(x=>x.field==='study_type').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]?.value)||run.source.study_type_declared,qcStatus:run.qc?.quality?.status||null,linkKind:c.link_kind};
    status('');
    await L.open({previous,current:currentSide,compatibility:{verdict:c.verdict,reason:c.reason,text:L.reasonText(c.reason)||'Mismo tipo de estudio y control de calidad completado en ambos.'},client,tenant,patient,currentCheck:valid,caps:run.api.caps,onLink:async(kind,reason)=>{await run.api.link(run.source.id,prevSource.id,kind,reason);await reload();renderWorkspace();}});
   }catch(e){status(errText(e),'rr-error');}
   finally{run.busy=false;renderWorkspace();}
  }
  function render(){
   if(!valid())return close(run,true);const feedback=host.querySelector('.rr-feedback');host.replaceChildren();if(feedback)host.prepend(feedback);
   if(!run.api){host.append(n('section','rr-empty',null));host.firstChild.append(n('h1','','Revisión por pieza no disponible'),n('p','','Esta clínica no tiene habilitada la revisión radiográfica v2 o tu rol no tiene acceso clínico.'),n('p','rr-note','Puedes seguir usando “Revisar con apoyo de IA” y las anotaciones manuales.'));return;}
   if(!run.source){
    const intro=n('section','rr-intro');intro.append(n('p','rr-step','1 de 3 · Registrar fuente'),n('h1','','Revisión asistida por pieza'),n('p','rr-lead','El servidor registra esta radiografía como fuente inmutable, comprueba su calidad y propone piezas y señales como candidatos. Nada se convierte en diagnóstico sin tu decisión.'),imagePanel([]));
    const privacy=n('div','rr-privacy');privacy.append(n('strong','','Datos enviados'),n('p','','El archivo privado ya guardado, su huella y el tipo de estudio. Sin nombre, notas ni fotografías. Puede generar consumo.'));
    const consent=n('input');consent.type='checkbox';consent.id='rv2-consent';const permission=n('label','rr-consent');permission.htmlFor='rv2-consent';permission.append(consent,document.createTextNode('Confirmo la autorización del paciente y revisaré cada candidato.'));
    const start=button('Registrar y comprobar calidad',()=>{if(!consent.checked){status('Marca la autorización del paciente antes de continuar.','rr-error');return;}runStep('Registrando y comprobando calidad',async()=>{const src=await run.api.register(new Date().toISOString());await run.api.invoke('radiograph-qc',{sourceId:src.id});});},'rr-primary');start.disabled=run.busy;
    intro.append(privacy,permission,start,n('p','rr-note rr-safety-note','Revisión privada. No se comparte ni se convierte automáticamente en diagnóstico.'));host.append(intro);return;
   }
   const list=entries(),top=n('section','rr-review rv2-review'),head=n('header','rr-review-head'),title=n('div');
   title.append(n('p','rr-step',list.length?'3 de 4 · Decidir por pieza':'2 de 4 · Analizar'),n('h1','','Revisión por pieza'),n('p','rr-lead','Candidatos del modelo, decisiones tuyas. Sólo lo confirmado o corregido llega al odontograma y al informe.'));head.append(title);
   // Etapa 5: informe construido sólo con decisiones confirmadas; detrás de la bandera report_v1.
   if(run.api.caps.flags['radiograph.report_v1']===true&&typeof window.SmylRadiographReport?.open==='function'){const verified=list.filter(e=>['confirmed','corrected'].includes(e.state)).length;const report=button('Informe radiográfico'+(verified?' ('+verified+' confirmados)':''),()=>{if(isDirty(run)){status('Guarda o deshaz el borrador de la tarjeta antes de abrir el informe.','rr-error');return;}window.SmylRadiographReport.open({source:run.source,study,entries:entries(),findings:run.findings,qc:run.qc,tenant,patient,current:valid,client,caps:run.api.caps});},'rr-tool');report.classList.add('rv2-report-button');report.disabled=run.busy;head.append(report);}
   top.append(head,qcCard());
   const ws=n('div','rr-workspace');ws.dataset.mode=run.editing?'editing':'review';ws.append(imagePanel(list),cardsPanel(list));top.append(ws);
   if(run.qc&&!list.length&&!run.busy)top.append(n('p','rr-note','Aún no hay candidatos. Ejecuta los análisis habilitados arriba; si el motor no propone nada, continúa con tu valoración clínica.'));
   top.append(n('p','rr-note rr-safety-note','Revisión asistida privada. Las decisiones quedan versionadas con tu autoría y pueden reconsiderarse; un informe firmado las congela.'));host.append(top);
  }
  host.append(n('p','rr-feedback','Abriendo la revisión por pieza…'));
  try{run.api=await connect(client,{tenant,patient,study,current:valid});await reload();if(!valid())return;if(run.source)run.api.logOpen(run.source.id);render();}
  catch(e){if(valid()){run.api=null;render();status(e.code==='disabled'?e.message:errText(e),'rr-error');}}
 }
 addEventListener('pagehide',()=>close(active,true));
 window.SmylRadiographReviewV2={open,close:()=>close(active,true),available};
})();
