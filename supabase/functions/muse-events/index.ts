import { smylAdmin as db } from '../_shared/lana-linked.ts';
import { uuid, reply, verifyWebhook } from '../_shared/muse-core.mjs';
import { allowed } from '../_shared/muse-inbox.ts';
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST') return reply(405,{error:'method_not_allowed'});
  const raw=await req.text();
  if(raw.length>5000) return reply(413,{error:'request_too_large'});
  if(!await verifyWebhook(raw,req.headers.get('X-SMYL-Signature'),Deno.env.get('SMYL_MUSE_WEBHOOK_SECRET'))) return reply(401,{error:'invalid_signature'});
  try {
    const event=JSON.parse(raw);
    if(!uuid(event.event_id)||!uuid(event.tenant_id)||!uuid(event.conversation_id)||!Number.isFinite(Date.parse(event.occurred_at))) return reply(400,{error:'invalid_event'});
    const a=await db.from('smyl_chat_assignments').select('assignee_id,version').eq('tenant_id',event.tenant_id).eq('conversation_id',event.conversation_id).maybeSingle();
    if(a.error) throw new Error('read');
    if(!a.data?.assignee_id) return reply(200,{status:'not_assigned'});
    const c=await db.from('smyl_muse_connections').select('id,tenant_id,user_id,created_at,whatsapp_alerts').eq('tenant_id',event.tenant_id).eq('user_id',a.data.assignee_id).is('revoked_at',null).maybeSingle();
    if(c.error) throw new Error('read');
    if(!c.data || !c.data.whatsapp_alerts || Date.parse(event.occurred_at)<Date.parse(c.data.created_at) || !await allowed(c.data as any,event.conversation_id)) return reply(200,{status:'not_enabled'});
    const saved=await db.from('smyl_muse_alerts').upsert({event_id:event.event_id,tenant_id:event.tenant_id,user_id:a.data.assignee_id,
      conversation_id:event.conversation_id,assignment_version:a.data.version},{onConflict:'tenant_id,event_id',ignoreDuplicates:true});
    if(saved.error) throw new Error('queue');
    return reply(202,{status:'queued'});
  } catch {return reply(503,{error:'event_unavailable'});}
});
