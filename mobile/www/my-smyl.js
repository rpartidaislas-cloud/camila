/* My SMYL v1: read-only presentation, not a patient authentication system.
 * Professional preview accepts verified, ephemeral blob images only.
 * No clinical documents, patient identifiers, storage, messaging or AI access.
 */
(function () {
  'use strict';
  const labels = {frontal:'Frontal',left:'Perfil izquierdo',right:'Perfil derecho',tresCuartos:'Vista 3/4',extraoral:'Detalle de sonrisa',intraoral:'Intraoral frontal',intraoralLeft:'Intraoral izquierda',intraoralRight:'Intraoral derecha'};
  let instance = 0;
  const mounted = new WeakMap();
  const el = (tag, cls, text) => { const n=document.createElement(tag); n.className=cls||''; if(text!=null)n.textContent=text; return n; };
  const button = (text, action, cls) => {const n=el('button',cls,text);n.type='button';n.onclick=action;return n;};
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  function allowedSource(source, demo) {
    if(typeof source!=='string') return false;
    if(demo) return ['icons/ui/my-smyl-example-before.svg','icons/ui/my-smyl-example-after.svg'].includes(source);
    try {const url=new URL(source);return url.protocol==='blob:'&&url.origin===location.origin;} catch (_) {return false;}
  }
  function mount(host, options) {
    const demo=options?.demo===true;
    const seen=new Set(), views=[];
    // Explicit image-only projection. Never render diagnosis, plan, contact or notes.
    for(const v of options?.views||[]) {
      if(!v||!labels[v.view]||seen.has(v.view)||!allowedSource(v.original,demo)||!allowedSource(v.result,demo))continue;
      seen.add(v.view);views.push({view:v.view,original:v.original,result:v.result});
    }
    if(!views.length) throw Error('No hay una pareja de imágenes disponible para esta vista previa.');
    mounted.get(host)?.destroy();
    const prefix='my-smyl-'+(++instance),root=el('div','ms-app');host.replaceChildren(root);
    let disposed=false, sequence=0, currentView=0, ready=false, split=50, zoom=1, x=0, y=0, gesture=null, ratio=1;
    const pointers=new Map();
    const notice=el('div','ms-notice',demo?'Muestra ilustrativa · no son fotografías de pacientes':'Vista previa para el dentista · no se ha compartido con el paciente');root.append(notice);
    const header=el('header','ms-header'),brand=el('div','ms-brand');brand.append(document.createTextNode('My '),el('strong','','smyl'),el('span','','✦'));
    header.append(brand,el('p','','Tu sonrisa, paso a paso.'));root.append(header);
    const intro=el('div','ms-intro');intro.append(el('p','ms-kicker','UN ESPACIO PARA TI'),el('h1','','Tu próxima sonrisa empieza aquí.'),el('p','','Explora tu propuesta, entiende tu revisión y conoce los próximos pasos.'));root.append(intro);
    const nav=el('div','ms-nav');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Tu espacio My SMYL');root.append(nav);
    const panels=[],tabs=[];
    ['Mi sonrisa','Mi revisión','Mi plan'].forEach((name,i)=>{
      const tab=button(name,()=>activate(i),'ms-tab'),panel=el('section','ms-panel');tab.id=prefix+'-tab-'+i;panel.id=prefix+'-panel-'+i;
      tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
      tab.onkeydown=e=>{let next=i;if(e.key==='ArrowRight')next=(i+1)%3;else if(e.key==='ArrowLeft')next=(i+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;else return;e.preventDefault();activate(next);tabs[next].focus();};
      tabs.push(tab);panels.push(panel);nav.append(tab);root.append(panel);
    });
    function activate(index){tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});pointers.clear();gesture=null;}
    const layout=el('div','ms-smile-layout'),card=el('section','ms-comparison'),aside=el('aside','ms-aside');panels[0].append(layout);layout.append(card,aside);
    const cardHead=el('div','ms-card-heading');cardHead.append(el('h2','','Una sonrisa, dos perspectivas.'),el('p','','Desliza la línea para descubrir el cambio.'));card.append(cardHead);
    const stage=el('div','ms-stage');stage.tabIndex=0;stage.setAttribute('role','group');stage.setAttribute('aria-label','Comparador. Arrastra la línea; pellizca para ampliar. También puedes usar los controles inferiores.');
    const before=el('img','ms-photo'),afterWindow=el('div','ms-after'),after=el('img','ms-photo');before.alt='Tu foto actual';after.alt='Propuesta visual, no es un resultado de tratamiento';before.draggable=after.draggable=false;afterWindow.append(after);
    const leftLabel=el('span','ms-photo-label ms-label-before','Tu foto actual'),rightLabel=el('span','ms-photo-label ms-label-after','Propuesta visual');
    const divider=el('div','ms-divider');divider.setAttribute('aria-hidden','true');divider.append(el('span','','‹  ›'));
    const loading=el('p','ms-loading','Abriendo imágenes…');loading.setAttribute('role','status');
    stage.append(before,afterWindow,divider,leftLabel,rightLabel,loading);card.append(stage);
    const controls=el('div','ms-controls'),sliderLabel=el('label','ms-range-label','Desliza para comparar'),range=el('input','ms-range');range.type='range';range.min=0;range.max=100;range.value=50;range.id=prefix+'-compare';sliderLabel.htmlFor=range.id;
    range.oninput=()=>{split=+range.value;paint();};
    const quick=el('div','ms-quick');const originalButton=button('Ver original',()=>{split=100;paint();}),middleButton=button('Comparar',()=>{split=50;paint();}),proposalButton=button('Ver propuesta',()=>{split=0;paint();});quick.append(originalButton,middleButton,proposalButton);
    const tools=el('div','ms-photo-tools'),zoomButton=button('Acercar · 1×',()=>{zoom=zoom>=3?1:Math.min(3,Math.floor(zoom)+1);x=y=0;paint();}),resetButton=button('Restablecer',()=>{zoom=1;split=50;x=y=0;paint();});tools.append(zoomButton,resetButton);
    controls.append(sliderLabel,range,quick,tools);card.append(controls);
    const viewList=el('div','ms-views');viewList.setAttribute('aria-label','Vistas de tu sonrisa');card.append(viewList);
    const viewButtons=views.map((v,i)=>{const b=button(labels[v.view],()=>selectView(i),'ms-view');viewList.append(b);return b;});
    card.append(el('p','ms-mobile-note','Es una simulación visual, no un tratamiento realizado ni una garantía de resultado.'));
    aside.append(el('p','ms-kicker','IMAGINA. COMPARA. CONVERSA.'),el('h2','','El comienzo de una conversación.'),el('p','','Esta propuesta te ayuda a explorar un cambio y comentarlo con tu dentista.'));
    const note=el('div','ms-note');note.append(el('span','ms-note-icon','i'),el('p','','Es una simulación visual, no una fotografía de un tratamiento realizado ni una garantía de resultado.'));aside.append(note);
    const next=button('Conocer mi revisión →',()=>{activate(1);tabs[1].focus();},'ms-primary');aside.append(next);
    const guide=el('div','ms-guide');guide.append(el('strong','','A tu ritmo'),el('p','','Compara, acerca los detalles y vuelve a la original las veces que quieras.'));aside.append(guide);
    emptyPanel(panels[1],'01','Tu revisión, explicada con claridad.','Todavía no hay observaciones compartidas.','Aquí verás el mapa dental y las explicaciones que tu dentista haya revisado y elegido compartir. Las sugerencias de IA pendientes de revisión no se muestran.',()=>{activate(0);tabs[0].focus();});
    emptyPanel(panels[2],'02','Un plan pensado para ti.','Todavía no hay un plan compartido.','Aquí podrás consultar las etapas y la cotización aprobada por tu dentista. La propuesta visual no establece por sí sola qué tratamiento necesitas.',()=>{activate(0);tabs[0].focus();});
    const footer=el('footer','ms-footer');footer.append(el('span','','My SMYL · Tu sonrisa, paso a paso.'),el('span','',demo?'Demostración sin datos personales.':'Vista previa local. El acceso privado y el envío todavía no están habilitados.'));root.append(footer);
    function emptyPanel(panel,number,title,status,copy,back){
      const box=el('div','ms-empty'),icon=el('span','ms-empty-number',number);icon.setAttribute('aria-hidden','true');
      box.append(icon,el('p','ms-kicker','CON EL ACOMPAÑAMIENTO DE TU DENTISTA'),el('h2','',title),el('strong','ms-empty-status',status),el('p','',copy),button('Volver a mi sonrisa',back,'ms-primary'));panel.append(box);
    }
    function paint(){
      if(disposed)return;
      const w=stage.clientWidth,h=stage.clientHeight,fw=Math.min(w,h*ratio),fh=fw/ratio;
      x=clamp(x,-Math.max(0,(fw*zoom-w)/2),Math.max(0,(fw*zoom-w)/2));y=clamp(y,-Math.max(0,(fh*zoom-h)/2),Math.max(0,(fh*zoom-h)/2));
      for(const img of [before,after])img.style.transform=`translate(${x}px,${y}px) scale(${zoom})`;
      afterWindow.style.clipPath=`inset(0 0 0 ${split}%)`;divider.style.left=split+'%';divider.hidden=split===0||split===100||!ready;
      leftLabel.hidden=split===0||!ready;rightLabel.hidden=split===100||!ready;
      range.value=split;range.setAttribute('aria-valuetext',split===100?'Solo foto actual':split===0?'Solo propuesta visual':`${split}% foto actual, ${100-split}% propuesta visual`);
      [originalButton,middleButton,proposalButton].forEach((b,i)=>b.setAttribute('aria-pressed',String(split===[100,50,0][i])));
      zoomButton.textContent='Acercar · '+Number(zoom.toFixed(1))+'×';stage.classList.toggle('ms-zoomed',zoom>1);
    }
    async function selectView(index){
      const token=++sequence;currentView=index;ready=false;split=50;zoom=1;x=y=0;pointers.clear();gesture=null;before.removeAttribute('src');after.removeAttribute('src');
      before.hidden=afterWindow.hidden=true;loading.hidden=false;loading.textContent='Abriendo imágenes…';
      [range,originalButton,middleButton,proposalButton,zoomButton,resetButton].forEach(b=>b.disabled=true);viewButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));paint();
      const load=src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('image'));img.src=src;});
      try {
        const v=views[index],[a,b]=await Promise.all([load(v.original),load(v.result)]);
        if(disposed||token!==sequence)return;
        // Do not distort dissimilar crops to manufacture an aligned comparison.
        if(Math.abs((a.naturalWidth/a.naturalHeight)/(b.naturalWidth/b.naturalHeight)-1)>.02)throw Error('ratio');
        before.src=a.src;after.src=b.src;ratio=a.naturalWidth/a.naturalHeight;ready=true;before.hidden=afterWindow.hidden=false;loading.hidden=true;
        [range,originalButton,middleButton,proposalButton,zoomButton,resetButton].forEach(b=>b.disabled=false);paint();
      } catch(error){if(!disposed&&token===sequence){loading.textContent=error.message==='ratio'?'Estas fotografías tienen encuadres distintos. Tu dentista debe revisarlas antes de compararlas.':'No se pudieron abrir estas imágenes. Vuelve a elegir la vista para reintentar.';}}
    }
    const point=e=>{const r=stage.getBoundingClientRect();return {x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2};};
    function startGesture(mode){const ps=[...pointers.values()];gesture=ps.length>=2?{mode:'pinch',distance:Math.max(1,Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y)),mx:(ps[0].x+ps[1].x)/2,my:(ps[0].y+ps[1].y)/2,x,y,zoom}:ps.length?{mode:mode||(zoom>1?'pan':'split'),px:ps[0].x,py:ps[0].y,x,y}:null;}
    stage.onpointerdown=e=>{if(!ready||e.button>0)return;pointers.set(e.pointerId,point(e));stage.setPointerCapture(e.pointerId);startGesture(e.target.closest('.ms-divider')?'split':null);if(gesture.mode==='split'){split=clamp((point(e).x/stage.clientWidth+.5)*100,0,100);paint();}e.preventDefault();};
    stage.onpointermove=e=>{
      if(!gesture||!pointers.has(e.pointerId))return;pointers.set(e.pointerId,point(e));const ps=[...pointers.values()];
      if(gesture.mode==='pinch'&&ps.length>=2){zoom=clamp(gesture.zoom*Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y)/gesture.distance,1,3);const k=zoom/gesture.zoom;x=(ps[0].x+ps[1].x)/2-(gesture.mx-gesture.x)*k;y=(ps[0].y+ps[1].y)/2-(gesture.my-gesture.y)*k;}
      else if(gesture.mode==='pan'){x=gesture.x+ps[0].x-gesture.px;y=gesture.y+ps[0].y-gesture.py;}
      else if(gesture.mode==='split')split=clamp((ps[0].x/stage.clientWidth+.5)*100,0,100);
      paint();e.preventDefault();
    };
    stage.onpointerup=stage.onpointercancel=stage.onlostpointercapture=e=>{pointers.delete(e.pointerId);startGesture();};
    stage.onkeydown=e=>{if(!ready)return;if(['+','=','-','0'].includes(e.key)){e.preventDefault();zoom=e.key==='0'?1:clamp(zoom+(e.key==='-'?-.25:.25),1,3);paint();}};
    const observer=new ResizeObserver(paint);observer.observe(stage);activate(0);selectView(currentView);
    const controller={destroy(){disposed=true;++sequence;observer.disconnect();pointers.clear();before.removeAttribute('src');after.removeAttribute('src');root.remove();if(mounted.get(host)===controller)mounted.delete(host);}};
    mounted.set(host,controller);return controller;
  }
  window.MySmyl={mount};
  function boot(){const host=document.getElementById('my-smyl-root');if(host&&new URLSearchParams(location.search).get('demo')==='1')mount(host,{demo:true,views:[{view:'frontal',original:'icons/ui/my-smyl-example-before.svg',result:'icons/ui/my-smyl-example-after.svg'}]});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
