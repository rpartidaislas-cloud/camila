/* Read-only projection of ONE saved photo review. No inference, merging or IO. */
(function(root,factory){const m=factory(typeof module==='object'&&module.exports?require('./smyl-photo-review-model.js'):root.SmylPhotoReviewModel);if(typeof module==='object'&&module.exports)module.exports=m;else root.SmylReviewEvidence=m;})(globalThis,function(M){
 'use strict';
 const family=view=>view.startsWith('intraoral')?'intraoral':'smile';
 function organize(doc,{by='tooth',state='all',tooth=null}={}){
  if(!M.validate(doc)||!['tooth','photo'].includes(by)||!['all','pending','confirmed','rejected'].includes(state))throw Error('No se pudo verificar la evidencia.');
  const items=doc.items,groups=new Map(),images=doc.photos.map(p=>{
   const source=doc.analysis?.report.images.find(i=>i.view===p.view),observations=items.filter(i=>M.evidence(doc,i).some(e=>e.view===p.view));
   return {view:p.view,sha256:p.sha256,family:family(p.view),quality:source?.quality||null,note:source?.note||'',
    pending:observations.filter(i=>i.state==='pending').length,confirmed:observations.filter(i=>i.state==='confirmed').length,rejected:observations.filter(i=>i.state==='rejected').length};
  });
  for(const item of items){
   if((tooth!==null&&item.tooth!==tooth)||(state!=='all'&&item.state!==state))continue;
   const sources=M.evidence(doc,item),keys=by==='photo'?sources.map(p=>p.view):[item.tooth||'unassigned'];
   for(const key of keys){if(!groups.has(key))groups.set(key,{key,items:[],views:[]});
    const group=groups.get(key);group.items.push(item);for(const p of sources)if(!group.views.includes(p.view))group.views.push(p.view);
   }
  }
  const ordered=[...groups.values()].sort((a,b)=>by==='photo'?doc.photos.findIndex(p=>p.view===a.key)-doc.photos.findIndex(p=>p.view===b.key):a.key==='unassigned'?1:b.key==='unassigned'?-1:Number(a.key)-Number(b.key));
  return {groups:ordered,images,total:items.length,analyzed:images.filter(p=>p.quality!==null).length,
   pending:items.filter(i=>i.state==='pending').length,confirmed:items.filter(i=>i.state==='confirmed').length,unassigned:items.filter(i=>!i.tooth&&i.state!=='rejected').length};
 }
 return {organize,family};
});
