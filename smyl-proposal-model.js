(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./smyl-clinical-model.js'));else root.SmylProposalModel=factory(root.SmylClinicalModel);})(typeof globalThis!=='undefined'?globalThis:this,function(Clinical){
  'use strict';
  var views={frontal:'Frontal sonriendo',left:'Perfil izquierdo',right:'Perfil derecho',tresCuartos:'Vista 3/4',extraoral:'Detalle de sonrisa',intraoral:'Frontal intraoral',intraoralLeft:'Lateral intraoral izquierda',intraoralRight:'Lateral intraoral derecha'};
  function cents(value){var s=String(value==null?'':value).trim();if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(s))return null;var parts=s.split('.');return Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));}
  function money(value){return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(value/100);}
  function total(doc){return doc.items.reduce(function(sum,item){return sum+(Number.isSafeInteger(item.unit_cents)&&Number.isInteger(item.quantity)?item.unit_cents*item.quantity:0);},0);}
  // En documentos schema 2 `treatment_id` es el id de la LINEA del plan, no el
  // capítulo clínico. Internamente lo nombramos planItemId para evitar mezclarlo
  // con smyl_proposals.treatment_id. Se conserva la clave histórica al serializar
  // porque las versiones ya emitidas son inmutables.
  function planItemId(item){item=item||{};return item.plan_item_id||item.treatment_id||null;}
  var PHASES=[['evaluate','Evaluación'],['prevent','Prevención'],['stabilize','Estabilización'],['treat','Tratamiento'],['maintain','Mantenimiento']];
  function phaseKey(v){return PHASES.some(function(x){return x[0]===v;})?v:'treat';}
  function phaseLabel(v){var f=PHASES.filter(function(x){return x[0]===phaseKey(v);})[0];return f?f[1]:'Tratamiento';}
  function metadata(item,index){item=item||{};return {phase:phaseKey(item.phase),id:String(item.id||'quote-'+(index+1)),treatment_id:planItemId(item),service_id:item.service_id||null,service_revision:item.service_revision||null,service_snapshot:item.service_snapshot||null,teeth:Array.isArray(item.teeth)?item.teeth:[],surfaces:Array.isArray(item.surfaces)?item.surfaces:[]};}
  function normalize(doc){doc=doc||{};return {schema:2,title:String(doc.title||''),introduction:String(doc.introduction||''),terms:String(doc.terms||''),valid_until:String(doc.valid_until||''),items:(Array.isArray(doc.items)?doc.items:[]).map(function(item,index){return Object.assign(metadata(item,index),{label:String(item.label||''),area:String(item.area||''),quantity:Number(item.quantity||1),unit_cents:item.unit_cents==null?null:Number(item.unit_cents),currency:'MXN'});}),photos:doc.photos||null};}
  function valid(value,approve){var doc=normalize(value),ids=new Set();if(!doc.title.trim()||doc.title.length>150)return 'Escribe un título para la propuesta.';if(doc.introduction.length>3000||doc.terms.length>3000)return 'Acorta el texto de la propuesta a 3,000 caracteres por campo.';if(!doc.items.length||doc.items.length>20)return 'Añade entre 1 y 20 conceptos a la cotización.';for(var item of doc.items){if(ids.has(item.id))return 'Cada concepto necesita un identificador distinto.';ids.add(item.id);if(!item.label.trim()||item.label.length>200||item.area.length>200)return 'Revisa el nombre y la zona de cada concepto.';if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100)return 'La cantidad debe ser un número entero entre 1 y 100.';if(item.unit_cents!==null&&(!Number.isSafeInteger(item.unit_cents)||item.unit_cents<0||item.unit_cents>999999999))return 'Revisa el precio: usa números positivos con hasta dos decimales.';if(approve&&item.unit_cents===null)return 'Completa todos los precios. Escribe 0 cuando un concepto no tenga costo.';if(item.surfaces.length&&!item.teeth.length)return 'Revisa las superficies del mapa dental.';}if(doc.valid_until){var d=new Date(doc.valid_until+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(doc.valid_until)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==doc.valid_until)return 'Revisa la fecha de vigencia.';}var today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Mexico_City'});if(approve&&(!doc.valid_until||doc.valid_until<today))return 'Indica una fecha de vigencia que no haya pasado.';if(approve&&!doc.terms.trim())return 'Aclara qué incluye el importe y las condiciones antes de aprobar.';return '';}
  function fromPlan(plan){var clinical=Clinical.normalize(plan.document);
  // Solo lo que tiene servicio del catálogo pasa al presupuesto; una indicación sin servicio es una indicación sin cobro.
  var billable=clinical.treatments.filter(function(t){return !!t.service_id;});
  return {schema:2,title:'Tu propuesta de tratamiento',introduction:'',terms:'',valid_until:'',items:billable.map(function(t,index){var s=t.service_snapshot,price=s&&s.reference_price!=null?Math.round(s.reference_price*100):null;return Object.assign(metadata({id:'quote-'+t.id,plan_item_id:t.id,service_id:t.service_id,service_revision:t.service_revision,service_snapshot:s,teeth:t.teeth,surfaces:t.surfaces},index),{label:(s&&s.patient_name)||t.name,area:Clinical.areaLabel(t),quantity:Clinical.quantity(t),unit_cents:price,currency:'MXN'});}).map(function(it,i){it.phase=phaseKey(billable[i].phase);return it;}),photos:null};}
  function groups(doc){doc=normalize(doc);var by=new Map();doc.items.forEach(function(item){var k=phaseKey(item.phase);if(!by.has(k))by.set(k,[]);by.get(k).push(item);});var out=[];PHASES.forEach(function(ph){if(by.has(ph[0])){var items=by.get(ph[0]);out.push({key:ph[0],label:ph[1],items:items,subtotalCents:items.reduce(function(s,i){return s+(Number.isSafeInteger(i.unit_cents)&&Number.isInteger(i.quantity)?i.unit_cents*i.quantity:0);},0),pending:items.some(function(i){return i.unit_cents===null;})});}});return out;}
  function lineCents(item){return Number.isSafeInteger(item&&item.unit_cents)&&Number.isInteger(item.quantity)?item.unit_cents*item.quantity:0;}
  function decisionSummary(doc,decision,decisionItems,legacyEvent){
    doc=normalize(doc);var states=new Map();
    (decisionItems||[]).forEach(function(row){if(row&&row.proposal_item_id)states.set(String(row.proposal_item_id),row.item_status==='rejected'?'declined':row.item_status);});
    var legacy=legacyEvent&&legacyEvent.event_type;
    if(!states.size&&legacy==='accepted')doc.items.forEach(function(item){states.set(item.id,'accepted');});
    if(!states.size&&legacy==='declined')doc.items.forEach(function(item){states.set(item.id,'declined');});
    var result={totalCents:total(doc),acceptedCents:0,pendingCents:0,rejectedCents:0,acceptedCount:0,pendingCount:0,rejectedCount:0,hasDecision:!!decision||legacy==='accepted'||legacy==='declined'||legacy==='changes_requested',canActivate:false,state:'pending',label:'Pendiente de decisión'};
    doc.items.forEach(function(item){var status=states.get(item.id)||'pending',amount=lineCents(item);if(status==='accepted'){result.acceptedCount++;result.acceptedCents+=amount;}else if(status==='declined'){result.rejectedCount++;result.rejectedCents+=amount;}else{result.pendingCount++;result.pendingCents+=amount;}});
    result.canActivate=result.acceptedCount>0;
    if(legacy==='changes_requested'){result.state='changes_requested';result.label='Requiere cambios';}
    else if(result.acceptedCount===doc.items.length&&doc.items.length){result.state='accepted';result.label='Aceptada';}
    else if(result.acceptedCount){result.state='partial';result.label='Aceptada parcialmente';}
    else if(result.rejectedCount===doc.items.length&&doc.items.length){result.state='declined';result.label='No aceptada';}
    else if(!decision&&!legacy){result.state='unpresented';result.label='Sin decisión';}
    return result;
  }
  // Estado único de una cotización para la lista, el contador del menú y las pruebas.
  // input: {row, event (último evento de la versión), share ({accepted,interested}), plan ({revision,status}|null), batch ({created_at}|null), today 'YYYY-MM-DD'}
  function dmy(iso){return String(iso||'').slice(0,10).split('-').reverse().join('/');}
  function day(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString('es-MX',{timeZone:'America/Mexico_City'});}
  function stage(input){
    input=input||{};var row=input.row||{},event=input.event||null,share=input.share||null,plan=input.plan||null,type=event&&event.event_type,decision=input.decision||null;
    var valid=row.document&&row.document.valid_until,today=input.today||new Date().toLocaleDateString('en-CA',{timeZone:'America/Mexico_City'});
    if(row.status==='approved'&&decision&&decision.acceptedCount>0&&input.batch)return {key:'converted',label:'En tratamiento',detail:'Los conceptos aceptados se enviaron a Finanzas el '+day(input.batch.created_at)+'.',priority:9,action:false};
    if(row.status==='approved'&&decision&&decision.state==='partial')return {key:'partial',label:'Aceptada parcialmente',detail:decision.acceptedCount+' aceptado(s) · '+decision.pendingCount+' pendiente(s) · '+decision.rejectedCount+' no aceptado(s).',priority:4,action:true};
    if(row.status==='approved'&&decision&&decision.state==='accepted')return {key:'accepted',label:'Aceptada',detail:'Todos los conceptos fueron aceptados.',priority:5,action:input.financeVisible!==false};
    if(row.status==='approved'&&decision&&decision.state==='declined')return {key:'declined',label:'No aceptada',detail:'La decisión quedó registrada por concepto.',priority:8,action:false};
    if(row.status==='approved'&&type==='accepted'&&input.batch)return {key:'converted',label:'En tratamiento',detail:'Cargos creados en Finanzas el '+day(input.batch.created_at)+'.',priority:9,action:false};
    if(row.status==='approved'&&type==='accepted'){var finance=input.financeVisible!==false;return {key:'accepted',label:'Aceptada',detail:'Decisión registrada '+day(event.occurred_at)+'.'+(finance?' Falta iniciar el tratamiento: cargos, anticipo y primera cita.':''),priority:finance?5:8,action:finance};}
    if(row.status==='approved'&&type==='declined')return {key:'declined',label:'No aceptada',detail:'Decisión registrada; conserva el motivo en el historial.',priority:8,action:false};
    if(plan&&(plan.status!=='reviewed'||plan.revision!==row.plan_revision))return {key:'stale',label:'Plan actualizado',detail:'El plan clínico cambió después de cotizar. Ábrela y usa el plan revisado actual.',priority:1,action:true};
    if(row.status!=='approved')return {key:'draft',label:'Completar borrador',detail:'Falta revisar y aprobar esta versión.',priority:3,action:true};
    if(type==='changes_requested')return {key:'changes_requested',label:'Preparar cambios',detail:'El paciente solicitó cambios en esta versión.',priority:0,action:true};
    if(share&&share.accepted)return {key:'link_accepted',label:'Aceptó en el enlace',detail:'Aceptó el '+day(share.accepted)+'. Confírmalo con el paciente y registra la aceptación.',priority:0,action:true};
    if(share&&share.interested)return {key:'interested',label:'Quiere agendar',detail:'Lo pidió desde el enlace el '+day(share.interested)+'. Contáctalo para agendar.',priority:0,action:true};
    if(valid&&valid<today)return {key:'expired',label:'Vigencia vencida',detail:'Venció el '+dmy(valid)+'. Revisa antes de presentarla.',priority:1,action:true};
    if(type==='presented')return {key:'awaiting',label:'Esperando decisión',detail:'Presentada el '+day(event.occurred_at)+'.',priority:4,action:true};
    return {key:'ready',label:'Lista para presentar',detail:valid?'Vigente hasta '+dmy(valid)+'.':'Registra cómo y cuándo se presenta.',priority:2,action:true};
  }
  function safeImage(src){return typeof src==='string'&&(/^(blob:|data:image\/(png|jpeg|webp);base64,)/.test(src)||/^https:\/\//.test(src));}
  return {views:views,cents:cents,money:money,total:total,lineCents:lineCents,valid:valid,fromPlan:fromPlan,safeImage:safeImage,normalize:normalize,metadata:metadata,planItemId:planItemId,decisionSummary:decisionSummary,stage:stage,phases:PHASES,phaseKey:phaseKey,phaseLabel:phaseLabel,groups:groups};
});
