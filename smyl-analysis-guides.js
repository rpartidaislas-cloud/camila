/* Manual professional workspace. All coordinates refer to the unchanged imported image. */
(function(){
  'use strict';
  const M=window.SmylAnalysisModel,NS='http://www.w3.org/2000/svg';
  let state=null,loading=false,dialog;
  const $=id=>document.getElementById(id);
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=(text,fn,cls)=>{const b=node('button',cls,text);b.type='button';b.onclick=fn;return b;};
  const active=()=>state?.record.items.find(i=>i.id===state.active);
  function changed(){return state&&(JSON.stringify(state.record.items)!==state.baseline||state.pending.length>0);}
  function checkpoint(){state.undo.push(M.clone(state.record.items));if(state.undo.length>40)state.undo.shift();}
  function message(text){$('ag-status').textContent=text;}
  function canEdit(){return state&&!state.saving&&state.options.isCurrent();}
  function close(force){
    if(!state||state.saving)return;
    if(!force&&changed()&&!confirm('Hay cambios sin guardar en las guías. ¿Salir sin guardarlos?'))return;
    const old=state;state=null;old.observer.disconnect();clearInterval(old.sessionWatch);dialog.close();$('ag-surface').replaceChildren();$('ag-loupe').hidden=true;
    $('ag-loupe').getContext('2d').clearRect(0,0,220,220);$('ag-note').value='';message('');
    if(old.focus?.isConnected)old.focus.focus();old.resolve();
  }
  function fit(){
    if(!state)return;const viewport=$('ag-viewport'),base=Math.min(Math.max(1,viewport.clientWidth-24)/state.width,Math.max(1,viewport.clientHeight-24)/state.height);
    $('ag-surface').style.width=(state.width*base*state.zoom)+'px';$('ag-surface').style.height=(state.height*base*state.zoom)+'px';
  }
  function xy(event){const r=$('ag-surface').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};}
  function svgEl(tag,attrs){const el=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el;}
  function loupe(p){
    const canvas=$('ag-loupe'),ctx=canvas.getContext('2d'),size=canvas.width;canvas.hidden=false;
    const scale=$('ag-surface').getBoundingClientRect().width/state.width,span=canvas.clientWidth/(scale*2.5);
    ctx.fillStyle='#071020';ctx.fillRect(0,0,size,size);ctx.drawImage(state.image,p.x*state.width-span/2,p.y*state.height-span/2,span,span,0,0,size,size);
    ctx.strokeStyle='#8ae0d1';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(size/2-10,size/2);ctx.lineTo(size/2+10,size/2);ctx.moveTo(size/2,size/2-10);ctx.lineTo(size/2,size/2+10);ctx.stroke();
  }
  function draw(){
    if(!state)return;const surface=$('ag-surface'),svg=$('ag-svg');svg.replaceChildren();surface.querySelectorAll('.ag-point').forEach(n=>n.remove());
    if(state.show){
      state.record.items.filter(item=>item.visible).forEach(item=>{
        const def=M.tools[item.id],geometry=M.geometry(item,state.width,state.height),attrs={stroke:def.color,opacity:item.id===state.active?1:.65};
        if(geometry.path)svg.append(svgEl('path',{...attrs,d:geometry.path}));
        (geometry.lines||[]).forEach(([a,b])=>svg.append(svgEl('line',{...attrs,x1:a.x,y1:a.y,x2:b.x,y2:b.y,'stroke-dasharray':['fifths','thirds'].includes(def.kind)?'5 5':''})));
      });
      const item=active();
      if(item?.visible&&!item.locked)item.points.forEach((p,i)=>handle(p,i,false));
      state.pending.forEach((p,i)=>handle(p,i,true));
    }
    surface.classList.toggle('placing',!!state.active&&!active()&&state.show&&requirementsMet());
  }
  function handle(p,i,pending){
    const def=M.tools[state.active],b=button('',()=>{},'ag-point'+(pending?' pending':''));
    b.dataset.point=i;b.style.left=(p.x*100)+'%';b.style.top=(p.y*100)+'%';b.style.setProperty('--point-color',def.color);b.append(node('span','',String(i+1)));
    if(pending)b.tabIndex=-1;
    b.setAttribute('aria-label',def.points[i]+(pending?' · punto colocado':' · arrastra o usa flechas'));
    b.addEventListener('keydown',e=>{
      const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key],item=active();
      if(!delta||!canEdit()||pending||item?.locked)return;e.preventDefault();checkpoint();
      const step=e.shiftKey?10:1;item.points[i]={x:Math.max(0,Math.min(1,item.points[i].x+delta[0]*step/state.width)),y:Math.max(0,Math.min(1,item.points[i].y+delta[1]*step/state.height))};draw();update();$('ag-surface').querySelector('[data-point="'+i+'"]').focus();
    });$('ag-surface').append(b);
  }
  function requirementsMet(){
    if(!state?.active)return false;const def=M.tools[state.active];
    return (!def.ack||$('ag-ack-input').checked)&&(state.active!=='camper'||!!$('ag-variant').value);
  }
  function select(id){
    if(!canEdit()||!M.allowed(state.options.view).includes(id))return;
    state.active=id;state.pending=[];state.show=true;message('');detail();update();draw();
    if(matchMedia('(max-width:699px)').matches){
      const needsOptions=!active()&&(!!M.tools[id].ack||id==='camper');
      dialog.dataset.toolsOpen=String(needsOptions);$('ag-tools-toggle').setAttribute('aria-expanded',String(needsOptions));
      if(needsOptions)$('ag-detail').scrollIntoView({block:'nearest'});
    }
    fit();
  }
  function detail(){
    const id=state.active,def=M.tools[id],box=$('ag-detail'),item=active();box.hidden=!def;if(!def)return;
    $('ag-detail-title').textContent=def.label;$('ag-tool-help').textContent=def.help;
    $('ag-tool-help').classList.toggle('ag-warning',!!def.ack||id==='camper');
    $('ag-variant-label').hidden=id!=='camper';$('ag-variant').value=item?.variant||'';$('ag-variant').disabled=!!item?.locked;
    $('ag-ack').hidden=!def.ack;$('ag-ack-copy').textContent=def.ack||'';$('ag-ack-input').checked=item?.acknowledged===true;$('ag-ack-input').disabled=!!item;
    $('ag-item-actions').hidden=!item;$('ag-note-label').hidden=!item;$('ag-note').hidden=!item;$('ag-note').value=item?.note||'';$('ag-note').disabled=!!item?.locked;
    $('ag-place').hidden=!!item;
  }
  function update(){
    if(!state)return;const item=active(),def=M.tools[state.active],placing=def&&!item;
    $('ag-tool-list').querySelectorAll('[data-guide]').forEach(b=>{const saved=state.record.items.find(i=>i.id===b.dataset.guide);b.setAttribute('aria-pressed',String(b.dataset.guide===state.active));b.querySelector('b').textContent=saved?(saved.locked?'Fija':'✓'):'';});
    $('ag-undo').disabled=!state.undo.length&&!state.pending.length;$('ag-save').disabled=state.saving||!!state.pending.length||!canEdit()||!M.allowed(state.options.view).length;
    $('ag-place').disabled=!requirementsMet();
    $('ag-toggle').setAttribute('aria-pressed',String(state.show));$('ag-toggle').textContent=state.show?'Ocultar guías':'Mostrar guías';
    $('ag-visible').textContent=item?.visible?'Ocultar':'Mostrar';$('ag-lock').textContent=item?.locked?'Desbloquear':'Bloquear';$('ag-delete').disabled=!!item?.locked;
    let hint='Elige una guía y coloca sus puntos sobre la foto. No hay detección automática.';
    if(!M.allowed(state.options.view).length)hint='La vista 3/4 no admite estas referencias. Usa una frontal o un perfil verdadero.';
    else if(!state.show)hint='Guías ocultas. La fotografía no se ha modificado.';
    else if(placing){
      if(!requirementsMet())hint='Abre Opciones y revisa '+(state.active==='camper'?'el punto del trago antes de trazar.':'la limitación de esta referencia antes de trazar.');
      else hint='Toca: '+def.points[state.pending.length]+'. '+(state.pending.length+1)+' de '+def.points.length+'.';
    }else if(item)hint=item.locked?'Guía bloqueada. Desbloquéala en Opciones para mover sus puntos.':!item.visible?'Esta guía está oculta. Puedes volver a mostrarla en Opciones.':'Arrastra los puntos. Usa Acercar para ver detalle; al ampliar puedes desplazar la foto.';
    $('ag-hint').textContent=hint;
    $('ag-save').textContent=state.saving?'Guardando…':'Guardar guías';
  }
  function undo(){
    if(!canEdit())return;if(state.pending.length)state.pending.pop();else if(state.undo.length)state.record.items=state.undo.pop();detail();draw();update();message('');
  }
  function changeItem(fn){const item=active();if(!canEdit()||!item)return;checkpoint();fn(item);detail();draw();update();message('');}
  async function save(){
    if(!canEdit())return;if(state.pending.length){message('Completa los puntos o usa Deshacer antes de guardar.');return;}
    const record=M.normalize(state.record,state.options.view,state.fingerprint,state.width,state.height);
    if(!record){message('Hay puntos coincidentes o datos no válidos. Revisa las guías antes de guardar.');return;}
    record.savedAt=new Date().toISOString();state.saving=true;update();
    try{
      if(!state.options.isCurrent())throw new Error('Changed');
      const saved=await state.options.onSave(record);
      if(!saved)throw new Error('Not saved');state.saving=false;state.baseline=JSON.stringify(record.items);close(true);
    }catch(_){if(state){state.saving=false;message('No se confirmó el guardado local. Conserva esta pantalla; las guías siguen aquí.');update();}}
  }
  function init(){
    if(dialog)return;
    dialog=node('dialog','ag-dialog');dialog.id='ag-dialog';dialog.setAttribute('aria-labelledby','ag-title');
    dialog.innerHTML='<header class="ag-head"><div><span class="ag-kicker">SMYL · ANÁLISIS AVANZADO</span><h2 id="ag-title">Guías de análisis</h2><p id="ag-photo-title"></p></div></header><div class="ag-body"><section class="ag-workspace" aria-label="Fotografía con guías"><div class="ag-toolbar"></div><div id="ag-viewport" class="ag-viewport"><div id="ag-surface" class="ag-surface"></div></div><canvas id="ag-loupe" class="ag-loupe" width="220" height="220" aria-hidden="true" hidden></canvas><p id="ag-hint" class="ag-hint" role="status"></p></section><aside class="ag-sidebar" id="ag-sidebar"><h3>Elige una guía</h3><p id="ag-context" class="ag-context"></p><div id="ag-tool-list" class="ag-tool-list"></div><section id="ag-detail" class="ag-detail" hidden><h3 id="ag-detail-title"></h3><p id="ag-tool-help" class="ag-limit"></p><label id="ag-variant-label" class="ag-note-label" hidden>Punto del trago<select id="ag-variant"><option value="">Elige la referencia</option><option value="superior">Superior</option><option value="medio">Medio</option><option value="inferior">Inferior</option></select></label><label id="ag-ack" class="ag-ack" hidden><input type="checkbox" id="ag-ack-input"><span id="ag-ack-copy"></span></label><div id="ag-item-actions" class="ag-detail-actions"></div><label id="ag-note-label" for="ag-note" class="ag-note-label">Observación del dentista</label><textarea id="ag-note" rows="3" maxlength="500" placeholder="Anota lo que deseas revisar…"></textarea><small>Sin milímetros ni conclusiones automáticas.</small></section></aside></div><footer class="ag-footer"><div><p>Solo avance local (24 h). Aún no se sincroniza al expediente ni se envía a la IA.</p><p id="ag-status" class="ag-status" role="status"></p></div></footer>';
    dialog.querySelector('.ag-head').append(button('Cerrar',()=>close(false),'ag-close'));
    const toolbar=dialog.querySelector('.ag-toolbar'),toggleTools=button('Opciones',()=>{const open=dialog.dataset.toolsOpen!=='true';dialog.dataset.toolsOpen=String(open);toggleTools.setAttribute('aria-expanded',String(open));fit();},'ag-mobile-tools');
    toggleTools.id='ag-tools-toggle';toggleTools.setAttribute('aria-controls','ag-sidebar');toolbar.append(toggleTools);
    const toggle=button('Ocultar guías',()=>{if(!state)return;state.show=!state.show;draw();update();});toggle.id='ag-toggle';toolbar.append(toggle);
    const back=button('Deshacer',undo);back.id='ag-undo';toolbar.append(back);
    const zoom=node('label','','Acercar'),range=node('input');range.id='ag-zoom';range.type='range';range.min=1;range.max=3;range.step=.1;range.value=1;zoom.append(range);toolbar.append(zoom);
    const saveButton=button('Guardar guías',save,'ag-save');saveButton.id='ag-save';dialog.querySelector('footer').append(saveButton);document.body.append(dialog);
    [['ag-visible','Ocultar',()=>changeItem(i=>{i.visible=!i.visible;})],['ag-lock','Bloquear',()=>changeItem(i=>{i.locked=!i.locked;})],['ag-delete','Quitar',()=>{if(!active()?.locked)changeItem(i=>{state.record.items=state.record.items.filter(v=>v!==i);});}]].forEach(([id,text,fn])=>{const b=button(text,fn);b.id=id;$('ag-item-actions').append(b);});
    const place=button('Colocar puntos',()=>{dialog.dataset.toolsOpen='false';$('ag-tools-toggle').setAttribute('aria-expanded','false');fit();$('ag-hint').scrollIntoView({block:'nearest'});});place.id='ag-place';$('ag-note-label').before(place);
    range.oninput=()=>{if(!state)return;state.zoom=Number(range.value);fit();};
    $('ag-variant').onchange=()=>{if(active())changeItem(i=>{i.variant=$('ag-variant').value;});else{draw();update();}};
    $('ag-ack-input').onchange=()=>{draw();update();};
    $('ag-note').addEventListener('focus',()=>{if(canEdit()&&active()&&!active().locked)checkpoint();});
    $('ag-note').oninput=()=>{if(canEdit()&&active()&&!active().locked){active().note=$('ag-note').value.slice(0,500);update();}};
    const surface=$('ag-surface');
    surface.addEventListener('pointerdown',e=>{
      if(!canEdit()||!state.show||e.button!==0||state.drag)return;
      const h=e.target.closest('[data-point]'),item=active();
      if(h&&!h.classList.contains('pending')&&item&&!item.locked){
        e.preventDefault();checkpoint();const r=surface.getBoundingClientRect();
        // Overlapping finger targets must choose the closest anchor, not the last DOM node.
        const distances=item.points.map(p=>Math.hypot(r.left+p.x*r.width-e.clientX,r.top+p.y*r.height-e.clientY));
        state.drag={id:e.pointerId,index:distances.indexOf(Math.min(...distances))};surface.setPointerCapture(e.pointerId);loupe(item.points[state.drag.index]);
      }
      else if(!h&&!item&&state.active&&requirementsMet()){e.preventDefault();state.tap={x:e.clientX,y:e.clientY,id:e.pointerId};surface.setPointerCapture(e.pointerId);}
    });
    surface.addEventListener('pointermove',e=>{
      if(!canEdit()||!state.drag||state.drag.id!==e.pointerId)return;e.preventDefault();const p=xy(e);active().points[state.drag.index]=p;draw();loupe(p);
    });
    surface.addEventListener('pointerup',e=>{
      if(!state)return;if(state.drag?.id===e.pointerId){const index=state.drag.index;state.drag=null;$('ag-loupe').hidden=true;update();surface.querySelector('[data-point="'+index+'"]').focus();}
      else if(state.tap?.id===e.pointerId){
        const tap=state.tap;state.tap=null;
        if(canEdit()&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<8){
          const p=xy(e);if(!state.pending.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<.002))state.pending.push(p);
          const def=M.tools[state.active];
          if(state.pending.length===def.points.length){checkpoint();state.record.items.push({id:state.active,points:M.clone(state.pending),visible:true,locked:false,note:'',variant:state.active==='camper'?$('ag-variant').value:'',acknowledged:!!def.ack&&$('ag-ack-input').checked});state.pending=[];detail();}
          draw();update();
        }
      }
      if(surface.hasPointerCapture(e.pointerId))surface.releasePointerCapture(e.pointerId);
    });
    surface.addEventListener('pointercancel',()=>{if(state?.drag){state.record.items=state.undo.pop()||state.record.items;state.drag=null;draw();}if(state)state.tap=null;$('ag-loupe').hidden=true;update();});
    dialog.addEventListener('cancel',e=>{e.preventDefault();close(false);});
    dialog.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['TEXTAREA','INPUT'].includes(e.target.tagName)){e.preventDefault();undo();}});
    window.addEventListener('beforeunload',e=>{if(changed()){e.preventDefault();e.returnValue='';}});
  }
  async function open(options){
    if(state||loading)throw new Error('Analysis already open');loading=true;
    try{
      if(!options.isCurrent()||!/^data:image\/(jpeg|png|webp);base64,/.test(options.source))throw new Error('Invalid photo');
      const image=new Image();image.src=options.source;await image.decode();
      const fingerprint=await M.fingerprint(options.source);
      if(!options.isCurrent())throw new Error('Changed');init();
      return await new Promise(resolve=>{
        const width=image.naturalWidth,height=image.naturalHeight,saved=M.normalize(options.record,options.view,fingerprint,width,height),record=saved||M.empty(options.view,fingerprint,width,height);
        state={options,image,width,height,fingerprint,record,baseline:JSON.stringify(record.items),resolve,focus:document.activeElement,active:null,pending:[],undo:[],zoom:1,show:true,saving:false,drag:null,tap:null};
        image.className='ag-photo';image.alt='Fotografía original completa para trazado manual';image.draggable=false;
        const svg=svgEl('svg',{viewBox:'0 0 '+width+' '+height,'aria-hidden':'true',class:'ag-svg'});svg.id='ag-svg';$('ag-surface').replaceChildren(image,svg);
        $('ag-photo-title').textContent=options.label+' · original completa · trazado manual';
        $('ag-context').textContent=['left','right'].includes(options.view)?'Usa perfil verdadero con nariz, ojo y oreja visibles. No reutilices estas líneas en la vista 3/4.':options.view==='frontal'?'Cabeza de frente y referencias visibles. Las guías son orientativas y las coloca el dentista.':'Solo se ofrecen las referencias compatibles con esta vista.';
        const list=$('ag-tool-list');list.replaceChildren();M.allowed(options.view).forEach(id=>{const def=M.tools[id],b=button('',()=>select(id));b.dataset.guide=id;const dot=node('span','ag-dot');dot.style.background=def.color;b.append(dot,node('span','',def.label),node('b'));list.append(b);});
        if(!M.allowed(options.view).length)list.append(node('p','ag-empty','Para estas guías necesitas una frontal o un perfil verdadero. Tu fotografía 3/4 se conserva sin cambios.'));
        $('ag-detail').hidden=true;$('ag-zoom').value=1;dialog.dataset.toolsOpen='true';$('ag-tools-toggle').setAttribute('aria-expanded','true');
        message(options.record&&!saved?'Las guías anteriores no corresponden a esta foto o no son válidas. No se han reutilizado.':'');
        dialog.showModal();state.observer=new ResizeObserver(fit);state.observer.observe($('ag-viewport'));
        state.sessionWatch=setInterval(()=>{if(state&&!state.saving&&!state.options.isCurrent())close(true);},500);
        fit();draw();update();dialog.querySelector('.ag-close').focus();
      });
    }finally{loading=false;}
  }
  window.SmylAnalysisGuides={open};
})();
