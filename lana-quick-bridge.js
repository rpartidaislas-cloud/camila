(function(root){
  'use strict';
  const KEY='smyl_lana_context';
  function read(storage){
    try{
      const c=JSON.parse(storage.getItem(KEY)||'null');
      if(!c||c.origen!=='lana'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c.tenant_id))return null;
      if(!/^[1-9]\d*$/.test(String(c.cita_id))||!Number.isSafeInteger(Number(c.cita_id)))return null;
      if(typeof c.paciente!=='string'||!c.paciente.trim()||c.paciente.length>160||!/^\+[1-9]\d{7,14}$/.test(c.telefono))return null;
      return c;
    }catch{return null;}
  }
  function bind(cfg,storage,search){
    cfg.lanaContext=null;
    if(new URLSearchParams(search).get('origen')!=='lana'||!cfg.userToken||cfg.modoProspecto)return null;
    const c=read(storage);
    if(!c)return null;
    if(c.tenant_id.toLowerCase()!==String(cfg.tenantId).toLowerCase())throw Error('La cita de LANA pertenece a otra clínica.');
    cfg.lanaContext={tenantId:c.tenant_id,citaId:Number(c.cita_id),paciente:c.paciente.trim(),telefono:c.telefono,origen:'lana'};
    return cfg.lanaContext;
  }
  async function notify(cfg,caso,fetcher,href){
    if(!cfg.userToken||cfg.modoProspecto||!cfg.lanaContext)throw Error('Se requiere la sesión profesional de la cita.');
    const url=new URL('revision-clinica.html',href);url.searchParams.set('caso',caso.id);
    if(url.protocol!=='https:')throw Error('Caso guardado. La entrega a LANA requiere el dominio HTTPS autorizado; no se envía desde la prueba local.');
    const response=await fetcher(cfg.supaUrl+'/functions/v1/lana-webhook',{
      method:'POST',headers:{apikey:cfg.supaKey,Authorization:'Bearer '+cfg.userToken,'Content-Type':'application/json'},
      body:JSON.stringify({simulacion_id:caso.id,url_resultado:url.href})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok!==true)throw Error('Caso guardado, pero LANA todavía no confirmó la recepción.');
    return data;
  }
  function showStatus(caso){
    const box=document.getElementById('case-actions-box');if(!box||!caso.lana_origen)return;
    const p=document.createElement('p');p.setAttribute('role','status');p.style.cssText='padding:12px;border:1px solid #526477;border-radius:10px;color:#d8eaf4';
    p.textContent=caso.lana_sincronizado?'LANA confirmó la recepción del caso.':'Guardado en SMYL. Envío a LANA pendiente; no vuelvas a generar la imagen.';
    box.append(p);
  }
  root.SmylLanaQuick={read,bind,notify,showStatus};
})(typeof window==='undefined'?globalThis:window);
