import { lanaRequest, smylAdmin as db } from './lana-linked.ts';
import { chatDto, messageDto } from './muse-core.mjs';
export type MuseConnection = {id:string; tenant_id:string; user_id:string; allow_replies:boolean; whatsapp_alerts:boolean};
export async function allowed(c:MuseConnection, conversation:string|null=null, write=false) {
  const r=await db.rpc('smyl_muse_allowed',{p_connection:c.id,p_conversation:conversation,p_write:write});
  if(r.error) throw new Error('authorization_unavailable');
  return r.data===true;
}
export async function museHeaders(c:MuseConnection, key?:string) {
  const r=await db.from('camila_usuarios').select('nombre').eq('tenant_id',c.tenant_id).eq('id',c.user_id).maybeSingle();
  if(r.error) throw new Error('authorization_unavailable');
  const h=new Headers({'X-SMYL-Actor-Id':c.user_id,'X-SMYL-Actor-Role':c.user_id===c.tenant_id?'owner':'staff',
    'X-SMYL-Actor-Name-Encoded':encodeURIComponent(r.data?.nombre || 'Profesional SMYL')});
  if(key) h.set('Idempotency-Key',key);
  return h;
}
export async function readMuseChat(c:MuseConnection, conversation:string) {
  if(!await allowed(c,conversation)) throw new Error('access_denied');
  // SMYL owns assignments. Read transport as the connector, as lana-inbox does;
  // authorization is checked before AND after transport and only a small DTO leaves SMYL.
  const headers=new Headers({'X-SMYL-Actor-Id':c.tenant_id,'X-SMYL-Actor-Role':'owner','X-SMYL-Actor-Name-Encoded':'SMYL'});
  const r=await lanaRequest(c.tenant_id,`/inbox/conversations/${conversation}/messages?limit=20`,{method:'GET',headers},15000);
  if(!r.response.ok) throw new Error('chat_unavailable');
  const chat=r.body.conversation as Record<string,unknown>;
  if(chat?.id!==conversation || !await allowed(c,conversation)) throw new Error('access_denied');
  return {conversation:chatDto(chat),messages:(Array.isArray(r.body.messages)?r.body.messages:[]).map(messageDto)};
}
export async function audit(c:MuseConnection,action:string,outcome:string,conversation:string|null=null) {
  const r=await db.from('smyl_muse_audit').insert({tenant_id:c.tenant_id,user_id:c.user_id,connection_id:c.id,conversation_id:conversation,action,outcome});
  if(r.error) throw new Error('audit_unavailable');
}
