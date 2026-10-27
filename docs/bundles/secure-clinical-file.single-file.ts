// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/secure-clinical-file/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/auth-membership.ts ──
const { decidirMembresia } = (() => {
// Decisión pura (sin red) sobre la membresía de quien llama a una Edge Function privada.
// Vive aparte de auth.ts para poder probarla sin Deno ni Supabase.
//
// `row` es la fila de camila_usuarios de la persona (o null si no tiene: el dueño de siempre
// es una cuenta cuyo id = tenant_id y puede no tener fila). Si la fila existe pero está
// desactivada, la persona ya no pertenece al equipo: no se le resuelve ninguna clínica
// (antes se ignoraba `activo` y un staff dado de baja seguía usando las funciones con el
// service role).
interface FilaMembresia {
  tenant_id?: string | null;
  activo?: boolean | null;
}

type DecisionMembresia = { tenantId: string } | { inactivo: true };

function decidirMembresia(row: FilaMembresia | null | undefined, userId: string): DecisionMembresia {
  if (row && row.activo === false) return { inactivo: true };
  if (row?.tenant_id) return { tenantId: row.tenant_id };
  return { tenantId: userId };
}

return { decidirMembresia };
})();

// ── _shared/auth.ts ──
const { requireUser, requirePermission } = (() => {
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
// Si la persona tiene fila en camila_usuarios pero está desactivada, ya no pertenece al equipo y no
// se le resuelve ninguna clínica (decidirMembresia, _shared/auth-membership.ts).
async function resolverMembresia(userId: string): Promise<DecisionMembresia> {
  const { data, error } = await admin
    .from('camila_usuarios')
    .select('tenant_id, activo')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return decidirMembresia(data, userId);
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
      const membresia = await resolverMembresia(data.user.id);
      if ('inactivo' in membresia) {
        return {
          user: null,
          tenantId: null,
          response: new Response(JSON.stringify({ error: 'Tu acceso a esta clínica está desactivado. Pide al dueño que lo reactive.' }), {
            status: 403,
            headers: { ...cors, 'Content-Type': 'application/json' },
          }),
        };
      }
      return { user: { id: data.user.id, email: data.user.email }, tenantId: membresia.tenantId, response: null };
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

// Exige un permiso del modelo de roles de SMYL (smyl_member_roles / smyl_role_permissions) además de
// la sesión. El dueño (user.id === tenantId) siempre pasa; el staff solo si su rol activo tiene el
// permiso. Falla cerrado: si la consulta falla, se niega. Devuelve una Response para regresar tal
// cual, o null si se puede continuar.
async function requirePermission(
  auth: AuthResult,
  cors: Record<string, string>,
  permission: string,
): Promise<Response | null> {
  const reply = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (!auth.user || !auth.tenantId) return reply(401, 'Necesitas iniciar sesión.');
  if (auth.user.id === auth.tenantId) return null;
  const { data, error } = await admin.rpc('smyl_actor_has_permission_explicit', {
    p_actor: auth.user.id,
    p_tenant: auth.tenantId,
    p_permission: permission,
  });
  if (error) {
    console.error('[auth] no se pudo verificar el permiso:', error.message);
    return reply(503, 'No se pudo verificar tu permiso. Intenta de nuevo.');
  }
  if (data !== true) return reply(403, 'Tu rol no tiene permiso para esta acción.');
  return null;
}

return { requireUser, requirePermission };
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

// ── secure-clinical-file/index.ts ──
// Verifica archivos privados recién subidos antes de que puedan vincularse a datos clínicos.
const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

async function mark(bucket: string,path: string,tenant: string,status: 'clean'|'rejected',details: Record<string, unknown>) {
  const checkedAt=new Date().toISOString();
  const row = { bucket_id: bucket, object_path: path, tenant_id: tenant, status, ...details, verified_at: checkedAt,last_checked_at:checkedAt,check_attempts:1 };
  const saved = await admin.from('smyl_file_security').upsert(row,{ onConflict:'bucket_id,object_path' });
  if (saved.error) throw saved.error;
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const reply = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response('ok',{ headers:CORS });
  if (req.method !== 'POST') return reply(405,{ error:'Método no permitido.' });
  const auth = await requireUser(req,CORS);
  if (auth.response) return auth.response;
  try {
    const body = await req.json();
    const bucket = String(body?.bucket || '');
    const path = String(body?.path || '');
    const claimedMime = String(body?.mime_type || '').toLowerCase();
    const claimedSize = Number(body?.size_bytes);
    const claimedSha = String(body?.sha256 || '').toLowerCase();
    const rule = FILE_RULES[bucket];
    if (!rule || !path || path.length>700 || path.startsWith('/') || path.includes('..') || path.split('/')[0]!==auth.tenantId) return reply(400,{ error:'Ruta de archivo no válida.' });
    if (!rule.mime.includes(claimedMime) || !Number.isSafeInteger(claimedSize) || claimedSize<16 || claimedSize>rule.max || !/^[0-9a-f]{64}$/.test(claimedSha)) return reply(400,{ error:'Metadatos de archivo no válidos.' });
    const downloaded = await admin.storage.from(bucket).download(path);
    if (downloaded.error || !downloaded.data) return reply(404,{ error:'No se encontró el archivo privado.' });
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const inspected=await inspectFile(bytes,claimedMime,claimedSize,claimedSha);
    const mime=inspected.mime,sha=inspected.sha256,rejected=inspected.reason;
    if (rejected) {
      await mark(bucket,path,auth.tenantId!,'rejected',{ verified_mime_type:mime,verified_size_bytes:bytes.length,verified_sha256:sha,rejection_reason:rejected,verified_by:auth.user!.id });
      await admin.storage.from(bucket).remove([path]);
      return reply(422,{ error:'El archivo no superó la verificación de seguridad.' });
    }
    await mark(bucket,path,auth.tenantId!,'clean',{ verified_mime_type:mime,verified_size_bytes:bytes.length,verified_sha256:sha,rejection_reason:null,verified_by:auth.user!.id });
    return reply(200,{ ok:true,mime_type:mime,size_bytes:bytes.length,sha256:sha });
  } catch (error) {
    console.error('[secure-clinical-file]',error instanceof Error?error.message:'error desconocido');
    return reply(500,{ error:'No se pudo verificar el archivo. Intenta de nuevo.' });
  }
});
