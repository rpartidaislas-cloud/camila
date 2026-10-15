/* Manual dental record v1. No AI diagnosis, generation or local persistence. */
(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.SmylDentalModel=model;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const upper=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
  const lower=[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
  const teeth=[...upper,...lower].map(String), types=['panoramic','periapical','bitewing','other'];
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
  const empty=()=>({schema:1,teeth:{},studies:[]});
  function validate(doc,tenant,patient){
    const text=(v,max)=>typeof v==='string'&&v.length<=max;
    if(!uuid(tenant)||!uuid(patient)||!doc||doc.schema!==1||!doc.teeth||typeof doc.teeth!=='object'||Array.isArray(doc.teeth)||!Array.isArray(doc.studies)||doc.studies.length>20)return false;
    for(const [tooth,n] of Object.entries(doc.teeth))if(!teeth.includes(tooth)||!n||!text(n.observation,2000)||!text(n.action,2000)||!['pending','following','done'].includes(n.status))return false;
    const ids=new Set();
    for(const s of doc.studies){
      if(!s||!uuid(s.id)||ids.has(s.id)||!types.includes(s.type)||!text(s.label,100)||!text(s.date,10)||!text(s.notes,4000)||!Array.isArray(s.marks)||s.marks.length>50)return false;
      ids.add(s.id);if(s.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||!Number.isFinite(Date.parse(s.date))||new Date(s.date).toISOString().slice(0,10)!==s.date))return false;
      const a=s.asset;if(!a||!['image/png','image/jpeg'].includes(a.mime)||!Number.isInteger(a.bytes)||a.bytes<16||a.bytes>20971520||!/^[a-f0-9]{64}$/.test(a.sha256))return false;
      if(a.path!==`${tenant}/${patient}/${s.id}/${a.sha256}.${a.mime.split('/')[1]}`)return false;
      const marks=new Set();for(const m of s.marks){if(!m||!uuid(m.id)||marks.has(m.id)||!Number.isFinite(m.x)||!Number.isFinite(m.y)||m.x<0||m.x>1||m.y<0||m.y>1||!text(m.note,2000)||!(m.tooth===''||teeth.includes(m.tooth)))return false;marks.add(m.id);}
    }return true;
  }
  const hash=async buffer=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
  async function asset(file,tenant,patient,id){
    if(!uuid(tenant)||!uuid(patient)||!uuid(id)||!file||!['image/jpeg','image/png'].includes(file.type)||file.size<16||file.size>20971520)throw new Error('Usa una imagen JPG o PNG de hasta 20 MB. DICOM y PDF aún no están disponibles.');
    const data=await file.arrayBuffer(),b=new Uint8Array(data);
    const valid=file.type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v):b[0]===255&&b[1]===216&&b[2]===255;
    if(!valid)throw new Error('El contenido no corresponde a una imagen JPG o PNG.');
    const sha256=await hash(data);return {path:`${tenant}/${patient}/${id}/${sha256}.${file.type.split('/')[1]}`,sha256,bytes:file.size,mime:file.type};
  }
  return {upper,lower,teeth,types,uuid,empty,validate,hash,asset};
});
