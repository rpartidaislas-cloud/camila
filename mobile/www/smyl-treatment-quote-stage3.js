/* SMYL · Etapa 3: control de integridad del plan y la cotización. */
(function(){
  'use strict';
  var scheduled=false,last='';
  function metadata(row){try{return JSON.parse(row.dataset.itemMeta||'{}');}catch(_){return {};}}
  function status(){
    scheduled=false;
    var form=document.getElementById('proposal-form'),items=document.getElementById('proposal-items');
    if(!form||!items)return;
    var rows=Array.from(items.querySelectorAll('.proposal-item')),mapped=0,missingPrice=0,fiscalPending=0;
    rows.forEach(function(row){var meta=metadata(row),price=row.querySelector('[data-field="price"]');if(Array.isArray(meta.teeth)&&meta.teeth.length)mapped++;if(!price||price.value.trim()==='')missingPrice++;if(meta.service_snapshot&&meta.service_snapshot.fiscal_status!=='reviewed')fiscalPending++;});
    var action=missingPrice?'Completar precios':fiscalPending?'Revisar información fiscal':rows.length&&!mapped?'Relacionar piezas':'Revisar y guardar';
    var copy=missingPrice?'Toda propuesta aprobada necesita importes definidos.':fiscalPending?'Confirma las claves fiscales con el responsable de la clínica.':rows.length&&!mapped?'Los tratamientos generales son válidos; vincula piezas cuando corresponda.':'El plan, el mapa y los importes están preparados para revisión.';
    var signature=[rows.length,mapped,missingPrice,fiscalPending,action].join('|'),host=form.querySelector('.quote-readiness-stage3');
    if(host&&last===signature)return;
    if(!host){host=document.createElement('section');host.className='quote-readiness-stage3';items.before(host);}
    last=signature;
    host.innerHTML='<header><div><span>CONTROL DE PROPUESTA</span><strong>'+action+'</strong><p>'+copy+'</p></div><button type="button">Ir al pendiente</button></header><div><article data-state="'+(rows.length?'ready':'pending')+'"><span>Conceptos</span><strong>'+rows.length+'</strong></article><article data-state="'+(mapped?'ready':'neutral')+'"><span>Con mapa dental</span><strong>'+mapped+'</strong></article><article data-state="'+(missingPrice?'pending':'ready')+'"><span>Precios pendientes</span><strong>'+missingPrice+'</strong></article><article data-state="'+(fiscalPending?'pending':'ready')+'"><span>Fiscal pendiente</span><strong>'+fiscalPending+'</strong></article></div>';
    host.querySelector('button').onclick=function(){var target;if(missingPrice)target=rows.find(function(row){var input=row.querySelector('[data-field="price"]');return !input||!input.value.trim();});else if(fiscalPending)target=rows.find(function(row){var meta=metadata(row);return meta.service_snapshot&&meta.service_snapshot.fiscal_status!=='reviewed';});else if(rows.length&&!mapped)target=rows[0];else target=document.getElementById('proposal-save');if(target){target.scrollIntoView({behavior:'smooth',block:'center'});var input=target.querySelector&&target.querySelector('input,select,textarea,button');(input||target).focus({preventScroll:true});}};
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(status);}
  function init(){var screen=document.getElementById('p-propuestas');if(!screen)return;new MutationObserver(schedule).observe(screen,{childList:true,subtree:true,characterData:true});screen.addEventListener('input',schedule);screen.addEventListener('change',schedule);schedule();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
