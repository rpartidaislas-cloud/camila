/* Manual photograph annotations. No diagnosis, ideal values, network or image mutation. */
(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;else root.SmylAnalysisModel=model;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const tools={
    facialMidline:{label:'Línea media facial',kind:'line',color:'#86e0d1',points:['Referencia facial superior','Referencia facial inferior'],help:'Marca dos referencias del centro del rostro. No se fuerza a coincidir con los dientes.'},
    interpupillary:{label:'Línea bipupilar',kind:'line',color:'#86e0d1',points:['Pupila a la izquierda de la foto','Pupila a la derecha de la foto'],help:'Marca el centro de cada pupila solo si ambas se distinguen. Una cabeza girada altera la comparación.'},
    upperMidline:{label:'Línea media superior',kind:'line',color:'#f3c98b',points:['Inicio entre centrales superiores','Final entre centrales superiores'],help:'Traza la línea entre los incisivos centrales superiores; no es la línea media facial.'},
    lowerMidline:{label:'Línea media inferior',kind:'line',color:'#e9a5bc',points:['Inicio entre centrales inferiores','Final entre centrales inferiores'],help:'Traza la línea entre los incisivos centrales inferiores, si son visibles.'},
    fifths:{label:'Quintos faciales',kind:'fifths',color:'#86e0d1',points:['Límite izquierdo del rostro en la foto','Límite derecho del rostro en la foto'],help:'Retícula orientativa de cinco partes iguales entre tus dos puntos. No es una regla de belleza ni una evaluación de normalidad.'},
    thirds:{label:'Tercios faciales',kind:'thirds',color:'#86e0d1',points:['Límite superior elegido','Límite inferior elegido'],help:'Retícula orientativa de tres partes iguales. Coloca los extremos; no reemplaza un análisis de proporciones individuales.'},
    incisalArc:{label:'Curva incisal',kind:'curve',color:'#f3c98b',points:['Extremo izquierdo de la curva incisal','Punto medio de la curva incisal','Extremo derecho de la curva incisal'],help:'Marca tres puntos sobre los bordes incisales visibles. La curva pasa por tus tres referencias.'},
    lipArc:{label:'Curva del labio inferior',kind:'curve',color:'#e9a5bc',points:['Extremo izquierdo del labio inferior','Centro del labio inferior','Extremo derecho del labio inferior'],help:'Dibuja el contorno visible del labio inferior para compararlo con la curva incisal.'},
    commissure:{label:'Línea entre comisuras',kind:'line',color:'#e9a5bc',points:['Comisura izquierda en la foto','Comisura derecha en la foto'],help:'Une ambas comisuras como referencia visual; no determina por sí sola el plano oclusal.'},
    gingival:{label:'Contorno gingival',kind:'curve',color:'#d3b5f8',points:['Referencia gingival izquierda','Referencia gingival central','Referencia gingival derecha'],help:'Curva general orientativa de la encía visible; no representa todos los márgenes de cada diente.'},
    occlusal:{label:'Referencia oclusal',kind:'line',color:'#f3c98b',points:['Referencia dental anterior','Referencia dental posterior'],help:'Proyección orientativa en esta foto. Usa referencias dentales visibles; no deduce contactos, mordida ni un plano 3D.',ack:'Distingo las referencias dentales anterior y posterior necesarias.'},
    camper:{label:'Camper · ala-trago',kind:'line',color:'#86e0d1',points:['Borde inferior del ala nasal','Punto elegido del trago'],help:'Requiere perfil verdadero, nariz y oreja visibles. Indica qué punto del trago usas; no se fuerza paralelismo con la oclusal.'},
    frankfort:{label:'Frankfort · estimada',kind:'line',color:'#d3b5f8',points:['Referencia superficial orbitaria','Referencia superficial auricular'],help:'Referencia fotográfica superficial, no el plano óseo porion-orbitale. No es cefalometría y no debe usarse como medición clínica del plano.',ack:'Comprendo la limitación y puedo ubicar las referencias superficiales.'}
  };
  const byView={
    frontal:['facialMidline','interpupillary','upperMidline','lowerMidline','incisalArc','lipArc','commissure','fifths','thirds','gingival'],
    left:['occlusal','camper','frankfort'],right:['occlusal','camper','frankfort'],tresCuartos:[],
    extraoral:['upperMidline','lowerMidline','incisalArc','lipArc','commissure','gingival'],
    intraoral:['upperMidline','lowerMidline','incisalArc','gingival'],intraoralLeft:['occlusal','gingival'],intraoralRight:['occlusal','gingival']
  };
  const allowed=view=>(byView[view]||[]).slice();
  const clone=value=>JSON.parse(JSON.stringify(value));
  const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  function item(value,view){
    if(!value||!allowed(view).includes(value.id))return null;
    const def=tools[value.id];
    if(!Array.isArray(value.points)||value.points.length!==def.points.length||!value.points.every(point))return null;
    if(value.id==='camper'&&!['superior','medio','inferior'].includes(value.variant))return null;
    if(def.ack&&value.acknowledged!==true)return null;
    // Reject coincident anchors, but do not invent an anatomical minimum distance.
    if(value.points.some((p,i)=>value.points.slice(0,i).some(q=>p.x===q.x&&p.y===q.y)))return null;
    return {id:value.id,points:value.points.map(p=>({x:p.x,y:p.y})),visible:value.visible!==false,locked:value.locked===true,note:typeof value.note==='string'?value.note.slice(0,500):'',variant:value.id==='camper'?value.variant:'',acknowledged:!!def.ack&&value.acknowledged===true};
  }
  function normalize(value,view,fingerprint,width,height){
    if(!value||value.schema!==1||value.view!==view||value.basis!=='imported-original'||value.fingerprint!==fingerprint||value.width!==width||value.height!==height||!Array.isArray(value.items)||value.items.length>allowed(view).length)return null;
    if(!/^[a-f0-9]{64}$/.test(fingerprint)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)return null;
    const items=value.items.map(v=>item(v,view));
    if(items.some(v=>!v)||new Set(items.map(v=>v.id)).size!==items.length)return null;
    return {schema:1,view,basis:'imported-original',fingerprint,width,height,items,savedAt:typeof value.savedAt==='string'?value.savedAt.slice(0,40):''};
  }
  function empty(view,fingerprint,width,height){return {schema:1,view,basis:'imported-original',fingerprint,width,height,items:[],savedAt:''};}
  // Geometry in image pixels. Non-square photos must not distort slopes or curves.
  function geometry(value,width,height){
    const p=value.points.map(q=>({x:q.x*width,y:q.y*height})),kind=tools[value.id].kind;
    if(kind==='curve'){
      const control={x:2*p[1].x-(p[0].x+p[2].x)/2,y:2*p[1].y-(p[0].y+p[2].y)/2};
      return {path:`M${p[0].x} ${p[0].y} Q${control.x} ${control.y} ${p[2].x} ${p[2].y}`,lines:[]};
    }
    if(kind==='line')return {lines:[[p[0],p[1]]]};
    const dx=p[1].x-p[0].x,dy=p[1].y-p[0].y,length=Math.hypot(dx,dy);
    if(!length)return {lines:[]};
    const count=kind==='fifths'?5:3,extent=Math.hypot(width,height),nx=-dy/length*extent,ny=dx/length*extent;
    const lines=[];
    for(let n=0;n<=count;n++){const x=p[0].x+dx*n/count,y=p[0].y+dy*n/count;lines.push([{x:x-nx,y:y-ny},{x:x+nx,y:y+ny}]);}
    return {lines};
  }
  async function fingerprint(source){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(v=>v.toString(16).padStart(2,'0')).join('');}
  return {tools,allowed,item,normalize,empty,clone,geometry,fingerprint};
});
