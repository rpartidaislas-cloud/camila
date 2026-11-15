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
    d.addEventListener('close',function(){if(session&&session.returnFocus&&session.returnFocus.focus)session.returnFocus.focus();});
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
  function render(){
    var s=session;if(!s||!s.dialog)return;
    var d=s.data||{},h=d.history,x=d.exam,phase=phaseOf(d,s),left=minutesLeft(s);
    var live=phase==='live'||d.interpreting||d.processing;
    var html='<header class="mila-iv-head"><span class="mila-iv-avatar" aria-hidden="true">'+esc(initials(s.patientName))+'</span><div class="mila-iv-title"><span class="mila-iv-kicker">MILA · ENTREVISTA CLÍNICA</span><h2 id="mila-iv-title">'+esc(s.patientName||'Paciente')+'</h2><p class="mila-iv-status" data-live="'+(live?'true':'false')+'" aria-live="polite"><span class="mila-iv-pulse" aria-hidden="true"></span>'+esc(statusLine(phase,d))+'</p></div><button type="button" class="mila-iv-icon-btn" data-mila-hide aria-label="Minimizar; la sesión sigue activa" title="Minimizar">'+ICON.close+'</button></header>';
    html+=stepper(phase);
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
    s.dialog.innerHTML=html;bind(s);
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
      if(!api||!api.apply(s.tenant,s.patient,s.data.history)){s.notice='No se pudo abrir el editor de historia. Abre la ficha del paciente y vuelve a intentar.';render();return;}
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
    try{s.data=await call({action:'status',id:s.id});s.error='';}
    catch(e){if(e.status===404||e.status===410){s.expired=true;s.data=s.data||{};stop(s);}else s.error=e.message;}
    if(session===s){render();}
  }
  function stop(s){if(s&&s.timer){clearInterval(s.timer);s.timer=null;}}

  async function start(tenant,patient,returnFocus,force){
    var dialog=ensureDialog();
    if(session&&!force&&session.patient===patient&&session.tenant===tenant){session.returnFocus=returnFocus;if(!dialog.open)dialog.showModal();render();return;}
    if(session)await end(false);
    var p=window.pacienteActual&&window.pacienteActual.id===patient?window.pacienteActual:null;
    var s={patientName:p?[p.nombre,p.apellido].filter(Boolean).join(' '):'',tenant:tenant,patient:patient,dialog:dialog,applied:new Set(),data:{},returnFocus:returnFocus,error:'',notice:''};
    session=s;if(!dialog.open)dialog.showModal();render();
    try{
      var created=await call({action:'create',patient_id:patient});
      if(session!==s)return;
      s.id=created.id;s.url=phoneUrl(created.id,created.token);s.expires=created.expires_at;
      s.timer=setInterval(function(){poll(s);},POLL_MS);
    }catch(e){if(session===s)s.error=e.message;}
    render();
  }

  async function end(notify){
    var s=session;if(!s)return;session=null;stop(s);
    if(s.dialog&&s.dialog.open&&notify)s.dialog.close();
    if(s.id){try{await call({action:'close',id:s.id});}catch(_){}}
  }

  window.SmylMilaInterview=Object.freeze({
    open:function(opts){
      opts=opts||{};
      var tenant=opts.tenant||window.tenantId,patient=opts.patient||(window.pacienteActual&&window.pacienteActual.id);
      if(!tenant||!patient||!window.sb||!window.SUPA_URL)return false;
      start(tenant,patient,opts.returnFocus||document.activeElement,false);return true;
    },
    end:function(){return end(true);}
  });
  // Al cambiar de paciente o cerrar la pestaña, la sesión se vacía en el servidor.
  addEventListener('smyl:patient-context-updated',function(e){if(session&&e.detail&&e.detail.patient!==session.patient)end(true);});
  addEventListener('pagehide',function(){var s=session;if(!s||!s.id)return;stop(s);});
})();
