/* Case workspace, stage 1: organize existing editors, not a new source of truth.
 * No network, storage, AI or implicit approval. Keep editor nodes and safeguards. */
(function () {
 'use strict';
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const btn=(text,fn,primary=false)=>{const e=n('button',primary?'pc-primary':'pc-secondary',text);e.type='button';e.onclick=fn;return e;};
 const copy=(e,value)=>{if(e.textContent!==value)e.textContent=value;};
 let active=null;
 const valid=ctx=>ctx&&!ctx.revoked&&ctx.root.isConnected&&window.tenantId===ctx.tenant&&window.pacienteActual?.id===ctx.patient&&document.getElementById('p-paciente-detalle')?.classList.contains('activa');
 const moduleId=id=>id==='photos'||id==='review'?'evaluation':id==='share'?'approval':id;
 function showEvaluationTask(ctx,id,focus=true){
  if(!ctx?.evaluationTasks?.[id])return false;
  ctx.evaluationTask=id;
  for(const [key,task] of Object.entries(ctx.evaluationTasks)){
   const selected=key===id;task.panel.hidden=!selected;
   task.button.setAttribute('aria-selected',String(selected));
   task.button.tabIndex=selected?0:-1;
   if(selected)task.button.setAttribute('aria-current','step');else task.button.removeAttribute('aria-current');
  }
  const current=ctx.evaluationTasks[id];
  if(ctx.evaluationMobileProgress)copy(ctx.evaluationMobileProgress,'Paso '+current.index+' de 4 · '+current.title);
  updateEvaluationAction(ctx);
  if(focus){const target=ctx.evaluationTasks[id];if(target.button.offsetParent!==null)target.button.focus({preventScroll:true});else{target.panel.tabIndex=-1;target.panel.focus({preventScroll:true});}target.panel.scrollIntoView({block:'start',behavior:'smooth'});}
  return true;
 }
 function evaluationTask(ctx,id,index,title,subtitle){
  const item=n('li',''),button=n('button','cw-evaluation-task'),number=n('span','cw-evaluation-task-number',index),copyBox=n('span','cw-evaluation-task-copy'),stateLabel=n('small','cw-evaluation-task-state','Pendiente');
  button.type='button';button.id='cw-evaluation-task-'+id;button.setAttribute('role','tab');button.setAttribute('aria-controls','cw-evaluation-panel-'+id);copyBox.append(n('strong','',title),n('small','',subtitle));button.append(number,copyBox,stateLabel);button.onclick=()=>showEvaluationTask(ctx,id);button.onkeydown=event=>{if(!['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();const ids=Object.keys(ctx.evaluationTasks),at=ids.indexOf(id),next=event.key==='Home'?0:event.key==='End'?ids.length-1:(at+(event.key==='ArrowUp'||event.key==='ArrowLeft'?-1:1)+ids.length)%ids.length;showEvaluationTask(ctx,ids[next]);};item.append(button);ctx.evaluationTaskList.append(item);
  const panel=n('section','cw-evaluation-panel');panel.id='cw-evaluation-panel-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);const body=n('div','cw-evaluation-panel-body');panel.append(body);ctx.evaluationPanels.append(panel);
  const task={id,index,title,item,button,panel,root:panel,body,badge:stateLabel};ctx.evaluationTasks[id]=task;return task;
 }
 function updateEvaluationAction(ctx){
  if(!ctx?.evaluationCta)return;
  const task=ctx.evaluationTask||'context',flow=ctx.evaluationFlowState||{};
  let label='Continuar a evidencia',status='Contexto clínico pendiente',disabled=false,action=()=>showEvaluationTask(ctx,'evidence');
  if(task==='context'){
   const context=ctx.contextState||{};
   disabled=!context.ready||context.state==='restricted';
   if(context.stale){label='Revisar contexto actualizado';status='El contexto cambió durante esta sesión';action=()=>ctx.openHistoryDrawer?.();}
   else if(context.reviewed){label='Continuar a evidencia';status='Contexto revisado en esta sesión';action=()=>showEvaluationTask(ctx,'evidence');}
   else{label=context.state==='attention'||context.state==='incomplete'?'Revisado y continuar':'Continuar a evidencia';status=context.footer||'Confirma el contexto clínico';action=()=>{if(acknowledgeContext(ctx))showEvaluationTask(ctx,'evidence');};}
  }
  else if(task==='evidence'){label='Continuar a hallazgos';status=ctx.evidencePart?.badge?.textContent||'Revisa la evidencia disponible';action=()=>showEvaluationTask(ctx,'findings');}
  else if(task==='findings'){
   status=ctx.reviewPart?.badge?.textContent||'Completa los hallazgos';
   if(flow.findingsComplete){label='Revisar';action=()=>showEvaluationTask(ctx,'closure');}
   else{label=flow.reviewLabel||'Revisar hallazgos';disabled=!!flow.reviewDisabled;action=()=>{if(ctx.reviewAction)ctx.reviewAction();};}
  }else if(task==='closure'){
   status=flow.reviewComplete?'Evaluación lista para preparar la propuesta':'Aún hay pendientes en la evaluación';
   if(flow.reviewComplete){label='Continuar a propuesta';action=()=>open('plan');}
   else{label=ctx.contextState?.reviewed?'Volver a hallazgos':'Volver a contexto';action=()=>showEvaluationTask(ctx,ctx.contextState?.reviewed?'findings':'context');}
  }
  if(ctx.evaluationFooterStatus)copy(ctx.evaluationFooterStatus,status);
  copy(ctx.evaluationCta,label);ctx.evaluationCta.disabled=disabled;ctx.evaluationAction=action;
 }
 function open(id,focus=true){
  const ctx=active;if(!valid(ctx))return false;
  const requested=id;id=moduleId(id);if(!ctx.modules[id])return false;
  ctx.activeStage=requested==='approval'||requested==='followup'?requested:id;
  // One working section, without unmounting editors or losing drafts.
  const section=ctx.modules[id];
  // Keep every canonical editor mounted: changing stages only changes visibility.
  for(const [key,m] of Object.entries(ctx.modules)){
   const selected=key===id;m.details.hidden=!selected;m.details.dataset.active=String(selected);
  }
  if(requested==='review')showEvaluationTask(ctx,'findings',false);
  else if(requested==='photos')showEvaluationTask(ctx,'evidence',false);
  if(focus){
   const target=requested==='review'?ctx.reviewSection:requested==='photos'?ctx.evidenceSection:section.details;
   section.summary.focus({preventScroll:true});(target||section.details).scrollIntoView({block:'start',behavior:'instant'});
  }
  syncNav(ctx);
  return true;
 }
 function module(ctx,id,index,title,subtitle){
  const details=n('section','cw-module'),summary=n('header','cw-summary'),text=n('span','cw-module-title');details.dataset.module=id;details.dataset.active='false';summary.id='cw-module-title-'+id;summary.tabIndex=-1;details.setAttribute('aria-labelledby',summary.id);
  const badge=n('span','cw-badge','Por completar'),sub=n('span','cw-subtitle',subtitle);
  text.append(n('strong','',title),sub);summary.append(text,badge);
  const body=n('div','cw-body');details.append(summary,body);ctx.root.append(details);
  const value={details,summary,body,badge,sub};ctx.modules[id]=value;
  return value;
 }
 function treatmentPart(index,title,subtitle){
  const root=n('section','cw-evaluation-part'),head=n('header','cw-evaluation-head'),titleWrap=n('div','cw-evaluation-title'),badge=n('span','cw-part-badge','Por revisar'),body=n('div','cw-evaluation-body');
  titleWrap.append(n('span','cw-part-number',index),n('div','',null));
  titleWrap.lastElementChild.append(n('strong','',title),n('small','',subtitle));
  head.append(titleWrap,badge);root.append(head,body);return {root,head,body,badge};
 }
 function syncNav(ctx){const stage=ctx.activeStage==='approval'||ctx.activeStage==='followup'?ctx.activeStage:moduleId(ctx.activeStage);for(const [id,b] of Object.entries(ctx.nav||{})){const mapped=moduleId(id),selected=!ctx.modules[mapped]?.details.hidden&&(mapped==='followup'?id===stage:mapped===stage);if(selected)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');}}
 function navState(ctx,id,label,tone='pending'){const button=ctx.nav?.[id];if(!button)return;button.dataset.state=tone;button.dataset.status=label;button.setAttribute('aria-label',button.dataset.label+' · '+label);}
 function state(ctx,id,label,tone='pending'){const m=ctx.modules[id];copy(m.badge,label);m.badge.dataset.state=tone;m.details.dataset.state=tone;for(const navId of Object.keys(ctx.nav||{}))if(moduleId(navId)===id)navState(ctx,navId,label,tone);}
 function partState(part,label,tone='pending'){if(!part)return;copy(part.badge,label);part.badge.dataset.state=tone;part.root.dataset.state=tone;if(part.button)part.button.dataset.state=tone;}
 function contextStatus(value,count){if(count)return count+' '+(count===1?'registro':'registros');return value==='no'?'Ninguno confirmado':value==='unknown'?'No se sabe':value==='yes'?'Falta detalle':'Por confirmar';}
 function contextMetric(label){const root=n('div',''),term=n('dt','',label),value=n('dd','','—'),detail=n('small','','Cargando');root.append(term,value,detail);return {root,value,detail};}
 function setContextMetric(metric,rows,status){const count=rows?.length||0;copy(metric.value,count?String(count):status==='no'?'0':'—');copy(metric.detail,contextStatus(status,count));metric.root.dataset.state=count?'attention':status==='no'?'done':'pending';}
 function renderContextDrawer(ctx){
  const model=ctx.contextState?.model;if(!model||!ctx.historyDrawerBody)return;
  ctx.historyDrawerBody.replaceChildren();
  const intro=n('p','cw-context-meta','Historia v'+model.historyRevision+(model.updatedAt?' · '+shortDate(model.updatedAt):''));ctx.historyDrawerBody.append(intro);
  const group=(title,rows,empty)=>{const section=n('section','cw-history-drawer-group');section.append(n('h4','',title));const list=n('div','');if(rows.length)rows.forEach(row=>{const item=n('article','');item.append(n('strong','',row.title),n('p','',row.detail));list.append(item);});else list.append(n('p','cw-context-meta',empty));section.append(list);ctx.historyDrawerBody.append(section);};
  group('Alertas médicas',(model.alerts||[]).map(value=>({title:'Alerta',detail:value})),'Sin alertas médicas registradas.');
  group('Alergias',(model.allergies||[]).map(row=>({title:row.substance||'Alergia',detail:row.summary||[row.reaction,row.severity].filter(Boolean).join(' · ')||'Sin detalle'})),'Sin alergias registradas.');
  group('Medicamentos',(model.medications||[]).map(row=>({title:row.name||'Medicamento',detail:row.summary||[row.dose,row.frequency].filter(Boolean).join(' · ')||'Sin detalle'})),'Sin medicamentos registrados.');
  group('Condiciones',(model.conditions||[]).map(row=>({title:row.name||'Condición',detail:row.summary||row.status||'Sin detalle'})),'Sin condiciones registradas.');
  const pending=model.coverage?.pending||[];if(pending.length)ctx.historyDrawerBody.append(n('p','cw-context-pending','Por confirmar: '+pending.join(', ')+'.'));
 }
 function openHistoryDrawer(ctx){
  if(!ctx?.historyDrawer)return false;renderContextDrawer(ctx);
  if(typeof ctx.historyDrawer.showModal==='function'&&!ctx.historyDrawer.open)ctx.historyDrawer.showModal();else ctx.historyDrawer.setAttribute('open','');
  ctx.historyDrawerClose?.focus({preventScroll:true});return true;
 }
 function acknowledgeContext(ctx,acceptChanges=false){
  const state=ctx?.contextState;if(!state?.ready||state.state==='restricted')return false;
  if(state.stale&&!acceptChanges){openHistoryDrawer(ctx);return false;}
  ctx.contextReviewSnapshot={historyRevision:state.model.historyRevision};renderContext(ctx);return true;
 }
 function renderContext(ctx){
  if(!ctx?.contextSummary)return null;
  const model=window.SmylPatient360?.context?.(ctx.tenant,ctx.patient)||null;
  if(!model){
   ctx.contextState={ready:false,state:'loading',reviewed:false,stale:false,model:null,footer:'Cargando contexto clínico'};
   if(ctx.contextFingerprint==='loading'){updateEvaluationAction(ctx);return ctx.contextState;}ctx.contextFingerprint='loading';
   ctx.contextSummary.dataset.state='loading';copy(ctx.contextTitle,'Cargando contexto clínico');copy(ctx.contextRevision,'Historia clínica');copy(ctx.contextMeta,'Esperando la información protegida del expediente.');ctx.contextAlerts.replaceChildren(n('p','cw-context-empty','Cargando contexto clínico…'));setContextMetric(ctx.contextMetrics.allergies,[],'pending');setContextMetric(ctx.contextMetrics.medications,[],'pending');setContextMetric(ctx.contextMetrics.conditions,[],'pending');updateEvaluationAction(ctx);return ctx.contextState;
  }
  const stale=!!ctx.contextReviewSnapshot&&ctx.contextReviewSnapshot.historyRevision!==model.historyRevision,reviewed=!!ctx.contextReviewSnapshot&&!stale;
  const attention=[...(model.alerts||[]).map(value=>({title:'Alerta médica',detail:value,tone:'attention'})),...(model.allergies||[]).map(row=>({title:'Alergia · '+(row.substance||'Sin especificar'),detail:row.summary||row.reaction||'Revisa el detalle en la historia.',tone:row.severity==='high'?'critical':'attention'}))];
  const pending=model.coverage?.pending||[],state=stale?'stale':model.state||'incomplete';
  const title=stale?'El contexto cambió':state==='attention'?(model.attentionCount||attention.length)+' '+((model.attentionCount||attention.length)===1?'dato puede':'datos pueden')+' modificar la atención':state==='ready'?'Contexto clínico confirmado':'Hay información clínica por confirmar';
  const footer=stale?'Actualiza la revisión antes de continuar':reviewed?'Contexto revisado en esta sesión':state==='attention'?(model.attentionCount||attention.length)+' por revisar antes de continuar':state==='incomplete'?pending.length+' '+(pending.length===1?'apartado pendiente':'apartados pendientes'):'Confirma el contexto clínico';
  ctx.contextState={ready:!!model.ready,state,reviewed,stale,model,footer};
  const fingerprint=JSON.stringify({historyRevision:model.historyRevision,updatedAt:model.updatedAt,state,reviewed,stale,attention:model.attentionCount,pending,alerts:model.alerts,allergies:model.allergies,conditions:model.conditions,medications:model.medications});
  if(ctx.contextFingerprint===fingerprint){updateEvaluationAction(ctx);return ctx.contextState;}ctx.contextFingerprint=fingerprint;
  ctx.contextSummary.dataset.state=state;copy(ctx.contextTitle,title);copy(ctx.contextRevision,'Historia v'+model.historyRevision+(model.updatedAt?' · '+shortDate(model.updatedAt):''));copy(ctx.contextMeta,footer+'.');
  ctx.contextAlerts.replaceChildren();
  const rows=attention.length?attention:pending.map(label=>({title:label,detail:'Pendiente de confirmar con el paciente.',tone:'pending'}));
  if(!rows.length){const item=n('article','cw-context-alert');item.dataset.state='done';item.append(n('span','','✓'),n('div','',null));item.lastChild.append(n('strong','','Sin alertas conocidas'),n('p','','Estado confirmado en esta versión de la historia.'));ctx.contextAlerts.append(item);}
  else rows.slice(0,3).forEach(row=>{const item=n('article','cw-context-alert');item.dataset.state=row.tone;item.append(n('span','',row.tone==='critical'?'!':row.tone==='attention'?'!':'?'),n('div','',null));item.lastChild.append(n('strong','',row.title),n('p','',row.detail));ctx.contextAlerts.append(item);});
  if(rows.length>3)ctx.contextAlerts.append(n('p','cw-context-more','+'+(rows.length-3)+' datos más en la historia clínica'));
  setContextMetric(ctx.contextMetrics.allergies,model.allergies,model.statuses?.allergies);setContextMetric(ctx.contextMetrics.medications,model.medications,model.statuses?.medications);setContextMetric(ctx.contextMetrics.conditions,model.conditions,model.statuses?.conditions);
  copy(ctx.contextReviewButton,state==='ready'?'Consultar contexto':stale?'Revisar cambios':'Ver detalles');ctx.contextReviewButton.disabled=!model.ready;renderContextDrawer(ctx);updateEvaluationAction(ctx);return ctx.contextState;
 }
 function mountContext(ctx,patient){
  ctx.contextSummary=n('section','cw-context-summary');ctx.contextSummary.setAttribute('aria-labelledby','cw-context-title');
  const head=n('header','cw-context-head'),copyBox=n('div');copyBox.append(n('span','cw-kicker','ANTES DE EVALUAR'),ctx.contextTitle=n('h3','','Cargando contexto clínico'),ctx.contextRevision=n('p','cw-context-meta','Historia clínica'));ctx.contextTitle.id='cw-context-title';ctx.contextReviewButton=btn('Revisar alertas',()=>openHistoryDrawer(ctx));head.append(copyBox,ctx.contextReviewButton);ctx.contextAlerts=n('div','cw-context-alerts');
  const grid=n('dl','cw-context-grid');ctx.contextMetrics={allergies:contextMetric('Alergias'),medications:contextMetric('Medicamentos'),conditions:contextMetric('Condiciones')};grid.append(ctx.contextMetrics.allergies.root,ctx.contextMetrics.medications.root,ctx.contextMetrics.conditions.root);
  const foot=n('footer','cw-context-foot');ctx.contextMeta=n('p','cw-context-meta','Cargando contexto clínico.');const admin=n('details','cw-context-admin');admin.append(n('summary','','Datos administrativos'));const adminGrid=n('dl','');[['Teléfono',patient.telefono||'Sin registrar'],['Correo',patient.email||'Sin registrar'],['Nacimiento',patient.fecha_nacimiento||patient.fechaNacimiento||'Sin registrar']].forEach(([label,value])=>{const item=n('div','');item.append(n('dt','',label),n('dd','',value));adminGrid.append(item);});admin.append(adminGrid);foot.append(ctx.contextMeta,admin);ctx.contextSummary.append(head,ctx.contextAlerts,grid,foot);ctx.contextPart.body.append(ctx.contextSummary);
  ctx.historyDrawer=n('dialog','cw-history-drawer');ctx.historyDrawer.setAttribute('aria-labelledby','cw-history-drawer-title');const drawerHead=n('header',''),drawerTitle=n('div');drawerTitle.append(n('span','cw-kicker','CONTEXTO CLÍNICO'),n('h3','','Historia para esta evaluación'));drawerTitle.lastChild.id='cw-history-drawer-title';ctx.historyDrawerClose=btn('Cerrar',()=>ctx.historyDrawer.close());drawerHead.append(drawerTitle,ctx.historyDrawerClose);ctx.historyDrawerBody=n('div','cw-history-drawer-body');const drawerFoot=n('footer',''),full=btn('Abrir historia completa',()=>{ctx.historyDrawer.close();window.SmylPatient360?.open('history');}),confirm=btn('Marcar como revisado',()=>{if(acknowledgeContext(ctx,true))ctx.historyDrawer.close();},true);drawerFoot.append(full,confirm);ctx.historyDrawer.append(drawerHead,ctx.historyDrawerBody,drawerFoot);ctx.historyDrawer.addEventListener('click',event=>{if(event.target===ctx.historyDrawer)ctx.historyDrawer.close();});ctx.contextPart.body.append(ctx.historyDrawer);ctx.openHistoryDrawer=()=>openHistoryDrawer(ctx);
 }
 function advancedPart(ctx,index){
  const sections=ctx.advancedSections||[];if(index!==1||!ctx.advancedEditor||!sections[index])return false;
  const content={title:'Agregar estudio radiográfico',subtitle:'Completa sólo los datos necesarios y conserva el original en el expediente.',steps:['Describe el estudio','Selecciona el archivo','Revisa y confirma']};
  ctx.advancedEditor.dataset.activePart='radiograph';copy(ctx.advancedTitle,content.title);copy(ctx.advancedSubtitle,content.subtitle);ctx.advancedGuide.replaceChildren();
  content.steps.forEach((label,step)=>{const item=n('span','');item.append(n('b','',String(step+1)),n('small','',label));ctx.advancedGuide.append(item);});
  sections.forEach((section,current)=>{section.hidden=current!==1;section.open=current===1;});return true;
 }
 function reviewPart(ctx,index){
  const sections=ctx.reviewPart?.body.querySelectorAll('.dr-record>.dr-form>.dr-section')||[];
  if(!sections.length)return false;
  if(!advancedPart(ctx,index))return false;
  ctx.advancedEditor.hidden=false;
  if(ctx.advancedEditor)ctx.advancedEditor.open=true;
  ctx.advancedEditor?.scrollIntoView({block:'start',behavior:'smooth'});
  return true;
 }
 function renderEvidenceHistory(ctx,files,dental,entry){
  if(!ctx.evidenceTimeline)return;
  const views=entry?.row?.document?.views||[],studyItems=dental?.studyItems||[],photoState={loaded:dental?.photoLoaded,reviewed:dental?.hasReview,pending:dental?.pending||0,workflowPending:dental?.workflowPending||0,confirmed:dental?.confirmed||0,rejected:dental?.rejected||0},fingerprint=JSON.stringify({files,studyItems,photoState,views:views.length,caseId:entry?.row?.id||''});
  if(ctx.evidenceFingerprint===fingerprint)return;ctx.evidenceFingerprint=fingerprint;ctx.evidenceTimeline.replaceChildren();
  const aiPending=(dental?.pending||0)+(dental?.workflowPending||0)+(dental?.rxPending||0),aiConfirmed=(dental?.confirmed||0)+(dental?.rxConfirmed||0),compatible=views.length+studyItems.length,assistant=n('aside','cw-evidence-assistant');assistant.dataset.state=aiPending?'pending':aiConfirmed?'done':'neutral';
  const total=views.length+studyItems.length+(files?.total||0),head=n('header','cw-evidence-compact'),title=n('div');title.append(n('span','cw-kicker','EVIDENCIA CLÍNICA'),n('strong','',total?total+' '+(total===1?'registro disponible':'registros disponibles'):'Sin evidencia todavía'));
  const metrics=n('div','cw-evidence-compact-metrics');[['Fotos',views.length],['Rayos X',studyItems.length],['Archivos',files?.total||0]].forEach(([label,value])=>{const item=n('span','');item.append(n('strong','',String(value)),n('small','',label));metrics.append(item);});head.append(title,metrics);ctx.evidenceTimeline.append(head);
  const assistantCopy=n('div');assistantCopy.append(n('strong','',aiPending?aiPending+' '+(aiPending===1?'sugerencia pendiente':'sugerencias pendientes'):aiConfirmed?'Revisión al día':compatible?'Lista para revisar':'Revisión profesional'),n('p','',aiPending?'Nada pasa al odontograma hasta que lo confirmes.':compatible?'La evidencia conserva su fuente y fecha.':'Puedes continuar aunque todavía no existan imágenes.'));
  const assistantStats=n('div','cw-evidence-ai-stats');assistantStats.append(n('span','',aiPending+' pendientes'),n('span','',aiConfirmed+' confirmadas'));assistant.append(assistantCopy,assistantStats);ctx.evidenceTimeline.append(assistant);
  const rows=[];
  if(views.length){const pending=photoState.pending+photoState.workflowPending,review=photoState.loaded===false?{tone:'neutral',label:'Estado sin comprobar'}:pending?{tone:'pending',label:pending+' por confirmar'}:photoState.confirmed?{tone:'done',label:photoState.confirmed+' confirmada'+(photoState.confirmed===1?'':'s')}:photoState.reviewed?{tone:'done',label:'Revisión completada'}:{tone:'available',label:'IA disponible'};rows.push({kind:'photo',label:'Sesión fotográfica',name:views.length+' fotografía'+(views.length===1?' clínica':'s clínicas'),at:entry?.row?.created_at||'',action:'session',review,button:pending?'Revisar pendientes':photoState.reviewed?'Consultar revisión':'Revisar con IA'});}
  studyItems.forEach(study=>{const review=dental?.rxLoaded===false?{tone:'neutral',label:'Estado sin comprobar'}:study.workflow==='unconfirmed'?{tone:'attention',label:'Sin resultado confirmado'}:study.pending?{tone:'pending',label:study.pending+' por confirmar'}:study.confirmed?{tone:'done',label:study.confirmed+' confirmada'+(study.confirmed===1?'':'s')}:study.reviewed?{tone:'done',label:'Revisión completada'}:{tone:'available',label:'IA disponible'};rows.push({kind:'radiograph',label:'Radiografía dental',name:study.label,at:study.date,detail:study.quality?{'usable':'Imagen utilizable','limited':'Imagen limitada','unusable':'Imagen no utilizable'}[study.quality]:'Original privado',action:'radiograph',id:study.id,review,button:'Abrir estudio'});});
  (files?.items||[]).forEach(file=>rows.push({kind:file.category==='radiograph'?'radiograph':'file',label:file.label,name:file.name,at:file.capturedAt||file.createdAt,detail:Math.max(1,Math.round(file.size/1024))+' KB',action:'file',id:file.id,review:{tone:'manual',label:'Revisión profesional'},button:'Abrir'}));
  rows.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));const list=n('div','cw-evidence-list');
  if(!rows.length)list.append(n('p','cw-evidence-empty','Todavía no hay evidencia clínica. Puedes continuar con el odontograma.'));
  else{const row=rows[0],article=n('article','cw-evidence-item cw-evidence-latest');article.dataset.kind=row.kind;const icon=n('span','cw-evidence-icon',row.kind==='photo'?'F':row.kind==='radiograph'?'RX':'A'),copyBox=n('div');copyBox.append(n('span','','REGISTRO MÁS RECIENTE'),n('strong','',row.name));const when=Date.parse(row.at),detail=[Number.isFinite(when)?new Date(when).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}):'Sin fecha',row.detail].filter(Boolean).join(' · '),meta=n('div','cw-evidence-meta');meta.append(n('small','',detail));const review=n('span','cw-evidence-review',row.review.label);review.dataset.state=row.review.tone;meta.append(review);copyBox.append(meta);const action=btn(row.button,()=>{if(row.action==='file')window.SmylPatient360?.openFile?.(ctx.tenant,ctx.patient,row.id);else if(row.action==='radiograph'){if(!window.SmylDentalProgress?.openStudy?.(ctx.tenant,ctx.patient,row.id))reviewPart(ctx,1);}else if(ctx.selected?.current())ctx.selected.review();});action.classList.add('cw-evidence-open');article.append(icon,copyBox,action);list.append(article);}
  ctx.evidenceTimeline.append(list);const foot=n('footer','cw-evidence-history-foot'),previous=btn(rows.length>1?'Ver estudios anteriores':'Ver archivos clínicos',()=>window.SmylPatient360?.open('files'));previous.classList.add('cw-evidence-previous');foot.append(n('p','',rows.length>1?'El historial conserva los estudios anteriores.':'Los originales permanecen en el expediente privado.'),previous);ctx.evidenceTimeline.append(foot);
 }
 function renderClinicalMap(ctx,snapshot){
  if(!ctx.mapHost||!window.SmylToothMap)return;
  ctx.mapSnapshot=snapshot;const filter=ctx.mapFilter||'all',fingerprint=JSON.stringify(snapshot||{})+'|'+filter+'|'+JSON.stringify(ctx.sourceData||{});
  if(ctx.mapFingerprint===fingerprint)return;ctx.mapFingerprint=fingerprint;
  const totals={annotated:0,manual:0,photo:0,radiograph:0,pending:0};
  for(const item of Object.values(snapshot?.teeth||{})){
   if(item.manual||item.photo||item.radiograph||item.pending)totals.annotated++;
   if(item.manual)totals.manual++;totals.photo+=item.photo||0;totals.radiograph+=item.radiograph||0;totals.pending+=item.pending||0;
  }
  window.SmylToothMap.render(ctx.mapHost,{disabled:!snapshot?.ready,onSelect:tooth=>{
   window.SmylDentalProgress?.openTooth(ctx.tenant,ctx.patient,tooth);
  },state:tooth=>{
   const item=snapshot?.teeth?.[tooth]||{},showManual=!!item.manual&&(filter==='all'||filter==='manual'),showPhoto=!!item.photo&&(filter==='all'||filter==='photo'),showRadiograph=!!item.radiograph&&(filter==='all'||filter==='radiograph'),sourcePending=filter==='photo'?item.photoPending:filter==='radiograph'?item.radiographPending:filter==='manual'?0:item.pending;
   if(!showManual&&!showPhoto&&!showRadiograph&&!sourcePending)return {label:'Sin anotación confirmada'};
   const classes=[];if(showManual)classes.push('cw-map-manual','cw-map-'+(item.status||'pending'));if(showPhoto)classes.push('cw-source-photo');if(showRadiograph)classes.push('cw-source-radiograph');if(sourcePending)classes.push('cw-source-pending');
   const parts=[];if(showManual)parts.push('anotación clínica');if(showPhoto)parts.push(item.photo+' fotografía'+(item.photo===1?'':'s')+' confirmada'+(item.photo===1?'':'s'));if(showRadiograph)parts.push(item.radiograph+' radiografía'+(item.radiograph===1?'':'s')+' confirmada'+(item.radiograph===1?'':'s'));if(sourcePending)parts.push(sourcePending+' sugerencia'+(sourcePending===1?'':'s')+' por revisar');
   const count=(showManual?1:0)+(showPhoto?item.photo:0)+(showRadiograph?item.radiograph:0)+(sourcePending||0);
   return {className:classes.join(' '),count,label:parts.join(' · ')};
  }});
  Object.entries(ctx.mapFilters||{}).forEach(([id,button])=>button.setAttribute('aria-pressed',String(id===filter)));
  copy(ctx.mapState,!snapshot?'No disponible':totals.pending?totals.pending+' por revisar':totals.annotated?'Mapa actualizado':'Sin anotaciones');ctx.mapState.dataset.state=!snapshot?'neutral':totals.pending?'pending':totals.annotated?'done':'neutral';
  copy(ctx.mapSummary,totals.annotated?totals.annotated+' '+(totals.annotated===1?'pieza relacionada':'piezas relacionadas'):'Comienza por seleccionar una pieza');
  copy(ctx.mapDetail,snapshot?totals.manual+' clínicas · '+totals.photo+' de fotos · '+totals.radiograph+' de rayos X'+(totals.pending?' · '+totals.pending+' IA por revisar':''):'El mapa se habilitará cuando termine de cargar el expediente dental.');
  ctx.mapFull.disabled=!snapshot?.ready;
  renderSourceWorkspace(ctx,filter,totals);
 }
 function renderSourceWorkspace(ctx,filter,totals){
  if(!ctx.sourceWorkspace)return;ctx.sourceWorkspace.replaceChildren();const data=ctx.sourceData||{},mode=n('article','cw-source-mode');mode.dataset.mode=filter;
  const names={all:['EXPEDIENTE UNIFICADO','Todo el contexto clínico','Consulta las fuentes confirmadas sin duplicar el odontograma.'],manual:['VALORACIÓN PROFESIONAL','Observaciones clínicas por pieza','Selecciona una pieza para registrar hallazgo, conducta y estado de seguimiento.'],photo:['FOTOGRAFÍAS CLÍNICAS','Archivo visual y revisión asistida','Agrega originales al expediente y revisa sugerencias antes de incorporarlas al mapa.'],radiograph:['ESTUDIOS RADIOGRÁFICOS','Rayos X con interpretación asistida','Carga el estudio, registra su tipo y fecha, y confirma únicamente los hallazgos útiles.']},meta=names[filter]||names.all;
  const intro=n('div','cw-source-intro'),icon=n('span','cw-source-icon',filter==='radiograph'?'RX':filter==='photo'?'F':filter==='manual'?'C':'32');intro.append(icon,n('div','',null));intro.lastChild.append(n('span','cw-kicker',meta[0]),n('strong','',meta[1]),n('p','',meta[2]));mode.append(intro);
  const stats=n('div','cw-source-stats');
  const appendStat=(value,label,tone='neutral')=>{const item=n('span','');item.dataset.tone=tone;item.append(n('strong','',String(value)),n('small','',label));stats.append(item);};
  if(filter==='manual'){appendStat(totals.manual,'piezas clínicas',totals.manual?'done':'neutral');appendStat(data.teethFollowing||0,'en seguimiento',(data.teethFollowing||0)?'pending':'neutral');appendStat(data.teethDone||0,'realizadas',(data.teethDone||0)?'done':'neutral');}
  else if(filter==='photo'){appendStat(data.photos||0,'fotografías',data.photos?'done':'neutral');appendStat(data.photoPending||0,'por confirmar',data.photoPending?'pending':'neutral');appendStat(data.photoConfirmed||0,'confirmadas',data.photoConfirmed?'done':'neutral');}
  else if(filter==='radiograph'){appendStat(data.studies||0,'estudios',data.studies?'done':'neutral');appendStat(data.rxPending||0,'por confirmar',data.rxPending?'pending':'neutral');appendStat(data.rxConfirmed||0,'confirmadas',data.rxConfirmed?'done':'neutral');}
  else {appendStat(totals.annotated,'piezas relacionadas',totals.annotated?'done':'neutral');appendStat(data.files||0,'archivos clínicos',data.files?'done':'neutral');appendStat(totals.pending,'IA por revisar',totals.pending?'pending':'neutral');}
  mode.append(stats);
  const suggestion=n('aside','cw-source-suggestion');suggestion.dataset.state=(filter==='photo'&&data.photoPending)||(filter==='radiograph'&&data.rxPending)?'pending':'neutral';suggestion.append(n('span','cw-source-suggestion-icon','✦'),n('div','',null));suggestion.lastChild.append(n('strong','',filter==='manual'?'Registro bajo control profesional':filter==='all'?'Una sola lectura, varias fuentes':'Valoración asistida, no diagnóstico'),n('p','',filter==='manual'?'El hallazgo se guarda únicamente cuando el dentista confirma y guarda sus observaciones.':filter==='all'?'Las fotografías, radiografías y notas clínicas mantienen su origen y fecha.':'La IA puede proponer zonas visibles y limitaciones. El dentista decide qué confirmar, editar o descartar.'));mode.append(suggestion);
  const actions=n('div','cw-source-actions');
  if(filter==='photo'){
   const review=btn(data.photoPending?'Revisar sugerencias':'Iniciar revisión asistida',()=>{if(ctx.selected?.current())ctx.selected.review();});review.disabled=!data.photos;actions.append(btn('Agregar fotografías',()=>window.SmylPatientFiles?.add('clinical_photo')),review);
  }else if(filter==='radiograph'){
   actions.append(btn('Agregar radiografía',()=>reviewPart(ctx,1)));
   if(data.firstStudy)actions.append(btn('Abrir último estudio',()=>window.SmylDentalProgress?.openStudy?.(ctx.tenant,ctx.patient,data.firstStudy)));
  }else if(filter==='manual'){
   actions.append(btn('Seleccionar una pieza',()=>ctx.mapHost.scrollIntoView({block:'center',behavior:'smooth'})));
  }else actions.append(btn('Ver archivos clínicos',()=>window.SmylPatient360?.open('files')));
  mode.append(actions);ctx.sourceWorkspace.append(mode);
 }
 function organizeReview(ctx,dental){
  if(!dental||dental.dataset.workspaceOrganized==='true')return;
  dental.dataset.workspaceOrganized='true';
  ctx.advancedSections=[...dental.querySelectorAll(':scope>.dr-form>.dr-section')];ctx.advancedSections.forEach((section,index)=>{section.open=false;section.dataset.cwPart=index===1?'radiograph':'odontogram';});
  const advanced=n('details','cw-advanced-editor'),summary=n('summary','');ctx.advancedTitle=n('strong','','Agregar estudio radiográfico');ctx.advancedSubtitle=n('small','','Completa sólo los datos necesarios y conserva el original en el expediente.');const summaryCopy=n('span','');summaryCopy.append(ctx.advancedTitle,ctx.advancedSubtitle);summary.append(n('span','cw-source-icon','✦'),summaryCopy,n('span','cw-advanced-toggle','Abrir'));ctx.advancedGuide=n('div','cw-advanced-guide');advanced.append(summary,ctx.advancedGuide);dental.before(advanced);advanced.append(dental);ctx.advancedEditor=advanced;advanced.hidden=true;advanced.addEventListener('toggle',()=>{ctx.advancedEditor.classList.toggle('is-open',advanced.open);ctx.advancedEditor.querySelector('.cw-advanced-toggle').textContent=advanced.open?'Cerrar':'Abrir';});advancedPart(ctx,1);advanced.hidden=true;
 }
 function shortDate(value){
  const when=Date.parse(value);return Number.isFinite(when)?new Date(when).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}):'Sin registro';
 }
 function renderEvolution(ctx,progress,dental,clinical){
  if(!ctx.evolution)return;
  const data={progress,dental:dental?.teeth||null,confirmed:(dental?.confirmed||0)+(dental?.rxConfirmed||0),plan:!!clinical?.ready};
  const fingerprint=JSON.stringify(data);if(ctx.evolutionFingerprint===fingerprint)return;ctx.evolutionFingerprint=fingerprint;ctx.evolution.replaceChildren();
  const notes=progress?.notes||{},appointments=progress?.appointments||{},teeth=dental?.teeth||{},confirmed=data.confirmed;
  const head=n('header','cw-evolution-head'),copyBox=n('div');copyBox.append(n('span','cw-kicker','HISTORIAL DEL TRATAMIENTO'),n('strong','','Qué se ha trabajado'),n('p','','Cada control conserva fecha, autor y versión. Lo anterior no se reemplaza.'));
  const ready=!!clinical?.ready&&!dental?.dirty&&!((dental?.pending||0)+(dental?.workflowPending||0)+(dental?.rxPending||0))&&!!notes.signed;
  const readiness=n('span','cw-evolution-readiness',ready?'Listo para documentar cierre':notes.drafts?'Evolución en borrador':notes.signed?'Seguimiento activo':'Primer control pendiente');readiness.dataset.state=ready?'done':notes.drafts?'pending':'neutral';head.append(copyBox,readiness);ctx.evolution.append(head);
  const metrics=n('dl','cw-evolution-metrics');[['Evoluciones',notes.total||0,(notes.signed||0)+' firmadas'],['Citas completadas',appointments.completed||0,appointments.upcoming?(appointments.upcoming+' próximas'):'Sin próxima cita'],['Piezas en seguimiento',teeth.following||0,(teeth.done||0)+' realizadas'],['Hallazgos confirmados',confirmed,'Revisión profesional']].forEach(([label,value,detail])=>{const item=n('div');item.append(n('dt','',label),n('dd','',String(value)),n('small','',detail));metrics.append(item);});ctx.evolution.append(metrics);
  const body=n('div','cw-evolution-body'),latest=n('section','cw-evolution-latest');latest.append(n('span','cw-kicker','ÚLTIMO CONTROL'),n('strong','',notes.latest?notes.latest.label:'Sin evolución registrada'),n('p','',notes.latest?shortDate(notes.latest.createdAt)+' · '+(notes.latest.status==='signed'?'Firmada e inmutable':'Borrador pendiente de firma'):'Registra la primera evolución para iniciar el historial clínico del caso.'));
  const route=n('ol','cw-evolution-route');[['Evaluación',dental?.ready?'Odontograma disponible':'Mapa pendiente',!!dental?.ready],['Propuesta',clinical?.ready?'Propuesta revisada':'Propuesta por completar',!!clinical?.ready],['Seguimiento',notes.signed?'Historial iniciado':'Registrar evolución',!!notes.signed]].forEach(([title,detail,done])=>{const item=n('li');item.dataset.done=String(done);item.append(n('span','',done?'✓':'○'),n('div','',null));item.lastChild.append(n('strong','',title),n('small','',detail));route.append(item);});body.append(latest,route);ctx.evolution.append(body);
  const actions=n('div','cw-evolution-actions');
  const evolve=btn(notes.drafts?'Continuar evolución':'Registrar evolución',()=>window.SmylPatientProgress?.newEvolution(),true);evolve.disabled=!progress?.ready||progress.canWrite===false;
  const map=btn('Actualizar odontograma',()=>{open('evaluation');ctx.mapHost?.scrollIntoView({block:'center',behavior:'smooth'});});
  const history=btn('Ver historial clínico',()=>window.SmylPatient360?.open('notes'));
  actions.append(evolve,map,history);ctx.evolution.append(actions,n('p','cw-evolution-note',ready?'El cierre se documenta con una evolución firmada y el odontograma actualizado; SMYL no cierra casos automáticamente.':'Completa los pendientes clínicos antes de documentar el cierre.'));
 }
 function mount(){
  const screen=document.getElementById('p-paciente-detalle'),layout=screen?.querySelector('.clinic-layout');
  if(!layout||window.pacienteActual?._local)return;
  if(active?.root.isConnected&&active.patient===window.pacienteActual?.id&&active.tenant===window.tenantId){if(!active.revoked)adopt(active);return;}
  const patient=window.pacienteActual,root=n('section','cw-workspace'),ctx={root,layout,patient:patient.id,tenant:window.tenantId,modules:{},selected:null,entries:null,receipts:new Map(),summary:null};active=ctx;
  root.setAttribute('aria-label','Atención integral del paciente');layout.classList.add('cw-layout');screen.classList.add('cw-enhanced');
  const patientHead=n('header','cw-patient-head'),patientIdentity=n('div','cw-patient-identity'),patientActions=n('div','cw-patient-actions');
  patientIdentity.append(n('p','cw-kicker','PACIENTE ACTUAL'),n('h1','',[patient.nombre,patient.apellido].filter(Boolean).join(' ')||'Paciente'),n('p','cw-patient-meta',[patient.telefono||'Sin teléfono',patient.email||'Sin correo'].join(' · ')));
  ctx.patientStatus=n('span','cw-patient-status','Expediente protegido');
  patientActions.append(btn('Abrir Agenda',()=>window.ir('agenda')),btn('Editar datos',()=>window.abrirModalPaciente?.(patient.id)));
  patientHead.append(patientIdentity,ctx.patientStatus,patientActions);root.append(patientHead);
  const quick=n('nav','cw-quick-links');quick.setAttribute('aria-label','Áreas del expediente');
  [['Resumen','overview'],['Expediente','history'],['Tratamiento','plan'],['Actividad','appointments']].forEach(([label,key])=>{const action=btn(label,()=>key==='plan'?open('plan'):window.SmylPatient360?.open(key));action.dataset.patientSection=key;quick.append(action);});root.append(quick);
  ctx.overview=n('p','cw-stage-status');ctx.overview.setAttribute('role','status');root.append(ctx.overview);ctx.nav={};
  const evaluation=module(ctx,'evaluation','01','Evaluación','Contexto, evidencia y hallazgos.');evaluation.details.dataset.active='true';ctx.activeStage='evaluation';
  const plan=module(ctx,'plan','02','Propuesta','Valoración, procedimientos y fases.');plan.details.hidden=true;
  const approval=module(ctx,'approval','03','Aceptación','Cotización, consentimiento y decisión.');approval.details.hidden=true;
  const followup=module(ctx,'followup','04','Seguimiento e historial','Citas, evoluciones y trabajo realizado.');followup.details.hidden=true;
  const progress=n('nav','cw-nav');progress.setAttribute('aria-label','Etapas del caso');
  [['evaluation','Evaluación'],['plan','Propuesta'],['approval','Aceptación'],['followup','Seguimiento']].forEach(([id,label])=>{const step=n('button','',label);step.type='button';step.dataset.label=label;step.onclick=()=>open(id);ctx.nav[id]=step;progress.append(step);});
  ctx.overview.after(progress);
  const evaluationFlow=n('section','cw-evaluation-flow');ctx.evaluationMobileProgress=n('p','cw-evaluation-mobile-progress','Paso 1 de 4 · Contexto');ctx.evaluationTaskList=n('ol','cw-evaluation-tasks');ctx.evaluationTaskList.setAttribute('role','tablist');ctx.evaluationTaskList.setAttribute('aria-label','Tareas de la evaluación');ctx.evaluationPanels=n('div','cw-evaluation-panels');ctx.evaluationTasks={};evaluationFlow.append(ctx.evaluationMobileProgress,ctx.evaluationTaskList,ctx.evaluationPanels);evaluation.body.append(evaluationFlow);
  ctx.contextPart=evaluationTask(ctx,'context','01','Contexto','Historia y alertas');
  ctx.evidencePart=evaluationTask(ctx,'evidence','02','Evidencia','Archivos y estudios');ctx.evidenceSection=ctx.evidencePart.root;
  ctx.reviewPart=evaluationTask(ctx,'findings','03','Hallazgos','Odontograma y revisión');ctx.reviewSection=ctx.reviewPart.root;
  ctx.closePart=evaluationTask(ctx,'closure','04','Revisión','Antes de la propuesta');
  ctx.contextCopy=n('p','cw-evaluation-intro','Confirma la seguridad clínica antes de revisar imágenes.');ctx.contextPart.body.append(ctx.contextCopy);mountContext(ctx,patient);
  const versionNote=n('aside','cw-version-note'),versionCopy=n('div');versionCopy.append(n('strong','','Versiones guardadas'),n('p','','Cada guardado crea una nueva versión. Lo anterior no se reemplaza.'));ctx.planHistory=btn('Ver historial',()=>{const history=document.getElementById('clinic-history');if(!history)return;history.hidden=false;history.open=true;history.scrollIntoView({block:'start',behavior:'smooth'});});versionNote.append(n('span','','✓'),versionCopy,ctx.planHistory);plan.body.append(versionNote);
  const clinical=screen.querySelector('.clinic-workspace');if(clinical)plan.body.append(clinical);
  const documentActions=n('div','cw-action-row');documentActions.append(btn('Abrir archivos clínicos',()=>window.SmylPatient360?.open('files')));
  ctx.evidenceTimeline=n('section','cw-evidence-history');ctx.photoHint=n('p','cw-help','Las simulaciones se mantienen separadas de la evidencia clínica.');ctx.evidencePart.body.append(ctx.evidenceTimeline,ctx.photoHint,documentActions);
  const simulationLink=n('aside','cw-simulation-link');simulationLink.innerHTML='<div><span>ESPACIO INDEPENDIENTE</span><strong>Simulaciones de sonrisa</strong><small>Comparaciones visuales orientativas, separadas del expediente clínico.</small></div><div><button type="button" data-open-simulations>Ver simulaciones</button><a href="simulacion-rapida.html?workspace=professional">Nueva simulación</a></div>';
  simulationLink.querySelector('[data-open-simulations]').onclick=()=>window.ir('historial');ctx.evidencePart.body.append(simulationLink);
  const clinicalMap=n('section','cw-clinical-map'),mapHead=n('header','cw-clinical-map-head'),mapTitle=n('div');mapTitle.append(n('span','cw-kicker','MAPA CLÍNICO LONGITUDINAL'),n('strong','','Odontograma verificable por fuente'),n('p','','Selecciona una pieza para revisar su evidencia y registrar la valoración profesional.'));
  ctx.mapState=n('span','cw-part-badge','Cargando mapa');mapHead.append(mapTitle,ctx.mapState);clinicalMap.append(mapHead);
  const filters=n('div','cw-map-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar anotaciones del odontograma');ctx.mapFilters={};
  [['all','Todo'],['manual','Clínica'],['photo','Fotografías'],['radiograph','Rayos X']].forEach(([id,label])=>{const control=btn(label,()=>{ctx.mapFilter=id;ctx.mapFingerprint='';renderClinicalMap(ctx,ctx.mapSnapshot);});control.classList.add('cw-map-filter');ctx.mapFilters[id]=control;filters.append(control);});clinicalMap.append(filters);ctx.sourceWorkspace=n('div','cw-source-workspace');clinicalMap.append(ctx.sourceWorkspace);
  const mapLayout=n('div','cw-clinical-map-layout'),mapStage=n('div','cw-map-stage');mapStage.append(n('div','dr-orientation',''));mapStage.firstChild.append(n('span','','Derecha del paciente'),n('span','','Izquierda del paciente'));ctx.mapHost=n('div','cw-clinical-odontogram');ctx.mapHost.setAttribute('aria-label','Odontograma FDI interactivo');mapStage.append(ctx.mapHost);
  const mapAside=n('aside','cw-map-aside');ctx.mapSummary=n('strong','','Preparando el mapa');ctx.mapDetail=n('p','','Comprobando anotaciones clínicas y evidencia confirmada.');ctx.reviewText=n('p','cw-help');ctx.reviewButton=btn('Analizar fotografías',()=>{if(valid(ctx)&&ctx.reviewAction)ctx.reviewAction();});ctx.mapFull=btn('Seleccionar una pieza',()=>ctx.mapHost?.scrollIntoView({block:'center',behavior:'smooth'}));ctx.mapFull.hidden=true;mapAside.append(n('span','cw-kicker','VISTA ACTUAL'),ctx.mapSummary,ctx.mapDetail,ctx.reviewText,ctx.reviewButton);mapLayout.append(mapStage,mapAside);clinicalMap.append(mapLayout);
  const mapLegend=n('div','cw-map-legend');[['manual','Clínica'],['photo','Fotografía confirmada'],['radiograph','Rayos X confirmado'],['pending','IA por revisar']].forEach(([tone,label])=>mapLegend.append(n('span','cw-map-key cw-map-key-'+tone,label)));clinicalMap.append(mapLegend);ctx.reviewPart.body.append(clinicalMap);
  ctx.reviewHelp=n('p','cw-help','El odontograma superior es el único mapa clínico. Las radiografías son opcionales; las herramientas inferiores sólo sirven para registrar una observación o agregar un estudio, y las simulaciones nunca se utilizan como evidencia clínica.');ctx.reviewPart.body.append(ctx.reviewHelp);
  const closeSummary=n('section','cw-evaluation-close');ctx.closeTitle=n('h3','','Revisión pendiente');ctx.closeCopy=n('p','','Comprueba el contexto y los hallazgos antes de preparar la propuesta.');const closeFacts=n('dl','cw-evaluation-close-facts'),contextFact=n('div',''),evidenceFact=n('div',''),findingsFact=n('div','');contextFact.append(n('dt','','Contexto'),ctx.closeContext=n('dd','','Sin revisar'));evidenceFact.append(n('dt','','Evidencia'),ctx.closeEvidence=n('dd','','Sin comprobar'));findingsFact.append(n('dt','','Hallazgos'),ctx.closeFindings=n('dd','','Pendientes'));closeFacts.append(contextFact,evidenceFact,findingsFact);closeSummary.append(ctx.closeTitle,ctx.closeCopy,closeFacts);ctx.closePart.body.append(closeSummary);
  const evaluationFoot=n('footer','cw-evaluation-footer');ctx.evaluationFooterStatus=n('span','cw-evaluation-footer-status','Cargando contexto clínico');ctx.evaluationCta=btn('Continuar a evidencia',()=>{if(valid(ctx)&&ctx.evaluationAction)ctx.evaluationAction();},true);ctx.evaluationCta.classList.add('cw-evaluation-cta');evaluationFoot.append(ctx.evaluationFooterStatus,ctx.evaluationCta);evaluationFlow.append(evaluationFoot);showEvaluationTask(ctx,'context',false);
  const planProgress=n('ul','cw-checklist');ctx.planChecks={};
  for(const [id,label] of [['assessment','Completar valoración'],['treatments','Elegir tratamientos'],['approved','Revisar propuesta']]){const item=n('li','',label);item.dataset.label=label;planProgress.append(item);ctx.planChecks[id]=item;}
  plan.body.prepend(planProgress);
  ctx.shareHint=n('p','cw-help');approval.body.append(ctx.shareHint);
  approval.body.append(n('p','cw-share-copy','La cotización usa la propuesta revisada. La presentación visual es opcional y nunca incluye antecedentes ni notas internas.'));
  ctx.planNext=btn('Revisar propuesta',()=>document.getElementById('clinic-review')?.click(),true);const planFoot=n('div','cw-module-footer');planFoot.append(ctx.planNext);plan.body.append(planFoot);
  ctx.quoteButton=btn('Preparar cotización',()=>window.SmylProposals?.forPatient(ctx.patient),true);
  ctx.shareButton=btn('Preparar presentación mySmyl',()=>{if(ctx.selected?.current())ctx.selected.present();});
  ctx.fixPlan=btn('Completar propuesta',()=>{open('plan');document.getElementById('clinic-assessment')?.focus({preventScroll:true});});
  const actions=n('div','cw-action-row');actions.append(ctx.quoteButton,ctx.shareButton,ctx.fixPlan);approval.body.append(actions,n('p','cw-help','Preparar una cotización o crear un enlace no envía nada automáticamente. El profesional conserva la revisión final.'));
  ctx.history=btn('Consultar enlaces y solicitudes',()=>{if(valid(ctx)&&ctx.selected?.current())ctx.selected.present();});
  const past=n('details','cw-contact');past.append(n('summary','','Presentaciones anteriores'),n('p','cw-help','Consulta su vigencia o revoca un acceso desde «Enlaces anteriores y mensajes del paciente». Abrirlo no crea ni envía una propuesta.'),ctx.history);approval.body.append(past);
  ctx.evolution=n('section','cw-evolution');followup.body.append(ctx.evolution);
  ctx.followupButton=btn('Continuar seguimiento en Mensajes',()=>window.ir('inbox'),true);ctx.followupButton.hidden=true;ctx.followupActions=n('div','cw-action-row');ctx.followupActions.hidden=true;ctx.followupActions.append(ctx.followupButton);followup.body.append(ctx.followupActions);
  layout.append(root);adopt(ctx);refresh();
 }
 function adopt(ctx){
  const screen=document.getElementById('p-paciente-detalle'),gallery=screen.querySelector('.pc-gallery'),dental=screen.querySelector('.dr-record');
  if(gallery&&!gallery.closest('[data-p360-panel="simulations"]')&&!ctx.evidencePart.body.contains(gallery)){gallery.classList.add('cw-simulation-source');gallery.setAttribute('aria-hidden','true');ctx.evidencePart.body.insertBefore(gallery,ctx.photoHint);}
  if(dental&&!ctx.reviewPart.body.contains(dental))ctx.reviewPart.body.insertBefore(dental,ctx.reviewHelp);
  organizeReview(ctx,dental);
 }
 function select(ctx,entry){
  ctx.selected=entry;
  for(const item of ctx.entries||[]){item.card.classList.toggle('cw-selected',item===entry);const radio=item.card.querySelector('.cw-case-choice input');if(radio)radio.checked=item===entry;}
  dispatchEvent(new CustomEvent('smyl:case-selection',{detail:{tenant:ctx.tenant,patient:ctx.patient,caseId:entry?.row.id||''}}));
  refresh();
 }
 function refresh(){
  const ctx=active;if(!valid(ctx))return;
  const gallery=ctx.root.querySelector('.pc-gallery')||document.querySelector('#p-paciente-detalle [data-p360-panel="simulations"] .pc-gallery');
  if(gallery?.smylCaseEntries!==ctx.entries){
   ctx.entries=gallery?.smylCaseEntries||[];ctx.selected=null;
  }
  ctx.entries.forEach((entry,index)=>{
   if(entry.card.querySelector('.cw-case-choice'))return;
   const label=n('label','cw-case-choice'),radio=n('input');radio.type='radio';radio.name='cw-case';radio.value=entry.row.id;
   const when=Date.parse(entry.row.created_at),date=Number.isFinite(when)?new Date(when).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}):'Sesión '+(index+1);
   label.append(radio,n('span','',date+(index===0?' · más reciente':'')));entry.card.prepend(label);radio.onchange=()=>{if(valid(ctx)&&entry.current())select(ctx,entry);};
  });
  if(!ctx.selected&&ctx.entries.length){select(ctx,ctx.entries[0]);return;}
  const entry=ctx.selected,views=entry?.row.document.views||[],count=views.length,pairs=views.filter(v=>v.result).length;
  const load=gallery?.dataset.loadState;
  const files=window.SmylPatient360?.files?.(ctx.tenant,ctx.patient),progress=window.SmylPatientProgress?.status?.(ctx.tenant,ctx.patient),clinical=window.SmylClinicalWorkflow?.status(ctx.tenant,ctx.patient),dental=window.SmylDentalProgress?.status(ctx.tenant,ctx.patient,entry?.row.id),evidenceTotal=count+(dental?.studies||0)+(files?.total||0);
  const evidenceLabel=evidenceTotal?evidenceTotal+(evidenceTotal===1?' evidencia':' evidencias'):load==='ready'?'Sin evidencia':'Cargando documentación';
  const contextState=renderContext(ctx),contextReviewed=!!contextState?.reviewed&&!contextState.stale;
  const contextLabel=contextState?.stale?'Contexto actualizado':contextReviewed?(contextState.state==='ready'?'Revisado':'Revisado con pendientes'):contextState?.state==='attention'?(contextState.model?.attentionCount||0)+' por revisar':contextState?.state==='incomplete'?'Por confirmar':'Cargando';
  partState(ctx.contextPart,contextLabel,contextReviewed?(contextState.state==='ready'?'done':'neutral'):'pending');
  partState(ctx.evidencePart,evidenceLabel,evidenceTotal?'done':load==='error'||load==='unavailable'?'neutral':'pending');
  copy(ctx.photoHint,count?count+' fotografías originales disponibles. Las simulaciones se consultan por separado.':'Sin fotografías clínicas. Puedes continuar con el odontograma.');
  renderEvidenceHistory(ctx,files,dental,entry);
  const photoPending=(dental?.pending||0)+(dental?.workflowPending||0),rxPending=dental?.rxPending||0;
  const findingsComplete=!!dental?.hasReview&&!photoPending&&!rxPending&&!dental?.dirty&&dental?.photoLoaded===true;
  let reviewLabel=count?'Fotografías por revisar':'Odontograma pendiente',reviewCopy=count?'Analiza las fotografías y confirma únicamente las observaciones que quieras incorporar al mapa.':'Abre el odontograma y registra únicamente hallazgos confirmados por el profesional.';
  if(!dental?.ready){reviewLabel='No disponible';reviewCopy='Espera a que cargue el mapa o revisa el aviso de conexión de este módulo.';}
  else if(dental.dirty){reviewLabel='Cambios sin guardar';reviewCopy='Guarda las observaciones del mapa antes de continuar.';}
  else if(count&&!dental.photoLoaded){reviewLabel='Por comprobar';reviewCopy='No se pudo confirmar el avance del análisis fotográfico. Ningún resultado dudoso se incorporó al mapa.';}
  else if(dental.hasReview){reviewLabel=photoPending||rxPending?(photoPending+rxPending)+' por revisar':'Lista';reviewCopy=dental.confirmed+' observaciones confirmadas · '+dental.pending+' pendientes · '+dental.rejected+' descartadas. Esto no sustituye tu valoración clínica.';}
  if(dental?.studies&&dental.rxLoaded)reviewCopy+=' Radiografías: '+dental.studies+' guardadas · '+dental.rxReviews+' revisadas · '+dental.rxConfirmed+' confirmadas · '+dental.rxPending+' pendientes.';
  else if(dental?.studies&&!dental.rxLoaded)reviewCopy+=' El avance de radiografías aún no pudo comprobarse.';
  partState(ctx.reviewPart,reviewLabel,findingsComplete?'done':dental?.hasReview?'neutral':'pending');copy(ctx.reviewText,reviewCopy);
  ctx.reviewButton.disabled=!entry||!dental?.ready||dental.busy||dental.dirty;
  if(findingsComplete){copy(ctx.reviewButton,'Revisar evaluación');ctx.reviewAction=()=>showEvaluationTask(ctx,'closure');}
  else if(rxPending&&!photoPending){copy(ctx.reviewButton,'Revisar radiografías pendientes');ctx.reviewAction=()=>reviewPart(ctx,1);}
  else if(!count){copy(ctx.reviewButton,'Seleccionar una pieza');ctx.reviewAction=()=>ctx.mapHost.scrollIntoView({block:'center',behavior:'smooth'});}
  else {copy(ctx.reviewButton,dental?.hasReview?(photoPending?'Revisar '+photoPending+' observaciones':'Continuar análisis'):'Analizar fotografías');ctx.reviewAction=()=>{if(ctx.selected?.current())ctx.selected.review();};}
  ctx.reviewButton.hidden=findingsComplete;
  const reviewDisabled=!entry||!dental?.ready||dental.busy||dental.dirty;
  const evaluationComplete=findingsComplete&&contextReviewed;
  partState(ctx.closePart,evaluationComplete?'Lista para la propuesta':'Pendiente',evaluationComplete?'done':'pending');
  copy(ctx.closeTitle,evaluationComplete?'Lista para la propuesta':'Revisión pendiente');
  copy(ctx.closeCopy,evaluationComplete?'El contexto y los hallazgos quedaron revisados en esta sesión.':'Completa los pendientes antes de preparar la propuesta.');
  copy(ctx.closeContext,contextState?.stale?'Cambió · revisar':contextReviewed?'Revisado en esta sesión':contextState?.state==='attention'?'Alertas por revisar':'Sin revisar');
  copy(ctx.closeEvidence,evidenceLabel);copy(ctx.closeFindings,reviewLabel);
  ctx.evaluationFlowState={reviewComplete:evaluationComplete,findingsComplete,reviewLabel:ctx.reviewButton.textContent,reviewDisabled};updateEvaluationAction(ctx);
  ctx.sourceData={photos:count,photoPending,photoConfirmed:dental?.confirmed||0,studies:dental?.studies||0,rxPending,rxConfirmed:dental?.rxConfirmed||0,firstStudy:dental?.studyItems?.[0]?.id||'',files:files?.total||0,teethFollowing:dental?.teeth?.following||0,teethDone:dental?.teeth?.done||0};
  renderClinicalMap(ctx,window.SmylDentalProgress?.map?.(ctx.tenant,ctx.patient,entry?.row.id));
  state(ctx,'evaluation',evaluationComplete?'Lista para propuesta':contextState?.stale?'Contexto actualizado':!contextReviewed?'Contexto por revisar':dental?.hasReview?'Revisión en curso':'Requiere revisión',evaluationComplete?'done':dental?.hasReview?'neutral':'pending');
  const planComplete=evaluationComplete&&clinical?.ready;
  ctx.planHistory.disabled=!document.getElementById('clinic-history');
  state(ctx,'plan',clinical?.saving?'Guardando':clinical?.dirty?'Cambios sin guardar':clinical?.ready?'Propuesta revisada':clinical?.saved?'Borrador guardado':clinical?.available?'Por completar':'No disponible',clinical?.ready?'done':'pending');
  for(const [id,done] of [['assessment',clinical?.assessment],['treatments',clinical?.treatments],['approved',clinical?.ready]]){const item=ctx.planChecks[id];copy(item,(done?'✓ ':'○ ')+item.dataset.label);item.dataset.done=String(!!done);}
  if(clinical?.ready&&!evaluationComplete){copy(ctx.planNext,'Terminar evaluación');ctx.planNext.disabled=false;ctx.planNext.onclick=()=>{open('evaluation');showEvaluationTask(ctx,contextReviewed?'findings':'context');};}
  else if(!clinical?.ready){const reviewButton=document.getElementById('clinic-review');copy(ctx.planNext,'Revisar propuesta');ctx.planNext.disabled=!reviewButton||reviewButton.disabled;ctx.planNext.onclick=()=>reviewButton?.click();}
  else {copy(ctx.planNext,'Continuar a aceptación');ctx.planNext.disabled=!planComplete;ctx.planNext.onclick=()=>open('approval');}
  const quoteReady=!!clinical?.ready,eligible=pairs>0&&planComplete;
  renderEvolution(ctx,progress,dental,clinical);
  const receipt=ctx.receipts.get(entry?.row.id),created=eligible&&receipt&&Date.parse(receipt.expiresAt)>Date.now()&&receipt.revision===clinical?.revision;
  state(ctx,'approval',created?'Preparada':quoteReady?'Lista para preparar':'Pendiente',created?'done':quoteReady?'neutral':'pending');
  state(ctx,'followup',created?'En curso':'Pendiente',created?'done':'pending');
  copy(ctx.shareHint,!clinical?.ready?'Falta revisar y guardar la propuesta.':!pairs?'La propuesta ya puede cotizarse. La presentación visual estará disponible cuando exista una foto con simulación guardada.':'Propuesta lista para cotizar y comparación visual disponible para la presentación.');
  const canQuote=!!window.SmylProposals;ctx.quoteButton.disabled=!quoteReady||!canQuote;ctx.quoteButton.title=canQuote?'':'Cotizaciones todavía no está disponible.';ctx.shareButton.disabled=!eligible;ctx.fixPlan.hidden=!!clinical?.ready;ctx.followupButton.hidden=!created;ctx.followupActions.hidden=!created;
  ctx.history.disabled=!entry;
  if(created)copy(ctx.shareHint,'Se creó un enlace en esta sesión. Compártelo junto con el código por separado. SMYL no confirma si ya lo enviaste.');
  // Suggested route, not a claim that all clinical issues were evaluated.
  copy(ctx.overview,!evaluationComplete?'Etapa 1 de 4 · Completa la evaluación.':!clinical?.ready?'Etapa 2 de 4 · Prepara la propuesta.':!created?'Etapa 3 de 4 · Registra la aceptación.':'Etapa 4 de 4 · Continúa el seguimiento.');
  syncNav(ctx);
 }
 function init(){
  const screen=document.getElementById('p-paciente-detalle');if(!screen)return;
  new MutationObserver(mount).observe(screen,{childList:true,subtree:true});
  // Local snapshots only. Never queries the database or runs an analysis.
  setInterval(refresh,400);mount();
  addEventListener('smyl:portal-created',e=>{const ctx=active,d=e.detail;if(valid(ctx)&&d?.tenant===ctx.tenant&&d.patient===ctx.patient){ctx.receipts.set(d.caseId,{expiresAt:d.expiresAt,revision:d.revision});refresh();}});
  addEventListener('smyl:portal-revoked',e=>{const ctx=active,d=e.detail;if(valid(ctx)&&d?.tenant===ctx.tenant&&d.patient===ctx.patient){ctx.receipts.delete(d.caseId);refresh();}});
  addEventListener('smyl:patient-summary',e=>{const ctx=active,d=e.detail;if(!valid(ctx)||d?.tenant!==ctx.tenant||d.patient!==ctx.patient)return;ctx.summary=d;const parts=[];if(d.alerts)parts.push(d.alerts+' '+(d.alerts===1?'alerta clínica':'alertas clínicas'));if(d.nextAppointment){const when=new Date(d.nextAppointment);parts.push('Próxima cita · '+when.toLocaleDateString('es-MX',{day:'numeric',month:'short'})+' '+when.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}));}copy(ctx.patientStatus,parts.join(' · ')||'Expediente al día');ctx.patientStatus.dataset.alerts=String(!!d.alerts);refresh();});
  addEventListener('smyl:patient-context-updated',e=>{const ctx=active,d=e.detail;if(!valid(ctx)||d?.tenant!==ctx.tenant||d.patient!==ctx.patient)return;ctx.contextFingerprint='';refresh();});
  window.sb?.auth?.onAuthStateChange?.((event,session)=>{const ctx=active;if(ctx?.root.isConnected&&(session?.user?.id!==ctx.tenant||session.user.is_anonymous)){ctx.revoked=true;ctx.entries=null;ctx.selected=null;ctx.receipts.clear();ctx.root.replaceChildren(n('p','cw-overview','La sesión cambió. Abre nuevamente el expediente con la cuenta autorizada.'));}});
 }
 window.SmylCaseWorkspace={open,context(tenant,patient){const ctx=active;if(!valid(ctx)||ctx.tenant!==tenant||ctx.patient!==patient)return null;const entry=ctx.selected;return entry&&entry.current()?{caseId:entry.row.id,isCurrent:()=>valid(ctx)&&ctx.selected===entry&&entry.current()}:null;}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
