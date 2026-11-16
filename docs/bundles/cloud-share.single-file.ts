// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/cloud-share/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/cloud-share-core.mjs ──
const { DIAS_PERMITIDOS, DIAS_POR_DEFECTO, MAX_INTENTOS_CODIGO, MAX_ENLACES_ACTIVOS_POR_ARCHIVO, TOKEN_RE, UUID_RE, CODIGO_RE, aleatorioHex, sha256Hex, codigoAleatorio, hashDeCodigo, diasValidos, venceEn, estadoDelEnlace, enlaceDisponible, vistaPublica } = (() => {
// Lógica pura de los enlaces de la Nube (sin Deno ni red): token, código, vigencia, estado y vista pública.
const DIAS_PERMITIDOS = [1, 7, 30];
const DIAS_POR_DEFECTO = 7;
const MAX_INTENTOS_CODIGO = 5;
const MAX_ENLACES_ACTIVOS_POR_ARCHIVO = 10;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_RE = /^[0-9]{6}$/;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

function aleatorioHex(bytes: any) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
async function sha256Hex(texto: any) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(texto)))); }

// Código de 6 dígitos sin sesgo de módulo (rechazo de valores altos).
function codigoAleatorio() {
  const limite = 4294967296 - (4294967296 % 1000000);
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    if (n < limite) return String(n % 1000000).padStart(6, "0");
  }
}
const hashDeCodigo = (sal, codigo) => sha256Hex(`${sal}:${codigo}`);
function diasValidos(valor: any) {
  const n = Number(valor);
  return DIAS_PERMITIDOS.includes(n) ? n : null;
}
function venceEn(dias: any, ahora = Date.now()) { return new Date(ahora + dias * 86400000).toISOString(); }

// 'active' | 'expired' | 'revoked' | 'locked' (bloqueado por demasiados códigos incorrectos).
function estadoDelEnlace(enlace: any, ahora = Date.now()) {
  if (!enlace) return "missing";
  if (enlace.revoked_at) return "revoked";
  if (Date.parse(enlace.expires_at) <= ahora) return "expired";
  if ((enlace.failed_attempts || 0) >= MAX_INTENTOS_CODIGO) return "locked";
  return "active";
}
// Un enlace caducado, revocado o bloqueado se ve igual que uno que no existe: no se revela nada.
const enlaceDisponible = (enlace, ahora) => estadoDelEnlace(enlace, ahora) === "active";

function vistaPublica({ nombre, mime: any, size: any, clinica: any, url: any, expires_at }) {
  return { name: nombre, mime_type: mime, size_bytes: size, clinic: clinica || "", url, expires_at };
}

return { DIAS_PERMITIDOS, DIAS_POR_DEFECTO, MAX_INTENTOS_CODIGO, MAX_ENLACES_ACTIVOS_POR_ARCHIVO, TOKEN_RE, UUID_RE, CODIGO_RE, aleatorioHex, sha256Hex, codigoAleatorio, hashDeCodigo, diasValidos, venceEn, estadoDelEnlace, enlaceDisponible, vistaPublica };
})();

// ── cloud-share/index.ts ──
// Compartir un archivo de la Nube con un enlace privado.
//   - Personal (JWT + cloud.share + poder ver el archivo): create | revoke
//   - Público (token opaco, sin sesión):                  view   -> URL firmada de 2 minutos; opcional código de 6 dígitos.
// El token solo existe en el enlace que recibe la persona: en la base solo se guarda su SHA-256. Cada acceso queda en bitácora.

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const APP_ORIGIN = "https://app.smyldesign.ai";
const MAX_BODY = 4096;
const NO_DISPONIBLE = "Este enlace no existe o ya no está disponible.";

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

function json(cors: Record<string, string>, status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
const evento = (tenant: string, shareId: string, tipo: string) =>
  admin.from("smyl_cloud_share_events").insert({ tenant_id: tenant, share_id: shareId, event: tipo }).then(() => null, () => null);

async function accionesPersonal(req: Request, body: Json, CORS: Record<string, string>): Promise<Response> {
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(CORS, 401, { error: "Sesión requerida." });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });

  if (body.action === "revoke") {
    const id = body.share_id;
    if (typeof id !== "string" || !UUID_RE.test(id)) return json(CORS, 400, { error: "Enlace inválido." });
    const { data: share } = await admin.from("smyl_cloud_shares").select("id, file_id, revoked_at").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (!share) return json(CORS, 404, { error: "Enlace no encontrado." });
    const { data: puede } = await asUser.rpc("smyl_cloud_can_share", { p_file_id: share.file_id });
    if (puede !== true) return json(CORS, 403, { error: "Tu rol no permite administrar los enlaces de este archivo." });
    if (!share.revoked_at) {
      await admin.from("smyl_cloud_shares").update({ revoked_at: new Date().toISOString(), revoked_by: user.id }).eq("id", id).is("revoked_at", null);
      await evento(tenantId, id, "revoked");
    }
    return json(CORS, 200, { ok: true });
  }

  if (body.action !== "create") return json(CORS, 400, { error: "Acción no válida." });
  const fileId = body.file_id;
  if (typeof fileId !== "string" || !UUID_RE.test(fileId)) return json(CORS, 400, { error: "Archivo inválido." });
  const dias = body.days === undefined ? DIAS_POR_DEFECTO : diasValidos(body.days);
  if (!dias) return json(CORS, 400, { error: "La vigencia debe ser de 1, 7 o 30 días." });
  const { data: puede } = await asUser.rpc("smyl_cloud_can_share", { p_file_id: fileId });
  if (puede !== true) return json(CORS, 403, { error: "Tu rol no permite compartir este archivo." });

  const { count } = await admin.from("smyl_cloud_shares").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("file_id", fileId).is("revoked_at", null).gt("expires_at", new Date().toISOString());
  if ((count || 0) >= MAX_ENLACES_ACTIVOS_POR_ARCHIVO) return json(CORS, 409, { error: "Este archivo ya tiene demasiados enlaces activos. Revoca alguno primero." });

  const token = aleatorioHex(32);
  const conCodigo = body.with_code === true;
  const codigo = conCodigo ? codigoAleatorio() : null;
  const sal = conCodigo ? aleatorioHex(8) : null;
  const expiresAt = venceEn(dias);
  const { data: share, error } = await admin.from("smyl_cloud_shares").insert({
    tenant_id: tenantId, file_id: fileId, token_hash: await sha256Hex(token), expires_at: expiresAt, created_by: user.id,
    code_hash: conCodigo ? await hashDeCodigo(sal, codigo) : null, code_salt: sal,
  }).select("id").single();
  if (error || !share) return json(CORS, 500, { error: "No se pudo crear el enlace." });
  await evento(tenantId, share.id, "created");
  // El código se entrega UNA sola vez; después solo existe su hash.
  return json(CORS, 200, { share_id: share.id, url: `${APP_ORIGIN}/compartido.html#t=${token}`, code: codigo, expires_at: expiresAt });
}

async function vistaDelEnlace(body: Json, CORS: Record<string, string>): Promise<Response> {
  const token = body.token;
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return json(CORS, 404, { error: NO_DISPONIBLE });
  const { data: share } = await admin.from("smyl_cloud_shares").select("*").eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (estadoDelEnlace(share) !== "active") return json(CORS, 404, { error: NO_DISPONIBLE });

  if (share.requires_code) {
    const codigo = typeof body.code === "string" ? body.code.trim() : "";
    if (!codigo) return json(CORS, 200, { needs_code: true });
    const correcto = CODIGO_RE.test(codigo) && (await hashDeCodigo(share.code_salt, codigo)) === share.code_hash;
    if (!correcto) {
      const intentos = (share.failed_attempts || 0) + 1;
      await admin.from("smyl_cloud_shares").update({ failed_attempts: intentos }).eq("id", share.id);
      await evento(share.tenant_id, share.id, intentos >= MAX_INTENTOS_CODIGO ? "locked" : "code_failed");
      if (intentos >= MAX_INTENTOS_CODIGO) return json(CORS, 404, { error: NO_DISPONIBLE });
      return json(CORS, 403, { error: "Código incorrecto.", attempts_left: MAX_INTENTOS_CODIGO - intentos });
    }
  }

  const { data: file } = await admin.from("smyl_cloud_files").select("display_name, storage_path, mime_type, size_bytes, status")
    .eq("tenant_id", share.tenant_id).eq("id", share.file_id).maybeSingle();
  if (!file || file.status !== "active") return json(CORS, 404, { error: NO_DISPONIBLE });
  const { data: firmada, error: errFirma } = await admin.storage.from("smyl-cloud").createSignedUrl(file.storage_path, 120);
  if (errFirma || !firmada?.signedUrl) return json(CORS, 404, { error: NO_DISPONIBLE });
  const { data: clinica } = await admin.from("camila_tenants").select("nombre").eq("id", share.tenant_id).maybeSingle();

  await admin.from("smyl_cloud_shares").update({ view_count: (share.view_count || 0) + 1, last_viewed_at: new Date().toISOString(), failed_attempts: 0 }).eq("id", share.id);
  await evento(share.tenant_id, share.id, "viewed");
  return json(CORS, 200, vistaPublica({ nombre: file.display_name, mime: file.mime_type, size: file.size_bytes, clinica: clinica?.nombre, url: firmada.signedUrl, expires_at: share.expires_at }));
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(CORS, 413, { error: "Solicitud demasiado grande." });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  if (body.action === "view") return await vistaDelEnlace(body, CORS);
  return await accionesPersonal(req, body, CORS);
});
