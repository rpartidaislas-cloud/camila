// supabase/functions/guardar-lead-prospecto/index.ts
//
// Guarda el caso de un prospecto (paciente sin cuenta, entró por el link
// público de una clínica -- simulacion.html?clinica=<tenant_id>). Sin
// sesión, camila_casos rechaza el INSERT directo (RLS exige ser miembro de
// la clínica) -- esta función corre con service role, valida que el
// tenant_id sea real/activo, y hace el INSERT por el prospecto. NO se
// exponen credenciales ni datos de otras clínicas: el único dato que el
// cliente controla es a cuál tenant_id atribuir el lead, y eso se valida
// contra camila_tenants antes de aceptar nada.

import { createClient } from "npm:@supabase/supabase-js@2";
import { checkAndConsumeLimit } from "../_shared/limits.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

// Campos que el cliente puede mandar -- cualquier otra cosa en el body se
// ignora (nunca se hace un INSERT con `...body` a pelo, para que un
// prospecto no pueda colar columnas que no le corresponden, p. ej.
// diagnosticos_usados o alguna columna futura sensible).
const CAMPOS_PERMITIDOS = [
  "id", "tenant_id", "nombre_paciente", "telefono", "email", "notas_doctor",
  "score", "score_lbl", "resumen", "diagnostico", "total_cotizacion",
  "simulacion_url", "simulacion_url_der", "simulacion_url_izq",
  "simulacion_url_extraoral", "simulacion_url_intraoral", "simulacion_url_tres_cuartos",
  "foto_frontal", "foto_perfil_der", "foto_perfil_izq", "foto_extraoral",
  "foto_intraoral", "foto_tres_cuartos", "cuestionario", "fotos_count",
  "diagnostico_claude", "prompt_gemini_usado", "editor_params", "created_at",
];

function jsonError(status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError(405, "Método no permitido.");

  // Tope genérico por IP -- protección barata contra spam de leads falsos
  // (no cuesta dinero de API como las llamadas de IA, pero sí ensucia el
  // panel del dentista). No exige sesión, así que se usa tal cual con
  // tenantId=null -- eso dispara la rama anónima de checkAndConsumeLimit.
  const { allowed, response: limitError } = await checkAndConsumeLimit(req, null, CORS);
  if (!allowed) return limitError!;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body inválido.");
  }

  const tenantId = String(body?.tenant_id || "");
  const nombre = String(body?.nombre_paciente || "").trim();
  if (!tenantId) return jsonError(400, "Falta tenant_id.");
  if (!nombre) return jsonError(400, "Falta el nombre del paciente.");

  const { data: tenant, error: tenantErr } = await admin
    .from("camila_tenants")
    .select("id, activo")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    console.error("[guardar-lead-prospecto] error consultando tenant:", tenantErr.message);
    return jsonError(500, "No se pudo verificar la clínica. Intenta de nuevo.");
  }
  if (!tenant || !tenant.activo) return jsonError(404, "No se encontró esta clínica o no está activa.");

  const fila: Record<string, unknown> = { es_prospecto: true };
  for (const campo of CAMPOS_PERMITIDOS) {
    if (body[campo] !== undefined) fila[campo] = body[campo];
  }
  fila.tenant_id = tenantId; // siempre el ya validado arriba, nunca el crudo del body

  const { error: insertErr } = await admin
    .from("camila_casos")
    .upsert(fila, { onConflict: "id" });
  if (insertErr) {
    console.error("[guardar-lead-prospecto] error guardando caso:", insertErr.message);
    return jsonError(500, "No se pudo guardar tu información. Intenta de nuevo.");
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
});
