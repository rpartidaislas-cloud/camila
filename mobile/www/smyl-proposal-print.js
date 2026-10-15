/* One renderer for patient preview and print. Only explicit, public proposal fields. */
(function(){
  'use strict';
  function n(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function targetLabel(item){var parts=[];if(item.teeth.length)parts.push('Piezas '+item.teeth.join(', '));if(item.surfaces.length)parts.push('Superficies '+item.surfaces.join(', '));return parts.join(' · ')||item.area||'Tratamiento general';}
  function render(row,assets,approved){
    var model=SmylProposalModel,doc=model.normalize(row.document),paper=n('article','proposal-paper');
    var top=n('header','proposal-paper-top');top.append(n('strong','',row.clinic_name||'Tu clínica dental'),n('span','proposal-brand','smyl'));
    paper.append(top,n('p','proposal-kicker',approved?'PROPUESTA PERSONALIZADA':'BORRADOR - PENDIENTE DE REVISIÓN'),n('h1','',doc.title));
    var who=n('div','proposal-paper-meta');who.append(n('div','','Para '+row.patient_name),n('div','',row.professional_name||'Equipo de la clínica'));
    paper.append(who);
    if(doc.introduction)paper.append(n('p','proposal-intro',doc.introduction));
    if(doc.photos&&assets&&model.safeImage(assets.before)&&model.safeImage(assets.simulation)){
      var section=n('section','proposal-comparison');section.append(n('h2','','Una posibilidad para tu sonrisa'));
      var photos=n('div','proposal-photo-pair');
      [['before','Fotografía original'],['simulation','Simulación visual - no es un resultado real']].forEach(function(entry){var fig=n('figure');var img=n('img');img.src=assets[entry[0]];img.alt=entry[1];fig.append(img,n('figcaption','',entry[1]));photos.append(fig);});
      section.append(photos,n('p','proposal-small',model.views[doc.photos.view]+' · La imagen es orientativa. No garantiza el resultado del tratamiento.'));paper.append(section);
    }
    var mapped=doc.items.filter(function(item){return item.teeth.length;});
    if(mapped.length&&window.SmylToothMap){var section=n('section','proposal-dental-plan');section.append(n('h2','','Dónde se realizará el tratamiento'),n('p','proposal-small','Mapa FDI preparado desde las piezas que el profesional vinculó al plan. No muestra antecedentes ni notas internas.'));var map=n('div','dr-map proposal-dental-map');var counts={};mapped.forEach(function(item){item.teeth.forEach(function(tooth){counts[tooth]=(counts[tooth]||0)+1;});});SmylToothMap.render(map,{disabled:true,state:function(tooth){return {className:counts[tooth]?'pr-proposed':'',count:counts[tooth]||0,label:counts[tooth]?counts[tooth]+' tratamiento(s) propuesto(s)':'Sin tratamiento propuesto'};}});var legend=n('div','proposal-dental-legend');mapped.forEach(function(item,index){var entry=n('article');entry.append(n('span','',String(index+1).padStart(2,'0')),n('div','',null));entry.lastChild.append(n('strong','',item.label),n('small','',targetLabel(item)));legend.append(entry);});section.append(map,legend);paper.append(section);}
    var heading=n('div','proposal-quote-heading');heading.append(n('h2','','Tu plan y su inversión'),n('span','','Importes en MXN'));paper.append(heading);
    var table=n('table','proposal-quote');table.append(n('caption','proposal-sr','Conceptos e importes estimados'));
    var head=n('thead'),tr=n('tr');['Concepto','Cant.','Precio unitario','Importe'].forEach(function(x){var th=n('th','',x);th.scope='col';if(x==='Cant.')th.setAttribute('aria-label','Cantidad');tr.append(th);});head.append(tr);table.append(head);
    var body=n('tbody');doc.items.forEach(function(item){var row=n('tr'),label=n('td');label.dataset.label='Concepto';label.append(n('strong','',item.label));if(item.area)label.append(n('small','',item.area));if(item.service_snapshot)label.append(n('small','proposal-fiscal-line','SAT '+(item.service_snapshot.sat_product_service_code||'por definir')+' · '+(item.service_snapshot.fiscal_status==='reviewed'?'revisado':'por revisar')));var quantity=n('td','',String(item.quantity)),unit=n('td','',item.unit_cents===null?'Por definir':model.money(item.unit_cents)),amount=n('td','',item.unit_cents===null?'Por definir':model.money(item.quantity*item.unit_cents));quantity.dataset.label='Cantidad';unit.dataset.label='Precio unitario';amount.dataset.label='Importe';row.append(label,quantity,unit,amount);body.append(row);});table.append(body);paper.append(table);
    var total=n('div','proposal-total');total.append(n('span','','Total estimado'),n('strong','',doc.items.some(function(i){return i.unit_cents===null;})?'Por completar':model.money(model.total(doc))));paper.append(total);
    var terms=n('section','proposal-terms');terms.append(n('h2','','Antes de comenzar'),n('p','',doc.terms||'Condiciones pendientes de completar.'));if(doc.valid_until)terms.append(n('p','proposal-validity','Vigencia: '+doc.valid_until.split('-').reverse().join('/')));paper.append(terms);
    var footer=n('footer','proposal-paper-footer');footer.append(n('p','','La propuesta requiere valoración y acuerdo con tu dentista. No constituye una garantía de resultados ni una aceptación del tratamiento.'),n('small','','Propuesta '+(row.id||'sin guardar')+' · Versión '+(row.revision||'sin guardar')+' · Plan '+row.plan_revision+(approved?' · Aprobada por el profesional':' · No aprobada')));paper.append(footer);
    return paper;
  }
  window.SmylProposalPrint={render:render};
})();
