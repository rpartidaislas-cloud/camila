import { smylAdmin as db, lanaRequest } from '../_shared/lana-linked.ts';
import { reply, deliveryResult } from '../_shared/muse-core.mjs';
import { allowed, type MuseConnection } from '../_shared/muse-inbox.ts';
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const TEMPLATE='smyl_chat_pendiente_profesional_v1';
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST' || !service || req.headers.get('Authorization')!==`Bearer ${service}`) return reply(401,{error:'unauthorized'});
  const cleanup=await db.rpc('smyl_muse_cleanup');
  const claimed=await db.rpc('smyl_muse_claim_alerts');
  if(cleanup.error || claimed.error) return reply(503,{error:'queue_unavailable'});
  for(const job of claimed.data || []) {
    let state='pending',code='preflight_unavailable',attempted=false;
    try {
      const [connection,assignment,professional]=await Promise.all([
        db.from('smyl_muse_connections').select('id,tenant_id,user_id,whatsapp_alerts').eq('tenant_id',job.tenant_id).eq('user_id',job.user_id).is('revoked_at',null).maybeSingle(),
        db.from('smyl_chat_assignments').select('assignee_id,version').eq('tenant_id',job.tenant_id).eq('conversation_id',job.conversation_id).maybeSingle(),
        db.from('smyl_professionals').select('id').eq('tenant_id',job.tenant_id).eq('user_id',job.user_id).eq('active',true).maybeSingle()]);
      if(connection.error||assignment.error||professional.error) throw new Error('preflight');
      const c=connection.data as MuseConnection;
      if(!c?.whatsapp_alerts || assignment.data?.assignee_id!==job.user_id || assignment.data?.version!==job.assignment_version || !await allowed(c,job.conversation_id)) {state='skipped';code='access_changed';}
      else if(!professional.data) {state='skipped';code='professional_missing';}
      else {
        const link=await db.from('smyl_professional_whatsapp_links').select('lana_conversation_id,linked_by').eq('tenant_id',job.tenant_id).eq('professional_id',professional.data.id).eq('active',true).maybeSingle();
        if(link.error) throw new Error('preflight');
        if(!link.data || link.data.linked_by!==job.user_id) {code='whatsapp_link_required';}
        else {
          // System notification to the doctor's verified channel, never a patient reply.
          const headers=new Headers({'X-SMYL-Actor-Id':job.tenant_id,'X-SMYL-Actor-Role':'owner',
            'X-SMYL-Actor-Name-Encoded':'Avisos%20SMYL','Idempotency-Key':job.id});
          const templates=await lanaRequest(job.tenant_id,'/inbox/whatsapp/templates?status=all',{method:'GET',headers},10000);
          if(!templates.response.ok) throw new Error('preflight');
          const template=(templates.body.templates as any[] || []).find(t=>t.name===TEMPLATE && t.status==='APPROVED' && t.category==='UTILITY');
          if(!template) {code='approved_template_required';}
          else if(!await allowed(c,job.conversation_id)) {state='skipped';code='access_changed';}
          else {
            attempted=true;
            const r=await lanaRequest(job.tenant_id,`/inbox/conversations/${link.data.lana_conversation_id}/messages`,{
              method:'POST',headers,body:JSON.stringify({type:'template',template_id:template.id,template_variables:[]})},30000);
            ({state,code}=deliveryResult(r.response,r.body));
          }
        }
      }
    } catch {if(attempted) {state='unknown';code='transport_unknown';}}
    if(state==='pending' && job.attempts>=8) state='failed';
    await db.from('smyl_muse_alerts').update({status:state,result_code:code,updated_at:new Date().toISOString(),
      next_attempt_at:new Date(Date.now()+Math.min(3600,60*2**job.attempts)*1000).toISOString()}).eq('id',job.id);
  }
  return reply(200,{processed:claimed.data?.length || 0});
});
