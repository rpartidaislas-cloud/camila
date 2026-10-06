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
   if(!exact(d,['schema','photos','analysis','items'])||![1,2].includes(d.schema)||!Array.isArray(d.photos)||d.photos.length<1||d.photos.length>8||!Array.isArray(d.items)||d.items.length>64)return false;
   const views=new Set();for(const p of d.photos){if(!exact(p,['view','sha256'])||!F.views.includes(p.view)||views.has(p.view)||!/^[a-f0-9]{64}$/.test(p.sha256))return false;views.add(p.view);if(caseRow&&!caseRow.document.views.some(v=>v.view===p.view&&v.original.sha256===p.sha256))return false;}
   let report=null;
   if(d.analysis!==null){
    const a=d.analysis;if(!exact(a,['model','at','requestId','report'])||a.model!=='claude-sonnet-4-6'||typeof a.at!=='string'||!Number.isFinite(Date.parse(a.at))||typeof a.requestId!=='string'||a.requestId&&!/^msg_[a-zA-Z0-9_-]{1,100}$/.test(a.requestId))return false;
    report=F.parse(a.report,[...views]);if(!same(report,a.report))return false;
   }
   const ids=new Set(),sources=new Set();for(const i of d.items){
    if(!exact(i,['id','sourceId','view','tooth','text','state',...(d.schema===2?['evidence']:[])])||!uuid(i.id)||ids.has(i.id)||!views.has(i.view)||!(i.tooth===''||F.tooth(i.tooth))||!text(i.text,600)||!['pending','confirmed','rejected'].includes(i.state)||!text(i.sourceId,4))return false;
    if(d.schema===2){
     if(!Array.isArray(i.evidence)||!i.evidence.length||i.evidence.length>d.photos.length||!i.evidence.some(p=>p?.view===i.view))return false;
     const expected=d.photos.filter(p=>i.evidence.some(e=>e?.view===p.view));
     if(!same(i.evidence,expected))return false;
    }
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
 // Origin stays immutable; these are dentist-chosen supporting originals, not AI consensus.
 function evidence(doc,item){return doc.schema===2?item.evidence:doc.photos.filter(p=>p.view===item.view);}
 function upgrade(doc){if(!validate(doc))throw Error('Revisión no válida.');const next=structuredClone(doc);if(next.schema===1){next.items.forEach(i=>i.evidence=evidence(doc,i).map(p=>({...p})));next.schema=2;}return next;}
 function setEvidence(doc,id,views){
  if(doc.schema!==2||!validate(doc)||!Array.isArray(views)||new Set(views).size!==views.length||views.some(v=>!doc.photos.some(p=>p.view===v)))throw Error('Evidencia no válida.');
  const item=doc.items.find(i=>i.id===id);if(!item||!views.includes(item.view))throw Error('Conserva el original de origen.');
  const next=doc.photos.filter(p=>views.includes(p.view)).map(p=>({...p}));
  if(!same(item.evidence,next)){item.evidence=next;item.state='pending';return true;}return false;
 }
 return {validate,create,validRow,same,evidence,upgrade,setEvidence};
});
