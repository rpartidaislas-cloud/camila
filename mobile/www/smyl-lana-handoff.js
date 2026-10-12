(function(){
  'use strict';
  function esc(value){var d=document.createElement('div');d.textContent=String(value||'');return d.innerHTML;}
  async function token(){var r=await sb.auth.getSession();var t=r&&r.data&&r.data.session&&r.data.session.access_token;if(!t)throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');return t;}
  async function request(action,conversationId,patientId){
    var response=await fetch(SUPA_URL+'/functions/v1/lana-handoff',{method:'POST',headers:{Authorization:'Bearer '+await token(),apikey:SUPA_KEY,'Content-Type':'application/json'},body:JSON.stringify({action:action,conversation_id:conversationId,patient_id:patientId||null})});
    var data=await response.json().catch(function(){return {};});if(!response.ok)throw new Error(data.error||'No se pudo abrir la conversación de LANA.');return data;
  }
  function modal(){return document.getElementById('lana-handoff-overlay');}
  function close(){var m=modal();if(m)m.hidden=true;}
  function render(data){
    var body=document.getElementById('lana-handoff-body'),actions=document.getElementById('lana-handoff-actions'),c=data.conversation||{},existing=data.existing_link;
    var contact=[c.phone,c.email].filter(Boolean).join(' · ')||'Contacto disponible solo en LANA';
    var candidates=(data.candidates||[]).map(function(p,i){return '<label class="lana-handoff-candidate"><input type="radio" name="lana-patient" value="'+esc(p.id)+'" '+(i===0?'checked':'')+'><span><strong>'+esc(p.name)+'</strong><br><small>'+esc([p.phone,p.email].filter(Boolean).join(' · '))+'</small></span></label>';}).join('');
    body.innerHTML='<div class="lana-handoff-person"><span class="lana-handoff-avatar">'+esc((c.name||'P').charAt(0).toUpperCase())+'</span><div><strong>'+esc(c.name||'Paciente de LANA')+'</strong><small>'+esc(c.channel||'')+' · '+esc(contact)+'</small></div></div>'+
      (existing?'<p class="lana-handoff-copy">Esta conversación ya está vinculada. Abriremos el expediente existente; no se creará ningún duplicado.</p>':'<p class="lana-handoff-copy">Revisa la identidad antes de crear el caso. Solo se copiarán nombre y datos de contacto; el historial del chat permanece en LANA.</p>')+
      (!existing&&candidates?'<div class="lana-handoff-candidates"><strong>Expediente coincidente</strong>'+candidates+'<label class="lana-handoff-candidate"><input type="radio" name="lana-patient" value=""><span><strong>Crear paciente nuevo</strong><br><small>Úsalo solo si ninguna coincidencia corresponde a esta persona.</small></span></label></div>':'')+
      '<div class="lana-handoff-note">Crear el expediente no envía mensajes ni comparte diagnósticos, simulaciones o propuestas con el paciente.</div>';
    actions.innerHTML='<button type="button" class="btn btn-primary" data-lana-confirm>'+(existing?'Abrir expediente':'Crear o vincular expediente')+'</button>';
    actions.querySelector('[data-lana-confirm]').onclick=function(){confirmLink(data);};
  }
  async function confirmLink(data){
    if(data.existing_link){await openPatient(data.existing_link.patient_id);return;}
    var button=document.querySelector('[data-lana-confirm]'),selected=document.querySelector('input[name="lana-patient"]:checked');button.disabled=true;button.textContent='Preparando expediente…';
    try{var result=await request('confirm',data.conversation.id,selected&&selected.value);await openPatient(result.link.patient_id);}
    catch(error){document.getElementById('lana-handoff-body').insertAdjacentHTML('beforeend','<p class="connections-form-message" data-tone="error">'+esc(error.message)+'</p>');button.disabled=false;button.textContent='Crear o vincular expediente';}
  }
  async function openPatient(patientId){await cargarPacientes();close();verPaciente(patientId);}
  async function open(conversationId){
    if(!/^[0-9a-f-]{36}$/i.test(String(conversationId||'')))return;
    var m=modal();m.hidden=false;document.getElementById('lana-handoff-body').innerHTML='<p class="lana-handoff-state">Consultando la identidad en LANA…</p>';document.getElementById('lana-handoff-actions').innerHTML='';history.replaceState(null,'',location.pathname);
    try{render(await request('preview',conversationId));}catch(error){document.getElementById('lana-handoff-body').innerHTML='<p class="lana-handoff-state">'+esc(error.message)+'</p>';}
  }
  function init(){
    var overlay=document.createElement('div');overlay.id='lana-handoff-overlay';overlay.className='lana-handoff-overlay';overlay.hidden=true;overlay.innerHTML='<section class="lana-handoff-dialog" role="dialog" aria-modal="true" aria-labelledby="lana-handoff-title"><header class="lana-handoff-head"><div><span class="lana-handoff-kicker">SMYL CHAT</span><h2 id="lana-handoff-title">Preparar expediente clínico</h2></div><button type="button" class="lana-handoff-close" aria-label="Cerrar">×</button></header><div class="lana-handoff-body" id="lana-handoff-body"></div><footer class="lana-handoff-actions" id="lana-handoff-actions"></footer></section>';document.body.appendChild(overlay);overlay.querySelector('.lana-handoff-close').onclick=close;overlay.onclick=function(e){if(e.target===overlay)close();};
  }
  window.SmylLanaHandoff={open:open,close:close};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
