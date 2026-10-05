/* Map-first professional review. Structured draft changes; no AI or network here. */
(function(){
 'use strict';let seq=0;
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='pr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 function mount(host,{photos,document:doc,current=()=>true,onChange,onSave,contextNotes=()=>({})}){
  if(!SmylPhotoReviewModel.validate(doc)||!photos.length||doc.photos.some(s=>!photos.some(p=>p.view===s.view&&p.sha256===s.sha256)))throw Error('No se pudo verificar la revisión.');
  photos.forEach(p=>{const u=new URL(p.url);if(p.role!=='original'||u.protocol!=='blob:'||u.origin!==location.origin)throw Error('Solo originales locales.');});
  const F=SmylPhotoFindings,id='pr-'+(++seq),items=doc.items,analysis=doc.analysis;
  let disposed=false,selected=null,filter='all',active=photos[0].view,photoReady=false,zoom=false;
  const valid=()=>!disposed&&current();
  const root=n('section','pr-app pr-workspace'),lead=n('header','pr-heading');
  lead.append(n('p','pr-kicker','EXPEDIENTE · REVISIÓN PRIVADA'),n('h1','','Tu mapa dental'),n('p','','Toca una pieza para revisar sus observaciones. Nada se comparte con el paciente.'));root.append(lead);host.replaceChildren(root);
  const overview=n('p','pr-overview');root.append(overview);
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
  const nav=n('div','pr-photo-nav'),quality=n('p','pr-quality');detail.append(photoHeader,stage,nav,quality);
  img.onload=()=>photoReady=true;img.onerror=()=>{photoReady=false;quality.textContent='No se pudo mostrar el original. No confirmes una observación sin revisarlo.';};
  const notes=n('details','pr-existing');notes.append(n('summary','','Notas previas del expediente'));const noteBody=n('div');notes.append(noteBody);detail.append(notes);
  const filters=n('div','pr-filters'),list=n('div','pr-list'),editor=n('section','pr-editor');editor.hidden=true;detail.append(filters,list,editor);
  const limits=n('details','pr-limits');limits.append(n('summary','','Alcance y detalles de la revisión'),n('p','',analysis?'Apoyo IA experimental, con precisión clínica no validada. Una foto no confirma por sí sola caries, sarro o ausencia de piezas. La valoración corresponde al dentista.':'Revisión manual. No se enviaron fotos a IA.'));
  for(const text of analysis?.report.limitations||[])limits.append(n('p','',text));
  if(analysis)limits.append(n('p','',analysis.model+' · '+new Date(analysis.at).toLocaleString('es-MX')));root.append(limits);
  const saveBar=n('footer','pr-savebar'),saveStatus=n('p'),saveButton=button('Guardar revisión',onSave,'pr-primary');saveStatus.setAttribute('role','status');saveBar.append(saveStatus,saveButton);root.append(saveBar);
  const states={pending:'Por revisar',confirmed:'Confirmado por ti',rejected:'Descartado'};
  function photo(view){active=view;photoReady=false;zoom=false;stage.classList.remove('pr-zoom');zoomer.textContent='Acercar';img.src=photos.find(p=>p.view===view).url;photoLabel.textContent=SmylCaseModel.label(view)+' · original';nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));const q=analysis?.report.images.find(i=>i.view===view);quality.textContent=q?q.note:'Selecciona la fotografía que respalda tu observación.';}
  photos.forEach(p=>{const b=button(SmylCaseModel.label(p.view),()=>photo(p.view));b.dataset.view=p.view;nav.append(b);});
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
   overview.textContent=items.filter(i=>i.state==='pending').length+' por revisar · '+items.filter(i=>i.state==='confirmed').length+' confirmadas · '+items.filter(i=>!i.tooth&&i.state!=='rejected').length+' por ubicar';
   detailTitle.textContent=selected===null?'Observaciones de la revisión':selected===''?'Sin pieza asignada':'Diente '+selected;
   mapSummary.textContent=selected?'Diente '+selected+' · cambiar pieza':'Seleccionar diente';
   const previous=selected?contextNotes()[selected]:null;notes.hidden=!previous;noteBody.replaceChildren();if(previous){noteBody.append(n('p','',previous.observation||'Sin observación previa'),n('p','',previous.action||''));}
   filters.replaceChildren();for(const [key,label] of [['all','Todas'],['pending','Por revisar'],['confirmed','Confirmadas'],['rejected','Descartadas']]){const b=button(label,()=>{filter=key;render();});b.setAttribute('aria-pressed',String(filter===key));filters.append(b);}
   list.replaceChildren();const shown=items.filter(i=>(selected===null||i.tooth===selected)&&(filter==='all'||i.state===filter));
   if(!shown.length)list.append(n('p','pr-empty','No hay observaciones en esta selección. No significa ausencia de problemas.'));
   for(const item of shown){const source=analysis?.report.findings.find(f=>f.id===item.sourceId),card=button('',()=>edit(item),'pr-finding pr-'+item.state);card.dataset.itemId=item.id;
    card.append(n('span','pr-finding-state',states[item.state]),n('strong','',item.tooth?'Diente '+item.tooth:'Pieza por identificar'),n('p','',item.text||'Observación sin completar'),n('small','',(source?F.categories[source.category]+' · IA':'Registro manual')+' · '+SmylCaseModel.label(item.view)));list.append(card);
   }renderMap();
  }
  function addManual(){if(!valid()||items.length>=64)return;const item={id:crypto.randomUUID(),sourceId:'',view:active,tooth:selected||'',text:'',state:'pending'};items.push(item);filter='all';changed();edit(item);}
  function edit(item){
   if(!valid())return;photo(item.view);editor.replaceChildren();editor.hidden=false;
   const title=n('h3','','Revisar observación');title.tabIndex=-1;editor.append(title);
   const source=analysis?.report.findings.find(f=>f.id===item.sourceId);
   if(source){const evidence=n('details','pr-evidence');evidence.open=true;evidence.append(n('summary','','Qué sugirió la IA'),n('p','',source.observation),n('small','','Dónde revisar: '+source.evidence));editor.append(evidence);}
   if(item.state==='confirmed'||item.state==='rejected'){
    editor.append(n('p','',item.text),n('p','pr-help',states[item.state]),button('Volver a revisar',()=>{item.state='pending';changed();edit(item);}));return;
   }
   const toothLabel=n('label','','Diente confirmado por ti'),tooth=n('select');tooth.id=id+'-tooth';toothLabel.htmlFor=tooth.id;tooth.add(new Option('Seleccionar pieza…',''));SmylToothMap.teeth.forEach(t=>tooth.add(new Option('Diente '+t,t)));tooth.value=item.tooth;
   const textLabel=n('label','','Tu observación'),text=n('textarea');text.id=id+'-text';textLabel.htmlFor=text.id;text.rows=3;text.maxLength=600;text.value=item.text;
   const confirmLabel=n('label','pr-confirm'),check=n('input');check.type='checkbox';confirmLabel.append(check,document.createTextNode('Revisé el original, la pieza y el texto. Confirmo esta observación con mi criterio profesional.'));
   const feedback=n('p','pr-feedback');feedback.setAttribute('role','status');
   const apply=button('Confirmar observación',()=>{
    if(!valid()||!check.checked||!F.tooth(item.tooth)||!item.text.trim())return;
    if(!photoReady||active!==item.view){feedback.textContent='Revisa la fotografía de esta observación antes de confirmar.';photo(item.view);check.checked=false;sync();return;}
    item.state='confirmed';changed();edit(item);
   },'pr-primary');
   function sync(){apply.disabled=!check.checked||!F.tooth(item.tooth)||!item.text.trim();}
   tooth.onchange=()=>{item.tooth=tooth.value;selected=null;check.checked=false;changed();sync();};text.oninput=()=>{item.text=text.value;check.checked=false;changed();sync();};check.onchange=sync;
   const actions=n('div','pr-editor-actions');actions.append(button('Descartar',()=>{item.state='rejected';changed();edit(item);}),apply);
   editor.append(toothLabel,tooth,textLabel,text,confirmLabel,feedback,actions);sync();title.focus({preventScroll:true});editor.scrollIntoView({block:'nearest'});
  }
  photo(active);render();
  return {destroy(){disposed=true;img.removeAttribute('src');root.remove();},setSaveState(s){
   if(disposed)return;saveStatus.textContent=!s.available?'Sin guardado disponible · no cierres si quieres conservar tus notas':s.message|| (s.saving?'Guardando revisión…':s.dirty?'Cambios sin guardar':s.revision?'Guardado en la nube · versión '+s.revision+' · privado':'Sin cambios guardados');
   saveBar.classList.toggle('pr-save-error',s.failed||!s.available);saveButton.disabled=!s.available||s.saving||s.conflict||!s.dirty;
  }};
 }
 window.SmylPhotoReview={mount};
})();
