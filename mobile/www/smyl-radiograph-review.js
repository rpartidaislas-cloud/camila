/* Dentist-controlled radiograph review: consent, one AI call, manual placement and explicit confirmation. */
(function(){
 'use strict';
 let active=null;
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='rr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 const typeLabel={panoramic:'Panorámica',periapical:'Periapical',bitewing:'Aleta de mordida',other:'Radiografía'};
 const categoryLabel={density:'Densidad',contour:'Contorno',restoration:'Restauración',support:'Soporte periodontal',development:'Desarrollo dental',other:'Señal por revisar'};
 const stateLabel={pending:'Por revisar',confirmed:'Confirmada',rejected:'Descartada'};
 let dialogSequence=0;
 function viewportNavigation(viewport,stage,options){
  let mouse=null,touch=null;const clamp=(value,min,max)=>Math.max(min,Math.min(max,value)),zoom=()=>Number(options.getZoom()),remember=()=>{if(!stage.offsetWidth||!stage.offsetHeight)return;options.remember?.(clamp((viewport.scrollLeft+viewport.clientWidth/2)/stage.offsetWidth,0,1),clamp((viewport.scrollTop+viewport.clientHeight/2)/stage.offsetHeight,0,1));};
  const state=()=>viewport.classList.toggle('is-zoomed',zoom()>1.01),zoomAt=(value,clientX,clientY,reset=false)=>{const rect=viewport.getBoundingClientRect(),localX=clientX==null?viewport.clientWidth/2:clamp(clientX-rect.left,0,viewport.clientWidth),localY=clientY==null?viewport.clientHeight/2:clamp(clientY-rect.top,0,viewport.clientHeight),x=(viewport.scrollLeft+localX)/Math.max(stage.offsetWidth,1),y=(viewport.scrollTop+localY)/Math.max(stage.offsetHeight,1),next=clamp(Number(value)||1,1,3);options.setZoom(next);options.apply();state();void stage.offsetWidth;viewport.scrollLeft=reset?0:x*stage.offsetWidth-localX;viewport.scrollTop=reset?0:y*stage.offsetHeight-localY;remember();};
  const distance=touches=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY),middle=touches=>({x:(touches[0].clientX+touches[1].clientX)/2,y:(touches[0].clientY+touches[1].clientY)/2});
  viewport.tabIndex=0;viewport.setAttribute('aria-label','Visor radiográfico. Amplía y arrastra para recorrer la imagen.');state();
  viewport.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'||options.blocked?.()||event.target.closest('button')||zoom()<=1.01)return;mouse={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.classList.add('is-panning');viewport.setPointerCapture?.(event.pointerId);});
  viewport.addEventListener('pointermove',event=>{if(!mouse)return;event.preventDefault();viewport.scrollLeft=mouse.left-(event.clientX-mouse.x);viewport.scrollTop=mouse.top-(event.clientY-mouse.y);remember();});
  const release=()=>{mouse=null;viewport.classList.remove('is-panning');};viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);
  viewport.addEventListener('touchstart',event=>{if(options.blocked?.())return;if(event.touches.length===2)touch={kind:'pinch',distance:distance(event.touches)};else if(event.touches.length===1&&zoom()>1.01)touch={kind:'pan',x:event.touches[0].clientX,y:event.touches[0].clientY,left:viewport.scrollLeft,top:viewport.scrollTop};},{passive:true});
  viewport.addEventListener('touchmove',event=>{if(options.blocked?.())return;if(event.touches.length===2){event.preventDefault();const nextDistance=distance(event.touches),point=middle(event.touches),base=touch?.kind==='pinch'&&touch.distance?touch.distance:nextDistance;zoomAt(zoom()*(nextDistance/base),point.x,point.y);touch={kind:'pinch',distance:nextDistance};return;}if(event.touches.length===1&&zoom()>1.01){event.preventDefault();if(touch?.kind!=='pan')touch={kind:'pan',x:event.touches[0].clientX,y:event.touches[0].clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.scrollLeft=touch.left-(event.touches[0].clientX-touch.x);viewport.scrollTop=touch.top-(event.touches[0].clientY-touch.y);remember();}},{passive:false});
  viewport.addEventListener('touchend',()=>{touch=null;});viewport.addEventListener('touchcancel',()=>{touch=null;});viewport.addEventListener('scroll',remember,{passive:true});
  viewport.addEventListener('keydown',event=>{if(options.blocked?.())return;const step=48;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&zoom()>1.01){event.preventDefault();viewport.scrollBy({left:event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,top:event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0});remember();}else if(event.key==='+'||event.key==='='){event.preventDefault();zoomAt(zoom()+.25);}else if(event.key==='-'){event.preventDefault();zoomAt(zoom()-.25);}else if(event.key==='0'){event.preventDefault();zoomAt(1,null,null,true);}});
  return {zoomAt,reset:()=>zoomAt(1,null,null,true),restore:(x=.5,y=.5)=>requestAnimationFrame(()=>{viewport.scrollLeft=clamp(x,0,1)*stage.offsetWidth-viewport.clientWidth/2;viewport.scrollTop=clamp(y,0,1)*stage.offsetHeight-viewport.clientHeight/2;remember();})};
 }
 function notice(title,message){
  const dialog=n('dialog','rr-confirm-dialog'),titleId='rr-notice-title-'+(++dialogSequence),heading=n('h2','',title),actions=n('div','rr-confirm-actions');heading.id=titleId;dialog.setAttribute('aria-labelledby',titleId);actions.append(button('Entendido',()=>dialog.close(),'rr-primary'));dialog.append(heading,n('p','',message),actions);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();actions.firstChild.focus();
 }
 function confirmClose(run){
  if(run.confirmDialog?.open)return;const dialog=n('dialog','rr-confirm-dialog'),titleId='rr-confirm-title-'+(++dialogSequence),heading=n('h2','',run.busy?'Guardado en proceso':'Decisión sin guardar'),message=n('p','',run.busy?'SMYL está verificando esta decisión con el servidor. Espera a que termine antes de salir.':'La señal que estás editando todavía no se ha confirmado. Las decisiones guardadas anteriormente permanecen en el expediente.'),actions=n('div','rr-confirm-actions');heading.id=titleId;dialog.setAttribute('aria-labelledby',titleId);actions.append(button('Continuar revisando',()=>dialog.close()),button('Salir sin guardar esta edición',()=>{dialog.close();close(run,true);},'rr-primary'));dialog.append(heading,message,actions);document.body.append(dialog);run.confirmDialog=dialog;dialog.addEventListener('close',()=>{dialog.remove();if(run.confirmDialog===dialog)run.confirmDialog=null;},{once:true});dialog.showModal();actions.firstChild.focus();
 }
 function close(run=active,force=false){if(!run||run.closed)return false;if(!force&&(run.busy||run.dirty)){confirmClose(run);return false;}run.closed=true;clearTimeout(run.statusTimer);if(run.keyHandler)document.removeEventListener('keydown',run.keyHandler);if(run.syncHandler){document.removeEventListener('visibilitychange',run.syncHandler);window.removeEventListener('focus',run.syncHandler);}run.abort?.abort();run.confirmDialog?.close();URL.revokeObjectURL(run.url);run.dialog.close();run.dialog.remove();if(active===run)active=null;run.focus?.focus?.({preventScroll:true});return true;}
 async function open({study,blob,tenant,patient,current}){
  if(active){close();if(active)return;}if(!(blob instanceof Blob)||!current()){notice('No pudimos abrir la revisión','Vuelve a abrir la radiografía desde la ficha del paciente.');return;}
   const dialog=n('dialog','rr-dialog'),bar=n('header','rr-bar'),host=n('div','rr-host'),run={dialog,host,study,blob,tenant,patient,current,url:URL.createObjectURL(blob),revision:0,doc:null,store:null,dirty:false,busy:false,syncing:false,closed:false,focus:document.activeElement,placing:null,selected:null,toothPickerOpen:null,phase:'image',lastSavedAt:null,savingItem:null,syncHandler:null,view:{zoom:1,brightness:100,contrast:100,invert:false,centerX:.5,centerY:.5,marks:false}};active=run;
  window.SmylEvidenceWorkspace?.decorate?.(dialog,'radiograph_2d');
  const valid=()=>!run.closed&&current()&&window.miRolEquipo==='dueño'&&window.tenantId===tenant&&window.pacienteActual?.id===patient;
   const titleId='rr-dialog-title-'+(++dialogSequence),dialogTitle=n('strong','',study.label||typeLabel[study.type]||'Revisión radiográfica'),exit=button('Volver al expediente',()=>close(run));dialogTitle.id=titleId;dialog.setAttribute('aria-labelledby',titleId);run.steps=n('nav','rr-steps');exit.classList.add('rr-exit');exit.setAttribute('aria-label','Volver al expediente');bar.append(n('div','rr-identity',null),run.steps,exit);bar.firstChild.append(n('span','rr-kicker','SMYL · RADIOGRAFÍA'),dialogTitle,n('span','rr-study-meta',typeLabel[study.type]||'Radiografía'));dialog.append(bar,host);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();close(run);});dialog.addEventListener('close',()=>close(run,true));
  // Atajos para revisar sin soltar el teclado: J/K recorren las señales, C confirma la abierta y V cambia de vista.
  run.keyHandler=event=>{
   if(run.closed||active!==run||!dialog.open)return;
   if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||run.placing||!run.doc||run.doc.workflow.state!=='completed')return;
   const target=event.target;
   if(event.key==='Escape'&&run.toothPickerOpen){event.preventDefault();run.toothPickerOpen=null;render();requestAnimationFrame(()=>host.querySelector('[data-rr-tooth-trigger="'+run.selected+'"]')?.focus({preventScroll:true}));return;}
   if(target&&(/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)||target.isContentEditable||target.closest?.('.rr-tooth-picker, .rr-tooth-dock')))return;
   const key=event.key.toLowerCase();
   if(key==='j'||key==='k'){const items=run.doc.items||[];if(!items.length)return;const at=items.findIndex(item=>item.id===run.selected),next=items[Math.max(0,Math.min(items.length-1,at<0?0:at+(key==='j'?1:-1)))];if(next&&next.id!==run.selected){event.preventDefault();selectItem(next.id);}}
   else if(key==='c'){const confirm=host.querySelector('[data-rr-decision="confirm"]');if(confirm&&!confirm.disabled){event.preventDefault();confirm.click();}}
   else if(key==='v'){const other=host.querySelector('.rr-view-switch .rr-tool[aria-pressed="false"]');if(other){event.preventDefault();other.click();}}
  };document.addEventListener('keydown',run.keyHandler);
  const status=(text,kind='')=>{clearTimeout(run.statusTimer);let e=host.querySelector('.rr-feedback');if(!e){e=n('p','rr-feedback');e.setAttribute('role','status');host.prepend(e);}e.className='rr-feedback '+kind;const tone=kind==='rr-error'?'error':kind==='rr-ok'?'success':'neutral';if(window.SmylEvidenceWorkspace?.setFeedback)window.SmylEvidenceWorkspace.setFeedback(e,{message:text,tone,key:'radiograph-review:'+tone+':'+String(text||'')});else e.textContent=text;if(kind==='rr-ok')run.statusTimer=setTimeout(()=>{if(e.isConnected){if(window.SmylEvidenceWorkspace?.setFeedback)window.SmylEvidenceWorkspace.setFeedback(e,{message:'',tone:'neutral'});else e.textContent='';e.className='rr-feedback';}},3200);};
  // Indicador de pasos de la barra superior: 1 Imagen, 2 Señales, 3 Resumen.
  const setStep=current=>{if(!run.steps)return;run.steps.replaceChildren();run.steps.setAttribute('aria-label','Pasos de la revisión');['Imagen','Señales','Resumen'].forEach((label,i)=>{const item=n('span','rr-step-item'+(i+1<current?' is-done':i+1===current?' is-on':''));if(i+1===current)item.setAttribute('aria-current','step');item.append(n('i','',i+1<current?'✓':String(i+1)),label);if(i)run.steps.append(n('span','rr-step-sep'));run.steps.append(item);});};
  const countOf=key=>key==='total'?run.doc.items.length:run.doc.items.filter(i=>i.state===key).length;
  const updateProgress=()=>{const items=run.doc?.items||[],decided=items.filter(i=>i.state!=='pending').length,fill=host.querySelector('.rr-save-prog s'),label=host.querySelector('.rr-save-prog-label');if(fill)fill.style.width=(items.length?decided/items.length*100:0)+'%';if(label)label.textContent=decided+' de '+items.length+' revisadas';};
  const nextPending=id=>{const items=run.doc?.items||[],at=Math.max(0,items.findIndex(item=>item.id===id)),ordered=items.slice(at+1).concat(items.slice(0,at+1));return ordered.find(item=>item.state==='pending')||null;};
  const savedLabel=()=>'Guardado y verificado';
  async function save(document){
   if(!valid()||!run.store||run.busy&&document===run.doc)return false;
   const saved=await run.store.save(document,run.revision);if(!valid())return false;run.doc=saved.document;run.revision=saved.revision;run.dirty=false;run.lastSavedAt=new Date(saved.updated_at||Date.now());dispatchEvent(new CustomEvent('smyl:radiograph-review-saved',{detail:{tenant,patient,study:study.id}}));return true;
  }
  async function refreshFromServer(announce=true){
   if(!valid()||!run.store||run.syncing||run.busy)return false;run.syncing=true;
   try{
    const row=await run.store.load();if(!valid()||!row||Number(row.revision)<=Number(run.revision))return false;
    if(run.dirty){status('Este estudio se actualizó en otro dispositivo. Termina o descarta la edición abierta antes de recargar.','rr-error');return false;}
    const selected=run.selected;run.doc=row.document;run.revision=row.revision;run.lastSavedAt=row.updated_at?new Date(row.updated_at):new Date();run.placing=null;run.toothPickerOpen=null;
    const items=run.doc?.items||[];run.selected=items.some(item=>item.id===selected)?selected:(items.find(item=>item.state==='pending')||items[0])?.id||null;render();if(announce)status('Revisión actualizada con los cambios guardados en el otro dispositivo.','rr-ok');return true;
   }catch(_){return false;}finally{run.syncing=false;}
  }
  // En escritorio la imagen aprovecha la mesa de lectura; sólo reserva el espacio real de los controles flotantes.
  // Si el odontograma contextual está abierto, su panel ya reduce el alto disponible sin cubrir la radiografía.
  function fitWidth(wrap,img){
   if(!window.matchMedia?.('(min-width: 960px)').matches||!wrap||!img.naturalWidth||!img.naturalHeight)return null;
   const availableWidth=wrap.clientWidth-48,availableHeight=wrap.clientHeight-72;
   return availableWidth>0&&availableHeight>0?Math.min(availableWidth,availableHeight*img.naturalWidth/img.naturalHeight):null;
  }
  function applyImageView(stage,img){const fit=fitWidth(stage.parentElement,img);stage.style.width=fit?Math.round(fit*run.view.zoom)+'px':(run.view.zoom*100)+'%';img.style.filter='brightness('+run.view.brightness+'%) contrast('+run.view.contrast+'%) invert('+(run.view.invert?1:0)+')';}
  // Dos vistas de la misma radiografía: limpia (sin marcas) y con todas las observaciones. No toca la imagen ni los datos.
  function marksToggle(stage){
   const group=n('div','rr-view-switch');group.setAttribute('role','group');group.setAttribute('aria-label','Vista de la radiografía');
   const clean=button('Original',()=>setMarks(false),'rr-tool'),marked=button('Señales',()=>setMarks(true),'rr-tool');
   function setMarks(on){run.view.marks=on;stage.classList.toggle('rr-marks-off',!on);clean.setAttribute('aria-pressed',String(!on));marked.setAttribute('aria-pressed',String(on));}
   setMarks(run.view.marks!==false);group.append(clean,marked);return group;
  }
  function viewToolbar(stage,img,viewport){
   const tools=n('div','rr-view-tools'),quick=n('div','rr-zoom-quick'),zoom=n('input'),contrast=n('input'),brightness=n('input'),zoomText=n('span','','Zoom'),zoomValue=n('output','rr-zoom-value',Math.round(run.view.zoom*100)+'%');
   tools.setAttribute('role','group');tools.setAttribute('aria-label','Herramientas de imagen radiográfica');
   quick.setAttribute('role','group');quick.setAttribute('aria-label','Zoom de la radiografía');
   Object.assign(zoom,{type:'range',min:1,max:3,step:.25,value:run.view.zoom});zoom.setAttribute('aria-label','Ampliar radiografía');
   Object.assign(contrast,{type:'range',min:60,max:180,step:5,value:run.view.contrast});contrast.setAttribute('aria-label','Contraste');
   Object.assign(brightness,{type:'range',min:60,max:160,step:5,value:run.view.brightness});brightness.setAttribute('aria-label','Brillo');
   let zoomOut,zoomIn;const updateZoom=value=>{run.view.zoom=value;zoom.value=value;zoomValue.textContent=Math.round(value*100)+'%';if(zoomOut)zoomOut.disabled=value<=1.01;if(zoomIn)zoomIn.disabled=value>=2.99;};
   const navigation=viewportNavigation(viewport,stage,{getZoom:()=>run.view.zoom,setZoom:updateZoom,apply:()=>applyImageView(stage,img),blocked:()=>!!run.placing,remember:(x,y)=>{run.view.centerX=x;run.view.centerY=y;}}),invert=button('Invertir',()=>{run.view.invert=!run.view.invert;invert.setAttribute('aria-pressed',String(run.view.invert));applyImageView(stage,img);},'rr-tool');invert.setAttribute('aria-pressed',String(run.view.invert));
   const fit=button('Ajustar',()=>navigation.reset(),'rr-tool'),reset=button('Restablecer',()=>{run.view.brightness=100;run.view.contrast=100;run.view.invert=false;run.view.centerX=.5;run.view.centerY=.5;contrast.value=100;brightness.value=100;invert.setAttribute('aria-pressed','false');navigation.reset();applyImageView(stage,img);},'rr-tool');
   zoomOut=button('−',()=>navigation.zoomAt(run.view.zoom-.25),'rr-zoom-button');zoomIn=button('+',()=>navigation.zoomAt(run.view.zoom+.25),'rr-zoom-button');zoomOut.setAttribute('aria-label','Alejar radiografía');zoomIn.setAttribute('aria-label','Ampliar radiografía');zoomValue.setAttribute('aria-live','polite');updateZoom(run.view.zoom);
   zoom.oninput=()=>navigation.zoomAt(zoom.value);contrast.oninput=()=>{run.view.contrast=Number(contrast.value);applyImageView(stage,img);};brightness.oninput=()=>{run.view.brightness=Number(brightness.value);applyImageView(stage,img);};
   const restore=()=>navigation.restore(run.view.centerX,run.view.centerY);if(img.complete)restore();else img.addEventListener('load',restore,{once:true});
   const control=(label,input)=>{const box=n('label','rr-tool-range');box.append(typeof label==='string'?n('span','',label):label,input);return box;};quick.append(zoomOut,control(zoomText,zoom),zoomValue,zoomIn,fit);tools.append(control('Contraste',contrast),control('Brillo',brightness),invert,reset);return {quick,tools};
  }
  function selectItem(id){run.selected=id;run.placing=null;run.toothPickerOpen=null;render();requestAnimationFrame(()=>{const card=host.querySelector('[data-rr-item="'+id+'"]');if(!card)return;card.focus({preventScroll:true});card.scrollIntoView({block:'nearest',inline:'nearest'});});}
  // Edición del cuadro de la señal abierta. Trabaja en fracciones de la imagen (0 a 1) con el mismo tamaño mínimo y máximo que el
  // contrato guardado (0.02 a 0.6) y deja el resultado como cambio del dentista (la señal vuelve a «por revisar»).
  function makeBoxEditable(item,index,view){
   const {box,mark,toothTag,stage}=view,MIN=.02,MAX=.6,clamp=(value,low,high)=>Math.max(low,Math.min(high,value)),round=value=>Math.round(value*1000)/1000;
   let rect={left:view.left,top:view.top,width:view.w,height:view.h},changed=false,issueBefore=SmylRadiographReviewModel.positionIssue(study.type,item.tooth,item.x,item.y);
   box.classList.add('is-editable');box.removeAttribute('aria-hidden');box.tabIndex=0;box.setAttribute('role','group');
   box.setAttribute('aria-label','Cuadro de la señal '+(index+1)+'. Flechas para moverlo; Mayús y flechas para cambiar su tamaño.');
   ['nw','n','ne','e','se','s','sw','w'].forEach(side=>{const handle=n('span','rr-handle');handle.dataset.handle=side;box.append(handle);});
   const paint=()=>{const l=rect.left*100+'%',t=rect.top*100+'%';box.style.left=l;box.style.top=t;box.style.width=rect.width*100+'%';box.style.height=rect.height*100+'%';mark.style.left=l;mark.style.top=t;};
   const commit=()=>{
    item.x=round(rect.left+rect.width/2);item.y=round(rect.top+rect.height/2);item.w=round(rect.width);item.h=round(rect.height);
    const issue=SmylRadiographReviewModel.positionIssue(study.type,item.tooth,item.x,item.y);box.classList.toggle('rr-box-warn',!!issue);toothTag.textContent=(item.tooth||'?')+(issue?' !':'');
    markDirty(item);if(issue!==issueBefore){issueBefore=issue;render();}
   };
   const apply=(left,top,right,bottom,mode)=>{
    let l=left,t=top,r=right,b=bottom;
    if(mode==='move'){const width=r-l,height=b-t;l=clamp(l,0,1-width);t=clamp(t,0,1-height);r=l+width;b=t+height;}
    else{l=clamp(l,0,r-MIN);t=clamp(t,0,b-MIN);r=clamp(r,l+MIN,1);b=clamp(b,t+MIN,1);if(r-l>MAX){if(mode.includes('w'))l=r-MAX;else r=l+MAX;}if(b-t>MAX){if(mode.includes('n'))t=b-MAX;else b=t+MAX;}}
    rect={left:l,top:t,width:r-l,height:b-t};changed=true;paint();
   };
   const start=(event,mode)=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;event.preventDefault();event.stopPropagation();
    const bounds=stage.getBoundingClientRect(),origin={left:rect.left,top:rect.top,right:rect.left+rect.width,bottom:rect.top+rect.height},x0=event.clientX,y0=event.clientY;
    if(!bounds.width||!bounds.height)return;changed=false;box.setPointerCapture?.(event.pointerId);box.classList.add('is-dragging');
    const move=e=>{const dx=(e.clientX-x0)/bounds.width,dy=(e.clientY-y0)/bounds.height;
     apply(mode==='move'||mode.includes('w')?origin.left+dx:origin.left,mode==='move'||mode.includes('n')?origin.top+dy:origin.top,mode==='move'||mode.includes('e')?origin.right+dx:origin.right,mode==='move'||mode.includes('s')?origin.bottom+dy:origin.bottom,mode);};
    const end=()=>{box.removeEventListener('pointermove',move);box.removeEventListener('pointerup',end);box.removeEventListener('pointercancel',end);box.classList.remove('is-dragging');if(changed){changed=false;commit();}};
    box.addEventListener('pointermove',move);box.addEventListener('pointerup',end);box.addEventListener('pointercancel',end);
   };
   box.addEventListener('pointerdown',event=>{const handle=event.target.closest?.('.rr-handle');start(event,handle?handle.dataset.handle:'move');});
   box.addEventListener('keydown',event=>{
    const step=event.key==='ArrowLeft'?[-1,0]:event.key==='ArrowRight'?[1,0]:event.key==='ArrowUp'?[0,-1]:event.key==='ArrowDown'?[0,1]:null;if(!step)return;
    event.preventDefault();event.stopPropagation();const d=.005,right=rect.left+rect.width,bottom=rect.top+rect.height;
    if(event.shiftKey)apply(rect.left,rect.top,right+step[0]*d,bottom+step[1]*d,'se');else apply(rect.left+step[0]*d,rect.top+step[1]*d,right+step[0]*d,bottom+step[1]*d,'move');
    clearTimeout(box.commitTimer);box.commitTimer=setTimeout(()=>{changed=false;commit();},350);
   });
  }
  function imagePanel(doc,clickable=false){
   const unlocated=(doc?.items||[]).filter(i=>i.x===null&&i.state!=='rejected').length,canvas=n('section','rr-canvas'),head=n('header','rr-canvas-head'),copy=n('div'),wrap=n('div','rr-image-wrap'),stage=n('div','rr-image-stage'),img=n('img');
   canvas.setAttribute('aria-label','Imagen radiográfica original y señales ubicadas');
    const noteText=clickable?(unlocated?unlocated+(unlocated===1?' señal sin ubicación. ':' señales sin ubicación. ')+'Ábrela y usa «Ubicar señal».':'Revisa el recuadro de la señal activa.'):'El original se conserva sin modificaciones.',note=n('small','rr-canvas-note'+(clickable&&unlocated?' is-alert':''),noteText),adjustments=n('details','rr-image-adjustments'),adjustmentSummary=n('summary','','Más ajustes');copy.append(note);head.append(copy);if(clickable)head.append(marksToggle(stage));img.src=run.url;img.alt='Radiografía original · '+(study.label||study.type);stage.append(img);wrap.append(stage);applyImageView(stage,img);img.addEventListener('load',()=>applyImageView(stage,img));if(window.ResizeObserver)new ResizeObserver(()=>applyImageView(stage,img)).observe(wrap);const imageControls=viewToolbar(stage,img,wrap);adjustments.append(adjustmentSummary,imageControls.tools);canvas.append(head,imageControls.quick,adjustments,wrap);
   if(run.placing)run.view.marks=true;
   stage.classList.toggle('rr-marks-off',!run.view.marks);stage.classList.toggle('is-placing',!!run.placing);
   // Cuadros punteados sobre las zonas observadas (solo señales ubicadas; las descartadas no se dibujan). El tamaño lo propone la IA;
   // si una señal se ubicó a mano, se usa un cuadro de tamaño estándar. Los cuadros no capturan clics: la imagen sigue recibiendo la ubicación.
   (doc?.items||[]).forEach((item,index)=>{if(item.x===null||item.state==='rejected')return;
    const w=Math.min(.6,typeof item.w==='number'?item.w:.07),h=Math.min(.6,typeof item.h==='number'?item.h:.12),left=Math.max(0,Math.min(1-w,item.x-w/2)),top=Math.max(0,Math.min(1-h,item.y-h/2)),selected=run.selected===item.id;
     const contextClass=clickable&&!selected?' is-context':'',box=n('div','rr-box rr-box-'+item.state+(selected?' is-selected':'')+contextClass);box.dataset.rrBox=item.id;box.style.left=left*100+'%';box.style.top=top*100+'%';box.style.width=w*100+'%';box.style.height=h*100+'%';box.setAttribute('aria-hidden','true');
    const issue=SmylRadiographReviewModel.positionIssue(study.type,item.tooth,item.x,item.y);if(issue)box.classList.add('rr-box-warn');
    const toothTag=n('span','rr-box-tooth',(item.tooth||'?')+(issue?' !':''));box.append(toothTag);stage.append(box);
     const mark=button(String(index+1),()=>selectItem(item.id),'rr-mark rr-mark-'+item.state+(selected?' is-selected':'')+contextClass);mark.dataset.rrMark=item.id;mark.style.left=left*100+'%';mark.style.top=top*100+'%';mark.setAttribute('aria-label',(stateLabel[item.state]||'Señal')+' '+(index+1)+(item.tooth?' · pieza '+item.tooth:' · diente por indicar')+(issue?' · comprobar: la posición no coincide con la pieza':''));mark.setAttribute('aria-pressed',String(selected));stage.append(mark);
    // La señal abierta tiene el cuadro editable: se arrastra para moverlo y las asas cambian su tamaño (ratón, tacto y flechas).
    if(clickable&&selected&&!run.placing&&run.view.marks)makeBoxEditable(item,index,{box,mark,toothTag,stage,left,top,w,h});});
   if(clickable&&doc?.items?.length){const activeIndex=doc.items.findIndex(item=>item.id===run.selected),item=doc.items[activeIndex];if(item){const activeLabel=n('div','rr-active-signal','Señal activa '+(activeIndex+1)+' de '+doc.items.length+' · '+(item.tooth?'Pieza FDI '+item.tooth:'Pieza por indicar'));activeLabel.setAttribute('aria-live','polite');canvas.append(activeLabel);}}
   if(clickable)img.onclick=e=>{if(!run.placing)return;const item=run.doc.items.find(i=>i.id===run.placing),r=img.getBoundingClientRect();if(!item)return;item.x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));item.y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));item.state='pending';run.selected=item.id;run.placing=null;run.dirty=true;render();};
   if(run.placing){const prompt=n('div','rr-place');prompt.setAttribute('role','status');prompt.append(n('strong','','Ubica la señal'),n('span','','Toca la zona correspondiente en la radiografía.'));canvas.append(prompt);}
   if(clickable){const legend=n('div','rr-image-legend');legend.append(n('span','rr-key rr-key-pending','Por revisar'),n('span','rr-key rr-key-confirmed','Confirmada'),n('span','rr-key rr-key-warn','Comprobar posición'),n('span','rr-gesture-hint','Arrastra para recorrer · pellizca para ampliar'));canvas.append(legend);
    const hint=n('div','rr-hint'),kb=(keys,label)=>{const item=n('span');keys.forEach(key=>item.append(n('kbd','',key)));item.append(label);return item;};hint.setAttribute('aria-hidden','true');hint.append(kb(['J','K'],'navegar'),kb(['C'],'confirmar'),kb(['V'],'cambiar vista'),n('span','','Arrastra el cuadro abierto · asas para su tamaño'));canvas.append(hint);}
   if(clickable&&run.toothPickerOpen){const item=(doc?.items||[]).find(value=>value.id===run.toothPickerOpen&&value.id===run.selected);if(item){const source=doc.analysis.report.observations.find(value=>value.id===item.sourceId);canvas.classList.add('has-tooth-dock');canvas.append(toothPickerDock(item,source));}else run.toothPickerOpen=null;}
   return canvas;
  }
  function markDirty(item){
   item.state='pending';run.dirty=true;const confirmAction=host.querySelector('[data-rr-decision="confirm"]'),savebar=host.querySelector('.rr-save'),card=Array.from(host.querySelectorAll('[data-rr-item]')).find(node=>node.dataset.rrItem===item.id);if(confirmAction){confirmAction.disabled=false;confirmAction.textContent='Confirmar y continuar';}if(savebar){savebar.dataset.dirty='true';const title=savebar.querySelector('.rr-save-title');if(title)title.textContent='Decisión pendiente';const meta=savebar.querySelector('.rr-save-meta');if(meta)meta.textContent='Confirma o descarta esta señal para guardar los cambios.';}
   if(card){card.classList.remove('rr-item-confirmed','rr-item-rejected');card.classList.add('rr-item-pending');card.dataset.state='pending';const state=card.querySelector('.rr-state');if(state){state.className='rr-state rr-state-pending';state.textContent=stateLabel.pending;}}
   const mark=host.querySelector('[data-rr-mark="'+item.id+'"]'),box=host.querySelector('[data-rr-box="'+item.id+'"]');if(mark){mark.classList.remove('rr-mark-confirmed','rr-mark-rejected');mark.classList.add('rr-mark-pending');}if(box){box.classList.remove('rr-box-confirmed','rr-box-rejected');box.classList.add('rr-box-pending');}
   updateProgress();
  }
  async function decideItem(item,index,nextState,trigger){
   if(run.busy)return;
   const note=host.querySelector('[data-rr-item="'+item.id+'"] textarea');
   if(nextState==='confirmed'&&!item.text.trim()){status('Escribe la conclusión profesional antes de confirmar.','rr-error');note?.focus();return;}
   if(nextState==='confirmed'&&item.x===null){run.placing=item.id;run.selected=item.id;render();status('Ubica la señal en la radiografía antes de confirmarla.','rr-error');return;}
   const previousState=item.state;item.state=nextState;run.placing=null;run.toothPickerOpen=null;run.dirty=true;run.busy=true;run.savingItem=item.id;
   const card=host.querySelector('[data-rr-item="'+item.id+'"]');card?.classList.add('is-saving');card?.querySelectorAll('button,select,textarea').forEach(control=>control.disabled=true);if(trigger)trigger.textContent='Guardando…';status('Verificando y guardando la decisión…');
   try{
    if(!await save(structuredClone(run.doc)))throw Error('No pudimos verificar el guardado.');
    const pending=nextPending(item.id);run.selected=pending?.id||item.id;run.busy=false;run.savingItem=null;render();
    status('Señal '+(index+1)+' guardada.'+(pending?' Continuando con la siguiente.':''),'rr-ok');
   }catch(e){
    const current=run.doc.items.find(entry=>entry.id===item.id);if(current)current.state=previousState;run.dirty=true;run.busy=false;run.savingItem=null;render();status(e.code==='40001'?'La revisión cambió en otra sesión. La señal no se marcó como guardada. Vuelve a abrir la revisión.':'No pudimos verificar el guardado. Conservamos tu edición en esta pantalla para que puedas reintentarlo.','rr-error');
   }
  }
  // Selector FDI compacto para la señal activa. Es un control de relación de la evidencia,
  // no un segundo odontograma clínico ni una fuente paralela de datos.
  function toothGlyph(value,arch){
   const ns='http://www.w3.org/2000/svg',digit=Number(value)%10,kind=digit<=2?'incisor':digit===3?'canine':digit<=5?'premolar':'molar',outlines={
    incisor:'M16 2C12 2 10 9 10 18L9 29C5 33 4 41 6 49C8 55 12 57 16 57C20 57 24 55 26 49C28 41 27 33 23 29L22 18C22 9 20 2 16 2Z',
    canine:'M16 1C12 1 11 9 11 20L10 31C7 35 6 42 8 48L16 57L24 48C26 42 25 35 22 31L21 20C21 9 20 1 16 1Z',
    premolar:'M8 3C7 12 9 23 11 30C6 34 5 42 7 49C9 55 13 57 16 54C19 57 23 55 25 49C27 42 26 34 21 30C23 23 25 12 24 4C21 0 18 13 16 25C14 13 11 0 8 3Z',
    molar:'M6 4C5 13 8 24 10 31C5 34 4 42 6 50C8 56 12 57 16 54C20 57 24 56 26 50C28 42 27 34 22 31C24 23 27 13 26 4C23 0 20 14 18 26C17 15 15 2 13 2C11 2 9 15 8 26C7 18 7 7 6 4Z'
   },svg=document.createElementNS(ns,'svg'),shape=document.createElementNS(ns,'path'),detail=document.createElementNS(ns,'path');
   svg.setAttribute('viewBox','0 0 32 60');svg.setAttribute('aria-hidden','true');svg.classList.add('rr-tooth-glyph','rr-tooth-glyph-'+kind);if(arch==='Inferior')svg.classList.add('is-lower');shape.setAttribute('d',outlines[kind]);shape.classList.add('rr-tooth-glyph-shape');detail.setAttribute('d',kind==='molar'?'M10 36C13 33 19 33 22 36M16 34V52':kind==='premolar'?'M11 36C14 33 18 33 21 36M16 34V51':kind==='canine'?'M11 39L16 47L21 39':'M10 39C13 42 19 42 22 39');detail.classList.add('rr-tooth-glyph-detail');svg.append(shape,detail);return svg;
  }
  function toothPicker(item){
   const disabled=item.state!=='pending',picker=n('div','rr-tooth-picker'),open=run.toothPickerOpen===item.id,dockId='rr-tooth-dock-'+String(item.id).replace(/[^a-zA-Z0-9_-]/g,'-'),trigger=button('',()=>{
    if(disabled)return;run.toothPickerOpen=run.toothPickerOpen===item.id?null:item.id;render();requestAnimationFrame(()=>{
     if(run.toothPickerOpen){const dock=host.querySelector('.rr-tooth-dock'),selected=dock?.querySelector('.rr-tooth-option[aria-checked="true"]')||dock?.querySelector('.rr-tooth-option:not(:disabled)');dock?.scrollIntoView({block:'nearest',inline:'nearest'});selected?.focus({preventScroll:true});}
     else host.querySelector('[data-rr-tooth-trigger="'+item.id+'"]')?.focus({preventScroll:true});
    });
   },'rr-tooth-picker-trigger'),summaryCopy=n('span','rr-tooth-picker-copy'),selected=n('strong','rr-tooth-current',item.tooth?'Pieza FDI '+item.tooth:'Indicar pieza'),change=n('span','rr-tooth-change',item.tooth?'Cambiar':'Abrir odontograma');
   picker.dataset.disabled=String(disabled);trigger.dataset.rrToothTrigger=item.id;trigger.setAttribute('aria-expanded',String(open));if(open)trigger.setAttribute('aria-controls',dockId);trigger.disabled=disabled;summaryCopy.append(n('span','rr-section-label','PIEZA FDI'),selected);trigger.append(summaryCopy,change,n('span','rr-tooth-chevron','⌄'));picker.append(trigger);return picker;
  }
  function toothPickerDock(item,source){
   const safeId=String(item.id).replace(/[^a-zA-Z0-9_-]/g,'-'),dock=n('section','rr-tooth-dock'),head=n('header','rr-tooth-dock-head'),copy=n('div'),dockTitle=n('strong','',item.tooth?'Pieza FDI '+item.tooth:'Selecciona una pieza'),closePicker=button('Cerrar',()=>{run.toothPickerOpen=null;render();requestAnimationFrame(()=>host.querySelector('[data-rr-tooth-trigger="'+item.id+'"]')?.focus({preventScroll:true}));},'rr-tooth-picker-close'),orientation=n('div','rr-tooth-orientation'),chart=n('div','rr-tooth-chart'),suggested=String(source?.tooth||''),groups=[
    {arch:'Superior',side:'Derecha',quadrant:'1',teeth:SmylDentalModel.upper.slice(0,8)},
    {arch:'Superior',side:'Izquierda',quadrant:'2',teeth:SmylDentalModel.upper.slice(8)},
    {arch:'Inferior',side:'Derecha',quadrant:'4',teeth:SmylDentalModel.lower.slice(0,8)},
    {arch:'Inferior',side:'Izquierda',quadrant:'3',teeth:SmylDentalModel.lower.slice(8)}
   ];
   dock.id='rr-tooth-dock-'+safeId;dockTitle.id='rr-tooth-dock-title-'+safeId;dock.setAttribute('aria-labelledby',dockTitle.id);copy.append(n('span','rr-section-label','PIEZA RELACIONADA'),dockTitle);head.append(copy,closePicker);
   orientation.append(n('span','','Derecha del paciente'),n('span','','Izquierda del paciente'));chart.setAttribute('role','radiogroup');chart.setAttribute('aria-label','Pieza relacionada en odontograma FDI');
   const choose=(value)=>{if(item.state!=='pending')return;item.tooth=String(value||'');run.toothPickerOpen=null;markDirty(item);render();requestAnimationFrame(()=>host.querySelector('[data-rr-tooth-trigger="'+item.id+'"]')?.focus({preventScroll:true}));};
   groups.forEach((group,groupIndex)=>{
    const row=n('div','rr-tooth-row'),rowLabel=n('span','rr-tooth-row-label'),options=n('div','rr-tooth-options');row.dataset.arch=group.arch.toLowerCase();row.dataset.side=group.side.toLowerCase();row.dataset.quadrant=group.quadrant;row.setAttribute('aria-label','Cuadrante '+group.quadrant+', '+group.arch.toLowerCase()+' '+group.side.toLowerCase());rowLabel.append(n('strong','','Cuadrante '+group.quadrant),n('small','',group.arch+' '+group.side));options.setAttribute('role','presentation');
    group.teeth.forEach((value,toothIndex)=>{
     const tooth=String(value),control=button('',()=>choose(tooth),'rr-tooth-option'),digit=Number(tooth)%10;control.dataset.tooth=tooth;control.dataset.kind=digit<=2?'incisor':digit===3?'canine':digit<=5?'premolar':'molar';control.append(toothGlyph(tooth,group.arch),n('span','rr-tooth-number',tooth));control.setAttribute('role','radio');control.setAttribute('aria-label','Pieza FDI '+tooth);control.setAttribute('aria-checked',String(item.tooth===tooth));control.setAttribute('aria-describedby','rr-tooth-picker-help');control.disabled=item.state!=='pending';control.tabIndex=item.tooth===tooth||(!item.tooth&&groupIndex===0&&toothIndex===0)?0:-1;if(item.tooth===tooth)control.classList.add('is-selected');if(suggested===tooth){control.classList.add('is-suggested');control.dataset.suggested='true';control.title='Pieza sugerida por la IA';}
     control.addEventListener('keydown',event=>{const controls=Array.from(chart.querySelectorAll('.rr-tooth-option:not(:disabled)')),at=controls.indexOf(control),key=event.key;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(key))return;event.preventDefault();const rowStart=Math.floor(at/16)*16,rowEnd=rowStart+15;let next=at;if(key==='ArrowLeft')next=Math.max(rowStart,at-1);if(key==='ArrowRight')next=Math.min(rowEnd,at+1);if(key==='ArrowUp')next=at>=16?at-16:at;if(key==='ArrowDown')next=at<16?at+16:at;if(key==='Home')next=rowStart;if(key==='End')next=rowEnd;const nextControl=controls[next];if(!nextControl)return;nextControl.focus();const nextTooth=String(nextControl.dataset.tooth||'');if(!nextTooth||nextTooth===item.tooth)return;item.tooth=nextTooth;markDirty(item);controls.forEach(option=>{const checked=option===nextControl;option.setAttribute('aria-checked',String(checked));option.tabIndex=checked?0:-1;option.classList.toggle('is-selected',checked);});dockTitle.textContent='Pieza FDI '+nextTooth;});
     options.append(control);
    });row.append(rowLabel,options);chart.append(row);
   });
   closePicker.setAttribute('aria-label','Cerrar selector de pieza');
   const footer=n('footer','rr-tooth-dock-footer'),help=n('p','rr-tooth-picker-help','Selecciona la pieza; la cruz separa los cuatro cuadrantes FDI.'),legend=n('div','rr-tooth-legend');help.id='rr-tooth-picker-help';legend.append(n('span','rr-tooth-legend-selected','Seleccionada'),n('span','rr-tooth-legend-ai','Sugerida por IA'));footer.append(help,legend);if(item.tooth&&item.state==='pending')footer.append(button('Dejar pieza por indicar',()=>choose(''),'rr-tooth-clear'));dock.append(head,orientation,chart,footer);return dock;
  }
  function editItem(item,index){
   const source=run.doc.analysis.report.observations.find(o=>o.id===item.sourceId),selected=run.selected===item.id,card=n('article','rr-item rr-item-'+item.state+(selected?' is-selected':''));if(item.state==='pending'&&source&&item.text===source.observation)item.text='';card.dataset.rrItem=item.id;card.dataset.state=item.state;card.tabIndex=-1;card.setAttribute('aria-current',String(selected));
   card.setAttribute('role','listitem');
   const head=n('button','rr-item-head'),title=n('span','rr-item-title');head.type='button';title.append(n('span','rr-number',String(index+1)),n('span','',null));title.lastChild.append(n('strong','',categoryLabel[source?.category]||'Señal por revisar'),n('span','rr-item-location',item.tooth?'Pieza FDI '+item.tooth:'Diente por indicar'));{const issue=SmylRadiographReviewModel.positionIssue(study.type,item.tooth,item.x,item.y);if(issue)title.lastChild.append(n('span','rr-item-warn',issue==='side'?'Comprobar: la posición en la imagen no coincide con el lado de esta pieza.':'Comprobar: la posición en la imagen no coincide con la arcada de esta pieza.'));};head.append(title,n('span','rr-state rr-state-'+item.state,stateLabel[item.state]));head.onclick=()=>selectItem(item.id);card.append(head);
   if(!selected)return card;
   const body=n('div','rr-item-body'),ai=n('details','rr-ai-summary'),aiSummary=n('summary'),aiBody=n('div','rr-ai-body');aiSummary.append(n('span','rr-ai-icon','IA'),n('span','',null),n('small','','Ver detalle'));aiSummary.children[1].append(n('strong','','Sugerencia de IA'),n('span','',source?.observation||'Señal visual pendiente de comprobar.'));
   const fact=(label,value)=>{const row=n('div','rr-ai-fact');row.append(n('span','',label),n('p','',value));return row;};aiBody.append(fact('Qué observa',source?.observation||'Señal visual pendiente de comprobar.'),fact('Dónde',source?.evidence||'Zona pendiente de comprobar en el original.'),fact('Validar','Confirma la pieza, la ubicación y tu conclusión en la imagen original.'));ai.append(aiSummary,aiBody);body.append(ai);
   const decision=n('section','rr-clinical-decision'),decisionHead=n('header');decisionHead.append(n('span','rr-section-label','VALIDACIÓN CLÍNICA'),n('h3','','Conclusión profesional'),n('p','','Esta información se guardará en el expediente.'));decision.append(decisionHead);
   const tooth=toothPicker(item);
   const textLabel=n('label','rr-field','Conclusión clínica'),text=n('textarea');text.rows=2;text.maxLength=600;text.value=item.text;text.disabled=item.state!=='pending';text.placeholder='Describe lo que confirmas en esta zona.';text.setAttribute('aria-label','Conclusión profesional de la señal '+(index+1));text.oninput=()=>{item.text=text.value;markDirty(item);};textLabel.append(text,n('small','rr-field-help','Obligatoria para confirmar.'));
   const locate=button(item.x===null?'Ubicar señal':'Ajustar recuadro',()=>{run.placing=item.id;run.selected=item.id;render();},'rr-secondary'),location=n('div','rr-location-row');location.append(n('div','',null),locate);location.firstChild.append(n('strong','','Zona en la imagen'),n('span','rr-location',item.x===null?'Señal todavía sin ubicación.':item.state==='confirmed'?'Ubicación validada.':'Ajusta el recuadro directamente sobre la radiografía.'));
   decision.append(tooth,textLabel,location,n('p','rr-decision-note',item.state==='pending'?'Guarda tu decisión en la barra inferior.':'Decisión verificada. Usa «Editar decisión» para cambiarla.'));body.append(decision);card.append(body);return card;
  }
  function signalPanel(){
   const panel=n('aside','rr-signal-panel'),head=n('header','rr-panel-head'),list=n('div','rr-items'),items=run.doc.items||[];if(items.length&&!items.some(item=>item.id===run.selected))run.selected=items[0].id;const selectedIndex=Math.max(0,items.findIndex(item=>item.id===run.selected)),selected=items[selectedIndex],report=run.doc.analysis.report,queue=n('details','rr-signal-queue'),queueSummary=n('summary','','Ver todas las señales'),queueList=n('div','rr-signal-queue-list'),nav=n('div','rr-signal-nav'),quality=n('span','rr-panel-quality rr-panel-quality-'+report.quality,({usable:'Imagen utilizable',limited:'Calidad limitada',unusable:'No evaluable'})[report.quality]);
   panel.setAttribute('aria-label','Decisión sobre la señal activa');list.setAttribute('role','list');list.setAttribute('aria-label','Señal clínica activa');
   const previous=button('←',()=>{if(selectedIndex>0)selectItem(items[selectedIndex-1].id);},'rr-signal-nav-button'),next=button('→',()=>{if(selectedIndex<items.length-1)selectItem(items[selectedIndex+1].id);},'rr-signal-nav-button');previous.disabled=selectedIndex<=0;next.disabled=selectedIndex>=items.length-1;previous.setAttribute('aria-label','Señal anterior');next.setAttribute('aria-label','Siguiente señal');nav.append(previous,n('span','',items.length?(selectedIndex+1)+' / '+items.length:'0 / 0'),next);
   head.append(n('span','rr-section-label',items.length?'SEÑAL '+(selectedIndex+1)+' DE '+items.length+(selected?.tooth?' · PIEZA FDI '+selected.tooth:' · PIEZA POR INDICAR'):'SIN SEÑALES'),n('h2','',selected?categoryLabel[report.observations.find(value=>value.id===selected.sourceId)?.category]||'Señal por revisar':'Revisión profesional'),n('p','',selected?'Comprueba la zona y registra una sola decisión.':'La IA no propuso zonas; continúa con tu valoración clínica.'),quality,nav,button('← Imagen',()=>{run.toothPickerOpen=null;run.phase='image';run.view.marks=false;render();},'rr-step-back'));
   items.forEach((item,index)=>{const source=run.doc.analysis.report.observations.find(value=>value.id===item.sourceId),control=button((index+1)+'. '+(categoryLabel[source?.category]||'Señal')+' · '+stateLabel[item.state],()=>{queue.open=false;selectItem(item.id);},'rr-signal-queue-item');control.setAttribute('aria-current',String(item.id===run.selected));queueList.append(control);});
   if(items.length>1){queue.append(queueSummary,queueList);head.append(queue);}
   if(selected)list.append(editItem(selected,selectedIndex));else{const empty=n('div','rr-panel-empty');empty.append(n('strong','','Sin señales automáticas'),n('p','','Revisa el estudio original y registra manualmente cualquier hallazgo clínico.'));list.append(empty);}
   panel.append(head,list);return panel;
  }
  function qualityPopover(report){
   const quality=n('details','rr-qpop rr-qpop-'+report.quality),qualitySummary=n('summary','',({usable:'Imagen utilizable',limited:'Imagen limitada',unusable:'No evaluable por IA'})[report.quality]),qualityBody=n('div','rr-qpop-body');
   qualityBody.append(n('span','rr-section-label','CALIDAD DEL ESTUDIO'),n('p','',report.qualityNote));
   if(report.limitations.length){const list=n('ul');report.limitations.forEach(value=>list.append(n('li','',value)));qualityBody.append(n('span','rr-section-label','LIMITACIONES DEL ANÁLISIS'),list);}
   if(report.quality==='unusable')quality.open=true;quality.append(qualitySummary,qualityBody);return quality;
  }
  function render(){
   if(!valid())return close(run,true);host.replaceChildren();setStep(!run.doc||run.doc.workflow.state!=='completed'||run.phase==='image'?1:run.phase==='summary'?3:2);
   if(!run.store){host.append(n('section','rr-empty',null));host.firstChild.append(n('h1','','Revisión asistida preparada'),n('p','','El guardado privado de esta fase aún no está activado. La radiografía no se enviará a IA desde esta pantalla.'),n('p','rr-note','Puedes abrir el archivo original para registrar observaciones manuales.'));return;}
   // Una revisión reiniciada con «Volver a intentar» queda en 'ready': vuelve a mostrar el inicio (sin crear otra fila).
   if(!run.doc||run.doc.workflow.state==='ready'){
    const intro=n('section','rr-intro');intro.append(n('p','rr-step','1 de 3 · Comprobar imagen'),n('h1','','Revisar con apoyo de IA'),n('p','rr-lead','La IA señala zonas para comprobar. No diagnostica ni modifica el mapa dental.'),imagePanel(null));
    const privacy=n('div','rr-privacy');privacy.append(n('strong','','Datos enviados'),n('p','','Una vista completa y recortes ampliados de la misma radiografía, sin nombre, notas, fotografías ni simulaciones. El original privado no cambia y esta acción puede generar consumo.'));
    const consent=n('input');consent.type='checkbox';const permission=n('label','rr-consent');permission.append(consent,document.createTextNode('Confirmo la autorización del paciente y revisaré cada sugerencia.'));
    const start=button('Iniciar revisión',async()=>{if(!consent.checked||run.busy||!valid())return;run.busy=true;start.disabled=true;status('Guardando el inicio…');run.abort=new AbortController();try{if(!run.doc){await save(SmylRadiographReviewModel.create(study));}const doc=SmylRadiographReviewModel.requested(run.doc);await save(doc);status('Analizando la vista completa y sus detalles. No cierres esta ventana.');const result=await SmylRadiographAnalysisClient.analyze({client:window.sb,tenant,study,blob,consent:true,current:valid,endpoint:window.EDGE_URL,publicKey:window.SUPA_KEY,signal:run.abort.signal});await save(SmylRadiographReviewModel.completed(run.doc,result));render();}catch(e){if(valid()){try{if(run.doc?.workflow.state==='requested')await save(SmylRadiographReviewModel.unconfirmed(run.doc));}catch(_){}render();status(e instanceof TypeError?'No se pudo confirmar la respuesta. No se repetirá automáticamente.':e.message,'rr-error');
    // Diagnóstico plegado (solo en pantalla, no se guarda): lo que devolvió la IA y por qué no se aceptó.
    if(e&&typeof e.detail==='string'&&e.detail){const box=n('details','rr-diagnostic'),pre=n('pre','',e.detail);box.append(n('summary','','Ver respuesta recibida (diagnóstico)'),pre);host.querySelector('.rr-feedback')?.after(box);}}}finally{run.busy=false;run.abort=null;}},'rr-primary');start.disabled=true;consent.onchange=()=>start.disabled=!consent.checked;intro.append(privacy,permission,n('div','rr-actions',null));intro.lastChild.append(start,button('Anotar sin IA',()=>close(run)));host.append(intro);return;
   }
   if(run.doc.workflow.state!=='completed'){
    const message=run.doc.workflow.state==='unconfirmed'?'La solicitud anterior no tuvo una respuesta confirmada. Para evitar un segundo cobro o resultados duplicados, no se repetirá desde esta revisión.':'La solicitud quedó registrada y aún no tiene una respuesta confirmada.';
    host.append(n('section','rr-empty',null));host.firstChild.append(n('h1','','Revisión sin resultado confirmado'),n('p','',message),n('p','rr-note','Puedes continuar con las anotaciones manuales sobre la imagen original o, si lo decides, volver a intentar el análisis.'));
    // Reintento explícito: la solicitud anterior pudo haberse procesado, así que un nuevo intento puede generar otro consumo.
    const retry=button('Volver a intentar',()=>{if(run.busy||!valid())return;const d=n('dialog','rr-confirm-dialog'),id='rr-retry-title-'+(++dialogSequence),h=n('h2','','Volver a intentar el análisis'),acts=n('div','rr-confirm-actions');h.id=id;d.setAttribute('aria-labelledby',id);
     acts.append(button('Cancelar',()=>d.close()),button('Volver a intentar',async()=>{d.close();if(run.busy||!valid())return;run.busy=true;retry.disabled=true;try{const row=await run.store.retry(run.revision);if(!valid())return;run.doc=row.document;run.revision=row.revision;run.dirty=false;render();status('Listo para un nuevo intento. La solicitud anterior queda en el historial.','rr-ok');}catch(e){status(e.code==='40001'||e.code==='PT409'?'La revisión cambió en otra sesión. Vuelve a abrirla.':e.code==='23514'?'Esta revisión ya no se puede reintentar.':'No se pudo reiniciar la revisión. No se envió nada.','rr-error');}finally{run.busy=false;retry.disabled=false;}},'rr-primary'));
     d.append(h,n('p','','La solicitud anterior no tuvo una respuesta confirmada y pudo haberse procesado. Un nuevo intento puede generar otro consumo del plan de IA. La solicitud anterior se conserva en el historial; no se borra nada.'),acts);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();acts.firstChild.focus();},'rr-primary');
    retry.classList.add('rr-retry');host.firstChild.append(retry);return;
   }
   const report=run.doc.analysis.report,top=n('section','rr-review');
   if(run.phase==='image'){
    top.dataset.phase='image';run.view.marks=false;const noEvaluation=report.quality==='unusable',workspace=n('div','rr-workspace rr-image-check-workspace'),canvas=imagePanel(run.doc,false),check=n('aside','rr-check-panel'),checkHead=n('header','rr-panel-head'),checkBody=n('div','rr-check-body'),qualityLabel=({usable:'Imagen utilizable',limited:'Imagen limitada',unusable:'No evaluable por IA'})[report.quality],continueButton=button(noEvaluation?'Continuar sin evaluación de IA':run.doc.items.length?'Revisar '+run.doc.items.length+' señal'+(run.doc.items.length===1?'':'es'):'Continuar al resumen',()=>{run.phase=run.doc.items.length?'signals':'summary';run.view.marks=true;if(!run.selected&&run.doc.items.length)run.selected=(run.doc.items.find(item=>item.state==='pending')||run.doc.items[0]).id;render();requestAnimationFrame(()=>host.scrollTo({top:0,behavior:'auto'}));},'rr-primary');
    checkHead.append(n('span','rr-section-label','PASO 1 DE 3'),n('h2','','Comprobar imagen'),n('p','','Verifica que el estudio sea legible antes de revisar las sugerencias.'));
    const checkStatus=n('div','rr-check-status');checkStatus.dataset.quality=report.quality;checkStatus.append(n('span','',null),n('div','',null));checkStatus.children[1].append(n('strong','',qualityLabel),n('p','',report.qualityNote));
    const checklist=n('ul','rr-check-list');if(noEvaluation){checklist.append(n('li','','La imagen original permanece guardada y disponible para revisión profesional.'),n('li','','Sube otra toma si deseas repetir el análisis asistido con mejor calidad.'));const checkActions=n('div','rr-check-actions');checkActions.append(button('Cerrar para cambiar imagen',()=>close(run),'rr-secondary'),continueButton);checkBody.append(checkStatus,checklist,checkActions,n('small','rr-check-note','Continuar no marca el estudio como revisado ni genera hallazgos automáticos.'));}else{checklist.append(n('li','','Confirma que corresponde al paciente y al estudio esperado.'),n('li','','Usa «Ajustar imagen» sólo si necesitas ampliar o mejorar la lectura.'));checkBody.append(checkStatus,checklist,continueButton,n('small','rr-check-note','La IA propone zonas para comprobar; no valida hallazgos.'));}check.append(checkHead,checkBody);canvas.append(qualityPopover(report));workspace.append(canvas,check);top.append(workspace);host.append(top);return;
   }
   if(run.phase==='summary'){
    const confirmed=countOf('confirmed'),rejected=countOf('rejected'),pending=countOf('pending'),noEvaluation=report.quality==='unusable',summary=n('section','rr-complete rr-review-summary'),actions=n('div','rr-actions');if(noEvaluation){summary.dataset.result='no-evaluation';summary.append(n('span','rr-section-label','PASO 3 DE 3 · SIN EVALUACIÓN DE IA'),n('h1','','Estudio conservado sin evaluación de IA'),n('p','rr-lead','La calidad o localización no permitió una revisión asistida confiable. El original sigue disponible.'));const state=n('section','rr-no-evaluation'),stateCopy=n('div','');stateCopy.append(n('strong','','Pendiente de revisión profesional'),n('p','',report.qualityNote));state.append(n('span','rr-no-evaluation-icon','!'),stateCopy);if(report.limitations.length){const limits=n('ul','rr-no-evaluation-limits');report.limitations.forEach(value=>limits.append(n('li','',value)));state.append(limits);}summary.append(state,n('p','rr-complete-safety','No se generaron señales automáticas y este estudio no se marcó como revisado.'));actions.append(button('Volver a comprobar la imagen',()=>{run.phase='image';run.view.marks=false;render();}),button('Continuar al expediente',()=>close(run),'rr-primary'));summary.append(actions);host.append(summary);return;}summary.append(n('span','rr-section-label','PASO 3 DE 3 · RESUMEN'),n('h1','',pending?'Revisión pendiente':'Decisiones guardadas'),n('p','rr-lead',pending?'Aún hay señales que requieren una decisión profesional.':'Sólo las señales confirmadas se incorporan al expediente.'));
    const counts=n('div','rr-complete-counts');for(const [value,label,tone] of [[confirmed,'Confirmadas','confirmed'],[rejected,'Descartadas','rejected'],[pending,'Pendientes','pending']]){const item=n('div','');item.dataset.state=tone;item.append(n('strong','',String(value)),n('span','',label));counts.append(item);}summary.append(counts);
    const decisions=n('div','rr-summary-list');run.doc.items.forEach((item,index)=>{const source=report.observations.find(value=>value.id===item.sourceId),row=n('article','rr-summary-item'),copyBox=n('div',''),state=n('span','rr-state rr-state-'+item.state,stateLabel[item.state]),professionalText=item.text&&item.text!==source?.observation?item.text:'',decision=item.state==='confirmed'?(item.text||'Sin conclusión profesional.'):item.state==='rejected'?(professionalText||'Señal descartada sin observación adicional.'):'Pendiente de decisión profesional.';copyBox.append(n('strong','',(index+1)+'. '+(categoryLabel[source?.category]||'Señal por revisar')+(item.tooth?' · Pieza '+item.tooth:'')),n('p','',decision));row.append(copyBox,state);decisions.append(row);});if(run.doc.items.length)summary.append(decisions);
    const savedAt=run.lastSavedAt instanceof Date&&!Number.isNaN(run.lastSavedAt.valueOf())?run.lastSavedAt.toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}):'';summary.append(n('p','rr-complete-safety',(savedAt?'Último guardado verificado: '+savedAt+'. ':'')+'La revisión asistida no sustituye la interpretación integral del estudio.'));
    actions.append(button(pending?'Revisar pendientes':'Volver a las señales',()=>{run.phase='signals';if(pending){const item=run.doc.items.find(value=>value.state==='pending');if(item)run.selected=item.id;}render();}),button('Cerrar y volver al expediente',()=>close(run),'rr-primary'));summary.append(actions);host.append(summary);return;
   }
   run.phase='signals';
   top.dataset.phase='signals';
   if(!run.selected&&run.doc.items.length)run.selected=(run.doc.items.find(item=>item.state==='pending')||run.doc.items[0]).id;
   const workspace=n('div','rr-workspace'),canvas=imagePanel(run.doc,true),panel=signalPanel();workspace.dataset.mode=run.placing?'placing':'review';canvas.append(qualityPopover(report));workspace.append(canvas,panel);top.append(workspace);
   const confirmed=countOf('confirmed'),pending=countOf('pending'),footer=n('footer','rr-save'),info=n('div','rr-save-info'),prog=n('div','rr-save-prog'),progBar=n('span','rr-save-prog-bar'),selectedItem=run.doc.items.find(item=>item.id===run.selected),selectedIndex=run.doc.items.findIndex(item=>item.id===run.selected),footerActions=n('div','rr-footer-actions');progBar.append(n('s'));prog.append(n('b','rr-save-prog-label'),progBar);footer.dataset.dirty=String(run.dirty);footer.dataset.saving=String(run.busy);
   const footerTitle=run.busy?'Guardando decisión…':run.dirty?'Decisión pendiente':selectedItem?.state==='pending'?'Pendiente de decisión':savedLabel(),footerMeta=run.busy?'Verificando con el servidor.':run.dirty?'Confirma o descarta esta señal para guardar los cambios.':selectedItem?.state==='pending'?'Completa la conclusión y decide esta señal.':confirmed+' confirmadas · '+pending+' por revisar';info.append(n('strong','rr-save-title',footerTitle),n('span','rr-save-meta',footerMeta));
   if(selectedItem?.state==='pending'){
    const reject=button('Descartar',()=>decideItem(selectedItem,selectedIndex,'rejected',reject),'rr-tertiary'),confirm=button('Confirmar y continuar',()=>decideItem(selectedItem,selectedIndex,'confirmed',confirm),'rr-primary');reject.dataset.rrDecision='reject';confirm.dataset.rrDecision='confirm';reject.disabled=confirm.disabled=run.busy;footerActions.append(reject,confirm);
   }else{
    const edit=button('Editar decisión',()=>{if(!selectedItem||run.busy)return;selectedItem.state='pending';run.dirty=true;render();requestAnimationFrame(()=>host.querySelector('[data-rr-item="'+selectedItem.id+'"] textarea')?.focus());}),next=button(pending?'Siguiente señal':'Ver resumen',()=>{if(run.busy)return;if(pending){const item=nextPending(run.selected);if(item)selectItem(item.id);return;}run.phase='summary';render();},'rr-primary');edit.disabled=!selectedItem||run.busy;next.disabled=run.busy;footerActions.append(edit,next);
   }
   footer.append(prog,info,footerActions,n('p','rr-save-note','Cada decisión se guarda al confirmarla o descartarla. La IA nunca valida por sí sola.'));panel.append(footer);host.append(top);updateProgress();
  }
  host.append(n('p','rr-feedback','Abriendo la revisión privada…'));
  try{run.store=await SmylRadiographReviewStore.connect(window.sb,{tenant,patient,study,current:valid});const row=await run.store.load();if(!valid())return;run.doc=row?.document||null;run.revision=row?.revision||0;run.lastSavedAt=row?.updated_at?new Date(row.updated_at):null;render();run.syncHandler=()=>{if(document.visibilityState!=='hidden')void refreshFromServer(true);};document.addEventListener('visibilitychange',run.syncHandler);window.addEventListener('focus',run.syncHandler);}catch(e){if(valid()){run.store=null;render();status(['42P01','PGRST205','PGRST202','42883'].includes(e.code)||e.message.includes('no habilitada')?'Esta fase está preparada localmente, pero el guardado aún no está activado en la clínica.':e.message,'rr-error');}}
 }
 addEventListener('pagehide',()=>close(active,true));
 window.SmylRadiographReview={open,close:()=>close(active,true),viewportNavigation};
})();
