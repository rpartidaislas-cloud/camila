/* Bounded photographic workflow. No network, diagnosis, voting or automatic approval. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./smyl-photo-findings.js'):root.SmylPhotoFindings);if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylAnalysisWorkflow=api;})(globalThis,function(F){
 'use strict';
 const groups=[
  {key:'front',label:'Frente y sonrisa',views:['frontal','extraoral'],offset:0},
  {key:'side',label:'Laterales y ¾',views:['left','right','tresCuartos'],offset:10},
  {key:'intraoral',label:'Intraorales',views:['intraoral','intraoralLeft','intraoralRight'],offset:20}
 ];
 const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
 const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
 function plan(photos){return groups.map(g=>({key:g.key,views:photos.filter(p=>g.views.includes(p.view)).map(p=>p.view),state:'ready',attempt:null,result:null})).filter(g=>g.views.length);}
 function resultValid(a,views){try{return exact(a,['model','at','requestId','report'])&&a.model==='claude-sonnet-4-6'&&date(a.at)&&typeof a.requestId==='string'&&(a.requestId===''||/^msg_[a-zA-Z0-9_-]{1,100}$/.test(a.requestId))&&a.report.findings.length<=10&&same(F.parse(a.report,views),a.report);}catch(_){return false;}}
 function valid(w,photos){try{
  if(!exact(w,['schema','at','stages'])||w.schema!==1||!date(w.at)||!Array.isArray(w.stages))return false;
  const expected=plan(photos);if(w.stages.length!==expected.length||!expected.length||w.stages.filter(s=>s.state==='requested').length>1)return false;
  return w.stages.every((s,k)=>exact(s,['key','views','state','attempt','result'])&&s.key===expected[k].key&&same(s.views,expected[k].views)&&['ready','requested','completed','unconfirmed'].includes(s.state)&&(s.state==='ready'?s.attempt===null:uuid(s.attempt))&&(s.state==='completed'?resultValid(s.result,s.views):s.result===null));
 }catch(_){return false;}}
 function aggregate(w,photos){
  if(!valid(w,photos))throw Error('El avance de la revisión no es válido.');
  const done=w.stages.filter(s=>s.state==='completed');if(!done.length)return null;
  const images=done.flatMap(s=>s.result.report.images);
  return {model:'claude-sonnet-4-6',at:w.at,requestId:'',report:{schema:1,
   images:photos.map(p=>images.find(i=>i.view===p.view)).filter(Boolean),
   findings:done.flatMap(s=>s.result.report.findings.map((f,k)=>({...f,id:'f'+(groups.find(g=>g.key===s.key).offset+k+1)}))),
   // Keep each specialist's limitations verbatim in its result, not a truncated summary.
   limitations:[]}};
 }
 function create(photos){return {schema:3,photos:photos.map(p=>({view:p.view,sha256:p.sha256})),analysis:null,items:[],workflow:{schema:1,at:new Date().toISOString(),stages:plan(photos)}};}
 function transition(doc,key,state,result=null){
  if(doc.schema!==3||!valid(doc.workflow,doc.photos)||!same(aggregate(doc.workflow,doc.photos),doc.analysis))throw Error('Revisión no válida.');
  const next=structuredClone(doc),stage=next.workflow.stages.find(s=>s.key===key);
  if(!stage||!(stage.state==='ready'&&state==='requested'||stage.state==='requested'&&['completed','unconfirmed'].includes(state)))throw Error('Esta revisión no se puede repetir.');
  stage.state=state;stage.result=result;if(state==='requested')stage.attempt=crypto.randomUUID();
  if(!valid(next.workflow,next.photos))throw Error('Respuesta de revisión no válida.');
  next.analysis=aggregate(next.workflow,next.photos);
  for(const f of next.analysis?.report.findings||[]){if(!next.items.some(i=>i.sourceId===f.id))next.items.push({id:crypto.randomUUID(),sourceId:f.id,view:f.view,tooth:f.tooth||'',text:f.observation,state:'pending',evidence:next.photos.filter(p=>p.view===f.view).map(p=>({...p}))});}
  if(next.items.length>64)throw Error('No hay espacio para añadir estas sugerencias.');
  return next;
 }
 function canRestart(doc){
  return !!doc&&doc.schema===3&&Array.isArray(doc.photos)&&Array.isArray(doc.items)&&valid(doc.workflow,doc.photos)&&same(aggregate(doc.workflow,doc.photos),doc.analysis)&&doc.analysis===null&&doc.items.every(i=>!i.sourceId)&&doc.workflow.stages.some(s=>s.state==='unconfirmed')&&doc.workflow.stages.every(s=>['ready','unconfirmed'].includes(s.state));
 }
 function restart(doc){
  if(!canRestart(doc))throw Error('Esta revisión no se puede iniciar de nuevo.');
  const next=structuredClone(doc),now=new Date().toISOString();next.workflow.at=now===doc.workflow.at?new Date(Date.parse(now)+1).toISOString():now;
  for(const stage of next.workflow.stages){stage.state='ready';stage.attempt=null;stage.result=null;}
  next.analysis=null;
  if(!valid(next.workflow,next.photos)||aggregate(next.workflow,next.photos)!==null)throw Error('No se pudo preparar la nueva revisión.');
  return next;
 }
 function source(doc,id){if(doc.schema!==3)return null;return doc.workflow.stages.find(s=>s.state==='completed'&&s.result.report.findings.some((f,k)=>'f'+(groups.find(g=>g.key===s.key).offset+k+1)===id))||null;}
 function summary(doc){
  const stages=doc.workflow.stages,overlaps=[];
  for(const f of doc.analysis?.report.findings||[]){if(!f.tooth)continue;const key=f.tooth+':'+f.category;let group=overlaps.find(g=>g.key===key);if(!group){group={key,tooth:f.tooth,category:f.category,sources:[],ids:[]};overlaps.push(group);}const stage=source(doc,f.id);if(!group.sources.includes(stage.key))group.sources.push(stage.key);group.ids.push(f.id);}
  return {total:stages.length,completed:stages.filter(s=>s.state==='completed').length,ready:stages.filter(s=>s.state==='ready').length,uncertain:stages.filter(s=>['requested','unconfirmed'].includes(s.state)).length,overlaps:overlaps.filter(g=>g.sources.length>1)};
 }
 return {groups,plan,valid,aggregate,create,transition,canRestart,restart,source,summary};
});
