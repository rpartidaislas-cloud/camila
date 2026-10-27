// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/invite-staff/index.ts con sus archivos de _shared incluidos,
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
// invitado (tenant_id_invitado), PERO ese dato por sí solo no basta: lo manda el
// navegador y cualquiera podría falsificarlo en un signUp. La invitación trazable
// se registra en smyl_staff_invitations y su UUID viaja como smyl_invitation_id.
// El trigger solo une la cuenta al equipo si ambos datos coinciden con una fila
// pendiente, vigente y emitida para el mismo correo.


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
    const [{ count, error: countErr }, { count: pendingCount, error: pendingErr }] = await Promise.all([
      admin
      .from("camila_usuarios")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", user.id)
      .eq("activo", true),
      admin
        .from("smyl_staff_invitations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", user.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString()),
    ]);
    if (countErr || pendingErr) {
      console.error("[invite-staff] error contando equipo:", countErr?.message || pendingErr?.message);
      return jsonError(500, "No se pudo verificar tu equipo actual. Intenta de nuevo.");
    }
    if ((count || 0) + (pendingCount || 0) >= limiteUsuarios) {
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
  const memberKind = body?.member_kind === "professional" ? "professional" : "staff";
  const specialty = String(body?.specialty || "").trim();
  const licenseNumber = String(body?.license_number || "").trim();
  const branchId = String(body?.branch_id || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, "Correo inválido.");
  if (memberKind === "professional" && nombre.length < 2) {
    return jsonError(400, "Escribe el nombre del profesional.");
  }
  if (specialty.length > 120 || licenseNumber.length > 80) {
    return jsonError(400, "Revisa la especialidad o la cédula profesional.");
  }
  if (memberKind === "professional" && !branchId) {
    return jsonError(400, "Selecciona la primera sucursal del profesional.");
  }

  if (branchId) {
    const { data: branch, error: branchErr } = await admin
      .from("smyl_branches")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("id", branchId)
      .eq("active", true)
      .maybeSingle();
    if (branchErr) {
      console.error("[invite-staff] error verificando sucursal:", branchErr.message);
      return jsonError(500, "No se pudo verificar la sucursal.");
    }
    if (!branch) return jsonError(400, "La sucursal no existe o está inactiva.");
  }

  const { data: invitation, error: invitationErr } = await admin
    .from("smyl_staff_invitations")
    .insert({
      tenant_id: tenant.id,
      email,
      display_name: nombre || email,
      member_kind: memberKind,
      specialty,
      license_number: licenseNumber,
      branch_id: branchId || null,
      invited_by: user.id,
    })
    .select("id")
    .single();

  if (invitationErr || !invitation) {
    const duplicate = invitationErr?.code === "23505";
    console.error("[invite-staff] error registrando invitación:", invitationErr?.message);
    return jsonError(
      duplicate ? 409 : 500,
      duplicate
        ? "Ya existe una invitación pendiente para ese correo."
        : "No se pudo preparar la invitación. Intenta de nuevo."
    );
  }

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      tenant_id_invitado: tenant.id,
      nombre: nombre || undefined,
      smyl_invitation_id: invitation.id,
      smyl_member_kind: memberKind,
    },
    redirectTo: `${APP_URL}/app.html?invite=1`,
  });

  if (inviteErr) {
    await admin.from("smyl_staff_invitations").delete().eq("id", invitation.id).eq("tenant_id", tenant.id);
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

  return new Response(JSON.stringify({ ok: true, email, invitation_id: invitation.id, member_kind: memberKind }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
