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
  "lana_cita_id", "lana_origen",
];

// Esta función es PÚBLICA (la llama el paciente desde el link de la clínica, sin sesión) y lo que
// guarda se muestra después dentro del panel del dentista. Por eso cada campo se valida por tipo y
// tamaño en el servidor: un valor con HTML/JS en `telefono` o `score` no debe llegar a la base.
const MAX_BODY_CHARS = 12_000_000; // fotos en base64 incluidas
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS_FOTO = [
  "simulacion_url", "simulacion_url_der", "simulacion_url_izq",
  "simulacion_url_extraoral", "simulacion_url_intraoral", "simulacion_url_tres_cuartos",
  "foto_frontal", "foto_perfil_der", "foto_perfil_izq", "foto_extraoral",
  "foto_intraoral", "foto_tres_cuartos",
];
const CAMPOS_TEXTO_CORTO: Record<string, number> = {
  nombre_paciente: 200, score_lbl: 120, lana_origen: 40, notas_doctor: 5000, resumen: 5000,
};
const CAMPOS_ESTRUCTURADOS = ["diagnostico", "diagnostico_claude", "cuestionario", "editor_params", "prompt_gemini_usado"];

function validarFila(body: Record<string, unknown>): { fila?: Record<string, unknown>; error?: string } {
  const fila: Record<string, unknown> = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    const valor = body[campo];
    if (valor === undefined || valor === null) continue;
    if (campo === "id") {
      if (typeof valor !== "string" || !UUID_RE.test(valor)) return { error: "id inválido." };
      fila.id = valor.toLowerCase();
    } else if (campo === "tenant_id") {
      continue; // se asigna aparte, ya validado contra camila_tenants
    } else if (campo === "telefono") {
      const t = String(valor).trim();
      if (t && !/^[0-9+()\-.\s]{1,30}$/.test(t)) return { error: "Teléfono inválido." };
      fila.telefono = t || null;
    } else if (campo === "email") {
      const e = String(valor).trim();
      if (e && (e.length > 254 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e))) return { error: "Correo inválido." };
      fila.email = e || null;
    } else if (campo === "score") {
      const n = Number(valor);
      if (typeof valor === "boolean" || !Number.isFinite(n) || n < 0 || n > 100) return { error: "score inválido." };
      fila.score = n;
    } else if (campo === "total_cotizacion") {
      const n = Number(valor);
      if (typeof valor === "boolean" || !Number.isFinite(n) || n < 0 || n > 100_000_000) return { error: "total_cotizacion inválido." };
      fila.total_cotizacion = n;
    } else if (campo === "fotos_count") {
      const n = Number(valor);
      if (!Number.isInteger(n) || n < 0 || n > 50) return { error: "fotos_count inválido." };
      fila.fotos_count = n;
    } else if (campo === "lana_cita_id") {
      const n = Number(valor);
      if (!Number.isInteger(n) || n < 0) return { error: "lana_cita_id inválido." };
      fila.lana_cita_id = n;
    } else if (campo === "created_at") {
      const d = new Date(String(valor));
      const ahora = Date.now();
      if (Number.isNaN(d.getTime()) || d.getTime() > ahora + 86_400_000 || d.getTime() < ahora - 31 * 86_400_000) continue;
      fila.created_at = d.toISOString();
    } else if (campo in CAMPOS_TEXTO_CORTO) {
      if (typeof valor !== "string" || valor.length > CAMPOS_TEXTO_CORTO[campo]) return { error: `${campo} inválido.` };
      fila[campo] = valor;
    } else if (CAMPOS_FOTO.includes(campo)) {
      if (typeof valor !== "string" || valor.length > MAX_BODY_CHARS) return { error: `${campo} inválido.` };
      fila[campo] = valor;
    } else if (CAMPOS_ESTRUCTURADOS.includes(campo)) {
      if (typeof valor === "string") {
        if (valor.length > 200_000) return { error: `${campo} demasiado grande.` };
      } else if (typeof valor === "object") {
        if (JSON.stringify(valor).length > 200_000) return { error: `${campo} demasiado grande.` };
      } else {
        return { error: `${campo} inválido.` };
      }
      fila[campo] = valor;
    }
    // Cualquier otro campo se ignora (ver CAMPOS_PERMITIDOS).
  }
  return { fila };
}

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
    const crudo = await req.text();
    if (crudo.length > MAX_BODY_CHARS) return jsonError(413, "La solicitud es demasiado grande.");
    body = JSON.parse(crudo);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("no es un objeto");
  } catch {
    return jsonError(400, "Body inválido.");
  }

  const tenantId = String(body?.tenant_id || "");
  if (!UUID_RE.test(tenantId)) return jsonError(400, "tenant_id inválido.");
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

  const validada = validarFila(body);
  if (validada.error) return jsonError(400, validada.error);
  const fila: Record<string, unknown> = { ...validada.fila, es_prospecto: true };
  fila.tenant_id = tenantId; // siempre el ya validado arriba, nunca el crudo del body

  // Un upsert por `id` que manda el cliente podría pisar (o mover de clínica) un caso que ya existe.
  // Si el id ya existe, solo se acepta que sea un caso de prospecto de ESTA misma clínica.
  if (typeof fila.id === "string") {
    const { data: existente, error: existenteErr } = await admin
      .from("camila_casos")
      .select("id, tenant_id, es_prospecto")
      .eq("id", fila.id)
      .maybeSingle();
    if (existenteErr) {
      console.error("[guardar-lead-prospecto] error consultando caso existente:", existenteErr.message);
      return jsonError(500, "No se pudo guardar tu información. Intenta de nuevo.");
    }
    if (existente && (existente.tenant_id !== tenantId || existente.es_prospecto !== true)) {
      return jsonError(409, "Ese identificador ya está en uso.");
    }
  }

  const { error: insertErr } = await admin
    .from("camila_casos")
    .upsert(fila, { onConflict: "id" });
  if (insertErr) {
    console.error("[guardar-lead-prospecto] error guardando caso:", insertErr.message);
    return jsonError(500, "No se pudo guardar tu información. Intenta de nuevo.");
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
});
