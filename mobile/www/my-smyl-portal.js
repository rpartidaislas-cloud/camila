/* Professional preparation and follow-up. Never opens a patient access session.
 * Endpoint snapshots are explicit, immutable approvals; no automatic sharing.
 */
(function(){'use strict';
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;},button=(text,fn,cls='mp-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const code=()=>{let x;do{x=crypto.getRandomValues(new Uint32Array(1))[0];}while(x>=4294000000);return String(x%1000000).padStart(6,'0');};
 const field=(label,value,limit,multiline=false)=>{const wrap=n('label','portal-field'),input=n(multiline?'textarea':'input');input.value=value;input.maxLength=limit;wrap.append(n('span','',label),input);return {wrap,input};};
 const disclosure=label=>{const box=n('details','portal-options');box.append(n('summary','',label));return box;};
 function progress(step,finished=false){
  const list=n('ol','portal-progress');list.setAttribute('aria-label','Etapas de la propuesta');
  ['Preparar','Revisar','Compartir'].forEach((label,i)=>{const done=i<step||finished,item=n('li',done?'is-done':i===step?'is-current':'');if(i===step&&!finished)item.setAttribute('aria-current','step');item.append(n('span','portal-progress-number',done?'✓':String(i+1)),n('strong','',label),n('small','',done?'Listo':i===step?'Ahora':'Pendiente'));list.append(item);});return list;
 }
 const message=e=>e?.code==='PT412'?'Primero revisa y guarda el plan clínico en el expediente. Después podrás preparar una nueva presentación.':['PT409','40001'].includes(e?.code)?'La fuente cambió. Recarga el expediente y revisa de nuevo antes de compartir.':['PGRST202','42P01','42883'].includes(e?.code)?'El acceso privado de mySmyl todavía no está activado en el servidor. No se ha compartido información.':e?.code==='42501'?'Tu sesión no tiene permiso o la función no está activada.':'No pudimos confirmar la operación. Conserva esta pantalla y reintenta.';
 let active=null;
 function close(force=false){if(!active)return;const run=active;if(!force&&(run.busy||run.attempt||run.dirty)&&!confirm('Hay cambios sin terminar o una operación sin confirmar. ¿Cerrar esta preparación?'))return;run.closed=true;clearInterval(run.watch);run.auth?.unsubscribe();run.controller?.destroy();run.urls.forEach(URL.revokeObjectURL);run.urls=[];run.attempt=null;run.secret=null;run.dialog.close();run.dialog.remove();active=null;run.focus?.focus?.({preventScroll:true});}
 async function open({api,row,current}){
  close();if(active||!current()||window.miRolEquipo!=='dueño')return;
  const dialog=n('dialog','ms-preview-dialog'),bar=n('div','ms-preview-bar'),host=n('div');dialog.setAttribute('aria-label','Preparar y compartir mySmyl');
  const run={dialog,host,row,urls:[],closed:false,busy:false,attempt:null,dirty:false,focus:document.activeElement,controller:null};active=run;
  const valid=()=>!run.closed&&current()&&window.miRolEquipo==='dueño'&&window.tenantId===row.tenant_id&&window.pacienteActual?.id===row.patient_id&&document.getElementById('p-paciente-detalle')?.classList.contains('activa');
  async function checked(promise,nullable=false){let timeout;try{if(!valid())throw Error('Context changed');const res=await Promise.race([promise,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Timeout')),25000))]);if(!valid())throw Error('Context changed');if(res?.error)throw res.error;if(!res||(!nullable&&res.data==null))throw Error('Unconfirmed');return res.data;}finally{clearTimeout(timeout);}}
  const rpc=(name,args={})=>checked(window.sb.rpc(name,args));
  bar.append(n('span','','mySmyl · Propuesta para tu paciente'),button('Volver al expediente',()=>close()));dialog.append(bar,host);document.body.append(dialog);dialog.showModal();dialog.oncancel=e=>{e.preventDefault();close();};run.watch=setInterval(()=>{if(!valid())close(true);},200);
  host.append(n('p','ms-preview-loading','Consultando el plan revisado y las fotografías de este caso…'));
  run.auth=window.sb.auth.onAuthStateChange?.((event,session)=>{if(session?.user?.id!==row.tenant_id||session.user.is_anonymous!==false)close(true);})?.data?.subscription;
  try{
   const identity=await checked(window.sb.auth.getUser());if(identity.user?.id!==row.tenant_id||identity.user.is_anonymous!==false)throw {code:'42501'};
   const local=window.SmylClinicalWorkflow?.status(row.tenant_id,row.patient_id);
   if(local&&!local.ready)throw {code:'PT412'};
   const [cap,source]=await Promise.all([rpc('smyl_portal_capabilities'),rpc('smyl_portal_sources',{p_case_id:row.id})]);
   if(cap.schema!==1||cap.tenant_id!==row.tenant_id||source.schema!==1||source.case_id!==row.id||source.patient_id!==row.patient_id||source.tenant_id!==row.tenant_id)throw Error('Source mismatch');
   if(local&&local.revision!==source.plan_revision)throw {code:'PT409'};
   if(!valid())return;run.source=source;run.enabled=cap.enabled===true;build();
  }catch(error){if(valid()){
   const section=n('section','portal-editor'),feedback=n('p','portal-warning',error.code==='PT412'?'Falta revisar tu valoración y plan. Tus fotos ya están guardadas; no necesitas generar otra simulación.':message(error));feedback.setAttribute('role','status');
   section.append(progress(0),n('h1','',error.code==='PT412'?'Empecemos por tu revisión.':'Todavía no podemos continuar.'),feedback);
   if(error.code==='PT412')section.append(button('Completar valoración y plan',()=>{
    close(true);
    const found=window.SmylClinicalWorkflow?.focus(row.tenant_id,row.patient_id,()=>{if(current())open({api,row,current});});
    if(!found)document.getElementById('clinic-content')?.scrollIntoView({block:'start'});
   },'ms-primary'));
   else section.append(button('Volver a comprobar',()=>{close(true);open({api,row,current});},'ms-primary'));
   host.replaceChildren(section);followup(section,feedback);
  }}
  function followup(container,feedback){
   const details=disclosure('Enlaces anteriores y mensajes del paciente'),links=n('section','portal-links'),inbox=n('section','portal-inbox');details.append(links,inbox);container.append(details);let loaded=false;
   async function refresh(){try{
    const [shares,requests]=await Promise.all([checked(window.sb.from('smyl_portal_shares').select('id,version,approved_at,expires_at,revoked_at').eq('tenant_id',row.tenant_id).eq('case_id',row.id).order('version',{ascending:false}).limit(20)),checked(window.sb.from('smyl_portal_requests').select('id,kind,message,state,created_at,share_id').eq('tenant_id',row.tenant_id).eq('patient_id',row.patient_id).order('created_at',{ascending:false}).limit(50))]);
    if(!valid())return;links.replaceChildren(n('h2','','Versiones y accesos'));for(const s of shares){const entry=n('article','portal-entry'),info=n('div');info.append(n('strong','','Versión '+s.version),n('p','',s.revoked_at?'Acceso revocado':Date.parse(s.expires_at)<=Date.now()?'Acceso vencido':'Vence '+new Date(s.expires_at).toLocaleString('es-MX')));entry.append(info);if(!s.revoked_at&&Date.parse(s.expires_at)>Date.now())entry.append(button('Revocar acceso',async()=>{if(!confirm('¿Revocar este acceso? No elimina copias que ya se hayan guardado en otro dispositivo.'))return;try{if(await rpc('smyl_portal_revoke',{p_id:s.id})!==true)throw Error('No receipt');feedback.textContent='Acceso revocado. Las próximas consultas serán denegadas.';refresh();}catch(e){feedback.textContent=message(e);}}));links.append(entry);}if(!shares.length)links.append(n('p','','Todavía no has creado un acceso para este caso.'));
    inbox.replaceChildren(n('h2','','Preguntas y solicitudes del paciente'),n('p','','Solicitar una cita no reserva un horario. Contacta al paciente con los datos de su expediente.'));for(const q of requests){const entry=n('article','portal-entry'),info=n('div');info.append(n('strong','',q.kind==='appointment'?'Solicitud de cita':'Pregunta'),n('p','',q.message),n('small','',new Date(q.created_at).toLocaleString('es-MX')));const state=n('select');state.setAttribute('aria-label','Estado de la solicitud');for(const [v,label] of [['new','Por atender'],['contacted','Contactado'],['closed','Cerrado']])state.append(new Option(label,v));state.value=q.state;state.onchange=async()=>{state.disabled=true;try{if(await rpc('smyl_portal_request_state',{p_id:q.id,p_state:state.value})!==true)throw Error('No receipt');q.state=state.value;feedback.textContent='Seguimiento actualizado. No se envió una respuesta automática.';}catch(e){state.value=q.state;feedback.textContent=message(e);}finally{state.disabled=false;}};entry.append(info,state);inbox.append(entry);}if(!requests.length)inbox.append(n('p','','Sin solicitudes recibidas.'));inbox.append(button('Actualizar solicitudes',refresh));
   }catch(e){if(valid()){links.replaceChildren(n('p','',message(e)));inbox.replaceChildren();}}}
   details.addEventListener('toggle',()=>{if(details.open&&!loaded){loaded=true;refresh();}});return ()=>{loaded=false;if(details.open){loaded=true;refresh();}};
  }
  function build(){
   const source=run.source,editor=n('section','portal-editor'),form=n('fieldset'),review=n('section','portal-review'),share=n('section','portal-share'),feedback=n('p','portal-feedback');
   feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
   const trail=n('div'),heading=n('h1','','Prepara su propuesta.'),intro=n('p','portal-intro',source.patient_name+' · '+source.clinic.name);
   const checklist=n('div','portal-checklist');checklist.setAttribute('aria-label','Qué falta para continuar');
   editor.append(trail,heading,intro,checklist,form,review,share,feedback);
   host.replaceChildren(editor);review.hidden=share.hidden=true;
   let stage=0,reviewedSelection=null;
   const summary=field('¿Qué le explicarías a tu paciente?','',5000,true);
   summary.input.placeholder='Explica qué observaste y cuál es el siguiente paso, con tus propias palabras.';
   form.append(summary.wrap,button('Usar valoración revisada',()=>{summary.input.value=source.summary;changed();summary.input.focus();}),n('p','portal-hint','Comprueba que el texto sea adecuado para compartir. Tus notas internas no se incluyen.'));
   const stepsBox=disclosure('Plan de tratamiento'),stepList=n('ol','portal-plan-summary'),steps=n('div'),stepFields=[];
   form.append(stepsBox);stepsBox.append(n('p','portal-hint','Ya tomamos las etapas de tu plan revisado. Puedes simplificar cómo se las explicas al paciente.'),steps);
   stepsBox.before(stepList);
   function addStep(value={title:'',text:''}){
    if(stepFields.length>=20)return;
    const wrap=n('section','portal-step'),name=field('Nombre de la etapa',value.title,200),copy=field('Explicación sencilla',value.text,1000,true),item={name:name.input,copy:copy.input};
    wrap.append(name.wrap,copy.wrap,button('Quitar etapa',()=>{wrap.remove();stepFields.splice(stepFields.indexOf(item),1);changed();}));
    steps.append(wrap);stepFields.push(item);
   }
   source.steps.forEach(addStep);stepsBox.append(button('Añadir etapa',()=>{addStep();changed();stepFields.at(-1).name.focus();}));
   const photos=disclosure('Fotos incluidas'),photoChecks=[];form.append(photos);
   photos.append(n('p','portal-hint','Cada vista incluye la foto original y su simulación.'));
   for(const id of source.views){const label=n('label','portal-check'),check=n('input');check.type='checkbox';check.checked=true;label.append(check,n('span','',window.SmylCaseModel.label(id)));photos.append(label);photoChecks.push({id,check});}
   const notes=disclosure('Mapa dental · opcional'),noteFields=[];form.append(notes);
   notes.append(n('p','portal-hint','Incluye solo las observaciones que quieras explicar. No es obligatorio para compartir la propuesta.'));
   for(const o of source.observations){
    const item=n('section','portal-item'),label=n('label','portal-check'),check=n('input');check.type='checkbox';
    label.append(check,n('span','','Incluir diente '+o.tooth));
    const note=field('Texto para el paciente',o.text,600,true);note.input.disabled=true;
    check.onchange=()=>note.input.disabled=!check.checked;
    item.append(label,note.wrap);notes.append(item);noteFields.push({source:o,check,input:note.input});
   }
   if(!noteFields.length)notes.append(n('p','','No hay observaciones guardadas para incluir. Puedes continuar sin mapa.'));
   const budget=disclosure('Presupuesto · no incluido'),includeLabel=n('label','portal-check'),include=n('input'),prices=n('section');
   include.type='checkbox';includeLabel.append(include,n('span','','Incluir presupuesto en esta propuesta'));prices.hidden=true;
   const quote=n('select');quote.setAttribute('aria-label','Presupuesto aprobado');quote.append(new Option('Elige un presupuesto aprobado',''));
   source.proposals.forEach(q=>quote.append(new Option(q.title,q.id)));
   const quoteView=n('div');prices.append(quote,quoteView);include.onchange=()=>prices.hidden=!include.checked;
   quote.onchange=()=>{quoteView.replaceChildren();const q=source.proposals.find(v=>v.id===quote.value);if(q){quoteView.append(n('p','',q.items.map(i=>i.quantity+' × '+i.label+' · '+new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(i.unit_cents/100)).join('\n')),n('p','','Total: '+new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(q.total_cents/100)),n('p','',q.terms),n('p','','Vigente hasta '+q.valid_until));}};
   budget.append(n('p','portal-hint','Solo se mostrarán precios si activas esta opción.'),includeLabel,prices);form.append(budget);
   if(!source.proposals.length)prices.append(n('p','','No hay un presupuesto aprobado. Puedes continuar sin precios y prepararlo después desde el expediente.'));
   const settings=disclosure('Título y duración del enlace'),title=field('Título de la presentación','Tu sonrisa, tu siguiente paso.',150),days=n('select');
   days.setAttribute('aria-label','Vigencia del enlace');for(const d of [1,7,14])days.append(new Option(d+(d===1?' día':' días'),d));days.value='7';
   const dayLabel=n('label','portal-field');dayLabel.append(n('span','','Duración del enlace'),days);settings.append(title.wrap,dayLabel);form.append(settings);
   const prepareActions=n('div','portal-actions portal-next'),next=button('Continuar a revisión',preview,'ms-primary');
   prepareActions.append(next);form.append(prepareActions);
   const consentLabel=n('label','portal-check'),consent=n('input');consent.type='checkbox';
   consentLabel.append(consent,n('span','','Revisé esta presentación y autorizo compartirla con este paciente. Tengo permiso para compartir sus imágenes.'));
   const reviewContent=n('div'),reviewFoot=n('div','portal-review-footer'),reviewActions=n('div','portal-actions');
   const back=button('Volver a editar',()=>{if(run.busy||run.attempt)return;clearPreview();consent.checked=false;reviewedSelection=null;setStage(0);});
   const publishButton=button('Aprobar y preparar envío',publish,'ms-primary');publishButton.disabled=true;
   const approvalHelp=n('p','portal-hint','Falta marcar la confirmación para continuar.');
   reviewActions.append(back,publishButton);reviewFoot.append(consentLabel,approvalHelp,reviewActions);review.append(reviewContent,reviewFoot);
   const extra=n('div');editor.append(extra);const refresh=followup(extra,feedback);
   function localReady(){
    const local=window.SmylClinicalWorkflow?.status(row.tenant_id,row.patient_id);
    return !local||(local.ready&&local.revision===source.plan_revision);
   }
   function clearPreview(){run.controller?.destroy();run.controller=null;run.urls.forEach(URL.revokeObjectURL);run.urls=[];reviewContent.replaceChildren();}
   function setStage(value){
    stage=value;trail.replaceChildren(progress(value));form.hidden=value!==0;review.hidden=value!==1;share.hidden=value!==2;checklist.hidden=value!==0;
    extra.hidden=value===1;
    heading.textContent=['Prepara su propuesta.','Revisa lo que verá tu paciente.','Tu propuesta está lista para compartir.'][value];
    heading.tabIndex=-1;heading.focus({preventScroll:true});dialog.scrollTop=0;update();
   }
   function requirements(){
    const missing=[];
    if(!summary.input.value.trim())missing.push({text:'Escribe una explicación para el paciente.',target:summary.input});
    if(summary.input.value.length>5000)missing.push({text:'Acorta la explicación a 5,000 caracteres o menos.',target:summary.input});
    if(!photoChecks.some(v=>v.check.checked))missing.push({text:'Selecciona al menos una foto con su simulación.',target:photoChecks[0]?.check||photos});
    if(!stepFields.length||stepFields.some(s=>!s.name.value.trim()))missing.push({text:'Añade al menos una etapa y escribe su nombre.',target:stepFields.find(s=>!s.name.value.trim())?.name||stepsBox});
    if(!title.input.value.trim())missing.push({text:'Escribe un título para la presentación.',target:title.input});
    for(const o of noteFields)if(o.check.checked&&!o.input.value.trim())missing.push({text:'Escribe la observación del diente '+o.source.tooth+'.',target:o.input});
    if(include.checked&&!quote.value)missing.push({text:'Elige un presupuesto aprobado o desactiva los precios.',target:quote});
    return missing;
   }
   function update(showStatus=true){
    const missing=requirements(),count=photoChecks.filter(v=>v.check.checked).length;
    photos.firstElementChild.textContent='Fotos incluidas · '+count+(count===1?' vista':' vistas');
    stepsBox.firstElementChild.textContent='Editar el plan · '+stepFields.length+(stepFields.length===1?' etapa':' etapas');
    budget.firstElementChild.textContent=include.checked?'Presupuesto · incluido':'Presupuesto · no incluido';
    stepList.replaceChildren(...stepFields.map((s,i)=>n('li','',s.name.value.trim()||'Etapa '+(i+1)+' · falta el nombre')));
    checklist.replaceChildren();
    const checks=[['Fotos',count>0],['Explicación',!!summary.input.value.trim()],['Plan',stepFields.length>0&&stepFields.every(s=>s.name.value.trim())]];
    checks.forEach(([label,ready])=>{const item=n('span',ready?'is-done':'is-missing');item.append(n('span','',ready?'✓':'○'),document.createTextNode(label+' · '+(ready?'listo':'falta')));checklist.append(item);});
    next.textContent='Continuar a revisión';
    consent.disabled=run.busy||!!run.attempt;
    publishButton.disabled=run.busy||!run.enabled||!consent.checked||!reviewedSelection;
    approvalHelp.textContent=!run.enabled?'El envío aún no está habilitado para esta clínica.':run.attempt?'No pudimos confirmar el guardado. Reintenta sin duplicar la propuesta.':consent.checked?'Todo listo. El siguiente paso crea el enlace; no lo envía.':'Falta marcar la confirmación para continuar.';
    if(stage===0&&showStatus)feedback.textContent=missing.length?'Falta: '+missing[0].text:'Listo para revisar. El presupuesto y el mapa son opcionales.';
   }
   function changed(){consent.checked=false;reviewedSelection=null;run.dirty=true;update();}
   form.addEventListener('input',changed);form.addEventListener('change',changed);consent.onchange=update;
   function selection(approved=false){const q=source.proposals.find(v=>v.id===quote.value);return {schema:1,title:title.input.value.trim(),summary:summary.input.value.trim(),steps:stepFields.map(s=>({title:s.name.value.trim(),text:s.copy.value.trim()})),observations:noteFields.filter(o=>o.check.checked).map(o=>({...o.source,text:o.input.value.trim()})),views:photoChecks.filter(v=>v.check.checked).map(v=>v.id),plan_revision:source.plan_revision,photo_revision:source.photo_revision,dental_revision:source.dental_revision,include_budget:include.checked,proposal_id:include.checked&&q?q.id:null,proposal_revision:include.checked&&q?q.revision:0,approved};}
   async function preview(){
    if(run.busy)return;
    const missing=requirements();
    if(missing.length){
     const {text,target}=missing[0];feedback.textContent='Falta: '+text;
     for(let parent=target;parent&&parent!==form;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
     target?.focus();target?.scrollIntoView({block:'center'});return;
    }
    if(!localReady()){feedback.textContent='El plan cambió. Vuelve al expediente y revísalo antes de continuar.';return;}
    run.busy=true;form.disabled=true;feedback.textContent='Cargando tus fotos para la revisión…';
    try{
     const s=selection(),doc=MySmylDocument.preview(source,s),views=[];clearPreview();
     for(const key of s.views){
      const v=row.document.views.find(v=>v.view===key&&v.result);if(!v)throw Error('No pudimos cargar una de las fotos. Vuelve a intentarlo.');
      const pair={view:key};
      for(const role of ['original','result']){
       const url=await api.image(row,v[role]);if(!valid()){URL.revokeObjectURL(url);return;}
       run.urls.push(url);const img=new Image();img.src=url;await img.decode();if(!valid())return;pair[role]=url;
      }views.push(pair);
     }
     if(!valid())return;
     run.controller=MySmylDocument.mount(reviewContent,{document:doc,views});
     reviewedSelection=JSON.stringify(s);consent.checked=false;setStage(1);
     feedback.textContent='Comprueba las fotos, tu explicación y el plan. Todavía no se comparte nada.';
    }catch(e){clearPreview();if(valid())feedback.textContent='No pudimos abrir la revisión. Comprueba los textos y las fotos e intenta de nuevo.';}
    finally{run.busy=false;if(valid()){form.disabled=false;update(false);}}
   }
   async function publish(){
    if(run.busy||!run.enabled||!consent.checked||!valid()||stage!==1||!reviewedSelection)return;
    if(!run.attempt&&(!localReady()||JSON.stringify(selection())!==reviewedSelection)){consent.checked=false;reviewedSelection=null;update();feedback.textContent='El contenido cambió. Vuelve a editar y revisa de nuevo.';return;}
    run.busy=true;form.disabled=true;back.disabled=true;update();feedback.textContent='Preparando el enlace privado…';
    let success=false;
    try{
     if(!run.attempt){const selected=selection(true);MySmylDocument.preview(source,selected);const token=random(),pin=code();run.secret={token,pin};run.attempt={p_id:crypto.randomUUID(),p_case_id:row.id,p_selection:selected,p_token_hash:await sha(token),p_code_hash:await sha('mySmyl:'+token+':'+pin),p_days:Number(days.value)};}
     if(!valid())return;
     const saved=await rpc('smyl_portal_publish',run.attempt);
     if(saved.id!==run.attempt.p_id||!Number.isInteger(saved.version)||!Number.isFinite(Date.parse(saved.expires_at))||saved.revoked_at)throw Error('No confirmed access');
     const link='https://rpartidaislas-cloud.github.io/camila/my-smyl-private.html#access='+saved.id+'.'+run.secret.token;
     const credentials=n('section','portal-credentials'),delivery=n('p','portal-delivery','Pendiente: envía el enlace y el código a tu paciente.');
     credentials.append(n('h2','','Solo falta enviarla.'),n('p','','Copia el enlace y pégalo en WhatsApp o correo. Entrega el código por separado para que el paciente pueda abrirla.'));
     for(const [label,value,kind] of [['Enlace privado',link,'enlace'],['Código · entregar por separado',run.secret.pin,'código']]){
      const f=field(label,value,500);f.input.readOnly=true;f.input.autocomplete='off';f.input.spellcheck=false;
      const copy=button('Copiar '+kind,async()=>{try{await navigator.clipboard.writeText(value);copy.textContent=kind==='enlace'?'Enlace copiado':'Código copiado';feedback.textContent='Copiado. Ahora pégalo en tu mensaje; no se envió automáticamente.';}catch{f.input.focus();f.input.select();feedback.textContent='Selecciona y copia el texto.';}},kind==='enlace'?'ms-primary':'mp-secondary');
      credentials.append(f.wrap,copy);
     }
     credentials.append(n('p','portal-hint','Disponible hasta '+new Date(saved.expires_at).toLocaleString('es-MX')+'. Guarda el enlace y el código antes de cerrar; no se pueden recuperar desde aquí.'));
     const help=disclosure('¿Qué verá el paciente?');
     help.append(n('p','','Su comparación antes y después, tu explicación y el plan. '+(include.checked?'También el presupuesto que elegiste.':'No verá precios.')),n('p','','Podrá enviarte preguntas o solicitar una cita. Las encontrarás en «Enlaces anteriores y mensajes del paciente».'),n('p','','Un nuevo enlace reemplaza al anterior. Cualquier persona con el enlace y el código puede abrirlo: compártelos solo con el paciente.'));
     share.replaceChildren(delivery,credentials,help,button('Volver al expediente',()=>close()));
     clearPreview();run.attempt=null;run.secret=null;run.dirty=false;consent.checked=false;success=true;
     setStage(2);feedback.textContent='Presentación aprobada. Enlace creado; todavía no enviado.';refresh();
    }catch(e){
     if(valid()){
      feedback.textContent=message(e);
      if(['PT412','PT409','40001','22023','42501'].includes(e.code)){run.attempt=null;run.secret=null;consent.checked=false;reviewedSelection=null;}
      else if(run.attempt)publishButton.textContent='Reintentar sin duplicar';
     }
    }finally{
     run.busy=false;if(valid()){form.disabled=success||!!run.attempt;back.disabled=success||!!run.attempt;update();}
    }
   }
   setStage(0);
  }
 }
 addEventListener('pagehide',()=>close(true));addEventListener('beforeunload',e=>{if(active&&(active.dirty||active.busy||active.attempt)){e.preventDefault();e.returnValue='';}});
 window.MySmylPortal={open,close};
})();
