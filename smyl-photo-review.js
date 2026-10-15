/* Map-first professional review. Structured draft changes; no AI or network here. */
(function(){
 'use strict';let seq=0;
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='pr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 function mount(host,{photos,document:doc,multiEvidence=false,current=()=>true,onChange,onSave,onContinue,onRestart,contextNotes=()=>({})}){
  if(!SmylPhotoReviewModel.validate(doc)||!photos.length||doc.photos.some(s=>!photos.some(p=>p.view===s.view&&p.sha256===s.sha256)))throw Error('No se pudo verificar la revisión.');
  photos.forEach(p=>{const u=new URL(p.url);if(p.role!=='original'||u.protocol!=='blob:'||u.origin!==location.origin)throw Error('Solo originales locales.');});
  const F=SmylPhotoFindings,id='pr-'+(++seq),items=doc.items,analysis=doc.analysis;
  let disposed=false,selected=null,filter='all',groupBy='tooth',active=photos[0].view,photoReady=false,zoom=false;
  let savedDocument=null,syncEditor=()=>{};const seen=new Set(),M=SmylPhotoReviewModel;
  const valid=()=>!disposed&&current();
  const root=n('section','pr-app pr-workspace'),lead=n('header','pr-heading');
  lead.append(n('p','pr-kicker','EXPEDIENTE · REVISIÓN PRIVADA'),n('h1','','Tu mapa dental'),n('p','','Toca una pieza para revisar sus observaciones. Nada se comparte con el paciente.'));root.append(lead);host.replaceChildren(root);
  let continueButton=null,restartButton=null;
  if(doc.schema===3){
   const W=SmylAnalysisWorkflow,s=W.summary(doc),panel=n('details','pr-workflow-summary'),steps=n('ol','pr-workflow-steps'),heading=n('summary');panel.open=s.completed!==s.total;
   heading.append(n('h2','',s.completed+' de '+s.total+' revisiones recibidas'));panel.append(heading,n('p','','La IA observa por grupos; tú revisas las evidencias y decides. No es un diagnóstico confirmado.'));
   for(const stage of doc.workflow.stages){const li=n('li','pr-step pr-step-'+stage.state);li.append(n('strong','',W.groups.find(g=>g.key===stage.key).label),n('span','',stage.state==='completed'?stage.result.report.findings.length+' sugerencias por comprobar':{ready:'Pendiente',requested:'Respuesta no confirmada · no se repetirá',unconfirmed:'Respuesta no confirmada · revisar manualmente'}[stage.state]));steps.append(li);}panel.append(steps);
   if(s.uncertain)panel.append(n('p','pr-storage-warning','No pudimos completar una o más revisiones. Tus fotografías y notas están guardadas; no añadimos resultados dudosos al mapa.'));
   if(s.ready&&onContinue){continueButton=button('Continuar '+s.ready+' '+(s.ready===1?'revisión pendiente':'revisiones pendientes'),()=>{if(valid())onContinue();},'pr-primary');panel.append(continueButton);}
   if(W.canRestart(doc)&&onRestart){restartButton=button('Iniciar un análisis nuevo',()=>{if(valid())onRestart();},'pr-primary');panel.append(restartButton,n('p','pr-help','La solicitud anterior no se repetirá. Esta acción crea una revisión nueva y puede generar consumo de IA.'));}
   const contrasts=n('details','pr-limits');contrasts.append(n('summary','','Puntos para contrastar entre fotografías'));
   if(!s.overlaps.length)contrasts.append(n('p','','No se detectaron coincidencias de pieza y categoría entre grupos. Esto no confirma que no haya problemas.'));
   for(const o of s.overlaps)contrasts.append(n('p','','Diente '+o.tooth+' · '+F.categories[o.category]+': aparece en '+o.sources.map(k=>W.groups.find(g=>g.key===k).label).join(' y ')+'. Contrasta los originales; se mantienen como observaciones separadas.'));
   panel.append(contrasts);root.append(panel);
  }
  const overview=n('p','pr-overview');root.append(overview);
  const evidenceSummary=n('p','pr-evidence-summary');root.append(evidenceSummary);
  const layout=n('div','pr-review-layout'),mapPanel=n('details','pr-map-panel');mapPanel.open=true;
  const mapSummary=n('summary','','Seleccionar diente'),mapBody=n('div','pr-map-body');mapPanel.append(mapSummary,mapBody);layout.append(mapPanel);
  mapBody.append(n('p','pr-help','Dentición permanente. Sin marca significa sin evaluar, no sano.'));
  const orientation=n('div','pr-orientation');orientation.append(n('span','','Derecha del paciente'),n('span','','Izquierda del paciente'));mapBody.append(orientation);
  const map=n('div','pr-map');mapBody.append(map);
  const legend=n('div','pr-legend');[['pending','Por revisar'],['confirmed','Confirmado por ti'],['empty','Sin evaluar']].forEach(([c,t])=>legend.append(n('span','pr-key pr-key-'+c,t)));mapBody.append(legend);
  const mapActions=n('div','pr-map-actions');mapActions.append(button('Ver todas',()=>select(null)),button('Sin pieza asignada',()=>select('')));mapBody.append(mapActions);
  const detail=n('section','pr-tooth-detail'),detailTitle=n('h2','','Observaciones de la revisión'),detailTools=n('div','pr-list-heading');
  detailTools.append(detailTitle,button('Añadir observación',()=>addManual()));detail.append(detailTools);layout.append(detail);root.append(layout);
  const photoHeader=n('div','pr-photo-heading'),photoLabel=n('strong'),zoomer=button('Acercar',()=>{zoom=!zoom;stage.classList.toggle('pr-zoom',zoom);zoomer.textContent=zoom?'Ver completa':'Acercar';});photoHeader.append(photoLabel,zoomer);
  const stage=n('div','pr-photo-stage'),img=n('img');img.alt='Fotografía original para revisión profesional';stage.append(img);
  const nav=n('div','pr-photo-nav pr-evidence-nav'),quality=n('p','pr-quality');nav.setAttribute('aria-label','Evidencias originales de esta sesión');detail.append(photoHeader,stage,nav,quality);
  img.onload=()=>{photoReady=true;seen.add(active);syncEditor();};img.onerror=()=>{photoReady=false;seen.delete(active);quality.textContent='No se pudo mostrar el original. No confirmes una observación sin revisarlo.';syncEditor();};
  const notes=n('details','pr-existing');notes.append(n('summary','','Notas previas del expediente'));const noteBody=n('div');notes.append(noteBody);detail.append(notes);
  const grouping=n('div','pr-grouping');grouping.setAttribute('aria-label','Organizar observaciones');
  for(const [value,label] of [['tooth','Por diente'],['photo','Por fotografía']]){const b=button(label,()=>{groupBy=value;render();});b.dataset.groupBy=value;grouping.append(b);}
  const filters=n('div','pr-filters'),list=n('div','pr-list'),editor=n('section','pr-editor');editor.hidden=true;detail.append(grouping,filters,list,editor);
  const limits=n('details','pr-limits');limits.append(n('summary','','Alcance y detalles de la revisión'),n('p','',analysis||doc.schema===3?'Apoyo IA experimental, con precisión clínica no validada. Una foto no confirma por sí sola caries, sarro o ausencia de piezas. La valoración corresponde al dentista.':'Revisión manual. No se enviaron fotos a IA.'));
  for(const text of analysis?.report.limitations||[])limits.append(n('p','',text));
  if(doc.schema===3)for(const s of doc.workflow.stages.filter(s=>s.state==='completed')){limits.append(n('h3','',SmylAnalysisWorkflow.groups.find(g=>g.key===s.key).label));for(const text of s.result.report.limitations)limits.append(n('p','',text));limits.append(n('p','',s.result.model+' · '+new Date(s.result.at).toLocaleString('es-MX')));}
  if(analysis)limits.append(n('p','',analysis.model+' · '+new Date(analysis.at).toLocaleString('es-MX')));root.append(limits);
  const saveBar=n('footer','pr-savebar'),saveStatus=n('p'),saveButton=button('Guardar revisión',onSave,'pr-primary');saveStatus.setAttribute('role','status');saveBar.append(saveStatus,saveButton);root.append(saveBar);
  const states={pending:'Por revisar',confirmed:'Confirmado por ti',rejected:'Descartado'};
  function photo(view){active=view;photoReady=false;zoom=false;stage.classList.remove('pr-zoom');zoomer.textContent='Acercar';img.src=photos.find(p=>p.view===view).url;photoLabel.textContent=SmylCaseModel.label(view)+' · original';nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));const q=analysis?.report.images.find(i=>i.view===view);quality.textContent=q?q.note:'Selecciona la fotografía que respalda tu observación.';syncEditor();}
  for(const [family,label] of [['smile','Rostro y sonrisa'],['intraoral','Intraorales']]){
   const sources=photos.filter(p=>doc.photos.some(s=>s.view===p.view)&&SmylReviewEvidence.family(p.view)===family);if(!sources.length)continue;
   const section=n('section','pr-photo-family'),choices=n('div','pr-photo-thumbs');section.append(n('h3','',label),choices);nav.append(section);
   sources.forEach(p=>{const b=button('',()=>photo(p.view)),thumb=n('img'),name=n('span','',SmylCaseModel.label(p.view)),status=n('small','pr-photo-progress');thumb.src=p.url;thumb.alt='';b.setAttribute('aria-label',SmylCaseModel.label(p.view)+' · ver original');b.dataset.view=p.view;b.append(thumb,name,status);choices.append(b);});
  }
  function changed(){if(!valid())return;onChange(doc);render();}
  function renderMap(){SmylToothMap.render(map,{state:tooth=>{
   const matches=items.filter(i=>i.tooth===tooth&&i.state!=='rejected'),pending=matches.some(i=>i.state==='pending'),confirmed=matches.some(i=>i.state==='confirmed');
   return {className:(pending?'pr-tooth-pending':confirmed?'pr-tooth-confirmed':'')+(selected===tooth?' pr-tooth-selected':''),label:(matches.length?matches.length+' observaciones · '+(pending?'Por revisar':'Confirmadas'):'Sin evaluar'),selected:selected===tooth,count:matches.length};
  },onSelect:tooth=>select(tooth)});}
  function select(tooth){
   if(!valid())return;selected=tooth;filter='all';editor.hidden=true;render();
   const first=items.find(i=>(tooth===null||i.tooth===tooth)&&i.state!=='rejected');if(first)photo(first.view);
   if(matchMedia('(max-width:620px)').matches&&tooth!==null){mapPanel.open=false;detailTitle.tabIndex=-1;detailTitle.focus({preventScroll:true});detail.scrollIntoView({block:'start'});}
  }
  function render(){
   const evidence=SmylReviewEvidence.organize(doc,{by:groupBy,state:filter,tooth:selected});
   overview.textContent=evidence.pending+' por revisar · '+evidence.confirmed+' confirmadas · '+evidence.unassigned+' por ubicar';
   evidenceSummary.textContent=doc.photos.length+' originales en esta revisión · '+(analysis?'IA analizó '+evidence.analyzed+' imágenes; esto no equivale a una valoración confirmada.':doc.schema===3?'Aún no hay resultados de IA confirmados como recibidos.':'Revisión manual, sin análisis de IA.')+' Las radiografías se revisan por separado en el expediente.';
   grouping.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.groupBy===groupBy)));
   for(const p of evidence.images){const b=nav.querySelector('[data-view="'+p.view+'"]');if(b){const label={usable:'Analizada',limited:'Visibilidad limitada',unusable:'No valorable'}[p.quality]||'Sin análisis IA';b.querySelector('small').textContent=label+' · '+p.pending+' pendientes · '+p.confirmed+' confirmadas';}}
   detailTitle.textContent=selected===null?'Observaciones de la revisión':selected===''?'Sin pieza asignada':'Diente '+selected;
   mapSummary.textContent=selected?'Diente '+selected+' · cambiar pieza':'Seleccionar diente';
   const previous=selected?contextNotes()[selected]:null;notes.hidden=!previous;noteBody.replaceChildren();if(previous){noteBody.append(n('p','',previous.observation||'Sin observación previa'),n('p','',previous.action||''));}
   filters.replaceChildren();for(const [key,label] of [['all','Todas'],['pending','Por revisar'],['confirmed','Confirmadas'],['rejected','Descartadas']]){const b=button(label,()=>{filter=key;render();});b.setAttribute('aria-pressed',String(filter===key));filters.append(b);}
   list.replaceChildren();
   if(!evidence.groups.length)list.append(n('p','pr-empty','No hay observaciones en esta selección. No significa ausencia de problemas.'));
   for(const group of evidence.groups){
    const block=n('section','pr-evidence-group');block.dataset.evidenceGroup=group.key;
    const heading=groupBy==='photo'?SmylCaseModel.label(group.key):group.key==='unassigned'?'Sin pieza asignada':'Diente '+group.key;
    block.append(n('h3','',heading),n('p','pr-group-hint',group.items.length+(group.items.length===1?' observación':' observaciones')+' · '+group.views.length+(group.views.length===1?' original':' originales')+' · se revisan por separado'));
    if(group.key==='unassigned')block.append(n('p','pr-help','No asignes una pieza por suposición. Si la observación es general, regístrala en tu valoración del paciente.'));
    for(const item of group.items){const source=analysis?.report.findings.find(f=>f.id===item.sourceId),card=button('',()=>edit(item),'pr-finding pr-'+item.state);card.dataset.itemId=item.id;
     card.append(n('span','pr-finding-state',states[item.state]),n('strong','',item.tooth?'Diente '+item.tooth:'Pieza por identificar'),n('p','',item.text||'Observación sin completar'),n('small','',(source?F.categories[source.category]+' · Sugerencia IA':'Registro manual')+' · Origen: '+SmylCaseModel.label(item.view)),n('span','pr-open-evidence',M.evidence(doc,item).length>1?M.evidence(doc,item).length+' originales vinculados · revisar →':'Ver original y revisar →'));block.append(card);
    }list.append(block);
   }renderMap();
  }
  function addManual(){if(!valid()||items.length>=64)return;if(doc.schema===3&&items.filter(i=>!i.sourceId).length>=34){alert('Esta revisión permite 34 notas manuales. Conservamos espacio para las sugerencias pendientes.');return;}const item={id:crypto.randomUUID(),sourceId:'',view:active,tooth:selected||'',text:'',state:'pending'};if(doc.schema>=2)item.evidence=doc.photos.filter(p=>p.view===active).map(p=>({...p}));items.push(item);filter='all';changed();edit(item);}
  function edit(item){
   if(!valid())return;syncEditor=()=>{};seen.clear();photo(item.view);editor.replaceChildren();editor.hidden=false;
   const title=n('h3','','Revisar observación');title.tabIndex=-1;editor.append(title);
   editor.append(n('p','pr-source-label','Evidencia: '+SmylCaseModel.label(item.view)+' · fotografía original de esta revisión.'),button('Ver este original',()=>{photo(item.view);photoHeader.scrollIntoView({block:'center'});}));
   const source=analysis?.report.findings.find(f=>f.id===item.sourceId);
   if(source&&doc.schema===3){const group=SmylAnalysisWorkflow.source(doc,source.id);editor.append(n('p','pr-help','Origen de la sugerencia: '+SmylAnalysisWorkflow.groups.find(g=>g.key===group.key).label+'. Se conserva la respuesta original, aunque edites tu observación.'));}
   if(source){const evidence=n('details','pr-evidence');evidence.open=true;evidence.append(n('summary','','Qué sugirió la IA'),n('p','',source.observation),n('small','','Dónde revisar: '+source.evidence));editor.append(evidence);}
   if(item.state==='confirmed'||item.state==='rejected'){
    const originals=n('div','pr-support-links');for(const p of M.evidence(doc,item))originals.append(button('Ver '+SmylCaseModel.label(p.view),()=>photo(p.view)));
    editor.append(originals,n('p','',item.text),n('p','pr-help',states[item.state]),button('Volver a revisar',()=>{item.state='pending';changed();edit(item);}));return;
   }
   const support=n('fieldset','pr-support');
   if(multiEvidence&&doc.photos.length>1){
    support.append(n('legend','','Fotos que respaldan esta observación'),n('p','pr-help','Marca solo los originales que ayuden a comprobarla. Vincular fotos no fusiona sugerencias ni confirma el hallazgo.'));
    for(const p of doc.photos){const label=n('label','pr-support-choice'),pick=n('input'),thumb=n('img');pick.type='checkbox';pick.checked=M.evidence(doc,item).some(e=>e.view===p.view);pick.disabled=p.view===item.view;pick.dataset.evidenceView=p.view;thumb.src=photos.find(x=>x.view===p.view).url;thumb.alt='';
     label.append(pick,thumb,n('span','',SmylCaseModel.label(p.view)+(p.view===item.view?' · origen':'')));
     pick.onchange=()=>{if(!valid())return;if(doc.schema===1){const upgraded=M.upgrade(doc);doc.schema=2;items.forEach((i,k)=>i.evidence=upgraded.items[k].evidence);}
      const views=[...support.querySelectorAll('input:checked')].map(e=>e.dataset.evidenceView);M.setEvidence(doc,item.id,views);changed();edit(item);
     };support.append(label);
    }editor.append(support);
   }
   const evidenceLinks=n('div','pr-support-links');for(const p of M.evidence(doc,item)){const b=button('Revisar '+SmylCaseModel.label(p.view),()=>{photo(p.view);photoHeader.scrollIntoView({block:'center'});});b.dataset.supportView=p.view;evidenceLinks.append(b);}if(multiEvidence||doc.schema>=2)editor.append(evidenceLinks);
   const toothLabel=n('label','','Diente confirmado por ti'),tooth=n('select');tooth.id=id+'-tooth';toothLabel.htmlFor=tooth.id;tooth.add(new Option('Seleccionar pieza…',''));SmylToothMap.teeth.forEach(t=>tooth.add(new Option('Diente '+t,t)));tooth.value=item.tooth;
   const textLabel=n('label','','Tu observación'),text=n('textarea');text.id=id+'-text';textLabel.htmlFor=text.id;text.rows=3;text.maxLength=600;text.value=item.text;
   const confirmLabel=n('label','pr-confirm'),check=n('input');check.type='checkbox';confirmLabel.append(check,document.createTextNode('Revisé los originales vinculados, la pieza y el texto. Confirmo esta observación con mi criterio profesional.'));
   const feedback=n('p','pr-feedback');feedback.setAttribute('role','status');
   const apply=button('Confirmar observación',()=>{
    if(!valid()||!check.checked||!F.tooth(item.tooth)||!item.text.trim()||!evidenceSaved()||!allSeen())return;
    item.state='confirmed';changed();edit(item);
   },'pr-primary');
   function evidenceSaved(){const old=savedDocument?.items.find(i=>i.id===item.id);return old?M.same(M.evidence(savedDocument,old),M.evidence(doc,item)):M.evidence(doc,item).length===1;}
   function allSeen(){return M.evidence(doc,item).every(p=>seen.has(p.view));}
   const discard=button('Descartar',()=>{if(!valid()||!evidenceSaved())return;item.state='rejected';changed();edit(item);});
   function sync(){apply.disabled=!check.checked||!F.tooth(item.tooth)||!item.text.trim()||!evidenceSaved()||!allSeen();discard.disabled=!evidenceSaved();
    feedback.textContent=!evidenceSaved()?'Primero guardaremos el cambio de evidencias. Después podrás confirmar.':!allSeen()?'Abre cada original vinculado para revisarlo antes de confirmar.':'';
    evidenceLinks.querySelectorAll('button').forEach(b=>{b.textContent=(seen.has(b.dataset.supportView)?'Vista · ':'Revisar · ')+SmylCaseModel.label(b.dataset.supportView);});
   }syncEditor=sync;
   tooth.onchange=()=>{item.tooth=tooth.value;selected=null;check.checked=false;changed();sync();};text.oninput=()=>{item.text=text.value;check.checked=false;changed();sync();};check.onchange=sync;
   const actions=n('div','pr-editor-actions');actions.append(discard,apply);
   editor.append(toothLabel,tooth,textLabel,text,confirmLabel,feedback,actions);sync();title.focus({preventScroll:true});editor.scrollIntoView({block:'nearest'});
  }
  photo(active);render();
  return {destroy(){disposed=true;img.removeAttribute('src');root.remove();},setSaveState(s){
   if(disposed)return;savedDocument=s.savedDocument||null;syncEditor();saveStatus.textContent=!s.available?'Sin guardado disponible · no cierres si quieres conservar tus notas':s.message|| (s.saving?'Guardando revisión…':s.dirty?'Cambios sin guardar':s.revision?'Guardado en la nube · versión '+s.revision+' · privado':'Sin cambios guardados');
   saveBar.classList.toggle('pr-save-error',s.failed||!s.available);saveButton.disabled=!s.available||s.saving||s.conflict||!s.dirty;
   if(continueButton)continueButton.disabled=!s.available||s.saving||s.dirty||s.failed||s.conflict;
   if(restartButton)restartButton.disabled=!s.available||s.saving||s.dirty||s.failed||s.conflict;
  }};
 }
 window.SmylPhotoReview={mount};
})();
