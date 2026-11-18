(function(){
  'use strict';
  function esc(value){var d=document.createElement('div');d.textContent=String(value||'');return d.innerHTML;}
  async function token(){var r=await sb.auth.getSession();var t=r&&r.data&&r.data.session&&r.data.session.access_token;if(!t)throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');return t;}
  async function request(action,conversationId,patientId){
    var headers={Authorization:'Bearer '+await token(),apikey:SUPA_KEY,'Content-Type':'application/json'};
    if(action==='confirm')headers['Idempotency-Key']=crypto.randomUUID();
    var response=await fetch(SUPA_URL+'/functions/v1/lana-inbox',{method:'POST',headers:headers,body:JSON.stringify({action:action==='preview'?'patient_link_preview':'patient_link_confirm',conversation_id:conversationId,patient_id:patientId||null})});
    var data=await response.json().catch(function(){return {};});if(!response.ok)throw new Error(data.error||'No se pudo preparar el expediente desde esta conversación.');return data;
  }
  function modal(){return document.getElementById('lana-handoff-overlay');}
  function close(){var m=modal();if(m)m.hidden=true;}

  // «← Volver al chat»: al abrir el expediente desde una conversación, un botón flotante regresa a Mensajes.
  var backButton=null,routeWrapped=false;
  function hideBack(){if(backButton){backButton.remove();backButton=null;}}
  function showBack(){
    hideBack();
    var button=document.createElement('button');button.type='button';button.className='lana-handoff-back';button.textContent='← Volver al chat';
    button.onclick=function(){hideBack();if(typeof window.ir==='function')window.ir('inbox');};
    document.body.appendChild(button);backButton=button;
    if(!routeWrapped&&typeof window.ir==='function'){routeWrapped=true;var previous=window.ir;window.ir=function(route){if(route!=='pacientes')hideBack();return previous.apply(this,arguments);};}
  }
  async function openPatient(patientId,fromConversation){
    await cargarPacientes();close();verPaciente(patientId);
    if(fromConversation)showBack();
  }

  function personLabel(p){return [p.phone||p.telefono,p.email].filter(Boolean).join(' · ');}
  function choice(value,title,detail){return '<label class="lana-handoff-candidate"><input type="radio" name="lana-patient" value="'+esc(value)+'" data-name="'+esc(title)+'"><span><strong>'+esc(title)+'</strong>'+(detail?'<br><small>'+esc(detail)+'</small>':'')+'</span></label>';}
  function fullName(p){return [p.nombre,p.apellido].filter(Boolean).join(' ')||'Paciente';}

  // Busca pacientes que ya existen (nombre, teléfono o correo) para vincularlos cuando el chat no trae datos de contacto.
  async function searchPatients(term){
    var tokens=String(term||'').trim().split(/\s+/).map(function(t){return t.replace(/[^\p{L}\p{N}@.+_-]/gu,'');}).filter(Boolean).slice(0,4);
    if(tokens.join('').length<2)return null;
    if(!window.sb||!window.tenantId)throw new Error('sin sesión');
    var query=window.sb.from('camila_pacientes').select('id,nombre,apellido,telefono,email').eq('tenant_id',window.tenantId);
    tokens.forEach(function(t){query=query.or('nombre.ilike.%'+t+'%,apellido.ilike.%'+t+'%,telefono.ilike.%'+t+'%,email.ilike.%'+t+'%');});
    var result=await query.order('nombre').limit(8);
    if(result.error)throw result.error;
    return result.data||[];
  }

  function render(data){
    var body=document.getElementById('lana-handoff-body'),actions=document.getElementById('lana-handoff-actions'),c=data.conversation||{};
    var hasContact=Boolean(c.phone||c.email),candidates=data.candidates||[];
    var contact=[c.phone,c.email].filter(Boolean).join(' · ')||'Sin teléfono ni correo';
    var headline=candidates.length?'¿Es alguno de estos pacientes?':hasContact?'No encontramos un paciente con estos datos.':'Esta persona no dejó teléfono ni correo, así que no podemos sugerir coincidencias.';
    body.innerHTML='<div class="lana-handoff-person"><span class="lana-handoff-avatar">'+esc((c.name||'P').charAt(0).toUpperCase())+'</span><div><strong>'+esc(c.name||'Paciente')+'</strong><small>'+esc(c.channel||'')+' · '+esc(contact)+'</small></div></div>'+
      '<p class="lana-handoff-copy"><strong>'+esc(headline)+'</strong> Busca uno que ya exista o crea uno nuevo con los datos de este chat.</p>'+
      (candidates.length?'<div class="lana-handoff-candidates"><strong>Coincidencias</strong>'+candidates.map(function(p){return choice(p.id,p.name,personLabel(p));}).join('')+'</div>':'')+
      '<div class="lana-handoff-search"><label for="lana-handoff-search"><strong>Buscar otro paciente</strong></label><input id="lana-handoff-search" type="search" placeholder="Nombre, teléfono o correo" autocomplete="off"><div id="lana-handoff-results" class="lana-handoff-candidates" aria-live="polite"></div></div>'+
      '<div class="lana-handoff-candidates">'+choice('','Crear paciente nuevo','Solo se copiarán nombre y datos de contacto; el historial de mensajes permanece protegido en su canal.')+'</div>'+
      '<div class="lana-handoff-note">Crear el expediente no envía mensajes ni comparte diagnósticos, simulaciones o propuestas con el paciente.</div>';
    var newOption=body.querySelector('input[name="lana-patient"][value=""]');
    if(!candidates.length)newOption.checked=true;
    actions.innerHTML='<button type="button" class="btn btn-primary" data-lana-confirm></button>';
    var confirm=actions.querySelector('[data-lana-confirm]');
    function refresh(){
      var chosen=document.querySelector('input[name="lana-patient"]:checked');
      if(!chosen){confirm.disabled=true;confirm.textContent='Elige una opción';return;}
      confirm.disabled=false;confirm.textContent=chosen.value?'Vincular a '+(chosen.dataset.name||'este paciente'):'Crear paciente nuevo';
    }
    body.addEventListener('change',refresh);
    var input=body.querySelector('#lana-handoff-search'),results=body.querySelector('#lana-handoff-results'),timer=null,sequence=0;
    input.addEventListener('input',function(){
      clearTimeout(timer);var mine=++sequence;
      timer=setTimeout(async function(){
        try{
          var rows=await searchPatients(input.value);if(mine!==sequence)return;
          if(rows===null){results.innerHTML='';return;}
          results.innerHTML=rows.length?rows.map(function(p){return choice(p.id,fullName(p),personLabel(p));}).join(''):'<p class="lana-handoff-state">No encontramos pacientes con ese dato.</p>';
        }catch(error){if(mine===sequence)results.innerHTML='<p class="lana-handoff-state">No pudimos buscar ahora. Inténtalo de nuevo.</p>';}
      },250);
    });
    confirm.onclick=function(){confirmLink(data);};
    refresh();
  }
  async function confirmLink(data){
    var button=document.querySelector('[data-lana-confirm]'),selected=document.querySelector('input[name="lana-patient"]:checked');
    if(!selected)return;
    var label=button.textContent;button.disabled=true;button.textContent='Vinculando…';
    try{var result=await request('confirm',data.conversation.id,selected.value);await openPatient(result.link.patient_id,data.conversation.id);}
    catch(error){var old=document.querySelector('#lana-handoff-body [data-tone="error"]');if(old)old.remove();document.getElementById('lana-handoff-body').insertAdjacentHTML('beforeend','<p class="connections-form-message" data-tone="error">'+esc(error.message)+'</p>');button.disabled=false;button.textContent=label;}
  }
  async function open(conversationId){
    if(!/^[0-9a-f-]{36}$/i.test(String(conversationId||'')))return;
    var m=modal();m.hidden=false;document.getElementById('lana-handoff-body').innerHTML=window.SmylSkeleton?window.SmylSkeleton.html('list',{rows:2,plain:true,label:'Consultando la identidad del contacto'}):'<p class="lana-handoff-state">Consultando la identidad del contacto…</p>';document.getElementById('lana-handoff-actions').innerHTML='';history.replaceState(null,'',location.pathname);
    try{
      var data=await request('preview',conversationId);
      // Ya vinculada: no hay nada que decidir, se abre el expediente directamente.
      if(data.existing_link&&data.existing_link.patient_id){await openPatient(data.existing_link.patient_id,conversationId);return;}
      render(data);
    }catch(error){document.getElementById('lana-handoff-body').innerHTML='<p class="lana-handoff-state">'+esc(error.message)+'</p>';}
  }
  function init(){
    var overlay=document.createElement('div');overlay.id='lana-handoff-overlay';overlay.className='lana-handoff-overlay';overlay.hidden=true;overlay.innerHTML='<section class="lana-handoff-dialog" role="dialog" aria-modal="true" aria-labelledby="lana-handoff-title"><header class="lana-handoff-head"><div><span class="lana-handoff-kicker">SMYL CHAT</span><h2 id="lana-handoff-title">Vincular paciente</h2></div><button type="button" class="lana-handoff-close" aria-label="Cerrar">×</button></header><div class="lana-handoff-body" id="lana-handoff-body"></div><footer class="lana-handoff-actions" id="lana-handoff-actions"></footer></section>';document.body.appendChild(overlay);overlay.querySelector('.lana-handoff-close').onclick=close;overlay.onclick=function(e){if(e.target===overlay)close();};
  }
  window.SmylLanaHandoff={open:open,close:close,openPatient:openPatient};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
