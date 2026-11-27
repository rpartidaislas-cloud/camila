export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
export const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function reply(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
}
export function validateAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_request');
  const fields = {
    list_chats: ['action'], read_chat:['action','conversation_id'],
    prepare_reply:['action','conversation_id','content'],
    send_reply:['action','draft_id','confirmation_token','confirmed']
  }[body.action];
  if (!fields || Object.keys(body).some(k => !fields.includes(k))) throw new Error('invalid_request');
  if (fields.includes('conversation_id') && !uuid(body.conversation_id)) throw new Error('invalid_request');
  if (body.action==='prepare_reply' && (typeof body.content!=='string' || !body.content.trim() || body.content.length>4000)) throw new Error('invalid_request');
  if (body.action==='send_reply' && (!uuid(body.draft_id) || body.confirmed!==true || !/^[a-f0-9]{64}$/.test(body.confirmation_token || ''))) throw new Error('confirmation_required');
  return body;
}
export function validateRequest(pathname, body) {
  const routes={'/chats':'list_chats','/chat':'read_chat','/reply/prepare':'prepare_reply','/reply/send':'send_reply'};
  const prefix='/muse-connector';
  const index=pathname.lastIndexOf(prefix);
  const action=index<0?null:routes[pathname.slice(index+prefix.length)];
  if(!action || !body || typeof body!=='object' || Array.isArray(body) || Object.hasOwn(body,'action')) throw new Error('invalid_request');
  return validateAction({...body,action});
}
// Deliberate DTO allowlist: no inbox actor, phone, finance, clinical context or media URLs.
export function chatDto(c) {
  return {id:c.id, name:c.contact_name || c.name || 'Paciente', channel:c.channel || '', unread_count:Number(c.unread_count)||0};
}
export function messageDto(m) {
  return {id:m.id, role:m.role, type:m.media_type || m.type || 'text', text:typeof m.content==='string' ? m.content.slice(0,4000) : '', created_at:m.created_at};
}
export function deliveryResult(response, body) {
  const known=['send_unknown','send_in_progress','whatsapp_window_expired','provider_rejected','inbox_forbidden','inbox_rate_limited'];
  const code=known.includes(body?.code)?body.code:`lana_${response.status}`;
  if(response.ok && body?.ok===true) return {state:'accepted',code:'accepted_by_lana'};
  if(['send_unknown','send_in_progress'].includes(code) || (response.status>=500 && code!=='provider_rejected') || response.ok) return {state:'unknown',code};
  return {state:'failed',code};
}
export async function verifyWebhook(raw, signature, secret, now = Date.now()) {
  if (!secret || secret.length<32 || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes = Uint8Array.from(signature.slice(7).match(/../g), s => parseInt(s,16));
  if (!await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(raw))) return false;
  try { const t=Date.parse(JSON.parse(raw).sent_at); return Number.isFinite(t) && Math.abs(now-t)<300000; } catch { return false; }
}
