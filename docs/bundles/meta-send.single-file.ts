// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/meta-send/index.ts con sus archivos de _shared incluidos,
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

// ── meta-send/index.ts ──
// supabase/functions/meta-send/index.ts
//
// El dentista/staff responde desde la bandeja de Mensajes de app.html (aún
// sin construir, ver docs/HANDOFF.md etapa 5) -- esta función busca el
// canal correcto de la conversación y llama al endpoint de envío que
// corresponda en Meta (WhatsApp Cloud API / Messenger Send API / Instagram
// Messaging API -- las tres comparten casi el mismo formato de request vía
// Graph API, solo cambia el shape del body).
//
// Arquitectura MULTI-TENANT (decisión del usuario 2026-08-06, mismo
// patrón que su otro producto "LANA"): un solo token de un System User
// "Tech Provider" (META_TOKEN, Secret compartido) firma las llamadas para
// TODAS las clínicas -- camila_canales solo guarda el id_externo
// (phone_number_id/page_id/ig_business_id) de cada una, nunca un token por
// fila. Si algún día se agrega Embedded Signup para que cada dentista
// conecte su propia cuenta, esto no cambia -- solo cambia CÓMO se llena
// camila_canales (autoservicio en vez de INSERT manual).
//
// No probado en vivo -- necesita credenciales reales de Meta.


const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";

// Token PERMANENTE del System User -- el mismo para todas las clínicas.
// NUNCA se guarda en camila_canales ni se manda al cliente.
const META_TOKEN = Deno.env.get("META_TOKEN") || "";

const GRAPH_VERSION = "v21.0";

async function enviarWhatsApp(phoneNumberId: string, para: string, texto: string): Promise<string | null> {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${META_TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "Error enviando WhatsApp");
  return data.messages?.[0]?.id ?? null;
}

async function enviarMessengerOInstagram(pageOrIgId: string, para: string, texto: string): Promise<string | null> {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageOrIgId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${META_TOKEN}` },
    body: JSON.stringify({ recipient: { id: para }, message: { text: texto } }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "Error enviando mensaje");
  return data.message_id ?? null;
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const jsonError = (status: number, msg: string): Response =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError(405, "Método no permitido.");

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  const { user, tenantId } = auth;
  if (!user || !tenantId) return jsonError(401, "Necesitas iniciar sesión.");
  // Enviar mensajes como la clínica exige el permiso de responder, no solo ser miembro.
  const sinPermiso = await requirePermission(auth, CORS, "messages.respond");
  if (sinPermiso) return sinPermiso;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body inválido.");
  }
  const conversacionId = String(body?.conversacionId || "");
  const texto = String(body?.texto || "").trim();
  if (!conversacionId || !texto) return jsonError(400, "Falta conversacionId o texto.");

  // Confirma que la conversación pertenece a la clínica de quien llama --
  // requireUser ya resuelve el tenant real (dueño o staff), pero hay que
  // verificar la fila específica igual que el resto de las Edge Functions
  // hacen con camila_casos.
  const { data: conv, error: convErr } = await admin
    .from("camila_conversaciones")
    .select("id, tenant_id, contacto_id_externo, canal_id")
    .eq("id", conversacionId)
    .maybeSingle();
  if (convErr || !conv || conv.tenant_id !== tenantId) {
    return jsonError(403, "Esa conversación no pertenece a tu clínica.");
  }

  const { data: canalRow, error: canalErr } = await admin
    .from("camila_canales")
    .select("canal, id_externo")
    .eq("id", conv.canal_id)
    .maybeSingle();
  if (canalErr || !canalRow) return jsonError(500, "No se encontró el canal de esta conversación.");

  try {
    const idExternoMeta =
      canalRow.canal === "whatsapp"
        ? await enviarWhatsApp(canalRow.id_externo, conv.contacto_id_externo, texto)
        : await enviarMessengerOInstagram(canalRow.id_externo, conv.contacto_id_externo, texto);

    await admin.from("camila_mensajes").insert({
      conversacion_id: conversacionId,
      direccion: "saliente",
      autor: "staff",
      texto,
      id_externo_meta: idExternoMeta,
    });
    await admin
      .from("camila_conversaciones")
      .update({ ultimo_mensaje_en: new Date().toISOString(), ultimo_mensaje_texto: texto })
      .eq("id", conversacionId);

    let usage = null;
    if (canalRow.canal === "whatsapp") {
      const usageResult = await admin.rpc("smyl_consume", {
        p_tenant_id: tenantId,
        p_resource: "whatsapp_messages",
        p_quantity_units: 1,
        p_idempotency_key: `meta-send:${idExternoMeta || crypto.randomUUID()}`,
        p_source_type: "meta_send",
        p_source_id: idExternoMeta || conversacionId,
        p_provider: "meta",
        p_provider_model: canalRow.canal,
        p_metadata: { conversacion_id: conversacionId },
        p_enforce: CONSUMABLES_ENFORCED,
      });
      usage = usageResult.data;
      if (usageResult.error) console.error("[meta-send] medición pendiente:", usageResult.error.message);
    }

    return new Response(JSON.stringify({ ok: true, usage: usage?.[0] || null }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[meta-send] error:", (e as Error).message);
    return jsonError(500, "No se pudo enviar el mensaje: " + (e as Error).message);
  }
});
