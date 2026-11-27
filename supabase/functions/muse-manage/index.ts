import { requireUser } from '../_shared/auth.ts';
import { makeCors } from '../_shared/cors.ts';
import { smylAdmin as db, lanaRequest } from '../_shared/lana-linked.ts';
import { hash, token, uuid, reply } from '../_shared/muse-core.mjs';

Deno.serve(async(req:Request)=>{
  const cors=makeCors(req,'GET, POST, OPTIONS');
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  if(!['GET','POST'].includes(req.method)) return reply(405,{error:'Método no permitido.'},cors);
  const auth=await requireUser(req,cors);
  if(auth.response) return auth.response;
  const tenant=auth.tenantId!, user=auth.user!.id;
  try {
    const t=await db.from('camila_tenants').select('activo').eq('id',tenant).single();
    if(t.error || !t.data?.activo) return reply(403,{error:'La clínica no está activa.'},cors);
    const owner=user===tenant;
    if(req.method==='GET') {
      const membersQuery=db.from('smyl_muse_members').select('user_id,enabled').eq('tenant_id',tenant);
      const [settings,members,connection,people,alerts]=await Promise.all([
        db.from('smyl_muse_settings').select('enabled,allow_replies').eq('tenant_id',tenant).maybeSingle(),
        owner?membersQuery:membersQuery.eq('user_id',user),
        db.from('smyl_muse_connections').select('id,expires_at,allow_replies,whatsapp_alerts').eq('tenant_id',tenant).eq('user_id',user).is('revoked_at',null).maybeSingle(),
        owner?db.from('camila_usuarios').select('id,nombre').eq('tenant_id',tenant).eq('activo',true):Promise.resolve({data:[],error:null}),
        db.from('smyl_muse_alerts').select('status,result_code,created_at').eq('tenant_id',tenant).eq('user_id',user).order('created_at',{ascending:false}).limit(5)
      ]);
      if([settings,members,connection,people,alerts].some(r=>r.error)) throw new Error('read');
      return reply(200,{owner,settings:settings.data||{enabled:false,allow_replies:false},members:members.data,
        connection:connection.data,alerts:alerts.data,people:owner?[{id:tenant,nombre:'Titular de la clínica'},...(people.data||[]).filter(x=>x.id!==tenant)]:[]},cors);
    }
    const raw=await req.text(); if(raw.length>12000) return reply(413,{error:'Solicitud demasiado grande.'},cors);
    const input=JSON.parse(raw);
    if(input.action==='configure') {
      if(!owner) return reply(403,{error:'Solo el titular puede habilitar el piloto.'},cors);
      if(typeof input.enabled!=='boolean' || typeof input.allow_replies!=='boolean') return reply(400,{error:'Configuración no válida.'},cors);
      // Enable the event source before enabling access. Disable local access first.
      if(input.enabled) {
        const remote=await lanaRequest(tenant,'/inbox/muse/events',{method:'PUT',headers:new Headers({'X-SMYL-Actor-Id':user,'X-SMYL-Actor-Role':'owner'}),body:JSON.stringify({enabled:true})});
        if(!remote.response.ok) return reply(503,{error:'El servicio de avisos todavía no está preparado. El piloto sigue sin activarse.'},cors);
      }
      const r=await db.from('smyl_muse_settings').upsert({tenant_id:tenant,enabled:input.enabled,allow_replies:input.allow_replies,updated_at:new Date().toISOString()});
      if(r.error) throw new Error('write');
      if(!input.enabled) {
        await lanaRequest(tenant,'/inbox/muse/events',{method:'PUT',headers:new Headers({'X-SMYL-Actor-Id':user,'X-SMYL-Actor-Role':'owner'}),body:JSON.stringify({enabled:false})});
      }
    } else if(input.action==='member') {
      if(!owner || !uuid(input.user_id) || typeof input.enabled!=='boolean') return reply(403,{error:'No puedes modificar este acceso.'},cors);
      const mode=await db.rpc('smyl_chat_mode',{p_tenant:tenant,p_user:input.user_id});
      if(mode.error || (input.enabled && mode.data==='none')) return reply(403,{error:'El usuario necesita acceso activo al chat en SMYL.'},cors);
      const r=await db.from('smyl_muse_members').upsert({tenant_id:tenant,user_id:input.user_id,enabled:input.enabled});
      if(r.error) throw new Error('write');
    } else if(input.action==='connect') {
      if(input.consent!==true || typeof input.allow_replies!=='boolean' || typeof input.whatsapp_alerts!=='boolean') return reply(400,{error:'Revisa y acepta el acceso de Muse.'},cors);
      const [s,m,mode]=await Promise.all([
        db.from('smyl_muse_settings').select('enabled,allow_replies').eq('tenant_id',tenant).maybeSingle(),
        db.from('smyl_muse_members').select('enabled').eq('tenant_id',tenant).eq('user_id',user).maybeSingle(),
        db.rpc('smyl_chat_mode',{p_tenant:tenant,p_user:user})]);
      if(s.error||m.error||mode.error) throw new Error('read');
      if(!s.data?.enabled || !m.data?.enabled || mode.data==='none' || (input.allow_replies&&!s.data.allow_replies)) return reply(403,{error:'Tu acceso al piloto o a las respuestas no está habilitado.'},cors);
      const revoked=await db.from('smyl_muse_connections').update({revoked_at:new Date().toISOString()}).eq('tenant_id',tenant).eq('user_id',user).is('revoked_at',null);
      if(revoked.error) throw new Error('write');
      const credential='smyl_muse_'+token();
      const created=await db.from('smyl_muse_connections').insert({tenant_id:tenant,user_id:user,token_hash:await hash(credential),allow_replies:input.allow_replies,whatsapp_alerts:input.whatsapp_alerts}).select('id,expires_at').single();
      if(created.error) throw new Error('write');
      const logged=await db.from('smyl_muse_audit').insert({tenant_id:tenant,user_id:user,connection_id:created.data.id,action:'connect',outcome:'ok'});
      if(logged.error) { await db.from('smyl_muse_connections').update({revoked_at:new Date().toISOString()}).eq('id',created.data.id); throw new Error('audit'); }
      return reply(201,{...created.data,credential,display_once:true},cors);
    } else if(input.action==='disconnect') {
      const r=await db.from('smyl_muse_connections').update({revoked_at:new Date().toISOString()}).eq('tenant_id',tenant).eq('user_id',user).is('revoked_at',null);
      if(r.error) throw new Error('write');
    } else return reply(400,{error:'Acción no válida.'},cors);
    const logged=await db.from('smyl_muse_audit').insert({tenant_id:tenant,user_id:user,action:input.action,outcome:'ok'});
    if(logged.error) throw new Error('audit');
    return reply(200,{ok:true},cors);
  } catch {return reply(503,{error:'No se pudo actualizar el piloto. Vuelve a consultar su estado.'},cors);}
});
