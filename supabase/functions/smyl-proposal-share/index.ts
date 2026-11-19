// Propuesta compartida con el paciente por enlace privado (propuesta.html).
//   - Personal (JWT + proposal.followup):  create | list | revoke   -> el doctor elige qué viaja; se guarda una copia CONGELADA.
//   - Público (token opaco de 256 bits):   view | interest | accept -> el paciente ve su propuesta, avisa interés o acepta con consentimiento.
// Solo viaja lo marcado: plan y precios siempre; odontograma, fotografías/simulación y resumen de historial solo si el doctor lo pide.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { smylAdmin as admin } from "../_shared/lana-linked.ts";
import { aleatorioHex, sha256Hex, TOKEN_RE, UUID_RE } from "../_shared/smyl-pay-core.mjs";
import {
  CONSENT_TEXT, CONSENT_VERSION, normalizarComparticion, construirSnapshot, detalleSede, estadoEnlace, vistaPaciente, limpiarNotaInteres,
} from "../_shared/smyl-proposal-share-core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const PAGE_URL = "https://app.smyldesign.ai/propuesta.html";
const BUCKET = "smyl-proposal-photos";
const MAX_BODY = 8192;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const json = (cors: Record<string, string>, status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function enlacePorToken(token: unknown): Promise<Json | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const { data } = await admin.from("smyl_proposal_shares").select("*").eq("token_hash", await sha256Hex(token)).maybeSingle();
  return data || null;
}

async function firmar(tenantId: string, path: unknown): Promise<string | null> {
  // Solo rutas de la propia clínica (la primera carpeta es el id de la clínica).
  if (typeof path !== "string" || !path.startsWith(tenantId + "/") || path.includes("..")) return null;
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl || null;
}

async function registrarSeguimiento(share: Json) {
  try {
    await admin.from("smyl_proposal_followups").insert({
      tenant_id: share.tenant_id, proposal_id: share.proposal_id, proposal_revision: share.proposal_revision, channel: "other", followed_by: null,
    });
  } catch (_) { /* el seguimiento es una comodidad; no debe romper la respuesta */ }
}

async function accionesPublicas(body: Json, CORS: Record<string, string>): Promise<Response> {
  const share = await enlacePorToken(body.token);
  if (!share) return json(CORS, 404, { error: "Este enlace no existe o ya no está disponible." });
  const estado = estadoEnlace(share);
  if (estado === "revoked") return json(CORS, 410, { error: "La clínica canceló este enlace. Pide uno nuevo.", status: "revoked" });
  if (estado === "expired") return json(CORS, 410, { error: "Este enlace venció. Pide uno nuevo a tu clínica.", status: "expired" });

  if (body.action === "view") {
    const ahora = new Date().toISOString();
    await admin.from("smyl_proposal_shares").update({
      open_count: (share.open_count || 0) + 1, first_opened_at: share.first_opened_at || ahora, last_opened_at: ahora,
    }).eq("id", share.id);
    const assets: Json = {};
    const fotos = share.sections?.photos ? share.snapshot?.document?.photos : null;
    if (fotos) {
      assets.before = await firmar(share.tenant_id, fotos.before_path);
      assets.simulation = await firmar(share.tenant_id, fotos.simulation_path);
    }
    return json(CORS, 200, vistaPaciente(share, assets));
  }

  if (body.action === "interest") {
    if (!share.interested_at) {
      const { data } = await admin.from("smyl_proposal_shares").update({
        interested_at: new Date().toISOString(), interest_note: limpiarNotaInteres(body.note), updated_at: new Date().toISOString(),
      }).eq("id", share.id).is("interested_at", null).select("id").maybeSingle();
      if (data) await registrarSeguimiento(share);
    }
    return json(CORS, 200, { ok: true });
  }

  if (body.action === "accept") {
    if (body.consent !== true || body.consent_version !== CONSENT_VERSION) return json(CORS, 400, { error: "Marca la casilla de consentimiento para aceptar." });
    const ahora = new Date().toISOString();
    const { data } = await admin.from("smyl_proposal_shares").update({
      accepted_at: ahora, interested_at: share.interested_at || ahora, consent_version: CONSENT_VERSION,
      consent_text_hash: await sha256Hex(CONSENT_TEXT), updated_at: ahora,
    }).eq("id", share.id).is("accepted_at", null).select("id").maybeSingle();
    if (data) await registrarSeguimiento(share); // solo la primera vez
    return json(CORS, 200, { ok: true, accepted_at: share.accepted_at || ahora });
  }
  return json(CORS, 400, { error: "Acción no válida." });
}

async function accionesPersonal(req: Request, body: Json, CORS: Record<string, string>): Promise<Response> {
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(CORS, 401, { error: "Sesión requerida." });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: permitido } = await asUser.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "proposal.followup" });
  if (permitido !== true) return json(CORS, 403, { error: "Tu rol no permite compartir propuestas." });

  const proposalId = body.proposal_id;
  if (typeof proposalId !== "string" || !UUID_RE.test(proposalId)) return json(CORS, 400, { error: "Propuesta inválida." });

  if (body.action === "list") {
    const { data } = await admin.from("smyl_proposal_shares")
      .select("id, status, expires_at, open_count, first_opened_at, last_opened_at, interested_at, accepted_at, sections, created_at")
      .eq("tenant_id", tenantId).eq("proposal_id", proposalId).order("created_at", { ascending: false }).limit(10);
    return json(CORS, 200, { shares: (data || []).map((s: Json) => ({ ...s, state: estadoEnlace(s) })) });
  }

  if (body.action === "revoke") {
    const id = body.share_id;
    if (typeof id !== "string" || !UUID_RE.test(id)) return json(CORS, 400, { error: "Enlace inválido." });
    await admin.from("smyl_proposal_shares").update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("id", id).eq("proposal_id", proposalId);
    return json(CORS, 200, { ok: true });
  }

  if (body.action !== "create") return json(CORS, 400, { error: "Acción no válida." });
  const norm = normalizarComparticion(body);
  if (!norm.ok) return json(CORS, 400, { error: norm.error, field: norm.campo });

  const { data: propuesta } = await admin.from("smyl_proposals").select("*").eq("tenant_id", tenantId).eq("id", proposalId).maybeSingle();
  if (!propuesta) return json(CORS, 404, { error: "Propuesta no encontrada." });
  if (propuesta.status !== "approved") return json(CORS, 409, { error: "Aprueba la propuesta antes de compartirla." });

  let sede = null;
  if (propuesta.branch_id) {
    const { count } = await admin.from("smyl_branches").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true);
    if ((count || 0) > 1) {
      const { data: b } = await admin.from("smyl_branches").select("name, address_line, city, state, phone").eq("tenant_id", tenantId).eq("id", propuesta.branch_id).maybeSingle();
      sede = detalleSede(b);
    }
  }
  const snapshot = construirSnapshot(propuesta, { secciones: norm.valor.sections, sede });
  const token = aleatorioHex(32);
  const expiresAt = new Date(Date.now() + norm.valor.expires_days * 86_400_000).toISOString();
  const { data: share, error } = await admin.from("smyl_proposal_shares").insert({
    tenant_id: tenantId, proposal_id: propuesta.id, proposal_revision: propuesta.revision, token_hash: await sha256Hex(token), snapshot,
    sections: norm.valor.sections, history_summary: norm.valor.history_summary, payment_note: norm.valor.payment_note,
    expires_at: expiresAt, created_by: user.id,
  }).select("id").single();
  if (error || !share) return json(CORS, 500, { error: "No se pudo crear el enlace." });
  return json(CORS, 200, { share_id: share.id, url: `${PAGE_URL}#t=${token}`, expires_at: expiresAt });
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(CORS, 413, { error: "Solicitud demasiado grande." });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  if (["view", "interest", "accept"].includes(body.action)) return await accionesPublicas(body, CORS);
  return await accionesPersonal(req, body, CORS);
});
