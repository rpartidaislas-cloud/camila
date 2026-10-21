// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/invite-staff/index.ts con sus archivos de _shared incluidos,
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

// ── invite-staff/index.ts ──
// supabase/functions/invite-staff/index.ts
//
// Etapa 4 de infraestructura multi-tenant: el dueño de una clínica invita
// a alguien de su staff por correo. Usa admin.inviteUserByEmail (requiere
// service_role, por eso vive en una Edge Function y no puede llamarse
// desde el cliente) -- Supabase manda un correo con un link mágico; quien
// lo abre llega con una sesión ya activa y solo le falta poner contraseña
// (ver el manejo de ?invite=1 en app.html).
//
// El vínculo con la clínica del dueño viaja en los metadatos del usuario
// invitado (tenant_id_invitado) -- el trigger camila_crear_tenant_en_signup
// (ver camila_team.sql) lo lee al crearse la cuenta y, en vez de montar una
// clínica nueva, inserta una fila en camila_usuarios con rol 'staff'
// apuntando a esa clínica.


const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://rpartidaislas-cloud.github.io/camila";

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

// Mismos topes que anuncian los planes en app.html (PLANES.*.features:
// "1 usuario" / "3 usuarios" / "Usuarios ilimitados") -- si no se hiciera
// cumplir aquí, el número de usuarios por plan sería solo un texto de
// marketing sin ningún efecto real.
const LIMITE_USUARIOS_POR_PLAN: Record<string, number> = {
  esencial: 1,
  profesional: 3,
  // premium: sin tope (no aparece aquí a propósito, ver chequeo abajo).
};

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const jsonError = (status: number, msg: string): Response =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError(405, "Método no permitido.");

  const { user, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user) return jsonError(401, "Necesitas iniciar sesión.");

  // Solo el dueño de una clínica puede invitar a su staff -- "ser dueño"
  // es exactamente tener una fila propia en camila_tenants (id = su
  // auth.uid()), misma regla que camila_es_dueno() en la migración. Se
  // repite aquí porque esta función corre con el service role y por lo
  // tanto se salta RLS -- no puede depender de las políticas de la tabla.
  const { data: tenant, error: tenantErr } = await admin
    .from("camila_tenants")
    .select("id, nombre, plan")
    .eq("id", user.id)
    .maybeSingle();
  if (tenantErr) {
    console.error("[invite-staff] error consultando camila_tenants:", tenantErr.message);
    return jsonError(500, "No se pudo verificar tu clínica. Intenta de nuevo.");
  }
  if (!tenant) return jsonError(403, "Solo el dueño de la clínica puede invitar personal.");

  const limiteUsuarios = LIMITE_USUARIOS_POR_PLAN[tenant.plan as string];
  if (limiteUsuarios !== undefined) {
    const { count, error: countErr } = await admin
      .from("camila_usuarios")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", user.id)
      .eq("activo", true);
    if (countErr) {
      console.error("[invite-staff] error contando equipo:", countErr.message);
      return jsonError(500, "No se pudo verificar tu equipo actual. Intenta de nuevo.");
    }
    if ((count || 0) >= limiteUsuarios) {
      return jsonError(
        403,
        `Tu plan (${tenant.plan}) permite hasta ${limiteUsuarios} usuario${limiteUsuarios === 1 ? "" : "s"}. Sube de plan para invitar a más personas.`
      );
    }
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body inválido.");
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const nombre = String(body?.nombre || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, "Correo inválido.");

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      tenant_id_invitado: user.id,
      nombre: nombre || undefined,
    },
    redirectTo: `${APP_URL}/app.html?invite=1`,
  });

  if (inviteErr) {
    console.error("[invite-staff] error invitando:", inviteErr.message);
    // Supabase regresa este mensaje cuando el correo ya tiene cuenta --
    // vale la pena distinguirlo del resto para no confundir al dueño.
    const yaExiste = /already.*registered|already exists/i.test(inviteErr.message);
    return jsonError(
      400,
      yaExiste
        ? "Ese correo ya tiene una cuenta en Smyl -- no se puede reinvitar."
        : "No se pudo enviar la invitación: " + inviteErr.message
    );
  }

  return new Response(JSON.stringify({ ok: true, email }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
