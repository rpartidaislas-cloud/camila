/* Versioned private review, separate from manual clinical notes and patient sharing. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./smyl-photo-findings.js'):root.SmylPhotoFindings);if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylPhotoReviewModel=api;})(globalThis,function(F){
 'use strict';
 const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
 const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
 const text=(v,n)=>typeof v==='string'&&v.length<=n;
 const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
 function validate(d,caseRow){
  try{
   if(!exact(d,['schema','photos','analysis','items'])||d.schema!==1||!Array.isArray(d.photos)||d.photos.length<1||d.photos.length>8||!Array.isArray(d.items)||d.items.length>64)return false;
   const views=new Set();for(const p of d.photos){if(!exact(p,['view','sha256'])||!F.views.includes(p.view)||views.has(p.view)||!/^[a-f0-9]{64}$/.test(p.sha256))return false;views.add(p.view);if(caseRow&&!caseRow.document.views.some(v=>v.view===p.view&&v.original.sha256===p.sha256))return false;}
   let report=null;
   if(d.analysis!==null){
    const a=d.analysis;if(!exact(a,['model','at','requestId','report'])||a.model!=='claude-sonnet-4-6'||typeof a.at!=='string'||!Number.isFinite(Date.parse(a.at))||typeof a.requestId!=='string'||a.requestId&&!/^msg_[a-zA-Z0-9_-]{1,100}$/.test(a.requestId))return false;
    report=F.parse(a.report,[...views]);if(!same(report,a.report))return false;
   }
   const ids=new Set(),sources=new Set();for(const i of d.items){
    if(!exact(i,['id','sourceId','view','tooth','text','state'])||!uuid(i.id)||ids.has(i.id)||!views.has(i.view)||!(i.tooth===''||F.tooth(i.tooth))||!text(i.text,600)||!['pending','confirmed','rejected'].includes(i.state)||!text(i.sourceId,4))return false;
    ids.add(i.id);if(i.state==='confirmed'&&(!i.tooth||!i.text.trim()))return false;
    if(i.sourceId){if(sources.has(i.sourceId)||!report?.findings.some(f=>f.id===i.sourceId&&f.view===i.view))return false;sources.add(i.sourceId);}
   }
   return sources.size===(report?.findings.length||0);
  }catch(_){return false;}
 }
 function create(photos,analysis=null){
  const a=analysis?{model:analysis.model,at:analysis.at,requestId:analysis.requestId,report:F.parse(analysis.report,photos.map(p=>p.view))}:null;
  return {schema:1,photos:photos.map(p=>({view:p.view,sha256:p.sha256})),analysis:a,items:(a?.report.findings||[]).map(f=>({id:crypto.randomUUID(),sourceId:f.id,view:f.view,tooth:f.tooth||'',text:f.observation,state:'pending'}))};
 }
 function validRow(row,caseRow){return !!row&&row.case_id===caseRow.id&&row.tenant_id===caseRow.tenant_id&&row.patient_id===caseRow.patient_id&&Number.isInteger(row.revision)&&row.revision>0&&row.updated_by===row.tenant_id&&Number.isFinite(Date.parse(row.updated_at))&&validate(row.document,caseRow);}
 return {validate,create,validRow,same};
});
