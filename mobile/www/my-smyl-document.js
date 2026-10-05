/* Shared patient renderer. Only explicitly projected presentation fields.
 * No source clinical document, settings, identity, private notes or asset paths.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MySmylDocument=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const text=(s,n,required=false)=>{if(typeof s!=='string'||s.length>n||(required&&!s.trim()))throw Error('Invalid presentation');return s.trim();};
 function project(raw){
  if(!raw||raw.schema!==1||!raw.clinic||!Array.isArray(raw.steps)||raw.steps.length<1||raw.steps.length>20||!Array.isArray(raw.observations)||raw.observations.length>64)throw Error('Invalid presentation');
  const doc={schema:1,title:text(raw.title,150,true),summary:text(raw.summary,5000,true),clinic:{name:text(raw.clinic.name,150,true),professional:text(raw.clinic.professional,150)},steps:raw.steps.map(s=>({title:text(s.title,200,true),text:text(s.text,1000)})),observations:raw.observations.map(o=>{if(!/^[1-4][1-8]$/.test(o.tooth))throw Error('Invalid tooth');return {tooth:o.tooth,text:text(o.text,600,true)};})};
  if(raw.budget){const b=raw.budget;if(b.currency!=='MXN'||!Array.isArray(b.items)||b.items.length<1||b.items.length>20||!/^\d{4}-\d{2}-\d{2}$/.test(b.valid_until))throw Error('Invalid budget');
   const items=b.items.map(i=>{if(!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>100||!Number.isSafeInteger(i.unit_cents)||i.unit_cents<0)throw Error('Invalid amount');return {label:text(i.label,200,true),area:text(i.area,200),quantity:i.quantity,unit_cents:i.unit_cents};});
   const total=items.reduce((a,i)=>a+i.quantity*i.unit_cents,0);if(!Number.isSafeInteger(total)||total!==b.total_cents)throw Error('Invalid total');
   doc.budget={currency:'MXN',items,total_cents:total,terms:text(b.terms,3000,true),valid_until:b.valid_until};
  }return doc;
 }
 function preview(source,selection){
  const doc={schema:1,title:selection.title,summary:selection.summary,clinic:source.clinic,steps:selection.steps,observations:selection.observations.map(o=>({tooth:o.tooth,text:o.text}))};
  if(selection.include_budget===true){const b=source.proposals.find(q=>q.id===selection.proposal_id&&q.revision===selection.proposal_revision);if(!b)throw Error('Selecciona un presupuesto aprobado.');doc.budget={...b,currency:'MXN'};}return project(doc);
 }
 function mount(host,{document:raw,views,patient=false,onRequest=null,meta={}}){
  const doc=project(raw),n=(tag,cls,value)=>{const e=window.document.createElement(tag);e.className=cls||'';if(value!=null)e.textContent=value;return e;},b=(value,fn,cls='mp-secondary')=>{const e=n('button',cls,value);e.type='button';e.onclick=fn;return e;};
  const base=window.MySmyl.mount(host,{views}),app=host.querySelector('.ms-app');app.classList.add('mp-presentation');
  const panels=[...app.querySelectorAll('.ms-panel')],tabs=[...app.querySelectorAll('.ms-tab')];let disposed=false;
  const go=i=>{tabs[i].click();tabs[i].focus();app.querySelector('.ms-nav').scrollIntoView({block:'start'});};
  app.querySelector('.ms-notice').textContent=patient?'Propuesta revisada por tu dentista · acceso temporal':'Vista previa del dentista · todavía no se ha compartido esta selección';
  const header=app.querySelector('.ms-header');header.lastElementChild.replaceWith(n('p','',doc.clinic.name+(doc.clinic.professional?' · '+doc.clinic.professional:'')));
  const intro=app.querySelector('.ms-intro');intro.querySelector('h1').textContent=doc.title;intro.lastElementChild.textContent='Explora tu sonrisa, entiende tu revisión y conoce tu plan. La decisión es tuya.';
  const aside=app.querySelector('.ms-aside');aside.replaceChildren(n('p','ms-kicker','HECHO PARA CONVERSAR'),n('h2','','Tu sonrisa, a tu manera.'),n('p','','Esta imagen es una propuesta visual. Tu dentista te explicará sus posibilidades y límites.'),b('Conocer mi revisión →',()=>go(1),'ms-primary'),n('p','mp-fine','No es un tratamiento realizado ni una garantía de resultado.'));
  const next=n('div','mp-continuation');next.append(b('Conocer mi revisión →',()=>go(1)));panels[0].append(next);
  panels[1].replaceChildren();const heading=n('div','mp-section-heading');heading.append(n('p','ms-kicker','REVISADO POR TU DENTISTA'),n('h2','','Tu revisión, con claridad.'),n('p','portal-summary',doc.summary));panels[1].append(heading);
  if(doc.observations.length){const grid=n('div','mp-review-grid'),mapCard=n('section','mp-map-card'),notes=n('section','mp-observations'),map=n('div','mp-map');map.setAttribute('role','img');mapCard.append(n('h3','','Tu mapa dental'),n('p','mp-map-hint','Elige una observación para ubicarla.'),map,n('p','mp-fine','Sin marca significa sin observación compartida, no necesariamente sano.'));
   const controls=[];const select=index=>{const active=doc.observations[index];controls.forEach((c,i)=>c.setAttribute('aria-pressed',String(i===index)));map.setAttribute('aria-label','Observación seleccionada en el diente '+active.tooth+'. '+active.text);window.SmylToothMap.render(map,{disabled:true,state:id=>({className:id===active.tooth?'mp-marked':doc.observations.some(o=>o.tooth===id)?'mp-other-marked':'',label:'Observaciones compartidas'})});map.querySelectorAll('button,.dr-arch-label').forEach(e=>e.setAttribute('aria-hidden','true'));};
   doc.observations.forEach((o,i)=>{const control=b('',()=>{select(i);if(innerWidth<650)mapCard.scrollIntoView({block:'start'});},'mp-observation');control.append(n('strong','','Diente '+o.tooth),n('span','mp-observation-copy',o.text));controls.push(control);notes.append(control);});select(0);grid.append(mapCard,notes);panels[1].append(grid);
  }else panels[1].append(n('p','mp-fine','No se han incluido observaciones por diente en esta versión.'));
  const more=n('div','mp-continuation');more.append(b('Conocer mi plan →',()=>go(2)));panels[1].append(more);
  panels[2].replaceChildren();const ph=n('div','mp-section-heading');ph.append(n('p','ms-kicker','UN PASO A LA VEZ'),n('h2','','Un plan a tu ritmo.'),n('p','','Puedes preguntar por otras opciones o tomarte tiempo antes de decidir.'));panels[2].append(ph);
  const timeline=n('ol','mp-timeline');doc.steps.forEach((s,i)=>{const li=n('li'),body=n('div','mp-step-body');body.append(n('h3','',s.title),n('p','',s.text));li.append(n('span','mp-step-number',String(i+1).padStart(2,'0')),body);timeline.append(li);});panels[2].append(timeline);
  if(doc.budget){const budget=n('section','mp-patient-budget');budget.append(n('p','ms-kicker','INCLUIDO POR TU DENTISTA'),n('h3','','Tu presupuesto'));
   const table=n('table','mp-budget-table');table.append(n('caption','','Importes en MXN · vigente hasta '+doc.budget.valid_until));const body=n('tbody'),money=c=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(c/100);
   for(const i of doc.budget.items){const tr=n('tr');tr.append(n('th','',i.quantity+' × '+i.label+(i.area?' · '+i.area:'')),n('td','',money(i.quantity*i.unit_cents)));body.append(tr);}const total=n('tr');total.append(n('th','','Total'),n('td','',money(doc.budget.total_cents)));body.append(total);table.append(body);budget.append(table,n('p','portal-summary',doc.budget.terms));panels[2].append(budget);
  }
  const request=n('section','mp-questions');request.append(n('h3','','El siguiente paso lo decides tú.'),n('p','',patient?'Puedes enviar una pregunta o pedir que la clínica te contacte para coordinar una cita. No es un canal de urgencias.':'El paciente podrá enviar preguntas o solicitar que la clínica lo contacte. Esta vista previa no envía nada.'));
  if(patient&&onRequest){const form=n('form'),kind=n('select'),message=n('textarea'),status=n('p');status.setAttribute('role','status');kind.setAttribute('aria-label','Qué quieres enviar');kind.append(new Option('Tengo una pregunta','question'),new Option('Me gustaría una cita','appointment'));message.setAttribute('aria-label','Mensaje para la clínica');message.maxLength=1000;message.required=true;message.rows=4;message.placeholder='Escribe tu pregunta o cuándo te gustaría que te contactaran…';const submit=b('Enviar a mi clínica',null,'ms-primary');submit.type='submit';let attempt=null,busy=false;
   form.onsubmit=async e=>{e.preventDefault();if(busy||disposed||!message.value.trim())return;if(!attempt)attempt={id:crypto.randomUUID(),kind:kind.value,message:message.value.trim()};busy=true;submit.disabled=kind.disabled=message.disabled=true;status.textContent='Enviando…';
    try{const answer=await onRequest(attempt);if(disposed)return;if(answer?.received!==true)throw Error('No receipt');status.textContent=attempt.kind==='appointment'?'Solicitud recibida. La clínica debe contactarte para confirmar fecha y horario; todavía no tienes una cita reservada.':'Pregunta recibida. La clínica podrá contactarte usando los datos de tu expediente.';attempt=null;message.value='';submit.textContent='Enviar otro mensaje';kind.disabled=message.disabled=false;}
    catch(error){if(!disposed){status.textContent=error?.status===429?'Llegaste al límite de mensajes de este acceso. Intenta más tarde o contacta directamente a tu clínica.':'No pudimos confirmar la recepción. Puedes reintentar este mismo mensaje sin duplicarlo. Si el acceso venció, abre nuevamente el enlace.';submit.textContent='Reintentar envío';}}
    finally{busy=false;if(!disposed)submit.disabled=false;}
   };form.append(kind,message,submit,status);request.append(form);
  }panels[2].append(request,b('Volver a mi sonrisa',()=>go(0)));
  app.querySelector('.ms-footer').replaceChildren(n('span','','mySmyl · Tu sonrisa, paso a paso.'),n('span','',patient?'Versión '+meta.version+' · aprobada '+new Date(meta.approved_at).toLocaleDateString('es-MX'):'Vista previa. Revisa el contenido antes de aprobar.'));
  return {destroy(){disposed=true;base.destroy();}};
 }
 return {project,preview,mount};
});
