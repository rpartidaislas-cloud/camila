/* SMYL radiografía asistida — historia longitudinal (plan Etapa 6).
   Compara dos fuentes del mismo paciente SÓLO cuando son compatibles (mismo tipo de estudio
   efectivo, control de calidad completado y no inutilizable); si no, explica por qué. Empareja por
   pieza FDI las decisiones de ambos estudios y separa tres cosas que nunca se mezclan:
   diferencias de adquisición, cambios propuestos por la IA (pendientes) y cambios confirmados por el
   profesional. No calcula mediciones óseas ni distancias: el método no está validado. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./smyl-radiograph-review-model-v2.js'):root.SmylRadiographReviewModelV2);if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylRadiographLongitudinal=api;})(typeof self!=='undefined'?self:this,function(M2){
 'use strict';
 const REASONS={different_study_type:'Tipo de estudio distinto: una panorámica no se compara con una periapical ni viceversa.',missing_qc:'Falta el control de calidad en uno de los estudios; compruébalo antes de comparar.',unusable_quality:'Uno de los estudios es no utilizable según el control de calidad.',professional_incompatible:'El profesional marcó este par como no comparable.'};
 const STUDY_LABELS={panoramic:'Panorámica',periapical:'Periapical',bitewing:'Aleta de mordida',intraoral_series:'Serie intraoral',unknown:'Tipo por confirmar'};
 const FLAG_LABELS={motion_blur:'movimiento / desenfoque',anterior_blur:'desenfoque anterior',anatomical_cropping:'recorte anatómico',underexposure:'subexposición',overexposure:'sobreexposición',low_contrast:'bajo contraste',overlap:'superposición',compression_artifacts:'artefactos de compresión',orientation_suspect:'orientación sospechosa',foreign_object:'objeto extraño',unknown_study_class:'tipo de estudio incierto'};
 const MEASUREMENTS_NOTE='Sin mediciones de nivel óseo ni distancias: la técnica, la calibración y la repetibilidad no están validadas (plan Etapa 7).';
 // Misma regla que smyl_radiograph_comparable_sources en el servidor.
 function compatibility(a,b){
  if(!a||!b)return {verdict:'incompatible',reason:'missing_qc',text:REASONS.missing_qc};
  if(a.studyType!==b.studyType)return {verdict:'incompatible',reason:'different_study_type',text:REASONS.different_study_type};
  if(!a.qcStatus||!b.qcStatus)return {verdict:'incompatible',reason:'missing_qc',text:REASONS.missing_qc};
  if(a.qcStatus==='unusable'||b.qcStatus==='unusable')return {verdict:'incompatible',reason:'unusable_quality',text:REASONS.unusable_quality};
  if(a.linkKind==='incompatible'||b.linkKind==='incompatible')return {verdict:'incompatible',reason:'professional_incompatible',text:REASONS.professional_incompatible};
  return {verdict:'comparable',reason:'',text:'Mismo tipo de estudio y control de calidad completado en ambos.'};
 }
 function reasonText(code){return REASONS[code]||'';}
 // Diferencias de adquisición: no son cambios clínicos y se muestran aparte.
 function acquisitionDifferences(qcA,qcB){
  const out=[];if(!qcA||!qcB)return out;
  if(qcA.studyClass?.value!==qcB.studyClass?.value)out.push('Clase de estudio detectada: '+(STUDY_LABELS[qcA.studyClass?.value]||qcA.studyClass?.value)+' → '+(STUDY_LABELS[qcB.studyClass?.value]||qcB.studyClass?.value)+'.');
  if(qcA.quality?.status!==qcB.quality?.status)out.push('Calidad: '+qcA.quality?.status+' → '+qcB.quality?.status+'.');
  const fa=new Set((qcA.quality?.flags||[]).map(f=>f.code)),fb=new Set((qcB.quality?.flags||[]).map(f=>f.code));
  [...fb].filter(c=>!fa.has(c)).forEach(c=>out.push('Nueva señal técnica en el estudio actual: '+(FLAG_LABELS[c]||c)+'.'));
  [...fa].filter(c=>!fb.has(c)).forEach(c=>out.push('Señal técnica presente sólo en el anterior: '+(FLAG_LABELS[c]||c)+'.'));
  if(!out.length)out.push('Sin diferencias de adquisición registradas por el control de calidad.');
  return out;
 }
 const decided=s=>['confirmed','corrected'].includes(s);
 const GENERAL='general';
 // ¿Se analizó este tipo de candidato en el estudio? Con ejecuciones, vale la completada; sin ellas, la existencia de candidatos.
 function analyzed(state){
  const runs=state&&state.runs,cands=(state&&state.candidates)||[];
  const has=(kind,candKind)=>(Array.isArray(runs)&&runs.some(r=>r.kind===kind&&r.status==='completed'))||cands.some(c=>c&&c.kind===candKind);
  return {teeth:has('tooth_localization','tooth'),findings:has('finding_candidates','finding')};
 }
 function sideByTooth(state){
  const map=new Map();const add=(fdi,item)=>{const key=fdi||GENERAL;if(!map.has(key))map.set(key,{tooth:[],findings:[]});map.get(key)[item.kind==='tooth'?'tooth':'findings'].push(item);};
  for(const e of M2.toothMap(state).entries)add(e.fdi,{kind:'tooth',state:e.state,candidateId:e.candidateId,visibility:e.visibility,evaluable:e.evaluable});
  const decisions=new Map((state.decisions||[]).map(d=>[d.candidate_id,d]));
  for(const c of (state.candidates||[]).filter(c=>c&&c.kind==='finding')){const d=decisions.get(c.id)||{state:'pending',payload:{}};const corr=d.state==='corrected'?d.payload:{};add(Object.hasOwn(corr,'fdi')?corr.fdi:c.payload.toothCandidate,{kind:'finding',state:d.state,candidateId:c.id,category:c.payload.category,label:corr.label||c.payload.label});}
  return map;
 }
 const summary=side=>{
  if(!side)return {located:false,locatedPending:false,rejected:0,notEvaluable:false,conflict:false,confirmedFindings:[],pendingFindings:[],rejectedFindings:[]};
  const live=side.tooth.filter(t=>t.state!=='rejected');
  return {located:side.tooth.some(t=>decided(t.state)&&t.evaluable!==false),locatedPending:side.tooth.some(t=>t.state==='pending'),rejected:side.tooth.filter(t=>t.state==='rejected').length,
   notEvaluable:side.tooth.some(t=>decided(t.state)&&t.evaluable===false),conflict:live.length>1,
   confirmedFindings:side.findings.filter(f=>decided(f.state)).map(f=>f.category).sort(),pendingFindings:side.findings.filter(f=>f.state==='pending').map(f=>f.category).sort(),rejectedFindings:side.findings.filter(f=>f.state==='rejected').map(f=>f.category).sort()};
 };
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 // Emparejamiento por pieza (o "general" para señales sin pieza): 'confirmed' (ambos lados decididos y distintos),
 // 'ai_proposed' (la diferencia depende de candidatos pendientes), 'stable' (decidido igual en ambos) o 'unverified'
 // (falta análisis en un lado, no es evaluable, hay conflicto o falta decisión). Nunca se compara contra lo que no se analizó.
 function pairByTooth(previous,current){
  const a=sideByTooth(previous),b=sideByTooth(current),teeth=[...new Set([...a.keys(),...b.keys()])].sort((x,y)=>x===GENERAL?1:y===GENERAL?-1:x.localeCompare(y));
  const pa=analyzed(previous),pb=analyzed(current),teethBoth=pa.teeth&&pb.teeth,findingsBoth=pa.findings&&pb.findings;
  const rows=teeth.map(fdi=>{const sa=summary(a.get(fdi)),sb=summary(b.get(fdi));
   const detail=[];let blocked=false;
   if(fdi!==GENERAL&&!teethBoth&&(sa.located||sb.located||sa.locatedPending||sb.locatedPending)){detail.push('La localización sólo se analizó en '+(pa.teeth?'el anterior':'el actual')+'; no se compara.');blocked=true;}
   if(sa.conflict||sb.conflict){detail.push('Conflicto: más de un candidato vivo para esta pieza en '+(sa.conflict&&sb.conflict?'ambos estudios':sa.conflict?'el anterior':'el actual')+'.');blocked=true;}
   if(sa.notEvaluable||sb.notEvaluable){detail.push('Pieza no evaluable en '+(sa.notEvaluable&&sb.notEvaluable?'ambos estudios':sa.notEvaluable?'el anterior':'el actual')+'.');blocked=true;}
   const fa=findingsBoth?sa.confirmedFindings:[],fb=findingsBoth?sb.confirmedFindings:[];
   if(!findingsBoth&&(sa.confirmedFindings.length||sb.confirmedFindings.length||sa.pendingFindings.length||sb.pendingFindings.length)){detail.push('Las señales sólo se analizaron en '+(pa.findings?'el anterior':'el actual')+'; no se compara contra lo que no se buscó.');blocked=true;}
   const hasA=(fdi===GENERAL?false:sa.located)||fa.length>0||sa.rejected>0||sa.rejectedFindings.length>0,hasB=(fdi===GENERAL?false:sb.located)||fb.length>0||sb.rejected>0||sb.rejectedFindings.length>0;
   const decidedBoth=hasA&&hasB&&!blocked;
   const confirmedDiff=!same([fdi===GENERAL?false:sa.located,fa],[fdi===GENERAL?false:sb.located,fb]);
   const pendingDiff=sa.locatedPending||sb.locatedPending||(findingsBoth&&(sa.pendingFindings.length||sb.pendingFindings.length));
   let category='unverified';
   if(!blocked){if(decidedBoth&&confirmedDiff)category='confirmed';else if(decidedBoth&&!confirmedDiff)category=pendingDiff?'ai_proposed':'stable';else if(pendingDiff)category='ai_proposed';}
   if(fa.length||fb.length)detail.push('Señales confirmadas: '+(fa.join(', ')||'ninguna')+' → '+(fb.join(', ')||'ninguna')+'.');
   if(findingsBoth&&(sa.rejectedFindings.length||sb.rejectedFindings.length))detail.push('Señales descartadas por el profesional: '+(sa.rejectedFindings.join(', ')||'ninguna')+' → '+(sb.rejectedFindings.join(', ')||'ninguna')+'.');
   if(sa.rejected||sb.rejected)detail.push('Candidato de localización descartado en '+(sa.rejected&&sb.rejected?'ambos estudios':sa.rejected?'el anterior':'el actual')+'.');
   if(findingsBoth&&(sa.pendingFindings.length||sb.pendingFindings.length))detail.push('Propuestas de IA pendientes: '+(sa.pendingFindings.join(', ')||'ninguna')+' → '+(sb.pendingFindings.join(', ')||'ninguna')+'.');
   if(sa.locatedPending||sb.locatedPending)detail.push('Localización pendiente de confirmar en '+(sa.locatedPending&&sb.locatedPending?'ambos':sa.locatedPending?'el anterior':'el actual')+'.');
   return {fdi,previous:sa,current:sb,category,detail};
  });
  return {rows,confirmed:rows.filter(r=>r.category==='confirmed'),aiProposed:rows.filter(r=>r.category==='ai_proposed'),stable:rows.filter(r=>r.category==='stable'),unverified:rows.filter(r=>r.category==='unverified'),measurements:null,measurementsNote:MEASUREMENTS_NOTE,analysis:{previous:pa,current:pb}};
 }
 // --- interfaz --------------------------------------------------------------------------------
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='rr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 const svgEl=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs||{}))e.setAttribute(k,String(v));return e;};
 const CATEGORY_LABELS={confirmed:'✓ Cambios confirmados por el profesional',ai_proposed:'○ Cambios propuestos por la IA (pendientes de decisión)',stable:'= Sin cambio confirmado',unverified:'? Sin decisión en uno de los estudios'};
 let active=null,seq=0;
 function close(run=active,force=false){if(!run||run.closed)return false;run.closed=true;run.urls.forEach(u=>URL.revokeObjectURL(u));run.dialog.close();run.dialog.remove();if(active===run)active=null;const back=(run.returnFocus&&run.returnFocus())||(run.focus&&run.focus.isConnected?run.focus:null);back?.focus?.({preventScroll:true});return true;}
 function viewer(run,side,label){
  const canvas=n('section','rr-canvas rl-canvas'),head=n('header','rr-canvas-head'),copy=n('div'),wrap=n('div','rr-image-wrap rl-wrap'),stage=n('div','rr-image-stage rv2-stage'),img=n('img');
  copy.append(n('span','rr-section-label',label),n('strong','',side.study?.label||STUDY_LABELS[side.studyType]||'Radiografía'),n('small','',(side.study?.date||'')+(side.qc?' · calidad '+side.qc.quality.status:'')));head.append(copy);
  const url=URL.createObjectURL(side.blob);run.urls.push(url);img.src=url;img.alt='Radiografía '+label.toLowerCase();stage.append(img);
  const svg=svgEl('svg',{class:'rv2-overlay',viewBox:'0 0 1000 1000',preserveAspectRatio:'none','aria-hidden':'true'});
  for(const e of M2.toothMap(side.state).entries){if(!decided(e.state)||!e.geometry)continue;const g=e.geometry,pts=g.kind==='bbox'?[[g.points[0][0],g.points[0][1]],[g.points[1][0],g.points[0][1]],[g.points[1][0],g.points[1][1]],[g.points[0][0],g.points[1][1]]]:g.points;svg.append(svgEl('polygon',{class:'rv2-shape rv2-shape-'+e.state,points:pts.map(p=>(p[0]*1000).toFixed(1)+','+(p[1]*1000).toFixed(1)).join(' '),'vector-effect':'non-scaling-stroke'}));}
  stage.append(svg);wrap.append(stage);canvas.append(head,wrap);
  // El zoom es uno solo para ambos visores: pellizcar o usar la rueda en uno amplía los dos y mueve el control.
  const nav=window.SmylRadiographReview.viewportNavigation(wrap,stage,{getZoom:()=>run.zoom,setZoom:v=>{run.zoom=v;if(run.zoomInput)run.zoomInput.value=v;},apply:()=>{const centers=run.wraps.map((w,i)=>({x:(w.scrollLeft+w.clientWidth/2)/Math.max(run.stages[i].offsetWidth,1),y:(w.scrollTop+w.clientHeight/2)/Math.max(run.stages[i].offsetHeight,1)}));run.stages.forEach(st=>{st.style.width=(run.zoom*100)+'%';});run.wraps.forEach((w,i)=>{w.classList.toggle('is-zoomed',run.zoom>1.01);void run.stages[i].offsetWidth;w.scrollLeft=centers[i].x*run.stages[i].offsetWidth-w.clientWidth/2;w.scrollTop=centers[i].y*run.stages[i].offsetHeight-w.clientHeight/2;});},blocked:()=>false,remember:()=>{}});
  run.stages.push(stage);run.wraps.push(wrap);run.navs.push(nav);
  // Sincronización: el desplazamiento de un visor se refleja proporcionalmente en el otro.
  wrap.addEventListener('scroll',()=>{if(run.syncing||!run.sync)return;run.syncing=true;const other=run.wraps.find(w=>w!==wrap);if(other){other.scrollLeft=wrap.scrollLeft/Math.max(1,wrap.scrollWidth-wrap.clientWidth)*Math.max(0,other.scrollWidth-other.clientWidth);other.scrollTop=wrap.scrollTop/Math.max(1,wrap.scrollHeight-wrap.clientHeight)*Math.max(0,other.scrollHeight-other.clientHeight);}run.syncing=false;},{passive:true});
  return canvas;
 }
 async function open({previous,current,compatibility:compat,client,tenant,patient,currentCheck,onLink,caps,returnFocus}){
  if(active){close();}
  if(!previous||!current||!window.SmylRadiographReview?.viewportNavigation)return;
  const dialog=n('dialog','rr-dialog rv2-dialog rl-dialog'),bar=n('header','rr-bar'),host=n('div','rr-host rl-host'),run={dialog,host,urls:[],stages:[],wraps:[],navs:[],zoom:1,sync:true,syncing:false,flip:false,closed:false,focus:document.activeElement,returnFocus,zoomInput:null,linking:false};active=run;
  const titleId='rl-title-'+(++seq),t=n('strong','','Comparación longitudinal');t.id=titleId;dialog.setAttribute('aria-labelledby',titleId);
  bar.append(n('div','rr-identity',null),button('Volver a la revisión',()=>close(run)));bar.firstChild.append(n('span','rr-kicker','SMYL · RADIOGRAFÍA · HISTORIA LONGITUDINAL'),t,n('span','rr-study-meta',(previous.study?.label||'Anterior')+' → '+(current.study?.label||'Actual')));
  dialog.append(bar,host);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();close(run);});dialog.addEventListener('close',()=>close(run,true));
  const status=(text,kind='')=>{let e=host.querySelector('.rr-feedback');if(!e){e=n('p','rr-feedback');e.setAttribute('role','status');e.setAttribute('aria-live','polite');host.prepend(e);}e.className='rr-feedback '+kind;e.textContent=text;};
  // Una sola solicitud a la vez y mensaje fiel: si el servidor la rechaza (p. ej. exige aprobación clínica), se muestra su motivo.
  const link=async(kind,reason,okText)=>{if(run.linking||run.closed)return;run.linking=true;host.querySelectorAll('.rl-actions button,.rl-blocked button').forEach(b=>{b.disabled=true;});try{await onLink(kind,reason);status(okText,'rr-ok');}catch(e){status(e?.code==='42501'||e?.code==='23514'?e.message:(e?.message||'No se pudo registrar el par.'),'rr-error');}finally{run.linking=false;host.querySelectorAll('.rl-actions button,.rl-blocked button').forEach(b=>{b.disabled=false;});}};
  const verdict=compat||compatibility(previous,current);
  const top=n('section','rr-review rl-review'),head=n('header','rr-review-head'),title=n('div');
  title.append(n('p','rr-step','Historia longitudinal'),n('h1','','Comparar con anterior'),n('p','rr-lead',verdict.verdict==='comparable'?'Estudios comparables: '+verdict.text:'Estudios no comparables: '+verdict.text));head.append(title);top.append(head);
  if(verdict.verdict!=='comparable'){const box=n('section','rv2-qc rl-blocked');box.append(n('strong','','No se compara automáticamente'),n('p','',verdict.text),n('p','rr-note','Puedes marcar el par como no comparable para dejar constancia; la comparación visual queda deshabilitada.'));if(onLink&&caps?.clinicalWrite)box.append(button('Marcar como no comparables',()=>link('incompatible',verdict.text,'Registrado como no comparable.'),'rr-tool'));top.append(box);host.append(top);return;}
  const tools=n('div','rr-view-tools rl-tools'),zoom=n('input');Object.assign(zoom,{type:'range',min:1,max:3,step:.25,value:1});zoom.setAttribute('aria-label','Ampliar ambos visores');run.zoomInput=zoom;zoom.oninput=()=>{run.navs[0].zoomAt(zoom.value);};
  const syncBtn=button('Sincronizar desplazamiento',()=>{run.sync=!run.sync;syncBtn.setAttribute('aria-pressed',String(run.sync));},'rr-tool');syncBtn.setAttribute('aria-pressed','true');
  const flip=button('Alternar anterior / actual',()=>{run.flip=!run.flip;flip.setAttribute('aria-pressed',String(run.flip));ws.dataset.flip=String(run.flip);},'rr-tool');flip.setAttribute('aria-pressed','false');
  const reset=button('Vista original',()=>{run.navs.forEach(nv=>nv.reset());zoom.value=1;},'rr-tool');
  const control=n('label','rr-tool-range');control.append(n('span','','Zoom'),zoom);tools.append(control,syncBtn,flip,reset);top.append(tools);
  const ws=n('div','rl-workspace');ws.dataset.flip='false';ws.append(viewer(run,previous,'ANTERIOR'),viewer(run,current,'ACTUAL'));top.append(ws);
  const pairs=pairByTooth(previous.state,current.state),panel=n('section','rl-panel');
  const block=(label,items,cls)=>{const b=n('section','rv2-block rl-block '+(cls||''));b.append(n('span','',label));const ul=n('ul','rl-list');if(!items.length)ul.append(n('li','rl-empty','Ninguno.'));items.forEach(i=>ul.append(typeof i==='string'?n('li','',i):(()=>{const li=n('li','');li.append(n('strong','',(i.fdi==='general'?'Región general':'Pieza '+i.fdi)+': '),document.createTextNode(i.detail.join(' ')||'Localización '+(i.previous.located?'confirmada':'sin confirmar')+' → '+(i.current.located?'confirmada':'sin confirmar')+'.'));return li;})()));b.append(ul);return b;};
  panel.append(block('Diferencias de adquisición (no son cambios clínicos)',acquisitionDifferences(previous.qc,current.qc),'rl-acq'),block(CATEGORY_LABELS.confirmed,pairs.confirmed,'rl-confirmed'),block(CATEGORY_LABELS.ai_proposed,pairs.aiProposed,'rl-ai'),block(CATEGORY_LABELS.stable,pairs.stable.map(r=>(r.fdi==='general'?'Región general':'Pieza '+r.fdi)+'.'),'rl-stable'),block(CATEGORY_LABELS.unverified,pairs.unverified.map(r=>(r.fdi==='general'?'Región general':'Pieza '+r.fdi)+(r.detail.length?': '+r.detail.join(' '):'.')),'rl-unverified'));
  panel.append(n('p','rr-note rl-measure',MEASUREMENTS_NOTE));
  if(onLink&&caps?.clinicalWrite){const acts=n('div','rr-actions rl-actions');acts.append(button(previous.linkKind==='comparable'?'Par registrado como comparable':'Registrar par como comparable',()=>link('comparable','Comparados por el profesional','Par registrado como comparable.'),'rr-primary'),button('Marcar como no comparables',()=>link('incompatible','Marcado por el profesional','Par registrado como no comparable.'),'rr-tertiary'));panel.append(acts);}
  top.append(panel,n('p','rr-note rr-safety-note','La comparación no genera diagnóstico ni progresión automática; sólo distingue lo que cambió en la adquisición, lo que propone la IA y lo que confirmaste.'));host.append(top);
 }
 const api={REASONS,MEASUREMENTS_NOTE,compatibility,reasonText,acquisitionDifferences,pairByTooth,CATEGORY_LABELS};
 if(typeof document!=='undefined'){api.open=open;api.close=()=>close(active,true);addEventListener('pagehide',()=>close(active,true));}
 return Object.freeze(api);
});
