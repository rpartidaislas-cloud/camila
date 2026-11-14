/* Visual editor for one professional dental finding. It only updates the canonical draft through callbacks. */
(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.SmylDentalFindingEditor=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';

 const fallbackConditions=Object.freeze([
  {code:'caries',label:'Caries'},{code:'restoration',label:'Restauración'},
  {code:'fracture',label:'Fractura'},{code:'endodontics',label:'Endodoncia'},
  {code:'crown',label:'Corona'},{code:'missing',label:'Ausente'},
  {code:'implant',label:'Implante'},{code:'sealant',label:'Sellador'},
  {code:'other',label:'Otra'}
 ]);
 const n=(tag,cls,text)=>{const element=root.document.createElement(tag);element.className=cls||'';if(text!=null)element.textContent=text;return element;};
 const button=(text,cls)=>{const element=n('button',cls||'',text);element.type='button';return element;};
 const tidy=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,180);
 const unit=tooth=>Number(String(tooth||'').slice(-1));
 const centerSurface=tooth=>unit(tooth)<=3?'I':'O';
 const cloneSource=value=>value&&value.type==='evidence_finding'&&value.id?{type:'evidence_finding',id:String(value.id)}:null;
 const surfaceCopy=(tooth,surface)=>{
  if(surface==='whole')return 'Pieza completa';
  if(surface==='O')return 'Oclusal';if(surface==='I')return 'Incisal';
  if(surface==='M')return 'Mesial';if(surface==='D')return 'Distal';
  if(surface==='V')return 'Vestibular';
  if(surface==='L')return ['1','2'].includes(String(tooth||'')[0])?'Palatina':'Lingual';
  return String(surface||'');
 };
 const conditionCatalog=()=>{
  const model=root.SmylDentalModel,catalog=typeof model?.conditionCatalog==='function'?model.conditionCatalog():model?.conditions;
  return Array.isArray(catalog)&&catalog.length?catalog.map(item=>({code:String(item.code||item.value||''),label:String(item.label||item.name||item.code||'')})).filter(item=>item.code&&item.label):fallbackConditions;
 };
 const conditionCopy=finding=>String(finding?.condition||finding?.label||conditionCatalog().find(item=>item.code===finding?.conditionCode)?.label||finding?.conditionCode||'Hallazgo');
 const sameCondition=(left,right)=>String(left||'').localeCompare(String(right||''),'es-MX',{sensitivity:'base'})===0;

 function mount(host,options={}){
  if(!host||!root.document)return null;
  host.replaceChildren();host.classList.add('dfe-host');
  const shell=n('section','dfe-editor'),empty=n('div','dfe-empty');
  empty.append(n('span','dfe-empty-icon','↖'),n('strong','','Selecciona una pieza'),n('p','','Después elige una cara y lo que observaste.'));
  const content=n('div','dfe-content');content.hidden=true;
  const head=n('header','dfe-head'),identity=n('div','dfe-identity'),number=n('span','dfe-tooth-number'),identityCopy=n('div'),title=n('strong'),subtitle=n('p');identityCopy.append(title,subtitle);identity.append(number,identityCopy);head.append(identity);
  const modeBanner=n('section','dfe-mode-banner');modeBanner.hidden=true;const modeCopy=n('div'),modeTitle=n('strong'),modeDetail=n('p'),modeCancel=button('Cancelar','dfe-link-button');modeCopy.append(modeTitle,modeDetail);modeBanner.append(modeCopy,modeCancel);
  const step=n('p','dfe-step','1 · Elige la cara');
  const surfaceGroup=n('div','dfe-surface-group');surfaceGroup.setAttribute('role','group');surfaceGroup.setAttribute('aria-label','Cara de la pieza');
  const surfaceMap=n('div','dfe-surface-map'),surfaceButtons=new Map();
  const addSurface=(value,short,label,position)=>{const control=button('',`dfe-surface dfe-surface-${position}`);control.dataset.surface=value;control.setAttribute('aria-pressed','false');control.setAttribute('aria-label',label);control.append(n('b','',short),n('small','',label));surfaceButtons.set(value,control);surfaceMap.append(control);};
  addSurface('V','V','Vestibular','top');addSurface('M','M','Mesial','mesial');addSurface('O','O','Oclusal','center');addSurface('I','I','Incisal','center');addSurface('D','D','Distal','distal');addSurface('L','L','Lingual / palatina','bottom');
  const whole=button('Pieza completa','dfe-whole');whole.dataset.surface='whole';whole.setAttribute('aria-pressed','false');surfaceButtons.set('whole',whole);surfaceGroup.append(surfaceMap,whole);
  const conditionSection=n('section','dfe-condition');conditionSection.hidden=true;const conditionHead=n('div','dfe-section-head');conditionHead.append(n('p','dfe-step','2 · Elige la condición'),n('small','','Una sola por registro'));const chips=n('div','dfe-condition-chips');chips.setAttribute('role','group');chips.setAttribute('aria-label','Condición clínica');conditionSection.append(conditionHead,chips);
  const otherField=n('label','dfe-other');otherField.hidden=true;otherField.append(n('span','','Describe la condición'));const otherInput=n('input');otherInput.type='text';otherInput.maxLength=180;otherInput.autocomplete='off';otherInput.placeholder='Ej. desgaste cervical';otherField.append(otherInput);conditionSection.append(otherField);
  const evidenceSection=n('section','dfe-evidence');evidenceSection.hidden=true;const evidenceHead=n('div','dfe-section-head');evidenceHead.append(n('p','dfe-step','3 · Evidencia relacionada'),n('small','','Opcional'));const evidenceChoices=n('div','dfe-evidence-choices');evidenceChoices.setAttribute('role','group');evidenceChoices.setAttribute('aria-label','Evidencia relacionada con la pieza');evidenceSection.append(evidenceHead,evidenceChoices,n('p','dfe-help','Vincula un original ya valorado; no crea otra copia.'));
  const review=n('section','dfe-review');review.hidden=true;review.setAttribute('aria-live','polite');const reviewHead=n('div','dfe-review-head');reviewHead.append(n('span','dfe-review-check','✓'),n('strong','','Listo para agregar'));const tokens=n('div','dfe-review-tokens');const reviewNote=n('p','dfe-review-note');reviewNote.hidden=true;const reviewActions=n('div','dfe-review-actions'),correct=button('Cambiar','dfe-secondary'),apply=button('Agregar al borrador','dfe-primary');reviewActions.append(correct,apply);review.append(reviewHead,tokens,reviewNote,reviewActions);
  const feedback=n('p','dfe-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const history=n('section','dfe-history'),historyHead=n('div','dfe-history-head'),historyCount=n('span','dfe-count','0');historyHead.append(n('strong','','Historial de la pieza'),historyCount);const historyList=n('div','dfe-history-list');history.append(historyHead,historyList);
  const legacy=n('details','dfe-legacy'),legacySummary=n('summary','','Notas anteriores'),legacyBody=n('div','dfe-legacy-body');legacy.append(legacySummary,legacyBody);
  content.append(head,modeBanner,step,surfaceGroup,conditionSection,evidenceSection,review,feedback,history,legacy);shell.append(empty,content);host.append(shell);

  const state={tooth:'',surface:'',conditionCode:'',condition:'',findings:[],findingSignature:'',legacy:null,evidenceSources:[],sourceRef:null,mode:'create',target:null,returnFocus:null,canWrite:false,ready:false,applying:false};
  const catalog=conditionCatalog(),conditionButtons=new Map();
  for(const item of catalog){const chip=button(item.label,'dfe-condition-chip');chip.dataset.code=item.code;chip.setAttribute('aria-pressed','false');chip.onclick=()=>selectCondition(item.code,item.label,true);conditionButtons.set(item.code,chip);chips.append(chip);}

  const validSurface=value=>['whole','M','D','V','L',centerSurface(state.tooth)].includes(value);
  const sourceFor=id=>state.evidenceSources.find(item=>item.id===id)||state.findings.find(item=>item.sourceRef?.id===id)?.source||null;
  const clearCondition=()=>{state.conditionCode='';state.condition='';otherInput.value='';otherField.hidden=true;conditionButtons.forEach(control=>control.setAttribute('aria-pressed','false'));review.hidden=true;};
  const updateSurfaces=()=>{
   const center=centerSurface(state.tooth);surfaceButtons.get('O').hidden=center!=='O';surfaceButtons.get('I').hidden=center!=='I';
   surfaceButtons.forEach((control,value)=>{control.setAttribute('aria-pressed',String(value===state.surface));control.disabled=!state.canWrite||!state.ready||state.mode!=='create';});
   surfaceMap.classList.toggle('dfe-mesial-right',['1','4'].includes(state.tooth[0]));
   surfaceButtons.get('L').querySelector('small').textContent=surfaceCopy(state.tooth,'L');surfaceButtons.get('L').setAttribute('aria-label',surfaceCopy(state.tooth,'L'));
  };
  const renderEvidence=()=>{
   evidenceChoices.replaceChildren();const visible=state.mode==='create'&&state.evidenceSources.length>0;evidenceSection.hidden=!visible;if(!visible)return;
   for(const source of state.evidenceSources){
    const selected=state.sourceRef?.id===source.id,control=button('','dfe-evidence-choice');control.dataset.sourceId=source.id;control.setAttribute('aria-pressed',String(selected));
    control.append(n('strong','',source.studyLabel||'Evidencia clínica'),n('small','',source.label||'Observación confirmada'));
    control.onclick=()=>{state.sourceRef=selected?null:{type:'evidence_finding',id:source.id};renderEvidence();renderReview();};evidenceChoices.append(control);
   }
  };
  const renderReview=()=>{
   const condition=state.conditionCode==='other'?tidy(otherInput.value):state.condition;state.condition=condition;
   const complete=state.mode==='resolve'?!!state.target:!!(state.tooth&&validSurface(state.surface)&&state.conditionCode&&condition);
   const unchanged=state.mode==='correct'&&state.target&&state.conditionCode===state.target.conditionCode&&sameCondition(condition,state.target.condition);
   review.hidden=!complete;review.dataset.mode=state.mode;apply.disabled=state.applying||!complete||unchanged;tokens.replaceChildren();reviewNote.hidden=true;reviewNote.textContent='';
   if(complete){
    [`Pieza ${state.tooth}`,surfaceCopy(state.tooth,state.surface),state.mode==='resolve'?conditionCopy(state.target):condition].forEach(value=>tokens.append(n('span','dfe-token',value)));
    if(state.sourceRef?.id&&sourceFor(state.sourceRef.id))tokens.append(n('span','dfe-token dfe-token-evidence','Con evidencia'));
   }
   reviewHead.querySelector('strong').textContent=state.mode==='resolve'?'Confirma la resolución':state.mode==='correct'?'Revisa la corrección':'Listo para agregar';
   apply.textContent=state.mode==='resolve'?'Marcar como resuelto':state.mode==='correct'?'Agregar corrección':'Agregar al borrador';correct.hidden=state.mode==='resolve';
   if(state.mode==='resolve'){reviewNote.hidden=false;reviewNote.textContent='El registro anterior permanecerá visible en el historial.';}
   else if(unchanged){reviewNote.hidden=false;reviewNote.textContent='Cambia la condición para crear una corrección.';}
   return complete&&!unchanged;
  };
  function selectSurface(value,focusCondition=true){
   if(state.mode!=='create'||!state.canWrite||!state.ready||!validSurface(value))return;
   feedback.textContent='';state.surface=value;state.sourceRef=null;clearCondition();updateSurfaces();conditionSection.hidden=false;renderEvidence();renderReview();
   if(focusCondition)requestAnimationFrame(()=>chips.querySelector('button')?.focus({preventScroll:true}));
  }
  function selectCondition(code,label,focusReview=false){
   if(!state.surface||!state.canWrite||!state.ready||state.mode==='resolve')return;
   const item=catalog.find(value=>value.code===code);if(!item)return;
   state.conditionCode=code;state.condition=code==='other'?tidy(otherInput.value):tidy(label||item.label);conditionButtons.forEach((control,key)=>control.setAttribute('aria-pressed',String(key===code)));otherField.hidden=code!=='other';
   if(code==='other'){review.hidden=true;requestAnimationFrame(()=>otherInput.focus({preventScroll:true}));}else if(renderReview()&&focusReview)requestAnimationFrame(()=>apply.focus({preventScroll:true}));
  }
  const resetComposer=(restoreFocus=false)=>{
   const target=state.returnFocus;state.mode='create';state.target=null;state.returnFocus=null;state.surface='';state.sourceRef=null;clearCondition();conditionSection.hidden=true;modeBanner.hidden=true;step.hidden=false;surfaceGroup.hidden=false;renderEvidence();updateSurfaces();renderReview();
   if(restoreFocus&&target?.isConnected)requestAnimationFrame(()=>target.focus({preventScroll:true}));
  };
  const beginCorrection=(finding,returnFocus)=>{
   feedback.textContent='';state.mode='correct';state.target=finding;state.returnFocus=returnFocus;state.surface=finding.surface;state.sourceRef=cloneSource(finding.sourceRef);modeBanner.hidden=false;modeTitle.textContent=`Corrigiendo · Pieza ${state.tooth} · ${surfaceCopy(state.tooth,finding.surface)}`;modeDetail.textContent='La versión anterior se conservará.';step.hidden=true;surfaceGroup.hidden=true;conditionSection.hidden=false;
   state.conditionCode=finding.conditionCode;state.condition=finding.condition;conditionButtons.forEach((control,key)=>control.setAttribute('aria-pressed',String(key===finding.conditionCode)));otherField.hidden=finding.conditionCode!=='other';otherInput.value=finding.conditionCode==='other'?finding.condition:'';renderEvidence();updateSurfaces();renderReview();renderHistory();requestAnimationFrame(()=>chips.querySelector(`[data-code="${finding.conditionCode}"]`)?.focus({preventScroll:true}));
  };
  const beginResolve=(finding,returnFocus)=>{
   feedback.textContent='';state.mode='resolve';state.target=finding;state.returnFocus=returnFocus;state.surface=finding.surface;state.conditionCode=finding.conditionCode;state.condition=finding.condition;state.sourceRef=cloneSource(finding.sourceRef);modeBanner.hidden=false;modeTitle.textContent=`Resolviendo · Pieza ${state.tooth} · ${surfaceCopy(state.tooth,finding.surface)}`;modeDetail.textContent='No se borrará lo registrado.';step.hidden=true;surfaceGroup.hidden=true;conditionSection.hidden=true;renderEvidence();updateSurfaces();renderReview();renderHistory();requestAnimationFrame(()=>apply.focus({preventScroll:true}));
  };
  surfaceButtons.forEach((control,value)=>{control.onclick=()=>selectSurface(value);});
  otherInput.addEventListener('input',renderReview);modeCancel.onclick=()=>resetComposer(true);
  correct.onclick=()=>{clearCondition();conditionSection.hidden=false;requestAnimationFrame(()=>chips.querySelector('button')?.focus({preventScroll:true}));};
  apply.onclick=()=>{
   if(state.applying||!renderReview())return;state.applying=true;apply.disabled=true;feedback.textContent=state.mode==='resolve'?'Preparando resolución…':state.mode==='correct'?'Preparando corrección…':'Agregando al borrador…';
   const actionMode=state.mode,target=state.target,candidate={tooth:state.tooth,surface:state.surface,conditionCode:actionMode==='resolve'?target.conditionCode:state.conditionCode,condition:actionMode==='resolve'?target.condition:state.condition,state:actionMode==='resolve'?'resolved':'active',capture:'touch',supersedes:target?.id||null,sourceRef:cloneSource(actionMode==='create'?state.sourceRef:target?.sourceRef)};
   Promise.resolve().then(()=>options.onApply?.(candidate)).then(accepted=>{if(accepted===false)throw new Error('No se pudo preparar el hallazgo.');const copy=actionMode==='resolve'?'Resolución preparada.':actionMode==='correct'?'Corrección agregada.':'Hallazgo agregado.';resetComposer();feedback.textContent=`${copy} Guarda las observaciones al terminar.`;}).catch(error=>{feedback.textContent=error?.message||'No se pudo preparar el hallazgo.';}).finally(()=>{state.applying=false;renderReview();renderHistory();});
  };

  const renderHistory=()=>{
   historyList.replaceChildren();historyCount.textContent=String(state.findings.length);history.hidden=!state.findings.length;
   for(const finding of state.findings){
    const previous=!!finding.superseded,item=n('article','dfe-history-item');item.dataset.state=previous?'previous':finding.state||'active';
    const copyBox=n('div','dfe-history-copy'),label=n('strong','',conditionCopy(finding)),meta=n('p','',[surfaceCopy(state.tooth,finding.surface),previous?'Registro anterior':finding.state==='resolved'?'Resuelto':finding.state==='following'?'En seguimiento':'Activo'].filter(Boolean).join(' · '));copyBox.append(label,meta);if(!previous&&finding.source)copyBox.append(n('small','dfe-history-source','Evidencia · '+(finding.source.studyLabel||finding.source.label||'original clínico')));
    const status=n('span','dfe-history-status',finding.draft?'Borrador':previous?'Anterior':finding.state==='resolved'?'Resuelto':'Registrado');item.append(n('span','dfe-history-surface',finding.surface==='whole'?'P':finding.surface),copyBox,status);
    const actions=n('div','dfe-history-row-actions');
    if(!previous&&finding.sourceRef?.id){const open=button(finding.source?'Ver evidencia':'Evidencia no disponible','dfe-history-link');open.disabled=!finding.source;open.onclick=()=>options.onOpenSource?.(finding.sourceRef.id);actions.append(open);}
    if(state.mode==='create'&&!previous&&finding.state!=='resolved'&&state.canWrite&&state.ready&&!state.applying){
     const updateAction=button('Actualizar','dfe-history-update'),menu=n('div','dfe-history-menu');menu.hidden=true;const correction=button('Corregir','dfe-secondary'),resolve=button('Marcar resuelto','dfe-secondary'),cancel=button('Cancelar','dfe-link-button');menu.append(correction,resolve,cancel);
     updateAction.onclick=()=>{updateAction.hidden=true;menu.hidden=false;requestAnimationFrame(()=>correction.focus({preventScroll:true}));};
     cancel.onclick=()=>{menu.hidden=true;updateAction.hidden=false;updateAction.focus({preventScroll:true});};correction.onclick=()=>beginCorrection(finding,updateAction);resolve.onclick=()=>beginResolve(finding,updateAction);actions.append(updateAction,menu);
    }
    if(actions.childElementCount){actions.setAttribute('aria-label','Acciones del hallazgo');item.append(actions);}historyList.append(item);
   }
   legacyBody.replaceChildren();const note=state.legacy||{};if(note.observation)legacyBody.append(n('p','',note.observation));if(note.action)legacyBody.append(n('p','dfe-legacy-action','Acción anterior · '+note.action));if(!note.observation&&!note.action)legacyBody.append(n('p','','No hay notas de texto anteriores.'));legacy.hidden=!note.observation&&!note.action;
  };
  const update=value=>{
   const next=value||{},nextTooth=String(next.tooth||''),nextFindings=Array.isArray(next.findings)?next.findings:[],signature=nextFindings.map(item=>item.id).join('|'),toothChanged=nextTooth!==state.tooth,findingChanged=!toothChanged&&signature!==state.findingSignature;
   state.tooth=nextTooth;state.findings=nextFindings;state.findingSignature=signature;state.legacy=next.legacy||null;state.evidenceSources=Array.isArray(next.evidenceSources)?next.evidenceSources.filter(item=>item?.id):[];if(state.mode==='create'&&state.sourceRef&&!state.evidenceSources.some(item=>item.id===state.sourceRef.id))state.sourceRef=null;state.canWrite=next.canWrite!==false;state.ready=next.ready!==false;
   empty.hidden=!!state.tooth;content.hidden=!state.tooth;if(!state.tooth)return;
   number.textContent=state.tooth;title.textContent='Pieza '+state.tooth;subtitle.textContent=unit(state.tooth)<=3?'Diente anterior · cara incisal':'Diente posterior · cara oclusal';
   if(toothChanged||findingChanged)resetComposer();state.surface=validSurface(state.surface)?state.surface:'';if(!state.surface&&state.mode==='create'){clearCondition();conditionSection.hidden=true;}updateSurfaces();renderEvidence();renderHistory();feedback.textContent=state.canWrite?'':'Modo consulta · no puedes modificar el expediente.';
  };
  const preview=candidate=>{
   const tooth=String(candidate?.tooth||'');if(tooth!==state.tooth||state.mode!=='create')return false;const surface=String(candidate?.surface||'');if(!validSurface(surface))return false;
   state.surface=surface;updateSurfaces();conditionSection.hidden=false;const condition=tidy(candidate?.condition),matched=catalog.find(item=>item.label.toLocaleLowerCase('es-MX')===condition.toLocaleLowerCase('es-MX')||item.code===candidate?.conditionCode);
   selectCondition(matched?.code||'other',matched?.label||condition);if(!matched){otherInput.value=condition;state.condition=condition;renderReview();}return true;
  };
  host.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.mode!=='create'){event.preventDefault();resetComposer(true);}});
  return Object.freeze({update,preview,focus:()=>{const target=content.hidden?empty:state.surface?conditionSection:surfaceGroup;target?.scrollIntoView?.({block:'nearest'});},destroy:()=>{host.replaceChildren();host.classList.remove('dfe-host');}});
 }

 return Object.freeze({mount,surfaceLabel:surfaceCopy,conditions:fallbackConditions});
});
