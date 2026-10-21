import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { makeCors } from '../_shared/cors.ts';

const URL=Deno.env.get('SUPABASE_URL')||Deno.env.get('SB_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SB_SERVICE_ROLE_KEY')||'';
const admin=createClient(URL,SERVICE);
const text=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';

async function sha256(value:string){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((x)=>x.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async(req:Request)=>{
  const CORS=makeCors(req);
  const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
  const auth=await requireUser(req,CORS);if(auth.response)return auth.response;
  const tenant=auth.tenantId!,actor=auth.user!.id;
  try{
    const body=await req.json().catch(()=>({}));
    const action=text(body.action,40);
    if(action==='observe'){
      const network=text(req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',')[0],120);
      const agent=text(req.headers.get('user-agent'),400);
      // SERVICE acts as a server-side pepper. Neither the address nor the user
      // agent is persisted or returned; only this tenant-bound digest leaves memory.
      const fingerprint=await sha256(`${SERVICE}:${tenant}:${network}:${agent}`);
      const observed=await admin.rpc('smyl_observe_security_session',{p_tenant:tenant,p_actor:actor,p_fingerprint:fingerprint});
      if(observed.error)throw observed.error;
      return reply(200,observed.data||{ok:true});
    }
    if(action==='dashboard'){
      const dashboard=await admin.rpc('smyl_security_dashboard_server',{p_tenant:tenant,p_actor:actor});
      if(dashboard.error){if(dashboard.error.code==='42501')return reply(403,{error:'Tu rol no tiene acceso a la auditoría de seguridad.'});throw dashboard.error;}
      return reply(200,{ok:true,dashboard:dashboard.data});
    }
    if(action==='record_export'){
      const recorded=await admin.rpc('smyl_record_export_server',{
        p_tenant:tenant,p_actor:actor,p_export_type:text(body.export_type,40),p_entity_type:text(body.entity_type,40),
        p_entity_id:text(body.entity_id,200)||null,p_record_count:Number.isInteger(body.record_count)?body.record_count:1,p_purpose:text(body.purpose,40)
      });
      if(recorded.error){if(recorded.error.code==='42501')return reply(403,{error:'No tienes permiso para exportar este contenido.'});throw recorded.error;}
      return reply(200,recorded.data||{ok:true});
    }
    if(action==='update_event'){
      const updated=await admin.rpc('smyl_update_security_event_server',{p_tenant:tenant,p_actor:actor,p_event:text(body.event_id,50),p_status:text(body.status,20),p_note:text(body.note,500)});
      if(updated.error){if(updated.error.code==='42501')return reply(403,{error:'No tienes permiso para gestionar esta señal.'});throw updated.error;}
      return reply(200,updated.data||{ok:true});
    }
    return reply(400,{error:'Acción no válida.'});
  }catch(error){
    console.error('[security-monitor]',error instanceof Error?error.message:'error desconocido');
    return reply(500,{error:'No se pudo completar la operación de seguridad.'});
  }
});
