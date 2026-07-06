// ── utils.js ────────────────────────────────────────────────────
// Funciones: dbToProd, prodToDB, dbToMarca, marcaToDB, dbToCot,
// migrateBrand, fmt, uid, slug
// Cargado como <script src='utils.js'> (sin Babel, JS puro)

function dbToProd(r){
  return { id:r.id, name:r.name, brand:r.brand||"", cat:r.cat||"", sub:r.sub||"",
    mat:r.mat||"", desc:r.desc_txt||"", icon:r.icon||"👔", shapeCat:r.shape_cat||"",
    active:r.active!==false, directo:r.directo===true, destacado:r.destacado===true,
    badge:r.badge||"", tags:r.tags||[], url:r.url||"", sku:r.sku||"",
    colors:r.colors||[], colorMap:r.color_map||{}, colorConfig:r.color_config||{}, sizeRecargos:r.size_recargos||{}, escala_max:r.escala_max??null, precio_independiente:r.precio_independiente===true, grupo_precio_id:r.grupo_precio_id||null, sizes:r.sizes||[], variants:r.variants||[],
    services:r.services||[], desde:r.desde||"", hasta:r.hasta||"",
    escalas:r.escalas||{}, varPrices:r.var_prices||{}, imgs:r.imgs||[],
    reglaPrecioId:r.regla_precio_id||null, linea:r.linea||"" };
}
function prodToDB(p, mainImg=null){
  var _id = p.id ? Math.floor(Number(p.id)) : null;
  var _row = { name:p.name, brand:p.brand||null, cat:p.cat||"", sub:p.sub||"",
    mat:p.mat||"", desc_txt:p.desc||"", icon:p.icon||"👔", shape_cat:p.shapeCat||"",
    active:p.active!==false, directo:p.directo===true, destacado:p.destacado===true,
    badge:p.badge||null, tags:p.tags||[], url:p.url||"", sku:p.sku||null,
    colors:p.colors||[], sizes:p.sizes||[], variants:p.variants||[],
    services:p.services||[], desde:p.desde||null, hasta:p.hasta||null,
    escalas:p.escalas||null, var_prices:p.varPrices||{}, imgs:p.imgs||[],
    color_map:p.colorMap||{}, color_config:p.colorConfig||{},
    size_recargos:p.sizeRecargos||{},
    escala_max:p.escala_max??null,
    precio_independiente:p.precio_independiente===true,
    grupo_precio_id:p.grupo_precio_id||null,
    main_img: mainImg||p.main_img||null, linea:p.linea||null };
  if(_id && !isNaN(_id)) _row.id = _id;
  return _row; }
function _prodToDB_OLD(p, mainImg=null){
  return { id:Math.floor(Number(p.id)), name:p.name, brand:p.brand||null, cat:p.cat||"", sub:p.sub||"",
    mat:p.mat||"", desc_txt:p.desc||"", icon:p.icon||"👔", shape_cat:p.shapeCat||"",
    active:p.active!==false, directo:p.directo===true, destacado:p.destacado===true,
    badge:p.badge||null, tags:p.tags||[], url:p.url||"", sku:p.sku||null,
    colors:p.colors||[], sizes:p.sizes||[], variants:p.variants||[],
    services:p.services||[], desde:p.desde||null, hasta:p.hasta||null,
    escalas:p.escalas||null, var_prices:p.varPrices||{}, imgs:p.imgs||[],
    color_map:p.colorMap||{}, color_config:p.colorConfig||{},
    size_recargos:p.sizeRecargos||{},
    main_img: mainImg||p.main_img||null, linea:p.linea||null };
}
function dbToMarca(r){
  var lineas=(r.lineas||[]).map(function(l){
    if(typeof l==="string") return {nombre:l};
    return {...l, nombre:l.nombre||l.name||"", guiaTallasId:l.guiaTallasId||l.guia_tallas_id||null};
  });
  return {id:r.id,name:r.name,active:r.active!==false,icon:r.icon||"👕",pdfUrl:r.pdf_url||"",lineas:lineas,
  modelos:r.modelos||[],colores:r.colores||[],tallas:r.tallas||[],mat:r.mat||"",desc:r.desc_txt||""}; }
function marcaToDB(b){ return {id:b.id,name:b.name,active:b.active!==false,icon:b.icon||"👕",pdf_url:b.pdfUrl||"",lineas:b.lineas||[],
  modelos:b.modelos||[],colores:b.colores||[],tallas:b.tallas||[],mat:b.mat||"",desc_txt:b.desc||""}; }
function dbToCot(r){
  return {
    id:           r.id,
    folio:        r.folio,
    fecha:        r.fecha,
    ts:           r.ts || new Date(r.fecha).getTime(),
    estado:       r.estado || "nueva",
    // Faltaba mapear esto — es el estado que realmente controla el botón de
    // "Confirmar precios" en cot.jsx y el stepper que ve el cliente. Sin él,
    // cada vez que se recargaba la lista desde Supabase (abrir la app,
    // refrescar), toda cotización volvía a verse como "sin confirmar" en
    // el panel aunque la base de datos ya tuviera el estado correcto.
    estado_cot:   r.estado_cot || "enviada",
    precios_confirmados: r.precios_confirmados || false,
    leida:        r.leida || false,
    archivada:    r.archivada || false,
    mensaje_sin_leer: r.mensaje_sin_leer || false,
    cliente:      r.cliente || { nombre:r.nombre||"", empresa:r.empresa||"", tel:r.tel||"", email:r.email||"" },
    notas:        r.notas || "",
    total_piezas: r.total_piezas || 0,
    resumen:      r.resumen || "",
    grupos:       r.grupos || [],
    preciosGrupo: r.precios_grupo || {},
    precioEnvio:  r.precio_envio || "",
    descuento:    r.descuento || null,
    notasAdmin:   r.notas_admin || "",
    conIVA:       r.con_iva || false,
    referencia:   r.referencia || "",
    comentarios:  r.comentarios || [],
    // Pago — antes no se mapeaban estos campos, así que cot.jsx nunca veía
    // el comprobante/referencia del cliente ni el recibo de la pasarela
    // después de cargar la lista desde Supabase (solo aparecían si el
    // objeto venía directo de un payload de Realtime sin pasar por aquí).
    metodo_pago:            r.metodo_pago || null,
    comprobante_url:        r.comprobante_url || null,
    referencia_pago:        r.referencia_pago || null,
    pago_confirmado_manual: r.pago_confirmado_manual || false,
    fecha_confirmacion_pago:r.fecha_confirmacion_pago || null,
    mp_payment_id:          r.mp_payment_id || null,
    mp_amount:              r.mp_amount != null ? r.mp_amount : null,
    stripe_session_id:      r.stripe_session_id || null,
    stripe_amount:          r.stripe_amount != null ? r.stripe_amount : null,
  };
}

// Guardar/actualizar Orden de Trabajo en Supabase
async function sbSaveOT(ot){
  if(!sb) return null;
  try{
    const otRow = MY_TENANT_ID ? {...ot, tenant_id: MY_TENANT_ID} : ot;
    const {data,error} = await sb.from("ordenes_trabajo").upsert(otRow,{onConflict:"id"}).select().single();
    if(error){ console.error("sbSaveOT:",error.message); return null; }
    return data;
  }catch(e){ console.error("sbSaveOT",e); return null; }
}
// ── AUTO-REGISTRO DE CONTACTOS ──────────────────────────────────
// tipo: 'prospecto' cuando cotiza, 'cliente' cuando genera OT
//
// Antes esto emparejaba SOLO por nombre (sin filtrar por tenant) — dos
// clientes distintos con el mismo nombre se mezclaban, "Juan Pérez" vs
// "juan perez " se duplicaba, y en teoría podía cruzar datos entre
// negocios distintos. Ahora la llave real es el teléfono (o el RFC si no
// hay teléfono), siempre acotado al tenant — el nombre solo se usa como
// último recurso si no hay ninguno de los dos.
function normTel(tel){ return (tel||"").replace(/[^0-9]/g,""); }

async function sbUpsertContacto(cliente, tipo){
  if(!sb||!cliente||!cliente.nombre||!MY_TENANT_ID) return;
  try{
    const nombre = (cliente.nombre||"").trim();
    if(!nombre) return;
    const tel = normTel(cliente.tel);
    const rfc = (cliente.rfc||"").trim().toUpperCase();

    let exist = null;
    if(tel){
      const {data} = await sb.from("clientes").select("id,tipo")
        .eq("tenant_id", MY_TENANT_ID).eq("tel", tel).limit(1).maybeSingle();
      exist = data;
    }
    if(!exist && rfc){
      const {data} = await sb.from("clientes").select("id,tipo")
        .eq("tenant_id", MY_TENANT_ID).eq("rfc", rfc).limit(1).maybeSingle();
      exist = data;
    }
    if(!exist && !tel && !rfc){
      const {data} = await sb.from("clientes").select("id,tipo")
        .eq("tenant_id", MY_TENANT_ID).ilike("nombre", nombre).limit(1).maybeSingle();
      exist = data;
    }

    if(exist){
      // Solo actualizar si es promoción (prospecto → cliente) o si hay datos nuevos que agregar
      const upd = {};
      if(tipo==="cliente" && exist.tipo!=="cliente") upd.tipo = "cliente";
      if(cliente.empresa) upd.empresa = cliente.empresa;
      if(tel) upd.tel = tel;
      if(cliente.email) upd.email = cliente.email;
      if(rfc) upd.rfc = rfc;
      if(Object.keys(upd).length){
        upd.updated_at = new Date().toISOString();
        await sb.from("clientes").update(upd).eq("id", exist.id);
      }
    } else {
      // Insertar nuevo
      await sb.from("clientes").insert({
        nombre: nombre,
        empresa: cliente.empresa||"",
        tel: tel,
        email: cliente.email||"",
        rfc: rfc||null,
        tipo: tipo,
        tenant_id: MY_TENANT_ID,
      });
    }
  }catch(e){ console.log("sbUpsertContacto:", e.message); }
}

// Obtener estado de aceptación de una OT
async function sbGetOT(otId){
  if(!sb) return null;
  try{
    const {data} = await sb.from("ordenes_trabajo").select("estado,firma_nombre,fecha_aceptacion").eq("id",otId).single();
    return data;
  }catch(e){ return null; }
}
async function sbSaveCotCompleta(cot){
  if(!sb) return;
  // Esperar tenant_id si aún no está disponible
  if(!MY_TENANT_ID){
    let tries=0;
    while(!MY_TENANT_ID && tries<20){ await new Promise(r=>setTimeout(r,200)); tries++; }
    if(!MY_TENANT_ID){ console.error("sbSaveCotCompleta: no MY_TENANT_ID"); return; }
  }
  try{
    const descVal = cot.descuento!=null
      ? (typeof cot.descuento==="string" || typeof cot.descuento==="number"
          ? cot.descuento
          : JSON.stringify(cot.descuento))
      : null;
    const row = {
      folio:        cot.folio,
      nombre:       cot.cliente?.nombre||"",
      empresa:      cot.cliente?.empresa||"",
      tel:          cot.cliente?.tel||"",
      email:        cot.cliente?.email||"",
      resumen:      cot.resumen||"",
      total_piezas: cot.total_piezas||0,
      notas:        cot.notas||"",
      estado:       cot.estado||"nueva",
      leida:        cot.leida||false,
      mensaje_sin_leer: cot.mensaje_sin_leer||false,
      fecha:        cot.fecha,
      ts:           cot.ts||null,
      cliente:      cot.cliente||null,
      grupos:       cot.grupos||null,
      precios_grupo: cot.preciosGrupo||{},
      precio_envio: cot.precioEnvio||null,
      descuento:    descVal,
      notas_admin:  cot.notasAdmin||null,
      con_iva:      cot.conIVA===true,
      referencia:   cot.referencia||null,
      comentarios:  cot.comentarios||[],
      creada_por_admin: cot.creada_por_admin||false,
      tenant_id:    MY_TENANT_ID,
    };
    // Verificar si ya existe para decidir UPDATE o INSERT
    const {data:existing} = await sb.from("cotizaciones")
      .select("folio").eq("folio", row.folio).eq("tenant_id", MY_TENANT_ID).maybeSingle();
    let error;
    if(existing){
      const {error:updErr} = await sb.from("cotizaciones").update(row)
        .eq("folio", row.folio).eq("tenant_id", MY_TENANT_ID);
      error = updErr;
    } else {
      const {error:insErr} = await sb.from("cotizaciones").insert(row);
      error = insErr;
    }
    if(error){
      console.error("sbSaveCotCompleta error:", error.message, error);
      alert("⚠️ Error al guardar cotización: "+error.message);
    } else {
      await sbUpsertContacto(cot.cliente, "prospecto");
    }
  }catch(e){ console.error("sbSaveCotCompleta excepción:", e); }
}

// Cargar datos desde Supabase al iniciar
async function sbInit(setProds, setBrands, setCots, setImgs){
  if(!sb) return;
  try{
    const [{data:p},{data:m},{data:c}] = await Promise.all([
      sb.from("productos").select("*").eq("tenant_id", MY_TENANT_ID).order("id"),
      sb.from("marcas").select("*").eq("tenant_id", MY_TENANT_ID).order("name"),
      sb.from("cotizaciones").select("*").eq("tenant_id", MY_TENANT_ID).order("fecha",{ascending:false})
    ]);
    if(p?.length){
      const prods=p.map(dbToProd);
      // setProds SIEMPRE, localStorage es solo caché opcional
      setProds(prods);
      // No escribimos a localStorage (Supabase es la fuente de verdad)
      const imgMap={};
      p.forEach(r=>{
        if(r.main_img){ imgMap[r.id]=r.main_img; }
        else if(r.imgs?.length>0 && r.imgs[0]?.src){ imgMap[r.id]=r.imgs[0].src; }
        // Mapear imágenes por color: prodId_colorName → src
        if(r.imgs?.length>0){
          r.imgs.forEach(im=>{
            if(im.color && im.src){ imgMap[r.id+'_'+im.color]=im.src; }
          });
        }
      });
      if(Object.keys(imgMap).length){ setImgs(prev=>({...prev,...imgMap})); }
    }
    if(m?.length){
      const brands=m.map(dbToMarca);
      setBrands(brands);
      // no escribir marcas a localStorage (multi-tenant)
    }
    if(c?.length){
      const cots=c.map(dbToCot);
      setCots(cots);
      // localStorage escrito por saveCots() en cot.jsx (con clave tenant-aware)
    }
  }catch(e){ console.error("sbInit",e); }
}

// Borrar cotización de Supabase
async function sbDeleteCot(folio){
  if(!sb) return;
  try{
    // Sin filtrar por tenant_id y sin verificar cuántas filas se tocaron,
    // un borrado bloqueado en silencio por RLS se ve idéntico a uno exitoso
    // — el admin la ve desaparecer localmente, pero sigue viva en la BD y
    // reaparece en la próxima carga. Mismo patrón que el bug de "confirmar".
    const {data, error} = await sb.from("cotizaciones").delete()
      .eq("folio",folio).eq("tenant_id",MY_TENANT_ID||"").select("folio");
    if(error){ console.error("sbDeleteCot",error.message); alert("❌ Error al borrar: "+error.message); return false; }
    if(!data||!data.length){ alert("⚠️ No se pudo borrar la cotización #"+folio+" (posible problema de permisos). Es probable que vuelva a aparecer."); return false; }
    return true;
  }catch(e){ console.error("sbDeleteCot",e); alert("❌ Error al borrar: "+e.message); return false; }
}
async function sbDeleteAllCots(folios){
  if(!sb||!folios.length) return;
  try{
    const {data, error} = await sb.from("cotizaciones").delete()
      .in("folio",folios).eq("tenant_id",MY_TENANT_ID||"").select("folio");
    if(error){ console.error("sbDeleteAllCots",error.message); alert("❌ Error al borrar: "+error.message); return false; }
    if(!data||data.length<folios.length){
      alert("⚠️ Solo se borraron "+((data&&data.length)||0)+" de "+folios.length+" cotizaciones. Las demás pueden volver a aparecer.");
    }
    return true;
  }catch(e){ console.error("sbDeleteAllCots",e); alert("❌ Error al borrar: "+e.message); return false; }
}

// Guardar/eliminar producto en Supabase
async function sbSaveProd(prod){
  if(!sb) return;
  try{
    const row = {...prodToDB(prod), tenant_id: MY_TENANT_ID};
    console.log("💾 Guardando producto id:", row.id);
    var result;
    if(row.id && !isNaN(row.id)){
      // Producto existente — upsert
      result = await sb.from("productos").upsert(row);
    } else {
      // Producto nuevo — insert sin id (BD lo genera)
      delete row.id;
      result = await sb.from("productos").insert(row).select("id").single();
      if(result.data && result.data.id) prod.id = result.data.id;
    }
    if(result.error){ console.error("sbSaveProd error:", result.error.message); alert("Error al guardar: " + result.error.message); }
    else { console.log("✓ Producto guardado en Supabase"); }
  }catch(e){ console.error("sbSaveProd",e); alert("Error: " + e.message); }
}
async function sbDelProd(id){  if(!sb) return;
  try{ await sb.from("productos").delete().eq("id",id); }catch(e){ console.error("sbDelProd",e); }
}
// Guardar/eliminar marca en Supabase
async function sbSaveMarca(marca){  if(!sb) return;
  try{ await sb.from("marcas").upsert({...marcaToDB(marca), tenant_id: MY_TENANT_ID}); }catch(e){ console.error("sbSaveMarca",e); }
}
async function sbDelMarca(id){  if(!sb) return;
  try{ await sb.from("marcas").delete().eq("id",id); }catch(e){ console.error("sbDelMarca",e); }
}
// Actualizar estado de cotización
async function sbUpdCotEstado(id, estado, leida){  if(!sb) return;
  try{ await sb.from("cotizaciones").update({estado,leida}).eq("id",id); }catch(e){ console.error("sbUpdCot",e); }
}


// Categorías de ocasión/uso — nivel principal de navegación en el catálogo
const CATS = [
  "Corporativo / Empresa",
  "Restaurante / Gourmet",
  "Deportivo / Equipos",
  "Industrial / Seguridad",
  "Clínica / Salud",
  "Eventos / Promocional",
  "Escolar",
];

// Mapa de migración de categorías viejas → nuevas
const CATS_MIGRATION = {
  "Corporativa":          "Corporativo / Empresa",
  "Performance":          "Deportivo / Equipos",
  "Sport":                "Deportivo / Equipos",
  "Seguridad Industrial": "Industrial / Seguridad",
  "Gourmet":              "Restaurante / Gourmet",
  "Clínica":              "Clínica / Salud",
  "Chamarra & Chaleco":   "Corporativo / Empresa",
  "Bottoms":              "Corporativo / Empresa",
  "Ecológica":            "Eventos / Promocional",
  "Gorras":               "Corporativo / Empresa",
  "Otros":                "Corporativo / Empresa",
};
const SERVICIOS = ["Bordado","Serigrafía","Sublimación","Vinil Textil","DTF"];
const ESCALAS_DEF = {p1_5:"",p6_20:"",p21_50:"",p51_100:"",p101:""};

// Categorías de forma — determinan qué prendas pueden agruparse juntas en el configurador
var SHAPE_CATS = [
  { id:"camisa",    label:"Camisas / Blusas",              icon:"👔", desc:"Camisas de botones, blusas, manga corta/larga" },
  { id:"playera",   label:"Playeras / Polos",              icon:"👕", desc:"Playeras cuello redondo, polos, camisetas" },
  { id:"sudadera",  label:"Sudaderas / Hoodies",           icon:"🧣", desc:"Sudaderas cuello redondo, sudaderas con capucha, sin cierre" },
  { id:"chamarra",  label:"Chamarras / Chalecos",          icon:"🧥", desc:"Chamarras con cierre, con capucha, fleece, chalecos" },
  { id:"gorra",     label:"Gorras / Sombreros",            icon:"🧢", desc:"Gorras, cachucha, sombreros, viseras, beanies" },
  { id:"pantalon",  label:"Pantalones / Faldas",           icon:"👖", desc:"Pantalón, bermuda, falda, pantalón industrial" },
  { id:"delantal",  label:"Batas / Filipinas / Delantales",icon:"🥼", desc:"Batas médicas, filipinas, batas de laboratorio, delantales" },
];
const ESCALAS_LBLS = [["p1_5","1–5"],["p6_20","6–20"],["p21_50","21–50"],["p51_100","51–100"],["p101","101+"]];

const KEY_PRODS  = "be_v2_prods";
const KEY_IMGS   = "be_v2_imgs";

// Limpiar localStorage si está muy lleno (productos con imágenes grandes)
// limpieza localStorage removida (no se usa para datos multi-tenant)
const KEY_BRANDS = "be_v2_brands";
const KEY_ACTIVE = "be_v2_brand_active";

// Marcas iniciales — coinciden con index.html
const DEFAULT_BRANDS = [
  {id:"big-bang",      name:"Big Bang",      active:true,  icon:"👕", pdfUrl:""},
  {id:"yazbek",        name:"Yazbek",        active:true,  icon:"👔", pdfUrl:"https://www.promodesk.com.mx/_files/ugd/2be84e_23805b8b1725455683ac1be7b3e26158.pdf"},
  {id:"playery-tees",  name:"Playery Tees",  active:true,  icon:"🎽", pdfUrl:"https://www.promodesk.com.mx/_files/ugd/2be84e_21546efdbc3e44549aa7e807c96be90d.pdf"},
  {id:"explosion",     name:"Explosion",     active:true,  icon:"🧥", pdfUrl:"https://www.promodesk.com.mx/_files/ugd/2be84e_4a9805d325924d3f884786897aa55bfc.pdf"},
];

// Migrar marcas viejas (sin active/icon/pdfUrl)
function migrateBrand(b){
  return {
    id: b.id,
    name: b.name,
    active: b.active!==false,
    icon: b.icon || "👕",
    pdfUrl: b.pdfUrl || "",
  };
}

const loadProds = () => []; // Supabase es la fuente — no localStorage
const saveProds = p => {}; // no-op: Supabase es la fuente
const loadImgs  = () => ({}); // Supabase es la fuente
const saveImgs  = i => {
  try{
    // Guardar solo main_img (strings cortos de URL), no base64 largas
    const slim = Object.fromEntries(Object.entries(i).filter(([,v])=>v&&v.length<2000));
    // no escribir imgs a localStorage
  }catch(e){ console.warn("saveImgs: localStorage lleno", e.message); }
};
const loadBrands= () => DEFAULT_BRANDS; // Supabase es la fuente
const saveBrands= b => {
  // no escribir brands a localStorage
  window.dispatchEvent(new StorageEvent("storage", {key:KEY_BRANDS, newValue:JSON.stringify(b)}));
};
const loadActive= () => localStorage.getItem(KEY_ACTIVE) || "all";
const saveActive= b  => localStorage.setItem(KEY_ACTIVE, b);

function fmt(n){return n?`$${Number(n).toLocaleString("es-MX",{minimumFractionDigits:2})}`:"—";}
function uid(){return Date.now()+Math.random();}
function slug(s){return (s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}

