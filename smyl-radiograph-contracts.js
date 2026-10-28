/* SMYL radiografía asistida — contratos v2 (schema 1) para navegador y pruebas.
   Enumeraciones cerradas, campos extra rechazados, probabilidades en [0,1], geometrías
   normalizadas al original. Es la misma regla que supabase/functions/_shared/radiograph-contracts.ts
   y que los validadores SQL de 20261028120000_smyl_radiograph_ai_runs.sql; los vectores en
   tests/fixtures/radiograph-contracts/ fijan el comportamiento de los tres.
   Nada aquí convierte una salida del modelo en diagnóstico. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylRadiographContracts=api;})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const CONTRACT_VERSION=1;
 const STUDY_CLASSES=['panoramic','periapical','bitewing','intraoral_series','unknown'];
 const QUALITY_STATES=['usable','limited','unusable'];
 const QC_FLAG_CODES=['motion_blur','anterior_blur','anatomical_cropping','underexposure','overexposure','low_contrast','overlap','compression_artifacts','orientation_suspect','foreign_object','unknown_study_class'];
 const SEVERITIES=['low','moderate','high'];
 const ANALYSES=['tooth_localization','finding_candidates'];
 const VISIBILITIES=['complete','partial','not_evaluable'];
 const FINDING_CATEGORIES=['restoration','crown','implant','endodontic','apparently_missing','density','contour','support','development','other'];
 const EVIDENCE_LEVELS=['model_candidate'];
 const DECISION_STATES=['pending','confirmed','corrected','rejected'];
 const REPORT_PRIORITIES=['routine','soon','urgent'];
 const REPORT_SECTIONS=['description','technicalLimitations','clinicalCorrelation','missingInformation','complementaryStudies'];
 const FDI=/^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/;
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const CANDIDATE_ID=/^[a-z0-9][a-z0-9_-]{0,63}$/;
 const FORBIDDEN_CLAIM=/(diagn[oó]s|confirmad[oa]|certeza|definitiv|inequ[ií]voc|sin duda|diagnosis|confirmed|definite)/i;
 const fail=m=>{throw new Error(m);};
 const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const exact=(o,keys)=>isObj(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
 const cp=s=>[...s].length; // code points, igual que char_length en SQL
 const text=(v,min,max)=>typeof v==='string'&&cp(v)<=max&&cp(v.trim())>=min&&cp(v.trim())<=max;
 const prob=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
 const fdi=v=>typeof v==='string'&&FDI.test(v);
 const candidateId=v=>typeof v==='string'&&CANDIDATE_ID.test(v);
 const model=m=>exact(m,['provider','name','version'])&&text(m.provider,1,60)&&text(m.name,1,80)&&text(m.version,1,60);
 function geometry(g,allowPoint){
  if(!exact(g,['kind','coordinateSpace','points'])||g.coordinateSpace!=='source-normalized'||!Array.isArray(g.points))return false;
  if(!['point','bbox','polygon'].includes(g.kind)||(g.kind==='point'&&!allowPoint))return false;
  let prev=null;
  for(const p of g.points){
   if(!Array.isArray(p)||p.length!==2||!prob(p[0])||!prob(p[1]))return false;
   if(prev&&prev[0]===p[0]&&prev[1]===p[1])return false;
   prev=p;
  }
  const n=g.points.length;
  if(g.kind==='point')return n===1;
  if(g.kind==='bbox')return n===2&&g.points[1][0]>g.points[0][0]&&g.points[1][1]>g.points[0][1];
  if(n<3||n>64)return false;
  if(g.points[0][0]===g.points[n-1][0]&&g.points[0][1]===g.points[n-1][1])return false;
  let area=0;
  for(let i=0;i<n;i++){const a=g.points[i],b=g.points[(i+1)%n];area+=a[0]*b[1]-b[0]*a[1];}
  return Math.abs(area)/2>=0.000001;
 }
 function parseQc(value){
  if(!exact(value,['schema','studyClass','quality','applicableAnalyses','blockedAnalyses','model'])||value.schema!==1||!model(value.model))fail('Resultado de control de calidad no válido.');
  const sc=value.studyClass;
  if(!exact(sc,['value','probability','alternatives'])||!STUDY_CLASSES.includes(sc.value)||!prob(sc.probability)||!Array.isArray(sc.alternatives)||sc.alternatives.length>4)fail('Clase de estudio no válida.');
  const seen=new Set([sc.value]);
  for(const a of sc.alternatives){
   if(!exact(a,['value','probability'])||!STUDY_CLASSES.includes(a.value)||seen.has(a.value)||!prob(a.probability))fail('Alternativa de clase de estudio no válida.');
   seen.add(a.value);
  }
  const q=value.quality;
  if(!exact(q,['status','flags'])||!QUALITY_STATES.includes(q.status)||!Array.isArray(q.flags)||q.flags.length>12)fail('Calidad radiográfica no válida.');
  for(const f of q.flags){
   if(!exact(f,['code','severity','region','explanation'])||!QC_FLAG_CODES.includes(f.code)||!SEVERITIES.includes(f.severity)||!text(f.explanation,1,300)||!(f.region===null||geometry(f.region,true)))fail('Bandera de calidad no válida.');
  }
  if(!Array.isArray(value.applicableAnalyses)||!Array.isArray(value.blockedAnalyses))fail('Análisis aplicables no válidos.');
  const applicable=new Set();
  for(const a of value.applicableAnalyses){if(!ANALYSES.includes(a)||applicable.has(a))fail('Análisis aplicable no válido.');applicable.add(a);}
  const blocked=new Set();
  for(const b of value.blockedAnalyses){
   if(!exact(b,['code','reason'])||!ANALYSES.includes(b.code)||applicable.has(b.code)||blocked.has(b.code)||!text(b.reason,1,300))fail('Análisis bloqueado no válido.');
   blocked.add(b.code);
  }
  if(q.status==='unusable'&&applicable.size)fail('Una imagen no utilizable no habilita análisis.');
  return structuredClone(value);
 }
 function parseToothSet(value){
  if(!exact(value,['schema','sourceId','model','candidates'])||value.schema!==1||!UUID.test(String(value.sourceId))||!model(value.model)||!Array.isArray(value.candidates)||value.candidates.length>64)fail('Conjunto de piezas candidatas no válido.');
  const ids=new Set();
  for(const c of value.candidates){
   if(!exact(c,['candidateId','fdiCandidate','fdiProbability','geometry','visibility','alternatives'])||!candidateId(c.candidateId)||ids.has(c.candidateId)
    ||!fdi(c.fdiCandidate)||!prob(c.fdiProbability)||!geometry(c.geometry,false)||!VISIBILITIES.includes(c.visibility)||!Array.isArray(c.alternatives)||c.alternatives.length>3)fail('Pieza candidata no válida.');
   ids.add(c.candidateId);
   const alts=new Set([c.fdiCandidate]);
   for(const a of c.alternatives){
    if(!exact(a,['fdi','probability'])||!fdi(a.fdi)||alts.has(a.fdi)||!prob(a.probability))fail('Alternativa FDI no válida.');
    alts.add(a.fdi);
   }
  }
  return structuredClone(value);
 }
 function parseFindingSet(value){
  if(!exact(value,['schema','sourceId','model','candidates'])||value.schema!==1||!UUID.test(String(value.sourceId))||!model(value.model)||!Array.isArray(value.candidates)||value.candidates.length>48)fail('Conjunto de señales candidatas no válido.');
  const ids=new Set();
  for(const c of value.candidates){
   if(!exact(c,['candidateId','toothCandidate','category','label','confidence','evidenceLevel','regions','explanation','limitations'])||!candidateId(c.candidateId)||ids.has(c.candidateId)
    ||!(c.toothCandidate===null||fdi(c.toothCandidate))||!FINDING_CATEGORIES.includes(c.category)||!text(c.label,1,120)||!prob(c.confidence)
    ||!EVIDENCE_LEVELS.includes(c.evidenceLevel)||!Array.isArray(c.regions)||c.regions.length<1||c.regions.length>4||!text(c.explanation,1,300)
    ||!Array.isArray(c.limitations)||c.limitations.length>6)fail('Señal candidata no válida.');
   if(FORBIDDEN_CLAIM.test(c.label)||FORBIDDEN_CLAIM.test(c.explanation))fail('El modelo no puede presentar una señal como diagnóstico o certeza.');
   ids.add(c.candidateId);
   for(const r of c.regions)if(!geometry(r,false))fail('Región de señal no válida.');
   for(const l of c.limitations)if(!text(l,1,200))fail('Limitación de señal no válida.');
  }
  return structuredClone(value);
 }
 function parseReport(value,strict){
  if(!exact(value,['schema','sections','findings'])||value.schema!==1||!Array.isArray(value.findings)||value.findings.length>48)fail('Informe radiográfico no válido.');
  if(!exact(value.sections,REPORT_SECTIONS))fail('Secciones del informe no válidas.');
  for(const k of REPORT_SECTIONS)if(!text(value.sections[k],0,4000))fail('Sección del informe demasiado larga.');
  if(strict&&value.sections.description.trim().length<2)fail('Completa la descripción radiográfica antes de firmar.');
  const ids=new Set();
  for(const f of value.findings){
   if(!exact(f,['candidateId','tooth','text','priority'])||!UUID.test(String(f.candidateId))||ids.has(f.candidateId)||!(f.tooth===null||fdi(f.tooth))||!text(f.text,1,600)||!REPORT_PRIORITIES.includes(f.priority))fail('Hallazgo del informe no válido.');
   ids.add(f.candidateId);
  }
  return structuredClone(value);
 }
 function parseDecisionPayload(state,payload){
  if(!DECISION_STATES.includes(state)||state==='pending')fail('Estado de decisión no válido.');
  const p=payload==null?{}:payload;
  if(state!=='corrected'){if(!isObj(p)||Object.keys(p).length)fail('Sólo una corrección lleva datos.');return {};}
  if(!isObj(p)||!Object.keys(p).length||!Object.keys(p).every(k=>['fdi','label','geometry'].includes(k))
   ||(Object.hasOwn(p,'fdi')&&!(p.fdi===null||fdi(p.fdi)))||(Object.hasOwn(p,'label')&&!text(p.label,1,200))
   ||(Object.hasOwn(p,'geometry')&&!geometry(p.geometry,false)))fail('Corrección no válida.');
  return structuredClone(p);
 }
 const canTransition=(from,to)=>DECISION_STATES.includes(from)&&['confirmed','corrected','rejected'].includes(to);
 const wrap=fn=>value=>{try{return {ok:true,value:fn(value)};}catch(e){return {ok:false,error:e.message};}};
 return Object.freeze({
  CONTRACT_VERSION,STUDY_CLASSES,QUALITY_STATES,QC_FLAG_CODES,SEVERITIES,ANALYSES,VISIBILITIES,FINDING_CATEGORIES,EVIDENCE_LEVELS,DECISION_STATES,REPORT_PRIORITIES,REPORT_SECTIONS,
  isFdi:fdi,isGeometry:geometry,hasForbiddenClaim:v=>FORBIDDEN_CLAIM.test(String(v)),
  parseQc,parseToothSet,parseFindingSet,parseReport,parseDecisionPayload,canTransition,
  validateQc:wrap(parseQc),validateToothSet:wrap(parseToothSet),validateFindingSet:wrap(parseFindingSet),
  validateReportDraft:wrap(v=>parseReport(v,false)),validateReportForSignature:wrap(v=>parseReport(v,true))
 });
});
