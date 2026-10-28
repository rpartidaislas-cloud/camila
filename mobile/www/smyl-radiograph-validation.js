/* SMYL radiografía asistida — panel de validación clínica y monitoreo (plan Etapa 7).
   Conjuntos de evaluación independientes, referencia anotada por varios odontólogos, métricas por
   tarea / tipo de estudio / motor, monitoreo de deriva, incidentes, informe de validación versionado
   con criterios de salida evaluados por el servidor y botón de pausa por clínica. Sólo para
   perfiles con aprobación clínica; nunca presenta una métrica como autorización de uso diagnóstico. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylRadiographValidation=api;})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const TASK_LABELS={tooth_localization:'Localización de piezas',finding_candidates:'Señales candidatas',qc:'Control de calidad'};
 const STUDY_LABELS={panoramic:'Panorámica',periapical:'Periapical',bitewing:'Aleta de mordida',intraoral_series:'Serie intraoral',unknown:'Tipo por confirmar'};
 const METRIC_LABELS={sensitivity:'Sensibilidad',specificity:'Especificidad',precision:'Precisión',disagreementRate:'Tasa de desacuerdo',unconfirmedRate:'Tasa de timeouts'};
 const DEFAULT_CRITERIA=[{metric:'sensitivity',task:'tooth_localization',min:.95},{metric:'precision',task:'tooth_localization',min:.95},{metric:'specificity',task:'tooth_localization',min:.98},{metric:'sensitivity',task:'finding_candidates',min:.8},{metric:'precision',task:'finding_candidates',min:.6},{metric:'disagreementRate',task:'finding_candidates',max:.4},{metric:'unconfirmedRate',task:'tooth_localization',max:.02}];
 const pct=v=>v==null?'—':(Math.round(Number(v)*1000)/10).toFixed(1)+' %';
 const engineText=e=>e?e.provider+' / '+e.name+' '+e.version+(e.simulated||e.provider==='simulated'?' (simulado)':''):'sin motor activo';
 // Texto de divulgación para la mesa: motor, validación y fecha. Sin credenciales ni promesas.
 function disclosureSummary(d){
  if(!d)return {engines:'Motor: sin información.',validation:'Validación: sin informe.',limits:[]};
  const engines=(d.engines||[]).length?(d.engines||[]).map(e=>TASK_LABELS[e.kind]+': '+engineText(e)+(e.updatedAt?' · actualizado '+String(e.updatedAt).slice(0,10):'')).join(' · '):'Sin motor activo registrado.';
  const v=d.validation;const validation=v?('Validación v'+v.version+' ('+v.setName+'): '+(v.verdict==='approved_for_pilot'?'aprobada para piloto':'no aprobada')+' · '+String(v.approvedAt).slice(0,10)):'Sin informe de validación aprobado: uso piloto bajo supervisión profesional.';
  return {engines,validation,limits:d.limits||[],openIncidents:d.openIncidents||0,simulated:(d.engines||[]).some(e=>e.simulated||e.provider==='simulated')};
 }
 // Evaluación local de criterios (mismo criterio que el servidor: el peor grupo de la tarea decide).
 function evaluateCriteria(metrics,criteria){
  return criteria.map(c=>{let value=null;
   if(['sensitivity','specificity','precision'].includes(c.metric)){const vals=(metrics.groups||[]).filter(g=>g.task===c.task&&g[c.metric]!=null).map(g=>Number(g[c.metric]));value=vals.length?Math.min(...vals):null;}
   else if(c.metric==='disagreementRate'){const vals=(metrics.disagreement||[]).filter(d=>d.task===c.task&&d.rate!=null).map(d=>Number(d.rate));value=vals.length?Math.max(...vals):null;}
   else{const vals=(metrics.runs||[]).filter(r=>r.task===c.task&&Number(r.runs)>0).map(r=>Number(r.unconfirmed)/Number(r.runs));value=vals.length?Math.max(...vals):null;}
   const met=value!=null&&!(c.min!=null&&value<c.min)&&!(c.max!=null&&value>c.max);
   return Object.assign({},c,{value,met});});
 }
 function parseCriteria(text){
  let list;try{list=JSON.parse(text);}catch(_){throw Error('Los criterios deben ser un arreglo JSON.');}
  if(!Array.isArray(list)||!list.length||list.length>20)throw Error('Define entre 1 y 20 criterios.');
  for(const c of list){if(!c||!METRIC_LABELS[c.metric]||!['tooth_localization','finding_candidates'].includes(c.task)||!(typeof c.min==='number'||typeof c.max==='number'))throw Error('Criterio no válido: '+JSON.stringify(c));}
  return list;
 }
 // --- interfaz --------------------------------------------------------------------------------
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='rr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 let active=null,seq=0;
 function close(run=active,force=false){if(!run||run.closed)return false;run.closed=true;run.dialog.close();run.dialog.remove();if(active===run)active=null;run.focus?.focus?.({preventScroll:true});return true;}
 function connect(client){
  const checked=async p=>{const r=await window.sbTimeout(p,20000);if(r.error)throw r.error;return r.data;};
  return {
   disclosure:()=>checked(client.rpc('smyl_radiograph_model_disclosure')),
   sets:()=>checked(client.from('smyl_radiograph_eval_sets').select('*')),
   createSet:(name,use)=>checked(client.rpc('smyl_radiograph_create_eval_set',{p_name:name,p_intended_use:use,p_population:'',p_exclusions:'',p_split:'test'})),
   addMember:(setId,sourceId,exposure)=>checked(client.rpc('smyl_radiograph_add_eval_member',{p_set_id:setId,p_source_id:sourceId,p_training_exposure:exposure})),
   annotate:(sourceId,kind,fdi,category,present,adjudicated)=>checked(client.rpc('smyl_radiograph_annotate_reference',{p_source_id:sourceId,p_kind:kind,p_fdi:fdi,p_category:category,p_present:present,p_geometry:null,p_note:'',p_adjudicated:adjudicated})),
   metrics:setId=>checked(client.rpc('smyl_radiograph_validation_metrics',{p_set_id:setId})),
   monitoring:()=>checked(client.rpc('smyl_radiograph_monitoring',{p_days:90})),
   incidents:()=>checked(client.from('smyl_radiograph_incidents').select('*')),
   reportIncident:(severity,category,description,sourceId)=>checked(client.rpc('smyl_radiograph_report_incident',{p_severity:severity,p_category:category,p_description:description,p_source_id:sourceId||null,p_run_id:null})),
   closeIncident:(id,resolution)=>checked(client.rpc('smyl_radiograph_close_incident',{p_incident_id:id,p_resolution:resolution})),
   reports:()=>checked(client.from('smyl_radiograph_validation_reports').select('*')),
   recordReport:(setId,criteria,notes)=>checked(client.rpc('smyl_radiograph_record_validation_report',{p_set_id:setId,p_exit_criteria:criteria,p_notes:notes})),
   setFlag:(key,enabled)=>checked(client.rpc('smyl_radiograph_set_tenant_flag',{p_key:key,p_enabled:enabled}))
  };
 }
 const table=(headers,rows)=>{const t=n('table','rp-table'),thead=n('thead'),tr=n('tr');headers.forEach(h=>tr.append(n('th','',h)));thead.append(tr);const tb=n('tbody');rows.forEach(r=>{const x=n('tr');r.forEach(c=>x.append(n('td','',c)));tb.append(x);});if(!rows.length){const x=n('tr'),td=n('td','rp-empty','Sin datos.');td.colSpan=headers.length;x.append(td);tb.append(x);}t.append(thead,tb);return t;};
 async function open({client,caps,source,tenant}){
  if(active){close();}client=client||window.sb;
  const dialog=n('dialog','rr-dialog rv2-dialog rp-dialog rv-dialog'),bar=n('header','rr-bar'),host=n('div','rr-host rp-host'),run={dialog,host,api:connect(client),caps,source,closed:false,focus:document.activeElement,busy:false,data:{disclosure:null,sets:[],metrics:null,metricsSet:null,monitoring:null,incidents:[],reports:[]}};active=run;
  const titleId='rv-title-'+(++seq),t=n('strong','','Validación del motor radiográfico');t.id=titleId;dialog.setAttribute('aria-labelledby',titleId);
  bar.append(n('div','rr-identity',null),button('Volver',()=>close(run)));bar.firstChild.append(n('span','rr-kicker','SMYL · RADIOGRAFÍA · VALIDACIÓN Y MONITOREO'),t,n('span','rr-study-meta','Evidencia versionada, no autorización de uso diagnóstico'));
  dialog.append(bar,host);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();close(run);});dialog.addEventListener('close',()=>close(run,true));
  const status=(text,kind='')=>{let e=host.querySelector('.rr-feedback');if(!e){e=n('p','rr-feedback');e.setAttribute('role','status');e.setAttribute('aria-live','polite');host.prepend(e);}e.className='rr-feedback '+kind;e.textContent=text;};
  async function reload(){const d=run.data;[d.disclosure,d.sets,d.monitoring,d.incidents,d.reports]=await Promise.all([run.api.disclosure(),run.api.sets().then(x=>x||[]),run.api.monitoring().catch(()=>null),run.api.incidents().then(x=>x||[]),run.api.reports().then(x=>x||[])]);if(d.metricsSet)d.metrics=await run.api.metrics(d.metricsSet).catch(()=>null);}
  async function act(label,fn){if(run.busy)return;run.busy=true;let text,kind;try{await fn();await reload();text=label+': listo.';kind='rr-ok';}catch(e){text=e?.message||'No se pudo completar la acción.';kind='rr-error';}finally{run.busy=false;render();status(text,kind);}}
  const section=(label,title,hint)=>{const s=n('section','rv-section'),h=n('header','rr-panel-head');h.append(n('span','rr-section-label',label),n('h2','',title),n('p','',hint));s.append(h);return s;};
  function disclosureSection(){
   const s=section('1 · DIVULGACIÓN','Motor, validación y límites','Lo mismo que ve el profesional en la mesa de revisión.'),d=disclosureSummary(run.data.disclosure);
   s.append(n('p','rv-engines',d.engines),n('p','rv-validation',d.validation));const ul=n('ul','rv2-limits');d.limits.forEach(l=>ul.append(n('li','',l)));s.append(ul);
   if(d.openIncidents)s.append(n('p','rv2-blocked','⚠ '+d.openIncidents+' incidente(s) abierto(s).'));
   const flags=run.data.monitoring?.flags||{};const fl=n('div','rr-actions rv-flags');Object.entries(flags).forEach(([key,on])=>{const b=button((on?'Pausar ':'Reanudar ')+key.replace('radiograph.',''),()=>act(on?'Pausado':'Reanudado',()=>run.api.setFlag(key,!on)),on?'rr-tertiary':'rr-tool');b.title='Botón de desactivación por clínica (requiere administrar la clínica).';fl.append(b);});if(Object.keys(flags).length){s.append(n('p','rr-note','Interruptor por clínica: pausar no requiere despliegue. El interruptor global es de la plataforma.'),fl);}
   return s;
  }
  function setsSection(){
   const s=section('2 · CONJUNTOS DE EVALUACIÓN','Conjunto de prueba independiente','Las fuentes con posible exposición al entrenamiento invalidan el conjunto como prueba.');
   s.append(table(['Nombre','Uso previsto','Tipo','Bloqueado'],run.data.sets.map(x=>[x.name,x.intended_use,x.split,x.locked_at?'sí':'no'])));
   const form=n('div','rv-form'),name=n('input'),use=n('input');name.placeholder='Nombre del conjunto';name.setAttribute('aria-label','Nombre del conjunto');use.placeholder='Uso previsto (≥ 10 caracteres)';use.setAttribute('aria-label','Uso previsto');
   form.append(name,use,button('Crear conjunto',()=>act('Conjunto creado',()=>run.api.createSet(name.value.trim(),use.value.trim())),'rr-primary'));s.append(form);
   if(run.source&&run.data.sets.length){const add=n('div','rv-form'),sel=n('select'),exposure=n('input'),lab=n('label','rr-consent');run.data.sets.forEach(x=>sel.add(new Option(x.name,x.id)));sel.setAttribute('aria-label','Conjunto al que añadir esta fuente');exposure.type='checkbox';exposure.id='rv-exposure';lab.htmlFor='rv-exposure';lab.append(exposure,document.createTextNode('Esta imagen pudo usarse para entrenar el motor'));
    add.append(sel,lab,button('Añadir esta radiografía al conjunto',()=>act('Fuente añadida',()=>run.api.addMember(sel.value,run.source.id,exposure.checked))));s.append(add);}
   return s;
  }
  function referenceSection(){
   const s=section('3 · REFERENCIA ANOTADA','Anotación independiente del modelo','Cada odontólogo anota sin ver los candidatos; consenso por mayoría, adjudicación con aprobación clínica.');
   if(!run.source){s.append(n('p','rr-note','Abre el panel desde una radiografía para anotar su referencia.'));return s;}
   const form=n('div','rv-form rv-annotate'),kind=n('select'),fdi=n('select'),cat=n('select'),present=n('select'),adj=n('input'),adjLab=n('label','rr-consent');
   [['tooth','Pieza'],['finding','Señal']].forEach(([v,l])=>kind.add(new Option(l,v)));kind.setAttribute('aria-label','Tipo de anotación');
   (window.SmylDentalModel?.teeth||[]).forEach(x=>fdi.add(new Option('Pieza '+x,x)));fdi.setAttribute('aria-label','Pieza FDI');
   cat.add(new Option('— sin categoría (pieza) —',''));['restoration','crown','implant','endodontic','apparently_missing','density','contour','support','development','other'].forEach(c=>cat.add(new Option(c,c)));cat.setAttribute('aria-label','Categoría de señal');
   [['true','Presente'],['false','Ausente / no visible']].forEach(([v,l])=>present.add(new Option(l,v)));present.setAttribute('aria-label','Presencia');
   adj.type='checkbox';adj.id='rv-adj';adjLab.htmlFor='rv-adj';adjLab.append(adj,document.createTextNode('Adjudicación (resuelve desacuerdos)'));
   form.append(kind,fdi,cat,present,adjLab,button('Registrar anotación',()=>act('Anotación registrada',()=>run.api.annotate(run.source.id,kind.value,fdi.value,kind.value==='finding'?cat.value:'',present.value==='true',adj.checked)),'rr-primary'));s.append(form);return s;
  }
  function metricsSection(){
   const s=section('4 · MÉTRICAS','Por tarea, tipo de estudio y motor','Sensibilidad, especificidad (sólo piezas), precisión, FP/FN, calibración y desacuerdo profesional.');
   if(!run.data.sets.length){s.append(n('p','rr-note','Crea un conjunto y añade fuentes para calcular métricas.'));return s;}
   const sel=n('select');sel.add(new Option('Elige un conjunto',''));run.data.sets.forEach(x=>sel.add(new Option(x.name,x.id)));sel.value=run.data.metricsSet||'';sel.setAttribute('aria-label','Conjunto a evaluar');sel.onchange=()=>{run.data.metricsSet=sel.value||null;act('Métricas calculadas',async()=>{});};s.append(sel);
   const m=run.data.metrics;if(!m)return s;
   s.append(n('p','rr-note','Fuentes: '+m.sources+' · con exposición al entrenamiento: '+m.trainingExposure+' · desacuerdos de referencia sin resolver: '+m.referenceDisagreements));
   s.append(table(['Tarea','Motor','Tipo','Fuentes','TP','FP','FN','Sensibilidad','Especificidad','Precisión','Verdad'],(m.groups||[]).map(g=>[TASK_LABELS[g.task]||g.task,engineText(g.engine),STUDY_LABELS[g.studyType]||g.studyType,g.sources+' ('+g.withReference+' ref.)',g.tp,g.fp,g.fn,pct(g.sensitivity),pct(g.specificity),pct(g.precision),g.truthSource])));
   s.append(n('h3','','Calibración'),table(['Tarea','Franja','n','Tasa confirmada'],(m.calibration||[]).map(c=>[TASK_LABELS[c.task]||c.task,c.lower+'–'+c.upper,c.n,pct(c.confirmedRate)])));
   s.append(n('h3','','Desacuerdo profesional y operación'),table(['Tarea','Decididas','Descartadas + corregidas','Tasa','Pendientes'],(m.disagreement||[]).map(d=>[TASK_LABELS[d.task]||d.task,d.decided,d.disagreed,pct(d.rate),d.pending])),table(['Tarea','Ejecuciones','Fallidas','Sin confirmar','Latencia media'],(m.runs||[]).map(r=>[TASK_LABELS[r.task]||r.task,r.runs,r.failed,r.unconfirmed,r.meanLatencyMs!=null?r.meanLatencyMs+' ms':'—'])));
   const ul=n('ul','rv2-limits');(m.limitations||[]).forEach(l=>ul.append(n('li','',l)));s.append(ul);return s;
  }
  function reportSection(){
   const s=section('5 · INFORME DE VALIDACIÓN','Criterios de salida y veredicto','El servidor evalúa el peor grupo de cada tarea; el informe es inmutable y versiona por conjunto.');
   s.append(table(['Versión','Conjunto','Veredicto','Criterios','Aprobado','Hash'],run.data.reports.map(r=>[r.version,(run.data.sets.find(x=>x.id===r.set_id)||{}).name||r.set_id,r.verdict==='approved_for_pilot'?'Aprobado para piloto':'No aprobado',r.criteria_met?'cumplidos':'no cumplidos',String(r.approved_at).slice(0,10),String(r.content_hash).slice(0,12)+'…'])));
   if(!run.data.metricsSet||!run.data.metrics){s.append(n('p','rr-note','Calcula primero las métricas de un conjunto.'));return s;}
   const crit=n('textarea');crit.rows=6;crit.value=JSON.stringify(run.data.criteria||DEFAULT_CRITERIA,null,1);crit.setAttribute('aria-label','Criterios de salida (JSON)');crit.oninput=()=>{try{run.data.criteria=parseCriteria(crit.value);preview.replaceWith(previewEl());}catch(_){}};
   let preview=previewEl();function previewEl(){const p=n('div','rv-preview');let list;try{list=parseCriteria(crit?.value||JSON.stringify(DEFAULT_CRITERIA));}catch(e){p.append(n('p','rv2-blocked',e.message));return p;}const ev=evaluateCriteria(run.data.metrics,list);p.append(table(['Métrica','Tarea','Umbral','Valor (peor grupo)','Cumple'],ev.map(c=>[METRIC_LABELS[c.metric],TASK_LABELS[c.task],c.min!=null?'≥ '+pct(c.min):'≤ '+pct(c.max),pct(c.value),c.met?'✓ sí':'✕ no'])));p.append(n('p',ev.every(c=>c.met)?'rp-diff-ok':'rv2-blocked',ev.every(c=>c.met)?'✓ Todos los criterios se cumplen con las métricas actuales.':'✕ Hay criterios sin cumplir: el informe quedaría como "no aprobado".'));return p;}
   const notes=n('textarea');notes.rows=3;notes.placeholder='Notas: prueba del equipo humano + IA, tamaño muestral, limitaciones.';notes.setAttribute('aria-label','Notas del informe');
   s.append(n('label','rr-field','Criterios de salida (JSON)'),crit,preview,notes,button('Registrar informe de validación',()=>{let list;try{list=parseCriteria(crit.value);}catch(e){status(e.message,'rr-error');return;}act('Informe registrado',()=>run.api.recordReport(run.data.metricsSet,list,notes.value));},'rr-primary'));return s;
  }
  function monitoringSection(){
   const s=section('6 · MONITOREO E INCIDENTES','Deriva del motor desplegado','Series semanales de volumen, fallos, timeouts, latencia y desacuerdo; incidentes reportados por el equipo.'),mo=run.data.monitoring;
   if(mo)s.append(table(['Semana','Tarea','Ejecuciones','Fallidas','Sin confirmar','Latencia','Decididas','Desacuerdo'],(mo.weekly||[]).map(w=>[w.week,TASK_LABELS[w.task]||w.task,w.runs,w.failed,w.unconfirmed,w.meanLatencyMs!=null?w.meanLatencyMs+' ms':'—',w.decided,pct(w.disagreementRate)])));
   s.append(n('h3','','Incidentes'),table(['Fecha','Severidad','Categoría','Descripción','Estado'],run.data.incidents.map(i=>[String(i.created_at).slice(0,10),i.severity,i.category,i.description,i.status==='open'?'abierto':'cerrado'])));
   const open=run.data.incidents.filter(i=>i.status==='open');if(open.length){const sel=n('select'),res=n('input');open.forEach(i=>sel.add(new Option(i.description.slice(0,60),i.id)));sel.setAttribute('aria-label','Incidente a cerrar');res.placeholder='Resolución';res.setAttribute('aria-label','Resolución');const f=n('div','rv-form');f.append(sel,res,button('Cerrar incidente',()=>act('Incidente cerrado',()=>run.api.closeIncident(sel.value,res.value))));s.append(f);}
   const form=n('div','rv-form'),sev=n('select'),cat=n('select'),desc=n('input');['low','moderate','high','critical'].forEach(v=>sev.add(new Option(v,v)));['wrong_numbering','missed_structure','false_signal','quality_misjudged','ui_error','latency','other'].forEach(v=>cat.add(new Option(v,v)));desc.placeholder='Descripción (≥ 5 caracteres)';sev.setAttribute('aria-label','Severidad');cat.setAttribute('aria-label','Categoría del incidente');desc.setAttribute('aria-label','Descripción del incidente');
   form.append(sev,cat,desc,button('Reportar incidente',()=>act('Incidente reportado',()=>run.api.reportIncident(sev.value,cat.value,desc.value,run.source?.id||null)),'rr-primary'));s.append(form);return s;
  }
  function render(){
   if(run.closed)return;const fb=host.querySelector('.rr-feedback');host.replaceChildren();if(fb)host.prepend(fb);
   const top=n('section','rr-review rp-review rv-review'),head=n('header','rr-review-head'),title=n('div');
   title.append(n('p','rr-step','Etapa 7 · Validación clínica'),n('h1','','Evidencia del sistema humano + IA'),n('p','rr-lead','Nada de lo que aparece aquí autoriza uso diagnóstico: documenta el rendimiento para que la clínica y la revisión regulatoria decidan.'));head.append(title);top.append(head);
   top.append(disclosureSection(),setsSection(),referenceSection(),metricsSection(),reportSection(),monitoringSection(),n('p','rr-note rr-safety-note','Cambiar de motor o versión exige un nuevo informe de validación. Las métricas sin referencia multi-profesional usan las decisiones del propio revisor.'));host.append(top);
   if(run.busy)host.querySelectorAll('button,select,textarea,input').forEach(b=>{if(!b.closest('.rr-bar'))b.disabled=true;});
  }
  host.append(n('p','rr-feedback','Cargando validación…'));
  try{await reload();render();status('Panel de validación listo.','rr-ok');}catch(e){render();status(e?.message||'No se pudo cargar el panel.','rr-error');}
 }
 const api={TASK_LABELS,METRIC_LABELS,DEFAULT_CRITERIA,disclosureSummary,evaluateCriteria,parseCriteria};
 if(typeof document!=='undefined'){api.open=open;api.close=()=>close(active,true);addEventListener('pagehide',()=>close(active,true));}
 return Object.freeze(api);
});
