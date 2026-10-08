/* Case workspace, stage 1: organize existing editors, not a new source of truth.
 * No network, storage, AI or implicit approval. Keep editor nodes and safeguards. */
(function () {
 'use strict';
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const btn=(text,fn,primary=false)=>{const e=n('button',primary?'pc-primary':'pc-secondary',text);e.type='button';e.onclick=fn;return e;};
 const copy=(e,value)=>{if(e.textContent!==value)e.textContent=value;};
 let active=null;
 const valid=ctx=>ctx&&!ctx.revoked&&ctx.root.isConnected&&window.tenantId===ctx.tenant&&window.pacienteActual?.id===ctx.patient&&window.miRolEquipo==='dueño'&&document.getElementById('p-paciente-detalle')?.classList.contains('activa');
 function open(id,focus=true){
  const ctx=active;if(!valid(ctx)||!ctx.modules[id])return false;
  // One working section, without unmounting editors or losing drafts.
  const section=ctx.modules[id];section.details.open=true;
  for(const [key,m] of Object.entries(ctx.modules))if(key!==id)m.details.open=false;
  if(focus){section.summary.focus({preventScroll:true});section.details.scrollIntoView({block:'start',behavior:'instant'});}
  return true;
 }
 function module(ctx,id,index,title,subtitle){
  const details=n('details','cw-module'),summary=n('summary','cw-summary'),text=n('span','cw-module-title');details.dataset.module=id;
  const badge=n('span','cw-badge','Por completar'),sub=n('span','cw-subtitle',subtitle);
  text.append(n('strong','',title),sub);summary.append(n('span','cw-number',index),text,badge,n('span','cw-chevron','⌄'));
  const body=n('div','cw-body');details.append(summary,body);ctx.root.append(details);
  const value={details,summary,body,badge,sub};ctx.modules[id]=value;
  details.addEventListener('toggle',()=>{if(!valid(ctx)||!details.open)return;for(const [key,m] of Object.entries(ctx.modules))if(key!==id)m.details.open=false;syncNav(ctx);});
  return value;
 }
 function syncNav(ctx){for(const [id,b] of Object.entries(ctx.nav||{})){if(ctx.modules[id].details.open)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');}}
 function state(ctx,id,label,tone='pending'){const m=ctx.modules[id];copy(m.badge,label);m.badge.dataset.state=tone;m.details.dataset.state=tone;if(ctx.nav?.[id])ctx.nav[id].dataset.state=tone;}
 function mount(){
  const screen=document.getElementById('p-paciente-detalle'),layout=screen?.querySelector('.clinic-layout');
  if(!layout||window.pacienteActual?._local||window.miRolEquipo!=='dueño')return;
  if(active?.root.isConnected&&active.patient===window.pacienteActual?.id&&active.tenant===window.tenantId){if(!active.revoked)adopt(active);return;}
  const root=n('section','cw-workspace'),ctx={root,layout,patient:window.pacienteActual.id,tenant:window.tenantId,modules:{},selected:null,entries:null,receipts:new Map()};active=ctx;
  root.setAttribute('aria-label','Preparar el caso del paciente');layout.classList.add('cw-layout');
  const header=n('header','cw-heading'),heading=n('div');heading.append(n('p','cw-kicker','UN SOLO RECORRIDO'),n('h2','','Prepara el caso en cuatro pasos.'),n('p','','SMYL organiza el trabajo. Tú revisas y decides qué compartir.'));
  header.append(heading);root.append(header);
  ctx.overview=n('p','cw-overview');ctx.overview.setAttribute('role','status');root.append(ctx.overview);
  const nav=n('nav','cw-nav');nav.setAttribute('aria-label','Avance del caso');ctx.nav={};root.append(nav);
  const photos=module(ctx,'photos','01','Evidencias','Selecciona las fotografías y simulaciones de este caso.');photos.details.open=true;
  const review=module(ctx,'review','02','Revisión clínica','Comprueba las sugerencias y organiza el mapa dental.');
  const plan=module(ctx,'plan','03','Plan de tratamiento','La IA propone un borrador; tú corriges y apruebas.');
  const share=module(ctx,'share','04','Compartir con el paciente','Prepara mySmyl y decide si incluir el presupuesto.');
  for(const [id,label] of [['photos','Evidencias'],['review','Revisión clínica'],['plan','Plan'],['share','Compartir']]){const b=btn(label,()=>open(id));ctx.nav[id]=b;nav.append(b);}syncNav(ctx);
  const identity=screen.querySelector('.clinic-patient-card');
  if(identity){const contact=n('details','cw-contact');contact.append(n('summary','','Datos del paciente · consultar'),identity);photos.body.append(contact);}
  const clinical=screen.querySelector('.clinic-workspace');if(clinical)plan.body.append(clinical);
  ctx.photoHint=n('p','cw-help');photos.body.append(ctx.photoHint);
  ctx.photosNext=btn('Continuar a revisión clínica',()=>open('review'),true);const photosFoot=n('div','cw-module-footer');photosFoot.append(ctx.photosNext);photos.body.append(photosFoot);
  const reviewTop=n('div','cw-action-row');ctx.reviewText=n('p','cw-help');ctx.reviewButton=btn('Analizar fotografías',()=>{if(valid(ctx)&&ctx.reviewAction)ctx.reviewAction();},true);
  reviewTop.append(ctx.reviewText,ctx.reviewButton);review.body.append(reviewTop);
  review.body.append(n('p','cw-help','Aquí se reúnen fotografías, mapa dental y radiografías. Las simulaciones nunca se utilizan como evidencia clínica.'));
  const planProgress=n('ul','cw-checklist');ctx.planChecks={};
  for(const [id,label] of [['assessment','Preparar o escribir la valoración'],['treatments','Elegir tratamientos o indicaciones'],['approved','Revisar y guardar el plan']]){const item=n('li','',label);item.dataset.label=label;planProgress.append(item);ctx.planChecks[id]=item;}
  plan.body.prepend(planProgress);
  ctx.shareHint=n('p','cw-help');share.body.append(ctx.shareHint);
  share.body.append(n('p','cw-share-copy','El paciente verá su antes y después, tu explicación y los siguientes pasos. El presupuesto no se incluye salvo que tú lo actives.'));
  ctx.planNext=btn('Continuar a compartir',()=>open('share'),true);const planFoot=n('div','cw-module-footer');planFoot.append(ctx.planNext);plan.body.append(planFoot);
  ctx.shareButton=btn('Preparar y compartir',()=>{if(ctx.selected?.current())ctx.selected.present();},true);
  ctx.fixPlan=btn('Completar el plan',()=>{open('plan');document.getElementById('clinic-assessment')?.focus({preventScroll:true});});
  const actions=n('div','cw-action-row');actions.append(ctx.shareButton,ctx.fixPlan);share.body.append(actions,n('p','cw-help','Crear el enlace no lo envía. Al terminar, tendrás el enlace y un código para compartir con el paciente.'));
  ctx.history=btn('Consultar enlaces y solicitudes',()=>{if(valid(ctx)&&ctx.selected?.current())ctx.selected.present();});
  const past=n('details','cw-contact');past.append(n('summary','','Presentaciones anteriores'),n('p','cw-help','Consulta su vigencia o revoca un acceso desde «Enlaces anteriores y mensajes del paciente». Abrirlo no crea ni envía una propuesta.'),ctx.history);share.body.append(past);
  layout.append(root);adopt(ctx);refresh();
 }
 function adopt(ctx){
  const screen=document.getElementById('p-paciente-detalle'),gallery=screen.querySelector('.pc-gallery'),dental=screen.querySelector('.dr-record');
  if(gallery&&!ctx.modules.photos.body.contains(gallery))ctx.modules.photos.body.insertBefore(gallery,ctx.photoHint);
  if(dental&&!ctx.modules.review.body.contains(dental))ctx.modules.review.body.insertBefore(dental,ctx.modules.review.body.lastElementChild);
 }
 function select(ctx,entry){
  ctx.selected=entry;
  for(const item of ctx.entries||[]){item.card.classList.toggle('cw-selected',item===entry);const radio=item.card.querySelector('.cw-case-choice input');if(radio)radio.checked=item===entry;}
  dispatchEvent(new CustomEvent('smyl:case-selection',{detail:{tenant:ctx.tenant,patient:ctx.patient,caseId:entry?.row.id||''}}));
  refresh();
 }
 function refresh(){
  const ctx=active;if(!valid(ctx))return;
  const gallery=ctx.root.querySelector('.pc-gallery');
  if(gallery?.smylCaseEntries!==ctx.entries){
   ctx.entries=gallery?.smylCaseEntries||[];ctx.selected=null;
  }
  ctx.entries.forEach((entry,index)=>{
   if(entry.card.querySelector('.cw-case-choice'))return;
   const label=n('label','cw-case-choice'),radio=n('input');radio.type='radio';radio.name='cw-case';radio.value=entry.row.id;
   const when=Date.parse(entry.row.created_at),date=Number.isFinite(when)?new Date(when).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}):'Sesión '+(index+1);
   label.append(radio,n('span','',date+(index===0?' · más reciente':'')));entry.card.prepend(label);radio.onchange=()=>{if(valid(ctx)&&entry.current())select(ctx,entry);};
  });
  if(!ctx.selected&&ctx.entries.length){select(ctx,ctx.entries[0]);return;}
  const entry=ctx.selected,views=entry?.row.document.views||[],count=views.length,pairs=views.filter(v=>v.result).length;
  const load=gallery?.dataset.loadState;
  state(ctx,'photos',count?count+(count===1?' foto':' fotos'):load==='ready'?'Sin fotos':load==='error'||load==='unavailable'?'No disponible':'Cargando',count?'done':'pending');
  copy(ctx.photoHint,count?'Sesión seleccionada: '+count+' originales · '+pairs+' simulaciones. Las intraorales son opcionales.':'Puedes empezar con una sola foto. Las otras vistas y las intraorales son opcionales.');
  ctx.photosNext.disabled=!entry||!count;
  const clinical=window.SmylClinicalWorkflow?.status(ctx.tenant,ctx.patient),dental=window.SmylDentalProgress?.status(ctx.tenant,ctx.patient,entry?.row.id);
  const photoPending=(dental?.pending||0)+(dental?.workflowPending||0),rxPending=dental?.rxPending||0;
  const reviewComplete=!!dental?.hasReview&&!photoPending&&!rxPending&&!dental?.dirty&&dental?.photoLoaded===true;
  let reviewLabel='Análisis pendiente',reviewCopy='Analiza las fotografías y confirma únicamente las observaciones que quieras incorporar al mapa.';
  if(!dental?.ready){reviewLabel='No disponible';reviewCopy='Espera a que cargue el mapa o revisa el aviso de conexión de este módulo.';}
  else if(dental.dirty){reviewLabel='Cambios sin guardar';reviewCopy='Guarda las observaciones del mapa antes de continuar.';}
  else if(!dental.photoLoaded){reviewLabel='Por comprobar';reviewCopy='No se pudo confirmar el avance del análisis fotográfico. Ningún resultado dudoso se incorporó al mapa.';}
  else if(dental.hasReview){reviewLabel=photoPending||rxPending?(photoPending+rxPending)+' por revisar':'Lista';reviewCopy=dental.confirmed+' observaciones confirmadas · '+dental.pending+' pendientes · '+dental.rejected+' descartadas. Esto no sustituye tu valoración clínica.';}
  if(dental?.studies&&dental.rxLoaded)reviewCopy+=' Radiografías: '+dental.studies+' guardadas · '+dental.rxReviews+' revisadas · '+dental.rxConfirmed+' confirmadas · '+dental.rxPending+' pendientes.';
  else if(dental?.studies&&!dental.rxLoaded)reviewCopy+=' El avance de radiografías aún no pudo comprobarse.';
  state(ctx,'review',reviewLabel,reviewComplete?'done':dental?.hasReview?'neutral':'pending');copy(ctx.reviewText,reviewCopy);
  ctx.reviewButton.disabled=!entry||!dental?.ready||dental.busy||dental.dirty;
  if(reviewComplete){copy(ctx.reviewButton,'Continuar al plan');ctx.reviewAction=()=>open('plan');}
  else if(rxPending&&!photoPending){copy(ctx.reviewButton,'Revisar mapa y radiografías');ctx.reviewAction=()=>ctx.modules.review.body.querySelector('.dr-record')?.scrollIntoView({block:'start',behavior:'smooth'});}
  else {copy(ctx.reviewButton,dental?.hasReview?(photoPending?'Revisar '+photoPending+' observaciones':'Continuar análisis'):'Analizar fotografías');ctx.reviewAction=()=>{if(ctx.selected?.current())ctx.selected.review();};}
  const planComplete=reviewComplete&&clinical?.ready;
  state(ctx,'plan',clinical?.saving?'Guardando':clinical?.dirty?'Cambios sin guardar':clinical?.ready&&!reviewComplete?'Guardado · falta revisión clínica':clinical?.ready?'Revisado y guardado':clinical?.saved?'Borrador guardado':clinical?.available?'Por completar':'No disponible',planComplete?'done':'pending');
  for(const [id,done] of [['assessment',clinical?.assessment],['treatments',clinical?.treatments],['approved',clinical?.ready]]){const item=ctx.planChecks[id];copy(item,(done?'✓ ':'○ ')+item.dataset.label);item.dataset.done=String(!!done);}
  ctx.planNext.disabled=!planComplete;
  const eligible=pairs>0&&planComplete;
  const receipt=ctx.receipts.get(entry?.row.id),created=eligible&&receipt&&Date.parse(receipt.expiresAt)>Date.now()&&receipt.revision===clinical?.revision;
  state(ctx,'share',created?'Enlace creado · sin enviar':eligible?'Lista para preparar':'Falta completar',created?'done':eligible?'neutral':'pending');
  copy(ctx.shareHint,!pairs?'Falta una foto con su simulación guardada.':!reviewComplete?'Falta terminar la revisión clínica antes de preparar una presentación nueva.':!clinical?.ready?'Falta revisar y guardar tu valoración y plan. No necesitas generar otra simulación.':'Fotos, revisión y plan listos. Ahora elige lo que verá el paciente y aprueba la presentación.');
  ctx.shareButton.disabled=!eligible;ctx.fixPlan.hidden=!!clinical?.ready;
  ctx.history.disabled=!entry;
  if(created)copy(ctx.shareHint,'Se creó un enlace en esta sesión. Compártelo junto con el código por separado. SMYL no confirma si ya lo enviaste.');
  // Suggested route, not a claim that all clinical issues were evaluated.
  copy(ctx.overview,!count?'Paso 1 de 4 · Añade o selecciona las evidencias del caso.':!reviewComplete?'Paso 2 de 4 · Comprueba las fotografías, el mapa y las radiografías.':!clinical?.ready?'Paso 3 de 4 · Completa y aprueba el plan de tratamiento.':'Paso 4 de 4 · Prepara lo que verá el paciente. Nada se envía automáticamente.');
  if(created)copy(ctx.overview,'Presentación aprobada y enlace creado en esta sesión. El envío al paciente es manual.');
  for(const [id,b] of Object.entries(ctx.nav)){const value=b.textContent+' · '+ctx.modules[id].badge.textContent;if(b.getAttribute('aria-label')!==value)b.setAttribute('aria-label',value);}syncNav(ctx);
 }
 function init(){
  const screen=document.getElementById('p-paciente-detalle');if(!screen)return;
  new MutationObserver(mount).observe(screen,{childList:true,subtree:true});
  // Local snapshots only. Never queries the database or runs an analysis.
  setInterval(refresh,400);mount();
  addEventListener('smyl:portal-created',e=>{const ctx=active,d=e.detail;if(valid(ctx)&&d?.tenant===ctx.tenant&&d.patient===ctx.patient){ctx.receipts.set(d.caseId,{expiresAt:d.expiresAt,revision:d.revision});refresh();}});
  addEventListener('smyl:portal-revoked',e=>{const ctx=active,d=e.detail;if(valid(ctx)&&d?.tenant===ctx.tenant&&d.patient===ctx.patient){ctx.receipts.delete(d.caseId);refresh();}});
  window.sb?.auth?.onAuthStateChange?.((event,session)=>{const ctx=active;if(ctx?.root.isConnected&&(session?.user?.id!==ctx.tenant||session.user.is_anonymous)){ctx.revoked=true;ctx.entries=null;ctx.selected=null;ctx.receipts.clear();ctx.root.replaceChildren(n('p','cw-overview','La sesión cambió. Abre nuevamente el expediente con la cuenta autorizada.'));}});
 }
 window.SmylCaseWorkspace={open,context(tenant,patient){const ctx=active;if(!valid(ctx)||ctx.tenant!==tenant||ctx.patient!==patient)return null;const entry=ctx.selected;return entry&&entry.current()?{caseId:entry.row.id,isCurrent:()=>valid(ctx)&&ctx.selected===entry&&entry.current()}:null;}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
