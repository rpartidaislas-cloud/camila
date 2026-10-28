// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/radiograph-qc/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { RadiographQcProvider, VerifiedRadiographSource } from "./radiograph-provider.ts";

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

// ── _shared/request-safety.ts ──
const { constantTimeEqual, parseAllowedHostSuffixes, isAllowedRemoteUrl, isAllowedImageSource, MAX_REMOTE_IMAGE_BYTES, readBodyWithLimit } = (() => {
// Utilidades de seguridad para Edge Functions que reciben URLs o secretos del exterior.

// Comparación de secretos en tiempo (casi) constante: no se corta en el primer byte distinto.
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // La longitud sí se compara, pero se recorre siempre el máximo para no filtrar dónde difieren.
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Sufijos de host permitidos para descargar imágenes o llamar callbacks. Por defecto solo
// Supabase (Storage y Edge Functions); se pueden añadir hosts con una lista separada por comas.
function parseAllowedHostSuffixes(extra: string | null | undefined): string[] {
  const base = [".supabase.co"];
  const more = String(extra || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s))
    .map((s) => (s.startsWith(".") ? s : "." + s));
  return Array.from(new Set([...base, ...more]));
}

// Solo https, sin credenciales, puerto estándar, nombre de host (no IP ni localhost) y dentro de la
// lista permitida. Evita que una función con service role haga peticiones a hosts internos (SSRF).
function isAllowedRemoteUrl(raw: unknown, suffixes: string[]): boolean {
  if (typeof raw !== "string" || raw.length > 4096) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  return suffixes.some((s) => host.endsWith(s) || host === s.slice(1));
}

const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i;

// Una imagen de entrada puede venir como data URL de imagen o como https permitido.
function isAllowedImageSource(raw: unknown, suffixes: string[], maxDataChars = 34_000_000): boolean {
  if (typeof raw !== "string") return false;
  if (raw.startsWith("data:")) return raw.length <= maxDataChars && DATA_IMAGE_RE.test(raw);
  return isAllowedRemoteUrl(raw, suffixes);
}

const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;

// Lee una respuesta con tope de tamaño (Content-Length y bytes reales) para no cargar archivos enormes.
async function readBodyWithLimit(res: Response, maxBytes = MAX_REMOTE_IMAGE_BYTES): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("La imagen es demasiado grande.");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("La imagen es demasiado grande.");
  return buf;
}

return { constantTimeEqual, parseAllowedHostSuffixes, isAllowedRemoteUrl, isAllowedImageSource, MAX_REMOTE_IMAGE_BYTES, readBodyWithLimit };
})();

// ── _shared/radiograph-contracts.ts ──
const { RADIOGRAPH_CONTRACT_VERSION, STUDY_CLASSES, QUALITY_STATES, QC_FLAG_CODES, SEVERITIES, ANALYSES, VISIBILITIES, FINDING_CATEGORIES, EVIDENCE_LEVELS, DECISION_STATES, REPORT_PRIORITIES, REPORT_SECTIONS, isGeometry, parseRadiographQc, parseToothCandidateSet, parseFindingCandidateSet, parseRadiographReport, parseRadiographOutput, hasForbiddenClaim, isFdi } = (() => {
// SMYL radiografía asistida — contratos v2 (schema 1) para Edge Functions.
// Espejo tipado de smyl-radiograph-contracts.js; ambos se comprueban contra los mismos
// vectores (tests/fixtures/radiograph-contracts) junto con los validadores SQL.
// Falla cerrado: cualquier campo extra, enumeración desconocida, probabilidad fuera de [0,1]
// o geometría degenerada rechaza la respuesta completa del proveedor.

const RADIOGRAPH_CONTRACT_VERSION = 1;
const STUDY_CLASSES = ["panoramic", "periapical", "bitewing", "intraoral_series", "unknown"] as const;
const QUALITY_STATES = ["usable", "limited", "unusable"] as const;
const QC_FLAG_CODES = ["motion_blur", "anterior_blur", "anatomical_cropping", "underexposure", "overexposure", "low_contrast", "overlap", "compression_artifacts", "orientation_suspect", "foreign_object", "unknown_study_class"] as const;
const SEVERITIES = ["low", "moderate", "high"] as const;
const ANALYSES = ["tooth_localization", "finding_candidates"] as const;
const VISIBILITIES = ["complete", "partial", "not_evaluable"] as const;
const FINDING_CATEGORIES = ["restoration", "crown", "implant", "endodontic", "apparently_missing", "density", "contour", "support", "development", "other"] as const;
const EVIDENCE_LEVELS = ["model_candidate"] as const;
const DECISION_STATES = ["pending", "confirmed", "corrected", "rejected"] as const;
const REPORT_PRIORITIES = ["routine", "soon", "urgent"] as const;
const REPORT_SECTIONS = ["description", "technicalLimitations", "clinicalCorrelation", "missingInformation", "complementaryStudies"] as const;

type StudyClass = typeof STUDY_CLASSES[number];
type QualityState = typeof QUALITY_STATES[number];
type Analysis = typeof ANALYSES[number];
type GeometryKind = "point" | "bbox" | "polygon";
interface Geometry { kind: GeometryKind; coordinateSpace: "source-normalized"; points: [number, number][] }
interface ModelRef { provider: string; name: string; version: string }
interface RadiographQcResultV1 {
  schema: 1;
  studyClass: { value: StudyClass; probability: number; alternatives: { value: StudyClass; probability: number }[] };
  quality: { status: QualityState; flags: { code: typeof QC_FLAG_CODES[number]; severity: typeof SEVERITIES[number]; region: Geometry | null; explanation: string }[] };
  applicableAnalyses: Analysis[];
  blockedAnalyses: { code: Analysis; reason: string }[];
  model: ModelRef;
}
interface ToothCandidateV1 { candidateId: string; fdiCandidate: string; fdiProbability: number; geometry: Geometry; visibility: typeof VISIBILITIES[number]; alternatives: { fdi: string; probability: number }[] }
interface ToothCandidateSetV1 { schema: 1; sourceId: string; model: ModelRef; candidates: ToothCandidateV1[] }
interface FindingCandidateV1 { candidateId: string; toothCandidate: string | null; category: typeof FINDING_CATEGORIES[number]; label: string; confidence: number; evidenceLevel: "model_candidate"; regions: Geometry[]; explanation: string; limitations: string[] }
interface FindingCandidateSetV1 { schema: 1; sourceId: string; model: ModelRef; candidates: FindingCandidateV1[] }
interface RadiographReportV1 { schema: 1; sections: Record<typeof REPORT_SECTIONS[number], string>; findings: { candidateId: string; tooth: string | null; text: string; priority: typeof REPORT_PRIORITIES[number] }[] }

const FDI = /^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CANDIDATE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FORBIDDEN_CLAIM = /(diagn[oó]s|confirmad[oa]|certeza|definitiv|inequ[ií]voc|sin duda|diagnosis|confirmed|definite)/i;

type Dict = Record<string, unknown>;
const fail = (m: string): never => { throw new Error(m); };
const isObj = (v: unknown): v is Dict => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (o: unknown, keys: readonly string[]): o is Dict => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const cp = (s: string): number => [...s].length; // code points, igual que char_length en SQL
const text = (v: unknown, min: number, max: number): v is string => typeof v === "string" && cp(v) <= max && cp(v.trim()) >= min && cp(v.trim()) <= max;
const prob = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const fdi = (v: unknown): v is string => typeof v === "string" && FDI.test(v);
const candidateId = (v: unknown): v is string => typeof v === "string" && CANDIDATE_ID.test(v);
const includes = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const model = (m: unknown): m is ModelRef => exact(m, ["provider", "name", "version"]) && text(m.provider, 1, 60) && text(m.name, 1, 80) && text(m.version, 1, 60);

function isGeometry(g: unknown, allowPoint: boolean): g is Geometry {
  if (!exact(g, ["kind", "coordinateSpace", "points"]) || g.coordinateSpace !== "source-normalized" || !Array.isArray(g.points)) return false;
  if (!["point", "bbox", "polygon"].includes(String(g.kind)) || (g.kind === "point" && !allowPoint)) return false;
  const points = g.points as unknown[];
  let prev: [number, number] | null = null;
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !prob(p[0]) || !prob(p[1])) return false;
    if (prev && prev[0] === p[0] && prev[1] === p[1]) return false;
    prev = [p[0], p[1]];
  }
  const pts = points as [number, number][];
  const n = pts.length;
  if (g.kind === "point") return n === 1;
  if (g.kind === "bbox") return n === 2 && pts[1][0] > pts[0][0] && pts[1][1] > pts[0][1];
  if (n < 3 || n > 64) return false;
  if (pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1]) return false;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(area) / 2 >= 0.000001;
}

function parseRadiographQc(value: unknown): RadiographQcResultV1 {
  if (!exact(value, ["schema", "studyClass", "quality", "applicableAnalyses", "blockedAnalyses", "model"]) || value.schema !== 1 || !model(value.model)) fail("Resultado de control de calidad no válido.");
  const v = value as Dict;
  const sc = v.studyClass;
  if (!exact(sc, ["value", "probability", "alternatives"]) || !includes(STUDY_CLASSES, sc.value) || !prob(sc.probability) || !Array.isArray(sc.alternatives) || sc.alternatives.length > 4) fail("Clase de estudio no válida.");
  const scd = sc as Dict;
  const seen = new Set<string>([String(scd.value)]);
  for (const a of scd.alternatives as unknown[]) {
    if (!exact(a, ["value", "probability"]) || !includes(STUDY_CLASSES, a.value) || seen.has(a.value) || !prob(a.probability)) fail("Alternativa de clase de estudio no válida.");
    seen.add(String((a as Dict).value));
  }
  const q = v.quality;
  if (!exact(q, ["status", "flags"]) || !includes(QUALITY_STATES, q.status) || !Array.isArray(q.flags) || q.flags.length > 12) fail("Calidad radiográfica no válida.");
  const qd = q as Dict;
  for (const f of qd.flags as unknown[]) {
    if (!exact(f, ["code", "severity", "region", "explanation"]) || !includes(QC_FLAG_CODES, f.code) || !includes(SEVERITIES, f.severity) || !text(f.explanation, 1, 300) || !(f.region === null || isGeometry(f.region, true))) fail("Bandera de calidad no válida.");
  }
  if (!Array.isArray(v.applicableAnalyses) || !Array.isArray(v.blockedAnalyses)) fail("Análisis aplicables no válidos.");
  const applicable = new Set<string>();
  for (const a of v.applicableAnalyses as unknown[]) { if (!includes(ANALYSES, a) || applicable.has(a)) fail("Análisis aplicable no válido."); applicable.add(a as string); }
  const blocked = new Set<string>();
  for (const b of v.blockedAnalyses as unknown[]) {
    if (!exact(b, ["code", "reason"]) || !includes(ANALYSES, b.code) || applicable.has(b.code) || blocked.has(b.code) || !text(b.reason, 1, 300)) fail("Análisis bloqueado no válido.");
    blocked.add(String((b as Dict).code));
  }
  if (qd.status === "unusable" && applicable.size) fail("Una imagen no utilizable no habilita análisis.");
  return structuredClone(value) as RadiographQcResultV1;
}

function parseToothCandidateSet(value: unknown): ToothCandidateSetV1 {
  if (!exact(value, ["schema", "sourceId", "model", "candidates"]) || value.schema !== 1 || !UUID.test(String(value.sourceId)) || !model(value.model) || !Array.isArray(value.candidates) || value.candidates.length > 64) fail("Conjunto de piezas candidatas no válido.");
  const ids = new Set<string>();
  for (const c of (value as Dict).candidates as unknown[]) {
    if (!exact(c, ["candidateId", "fdiCandidate", "fdiProbability", "geometry", "visibility", "alternatives"]) || !candidateId(c.candidateId) || ids.has(c.candidateId)
      || !fdi(c.fdiCandidate) || !prob(c.fdiProbability) || !isGeometry(c.geometry, false) || !includes(VISIBILITIES, c.visibility) || !Array.isArray(c.alternatives) || c.alternatives.length > 3) fail("Pieza candidata no válida.");
    const cd = c as Dict;
    ids.add(String(cd.candidateId));
    const alts = new Set<string>([String(cd.fdiCandidate)]);
    for (const a of cd.alternatives as unknown[]) {
      if (!exact(a, ["fdi", "probability"]) || !fdi(a.fdi) || alts.has(a.fdi) || !prob(a.probability)) fail("Alternativa FDI no válida.");
      alts.add(String((a as Dict).fdi));
    }
  }
  return structuredClone(value) as ToothCandidateSetV1;
}

function parseFindingCandidateSet(value: unknown): FindingCandidateSetV1 {
  if (!exact(value, ["schema", "sourceId", "model", "candidates"]) || value.schema !== 1 || !UUID.test(String(value.sourceId)) || !model(value.model) || !Array.isArray(value.candidates) || value.candidates.length > 48) fail("Conjunto de señales candidatas no válido.");
  const ids = new Set<string>();
  for (const c of (value as Dict).candidates as unknown[]) {
    if (!exact(c, ["candidateId", "toothCandidate", "category", "label", "confidence", "evidenceLevel", "regions", "explanation", "limitations"]) || !candidateId(c.candidateId) || ids.has(c.candidateId)
      || !(c.toothCandidate === null || fdi(c.toothCandidate)) || !includes(FINDING_CATEGORIES, c.category) || !text(c.label, 1, 120) || !prob(c.confidence)
      || !includes(EVIDENCE_LEVELS, c.evidenceLevel) || !Array.isArray(c.regions) || c.regions.length < 1 || c.regions.length > 4 || !text(c.explanation, 1, 300)
      || !Array.isArray(c.limitations) || c.limitations.length > 6) fail("Señal candidata no válida.");
    const cd = c as Dict;
    if (FORBIDDEN_CLAIM.test(String(cd.label)) || FORBIDDEN_CLAIM.test(String(cd.explanation))) fail("El modelo no puede presentar una señal como diagnóstico o certeza.");
    ids.add(String(cd.candidateId));
    for (const r of cd.regions as unknown[]) if (!isGeometry(r, false)) fail("Región de señal no válida.");
    for (const l of cd.limitations as unknown[]) if (!text(l, 1, 200)) fail("Limitación de señal no válida.");
  }
  return structuredClone(value) as FindingCandidateSetV1;
}

function parseRadiographReport(value: unknown, strict: boolean): RadiographReportV1 {
  if (!exact(value, ["schema", "sections", "findings"]) || value.schema !== 1 || !Array.isArray(value.findings) || value.findings.length > 48) fail("Informe radiográfico no válido.");
  const v = value as Dict;
  if (!exact(v.sections, REPORT_SECTIONS)) fail("Secciones del informe no válidas.");
  const sections = v.sections as Dict;
  for (const k of REPORT_SECTIONS) if (!text(sections[k], 0, 4000)) fail("Sección del informe demasiado larga.");
  if (strict && String(sections.description).trim().length < 2) fail("Completa la descripción radiográfica antes de firmar.");
  const ids = new Set<string>();
  for (const f of v.findings as unknown[]) {
    if (!exact(f, ["candidateId", "tooth", "text", "priority"]) || !UUID.test(String(f.candidateId)) || ids.has(String(f.candidateId)) || !(f.tooth === null || fdi(f.tooth)) || !text(f.text, 1, 600) || !includes(REPORT_PRIORITIES, f.priority)) fail("Hallazgo del informe no válido.");
    ids.add(String((f as Dict).candidateId));
  }
  return structuredClone(value) as RadiographReportV1;
}

function parseRadiographOutput(kind: "qc" | "tooth_localization" | "finding_candidates", value: unknown): RadiographQcResultV1 | ToothCandidateSetV1 | FindingCandidateSetV1 {
  if (kind === "qc") return parseRadiographQc(value);
  if (kind === "tooth_localization") return parseToothCandidateSet(value);
  if (kind === "finding_candidates") return parseFindingCandidateSet(value);
  return fail("Tipo de análisis desconocido.");
}

const hasForbiddenClaim = (v: unknown): boolean => FORBIDDEN_CLAIM.test(String(v));
const isFdi = fdi;

return { RADIOGRAPH_CONTRACT_VERSION, STUDY_CLASSES, QUALITY_STATES, QC_FLAG_CODES, SEVERITIES, ANALYSES, VISIBILITIES, FINDING_CATEGORIES, EVIDENCE_LEVELS, DECISION_STATES, REPORT_PRIORITIES, REPORT_SECTIONS, isGeometry, parseRadiographQc, parseToothCandidateSet, parseFindingCandidateSet, parseRadiographReport, parseRadiographOutput, hasForbiddenClaim, isFdi };
})();

// ── _shared/radiograph-provider.ts ──
const { SIMULATED_MODEL, SimulatedQcProvider, simulateQc, HttpQcProvider, createQcProvider } = (() => {
// Adaptador de proveedor para el control de calidad radiográfico (plan §7). La UI nunca habla con
// un proveedor: el núcleo recibe un RadiographQcProvider y valida su respuesta con el contrato.
// Reglas del adaptador: credenciales ocultas, timeout y tamaño impuestos, sin redirecciones,
// salida cruda que el núcleo valida (falla cerrado), versión exacta del modelo, y un proveedor
// simulado determinista para pruebas y pilotos sin motor real.


interface VerifiedRadiographSource {
  sourceId: string;
  sha256: string;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  orientation: number;
  studyTypeDeclared: string;
  bytes: Uint8Array;
  hints: string[]; // sólo las usa el proveedor simulado
}

interface RadiographQcProvider {
  readonly model: ModelRef;
  // Devuelve la respuesta cruda; el núcleo la valida con parseRadiographQc. Debe respetar `signal`.
  analyze(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown>;
}

const SIMULATED_MODEL: ModelRef = { provider: 'simulated', name: 'smyl-sim-xray', version: '0.1.0' };

// Determinista a partir de dimensiones, orientación, peso por píxel y pistas de prueba. Nunca emite
// afirmaciones clínicas: sólo clase de estudio y banderas técnicas con explicación.
class SimulatedQcProvider implements RadiographQcProvider {
  readonly model = SIMULATED_MODEL;
  analyze(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> {
    if (input.hints.includes('malformed')) return Promise.resolve({ schema: 1, studyClass: { value: 'panoramic' } });
    if (input.hints.includes('hang')) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))));
    if (input.hints.includes('crash')) return Promise.reject(new Error('simulated provider failure'));
    return Promise.resolve(simulateQc(input));
  }
}

function simulateQc(input: VerifiedRadiographSource): RadiographQcResultV1 {
  const ratio = input.width / input.height;
  const derived = ratio >= 1.8 ? 'panoramic' : ratio >= 1.15 && input.width <= 1600 ? 'bitewing' : ratio < 1.15 ? 'periapical' : 'unknown';
  const declared = input.studyTypeDeclared;
  const agrees = declared === derived || declared === 'unknown';
  const studyClass: RadiographQcResultV1['studyClass'] = agrees
    ? { value: derived, probability: 0.9, alternatives: [] }
    : { value: derived, probability: 0.6, alternatives: [{ value: declared as RadiographQcResultV1['studyClass']['value'], probability: 0.3 }] };
  const flags: RadiographQcResultV1['quality']['flags'] = [];
  if (input.orientation !== 1 && input.orientation !== 0) flags.push({ code: 'orientation_suspect', severity: 'high', region: null, explanation: 'La orientación EXIF no es la normal; revisar lado y sentido antes de interpretar.' });
  const bytesPerPixel = input.bytes.length / (input.width * input.height);
  if (input.mimeType === 'image/jpeg' && bytesPerPixel < 0.08) flags.push({ code: 'compression_artifacts', severity: 'moderate', region: null, explanation: 'Compresión JPEG alta para el tamaño de la imagen; el detalle fino puede estar degradado.' });
  for (const hint of input.hints) {
    const [code, severity] = hint.split(':');
    if ((QC_FLAG_CODES as readonly string[]).includes(code) && !flags.some((f) => f.code === code)) {
      flags.push({ code: code as typeof QC_FLAG_CODES[number], severity: severity === 'high' || severity === 'low' ? severity : 'moderate', region: null, explanation: `Señal técnica simulada: ${code.replace(/_/g, ' ')}.` });
    }
  }
  const unusable = input.hints.includes('unusable');
  const high = flags.some((f) => f.severity === 'high');
  const status: RadiographQcResultV1['quality']['status'] = unusable ? 'unusable' : high || flags.length >= 2 ? 'limited' : 'usable';
  const fineBlocked = status === 'limited' && flags.some((f) => ['motion_blur', 'anterior_blur', 'compression_artifacts', 'orientation_suspect'].includes(f.code));
  const applicable = status === 'unusable' ? [] : fineBlocked ? ['tooth_localization'] : [...ANALYSES];
  const blocked = (ANALYSES as readonly string[]).filter((a) => !applicable.includes(a)).map((code) => ({
    code: code as typeof ANALYSES[number],
    reason: status === 'unusable' ? 'La imagen no es utilizable para análisis asistido.' : 'Las señales técnicas detectadas impiden evaluar señales finas.',
  }));
  return { schema: 1, studyClass, quality: { status, flags }, applicableAnalyses: applicable as RadiographQcResultV1['applicableAnalyses'], blockedAnalyses: blocked, model: { ...SIMULATED_MODEL } };
}

interface HttpQcProviderConfig {
  url: string;
  apiKey: string;
  model: ModelRef;
  timeoutMs: number;
  maxResponseBytes: number;
  allowedHostSuffixes: string[];
}

// Adaptador HTTP genérico: https permitido, sin redirecciones, tope de respuesta, salida cruda.
class HttpQcProvider implements RadiographQcProvider {
  readonly model: ModelRef;
  private readonly cfg: HttpQcProviderConfig;
  constructor(cfg: HttpQcProviderConfig, isAllowedUrl: (u: string, s: string[]) => boolean) {
    if (!isAllowedUrl(cfg.url, cfg.allowedHostSuffixes)) throw new Error('URL del proveedor no permitida.');
    this.cfg = cfg;
    this.model = { ...cfg.model };
  }
  async analyze(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> {
    const body = new FormData();
    body.set('metadata', JSON.stringify({ sourceId: input.sourceId, sha256: input.sha256, mimeType: input.mimeType, width: input.width, height: input.height, studyTypeDeclared: input.studyTypeDeclared, model: this.model }));
    body.set('image', new Blob([input.bytes], { type: input.mimeType }), 'radiograph');
    const res = await fetch(this.cfg.url, { method: 'POST', headers: { authorization: `Bearer ${this.cfg.apiKey}` }, body, redirect: 'error', signal });
    if (!res.ok) throw new Error(`provider_http_${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > this.cfg.maxResponseBytes) throw new Error('provider_response_too_large');
    const text = await res.text();
    if (text.length > this.cfg.maxResponseBytes) throw new Error('provider_response_too_large');
    return JSON.parse(text);
  }
}

type ProviderEnv = Record<string, string | undefined>;

// Falla cerrado: sin RADIOGRAPH_QC_PROVIDER no hay motor. Las credenciales sólo viven en env.
function createQcProvider(env: ProviderEnv, isAllowedUrl: (u: string, s: string[]) => boolean, parseSuffixes: (extra: string | undefined) => string[]): RadiographQcProvider | null {
  const kind = (env.RADIOGRAPH_QC_PROVIDER || '').trim();
  if (kind === 'simulated') return new SimulatedQcProvider();
  if (kind !== 'http') return null;
  const url = env.RADIOGRAPH_QC_URL || '', apiKey = env.RADIOGRAPH_QC_API_KEY || '';
  const model = { provider: env.RADIOGRAPH_QC_PROVIDER_NAME || '', name: env.RADIOGRAPH_QC_MODEL_NAME || '', version: env.RADIOGRAPH_QC_MODEL_VERSION || '' };
  if (!url || !apiKey || !model.provider || !model.name || !model.version) return null;
  return new HttpQcProvider({ url, apiKey, model, timeoutMs: 0, maxResponseBytes: 262_144, allowedHostSuffixes: parseSuffixes(env.RADIOGRAPH_PROVIDER_HOSTS) }, isAllowedUrl);
}

return { SIMULATED_MODEL, SimulatedQcProvider, simulateQc, HttpQcProvider, createQcProvider };
})();

// ── _shared/radiograph-image.ts ──
const { detectRadiographMime, probeRadiograph, sha256Hex } = (() => {
// Inspección de una radiografía 2D sin decodificarla: tipo real por firma binaria, dimensiones
// desde la cabecera (PNG IHDR / JPEG SOFn) y orientación EXIF. No usa librerías ni Deno: se
// ejecuta igual en pruebas de Node. Las "pistas" (chunk PNG tEXt `smyl.sim`) sólo las lee el
// proveedor simulado; un proveedor real las ignora.

interface ImageProbe {
  mime: 'image/jpeg' | 'image/png' | null;
  width: number | null;
  height: number | null;
  orientation: number; // EXIF 1..8; 1 = normal; 0 = desconocida
  hints: string[];
  reason: string | null; // motivo de rechazo, o null si la cabecera es coherente
}

const td = new TextDecoder();
const u16 = (b: Uint8Array, i: number, le: boolean) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
const u32 = (b: Uint8Array, i: number, le: boolean) =>
  le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function detectRadiographMime(b: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9) return 'image/jpeg';
  if (b.length >= 20 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    && td.decode(b.slice(-8, -4)) === 'IEND') return 'image/png';
  return null;
}

function probePng(b: Uint8Array): ImageProbe {
  const hints: string[] = [];
  let width: number | null = null, height: number | null = null;
  let i = 8;
  while (i + 8 <= b.length) {
    const len = u32(b, i, false);
    const type = td.decode(b.slice(i + 4, i + 8));
    const start = i + 8;
    if (start + len > b.length) break;
    if (type === 'IHDR' && len >= 8) { width = u32(b, start, false); height = u32(b, start + 4, false); }
    if (type === 'tEXt') {
      const text = td.decode(b.slice(start, start + len));
      const sep = text.indexOf('\0');
      if (sep > 0 && text.slice(0, sep) === 'smyl.sim') hints.push(...text.slice(sep + 1).split(',').map((h) => h.trim()).filter(Boolean));
    }
    if (type === 'IEND') break;
    i = start + len + 4; // + CRC
  }
  if (width === null || height === null) return { mime: 'image/png', width, height, orientation: 0, hints, reason: 'La cabecera PNG no declara dimensiones.' };
  return { mime: 'image/png', width, height, orientation: 1, hints, reason: null };
}

function exifOrientation(app1: Uint8Array): number {
  // app1 empieza en "Exif\0\0" seguido de la cabecera TIFF.
  if (app1.length < 14 || td.decode(app1.slice(0, 4)) !== 'Exif') return 0;
  const t = app1.slice(6);
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return 0;
  if (u16(t, 2, le) !== 0x2a) return 0;
  const ifd = u32(t, 4, le);
  if (ifd + 2 > t.length) return 0;
  const n = u16(t, ifd, le);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) break;
    if (u16(t, e, le) === 0x0112) { const v = u16(t, e + 8, le); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 1;
}

function probeJpeg(b: Uint8Array): ImageProbe {
  let width: number | null = null, height: number | null = null, orientation = 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break; // EOI o inicio de scan: ya no hay cabeceras
    const len = u16(b, i + 2, false);
    if (len < 2 || i + 2 + len > b.length) break;
    const seg = b.slice(i + 4, i + 2 + len);
    if (marker === 0xe1) { const o = exifOrientation(seg); if (o) orientation = o; }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (seg.length >= 5) { height = u16(seg, 1, false); width = u16(seg, 3, false); }
    }
    i += 2 + len;
  }
  if (width === null || height === null) return { mime: 'image/jpeg', width, height, orientation, hints: [], reason: 'La cabecera JPEG no declara dimensiones.' };
  return { mime: 'image/jpeg', width, height, orientation, hints: [], reason: null };
}

function probeRadiograph(bytes: Uint8Array): ImageProbe {
  const mime = detectRadiographMime(bytes);
  if (mime === 'image/png') return probePng(bytes);
  if (mime === 'image/jpeg') return probeJpeg(bytes);
  return { mime: null, width: null, height: null, orientation: 0, hints: [], reason: 'El formato real no está permitido.' };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest).map((x) => x.toString(16).padStart(2, '0')).join('');
}

return { detectRadiographMime, probeRadiograph, sha256Hex };
})();

// ── _shared/radiograph-qc-core.ts ──
const { runRadiographQc } = (() => {
// Núcleo de la Edge Function radiograph-qc, sin Deno ni Supabase: recibe dependencias y devuelve
// {status, body}. Así se prueba cada escenario (tipo falso, hash distinto, respuesta incompleta,
// timeout, duplicado) de forma determinista en Node.
//
// Orden obligatorio: (1) la solicitud se registra en la base con la sesión del usuario — el RPC
// verifica tenant, permiso, alcance del paciente, bandera y motor activo, y es idempotente —;
// (2) sólo entonces se usa service_role para leer la fuente y descargar el archivo por su ruta
// conocida; (3) se verifica hash, MIME real, tamaño y dimensiones; (4) se llama al proveedor con
// timeout; (5) la respuesta se valida con el contrato y se guarda completa e inmutable.
// Un timeout incierto cierra la ejecución como `unconfirmed` y NO reintenta.


interface AiRunRow {
  id: string; tenant_id: string; patient_id: string; source_id: string; kind: string; status: string;
  engine: { provider: string; name: string; version: string }; contract_version: number; output: unknown; failure_code: string;
}
interface SourceRow {
  id: string; tenant_id: string; patient_id: string; bucket: string; storage_path: string; sha256: string;
  mime_type: string; size_bytes: number; study_type_declared: string;
}
interface DbResult<T> { data: T | null; error: { code?: string; message: string } | null }
interface QcDeps {
  requestRun(sourceId: string): Promise<DbResult<AiRunRow>>;            // como usuario (JWT)
  loadSource(sourceId: string): Promise<SourceRow | null>;               // service_role
  download(bucket: string, path: string): Promise<Uint8Array | null>;    // service_role, ruta conocida
  completeRun(runId: string, status: 'completed' | 'failed' | 'unconfirmed', output: unknown, failureCode: string): Promise<DbResult<AiRunRow>>; // service_role
  provider: RadiographQcProvider | null;
  timeoutMs: number;
  log(event: Record<string, string | number | boolean | null>): void;    // sólo ids y códigos
}
interface QcReply { status: number; body: Record<string, unknown> }

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_DIM = 64, MAX_DIM = 12000;

function publicRun(run: AiRunRow) {
  return { id: run.id, sourceId: run.source_id, kind: run.kind, status: run.status, engine: run.engine, contractVersion: run.contract_version, output: run.output, failureCode: run.failure_code };
}

function dbStatus(code: string | undefined): number {
  if (code === '42501') return 403;
  if (code === '23514' || code === 'PT409' || code === '23505') return 409;
  if (code === '22023') return 400;
  return 500;
}

async function runRadiographQc(rawBody: unknown, deps: QcDeps): Promise<QcReply> {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.toLowerCase() : '';
  if (!UUID.test(sourceId)) return { status: 400, body: { error: 'Indica la fuente radiográfica.' } };
  if (!deps.provider) return { status: 503, body: { error: 'El control de calidad radiográfico no está configurado en el servidor.', code: 'disabled' } };

  const requested = await deps.requestRun(sourceId);
  if (requested.error || !requested.data) {
    deps.log({ event: 'qc_request_rejected', sourceId, code: requested.error?.code || '' });
    return { status: dbStatus(requested.error?.code), body: { error: requested.error?.message || 'No se pudo registrar la solicitud.', code: requested.error?.code || '' } };
  }
  const run = requested.data;
  if (run.status === 'completed') {
    deps.log({ event: 'qc_reused', runId: run.id, sourceId });
    return { status: 200, body: { run: publicRun(run), reused: true } };
  }
  if (run.status !== 'requested') return { status: 409, body: { error: 'La ejecución no está en un estado que permita continuar.', code: run.status } };

  const fail = async (status: number, failureCode: string, error: string, runStatus: 'failed' | 'unconfirmed' = 'failed') => {
    const closed = await deps.completeRun(run.id, runStatus, null, failureCode);
    deps.log({ event: 'qc_closed', runId: run.id, sourceId, status: runStatus, code: failureCode, persisted: !closed.error });
    return { status, body: { error, code: failureCode, run: closed.data ? publicRun(closed.data) : { id: run.id, status: runStatus, failureCode } } };
  };

  const source = await deps.loadSource(run.source_id);
  if (!source || source.tenant_id !== run.tenant_id) return fail(422, 'source_invalid', 'La fuente radiográfica no está disponible.');
  if (source.bucket !== 'smyl-radiographs' || source.size_bytes > MAX_BYTES) return fail(422, 'size_limit', 'El archivo excede el tamaño permitido.');
  const bytes = await deps.download(source.bucket, source.storage_path);
  if (!bytes) return fail(422, 'source_invalid', 'No se encontró el archivo privado.');
  if (bytes.length !== source.size_bytes || bytes.length > MAX_BYTES) return fail(422, 'source_invalid', 'El tamaño real no coincide con la fuente.');
  if ((await sha256Hex(bytes)) !== source.sha256) return fail(422, 'source_invalid', 'La huella del archivo no coincide con la fuente.');
  const probe = probeRadiograph(bytes);
  if (probe.mime !== source.mime_type) return fail(422, 'source_invalid', 'El tipo real del archivo no coincide con la fuente.');
  if (probe.reason || probe.width === null || probe.height === null) return fail(422, 'source_invalid', probe.reason || 'La imagen no declara dimensiones.');
  if (probe.width < MIN_DIM || probe.height < MIN_DIM || probe.width > MAX_DIM || probe.height > MAX_DIM) return fail(422, 'source_invalid', 'Las dimensiones de la imagen están fuera de rango.');

  const verified: VerifiedRadiographSource = {
    sourceId: source.id, sha256: source.sha256, mimeType: probe.mime, width: probe.width, height: probe.height,
    orientation: probe.orientation, studyTypeDeclared: source.study_type_declared, bytes, hints: probe.hints,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  let raw: unknown;
  try {
    raw = await deps.provider.analyze(verified, controller.signal);
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) return fail(504, 'timeout', 'El motor no respondió a tiempo; la ejecución quedó sin confirmar y no se reintenta sola.', 'unconfirmed');
    deps.log({ event: 'qc_provider_error', runId: run.id, sourceId, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return fail(502, 'provider_error', 'El motor devolvió un error.');
  }
  clearTimeout(timer);
  if (controller.signal.aborted) return fail(504, 'timeout', 'El motor no respondió a tiempo; la ejecución quedó sin confirmar y no se reintenta sola.', 'unconfirmed');

  let output;
  try { output = parseRadiographQc(raw); } catch (error) {
    deps.log({ event: 'qc_invalid_output', runId: run.id, sourceId, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return fail(502, 'invalid_output', 'La respuesta del motor no cumple el contrato.');
  }
  const m = output.model, e = run.engine, p = deps.provider.model;
  if (m.provider !== e.provider || m.name !== e.name || m.version !== e.version || m.provider !== p.provider || m.name !== p.name || m.version !== p.version) {
    return fail(502, 'invalid_output', 'La respuesta no identifica el motor registrado.');
  }
  const closed = await deps.completeRun(run.id, 'completed', output, '');
  if (closed.error || !closed.data) {
    deps.log({ event: 'qc_persist_failed', runId: run.id, sourceId, code: closed.error?.code || '' });
    return { status: dbStatus(closed.error?.code), body: { error: closed.error?.message || 'No se pudo guardar el resultado.', code: closed.error?.code || '' } };
  }
  deps.log({ event: 'qc_completed', runId: run.id, sourceId, quality: output.quality.status, studyClass: output.studyClass.value, flags: output.quality.flags.length });
  return { status: 200, body: { run: publicRun(closed.data), reused: false } };
}

return { runRadiographQc };
})();

// ── radiograph-qc/index.ts ──
// Control de calidad de una radiografía 2D (plan Etapa 2). Dedicada: NO reutiliza segment-teeth
// (ese servicio es para fotografías). La autorización la decide la base de datos con la sesión
// del usuario (smyl_radiograph_request_ai_run); service_role sólo se usa después para leer la
// fuente, descargar el archivo por su ruta conocida y cerrar la ejecución.
// Logs: ids y códigos únicamente; nunca imagen, base64, salida del motor ni datos clínicos.

const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
const SB_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SB_ANON_KEY') || '';
const PROVIDER_TIMEOUT_MS = Math.min(Math.max(Number(Deno.env.get('RADIOGRAPH_QC_TIMEOUT_MS') || 45000), 5000), 120000);
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const provider = createQcProvider(
  { RADIOGRAPH_QC_PROVIDER: Deno.env.get('RADIOGRAPH_QC_PROVIDER'), RADIOGRAPH_QC_URL: Deno.env.get('RADIOGRAPH_QC_URL'), RADIOGRAPH_QC_API_KEY: Deno.env.get('RADIOGRAPH_QC_API_KEY'),
    RADIOGRAPH_QC_PROVIDER_NAME: Deno.env.get('RADIOGRAPH_QC_PROVIDER_NAME'), RADIOGRAPH_QC_MODEL_NAME: Deno.env.get('RADIOGRAPH_QC_MODEL_NAME'),
    RADIOGRAPH_QC_MODEL_VERSION: Deno.env.get('RADIOGRAPH_QC_MODEL_VERSION'), RADIOGRAPH_PROVIDER_HOSTS: Deno.env.get('RADIOGRAPH_PROVIDER_HOSTS') },
  isAllowedRemoteUrl, parseAllowedHostSuffixes,
);

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const reply = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  let body: unknown;
  try { body = await req.json(); } catch { return reply(400, { error: 'Cuerpo no válido.' }); }
  // Cliente con la sesión de la persona: el RPC aplica tenant, permiso, alcance, bandera y motor.
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  try {
    const result = await runRadiographQc(body, {
      requestRun: async (sourceId) => {
        const { data, error } = await asUser.rpc('smyl_radiograph_request_ai_run', { p_source_id: sourceId, p_kind: 'qc', p_acknowledge_unconfirmed: false });
        return { data: (data as AiRunRow) ?? null, error: error ? { code: error.code, message: error.message } : null };
      },
      loadSource: async (sourceId) => {
        const { data } = await admin.from('smyl_radiograph_sources').select('id,tenant_id,patient_id,bucket,storage_path,sha256,mime_type,size_bytes,study_type_declared').eq('id', sourceId).maybeSingle();
        return (data as SourceRow) ?? null;
      },
      download: async (bucket, path) => {
        const downloaded = await admin.storage.from(bucket).download(path);
        if (downloaded.error || !downloaded.data) return null;
        return new Uint8Array(await downloaded.data.arrayBuffer());
      },
      completeRun: async (runId, status, output, failureCode) => {
        const { data, error } = await admin.rpc('smyl_radiograph_complete_ai_run', { p_run_id: runId, p_status: status, p_output: output, p_failure_code: failureCode, p_cost: {} });
        return { data: (data as AiRunRow) ?? null, error: error ? { code: error.code, message: error.message } : null };
      },
      provider,
      timeoutMs: PROVIDER_TIMEOUT_MS,
      log: (event) => console.log(JSON.stringify({ fn: 'radiograph-qc', actor: auth.user?.id, tenant: auth.tenantId, ...event })),
    });
    return reply(result.status, result.body);
  } catch (error) {
    console.error('[radiograph-qc]', error instanceof Error ? error.message : 'error desconocido');
    return reply(500, { error: 'No se pudo completar el control de calidad. Intenta de nuevo.' });
  }
});
