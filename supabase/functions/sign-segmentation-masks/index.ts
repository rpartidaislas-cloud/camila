// Renueva enlaces breves de máscaras dentales privadas al reabrir un caso.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requirePermission, requireUser } from '../_shared/auth.ts';
import { makeCors } from '../_shared/cors.ts';
const SB_URL=Deno.env.get('SUPABASE_URL')||Deno.env.get('SB_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SB_SERVICE_ROLE_KEY')||'';
const admin=createClient(SB_URL,SERVICE);
const BUCKET='camila-masks';
function safeMasks(value: unknown,caseId: string): Array<Record<string,unknown>> {
  if(!value||typeof value!=='object')return [];
  const rows=Array.isArray((value as {masks?:unknown}).masks)?(value as {masks:unknown[]}).masks:[];
  return rows.filter((row):row is Record<string,unknown>=>{
    if(!row||typeof row!=='object')return false;
    const path=String((row as Record<string,unknown>).maskPath||'');
    return path.startsWith(caseId+'/')&&/^[0-9a-f-]{36}\/(mask|gum_mask)_\d+\.svg$/.test(path);
  }).slice(0,100);
}
async function renew(rows:Array<Record<string,unknown>>) {
  if(!rows.length)return rows;
  const paths=rows.map((row)=>String(row.maskPath));
  const signed=await admin.storage.from(BUCKET).createSignedUrls(paths,300);
  if(signed.error||!signed.data||signed.data.length!==rows.length)throw signed.error||new Error('Firma incompleta');
  return rows.map((row,index)=>({...row,maskUrl:signed.data[index].signedUrl}));
}

Deno.serve(async(req:Request)=>{
  const CORS=makeCors(req);
  const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
  const auth=await requireUser(req,CORS);if(auth.response)return auth.response;
  const sinPermiso=await requirePermission(auth,CORS,'clinical.read');if(sinPermiso)return sinPermiso;
  try{
    const body=await req.json();const caseId=String(body?.case_id||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(caseId))return reply(400,{error:'Caso no válido.'});
    const found=await admin.from('camila_casos').select('segmentacion,segmentacion_encia').eq('id',caseId).eq('tenant_id',auth.tenantId).maybeSingle();
    if(found.error)throw found.error;if(!found.data)return reply(404,{error:'Caso no disponible.'});
    const masks=await renew(safeMasks(found.data.segmentacion,caseId));
    const gumMasks=await renew(safeMasks(found.data.segmentacion_encia,caseId));
    return reply(200,{masks,gum_masks:gumMasks,expires_in:300});
  }catch(error){console.error('[sign-segmentation-masks]',error instanceof Error?error.message:'error desconocido');return reply(500,{error:'No se pudieron renovar las máscaras privadas.'});}
});
