/* Private, dentist-reviewed radiograph suggestions. AI output never becomes a diagnosis automatically. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./smyl-dental-model.js'):root.SmylDentalModel);if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylRadiographReviewModel=api;})(globalThis,function(D){
 'use strict';
 const types=['panoramic','periapical','bitewing','other'];
 const categories=['density','contour','restoration','support','development','other'];
 const states=['ready','requested','completed','unconfirmed'];
 // Modelos con los que se guardó un análisis: las revisiones anteriores usan Sonnet 4.6; las nuevas, Opus 5.5.
 const models=['claude-sonnet-4-6','claude-opus-5-5'];
 // Cada señal puede traer el tamaño (ancho y alto, de 0 a 1 sobre la imagen) del cuadro que propone la IA; las revisiones anteriores no lo traen.
 const itemKeys=['id','sourceId','tooth','text','x','y','state'];
 const boxSize=v=>typeof v==='number'&&Number.isFinite(v)&&v>=.02&&v<=.6;
 const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
 const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
 const text=(v,n,min=0)=>typeof v==='string'&&v.length<=n&&v.trim().length>=min;
 const tooth=v=>v===''||(D?.teeth||[]).includes(String(v));
 function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
 const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

 // Motivo concreto por el que una observación no cumple el contrato. Solo se muestra en pantalla (diagnóstico); lo que
 // devuelve la IA se recorta y se limpia antes de citarlo, y nunca se guarda en el expediente.
 const shown=v=>typeof v==='string'?'"'+v.replace(/[^\p{L}\p{N} .,;:()/+_-]/gu,'').slice(0,40)+'"':v===null?'null':typeof v;
 function observationProblem(o,ids){
  const ok=o&&typeof o==='object'&&!Array.isArray(o);
  const id=ok&&typeof o.id==='string'&&/^r([1-9]|1[0-2])$/.test(o.id)?o.id:'';
  if(!exact(o,['id','category','tooth','observation','evidence']))return {id,reason:'tiene campos distintos de los esperados ('+(ok?Object.keys(o).slice(0,8).map(k=>shown(k).replace(/"/g,'')).join(', '):typeof o)+')'};
  if(!id)return {id,reason:'id '+shown(o.id)+' fuera de r1 a r12'};
  if(ids.has(o.id))return {id,reason:'id repetido'};
  if(!categories.includes(o.category))return {id,reason:'categoría '+shown(o.category)+' no permitida'};
  if(!(o.tooth===null||tooth(o.tooth)&&o.tooth!==''))return {id,reason:'diente '+shown(o.tooth)+' no es un número FDI válido ni null'};
  if(!text(o.observation,500,1))return {id,reason:'observación vacía o de más de 500 caracteres ('+(typeof o.observation==='string'?o.observation.length:typeof o.observation)+')'};
  if(!text(o.evidence,300,1))return {id,reason:'evidencia vacía o de más de 300 caracteres ('+(typeof o.evidence==='string'?o.evidence.length:typeof o.evidence)+')'};
  return null;
 }
 function parseReport(value){
  if(!exact(value,['schema','quality','qualityNote','observations','limitations'])||value.schema!==1||!['usable','limited','unusable'].includes(value.quality)||!text(value.qualityNote,400,1)||!Array.isArray(value.observations)||value.observations.length>12||!Array.isArray(value.limitations)||value.limitations.length>8)throw Error('Informe radiográfico no válido.');
  const ids=new Set();value.observations.forEach(o=>{const why=observationProblem(o,ids);if(why)throw Error('Observación radiográfica no válida'+(why.id?' ('+why.id+')':'')+': '+why.reason+'.');ids.add(o.id);});
  value.limitations.forEach(v=>{if(!text(v,300,1))throw Error('Limitación radiográfica no válida.');});
  if(value.quality==='unusable'&&value.observations.length)throw Error('Una imagen no utilizable no puede producir observaciones.');
  return structuredClone(value);
 }
 function validate(doc,study){
  try{
   if(!exact(doc,['schema','study','workflow','analysis','items'])||doc.schema!==1||!exact(doc.study,['id','type','sha256'])||!uuid(doc.study.id)||!types.includes(doc.study.type)||!/^[a-f0-9]{64}$/.test(doc.study.sha256)||!exact(doc.workflow,['state','attempt'])||!states.includes(doc.workflow.state)||!Number.isInteger(doc.workflow.attempt)||doc.workflow.attempt<0||doc.workflow.attempt>1||!Array.isArray(doc.items)||doc.items.length>12)return false;
   if(study&&(doc.study.id!==study.id||doc.study.type!==study.type||doc.study.sha256!==study.asset?.sha256))return false;
   if(doc.workflow.state==='ready'&&(doc.workflow.attempt!==0||doc.analysis!==null||doc.items.length))return false;
   if(['requested','unconfirmed'].includes(doc.workflow.state)&&(doc.workflow.attempt!==1||doc.analysis!==null||doc.items.length))return false;
   let report=null;
   if(doc.workflow.state==='completed'){
    if(doc.workflow.attempt!==1||!exact(doc.analysis,['model','at','requestId','report'])||!models.includes(doc.analysis.model)||!text(doc.analysis.at,40,1)||!Number.isFinite(Date.parse(doc.analysis.at))||!text(doc.analysis.requestId,104)||doc.analysis.requestId&&!/^msg_[a-zA-Z0-9_-]{1,100}$/.test(doc.analysis.requestId))return false;
    report=parseReport(doc.analysis.report);if(!same(report,doc.analysis.report))return false;
   }else if(doc.analysis!==null)return false;
   const ids=new Set(),sources=new Set();for(const item of doc.items){
    if(!(exact(item,itemKeys)||exact(item,[...itemKeys,'w','h']))||!uuid(item.id)||ids.has(item.id)||!/^r([1-9]|1[0-2])$/.test(item.sourceId)||sources.has(item.sourceId)||!tooth(item.tooth)||!text(item.text,600)||!['pending','confirmed','rejected'].includes(item.state))return false;
    if(!((item.x===null&&item.y===null)||(typeof item.x==='number'&&Number.isFinite(item.x)&&item.x>=0&&item.x<=1&&typeof item.y==='number'&&Number.isFinite(item.y)&&item.y>=0&&item.y<=1)))return false;
    if(Object.hasOwn(item,'w')&&(item.x===null||![item.w,item.h].every(boxSize)))return false;
    if(item.state==='confirmed'&&(!item.text.trim()||item.x===null))return false;
    const source=report?.observations.find(o=>o.id===item.sourceId);if(!source)return false;
    ids.add(item.id);sources.add(item.sourceId);
   }
   return sources.size===(report?.observations.length||0);
  }catch(_){return false;}
 }
 function create(study){return {schema:1,study:{id:study.id,type:study.type,sha256:study.asset.sha256},workflow:{state:'ready',attempt:0},analysis:null,items:[]};}
 function requested(doc){if(!validate(doc)||doc.workflow.state!=='ready')throw Error('La revisión ya fue iniciada.');const next=structuredClone(doc);next.workflow={state:'requested',attempt:1};return next;}
 function completed(doc,result){if(!validate(doc)||doc.workflow.state!=='requested')throw Error('La solicitud no está registrada.');const next=structuredClone(doc),analysis={model:result.model,at:result.at,requestId:result.requestId,report:parseReport(result.report)};next.workflow.state='completed';next.analysis=analysis;const at=o=>{const l=result.locations&&result.locations[o.id];return l&&[l.x,l.y].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)?l:null;};
  next.items=analysis.report.observations.map(o=>{const l=at(o);const item={id:crypto.randomUUID(),sourceId:o.id,tooth:o.tooth||'',text:o.observation,x:l?l.x:null,y:l?l.y:null,state:'pending'};if(l&&[l.w,l.h].every(boxSize)){item.w=l.w;item.h=l.h;}return item;});if(!validate(next))throw Error('La respuesta no cumple el contrato.');return next;}
 function unconfirmed(doc){if(!validate(doc)||doc.workflow.state!=='requested')throw Error('La solicitud no está registrada.');const next=structuredClone(doc);next.workflow.state='unconfirmed';return next;}
 function validRow(row,study,tenant,patient){return !!row&&row.tenant_id===tenant&&row.patient_id===patient&&row.study_id===study.id&&row.updated_by===tenant&&Number.isInteger(row.revision)&&row.revision>0&&Number.isFinite(Date.parse(row.updated_at))&&validate(row.document,study);}
 return {types,categories,parseReport,validate,create,requested,completed,unconfirmed,validRow,same};
});
