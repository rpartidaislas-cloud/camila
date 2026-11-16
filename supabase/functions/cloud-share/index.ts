// Compartir un archivo de la Nube con un enlace privado.
//   - Personal (JWT + cloud.share + poder ver el archivo): create | revoke
//   - Público (token opaco, sin sesión):                  view   -> URL firmada de 2 minutos; opcional código de 6 dígitos.
// El token solo existe en el enlace que recibe la persona: en la base solo se guarda su SHA-256. Cada acceso queda en bitácora.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import {
  UUID_RE, TOKEN_RE, CODIGO_RE, MAX_INTENTOS_CODIGO, MAX_ENLACES_ACTIVOS_POR_ARCHIVO, DIAS_POR_DEFECTO,
  aleatorioHex, sha256Hex, codigoAleatorio, hashDeCodigo, diasValidos, venceEn, estadoDelEnlace, vistaPublica,
} from "../_shared/cloud-share-core.mjs";

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
