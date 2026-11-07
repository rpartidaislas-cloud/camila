/* SMYL · Historia clínica, vista de lectura: secciones numeradas con índice lateral.
 * Función pura: recibe datos ya preparados por smyl-patient-360.js y devuelve HTML. No toca el DOM ni la red,
 * así se puede probar sin sesión. Los textos del paciente se escapan aquí; el HTML fijo no depende de ellos. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylHistoryRead=api;})(globalThis,function(){
  'use strict';
  var STATES=['alert','records','ok','pending','empty'];
  var SHORT={safety:'Seguridad',medical:'Salud médica',dental:'Dental',habits:'Hábitos',admin:'Contacto y notas'};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function state(value,list){return list.indexOf(value)>=0?value:list[list.length-1];}
  function rowHtml(row){
    var lines=Array.isArray(row.lines)&&row.lines.length?row.lines:[row.text||''],kind=state(row.state,STATES);
    return '<div class="p360-hc-row" data-state="'+kind+'"><dt>'+esc(row.label)+'</dt><dd class="p360-hc-v">'+lines.map(function(line){return '<span>'+esc(line)+'</span>';}).join('')+'</dd><dd class="p360-hc-st">'+(row.badge?'<b>'+esc(row.badge)+'</b>':'')+'</dd></div>';
  }
  function bandHtml(section,index,canWrite){
    var id='p360-hc-'+esc(section.key);
    return '<section class="p360-hc-band" id="'+id+'" data-tone="'+esc(section.key)+'" data-state="'+state(section.state,['alert','pending','ok','neutral'])+'" tabindex="-1" aria-labelledby="'+id+'-t">'
      +'<header class="p360-hc-band-h"><div class="p360-hc-title"><span class="p360-hc-num" aria-hidden="true">'+(index+1)+'</span><div><h3 id="'+id+'-t">'+esc(section.title)+'</h3><small>'+esc(section.copy)+'</small></div></div>'
      +(canWrite?'<button type="button" class="p360-hc-edit" data-hc-edit="'+esc(section.key)+'" data-hc-step="'+Number(section.step||0)+'" aria-label="Editar sección '+esc(section.title)+'">Editar sección</button>':'')+'</header>'
      +'<dl class="p360-hc-rows">'+section.rows.map(rowHtml).join('')+'</dl></section>';
  }
  function indexHtml(model){
    var cov=model.coverage||{done:0,total:0,pending:[]},percent=cov.total?Math.round(cov.done/cov.total*100):0;
    return '<nav class="p360-hc-index" aria-label="Secciones de la historia clínica"><h3>Secciones</h3>'
      +model.sections.map(function(section,index){return '<button type="button" data-hc-goto="'+esc(section.key)+'"><span class="p360-hc-dot" data-state="'+state(section.state,['alert','pending','ok','neutral'])+'" aria-hidden="true"></span>'+(index+1)+' · '+esc(SHORT[section.key]||section.title)+'</button>';}).join('')
      +'<div class="p360-hc-progress"><strong>'+Number(cov.done)+' de '+Number(cov.total)+'</strong> confirmadas<div class="p360-hc-bar" role="presentation"><i style="width:'+percent+'%"></i></div>'
      +(cov.pending&&cov.pending.length?'<span class="p360-hc-missing">Falta: '+cov.pending.map(esc).join(', ')+'</span>':'<span class="p360-hc-complete">Todo confirmado</span>')+'</div></nav>';
  }
  function render(model){
    var canWrite=!!model.canWrite;
    return '<article class="p360-hc"><header class="p360-hc-header"><div><h2>Historia clínica</h2><p>Información médica y dental confirmada para la atención. Actualizada el '+esc(model.updated)+' · versión '+Number(model.revision||0)+'</p></div>'
      +'<div class="p360-hc-actions"><button type="button" class="btn btn-secondary" data-hc-versions>Historial de cambios</button>'+(canWrite?'<button type="button" class="btn btn-secondary" data-hc-add="allergy">+ Alergia</button><button type="button" class="btn btn-secondary" data-hc-add="medication">+ Medicamento</button><button type="button" class="btn btn-primary" data-history-edit>Editar historia</button>':'')+'</div></header>'
      +'<div class="p360-hc-layout">'+indexHtml(model)+'<div class="p360-hc-main">'+model.sections.map(function(section,index){return bandHtml(section,index,canWrite);}).join('')
      +'<footer class="p360-hc-footer"><p>La información se conserva versionada dentro del expediente.</p><div class="p360-history-links"><button type="button" data-record-tab="notes">Ver evoluciones</button><button type="button" data-record-link="p360-dental">Abrir odontograma</button></div></footer></div></div></article>';
  }
  /* Historial de cambios: lista de versiones, de la más reciente a la más antigua, con quién y qué cambió. */
  var CHANGE_MARK={added:'+',removed:'−',changed:'↻',confirmed:'✓'};
  function changeHtml(change){
    var kind=CHANGE_MARK[change.kind]?change.kind:'changed';
    return '<li data-kind="'+kind+'"><i aria-hidden="true">'+CHANGE_MARK[kind]+'</i><span class="p360-hv-sec">'+esc(SHORT[change.section]||'')+'</span><span>'+esc(change.text)+'</span></li>';
  }
  function entryHtml(entry){
    var body=entry.changes==null?'<li data-kind="none">Esta versión no se puede comparar: la versión anterior no está disponible.</li>'
      :entry.changes.length?entry.changes.map(changeHtml).join('')
      :'<li data-kind="none">'+(entry.isFirst?'Historia creada sin datos.':'Se guardó sin cambios en los datos.')+'</li>';
    return '<li class="p360-hv-item"><div class="p360-hv-meta"><strong>Versión '+Number(entry.revision)+'</strong><span>'+esc(entry.when)+'</span><span>'+esc(entry.who)+'</span></div><ul class="p360-hv-changes">'+body+'</ul></li>';
  }
  function renderVersions(model){
    var entries=model.entries||[];
    return '<div class="p360-hv"><header class="p360-hv-head"><div><h2>Historial de cambios</h2><p>'+(entries.length?'Quién cambió qué en la historia clínica, de lo más reciente a lo más antiguo.':'Aún no hay versiones registradas.')+'</p></div><button type="button" class="btn btn-secondary" data-close>Cerrar</button></header>'
      +(entries.length?'<ol class="p360-hv-list">'+entries.map(entryHtml).join('')+'</ol>':'')
      +(model.more?'<p class="p360-hv-more">Se muestran las últimas '+Number(entries.length)+' versiones. Las anteriores se conservan en el expediente.</p>':'')+'</div>';
  }
  function renderVersionsMessage(message,tone){
    return '<div class="p360-hv"><header class="p360-hv-head"><div><h2>Historial de cambios</h2></div><button type="button" class="btn btn-secondary" data-close>Cerrar</button></header><p class="p360-hv-message" data-tone="'+(tone==='error'?'error':'info')+'" role="'+(tone==='error'?'alert':'status')+'">'+esc(message)+'</p></div>';
  }
  return {render:render,renderVersions:renderVersions,renderVersionsMessage:renderVersionsMessage,esc:esc};
});
