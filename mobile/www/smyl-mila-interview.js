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

  function render(){
    var s=session;if(!s||!s.dialog)return;
    var d=s.data||{},h=d.history,x=d.exam;
    var steps=[[!!d.paired,'Celular vinculado'],[!!d.consent,'Consentimiento del paciente'],[(d.segments||0)>0,(d.segments||0)+' segmento'+(d.segments===1?'':'s')+' procesado'+(d.segments===1?'':'s')]];
    var html='<header class="mila-iv-head"><div><span class="mila-iv-kicker">MILA EN TU CELULAR</span><h2 id="mila-iv-title">Entrevista y exploración por voz</h2></div><button type="button" class="btn btn-secondary" data-mila-hide>Minimizar</button></header>';
    if(s.error)html+='<p class="mila-iv-error" role="alert">'+esc(s.error)+'</p>';
    if(!d.paired){
      html+='<div class="mila-iv-pair"><div class="mila-iv-qr" aria-label="Código QR para abrir MILA en el celular">'+(s.url?qrSvg(s.url):'<span>Generando…</span>')+'</div><div><ol class="mila-iv-howto"><li>Abre la cámara de tu celular y escanea el código.</li><li>Pide al paciente su consentimiento para grabar.</li><li>Haz las preguntas de la guía; MILA llena el borrador aquí.</li><li>Después dicta la exploración diente por diente.</li></ol>'+(s.url?'<button type="button" class="btn btn-secondary" data-mila-copy>Copiar enlace</button>':'')+'<p class="mila-iv-note">El código sirve para un solo celular y vence a los 90 minutos. No se guarda el audio.</p></div></div>';
    }
    html+='<ul class="mila-iv-steps">'+steps.map(function(st){return '<li data-done="'+st[0]+'">'+esc(st[1])+'</li>';}).join('')+'</ul>';
    if(d.paired)html+='<p class="mila-iv-usage" aria-live="polite">Consumo de esta sesión: <strong>'+fmt(Math.ceil((d.audio_seconds||0)/60))+' min</strong> de MILA · <strong>'+fmt((d.tokens&&d.tokens.input)||0)+'</strong> tokens de entrada · <strong>'+fmt((d.tokens&&d.tokens.output)||0)+'</strong> de salida'+(d.processing?' · <em>procesando…</em>':'')+'</p>';
    // Historia
    if(h){
      var cov=h.coverage||{};
      html+='<section class="mila-iv-block"><h3>Historia clínica</h3><div class="mila-iv-chips">'+SECTIONS.map(function(sec){var v=cov[sec[0]]||'not_asked';return '<span data-state="'+esc(v)+'">'+esc(sec[1])+' · '+({yes:'Sí',no:'No',unknown:'No sabe',not_asked:'Falta'})[v]+'</span>';}).join('')+'</div>'
        +((h.follow_ups||[]).length?'<p class="mila-iv-follow"><strong>Falta preguntar:</strong> '+h.follow_ups.map(esc).join(' · ')+'</p>':'')
        +'<button type="button" class="btn btn-primary" data-mila-history>Revisar en Historia clínica</button><p class="mila-iv-note">Se abrirá el editor con los datos sugeridos. Revisa y pulsa «Guardar historia».</p></section>';
    }
    // Exploración
    if(x){
      var findings=x.findings||[];
      html+='<section class="mila-iv-block"><h3>Exploración dictada</h3>'+(findings.length?'<ul class="mila-iv-findings">'+findings.map(function(f,i){var key=f.tooth+'|'+f.surface+'|'+f.condition,done=s.applied.has(key);return '<li><label><input type="checkbox" data-mila-finding="'+i+'"'+(done?' disabled':' checked')+'><span><strong>'+esc(f.tooth)+' · '+esc(SURFACE[f.surface]||f.surface)+'</strong> '+esc(f.condition)+(f.uncertain?' <em class="mila-iv-flag">Verificar</em>':'')+(done?' <em class="mila-iv-ok">Agregado</em>':'')+'<small>«'+esc(f.quote)+'»</small></span></label></li>';}).join('')+'</ul>':'<p>Aún no hay hallazgos por pieza.</p>')
        +((x.unplaced||[]).length?'<p class="mila-iv-follow"><strong>Sin pieza identificada:</strong> '+x.unplaced.map(function(u){return esc(u.text);}).join(' · ')+'</p>':'')
        +((x.general_notes||[]).length?'<p class="mila-iv-follow"><strong>Observaciones generales:</strong> '+x.general_notes.map(function(g){return esc(g.text);}).join(' · ')+'</p>':'')
        +(findings.length?'<button type="button" class="btn btn-primary" data-mila-exam>Agregar seleccionados al odontograma</button><p class="mila-iv-note">Se agregan al borrador del odontograma. Guarda el odontograma para crear la versión.</p>':'')+'</section>';
    }
    if(s.notice)html+='<p class="mila-iv-notice" role="status">'+esc(s.notice)+'</p>';
    html+='<footer class="mila-iv-foot"><button type="button" class="btn btn-secondary" data-mila-new>Nuevo código</button><button type="button" class="btn btn-secondary" data-mila-end>Terminar y borrar sesión</button></footer>';
    s.dialog.innerHTML=html;bind(s);
  }

  function bind(s){
    var d=s.dialog;
    d.querySelector('[data-mila-hide]').onclick=function(){d.close();};
    var copy=d.querySelector('[data-mila-copy]');if(copy)copy.onclick=function(){if(navigator.clipboard)navigator.clipboard.writeText(s.url).then(function(){s.notice='Enlace copiado. Ábrelo solo en tu celular.';render();});};
    d.querySelector('[data-mila-new]').onclick=function(){start(s.tenant,s.patient,s.returnFocus,true);};
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
    catch(e){if(e.status===404||e.status===410){s.error='La sesión venció. Genera un código nuevo.';s.data=s.data||{};stop(s);}else s.error=e.message;}
    if(session===s){render();}
  }
  function stop(s){if(s&&s.timer){clearInterval(s.timer);s.timer=null;}}

  async function start(tenant,patient,returnFocus,force){
    var dialog=ensureDialog();
    if(session&&!force&&session.patient===patient&&session.tenant===tenant){session.returnFocus=returnFocus;if(!dialog.open)dialog.showModal();render();return;}
    if(session)await end(false);
    var s={tenant:tenant,patient:patient,dialog:dialog,applied:new Set(),data:{},returnFocus:returnFocus,error:'',notice:''};
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
