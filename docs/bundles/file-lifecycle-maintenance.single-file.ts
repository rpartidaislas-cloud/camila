// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/file-lifecycle-maintenance/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/auth.ts ──
const { requireUser } = (() => {
// Verificación obligatoria de sesión para Edge Functions privadas.
// Una publishable key identifica el proyecto, pero nunca autentica a una
// persona. Los flujos públicos deben usar funciones separadas con capacidades
// limitadas; nunca deben reutilizar este helper ni aceptar tenant_id del cliente.


// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY vienen inyectadas automáticamente
// en el entorno de toda Edge Function. `segment-teeth` usa nombres propios
// (SB_URL / SB_SERVICE_ROLE_KEY) porque el prefijo SUPABASE_ está reservado
// y no se puede definir a mano en Secrets, así que aceptamos ambos.
const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

interface AuthResult {
  user: { id: string; email?: string } | null;
  // La clínica real de quien llama -- NO uses user.id para topes de gasto,
  // RPCs ni escrituras con tenant_id, usa siempre este campo. Para el dueño
  // coincide con user.id (de siempre); para staff invitado (etapa 4, ver
  // camila_team.sql/camila_usuarios) es la clínica de quien lo invitó.
  // Antes de esto, claude/index.ts y segment-teeth/index.ts usaban user.id
  // directo: camila_consumir_diagnostico nunca encontraba la fila de un
  // staff en camila_tenants (rechazo 402, "no se encontró tu clínica"), y
  // segment-teeth guardaba la segmentación con un tenant_id que no
  // pertenecía a ningún caso real -- se perdía en silencio. null si no hay
  // sesión.
  tenantId: string | null;
  response: Response | null; // si no es null, devuélvela tal cual y no sigas
}

// Mismo patrón que ya usa el cliente (cargarTenantConfig() en
// simulacion.html, continuarConUsuario() en app.html): resuelve si quien
// llama es staff antes de asumir que su propio auth.uid() es el tenant.
async function resolverTenantId(userId: string): Promise<string> {
  const { data, error } = await admin
    .from('camila_usuarios')
    .select('tenant_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data?.tenant_id) return data.tenant_id;
  return userId;
}

async function requireUser(req: Request, cors: Record<string, string>): Promise<AuthResult> {
  const deny = (msg: string) => ({
    user: null,
    tenantId: null,
    response: new Response(JSON.stringify({ error: msg }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    }),
  });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return deny('No autenticado: falta el header Authorization.');

  // Esta llamada corre ANTES de cualquier otro código de la función (incluido
  // el fetchConTimeout de claude/index.ts) -- si se queda colgada sin límite
  // de tiempo, la plataforma mata el proceso a medio camino sin headers de
  // CORS ("CORS error" en el navegador) y ningún timeout más adelante en el
  // código llega siquiera a ejecutarse. Se le pone su propio límite (8s,
  // suficiente para una llamada a la API de Auth de Supabase en condiciones
  // normales) para que, si falla, devuelva una respuesta real con CORS en
  // vez de dejar que la plataforma la corte a ciegas.
  let seTardo = false;
  const timeout = new Promise<{ data: null }>((resolve) => {
    setTimeout(() => { seTardo = true; resolve({ data: null }); }, 8000);
  });
  const { data } = await Promise.race([
    admin.auth.getUser(jwt).catch(() => ({ data: null })),
    timeout,
  ]);
  if (data?.user) {
    try {
      const tenantId = await resolverTenantId(data.user.id);
      return { user: { id: data.user.id, email: data.user.email }, tenantId, response: null };
    } catch (error) {
      console.error('[auth] no se pudo resolver el tenant del usuario:', error instanceof Error ? error.message : 'error desconocido');
      return {
        user: null,
        tenantId: null,
        response: new Response(JSON.stringify({ error: 'No se pudo verificar el acceso a la clínica. Intenta de nuevo.' }), {
          status: 503,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }),
      };
    }
  }

  if (seTardo) return deny('No se pudo verificar la sesión a tiempo (Supabase Auth no respondió). Intenta de nuevo.');

  return deny('No autenticado: la sesión no es válida o ya expiró.');
}

return { requireUser };
})();

// ── _shared/file-security.ts ──
const { FILE_RULES, bytesHex, detectMime, unsafePdf, inspectFile } = (() => {
type FileRule = { max: number; mime: string[] };
const FILE_RULES: Record<string, FileRule> = {
  'smyl-case-photos': { max: 10 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp'] },
  'smyl-radiographs': { max: 20 * 1024 * 1024, mime: ['image/jpeg','image/png'] },
  'smyl-clinical-files': { max: 20 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp','application/pdf'] },
  'smyl-proposal-photos': { max: 8 * 1024 * 1024, mime: ['image/jpeg'] },
  'smyl-professional-cv': { max: 10 * 1024 * 1024, mime: ['application/pdf'] },
  'smyl-professional-cases': { max: 10 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp','application/pdf'] },
};
function bytesHex(bytes: Uint8Array): string { return Array.from(bytes).map((x)=>x.toString(16).padStart(2,'0')).join(''); }
function detectMime(bytes: Uint8Array): string | null {
  if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&bytes[bytes.length-2]===0xff&&bytes[bytes.length-1]===0xd9)return'image/jpeg';
  if(bytes.length>=20&&bytesHex(bytes.slice(0,8))==='89504e470d0a1a0a'&&new TextDecoder().decode(bytes.slice(-8,-4))==='IEND')return'image/png';
  if(bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return'image/webp';
  if(bytes.length>=8&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'&&new TextDecoder().decode(bytes.slice(-2048)).includes('%%EOF'))return'application/pdf';
  return null;
}
function unsafePdf(bytes: Uint8Array): boolean {
  return /\/(JavaScript|JS|OpenAction|Launch|EmbeddedFile|RichMedia|XFA)\b/i.test(new TextDecoder('latin1').decode(bytes));
}
async function inspectFile(bytes: Uint8Array,claimedMime?:string,claimedSize?:number,claimedSha?:string) {
  const mime=detectMime(bytes);
  const sha256=bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
  const reason=claimedSize!==undefined&&bytes.length!==claimedSize?'El tamaño real no coincide.':claimedMime&&mime!==claimedMime?'El tipo real no coincide.':claimedSha&&sha256!==claimedSha?'La huella del archivo no coincide.':mime==='application/pdf'&&unsafePdf(bytes)?'El PDF contiene acciones activas no permitidas.':mime?null:'El formato real no está permitido.';
  return {mime,size:bytes.length,sha256,reason};
}

return { FILE_RULES, bytesHex, detectMime, unsafePdf, inspectFile };
})();

// ── _shared/cors.ts ──
const { makeCors, corsPublic, corsHeaders } = (() => {
// Orígenes autorizados para funciones privadas (autenticadas).
// Las funciones públicas (webhooks, portales de paciente) usan corsPublic o "*" directamente.
const ALLOWED_ORIGINS = new Set([
  'https://app.smyldesign.ai',
  'https://rpartidaislas-cloud.github.io',
]);

// Para funciones privadas: refleja el origen si está en la lista; si no, bloquea con el origen
// principal. Siempre incluye Vary:Origin para que las cachés no reutilicen respuestas entre orígenes.
function makeCors(req: Request, methods = 'POST, OPTIONS'): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://app.smyldesign.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': methods,
    'Vary': 'Origin',
  };
}

// Para endpoints públicos que legítimamente necesitan "*" (portales de paciente, formularios públicos).
const corsPublic: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Alias de compatibilidad hacia atrás (stripe-checkout, stripe-portal).
const corsHeaders = corsPublic;

return { makeCors, corsPublic, corsHeaders };
})();

// ── file-lifecycle-maintenance/index.ts ──
// Mantenimiento oportunista por clínica: limpia cargas abandonadas y reanaliza legado.

const URL=Deno.env.get('SUPABASE_URL')||Deno.env.get('SB_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SB_SERVICE_ROLE_KEY')||'';
const admin=createClient(URL,SERVICE);

Deno.serve(async(req:Request)=>{
  const CORS=makeCors(req);
  const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
  const auth=await requireUser(req,CORS);if(auth.response)return auth.response;
  const tenant=auth.tenantId!,actor=auth.user!.id,started=new Date();
  try{
    const previous=await admin.from('smyl_file_maintenance_runs').select('last_started_at').eq('tenant_id',tenant).maybeSingle();
    if(previous.error)throw previous.error;
    if(previous.data&&Date.now()-Date.parse(previous.data.last_started_at)<12*60*60*1000)return reply(200,{ok:true,skipped:true});
    const begun=await admin.from('smyl_file_maintenance_runs').upsert({tenant_id:tenant,last_started_at:started.toISOString(),last_finished_at:null,deleted_count:0,rescanned_count:0,review_count:0,error_count:0},{onConflict:'tenant_id'});
    if(begun.error)throw begun.error;

    let deleted=0,rescanned=0,review=0,errors=0;
    const cleanup=await admin.rpc('smyl_file_cleanup_candidates',{p_tenant:tenant,p_limit:50});
    if(cleanup.error)throw cleanup.error;
    for(const item of cleanup.data||[]){
      try{
        const removed=await admin.storage.from(item.bucket_id).remove([item.object_path]);
        if(removed.error)throw removed.error;
        const confirmation=await admin.storage.from(item.bucket_id).download(item.object_path);
        if(!confirmation.error)throw new Error('El objeto continúa disponible después del borrado.');
        const logged=await admin.rpc('smyl_record_file_deletion',{p_tenant:tenant,p_bucket:item.bucket_id,p_path:item.object_path,p_reason:item.reason,p_existed:Array.isArray(removed.data)&&removed.data.length>0,p_actor:actor});
        if(logged.error)throw logged.error;deleted++;
      }catch(error){errors++;console.error('[file-lifecycle] cleanup',item.bucket_id,error instanceof Error?error.message:'error');}
    }

    const legacy=await admin.rpc('smyl_file_legacy_candidates',{p_tenant:tenant,p_limit:3});
    if(legacy.error)throw legacy.error;
    for(const item of legacy.data||[]){
      try{
        const rule=FILE_RULES[item.bucket_id];
        const downloaded=await admin.storage.from(item.bucket_id).download(item.object_path);
        if(downloaded.error||!downloaded.data)throw downloaded.error||new Error('Objeto no disponible');
        const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
        const inspected=await inspectFile(bytes);
        const reason=!rule||!inspected.mime||!rule.mime.includes(inspected.mime)?'El tipo histórico requiere revisión.':bytes.length>rule.max?'El tamaño histórico excede el límite actual.':inspected.reason;
        const saved=await admin.from('smyl_file_security').update({status:reason?'legacy_review':'clean',verified_mime_type:inspected.mime,verified_size_bytes:inspected.size,verified_sha256:inspected.sha256,rejection_reason:reason,last_checked_at:new Date().toISOString(),check_attempts:1,verified_by:actor,verified_at:reason?null:new Date().toISOString()}).eq('tenant_id',tenant).eq('bucket_id',item.bucket_id).eq('object_path',item.object_path).eq('status','legacy');
        if(saved.error)throw saved.error;rescanned++;if(reason)review++;
      }catch(error){
        errors++;review++;
        await admin.from('smyl_file_security').update({status:'legacy_review',rejection_reason:'No se pudo reanalizar el objeto histórico.',last_checked_at:new Date().toISOString(),check_attempts:1}).eq('tenant_id',tenant).eq('bucket_id',item.bucket_id).eq('object_path',item.object_path).eq('status','legacy');
        console.error('[file-lifecycle] legacy',item.bucket_id,error instanceof Error?error.message:'error');
      }
    }
    const finished=await admin.from('smyl_file_maintenance_runs').update({last_finished_at:new Date().toISOString(),deleted_count:deleted,rescanned_count:rescanned,review_count:review,error_count:errors}).eq('tenant_id',tenant);
    if(finished.error)throw finished.error;
    return reply(200,{ok:true,skipped:false,deleted,rescanned,review,errors});
  }catch(error){
    console.error('[file-lifecycle-maintenance]',error instanceof Error?error.message:'error desconocido');
    await admin.from('smyl_file_maintenance_runs').update({last_finished_at:new Date().toISOString(),error_count:1}).eq('tenant_id',tenant).eq('last_started_at',started.toISOString());
    return reply(500,{error:'No se pudo completar el mantenimiento de archivos.'});
  }
});
