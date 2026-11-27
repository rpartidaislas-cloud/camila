import { lanaRequest, smylAdmin as db } from '../_shared/lana-linked.ts';
import { hash, token, reply, validateRequest, deliveryResult } from '../_shared/muse-core.mjs';
import { allowed, readMuseChat, museHeaders, audit, type MuseConnection } from '../_shared/muse-inbox.ts';

// Remote API for a private Muse connector; no financial, clinical or general proxy tools.
Deno.serve(async (req:Request) => {
  if(req.method!=='POST') return reply(405,{error:'method_not_allowed'});
  const secret=req.headers.get('Authorization')?.replace(/^Bearer /i,'') || '';
  if(!/^smyl_muse_[a-f0-9]{64}$/.test(secret)) return reply(401,{error:'invalid_connection'});
  const auth=await db.rpc('smyl_muse_authenticate',{p_hash:await hash(secret)});
  if(auth.error) return reply(auth.error.message.includes('MUSE_RATE_LIMIT')?429:503,{error:'connection_unavailable'});
  const c=auth.data?.[0] as MuseConnection;
  if(!c) return reply(401,{error:'connection_disabled_or_expired'});
  try {
    const raw=await req.text();
    if(raw.length>20000) return reply(413,{error:'request_too_large'});
    const input=validateRequest(new URL(req.url).pathname,JSON.parse(raw));
    if(input.action==='list_chats') {
      const r=await db.from('smyl_chat_assignments').select('conversation_id').eq('tenant_id',c.tenant_id)
        .eq('assignee_id',c.user_id).order('updated_at',{ascending:false}).limit(10);
      if(r.error) throw new Error('chat_unavailable');
      const chats=(await Promise.all((r.data || []).map(async row=>
        await allowed(c,row.conversation_id)?(await readMuseChat(c,row.conversation_id)).conversation:null))).filter(Boolean);
      if(!await allowed(c)) throw new Error('access_denied');
      await audit(c,'list_chats','ok');
      const visible=await Promise.all(chats.map(async chat=>await allowed(c,chat!.id)?chat:null));
      return reply(200,{chats:visible.filter(Boolean),limit:10,scope:'assigned_to_me'});
    }
    if(input.action==='read_chat') {
      const result=await readMuseChat(c,input.conversation_id);
      await audit(c,'read_chat','ok',input.conversation_id);
      return reply(200,result);
    }
    if(input.action==='prepare_reply') {
      if(!await allowed(c,input.conversation_id,true)) throw new Error('access_denied');
      const chat=await readMuseChat(c,input.conversation_id);
      const a=await db.from('smyl_chat_assignments').select('version,assignee_id').eq('tenant_id',c.tenant_id).eq('conversation_id',input.conversation_id).single();
      if(a.error || a.data.assignee_id!==c.user_id) throw new Error('access_denied');
      const confirmation=token();
      const r=await db.from('smyl_muse_drafts').insert({connection_id:c.id,conversation_id:input.conversation_id,
        assignment_version:a.data.version,content:input.content.trim(),confirmation_hash:await hash(confirmation)}).select('id,expires_at').single();
      if(r.error) throw new Error('draft_unavailable');
      await audit(c,'prepare_reply','ok',input.conversation_id);
      return reply(200,{draft_id:r.data.id,expires_at:r.data.expires_at,recipient:chat.conversation,
        content:input.content.trim(),confirmation_token:confirmation,requires_human_confirmation:true,
        instruction:'Muestra el destinatario y el texto exacto al doctor. Solicita su aprobación antes de llamar send_reply. No envíes automáticamente.'});
    }
    const claim=await db.rpc('smyl_muse_claim_draft',{p_connection:c.id,p_draft:input.draft_id,p_confirmation:await hash(input.confirmation_token)});
    if(claim.error) return reply(claim.error.code==='42501'?403:409,{error:'reply_not_authorized_or_expired'});
    const d=claim.data;
    if(!d.claimed) return reply(200,{draft_id:d.id,status:d.status,duplicate:true});
    let state='unknown'; let code='transport_unknown';
    try {
      // Revalidate immediately before the consequential operation. LANA also checks assignment,
      // WhatsApp's service window and duplicate keys and pauses AI on a manual reply.
      if(!await allowed(c,d.conversation_id,true)) { state='failed'; code='access_revoked'; }
      else {
        const r=await lanaRequest(c.tenant_id,`/inbox/conversations/${d.conversation_id}/messages`,{
          method:'POST',headers:await museHeaders(c,d.id),body:JSON.stringify({type:'text',content:d.content})},30000);
        ({state,code}=deliveryResult(r.response,r.body));
      }
    } catch { /* Provider may have accepted: never create a new send automatically. */ }
    const saved=await db.from('smyl_muse_drafts').update({status:state,result_code:code,content:'[contenido retirado]',updated_at:new Date().toISOString()}).eq('id',d.id);
    if(saved.error) return reply(503,{draft_id:d.id,status:'unknown',error:'check_smyl_before_retry'});
    await audit(c,'reply',state,d.conversation_id);
    return reply(state==='accepted'?200:state==='unknown'?202:409,{draft_id:d.id,status:state,code,
      ...(state==='unknown'?{instruction:'Revisa el chat en SMYL. No vuelvas a enviar el mismo texto con otra referencia.'}:{})});
  } catch(error) {
    const code=error instanceof Error?error.message:'unavailable';
    if(['invalid_request','confirmation_required'].includes(code) || error instanceof SyntaxError) return reply(400,{error:'invalid_request_or_confirmation'});
    if(code==='access_denied') return reply(403,{error:code});
    return reply(503,{error:'muse_temporarily_unavailable'});
  }
});
