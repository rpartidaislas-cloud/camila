/* Local-only validation of photographic suggestions. No network, model calls or storage. */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.SmylPhotoFindings=m;})(typeof globalThis==='undefined'?this:globalThis,function(){
 'use strict';
 const views=['frontal','left','right','tresCuartos','extraoral','intraoral','intraoralLeft','intraoralRight'];
 const categories={deposit:'Depósito visible',color:'Coloración',wear:'Forma o desgaste',position:'Posición aparente',gap:'Espacio por valorar',soft_tissue:'Tejido visible',other:'Otra observación'};
 const tooth=v=>typeof v==='string'&&/^[1-4][1-8]$/.test(v);
 const text=(v,max)=>typeof v==='string'&&v.length<=max&&!!v.trim();
 const fail=()=>{throw new Error('La respuesta no permite una revisión segura. No se añadió nada al mapa.');};
 function parse(value,selected){
  if(!Array.isArray(selected)||!selected.length||selected.length>8||new Set(selected).size!==selected.length||selected.some(v=>!views.includes(v)))fail();
  if(!value||value.schema!==1||!Array.isArray(value.images)||value.images.length!==selected.length||!Array.isArray(value.findings)||value.findings.length>32||!Array.isArray(value.limitations)||value.limitations.length>8||value.limitations.some(v=>!text(v,300)))fail();
  const seen=new Set(),images=value.images.map(i=>{
   if(!i||!selected.includes(i.view)||seen.has(i.view)||!['usable','limited','unusable'].includes(i.quality)||!text(i.note,300))fail();
   seen.add(i.view);return {view:i.view,quality:i.quality,note:i.note.trim()};
  });
  const ids=new Set(),findings=value.findings.map(f=>{
   if(!f||typeof f.id!=='string'||!/^f[1-9][0-9]?$/.test(f.id)||ids.has(f.id)||!selected.includes(f.view)||images.find(i=>i.view===f.view).quality==='unusable'||!(f.tooth===null||tooth(f.tooth))||!Object.hasOwn(categories,f.category)||!text(f.observation,400)||!text(f.evidence,250))fail();
   ids.add(f.id);
   // Model-supplied approval, presence, severity and treatment are never accepted.
   return {id:f.id,view:f.view,tooth:f.tooth,category:f.category,observation:f.observation.trim(),evidence:f.evidence.trim()};
  });
  return {schema:1,images,findings,limitations:value.limitations.map(v=>v.trim())};
 }
 function recordNote(item,source){
  if(item?.confirmed!==true||!tooth(item.tooth)||!text(item.text,600)||!['ai','manual'].includes(item.origin)||!views.includes(item.photo?.view)||!/^[a-f0-9]{64}$/.test(item.photo?.sha256)||!source||!/^[a-f0-9-]{36}$/.test(source.caseId))fail();
  const lines=[item.text.trim(),'Registro confirmado por el dentista · '+(item.origin==='ai'?'con apoyo de IA (preliminar)':'manual')];
  if(item.origin==='ai'){
   if(!text(item.suggestion?.observation,400)||!text(item.suggestion?.evidence,250)||item.suggestion.view!==item.photo.view||source.model!=='claude-sonnet-4-6'||!Number.isFinite(Date.parse(source.at))||typeof source.requestId!=='string'||source.requestId&&!/^msg_[a-zA-Z0-9_-]{1,100}$/.test(source.requestId))fail();
   lines.push('Sugerencia original IA: '+item.suggestion.observation,'Evidencia sugerida: '+item.suggestion.evidence,'Modelo: '+source.model+' · '+source.at+(source.requestId?' · '+source.requestId:''));
  }
  lines.push('Fuente original: '+item.photo.view+' · caso '+source.caseId,'SHA-256: '+item.photo.sha256);
  return lines.join('\n');
 }
 return {views,categories,tooth,parse,recordNote};
});
