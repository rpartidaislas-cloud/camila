/* Manual dental record v1 + append-only professional findings v2. No AI diagnosis, generation or local persistence. */
(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.SmylDentalModel=model;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const upper=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
  const lower=[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
  const teeth=[...upper,...lower].map(String), types=['panoramic','periapical','bitewing','other'];
  const surfaces=['whole','M','D','V','L','O','I'];
  const conditions=[
    {code:'caries',label:'Caries',tone:'condition'},
    {code:'restoration',label:'Restauración',tone:'restoration'},
    {code:'crown',label:'Corona',tone:'restoration'},
    {code:'endodontics',label:'Endodoncia',tone:'restoration'},
    {code:'missing',label:'Ausente',tone:'condition'},
    {code:'implant',label:'Implante',tone:'restoration'},
    {code:'fracture',label:'Fractura',tone:'condition'},
    {code:'sealant',label:'Sellador',tone:'restoration'},
    {code:'other',label:'Otra',tone:'condition'}
  ];
  const conditionCodes=conditions.map(item=>item.code);
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
  const empty=()=>({schema:1,teeth:{},studies:[],findings:{schema:2,events:[]}});
  function ensureFindings(doc){
    if(!doc||typeof doc!=='object'||Array.isArray(doc))throw new TypeError('Se requiere un expediente dental.');
    if(doc.findings===undefined)doc.findings={schema:2,events:[]};
    return doc.findings;
  }
  function surfaceAllowed(tooth,surface){
    if(!teeth.includes(String(tooth))||!surfaces.includes(surface))return false;
    const unit=Number(String(tooth)[1]);
    if(surface==='O')return unit>=4&&unit<=8;
    if(surface==='I')return unit>=1&&unit<=3;
    return true;
  }
  function surfaceLabel(surface,tooth){
    if(surface==='whole')return 'Pieza completa';
    if(surface==='M')return 'Mesial';
    if(surface==='D')return 'Distal';
    if(surface==='V')return 'Vestibular';
    if(surface==='O')return 'Oclusal';
    if(surface==='I')return 'Incisal';
    if(surface==='L')return /^[12]/.test(String(tooth||''))?'Palatina':'Lingual';
    return '';
  }
  const conditionLabel=code=>conditions.find(item=>item.code===code)?.label||'';
  function conditionCodeFromText(value){
    const plain=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-MX').replace(/[^a-z0-9ñ]+/g,' ').trim();
    const aliases={caries:['caries'],restoration:['restauracion','obturacion','resina','amalgama'],crown:['corona'],endodontics:['endodoncia','tratamiento de conducto'],missing:['ausente','perdida','faltante'],implant:['implante'],fracture:['fractura','fracturado'],sealant:['sellador','sellante']};
    const clinicalTerms=Object.values(aliases).flat().sort((a,b)=>b.length-a.length).join('|');
    if(new RegExp(`\\b(?:sin|niega|ausencia de|no presenta|no hay|no se observa|no tiene)\\s+(?:${clinicalTerms})\\b`).test(plain))return 'other';
    return Object.entries(aliases).find(([,terms])=>terms.some(term=>plain.includes(term)))?.[0]||'other';
  }
  function validSourceRef(value){
    return value===null||(exact(value,['type','id'])&&value.type==='evidence_finding'&&uuid(value.id));
  }
  function sameSourceRef(left,right){
    if(left===null||right===null)return left===right;
    return left?.type===right?.type&&left?.id===right?.id;
  }
  function validFinding(event,seen){
    const keys=['id','tooth','surface','conditionCode','condition','state','capture','supersedes','sourceRef'];
    if(!exact(event,keys)||!uuid(event.id)||seen.has(event.id)||!teeth.includes(event.tooth)||!surfaceAllowed(event.tooth,event.surface))return false;
    if(!conditionCodes.includes(event.conditionCode)||typeof event.condition!=='string'||!event.condition.trim()||event.condition.length>180)return false;
    if(!['active','following','resolved'].includes(event.state)||!['touch','voice'].includes(event.capture)||!validSourceRef(event.sourceRef))return false;
    if(event.supersedes!==null&&(!uuid(event.supersedes)||!seen.has(event.supersedes)))return false;
    return true;
  }
  function createFinding(input){
    const value=input&&typeof input==='object'?input:{};
    const id=value.id||(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():'');
    const conditionCode=String(value.conditionCode||'');
    const condition=String(value.condition||conditionLabel(conditionCode)||'').trim();
    return {
      id,
      tooth:String(value.tooth||''),
      surface:String(value.surface||''),
      conditionCode,
      condition,
      state:String(value.state||'active'),
      capture:String(value.capture||'touch'),
      supersedes:value.supersedes||null,
      sourceRef:value.sourceRef?{type:value.sourceRef.type,id:value.sourceRef.id}:null
    };
  }
  function events(doc){return doc?.findings?.schema===2&&Array.isArray(doc.findings.events)?doc.findings.events:[];}
  function currentFindings(doc){
    const all=events(doc),superseded=new Set(all.map(event=>event.supersedes).filter(Boolean));
    return all.filter(event=>!superseded.has(event.id));
  }
  function activeFindings(doc,options){
    const tooth=options&&options.tooth?String(options.tooth):'';
    return currentFindings(doc).filter(event=>event.state!=='resolved'&&(!tooth||event.tooth===tooth));
  }
  function findingsForTooth(doc,tooth,options){
    const config=options||{},all=config.includeSuperseded?events(doc):currentFindings(doc);
    return all.filter(event=>event.tooth===String(tooth)&&(config.includeResolved||event.state!=='resolved'));
  }
  function findingLabel(event){
    if(!event)return '';
    return `Pieza ${event.tooth} · ${surfaceLabel(event.surface,event.tooth)} · ${event.condition}`;
  }
  function findingTone(event){
    if(!event)return 'neutral';
    if(event.state==='resolved')return 'resolved';
    return conditions.find(item=>item.code===event.conditionCode)?.tone||'condition';
  }
  function validate(doc,tenant,patient){
    const text=(v,max)=>typeof v==='string'&&v.length<=max;
    if(!uuid(tenant)||!uuid(patient)||!doc||doc.schema!==1||!doc.teeth||typeof doc.teeth!=='object'||Array.isArray(doc.teeth)||!Array.isArray(doc.studies)||doc.studies.length>20)return false;
    for(const [tooth,n] of Object.entries(doc.teeth))if(!teeth.includes(tooth)||!n||!text(n.observation,2000)||!text(n.action,2000)||!['pending','following','done'].includes(n.status))return false;
    if(doc.findings!==undefined){
      if(!exact(doc.findings,['schema','events'])||doc.findings.schema!==2||!Array.isArray(doc.findings.events)||doc.findings.events.length>200)return false;
      const findingIds=new Set(),findingById=new Map(),supersededIds=new Set();
      for(const event of doc.findings.events){
        if(!validFinding(event,findingIds))return false;
        if(event.supersedes!==null){
          const previous=findingById.get(event.supersedes);
          if(!previous||supersededIds.has(event.supersedes)||previous.tooth!==event.tooth||previous.surface!==event.surface||!sameSourceRef(previous.sourceRef,event.sourceRef))return false;
          supersededIds.add(event.supersedes);
        }
        findingIds.add(event.id);findingById.set(event.id,event);
      }
    }
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
  return {upper,lower,teeth,types,surfaces,conditions,uuid,empty,ensureFindings,surfaceAllowed,surfaceLabel,conditionLabel,conditionCodeFromText,createFinding,activeFindings,findingsForTooth,findingLabel,findingTone,validate,hash,asset};
});
