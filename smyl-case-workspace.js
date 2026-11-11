/* Case workspace, stage 1: organize existing editors, not a new source of truth.
 * No network, storage, AI or implicit approval. Keep editor nodes and safeguards. */
(function () {
 'use strict';
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const btn=(text,fn,primary=false)=>{const e=n('button',primary?'pc-primary':'pc-secondary',text);e.type='button';e.onclick=fn;return e;};
 const copy=(e,value)=>{if(e.textContent!==value)e.textContent=value;};
 let active=null;
 const views=new Map();
 const valid=ctx=>ctx&&!ctx.revoked&&ctx.root.isConnected&&window.tenantId===ctx.tenant&&window.pacienteActual?.id===ctx.patient&&document.getElementById('p-paciente-detalle')?.classList.contains('activa');
 const moduleId=id=>id==='photos'||id==='review'?'evaluation':id==='share'?'approval':id;
 const viewKey=ctx=>String(ctx?.tenant||'')+'::'+String(ctx?.patient||'');
 function restoreView(ctx){
  const saved=views.get(viewKey(ctx))||{},stages=['evaluation','plan','approval','followup'],tasks=['context','evidence','findings','closure'];
  return {stage:stages.includes(saved.stage)?saved.stage:'evaluation',task:tasks.includes(saved.task)?saved.task:'context'};
 }
 function rememberView(ctx){
  if(!ctx?.root?.isConnected)return;
  views.set(viewKey(ctx),{stage:moduleId(ctx.activeStage||'evaluation'),task:ctx.evaluationTask||'context'});
 }
 function showEvaluationTask(ctx,id,focus=true){
  if(!ctx?.evaluationTasks?.[id])return false;
  ctx.evaluationTask=id;
  if(ctx.evaluationFlow)ctx.evaluationFlow.dataset.activeTask=id;
  for(const [key,task] of Object.entries(ctx.evaluationTasks)){
   const selected=key===id;task.panel.hidden=!selected;
   task.button.setAttribute('aria-selected',String(selected));
   task.button.tabIndex=selected?0:-1;
   if(selected)task.button.setAttribute('aria-current','step');else task.button.removeAttribute('aria-current');
  }
  const current=ctx.evaluationTasks[id];
  if(ctx.evaluationMobileProgress)copy(ctx.evaluationMobileProgress,'Paso '+current.index+' de 4 · '+current.title);
  updateEvaluationAction(ctx);
  rememberView(ctx);
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
  else if(task==='evidence'){label='Continuar a valoración';status=ctx.evidencePart?.badge?.textContent||'Revisa la evidencia disponible';action=()=>showEvaluationTask(ctx,'findings');}
  else if(task==='findings'){
   status=ctx.reviewPart?.badge?.textContent||'Completa la valoración clínica';
   if(flow.findingsComplete){label='Revisar';action=()=>showEvaluationTask(ctx,'closure');}
   else{label=flow.reviewLabel||'Continuar valoración';disabled=!!flow.reviewDisabled;action=()=>{if(ctx.reviewAction)ctx.reviewAction();};}
  }else if(task==='closure'){
   status=flow.reviewComplete?'Evaluación lista para preparar la propuesta':'Aún hay pendientes en la evaluación';
   if(flow.reviewComplete){label='Continuar a propuesta';action=()=>open('plan');}
   else{label=ctx.contextState?.reviewed?'Volver a valoración':'Volver a contexto';action=()=>showEvaluationTask(ctx,ctx.contextState?.reviewed?'findings':'context');}
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
  rememberView(ctx);
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
  ctx.evidenceTimeline.append(list);const foot=n('footer','cw-evidence-history-foot'),hasRadiographs=studyItems.length>0,previous=btn(hasRadiographs?'Ver radiografías':rows.length>1?'Ver evidencia anterior':'Ver archivos clínicos',()=>{if(hasRadiographs){showEvaluationTask(ctx,'findings');ctx.mapFilters?.radiograph?.click();}else window.SmylPatient360?.open('files');});previous.classList.add('cw-evidence-previous');foot.append(n('p','',hasRadiographs?'Consulta todos los estudios en Valoración clínica, sin duplicar originales.':rows.length>1?'El historial conserva la evidencia anterior.':'Los originales permanecen en el expediente privado.'),previous);ctx.evidenceTimeline.append(foot);
 }
 const radiographTypes={panoramic:'Panorámica',periapical:'Periapical',bitewing:'Aleta de mordida',other:'Otra radiografía'};
 function openRadiograph(ctx,id){
  if(!window.SmylDentalProgress?.openStudy?.(ctx.tenant,ctx.patient,id))reviewPart(ctx,1);
 }
 function radiographStatus(study){
  if(study.workflow==='unconfirmed')return {tone:'attention',label:'Sin resultado confirmado'};
  if(study.pending)return {tone:'pending',label:study.pending+' '+(study.pending===1?'hallazgo por revisar':'hallazgos por revisar')};
  if(study.confirmed)return {tone:'done',label:study.confirmed+' '+(study.confirmed===1?'hallazgo confirmado':'hallazgos confirmados')};
  if(study.reviewed)return {tone:'done',label:'Revisión completada'};
  return {tone:'neutral',label:'Pendiente de revisión'};
 }
 function radiographDate(value){
  const raw=String(value||'').trim(),dateOnly=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);let date;
  if(dateOnly)date=new Date(Number(dateOnly[1]),Number(dateOnly[2])-1,Number(dateOnly[3]));else date=new Date(raw);
  return Number.isFinite(date.getTime())?date.toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}):'Sin fecha';
 }
 function radiographProgress(study){
  const confirmed=Number(study?.confirmed)||0,rejected=Number(study?.rejected)||0,pending=Number(study?.pending)||0;
  const total=Math.max(0,Number(study?.total)||(confirmed+rejected+pending)),reviewed=Math.min(total,Math.max(0,Number(study?.reviewedCount)||(confirmed+rejected)));
  return {total,reviewed,pending};
 }
 function radiographQueueMatch(study,filter){
  const progress=radiographProgress(study);
  if(filter==='pending')return progress.pending>0||study.workflow==='unconfirmed';
  if(filter==='reviewed')return progress.pending===0&&study.workflow==='completed';
  if(filter==='limited')return study.quality==='limited'||study.quality==='unusable';
  if(filter==='duplicates')return study.isDuplicate===true;
  return true;
 }
 function radiographQuality(study){
  return ({usable:{tone:'done',label:'Imagen utilizable'},limited:{tone:'attention',label:'Calidad limitada'},unusable:{tone:'danger',label:'No utilizable'}})[study.quality]||{tone:'neutral',label:'Calidad no evaluada'};
 }
 function radiographCta(study){
  const progress=radiographProgress(study);
  if(study.workflow==='unconfirmed')return 'Revisar resultado';
  if(progress.pending)return 'Revisar '+progress.pending+' pendiente'+(progress.pending===1?'':'s');
  if(study.workflow==='completed'&&progress.pending===0)return 'Consultar revisión';
  return 'Revisar estudio';
 }
 function renderRadiographShelf(ctx){
  if(!ctx.radiographShelf)return;
  const enabled=(ctx.mapFilter||'all')==='radiograph';ctx.radiographShelf.hidden=!enabled;if(!enabled){ctx.radiographPreviewObserver?.disconnect();ctx.radiographPreviewObserver=null;return;}
  const studies=[...(ctx.studyItems||[])].sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)),tooth=String(ctx.selectedTooth||''),related=tooth?studies.filter(study=>(study.teeth||[]).includes(tooth)):studies,baseVisible=tooth&&related.length?related:studies,queueFilter=ctx.radiographQueueFilter||'all',visible=baseVisible.filter(study=>radiographQueueMatch(study,queueFilter)),pendingTotal=studies.reduce((sum,study)=>sum+radiographProgress(study).pending,0),unconfirmedTotal=studies.filter(study=>study.workflow==='unconfirmed').length,duplicateTotal=studies.filter(study=>study.isDuplicate).length;
  const fingerprint=JSON.stringify({studies,tooth,queueFilter});if(ctx.radiographShelfFingerprint===fingerprint)return;ctx.radiographShelfFingerprint=fingerprint;const token=(ctx.radiographPreviewToken||0)+1;ctx.radiographPreviewToken=token;ctx.radiographPreviewObserver?.disconnect();ctx.radiographShelf.replaceChildren();
  const queueSummary=[studies.length+' '+(studies.length===1?'estudio':'estudios')];if(unconfirmedTotal)queueSummary.push(unconfirmedTotal+' '+(unconfirmedTotal===1?'estudio por revisar':'estudios por revisar'));if(pendingTotal)queueSummary.push(pendingTotal+' '+(pendingTotal===1?'hallazgo pendiente':'hallazgos pendientes'));if(duplicateTotal)queueSummary.push(duplicateTotal+' posible'+(duplicateTotal===1?' duplicado':'s duplicados'));
  const head=n('header','cw-radiograph-shelf-head'),copyBox=n('div'),summary=n('strong','',studies.length?queueSummary.join(' · '):'Sin estudios radiográficos');summary.setAttribute('aria-live','polite');copyBox.append(n('span','cw-kicker','ESTUDIOS RADIOGRÁFICOS'),summary,n('p','',tooth&&related.length?'Mostrando los estudios vinculados con la pieza '+tooth+'.':tooth?'La pieza '+tooth+' no tiene un estudio vinculado; se muestran todos.':'Consulta el avance de cada estudio y abre su revisión profesional.'));head.append(copyBox);
  if(tooth){const clear=btn('Ver todos',()=>{ctx.selectedTooth='';ctx.mapFingerprint='';renderClinicalMap(ctx,ctx.mapSnapshot);});clear.classList.add('cw-radiograph-clear');head.append(clear);}ctx.radiographShelf.append(head);
  if(!studies.length){const empty=n('div','cw-radiograph-empty');empty.append(n('span','','RX'),n('div','',null));empty.lastChild.append(n('strong','','Todavía no hay radiografías guardadas'),n('p','','Agrega un estudio para verlo aquí y relacionarlo con el odontograma.'));const add=btn('Agregar radiografía',()=>reviewPart(ctx,1),true);empty.append(add);ctx.radiographShelf.append(empty);return;}
  const filters=n('div','cw-radiograph-queue-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar estudios radiográficos');[['all','Todos'],['pending','Pendientes'],['reviewed','Revisados'],['limited','Calidad limitada'],['duplicates','Duplicados']].forEach(([id,label])=>{if(id==='duplicates'&&!duplicateTotal)return;const control=btn(label,()=>{ctx.radiographQueueFilter=id;ctx.radiographShelfFingerprint='';renderRadiographShelf(ctx);});control.setAttribute('aria-pressed',String(id===queueFilter));filters.append(control);});ctx.radiographShelf.append(filters);
  if(!visible.length){const empty=n('div','cw-radiograph-empty cw-radiograph-filter-empty');empty.append(n('span','','RX'),n('div','',null));empty.lastChild.append(n('strong','','No hay estudios en este estado'),n('p','','Cambia el filtro para consultar el resto de la historia radiográfica.'));const reset=btn('Ver todos',()=>{ctx.radiographQueueFilter='all';ctx.radiographShelfFingerprint='';renderRadiographShelf(ctx);});empty.append(reset);ctx.radiographShelf.append(empty);return;}
  const grid=n('div','cw-radiograph-grid'),previewEntries=new WeakMap();grid.setAttribute('role','list');grid.setAttribute('aria-label','Cola de estudios radiográficos');
  const loadPreview=({study,card,placeholder,image})=>Promise.resolve(window.SmylDentalProgress.previewStudy(ctx.tenant,ctx.patient,study.id)).then(blob=>{
   if(!(blob instanceof Blob)||!valid(ctx)||ctx.radiographPreviewToken!==token||!card.isConnected){placeholder.textContent='Vista previa no disponible';return;}
   const url=URL.createObjectURL(blob);let released=false,timer;const release=()=>{if(released)return;released=true;clearTimeout(timer);URL.revokeObjectURL(url);};image.addEventListener('load',()=>{image.hidden=false;placeholder.hidden=true;release();},{once:true});image.addEventListener('error',()=>{placeholder.textContent='Vista previa no disponible';release();},{once:true});timer=setTimeout(release,30000);image.src=url;
  }).catch(()=>{if(card.isConnected)placeholder.textContent='Vista previa no disponible';});
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;const preview=previewEntries.get(entry.target);observer.unobserve(entry.target);if(preview)loadPreview(preview);}),{root:grid,rootMargin:'100px'}):null;ctx.radiographPreviewObserver=observer;
  visible.forEach((study,index)=>{
   const card=n('article','cw-radiograph-card'),media=n('div','cw-radiograph-media'),placeholder=n('span','cw-radiograph-placeholder','RX'),image=n('img'),body=n('div','cw-radiograph-card-body'),meta=n('div','cw-radiograph-card-meta'),status=radiographStatus(study),quality=radiographQuality(study),progress=radiographProgress(study),open=btn(radiographCta(study),()=>openRadiograph(ctx,study.id));card.dataset.related=String(!tooth||(study.teeth||[]).includes(tooth));card.setAttribute('role','listitem');image.alt='Vista previa privada de '+study.label;image.hidden=true;media.append(placeholder,image);
   const date=radiographDate(study.date),kind=radiographTypes[study.type]||radiographTypes.other,pieces=(study.teeth||[]).length?'Piezas '+study.teeth.join(', '):'Sin piezas vinculadas';meta.append(n('span','',kind+' · '+date),n('span','',pieces));const badges=n('div','cw-radiograph-badges'),badge=n('span','cw-radiograph-status',status.label),qualityBadge=n('span','cw-radiograph-status',quality.label);badge.dataset.tone=status.tone;qualityBadge.dataset.tone=quality.tone;badges.append(badge,qualityBadge);if(study.isDuplicate){const duplicate=n('span','cw-radiograph-status','Posible duplicado exacto');duplicate.dataset.tone='duplicate';badges.append(duplicate);}const progressBox=n('div','cw-radiograph-progress'),progressCopy=progress.total?progress.reviewed+' de '+progress.total+' revisados':study.workflow==='completed'?'Revisión completada sin hallazgos':'Sin hallazgos generados',progressLabel=n('span','',progressCopy),progressTrack=n('span','cw-radiograph-progress-track'),progressFill=n('i','');progressBox.setAttribute('aria-label',progressLabel.textContent);progressFill.style.width=(progress.total?Math.round(progress.reviewed/progress.total*100):study.workflow==='completed'?100:0)+'%';progressTrack.append(progressFill);progressBox.append(progressLabel,progressTrack);const actions=n('div','cw-radiograph-card-actions');actions.append(open);if(window.SmylDentalProgress?.archiveStudy&&ctx.findingsActionState?.dental?.canManageStudies){const remove=btn('Retirar',()=>window.SmylDentalProgress.archiveStudy(ctx.tenant,ctx.patient,study.id));remove.classList.add('cw-radiograph-remove');actions.append(remove);}body.append(n('strong','',study.label),meta,badges,progressBox,actions);card.append(media,body);grid.append(card);
   if(window.SmylDentalProgress?.previewStudy){const preview={study,card,placeholder,image};if(observer){previewEntries.set(card,preview);observer.observe(card);}else if(index<2)loadPreview(preview);}
  });ctx.radiographShelf.append(grid);
 }
 function toothAnatomy(tooth){
  const id=String(tooth||''),quadrant=Number(id[0]),position=Number(id[1]),types={1:'Incisivo central',2:'Incisivo lateral',3:'Canino',4:'Primer premolar',5:'Segundo premolar',6:'Primer molar',7:'Segundo molar',8:'Tercer molar'};
  if(!types[position]||quadrant<1||quadrant>4)return 'Pieza '+id;
  const arch=quadrant<3?'superior':'inferior',side=quadrant===1||quadrant===4?'derecho':'izquierdo';
  return 'Pieza '+id+' · '+types[position]+' '+arch+' '+side;
 }
 async function drawRadiographCrop(ctx,finding,canvas,marker,status,token){
  const blob=await window.SmylDentalProgress?.previewStudy?.(ctx.tenant,ctx.patient,finding.studyId);if(!(blob instanceof Blob))throw Error('preview');
  let image,revoke=()=>{};try{
   if(typeof createImageBitmap==='function')image=await createImageBitmap(blob);else{const url=URL.createObjectURL(blob);revoke=()=>URL.revokeObjectURL(url);image=await new Promise((resolve,reject)=>{const value=new Image();value.onload=()=>resolve(value);value.onerror=reject;value.src=url;});}
   if(!valid(ctx)||ctx.radiographCropToken!==token||!canvas.isConnected)return;
   const clamp=(value,min,max)=>Math.max(min,Math.min(max,value)),width=image.width||image.naturalWidth,height=image.height||image.naturalHeight,cx=clamp(Number(finding.x),0,1),cy=clamp(Number(finding.y),0,1),boxW=clamp(Number(finding.w)||.07,.02,.6),boxH=clamp(Number(finding.h)||.12,.02,.6),ratio=1.8;
   let cropW=clamp(Math.max(.22,boxW*3.4),.18,.64),cropH=Math.max(.2,boxH*2.8,cropW*width/(ratio*height));cropH=clamp(cropH,.18,.64);cropW=clamp(Math.max(cropW,cropH*ratio*height/width),.18,.72);
   const left=clamp(cx-cropW/2,0,1-cropW),top=clamp(cy-cropH/2,0,1-cropH),context=canvas.getContext('2d',{alpha:false});canvas.width=720;canvas.height=400;context.drawImage(image,left*width,top*height,cropW*width,cropH*height,0,0,canvas.width,canvas.height);
   marker.style.left=((cx-boxW/2-left)/cropW*100)+'%';marker.style.top=((cy-boxH/2-top)/cropH*100)+'%';marker.style.width=(boxW/cropW*100)+'%';marker.style.height=(boxH/cropH*100)+'%';canvas.hidden=false;marker.hidden=false;status.hidden=true;
  }finally{image?.close?.();revoke();}
 }
 function renderToothRadiographContext(ctx,tooth){
  const host=ctx.mapInspectorRadiographs;if(!host)return;host.replaceChildren();host.hidden=(ctx.mapFilter||'all')!=='radiograph'||!tooth;if(host.hidden)return;
  const context=window.SmylDentalProgress?.toothRadiographContext?.(ctx.tenant,ctx.patient,tooth);
  host.setAttribute('aria-live','polite');host.append(n('span','cw-kicker','RADIOGRAFÍA RELACIONADA'));
  if(!context){host.append(n('p','cw-help','No pudimos verificar el detalle radiográfico de esta pieza. Abre el estudio para revisarlo.'));return;}
  const studies=Array.isArray(context.studies)?context.studies:[],findings=Array.isArray(context.findings)?context.findings:studies.flatMap(study=>(Array.isArray(study.findings)?study.findings:[]).map(finding=>({...finding,studyId:finding.studyId||study.id,studyLabel:finding.studyLabel||study.label})));
  if(!findings.length){host.append(n('p','cw-help',studies.length?'Esta pieza no tiene señales radiográficas registradas.':'No hay estudios vinculados con esta pieza.'));return;}
  const ordered=[...findings].sort((a,b)=>(a.state==='confirmed'?-1:0)-(b.state==='confirmed'?-1:0)),preview=n('figure','cw-radiograph-crop'),caption=n('figcaption'),captionTitle=n('strong'),captionMeta=n('span'),view=n('div','cw-radiograph-crop-view'),canvas=n('canvas'),marker=n('span','cw-radiograph-crop-marker'),loading=n('span','cw-radiograph-crop-loading','Preparando recorte…'),detail=n('p','cw-radiograph-crop-detail'),switcher=n('div','cw-radiograph-crop-switcher'),open=btn('Abrir estudio completo',()=>{});canvas.hidden=true;marker.hidden=true;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Recorte de la radiografía correspondiente a la pieza '+tooth);caption.append(captionTitle,captionMeta);view.append(canvas,marker,loading);preview.append(caption,view,detail);open.classList.add('cw-radiograph-crop-open');
  const buttons=ordered.map((finding,index)=>{const control=btn(ordered.length===1?'Señal vinculada':'Señal '+(index+1),()=>select(finding,control));control.dataset.state=finding.state||'pending';control.setAttribute('aria-label','Mostrar señal '+(index+1)+' de la pieza '+tooth);switcher.append(control);return control;});
  const select=(finding,control)=>{buttons.forEach(button=>button.setAttribute('aria-pressed',String(button===control)));const study=studies.find(value=>value.id===finding.studyId),state=({pending:'Por revisar',confirmed:'Confirmada',corrected:'Corregida',rejected:'Descartada'})[finding.state]||'Sin decisión';copy(captionTitle,study?.label||finding.studyLabel||'Estudio radiográfico');copy(captionMeta,[state,study?radiographDate(study.date):''].filter(Boolean).join(' · '));copy(detail,finding.text||finding.sourceText||'Señal radiográfica por comprobar.');open.onclick=()=>openRadiograph(ctx,finding.studyId);canvas.hidden=true;marker.hidden=true;loading.hidden=false;loading.textContent=Number.isFinite(finding.x)&&Number.isFinite(finding.y)?'Preparando recorte…':'Esta señal no tiene un recuadro guardado.';const token=(ctx.radiographCropToken||0)+1;ctx.radiographCropToken=token;if(Number.isFinite(finding.x)&&Number.isFinite(finding.y))drawRadiographCrop(ctx,finding,canvas,marker,loading,token).catch(()=>{if(valid(ctx)&&ctx.radiographCropToken===token&&loading.isConnected){loading.hidden=false;loading.textContent='No pudimos mostrar el recorte. Abre el estudio completo.';}});};
  host.append(preview);if(ordered.length>1)host.append(switcher);host.append(open);select(ordered[0],buttons[0]);
 }
 function renderMapInspector(ctx,snapshot,totals){
  if(!ctx.mapInspectorTitle)return;
  const tooth=ctx.selectedTooth,item=tooth?snapshot?.teeth?.[tooth]||{}:null,radiographMode=(ctx.mapFilter||'all')==='radiograph';
  ctx.mapInspector.dataset.empty=String(!tooth);
  copy(ctx.mapInspectorTitle,tooth?toothAnatomy(tooth):'Selecciona una pieza');
  copy(ctx.mapInspectorMeta,tooth?(ctx.mapFilter==='radiograph'?'Revisa el recorte y la conclusión vinculada.':'Consulta la evidencia vinculada a esta pieza.'):'El mapa conserva la selección mientras cambias de capa.');
  ctx.mapInspectorFacts.replaceChildren();
  const addFact=(value,label,tone='neutral')=>{if(!value)return;const fact=n('span','cw-map-inspector-fact',String(value)+' '+label);fact.dataset.value=String(value);fact.dataset.tone=tone;ctx.mapInspectorFacts.append(fact);};
  if(tooth){
   addFact(item.manual?1:0,'clínica',item.status==='done'?'done':'neutral');addFact(item.photo||0,'foto'+(item.photo===1?'':'s'),'done');addFact(item.radiograph||0,'hallazgo'+(item.radiograph===1?' RX':'s RX'),'done');addFact(item.pending||0,'por revisar','pending');
   if(!ctx.mapInspectorFacts.childElementCount)ctx.mapInspectorFacts.append(n('span','cw-map-inspector-fact','Sin registros en esta pieza'));
   const status={pending:'Pendiente de seguimiento',following:'En seguimiento',done:'Tratamiento realizado'}[item.status];
   copy(ctx.mapInspectorStatus,item.manual?(status||'Valoración profesional registrada'):item.pending?'Sugerencias pendientes de revisión':'Sin valoración clínica registrada');
  }else{
   if((ctx.mapFilter||'all')==='radiograph'){addFact((ctx.studyItems||[]).length,'estudio'+((ctx.studyItems||[]).length===1?'':'s'),'done');addFact(totals.radiograph,'hallazgo'+(totals.radiograph===1?' confirmado':'s confirmados'),'done');addFact(totals.radiographPending,'por revisar','pending');}
   else{addFact(totals.annotated,'piezas relacionadas','done');addFact(totals.pending,'por revisar','pending');}
   if(!ctx.mapInspectorFacts.childElementCount)ctx.mapInspectorFacts.append(n('span','cw-map-inspector-fact','Sin registros en esta capa'));
   copy(ctx.mapInspectorStatus,'Selecciona una pieza para ver su contexto sin abrir el editor.');
  }
  ctx.mapInspectorStatus.hidden=!!tooth&&radiographMode;
  renderToothRadiographContext(ctx,tooth);
  ctx.mapEdit.hidden=radiographMode;
  ctx.mapEdit.disabled=!snapshot?.ready||!tooth;
 }
  function openClinicalPhotoIntake(ctx){
   showEvaluationTask(ctx,'evidence');
   requestAnimationFrame(()=>window.SmylEvidenceCenterIntegration?.openAdd?.('photograph'));
  }
  function openClinicalPhotoReview(ctx,studyId){
   showEvaluationTask(ctx,'findings');
   requestAnimationFrame(()=>{const section=document.querySelector('.scpr-root');section?.scrollIntoView({block:'start',behavior:'smooth'});if(studyId)window.SmylClinicalPhotoReview?.open?.(studyId);else window.SmylClinicalPhotoReview?.openFirst?.();});
  }
 function syncFindingsAction(ctx){
  const state=ctx.findingsActionState;if(!state||!ctx.reviewButton)return;
  const filter=ctx.mapFilter||'all',baseDisabled=!!state.reviewDisabled,data=ctx.sourceData||{};
  let label='Seleccionar una pieza',disabled=baseDisabled,action=()=>ctx.mapHost?.scrollIntoView({block:'center',behavior:'smooth'});
  if(state.findingsComplete){label='Revisar evaluación';action=()=>showEvaluationTask(ctx,'closure');}
  else if(filter==='manual'){
   label=ctx.selectedTooth?'Editar pieza '+ctx.selectedTooth:'Seleccionar una pieza';
   action=()=>ctx.selectedTooth?window.SmylDentalProgress?.openTooth(ctx.tenant,ctx.patient,ctx.selectedTooth):ctx.mapHost?.scrollIntoView({block:'center',behavior:'smooth'});
  }else if(filter==='photo'){
    if(state.photoPending){label='Revisar '+state.photoPending+' sugerencia'+(state.photoPending===1?'':'s');disabled=false;action=()=>openClinicalPhotoReview(ctx,state.firstPendingPhotoStudy||state.firstPhotoStudy);}
    else if(!state.photoCount){label='Agregar fotografías';disabled=false;action=()=>openClinicalPhotoIntake(ctx);}
    else{label=state.hasReview?'Revisar fotografías':'Analizar fotografías';disabled=false;action=()=>openClinicalPhotoReview(ctx,state.firstPhotoStudy);}
  }else if(filter==='radiograph'){
   if(state.rxPending){label='Revisar '+state.rxPending+' '+(state.rxPending===1?'hallazgo pendiente':'hallazgos pendientes');action=()=>reviewPart(ctx,1);}
   else if(data.firstStudy){label='Abrir último estudio';action=()=>{if(!window.SmylDentalProgress?.openStudy?.(ctx.tenant,ctx.patient,data.firstStudy))reviewPart(ctx,1);};}
   else{label='Agregar radiografía';action=()=>reviewPart(ctx,1);}
  }else if(filter==='pending'){
   if(state.photoPending){label='Revisar '+state.photoPending+' de fotografías';disabled=false;action=()=>openClinicalPhotoReview(ctx,state.firstPendingPhotoStudy||state.firstPhotoStudy);}
   else if(state.rxPending){label='Revisar '+state.rxPending+' pendiente'+(state.rxPending===1?'':'s');action=()=>reviewPart(ctx,1);}
   else{label=ctx.selectedTooth?'Editar pieza '+ctx.selectedTooth:'Seleccionar una pieza';action=()=>ctx.selectedTooth?window.SmylDentalProgress?.openTooth(ctx.tenant,ctx.patient,ctx.selectedTooth):ctx.mapHost?.scrollIntoView({block:'center',behavior:'smooth'});}
  }else if(state.photoPending){label='Revisar '+state.photoPending+' observación'+(state.photoPending===1?'':'es');disabled=false;action=()=>openClinicalPhotoReview(ctx,state.firstPendingPhotoStudy||state.firstPhotoStudy);}
  else if(state.rxPending){label='Revisar '+state.rxPending+' '+(state.rxPending===1?'hallazgo RX pendiente':'hallazgos RX pendientes');action=()=>reviewPart(ctx,1);}
  else if(state.photoCount){label=state.hasReview?'Continuar análisis':'Analizar fotografías';disabled=false;action=()=>openClinicalPhotoReview(ctx,state.firstPhotoStudy);}
  else if(ctx.selectedTooth){label='Editar pieza '+ctx.selectedTooth;action=()=>window.SmylDentalProgress?.openTooth(ctx.tenant,ctx.patient,ctx.selectedTooth);}
  copy(ctx.reviewButton,label);ctx.reviewButton.disabled=disabled;ctx.reviewAction=action;
  ctx.evaluationFlowState={reviewComplete:state.evaluationComplete,findingsComplete:state.findingsComplete,reviewLabel:label,reviewDisabled:disabled};updateEvaluationAction(ctx);
 }
 function renderClinicalMap(ctx,snapshot){
  if(!ctx.mapHost||!window.SmylToothMap)return;
  ctx.mapSnapshot=snapshot;const filter=ctx.mapFilter||'all',fingerprint=JSON.stringify(snapshot||{})+'|'+filter+'|'+String(ctx.selectedTooth||'')+'|'+JSON.stringify(ctx.sourceData||{})+'|'+JSON.stringify(ctx.studyItems||[]);
  if(ctx.mapFingerprint===fingerprint)return;ctx.mapFingerprint=fingerprint;
  const totals={annotated:0,manual:0,photo:0,photoTeeth:0,photoPending:0,radiograph:0,radiographTeeth:0,radiographPending:0,pending:0,pendingTeeth:0};
  for(const item of Object.values(snapshot?.teeth||{})){
   if(item.manual||item.photo||item.radiograph||item.pending)totals.annotated++;
   if(item.manual)totals.manual++;if(item.photo)totals.photoTeeth++;if(item.radiograph)totals.radiographTeeth++;if(item.pending)totals.pendingTeeth++;
   totals.photo+=item.photo||0;totals.photoPending+=item.photoPending||0;totals.radiograph+=item.radiograph||0;totals.radiographPending+=item.radiographPending||0;totals.pending+=item.pending||0;
  }
  window.SmylToothMap.render(ctx.mapHost,{disabled:!snapshot?.ready,onSelect:tooth=>{
   ctx.selectedTooth=String(tooth);ctx.mapFingerprint='';renderClinicalMap(ctx,snapshot);syncFindingsAction(ctx);if(innerWidth<=1024)requestAnimationFrame(()=>ctx.mapInspector?.scrollIntoView({block:'nearest',behavior:'smooth'}));
  },state:tooth=>{
   const item=snapshot?.teeth?.[tooth]||{},selected=String(tooth)===String(ctx.selectedTooth||''),showManual=!!item.manual&&(filter==='all'||filter==='manual'),showPhoto=!!item.photo&&(filter==='all'||filter==='photo'),showRadiograph=!!item.radiograph&&(filter==='all'||filter==='radiograph'),sourcePending=filter==='photo'?item.photoPending:filter==='radiograph'?item.radiographPending:filter==='manual'?0:item.pending;
   if(!showManual&&!showPhoto&&!showRadiograph&&!sourcePending)return {selected,className:selected?'cw-map-selected':'',label:selected?'Seleccionada · sin registros en esta capa':'Sin anotación en esta capa'};
   const classes=[];if(showManual)classes.push('cw-map-manual','cw-map-'+(item.status||'pending'));if(showPhoto)classes.push('cw-source-photo');if(showRadiograph)classes.push('cw-source-radiograph');if(sourcePending)classes.push('cw-source-pending');if(selected)classes.push('cw-map-selected');
   const parts=[];if(selected)parts.push('seleccionada');if(showManual)parts.push('anotación clínica');if(showPhoto)parts.push(item.photo+' fotografía'+(item.photo===1?'':'s')+' confirmada'+(item.photo===1?'':'s'));if(showRadiograph)parts.push(item.radiograph+' hallazgo'+(item.radiograph===1?' RX confirmado':'s RX confirmados'));if(sourcePending)parts.push(sourcePending+' sugerencia'+(sourcePending===1?'':'s')+' por revisar');
   const count=(showManual?1:0)+(showPhoto?item.photo:0)+(showRadiograph?item.radiograph:0)+(sourcePending||0);
   return {selected,className:classes.join(' '),count,label:parts.join(' · ')};
  }});
  const studyCount=(ctx.studyItems||[]).length,counts={all:totals.annotated,manual:totals.manual,photo:totals.photo+totals.photoPending,radiograph:studyCount,pending:totals.pending};
  Object.entries(ctx.mapFilters||{}).forEach(([id,button])=>{button.setAttribute('aria-pressed',String(id===filter));button.setAttribute('aria-label',button.dataset.label+' · '+counts[id]+' registros');if(ctx.mapFilterCounts?.[id])copy(ctx.mapFilterCounts[id],String(counts[id]));});
  const layers={all:{count:totals.annotated,summary:totals.annotated?totals.annotated+' '+(totals.annotated===1?'pieza relacionada':'piezas relacionadas'):'Comienza por seleccionar una pieza',detail:[totals.manual&&totals.manual+' clínicas',totals.photo&&totals.photo+' de fotos',totals.radiograph&&totals.radiograph+' hallazgos RX',totals.pending&&totals.pending+' por revisar'].filter(Boolean).join(' · ')||'Sin evidencia vinculada todavía.'},manual:{count:totals.manual,summary:totals.manual?totals.manual+' '+(totals.manual===1?'pieza con valoración':'piezas con valoración'):'Sin valoraciones clínicas',detail:totals.manual?'Sólo muestra registros confirmados por el profesional.':'Selecciona una pieza para registrar una valoración profesional.'},photo:{count:counts.photo,summary:counts.photo?counts.photo+' registro'+(counts.photo===1?' fotográfico':'s fotográficos'):'Sin registros fotográficos',detail:[totals.photo&&totals.photo+' confirmada'+(totals.photo===1?'':'s'),totals.photoPending&&totals.photoPending+' por revisar'].filter(Boolean).join(' · ')||'Agrega fotografías desde el expediente clínico.'},radiograph:{count:studyCount,summary:studyCount?studyCount+' '+(studyCount===1?'estudio radiográfico':'estudios radiográficos'):'Sin estudios radiográficos',detail:[totals.radiograph&&totals.radiograph+' '+(totals.radiograph===1?'hallazgo confirmado':'hallazgos confirmados'),totals.radiographPending&&totals.radiographPending+' '+(totals.radiographPending===1?'hallazgo por revisar':'hallazgos por revisar')].filter(Boolean).join(' · ')||'Agrega un estudio radiográfico cuando sea necesario.'},pending:{count:totals.pending,summary:totals.pending?totals.pending+' sugerencia'+(totals.pending===1?' pendiente':'s pendientes'):'Sin pendientes de IA',detail:totals.pendingTeeth?totals.pendingTeeth+' '+(totals.pendingTeeth===1?'pieza requiere':'piezas requieren')+' revisión profesional.':'Nada se confirma automáticamente.'}},layer=layers[filter]||layers.all;
  copy(ctx.mapState,!snapshot?'No disponible':layer.summary);ctx.mapState.dataset.state=!snapshot?'neutral':filter==='pending'&&layer.count?'pending':layer.count?'done':'neutral';
  copy(ctx.mapSummary,layer.summary);copy(ctx.mapDetail,snapshot?layer.detail:'El mapa se habilitará cuando termine de cargar el expediente dental.');
  renderMapInspector(ctx,snapshot,totals);renderMapContext(ctx,filter,totals);renderRadiographShelf(ctx);syncFindingsAction(ctx);
 }
 function renderMapContext(ctx,filter,totals){
  if(!ctx.mapContext)return;ctx.mapContext.replaceChildren();const data=ctx.sourceData||{},mode=n('div','');mode.dataset.mode=filter;
  const names={all:['EXPEDIENTE UNIFICADO','Fuentes clínicas relacionadas','Las notas, fotografías y radiografías conservan su origen.'],manual:['VALORACIÓN PROFESIONAL','Registro clínico por pieza','Sólo el profesional confirma o modifica un hallazgo.'],photo:['FOTOGRAFÍAS CLÍNICAS','Evidencia fotográfica','Las sugerencias requieren revisión antes de incorporarse al mapa.'],radiograph:['ESTUDIOS RADIOGRÁFICOS','Evidencia radiográfica','La interpretación asistida nunca confirma hallazgos automáticamente.'],pending:['REVISIÓN PENDIENTE','Sugerencias por confirmar','Revisa, edita o descarta cada sugerencia antes de continuar.']},meta=names[filter]||names.all;
  const intro=n('div',ctx.mapContextClasses.copy);intro.append(n('span','cw-kicker',meta[0]),n('strong','',meta[1]),n('p','',meta[2]));mode.append(intro);
  const metrics=n('div',ctx.mapContextClasses.metrics),items=filter==='manual'?[[totals.manual,'piezas clínicas','done'],[data.teethFollowing||0,'en seguimiento','pending']]:filter==='photo'?[[totals.photo,'fotografías','done'],[totals.photoPending,'por revisar','pending']]:filter==='radiograph'?[[data.studies||0,'estudios','radiograph'],[totals.radiograph,'hallazgos confirmados','done'],[totals.radiographPending,'hallazgos por revisar','pending']]:filter==='pending'?[[totals.pending,'sugerencias','pending'],[totals.pendingTeeth,'piezas','neutral']]:[[totals.annotated,'piezas','done'],[totals.pending,'por revisar','pending']];
  items.forEach(([value,label,tone])=>{if(!value)return;const chip=n('span',ctx.mapContextClasses.chip,value+' '+label);chip.dataset.value=String(value);chip.dataset.tone=tone;metrics.append(chip);});
  if(!metrics.childElementCount)metrics.append(n('span',ctx.mapContextClasses.chip,'Sin registros en esta capa'));
  mode.append(metrics);ctx.mapContext.append(mode);
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
  const patient=window.pacienteActual,root=n('section','cw-workspace'),ctx={root,layout,patient:patient.id,tenant:window.tenantId,modules:{},selected:null,entries:null,receipts:new Map(),summary:null};active=ctx;const resume=restoreView(ctx);
  root.setAttribute('aria-label','Atención integral del paciente');layout.classList.add('cw-layout');screen.classList.add('cw-enhanced');
  const patientHead=n('header','cw-patient-head'),patientIdentity=n('div','cw-patient-identity'),patientActions=n('div','cw-patient-actions');
  patientIdentity.append(n('p','cw-kicker','PACIENTE ACTUAL'),n('h1','',[patient.nombre,patient.apellido].filter(Boolean).join(' ')||'Paciente'),n('p','cw-patient-meta',[patient.telefono||'Sin teléfono',patient.email||'Sin correo'].join(' · ')));
  ctx.patientStatus=n('span','cw-patient-status','Expediente protegido');
  patientActions.append(btn('Abrir Agenda',()=>window.ir('agenda')),btn('Editar datos',()=>window.abrirModalPaciente?.(patient.id)));
  patientHead.append(patientIdentity,ctx.patientStatus,patientActions);root.append(patientHead);
  const quick=n('nav','cw-quick-links');quick.setAttribute('aria-label','Áreas del expediente');
  [['Resumen','overview'],['Expediente','history'],['Tratamiento','plan'],['Actividad','appointments']].forEach(([label,key])=>{const action=btn(label,()=>key==='plan'?open('plan'):window.SmylPatient360?.open(key));action.dataset.patientSection=key;quick.append(action);});root.append(quick);
  ctx.overview=n('p','cw-stage-status');ctx.overview.setAttribute('role','status');root.append(ctx.overview);ctx.nav={};
  const evaluation=module(ctx,'evaluation','01','Evaluación','Contexto, evidencia y valoración profesional.');evaluation.details.dataset.active='true';ctx.activeStage='evaluation';
  const plan=module(ctx,'plan','02','Propuesta','Valoración, procedimientos y fases.');plan.details.hidden=true;
  const approval=module(ctx,'approval','03','Aceptación','Cotización, consentimiento y decisión.');approval.details.hidden=true;
  const followup=module(ctx,'followup','04','Seguimiento e historial','Citas, evoluciones y trabajo realizado.');followup.details.hidden=true;
  const progress=n('nav','cw-nav');progress.setAttribute('aria-label','Etapas del caso');
  [['evaluation','Evaluación'],['plan','Propuesta'],['approval','Aceptación'],['followup','Seguimiento']].forEach(([id,label])=>{const step=n('button','',label);step.type='button';step.dataset.label=label;step.onclick=()=>open(id);ctx.nav[id]=step;progress.append(step);});
  ctx.overview.before(progress);
  const evaluationFlow=n('section','cw-evaluation-flow');ctx.evaluationFlow=evaluationFlow;ctx.evaluationMobileProgress=n('p','cw-evaluation-mobile-progress','Paso 1 de 4 · Contexto');ctx.evaluationTaskList=n('ol','cw-evaluation-tasks');ctx.evaluationTaskList.setAttribute('role','tablist');ctx.evaluationTaskList.setAttribute('aria-label','Tareas de la evaluación');ctx.evaluationPanels=n('div','cw-evaluation-panels');ctx.evaluationTasks={};evaluationFlow.append(ctx.evaluationMobileProgress,ctx.evaluationTaskList,ctx.evaluationPanels);evaluation.body.append(evaluationFlow);
  ctx.contextPart=evaluationTask(ctx,'context','01','Contexto','Historia y alertas');
  ctx.evidencePart=evaluationTask(ctx,'evidence','02','Evidencia','Subir y clasificar originales');ctx.evidenceSection=ctx.evidencePart.root;
  ctx.reviewPart=evaluationTask(ctx,'findings','03','Valoración','Revisar y decidir');ctx.reviewSection=ctx.reviewPart.root;
  ctx.closePart=evaluationTask(ctx,'closure','04','Revisión','Antes de la propuesta');
  ctx.contextCopy=n('p','cw-evaluation-intro','Confirma la seguridad clínica antes de revisar imágenes.');ctx.contextPart.body.append(ctx.contextCopy);mountContext(ctx,patient);
  const versionNote=n('aside','cw-version-note'),versionCopy=n('div');versionCopy.append(n('strong','','Versiones guardadas'),n('p','','Cada guardado crea una nueva versión. Lo anterior no se reemplaza.'));ctx.planHistory=btn('Ver historial',()=>{const history=document.getElementById('clinic-history');if(!history)return;history.hidden=false;history.open=true;history.scrollIntoView({block:'start',behavior:'smooth'});});versionNote.append(n('span','','✓'),versionCopy,ctx.planHistory);plan.body.append(versionNote);
  const clinical=screen.querySelector('.clinic-workspace');if(clinical)plan.body.append(clinical);
  const documentActions=n('div','cw-action-row');documentActions.append(btn('Abrir archivos clínicos',()=>window.SmylPatient360?.open('files')));
  ctx.evidenceTimeline=n('section','cw-evidence-history');ctx.photoHint=n('p','cw-help','Las radiografías son opcionales. Las simulaciones se mantienen separadas de la evidencia clínica.');ctx.evidencePart.body.append(ctx.evidenceTimeline,ctx.photoHint,documentActions);
  const simulationLink=n('aside','cw-simulation-link');simulationLink.innerHTML='<div><span>ESPACIO INDEPENDIENTE</span><strong>Simulaciones de sonrisa</strong><small>Comparaciones visuales orientativas, separadas del expediente clínico.</small></div><div><button type="button" data-open-simulations>Ver simulaciones</button><a href="simulacion-rapida.html?workspace=professional">Nueva simulación</a></div>';
  simulationLink.querySelector('[data-open-simulations]').onclick=()=>window.ir('historial');ctx.evidencePart.body.append(simulationLink);
  const clinicalMap=n('section','cw-clinical-map'),mapHead=n('header','cw-clinical-map-head'),mapTitle=n('div');mapTitle.append(n('span','cw-kicker','MAPA CLÍNICO LONGITUDINAL'),n('strong','','Odontograma verificable por fuente'),n('p','','Selecciona una pieza para revisar su evidencia y registrar la valoración profesional.'));
  ctx.mapState=n('span','cw-part-badge','Cargando mapa');mapHead.append(mapTitle,ctx.mapState);clinicalMap.append(mapHead);
  const filters=n('div','cw-map-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar anotaciones del odontograma');ctx.mapFilters={};ctx.mapFilterCounts={};
  [['all','Todo'],['manual','Clínica'],['photo','Fotografías'],['radiograph','Rayos X'],['pending','Pendientes']].forEach(([id,label])=>{const control=btn('',()=>{ctx.mapFilter=id;ctx.mapFingerprint='';renderClinicalMap(ctx,ctx.mapSnapshot);});control.classList.add('cw-map-filter');control.dataset.label=label;const text=n('span','',label),count=n('small','cw-map-filter-count','0');control.append(text,count);ctx.mapFilters[id]=control;ctx.mapFilterCounts[id]=count;filters.append(control);});clinicalMap.append(filters);
  ctx.radiographShelf=n('section','cw-radiograph-shelf');ctx.radiographShelf.hidden=true;ctx.radiographShelf.setAttribute('aria-label','Estudios radiográficos del paciente');clinicalMap.append(ctx.radiographShelf);
  const mapLayout=n('div','cw-clinical-map-layout'),mapStage=n('div','cw-map-stage');mapStage.append(n('div','dr-orientation',''));mapStage.firstChild.append(n('span','','Derecha del paciente'),n('span','','Izquierda del paciente'));ctx.mapHost=n('div','cw-clinical-odontogram');ctx.mapHost.setAttribute('aria-label','Odontograma FDI interactivo');mapStage.append(ctx.mapHost);
  const mapAside=n('aside','cw-map-aside cw-map-inspector');ctx.mapInspector=mapAside;ctx.mapSummary=n('strong','','Preparando el mapa');ctx.mapDetail=n('p','','Comprobando anotaciones clínicas y evidencia confirmada.');ctx.mapInspectorTitle=n('strong','cw-map-inspector-title','Selecciona una pieza');ctx.mapInspectorMeta=n('p','','El mapa conserva la selección mientras cambias de capa.');ctx.mapInspectorFacts=n('div','cw-map-inspector-facts');ctx.mapInspectorStatus=n('p','cw-help','Selecciona una pieza para ver su contexto sin abrir el editor.');ctx.mapInspectorRadiographs=n('section','cw-map-radiograph-context cw-map-inspector-radiograph');ctx.mapInspectorRadiographs.hidden=true;ctx.mapEdit=btn('Editar pieza',()=>{if(valid(ctx)&&ctx.selectedTooth)window.SmylDentalProgress?.openTooth(ctx.tenant,ctx.patient,ctx.selectedTooth);});ctx.mapEdit.classList.add('cw-map-edit');ctx.mapFull=ctx.mapEdit;ctx.reviewText=n('p','cw-help');ctx.reviewButton=btn('Analizar fotografías',()=>{if(valid(ctx)&&ctx.reviewAction)ctx.reviewAction();});mapAside.append(n('span','cw-kicker','VISTA ACTUAL'),ctx.mapSummary,ctx.mapDetail,n('span','cw-kicker','PIEZA SELECCIONADA'),ctx.mapInspectorTitle,ctx.mapInspectorMeta,ctx.mapInspectorFacts,ctx.mapInspectorStatus,ctx.mapInspectorRadiographs,ctx.mapEdit);mapLayout.append(mapStage,mapAside);clinicalMap.append(mapLayout);
  ctx.mapContext=n('section','cw-map-context');ctx.mapContextClasses={copy:'cw-map-context-copy',metrics:'cw-map-context-metrics',chip:'cw-map-context-chip'};clinicalMap.append(ctx.mapContext);
  const mapLegend=n('div','cw-map-legend');[['manual','Clínica'],['photo','Fotografía confirmada'],['radiograph','Rayos X confirmado'],['pending','IA por revisar']].forEach(([tone,label])=>mapLegend.append(n('span','cw-map-key cw-map-key-'+tone,label)));clinicalMap.append(mapLegend);ctx.reviewPart.body.append(clinicalMap);
  ctx.reviewHelp=n('p','cw-help','Aquí no se suben originales. El odontograma es el único mapa clínico: revisa la evidencia ya clasificada, registra tu valoración y decide qué sugerencias se incorporan al expediente. Las simulaciones nunca se utilizan como evidencia clínica.');ctx.reviewPart.body.append(ctx.reviewHelp);
  const closeSummary=n('section','cw-evaluation-close');ctx.closeTitle=n('h3','','Revisión pendiente');ctx.closeCopy=n('p','','Comprueba el contexto, la evidencia y las decisiones profesionales antes de preparar la propuesta.');const closeFacts=n('dl','cw-evaluation-close-facts'),contextFact=n('div',''),evidenceFact=n('div',''),findingsFact=n('div','');contextFact.append(n('dt','','Contexto'),ctx.closeContext=n('dd','','Sin revisar'));evidenceFact.append(n('dt','','Evidencia'),ctx.closeEvidence=n('dd','','Sin comprobar'));findingsFact.append(n('dt','','Valoración clínica'),ctx.closeFindings=n('dd','','Pendiente'));closeFacts.append(contextFact,evidenceFact,findingsFact);closeSummary.append(ctx.closeTitle,ctx.closeCopy,closeFacts);ctx.closePart.body.append(closeSummary);
  const evaluationFoot=n('footer','cw-evaluation-footer');ctx.evaluationFooterStatus=n('span','cw-evaluation-footer-status','Cargando contexto clínico');ctx.evaluationCta=btn('Continuar a evidencia',()=>{if(valid(ctx)&&ctx.evaluationAction)ctx.evaluationAction();},true);ctx.evaluationCta.classList.add('cw-evaluation-cta');evaluationFoot.append(ctx.evaluationFooterStatus,ctx.evaluationCta);evaluationFlow.append(evaluationFoot);showEvaluationTask(ctx,resume.task,false);
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
  layout.append(root);adopt(ctx);refresh();open(resume.stage,false);
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
  const photoStatus=ctx.clinicalPhotoStatus||null,canonicalPhotoCount=photoStatus?Number(photoStatus.studies||0):0,canonicalPhotoResolved=photoStatus?Number(photoStatus.resolvedStudies||0):0,canonicalPhotoPending=photoStatus?Number((photoStatus.unresolvedStudies??photoStatus.pending)||0):0;
  const files=window.SmylPatient360?.files?.(ctx.tenant,ctx.patient),progress=window.SmylPatientProgress?.status?.(ctx.tenant,ctx.patient),clinical=window.SmylClinicalWorkflow?.status(ctx.tenant,ctx.patient),dental=window.SmylDentalProgress?.status(ctx.tenant,ctx.patient,entry?.row.id),evidenceTotal=count+(dental?.studies||0)+(files?.total||0);
  const photoCount=photoStatus?canonicalPhotoCount:count,photoPending=(dental?.pending||0)+(dental?.workflowPending||0)+canonicalPhotoPending,rxPending=dental?.rxPending||0;
  const evidenceLabel=evidenceTotal?evidenceTotal+(evidenceTotal===1?' evidencia':' evidencias'):load==='ready'?'Sin evidencia':'Cargando documentación';
  const contextState=renderContext(ctx),contextReviewed=!!contextState?.reviewed&&!contextState.stale;
  const contextLabel=contextState?.stale?'Contexto actualizado':contextReviewed?(contextState.state==='ready'?'Revisado':'Revisado con pendientes'):contextState?.state==='attention'?(contextState.model?.attentionCount||0)+' por revisar':contextState?.state==='incomplete'?'Por confirmar':'Cargando';
  partState(ctx.contextPart,contextLabel,contextReviewed?(contextState.state==='ready'?'done':'neutral'):'pending');
  partState(ctx.evidencePart,evidenceLabel,evidenceTotal?'done':load==='error'||load==='unavailable'?'neutral':'pending');
  copy(ctx.photoHint,photoCount?photoCount+' fotografías clínicas originales disponibles. Las simulaciones se consultan por separado.':'Sin fotografías clínicas. Puedes continuar con el odontograma.');
  renderEvidenceHistory(ctx,files,dental,entry);
  const hasProfessionalReview=!!dental?.hasReview||canonicalPhotoResolved>0,photoProgressLoaded=photoStatus?true:dental?.photoLoaded===true;
  const findingsComplete=hasProfessionalReview&&!photoPending&&!rxPending&&!dental?.dirty&&photoProgressLoaded;
  let reviewLabel=photoCount?'Fotografías por revisar':'Odontograma pendiente',reviewCopy=photoCount?'Analiza las fotografías y confirma únicamente las observaciones que quieras incorporar al expediente.':'Abre el odontograma y registra únicamente hallazgos confirmados por el profesional.';
  if(!dental?.ready){reviewLabel='No disponible';reviewCopy='Espera a que cargue el mapa o revisa el aviso de conexión de este módulo.';}
  else if(dental.dirty){reviewLabel='Cambios sin guardar';reviewCopy='Guarda las observaciones del mapa antes de continuar.';}
  else if(photoCount&&!photoStatus&&!dental.photoLoaded){reviewLabel='Por comprobar';reviewCopy='No se pudo confirmar el avance del análisis fotográfico. Ningún resultado dudoso se incorporó al mapa.';}
  else if(canonicalPhotoCount&&canonicalPhotoPending===0){reviewLabel='Fotografías revisadas';reviewCopy=canonicalPhotoResolved+' '+(canonicalPhotoResolved===1?'toma resuelta':'tomas resueltas')+' con decisión profesional auditable. Esto no sustituye la exploración clínica.';}
  else if(dental.hasReview){reviewLabel=photoPending||rxPending?(photoPending+rxPending)+' por revisar':'Lista';reviewCopy=dental.confirmed+' observaciones confirmadas · '+dental.pending+' pendientes · '+dental.rejected+' descartadas. Esto no sustituye tu valoración clínica.';}
  if(dental?.studies&&dental.rxLoaded)reviewCopy+=' Radiografías: '+dental.studies+' guardadas · '+dental.rxReviews+' revisadas · '+dental.rxConfirmed+' confirmadas · '+dental.rxPending+' pendientes.';
  else if(dental?.studies&&!dental.rxLoaded)reviewCopy+=' El avance de radiografías aún no pudo comprobarse.';
  partState(ctx.reviewPart,reviewLabel,findingsComplete?'done':hasProfessionalReview?'neutral':'pending');copy(ctx.reviewText,reviewCopy);
  const reviewDisabled=!entry||!dental?.ready||dental.busy||dental.dirty;
  const evaluationComplete=findingsComplete&&contextReviewed;
  partState(ctx.closePart,evaluationComplete?'Lista para la propuesta':'Pendiente',evaluationComplete?'done':'pending');
  copy(ctx.closeTitle,evaluationComplete?'Lista para la propuesta':'Revisión pendiente');
  copy(ctx.closeCopy,evaluationComplete?'El contexto, la evidencia y la valoración profesional quedaron revisados en esta sesión.':'Completa los pendientes antes de preparar la propuesta.');
  copy(ctx.closeContext,contextState?.stale?'Cambió · revisar':contextReviewed?'Revisado en esta sesión':contextState?.state==='attention'?'Alertas por revisar':'Sin revisar');
  copy(ctx.closeEvidence,evidenceLabel);copy(ctx.closeFindings,reviewLabel);
  ctx.studyItems=dental?.studyItems||[];ctx.sourceData={photos:photoCount,photoPending,photoConfirmed:(dental?.confirmed||0)+(photoStatus?.reviewed||0),studies:ctx.studyItems.length,rxPending,rxConfirmed:dental?.rxConfirmed||0,firstStudy:ctx.studyItems[0]?.id||'',files:files?.total||0,teethFollowing:dental?.teeth?.following||0,teethDone:dental?.teeth?.done||0};
  ctx.findingsActionState={entry,dental,photoCount,photoPending,rxPending,findingsComplete,evaluationComplete,reviewDisabled,hasReview:hasProfessionalReview,firstPhotoStudy:photoStatus?.firstStudyId||'',firstPendingPhotoStudy:photoStatus?.firstPendingStudyId||''};
  renderClinicalMap(ctx,window.SmylDentalProgress?.map?.(ctx.tenant,ctx.patient,entry?.row.id));
  syncFindingsAction(ctx);
  state(ctx,'evaluation',evaluationComplete?'Lista para propuesta':contextState?.stale?'Contexto actualizado':!contextReviewed?'Contexto por revisar':hasProfessionalReview?'Revisión en curso':'Requiere revisión',evaluationComplete?'done':hasProfessionalReview?'neutral':'pending');
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
  copy(ctx.overview,!evaluationComplete?'Siguiente acción · Completa la evaluación.':!clinical?.ready?'Siguiente acción · Prepara la propuesta.':!created?'Siguiente acción · Registra la aceptación.':'Siguiente acción · Continúa el seguimiento.');
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
  addEventListener('smyl:clinical-photo-status',e=>{const ctx=active,d=e.detail;if(!valid(ctx)||d?.tenant!==ctx.tenant||d.patient!==ctx.patient)return;ctx.clinicalPhotoStatus=d;refresh();});
  window.sb?.auth?.onAuthStateChange?.((event,session)=>{const ctx=active;if(ctx?.root.isConnected&&(session?.user?.id!==ctx.tenant||session.user.is_anonymous)){views.clear();ctx.revoked=true;ctx.entries=null;ctx.selected=null;ctx.receipts.clear();ctx.root.replaceChildren(n('p','cw-overview','La sesión cambió. Abre nuevamente el expediente con la cuenta autorizada.'));}});
 }
 window.SmylCaseWorkspace={open,context(tenant,patient){const ctx=active;if(!valid(ctx)||ctx.tenant!==tenant||ctx.patient!==patient)return null;const entry=ctx.selected;return entry&&entry.current()?{caseId:entry.row.id,isCurrent:()=>valid(ctx)&&ctx.selected===entry&&entry.current()}:null;}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
