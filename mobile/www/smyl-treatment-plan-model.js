/* Strict contracts for a clinician-reviewed treatment-plan draft. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylTreatmentPlanModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const sources=['patient_goal','clinical_history','clinician_assessment','manual_map','photo_confirmed','radiograph_confirmed'];
 const phases=['evaluate','prevent','stabilize','treat','maintain'];
 const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
 const text=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min;
 function validateInput(value){
  if(!exact(value,['schema','evidence','limitations'])||value.schema!==1||!Array.isArray(value.evidence)||!value.evidence.length||value.evidence.length>64||!Array.isArray(value.limitations)||value.limitations.length>20)return false;
  const ids=new Set();
  for(const item of value.evidence){
   if(!exact(item,['id','source','tooth','text'])||!/^E([1-9]|[1-5][0-9]|6[0-4])$/.test(item.id)||ids.has(item.id)||!sources.includes(item.source)||!(item.tooth===''||/^[1-4][1-8]$/.test(item.tooth))||!text(item.text,1200,1))return false;
   ids.add(item.id);
  }
  return value.limitations.every(v=>text(v,400,1));
 }
 function parse(value,input){
  if(!validateInput(input)||!exact(value,['schema','summary','goals','treatments','questions','limitations'])||value.schema!==1||!text(value.summary,4000,1)||!Array.isArray(value.goals)||value.goals.length>8||!Array.isArray(value.treatments)||value.treatments.length>8||!Array.isArray(value.questions)||value.questions.length>8||!Array.isArray(value.limitations)||value.limitations.length>8)throw Error('El borrador no cumple el contrato clínico.');
  const evidence=new Set(input.evidence.map(v=>v.id)),ids=new Set();
  if(!value.goals.every(v=>text(v,500,1))||!value.questions.every(v=>text(v,500,1))||!value.limitations.every(v=>text(v,500,1)))throw Error('El borrador contiene texto no válido.');
  for(const item of value.treatments){
   if(!exact(item,['id','name','area','phase','rationale','prerequisites','basis'])||!/^T[1-8]$/.test(item.id)||ids.has(item.id)||!text(item.name,200,1)||!text(item.area,200)||!phases.includes(item.phase)||!text(item.rationale,1200,1)||!Array.isArray(item.prerequisites)||item.prerequisites.length>6||!item.prerequisites.every(v=>text(v,300,1))||!Array.isArray(item.basis)||!item.basis.length||item.basis.length>12||new Set(item.basis).size!==item.basis.length||item.basis.some(id=>!evidence.has(id)))throw Error('Una sugerencia no puede vincularse con la evidencia confirmada.');
   ids.add(item.id);
  }
  return structuredClone(value);
 }
 function toPlanTreatment(item){
  const phase={evaluate:'Evaluación',prevent:'Prevención',stabilize:'Estabilización',treat:'Tratamiento',maintain:'Mantenimiento'}[item.phase];
  const notes=[phase+'. '+item.rationale,item.prerequisites.length?'Antes de avanzar: '+item.prerequisites.join('; '):''].filter(Boolean).join('\n');
  return {name:item.name,area:item.area,notes:notes.slice(0,2000)};
 }
 return {sources,phases,validateInput,parse,toPlanTreatment};
});
