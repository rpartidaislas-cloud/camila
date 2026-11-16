/* SMYL · MILA en el celular (computadora).
 * Muestra un QR para que el celular del dentista grabe la entrevista de historia clínica y el dictado de la
 * exploración. La computadora sondea el borrador que MILA interpreta y lo entrega a los flujos canónicos:
 *   - Historia: SmylPatientHistoryMila.apply → editor de historia prellenado; solo "Guardar historia" crea versión.
 *   - Exploración: SmylDentalProgress.addFinding → borrador del odontograma; solo su guardado crea versión.
 * No guarda audio, transcripción ni borrador en el navegador. Al terminar o cambiar de paciente, la sesión
 * se vacía en el servidor (action close). */
(function(){
  'use strict';
  var POLL_MS=3000,SECTIONS=[['allergies','Alergias'],['alerts','Alertas'],['conditions','Condiciones'],['medications','Medicamentos'],['surgeries','Cirugías'],['dental','Dental'],['habits','Hábitos']];
  var SURFACE={whole:'Pieza completa',M:'Mesial',D:'Distal',V:'Vestibular',L:'Lingual/palatina',O:'Oclusal',I:'Incisal'};
  var session=null; // {id,tenant,patient,url,expires,data,applied:Set,timer,dialog,mode}

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function fmt(n){return Number(n||0).toLocaleString('es-MX');}
  async function call(body){
    var auth=await window.sb.auth.getSession(),token=auth&&auth.data&&auth.data.session&&auth.data.session.access_token;
    if(!token)throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    var res=await fetch(window.SUPA_URL+'/functions/v1/mila-interview',{method:'POST',headers:{Authorization:'Bearer '+token,apikey:window.SUPA_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
    var data={};try{data=await res.json();}catch(_){}
    if(!res.ok){var e=new Error(data.error||'MILA no respondió.');e.status=res.status;throw e;}
    return data;
  }
  function phoneUrl(id,token){
    var base=/^https:$/.test(location.protocol)&&/smyldesign\.ai$|github\.io$/.test(location.hostname)?new URL('mila-movil.html',location.href).href:'https://app.smyldesign.ai/mila-movil.html';
    return base+'#s='+encodeURIComponent(id)+'&t='+encodeURIComponent(token);
  }
  function qrSvg(text){
    if(typeof window.qrcode!=='function')return '';
    var qr=window.qrcode(0,'M');qr.addData(text);qr.make();
    return qr.createSvgTag({cellSize:5,margin:2,scalable:true});
  }
  function stillCurrent(s){return s&&session===s&&window.tenantId===s.tenant&&window.pacienteActual&&window.pacienteActual.id===s.patient;}

  function ensureDialog(){
    var d=document.getElementById('smyl-mila-interview');
    if(d)return d;
    d=document.createElement('dialog');d.id='smyl-mila-interview';d.className='mila-iv';d.setAttribute('aria-labelledby','mila-iv-title');
    document.body.append(d);
    d.addEventListener('close',function(){if(session){session.previsitOnly=false;session.appointmentId='';if(session.pv&&!session.id)session.pv=null;}if(session&&session.returnFocus&&session.returnFocus.focus)session.returnFocus.focus();});
    return d;
  }

  var ICON={
    phone:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    shield:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    mic:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>',
    doc:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>',
    tooth:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 3.5c1.8 0 2.7.8 4.5.8s2.7-.8 4.5-.8c2.5 0 3.8 2.3 3.3 5.2-.5 2.6-1.6 3.6-2 6.3-.4 2.9-.9 5.5-2.4 5.5-1.6 0-1.4-4.5-3.4-4.5s-1.8 4.5-3.4 4.5c-1.5 0-2-2.6-2.4-5.5-.4-2.7-1.5-3.7-2-6.3-.5-2.9.8-5.2 3.3-5.2z"/></svg>',
    alert:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
    close:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
    link:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
    screen:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
  };
  function initials(name){return String(name||'P').trim().split(/\s+/).slice(0,2).map(function(w){return w.charAt(0);}).join('').toUpperCase()||'P';}
  function minutesLeft(s){if(!s.expires)return null;var ms=Date.parse(s.expires)-Date.now();return Number.isFinite(ms)?Math.max(0,Math.ceil(ms/60000)):null;}
  function phaseOf(d,s){
    if(s.expired)return 'expired';
    if(!d.paired)return 'scan';
    if(!d.consent)return 'consent';
    if(d.realtime&&d.realtime.active)return 'live';
    if(d.history||d.exam)return 'review';
    return 'ready';
  }
  function stepper(phase){
    var order=['scan','consent','live','review'],labels=[['Escanear','phone'],['Consentimiento','shield'],['Entrevista','mic'],['Revisar','doc']];
    var current={scan:0,consent:1,ready:2,live:2,review:3,expired:0}[phase];
    return '<ol class="mila-iv-stepper" aria-label="Avance">'+labels.map(function(l,i){var state=i<current?'done':i===current?'current':'todo';return '<li data-state="'+state+'"'+(state==='current'?' aria-current="step"':'')+'><span class="mila-iv-step-dot">'+(state==='done'?'✓':ICON[l[1]])+'</span><span>'+esc(l[0])+'</span></li>';}).join('')+'</ol>';
  }
  function statusLine(phase,d){
    return ({scan:'Esperando que escanees el código con el celular…',consent:'Celular conectado · falta el consentimiento del paciente',ready:'Listo · inicia la entrevista desde el celular',live:'MILA está entrevistando al paciente',review:d.interpreting||d.processing?'MILA está ordenando la información…':'Borrador listo para revisar',expired:'El código venció'})[phase];
  }
  function tabs(s){if(s.previsitOnly)return '';return '<div class="mila-iv-tabs" role="tablist"><button type="button" role="tab" data-mila-view="clinic" aria-selected="'+(s.view!=='previsit')+'">En consultorio</button><button type="button" role="tab" data-mila-view="previsit" aria-selected="'+(s.view==='previsit')+'">Antes de la cita</button></div>';}
  function renderPrevisit(s){
    var pv=s.pv||(s.pv={mode:'choice'}),r=pv.result,html='<header class="mila-iv-head"><span class="mila-iv-avatar" aria-hidden="true">'+esc(initials(s.patientName))+'</span><div class="mila-iv-title"><span class="mila-iv-kicker">MILA · ANTES DE LA CITA</span><h2 id="mila-iv-title">'+esc(s.patientName||'Paciente')+'</h2><p class="mila-iv-status">El paciente responde desde su celular antes de llegar.</p></div><button type="button" class="mila-iv-icon-btn" data-mila-hide aria-label="Cerrar" title="Cerrar">'+ICON.close+'</button></header>'+tabs(s)+'<div class="mila-iv-body">';
    if(!r){
      var modes=[['choice','Que el paciente elija','Puede platicar con MILA o llenar el formulario.'],['voice','MILA por voz','MILA le hace las preguntas. ~US$0.33 por entrevista.'],['form','Formulario','Responde escribiendo. Sin costo de IA.']];
      html+='<section class="mila-iv-card"><h3>¿Cómo responderá?</h3><div class="mila-iv-modes" role="radiogroup">'+modes.map(function(m){return '<label class="mila-iv-mode"><input type="radio" name="mila-pv-mode" value="'+m[0]+'"'+(pv.mode===m[0]?' checked':'')+'><span><strong>'+esc(m[1])+'</strong><small>'+esc(m[2])+'</small></span></label>';}).join('')+'</div>'
        +'<p class="mila-iv-note">'+(s.appointmentId?'Se envía para esta cita.':'Se usa la próxima cita del paciente.')+' El enlace es personal, pide su fecha de nacimiento si la ficha la tiene y vence un día después de la cita. Lo que responda llega aquí como borrador para revisar.</p>'
        +'<div class="mila-iv-card-actions"><button type="button" class="btn btn-primary" data-mila-pv-send="whatsapp"'+(pv.busy?' disabled':'')+'>Enviar por WhatsApp</button><button type="button" class="mila-iv-ghost" data-mila-pv-send="link"'+(pv.busy?' disabled':'')+'>'+ICON.link+'Solo copiar enlace</button></div></section>';
    }else{
      var ok=r.sent,reason=r.reason,msg=ok?'Enviada por WhatsApp con la plantilla «Entrevista previa». Saldrá en menos de un minuto.':reason==='link'?'Enlace listo. Cópialo y envíaselo al paciente.':reason==='no_conversation'?'Este paciente aún no tiene conversación de WhatsApp con la clínica, así que no se puede usar la plantilla. Envíale el enlace por WhatsApp normal.':reason==='template_not_approved'?'La plantilla «entrevista_previa_v1» todavía no está aprobada por Meta. Solicítala en Configuración → WhatsApp → Plantillas. Mientras tanto, envía el enlace por WhatsApp normal.':'No se pudo enviar por WhatsApp ('+esc(r.detail||reason||'error')+'). Envía el enlace por WhatsApp normal.';
      html+='<section class="mila-iv-card"><h3>'+(ok?'Entrevista enviada':'Entrevista lista')+'</h3><p class="mila-iv-note" style="font-size:14px;color:inherit">'+esc(msg)+'</p>'
        +'<p class="mila-iv-note">'+(r.appointment?'Cita: '+esc(r.appointment)+' · ':'Sin cita próxima registrada · ')+'modo: '+esc({choice:'el paciente elige',voice:'MILA por voz',form:'formulario'}[r.mode]||r.mode)+'</p>'
        +'<div class="mila-iv-card-actions">'+(ok?'':'<a class="btn btn-primary" data-mila-pv-wa target="_blank" rel="noopener" href="'+esc(waLink(s,r))+'">Abrir WhatsApp con el mensaje</a>')+'<button type="button" class="mila-iv-ghost" data-mila-pv-copy>'+ICON.link+'Copiar enlace</button></div></section>';
    }
    if(pv.error)html+='<p class="mila-iv-error" role="alert">'+esc(pv.error)+'</p>';
    if(pv.notice)html+='<p class="mila-iv-notice" role="status">'+esc(pv.notice)+'</p>';
    html+=autoSection(s);
    html+='</div><footer class="mila-iv-foot"><span></span><button type="button" class="mila-iv-link" data-mila-hide>Listo</button></footer>';
    s.dialog.innerHTML=html;
    s.dialog.querySelectorAll('[data-mila-hide]').forEach(function(b){b.onclick=function(){s.dialog.close();};});
    bindTabs(s);
    s.dialog.querySelectorAll('[name="mila-pv-mode"]').forEach(function(i){i.onchange=function(){pv.mode=i.value;};});
    s.dialog.querySelectorAll('[data-mila-pv-send]').forEach(function(b){b.onclick=function(){sendPrevisit(s,b.dataset.milaPvSend);};});
    bindAuto(s);
    var cp=s.dialog.querySelector('[data-mila-pv-copy]');if(cp)cp.onclick=function(){if(navigator.clipboard)navigator.clipboard.writeText(r.url).then(function(){pv.notice='Enlace copiado.';renderPrevisit(s);});else window.prompt('Copia el enlace:',r.url);};
  }
  /* Envío automático (Configuración de la clínica): se guarda en el servidor y se aplica a todas las citas. */
  var auto={loaded:false,loading:false,data:null,error:'',saving:false,notice:''};
  function autoSection(s){
    if(!auto.loaded&&!auto.loading)loadAuto(s);
    var d=auto.data,st=d&&d.settings||{},can=d&&d.can_configure;
    var html='<details class="mila-iv-card mila-iv-auto"'+(s.autoOpen?' open':'')+'><summary><span><strong>Envío automático</strong><small>'+esc(!d?(auto.error||'Cargando…'):st.enabled?'Activo · '+st.hours_before+' h antes de cada cita':'Apagado')+'</small></span></summary>';
    if(d){
      var hours=[24,48,72];if(hours.indexOf(st.hours_before)<0)hours.push(st.hours_before);
      html+='<p class="mila-iv-note">La entrevista previa sale sola por WhatsApp antes de cada cita confirmada. Nunca se envía dos veces para la misma cita ni más de una vez al mes al mismo paciente.</p>'
        +(d.template_ready===false?'<p class="mila-iv-warn">La plantilla «entrevista_previa_v1» aún no está aprobada por Meta: el envío automático empezará en cuanto lo esté (Configuración → WhatsApp → Plantillas).</p>':'')
        +'<fieldset class="mila-iv-auto-form"'+(can?'':' disabled')+'>'
        +'<label class="mila-iv-switch"><input type="checkbox" data-auto="enabled"'+(st.enabled?' checked':'')+'><span>Enviar automáticamente</span></label>'
        +'<label>Cuándo<select data-auto="hours_before">'+hours.sort(function(a,b){return a-b;}).map(function(h){return '<option value="'+h+'"'+(h===st.hours_before?' selected':'')+'>'+h+' horas antes</option>';}).join('')+'</select></label>'
        +'<label>Cómo responde<select data-auto="mode">'+[['choice','El paciente elige'],['voice','MILA por voz'],['form','Formulario']].map(function(m){return '<option value="'+m[0]+'"'+(m[0]===st.mode?' selected':'')+'>'+m[1]+'</option>';}).join('')+'</select></label>'
        +'<label>A quién<select data-auto="audience">'+[['stale','Sin historia o con historia de más de un año'],['no_history','Solo pacientes sin historia'],['all','A todos los pacientes']].map(function(m){return '<option value="'+m[0]+'"'+(m[0]===st.audience?' selected':'')+'>'+m[1]+'</option>';}).join('')+'</select></label>'
        +'</fieldset>'
        +(can?'<div class="mila-iv-card-actions"><button type="button" class="btn btn-primary" data-auto-save'+(auto.saving?' disabled':'')+'>'+(auto.saving?'Guardando…':'Guardar')+'</button></div>':'<p class="mila-iv-note">Solo quien administra la agenda puede cambiar esto.</p>')
        +(auto.notice?'<p class="mila-iv-notice" role="status">'+esc(auto.notice)+'</p>':'');
    }
    return html+'</details>';
  }
  async function loadAuto(s){
    auto.loading=true;auto.error='';
    try{auto.data=await call({action:'previsit_settings'});auto.loaded=true;}catch(e){auto.error=e.message;}
    auto.loading=false;if(session===s&&s.view==='previsit')renderPrevisit(s);
  }
  function bindAuto(s){
    var box=s.dialog.querySelector('.mila-iv-auto');if(!box)return;
    box.addEventListener('toggle',function(){s.autoOpen=box.open;});
    var btn=box.querySelector('[data-auto-save]');if(!btn)return;
    btn.onclick=async function(){
      var v=function(k){var el=box.querySelector('[data-auto="'+k+'"]');return el.type==='checkbox'?el.checked:el.value;};
      var body={action:'previsit_settings_save',enabled:v('enabled'),hours_before:Number(v('hours_before')),mode:v('mode'),audience:v('audience')};
      auto.saving=true;auto.notice='';renderPrevisit(s);
      try{
        var r=await call(body);auto.data.settings=Object.assign({},auto.data.settings,r.settings);
        var sum=r.summary||{};
        auto.notice=!r.settings.enabled?'Envío automático apagado.':sum.skipped==='template_not_approved'?'Guardado. Empezará a enviarse cuando Meta apruebe la plantilla.':'Guardado.'+(sum.sent?' Se enviaron '+sum.sent+' entrevista'+(sum.sent>1?'s':'')+' a citas próximas.':'');
        dispatchEvent(new CustomEvent('smyl:mila-pending-changed',{detail:{auto:true}}));
      }catch(e){auto.notice=e.message;}
      auto.saving=false;renderPrevisit(s);
    };
  }
  function waLink(s,r){
    var p=s.info||window.pacienteActual||{},d=String(p.telefono||'').replace(/\D/g,'');if(d.length===10)d='52'+d;
    var first=String(p.nombre||'').trim().split(/\s+/)[0]||'';
    var text='Hola'+(first?' '+first:'')+', para preparar tu cita'+(r.appointment?' del '+r.appointment:'')+' te pedimos responder unas preguntas para tu expediente (5 minutos): '+r.url+' El enlace es personal.';
    return (d.length>=11?'https://wa.me/'+d:'https://wa.me/')+'?text='+encodeURIComponent(text);
  }
  async function sendPrevisit(s,via){
    var pv=s.pv;pv.busy=true;pv.error='';pv.notice='';renderPrevisit(s);
    try{pv.result=await call({action:'previsit_create',patient_id:s.patient,mode:pv.mode,via:via,appointment_id:s.appointmentId||''});dispatchEvent(new CustomEvent('smyl:mila-pending-changed',{detail:{patient:s.patient,appointment:s.appointmentId||''}}));}
    catch(e){pv.error=e.message;}
    pv.busy=false;renderPrevisit(s);
  }
  function bindTabs(s){s.dialog.querySelectorAll('[data-mila-view]').forEach(function(b){b.onclick=function(){s.view=b.dataset.milaView;render();if(s.view==='clinic')createClinic(s);};});}

  function render(){
    var s=session;if(!s||!s.dialog)return;
    if(s.view==='previsit'){renderPrevisit(s);return;}
    var d=s.data||{},h=d.history,x=d.exam,phase=phaseOf(d,s),left=minutesLeft(s);
    var live=phase==='live'||d.interpreting||d.processing;
    var html='<header class="mila-iv-head"><span class="mila-iv-avatar" aria-hidden="true">'+esc(initials(s.patientName))+'</span><div class="mila-iv-title"><span class="mila-iv-kicker">MILA · ENTREVISTA CLÍNICA</span><h2 id="mila-iv-title">'+esc(s.patientName||'Paciente')+'</h2><p class="mila-iv-status" data-live="'+(live?'true':'false')+'" aria-live="polite"><span class="mila-iv-pulse" aria-hidden="true"></span>'+esc(statusLine(phase,d))+'</p></div><button type="button" class="mila-iv-icon-btn" data-mila-hide aria-label="Minimizar; la sesión sigue activa" title="Minimizar">'+ICON.close+'</button></header>';
    html+=tabs(s)+stepper(phase);
    html+='<div class="mila-iv-body">';
    if(s.error)html+='<p class="mila-iv-error" role="alert">'+esc(s.error)+'</p>';
    var alerts=alertItems(d);if(alerts.length)html+='<section class="mila-iv-alerts" role="alert"><span class="mila-iv-alerts-icon">'+ICON.alert+'</span><div><strong>Alerta para la atención</strong><ul>'+alerts.map(function(a){return '<li>'+esc(a)+'</li>';}).join('')+'</ul></div></section>';
    if(phase==='scan'){
      html+='<section class="mila-iv-pair"><div class="mila-iv-qr-frame"><div class="mila-iv-qr" role="img" aria-label="Código QR para abrir MILA en el celular">'+(s.url?qrSvg(s.url):'<span class="mila-iv-skeleton">Generando código…</span>')+'</div></div><div class="mila-iv-pair-copy"><h3>Escanea con la cámara del celular</h3><ul class="mila-iv-howto"><li>'+ICON.phone+'<span>Apunta la cámara al código y abre el enlace.</span></li><li>'+ICON.shield+'<span>Confirma el paciente y su consentimiento.</span></li><li>'+ICON.mic+'<span>MILA hace las preguntas por voz, o tú preguntas y MILA escucha.</span></li></ul><div class="mila-iv-pair-actions">'+(s.url?'<button type="button" class="mila-iv-ghost" data-mila-copy>'+ICON.link+'Copiar enlace</button><button type="button" class="mila-iv-ghost" data-mila-here>'+ICON.screen+'Usar esta computadora</button>':'')+'</div><p class="mila-iv-note">Un solo dispositivo por código'+(left!=null?' · vence en '+left+' min':'')+' · el audio no se guarda.</p></div></section>';
    }else if(phase==='expired'){
      html+='<section class="mila-iv-empty"><h3>El código venció</h3><p>Por seguridad cada código dura 90 minutos. Genera uno nuevo para continuar.</p><button type="button" class="btn btn-primary" data-mila-new>Generar código nuevo</button></section>';
    }else if(!h&&!x){
      html+='<section class="mila-iv-live"><div class="mila-iv-wave'+(phase==='live'?' is-on':'')+'" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div><h3>'+esc(phase==='consent'?'Celular conectado':phase==='live'?'Entrevista en curso':'Todo listo en el celular')+'</h3><p>'+esc(phase==='consent'?'En el celular, confirma el nombre del paciente y marca su consentimiento.':phase==='live'?'Aquí aparecerán las alertas al instante y el borrador al terminar.':'Pulsa «Iniciar entrevista» en el celular. El borrador aparecerá aquí.')+'</p></div></section>';
    }
    if(d.paired&&!s.expired){
      var mins=Math.ceil((d.audio_seconds||0)/60),tin=(d.tokens&&d.tokens.input)||0,tout=(d.tokens&&d.tokens.output)||0;
      html+='<dl class="mila-iv-stats"><div><dt>Minutos de MILA</dt><dd>'+fmt(mins)+'</dd></div><div><dt>Tokens de entrada</dt><dd>'+fmt(tin)+'</dd></div><div><dt>Tokens de salida</dt><dd>'+fmt(tout)+'</dd></div></dl>';
    }
    if(h){
      var cov=h.coverage||{},done=SECTIONS.filter(function(sec){return (cov[sec[0]]||'not_asked')!=='not_asked';}).length,pct=Math.round(done/SECTIONS.length*100);
      html+='<section class="mila-iv-card"><header><span class="mila-iv-card-icon">'+ICON.doc+'</span><div><h3>Historia clínica</h3><p>'+done+' de '+SECTIONS.length+' secciones cubiertas</p></div></header><div class="mila-iv-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'"><span style="width:'+pct+'%"></span></div><div class="mila-iv-chips">'+SECTIONS.map(function(sec){var v=cov[sec[0]]||'not_asked';return '<span data-state="'+esc(v)+'">'+esc(sec[1])+'<b>'+({yes:'Sí',no:'No',unknown:'No sabe',not_asked:'Falta'})[v]+'</b></span>';}).join('')+'</div>'
        +((h.follow_ups||[]).length?'<div class="mila-iv-follow"><strong>Falta preguntar o confirmar</strong><ul>'+h.follow_ups.map(function(f){return '<li>'+esc(f)+'</li>';}).join('')+'</ul></div>':'')
        +'<div class="mila-iv-card-actions"><button type="button" class="btn btn-primary" data-mila-history>Revisar en Historia clínica</button><span class="mila-iv-note">Abre el editor prellenado. Nada se guarda hasta que pulses «Guardar historia».</span></div></section>';
    }
    if(x){
      var findings=x.findings||[];
      html+='<section class="mila-iv-card"><header><span class="mila-iv-card-icon">'+ICON.tooth+'</span><div><h3>Exploración dictada</h3><p>'+findings.length+' hallazgo'+(findings.length===1?'':'s')+' por pieza</p></div></header>'+(findings.length?'<ul class="mila-iv-findings">'+findings.map(function(f,i){var key=f.tooth+'|'+f.surface+'|'+f.condition,applied=s.applied.has(key);return '<li><label><input type="checkbox" data-mila-finding="'+i+'"'+(applied?' disabled':' checked')+'><span class="mila-iv-tooth">'+esc(f.tooth)+'</span><span class="mila-iv-finding-copy"><strong>'+esc(f.condition)+'</strong><small>'+esc(SURFACE[f.surface]||f.surface)+' · «'+esc(f.quote)+'»</small></span>'+(f.uncertain?'<em class="mila-iv-flag">Verificar</em>':'')+(applied?'<em class="mila-iv-ok">Agregado</em>':'')+'</label></li>';}).join('')+'</ul>':'<p class="mila-iv-note">Aún no hay hallazgos por pieza.</p>')
        +((x.unplaced||[]).length?'<div class="mila-iv-follow"><strong>Sin pieza identificada</strong><ul>'+x.unplaced.map(function(u){return '<li>'+esc(u.text)+'</li>';}).join('')+'</ul></div>':'')
        +((x.general_notes||[]).length?'<div class="mila-iv-follow"><strong>Observaciones generales</strong><ul>'+x.general_notes.map(function(g){return '<li>'+esc(g.text)+'</li>';}).join('')+'</ul></div>':'')
        +(findings.length?'<div class="mila-iv-card-actions"><button type="button" class="btn btn-primary" data-mila-exam>Agregar seleccionados al odontograma</button><span class="mila-iv-note">Se agregan al borrador; guarda el odontograma para crear la versión.</span></div>':'')+'</section>';
    }
    if(s.notice)html+='<p class="mila-iv-notice" role="status">'+esc(s.notice)+'</p>';
    html+='</div><footer class="mila-iv-foot"><button type="button" class="mila-iv-link" data-mila-new>Generar código nuevo</button><button type="button" class="mila-iv-danger" data-mila-end>Terminar y borrar sesión</button></footer>';
    s.dialog.innerHTML=html;bind(s);bindTabs(s);
  }

  function alertItems(d){
    var out=(d.alerts||[]).map(function(a){return (a.label||'Alerta')+(a.detalle?': '+a.detalle:'');});
    var doc=d.history&&d.history.document;
    if(doc){(doc.allergy_records||[]).forEach(function(r){if(r.severity==='high')out.push('Alergia grave: '+r.substance+(r.reaction?' ('+r.reaction+')':''));});(doc.alerts||[]).forEach(function(a){var low=String(a).toLowerCase();if(!out.some(function(x){return x.toLowerCase().indexOf(low)>=0;}))out.push(a);});}
    return out.filter(function(v,i,a){return a.indexOf(v)===i;});
  }
  function bind(s){
    var d=s.dialog;
    d.querySelector('[data-mila-hide]').onclick=function(){d.close();};
    var copy=d.querySelector('[data-mila-copy]');if(copy)copy.onclick=function(){if(navigator.clipboard)navigator.clipboard.writeText(s.url).then(function(){s.notice='Enlace copiado. Ábrelo solo en el dispositivo de la entrevista.';render();});};
    d.querySelectorAll('[data-mila-new]').forEach(function(b){b.onclick=function(){start(s.tenant,s.patient,s.returnFocus,true);};});
    var here=d.querySelector('[data-mila-here]');if(here)here.onclick=function(){if(window.confirm('¿Usar esta computadora para la entrevista? El código dejará de servir para el celular.'))window.open(s.url,'_blank','noopener');};
    d.querySelector('[data-mila-end]').onclick=function(){if(window.confirm('¿Terminar la sesión de MILA? Lo que no hayas aplicado se borrará.'))end(true);};
    var hist=d.querySelector('[data-mila-history]');if(hist)hist.onclick=function(){
      var api=window.SmylPatientHistoryMila;
      if(!api||!api.apply(s.tenant,s.patient,s.data.history,{interviewId:s.id,consentAt:s.data.consent_at||null})){s.notice='No se pudo abrir el editor de historia. Abre la ficha del paciente y vuelve a intentar.';render();return;}
      d.close();
    };
    var exam=d.querySelector('[data-mila-exam]');if(exam)exam.onclick=function(){
      var api=window.SmylDentalProgress,findings=(s.data.exam&&s.data.exam.findings)||[],ok=0,failed=[];
      d.querySelectorAll('[data-mila-finding]:checked:not(:disabled)').forEach(function(box){
        var f=findings[Number(box.dataset.milaFinding)];if(!f)return;
        try{
          var res=api&&api.addFinding&&api.addFinding(s.tenant,s.patient,{tooth:f.tooth,surface:f.surface,conditionCode:f.condition_code,condition:f.condition,state:'active',capture:'voice',supersedes:null,sourceRef:null});
          if(res){ok++;s.applied.add(f.tooth+'|'+f.surface+'|'+f.condition);}else failed.push(f.tooth);
        }catch(e){
          if(/ya está en el borrador/i.test(String(e&&e.message))){s.applied.add(f.tooth+'|'+f.surface+'|'+f.condition);}else failed.push(f.tooth+' ('+String(e&&e.message||'error')+')');
        }
      });
      s.notice=(ok?ok+' hallazgo'+(ok===1?'':'s')+' agregado'+(ok===1?'':'s')+' al borrador del odontograma. Guárdalo para crear la versión. ':'')+(failed.length?'No se pudieron agregar: '+failed.join(', ')+'. Abre la pestaña Tratamiento (odontograma) y vuelve a intentar; los hallazgos siguen aquí.':'');
      render();
    };
  }

  async function poll(s){
    if(!stillCurrent(s)){end(true);return;}
    try{s.data=await call({action:'status',id:s.id});s.error='';
      var ready=(s.data.finished||(s.data.realtime&&s.data.realtime.finished))&&s.data.history;
      if(ready&&!s.toasted&&!s.dialog.open){s.toasted=true;toast('El borrador de MILA está listo','Revisar',function(){s.view='clinic';s.dialog.showModal();render();});}
      if(ready)dispatchEvent(new CustomEvent('smyl:mila-pending-changed',{detail:{patient:s.patient}}));}
    catch(e){if(e.status===404||e.status===410){s.expired=true;s.data=s.data||{};stop(s);}else s.error=e.message;}
    if(session===s){render();}
  }
  function stop(s){if(s&&s.timer){clearInterval(s.timer);s.timer=null;}}

  async function start(tenant,patient,returnFocus,force,view,info,extra){
    var dialog=ensureDialog();
    if(session&&!force&&session.patient===patient&&session.tenant===tenant){session.returnFocus=returnFocus;session.appointmentId=extra&&extra.appointmentId||'';session.previsitOnly=!!(extra&&extra.previsitOnly);if(info&&!session.info)session.info=info;if(view)session.view=view;if(!dialog.open)dialog.showModal();render();if(session.view==='clinic')createClinic(session);return;}
    if(session)await end(false);
    var p=info||(window.pacienteActual&&window.pacienteActual.id===patient?window.pacienteActual:null);
    var s={view:'clinic',info:p,appointmentId:extra&&extra.appointmentId||'',previsitOnly:!!(extra&&extra.previsitOnly),patientName:p?[p.nombre,p.apellido].filter(Boolean).join(' '):'',tenant:tenant,patient:patient,dialog:dialog,applied:new Set(),data:{},returnFocus:returnFocus,error:'',notice:''};
    if(view)s.view=view;session=s;if(!dialog.open)dialog.showModal();render();
    if(s.view!=='previsit')await createClinic(s);
  }
  // La sesión del QR solo se crea cuando se usa «En consultorio».
  async function createClinic(s){
    if(s.id||s.creating)return;s.creating=true;
    try{
      var created=await call({action:'create',patient_id:s.patient});
      if(session!==s)return;
      s.id=created.id;s.url=phoneUrl(created.id,created.token);s.expires=created.expires_at;
      s.timer=setInterval(function(){poll(s);},POLL_MS);
    }catch(e){if(session===s)s.error=e.message;}
    s.creating=false;if(session===s)render();
  }

  async function end(notify,keepDraft){
    var s=session;if(!s)return;session=null;stop(s);
    if(s.dialog&&s.dialog.open&&notify)s.dialog.close();
    var hasDraft=s.data&&(s.data.history||s.data.exam);
    if(s.id&&!(keepDraft&&hasDraft)){try{await call({action:'close',id:s.id});}catch(_){}}
  }

  // ---- Aviso flotante
  function toast(title,action,onClick){
    var t=document.createElement('div');t.className='mila-iv-toast';t.setAttribute('role','status');
    t.innerHTML='<span class="mila-iv-toast-dot" aria-hidden="true"></span><strong>'+esc(title)+'</strong>'+(action?'<button type="button">'+esc(action)+'</button>':'')+'<button type="button" class="x" aria-label="Cerrar aviso">×</button>';
    document.body.append(t);var b=t.querySelector('button:not(.x)');if(b)b.onclick=function(){t.remove();onClick&&onClick();};t.querySelector('.x').onclick=function(){t.remove();};
    setTimeout(function(){t.remove();},20000);
  }

  // ---- Borradores pendientes en la Historia clínica (consultorio sin guardar o entrevista previa respondida)
  var pendingCache={};
  function fmtDate(v){try{return new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(v));}catch(_){return '';}}
  async function renderPending(host,tenant,patient){
    if(!host||!tenant||!patient||!window.sb)return;
    var key=tenant+'|'+patient,cached=pendingCache[key],items;
    try{
      if(cached&&Date.now()-cached.at<15000)items=cached.items;
      else{items=(await call({action:'pending',patient_id:patient})).items||[];pendingCache[key]={at:Date.now(),items:items};}
    }catch(_){return;}
    items=items.filter(function(it){return it.kind==='previsit'||(it.has_history&&it.finished);});
    var old=host.querySelector('.mila-pending');if(old)old.remove();
    if(!host.isConnected||!items.length||(window.pacienteActual&&window.pacienteActual.id!==patient))return;
    var box=document.createElement('section');box.className='mila-pending';box.setAttribute('aria-label','Respuestas de MILA pendientes');
    box.innerHTML=items.map(function(it){
      var ready=it.has_history&&it.finished,cov=it.coverage||{},n=Object.keys(cov).filter(function(k){return cov[k]&&cov[k]!=='not_asked';}).length;
      var src=it.kind==='previsit'?(it.source==='form'?'Formulario previo a la cita':'Entrevista previa con MILA'):'Entrevista con MILA en consultorio';
      var line=ready?(n+' de 7 temas'+(it.alerts&&it.alerts.length?' · <b class="mila-pending-alert">'+it.alerts.length+' alerta'+(it.alerts.length>1?'s':'')+'</b>':'')+(it.consent_at?' · consentimiento '+esc(fmtDate(it.consent_at)):'')):(it.kind==='previsit'?'Enviada '+esc(fmtDate(it.created_at))+(it.appointment?' para la cita del '+esc(it.appointment):'')+' · aún sin responder':'En curso');
      return '<div class="mila-pending-item" data-ready="'+ready+'"><span class="mila-pending-ic" aria-hidden="true">'+(ready?ICON.doc:ICON.phone)+'</span><div><strong>'+esc(ready?(it.kind==='previsit'?'El paciente respondió: '+src:'Borrador de MILA sin guardar'):src)+'</strong><p>'+line+'</p></div>'
        +(ready?'<button type="button" class="btn btn-primary" data-mila-review="'+esc(it.id)+'">Revisar y llenar historia</button>':'')
        +'<button type="button" class="mila-iv-link" data-mila-discard="'+esc(it.id)+'">'+(ready?'Descartar':'Cancelar envío')+'</button></div>';
    }).join('');
    var article=host.querySelector('.p360-hc')||host;article.insertBefore(box,article.children[1]||null);
    box.querySelectorAll('[data-mila-review]').forEach(function(b){b.onclick=async function(){
      b.disabled=true;
      try{var st=await call({action:'status',id:b.dataset.milaReview});var api=window.SmylPatientHistoryMila;
        if(!st.history||!api||!api.apply(tenant,patient,st.history,{interviewId:b.dataset.milaReview,consentAt:st.consent_at||null}))throw new Error('No se pudo abrir el editor.');}
      catch(e){b.disabled=false;alert(e.message);}
    };});
    box.querySelectorAll('[data-mila-discard]').forEach(function(b){b.onclick=async function(){
      if(!window.confirm('¿Descartar estas respuestas de MILA? No se podrán recuperar.'))return;
      try{await call({action:'close',id:b.dataset.milaDiscard});}catch(_){}
      delete pendingCache[key];renderPending(host,tenant,patient);
    };});
  }
  addEventListener('smyl:mila-pending-changed',function(e){if(e.detail&&e.detail.patient){Object.keys(pendingCache).forEach(function(k){if(k.indexOf(e.detail.patient)>=0)delete pendingCache[k];});}});
  // Al guardar la historia con un borrador de MILA, la sesión se cierra y se borra la transcripción.
  addEventListener('smyl:mila-history-saved',async function(e){var id=e.detail&&e.detail.interviewId;if(!id)return;
    try{await call({action:'close',id:id});}catch(_){}
    if(session&&session.id===id){stop(session);session.id=null;session=null;}
    Object.keys(pendingCache).forEach(function(k){delete pendingCache[k];});
  });

  window.SmylMilaInterview=Object.freeze({
    open:function(opts){
      opts=opts||{};
      var tenant=opts.tenant||window.tenantId,patient=opts.patient||(window.pacienteActual&&window.pacienteActual.id);
      if(!tenant||!patient||!window.sb||!window.SUPA_URL)return false;
      // Desde la agenda no se interrumpe una entrevista en consultorio de otro paciente.
      if(opts.previsitOnly&&session&&session.id&&session.patient!==patient){toast('Hay una entrevista de MILA en curso en consultorio. Termínala antes de enviar otra.');return false;}
      start(tenant,patient,opts.returnFocus||document.activeElement,false,opts.view||null,opts.patientInfo||null,{appointmentId:opts.appointmentId||'',previsitOnly:!!opts.previsitOnly});return true;
    },
    end:function(){return end(true);},
    renderPending:renderPending
  });
  // Al cambiar de paciente o cerrar la pestaña, la sesión se vacía en el servidor.
  addEventListener('smyl:patient-context-updated',function(e){if(session&&e.detail&&e.detail.patient!==session.patient)end(true,true);});
  addEventListener('pagehide',function(){var s=session;if(!s||!s.id)return;stop(s);});
})();
