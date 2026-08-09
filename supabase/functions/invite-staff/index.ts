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

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

function jsonError(status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
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
