/* SMYL · Etapa 2: continuidad profesional del expediente y odontograma. */
(function(){
  'use strict';
  var scheduled=false,lastSignature='';
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(char){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char];});}
  function text(root,selector,fallback){var node=root.querySelector(selector);return node&&node.textContent.trim()||fallback;}
  function openTab(key){return window.SmylPatient360&&window.SmylPatient360.open&&window.SmylPatient360.open(key);}
  function scrollTo(id){var target=document.getElementById(id);if(!target)return false;target.scrollIntoView({behavior:'smooth',block:'start'});return true;}
  function count(root,selector){return root.querySelectorAll(selector).length;}
  function nextAction(historyReady,teeth,plan){
    if(!historyReady)return {label:'Completar antecedentes',copy:'Confirma alertas, alergias y condiciones médicas con el paciente.',action:'history'};
    if(!teeth)return {label:'Revisar odontograma',copy:'Registra únicamente hallazgos comprobados durante la valoración.',action:'p360-dental'};
    if(!plan)return {label:'Construir plan',copy:'Relaciona los hallazgos revisados con las opciones de tratamiento.',action:'p360-plan'};
    return {label:'Registrar evolución',copy:'El expediente está preparado para documentar la siguiente atención.',action:'notes'};
  }
  function render(){
    scheduled=false;
    var screen=document.getElementById('p-paciente-detalle'),root=screen&&screen.querySelector('.p360-root'),overview=root&&root.querySelector('[data-p360-panel="overview"]');
    if(!overview||overview.hidden)return;
    var history=text(overview,'.p360-metrics article:first-child strong','Pendientes'),historyReady=/registrados/i.test(history);
    var alerts=count(overview,'.p360-alerts span'),teeth=count(screen,'.dr-map .dr-tooth.dr-noted'),following=count(screen,'.dr-map .dr-tooth.dr-following'),done=count(screen,'.dr-map .dr-tooth.dr-done');
    var plan=count(screen,'.clinic-treatment'),targeted=count(screen,'.clinic-treatment-target-summary:not(:empty)'),signed=count(overview,'.p360-timeline i[data-type="clinical_note"]');
    var action=nextAction(historyReady,teeth,plan),signature=[history,alerts,teeth,following,done,plan,targeted,signed,action.action].join('|');
    var host=overview.querySelector('.patient-record-stage2');
    if(host&&lastSignature===signature)return;
    if(!host){host=document.createElement('section');host.className='patient-record-stage2';var alertsBox=overview.querySelector('.p360-alerts');if(alertsBox)alertsBox.after(host);else overview.prepend(host);}
    lastSignature=signature;
    host.innerHTML='<header><div><span>ESTADO CLÍNICO ACTUAL</span><h2>Expediente y odontograma</h2><p>Una lectura operativa del registro. El profesional confirma cada hallazgo y decisión.</p></div><button type="button" class="patient-record-next" data-record-action="'+esc(action.action)+'"><small>Siguiente acción</small><strong>'+esc(action.label)+'</strong><span>'+esc(action.copy)+'</span></button></header><div class="patient-record-grid"><button type="button" data-record-action="history" data-state="'+(historyReady?'ready':'pending')+'"><span>Antecedentes</span><strong>'+esc(history)+'</strong><small>'+alerts+' '+(alerts===1?'alerta visible':'alertas visibles')+'</small></button><button type="button" data-record-action="p360-dental" data-state="'+(teeth?'active':'pending')+'"><span>Odontograma</span><strong>'+teeth+' '+(teeth===1?'pieza anotada':'piezas anotadas')+'</strong><small>'+following+' en seguimiento · '+done+' realizadas</small></button><button type="button" data-record-action="p360-plan" data-state="'+(plan?'active':'pending')+'"><span>Plan de tratamiento</span><strong>'+plan+' '+(plan===1?'intervención':'intervenciones')+'</strong><small>'+targeted+' con piezas o superficies</small></button><button type="button" data-record-action="notes" data-state="'+(signed?'ready':'pending')+'"><span>Seguimiento</span><strong>'+signed+' '+(signed===1?'evolución reciente':'evoluciones recientes')+'</strong><small>Las notas firmadas permanecen inmutables</small></button></div>';
    host.querySelectorAll('[data-record-action]').forEach(function(button){button.onclick=function(){var key=button.dataset.recordAction;if(key==='history'||key==='notes')openTab(key);else if(!scrollTo(key)){root.scrollIntoView({behavior:'smooth',block:'start'});}};});
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(render);}
  function init(){var screen=document.getElementById('p-paciente-detalle');if(!screen)return;new MutationObserver(schedule).observe(screen,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','hidden']});addEventListener('smyl:dental-context-updated',schedule);schedule();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
