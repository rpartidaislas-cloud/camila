// ── cot.jsx ─────────────────────────────────────────────────────
// Componentes: CodigosDescuento, ModalCodigo, getVistaZona,
// fmtFecha, ModalCotizacion, Cotizaciones
// Globals disponibles: sb, MY_TENANT_ID, fmt, uid, fmtFecha,
// sbSaveCotCompleta, sbDeleteCot, dbToCot, useState, useEffect, useMemo, useRef

// ── LÍNEAS 2911-3287 ──────────────────────────────
function CodigosDescuento(){
  const [codigos, setCodigos] = useState(loadCodigos);
  const [editing, setEditing] = useState(null); // null | {} | {code,...}
  const [search, setSearch] = useState("");

  useEffect(()=>saveCodigos(codigos),[codigos]);

  const filtered = codigos.filter(c=>
    !search || c.code.toLowerCase().includes(search.toLowerCase()) || (c.desc||"").toLowerCase().includes(search.toLowerCase())
  );

  const save = (cod)=>{
    const exists = codigos.find(c=>c.id===cod.id);
    if(exists) setCodigos(prev=>prev.map(c=>c.id===cod.id?cod:c));
    else setCodigos(prev=>[...prev,{...cod,id:Date.now()}]);
    setEditing(null);
  };
  const toggle = (id)=> setCodigos(prev=>prev.map(c=>c.id===id?{...c,activo:!c.activo}:c));
  const del = (id)=>{ if(confirm("¿Eliminar este código?")) setCodigos(prev=>prev.filter(c=>c.id!==id)); };

  const usosTotal = codigos.reduce((a,c)=>a+(c.usos||0),0);
  const activos = codigos.filter(c=>c.activo!==false).length;

  return(
    <div>
      <div className="adm-title" style={{borderLeft:"4px solid var(--c-purple)",paddingLeft:"12px"}}>Códigos de Descuento</div>
      <div className="adm-sub">{codigos.length} códigos · {activos} activos · {usosTotal} usos totales</div>

      {/* STATS */}
      <div className="cot-stats" style={{marginBottom:"18px"}}>
        <div className="cot-stat-card green">
          <div className="cot-stat-num">{activos}</div>
          <div className="cot-stat-lbl">Activos</div>
        </div>
        <div className="cot-stat-card">
          <div className="cot-stat-num">{codigos.length - activos}</div>
          <div className="cot-stat-lbl">Inactivos</div>
        </div>
        <div className="cot-stat-card blue">
          <div className="cot-stat-num">{usosTotal}</div>
          <div className="cot-stat-lbl">Usos registrados</div>
        </div>
      </div>

      <div className="toolbar">
        <input className="si" placeholder="🔍 Buscar código o descripción..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <button className="tb-btn red" onClick={()=>setEditing({})}>+ Nuevo código</button>
      </div>

      {filtered.length===0 ? (
        <div className="cot-empty">
          <div style={{fontSize:"40px",marginBottom:"10px"}}>🏷</div>
          <div style={{fontFamily:"var(--fh)",fontSize:"15px",textTransform:"uppercase"}}>{codigos.length===0?"Sin códigos creados":"Sin resultados"}</div>
          <div className="help" style={{marginTop:"6px"}}>Crea códigos de porcentaje o monto fijo para aplicar en el configurador.</div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
          {filtered.map(c=>{
            const activo = c.activo!==false;
            return(
              <div key={c.id} style={{background:"var(--g1)",border:`1.5px solid ${activo?"rgba(74,154,74,.3)":"rgba(255,255,255,.05)"}`,borderRadius:"10px",padding:"13px 16px",display:"grid",gridTemplateColumns:"auto 1fr auto auto auto",gap:"14px",alignItems:"center"}}>
                {/* Badge activo/inactivo */}
                <div style={{width:"10px",height:"10px",borderRadius:"50%",background:activo?"var(--c-success)":"var(--c-surface3)",flexShrink:0}}/>
                {/* Info */}
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
                    <span style={{fontFamily:"var(--fh)",fontSize:"16px",fontWeight:900,color:"white",letterSpacing:"1px"}}>{c.code}</span>
                    <span style={{background:c.tipo==="porcentaje"?"var(--c-warning-bg)":"var(--c-info-bg)",color:c.tipo==="porcentaje"?"var(--c-warning)":"var(--c-info)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,padding:"2px 9px",borderRadius:"10px",textTransform:"uppercase",letterSpacing:".5px"}}>
                      {c.tipo==="porcentaje"?`${c.valor}% OFF`:`$${c.valor} OFF`}
                    </span>
                    {!activo && <span style={{background:"rgba(150,150,150,.1)",color:"var(--c-text2)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,padding:"2px 9px",borderRadius:"10px",textTransform:"uppercase"}}>Inactivo</span>}
                  </div>
                  <div style={{fontSize:"12px",color:"var(--c-text2)",marginTop:"3px"}}>
                    {c.desc||<em>Sin descripción</em>}
                    {c.usos>0&&<span style={{marginLeft:"10px",color:"var(--c-text3)"}}>· {c.usos} uso{c.usos!==1?"s":""}</span>}
                    {c.vencimiento&&<span style={{marginLeft:"10px",color:"var(--c-text3)"}}>· Vence: {c.vencimiento}</span>}
                  </div>
                </div>
                {/* Toggle */}
                <div style={{width:"38px",height:"22px",borderRadius:"11px",background:activo?"var(--c-success)":"var(--c-surface3)",position:"relative",cursor:"pointer",transition:"background .2s",flexShrink:0}}
                  onClick={()=>toggle(c.id)} title={activo?"Desactivar":"Activar"}>
                  <div style={{position:"absolute",top:"3px",left:activo?"19px":"3px",width:"16px",height:"16px",background:"white",borderRadius:"50%",transition:"left .2s"}}/>
                </div>
                {/* Editar */}
                <button className="btn-n" style={{padding:"6px 12px",fontSize:"11px"}} onClick={()=>setEditing(c)}>✎ Editar</button>
                {/* Eliminar */}
                <button className="btn-n" style={{padding:"6px 10px",fontSize:"11px",color:"var(--c-danger)",borderColor:"rgba(255,100,100,.2)"}} onClick={()=>del(c.id)}>🗑</button>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL EDITAR/CREAR */}
      {editing!==null && <ModalCodigo codigo={editing} onSave={save} onCancel={()=>setEditing(null)}/>}
    </div>
  );
}

function ModalCodigo({codigo, onSave, onCancel}){
  const isNew = !codigo.id;
  const [code, setCode]   = useState(codigo.code||"");
  const [tipo, setTipo]   = useState(codigo.tipo||"porcentaje");
  const [valor, setValor] = useState(codigo.valor||"");
  const [desc, setDesc]   = useState(codigo.desc||"");
  const [activo, setActivo] = useState(codigo.activo!==false);
  const [vencimiento, setVencimiento] = useState(codigo.vencimiento||"");
  const [err, setErr]     = useState("");

  const handleSave = ()=>{
    if(!code.trim()){ setErr("El código no puede estar vacío."); return; }
    if(!valor || isNaN(valor) || parseFloat(valor)<=0){ setErr("Ingresa un valor válido mayor a 0."); return; }
    if(tipo==="porcentaje" && parseFloat(valor)>100){ setErr("El porcentaje no puede ser mayor a 100."); return; }
    onSave({
      ...codigo,
      code: code.trim().toUpperCase(),
      tipo, valor: parseFloat(valor),
      desc: desc.trim(),
      activo,
      vencimiento: vencimiento||null,
      usos: codigo.usos||0,
    });
  };

  return(
    <div className="modal-ov" onClick={onCancel}>
      <div className="modal-box" style={{maxWidth:"480px"}} onClick={e=>e.stopPropagation()}>
        <div className="modal-hdr">
          <div className="modal-ttl">{isNew?"Nuevo Código":"Editar Código"}</div>
          <button className="modal-x" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body" style={{display:"flex",flexDirection:"column",gap:"14px"}}>

          <div className="field">
            <label>Código <span style={{color:"var(--red)"}}>*</span></label>
            <input className="ai" value={code} onChange={e=>setCode(e.target.value.toUpperCase())}
              placeholder="Ej: PROMO20, DESCUENTO10..." style={{fontFamily:"var(--fh)",fontWeight:900,fontSize:"16px",letterSpacing:"2px"}}/>
            <div className="help">Solo letras, números y guiones. Se mostrará en mayúsculas.</div>
          </div>

          <div className="cot-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
            <div className="field">
              <label>Tipo de descuento <span style={{color:"var(--red)"}}>*</span></label>
              <select className="ai" value={tipo} onChange={e=>setTipo(e.target.value)}>
                <option value="porcentaje">Porcentaje (%)</option>
                <option value="monto">Monto fijo ($)</option>
              </select>
            </div>
            <div className="field">
              <label>{tipo==="porcentaje"?"Porcentaje (1–100)":"Monto ($)"} <span style={{color:"var(--red)"}}>*</span></label>
              <input className="ai" type="number" min="1" max={tipo==="porcentaje"?100:undefined}
                value={valor} onChange={e=>setValor(e.target.value)}
                placeholder={tipo==="porcentaje"?"Ej: 15":"Ej: 200"}/>
            </div>
          </div>

          <div className="field">
            <label>Descripción interna</label>
            <input className="ai" value={desc} onChange={e=>setDesc(e.target.value)}
              placeholder="Ej: Campaña verano 2025, primer pedido..."/>
          </div>

          <div className="field">
            <label>Fecha de vencimiento (opcional)</label>
            <input className="ai" type="date" value={vencimiento} onChange={e=>setVencimiento(e.target.value)}/>
            <div className="help">Deja en blanco si no tiene fecha límite.</div>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:"10px",cursor:"pointer"}} onClick={()=>setActivo(a=>!a)}>
            <div style={{width:"38px",height:"22px",borderRadius:"11px",background:activo?"var(--c-success)":"var(--c-surface3)",position:"relative",flexShrink:0,transition:"background .2s"}}>
              <div style={{position:"absolute",top:"3px",left:activo?"19px":"3px",width:"16px",height:"16px",background:"white",borderRadius:"50%",transition:"left .2s"}}/>
            </div>
            <span style={{fontSize:"13px",color:activo?"var(--c-success)":"var(--c-text2)"}}>{activo?"Activo — los clientes pueden usarlo":"Inactivo — no aparece en el configurador"}</span>
          </div>

          {err && <div style={{color:"var(--c-danger)",fontSize:"12px",background:"rgba(255,100,100,.08)",border:"1px solid rgba(255,100,100,.2)",borderRadius:"6px",padding:"8px 12px"}}>{err}</div>}

          <div style={{background:"var(--c-info-bg)",border:"1px dashed var(--c-info-bd)",borderRadius:"8px",padding:"10px 14px",fontSize:"12px",color:"var(--c-info)",lineHeight:1.5}}>
            💡 Los clientes ingresan el código en el paso 2 del configurador. El descuento se muestra en el resumen y se incluye en la cotización que llega al admin.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-n" onClick={onCancel}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave}>{isNew?"Crear código":"Guardar cambios"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAPA DE ZONAS ────────────────────────────────────────────────
const ZONAS_MAP = {
  camisa: {
    frontal:[
      {id:"manga-der-f",label:"Manga Der",x:"0%",y:"26%",w:"15%",h:"20%"},
      {id:"pecho-der-f",label:"Pecho Der",x:"15%",y:"22%",w:"27%",h:"22%"},
      {id:"pecho-izq-f",label:"Pecho Izq",x:"58%",y:"22%",w:"27%",h:"22%"},
      {id:"manga-izq-f",label:"Manga Izq",x:"85%",y:"26%",w:"15%",h:"20%"},
      {id:"cuello-f",   label:"Cuello",   x:"30%",y:"1%", w:"40%",h:"14%"},
    ],
    trasera:[
      {id:"manga-der-t",label:"Manga Der",      x:"0%", y:"26%",w:"15%",h:"20%"},
      {id:"esp-alta-t", label:"Espalda Alta",   x:"15%",y:"9%", w:"70%",h:"24%"},
      {id:"manga-izq-t",label:"Manga Izq",      x:"85%",y:"26%",w:"15%",h:"20%"},
      {id:"esp-cen-t",  label:"Espalda Centro", x:"22%",y:"35%",w:"56%",h:"34%"},
    ],
  },
  playera: {
    frontal:[
      {id:"manga-der-pf", label:"Manga Der",  x:"0%", y:"24%",w:"16%",h:"20%"},
      {id:"pecho-der-pf", label:"Pecho Der",  x:"16%",y:"18%",w:"27%",h:"24%"},
      {id:"pecho-izq-pf", label:"Pecho Izq",  x:"57%",y:"18%",w:"27%",h:"24%"},
      {id:"manga-izq-pf", label:"Manga Izq",  x:"84%",y:"24%",w:"16%",h:"20%"},
      {id:"centro-pf",    label:"Centro",     x:"30%",y:"36%",w:"40%",h:"28%"},
    ],
    trasera:[
      {id:"manga-der-pb", label:"Manga Der",    x:"0%", y:"24%",w:"16%",h:"20%"},
      {id:"esp-alta-pb",  label:"Espalda Alta", x:"16%",y:"8%", w:"68%",h:"24%"},
      {id:"manga-izq-pb", label:"Manga Izq",    x:"84%",y:"24%",w:"16%",h:"20%"},
      {id:"esp-cen-pb",   label:"Espalda Cen",  x:"16%",y:"35%",w:"68%",h:"28%"},
    ],
  },
  gorra: {
    frontal:[
      {id:"frente-g",  label:"Frente",      x:"22%",y:"10%",w:"56%",h:"48%"},
      {id:"lat-der-g", label:"Lateral Der", x:"3%", y:"16%",w:"19%",h:"34%"},
      {id:"lat-izq-g", label:"Lateral Izq", x:"78%",y:"16%",w:"19%",h:"34%"},
    ],
    trasera:[
      {id:"tras-g",   label:"Trasera",     x:"20%",y:"10%",w:"60%",h:"50%"},
      {id:"cierre-g", label:"Cierre/Clip", x:"38%",y:"62%",w:"24%",h:"20%"},
    ],
  },
  chamarra: {
    frontal:[
      {id:"manga-der-chf",label:"Manga Der",   x:"0%", y:"24%",w:"17%",h:"22%"},
      {id:"pecho-der-chf",label:"Pecho Der",   x:"17%",y:"18%",w:"26%",h:"24%"},
      {id:"pecho-izq-chf",label:"Pecho Izq",   x:"57%",y:"18%",w:"26%",h:"24%"},
      {id:"manga-izq-chf",label:"Manga Izq",   x:"83%",y:"24%",w:"17%",h:"22%"},
      {id:"centro-chf",   label:"Centro",      x:"28%",y:"40%",w:"44%",h:"26%"},
    ],
    trasera:[
      {id:"manga-der-chb",label:"Manga Der",    x:"0%", y:"24%",w:"17%",h:"22%"},
      {id:"esp-alta-chb", label:"Espalda Alta", x:"17%",y:"8%", w:"66%",h:"24%"},
      {id:"manga-izq-chb",label:"Manga Izq",    x:"83%",y:"24%",w:"17%",h:"22%"},
      {id:"esp-cen-chb",  label:"Espalda Cen",  x:"17%",y:"35%",w:"66%",h:"28%"},
    ],
  },
};

// Detecta si una zona es frontal o trasera
// Soporta IDs del ZONAS_MAP (ej: "frente-g") y también IDs legacy del configurador
// (ej: "frente_izq", "panel_frontal", "espalda", "pecho_der", etc.)
const _FRONT_KEYS = ['frente','pecho','manga','cuello','bolsillo','cara_a','panel_frontal','centro','lat_'];
const _BACK_KEYS  = ['espalda','trasera','cara_b','panel_trasero'];
function getVistaZona(zonaId){
  if(!zonaId) return "frontal";
  // Buscar en ZONAS_MAP primero (IDs exactos)
  for(const [tipo, cfg] of Object.entries(ZONAS_MAP)){
    if(cfg.frontal.find(z=>z.id===zonaId)) return "frontal";
    if(cfg.trasera.find(z=>z.id===zonaId)) return "trasera";
  }
  // Fallback: keywords del configurador
  const id = zonaId.toLowerCase();
  if(_BACK_KEYS.some(k=>id.includes(k))) return "trasera";
  return "frontal";
}

// ── Cache de SVGs cargados de Supabase ────────────────────────────
const _svgCache = {}; // key: "shapeCat|vista" → svgText

// ── Mapa shapeCat → categoría en svg_templates/svg_categorias ────────────────
var SHAPE_TO_SVG_CAT = {
  'camisa':'impresos','impresos':'impresos','blusa':'impresos',
  'camisa_mc':'impresos','camisa_ml':'impresos','oxford':'impresos',
  'gabardina':'impresos','popelina':'impresos',
  'playera':'textil','textil':'textil','camiseta':'textil',
  'playera_ml':'textil','sudadera':'textil','fleece':'textil',
  'polo':'termos','termos':'termos',
  'gorra':'gorra','cap':'gorra','gorras':'gorra',
  'bolsa':'bolsa','tote':'bolsa','totebag':'bolsa',
};
function resolveSvgCat(sc){ return SHAPE_TO_SVG_CAT[(sc||'').toLowerCase().trim()]||'impresos'; }

// ── Cache + helper para cargar SVG por URL directa ─────────────────────────
const _svgUrlCache = {};
async function fetchSvgContent(url) {
  if(!url) return null;
  if(_svgUrlCache[url]) return _svgUrlCache[url];
  try {
    const r = await fetch(url);
    if(!r.ok) return null;
    const txt = await r.text();
    if(!txt.includes('<svg')) return null;
    _svgUrlCache[url] = txt;
    return txt;
  } catch(e) { return null; }
}

async function fetchSvgTemplate(shapeCat, vista) {
  // Resolver shapeCat → categoría real en Supabase
  var catId = resolveSvgCat(shapeCat);
  const key = catId + "|" + (vista||"frontal");
  if(_svgCache[key] !== undefined) return _svgCache[key];

  try {
    // Buscar en svg_categorias primero (fuente principal)
    var svgUrl = null;
    try {
      var {data:cats} = await sb.from("svg_categorias").select("id,svgs").eq("id",catId).maybeSingle();
      if(cats&&cats.svgs){
        var vl = (vista||"frontal").toLowerCase();
        var sv = cats.svgs.find(function(s){ return (s.vista||"").toLowerCase().indexOf(vl)>=0; });
        if(sv) svgUrl = sv.url;
      }
    } catch(e2){}
    // Fallback: svg_templates
    if(!svgUrl){
      const {data} = await sb.from("svg_templates")
        .select("url,vista,categoria")
        .eq("categoria", catId)
        .ilike("vista", vista||"Frontal")
        .limit(1)
        .maybeSingle();
      if(data&&data.url) svgUrl = data.url;
    }
    if(!svgUrl){ _svgCache[key]=null; return null; }
    const data = {url: svgUrl};

    if(!data?.url) { _svgCache[key] = null; return null; }

    // Descargar el SVG
    const res = await fetch(data.url);
    if(!res.ok) { _svgCache[key] = null; return null; }
    const txt = await res.text();
    _svgCache[key] = txt;
    return txt;
  } catch(e) {
    console.warn("fetchSvgTemplate:", e.message);
    _svgCache[key] = null;
    return null;
  }
}

// Aplica el color del producto al SVG usando CSS vars
function aplicarColorSVG(svgText, colorHex) {
  if(!svgText) return svgText;
  const c = colorHex||"#c8b89a";
  // Reemplazar los CSS vars en el SVG directamente
  return svgText
    .replace(/var\(--cp\)/g, c)
    .replace(/var\(--cd\)/g, c)
    .replace(/var\(--cs\)/g, c)
    .replace(/var\(--cl\)/g, c);
}

// Mapa visual con SVG real de Supabase (o fallback hardcoded)
// onZonaClick(zona) — clic en una posición vacía: asigna ahí el arte pendiente
// onQuitarZona(zonaId) — clic en "✕" de una posición ocupada: libera esa posición (no borra el arte)
function MapaZonas({designs, tipo, color, svgUrl, svgUrlBack, onZonaClick, onQuitarZona}){
  if(!designs||designs.length===0) return null;
  const zonasIds = designs.filter(d=>d.zonaId).map(d=>d.zonaId);
  const interactivo = !!(onZonaClick||onQuitarZona);
  if(!zonasIds.length && !interactivo) return null;

  const [svgFrontal, setSvgFrontal] = useState(null);
  const [svgTrasera, setSvgTrasera] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // Posiciones REALES — las mismas que vio el cliente en el configurador (tabla svg_templates.zonas,
  // o si no hay, las marcadas dentro del propio SVG con data-zona). null = usar el set fijo de respaldo.
  const [zonasRealesF, setZonasRealesF] = useState(null);
  const [zonasRealesT, setZonasRealesT] = useState(null);

  // Determinar shapeCat desde tipo prop — resolver a ID de svg_categorias
  let shapeCat = resolveSvgCat(tipo||"camisa");
  if(!tipo) {
    const primerZona = zonasIds[0]||"";
    for(const [t,cfg] of Object.entries(ZONAS_MAP)){
      if([...cfg.frontal,...cfg.trasera].find(z=>z.id===primerZona)){
        shapeCat = t; break;
      }
    }
  }
  const cfg = ZONAS_MAP[shapeCat] || ZONAS_MAP.camisa;

  const frontales = designs.filter(d=>d.zonaId && getVistaZona(d.zonaId)==="frontal");
  const traseras  = designs.filter(d=>d.zonaId && getVistaZona(d.zonaId)==="trasera");
  const colorHex  = color||"#c8b89a";

  // Cargar SVGs — primero usa svgUrl directo del configurador, si no busca en Supabase
  useEffect(()=>{
    let active = true;
    const load = async() => {
      if(svgUrl) {
        const [f, b] = await Promise.all([
          fetchSvgContent(svgUrl),
          svgUrlBack ? fetchSvgContent(svgUrlBack) : Promise.resolve(null),
        ]);
        if(!active) return;
        setSvgFrontal(f);
        setSvgTrasera(b);
        setLoaded(true);
        return;
      }
      const [f, t] = await Promise.all([
        (frontales.length||(interactivo&&cfg.frontal.length)) ? fetchSvgTemplate(shapeCat, "Frontal") : Promise.resolve(null),
        (traseras.length||(interactivo&&cfg.trasera.length))  ? fetchSvgTemplate(shapeCat, "Trasera") : Promise.resolve(null),
      ]);
      if(!active) return;
      setSvgFrontal(f);
      setSvgTrasera(t);
      setLoaded(true);
    };
    load();
    return ()=>{ active=false; };
  }, [shapeCat, svgUrl, svgUrlBack]);

  // Cargar posiciones reales del SVG exacto que usó el cliente — misma fuente y orden de prioridad
  // que configurador.html: 1) svg_templates.zonas (Supabase) 2) data-zona dentro del SVG 3) set fijo de respaldo
  useEffect(()=>{
    let active = true;
    const parseZonasDelSvg = (txt) => {
      const vbMatch = txt.match(/viewBox="([^"]+)"/);
      let vbW=320, vbH=250;
      if(vbMatch){ const p=vbMatch[1].split(/[ ,]+/); vbW=parseFloat(p[2])||320; vbH=parseFloat(p[3])||250; }
      const re = /data-zona="([^"]+)"\s+x="([^"]+)"\s+y="([^"]+)"\s+width="([^"]+)"\s+height="([^"]+)"/g;
      let m, extraidas=[];
      while((m=re.exec(txt))!==null){
        const after = txt.slice(m.index+m[0].length, m.index+m[0].length+300);
        const lb = after.match(/class="ztxt"[^>]*>([^<]+)</);
        extraidas.push({
          id: m[1],
          label: lb ? lb[1].trim() : m[1].replace(/_/g," ").toUpperCase(),
          x: (parseFloat(m[2])/vbW*100).toFixed(1)+"%",
          y: (parseFloat(m[3])/vbH*100).toFixed(1)+"%",
          w: (parseFloat(m[4])/vbW*100).toFixed(1)+"%",
          h: (parseFloat(m[5])/vbH*100).toFixed(1)+"%",
        });
      }
      return extraidas;
    };
    const cargarZonasReales = async (url, setter) => {
      if(!url){ setter(null); return; }
      try{
        const {data} = await sb.from("svg_templates").select("zonas").eq("url", url).maybeSingle();
        if(active && data && Array.isArray(data.zonas) && data.zonas.length){
          setter(data.zonas.map(z=>({
            id: z.id || String(z.label||"zona").toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,""),
            label: z.label||"Zona",
            x: (typeof z.x==="number"?z.x:parseFloat(z.x)||0)+"%",
            y: (typeof z.y==="number"?z.y:parseFloat(z.y)||0)+"%",
            w: (typeof z.w==="number"?z.w:parseFloat(z.w)||20)+"%",
            h: (typeof z.h==="number"?z.h:parseFloat(z.h)||20)+"%",
          })));
          return;
        }
      }catch(e){}
      const txt = await fetchSvgContent(url);
      if(!active) return;
      if(txt){
        const extraidas = parseZonasDelSvg(txt);
        setter(extraidas.length ? extraidas : null);
        return;
      }
      if(active) setter(null);
    };
    cargarZonasReales(svgUrl, setZonasRealesF);
    cargarZonasReales(svgUrlBack, setZonasRealesT);
    return ()=>{ active=false; };
  }, [svgUrl, svgUrlBack]);

  // Set de posiciones a usar: las reales si se encontraron, si no el set fijo de respaldo
  const zonasFrontalUsar = zonasRealesF || cfg.frontal;
  const zonasTraseraUsar = zonasRealesT || cfg.trasera;

  // SVG fallback hardcoded (si Supabase no responde)
  const svgFallback = (shapeCat==="gorra") ? (
    <svg viewBox="0 0 220 170" style={{width:"100%",height:"100%",display:"block"}}>
      <path d="M30 108 Q30 38 110 30 Q190 38 190 108 Z" fill={colorHex} stroke="rgba(12,12,20,.15)" strokeWidth="1.5"/>
      <path d="M18 116 Q20 104 30 108 L190 108 Q200 104 202 116 Q180 138 18 116Z" fill="rgba(0,0,0,.3)" stroke="rgba(255,255,255,.1)" strokeWidth="1"/>
    </svg>
  ) : (
    <svg viewBox="0 0 200 230" style={{width:"100%",height:"100%",display:"block"}}>
      <path d="M78,38 C78,26 122,26 122,38 L165,44 C177,47 198,62 200,82 L186,90 C183,76 172,66 164,62 L164,212 Q164,218 157,218 L43,218 Q36,218 36,212 L36,62 C28,66 17,76 14,90 L0,82 C2,62 23,47 35,44 Z" fill={colorHex} opacity=".7"/>
      <path d="M78,38 C78,26 122,26 122,38 L162,44 C174,47 194,61 196,80 L183,87 C180,73 169,64 162,60 L162,210 Q162,216 155,216 L45,216 Q38,216 38,210 L38,60 C31,64 20,73 17,87 L4,80 C6,61 26,47 38,44 Z" fill={colorHex}/>
      <path d="M82,38 C86,28 114,28 118,38 Q110,50 100,53 Q90,50 82,38Z" fill="rgba(0,0,0,.2)"/>
      <path d="M46,68 C46,68 50,64 56,64 L54,208 C48,206 44,202 44,210 Z" fill="rgba(255,255,255,.12)"/>
    </svg>
  );

  const renderVista = (vistaDesigns, zonas, label, svgText) => {
    const ocupadas = zonas.filter(z=>designs.find(d=>d.zonaId===z.id));
    if(!ocupadas.length && !interactivo) return null;
    const isGorra = shapeCat==="gorra";
    const aspect = isGorra ? "76%" : "130%";
    const svgConColor = svgText ? aplicarColorSVG(svgText, colorHex) : null;

    return(
      <div style={{display:"flex",flexDirection:"column",gap:"5px",alignItems:"center"}}>
        <div style={{fontSize:"11px",fontWeight:800,letterSpacing:"2px",textTransform:"uppercase",color:"var(--c-text3)"}}>{label}</div>
        <div style={{position:"relative",width:"150px",paddingBottom:aspect,background:"var(--c-surface2)",borderRadius:"8px",overflow:"hidden",flexShrink:0}}>
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {/* SVG real de Supabase o fallback */}
            {svgConColor ? (
              <div dangerouslySetInnerHTML={{__html:svgConColor}}
                ref={function(el){
                  if(!el) return;
                  var svg = el.querySelector("svg");
                  if(!svg) return;
                  svg.removeAttribute("width");
                  svg.removeAttribute("height");
                  svg.setAttribute("preserveAspectRatio","none");
                  svg.style.cssText = "width:100%;height:100%;display:block;";
                }}
                style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}/>
            ) : (
              loaded ? svgFallback : (
                <div style={{opacity:.3,fontSize:"20px"}}>⌛</div>
              )
            )}
            {/* Todas las posiciones de esta vista — ocupadas (con arte) y libres (clickeables) */}
            {zonas.map(zona=>{
              const d = designs.find(x=>x.zonaId===zona.id);
              const lbl = (d&&d.zonaLabel)||zona.label||"";
              const tec = (d&&d.tecnica)||"";
              if(d){
                return(
                  <div key={zona.id} title={lbl} style={{
                    position:"absolute",
                    left:zona.x, top:zona.y, width:zona.w, height:zona.h,
                    background:"var(--c-purple-bg)",
                    border:"2px solid var(--c-purple)",
                    borderRadius:"4px",
                    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                    overflow:"hidden",
                  }}>
                    {d.src ? (
                      <img src={d.src} alt="" style={{width:"75%",height:"75%",objectFit:"contain",pointerEvents:"none"}}/>
                    ) : (
                      <div style={{width:"8px",height:"8px",background:"var(--c-purple)",borderRadius:"50%"}}/>
                    )}
                    {(lbl||tec) && (
                      <div style={{fontSize:"10px",fontWeight:700,color:"#fff",background:"var(--c-purple-dk)",padding:"1px 4px",borderRadius:"2px",maxWidth:"95%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"center",lineHeight:"1.3",marginTop:"1px"}}>
                        {lbl}{lbl&&tec?" · ":""}{tec}
                      </div>
                    )}
                    {onQuitarZona && (
                      <button onClick={(e)=>{e.stopPropagation();onQuitarZona(zona.id);}} title="Quitar de esta posición"
                        style={{position:"absolute",top:"-6px",right:"-6px",width:"18px",height:"18px",borderRadius:"50%",background:"rgba(220,38,38,.9)",border:"1.5px solid white",color:"white",cursor:"pointer",fontSize:"10px",display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1}}>✕</button>
                    )}
                  </div>
                );
              }
              return(
                <div key={zona.id} title={onZonaClick?`Clic para asignar arte en: ${zona.label}`:zona.label}
                  onClick={onZonaClick?()=>onZonaClick(zona):undefined}
                  style={{
                    position:"absolute",
                    left:zona.x, top:zona.y, width:zona.w, height:zona.h,
                    background:onZonaClick?"var(--c-purple-bg)":"transparent",
                    border:"1.5px dashed var(--c-purple-bd)",
                    borderRadius:"4px",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    cursor:onZonaClick?"pointer":"default",
                    overflow:"hidden",
                  }}>
                  {onZonaClick && (
                    <span style={{fontSize:"9px",fontWeight:700,color:"var(--c-purple)",textAlign:"center",padding:"2px",lineHeight:1.2,opacity:.7,maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{zona.label}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Posiciones asignadas sin coords en ZONAS_MAP: mostrar como chips debajo del mapa */}
        {vistaDesigns.filter(d=>!zonas.find(z=>z.id===d.zonaId)).length>0 && (
          <div style={{display:"flex",flexDirection:"column",gap:"3px",width:"150px",marginTop:"4px"}}>
            {vistaDesigns.filter(d=>!zonas.find(z=>z.id===d.zonaId)).map((d,i)=>{
              const lbl = d.zonaLabel||d.zonaId||"Posición";
              const tec = d.tecnica||"";
              return(
                <div key={i} style={{
                  display:"flex",alignItems:"center",gap:"5px",
                  background:"var(--c-purple-bg)",
                  border:"1.5px solid var(--c-purple)",
                  borderRadius:"6px",padding:"4px 6px",
                }}>
                  {d.src ? (
                    <img src={d.src} alt="" style={{width:"26px",height:"26px",objectFit:"contain",borderRadius:"3px",flexShrink:0}}/>
                  ) : (
                    <div style={{width:"14px",height:"14px",background:"var(--c-purple)",borderRadius:"50%",flexShrink:0}}/>
                  )}
                  <div style={{flex:1,overflow:"hidden"}}>
                    <div style={{fontSize:"11px",fontWeight:700,color:"var(--c-purple)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{lbl}</div>
                    {tec && <div style={{fontSize:"11px",color:"var(--c-purple)",fontWeight:600}}>{tec}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return(
    <div style={{display:"flex",gap:"12px",flexWrap:"wrap",marginTop:"12px"}}>
      {renderVista(frontales, zonasFrontalUsar, "Frontal", svgFrontal)}
      {renderVista(traseras,  zonasTraseraUsar, "Trasera", svgTrasera)}
      {interactivo && (
        <div style={{fontSize:"11px",color:"var(--c-text3)",fontStyle:"italic",width:"100%"}}>
          💡 Clic en una posición libre (línea punteada) para asignar el arte pendiente · Clic en ✕ para liberar una posición ocupada
        </div>
      )}
    </div>
  );
}

// ─── COTIZACIONES ────────────────────────────────────────────────
// Cotizaciones: localStorage aislado por tenant + Supabase como fuente de verdad
// Cotizaciones: SOLO Supabase, sin localStorage (evita contaminación multi-tenant)
const loadCots = ()=>{ return []; };
const saveCots = c => {};

// ─── ÓRDENES DE SURTIDO ──────────────────────────────────────────
const KEY_OS = "be_ordenes_surtido";
const loadOS = ()=>{ try{return JSON.parse(localStorage.getItem(KEY_OS)||"[]");}catch(e){return[];} };
const saveOS = o => localStorage.setItem(KEY_OS, JSON.stringify(o));

// ─── PEDIDOS ─────────────────────────────────────────────────────
const KEY_PED = "be_pedidos";
const loadPedidos = ()=>{ try{return JSON.parse(localStorage.getItem(KEY_PED)||"[]");}catch(e){return[];} };
const savePedidos = p => localStorage.setItem(KEY_PED, JSON.stringify(p));

// Calcula el total monetario de una cotización (suma de precios por prenda)
const calcTotal = (cot) => {
  const _pgRaw = cot?.preciosGrupo||cot?.precios_grupo;
  if(!_pgRaw) return null;
  // Normalizar claves g0_0 → g0_p0 (config envía sin _p, cot.jsx espera con _p)
  const _pg = {};
  Object.keys(_pgRaw).forEach(function(k){
    const m = k.match(/^(g\d+)_(\d+)$/);
    const m2 = k.match(/^(dis_g\d+)_(\d+)$/);
    if(m){ _pg[m[1]+'_p'+m[2]] = _pgRaw[k]; }
    else if(m2){ _pg[m2[1]+'_p'+m2[2]] = _pgRaw[k]; }
    else { _pg[k] = _pgRaw[k]; }
  });
  let sub = 0;
  (cot.grupos||[]).forEach((g,gi)=>{
    const zonasArte = (g.designs||[]).filter(function(d){return d.zonaId;});
    (g.prendas||[]).forEach((p,pi)=>{
      const pk=`g${gi}_p${pi}`;
      const dk=`dis_g${gi}_p${pi}`;
      const pu = parseFloat(_pg[pk]||0)||0;
      const sumaZonas = zonasArte.length>0
        ? zonasArte.reduce(function(a,_,zi){return a+(parseFloat(_pg[dk+'_z'+zi]||0)||0);},0)
        : 0;
      const du = sumaZonas>0 ? sumaZonas : (parseFloat(_pg[dk]||0)||0);
      sub += (pu+du)*(parseInt(p.cantidad)||0);
    });
  });
  if(!sub) return null;
  const base = sub+(parseFloat(cot.precioEnvio)||0)-(parseFloat(cot.descuento?.monto||cot.descuento)||0);
  return Math.max(0, cot.conIVA ? base*1.16 : base);
};
const fmtMXN = n => n!=null ? `$${Number(n).toLocaleString("es-MX",{minimumFractionDigits:2})}` : "";

// Estima el precio de decorado por zona según técnica + medidas — misma fórmula que configurador.html
const estimarPrecioZona = (tecnica, medidas) => {
  const tl = (tecnica||"").toLowerCase();
  const ms = (medidas||"8x8").split(/[x×]/i);
  const mc = (parseFloat(ms[0])||8) * (parseFloat(ms[1])||parseFloat(ms[0])||8);
  const cmLado = Math.sqrt(mc);
  if(tl.indexOf("bordado")>=0)   return Math.round(Math.max(40,Math.min(150,35+cmLado*5)));
  if(tl.indexOf("dtf")>=0)       return Math.round(Math.max(25,Math.min(120,20+cmLado*4)));
  if(tl.indexOf("serigraf")>=0)  return Math.round(Math.max(20,Math.min(80,15+cmLado*3)));
  if(tl.indexOf("vinil")>=0)     return Math.round(Math.max(15,Math.min(60,12+cmLado*2.5)));
  return 50;
};

// Encuentra el producto del catálogo para una prenda de la cotización.
// Prioriza el id (p.prodId, estable) sobre el nombre (p.modelo) — el
// nombre puede no coincidir exactamente (mayúsculas, espacios, o el
// producto fue renombrado después de que se generó la cotización), lo
// que dejaba el precio en $0 aunque el id sí fuera correcto.
const findProdParaPrenda = (p, prods) => {
  if(!prods || !prods.length || !p) return null;
  if(p.prodId){
    const byId = prods.find(function(x){ return String(x.id)===String(p.prodId); });
    if(byId) return byId;
  }
  return prods.find(function(x){ return x.name===p.modelo; }) || null;
};

// Traduce una clave de preciosGrupo (ej. "g0_p1", "dis_g0_p0_z1") a un
// nombre legible, para avisarle al cliente EXACTAMENTE qué precio cambió
// y no solo el total.
const labelParaClavePrecio = (key, grupos) => {
  var m = key.match(/^g(\d+)_p(\d+)$/);
  if(m){
    var g1 = (grupos||[])[+m[1]];
    var p = g1 && (g1.prendas||[])[+m[2]];
    if(p) return p.modelo+(p.color?" "+p.color:"")+(p.size?" T."+p.size:"");
    return "Prenda "+(+m[2]+1);
  }
  m = key.match(/^dis_g(\d+)_p\d+_z(\d+)$/);
  if(m){
    var g2 = (grupos||[])[+m[1]];
    var designs = ((g2&&g2.designs)||[]).filter(function(d){ return d.zonaId||d.zonaLabel; });
    var d = designs[+m[2]];
    return "Arte"+(d&&d.zonaLabel?" — "+d.zonaLabel:"");
  }
  m = key.match(/^dis_g(\d+)_p(\d+)$/);
  if(m) return "Arte del diseño";
  return "Precio";
};

const ESTADOS = [
  {id:"nueva",       label:"Nueva"},
  {id:"en_proceso",  label:"En proceso"},
  {id:"cotizada",    label:"Cotizada"},
  {id:"ganada",      label:"Ganada"},
  {id:"perdida",     label:"Perdida"},
];

function fmtFecha(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString()===now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate()-1);
  const isYest = d.toDateString()===yest.toDateString();
  const hh = d.getHours().toString().padStart(2,"0");
  const mm = d.getMinutes().toString().padStart(2,"0");
  if(sameDay) return `Hoy ${hh}:${mm}`;
  if(isYest)  return `Ayer ${hh}:${mm}`;
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear().toString().slice(-2)} ${hh}:${mm}`;
}

// Construye y guarda una Orden de Trabajo a partir de una cotización ya
// confirmada. Compartida por el botón manual (ModalCotizacion) y por el
// disparo automático cuando se confirma un pago con tarjeta (Cotizaciones →
// listener de Realtime) — así la lógica de precios/armado de la OT vive en
// un solo lugar sin importar quién la dispare.
async function crearOTDesdeCotizacion(cot, prods, brands, opts){
  opts = opts||{};
  if(!sb || !MY_TENANT_ID) return null;
  // Evitar duplicados: solo puede existir una OT por cotización. La fuente
  // de verdad es la tabla ordenes_trabajo (folio_cot), no un campo en la
  // cotización — así funciona sin importar quién la creó ni si se recargó
  // la página entre medio.
  try{
    const {data:existente} = await sb.from("ordenes_trabajo")
      .select("id,estado,token").eq("folio_cot",cot.folio).eq("tenant_id",MY_TENANT_ID).single();
    if(existente) return {id:existente.id, token:existente.token||"", estado:existente.estado, yaExistia:true};
  }catch(e){}

  const preciosGrupo = cot.preciosGrupo||cot.precios_grupo||{};
  const precioEnvio  = cot.precioEnvio||cot.precio_envio||"";
  const descuento    = cot.descuento;
  const notasAdmin   = cot.notasAdmin||cot.notas_admin||"";
  const referencia   = cot.referencia||"";

  const otId = "OT-" + Date.now().toString(36).toUpperCase().slice(-6);
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  let sub=0;
  (cot.grupos||[]).forEach((g,gi)=>{ (g.prendas||[]).forEach((_,pi)=>{ const pk=`g${gi}_p${pi}`; sub+=(parseFloat(preciosGrupo[pk]||0)||0)*(parseInt((cot.grupos[gi].prendas[pi].cantidad))||0); }); });
  const total = sub+(parseFloat(precioEnvio)||0)-(parseFloat((descuento&&descuento.monto)||descuento)||0);
  // Enriquecer prendas con marca correcta (ID + nombre)
  const gruposEnriquecidos = (cot.grupos||[]).map(g=>({
    ...g,
    prendas:(g.prendas||[]).map(p=>{
      const prod = findProdParaPrenda(p, prods);
      const mId = p.marca||(prod&&prod.brand)||"";
      const brand = (brands||[]).find(b=>b.id===mId);
      return {...p, marca:mId, marca_nombre:brand?.name||mId||"Sin marca"};
    })
  }));
  // Para cuando se llega aquí (ver arriba), la cotización YA está pagada
  // (pasarela o confirmación manual) o el admin ya aprobó la excepción sin
  // anticipo — en los 4 orígenes posibles no queda ningún paso pendiente de
  // aprobación, así que la OT nace directamente aceptada. Antes nacía
  // "pendiente" y le pedía al cliente firmar/aceptar el documento de nuevo
  // en aceptar.html, un paso redundante ya que pagar (o la excepción del
  // admin) YA es la aceptación.
  const ot = {
    id:otId, folio_cot:cot.folio, token,
    referencia: referencia||null,
    estado:"aceptada",
    firma_nombre: (cot.cliente&&cot.cliente.nombre)||null,
    fecha_aceptacion: new Date().toISOString(),
    aceptado_por_tipo: opts.origen==="excepcion_manual" ? "admin" : "cliente",
    cliente:cot.cliente||{},
    grupos:gruposEnriquecidos,
    precios_grupo:preciosGrupo,
    precio_envio:precioEnvio||null,
    descuento:descuento||null,
    con_iva:(cot.conIVA===true||cot.con_iva===true),
    total:total||null,
    notas_admin:notasAdmin||null,
    fecha_emision:new Date().toISOString(),
    creada_por: opts.origen||"manual",
    motivo_excepcion: opts.motivo||null,
  };
  const saved = await sbSaveOT(ot);
  if(!saved) return null;

  // Marcar la cotización como "OT generada" — antes esto nunca se escribía,
  // así que el badge y el stepper del cliente se quedaban pegados en
  // "Pagada" para siempre aunque ya hubiera una OT.
  try{
    await sb.from("cotizaciones").update({estado_cot:"ot_generada"}).eq("folio",cot.folio).eq("tenant_id",MY_TENANT_ID);
  }catch(e){}
  // Auto-promover a cliente al generar OT
  await sbUpsertContacto(cot.cliente, "cliente");

  // ── Push a FlowShop workflow ──
  try{
    // Detectar técnica principal de decorado
    const tecnicas=(cot.grupos||[]).flatMap(g=>(g.designs||[]).map(d=>(d.tecnica||"").toLowerCase())).filter(Boolean);
    const svc = tecnicas.includes("bordado")?"bordado":
                tecnicas.some(t=>t.includes("serigrafia")||t.includes("serigrafía"))?"serigrafia":
                tecnicas.includes("dtf")?"dtf":
                tecnicas.some(t=>t.includes("sublim"))?"sublimacion":
                tecnicas.some(t=>t.includes("vinil"))?"vinil":"bordado";
    const otPayload={
      otId, cotFolio:cot.folio,
      cliente:cot.cliente?.nombre||"Sin nombre",
      desc:`${cot.total_piezas||"?"} pzas — ${cot.folio}`,
      svc,
      piezas:cot.total_piezas||0,
      tecnicas:tecnicas.join(", ")||"",
      fechaSugerida:ot.fecha_entrega_sugerida||new Date().toISOString().split("T")[0],
      fechaEntrega:ot.fecha_entrega_sugerida||new Date().toISOString().split("T")[0],
      urgente:false,
    };
    localStorage.setItem("promodesk-ot-queue", JSON.stringify(otPayload));
    setTimeout(()=>localStorage.removeItem("promodesk-ot-queue"),500);
    // ── Auto-push a flowshop-v2 localStorage ──
    try{
      const jobId='ot-'+otId;
      const fsState=JSON.parse(localStorage.getItem('flowshop-v2')||'{}');
      const fsJobs=fsState.jobs||[];
      if(!fsJobs.find(j=>j.id===jobId)){
        const newN=(fsJobs.length?Math.max(...fsJobs.map(j=>j.n||0)):0)+1;
        fsJobs.unshift({id:jobId,n:newN,folio:otId,cliente:otPayload.cliente,svc,
          desc:otPayload.desc,status:'sin-asignar',prio:'normal',
          fechaIn:otPayload.fechaSugerida,fechaOut:otPayload.fechaEntrega,
          cap:{piezas:otPayload.piezas},notas:otPayload.tecnicas||'',
          fromOT:true,otId,cotFolio:cot.folio});
        fsState.jobs=fsJobs;
        localStorage.setItem('flowshop-v2',JSON.stringify(fsState));
      }
      // Guardar en Supabase produccion_jobs
      if(sb) sb.from('produccion_jobs').upsert({
        id:jobId,n:fsJobs[0].n,folio:otId,cliente:otPayload.cliente,svc,
        descripcion:otPayload.desc,status:'sin-asignar',prioridad:'normal',
        fecha_inicio:otPayload.fechaSugerida,fecha_entrega:otPayload.fechaEntrega,
        capacidad:{piezas:otPayload.piezas},notas:otPayload.tecnicas||'',
        from_ot:true,ot_id:otId,cot_folio:cot.folio,
        tenant_id: MY_TENANT_ID,
      });
    }catch(e2){ console.warn('auto-push flowshop',e2); }
  }catch(pushErr){ console.warn("FlowShop push failed:",pushErr); }

  return {id:otId, token, estado:"aceptada", yaExistia:false};
}

// Construye/actualiza las Órdenes de Compra (tabla ordenes_surtido — la
// sección del panel se llama "Órdenes de Compra" pero internamente son las
// mismas OS que agrupan piezas por marca/proveedor para surtir). Se llama
// justo después de crear una OT nueva, con las piezas exactas que se están
// pidiendo. Si ya existe una OS "abierta" para esa marca, se le acumulan las
// piezas en vez de crear una nueva — así un mismo proveedor concentra todo
// lo pendiente hasta que el admin la marca como "enviada".
async function crearOrdenSurtidoDesdeCotizacion(cot, prods, brands, otId){
  if(!sb || !MY_TENANT_ID) return;
  try{
    var porMarca = {};
    (cot.grupos||[]).forEach(function(g, gi){
      (g.prendas||[]).forEach(function(p){
        var prod = findProdParaPrenda(p, prods);
        var mId = p.marca||(prod&&prod.brand)||"";
        var brand = (brands||[]).find(function(b){ return b.id===mId; });
        var marcaNombre = (brand&&brand.name) || "Sin marca";
        if(!porMarca[marcaNombre]) porMarca[marcaNombre] = [];
        porMarca[marcaNombre].push({
          modelo: p.modelo||"",
          color: p.color||"",
          talla: p.size||"",
          cantidad: parseInt(p.cantidad)||0,
          grupo: "Grupo "+(gi+1),
          ot_id: otId,
          referencia: cot.referencia||"",
          cliente: (cot.cliente&&cot.cliente.nombre)||"",
          surtido_estado: "pendiente",
        });
      });
    });

    for(var marcaNombre in porMarca){
      var nuevosItems = porMarca[marcaNombre];
      if(!nuevosItems.length) continue;
      var existente = null;
      try{
        var {data:ex} = await sb.from("ordenes_surtido")
          .select("id,items").eq("tenant_id",MY_TENANT_ID).eq("marca_nombre",marcaNombre).eq("estado","abierta")
          .order("fecha_creacion",{ascending:false}).limit(1).maybeSingle();
        existente = ex;
      }catch(e){}
      if(existente){
        var itemsCombinados = (existente.items||[]).concat(nuevosItems);
        await sb.from("ordenes_surtido").update({items:itemsCombinados}).eq("id",existente.id);
      } else {
        var osId = "OS-"+Date.now().toString(36).toUpperCase().slice(-6)+Math.random().toString(36).slice(2,4).toUpperCase();
        await sb.from("ordenes_surtido").insert({
          id:osId, tenant_id:MY_TENANT_ID, marca_nombre:marcaNombre,
          estado:"abierta", items:nuevosItems, fecha_creacion:new Date().toISOString(),
        });
      }
    }
  }catch(e){ console.error("crearOrdenSurtidoDesdeCotizacion:", e); }
}

function ModalCotizacion({cot, onClose, onUpdate, onDelete, prods, brands, imgs={}, initialTab=null}){
  const [cotTab,setCotTab] = useState(initialTab||"resumen");
  const [estado,setEstado] = useState(cot.estado||"nueva");
  const [notasAdmin,setNotasAdmin] = useState(cot.notasAdmin||"");
  const [referencia, setReferencia] = useState(cot.referencia||"");
  // Precios por prenda — claves: g${gi}_p${pi}
  const [preciosGrupo, setPreciosGrupo] = useState(()=>{
    // Inicializar con precios_grupo de Supabase — soporta camelCase o snake_case
    // (incluye precio prenda g0_p0 y arte dis_g0_p0)
    var pg = Object.assign({}, cot.preciosGrupo||cot.precios_grupo||{});
    // El configurador guarda g${gi}_${pi} y dis_g${gi}_${pi} (SIN _p)
    // cot.jsx espera g${gi}_p${pi} y dis_g${gi}_p${pi} (CON _p) — normalizar ambos
    Object.keys(pg).forEach(function(k){
      // convertir g0_0 → g0_p0
      var m = k.match(/^(g\d+)_(\d+)$/);
      if(m){ pg[m[1]+'_p'+m[2]] = pg[k]; delete pg[k]; return; }
      // convertir dis_g0_0 → dis_g0_p0
      var m2 = k.match(/^(dis_g\d+)_(\d+)$/);
      if(m2){ pg[m2[1]+'_p'+m2[2]] = pg[k]; delete pg[k]; }
    });
    return pg;
  });
  // Helper: obtener precio de arte (du) de un grupo/prenda, sumando zonas múltiples si aplica
  const getDu = function(g, gi, pi, pg){
    pg = pg || preciosGrupo;
    const dk = "dis_g"+gi+"_p"+pi;
    const zonasArte = (g.designs||[]).filter(function(d){return d.zonaId;});
    if(zonasArte.length>0){
      // El precio por zona se guarda como dis_gX_p0_zN. Si no hay nada ahí
      // (cotizaciones viejas que solo guardaban un total agregado en la
      // clave plana dis_gX_pY), usa ese valor como respaldo.
      var sumaZonas = zonasArte.reduce(function(a,_,zi){return a+(parseFloat(pg["dis_g"+gi+"_p0_z"+zi]||0)||0);},0);
      if(sumaZonas>0) return sumaZonas;
      return parseFloat(pg[dk]||0)||0;
    }
    return parseFloat(pg[dk]||0)||0;
  };
  const [precioEnvio, setPrecioEnvio] = useState(cot.precioEnvio||"");

  // ── Auto-llenar precios al abrir si están vacíos ──
  // Bug: dependía solo de [cot.id], así que si "prods" (catálogo) todavía no
  // había cargado cuando el modal abrió, este efecto corría una vez, veía
  // prods vacío, y nunca se volvía a ejecutar — el precio de prenda se
  // quedaba en $0 hasta que el admin le daba clic al campo (dispara
  // autoFillPrenda por separado). Ahora también reacciona cuando prods
  // termina de cargar.
  React.useEffect(function(){
    if(!prods || !prods.length) return;
    var nuevos = {};
    (cot.grupos||[]).forEach(function(g,gi){
      var totalGrupo = (g.prendas||[]).reduce(function(a,p){ return a+(parseInt(p.cantidad)||0); },0);
      (g.prendas||[]).forEach(function(p,pi){
        var pk = "g"+gi+"_p"+pi;
        var _cotPg = cot.preciosGrupo||cot.precios_grupo||{};
        var _altKey = "g"+gi+"_"+pi; // formato que envía el configurador (sin _p)
        if((_cotPg[pk]&&parseFloat(_cotPg[pk])>0)||(_cotPg[_altKey]&&parseFloat(_cotPg[_altKey])>0)) return; // ya tiene precio
        var prod2 = findProdParaPrenda(p, prods);
        if(!prod2) return;
        var escalas = [];
        if(Array.isArray(prod2.escalas)) escalas = prod2.escalas;
        else if(prod2.escalas&&typeof prod2.escalas==="object"){
          [["p1_5",1,5],["p6_20",6,20],["p21_50",21,50],["p51_100",51,100],["p101",101,null]].forEach(function(m){
            if(prod2.escalas[m[0]]) escalas.push({min:m[1],max:m[2],precio:prod2.escalas[m[0]]});
          });
        }
        var qtyEste = parseInt(p.cantidad)||1;
        var precio = 0;
        if(escalas.length){
          var sorted = escalas.slice().sort(function(a,b){ return (parseInt(a.min)||1)-(parseInt(b.min)||1); });
          var idx = sorted.findIndex(function(e){
            var mn=parseInt(e.min)||1, mx=e.max===null||e.max===undefined?Infinity:parseInt(e.max);
            return qtyEste>=mn&&qtyEste<=mx;
          });
          if(idx===-1) idx=sorted.length-1;
          // Prioridad 1: varPrices del modelo
          if(p.variant&&prod2.varPrices){
            var vpKey2 = prod2.varPrices[p.variant]
              ? p.variant
              : Object.keys(prod2.varPrices).find(function(k){ return k.toLowerCase()===(p.variant||"").toLowerCase(); });
            if(vpKey2){ var vp=prod2.varPrices[vpKey2]; if(Array.isArray(vp)&&vp[idx]) precio=parseFloat(vp[idx].precio)||0; }
          }
          // Prioridad 2: escala base
          if(!precio) precio = parseFloat(sorted[idx]&&sorted[idx].precio)||0;
          // Recargo talla
          if(precio&&prod2.sizeRecargos&&p.size) precio += parseFloat(prod2.sizeRecargos[p.size])||0;
        }
        // Prioridad 3: el producto no tiene escalas de volumen configuradas
        // en absoluto — usar su precio base "desde $X" en vez de $0 silencioso.
        if(!precio && prod2.desde) precio = parseFloat(prod2.desde)||0;
        if(precio>0) nuevos[pk] = String(precio);
      });
    });
    if(Object.keys(nuevos).length>0){
      setPreciosGrupo(function(prev){
        var merged = Object.assign({},nuevos,prev);
        // Persistir en segundo plano — si solo se actualiza el estado local, el
        // precio se ve en este modal pero la BD (y por tanto aceptar.html, que
        // el cliente ve) se queda con el $0 viejo hasta que alguien le dé clic
        // a Guardar/Confirmar. El objetivo es que el precio ya esté puesto sin
        // que el admin tenga que hacer nada.
        if(typeof sbSaveCotCompleta==="function"){
          sbSaveCotCompleta(Object.assign({},cot,{preciosGrupo:merged}));
        }
        return merged;
      });
    }
  }, [cot.id, prods && prods.length]);

  // ── Auto-llenar precio de arte por zona al abrir, si está vacío ──
  // Mismo problema que el efecto de arriba: antes solo se rellenaba cuando
  // el admin le daba clic al campo de "Precio por zona" (autoFillZonaPrecio,
  // disparado por onFocus). Casi nunca debería hacer falta ya que el
  // configurador manda el precio de arte calculado desde el envío, pero
  // sirve de respaldo para cotizaciones viejas o incompletas.
  React.useEffect(function(){
    var nuevosZona = {};
    var _cotPg = cot.preciosGrupo||cot.precios_grupo||{};
    (cot.grupos||[]).forEach(function(g,gi){
      var designs = (g.designs||[]).filter(function(d){ return d.zonaId||d.zonaLabel; });
      var multiZona = designs.length>1;
      designs.forEach(function(d,di){
        var zk = "dis_g"+gi+"_p0_z"+di;
        var yaTiene = (_cotPg[zk]&&parseFloat(_cotPg[zk])>0) || (!multiZona && _cotPg["dis_g"+gi+"_p0"]&&parseFloat(_cotPg["dis_g"+gi+"_p0"])>0);
        if(yaTiene) return;
        var est = estimarPrecioZona(d.tecnica, d.medidas);
        if(est>0) nuevosZona[zk] = String(est);
      });
    });
    if(Object.keys(nuevosZona).length>0){
      setPreciosGrupo(function(prev){
        var merged = Object.assign({},nuevosZona,prev);
        if(typeof sbSaveCotCompleta==="function"){
          sbSaveCotCompleta(Object.assign({},cot,{preciosGrupo:merged}));
        }
        return merged;
      });
    }
  }, [cot.id]);
  const [descuento, setDescuento] = useState(cot.descuento||"");
  const [precioDecorCopy, setPrecioDecorCopy] = useState("");
  const [conIVA, setConIVA] = useState(()=>cot.conIVA===true);
  // ── Servicios de Arte / Maquila ─────────────────────────────────
  const [serviciosArte, setServiciosArte] = useState(()=>cot.serviciosArte||cot.servicios_arte||[]);

  // ── EDICIÓN COMPLETA DE COTIZACIÓN ──────────────────────────────
  const [editandoPrendas, setEditandoPrendas] = useState(false);
  const [modalNuevoGrupo, setModalNuevoGrupo] = useState(false);
  const [nombreNuevoGrupo, setNombreNuevoGrupo] = useState("");

  const [localGrupos, setLocalGrupos] = useState(()=>
    (cot.grupos||[]).map(g=>({...g, prendas:[...(g.prendas||[]).map(p=>({...p}))]}))
  );
  const [nuevaPrend, setNuevaPrend] = useState({gi:0, modelo:"", color:"", size:"", variant:"", cantidad:1});
  // ── Modal visual catálogo para agregar prendas ──
  const [modalCatOpen, setModalCatOpen] = useState(false);
  const [modalCatGi, setModalCatGi] = useState(0);
  const [catSearch, setCatSearch] = useState("");
  const [catBrand, setCatBrand] = useState("");
  const [catProdSel, setCatProdSel] = useState(null); // producto seleccionado
  const [catColor, setCatColor] = useState("");
  const [catVariant, setCatVariant] = useState("");
  const [catSizeQtys, setCatSizeQtys] = useState({}); // {talla: qty}
  // Edición de datos del cliente
  const [editCliente, setEditCliente] = useState(false);
  const [localCliente, setLocalCliente] = useState({...cot.cliente});
  const [localNotas, setLocalNotas] = useState(cot.notas||"");
  const [comentarios, setComentarios] = useState(cot.comentarios||[]);
  const [replyTexto, setReplyTexto] = useState("");
  const [enviandoReply, setEnviandoReply] = useState(false);

  // Mantener sincronizados los mensajes con lo que llega por Realtime — sin
  // esto, un comentario nuevo del cliente solo se veía si cerrabas y volvías
  // a abrir el modal.
  useEffect(() => {
    setComentarios(cot.comentarios||[]);
  }, [cot.comentarios]);

  const guardarCliente = () => {
    onUpdate({...cot, cliente:localCliente, notas:localNotas, leida:true});
    setEditCliente(false);
  };

  // ── Agregar nuevo grupo ──
  // Abrir modal visual
  const abrirModalCat = function(gi){
    setModalCatGi(gi);
    setCatSearch("");
    setCatBrand("");
    setCatProdSel(null);
    setCatColor("");
    setCatVariant("");
    setCatSizeQtys({});
    setModalCatOpen(true);
  };
  // Confirmar selección del modal
  const confirmarModalCat = function(){
    if(!catProdSel) return;
    var agregados = 0;
    Object.entries(catSizeQtys).forEach(function(entry){
      var sz=entry[0]; var q=parseInt(entry[1])||0;
      if(q<=0) return;
      var p = {
        modelo: catProdSel.name,
        marca: catProdSel.brand||"",
        color: catColor,
        size: sz,
        variant: catVariant||"",
        cantidad: q,
        imgUrl: catProdSel.main_img||null,
        prodId: String(catProdSel.id)
      };
      var sc = autoShapeCat(catProdSel.name);
      setLocalGrupos(function(prev){
        return prev.map(function(g,i){
          if(i!==modalCatGi) return g;
          return {...g, prendas:[...g.prendas,p], ...(sc?{shapeCat:sc}:{})};
        });
      });
      agregados++;
    });
    if(agregados===0){ alert("Agrega cantidad en al menos una talla"); return; }
    setCatProdSel(null); setCatColor(""); setCatVariant(""); setCatSizeQtys({});
    setModalCatOpen(false);
  };

  const addGrupo = ()=>{
    const letra = String.fromCharCode(65 + localGrupos.length); // A, B, C...
    const nuevo = {
      nombre: `Diseño ${letra}`,
      modo: "mockup",
      shapeCat: "camisa",
      prendas: [],
      designs: [],
    };
    setLocalGrupos(prev=>{ const n=[...prev,nuevo]; setOpenGrupos(p=>({...p,[n.length-1]:true})); return n; });
  };

  const removeGrupo = (gi)=>{
    if(!confirm(`¿Eliminar el grupo "${localGrupos[gi]?.nombre}"?`)) return;
    setLocalGrupos(prev=>prev.filter((_,i)=>i!==gi));
    setOpenGrupos(prev=>{ const n={}; Object.entries(prev).forEach(([k,v])=>{ const ki=parseInt(k); if(ki<gi){n[ki]=v;}else if(ki>gi){n[ki-1]=v;} }); return n; });
  };

  const renameGrupo = (gi, nombre)=>{
    setLocalGrupos(prev=>prev.map((g,i)=>i!==gi?g:{...g,nombre}));
  };

  // ── Subir imagen de diseño ──
  const uploadImagenDiseño = (gi, di, file)=>{
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (e)=>{
      setLocalGrupos(prev=>prev.map((g,i)=>i!==gi?g:{
        ...g, designs:g.designs.map((d,j)=>j!==di?d:{...d, src:e.target.result, fileName:file.name})
      }));
    };
    reader.readAsDataURL(file);
  };

  // ── Agregar diseño a grupo ──
  const addDiseno = (gi)=>{
    setLocalGrupos(prev=>prev.map((g,i)=>i!==gi?g:{
      ...g, designs:[...g.designs, {zonaId:"",zonaLabel:"",tecnica:"",medidas:"",src:null,fileName:""}]
    }));
  };

  const [openGrupos, setOpenGrupos] = useState(()=>{
    const obj={};
    (cot.grupos||[]).forEach((_,i)=>{ obj[i]=true; });
    return obj;
  });
  const [editandoDisenos, setEditandoDisenos] = useState(false);

  // Obtener zonas disponibles para un shapeCat
  const zonasDeGrupo = (g) => {
    const t = g.shapeCat||"camisa";
    const cfg = ZONAS_MAP[t]||ZONAS_MAP.camisa;
    return [...(cfg.frontal||[]),...(cfg.trasera||[])];
  };

  const updDiseno=(gi,di,field,val)=>{
    setLocalGrupos(prev=>prev.map((g,i)=>i!==gi?g:{
      ...g, designs:g.designs.map((d,j)=>j!==di?d:
        field==="zona"
          ? {...d, zonaId:val.id, zonaLabel:val.label}
          : {...d, [field]:val}
      )
    }));
  };
  const removeDiseno=(gi,di)=>{
    if(!confirm("¿Quitar este diseño?")) return;
    setLocalGrupos(prev=>prev.map((g,i)=>i!==gi?g:{...g,designs:g.designs.filter((_,j)=>j!==di)}));
  };
  const guardarDisenos=()=>{
    const updated={...cot, grupos:localGrupos, leida:true};
    onUpdate(updated);
    sbSaveCotCompleta(updated);
    setEditandoDisenos(false);
  };

  const updPrenda = (gi, pi, key, val) => {
    setLocalGrupos(prev=>prev.map((g,i)=>i!==gi?g:{...g,prendas:g.prendas.map((p,j)=>j!==pi?p:{...p,[key]:val})}));
  };
  // Auto-detecta shapeCat a partir del producto o del nombre del modelo
  const autoShapeCat = (modeloNombre) => {
    const prod = prods.find(x=>x.name===modeloNombre);
    if(prod && prod.shapeCat) return prod.shapeCat;
    const nm = (modeloNombre||"").toLowerCase();
    if(nm.includes("gorra")||nm.includes("cap")||nm.includes("cachucha")||nm.includes("beanie")||nm.includes("sombrero")) return "gorra";
    if(nm.includes("pantalon")||nm.includes("bermuda")||nm.includes("falda")) return "pantalon";
    if(nm.includes("playera")||nm.includes("polo")||nm.includes("camiseta")) return "playera";
    if(nm.includes("chamarra")||nm.includes("chaleco")||nm.includes("fleece")) return "chamarra";
    if(nm.includes("sudadera")||nm.includes("hoodie")||nm.includes("sweat")) return "sudadera";
    if(nm.includes("bata")||nm.includes("mandil")||nm.includes("filipina")||nm.includes("delantal")) return "delantal";
    return null;
  };

  const updPrendaMulti = (gi, pi, updates) => {
    setLocalGrupos(prev=>prev.map((g,i)=>{
      if(i!==gi) return g;
      const newPrendas = g.prendas.map((p,j)=>j!==pi?p:{...p,...updates});
      if(updates.modelo !== undefined){
        const sc = autoShapeCat(updates.modelo);
        return {...g, prendas:newPrendas, ...(sc?{shapeCat:sc}:{})};
      }
      return {...g, prendas:newPrendas};
    }));
  };
  const removePrenda = (gi, pi) => {
    if(!confirm("¿Quitar este producto del grupo?")) return;
    setLocalGrupos(prev=>prev.map((g,i)=>i!==gi?g:{...g,prendas:g.prendas.filter((_,j)=>j!==pi)}));
  };
  const addPrenda = () => {
    if(!nuevaPrend.modelo.trim()){ alert("Selecciona un modelo"); return; }
    const cant = parseInt(nuevaPrend.cantidad)||1;
    const p = {modelo:nuevaPrend.modelo.trim(), marca:nuevaPrend.marca||"", color:nuevaPrend.color.trim(), size:nuevaPrend.size.trim(), variant:nuevaPrend.variant.trim(), cantidad:cant};
    const sc = autoShapeCat(nuevaPrend.modelo.trim());
    setLocalGrupos(prev=>prev.map((g,i)=>i!==nuevaPrend.gi?g:{...g, prendas:[...g.prendas,p], ...(sc?{shapeCat:sc}:{})}));
    setNuevaPrend(s=>({...s, modelo:"", marca:"", color:"", size:"", variant:"", cantidad:1}));
  };
  const duplicatePrendaExistente = (gi, pi) => {
    const prenda = localGrupos[gi]?.prendas?.[pi];
    if(!prenda) return;
    const nuevaPrenda = {...prenda, cantidad: parseInt(prenda.cantidad)||1};
    setLocalGrupos(prev=>prev.map((g,i)=>i!==gi?g:{...g, prendas:[...g.prendas, nuevaPrenda]}));
  };
  const guardarPrendas = () => {
    const totalPiezas = localGrupos.reduce((a,g)=>a+g.prendas.reduce((b,p)=>b+(parseInt(p.cantidad)||0),0),0);
    const updated = {...cot, grupos:localGrupos, total_piezas:totalPiezas, leida:true};
    onUpdate(updated);
    setEditandoPrendas(false);
    sbSaveCotCompleta(updated); // sync to Supabase
  };

  const guardarPrecios = () => {
    const updated = {...cot, preciosGrupo, precioEnvio, descuento, notasAdmin, leida:true};
    onUpdate(updated);
    sbSaveCotCompleta(updated); // sync to Supabase
  };

  // Guarda todo (precios, grupos, notas...) Y confirma en un solo paso —
  // esto es lo que quita el letrero de "pendiente" en aceptar.html y deja
  // que el cliente acepte y pague.
  const confirmarCotizacion = async () => {
    if(!window.confirm("¿Confirmar precios y habilitar pago al cliente? El cliente podrá aceptar y pagar en cuanto confirmes.")) return;
    // Aviso automático en la conversación — para que el cliente vea en el
    // mismo hilo que ya se confirmaron los precios, sin tener que ir a
    // buscarlo en otro lado.
    const totalFinal = calcTotal({...cot, preciosGrupo, precioEnvio, descuento, conIVA, grupos:localGrupos});
    const pgAntesConf = cot.preciosGrupo||cot.precios_grupo||{};
    const cambiosPrecioConf = Object.keys(preciosGrupo).filter(function(k){
      return String(preciosGrupo[k]||"") !== String(pgAntesConf[k]||"");
    }).map(function(k){
      return {label:labelParaClavePrecio(k, localGrupos), antes:parseFloat(pgAntesConf[k])||0, ahora:parseFloat(preciosGrupo[k])||0};
    });
    let textoConfirmacion = "✅ Confirmamos los precios y detalles finales de tu pedido.";
    if(cambiosPrecioConf.length){
      textoConfirmacion += "\n"+cambiosPrecioConf.map(function(c){ return "• "+c.label+": "+fmtMXN(c.antes)+" → "+fmtMXN(c.ahora); }).join("\n");
    }
    if(totalFinal!=null) textoConfirmacion += "\nTotal: "+fmtMXN(totalFinal);
    textoConfirmacion += "\nYa puedes aceptar y pagar cuando gustes.";
    const avisoConfirmacion = {
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      texto: textoConfirmacion,
      nombre: "Asesor", autor: "admin", fecha: new Date().toISOString(), historial: [],
    };
    const comentariosConAviso = [...comentarios, avisoConfirmacion];
    setComentarios(comentariosConAviso);
    const updated = {
      ...cot,
      preciosGrupo, precioEnvio, descuento, notasAdmin, estado, referencia, conIVA,
      grupos: localGrupos, cliente: localCliente, notas: localNotas, serviciosArte, leida: true,
      estado_cot: "confirmada",
      precios_confirmados: true,
      comentarios: comentariosConAviso,
    };
    onUpdate(updated);
    try{
      if(sb){
        await sb.functions.invoke("notify-respuesta-ts", {
          body:{
            tenant_id: MY_TENANT_ID, folio: cot.folio, mensaje: avisoConfirmacion.texto,
            cliente_email: localCliente?.email, cliente_nombre: localCliente?.nombre,
            tenant_nombre: MY_TENANT_NOMBRE||"LANA"
          }
        });
      }
    }catch(e){ console.error("notify-respuesta (confirmación):",e); }
    // Esperar a que se guarde TODO primero (precios, grupos, etc.) — antes
    // este guardado y el de abajo (estado_cot) salían en paralelo sin
    // esperarse uno a otro, y si el de estado_cot fallaba, no había ningún
    // aviso: el botón igual decía "✓ Confirmado" aunque el cliente nunca
    // viera el cambio en aceptar.html.
    await sbSaveCotCompleta(updated);
    const btn = document.getElementById("btn-confirmar-cot");
    if(sb && cot.folio){
      const {data:filasAfectadas, error} = await sb.from("cotizaciones")
        .update({
          servicios_arte: serviciosArte,
          estado_cot: "confirmada",
          precios_confirmados: true,
        })
        .eq("folio", cot.folio)
        .eq("tenant_id", MY_TENANT_ID)
        .select("folio");
      if(error){
        alert("❌ No se pudo confirmar: "+error.message+"\n\nEl cliente NO verá esta cotización como confirmada todavía. Intenta de nuevo.");
        return;
      }
      // Supabase puede responder "sin error" aunque no haya tocado ninguna
      // fila (ej. una política de permisos que filtra en silencio) — sin
      // .select() para verificar, eso se veía igual que un éxito real.
      if(!filasAfectadas || !filasAfectadas.length){
        alert("⚠️ No se encontró la cotización para confirmar (folio "+cot.folio+"). Es probable que sea un problema de permisos. Avísame para revisarlo.");
        return;
      }
    }
    // Feedback — solo se muestra si el guardado realmente funcionó
    if(btn){ btn.textContent="✓ Confirmado"; btn.style.background="var(--c-purple)"; setTimeout(()=>{ btn.textContent="✅ Confirmar precios y habilitar pago"; btn.style.background="var(--c-purple)"; },2500); }
  };

  const guardarTodo = () => {
    // Avisar al cliente en la conversación si esta guardada trae un cambio
    // de precio o un diseño nuevo — no en cada guardado (ej. solo cambiar
    // una nota), solo cuando de verdad hay algo que le interese ver.
    const pgAntes = cot.preciosGrupo||cot.precios_grupo||{};
    const cambiosPrecio = Object.keys(preciosGrupo).filter(function(k){
      return String(preciosGrupo[k]||"") !== String(pgAntes[k]||"");
    }).map(function(k){
      return {label:labelParaClavePrecio(k, localGrupos), antes:parseFloat(pgAntes[k])||0, ahora:parseFloat(preciosGrupo[k])||0};
    });
    const huboCambioPrecio = cambiosPrecio.length>0;
    const disenosAntes = (cot.grupos||[]).reduce(function(a,g){ return a+(g.designs||[]).length; },0);
    const disenosAhora = localGrupos.reduce(function(a,g){ return a+(g.designs||[]).length; },0);
    const disenosNuevos = disenosAhora-disenosAntes;

    let comentariosFinal = comentarios;
    if(huboCambioPrecio || disenosNuevos>0){
      const partes=[];
      if(huboCambioPrecio) partes.push("actualizamos "+(cambiosPrecio.length===1?"un precio":cambiosPrecio.length+" precios")+" de tu pedido");
      if(disenosNuevos>0) partes.push("agregamos "+disenosNuevos+" diseño"+(disenosNuevos!==1?"s":"")+" nuevo"+(disenosNuevos!==1?"s":""));
      const totalNuevo = calcTotal({...cot, preciosGrupo, precioEnvio, descuento, conIVA, grupos:localGrupos});
      let texto = "✏️ "+partes.join(" y ")+".";
      if(cambiosPrecio.length){
        texto += "\n"+cambiosPrecio.map(function(c){ return "• "+c.label+": "+fmtMXN(c.antes)+" → "+fmtMXN(c.ahora); }).join("\n");
      }
      if(totalNuevo!=null) texto += "\nTotal actualizado: "+fmtMXN(totalNuevo);
      const avisoCambio = {
        id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
        texto: texto,
        nombre:"Asesor", autor:"admin", fecha:new Date().toISOString(), historial:[],
      };
      comentariosFinal = [...comentarios, avisoCambio];
      setComentarios(comentariosFinal);
      if(sb){
        sb.functions.invoke("notify-respuesta-ts", {
          body:{
            tenant_id: MY_TENANT_ID, folio: cot.folio, mensaje: avisoCambio.texto,
            cliente_email: localCliente?.email, cliente_nombre: localCliente?.nombre,
            tenant_nombre: MY_TENANT_NOMBRE||"LANA"
          }
        }).catch(function(e){ console.error("notify-respuesta (cambio):",e); });
      }
    }
    const updated = {
      ...cot,
      preciosGrupo,
      precioEnvio,
      descuento,
      notasAdmin,
      estado,
      referencia,
      conIVA,
      grupos: localGrupos,
      cliente: localCliente,
      notas: localNotas,
      serviciosArte,
      leida: true,
      comentarios: comentariosFinal,
    };
    onUpdate(updated);
    sbSaveCotCompleta(updated);
    // Guardar servicios_arte directamente en columna snake_case
    if(sb && cot.folio){
      sb.from('cotizaciones')
        .update({ servicios_arte: serviciosArte })
        .eq('folio', cot.folio)
        .then(()=>{})
        .catch(e=>console.error('servicios_arte save:',e));
    }
    // Feedback visual
    const btn = document.getElementById('btn-guardar-todo');
    if(btn){ btn.textContent='✓ Guardado'; btn.style.background='var(--c-success)'; setTimeout(()=>{ btn.textContent='💾 Guardar todo'; btn.style.background='var(--c-purple)'; },2000); }
  };

  const celebrarGanada = () => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden;";
    document.body.appendChild(overlay);
    // Emoji grande central
    const emoji = document.createElement("div");
    emoji.textContent = "🎉";
    emoji.style.cssText = "position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);font-size:100px;animation:confettiPop 1.5s ease forwards;";
    overlay.appendChild(emoji);
    // Confetti
    const colors=["var(--c-danger)","#ffd700","var(--c-success)","#60a5fa","#f472b6","#fb923c","var(--c-purple-lt)"];
    for(let i=0;i<100;i++){
      const p=document.createElement("div");
      const c=colors[Math.floor(Math.random()*colors.length)];
      const s=5+Math.random()*10;
      p.style.cssText=`position:absolute;width:${s}px;height:${s}px;background:${c};left:${Math.random()*100}%;top:-20px;border-radius:${Math.random()>.5?"50%":"2px"};animation:confettiFall ${1.5+Math.random()*2.5}s ease-in ${Math.random()*1}s forwards;`;
      overlay.appendChild(p);
    }
    setTimeout(()=>overlay.remove(), 4500);
  };

  const autoGenerarOC = (cotizacion) => {
    const os = loadOS();
    const prendas = [];
    (cotizacion.grupos||[]).forEach(g=>{
      (g.prendas||[]).forEach(p=>{
        const prod = prods?.find(x=>String(x.id)===String(p.prodId||""));
        const brand = brands?.find(b=>b.id===prod?.brand);
        const marca = brand?.name || prod?.name?.split(" ")?.[0] || "Sin marca";
        const talla = p.size||p.variant||"Única";
        const ex = prendas.find(x=>x.marca===marca&&x.modelo===p.modelo&&x.color===p.color);
        if(ex){ ex.tallas[talla]=(ex.tallas[talla]||0)+(parseInt(p.cantidad)||0); }
        else prendas.push({marca, modelo:p.modelo, color:p.color, tallas:{[talla]:parseInt(p.cantidad)||0}});
      });
    });
    let target = os.find(o=>o.estado==="abierta");
    if(!target){
      target={id:"OS-"+Date.now().toString(36).toUpperCase().slice(-6),fecha:new Date().toISOString(),estado:"abierta",folios:[],prendas:[],notas:""};
      os.unshift(target);
    }
    if(!target.folios.includes(cotizacion.folio)){
      target.folios.push(cotizacion.folio);
      prendas.forEach(p=>{
        const ex=target.prendas.find(x=>x.marca===p.marca&&x.modelo===p.modelo&&x.color===p.color);
        if(ex){ Object.entries(p.tallas).forEach(([t,n])=>{ex.tallas[t]=(ex.tallas[t]||0)+n;}); }
        else target.prendas.push({...p});
      });
    }
    saveOS(os);
    return target.id;
  };

  const cambiarEstado = (e)=>{
    setEstado(e);
    let extra = {};
    if(e==="ganada"){
      celebrarGanada();
      if(cot.estado!=="ganada"){
        const ocId = autoGenerarOC(cot);
        // Crear pedido automático
        const peds = loadPedidos();
        if(!peds.find(p=>p.folioRef===cot.folio)){
          const ped = {
            id:"PED-"+Date.now().toString(36).toUpperCase().slice(-6),
            folioRef:cot.folio,
            fechaCreacion:new Date().toISOString(),
            fechaEntrega:cot.fechaEntrega||null,
            urgencia:cot.urgencia||null,
            cliente:{...cot.cliente},
            totalPiezas:cot.total_piezas||0,
            grupos:cot.grupos||[],
            estado:"activo",
            ordenSurtidoId:ocId,
            checks:{ponchados:false,surtido:false,produccion:false,control_calidad:false,entregado:false},
            notasInternas:"",
          };
          peds.unshift(ped);
          savePedidos(peds);
        }
        extra = {enOrden:ocId};
      }
    }
    onUpdate({...cot, estado:e, leida:true, ...extra});
  };
  const copiarLink = ()=>{
    const base = window.location.origin;
    const link = base + "/aceptar.html?folio=" + encodeURIComponent(cot.folio) + "&tenant=" + encodeURIComponent(MY_TENANT_ID||"");
    navigator.clipboard.writeText(link).then(()=>{
      alert("¡Link copiado!\n" + link);
    }).catch(()=>{
      prompt("Copia este link:", link);
    });
  };

  const guardarNotas = ()=>{
    onUpdate({...cot, notasAdmin, leida:true});
  };

  const [otInfo, setOtInfo] = useState(cot.otId ? {id:cot.otId, estado:cot.otEstado||"pendiente", token:cot.otToken||""} : null);
  const [creandoOT, setCreandoOT] = useState(false);

  const [motivoExcepcionOT, setMotivoExcepcionOT] = useState("");
  const [pidiendoMotivoOT, setPidiendoMotivoOT] = useState(false);
  const [confirmandoPago, setConfirmandoPago] = useState(false);
  const [marcandoEfectivo, setMarcandoEfectivo] = useState(false);

  const crearOrdenTrabajo = async (origen, motivo) => {
    setCreandoOT(true);
    const cotParaOT = {...cot, preciosGrupo, precioEnvio, descuento, notasAdmin, conIVA, referencia};
    const resultado = await crearOTDesdeCotizacion(cotParaOT, prods, brands, {origen, motivo});
    if(resultado){
      setOtInfo({id:resultado.id, token:resultado.token, estado:resultado.estado});
      if(resultado.yaExistia){
        onUpdate({...cot, otId:resultado.id, otEstado:resultado.estado, otToken:resultado.token, leida:true});
        alert(`⚠️ Esta cotización ya tiene una Orden de Trabajo: ${resultado.id}\n\nSolo puede haber una OT por cotización. Se cargó la existente.`);
      } else {
        onUpdate({...cot, otId:resultado.id, otEstado:resultado.estado, otToken:resultado.token, estado_cot:"ot_generada", leida:true});
        crearOrdenSurtidoDesdeCotizacion(cotParaOT, prods, brands, resultado.id);
      }
    } else {
      alert("Error al crear la Orden de Trabajo. Verifica tu conexión.");
    }
    setCreandoOT(false);
  };

  // Pago verificado por la pasarela — no necesita revisión manual
  const pagoVerificadoPasarela = ["tarjeta_mp","tarjeta_stripe"].includes(cot.metodo_pago);
  // Depósito/efectivo ya reportado por el cliente, pendiente de que el admin lo revise
  const pagoPendienteDeRevisar = ["deposito","efectivo"].includes(cot.metodo_pago) && !cot.pago_confirmado_manual;
  const pagoConfirmado = pagoVerificadoPasarela || cot.pago_confirmado_manual===true;
  // Solo puede haber OT si la cotización ya está confirmada por el negocio en adelante
  const cotConfirmadaOAdelante = ["confirmada","aceptada","pagada","ot_generada"].includes(cot.estado_cot);

  const confirmarPagoRecibido = async () => {
    setConfirmandoPago(true);
    const fecha = new Date().toISOString();
    try{
      if(sb && MY_TENANT_ID){
        await sb.from("cotizaciones").update({pago_confirmado_manual:true, fecha_confirmacion_pago:fecha}).eq("folio",cot.folio).eq("tenant_id",MY_TENANT_ID);
      }
    }catch(e){}
    onUpdate({...cot, pago_confirmado_manual:true, fecha_confirmacion_pago:fecha, leida:true});
    await crearOrdenTrabajo("confirmacion_manual");
    setConfirmandoPago(false);
  };

  // El admin marca el pago en efectivo directamente (el cliente pagó en
  // persona, sin pasar por aceptar.html) — distinto de confirmarPagoRecibido,
  // que solo revisa un pago que el CLIENTE ya reportó desde su link.
  const marcarPagoEfectivoDirecto = async () => {
    if(!window.confirm("¿Confirmas que ya recibiste el pago en efectivo de esta cotización?")) return;
    setMarcandoEfectivo(true);
    const fecha = new Date().toISOString();
    try{
      if(sb && MY_TENANT_ID){
        await sb.from("cotizaciones").update({
          metodo_pago:"efectivo", estado_cot:"pagada",
          pago_confirmado_manual:true, fecha_confirmacion_pago:fecha,
          pago_marcado_por_admin:true,
        }).eq("folio",cot.folio).eq("tenant_id",MY_TENANT_ID);
      }
    }catch(e){}
    onUpdate({...cot, metodo_pago:"efectivo", estado_cot:"pagada", pago_confirmado_manual:true, fecha_confirmacion_pago:fecha, pago_marcado_por_admin:true, leida:true});
    await crearOrdenTrabajo("confirmacion_manual");
    setMarcandoEfectivo(false);
  };

  const confirmarMotivoYCrearOT = async () => {
    if(!motivoExcepcionOT.trim()){ alert("Escribe el motivo de la excepción."); return; }
    setPidiendoMotivoOT(false);
    await crearOrdenTrabajo("excepcion_manual", motivoExcepcionOT.trim());
    setMotivoExcepcionOT("");
  };

  // aceptar.html solo reconoce ?ot=<id>&tenant=<tenantId> (ver OT_ID/MODE
  // ahí) — nunca leyó ?token=, así que ese formato dejaba al cliente varado
  // en "El enlace está incompleto." al abrir el link de WhatsApp/Email.
  const otUrl = otInfo?.id
    ? `https://app.get-lana.com/aceptar.html?ot=${otInfo.id}&tenant=${MY_TENANT_ID||""}`
    : "";

  const enviarOTWhatsApp = () => {
    const tel = (cot.cliente?.tel||"").replace(/[^0-9]/g,"");
    if(!tel){ alert("Este cliente no tiene teléfono registrado."); return; }
    const num = tel.length===10 ? "52"+tel : tel;
    const msg = `Hola ${cot.cliente?.nombre||""}! 👋\n\nTu *Orden de Trabajo #${otInfo?.id}* de LANA está lista para tu aprobación.\n\nRevisa los detalles y acéptala aquí:\n${otUrl}\n\nCualquier duda estamos aquí. 🙌`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`,"_blank");
  };

  const enviarOTEmail = () => {
    if(!cot.cliente?.email){ alert("Este cliente no tiene email registrado."); return; }
    const subject = `Orden de Trabajo #${otInfo?.id} — LANA`;
    const body = `Hola ${cot.cliente?.nombre||""},\n\nTu Orden de Trabajo está lista para revisión y aceptación.\n\nPuedes verla y aceptarla aquí:\n${otUrl}\n\nSaludos,\nLANA`;
    window.open(`mailto:${cot.cliente.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };
  const waMsg = async ()=>{
    const tel = (cot.cliente&&cot.cliente.tel||"").replace(/[^0-9]/g,"");
    if(!tel) {alert("Este cliente no dejó teléfono.");return;}
    const num = tel.length===10 ? "52"+tel : tel;
    const linkCot = "https://app.get-lana.com/aceptar.html?folio="+encodeURIComponent(cot.folio)+"&tenant="+encodeURIComponent(MY_TENANT_ID||"");
    // Obtener datos del tenant
    var tenantData = {};
    try{
      var {data:td} = await sb.from("tenants").select("nombre,msg_whatsapp,whatsapp").eq("id",MY_TENANT_ID).single();
      tenantData = td||{};
    }catch(e){}
    // Calcular total
    var totalCot = cot.total_estimado ? "$"+Number(cot.total_estimado).toLocaleString("es-MX",{minimumFractionDigits:2}) : "Ver cotización";
    // Resumen simple
    var resumenTxt = (cot.grupos||[]).map(function(g){
      var pzas = Object.values(g.assignments||{}).reduce(function(a,v){return a+(parseInt(v)||0);},0);
      return g.nombre+" ("+(g.tecnica||"decorado")+") — "+pzas+" pzas";
    }).join("\n") || cot.resumen || "";
    // Aplicar plantilla
    var plantilla = tenantData.msg_whatsapp || "Hola {nombre}, te compartimos tu cotización {folio}.\n\nTotal: {total}\n\nVer y aceptar: {link}";
    var txt = plantilla
      .replace(/{nombre}/g, cot.cliente&&cot.cliente.nombre||"")
      .replace(/{folio}/g, cot.folio||"")
      .replace(/{negocio}/g, tenantData.nombre||"LANA")
      .replace(/{total}/g, totalCot)
      .replace(/{link}/g, linkCot)
      .replace(/{resumen}/g, resumenTxt);
    // Número del negocio o del cliente
    var waNum = tenantData.whatsapp ? tenantData.whatsapp.replace(/[^0-9]/g,"") : num;
    window.open("https://wa.me/"+num+"?text="+encodeURIComponent(txt), "_blank");
    if(sb && (!cot.estado_cot || cot.estado_cot==="borrador")){
      try{ sb.from("cotizaciones").update({estado_cot:"enviada"}).eq("folio",cot.folio).then(function(){}); }catch(e){}
      onUpdate(Object.assign({},cot,{estado_cot:"enviada"}));
    }
  };

  const mailMsg = async ()=>{
    if(!cot.cliente||!cot.cliente.email){alert("Este cliente no dejó email.");return;}
    const linkCot = "https://app.get-lana.com/aceptar.html?folio="+encodeURIComponent(cot.folio)+"&tenant="+encodeURIComponent(MY_TENANT_ID||"");
    // Obtener datos del tenant
    var tenantDataM = {};
    try{
      var {data:tdm} = await sb.from("tenants").select("nombre,msg_email_asunto,msg_email_cuerpo").eq("id",MY_TENANT_ID).single();
      tenantDataM = tdm||{};
    }catch(e){}
    var totalCotM = cot.total_estimado ? "$"+Number(cot.total_estimado).toLocaleString("es-MX",{minimumFractionDigits:2}) : "Ver cotización";
    var resumenTxtM = (cot.grupos||[]).map(function(g){
      var pzas = Object.values(g.assignments||{}).reduce(function(a,v){return a+(parseInt(v)||0);},0);
      return g.nombre+" — "+pzas+" pzas";
    }).join("\n") || cot.resumen || "";
    var repl = function(t){ return (t||"")
      .replace(/{nombre}/g, cot.cliente&&cot.cliente.nombre||"")
      .replace(/{folio}/g, cot.folio||"")
      .replace(/{negocio}/g, tenantDataM.nombre||"LANA")
      .replace(/{total}/g, totalCotM)
      .replace(/{link}/g, linkCot)
      .replace(/{resumen}/g, resumenTxtM);
    };
    var subject = repl(tenantDataM.msg_email_asunto || "Cotización {folio} — {negocio}");
    var body = repl(tenantDataM.msg_email_cuerpo || "Hola {nombre},\n\nTe compartimos tu cotización {folio}.\n\nTotal: {total}\n\nVer y aceptar: {link}\n\nSaludos,\n{negocio}");
    window.open("mailto:"+cot.cliente.email+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body));
    if(sb && (!cot.estado_cot || cot.estado_cot==="borrador")){
      try{ sb.from("cotizaciones").update({estado_cot:"enviada"}).eq("folio",cot.folio).then(function(){}); }catch(e){}
      onUpdate(Object.assign({},cot,{estado_cot:"enviada"}));
    }
  };

  const copiarResumen = ()=>{
    const txt = `COTIZACIÓN #${cot.folio}\nCliente: ${cot.cliente?.nombre||""} (${cot.cliente?.empresa||"sin empresa"})\nTel: ${cot.cliente?.tel||"—"} · ${cot.cliente?.email||"—"}\nTotal: ${cot.total_piezas} piezas\n\n${cot.resumen||""}\n\nNotas cliente: ${cot.notas||"—"}`;
    navigator.clipboard.writeText(txt);
    alert("Resumen copiado al portapapeles");
  };

  // ── GENERADOR DE PDF ──────────────────────────────────────────
  // SVG de prendas como strings para el PDF
  const svgPrendaStr = (tipo, color="#c8b89a") => {
    const adj=(hex,n)=>{if(!hex||hex[0]!=='#'||hex.length<7)return"#b0a090";const c=v=>Math.min(255,Math.max(0,v));const r=c(parseInt(hex.slice(1,3),16)+n);const g=c(parseInt(hex.slice(3,5),16)+n);const b=c(parseInt(hex.slice(5,7),16)+n);return`#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`};
    const t = tipo==="sudadera"?"sudadera":tipo||"camisa";

    // ── CAMISA / BLUSA — cuello de punta, botones, bolsillo ──────────────
    if(t==="camisa") return `<svg viewBox="0 0 220 282" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;">
      <defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(0,0,0,0.08)"/><stop offset="0.35" stop-color="rgba(0,0,0,0)"/><stop offset="0.65" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.08)"/></linearGradient></defs>
      <path d="M62 30 L20 76 L4 66 L16 128 L46 122 L46 272 L174 272 L174 122 L204 128 L216 66 L200 76 L158 30 Q140 52 110 54 Q80 52 62 30Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <path d="M62 30 L20 76 L4 66 L16 128 L46 122 L46 272 L174 272 L174 122 L204 128 L216 66 L200 76 L158 30 Q140 52 110 54 Q80 52 62 30Z" fill="url(#cg)"/>
      <path d="M82 31 L70 16 L109 57 Z" fill="${adj(color,-18)}"/>
      <path d="M138 31 L150 16 L111 57 Z" fill="${adj(color,-18)}"/>
      <path d="M82 31 Q110 46 138 31 L132 22 Q110 38 88 22Z" fill="${adj(color,-14)}" opacity="0.6"/>
      <rect x="107" y="57" width="6" height="215" rx="2" fill="rgba(0,0,0,0.065)"/>
      ${[76,100,124,148,172,198,224].map(y=>`<circle cx="110" cy="${y}" r="3.5" fill="rgba(255,255,255,0.75)" stroke="${adj(color,-18)}" stroke-width="0.7"/>`).join("")}
      <rect x="64" y="94" width="28" height="22" rx="2" fill="rgba(0,0,0,0.05)" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.7"/>
      <line x1="64" y1="105" x2="92" y2="105" stroke="${adj(color,-14)}" stroke-width="0.5" opacity="0.5"/>
      <rect x="4"   y="112" width="40" height="18" rx="4" fill="${adj(color,-18)}" opacity="0.35"/>
      <rect x="176" y="112" width="40" height="18" rx="4" fill="${adj(color,-18)}" opacity="0.35"/>
      <line x1="62" y1="30" x2="46" y2="122" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
      <line x1="158" y1="30" x2="174" y2="122" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
      <line x1="46" y1="262" x2="174" y2="262" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
    </svg>`;

    // ── PLAYERA / POLO — cuello redondo, sin botones ───────────────────
    if(t==="playera") return `<svg viewBox="0 0 220 268" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(0,0,0,0.07)"/><stop offset="0.35" stop-color="rgba(0,0,0,0)"/><stop offset="0.65" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.07)"/></linearGradient></defs>
      <path d="M62 30 L20 76 L4 66 L16 128 L46 122 L46 258 L174 258 L174 122 L204 128 L216 66 L200 76 L158 30 Q140 50 110 52 Q80 50 62 30Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <path d="M62 30 L20 76 L4 66 L16 128 L46 122 L46 258 L174 258 L174 122 L204 128 L216 66 L200 76 L158 30 Q140 50 110 52 Q80 50 62 30Z" fill="url(#pg)"/>
      <path d="M84 31 Q110 58 136 31 Q124 22 110 20 Q96 22 84 31Z" fill="${adj(color,-16)}" opacity="0.8"/>
      <path d="M86 33 Q110 54 134 33 Q122 26 110 25 Q98 26 86 33Z" fill="${adj(color,-12)}" opacity="0.35"/>
      <path d="M4 66 L20 76 L18 86 L4 74Z" fill="${adj(color,-14)}" opacity="0.3"/>
      <path d="M216 66 L200 76 L202 86 L216 74Z" fill="${adj(color,-14)}" opacity="0.3"/>
      <rect x="46" y="248" width="128" height="10" rx="3" fill="${adj(color,-14)}" opacity="0.25"/>
      <line x1="62" y1="30" x2="46" y2="122" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
      <line x1="158" y1="30" x2="174" y2="122" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
    </svg>`;

    // ── SUDADERA / HOODIE — capucha, cordones, bolsillo canguro ─────────
    if(t==="sudadera") return `<svg viewBox="0 0 220 286" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;">
      <defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(0,0,0,0.09)"/><stop offset="0.35" stop-color="rgba(0,0,0,0)"/><stop offset="0.65" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.09)"/></linearGradient></defs>
      <path d="M62 72 L20 112 L4 102 L16 160 L46 154 L46 276 L174 276 L174 154 L204 160 L216 102 L200 112 L158 72 Q140 86 110 88 Q80 86 62 72Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <path d="M62 72 Q42 28 78 16 Q110 6 142 16 Q178 28 158 72 Q140 48 110 46 Q80 48 62 72Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <path d="M62 72 Q42 28 78 16 Q110 6 142 16 Q178 28 158 72 Q140 48 110 46 Q80 48 62 72Z" fill="url(#sg)"/>
      <path d="M80 18 Q110 10 140 18 Q128 13 110 12 Q92 13 80 18Z" fill="${adj(color,-18)}" opacity="0.5"/>
      <path d="M62 72 L20 112 L4 102 L16 160 L46 154 L46 276 L174 276 L174 154 L204 160 L216 102 L200 112 L158 72 Q140 86 110 88 Q80 86 62 72Z" fill="url(#sg)"/>
      <line x1="100" y1="80" x2="96"  y2="110" stroke="${adj(color,-22)}" stroke-width="2" stroke-linecap="round" opacity="0.55"/>
      <circle cx="96"  cy="112" r="3.5" fill="${adj(color,-22)}" opacity="0.55"/>
      <line x1="120" y1="80" x2="124" y2="110" stroke="${adj(color,-22)}" stroke-width="2" stroke-linecap="round" opacity="0.55"/>
      <circle cx="124" cy="112" r="3.5" fill="${adj(color,-22)}" opacity="0.55"/>
      <path d="M68 198 L68 247 Q110 254 152 247 L152 198 Q110 203 68 198Z" fill="rgba(0,0,0,0.07)" stroke="${adj(color,-14)}" stroke-width="0.8" opacity="0.7"/>
      <line x1="110" y1="198" x2="110" y2="251" stroke="${adj(color,-14)}" stroke-width="0.6" opacity="0.4"/>
      <rect x="46" y="264" width="128" height="12" rx="3" fill="${adj(color,-18)}" opacity="0.3"/>
      <rect x="4"   y="142" width="40" height="18" rx="4" fill="${adj(color,-18)}" opacity="0.3"/>
      <rect x="176" y="142" width="40" height="18" rx="4" fill="${adj(color,-18)}" opacity="0.3"/>
      <line x1="62"  y1="72" x2="46"  y2="154" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
      <line x1="158" y1="72" x2="174" y2="154" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
    </svg>`;

    // ── CHAMARRA / CHALECO — cuello punta, cremallera, bolsillos ────────
    if(t==="chamarra") return `<svg viewBox="0 0 220 274" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;">
      <defs><linearGradient id="chg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(0,0,0,0.09)"/><stop offset="0.35" stop-color="rgba(0,0,0,0)"/><stop offset="0.65" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.09)"/></linearGradient></defs>
      <path d="M62 32 L20 76 L4 66 L12 140 L46 132 L46 264 L174 264 L174 132 L208 140 L216 66 L200 76 L158 32 Q142 54 110 56 Q78 54 62 32Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <path d="M62 32 L20 76 L4 66 L12 140 L46 132 L46 264 L174 264 L174 132 L208 140 L216 66 L200 76 L158 32 Q142 54 110 56 Q78 54 62 32Z" fill="url(#chg)"/>
      <path d="M80 33 L66 18 L106 58 Z" fill="${adj(color,-18)}" opacity="0.85"/>
      <path d="M140 33 L154 18 L114 58 Z" fill="${adj(color,-18)}" opacity="0.85"/>
      <path d="M80 33 Q110 54 140 33 L134 24 Q110 44 86 24Z" fill="${adj(color,-14)}" opacity="0.6"/>
      <rect x="107" y="58" width="6" height="206" rx="3" fill="${adj(color,-24)}" opacity="0.55"/>
      <line x1="110" y1="62" x2="110" y2="260" stroke="rgba(255,255,255,0.2)" stroke-width="0.8" stroke-dasharray="4,5"/>
      <rect x="46"  y="132" width="38" height="24" rx="3" fill="rgba(0,0,0,0.06)" stroke="${adj(color,-14)}" stroke-width="0.8" opacity="0.7"/>
      <rect x="136" y="132" width="38" height="24" rx="3" fill="rgba(0,0,0,0.06)" stroke="${adj(color,-14)}" stroke-width="0.8" opacity="0.7"/>
      <rect x="46" y="252" width="128" height="12" rx="3" fill="${adj(color,-18)}" opacity="0.3"/>
      <rect x="4"   y="122" width="40" height="18" rx="4" fill="${adj(color,-18)}" opacity="0.3"/>
      <rect x="176" y="122" width="40" height="18" rx="4" fill="${adj(color,-18)}" opacity="0.3"/>
      <line x1="62"  y1="32" x2="46"  y2="132" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
      <line x1="158" y1="32" x2="174" y2="132" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.2"/>
    </svg>`;

    // ── GORRA — corona, visera, costuras, ojales ──────────────────────
    if(t==="gorra") return `<svg viewBox="0 0 220 148" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;">
      <path d="M28 108 Q28 36 110 28 Q192 36 192 108Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1.2"/>
      <path d="M28 108 Q40 68 56 46 Q86 108 28 108Z" fill="rgba(0,0,0,0.055)"/>
      <path d="M192 108 Q180 68 164 46 Q134 108 192 108Z" fill="rgba(0,0,0,0.055)"/>
      <line x1="110" y1="28" x2="110" y2="108" stroke="${adj(color,-18)}" stroke-width="0.8" opacity="0.4"/>
      <path d="M28 108 Q69 66 110 62 Q151 66 192 108" fill="none" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.3"/>
      <path d="M42 90 Q76 58 110 54 Q144 58 178 90" fill="none" stroke="${adj(color,-14)}" stroke-width="0.5" opacity="0.2"/>
      <path d="M16 116 Q19 104 28 108 L192 108 Q201 104 204 116 Q182 140 16 116Z" fill="${adj(color,-22)}" stroke="${adj(color,-18)}" stroke-width="1"/>
      <path d="M18 115 Q110 136 202 115 Q110 131 18 115Z" fill="rgba(0,0,0,0.1)"/>
      <circle cx="110" cy="30" r="6"   fill="${adj(color,-24)}" stroke="${adj(color,-18)}" stroke-width="0.8"/>
      <circle cx="110" cy="30" r="3.5" fill="rgba(255,255,255,0.25)"/>
      <path d="M28 108 Q110 121 192 108 L192 114 Q110 128 28 114Z" fill="${adj(color,-18)}" opacity="0.3"/>
      <ellipse cx="72"  cy="82" rx="4" ry="5" fill="${adj(color,-28)}" opacity="0.5"/>
      <ellipse cx="148" cy="82" rx="4" ry="5" fill="${adj(color,-28)}" opacity="0.5"/>
    </svg>`;

    // ── PANTALÓN — cinturilla, bolsillos, piernas ─────────────────────
    if(t==="pantalon") return `<svg viewBox="0 0 220 318" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;">
      <defs><linearGradient id="pang" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(0,0,0,0.08)"/><stop offset="0.4" stop-color="rgba(0,0,0,0)"/><stop offset="0.6" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.08)"/></linearGradient></defs>
      <rect x="26" y="18" width="168" height="26" rx="5" fill="${adj(color,-16)}" stroke="${adj(color,-18)}" stroke-width="1"/>
      ${[44,78,105,132,166].map(x=>`<rect x="${x}" y="12" width="10" height="18" rx="2" fill="${adj(color,-18)}" opacity="0.6"/>`).join("")}
      <path d="M26 44 L26 168 Q54 184 78 308 L122 308 L110 168 L110 168 L110 308 L142 308 Q166 184 194 168 L194 44Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <path d="M26 44 L26 168 Q54 184 78 308 L122 308 L110 168 L110 168 L110 308 L142 308 Q166 184 194 168 L194 44Z" fill="url(#pang)"/>
      <line x1="110" y1="44" x2="110" y2="176" stroke="${adj(color,-14)}" stroke-width="0.8" opacity="0.35"/>
      <path d="M100 44 L100 90 Q110 96 120 90 L120 44Z" fill="rgba(0,0,0,0.07)" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.6"/>
      <path d="M26 52 Q38 60 56 78 L56 44Z" fill="rgba(0,0,0,0.07)" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.55"/>
      <path d="M194 52 Q182 60 164 78 L164 44Z" fill="rgba(0,0,0,0.07)" stroke="${adj(color,-14)}" stroke-width="0.7" opacity="0.55"/>
      <line x1="28"  y1="301" x2="108" y2="301" stroke="${adj(color,-18)}" stroke-width="1.2" opacity="0.35"/>
      <line x1="112" y1="301" x2="192" y2="301" stroke="${adj(color,-18)}" stroke-width="1.2" opacity="0.35"/>
    </svg>`;

    // ── DELANTAL / BATA — peto, tiras, bolsillos ─────────────────────
    if(t==="delantal") return `<svg viewBox="0 0 220 302" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;">
      <line x1="88" y1="18" x2="86" y2="32" stroke="${adj(color,-22)}" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
      <line x1="132" y1="18" x2="134" y2="32" stroke="${adj(color,-22)}" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
      <path d="M88 18 Q110 12 132 18" fill="none" stroke="${adj(color,-22)}" stroke-width="4" stroke-linecap="round" opacity="0.55"/>
      <rect x="72" y="30" width="96" height="92" rx="8" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <rect x="72" y="30" width="96" height="92" rx="8" fill="rgba(0,0,0,0.04)"/>
      <rect x="95" y="54" width="50" height="40" rx="4" fill="rgba(0,0,0,0.06)" stroke="${adj(color,-14)}" stroke-width="0.8" opacity="0.65"/>
      <line x1="95" y1="66" x2="145" y2="66" stroke="${adj(color,-14)}" stroke-width="0.5" opacity="0.4"/>
      <line x1="22"  y1="138" x2="72"  y2="122" stroke="${adj(color,-22)}" stroke-width="6" stroke-linecap="round" opacity="0.55"/>
      <line x1="198" y1="138" x2="148" y2="122" stroke="${adj(color,-22)}" stroke-width="6" stroke-linecap="round" opacity="0.55"/>
      <path d="M44 122 L28 292 L192 292 L176 122Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <path d="M44 122 L28 292 L192 292 L176 122Z" fill="rgba(0,0,0,0.035)"/>
      <rect x="74" y="194" width="92" height="56" rx="4" fill="rgba(0,0,0,0.06)" stroke="${adj(color,-14)}" stroke-width="0.8" opacity="0.6"/>
      <line x1="120" y1="194" x2="120" y2="250" stroke="${adj(color,-14)}" stroke-width="0.6" opacity="0.35"/>
      <line x1="30"  y1="284" x2="190" y2="284" stroke="${adj(color,-18)}" stroke-width="0.8" opacity="0.3"/>
    </svg>`;

    // ── FALLBACK: playera genérica ────────────────────────────────────
    return `<svg viewBox="0 0 220 268" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;">
      <path d="M62 30 L20 76 L4 66 L16 128 L46 122 L46 258 L174 258 L174 122 L204 128 L216 66 L200 76 L158 30 Q140 50 110 52 Q80 50 62 30Z" fill="${color}" stroke="${adj(color,-14)}" stroke-width="1"/>
      <path d="M84 31 Q110 58 136 31 Q124 22 110 20 Q96 22 84 31Z" fill="${adj(color,-16)}" opacity="0.8"/>
    </svg>`;
  };

  const aspecto = (tipo) => {
    const t = tipo==="sudadera"?"sudadera":tipo||"camisa";
    if(t==="gorra")    return "68%";
    if(t==="pantalon") return "145%";
    if(t==="delantal") return "138%";
    if(t==="sudadera") return "130%";
    if(t==="camisa")   return "128%";
    if(t==="chamarra") return "125%";
    return "122%"; // playera y fallback
  };
  const diagramaZonasPDF = (designs, tipo) => {
    const t = tipo==="sudadera"?"sudadera":tipo||"camisa";
    const cfg = ZONAS_MAP[t] || ZONAS_MAP["camisa"];
    const renderVista = (zonas, vista, svgStr) => {
      const usadas = designs.filter(d => zonas.find(z=>z.id===d.zonaId));
      if(!usadas.length) return "";
      const overlays = zonas.map(z => {
        const d = designs.find(dd=>dd.zonaId===z.id);
        if(!d) return `<div style="position:absolute;left:${z.x};top:${z.y};width:${z.w};height:${z.h};border:1.5px dashed rgba(214,32,32,.25);border-radius:4px;box-sizing:border-box;"></div>`;
        const thumb = d.src&&d.src.startsWith("data:") ? `<img src="${d.src}" style="width:72%;height:72%;object-fit:contain;border-radius:2px;pointer-events:none;"/>` : `<span style="font-size:8px;font-weight:800;color:var(--c-danger);text-align:center;padding:2px;font-family:sans-serif;">${z.label}</span>`;
        return `<div style="position:absolute;left:${z.x};top:${z.y};width:${z.w};height:${z.h};border:2px solid var(--c-danger);border-radius:4px;background:rgba(214,32,32,.13);display:flex;align-items:center;justify-content:center;box-sizing:border-box;">${thumb}</div>`;
      }).join("");
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0;">
        <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#999;">${vista}</div>
        <div style="position:relative;width:100%;padding-bottom:${aspecto(t)};background:#f8f6f2;border-radius:6px;overflow:hidden;">
          <div style="position:absolute;inset:0;">${svgStr}${overlays}</div>
        </div>
      </div>`;
    };
    const colorPrenda = "#c8b89a";
    const frontStr = renderVista(cfg.frontal||[], "Frontal", svgPrendaStr(t, colorPrenda));
    const backStr  = renderVista(cfg.trasera||[], "Trasera", svgPrendaStr(t, colorPrenda));
    if(!frontStr && !backStr) return "";
    return `<div style="display:flex;gap:12px;margin-top:12px;">${frontStr}${backStr}</div>`;
  };

  const generarPDF = ()=>{
    const fecha = cot.fecha ? new Date(cot.fecha).toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"}) : "—";

    // ── Calcular tabla de precios ──────────────────────────────
    const filasPrecio = [];
    (cot.grupos||[]).forEach((g,gi)=>{
      (g.prendas||[]).forEach((p,pi)=>{
        const pk=`g${gi}_p${pi}`;
        const pu = parseFloat(preciosGrupo[pk]||"")||0;
        const du = getDu(g, gi, pi);
        if(pu>0||du>0){
          filasPrecio.push({modelo:p.modelo, color:p.color, size:p.size, variant:p.variant, cantidad:parseInt(p.cantidad)||0, precioUnit:pu+du, grupo:g.nombre||`Grupo ${gi+1}`});
        }
      });
    });
    const subtotal = filasPrecio.reduce((a,p)=>a+p.precioUnit*p.cantidad,0);
    const serviciosSub = (serviciosArte||[]).reduce((a,s)=>a+(s.subtotal||0),0);
    const envioN   = parseFloat(precioEnvio)||0;
    const descN    = parseFloat(descuento)||0;
    const baseTotal = subtotal + serviciosSub + envioN - descN;
    const ivaAmt   = conIVA ? baseTotal * 0.16 : 0;
    const total    = baseTotal + ivaAmt;
    const hasPrices = filasPrecio.length>0 || subtotal>0 || serviciosSub>0;
    const mxn = n=>`$${Number(n).toLocaleString("es-MX",{minimumFractionDigits:2})}`;

    // ── HTML servicios de arte para el PDF ──────────────────────
    const serviciosHTML = serviciosSub > 0 ? `
      <div style="margin-top:20px;margin-bottom:8px;page-break-inside:avoid;">
        <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
          Servicios de Arte
          <span style="background:#1C1C1C;color:#fff;font-size:9px;padding:2px 8px;border-radius:999px;letter-spacing:.05em;">MAQUILA</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#333;">
          <thead>
            <tr style="background:#f8f6f2;">
              <th style="padding:7px 12px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Técnica</th>
              <th style="padding:7px 12px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Descripción</th>
              <th style="padding:7px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Cant.</th>
              <th style="padding:7px 12px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">$/pza</th>
              <th style="padding:7px 12px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${(serviciosArte||[]).map((s,i)=>{
              const esBordado = s.tecnica==="bordado";
              const desc = [s.descripcion, s.opcion_desc].filter(Boolean).join(" · ");
              const ppu = esBordado ? s.precio_pieza : s.precio_unitario;
              return `<tr style="border-bottom:1px solid #f0ede8;${i%2===1?"background:#fdf9f6;":" "}">
                <td style="padding:7px 12px;font-weight:700;color:#111;text-transform:capitalize;">${s.tecnica||""}${esBordado?`<div style="font-size:10px;color:#888;font-weight:400;">Fijo ${mxn(s.precio_fijo||0)}</div>`:"" }</td>
                <td style="padding:7px 12px;color:#555;font-size:12px;">${desc||"—"}</td>
                <td style="padding:7px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:900;">${s.cantidad}</td>
                <td style="padding:7px 12px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;">${mxn(ppu||0)}</td>
                <td style="padding:7px 12px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:900;color:#111;">${mxn(s.subtotal||0)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
        <div style="display:flex;justify-content:flex-end;padding:8px 12px 4px;border-top:1px solid #e8e4de;font-size:13px;color:#555;">
          <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;">Subtotal maquila: ${mxn(serviciosSub)}</span>
        </div>
      </div>` : "";

    const preciosHTML = hasPrices ? `
      <div style="margin-top:24px;margin-bottom:20px;page-break-inside:avoid;">
        <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:10px;">Desglose de precios</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#333;">
          <thead>
            <tr style="background:#f8f6f2;">
              <th style="padding:8px 12px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Prenda</th>
              <th style="padding:8px 12px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Grupo</th>
              <th style="padding:8px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Cant.</th>
              <th style="padding:8px 12px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">$/pza</th>
              <th style="padding:8px 12px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${filasPrecio.map((p,i)=>`
              <tr style="border-bottom:1px solid #f0ede8;${i%2===1?"background:#fdf9f6;":""}">
                <td style="padding:8px 12px;font-weight:600;color:#111;">${p.modelo}${p.color?` <span style="color:#888;font-weight:400;font-size:12px;">· ${p.color}</span>`:""}${p.size?` <span style="color:#888;font-weight:400;font-size:12px;">T.${p.size}</span>`:""}</td>
                <td style="padding:8px 12px;color:#888;font-size:12px;">${p.grupo}</td>
                <td style="padding:8px 12px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:900;">${p.cantidad}</td>
                <td style="padding:8px 12px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;">${mxn(p.precioUnit)}</td>
                <td style="padding:8px 12px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:900;color:#111;">${mxn(p.precioUnit*p.cantidad)}</td>
              </tr>`).join("")}
          </tbody>
        </table>

        <!-- TOTALES -->
        <div style="margin-top:0;border:1.5px solid #e0ddd8;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">
          ${envioN>0?`<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #f0ede8;font-size:13px;color:#555;"><span>Envío</span><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;">${mxn(envioN)}</span></div>`:""}
          ${descN>0?`<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #f0ede8;font-size:13px;color:#c07020;"><span>Descuento${cot.descuento?.code?" ("+cot.descuento.code+")":""}</span><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;">-${mxn(descN)}</span></div>`:""}
          ${conIVA?`
          <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #f0ede8;font-size:13px;color:#555;background:#fafaf8;"><span>Subtotal</span><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;">${mxn(baseTotal)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e8e4de;font-size:13px;color:#555;background:#fafaf8;"><span>IVA (16%)</span><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;">${mxn(ivaAmt)}</span></div>`:""}
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#111;">
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:800;text-transform:uppercase;color:#888;letter-spacing:1px;">TOTAL${conIVA?" (IVA incluido)":""}</span>
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;color:var(--c-danger);">${mxn(total)}</span>
          </div>
        </div>
      </div>` : "";

    // Construir HTML de grupos con imágenes
    const gruposHTML = (cot.grupos||[]).map((g,i)=>{
      // ── Calcular si este grupo tiene precios asignados
      const groupPrices = (g.prendas||[]).map((p,pi)=>{
        const pk=`g${i}_p${pi}`;
        const prenda = parseFloat(preciosGrupo[pk]||"")||0;
        const diseno = getDu(g, i, pi);
        return {prenda, diseno, total: prenda+diseno};
      });
      const grupoTienePrecios = groupPrices.some(p=>p.total>0);
      const grupoSubtotal = (g.prendas||[]).reduce((acc,p,pi)=>{
        return acc + groupPrices[pi].total*(parseInt(p.cantidad)||0);
      },0);

      const prendasRows = (g.prendas||[]).map((p,pi)=>{
        const {prenda:pu, diseno:du, total:pu_total} = groupPrices[pi];
        const sub = pu_total*(parseInt(p.cantidad)||0);
        const sublinea = (pu>0&&du>0)
          ? `<div style="font-size:10px;color:#aaa;margin-top:2px;">🎽 ${mxn(pu)} prenda + ✏️ ${mxn(du)} decorado</div>`
          : "";
        return `
        <tr>
          <td style="padding:5px 7px;border-bottom:1px solid #f0ede8;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:900;">${p.cantidad}</td>
          <td style="padding:5px 7px;border-bottom:1px solid #f0ede8;font-weight:600;color:#111;font-size:11px;">${p.modelo||""}${p.color?`<span style="color:#888;font-weight:400;font-size:10px;margin-left:3px;">· ${p.color}</span>`:""}${sublinea}</td>
          <td style="padding:5px 7px;border-bottom:1px solid #f0ede8;color:#555;font-size:11px;">${p.color||""}</td>
          <td style="padding:5px 7px;border-bottom:1px solid #f0ede8;color:#555;font-size:11px;">${p.size?`T. ${p.size}`:"—"}</td>
          <td style="padding:5px 7px;border-bottom:1px solid #f0ede8;color:#555;font-size:11px;">${p.variant&&p.variant!==p.size?p.variant:"—"}</td>
          ${grupoTienePrecios?`
          <td style="padding:5px 7px;border-bottom:1px solid #f0ede8;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;">${pu_total>0?mxn(pu_total):"—"}</td>
          <td style="padding:5px 7px;border-bottom:1px solid #f0ede8;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:900;color:${sub>0?"#111":"#aaa"};">${sub>0?mxn(sub):"—"}</td>`:""}
        </tr>`}).join("");

      const preciosHeaders = grupoTienePrecios ? `
        <th style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:1.5px solid #e8e4de;">$/pza</th>
        <th style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:1.5px solid #e8e4de;">Importe</th>` : "";

      const grupoSubtotalRow = grupoTienePrecios && grupoSubtotal>0 ? `
        <tr style="background:#f8f6f2;">
          <td colspan="5" style="padding:5px 7px;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:.5px;">Subtotal grupo</td>
          <td style="padding:5px 7px;text-align:right;"></td>
          <td style="padding:5px 7px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:900;color:var(--c-danger);">${mxn(grupoSubtotal)}</td>
        </tr>` : "";

      let disenosHTML = "";
      if(g.modo==="mockup" && g.mockup){
        const imgTag = g.mockup.src && g.mockup.src.startsWith("data:")
          ? `<img src="${g.mockup.src}" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #e0ddd8;object-fit:contain;display:block;"/>`
          : `<div style="padding:12px;background:#f5f2ed;border-radius:6px;color:#888;font-size:13px;">📎 ${g.mockup.name}</div>`;
        disenosHTML = `
          <div style="margin-top:14px;">
            <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:8px;">Mockup / Ficha técnica</div>
            ${imgTag}
          </div>`;
      } else if((g.designs||[]).length>0){

        // Usar shapeCat del grupo; si no, buscarlo en el catálogo por el modelo de la primera prenda
        const resolveShapeCatPDF = (grp) => {
          if(grp.shapeCat) return grp.shapeCat;
          const firstP = (grp.prendas||[])[0];
          if(firstP){
            const prod = prods.find(p=>p.name===firstP.modelo);
            if(prod && prod.shapeCat) return prod.shapeCat;
            // Fallback por nombre del modelo
            const nm = (firstP.modelo||"").toLowerCase();
            if(nm.includes("gorra")||nm.includes("cap")||nm.includes("cachucha")) return "gorra";
            if(nm.includes("pantalon")||nm.includes("bermuda")) return "pantalon";
            if(nm.includes("playera")||nm.includes("polo")||nm.includes("camiseta")) return "playera";
            if(nm.includes("chamarra")||nm.includes("chaleco")) return "chamarra";
            if(nm.includes("sudadera")||nm.includes("hoodie")) return "sudadera";
            if(nm.includes("bata")||nm.includes("mandil")||nm.includes("filipina")||nm.includes("delantal")) return "delantal";
          }
          return "camisa";
        };
        const sc = resolveShapeCatPDF(g);
        const t  = sc==="sudadera"?"playera":sc;
        const cfg = ZONAS_MAP[t] || ZONAS_MAP["camisa"];
        const colorPrenda = "#c8b89a";
        const isGorra = t==="gorra";

        // ── Renderizar vista de prenda con zonas marcadas ──────────────────
        const renderVistaPDF = (zonas, vista, svgStr) => {
          const usadas = g.designs.filter(d=>zonas.find(z=>z.id===d.zonaId));
          const overlays = zonas.map(z=>{
            const d = g.designs.find(dd=>dd.zonaId===z.id);
            if(!d) return `<div style="position:absolute;left:${z.x};top:${z.y};width:${z.w};height:${z.h};border:1.5px dashed rgba(180,40,40,.25);border-radius:3px;box-sizing:border-box;"></div>`;
            const thumb = d.src ? `<img src="${d.src}" style="max-width:80%;max-height:80%;object-fit:contain;border-radius:2px;"/>` : `<div style="width:8px;height:8px;background:var(--c-danger);border-radius:50%;"></div>`;
            return `<div style="position:absolute;left:${z.x};top:${z.y};width:${z.w};height:${z.h};border:2.5px solid var(--c-danger);border-radius:3px;background:rgba(214,32,32,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;box-sizing:border-box;">${thumb}</div>`;
          }).join("");
          if(!usadas.length && !overlays) return "";
          return `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;">
              <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#bbb;margin-bottom:2px;">${vista}</div>
              <div style="position:relative;width:100%;padding-bottom:${aspecto(t)};background:linear-gradient(135deg,#f5f4f1,#eeece8);border-radius:8px;overflow:hidden;border:1px solid #e8e4de;">
                <div style="position:absolute;inset:0;">${svgStr}${overlays}</div>
              </div>
            </div>`;
        };

        const frontVista = renderVistaPDF(cfg.frontal||[], "FRONTAL", svgPrendaStr(t, colorPrenda));
        const backVista  = renderVistaPDF(cfg.trasera||[], "TRASERA",  svgPrendaStr(t, colorPrenda));

        // ── Tarjetas de diseño ────────────────────────────────────────────
        const designCards = g.designs.map((d,di)=>{
          const imgTag = d.src
            ? `<img src="${d.src}" style="width:110px;height:110px;object-fit:contain;border-radius:8px;border:1.5px solid var(--c-danger);background:#f8f6f2;display:block;flex-shrink:0;"/>`
            : `<div style="width:110px;height:110px;background:#f0ede8;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0;">🖼</div>`;
          return `
            <div style="display:flex;align-items:flex-start;gap:14px;padding:12px 14px;background:#f8f6f2;border-radius:8px;border:1px solid #e8e4de;margin-bottom:8px;">
              ${imgTag}
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                  <span style="background:var(--c-danger);color:white;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:900;text-transform:uppercase;padding:2px 8px;border-radius:10px;letter-spacing:.5px;">Arte ${di+1}</span>
                  <span style="font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:900;text-transform:uppercase;color:#111;">📍 ${d.zonaLabel||"Sin zona asignada"}</span>
                </div>
                ${d.tecnica?`<div style="display:inline-block;background:#fff;border:1.5px solid var(--c-danger);color:var(--c-danger);font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:800;text-transform:uppercase;padding:2px 10px;border-radius:4px;letter-spacing:.5px;margin-bottom:5px;">${d.tecnica}</div>`:""}
                ${d.medidas?`<div style="font-size:12px;color:#555;margin-top:4px;">📐 Medidas: <strong>${d.medidas}</strong></div>`:""}
                ${d.nota?`<div style="font-size:11px;color:#888;font-style:italic;margin-top:4px;padding:6px 8px;background:white;border-radius:4px;border-left:3px solid #e8e4de;">💬 ${d.nota}</div>`:""}
              </div>
            </div>`;
        }).join("");

        disenosHTML = `
          <div style="margin-top:18px;border-top:2px solid #e8e4de;padding-top:16px;">
            <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:14px;">DISEÑOS Y ARTES — COLOCACIÓN</div>

            ${(frontVista||backVista)?`
            <!-- MAPA DE POSICIONES -->
            <div style="display:flex;gap:14px;margin-bottom:18px;padding:12px;background:#f8f6f2;border-radius:10px;border:1px solid #e8e4de;max-width:420px;">
              ${frontVista}
              ${backVista}
              <!-- LEYENDA -->
              <div style="flex:0 0 120px;display:flex;flex-direction:column;gap:5px;justify-content:center;">
                <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#bbb;margin-bottom:3px;">Zonas marcadas</div>
                ${g.designs.filter(d=>d.zonaId).map((d,k)=>`
                  <div style="display:flex;align-items:center;gap:5px;background:white;border:1px solid #e8e4de;border-radius:5px;padding:4px 7px;">
                    <div style="width:7px;height:7px;border-radius:50%;background:var(--c-danger);flex-shrink:0;"></div>
                    <div>
                      <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;color:#111;line-height:1.1;">${d.zonaLabel||"—"}</div>
                      ${d.tecnica?`<div style="font-size:9px;color:var(--c-danger);font-weight:600;">${d.tecnica}</div>`:""}
                    </div>
                  </div>`).join("")}
              </div>
            </div>` : ""}

            <!-- TARJETAS DE DISEÑO -->
            ${designCards}
          </div>`;
      }

      return `
        <div style="background:white;border:1px solid #e0ddd8;border-radius:6px;padding:10px 14px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:900;text-transform:uppercase;color:#111;">${g.nombre||`Grupo ${i+1}`}</div>
            <div style="font-size:9px;font-weight:800;text-transform:uppercase;background:#f0ede8;color:#888;padding:3px 8px;border-radius:10px;letter-spacing:.5px;">${g.modo==="mockup"?"Mockup":"Diseño guiado"}</div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;color:#333;">
            <thead>
              <tr style="background:#f8f6f2;">
                <th style="padding:5px 7px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:1.5px solid #e8e4de;">Cant.</th>
                <th style="padding:5px 7px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:1.5px solid #e8e4de;">Línea</th>
                <th style="padding:5px 7px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:1.5px solid #e8e4de;">Color</th>
                <th style="padding:5px 7px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:1.5px solid #e8e4de;">Talla</th>
                <th style="padding:5px 7px;text-align:left;font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;color:#999;letter-spacing:1px;border-bottom:1.5px solid #e8e4de;">Modelo</th>
                ${preciosHeaders}
              </tr>
            </thead>
            <tbody>${prendasRows}${grupoSubtotalRow}</tbody>
          </table>
          ${disenosHTML}
        </div>`;
    }).join("");

    const notasClienteHTML = cot.notas ? `
      <div style="background:#fffaf0;border:1.5px solid #f5d88a;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#b88a20;margin-bottom:6px;">Instrucciones del cliente</div>
        <div style="font-size:13px;color:#6a5010;white-space:pre-wrap;">${cot.notas}</div>
      </div>` : "";

    const notasAdminHTML = notasAdmin ? `
      <div style="background:#f0f4ff;border:1.5px solid #c0d0f0;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#4a60a0;margin-bottom:6px;">Notas del asesor</div>
        <div style="font-size:13px;color:#2a3870;white-space:pre-wrap;">${notasAdmin}</div>
      </div>` : "";

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cotización ${cot.folio} — LANA</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Barlow',sans-serif;background:#f0ede8;color:#1a1a1a;padding:0}
  @page{size:letter portrait;margin:0}
  @media print{
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    html,body{background:white!important;margin:0!important;padding:0!important}
    .no-print{display:none!important}
    .page{box-shadow:none!important;margin:0!important;padding:0!important;border-radius:0!important;max-width:100%!important;min-height:0!important}
    .page-inner{padding:8mm 10mm!important}
    .page-header{border-radius:0!important}
    .page-client{border-radius:0!important}
  }
</style>
</head>
<body>
<!-- TOOLBAR (solo pantalla) -->
<div class="no-print" style="position:sticky;top:0;z-index:99;background:#111;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:3px solid var(--c-danger);">
  <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:900;color:white;letter-spacing:.5px;">${MY_TENANT_NOMBRE||"LANA"} — COTIZACIÓN #${cot.folio}</div>
  <div style="display:flex;gap:8px;">
    <button onclick="window.print()" style="padding:7px 16px;background:var(--c-danger);border:none;border-radius:6px;color:white;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:900;text-transform:uppercase;cursor:pointer;letter-spacing:.5px;">🖨 Imprimir / PDF</button>
    <button onclick="window.close()" style="padding:7px 12px;background:#2a2a2a;border:1.5px solid rgba(255,255,255,.1);border-radius:6px;color:#aaa;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;cursor:pointer;">✕ Cerrar</button>
  </div>
</div>

<div class="page" style="max-width:760px;margin:20px auto;background:white;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.12);overflow:visible;">

  <!-- ENCABEZADO COMPACTO -->
  <div class="page-header" style="background:#111;padding:14px 22px;border-radius:10px 10px 0 0;display:flex;justify-content:space-between;align-items:center;gap:12px;">
    <div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;color:white;letter-spacing:1px;line-height:1;">${MY_TENANT_NOMBRE||"LANA"}</div>
    </div>
    <div style="text-align:right;">
      <div style="background:var(--c-danger);color:white;font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:900;padding:5px 14px;border-radius:5px;letter-spacing:1px;">FOLIO #${cot.folio}</div>
      <div style="font-size:11px;color:#666;margin-top:4px;">${fecha}</div>
    </div>
  </div>

  <!-- DATOS CLIENTE — fila horizontal compacta -->
  <div class="page-client" style="padding:10px 22px;background:#f8f6f2;border-bottom:1.5px solid #e8e4de;display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
    <div style="flex:2;min-width:150px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:2px;">Cliente</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;color:#111;line-height:1;">${cot.cliente?.nombre||"—"}</div>
      ${cot.cliente?.empresa?`<div style="font-size:11px;color:#888;">${cot.cliente.empresa}</div>`:""}
    </div>
    <div style="flex:2;min-width:130px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:2px;">Contacto</div>
      ${cot.cliente?.tel?`<div style="font-size:11px;color:#555;">📱 ${cot.cliente.tel}</div>`:""}
      ${cot.cliente?.email?`<div style="font-size:11px;color:#555;">✉ ${cot.cliente.email}</div>`:""}
    </div>
    <div style="text-align:center;min-width:70px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:2px;">Piezas</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;color:var(--c-danger);line-height:1;">${cot.total_piezas||0}</div>
    </div>
    <div style="text-align:center;min-width:55px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:2px;">Grupos</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;color:#111;line-height:1;">${(cot.grupos||[]).length}</div>
    </div>
  </div>

  <div class="page-inner" style="padding:14px 22px 20px;">
    <!-- DETALLE GRUPOS -->
    <div style="font-size:9px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#bbb;margin-bottom:10px;">Detalle del pedido</div>
    ${gruposHTML}

    ${serviciosHTML}

    ${preciosHTML}

    ${notasClienteHTML}
    ${notasAdminHTML}

    <!-- PIE -->
    <!-- LINK CLIENTE -->
    ${(()=>{
      const base = window.location.origin;
      const clientLink = base + "/aceptar.html?folio=" + encodeURIComponent(cot.folio) + "&tenant=" + encodeURIComponent(MY_TENANT_ID||"");
      return `
      <div style="margin-top:20px;padding:14px 18px;background:#f0f4ff;border:1.5px solid #c0d0f0;border-radius:8px;">
        <div style="font-size:9px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#4a60a0;margin-bottom:6px;">Link para el cliente</div>
        <a href="${clientLink}" style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:#2563eb;word-break:break-all;">${clientLink}</a>
        <div style="font-size:10px;color:#888;margin-top:4px;">El cliente puede ver y aceptar la cotización desde este enlace.</div>
      </div>`;
    })()}
    <div style="margin-top:20px;padding-top:18px;border-top:1.5px solid #f0ede8;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div style="font-size:11px;color:#bbb;line-height:1.6;">
        ${hasPrices ? (conIVA ? "Precios incluyen IVA (16%)." : "Precios sin IVA. Se puede emitir factura.") : "Cotización preliminar. Sujeta a disponibilidad."}
      </div>
      <div style="text-align:right;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:900;color:#888;text-transform:uppercase;letter-spacing:.5px;">${MY_TENANT_NOMBRE||"LANA"}</div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;

    const win = window.open("", "_blank");
    if(win){ win.document.write(html); win.document.close(); }
    else { alert("El navegador bloqueó la ventana emergente. Permite popups para este sitio."); }
  };
  // ─────────────────────────────────────────────────────────────

  // ── MENSAJES CON EL CLIENTE ─────────────────────────────────────
  const enviarRespuestaComentario = async () => {
    const texto = replyTexto.trim();
    if(!texto || enviandoReply) return;
    setEnviandoReply(true);
    const nuevo = {
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      texto, nombre:"Asesor", autor:"admin",
      fecha: new Date().toISOString(), historial:[]
    };
    const nuevos = [...comentarios, nuevo];
    setComentarios(nuevos);
    setReplyTexto("");
    onUpdate({...cot, comentarios:nuevos});
    // Notificar al cliente por correo — best-effort, no bloquea el guardado
    try{
      if(sb){
        await sb.functions.invoke("notify-respuesta-ts", {
          body:{
            tenant_id: MY_TENANT_ID, folio: cot.folio, mensaje: texto,
            cliente_email: cot.cliente?.email, cliente_nombre: cot.cliente?.nombre,
            tenant_nombre: MY_TENANT_NOMBRE||"LANA"
          }
        });
      }
    }catch(e){ console.error("notify-respuesta:",e); }
    setEnviandoReply(false);
  };

  const exportarConversacionPDF = async () => {
    let tenantInfo = {nombre: MY_TENANT_NOMBRE||"LANA", whatsapp:"", email_contacto:""};
    try{
      if(sb){
        const {data:td} = await sb.from("tenants").select("nombre,whatsapp,email_contacto").eq("id",MY_TENANT_ID).single();
        if(td) tenantInfo = td;
      }
    }catch(e){}

    const fecha = new Date().toLocaleString("es-MX",{day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"});
    const filas = comentarios.map(c=>{
      const esAdmin = c.autor==="admin";
      return `<div style="margin-bottom:14px;padding:12px 16px;border-radius:8px;background:${esAdmin?"#f0ebff":"#f7f6f4"};border:1px solid ${esAdmin?"#d4c8f0":"#e8e4de"};border-left:4px solid ${esAdmin?"#6B3FBF":"#c0392b"};">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:${esAdmin?"#6B3FBF":"#c0392b"};">${esAdmin?"Asesor":(c.nombre||"Cliente")}</span>
          <span style="font-size:11px;color:#999;">${c.fecha?new Date(c.fecha).toLocaleString("es-MX",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):""}</span>
        </div>
        ${c.texto?`<div style="font-size:13px;color:#1a1a1a;white-space:pre-wrap;">${c.texto}</div>`:""}
        ${c.imagen?`<img src="${c.imagen}" style="max-width:280px;border-radius:6px;margin-top:6px;display:block;"/>`:""}
      </div>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Conversación ${cot.folio} — ${tenantInfo.nombre}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Barlow',sans-serif;background:#f0ede8;color:#1a1a1a;}
@page{size:letter portrait;margin:0}
@media print{ *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important} html,body{background:white!important;margin:0!important;padding:0!important} .no-print{display:none!important} .page{box-shadow:none!important;margin:0!important;border-radius:0!important;max-width:100%!important} }
</style></head><body>
<div class="no-print" style="position:sticky;top:0;z-index:99;background:#111;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:3px solid #6B3FBF;">
  <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:900;color:white;letter-spacing:.5px;">${tenantInfo.nombre} — CONVERSACIÓN #${cot.folio}</div>
  <div style="display:flex;gap:8px;">
    <button onclick="window.print()" style="padding:7px 16px;background:#6B3FBF;border:none;border-radius:6px;color:white;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:900;text-transform:uppercase;cursor:pointer;letter-spacing:.5px;">🖨 Guardar como PDF</button>
    <button onclick="window.close()" style="padding:7px 12px;background:#2a2a2a;border:1.5px solid rgba(255,255,255,.1);border-radius:6px;color:#aaa;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;cursor:pointer;">✕ Cerrar</button>
  </div>
</div>

<div class="page" style="max-width:700px;margin:20px auto;background:white;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.12);overflow:visible;">
  <div style="background:#111;padding:14px 22px;border-radius:10px 10px 0 0;display:flex;justify-content:space-between;align-items:center;gap:12px;">
    <div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;color:white;letter-spacing:1px;line-height:1;">${tenantInfo.nombre}</div>
      <div style="font-size:10px;color:#aaa;margin-top:3px;">${[tenantInfo.whatsapp&&("📱 "+tenantInfo.whatsapp),tenantInfo.email_contacto&&("✉ "+tenantInfo.email_contacto)].filter(Boolean).join("  ·  ")}</div>
    </div>
    <div style="text-align:right;">
      <div style="background:#6B3FBF;color:white;font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:900;padding:5px 14px;border-radius:5px;letter-spacing:1px;">FOLIO #${cot.folio}</div>
      <div style="font-size:11px;color:#666;margin-top:4px;">${fecha}</div>
    </div>
  </div>

  <div style="padding:10px 22px;background:#f8f6f2;border-bottom:1.5px solid #e8e4de;display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
    <div style="flex:2;min-width:150px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:2px;">Cliente</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;color:#111;line-height:1;">${cot.cliente?.nombre||"—"}</div>
      ${cot.cliente?.empresa?`<div style="font-size:11px;color:#888;">${cot.cliente.empresa}</div>`:""}
    </div>
    <div style="flex:2;min-width:130px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:2px;">Contacto</div>
      ${cot.cliente?.tel?`<div style="font-size:11px;color:#555;">📱 ${cot.cliente.tel}</div>`:""}
      ${cot.cliente?.email?`<div style="font-size:11px;color:#555;">✉ ${cot.cliente.email}</div>`:""}
    </div>
    <div style="text-align:center;min-width:70px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:2px;">Mensajes</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;color:#6B3FBF;line-height:1;">${comentarios.length}</div>
    </div>
  </div>

  <div style="padding:18px 22px 22px;">
    <div style="font-size:9px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#bbb;margin-bottom:12px;">Conversación</div>
    ${filas || '<div style="color:#999;font-size:13px;">Sin mensajes.</div>'}
  </div>
</div>
</body></html>`;
    const win2 = window.open("", "_blank");
    if(win2){ win2.document.write(html); win2.document.close(); }
    else { alert("El navegador bloqueó la ventana emergente. Permite popups para este sitio."); }
  };
  // ─────────────────────────────────────────────────────────────

  return(
    <div className="modal-ov">
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-hdr" style={{flexDirection:"column",gap:0,padding:0}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 20px",borderBottom:"1px solid var(--c-border)"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",flex:1,minWidth:0,flexWrap:"wrap"}}>
              <div className="modal-ttl">#{cot.folio}</div>
              {/* REFERENCIA EDITABLE */}
              <input
                value={referencia}
                onChange={e=>setReferencia(e.target.value)}
                onBlur={()=>{
                  const updated={...cot, referencia, leida:true};
                  onUpdate(updated);
                  if(sb) sb.from("cotizaciones").update({referencia}).eq("folio",cot.folio).then(()=>{});
                }}
                placeholder="+ Nombre de referencia..."
                style={{background:"rgba(255,255,255,.06)",border:"1px solid var(--c-border)",borderRadius:"6px",padding:"4px 10px",color:"var(--c-text)",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:700,outline:"none",minWidth:"180px",flex:1,maxWidth:"280px"}}
              />
            </div>
            <div style={{display:"flex",gap:"10px",marginTop:"3px",flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:"12px",color:"var(--c-text2)"}}>{fmtFecha(cot.fecha)}</span>
              {cot.fechaEntrega && (
                <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,background:"var(--c-warning-bg)",border:"1px solid var(--c-warning-bd)",color:"var(--c-warning)",padding:"2px 8px",borderRadius:"6px",letterSpacing:".3px"}}>
                  📅 Entrega: {new Date(cot.fechaEntrega+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}
                </span>
              )}
            </div>
              <button className="modal-x" onClick={onClose}>✕</button>
            </div>
          </div>
          <div className="cot-tabbar" style={{display:"flex",borderBottom:"1px solid var(--c-border)",background:"var(--c-surface2)",padding:"0 16px"}}>
            {[
              {id:"resumen",label:"Resumen"},
              {id:"prendas",label:"Productos"},
              {id:"extras", label:"Detalle"},
              {id:"mensajes", label:"Mensajes"},
            ].map(function(t){
              return(
                <button key={t.id} onClick={function(){
                    setCotTab(t.id);
                    if(t.id==="mensajes" && cot.mensaje_sin_leer){
                      onUpdate(Object.assign({},cot,{mensaje_sin_leer:false}));
                    }
                  }}
                  style={{padding:"9px 14px",background:"none",border:"none",
                    borderBottom:cotTab===t.id?"2px solid var(--c-purple)":"2px solid transparent",
                    color:cotTab===t.id?"var(--c-purple)":"var(--c-text3)",
                    fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,
                    textTransform:"uppercase",letterSpacing:".5px",cursor:"pointer",
                    marginBottom:"-1px",whiteSpace:"nowrap",transition:"color .15s",
                    display:"flex",alignItems:"center",gap:"5px"}}>
                  {t.label}
                  {t.id==="mensajes"&&comentarios.length>0&&(
                    <span style={{background:"var(--c-danger)",color:"white",borderRadius:"9px",padding:"1px 6px",fontSize:"10px",fontWeight:900}}>{comentarios.length}</span>
                  )}
                </button>
              );
            })}
          </div>

        <div className="modal-body">
          <div style={{display:cotTab==="resumen"?"block":"none"}}>
          {/* STICKY TOTAL */}
          <div className="cot-stickytotal" style={{position:"sticky",top:0,zIndex:10,background:"var(--c-surface)",borderBottom:"1px solid var(--c-border)",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",margin:"-20px -22px 16px"}}>
            <div className="cot-stickytotal-inner" style={{display:"flex",gap:"20px",alignItems:"center"}}>
              <div>
                <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:"1px",color:"var(--c-text3)"}}>Total estimado</div>
                <div style={{fontFamily:"var(--fh)",fontSize:"24px",fontWeight:900,color:"var(--c-success)",lineHeight:1}}>
                  {(function(){
                    var sub=0;
                    (cot.grupos||[]).forEach(function(g,gi){
                      (g.prendas||[]).forEach(function(p,pi){
                        var pu=parseFloat(preciosGrupo["g"+gi+"_p"+pi]||0)||0;
                        var du=getDu(g,gi,pi,preciosGrupo);
                        sub+=(pu+du)*(parseInt(p.cantidad)||0);
                      });
                    });
                    if(!sub) return "—";
                    var base=sub+(parseFloat(precioEnvio)||0)-(parseFloat(descuento)||0);
                    return "$"+(Math.max(0,conIVA?base*1.16:base)).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});
                  })()}
                </div>
              </div>
              <div style={{display:"flex",gap:"14px"}}>
                <div>
                  <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:"var(--c-text3)"}}>Piezas</div>
                  <div style={{fontFamily:"var(--fh)",fontSize:"18px",fontWeight:900,color:"var(--c-purple)"}}>
                    {(cot.grupos||[]).reduce(function(s,g){return (g.prendas||[]).reduce(function(ss,p){return ss+(parseInt(p.cantidad)||0);},s);},0)}
                  </div>
                </div>
                <div>
                  <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:"var(--c-text3)"}}>Grupos</div>
                  <div style={{fontFamily:"var(--fh)",fontSize:"18px",fontWeight:900,color:"var(--c-text2)"}}>{(cot.grupos||[]).length}</div>
                </div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"6px",cursor:"pointer"}} onClick={function(){setConIVA(function(v){return !v;});}}>
              <div style={{width:"30px",height:"16px",borderRadius:"8px",background:conIVA?"var(--c-purple)":"var(--c-border)",position:"relative",transition:"background .2s",flexShrink:0}}>
                <div style={{position:"absolute",top:"2px",left:conIVA?"16px":"2px",width:"12px",height:"12px",background:"var(--c-surface)",borderRadius:"50%",transition:"left .2s"}}/>
              </div>
              <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,color:"var(--c-text2)",textTransform:"uppercase",letterSpacing:".5px"}}>IVA 16%</span>
            </div>
          </div>
          {/* CLIENTE */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
            <div className="section-title" style={{marginBottom:0}}>Cliente</div>
            <button onClick={()=>setEditCliente(e=>!e)}
              style={{padding:"5px 12px",background:editCliente?"var(--red)":"var(--c-surface3)",border:`1.5px solid ${editCliente?"var(--red)":"rgba(255,255,255,.12)"}`,borderRadius:"6px",color:editCliente?"white":"var(--c-text3)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",cursor:"pointer",letterSpacing:".5px"}}>
              {editCliente ? "✕ Cancelar" : "✏ Editar datos"}
            </button>
          </div>

          {editCliente ? (
            <div style={{background:"rgba(214,32,32,.06)",border:"1.5px solid rgba(214,32,32,.25)",borderRadius:"10px",padding:"14px",marginBottom:"18px"}}>
              {/* RFC con lookup */}
              <div style={{marginBottom:"10px"}}>
                <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"var(--c-text3)",marginBottom:"4px"}}>RFC (cliente verificado)</div>
                <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                  <input className="ai" value={localCliente.rfc||""} onChange={e=>setLocalCliente(p=>({...p,rfc:e.target.value.toUpperCase()}))}
                    placeholder="XAXX010101000" style={{padding:"7px 10px",fontSize:"13px",textTransform:"uppercase",letterSpacing:"1px",flex:1}}/>
                  <button onClick={async()=>{
                    const rfc=(localCliente.rfc||"").trim().toUpperCase();
                    if(!rfc||rfc.length<12) return;
                    const {data}=await sb.from("clientes_portal").select("*").eq("tenant_id",MY_TENANT_ID).eq("rfc",rfc).eq("tipo","recurrente").maybeSingle();
                    if(data){
                      setLocalCliente(p=>({...p,
                        nombre:data.razon_social||p.nombre,
                        email:data.email||p.email,
                        tel:data.whatsapp||p.tel,
                        rfc:data.rfc,
                        razon_social:data.razon_social,
                        regimen_fiscal:data.regimen_fiscal,
                        cp:data.cp,
                        estado:data.estado,
                        municipio:data.municipio,
                        colonia:data.colonia,
                        calle:data.calle,
                        email_fiscal:data.email_fiscal,
                      }));
                      alert("✅ Cliente verificado encontrado: "+data.razon_social);
                    } else {
                      alert("No se encontró cliente registrado con ese RFC.");
                    }
                  }} style={{padding:"7px 12px",background:"var(--c-purple)",border:"none",borderRadius:"6px",color:"white",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",cursor:"pointer",whiteSpace:"nowrap"}}>
                    🔍 Buscar
                  </button>
                </div>
              </div>
              <div className="cot-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"10px"}}>
                {[["Nombre *","nombre"],["Empresa","empresa"],["Teléfono","tel"],["Email","email"]].map(([lbl,key])=>(
                  <div key={key}>
                    <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"var(--c-text3)",marginBottom:"4px"}}>{lbl}</div>
                    <input className="ai" value={localCliente[key]||""} onChange={e=>setLocalCliente(p=>({...p,[key]:e.target.value}))}
                      placeholder={lbl} style={{padding:"7px 10px",fontSize:"13px"}}/>
                  </div>
                ))}
              </div>
              <div style={{marginBottom:"10px"}}>
                <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"var(--c-text3)",marginBottom:"4px"}}>Notas del cliente</div>
                <textarea className="ai" rows="2" value={localNotas} onChange={e=>setLocalNotas(e.target.value)} style={{padding:"7px 10px",fontSize:"12px",resize:"vertical"}}/>
              </div>
              <button onClick={guardarCliente}
                style={{padding:"8px 18px",background:"var(--c-purple)",border:"1.5px solid var(--c-purple-dk)",borderRadius:"7px",color:"white",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,textTransform:"uppercase",cursor:"pointer",letterSpacing:".5px"}}>
                💾 Guardar datos
              </button>
            </div>
          ) : (
            <div className="cot-modal-grid" style={{marginBottom:"18px"}}>
              <div className="cot-info-card">
                <div className="cot-info-lbl">Nombre</div>
                <div className="cot-info-val big">{cot.cliente?.nombre||"—"}</div>
                {cot.cliente?.empresa && <div style={{color:"var(--c-text3)",fontSize:"12px",marginTop:"3px"}}>{cot.cliente.empresa}</div>}
              </div>
              <div className="cot-info-card">
                <div className="cot-info-lbl">Total piezas</div>
                <div className="cot-info-val big" style={{color:"var(--red)"}}>{cot.total_piezas||0}</div>
              </div>
              <div className="cot-info-card">
                <div className="cot-info-lbl">Teléfono</div>
                <div className="cot-info-val">{cot.cliente?.tel || <span style={{color:"var(--c-text2)"}}>No proporcionado</span>}</div>
              </div>
              <div className="cot-info-card">
                <div className="cot-info-lbl">Email</div>
                <div className="cot-info-val" style={{fontSize:"12px"}}>{cot.cliente?.email || <span style={{color:"var(--c-text2)"}}>No proporcionado</span>}</div>
              </div>
              {cot.cliente?.rfc&&<div className="cot-info-card">
                <div className="cot-info-lbl">RFC</div>
                <div className="cot-info-val" style={{fontFamily:"var(--fh)",letterSpacing:"1px",fontWeight:900,color:"var(--c-purple)"}}>{cot.cliente.rfc}</div>
              </div>}
            </div>
          )}

          </div>
          <div style={{display:cotTab==="prendas"?"block":"none"}}>
          {/* ESTADO */}
          <div className="section-title">Estado de la cotización</div>
          <div className="estado-selector" style={{marginBottom:"18px"}}>
            {ESTADOS.map(e=>(
              <button key={e.id} className={`estado-btn${estado===e.id?" active":""}`} onClick={()=>cambiarEstado(e.id)}>
                {e.label}
              </button>
            ))}
          </div>

          {/* GRUPOS DE PRODUCTOS */}
          <div style={{marginBottom:"8px"}}><div className="section-title" style={{marginBottom:0}}>Detalle del pedido</div></div>



          {(cot.grupos||[]).length===0 ? (
            <div className="cot-grupo">
              <div style={{whiteSpace:"pre-wrap",color:"var(--c-text3)",fontSize:"12px",fontFamily:"monospace"}}>{cot.resumen||"Sin detalle"}</div>
            </div>
          ) : (cot.grupos||[]).map((g,i)=>(
            <div className="cot-grupo" key={i}>
              <div className="cot-grupo-ttl">
                <span>{g.nombre || `Grupo ${i+1}`}</span>
                <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                  <button onClick={(e)=>{e.stopPropagation();if(!confirm(`¿Eliminar "${g.nombre||`Grupo ${i+1}`}"? Se perderán sus prendas y precios.`))return;const updated={...cot,grupos:(cot.grupos||[]).filter((_,idx)=>idx!==i)};onUpdate(updated);sbSaveCotCompleta(updated);}}
                    style={{padding:"4px 10px",background:"rgba(220,38,38,.1)",border:"1px solid rgba(220,38,38,.25)",borderRadius:"5px",color:"var(--c-danger)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",cursor:"pointer",letterSpacing:".5px"}}>
                    🗑 Borrar
                  </button>

                </div>
              </div>
              <div style={{marginTop:"10px",borderTop:"1px solid var(--c-purple-bd)",paddingTop:"12px"}}>
                  {/* Productos agrupados por modelo+color — una card por grupo */}
                  {(function(){
                    var prendas = localGrupos[i]?.prendas||[];
                    if(!prendas.length) return null;
                    // Agrupar por modelo+color
                    var grupos2 = [];
                    prendas.forEach(function(p,pi){
                      var key = (p.modelo||"")+"||"+(p.color||"");
                      var g2 = grupos2.find(function(x){ return x.key===key; });
                      if(g2){ g2.tallas.push({size:p.size||"",cantidad:p.cantidad,pi:pi}); }
                      else grupos2.push({key:key,modelo:p.modelo,color:p.color,variant:p.variant||"",tallas:[{size:p.size||"",cantidad:p.cantidad,pi:pi}]});
                    });
                    return(
                      <div style={{display:"flex",flexDirection:"column",gap:"8px",marginBottom:"12px"}}>
                        {grupos2.map(function(grp,gi2){
                          var prod = prods.find(function(x){ return x.name===grp.modelo; });
                          // Buscar imagen por color específico
                          var imgSrc = null;
                          if(prod&&prod.imgs&&Array.isArray(prod.imgs)&&grp.color){
                            var norm = function(s){ return String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim(); };
                            var found = prod.imgs.find(function(im){ return norm(im.color)===norm(grp.color); });
                            if(!found) found = prod.imgs.find(function(im){ return norm(im.color).includes(norm(grp.color))||norm(grp.color).includes(norm(im.color)); });
                            if(found) imgSrc = found.src;
                          }
                          if(!imgSrc) imgSrc = (prod&&prod.main_img)||null;
                          var totalQty = grp.tallas.reduce(function(a,t){ return a+(parseInt(t.cantidad)||0); },0);
                          return(
                            <div key={grp.key} style={{background:"var(--c-purple-bg)",border:"1px solid var(--c-purple-bd)",borderRadius:"10px",padding:"10px 12px"}}>
                              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px"}}>
                                {/* Imagen */}
                                <div style={{width:"48px",height:"48px",borderRadius:"8px",background:"rgba(255,255,255,.06)",flexShrink:0,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--c-purple-bd)"}}>
                                  {imgSrc?<img src={imgSrc} style={{width:"100%",height:"100%",objectFit:"contain"}} alt={grp.modelo} onError={function(e){e.target.style.display="none";}}/>:<span style={{fontSize:"22px"}}>{"👔"}</span>}
                                </div>
                                {/* Info */}
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontFamily:"var(--fh)",fontSize:"12px",fontWeight:900,color:"var(--c-purple-lt)",textTransform:"uppercase",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{grp.modelo}</div>
                                  <div style={{display:"flex",alignItems:"center",gap:"6px",marginTop:"3px",flexWrap:"wrap"}}>
                                    <span style={{fontSize:"11px",color:"rgba(255,255,255,.6)"}}>{grp.color}</span>
                                    <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,color:"var(--c-purple-lt)"}}>{totalQty} pzs</span>
                                  </div>
                                </div>
                                {/* Eliminar todo el grupo */}
                                <button onClick={function(){
                                  var indices = grp.tallas.map(function(t){ return t.pi; });
                                  setLocalGrupos(function(prev){ return prev.map(function(g2,gi3){ if(gi3!==i) return g2; return {...g2,prendas:g2.prendas.filter(function(_,ppi){ return indices.indexOf(ppi)===-1; })}; }); });
                                }} style={{width:"28px",height:"28px",background:"var(--c-danger-bd)",border:"1px solid rgba(220,38,38,.3)",borderRadius:"5px",color:"var(--c-danger)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:"12px"}}>{"✕"}</button>
                              </div>
                              {/* Chips de tallas */}
                              <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                                {grp.tallas.map(function(t,ti){
                                  return(
                                    <div key={t.pi} style={{display:"flex",alignItems:"center",gap:"3px",background:"var(--c-purple-bg)",border:"1px solid var(--c-purple-bd)",borderRadius:"20px",padding:"3px 6px 3px 10px"}}>
                                      <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,color:"var(--c-purple-lt)",minWidth:"28px"}}>{t.size||"Úni"}</span>
                                      <button onClick={function(){ setLocalGrupos(function(prev){ return prev.map(function(g2,gi3){ if(gi3!==i) return g2; return {...g2,prendas:g2.prendas.map(function(pp,ppi){ return ppi!==t.pi?pp:{...pp,cantidad:Math.max(1,(parseInt(pp.cantidad)||1)-1)}; })}; }); }); }}
                                        style={{width:"18px",height:"18px",background:"rgba(255,255,255,.08)",border:"none",borderRadius:"50%",cursor:"pointer",color:"white",fontSize:"12px",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,lineHeight:1}}>{"−"}</button>
                                      <input type="number" min="1" value={t.cantidad}
                                        onChange={function(e){ setLocalGrupos(function(prev){ return prev.map(function(g2,gi3){ if(gi3!==i) return g2; return {...g2,prendas:g2.prendas.map(function(pp,ppi){ return ppi!==t.pi?pp:{...pp,cantidad:e.target.value}; })}; }); }); }}
                                        style={{width:"30px",textAlign:"center",background:"transparent",border:"none",color:"white",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,padding:"0",outline:"none"}}/>
                                      <button onClick={function(){ setLocalGrupos(function(prev){ return prev.map(function(g2,gi3){ if(gi3!==i) return g2; return {...g2,prendas:g2.prendas.map(function(pp,ppi){ return ppi!==t.pi?pp:{...pp,cantidad:(parseInt(pp.cantidad)||1)+1}; })}; }); }); }}
                                        style={{width:"18px",height:"18px",background:"var(--lana-purple)",border:"none",borderRadius:"50%",cursor:"pointer",color:"white",fontSize:"12px",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,lineHeight:1}}>{"+"}</button>
                                      <button onClick={function(){ setLocalGrupos(function(prev){ return prev.map(function(g2,gi3){ if(gi3!==i) return g2; return {...g2,prendas:g2.prendas.filter(function(_,ppi){ return ppi!==t.pi; })}; }); }); }}
                                        style={{width:"16px",height:"16px",background:"rgba(220,38,38,.2)",border:"none",borderRadius:"50%",cursor:"pointer",color:"var(--c-danger)",fontSize:"9px",display:"flex",alignItems:"center",justifyContent:"center",marginLeft:"2px"}}>{"×"}</button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  <button onClick={function(){ abrirModalCat(i); }}
                    style={{marginTop:"8px",width:"100%",padding:"10px",background:"var(--c-purple-bg)",border:"1.5px dashed var(--c-purple-bd)",borderRadius:"8px",color:"var(--c-purple)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,cursor:"pointer",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",textTransform:"uppercase",letterSpacing:".04em"}}>
                    <span style={{fontSize:"16px",lineHeight:1}}>+</span> Agregar producto a {g.nombre||("Grupo "+(i+1))}
                  </button>

                  {/* DISEÑOS Y POSICIONES */}
                  {(()=>{
                    const grpDisenos2 = localGrupos[i]?.designs||[];
                    const zonas2 = zonasDeGrupo(localGrupos[i]||{});
                    const limite2 = zonas2.length;
                    const addImg2 = (file) => {
                      if(!file) return;
                      if(grpDisenos2.length>=limite2){alert("Límite de "+limite2+" posiciones alcanzado");return;}
                      var addSlot = function(srcData, fileName){
                        setLocalGrupos(function(prev2){return prev2.map(function(g3,gi3){return gi3!==i?g3:{...g3,designs:[...g3.designs,{zonaId:"",zonaLabel:"",tecnica:"",medidas:"",src:srcData,fileName:fileName||"arte.png"}]};});});
                      };
                      // Si ya viene con src (objeto de PasteZone) — usar directo
                      if(file.src&&file.src.startsWith("data:")){
                        addSlot(file.src, file.name||file.fileName||"pegado.png");
                        return;
                      }
                      // Si es File/Blob — leer con FileReader
                      var tp = file.type||"";
                      if(!tp.startsWith("image/")) return;
                      var rdr=new FileReader();
                      rdr.onload=function(ev2){ addSlot(ev2.target.result, file.name||"arte.png"); };
                      rdr.readAsDataURL(file);
                    };
                    // Clic en posición LIBRE del mapa → asigna ahí el primer arte sin posición
                    const handleZonaClickMapa = (zona) => {
                      const idxPendiente = grpDisenos2.findIndex(d=>!d.zonaId);
                      if(idxPendiente===-1){ alert("Todas las imágenes ya tienen posición. Sube una nueva imagen para asignarla aquí."); return; }
                      updDiseno(i, idxPendiente, "zona", zona);
                    };
                    // Clic en ✕ de posición OCUPADA del mapa → libera la posición (no borra el arte)
                    const handleQuitarZonaMapa = (zonaId) => {
                      const idx = grpDisenos2.findIndex(d=>d.zonaId===zonaId);
                      if(idx===-1) return;
                      updDiseno(i, idx, "zona", {id:"",label:""});
                    };
                    return(
                      <div style={{marginTop:"16px",borderTop:"1px solid var(--c-purple-bd)",paddingTop:"14px"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
                          <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:900,textTransform:"uppercase",color:"var(--c-purple-lt)",letterSpacing:"1.5px"}}>🎨 Diseños y posiciones</div>
                          <div style={{display:"flex",gap:"4px"}}>
                            <button onClick={function(){ setLocalGrupos(function(prev){ return prev.map(function(g3,gi3){ if(gi3!==i) return g3; return {...g3,modo:"normal"}; }); }); }}
                              style={{padding:"4px 10px",borderRadius:"5px",border:"1.5px solid var(--c-purple-bd)",background:localGrupos[i]&&localGrupos[i].modo!=="mockup"?"var(--c-purple-bd)":"transparent",color:"var(--c-purple-lt)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,cursor:"pointer",textTransform:"uppercase"}}>
                              📍 Por zona
                            </button>
                            <button onClick={function(){ setLocalGrupos(function(prev){ return prev.map(function(g3,gi3){ if(gi3!==i) return g3; return {...g3,modo:"mockup",mockup:g3.mockup||null}; }); }); }}
                              style={{padding:"4px 10px",borderRadius:"5px",border:"1.5px solid var(--c-purple-bd)",background:localGrupos[i]&&localGrupos[i].modo==="mockup"?"var(--c-purple-bd)":"transparent",color:"var(--c-purple-lt)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,cursor:"pointer",textTransform:"uppercase"}}>
                              📄 Mockup completo
                            </button>
                          </div>
                        </div>
                        {/* MOCKUP COMPLETO */}
                        {localGrupos[i]&&localGrupos[i].modo==="mockup"&&(
                          <div style={{marginBottom:"14px",border:"2px dashed var(--c-purple-bd)",borderRadius:"10px",background:"var(--c-purple-bg)",padding:"16px"}}>
                            <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:"var(--c-purple-lt)",marginBottom:"10px"}}>📄 Mockup / Ficha completa</div>
                            {localGrupos[i].mockup&&localGrupos[i].mockup.src?(
                              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                                <img src={localGrupos[i].mockup.src} style={{width:"80px",height:"80px",objectFit:"contain",borderRadius:"6px",border:"1px solid var(--c-purple-bd)"}} alt="mockup"/>
                                <div style={{flex:1}}>
                                  <div style={{fontSize:"12px",color:"var(--c-purple-lt)",fontWeight:700}}>{localGrupos[i].mockup.name||"Mockup"}</div>
                                  <button onClick={function(){ setLocalGrupos(function(prev){ return prev.map(function(g3,gi3){ if(gi3!==i) return g3; return {...g3,mockup:null}; }); }); }}
                                    style={{marginTop:"6px",padding:"3px 10px",background:"var(--c-danger-bd)",border:"1px solid rgba(220,38,38,.3)",borderRadius:"4px",color:"var(--c-danger)",cursor:"pointer",fontSize:"11px"}}>
                                    ✕ Quitar
                                  </button>
                                </div>
                              </div>
                            ):null}
                            <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",padding:"12px 16px",background:"var(--c-purple-bg)",border:"1px solid var(--c-purple-bd)",borderRadius:"7px",cursor:"pointer",color:"var(--c-purple-lt)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,textTransform:"uppercase"}}>
                              📁 {localGrupos[i]&&localGrupos[i].mockup?"Cambiar archivo":"Subir mockup / PDF / imagen"}
                              <input type="file" accept="image/*,.pdf" style={{display:"none"}}
                                onChange={function(e){
                                  var f=e.target.files&&e.target.files[0];
                                  if(!f) return;
                                  var rdr=new FileReader();
                                  rdr.onload=function(ev){
                                    setLocalGrupos(function(prev){ return prev.map(function(g3,gi3){ if(gi3!==i) return g3; return {...g3,mockup:{src:ev.target.result,name:f.name,type:f.type}}; }); });
                                  };
                                  rdr.readAsDataURL(f);
                                  e.target.value="";
                                }}/>
                            </label>
                          </div>
                        )}
                        {/* ZONA UPLOAD — solo en modo por zona */}
                        {(!localGrupos[i]||localGrupos[i].modo!=="mockup")&&<div style={{marginBottom:"14px",border:"2px dashed var(--c-purple-bd)",borderRadius:"10px",background:"var(--c-purple-bg)"}}>
                          <PasteZone onPaste={addImg2}/>
                          <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"4px 18px 12px"}}>
                            <div style={{flex:1,height:"1px",background:"var(--c-purple-bd)"}}/>
                            <span style={{fontSize:"11px",color:"var(--c-purple)",fontFamily:"var(--fh)",fontWeight:700}}>O ELIGE ARCHIVO</span>
                            <div style={{flex:1,height:"1px",background:"var(--c-purple-bd)"}}/>
                          </div>
                          <div style={{padding:"0 18px 14px"}}>
                            {grpDisenos2.length<limite2?(
                              <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",padding:"9px 16px",background:"var(--c-purple-bg)",border:"1px solid var(--c-purple-bd)",borderRadius:"7px",cursor:"pointer",color:"var(--c-purple-lt)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,textTransform:"uppercase"}}>
                                📁 Seleccionar imágenes
                                <span style={{background:"var(--c-purple-bd)",borderRadius:"20px",padding:"1px 8px",fontSize:"11px"}}>{limite2-grpDisenos2.length} libre{limite2-grpDisenos2.length!==1?"s":""}</span>
                                <input type="file" accept="image/*" multiple style={{display:"none"}}
                                  onChange={e=>{Array.from(e.target.files).forEach(f=>addImg2(f));e.target.value="";}}/>
                              </label>
                            ):(
                              <div style={{textAlign:"center",padding:"9px",color:"var(--c-purple)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:700}}>✓ Todas las posiciones cubiertas</div>
                            )}
                          </div>
                        </div>}
                        {/* ARCHIVOS (izq, editables — vienen del configurador) + MAPA (der) — UN SOLO BLOQUE */}
                        <div style={{display:"grid",gridTemplateColumns:grpDisenos2.length>0?"minmax(0,1fr) minmax(220px,340px)":"1fr",gap:"16px",alignItems:"start"}}>
                        {/* COLUMNA IZQUIERDA — archivos de diseño */}
                        <div style={{minWidth:0}}>
                        {/* GALERÍA */}
                        {grpDisenos2.map((d,di)=>(
                          <div key={di} style={{display:"flex",gap:"12px",background:"var(--c-purple-bg)",border:"1px solid var(--c-purple-bd)",borderRadius:"10px",padding:"12px",marginBottom:"10px",alignItems:"flex-start"}}>
                            <div style={{flexShrink:0,position:"relative"}}>
                              {d.src?(
                                <img src={d.src} style={{width:"80px",height:"80px",objectFit:"contain",borderRadius:"8px",background:"rgba(255,255,255,.06)",border:"1px solid var(--c-purple-bd)",display:"block"}}
                                  onError={function(e){e.target.style.display="none";e.target.nextSibling&&(e.target.nextSibling.style.display="flex");}}/>
                              ):null}
                              {(!d.src)&&(
                                <div style={{width:"80px",height:"80px",borderRadius:"8px",background:"var(--c-purple-bg)",border:"1px dashed var(--c-purple-bd)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"24px"}}>🖼</div>
                              )}
                              <button onClick={()=>removeDiseno(i,di)}
                                style={{position:"absolute",top:"-6px",right:"-6px",width:"20px",height:"20px",borderRadius:"50%",background:"rgba(220,38,38,.85)",border:"none",color:"white",cursor:"pointer",fontSize:"11px",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:"13px",color:"var(--c-purple-lt)",marginBottom:"8px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:700}}>{d.fileName||("Arte "+(di+1))}</div>
                              {/* La posición ya NO se elige aquí — se asigna directo en el mapa de la derecha */}
                              <div style={{marginBottom:"6px"}}>
                                <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:"var(--c-purple)",marginBottom:"3px"}}>🎨 Técnica</div>
                                <select value={d.tecnica||""} onChange={e=>updDiseno(i,di,"tecnica",e.target.value)}
                                  style={{width:"100%",padding:"7px",background:"var(--c-surface)",border:"1px solid var(--c-purple-bd)",borderRadius:"6px",color:"var(--c-text)",fontSize:"13px",outline:"none",fontFamily:"var(--fh)"}}>
                                  <option value="">— Técnica —</option>
                                  {["Bordado","DTF","Serigrafía","Sublimación","Vinil","Estampado"].map(t=><option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <input type="text" value={d.medidas||""} onChange={e=>updDiseno(i,di,"medidas",e.target.value)}
                                placeholder="📐 Medidas — ej: 10×8 cm"
                                style={{width:"100%",padding:"7px 9px",background:"var(--c-surface)",border:"1px solid var(--c-purple-bd)",borderRadius:"6px",color:"var(--c-text)",fontSize:"13px",outline:"none",fontFamily:"var(--fh)",boxSizing:"border-box"}}/>
                              <div style={{marginTop:"6px",display:"flex",gap:"4px",flexWrap:"wrap"}}>
                                {d.zonaId?(
                                  <span style={{background:"var(--c-purple-bd)",border:"1px solid var(--c-purple-bd)",borderRadius:"20px",padding:"3px 9px",fontSize:"12px",color:"var(--c-purple-lt)",fontFamily:"var(--fh)",fontWeight:700}}>📍 {d.zonaLabel}</span>
                                ):(
                                  <span style={{background:"var(--c-danger-bg)",border:"1px solid var(--c-danger-bd)",borderRadius:"20px",padding:"3px 9px",fontSize:"12px",color:"var(--c-danger)",fontFamily:"var(--fh)",fontWeight:700}}>📍 Sin posición — asígnala en el mapa →</span>
                                )}
                                {d.tecnica&&<span style={{background:"var(--c-purple-bd)",border:"1px solid var(--c-purple-bd)",borderRadius:"20px",padding:"3px 9px",fontSize:"12px",color:"var(--c-purple-lt)",fontFamily:"var(--fh)",fontWeight:700}}>🎨 {d.tecnica}</span>}
                                {d.medidas&&<span style={{background:"var(--c-purple-bd)",border:"1px solid var(--c-purple-bd)",borderRadius:"20px",padding:"3px 9px",fontSize:"12px",color:"var(--c-purple-lt)",fontFamily:"var(--fh)",fontWeight:700}}>📐 {d.medidas}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                        {grpDisenos2.length===0&&(
                          <div style={{textAlign:"center",padding:"14px",color:"var(--c-purple)",fontSize:"12px",fontStyle:"italic",marginBottom:"12px"}}>
                            Sube imágenes arriba y configura posición y técnica
                          </div>
                        )}
                        </div>{/* /COLUMNA IZQUIERDA */}
                        {/* COLUMNA DERECHA — un solo mapa de posiciones, interactivo */}
                        {grpDisenos2.length>0&&(
                          <div style={{position:"sticky",top:"8px",background:"var(--c-purple-bg)",border:"1px solid var(--c-purple-bd)",borderRadius:"8px",padding:"12px"}}>
                            <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:"var(--c-purple)",marginBottom:"8px",letterSpacing:"1px"}}>Mapa de posiciones</div>
                            <MapaZonas designs={grpDisenos2} tipo={localGrupos[i]?.shapeCat||"camisa"} color={(localGrupos[i]?.prendas||[])[0]?.colorHex||"#c8b89a"} svgUrl={localGrupos[i]?.svgUrl} svgUrlBack={localGrupos[i]?.svgUrlBack}
                              onZonaClick={handleZonaClickMapa} onQuitarZona={handleQuitarZonaMapa}/>
                          </div>
                        )}
                        </div>{/* /grid archivos+mapa */}
                      </div>
                    );
                  })()}

                </div>

              {/* MOCKUP */}
              {g.modo==="mockup" && g.mockup && (
                <div style={{marginTop:"10px"}}>
                  <div style={{fontSize:"11px",fontWeight:800,letterSpacing:"1.5px",textTransform:"uppercase",color:"var(--c-text2)",marginBottom:"7px"}}>Mockup / Ficha técnica</div>
                  <div style={{display:"flex",alignItems:"center",gap:"12px",background:"var(--c-surface2)",borderRadius:"8px",padding:"10px 12px"}}>
                    {g.mockup.src && g.mockup.src.startsWith("data:image") && (
                      <img src={g.mockup.src} alt={g.mockup.name}
                        style={{width:"72px",height:"72px",objectFit:"contain",borderRadius:"6px",background:"#FFFFFF",flexShrink:0,border:"1px solid var(--c-border)"}}/>
                    )}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:800,color:"var(--c-text)",textTransform:"uppercase",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.mockup.name}</div>
                      {g.mockup.src && <a href={g.mockup.src} download={g.mockup.name} target="_blank" className="cot-mockup-link" style={{marginTop:"5px",display:"inline-block"}}>↓ Descargar</a>}
                    </div>
                  </div>
                </div>
              )}
              {/* DISEÑOS CON IMÁGENES Y MAPA — unificado arriba en el bloque editable (archivos + un solo mapa) */}

              {/* 💲 PRECIOS POR GRUPO */}
              {(g.prendas||[]).length>0 && (
                <div style={{marginTop:"14px",borderTop:"1px solid var(--c-border)",paddingTop:"12px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
                    <div style={{fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,textTransform:"uppercase",letterSpacing:"1.5px",color:"var(--c-text2)"}}>💲 Precios — {g.nombre||`Grupo ${i+1}`}</div>
                    <button onClick={()=>{
                      // Recalcular TODOS los precios del grupo por variante
                      const grupoActual = localGrupos[i];
                      if(!grupoActual) return;
                      (grupoActual.prendas||[]).forEach((p,pi)=>{
                        const pk=`g${i}_p${pi}`;
                        const prod2=findProdParaPrenda(p, prods);
                        if(!prod2) return;
                        let escalas=[];
                        if(Array.isArray(prod2.escalas)) escalas=prod2.escalas;
                        else if(prod2.escalas&&typeof prod2.escalas==="object"){
                          const map=[["p1_5",1,5],["p6_20",6,20],["p21_50",21,50],["p51_100",51,100],["p101",101,null]];
                          escalas=map.filter(([k])=>prod2.escalas[k]).map(([k,mn,mx])=>({min:mn,max:mx,precio:prod2.escalas[k]}));
                        }
                        const totalGrupo=(grupoActual.prendas||[]).reduce((a,pp)=>a+(parseInt(pp.cantidad)||0),0);
                        const sortedE=[...escalas].sort((a,b)=>(parseInt(a.min)||1)-(parseInt(b.min)||1));
                        let idx=sortedE.findIndex(e=>{ const mn=parseInt(e.min)||1,mx=e.max===null?Infinity:parseInt(e.max); return totalGrupo>=mn&&totalGrupo<=mx; });
                        if(idx===-1) idx=sortedE.length-1;
                        // Prioridad: varPrices del modelo específico
                        let precio=0;
                        if(p.variant&&prod2.varPrices){
                          const vpKey=prod2.varPrices[p.variant]?p.variant:Object.keys(prod2.varPrices).find(k=>k.toLowerCase()===(p.variant||"").toLowerCase());
                          if(vpKey){
                            const vp=prod2.varPrices[vpKey];
                            if(Array.isArray(vp)&&vp[idx]) precio=parseFloat(vp[idx].precio)||0;
                          }
                        }
                        if(!precio) precio=parseFloat(sortedE[idx]?.precio)||0;
                        // Aplicar sizeRecargo si existe
                        if(precio>0 && prod2.sizeRecargos && p.size){
                          precio += parseFloat(prod2.sizeRecargos[p.size])||0;
                        }
                        if(precio>0) setPreciosGrupo(prev=>({...prev,[pk]:String(precio)}));
                      });
                    }}
                    style={{padding:"5px 12px",background:"rgba(74,154,250,.12)",border:"1px solid rgba(74,154,250,.25)",borderRadius:"6px",color:"var(--c-info)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",cursor:"pointer",letterSpacing:".5px"}}>
                      ↓ Recalcular
                    </button>
                  </div>
                  <div className="cot-tbl-scroll">
                  <div className="cot-tbl-row4" style={{display:"grid",gridTemplateColumns:"1fr 44px 90px 90px",gap:"4px 8px",alignItems:"center",marginBottom:"6px",padding:"0 4px"}}>
                    {["Producto","Pzs","$ Prenda","Total"].map((h,k)=>(
                      <div key={k} style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:"1px",color:"var(--c-text3)",textAlign:k>0?"right":"left"}}>{h}</div>
                    ))}
                  </div>
                  {(g.prendas||[]).map((p,pi)=>{
                    const pk=`g${i}_p${pi}`;
                    const pu=parseFloat(preciosGrupo[pk]||"")||0;
                    const du=getDu(g, i, pi);
                    const total=(pu+du)*(parseInt(p.cantidad)||0);
                    const prod2=findProdParaPrenda(p, prods);
                    const bN=brands.find(b=>b.id===(prod2?.brand||p.marca))?.name||"";
                    const autoFillPrenda = () => {
                      if(pu>0) return;
                      if(!prod2) return;
                      let escalas=[];
                      if(Array.isArray(prod2.escalas)) escalas=prod2.escalas;
                      else if(prod2.escalas&&typeof prod2.escalas==="object"){
                        const map=[["p1_5",1,5],["p6_20",6,20],["p21_50",21,50],["p51_100",51,100],["p101",101,null]];
                        escalas=map.filter(([k])=>prod2.escalas[k]).map(([k,mn,mx])=>({min:mn,max:mx,precio:prod2.escalas[k]}));
                      }
                      // Usar total de TODAS las prendas del grupo para la escala
                      const totalGrupo=(g.prendas||[]).reduce((a,pp)=>a+(parseInt(pp.cantidad)||0),0);
                      const sortedE=[...escalas].sort((a,b)=>(parseInt(a.min)||1)-(parseInt(b.min)||1));
                      let idx=sortedE.findIndex(e=>{ const mn=parseInt(e.min)||1,mx=e.max===null?Infinity:parseInt(e.max); return totalGrupo>=mn&&totalGrupo<=mx; });
                      if(idx===-1) idx=sortedE.length-1;
                      // Prioridad 1: varPrices del modelo (case-insensitive)
                      let precio=0;
                      if(p.variant&&prod2.varPrices){
                        const vpKey = prod2.varPrices[p.variant]
                          ? p.variant
                          : Object.keys(prod2.varPrices).find(k=>k.toLowerCase()===(p.variant||"").toLowerCase());
                        if(vpKey){
                          const vp=prod2.varPrices[vpKey];
                          if(Array.isArray(vp)&&vp[idx]) precio=parseFloat(vp[idx].precio)||0;
                        }
                      }
                      // Prioridad 2: precio base de la escala
                      if(!precio) precio=parseFloat(sortedE[idx]?.precio)||0;
                      // Prioridad 3: sin escalas configuradas — usar precio base "desde $X"
                      if(!precio && prod2.desde) precio=parseFloat(prod2.desde)||0;
                      if(precio>0) setPreciosGrupo(prev=>({...prev,[pk]:String(precio)}));
                    };
                    return(
                      <div key={pk} className="cot-tbl-row4" style={{display:"grid",gridTemplateColumns:"1fr 44px 90px 90px",gap:"4px 8px",alignItems:"center",padding:"7px 4px",borderBottom:"1px solid rgba(255,255,255,.05)",background:pu>0?"rgba(74,154,74,.05)":"transparent"}}>
                        <div style={{minWidth:0,overflow:"hidden"}}>
                          <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,color:"var(--c-text)",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                            {bN&&<span style={{color:"var(--c-text2)",fontWeight:700,fontSize:"11px"}}>{bN} </span>}{p.modelo}
                          </div>
                          <div style={{fontSize:"11px",color:"var(--c-text2)",marginTop:"1px"}}>{p.color}{p.size?` · T.${p.size}`:""}{p.variant&&p.variant!==p.size?` · ${p.variant}`:""}</div>
                          {pu<=0&&prod2&&!(prod2.escalas&&(Array.isArray(prod2.escalas)?prod2.escalas.length:Object.keys(prod2.escalas).length))&&!prod2.desde&&(
                            <div style={{fontSize:"10px",color:"var(--c-warning)",marginTop:"2px"}} title="Este producto no tiene escalas de volumen ni precio base configurados en el catálogo">
                              ⚠️ Sin precio en catálogo — configúralo en Productos
                            </div>
                          )}
                        </div>
                        <div style={{fontFamily:"var(--fh)",fontSize:"16px",fontWeight:900,color:pu>0?"var(--c-success)":"var(--c-text2)",textAlign:"right"}}>{p.cantidad}</div>
                        <div style={{display:"flex",alignItems:"center",gap:"3px"}}>
                          <span style={{color:"var(--c-text3)",fontSize:"11px",flexShrink:0}}>$</span>
                          <input className="ai" type="number" min="0" step="0.01" placeholder="0.00"
                            value={preciosGrupo[pk]||""}
                            onFocus={autoFillPrenda}
                            onChange={e=>setPreciosGrupo(prev=>({...prev,[pk]:e.target.value}))}
                            style={{width:"100%",padding:"4px 6px",fontSize:"12px",textAlign:"right",fontFamily:"var(--fh)",fontWeight:800}}/>
                        </div>
                        <div style={{fontFamily:"var(--fh)",fontSize:"14px",fontWeight:900,color:total>0?"var(--c-success)":"var(--c-text3)",textAlign:"right"}}>
                          {total>0?`$${total.toLocaleString("es-MX",{minimumFractionDigits:2})}`:"—"}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  {(()=>{
                    const gSub=(g.prendas||[]).reduce((a,p,pi)=>{
                      const pk=`g${i}_p${pi}`;
                      return a+((parseFloat(preciosGrupo[pk]||0)||0)+getDu(g,i,pi))*(parseInt(p.cantidad)||0);
                    },0);
                    if(!gSub) return null;
                    return(
                      <div style={{display:"flex",justifyContent:"space-between",padding:"8px 4px 0",borderTop:"1px solid rgba(255,255,255,.08)",marginTop:"6px"}}>
                        <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,color:"var(--c-text3)",textTransform:"uppercase"}}>Subtotal {g.nombre||`Grupo ${i+1}`}</div>
                        <div style={{fontFamily:"var(--fh)",fontSize:"17px",fontWeight:900,color:"var(--c-success)"}}>${gSub.toLocaleString("es-MX",{minimumFractionDigits:2})}</div>
                      </div>
                    );
                  })()}

                  {/* ZONA DE DECORADO INLINE — única fuente de verdad, persiste directo en preciosGrupo */}
                  {g.modo!=="sin_diseno" && (g.designs||[]).filter(d=>d.zonaId||d.zonaLabel).length>0 && (()=>{
                    const designs=(g.designs||[]).filter(d=>d.zonaId||d.zonaLabel);
                    const multiZona = designs.length>1;
                    // Clave por zona: dis_g{i}_p0_z{di} — aplica a TODAS las prendas del grupo (mismo bordado en todas las tallas)
                    // Respaldo: cotizaciones viejas (antes del desglose por zona) solo guardaban
                    // un total agregado en la clave plana dis_g{i}_p0 — si no hay nada en la
                    // clave por zona y solo hay una zona, usa ese valor viejo.
                    const zonaValor = (di) => {
                      const v = preciosGrupo[`dis_g${i}_p0_z${di}`];
                      if(v!==undefined && v!==null && v!=="") return v;
                      if(!multiZona && preciosGrupo[`dis_g${i}_p0`]) return preciosGrupo[`dis_g${i}_p0`];
                      return "";
                    };
                    const totalZona=designs.reduce((a,_,di)=>a+(parseFloat(zonaValor(di))||0),0);
                    const setZonaPrecio = (di, val) => {
                      setPreciosGrupo(prev=>{
                        const next = {...prev, [`dis_g${i}_p0_z${di}`]: val};
                        return next;
                      });
                    };
                    // Autocompletar precio de arte por zona — misma fórmula que usa configurador.html
                    const autoFillZonaPrecio = (di, d) => {
                      if(parseFloat(zonaValor(di))>0) return;
                      const est = estimarPrecioZona(d.tecnica, d.medidas);
                      if(est>0) setZonaPrecio(di, String(est));
                    };
                    return(
                      <div style={{marginTop:"10px",background:"rgba(74,154,250,.06)",border:"1.5px solid rgba(74,154,250,.15)",borderRadius:"8px",padding:"10px 12px"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
                          <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:800,color:"var(--c-info)",textTransform:"uppercase",letterSpacing:"1px"}}>✏️ Precio por zona</div>
                          {totalZona>0&&<span style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,color:"var(--c-success)"}}>${totalZona.toFixed(2)}/pza total</span>}
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                          {designs.map((d,di)=>(
                            <div key={di} style={{display:"flex",alignItems:"center",gap:"8px"}}>
                              {d.src && <img src={d.src} style={{width:"26px",height:"26px",objectFit:"contain",borderRadius:"4px",border:"1px solid var(--c-border)",flexShrink:0,background:"#fff"}}/>}
                              <div style={{flex:1,display:"flex",alignItems:"center",gap:"6px",minWidth:0}}>
                                <div style={{width:"6px",height:"6px",borderRadius:"50%",background:"var(--c-danger)",flexShrink:0}}/>
                                <span style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:800,color:"var(--c-text2)",textTransform:"uppercase"}}>{d.zonaLabel||d.zonaId}</span>
                                {d.tecnica&&<span style={{fontSize:"11px",background:"rgba(214,32,32,.15)",color:"var(--c-danger)",padding:"2px 7px",borderRadius:"3px",fontFamily:"var(--fh)",fontWeight:700,textTransform:"uppercase"}}>{d.tecnica}</span>}
                              </div>
                              <div style={{display:"flex",alignItems:"center",gap:"4px",flexShrink:0}}>
                                <span style={{fontSize:"12px",color:"var(--c-text3)"}}>$</span>
                                <input className="ai" type="number" min="0" step="0.01" placeholder="0.00"
                                  value={zonaValor(di)}
                                  onFocus={()=>autoFillZonaPrecio(di, d)}
                                  onChange={e=>setZonaPrecio(di, e.target.value)}
                                  style={{width:"95px",padding:"6px 7px",fontSize:"14px",textAlign:"right",fontFamily:"var(--fh)",fontWeight:800}}/>
                              </div>
                            </div>
                          ))}
                          {multiZona&&totalZona>0&&(
                            <div style={{display:"flex",justifyContent:"flex-end",paddingTop:"4px",borderTop:"1px solid var(--c-border)",marginTop:"2px"}}>
                              <span style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,color:"var(--c-info)"}}>Total: ${totalZona.toFixed(2)}/pza</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}

          {/* ── BOTONES AGREGAR GRUPO DESDE VISTA PRINCIPAL ── */}
          <div style={{display:"flex",gap:"8px",margin:"8px 0 14px",flexWrap:"wrap"}}>
            <button onClick={function(){
              var idx = (cot.grupos||[]).length;
              var letra = String.fromCharCode(65+idx);
              setNombreNuevoGrupo("Diseño "+letra);
              setModalNuevoGrupo(true);
            }} style={{padding:"7px 16px",background:"rgba(74,154,250,.1)",border:"1.5px dashed rgba(74,154,250,.35)",borderRadius:"8px",color:"var(--c-info)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,textTransform:"uppercase",cursor:"pointer",letterSpacing:".5px"}}>
              + Nuevo Grupo
            </button>
          </div>

          {/* MODAL NOMBRE NUEVO GRUPO */}
          {modalNuevoGrupo&&(
            <div style={{position:"fixed",inset:0,zIndex:700,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}
              onClick={function(e){ if(e.target===e.currentTarget) setModalNuevoGrupo(false); }}>
              <div style={{background:"var(--bg-card)",border:"1.5px solid var(--border)",borderRadius:"14px",padding:"28px 24px",width:"100%",maxWidth:"400px",boxShadow:"0 24px 60px rgba(0,0,0,.4)"}}>
                <div style={{fontFamily:"var(--fh)",fontSize:"18px",fontWeight:900,textTransform:"uppercase",color:"var(--text-primary)",marginBottom:"6px"}}>Nuevo Grupo</div>
                <div style={{fontSize:"12px",color:"var(--text-muted)",marginBottom:"18px"}}>Divide tus artículos por diseño o tipo de prenda.</div>
                <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:"1px",color:"var(--text-muted)",marginBottom:"6px"}}>Nombre del grupo</div>
                <input autoFocus className="ai" value={nombreNuevoGrupo}
                  onChange={function(e){ setNombreNuevoGrupo(e.target.value); }}
                  onKeyDown={function(e){
                    if(e.key==="Enter") document.getElementById("btn-crear-grupo").click();
                    if(e.key==="Escape") setModalNuevoGrupo(false);
                  }}
                  placeholder="Ej: Logo A, Camisas equipo, Gorras..."
                  style={{width:"100%",marginBottom:"18px",padding:"10px 12px",fontSize:"14px"}}/>
                <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",flexWrap:"wrap"}}>
                  <button onClick={function(){ setModalNuevoGrupo(false); }}
                    style={{padding:"9px 18px",background:"transparent",border:"1.5px solid var(--border)",borderRadius:"8px",color:"var(--text-muted)",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:700,cursor:"pointer"}}>
                    Cancelar
                  </button>
                  <button id="btn-crear-grupo" onClick={function(){
                    var nombre = (nombreNuevoGrupo||"").trim() || ("Diseño "+String.fromCharCode(65+(cot.grupos||[]).length));
                    var nuevoGrupo = {nombre:nombre,modo:"mockup",shapeCat:"camisa",prendas:[],designs:[]};
                    var updated = {...cot,grupos:[...(cot.grupos||[]),nuevoGrupo],leida:true};
                    onUpdate(updated); sbSaveCotCompleta(updated);
                    setLocalGrupos([...(cot.grupos||[]),nuevoGrupo]);
                    setModalNuevoGrupo(false);
                    setNombreNuevoGrupo("");
                  }}
                  style={{padding:"9px 22px",background:"var(--lana-purple)",border:"none",borderRadius:"8px",color:"white",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,textTransform:"uppercase",cursor:"pointer",letterSpacing:".5px"}}>
                    Crear grupo
                  </button>
                </div>
              </div>
            </div>
          )}

          {cot.notas && (
            <>
              <div className="section-title" style={{marginTop:"14px"}}>Notas del cliente</div>
              <div className="cot-info-card" style={{marginBottom:"14px"}}>
                <div style={{fontSize:"13px",color:"var(--c-text)",whiteSpace:"pre-wrap"}}>{cot.notas}</div>
              </div>
            </>
          )}

          </div>
          <div style={{display:cotTab==="extras"?"block":"none"}}>
          {/* ── PRECIOS POR PRENDA (movido desde Productos) ── */}
          {(cot.grupos||[]).map(function(g,i){
            if(!(g.prendas||[]).length) return null;
            const bN2 = function(p){ const prod2=findProdParaPrenda(p, prods); return (brands.find(function(b){return b.id===(prod2?.brand||p.marca);})?.name||""); };
            return(
              <div key={g.id||i} style={{border:"1.5px solid var(--c-border)",borderRadius:"10px",overflow:"hidden",marginBottom:"12px"}}>
                <div style={{padding:"8px 12px",background:"var(--c-surface2)",borderBottom:"1px solid var(--c-border)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:900,textTransform:"uppercase",color:"var(--c-text2)",letterSpacing:".5px"}}>
                  🧾 {g.nombre||("Grupo "+(i+1))} — Precios
                </div>
                <div style={{padding:"8px 12px"}}>
                  <div className="cot-tbl-scroll">
                  <div className="cot-tbl-row5" style={{display:"grid",gridTemplateColumns:"1fr 44px 90px 90px 90px",gap:"4px 8px",padding:"4px 0 6px",borderBottom:"1px solid var(--c-border)",marginBottom:"6px"}}>
                    {["Prenda","Pzs","🎽 Prenda","✏ Arte","Total"].map(function(h,k){return(
                      <div key={k} style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:"var(--c-text3)",textAlign:k>0?"right":"left"}}>{h}</div>
                    );})}
                  </div>
                  {(g.prendas||[]).map(function(p,pi){
                    const pk="g"+i+"_p"+pi;
                    const pu=parseFloat(preciosGrupo[pk]||"")||0;
                    // Precio de arte: SOLO LECTURA aquí — se edita en el tab Productos → "Precio por zona"
                    const du = getDu(g, i, pi);
                    const total=(pu+du)*(parseInt(p.cantidad)||0);
                    const prod2=findProdParaPrenda(p, prods);
                    const autoFillPrenda = function(){
                      if(pu>0) return;
                      if(!prod2) return;
                      let escalas=[];
                      if(Array.isArray(prod2.escalas)) escalas=prod2.escalas;
                      else if(prod2.escalas&&typeof prod2.escalas==="object"){
                        const map=[["p1_5",1,5],["p6_20",6,20],["p21_50",21,50],["p51_100",51,100],["p101",101,null]];
                        escalas=map.filter(function([k]){return prod2.escalas[k];}).map(function([k,mn,mx]){return {min:mn,max:mx,precio:prod2.escalas[k]};});
                      }
                      const totalGrupo=(g.prendas||[]).reduce(function(a,pp){return a+(parseInt(pp.cantidad)||0);},0);
                      const sortedE=[...escalas].sort(function(a,b){return (parseInt(a.min)||1)-(parseInt(b.min)||1);});
                      let idx=sortedE.findIndex(function(e){const mn=parseInt(e.min)||1,mx=e.max===null?Infinity:parseInt(e.max);return totalGrupo>=mn&&totalGrupo<=mx;});
                      if(idx===-1) idx=sortedE.length-1;
                      let precio=0;
                      if(p.variant&&prod2.varPrices){
                        const vpKey=prod2.varPrices[p.variant]?p.variant:Object.keys(prod2.varPrices).find(function(k){return k.toLowerCase()===(p.variant||"").toLowerCase();});
                        if(vpKey){const vp=prod2.varPrices[vpKey];if(Array.isArray(vp)&&vp[idx]) precio=parseFloat(vp[idx].precio)||0;}
                      }
                      if(!precio) precio=parseFloat(sortedE[idx]?.precio)||0;
                      if(!precio && prod2.desde) precio=parseFloat(prod2.desde)||0;
                      if(precio>0) setPreciosGrupo(function(prev){return {...prev,[pk]:String(precio)};});
                    };
                    return(
                      <div key={pk} className="cot-tbl-row5" style={{display:"grid",gridTemplateColumns:"1fr 44px 90px 90px 90px",gap:"4px 8px",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
                        <div style={{minWidth:0,overflow:"hidden"}}>
                          <div style={{fontFamily:"var(--fh)",fontSize:"12px",fontWeight:900,color:"var(--c-text)",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                            {bN2(p)&&<span style={{color:"var(--c-text2)",fontWeight:700,fontSize:"11px"}}>{bN2(p)} </span>}{p.modelo}
                          </div>
                          <div style={{fontSize:"11px",color:"var(--c-text2)"}}>{p.color}{p.size?` · T.${p.size}`:""}{p.variant&&p.variant!==p.size?` · ${p.variant}`:""}</div>
                        </div>
                        <div style={{fontFamily:"var(--fh)",fontSize:"15px",fontWeight:900,textAlign:"right",color:pu>0?"var(--c-success)":"var(--c-text2)"}}>{p.cantidad}</div>
                        {/* Precio de prenda — SOLO LECTURA, se edita en tab Productos */}
                        <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:"3px",fontSize:"12px",color:pu>0?"var(--c-success)":"var(--c-text3)",fontFamily:"var(--fh)",fontWeight:700}} title="Editar en tab Productos">
                          <span style={{fontSize:"11px"}}>🎽$</span>{pu>0?pu.toFixed(2):"—"}
                        </div>
                        {/* Precio de arte — SOLO LECTURA, se edita en tab Productos */}
                        <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:"3px",fontSize:"12px",color:du>0?"var(--c-info)":"var(--c-text3)",fontFamily:"var(--fh)",fontWeight:700}} title="Editar en tab Productos → Precio por zona">
                          <span style={{fontSize:"11px"}}>✏$</span>{du>0?du.toFixed(2):"—"}
                        </div>
                        <div style={{fontFamily:"var(--fh)",fontSize:"14px",fontWeight:900,color:total>0?"var(--c-success)":"var(--c-text3)",textAlign:"right"}}>
                          {total>0?`$${total.toLocaleString("es-MX",{minimumFractionDigits:2})}`:"—"}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              </div>
            );
          })}
          {/* TOTAL GENERAL */}
          {(cot.grupos||[]).length>0 && (
            <div style={{background:"var(--c-surface2)",border:"1px solid var(--c-border)",borderRadius:"10px",overflow:"hidden",marginBottom:"14px",marginTop:"4px"}}>
              <div style={{padding:"12px 14px",borderBottom:"1px solid var(--c-border)"}}>
                <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:"1.5px",color:"var(--c-text3)",marginBottom:"10px"}}>Envío / Descuento</div>
                <div className="cot-total-row" style={{display:"grid",gridTemplateColumns:"1fr 104px 90px",gap:"6px 6px",alignItems:"center",marginBottom:"6px"}}>
                  <div style={{fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,textTransform:"uppercase",color:"var(--c-text3)"}}>Envío</div>
                  <div style={{display:"flex",alignItems:"center",gap:"2px"}}>
                    <span style={{color:"var(--c-text3)",fontSize:"11px"}}>$</span>
                    <input className="ai" type="number" min="0" step="0.01" placeholder="0.00"
                      value={precioEnvio} onChange={e=>setPrecioEnvio(e.target.value)}
                      style={{width:"100%",padding:"5px 6px",fontSize:"13px",textAlign:"right"}}/>
                  </div>
                  <div style={{fontFamily:"var(--fh)",fontSize:"13px",color:"var(--c-text2)",textAlign:"right"}}>
                    {parseFloat(precioEnvio)>0?`$${parseFloat(precioEnvio).toLocaleString("es-MX",{minimumFractionDigits:2})}`:"—"}
                  </div>
                </div>
                <div className="cot-total-row" style={{display:"grid",gridTemplateColumns:"1fr 104px 90px",gap:"6px 6px",alignItems:"center"}}>
                  <div style={{fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,textTransform:"uppercase",color:"var(--c-text3)"}}>Descuento</div>
                  <div style={{display:"flex",alignItems:"center",gap:"2px"}}>
                    <span style={{color:"var(--c-text3)",fontSize:"11px"}}>$</span>
                    <input className="ai" type="number" min="0" step="0.01" placeholder="0.00"
                      value={descuento} onChange={e=>setDescuento(e.target.value)}
                      style={{width:"100%",padding:"5px 6px",fontSize:"13px",textAlign:"right"}}/>
                  </div>
                  <div style={{fontFamily:"var(--fh)",fontSize:"13px",color:"var(--c-warning)",textAlign:"right"}}>
                    {parseFloat(descuento)>0?`-$${parseFloat(descuento).toLocaleString("es-MX",{minimumFractionDigits:2})}`:"—"}
                  </div>
                </div>
              </div>
              {(()=>{
                const gTots=(cot.grupos||[]).map((g,gi)=>({
                  nombre:g.nombre||`Grupo ${gi+1}`,
                  sub:(g.prendas||[]).reduce((a,p,pi)=>{
                    const pk=`g${gi}_p${pi}`;
                    return a+((parseFloat(preciosGrupo[pk]||0)||0)+getDu(g,gi,pi))*(parseInt(p.cantidad)||0);
                  },0),
                }));
                const sub=gTots.reduce((a,g)=>a+g.sub,0);
                const serviciosSub=(serviciosArte||[]).reduce((a,s)=>a+(s.subtotal||0),0);
                if(!sub && !serviciosSub) return null;
                const baseTotal=sub+serviciosSub+(parseFloat(precioEnvio)||0)-(parseFloat(descuento)||0);
                const ivaAmt=conIVA?baseTotal*0.16:0;
                const total=baseTotal+ivaAmt;
                const fmt=n=>`$${Number(n).toLocaleString("es-MX",{minimumFractionDigits:2})}`;
                return(
                  <div style={{padding:"10px 14px 0"}}>
                    {gTots.filter(g=>g.sub>0).map((g,k)=>(
                      <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                        <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,color:"var(--c-text3)",textTransform:"uppercase"}}>{g.nombre}</div>
                        <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,color:"var(--c-text3)"}}>{fmt(g.sub)}</div>
                      </div>
                    ))}
                    {serviciosSub>0&&(
                      <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                          <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,color:"var(--c-text3)",textTransform:"uppercase"}}>Servicios de Arte</div>
                          <span style={{background:"var(--c-surface3)",color:"var(--c-text2)",fontSize:"11px",padding:"1px 6px",borderRadius:"999px",fontFamily:"var(--fh)",fontWeight:800,letterSpacing:".05em"}}>MAQUILA</span>
                        </div>
                        <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,color:"var(--c-text3)"}}>{fmt(serviciosSub)}</div>
                      </div>
                    )}
                    {conIVA&&(
                      <>
                        <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 2px",borderTop:"1px solid rgba(255,255,255,.07)",marginTop:"4px"}}>
                          <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,color:"var(--c-text3)",textTransform:"uppercase"}}>Subtotal</div>
                          <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:700,color:"var(--c-text3)"}}>{fmt(baseTotal)}</div>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",padding:"2px 0 4px"}}>
                          <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,color:"var(--c-purple-lt)",textTransform:"uppercase"}}>IVA 16%</div>
                          <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:700,color:"var(--c-purple-lt)"}}>{fmt(ivaAmt)}</div>
                        </div>
                      </>
                    )}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0 8px",borderTop:"1px solid rgba(255,255,255,.07)",marginTop:"4px"}}>
                      <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,textTransform:"uppercase",color:"var(--c-text3)"}}>{conIVA?"Total (con IVA)":"Total estimado"}</div>
                      <div style={{fontFamily:"var(--fh)",fontSize:"26px",fontWeight:900,color:"var(--c-success)"}}>{fmt(total)}</div>
                    </div>
                  </div>
                );
              })()}

            </div>
          )}

          {/* SERVICIOS DE ARTE / MAQUILA */}
          {typeof ServiciosArteEditor !== 'undefined' && (
            <ServiciosArteEditor
              tenantId={MY_TENANT_ID}
              value={serviciosArte}
              onChange={setServiciosArte}
              colorPrenda={(()=>{
                const g=(cot.grupos||[])[0];
                const p=(g&&g.prendas&&g.prendas[0]);
                return (p&&p.colorHex)||"#c8b89a";
              })()}
            />
          )}

          {/* COMPROBANTE DE PAGO — depósito/efectivo reportado por el cliente */}
          {(cot.comprobante_url || cot.referencia_pago) && (
            <div style={{background:"var(--c-surface2)",border:"1px solid var(--c-border)",borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
              <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:"1.5px",color:"var(--c-text2)",marginBottom:"10px"}}>
                🧾 Comprobante de pago — {cot.metodo_pago==="deposito"?"Depósito":cot.metodo_pago==="efectivo"?"Efectivo":cot.metodo_pago}
              </div>
              {cot.referencia_pago && (
                <div style={{fontSize:"12px",color:"var(--c-text2)",marginBottom:cot.comprobante_url?"10px":"0"}}>
                  Referencia: <strong>{cot.referencia_pago}</strong>
                </div>
              )}
              {cot.comprobante_url && (
                cot.comprobante_url.indexOf("application/pdf")>=0 ? (
                  <a href={cot.comprobante_url} target="_blank" rel="noopener" className="btn-n" style={{display:"inline-flex",alignItems:"center",gap:"6px"}}>
                    📄 Ver comprobante (PDF)
                  </a>
                ) : (
                  <a href={cot.comprobante_url} target="_blank" rel="noopener" style={{display:"block"}}>
                    <img src={cot.comprobante_url} alt="Comprobante de pago" style={{maxWidth:"100%",maxHeight:"280px",borderRadius:"7px",border:"1px solid var(--c-border)",display:"block",cursor:"zoom-in"}}/>
                  </a>
                )
              )}
            </div>
          )}

          {/* ORDEN DE TRABAJO */}
          <div style={{background:"var(--c-surface2)",border:`1px solid ${otInfo?"var(--c-purple-bd)":"var(--c-border)"}`,borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
              <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:"1.5px",color:otInfo?"var(--c-success)":"var(--c-text2)"}}>
                📋 Orden de Trabajo
              </div>
              {otInfo && (function(){
                // Usa el mismo estado (aceptada/produccion/listo/entregada/
                // rechazada) que ots.jsx — antes esta píldora solo distinguía
                // aceptada/rechazada y todo lo demás caía en "Pendiente de
                // aceptación", que ya no aplica desde que la OT nace aceptada.
                var st = (typeof ESTADO_OT!=="undefined" && ESTADO_OT[otInfo.estado]) || {label:otInfo.estado, color:"var(--c-warning)", bg:"var(--c-warning-bg)"};
                return (
                  <div style={{display:"flex",alignItems:"center",gap:"6px",background:st.bg,border:`1px solid ${st.color}`,borderRadius:"5px",padding:"3px 10px"}}>
                    <div style={{width:"6px",height:"6px",borderRadius:"50%",background:st.color}}/>
                    <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:st.color}}>
                      {otInfo.estado==="aceptada"?"Aceptada por cliente":st.label}
                    </span>
                  </div>
                );
              })()}
            </div>

            {!otInfo ? (
              <div>
                {!cotConfirmadaOAdelante ? (
                  <div style={{fontSize:"12px",color:"var(--c-text3)",fontStyle:"italic",padding:"4px 0"}}>
                    Todavía no se puede generar la OT — primero confirma precios y habilita el pago con el botón de abajo.
                  </div>
                ) : (
                  <>
                    <div style={{fontSize:"12px",color:"var(--c-text2)",marginBottom:"10px"}}>
                      Genera una Orden de Trabajo para que el cliente la revise y acepte digitalmente por WhatsApp o Email.
                    </div>
                    <div style={{background:"var(--c-warning-bg)",border:"1px solid rgba(251,191,36,.2)",borderRadius:"6px",padding:"8px 12px",marginBottom:"10px",fontSize:"11px",color:"var(--c-warning)",display:"flex",alignItems:"center",gap:"6px"}}>
                      ⚠️ Solo se puede crear <strong>una OT por cotización</strong>. Si ya existe, se cargará la existente.
                    </div>

                    {pagoPendienteDeRevisar && (
                      <div style={{background:"var(--c-info-bg)",border:"1px solid var(--c-info-bd)",borderRadius:"8px",padding:"10px 12px",marginBottom:"10px"}}>
                        <div style={{fontSize:"12px",color:"var(--c-info)",marginBottom:"8px"}}>
                          El cliente reportó su pago ({cot.metodo_pago==="deposito"?"depósito":"efectivo"}). Revisa el comprobante de arriba y confirma para generar la OT automáticamente.
                        </div>
                        <button onClick={confirmarPagoRecibido} disabled={confirmandoPago}
                          style={{width:"100%",padding:"9px",background:"var(--c-success-bg)",border:"1.5px solid var(--c-success-bd)",borderRadius:"7px",color:"var(--c-success)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:900,textTransform:"uppercase",cursor:confirmandoPago?"wait":"pointer",letterSpacing:".4px"}}>
                          {confirmandoPago?"⏳ Confirmando...":"✔ Confirmar pago recibido"}
                        </button>
                      </div>
                    )}

                    {pagoVerificadoPasarela && (
                      <div style={{fontSize:"11px",color:"var(--c-success)",marginBottom:"10px"}}>
                        ✅ Pago verificado automáticamente por la pasarela — la OT se genera sola en unos segundos.
                      </div>
                    )}

                    {pidiendoMotivoOT ? (
                      <div style={{background:"var(--c-danger-bg)",border:"1px solid var(--c-danger-bd)",borderRadius:"8px",padding:"10px 12px"}}>
                        <div style={{fontSize:"11px",color:"var(--c-danger)",marginBottom:"6px",fontWeight:700}}>
                          Esta cotización no tiene un pago confirmado. Escribe el motivo de la excepción (ej. "Autorizado sin anticipo por acuerdo con el cliente"):
                        </div>
                        <textarea className="ai" rows="2" value={motivoExcepcionOT} onChange={e=>setMotivoExcepcionOT(e.target.value)} autoFocus/>
                        <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                          <button onClick={()=>{setPidiendoMotivoOT(false);setMotivoExcepcionOT("");}} className="btn-n" style={{flex:1}}>Cancelar</button>
                          <button onClick={confirmarMotivoYCrearOT} disabled={creandoOT}
                            style={{flex:1,padding:"9px",background:"var(--c-danger)",border:"none",borderRadius:"7px",color:"white",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:900,textTransform:"uppercase",cursor:creandoOT?"wait":"pointer"}}>
                            {creandoOT?"⏳ Generando...":"Confirmar excepción y crear OT"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={()=>{ if(pagoConfirmado){ crearOrdenTrabajo("manual"); } else { setPidiendoMotivoOT(true); } }} disabled={creandoOT}
                        style={{width:"100%",padding:"10px",background:"var(--c-purple-bg)",border:"1.5px solid var(--c-purple-bd)",borderRadius:"7px",color:"var(--c-purple)",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,textTransform:"uppercase",cursor:creandoOT?"wait":"pointer",letterSpacing:".5px"}}>
                        {creandoOT?"⏳ Generando...":pagoConfirmado?"📋 Crear Orden de Trabajo":"📋 Crear OT sin pago confirmado (excepción)"}
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div>
                <div style={{display:"flex",alignItems:"center",gap:"8px",background:"var(--c-surface2)",borderRadius:"6px",padding:"8px 10px",marginBottom:"10px"}}>
                  <span style={{fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,color:"var(--c-success)"}}>{otInfo.id}</span>
                  <span style={{flex:1,fontSize:"11px",color:"var(--c-text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{otUrl}</span>
                  <button onClick={()=>navigator.clipboard.writeText(otUrl).then(()=>alert("¡Enlace copiado!"))}
                    style={{background:"none",border:"1px solid var(--c-border)",borderRadius:"4px",color:"var(--c-text3)",cursor:"pointer",padding:"3px 8px",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,flexShrink:0}}>
                    Copiar URL
                  </button>
                </div>
                <div className="cot-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  <button onClick={enviarOTWhatsApp}
                    style={{padding:"9px",background:"rgba(37,211,102,.12)",border:"1.5px solid rgba(37,211,102,.3)",borderRadius:"7px",color:"#25d366",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,textTransform:"uppercase",cursor:"pointer",letterSpacing:".3px"}}>
                    💬 Enviar por WhatsApp
                  </button>
                  <button onClick={enviarOTEmail}
                    style={{padding:"9px",background:"var(--c-info-bg)",border:"1.5px solid var(--c-info-bd)",borderRadius:"7px",color:"var(--c-info)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,textTransform:"uppercase",cursor:"pointer",letterSpacing:".3px"}}>
                    ✉ Enviar por Email
                  </button>
                </div>
                {otInfo.estado==="aceptada" && (
                  <div style={{marginTop:"10px",padding:"8px 12px",background:"rgba(74,154,74,.08)",border:"1px solid rgba(74,154,74,.2)",borderRadius:"6px",fontSize:"12px",color:"var(--c-success)"}}>
                    ✅ Aceptada por: <strong>{cot.firmaNombre||"cliente"}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* NOTAS INTERNAS */}
          <div className="section-title">📝 Notas internas (solo admin)</div>
          <textarea className="ai" rows="3" value={notasAdmin} onChange={e=>setNotasAdmin(e.target.value)}
            onBlur={guardarNotas} placeholder="Notas internas: precio cotizado, seguimiento, comentarios del asesor..."/>

          {/* COMENTARIOS DEL CLIENTE — ahora viven en su propia pestaña "Mensajes" */}
          {comentarios.length>0&&(
            <div style={{marginTop:"12px",padding:"10px 14px",background:"var(--c-purple-bg)",border:"1px solid var(--c-purple-bd)",borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",cursor:"pointer"}} onClick={()=>setCotTab("mensajes")}>
              <span style={{fontSize:"12px",color:"var(--c-purple)",fontWeight:700}}>💬 {comentarios.length} mensaje{comentarios.length===1?"":"s"} con el cliente</span>
              <span style={{fontSize:"11px",color:"var(--c-purple)",fontWeight:800,textTransform:"uppercase"}}>Ver conversación →</span>
            </div>
          )}

          {/* BADGE ESTADO COT */}
          {(function(){
            var ec = cot.estado_cot||"borrador";
            var cfg = {
              borrador:   {label:"Borrador",    color:"var(--c-text3)",   bg:"var(--c-surface2)"},
              enviada:    {label:"Enviada",      color:"var(--c-info)",    bg:"var(--c-info-bg)"},
              revisada:   {label:"📋 En revisión", color:"var(--c-warning)", bg:"var(--c-warning-bg)"},
              confirmada: {label:"✅ Confirmada", color:"var(--c-success)", bg:"var(--c-success-bg)"},
              aceptada:   {label:"Aceptada",    color:"var(--c-success)", bg:"var(--c-success-bg)"},
              pagada:     pagoPendienteDeRevisar
                            ? {label:"Pagada (por confirmar)", color:"var(--c-warning)", bg:"var(--c-warning-bg)"}
                            : {label:"Pagada",       color:"var(--c-purple)",  bg:"var(--c-purple-bg)"},
              ot_generada:{label:"OT Generada", color:"var(--c-purple)",  bg:"var(--c-purple-bg)"},
            };
            var s = cfg[ec]||cfg.borrador;
            return React.createElement("div",{style:{display:"flex",alignItems:"center",gap:"6px",marginBottom:"8px"}},
              React.createElement("span",{style:{fontSize:"11px",fontWeight:800,fontFamily:"var(--fh)",textTransform:"uppercase",letterSpacing:".5px",color:"var(--c-text2)"}}, "Estado pago:"),
              React.createElement("span",{style:{fontSize:"11px",fontWeight:800,fontFamily:"var(--fh)",textTransform:"uppercase",letterSpacing:".5px",color:s.color,background:s.bg,border:"1px solid "+s.color,borderRadius:"5px",padding:"2px 8px"}}, s.label)
            );
          })()}

          {/* RECIBO DE PAGO — tarjeta verificada por Mercado Pago o Stripe */}
          {pagoVerificadoPasarela && (
            <div style={{background:"var(--c-success-bg)",border:"1px solid var(--c-success-bd)",borderRadius:"8px",padding:"10px 12px",marginBottom:"10px",fontSize:"12px",color:"var(--c-success)"}}>
              <div style={{fontWeight:800,marginBottom:"4px"}}>
                ✅ Pago verificado por {cot.metodo_pago==="tarjeta_mp"?"Mercado Pago":"Stripe"}
              </div>
              {cot.metodo_pago==="tarjeta_mp" && (
                <>
                  {cot.mp_payment_id && <div>ID de pago: <strong>{cot.mp_payment_id}</strong></div>}
                  {cot.mp_amount!=null && <div>Monto: <strong>{fmtMXN(cot.mp_amount)}</strong></div>}
                </>
              )}
              {cot.metodo_pago==="tarjeta_stripe" && (
                <>
                  {cot.stripe_session_id && <div style={{wordBreak:"break-all"}}>ID de sesión: <strong>{cot.stripe_session_id}</strong></div>}
                  {cot.stripe_amount!=null && <div>Monto: <strong>{fmtMXN(cot.stripe_amount)}</strong></div>}
                </>
              )}
            </div>
          )}

          {/* MARCAR PAGADO EN EFECTIVO — directo desde admin, sin que el
              cliente tenga que pasar por su link (ej. pagó en persona) */}
          {cotConfirmadaOAdelante && !pagoConfirmado && !pagoPendienteDeRevisar && (
            <button onClick={marcarPagoEfectivoDirecto} disabled={marcandoEfectivo}
              style={{width:"100%",padding:"9px",marginBottom:"10px",background:"var(--c-success-bg)",border:"1.5px solid var(--c-success-bd)",borderRadius:"7px",color:"var(--c-success)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:900,textTransform:"uppercase",cursor:marcandoEfectivo?"wait":"pointer",letterSpacing:".4px"}}>
              {marcandoEfectivo?"⏳ Guardando...":"💵 Marcar como pagado en efectivo"}
            </button>
          )}

          {/* ACCIONES */}
          <div className="cot-actions-row">
            <div style={{display:"flex",alignItems:"center",gap:"6px",background:"var(--c-surface2)",border:"1.5px solid var(--c-border)",borderRadius:"7px",padding:"5px 10px",cursor:"pointer"}} onClick={()=>setConIVA(v=>!v)}>
              <div style={{width:"32px",height:"17px",borderRadius:"9px",background:conIVA?"var(--c-purple)":"var(--c-border)",position:"relative",transition:"background .2s",flexShrink:0}}>
                <div style={{position:"absolute",top:"3px",left:conIVA?"17px":"3px",width:"11px",height:"11px",background:"white",borderRadius:"50%",transition:"left .2s"}}/>
              </div>
              <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:conIVA?"var(--c-purple)":"var(--c-text2)",letterSpacing:".5px"}}>IVA 16%</span>
            </div>
            <button className="btn-n" style={{background:"var(--c-text)",borderColor:"var(--c-text)",color:"#FFFFFF",fontWeight:900}} onClick={()=>{const base=window.location.origin;window.open(base+"/aceptar.html?folio="+encodeURIComponent(cot.folio)+"&tenant="+encodeURIComponent(MY_TENANT_ID||""),"_blank");}}>🔗 Ver / Aceptar</button>

            <button className="tb-btn green" onClick={waMsg}>💬 WhatsApp</button>
            <button className="tb-btn blue" onClick={mailMsg}>✉ Email</button>

          </div>
          </div>

          {/* MENSAJES CON EL CLIENTE */}
          <div style={{display:cotTab==="mensajes"?"block":"none"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
              <div className="section-title" style={{marginBottom:0}}>💬 Conversación con el cliente</div>
              <button className="btn-n" disabled={comentarios.length===0} onClick={exportarConversacionPDF}>🖨 Guardar como PDF</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"8px",maxHeight:"380px",overflowY:"auto",padding:"4px 2px",marginBottom:"14px"}}>
              {comentarios.length===0 ? (
                <div style={{color:"var(--c-text3)",fontSize:"13px",textAlign:"center",padding:"30px 0"}}>Aún no hay mensajes con el cliente.</div>
              ) : comentarios.map((c,i)=>(
                <div key={c.id||i} style={{padding:"10px 14px",background:c.autor==="admin"?"var(--c-purple-bg)":"var(--c-surface2)",border:"1px solid",borderColor:c.autor==="admin"?"var(--c-purple-bd)":"var(--c-border)",borderRadius:"8px",borderLeft:"3px solid",borderLeftColor:c.autor==="admin"?"var(--c-purple)":"var(--c-danger)",alignSelf:c.autor==="admin"?"flex-end":"flex-start",maxWidth:"85%"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:"14px",marginBottom:"3px"}}>
                    <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",color:c.autor==="admin"?"var(--c-purple)":"var(--c-danger)",letterSpacing:".5px"}}>{c.autor==="admin"?"Tú (asesor)":c.nombre||"Cliente"}</span>
                    <span style={{fontSize:"11px",color:"var(--c-text3)",whiteSpace:"nowrap"}}>{c.fecha?new Date(c.fecha).toLocaleString("es-MX",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):""}</span>
                  </div>
                  {c.texto&&<div style={{fontSize:"13px",color:"var(--c-text)",whiteSpace:"pre-wrap"}}>{c.texto}</div>}
                  {c.imagen&&<img src={c.imagen} style={{maxWidth:"180px",borderRadius:"6px",marginTop:"6px",display:"block"}}/>}
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:"8px",alignItems:"flex-end"}}>
              <textarea className="ai" rows="2" style={{flex:1}} value={replyTexto} onChange={e=>setReplyTexto(e.target.value)}
                placeholder="Escribe tu respuesta al cliente..."/>
              <button className="btn-n" style={{background:"var(--c-purple)",borderColor:"var(--c-purple)",color:"white",fontWeight:900}}
                disabled={!replyTexto.trim()||enviandoReply} onClick={enviarRespuestaComentario}>
                {enviandoReply?"Enviando...":"Enviar"}
              </button>
            </div>
            <div style={{fontSize:"11px",color:"var(--c-text3)",marginTop:"6px"}}>Al enviar, se le notifica al cliente por correo.</div>
          </div>
        </div>

        <div className="modal-footer">
          {onDelete&&<button className="btn-n" style={{color:"var(--c-danger)",borderColor:"var(--c-danger-bd)"}} onClick={()=>{if(confirm("¿Eliminar esta cotización?"))onDelete(cot.folio);}}>Eliminar</button>}
          <div style={{flex:1}}/>
          <button className="btn-n" onClick={onClose}>Cerrar</button>
          <button id="btn-guardar-todo" className="btn-primary" onClick={guardarTodo}>💾 Guardar todo</button>
          {!["confirmada","aceptada","pagada","ot_generada"].includes(cot.estado_cot)&&
            <button id="btn-confirmar-cot"
              onClick={confirmarCotizacion}
              title="Guarda todo y confirma — esto quita el letrero de 'pendiente' y deja que el cliente acepte y pague."
              style={{padding:"9px 18px",background:"var(--c-purple)",color:"white",border:"none",borderRadius:"8px",
                fontFamily:"var(--fh)",fontSize:"12px",fontWeight:900,cursor:"pointer",
                textTransform:"uppercase",letterSpacing:".3px",display:"flex",alignItems:"center",gap:"6px"}}>
              ✅ Confirmar precios y habilitar pago
            </button>
          }
        </div>
      </div>
      {/* MODAL VISUAL CATÁLOGO */}
      {modalCatOpen&&<ModalCatalogoCot
        open={modalCatOpen}
        onClose={function(){ setModalCatOpen(false); }}
        gi={modalCatGi}
        prods={prods}
        brands={brands}
        imgs={imgs}
        onConfirm={function(gi, items){
          var sc = items.length>0?(function(){ var p=prods.find(function(x){ return x.name===items[0].modelo; }); return p&&p.shapeCat?p.shapeCat:null; })():null;
          setLocalGrupos(function(prev){
            return prev.map(function(g,i){
              if(i!==gi) return g;
              return Object.assign({},g,{prendas:(g.prendas||[]).concat(items),...(sc?{shapeCat:sc}:{})});
            });
          });
        }}
      />}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════
// MODAL VISUAL CATÁLOGO — para agregar prendas desde cotización
// ══════════════════════════════════════════════════════════════
function calcPrecioUnitCot(prod, qty, variant, size){
  if(!prod) return null;
  var escalas = [];
  if(Array.isArray(prod.escalas)) escalas = prod.escalas.filter(function(e){ return e.precio; });
  else if(prod.escalas && typeof prod.escalas === "object"){
    var _map=[["p1_5",1,5],["p6_20",6,20],["p21_50",21,50],["p51_100",51,100],["p101",101,null]];
    _map.forEach(function(m){ if(prod.escalas[m[0]]) escalas.push({min:m[1],max:m[2],precio:prod.escalas[m[0]]}); });
  }
  if(!escalas.length) return prod.desde ? parseFloat(prod.desde) : null;
  var sorted = escalas.slice().sort(function(a,b){ return (parseInt(a.min)||1)-(parseInt(b.min)||1); });
  var q = parseInt(qty)||1;
  var idx = sorted.findIndex(function(e){ var mn=parseInt(e.min)||1, mx=e.max===null||e.max===undefined?null:parseInt(e.max); return q>=mn&&(mx===null||q<=mx); });
  if(idx===-1) idx=sorted.length-1;
  var precio = 0;
  if(variant && prod.varPrices){
    var vpKey = prod.varPrices[variant] ? variant : Object.keys(prod.varPrices).find(function(k){ return k.toLowerCase()===(variant||"").toLowerCase(); });
    if(vpKey){ var vp=prod.varPrices[vpKey]; if(Array.isArray(vp)&&vp[idx]) precio=parseFloat(vp[idx].precio)||0; }
  }
  if(!precio) precio = parseFloat(sorted[idx]&&sorted[idx].precio)||0;
  if(precio && prod.sizeRecargos && size) precio += parseFloat(prod.sizeRecargos[size])||0;
  return precio > 0 ? precio : (prod.desde ? parseFloat(prod.desde) : null);
}

function getDesdeUnitCot(prod){
  if(!prod) return null;
  var escalas = [];
  if(Array.isArray(prod.escalas)) escalas = prod.escalas.filter(function(e){ return e.precio; });
  else if(prod.escalas && typeof prod.escalas === "object"){
    var _map=[["p1_5",1,5],["p6_20",6,20],["p21_50",21,50],["p51_100",51,100],["p101",101,null]];
    _map.forEach(function(m){ if(prod.escalas[m[0]]) escalas.push({min:m[1],max:m[2],precio:prod.escalas[m[0]]}); });
  }
  if(!escalas.length) return prod.desde ? parseFloat(prod.desde) : null;
  var precios = escalas.map(function(e){ return parseFloat(e.precio); }).filter(Boolean);
  return precios.length ? Math.min.apply(null, precios) : (prod.desde ? parseFloat(prod.desde) : null);
}

function ModalCatalogoCot({open, onClose, gi, prods, brands, imgs, onConfirm}){
  var [search,setSearch] = useState("");
  var [brandFil,setBrandFil] = useState("");
  var [prodSel,setProdSel] = useState(null);
  var [color,setColor] = useState("");
  var [variant,setVariant] = useState("");
  var [sizeQtys,setSizeQtys] = useState({});
  var [lineaFil,setLineaFil] = useState(null);
  if(!open) return null;
  var lineasDisp = [...new Set((prods||[]).filter(function(p){return !brandFil||(p.brand||String())===brandFil;}).map(function(p){ return p.linea; }).filter(Boolean))].sort();
  var prodsFiltered = (prods||[]).filter(function(p){
    if(brandFil && p.brand!==brandFil) return false;
    if(lineaFil && p.linea!==lineaFil) return false;
    if(search && !(p.name||"").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  var colorsDisp = prodSel?(prodSel.colors||[]):[];
  var variantsDisp = prodSel?(prodSel.variants||[]):[];
  var sizesDisp = prodSel?(prodSel.sizes||[]):[];
  var totalQty = Object.values(sizeQtys).reduce(function(a,v){ return a+(parseInt(v)||0); },0);
  var selProd = function(p){ setProdSel(p); setColor(""); setVariant(""); setSizeQtys({}); };
  var confirmar = function(){
    if(!prodSel||!color){ alert("Selecciona producto y color"); return; }
    var items = [];
    Object.entries(sizeQtys).forEach(function(e){
      var sz=e[0]; var q=parseInt(e[1])||0;
      if(q>0) items.push({modelo:prodSel.name,marca:prodSel.brand||"",color:color,size:sz,variant:variant||"",cantidad:q,imgUrl:prodSel.main_img||null,prodId:String(prodSel.id)});
    });
    if(!items.length){ alert("Agrega cantidad en al menos una talla"); return; }
    onConfirm(gi, items);
    setProdSel(null); setColor(""); setVariant(""); setSizeQtys({}); setSearch(""); setBrandFil("");
  };
  return(
    <div style={{position:"fixed",inset:0,zIndex:600,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}
      onClick={function(e){ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{background:"var(--bg-card)",border:"1.5px solid var(--border)",borderRadius:"16px",width:"100%",maxWidth:"860px",maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 24px 60px rgba(0,0,0,.4)"}}>
        <div style={{padding:"16px 20px",borderBottom:"1.5px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontFamily:"var(--fh)",fontSize:"18px",fontWeight:900,textTransform:"uppercase",color:"var(--text-primary)"}}>Agregar Prenda</div>
            <div style={{fontSize:"11px",color:"var(--text-muted)",marginTop:"2px"}}>Selecciona producto, color y tallas</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"1.5px solid var(--border)",borderRadius:"7px",color:"var(--text-muted)",width:"32px",height:"32px",cursor:"pointer",fontSize:"14px"}}>✕</button>
        </div>
        <div className="cot-catbody" style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>
          <div className="cot-catleft" style={{width:"55%",borderRight:"1.5px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",display:"flex",gap:"8px",flexShrink:0}}>
              <input value={search} onChange={function(e){ setSearch(e.target.value); }} placeholder="Buscar..." className="ai" style={{flex:1,padding:"7px 10px",fontSize:"12px"}}/>
              <select value={brandFil} onChange={function(e){ setBrandFil(e.target.value); }} className="ai" style={{padding:"7px 8px",fontSize:"12px",minWidth:"100px"}}>
                <option value="">Todas las marcas</option>
                {(brands||[]).map(function(b){ return <option key={b.id} value={b.id}>{b.name}</option>; })}
              </select>
            </div>
            {!lineaFil ? (
              <div style={{flex:1,overflow:"auto",padding:"12px"}}>
                <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:".1em",color:"var(--text-muted)",marginBottom:"10px"}}>Línea</div>
                <div className="cot-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  {lineasDisp.map(function(ln){
                    var count = (prods||[]).filter(function(p){ return p.linea===ln && (!brandFil||p.brand===brandFil); }).length;
                    var lineaImg=(function(){var p=(prods||[]).find(function(x){return (x.linea||String()).toLowerCase()===(ln||String()).toLowerCase();});if(!p)return null;return (imgs&&imgs[p.id])||(p.imgs&&p.imgs[0]&&p.imgs[0].src)||null;})();
                    return (
                      <button key={ln} onClick={function(){ setLineaFil(ln); setProdSel(null); setColor(""); setVariant(""); setSizeQtys({}); }}
                        style={{padding:"10px",borderRadius:"10px",border:"1.5px solid var(--c-border)",background:"var(--c-surface2)",cursor:"pointer",textAlign:"left",fontFamily:"var(--fh)",display:"flex",flexDirection:"column",gap:"6px"}}>
                        {lineaImg&&(
                          <div style={{width:"100%",height:"120px",borderRadius:"6px",overflow:"hidden",background:"var(--c-surface3)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                            <img src={lineaImg} alt={ln} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
                          </div>
                        )}
                        <div style={{fontSize:"13px",fontWeight:800,color:"var(--c-text)",textTransform:"uppercase"}}>{ln}</div>
                        <div style={{fontSize:"11px",color:"var(--c-text3)"}}>{count} producto{count!==1?"s":""}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{flex:1,overflow:"auto",padding:"12px"}}>
                <button onClick={function(){ setLineaFil(null); setProdSel(null); setColor(""); setVariant(""); setSizeQtys({}); }}
                  style={{marginBottom:"10px",padding:"5px 12px",borderRadius:"6px",border:"1.5px solid var(--border)",background:"none",cursor:"pointer",color:"var(--text-muted)",fontFamily:"var(--fh)",fontSize:"11px",display:"flex",alignItems:"center",gap:"5px"}}>
                  {"← "}{lineaFil}
                </button>
                {prodsFiltered.length===0 ? (
                  <div style={{color:"var(--text-muted)",fontSize:"13px",padding:"20px",textAlign:"center"}}>Sin productos</div>
                ) : prodsFiltered.map(function(p){
                  var img = (imgs&&imgs[p.id])||p.main_img||null;
                  return (
                    <div key={p.id} onClick={function(){ selProd(p); }}
                      style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 10px",borderRadius:"8px",cursor:"pointer",marginBottom:"4px",
                        background:prodSel&&prodSel.id===p.id?"var(--c-purple-bg)":"transparent",
                        border:prodSel&&prodSel.id===p.id?"1.5px solid var(--lana-purple)":"1.5px solid transparent"}}>
                      <div style={{width:"40px",height:"40px",borderRadius:"6px",overflow:"hidden",flexShrink:0,background:"var(--bg-muted)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {img ? <img src={img} style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{fontSize:"20px"}}>{"👕"}</span>}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontFamily:"var(--fh)",fontSize:"12px",fontWeight:800,color:"var(--text-primary)",textTransform:"uppercase",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                        {p.variants&&p.variants.length>0&&<div style={{fontSize:"11px",color:"var(--text-muted)"}}>{p.variants.join(" · ")}</div>}
                    {(function(){ var _dp=getDesdeUnitCot(p); return _dp ? <div style={{fontSize:"11px",color:"var(--c-purple)",fontFamily:"var(--fh)",fontWeight:700,marginTop:"2px"}}>Desde ${_dp.toFixed(2)}<span style={{fontWeight:400,color:"var(--c-text3)",fontSize:"11px"}}>/pza</span></div> : null; })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {!prodSel?(
              <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:"10px",color:"var(--text-muted)"}}>
                <span style={{fontSize:"36px"}}>{"👈"}</span>
                <span style={{fontSize:"13px"}}>Selecciona un producto</span>
              </div>
            ):(
              <div style={{flex:1,overflow:"auto",padding:"14px"}}>
                <div style={{fontFamily:"var(--fh)",fontSize:"15px",fontWeight:900,textTransform:"uppercase",color:"var(--text-primary)",marginBottom:"14px"}}>{prodSel.name}</div>
              {(function(){ var _pu=calcPrecioUnitCot(prodSel, totalQty||1, variant, ""); return _pu ? <div style={{fontSize:"13px",color:"var(--c-purple)",fontFamily:"var(--fh)",fontWeight:700,marginTop:"-10px",marginBottom:"12px"}}>${_pu.toFixed(2)}/pza<span style={{fontWeight:400,color:"var(--c-text3)",fontSize:"11px"}}> · {totalQty||1} pieza{(totalQty||1)!==1?"s":""}</span></div> : null; })()}
                {variantsDisp.length>0&&(
                  <div style={{marginBottom:"12px"}}>
                    <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:".1em",color:"var(--lana-purple)",marginBottom:"6px"}}>Modelo</div>
                    <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                      {variantsDisp.map(function(v){
                        return <button key={v} onClick={function(){ setVariant(v); setColor(""); setSizeQtys({}); }}
                          style={{padding:"5px 10px",borderRadius:"6px",border:"1.5px solid "+(variant===v?"var(--lana-purple)":"var(--border)"),background:variant===v?"var(--lana-purple-ghost)":"var(--bg-muted)",color:variant===v?"var(--lana-purple)":"var(--text-secondary)",fontFamily:"var(--fh)",fontSize:"11px",fontWeight:700,cursor:"pointer"}}>{v}</button>;
                      })}
                    </div>
                  </div>
                )}
                {colorsDisp.length>0&&(
                  <div style={{marginBottom:"12px"}}>
                    <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:".1em",color:"var(--lana-purple)",marginBottom:"8px"}}>Color</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(72px,1fr))",gap:"6px",maxHeight:"260px",overflowY:"auto",padding:"2px"}}>
                      {colorsDisp.map(function(c){
                        // Buscar imagen por variante de color
                        var colorKey = (variant||"")+"_"+c;
                        var imgSrc = (imgs&&prodSel&&(imgs[prodSel.id+"_"+c]||imgs[prodSel.id+"_"+colorKey]||imgs[prodSel.id]||prodSel.main_img))||null;
                        var sel = color===c;
                        return(
                          <button key={c} onClick={function(){ setColor(c); setSizeQtys({}); }} title={c}
                            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"4px",padding:"6px 4px",borderRadius:"8px",
                              border:"1.5px solid "+(sel?"var(--lana-purple)":"var(--border)"),
                              background:sel?"var(--lana-purple-ghost)":"var(--bg-muted)",
                              cursor:"pointer",transition:"all .15s",minWidth:0}}>
                            {imgSrc
                              ? <img src={imgSrc} alt={c} loading="lazy" style={{width:"52px",height:"52px",objectFit:"contain",borderRadius:"5px",background:"#fff",padding:"2px"}}/>
                              : <div style={{width:"52px",height:"52px",borderRadius:"5px",background:"var(--bg-card,#eee)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px"}}>{"🎨"}</div>
                            }
                            <span style={{fontSize:"10px",fontWeight:700,color:sel?"var(--lana-purple)":"var(--text-secondary)",textAlign:"center",lineHeight:1.2,wordBreak:"break-word",fontFamily:"var(--fh)",maxWidth:"68px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {color&&sizesDisp.length>0&&(
                  <div style={{marginBottom:"14px"}}>
                    <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:".1em",color:"var(--lana-purple)",marginBottom:"8px"}}>Tallas y cantidades</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(80px,1fr))",gap:"6px"}}>
                      {sizesDisp.map(function(s){
                        var q=parseInt(sizeQtys[s])||0;
                        return(
                          <div key={s} style={{background:"var(--bg-muted)",border:"1.5px solid "+(q>0?"var(--lana-purple)":"var(--border)"),borderRadius:"8px",padding:"8px",textAlign:"center"}}>
                            <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,color:"var(--text-secondary)",marginBottom:"5px"}}>{s}</div>
                            <div style={{display:"flex",alignItems:"center",gap:"3px",justifyContent:"center"}}>
                              <button onClick={function(){ setSizeQtys(function(prev){ var n=Object.assign({},prev); n[s]=Math.max(0,(parseInt(n[s])||0)-1); if(!n[s]) delete n[s]; return n; }); }}
                                style={{width:"22px",height:"22px",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:"4px",cursor:"pointer",color:"var(--text-secondary)",fontSize:"14px",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900}}>{"−"}</button>
                              <input type="number" min="0" value={q||""} placeholder="0"
                                onChange={function(e){ var v=parseInt(e.target.value)||0; setSizeQtys(function(prev){ var n=Object.assign({},prev); if(v>0) n[s]=v; else delete n[s]; return n; }); }}
                                style={{width:"32px",textAlign:"center",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:"4px",color:"var(--text-primary)",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:800,padding:"2px",outline:"none"}}/>
                              <button onClick={function(){ setSizeQtys(function(prev){ return Object.assign({},prev,{[s]:(parseInt(prev[s])||0)+1}); }); }}
                                style={{width:"22px",height:"22px",background:"var(--lana-purple)",border:"none",borderRadius:"4px",cursor:"pointer",color:"white",fontSize:"14px",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900}}>{"+"}</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <button onClick={confirmar} disabled={!color||totalQty===0}
                  style={{width:"100%",padding:"12px",background:(!color||totalQty===0)?"var(--bg-muted)":"linear-gradient(135deg,var(--c-purple),var(--c-purple-lt))",border:"none",borderRadius:"10px",color:(!color||totalQty===0)?"var(--text-muted)":"white",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,textTransform:"uppercase",cursor:(!color||totalQty===0)?"not-allowed":"pointer",letterSpacing:".06em",boxShadow:(!color||totalQty===0)?"none":"0 4px 14px var(--lana-purple-glow)"}}>
                  {totalQty>0?("+ Agregar "+totalQty+" pieza"+(totalQty!==1?"s":"")):"Selecciona color y talla"}
                </button>
                <button onClick={onClose}
                  style={{marginTop:"8px",width:"100%",padding:"11px",background:"none",border:"1.5px solid var(--c-border)",borderRadius:"10px",color:"var(--c-text3)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:".06em"}}>
                  ✓ Listo, cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── LÍNEAS 5098-5474 ──────────────────────────────
function Cotizaciones({cots, setCots, prods, brands, esAdmin=false, imgs={}}){
  const [search,setSearch]=useState("");
  const [filtroEstado,setFiltroEstado]=useState("all");
  const [viendo,setViendo]=useState(null);
  const [viendoTabInicial,setViendoTabInicial]=useState(null);
  const [creandoCot, setCreandoCot]=useState(false);
  const [showLimpiarModal, setShowLimpiarModal]=useState(false);
  const [verArchivadas, setVerArchivadas]=useState(false);
  const [confirmPass, setConfirmPass]=useState(null);
  const [notifNuevas, setNotifNuevas]=useState({}); // folio → {tipo, ts}

  // Si el modal de detalle está abierto y la lista se refrescó por fuera
  // (ej. al volver a la pestaña, ver más abajo en admin.html), reflejarlo
  // también en el modal — si no, "viendo" se queda con los datos de cuando
  // se abrió, aunque la lista ya tenga los nuevos.
  useEffect(function(){
    if(!viendo) return;
    var fresca = cots.find(function(c){ return c.folio===viendo.folio; });
    if(fresca && fresca!==viendo) setViendo(fresca);
  },[cots]);

  // Abrir el detalle de una cotización al hacer clic en una notificación
  // del panel (ver admin.html — el bell vive en App, siempre montado, y
  // dispara este evento tras cambiar de sección hacia "cotizaciones").
  useEffect(function(){
    const onVerCot = (e)=>{
      const folio = e.detail && e.detail.folio;
      if(!folio) return;
      const c = cots.find(function(x){ return x.folio===folio; });
      if(c){ setViendoTabInicial((e.detail&&e.detail.tab)||null); setViendo(c); }
    };
    window.addEventListener("lana:ver_cotizacion", onVerCot);
    return ()=>window.removeEventListener("lana:ver_cotizacion", onVerCot);
  },[cots]);

  // ── Supabase Realtime — escuchar comentarios y estados nuevos ──
  useEffect(function(){
    if(!sb||!MY_TENANT_ID) return;
    var ch = sb.channel('cots-realtime-'+MY_TENANT_ID)
      .on('postgres_changes',{
        event:'INSERT', schema:'public', table:'cotizaciones',
        filter:'tenant_id=eq.'+MY_TENANT_ID
      }, function(payload){
        var nueva = payload.new;
        if(!nueva||!nueva.folio) return;
        setCots(function(prev){
          if(prev.some(function(c){ return c.folio===nueva.folio; })) return prev; // ya la teníamos (ej. la creó este mismo admin)
          return [dbToCot(nueva), ...prev];
        });
        setNotifNuevas(function(prev){
          return Object.assign({},prev,{[nueva.folio]:{tipo:'nueva',ts:Date.now()}});
        });
        if(window.Notification&&Notification.permission==='granted'){
          var cli = (nueva.cliente&&nueva.cliente.nombre)||nueva.folio;
          new Notification('🆕 Cotización nueva — '+cli, {
            body: (nueva.total_piezas?nueva.total_piezas+' piezas · ':'')+'Folio '+nueva.folio,
            icon: '/favicon.ico'
          });
        }
      })
      .on('postgres_changes',{
        event:'UPDATE', schema:'public', table:'cotizaciones',
        filter:'tenant_id=eq.'+MY_TENANT_ID
      }, function(payload){
        var nueva = payload.new;
        var vieja = payload.old||{};
        if(!nueva||!nueva.folio) return;
        // Detectar comentario nuevo — no confiar solo en comparar contra
        // payload.old (Supabase a veces manda esa parte incompleta según la
        // REPLICA IDENTITY de la tabla); si el conteo no ayuda, sincroniza
        // igual con lo que llegó en payload.new.
        var comentNuevos = (nueva.comentarios||[]).length;
        var comentViejos = (vieja.comentarios||[]).length;
        var cambioComentarios = JSON.stringify(nueva.comentarios||[]) !== JSON.stringify(vieja.comentarios||[]);
        if(cambioComentarios){
          if(comentNuevos > comentViejos){
            var ultimo = (nueva.comentarios||[]).slice(-1)[0];
            setNotifNuevas(function(prev){
              return Object.assign({},prev,{[nueva.folio]:{tipo:'comentario',ts:Date.now(),texto:ultimo&&ultimo.texto||''}});
            });
            // Notificación del navegador
            if(window.Notification&&Notification.permission==='granted'){
              var cli = (nueva.cliente&&nueva.cliente.nombre)||nueva.folio;
              new Notification('💬 Nuevo comentario — '+cli, {
                body: (ultimo&&ultimo.texto||'').slice(0,80),
                icon: '/favicon.ico'
              });
            }
          }
          setCots(function(prev){ return prev.map(function(c){ return c.folio===nueva.folio?Object.assign({},c,{comentarios:nueva.comentarios,mensaje_sin_leer:nueva.mensaje_sin_leer}):c; }); });
          // Si el detalle está abierto para esta cot, actualizar también viendo
          setViendo(function(prev){ return (prev&&prev.folio===nueva.folio)?Object.assign({},prev,{comentarios:nueva.comentarios,mensaje_sin_leer:nueva.mensaje_sin_leer}):prev; });
        }
        // Detectar cambio en los campos de pago (comprobante, referencia,
        // confirmación manual, recibo de la pasarela) — antes solo se
        // mergeaban comentarios/estado_cot, así que el comprobante subido
        // por el cliente nunca se veía en vivo en el modal abierto del admin,
        // solo tras recargar la página (y solo desde que dbToCot los mapea).
        var camposPago = ["metodo_pago","comprobante_url","referencia_pago","pago_confirmado_manual","fecha_confirmacion_pago","mp_payment_id","mp_amount","stripe_session_id","stripe_amount"];
        var cambioPago = camposPago.some(function(k){ return nueva[k] !== vieja[k]; });
        if(cambioPago){
          var patchPago = {};
          camposPago.forEach(function(k){ patchPago[k] = nueva[k]; });
          setCots(function(prev){ return prev.map(function(c){ return c.folio===nueva.folio?Object.assign({},c,patchPago):c; }); });
          setViendo(function(prev){ return (prev&&prev.folio===nueva.folio)?Object.assign({},prev,patchPago):prev; });
        }
        // Detectar cambio de estado
        if(nueva.estado_cot && nueva.estado_cot !== vieja.estado_cot){
          setNotifNuevas(function(prev){
            return Object.assign({},prev,{[nueva.folio]:{tipo:'estado',ts:Date.now(),estado:nueva.estado_cot}});
          });
          setCots(function(prev){ return prev.map(function(c){ return c.folio===nueva.folio?Object.assign({},c,{estado_cot:nueva.estado_cot}):c; }); });
          // Si el detalle está abierto para esta cot, actualizar también viendo
          setViendo(function(prev){ return (prev&&prev.folio===nueva.folio)?Object.assign({},prev,{estado_cot:nueva.estado_cot,firma_nombre:nueva.firma_nombre||prev.firma_nombre,fecha_aceptacion:nueva.fecha_aceptacion||prev.fecha_aceptacion}):prev; });
          if(window.Notification&&Notification.permission==='granted'){
            var labels={'aceptada':'✅ Aceptada','pagada':'💰 Pagada','correccion':'✏️ Corrección solicitada'};
            var lbl=labels[nueva.estado_cot]||nueva.estado_cot;
            new Notification(lbl+' — '+((nueva.cliente&&nueva.cliente.nombre)||nueva.folio),{icon:'/favicon.ico'});
          }
          // ── Disparo automático de OT: pago verificado por la pasarela ──
          // (tarjeta vía MercadoPago o Stripe — mp-webhook/stripe-webhook ya
          // confirmaron el cargo antes de marcar esto). Depósito/efectivo
          // siguen necesitando confirmación manual del admin (ver botón
          // "Confirmar pago recibido" en ModalCotizacion).
          if(nueva.estado_cot==="pagada" && ["tarjeta_mp","tarjeta_stripe"].includes(nueva.metodo_pago)){
            var cotFresca = dbToCot(nueva);
            crearOTDesdeCotizacion(cotFresca, prods, brands, {origen:"pago_verificado"}).then(function(resultado){
              if(!resultado || resultado.yaExistia) return;
              setCots(function(prev){ return prev.map(function(c){ return c.folio===nueva.folio?Object.assign({},c,{otId:resultado.id,otEstado:resultado.estado,otToken:resultado.token,estado_cot:"ot_generada"}):c; }); });
              setViendo(function(prev){ return (prev&&prev.folio===nueva.folio)?Object.assign({},prev,{otId:resultado.id,otEstado:resultado.estado,otToken:resultado.token,estado_cot:"ot_generada"}):prev; });
              crearOrdenSurtidoDesdeCotizacion(cotFresca, prods, brands, resultado.id);
            });
          }
        }
      })
      .subscribe();
    // Pedir permiso de notificaciones
    if(window.Notification&&Notification.permission==='default'){
      Notification.requestPermission();
    }
    return function(){ sb.removeChannel(ch); };
  // Bug: dependía de [] (una sola vez al montar). Si MY_TENANT_ID todavía
  // no estaba listo en ese primer render, el guard de arriba cancelaba
  // todo y el canal de Realtime NUNCA se armaba por el resto de la sesión
  // — de ahí que los mensajes solo se vieran al salir y volver a entrar
  // (lo que fuerza un montaje nuevo, ya con el tenant cargado).
  },[MY_TENANT_ID]);

  // Nueva cotización desde admin
  const [newCotForm, setNewCotForm]=useState({
    nombre:"", empresa:"", tel:"", email:"",
    notas:"", referencia:"",
  });

  const crearCotAdmin = async(saltar=false)=>{
    if(!saltar && !newCotForm.nombre.trim()){alert("El nombre del cliente es obligatorio.");return;}
    const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const folio = Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
    const cot = {
      folio:`BE-${folio}`,
      fecha: new Date().toISOString().slice(0,10),
      ts: Date.now(),
      estado:"nueva",
      leida:true,
      creada_por_admin:true,
      referencia: newCotForm.referencia||null,
      cliente:{
        nombre:saltar?"Sin nombre":newCotForm.nombre.trim(),
        empresa:newCotForm.empresa.trim(),
        tel:newCotForm.tel.trim(),
        email:newCotForm.email.trim(),
      },
      notas:newCotForm.notas.trim(),
      resumen:"",
      total_piezas:0,
      grupos:[],
      preciosGrupo:{},
      precioEnvio:"",
      descuento:"",
      notasAdmin:"",
    };
    setCots(prev=>[cot,...prev]);
    await sbSaveCotCompleta(cot);
    setCreandoCot(false);
    setNewCotForm({nombre:"",empresa:"",tel:"",email:"",notas:"",referencia:""});
    setViendo(cot);
  };

  const filtered = useMemo(()=>cots.filter(c=>{
    const archivada = c.archivada===true;
    if(!verArchivadas && archivada) return false;
    if(verArchivadas && !archivada) return false;
    if(!verArchivadas && filtroEstado!=="all" && (c.estado||"nueva")!==filtroEstado) return false;
    if(search){
      const s=search.toLowerCase();
      const blob = `${c.folio} ${c.cliente?.nombre||""} ${c.cliente?.empresa||""} ${c.cliente?.email||""} ${c.cliente?.tel||""}`.toLowerCase();
      if(!blob.includes(s)) return false;
    }
    return true;
  }),[cots,search,filtroEstado,verArchivadas]);

  const stats = useMemo(()=>{
    const s = {total:cots.length, nueva:0, en_proceso:0, cotizada:0, ganada:0, perdida:0, sin_leer:0, piezas:0, potencial:0, ganado:0};
    cots.forEach(c=>{
      const e = c.estado||"nueva";
      if(s[e]!==undefined) s[e]++;
      if(!c.leida) s.sin_leer++;
      s.piezas += parseInt(c.total_piezas)||0;
      const t = calcTotal(c);
      if(t){ s.potencial += t; if(e==="ganada") s.ganado += t; }
    });
    return s;
  },[cots]);

  const updateCot = (updated)=>{
    setCots(prev=>prev.map(c=>c.folio===updated.folio?updated:c));
    setViendo(updated);
    sbSaveCotCompleta(updated); // sync to Supabase
  };
  const deleteCot = (folio)=>{
    setConfirmPass({
      titulo:"Eliminar cotización",
      mensaje:`Se eliminará permanentemente la cotización #${folio}. No se puede deshacer.`,
      onConfirm: async ()=>{
        setConfirmPass(null); setViendo(null);
        // Esperar la confirmación real de Supabase antes de quitarla de la
        // lista — si el borrado falla en silencio (ej. permisos), antes
        // desaparecía igual en pantalla y volvía a aparecer en la siguiente
        // carga, lo cual parecía un bug fantasma.
        const ok = await sbDeleteCot(folio);
        if(ok) setCots(prev=>prev.filter(c=>c.folio!==folio));
      }
    });
  };

  const archivarTodas = async()=>{
    const folios = cots.filter(c=>!c.archivada).map(c=>c.folio);
    if(!folios.length) return;
    setCots(prev=>prev.map(c=>folios.includes(c.folio)?{...c,archivada:true}:c));
    if(sb){ try{ await sb.from("cotizaciones").update({archivada:true}).in("folio",folios).eq("tenant_id",MY_TENANT_ID||""); }catch(e){console.error(e);} }
    setShowLimpiarModal(false);
  };

  const eliminarTodas = ()=>{
    const folios = cots.filter(c=>!c.archivada).map(c=>c.folio);
    setConfirmPass({
      titulo:"Eliminar TODAS las cotizaciones",
      mensaje:`Se eliminarán permanentemente ${folios.length} cotizaciones de Supabase. Esta acción NO se puede deshacer.`,
      onConfirm: async ()=>{
        setShowLimpiarModal(false); setConfirmPass(null);
        const ok = await sbDeleteAllCots(folios);
        if(ok) setCots(prev=>prev.filter(c=>c.archivada));
      }
    });
  };

  const limpiarTodas = ()=>{ setShowLimpiarModal(true); };

  const abrirCot = (c)=>{
    if(!c.leida){
      const upd = {...c, leida:true};
      setCots(prev=>prev.map(x=>x.folio===c.folio?upd:x));
      setViendo(upd);
    } else {
      setViendo(c);
    }
  };

  const exportarCSV = ()=>{
    const rows = cots.map(c=>({
      folio:c.folio,
      fecha:c.fecha,
      estado:c.estado||"nueva",
      cliente:c.cliente?.nombre||"",
      empresa:c.cliente?.empresa||"",
      tel:c.cliente?.tel||"",
      email:c.cliente?.email||"",
      total_piezas:c.total_piezas||0,
      notas_cliente:c.notas||"",
      notas_internas:c.notasAdmin||"",
      resumen:c.resumen||"",
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Cotizaciones");
    const date=new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb,`cotizaciones-${date}.xlsx`);
  };

  // ── PIPELINE & ACCIONES RÁPIDAS ───────────────────────────────────
  const [vistaMode, setVistaMode] = useState("lista");

  const PIPE_COLS = [
    {id:"nueva",      label:"Nueva",      color:"var(--c-purple)", bg:"var(--c-purple-bg)"},
    {id:"en_proceso", label:"En proceso", color:"var(--c-info)", bg:"var(--c-info-bg)"},
    {id:"cotizada",   label:"Cotizada",   color:"var(--c-warning)", bg:"var(--c-warning-bg)"},
    {id:"ganada",     label:"Ganada",     color:"var(--c-success)", bg:"var(--c-success-bg)"},
    {id:"perdida",    label:"Perdida",    color:"var(--c-danger)",    bg:"var(--c-danger-bg)"},
  ];

  const cambiarEstado = (folio, nuevoEstado) => {
    var c = cots.find(function(x){ return x.folio===folio; });
    if(!c) return;
    var updated = Object.assign({}, c, {estado:nuevoEstado, leida:true});
    setCots(function(prev){ return prev.map(function(x){ return x.folio===folio?updated:x; }); });
    sbSaveCotCompleta(updated);
  };

  const buildWaLink = (c) => {
    var tel = (c.cliente&&c.cliente.tel)||"";
    var num = tel.replace(/\D/g,"");
    if(!num) return null;
    var full = num.startsWith("52") ? num : "52"+num;
    var msg = "Hola "+((c.cliente&&c.cliente.nombre)||"")+", te comparto tu cotización: https://app.get-lana.com/aceptar.html?folio="+c.folio;
    return "https://wa.me/"+full+"?text="+encodeURIComponent(msg);
  };



  return(
    <div>
      <style>{`
        @media(max-width:768px){
          .cot-catbody{flex-direction:column!important}
          .cot-catleft{width:100%!important;border-right:none!important;border-bottom:1.5px solid var(--border);max-height:38vh}
        }
        @media(max-width:480px){
          .cot-grid2{grid-template-columns:1fr!important}
          .cot-tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -4px;padding:0 4px}
          .cot-tbl-row4{min-width:380px}
          .cot-tbl-row5{min-width:460px}
          .cot-total-row{grid-template-columns:1fr 78px 74px!important;gap:4px 4px!important}
          .cot-tabbar{overflow-x:auto;-webkit-overflow-scrolling:touch}
          .cot-stickytotal{flex-wrap:wrap;row-gap:10px}
          .cot-stickytotal-inner{gap:12px!important}
        }
      `}</style>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"3px",gap:"8px",flexWrap:"wrap"}}>
        <div className="adm-title" style={{borderLeft:"4px solid var(--c-purple)",paddingLeft:"12px",marginBottom:0}}>Cotizaciones</div>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          <div style={{display:"flex",background:"var(--g2)",borderRadius:"8px",padding:"3px",gap:"2px"}}>
            {[["lista","≡ Lista"],["pipeline","⬛ Pipeline"]].map(function(item){
              var m=item[0], l=item[1];
              return(
                <button key={m} onClick={function(){ setVistaMode(m); }}
                  style={{padding:"5px 12px",borderRadius:"6px",border:"none",cursor:"pointer",
                    fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",
                    background:vistaMode===m?"var(--g1)":"transparent",
                    color:vistaMode===m?"var(--red)":"var(--mt)",
                    boxShadow:vistaMode===m?"0 1px 4px rgba(0,0,0,.1)":"none"}}>
                  {l}
                </button>
              );
            })}
          </div>
          <button onClick={function(){ setCreandoCot(true); }}
            style={{padding:"7px 16px",background:"var(--red)",border:"none",borderRadius:"7px",color:"white",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,textTransform:"uppercase",cursor:"pointer",letterSpacing:".5px",whiteSpace:"nowrap"}}>
            + Nueva Cotización
          </button>
        </div>
      </div>
      <div className="adm-sub" style={{marginBottom:"12px"}}>{cots.length} solicitudes · {stats.sin_leer} sin leer · {stats.piezas} piezas</div>

      {/* MODAL NUEVA COTIZACIÓN */}
      {creandoCot&&(
        <div className="modal-ov">
          <div className="modal-box" style={{maxWidth:"480px"}} onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-ttl">Nueva Cotización</div>
              <button className="modal-x" onClick={()=>setCreandoCot(false)}>✕</button>
            </div>
            <div className="modal-body" style={{display:"flex",flexDirection:"column",gap:"12px"}}>
              <div className="cot-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                <div className="field" style={{gridColumn:"1/-1"}}>
                  <label>Nombre del cliente *</label>
                  <input className="ai" value={newCotForm.nombre} onChange={e=>setNewCotForm(f=>({...f,nombre:e.target.value}))} placeholder="Nombre completo o razón social"/>
                </div>
                <div className="field">
                  <label>Empresa</label>
                  <input className="ai" value={newCotForm.empresa} onChange={e=>setNewCotForm(f=>({...f,empresa:e.target.value}))} placeholder="Nombre de la empresa"/>
                </div>
                <div className="field">
                  <label>Referencia del pedido</label>
                  <input className="ai" value={newCotForm.referencia} onChange={e=>setNewCotForm(f=>({...f,referencia:e.target.value}))} placeholder="Nombre identificador..."/>
                </div>
                <div className="field">
                  <label>Teléfono</label>
                  <input className="ai" value={newCotForm.tel} onChange={e=>setNewCotForm(f=>({...f,tel:e.target.value}))} placeholder="33 1234 5678"/>
                </div>
                <div className="field">
                  <label>Email</label>
                  <input className="ai" value={newCotForm.email} onChange={e=>setNewCotForm(f=>({...f,email:e.target.value}))} placeholder="correo@ejemplo.com"/>
                </div>
                <div className="field" style={{gridColumn:"1/-1"}}>
                  <label>Notas del pedido</label>
                  <textarea className="ai" rows="2" value={newCotForm.notas} onChange={e=>setNewCotForm(f=>({...f,notas:e.target.value}))} placeholder="Descripción general del pedido, urgencias, detalles..."/>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{flexDirection:"column",gap:"8px",alignItems:"stretch"}}>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                <button className="btn-n" onClick={()=>setCreandoCot(false)}>Cancelar</button>
                <button className="btn-primary" onClick={()=>crearCotAdmin(false)}>📋 Crear Cotización</button>
              </div>
              <button onClick={()=>crearCotAdmin(true)}
                style={{background:"none",border:"1px dashed rgba(255,255,255,.15)",borderRadius:"7px",color:"var(--c-text2)",padding:"8px",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",cursor:"pointer",width:"100%"}}>
                ⚡ Saltar datos — ir directo a la cotización
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATS */}
      <div className="cot-stats">
        <div className="cot-stat-card red">
          <div className="cot-stat-num">{stats.nueva}</div>
          <div className="cot-stat-lbl">Nuevas</div>
        </div>
        <div className="cot-stat-card blue">
          <div className="cot-stat-num">{stats.en_proceso}</div>
          <div className="cot-stat-lbl">En proceso</div>
        </div>
        <div className="cot-stat-card yellow">
          <div className="cot-stat-num">{stats.cotizada}</div>
          <div className="cot-stat-lbl">Cotizadas</div>
        </div>
        <div className="cot-stat-card green">
          <div className="cot-stat-num">{stats.ganada}</div>
          <div className="cot-stat-lbl">Ganadas</div>
        </div>
        <div className="cot-stat-card">
          <div className="cot-stat-num">{stats.perdida}</div>
          <div className="cot-stat-lbl">Perdidas</div>
        </div>
        {stats.potencial>0 && (
          <div className="cot-stat-card yellow" style={{minWidth:"160px"}}>
            <div className="cot-stat-num" style={{fontSize:"18px"}}>{fmtMXN(stats.potencial)}</div>
            <div className="cot-stat-lbl">Ingreso potencial</div>
          </div>
        )}
        {stats.ganado>0 && (
          <div className="cot-stat-card green" style={{minWidth:"160px"}}>
            <div className="cot-stat-num" style={{fontSize:"18px"}}>{fmtMXN(stats.ganado)}</div>
            <div className="cot-stat-lbl">Ingreso confirmado ✓</div>
          </div>
        )}
      </div>

      {/* MODAL LIMPIAR / ARCHIVAR */}
      {showLimpiarModal&&(
        <div className="modal-ov" onClick={()=>setShowLimpiarModal(false)}>
          <div className="modal-box" style={{maxWidth:"420px"}} onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-ttl">🗑 Gestionar cotizaciones</div>
              <button className="m-close" onClick={()=>setShowLimpiarModal(false)}>✕</button>
            </div>
            <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:"14px"}}>
              <div style={{background:"var(--c-warning-bg)",border:"1px solid var(--c-warning-bd)",borderRadius:"8px",padding:"12px 14px",fontSize:"13px",color:"var(--c-warning)",lineHeight:1.5}}>
                ⚠️ Tienes <strong>{cots.filter(c=>!c.archivada).length} cotizaciones activas</strong>. Elige qué hacer:
              </div>
              <div style={{background:"var(--c-info-bg)",border:"1.5px solid var(--c-info-bd)",borderRadius:"10px",padding:"16px"}}>
                <div style={{fontFamily:"var(--fh)",fontSize:"14px",fontWeight:900,textTransform:"uppercase",color:"var(--c-info)",marginBottom:"4px"}}>📦 Archivar todas</div>
                <div style={{fontSize:"12px",color:"var(--c-text2)",lineHeight:1.5,marginBottom:"12px"}}>Se mueven al archivo. Puedes verlas desde "Archivadas". No se eliminan de Supabase.</div>
                <button onClick={archivarTodas} style={{width:"100%",padding:"10px",background:"var(--c-info)",border:"none",borderRadius:"7px",color:"white",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,textTransform:"uppercase",cursor:"pointer"}}>
                  📦 Archivar todas
                </button>
              </div>
              <div style={{background:"var(--c-danger-bg)",border:"1.5px solid var(--c-danger-bd)",borderRadius:"10px",padding:"16px"}}>
                <div style={{fontFamily:"var(--fh)",fontSize:"14px",fontWeight:900,textTransform:"uppercase",color:"var(--c-danger)",marginBottom:"4px"}}>🗑 Eliminar permanentemente</div>
                <div style={{fontSize:"12px",color:"var(--c-text2)",lineHeight:1.5,marginBottom:"12px"}}><strong style={{color:"var(--c-danger)"}}>⚠️ No se puede deshacer.</strong> Se borran definitivamente de Supabase.</div>
                <button onClick={eliminarTodas} style={{width:"100%",padding:"10px",background:"var(--red)",border:"none",borderRadius:"7px",color:"white",fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,textTransform:"uppercase",cursor:"pointer"}}>
                  🗑 Eliminar permanentemente
                </button>
              </div>
              <button onClick={()=>setShowLimpiarModal(false)} style={{padding:"9px",background:"transparent",border:"1px solid rgba(255,255,255,.1)",borderRadius:"7px",color:"var(--c-text2)",fontFamily:"var(--fh)",fontSize:"12px",fontWeight:700,textTransform:"uppercase",cursor:"pointer"}}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAR CON CONTRASEÑA — siempre encima */}
      {confirmPass&&<ModalConfirmPass
        titulo={confirmPass.titulo}
        mensaje={confirmPass.mensaje}
        onConfirm={confirmPass.onConfirm}
        onCancel={()=>setConfirmPass(null)}
      />}

      {/* TOOLBAR */}
      <div className="toolbar">
        <input className="si" placeholder="🔍 Buscar por folio, cliente, empresa, email..." value={search} onChange={e=>setSearch(e.target.value)}/>
        {!verArchivadas&&<select className="as" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)}>
          <option value="all">Todos los estados</option>
          {ESTADOS.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}
        </select>}
        <button className="btn-n" onClick={()=>setVerArchivadas(v=>!v)} style={{color:verArchivadas?"var(--c-info)":"var(--c-text2)",borderColor:verArchivadas?"rgba(96,160,255,.3)":""}}>
          {verArchivadas?"← Activas":"📦 Archivadas"}
        </button>
        {!verArchivadas&&cots.length>0&&<button className="btn-n" onClick={exportarCSV}>↓ Exportar Excel</button>}
        {esAdmin&&!verArchivadas&&cots.length>0&&<button className="btn-n" onClick={limpiarTodas} style={{color:"var(--c-danger)",borderColor:"rgba(255,100,100,.2)"}}>🗑 Limpiar todo</button>}
      </div>

      {/* PIPELINE VIEW */}
      {vistaMode==="pipeline"&&!verArchivadas&&(
        <div style={{overflowX:"auto",paddingBottom:"12px",marginBottom:"16px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(200px,1fr))",gap:"10px",minWidth:"1000px"}}>
            {PIPE_COLS.map(function(col){
              var colCots = filtered.filter(function(c){ return (c.estado||"nueva")===col.id; });
              var colTotal = colCots.reduce(function(s,c){ var t=calcTotal(c); return t?s+t:s; },0);
              var nextCol = PIPE_COLS[PIPE_COLS.findIndex(function(p){ return p.id===col.id; })+1];
              var prevCol = PIPE_COLS[PIPE_COLS.findIndex(function(p){ return p.id===col.id; })-1];
              return(
                <div key={col.id} style={{background:"var(--g2)",borderRadius:"10px",padding:"10px",minHeight:"180px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
                      <div style={{width:"8px",height:"8px",borderRadius:"50%",background:col.color}}/>
                      <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:900,textTransform:"uppercase",color:"var(--lt)",letterSpacing:".04em"}}>{col.label}</span>
                      <span style={{background:col.bg,color:col.color,fontFamily:"var(--fh)",fontSize:"11px",fontWeight:900,padding:"1px 7px",borderRadius:"10px",border:"1px solid "+col.color+"40"}}>{colCots.length}</span>
                    </div>
                    {colTotal>0&&<span style={{fontSize:"11px",fontFamily:"var(--fh)",fontWeight:800,color:"var(--mt)"}}>{fmtMXN(colTotal)}</span>}
                  </div>
                  {colCots.length===0?(
                    <div style={{textAlign:"center",padding:"20px 8px",border:"2px dashed var(--g3)",borderRadius:"8px",color:"var(--mt)",fontSize:"11px",opacity:.6}}>
                      Sin cotizaciones
                    </div>
                  ):colCots.map(function(c){
                    var t=calcTotal(c);
                    var wa=buildWaLink(c);
                    var dias=c.fecha?Math.floor((Date.now()-new Date(c.fecha))/(864e5)):null;
                    return(
                      <div key={c.folio}
                        style={{background:"var(--g1)",borderRadius:"9px",padding:"11px",marginBottom:"8px",
                          cursor:"pointer",border:"1.5px solid "+(!c.leida?"var(--red)":dias>=3&&col.id!=="ganada"&&col.id!=="perdida"?"rgba(217,119,6,.4)":"var(--g3)"),
                          boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}
                        onClick={function(){ abrirCot(c); }}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
                          <span style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:900,color:"var(--red)"}}>#{c.folio}</span>
                          <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                            {c.mensaje_sin_leer&&<span style={{fontSize:"10px",fontFamily:"var(--fh)",fontWeight:900,color:"white",background:"var(--c-danger)",padding:"1px 6px",borderRadius:"9px",animation:"pulse 1.5s ease infinite"}}>💬 Mensaje</span>}
                            {!c.leida&&<span style={{width:"6px",height:"6px",borderRadius:"50%",background:"var(--red)",display:"block"}}/>}
                            {dias>=3&&col.id!=="ganada"&&col.id!=="perdida"&&<span style={{fontSize:"10px",fontFamily:"var(--fh)",fontWeight:800,color:"var(--c-warning)",background:"rgba(217,119,6,.1)",padding:"1px 5px",borderRadius:"4px"}}>{dias}d</span>}
                          </div>
                        </div>
                        <div style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:800,color:"var(--lt)",textTransform:"uppercase",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",marginBottom:"1px"}}>{(c.cliente&&c.cliente.nombre)||"Sin nombre"}</div>
                        {c.cliente&&c.cliente.empresa&&<div style={{fontSize:"11px",color:"var(--mt)",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",marginBottom:"6px"}}>{c.cliente.empresa}</div>}
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                          <span style={{fontSize:"11px",color:"var(--mt)",fontFamily:"var(--fh)",fontWeight:700}}>{c.total_piezas||0} pzs</span>
                          {t&&<span style={{fontFamily:"var(--fh)",fontSize:"13px",fontWeight:900,color:col.id==="ganada"?"var(--c-success)":"var(--lt)"}}>{fmtMXN(t)}</span>}
                        </div>
                        <div style={{display:"flex",gap:"4px",borderTop:"1px solid var(--g3)",paddingTop:"7px"}}
                          onClick={function(e){ e.stopPropagation(); }}>
                          {prevCol&&<button onClick={function(){ cambiarEstado(c.folio,prevCol.id); }} title="Etapa anterior"
                            style={{flex:1,padding:"4px",background:"var(--g2)",border:"none",borderRadius:"5px",cursor:"pointer",fontSize:"12px",color:"var(--mt)"}}>←</button>}
                          {nextCol&&<button onClick={function(){ cambiarEstado(c.folio,nextCol.id); }} title={"→ "+nextCol.label}
                            style={{flex:2,padding:"4px",background:col.bg,border:"none",borderRadius:"5px",cursor:"pointer",fontSize:"11px",color:col.color,fontFamily:"var(--fh)",fontWeight:800,textTransform:"uppercase"}}>
                            → {nextCol.label}
                          </button>}
                          {wa&&<a href={wa} target="_blank" rel="noopener noreferrer"
                            style={{padding:"4px 8px",background:"rgba(37,211,102,.1)",border:"none",borderRadius:"5px",cursor:"pointer",fontSize:"13px",textDecoration:"none",display:"flex",alignItems:"center",flexShrink:0}}>💬</a>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LISTA */}
      {(vistaMode==="lista"||verArchivadas)&&(
      filtered.length===0 ? (
        <div className="cot-empty">
          <div style={{fontSize:"48px",marginBottom:"12px"}}>{cots.length===0?"📭":"🔍"}</div>
          <div style={{fontFamily:"var(--fh)",fontSize:"16px",textTransform:"uppercase"}}>
            {cots.length===0 ? "Aún no hay cotizaciones" : "Sin resultados"}
          </div>
          <div className="help" style={{marginTop:"8px",maxWidth:"460px",margin:"8px auto"}}>
            {cots.length===0
              ? "Cuando un cliente envíe el configurador, su cotización aparecerá aquí automáticamente con todos los detalles del pedido."
              : "Intenta cambiar los filtros o borrar la búsqueda."}
          </div>
        </div>
      ) : (()=>{
        const sinId = filtered.filter(c=>!c.cliente?.nombre||c.cliente.nombre==="Sin nombre"||c.cliente.nombre.trim()==="");
        const conId = filtered.filter(c=>c.cliente?.nombre&&c.cliente.nombre!=="Sin nombre"&&c.cliente.nombre.trim()!=="");

        const renderRow = c => {
          const estado = c.estado||"nueva";
          const estadoLbl = ESTADOS.find(x=>x.id===estado)?.label || estado;
          const col = PIPE_COLS.find(p=>p.id===estado)||PIPE_COLS[0];
          const wa = buildWaLink(c);
          const TENANT_ID_COT="036bb85f-c7d3-4e7a-84e9-a631557ac955";
          return(
            <div key={c.folio} className={`cot-row${!c.leida?" unread":""}`}
              style={{borderLeft:"3px solid "+col.color,position:"relative"}}
              onClick={()=>{
                setNotifNuevas(function(prev){ var n=Object.assign({},prev); delete n[c.folio]; return n; });
                abrirCot(c);
              }}>
              {/* Badge de notificación nueva — persiste aunque recargues la
                  página (viene de mensaje_sin_leer en la BD), no solo mientras
                  la pestaña está abierta en vivo (eso es notifNuevas). */}
              {(notifNuevas[c.folio]||c.mensaje_sin_leer)&&(
                <div style={{position:"absolute",top:"8px",right:"8px",zIndex:10,
                  background:(notifNuevas[c.folio]&&notifNuevas[c.folio].tipo!=='comentario')?"var(--c-purple)":"var(--c-danger)",
                  color:"white",borderRadius:"10px",padding:"2px 8px",
                  fontFamily:"var(--fh)",fontSize:"11px",fontWeight:900,
                  boxShadow:"0 2px 8px rgba(0,0,0,.3)",
                  animation:"pulse 1.5s ease infinite"}}>
                  {(notifNuevas[c.folio]&&notifNuevas[c.folio].tipo!=='comentario')?"⚡ "+notifNuevas[c.folio].estado:"💬 Nuevo mensaje"}
                </div>
              )}
              <div>
                <div className="cot-folio">#{c.folio}</div>
                {/* Badge estado_cot */}
                {c.estado_cot&&c.estado_cot!=="borrador"&&(function(){
                  var pagoPorConfirmar = ["deposito","efectivo"].includes(c.metodo_pago) && !c.pago_confirmado_manual;
                  var MAP={enviada:{l:"📤 Enviada",bg:"var(--c-info-bg)",c:"var(--c-info)"},
                    vista:{l:"👁 Vista",bg:"var(--c-success-bg)",c:"var(--c-success)"},
                    correccion:{l:"✏️ Corrección",bg:"var(--c-warning-bg)",c:"var(--c-warning)"},
                    aceptada:{l:"✅ Aceptada",bg:"var(--c-success-bg)",c:"var(--c-success)"},
                    pagada: pagoPorConfirmar
                      ? {l:"⏳ Pagada (por confirmar)",bg:"var(--c-warning-bg)",c:"var(--c-warning)"}
                      : {l:"💰 Pagada",bg:"var(--c-success-bg)",c:"var(--c-success)"},
                    ot_generada:{l:"🔧 OT Generada",bg:"var(--c-purple-bg)",c:"var(--c-purple)"}};
                  var m=MAP[c.estado_cot];
                  if(!m) return null;
                  return <div style={{display:"inline-block",marginTop:"4px",padding:"1px 8px",
                    background:m.bg,color:m.c,borderRadius:"5px",
                    fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,
                    textTransform:"uppercase",letterSpacing:".3px"}}>{m.l}</div>;
                })()}
                {c.referencia&&<div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,color:"var(--c-danger)",textTransform:"uppercase",letterSpacing:".3px",marginTop:"2px"}}>{c.referencia}</div>}
                {c.origen==="whatsapp"&&<div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,color:"#25d366",textTransform:"uppercase",letterSpacing:".3px",marginTop:"2px"}}>📱 WhatsApp</div>}
                {c.origen==="catalogo_directo"&&<div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,color:"var(--c-purple)",textTransform:"uppercase",letterSpacing:".3px",marginTop:"2px"}}>🛒 Compra directa</div>}
                {c.origen==="catalogo_directo"&&(c.servicios_arte||[]).some(function(s){return s.pendiente;})?
                  <div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,color:"var(--c-warning)",textTransform:"uppercase",letterSpacing:".3px",marginTop:"2px"}}>⚠️ Arte pendiente</div>
                :null}
              </div>
              <div className="cot-cliente">
                <div className="cot-cliente-nom">{c.cliente?.nombre||"Sin nombre"}</div>
                <div className="cot-cliente-emp">
                  {c.cliente?.empresa || "Sin empresa"}
                  {c.cliente?.tel && <> · {c.cliente.tel}</>}
                </div>
              </div>
              <div>
                <div className="cot-piezas">{c.total_piezas||0}</div>
                <div className="cot-piezas-lbl" style={{textAlign:"center"}}>pzs</div>
              </div>
              {(()=>{
                const t = calcTotal(c);
                const esGanada = (c.estado||"nueva")==="ganada";
                if(!t) return <div style={{minWidth:"90px"}}/>;
                return(
                  <div style={{textAlign:"right",minWidth:"90px"}}>
                    <div style={{fontFamily:"var(--fh)",fontSize:"14px",fontWeight:900,color:esGanada?"var(--c-success)":"var(--c-warning)",lineHeight:1}}>{fmtMXN(t)}</div>
                    <div style={{fontSize:"11px",fontFamily:"var(--fh)",fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:esGanada?"var(--c-success)":"var(--c-warning)",marginTop:"2px"}}>{esGanada?"✓ confirmado":"potencial"}</div>
                  </div>
                );
              })()}
              {/* Estado inline */}
              <div onClick={e=>e.stopPropagation()}>
                <select value={estado}
                  onChange={e=>{ e.stopPropagation(); cambiarEstado(c.folio, e.target.value); }}
                  style={{padding:"4px 8px",borderRadius:"6px",
                    border:"1.5px solid "+col.color+"60",
                    background:col.bg,color:col.color,
                    fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,
                    textTransform:"uppercase",cursor:"pointer",outline:"none"}}>
                  {ESTADOS.map(e=>(
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </div>
              {/* Acciones rápidas */}
              <div style={{display:"flex",gap:"4px",alignItems:"center"}}
                onClick={e=>e.stopPropagation()}>
                {wa&&(
                  <a href={wa} target="_blank" rel="noopener noreferrer"
                    style={{width:"28px",height:"28px",display:"flex",alignItems:"center",
                      justifyContent:"center",background:"rgba(37,211,102,.1)",
                      border:"1px solid rgba(37,211,102,.3)",borderRadius:"6px",
                      fontSize:"13px",textDecoration:"none"}}
                    title="WhatsApp">💬</a>
                )}
              </div>
              <div className="cot-fecha">{fmtFecha(c.fecha)}</div>
            </div>
          );
        };

        return(
          <div className="cot-list">
            {sinId.length>0&&(
              <div style={{marginBottom:"20px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",margin:"4px 0 10px",padding:"8px 14px",background:"var(--c-warning-bg)",border:"1.5px solid var(--c-warning-bd)",borderRadius:"10px"}}>
                  <span style={{fontSize:"18px"}}>⏳</span>
                  <div>
                    <div style={{fontFamily:"var(--fh)",fontSize:"12px",fontWeight:900,textTransform:"uppercase",letterSpacing:".5px",color:"var(--c-warning)"}}>Pendientes de identificar · {sinId.length}</div>
                    <div style={{fontSize:"11px",color:"var(--c-warning)"}}>El cliente aún no se ha registrado. Comparte el folio para que pueda identificarse y ver su cotización.</div>
                  </div>
                </div>
                {sinId.map(renderRow)}
              </div>
            )}
            {conId.length>0&&(
              <div>
                {sinId.length>0&&<div style={{fontFamily:"var(--fh)",fontSize:"11px",fontWeight:800,textTransform:"uppercase",letterSpacing:"1px",color:"var(--c-text3)",margin:"0 0 8px"}}>Cotizaciones identificadas · {conId.length}</div>}
                {conId.map(renderRow)}
              </div>
            )}
          </div>
        );
      })()
      )}

      {viendo && <ModalCotizacion cot={viendo} onClose={()=>{setViendo(null);setViendoTabInicial(null);}} onUpdate={updateCot} onDelete={esAdmin?deleteCot:null} prods={prods} brands={brands} imgs={imgs} initialTab={viendoTabInicial}/>}
    </div>
  );
}

// ─── PRODUCTOS ───────────────────────────────────────────────────

// ── Exportar globalmente ──
// Inyectar CSS animación pulse para badges
(function(){
  if(document.getElementById('cot-notif-style')) return;
  var s=document.createElement('style');
  s.id='cot-notif-style';
  s.textContent='@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.85;transform:scale(1.05)}}';
  document.head.appendChild(s);
})();

window.Cotizaciones = Cotizaciones;
