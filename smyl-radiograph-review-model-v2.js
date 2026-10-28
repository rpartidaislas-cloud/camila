/* SMYL radiografía asistida — modelo v2 de revisión por pieza (Etapa 3). Sólo modelo, sin UI ni red.
   Toma los candidatos del motor (smyl_radiograph_candidates) y las decisiones profesionales
   (smyl_radiograph_decisions) y deriva, en tiempo de lectura, el mapa FDI verificable y la
   evidencia para el odontograma canónico (doc.teeth[fdi]). Igual que el flujo v1 (radiographNotes
   en smyl-dental-record.js): nunca escribe doc.teeth, nunca marca una pieza como ausente y sólo
   las decisiones confirmadas/corregidas producen evidencia. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./smyl-radiograph-contracts.js'):root.SmylRadiographContracts);if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylRadiographReviewModelV2=api;})(typeof self!=='undefined'?self:this,function(C){
 'use strict';
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const BANDS=[['alta',0.85],['media',0.6],['baja',0]];
 const band=p=>typeof p==='number'&&p>=0&&p<=1?BANDS.find(([,min])=>p>=min)[0]:'baja';
 const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const STATE_LABELS={pending:'Por confirmar',confirmed:'Confirmada',corrected:'Corregida',rejected:'Descartada'};
 const VISIBILITY_LABELS={complete:'Completa',partial:'Parcial',not_evaluable:'No evaluable'};
 // Fila mínima aceptada; cualquier cosa fuera de forma se ignora (no se interpreta a ciegas).
 function validCandidate(c){return isObj(c)&&UUID.test(String(c.id))&&['tooth','finding'].includes(c.kind)&&isObj(c.payload)&&typeof c.candidate_id==='string';}
 function validDecision(d){return isObj(d)&&UUID.test(String(d.candidate_id))&&C.DECISION_STATES.includes(d.state)&&Number.isInteger(d.revision)&&d.revision>0&&isObj(d.payload);}
 function engineOf(c,runs){const run=(runs||[]).find(r=>r&&r.id===c.run_id);return run&&isObj(run.engine)?{provider:String(run.engine.provider||''),name:String(run.engine.name||''),version:String(run.engine.version||'')}:null;}
 // Mapa FDI: una entrada por candidato de pieza con el valor efectivo tras la decisión profesional.
 function toothMap(input){
  const candidates=(input&&input.candidates||[]).filter(validCandidate).filter(c=>c.kind==='tooth');
  const decisions=new Map((input&&input.decisions||[]).filter(validDecision).map(d=>[d.candidate_id,d]));
  const entries=candidates.map(c=>{
   const p=c.payload,d=decisions.get(c.id)||{state:'pending',revision:1,payload:{},decided_by:null,decided_at:null};
   const corr=d.state==='corrected'?d.payload:{};
   const fdi=Object.hasOwn(corr,'fdi')?corr.fdi:p.fdiCandidate;
   return {
    candidateId:c.id,sourceId:c.source_id||null,runId:c.run_id||null,
    fdi,fdiModel:p.fdiCandidate,renumbered:fdi!==p.fdiCandidate,
    fdiProbability:p.fdiProbability,band:band(p.fdiProbability),
    visibility:corr.visibility||p.visibility,visibilityModel:p.visibility,
    geometry:corr.geometry||p.geometry,geometryModel:p.geometry,
    label:corr.label||'',alternatives:Array.isArray(p.alternatives)?p.alternatives:[],
    state:d.state,stateLabel:STATE_LABELS[d.state],visibilityLabel:VISIBILITY_LABELS[corr.visibility||p.visibility]||'',
    revision:d.revision,decidedBy:d.decided_by||null,decidedAt:d.decided_at||null,note:d.note||'',
    engine:engineOf(c,input&&input.runs),
    evaluable:(corr.visibility||p.visibility)!=='not_evaluable'
   };
  });
  // Conflictos: dos candidatos vivos (no descartados) apuntando a la misma pieza.
  const byFdi=new Map();
  for(const e of entries){if(e.state==='rejected'||e.fdi===null)continue;if(!byFdi.has(e.fdi))byFdi.set(e.fdi,[]);byFdi.get(e.fdi).push(e.candidateId);}
  const conflicts=[...byFdi.entries()].filter(([,ids])=>ids.length>1).map(([fdi,candidateIds])=>({fdi,candidateIds}));
  const pending=entries.filter(e=>e.state==='pending').length;
  return {entries,byFdi:Object.fromEntries(byFdi),conflicts,pending,total:entries.length,verified:entries.filter(e=>['confirmed','corrected'].includes(e.state)).length};
 }
 // Acciones profesionales → payload para smyl_radiograph_decide_candidate (state 'corrected').
 function renumberPayload(entry,fdi){
  if(!C.isFdi(fdi))throw new Error('Pieza FDI no válida.');
  if(fdi===entry.fdiModel&&!entry.renumbered)throw new Error('La pieza ya tiene esa numeración; confírmala en vez de corregirla.');
  return C.parseDecisionPayload('corrected',{fdi});
 }
 function notEvaluablePayload(entry,label){
  const payload={visibility:'not_evaluable'};if(label)payload.label=label;
  return C.parseDecisionPayload('corrected',payload);
 }
 function geometryPayload(entry,geometry){return C.parseDecisionPayload('corrected',{geometry});}
 // Dividir/unir piezas no tiene soporte profesional en este flujo: se rechaza explícitamente.
 function splitOrMerge(){throw new Error('Dividir o unir piezas no está soportado; descarta el candidato y renumera el correcto.');}
 // Evidencia para el odontograma canónico (lectura). Sólo confirmadas/corregidas. Nunca "ausente".
 function odontogramEvidence(input){
  const map=toothMap(input);
  const evidence=[];
  for(const e of map.entries){
   if(!['confirmed','corrected'].includes(e.state)||!e.fdi||!e.evaluable)continue;
   evidence.push({source:'radiograph_v2_tooth',tooth:e.fdi,candidateId:e.candidateId,state:e.state,
    text:`Pieza ${e.fdi} localizada en radiografía (${e.renumbered?'renumerada por el profesional, modelo proponía '+e.fdiModel:'numeración del modelo confirmada'}).`,
    engine:e.engine,decidedBy:e.decidedBy,decidedAt:e.decidedAt});
  }
  const decisions=new Map((input&&input.decisions||[]).filter(validDecision).map(d=>[d.candidate_id,d]));
  for(const c of (input&&input.candidates||[]).filter(validCandidate).filter(c=>c.kind==='finding')){
   const d=decisions.get(c.id);if(!d||!['confirmed','corrected'].includes(d.state))continue;
   const corr=d.state==='corrected'?d.payload:{};
   const tooth=Object.hasOwn(corr,'fdi')?corr.fdi:c.payload.toothCandidate;
   const apparentlyMissing=c.payload.category==='apparently_missing';
   evidence.push({source:'radiograph_v2_finding',tooth:tooth||'',candidateId:c.id,state:d.state,category:c.payload.category,
    text:apparentlyMissing?`Pieza ${tooth||'sin asignar'} aparentemente no visible en la radiografía. No implica ausencia: confirmar clínicamente antes de registrarla.`:String(corr.label||c.payload.label||''),
    neverAutoAbsent:apparentlyMissing,engine:engineOf(c,input&&input.runs),decidedBy:d.decided_by||null,decidedAt:d.decided_at||null});
  }
  return {evidence,pending:map.pending,conflicts:map.conflicts};
 }
 return Object.freeze({band,toothMap,renumberPayload,notEvaluablePayload,geometryPayload,splitOrMerge,odontogramEvidence,STATE_LABELS,VISIBILITY_LABELS});
});
