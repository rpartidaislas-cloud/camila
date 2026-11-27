import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { lanaRequest } from "../_shared/lana-linked.ts";
import { matchBranch, matchBranchInMessages } from "../_shared/branch-match.ts";
import { makeCors } from "../_shared/cors.ts";
import { MAX_CHAT_FILE_BYTES, tipoPorFirma, urlDescargable, bytesABase64, esArchivoFiscal } from "../_shared/fiscal-chat.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const MESSAGE_REWRITE_MODEL = Deno.env.get("OPENAI_MILA_MESSAGE_MODEL") || Deno.env.get("OPENAI_MILA_NOTE_MODEL") || "gpt-5-mini";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type Actor = {
  id: string;
  name: string;
  role: "owner" | "staff";
  role_code: string;
  role_name: string;
  chat_access: "none" | "agent" | "coordinator";
  permissions: string[];
  scopes: Record<string, DataScope>;
};

type DataScope = "own" | "care_team" | "branches" | "clinic";
const SCOPE_RANK: Record<DataScope, number> = { own: 1, care_team: 2, branches: 3, clinic: 4 };

const OWNER_PERMISSIONS = [
  "messages.read", "messages.respond", "messages.manage",
  "clinical.read", "clinical.write", "clinical.approve",
  "schedule.read", "schedule.manage",
];

function can(actor: Actor, permission: string): boolean {
  return (actor.role === "owner" && !permission.startsWith("messages.")) || actor.permissions.includes(permission);
}

function uuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function messageId(value: unknown): string | null {
  const candidate = String(value || "").trim();
  return /^[1-9][0-9]{0,18}$/.test(candidate) ? candidate : null;
}

// Respuesta JSON para las funciones auxiliares del módulo. Desde el 2026-10-21 la versión con CORS vive dentro del
// manejador (necesita el Origin de cada petición) y las funciones de afuera fallaban con ReferenceError: la envoltura de
// Deno.serve (al final del archivo) agrega los encabezados CORS a toda respuesta que no los traiga.
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function responseUsage(payload: Record<string, unknown>): Record<string, number> {
  const source = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  const result: Record<string, number> = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) result[key] = Math.round(value);
  }
  if (!("total_tokens" in result) && (result.input_tokens || result.output_tokens)) {
    result.total_tokens = (result.input_tokens || 0) + (result.output_tokens || 0);
  }
  return result;
}

function responseOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") return part.text;
    }
  }
  throw new Error("MILA no devolvió una redacción.");
}

function stableMessageFacts(value: string): { numbers: string[]; urls: string[] } {
  return {
    numbers: (value.match(/\b\d+(?:[.,:/-]\d+)*\b/g) || []).map((item) => item.trim()).sort(),
    urls: (value.match(/https?:\/\/[^\s]+/gi) || []).map((item) => item.trim()).sort(),
  };
}

async function improveMessageWriting(sourceText: string): Promise<{ rewrittenText: string; usage: Record<string, number> }> {
  const schema = {
    type: "object",
    properties: { rewritten_text: { type: "string" } },
    required: ["rewritten_text"],
    additionalProperties: false,
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MESSAGE_REWRITE_MODEL,
      store: false,
      max_output_tokens: 1400,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: `Eres MILA, asistente de comunicación de una clínica dental. Corrige únicamente ortografía, puntuación, concordancia, repeticiones y claridad del mensaje escrito por una persona del equipo.
Conserva exactamente el significado, tono, intención, incertidumbre, negaciones, nombres, fechas, horas, montos, teléfonos, cantidades, enlaces y compromisos. Mantén saltos de línea y emojis cuando ayuden a la lectura.
No inventes ni agregues hechos, diagnósticos, tratamientos, precios, promociones, disponibilidad, políticas ni promesas. No cambies una pregunta por una afirmación ni una posibilidad por una certeza. No respondas al paciente: solo devuelve el mismo mensaje mejor redactado en español.`,
          }],
        },
        { role: "user", content: [{ type: "input_text", text: sourceText }] },
      ],
      text: { format: { type: "json_schema", name: "mila_message_rewrite", strict: true, schema } },
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Redacción ${response.status}`);
  const parsed = JSON.parse(responseOutputText(payload)) as Record<string, unknown>;
  const rewrittenText = typeof parsed.rewritten_text === "string" ? parsed.rewritten_text.trim() : "";
  if (!rewrittenText || rewrittenText.length > 4000) throw new Error("Redacción fuera de límite");
  if (JSON.stringify(stableMessageFacts(sourceText)) !== JSON.stringify(stableMessageFacts(rewrittenText))) {
    throw new Error("La redacción alteró datos verificables");
  }
  return { rewrittenText, usage: responseUsage(payload) };
}

async function actorFor(user: { id: string; email?: string }, tenantId: string): Promise<Actor | null> {
  const { data } = await admin.from("camila_usuarios")
    .select("id,nombre,email,rol,activo")
    .eq("id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (data && data.activo === false) return null;
  const isOwner = user.id === tenantId || data?.rol === "dueño";
  const fallback = text(user.email, 160).split("@")[0] || (isOwner ? "Dueño de la clínica" : "Miembro del equipo");
  let roleCode = isOwner ? "propietario" : "sin_rol";
  let roleName = isOwner ? "Propietario" : "Sin rol operativo";
  let permissions = isOwner ? [...OWNER_PERMISSIONS] : [];
  const scopes: Record<string, DataScope> = {
    patients: isOwner ? "clinic" : "own", schedule: isOwner ? "clinic" : "own",
    clinical: isOwner ? "clinic" : "own", messages: isOwner ? "clinic" : "own",
    finance: isOwner ? "clinic" : "own",
  };
  if (!isOwner) {
    const { data: assignments } = await admin.from("smyl_member_roles")
      .select("role_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id);
    const roleIds = (assignments || []).map((row: Record<string, unknown>) => String(row.role_id || "")).filter(Boolean);
    if (roleIds.length) {
      const [{ data: roles }, { data: grants }, { data: roleScopes }] = await Promise.all([
        admin.from("smyl_roles").select("id,code,name,active").eq("tenant_id", tenantId).in("id", roleIds).eq("active", true),
        admin.from("smyl_role_permissions").select("role_id,permission_key").eq("tenant_id", tenantId).in("role_id", roleIds),
        admin.from("smyl_role_scopes").select("role_id,domain,scope").eq("tenant_id", tenantId).in("role_id", roleIds),
      ]);
      const activeRoles = roles || [];
      if (activeRoles.length) {
        roleCode = activeRoles.map((row: Record<string, unknown>) => text(row.code, 40)).filter(Boolean).join(",");
        roleName = activeRoles.map((row: Record<string, unknown>) => text(row.name, 80)).filter(Boolean).join(" · ");
        const activeIds = new Set(activeRoles.map((row: Record<string, unknown>) => String(row.id || "")));
        permissions = Array.from(new Set((grants || [])
          .filter((row: Record<string, unknown>) => activeIds.has(String(row.role_id || "")))
          .map((row: Record<string, unknown>) => text(row.permission_key, 80))
          .filter(Boolean)));
        for (const row of roleScopes || []) {
          if (!activeIds.has(String(row.role_id || ""))) continue;
          const domain = text(row.domain, 30);
          const candidate = text(row.scope, 20) as DataScope;
          if (domain in scopes && candidate in SCOPE_RANK && SCOPE_RANK[candidate] > SCOPE_RANK[scopes[domain]]) scopes[domain] = candidate;
        }
      }
    }
  }
  const access = await admin.rpc("smyl_chat_mode", { p_tenant: tenantId, p_user: user.id });
  if (access.error) throw new Error("No se pudo verificar el perfil de mensajería.");
  const mode: Actor["chat_access"] = access.data === "coordinator" || access.data === "agent" ? access.data : "none";
  permissions = permissions.filter((p) => !p.startsWith("messages."));
  if (mode !== "none") permissions.push("messages.read", "messages.respond");
  if (mode === "coordinator") permissions.push("messages.manage");
  scopes.messages = "own";
  if (mode === "coordinator") {
    const wide = await admin.rpc("smyl_chat_clinic_wide", { p_tenant: tenantId, p_user: user.id });
    if (wide.error) throw new Error("No se pudo comprobar el alcance de mensajería.");
    scopes.messages = wide.data === true ? "clinic" : "branches";
  }
  return {
    chat_access: mode,
    id: user.id,
    name: text(data?.nombre, 160) || text(data?.email, 160) || fallback,
    role: isOwner ? "owner" : "staff",
    role_code: roleCode,
    role_name: roleName,
    permissions,
    scopes,
  };
}

function assignedActorId(conversation: Record<string, unknown>): string {
  const assignment = conversation.assignment && typeof conversation.assignment === "object"
    ? conversation.assignment as Record<string, unknown> : {};
  return String(conversation.assigned_actor_id || assignment.actor_id || "");
}

async function accessiblePatient(actor: Actor, tenantId: string, patientId: string, domain: "messages" | "clinical" = "messages"): Promise<boolean> {
  const scope = actor.scopes[domain] || "own";
  if (scope === "clinic") return true;
  if (scope === "branches") {
    const { data: branches } = await admin.from("smyl_member_branches").select("branch_id").eq("tenant_id", tenantId).eq("user_id", actor.id);
    const ids = (branches || []).map((row) => row.branch_id).filter(Boolean);
    if (!ids.length) return false;
    const { data } = await admin.from("smyl_appointments").select("id").eq("tenant_id", tenantId).eq("patient_id", patientId).in("branch_id", ids).limit(1);
    return Boolean(data?.length);
  }
  const { data: professional } = await admin.from("smyl_professionals").select("id").eq("tenant_id", tenantId).eq("user_id", actor.id).eq("active", true).maybeSingle();
  if (!professional?.id) return false;
  const [{ data: team }, { data: appointments }] = await Promise.all([
    admin.from("smyl_patient_care_team").select("patient_id").eq("tenant_id", tenantId).eq("patient_id", patientId).eq("professional_id", professional.id).eq("active", true).limit(1),
    admin.from("smyl_appointments").select("id").eq("tenant_id", tenantId).eq("patient_id", patientId).eq("professional_id", professional.id).limit(1),
  ]);
  return Boolean(team?.length || appointments?.length);
}

type BranchAssignment = { branch_id: string; source: string };

async function branchAssignments(tenantId: string, ids: string[]): Promise<Map<string, BranchAssignment>> {
  const result = new Map<string, BranchAssignment>();
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, 200);
  if (!unique.length) return result;
  const { data } = await admin.from("smyl_conversation_branches").select("conversation_id,branch_id,source")
    .eq("tenant_id", tenantId).in("conversation_id", unique);
  for (const row of (data || []) as Record<string, unknown>[]) {
    result.set(String(row.conversation_id), { branch_id: String(row.branch_id), source: text(row.source, 20) || "manual" });
  }
  return result;
}

async function memberBranchIds(actor: Actor, tenantId: string): Promise<string[]> {
  const { data } = await admin.from("smyl_member_branches").select("branch_id").eq("tenant_id", tenantId).eq("user_id", actor.id);
  return ((data || []) as Record<string, unknown>[]).map((row) => String(row.branch_id || "")).filter(Boolean);
}

async function activeBranches(tenantId: string): Promise<{ id: string; name: string; is_default: boolean }[]> {
  const { data } = await admin.from("smyl_branches").select("id,name,is_default").eq("tenant_id", tenantId).eq("active", true).order("is_default", { ascending: false }).order("name");
  return ((data || []) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), name: text(row.name, 120), is_default: Boolean(row.is_default) }));
}

type Assignment = { conversation_id: string; assignee_id: string | null; version: number; updated_at: string };
async function chatAssignments(tenantId: string, ids: string[]): Promise<Map<string, Assignment>> {
  if (!ids.length) return new Map();
  const {data, error} = await admin.from("smyl_chat_assignments").select("conversation_id,assignee_id,version,updated_at")
    .eq("tenant_id",tenantId).in("conversation_id", ids);
  if (error) throw new Error("No se pudo verificar el responsable del chat.");
  return new Map((data || []).map((row: Assignment) => [row.conversation_id, row]));
}

async function canAccessConversation(actor: Actor, tenantId: string, conversationId: string): Promise<boolean> {
  const result = await admin.rpc("smyl_chat_visible", { p_tenant: tenantId, p_actor: actor.id, p_conversation: conversationId });
  if (result.error) throw new Error("No se pudo comprobar el acceso a esta conversación.");
  return result.data === true;
}
type ChatMember = { id:string; name:string; chat_mode:string; kind:string };
async function visibleChatIds(tenantId: string, actor: Actor, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const result = await admin.rpc("smyl_chat_visible_ids",{p_tenant:tenantId,p_actor:actor.id,p_conversations:ids});
  if (result.error) throw new Error("No se pudo validar el alcance de la bandeja.");
  return new Set(result.data || []);
}

async function assignableTeam(tenantId: string, conversationId?: string | null): Promise<ChatMember[]> {
  const {data,error} = conversationId
    ? await admin.rpc("smyl_chat_recipients", { p_tenant: tenantId, p_conversation: conversationId })
    : await admin.rpc("smyl_chat_assistants", { p_tenant: tenantId });
  if (error) throw new Error("No se pudo consultar el equipo de chat.");
  return (data || []) as ChatMember[];
}
function projectOwner(row: Record<string,unknown>, assignment: Assignment | undefined, members: Map<string, ChatMember>) {
  const id = assignment?.assignee_id || null, name = id ? members.get(id)?.name || "Integrante del equipo" : null;
  delete row.private_handoff_note;
  row.assignment_version = assignment?.version || 0;
  row.assigned_actor_id = id; row.assigned_actor_name = name; row.legacy_assigned = false;
  row.assignment = id ? {actor_id:id,name,source:"smyl"} : null;
  return row;
}
// LANA serializes assignments with the connector's owner capability. This identity is used
// only for a tenant-bound inbox read or to project the authoritative SMYL assignment.
function connectorHeaders(tenantId: string, key?: string): Headers {
  const headers = new Headers({ "X-SMYL-Actor-Id": tenantId, "X-SMYL-Actor-Role": "owner",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent("Integración SMYL") });
  if (key) headers.set("Idempotency-Key", key);
  return headers;
}

async function syncProviderOwner(tenantId: string, conversationId: string, roster: ChatMember[]): Promise<boolean> {
  // Re-read after the write: a newer transfer may have committed while LANA was processing it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = (await chatAssignments(tenantId, [conversationId])).get(conversationId);
    if (!before) return true;
    const target = before.assignee_id;
    const path = "/inbox/conversations/" + conversationId + (target ? "/assign" : "/release");
    const payload = target ? { target_actor_id: target, target_actor_name: roster.find(m => m.id === target)?.name || "Integrante del equipo" } : {};
    const remote = await lanaRequest(tenantId, path, { method: "POST", headers: connectorHeaders(tenantId, crypto.randomUUID()), body: JSON.stringify(payload) }, 10000);
    if (!remote.response.ok) return false;
    const current = (await chatAssignments(tenantId, [conversationId])).get(conversationId);
    if (current?.version === before.version) return true;
  }
  return false;
}

const APPOINTMENT_STAGES = new Set(["smyl:confirmed", "smyl:arrived", "smyl:attended"]);

type PipelineContext = {
  conversation_id: string;
  stage_source: "manual" | "appointment" | "lana";
  effective_stage_id: string | null;
  manual_revision: number;
  appointment: { id: string; status: string; starts_at: string; ends_at: string; timezone: string | null } | null;
};

async function pipelineContext(tenantId: string, actor: Actor, ids: string[]): Promise<Map<string, PipelineContext>> {
  if (!ids.length) return new Map();
  const { data, error } = await admin.rpc("smyl_chat_pipeline_context", {
    p_tenant: tenantId, p_actor: actor.id, p_conversations: ids,
  });
  if (error || !Array.isArray(data)) throw new Error("No se pudo comprobar la etapa de los chats.");
  return new Map(data.map((context: PipelineContext) => [context.conversation_id, context]));
}

function projectPipeline(row: Record<string, unknown>, context: PipelineContext, providerKnown = true) {
  const providerStage = uuid(row.stage_id);
  const source = context.stage_source === "appointment" ? "agenda" :
    context.stage_source === "manual" ? "manual" : providerStage || !providerKnown ? "lana" : "none";
  row.stage_id = source === "manual" || source === "agenda" ? context.effective_stage_id : providerStage;
  row.pipeline = {
    stage_id: row.stage_id, source, revision: context.manual_revision,
    ...(providerKnown ? {provider_stage_id:providerStage} : {}),
  };
  const visit = context.appointment;
  row.appointment = visit ? { id:visit.id, status:visit.status, starts_at:visit.starts_at, ends_at:visit.ends_at, timezone:visit.timezone } : null;
}

async function movePipelineStage(actor: Actor, tenantId: string, conversationId: string, input: Record<string, unknown>): Promise<Response> {
  const raw = input.target_stage_id;
  const stage = raw === null || raw === "" ? null : typeof raw === "string" && APPOINTMENT_STAGES.has(raw) ? raw : uuid(raw);
  if (stage === null && raw !== null && raw !== "") return json(400, { error:"La etapa seleccionada no es válida." });
  let revision = input.expected_revision;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || Number(revision) < 0)) {
    return json(400, {error:"La revisión del tablero no es válida."});
  }
  const headers = connectorHeaders(tenantId);
  const thread = await lanaRequest(tenantId, "/inbox/conversations/" + conversationId + "/messages?limit=1", {method:"GET",headers}, 10000);
  const record = thread.body.conversation as Record<string, unknown> | undefined;
  if (!thread.response.ok || record?.id !== conversationId) {
    return json(thread.response.ok ? 404 : thread.response.status, {error:"No se pudo verificar la conversación."});
  }
  if (stage && !APPOINTMENT_STAGES.has(stage)) {
    const catalog = await lanaRequest(tenantId, "/inbox/stages", {method:"GET",headers:actorHeaders(actor)}, 10000);
    if (!catalog.response.ok) return json(catalog.response.status, {error:"No se pudo consultar el catálogo de etapas."});
    const available = Array.isArray(catalog.body.stages) && catalog.body.stages.some(row => row?.id === stage && !row.archived);
    if (!available) return json(400, {error:"Elige una etapa activa de esta clínica."});
  }
  // Clientes anteriores aún no incluyen la revisión. Se protege igualmente el intervalo lectura/escritura.
  if (revision === undefined) {
    const current = (await pipelineContext(tenantId, actor, [conversationId])).get(conversationId);
    if (!current) return forbiddenConversation();
    revision = current.manual_revision;
  }
  const result = await admin.rpc("smyl_chat_set_pipeline_stage", {
    p_tenant:tenantId, p_actor:actor.id, p_conversation:conversationId, p_stage_id:stage, p_expected_revision:revision,
  });
  if (result.error?.code === "40001") return json(409,{error:"La etapa cambió. Actualiza el tablero.",code:"pipeline_conflict"});
  if (result.error?.code === "42501") return forbiddenConversation();
  if (result.error || result.data?.conversation_id !== conversationId) throw new Error("No se pudo guardar la etapa del chat.");
  const response = {ok:true, conversation_id:conversationId, stage_id:record.stage_id} as Record<string,unknown>;
  projectPipeline(response, result.data as PipelineContext);
  return json(200, response);
}

async function projectConversation(actor: Actor, tenantId: string, row: Record<string, unknown>, includeNote = false) {
  const id = uuid(row.id);
  if (!id) return;
  const [assignments, roster, stages] = await Promise.all([
    chatAssignments(tenantId, [id]), assignableTeam(tenantId), pipelineContext(tenantId, actor, [id]),
  ]);
  const currentStage = stages.get(id);
  if (currentStage) projectPipeline(row, currentStage);
  const owner = assignments.get(id);
  const oldAssignment = row.assignment as Record<string,unknown> | null;
  if (includeNote && owner && (assignedActorId(row) !== (owner.assignee_id || "") || oldAssignment?.source === "lana")) {
    row.provider_sync = await syncProviderOwner(tenantId, id, roster).catch(() => false) ? "synced" : "pending";
  }
  projectOwner(row, owner, new Map(roster.map(m => [m.id,m])));
  if (includeNote && owner && (owner.assignee_id === actor.id || actor.chat_access === "coordinator")) {
    const {data,error} = await admin.from("smyl_chat_handoffs").select("note").eq("tenant_id",tenantId)
      .eq("conversation_id",id).eq("version",owner.version).maybeSingle();
    if (error) throw new Error("No se pudo consultar la nota del traspaso.");
    row.private_handoff_note = data?.note || null;
  }
}

async function transferChat(actor: Actor, tenantId: string, id: string, action: string, input: Record<string,unknown>) {
  const target = action === "release" ? null : uuid(input.target_actor_id);
  if (action === "assign" && !target) return json(400,{error:"Elige una persona para atender el chat."});
  if (!Number.isSafeInteger(input.expected_version) || Number(input.expected_version) < 0) return json(400,{error:"Actualiza la conversación antes de transferirla."});
  const note = input.private_note ?? "";
  if (typeof note !== "string" || note.trim().length > 1000) return json(400,{error:"La nota debe tener hasta 1,000 caracteres."});
  if (!target && actor.chat_access !== "coordinator") return forbiddenConversation();
  const roster = await assignableTeam(tenantId, id);
  const recipient = roster.find(member => member.id === target);
  if (target && !recipient) return json(400,{error:"Elige un integrante habilitado para atender chats."});
  const check = await lanaRequest(tenantId, "/inbox/conversations/" + id + "/messages?limit=1",
    {method:"GET", headers:connectorHeaders(tenantId)}, 10000);
  if (!check.response.ok || (check.body.conversation as {id?:string} | undefined)?.id !== id) return json(check.response.ok ? 404 : check.response.status,{error:"No se pudo verificar la conversación."});
  const saved = await admin.rpc("smyl_transfer_chat", { p_tenant:tenantId, p_actor:actor.id, p_conversation:id,
    p_target:target, p_note:note.trim(), p_expected_version:input.expected_version });
  if (saved.error) {
    if (saved.error.code === "40001") return json(409,{error:"La asignación cambió. Actualiza el chat.",code:"assignment_conflict"});
    if (saved.error.code === "42501") return forbiddenConversation();
    if (saved.error.code === "22023") return json(400,{error:"Elige un responsable habilitado distinto al actual."});
    throw new Error("No se pudo guardar el traspaso.");
  }
  const synced = await syncProviderOwner(tenantId, id, roster).catch(() => false);
  return json(200,{ok:true, conversation_id:id, assigned_actor_id:target, assigned_actor_name:recipient?.name || null,
    assignment_version:saved.data.version, can_operate:await canAccessConversation(actor,tenantId,id), provider_sync:synced ? "synced" : "pending"});
}

async function listTeam(tenantId: string, conversationId: string | null): Promise<Response> {
  return json(200, {ok:true,members:await assignableTeam(tenantId, conversationId)});
}

async function inferChatBranch(actor: Actor, tenantId: string, conversationId: string, branchId: string) {
  const result = await admin.rpc("smyl_chat_infer_branch", {
    p_tenant: tenantId, p_actor: actor.id, p_conversation: conversationId, p_branch: branchId,
  });
  if (result.error) throw new Error("No se pudo verificar la sucursal del chat.");
}

async function filterConversationPayload(actor: Actor, tenantId: string, body: Record<string, unknown>, url: URL): Promise<Record<string, unknown>> {
  if (!Array.isArray(body.conversations)) return {conversations:[], synced_at:body.synced_at || new Date().toISOString()};
  const sliced = body.conversations.slice(0, 100);
  const ids = sliced.map((value) => value && typeof value === "object" ? uuid((value as Record<string, unknown>).id) : null).filter(Boolean) as string[];
  let [assignments, branches] = await Promise.all([branchAssignments(tenantId, ids), activeBranches(tenantId)]);
  const names = new Map(branches.map(branch => [branch.id, branch.name]));
  if (branches.length > 1) {
    const candidates = sliced.filter((row: Record<string, unknown>) => row && typeof row === "object" &&
      row.last_message_role === "patient" && !assignments.has(String(row.id)));
    const eligible = await visibleChatIds(tenantId, actor, candidates.map(row => uuid(row.id)).filter(Boolean) as string[]);
    let inferred = false;
    for (const row of candidates) {
      const id = uuid(row.id);
      if (!id || !eligible.has(id)) continue;
      const branch = matchBranch(text(row.last_message, 600), branches);
      if (!branch) continue;
      await inferChatBranch(actor, tenantId, id, branch.id);
      inferred = true;
    }
    if (inferred) assignments = await branchAssignments(tenantId, ids);
  }
  const [owners, roster, visible] = await Promise.all([chatAssignments(tenantId,ids), assignableTeam(tenantId), visibleChatIds(tenantId,actor,ids)]);
  const members = new Map(roster.map(m=>[m.id,m]));
  const pick = url.searchParams.get("assignee"), filter = url.searchParams.get("filter");
  const allowed: Record<string,unknown>[] = [];
  for (const value of sliced) {
    if (!value || typeof value !== "object") continue;
    const conversation = {...value as Record<string,unknown>}, id = uuid(conversation.id);
    if (!id) continue;
    const assigned = assignments.get(id), owner = owners.get(id), ownerId = owner?.assignee_id || null;
    if (!visible.has(id) || (actor.chat_access === "agent" && ownerId !== actor.id)) continue;
    const branchFilter = url.searchParams.get("branch_id");
    if (branchFilter && branchFilter !== (assigned?.branch_id || "none")) continue;
    if (((filter === "mine" || pick === "me") && ownerId !== actor.id) || ((filter === "unassigned" || pick === "unassigned") && ownerId)
       || (pick && uuid(pick) && pick !== ownerId)) continue;
    conversation.branch = assigned ? {id:assigned.branch_id,name:names.get(assigned.branch_id)||"Sucursal",source:assigned.source} : null;
    // SMYL ya comprobó acceso y alcance de esta conversación arriba: no se depende de que LANA mande «can_operate» (si falta, el chat ocultaba «Agendar» y otras acciones sin avisar).
    if (typeof conversation.can_operate !== "boolean") conversation.can_operate = true;
    allowed.push(projectOwner(conversation,owner,members));
  }
  const stages = await pipelineContext(tenantId, actor, allowed.map(row => String(row.id)));
  const stageFilter = url.searchParams.get("stage_id");
  const conversations = allowed.filter(row => {
    const context = stages.get(String(row.id));
    if (!context) return false;
    projectPipeline(row, context);
    return !stageFilter || (row.stage_id || "none") === stageFilter;
  });
  return { conversations, synced_at:body.synced_at || new Date().toISOString(), truncated:body.truncated === true };
}

// Paginar sobre el origen, incluso cuando una página no contiene hilos visibles.
// El cliente recibe un cursor opaco numérico, nunca el total ni los contadores globales.
async function listScoped(actor: Actor, tenantId: string, url: URL): Promise<Response> {
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get("limit"))||40)));
  const start = Math.min(1000000,Math.max(0,Math.trunc(Number(url.searchParams.get("offset"))||0)));
  let offset = start, hasMore = true; const rows: unknown[] = [];
  const since = new Date().toISOString();
  const source = new URL(url); source.searchParams.delete("assignee"); source.searchParams.delete("branch_id");
  // LANA sólo conoce sus etapas comerciales. El filtro se evalúa sobre la etapa efectiva de SMYL.
  source.searchParams.delete("stage_id");
  if (["mine","unassigned"].includes(source.searchParams.get("filter") || "")) source.searchParams.set("filter","all");
  for (let batch=0; batch<4 && hasMore && rows.length<limit; batch++) {
    const take = Math.min(100, Math.max(limit, 40));
    source.searchParams.set("limit",String(take)); source.searchParams.set("offset",String(offset));
    const remote = await lanaRequest(tenantId,queryPath(source,"list",null)!,{method:"GET",headers:connectorHeaders(tenantId)},15000);
    if (!remote.response.ok) return json(remote.response.status,{error:"No se pudo consultar la bandeja."});
    const raw = Array.isArray(remote.body.conversations) ? remote.body.conversations as {id:string}[] : [];
    const page = remote.body.page as {has_more?:boolean} | undefined;
    const scoped = await filterConversationPayload(actor,tenantId,remote.body,url);
    const visible = scoped.conversations as {id:string}[];
    const selected = visible.slice(0,limit-rows.length);
    rows.push(...selected);
    const consumed = selected.length && rows.length===limit ? raw.findIndex(r=>r.id===selected[selected.length-1].id)+1 : raw.length;
    offset += consumed;
    hasMore = consumed>0 && (consumed<raw.length || (page?.has_more ?? raw.length>=take));
  }
  return json(200,{conversations:rows, actor, synced_at:since, page:{total:rows.length,has_more:hasMore,next_offset:offset}});
}

// Al abrir una conversación: muestra su sucursal y, si aún no tiene, la deduce de lo que dijo el paciente.
async function attachThreadBranch(actor: Actor, tenantId: string, body: Record<string, unknown>): Promise<void> {
  const conversation = body.conversation && typeof body.conversation === "object" ? body.conversation as Record<string, unknown> : null;
  const id = conversation ? uuid(conversation.id) : null;
  if (!conversation || !id) return;
  const [assignments, branches] = await Promise.all([branchAssignments(tenantId, [id]), activeBranches(tenantId)]);
  let assigned = assignments.get(id);
  if (!assigned && branches.length > 1 && Array.isArray(body.messages)) {
    const hit = matchBranchInMessages(body.messages as { role?: string; content?: string }[], branches);
    if (hit) {
      await inferChatBranch(actor, tenantId, id, hit.id);
      assigned = (await branchAssignments(tenantId, [id])).get(id);
    }
  }
  const name = assigned ? branches.find((branch) => branch.id === assigned!.branch_id)?.name : "";
  conversation.branch = assigned ? { id: assigned.branch_id, name: name || "Sucursal", source: assigned.source } : null;
}

// Sincronización: si alguien cambió la sucursal de una conversación desde la última consulta, quien ya no puede verla la pierde
// de su bandeja y los demás recargan la lista (la sucursal vive en SMYL, así que LANA no la marca como cambiada).
async function attachBranchChanges(actor: Actor, tenantId: string, url: URL, body: Record<string,unknown>, remote: Record<string,unknown>) {
  const since = url.searchParams.get("since") || "";
  if (!Number.isFinite(Date.parse(since))) return;
  const stamp = new Date(since).toISOString();
  const known = [...new Set((url.searchParams.get("visible_ids")||"").split(",").map(uuid).filter(Boolean) as string[])].slice(0,100);
  const visible = await visibleChatIds(tenantId,actor,known);
  const deleted = new Set(Array.isArray(remote.removed_conversation_ids) ? remote.removed_conversation_ids as string[] : []);
  body.removed_conversation_ids = known.filter(id => deleted.has(id) || !visible.has(id));
  const transfers = await admin.from("smyl_chat_handoffs").select("conversation_id").eq("tenant_id",tenantId)
    .eq("to_user_id",actor.id).gte("created_at",stamp).order("created_at",{ascending:false}).limit(100);
  if (transfers.error) throw new Error("No se pudieron consultar los traspasos.");
  const received = [...new Set<string>((transfers.data || []).map(row => String(row.conversation_id)))];
  const [current, visibleReceived] = await Promise.all([
    chatAssignments(tenantId, received), visibleChatIds(tenantId, actor, received),
  ]);
  body.received_conversation_ids = received.filter(id => visibleReceived.has(id) && !deleted.has(id) && current.get(id)?.assignee_id === actor.id);
  // A former recipient must also reconcile when the chat was outside their current page.
  const departures = await admin.from("smyl_chat_handoffs").select("conversation_id").eq("tenant_id",tenantId)
    .eq("from_user_id",actor.id).gte("created_at",stamp).limit(100);
  if (departures.error) throw new Error("No se pudieron verificar las transferencias salientes.");
  const previous = [...new Set<string>((departures.data || []).map(row => String(row.conversation_id)))];
  if (previous.length) {
    const stillVisible = await visibleChatIds(tenantId,actor,previous);
    const removed = new Set(body.removed_conversation_ids as string[]);
    for (const id of previous) if (!stillVisible.has(id)) removed.add(id);
    body.removed_conversation_ids = [...removed];
  }
  const changed = await admin.rpc("smyl_chat_scope_changed", { p_tenant: tenantId, p_actor: actor.id, p_since: stamp });
  if (changed.error) throw new Error("No se pudieron actualizar las asignaciones.");
  body.branch_changed = changed.data === true || (body.removed_conversation_ids as string[]).length > 0;
  Object.assign(body, await pipelineDelta(tenantId, actor, [...visible], stamp));
}

async function pipelineDelta(tenantId: string, actor: Actor, visibleIds: string[], since: string | null) {
  const delta = since && visibleIds.length ? await admin.rpc("smyl_chat_pipeline_changed", {
    p_tenant:tenantId, p_actor:actor.id, p_conversations:visibleIds, p_since:since,
  }) : {data:!since && visibleIds.length > 0,error:null};
  if (delta.error) throw new Error("No se pudo comprobar si cambió el tablero.");
  const contexts = delta.data === true ? await pipelineContext(tenantId, actor, visibleIds) : new Map<string,PipelineContext>();
  const updates = [...contexts.values()].map(context => {
    const item: Record<string,unknown> = {id:context.conversation_id};
    projectPipeline(item, context, false);
    return item;
  });
  return {pipeline_changed:delta.data === true, pipeline_updates:updates};
}

async function pipelineUpdates(actor: Actor, tenantId: string, url: URL): Promise<Response> {
  const syncedAt = new Date().toISOString();
  const values = (url.searchParams.get("visible_ids") || "").split(",").filter(Boolean);
  const since = url.searchParams.get("since") || null;
  if (values.length > 100 || values.some(id => !uuid(id)) || (since && !Number.isFinite(Date.parse(since)))) {
    return json(400,{error:"Lote de conversaciones o fecha de sincronización no válidos."});
  }
  const ids = [...new Set(values)];
  const visible = await visibleChatIds(tenantId,actor,ids);
  const changes = await pipelineDelta(tenantId, actor, [...visible], since);
  return json(200,{...changes, removed_conversation_ids:ids.filter(id => !visible.has(id)), synced_at:syncedAt});
}

function forbiddenConversation(): Response {
  return json(403, { error: "Esta conversación queda fuera del alcance de tu rol.", code: "conversation_scope_denied" });
}

// La lista de responsables utiliza el mismo perfil explícito que la transferencia.

async function availabilityCatalog(tenantId: string): Promise<Response> {
  const [servicesResult, branchesResult, professionalsResult, linksResult] = await Promise.all([
    admin.from("smyl_services").select("id,name,duration_minutes,category").eq("tenant_id", tenantId).eq("active", true).order("name"),
    admin.from("smyl_branches").select("id,name,timezone").eq("tenant_id", tenantId).eq("active", true).order("name"),
    admin.from("smyl_professionals").select("id,display_name,specialty").eq("tenant_id", tenantId).eq("active", true).order("display_name"),
    admin.from("smyl_professional_services").select("professional_id,service_id").eq("tenant_id", tenantId),
  ]);
  const failed = [servicesResult, branchesResult, professionalsResult, linksResult].find((result) => result.error);
  if (failed?.error) return json(500, { error: "No se pudo consultar la configuración de Agenda." });
  return json(200, {
    ok: true,
    services: servicesResult.data || [],
    branches: branchesResult.data || [],
    professionals: professionalsResult.data || [],
    professional_services: linksResult.data || [],
  });
}

async function availableSlots(actor: Actor, tenantId: string, url: URL): Promise<Response> {
  const serviceId = uuid(url.searchParams.get("service_id"));
  const branchId = url.searchParams.get("branch_id") ? uuid(url.searchParams.get("branch_id")) : null;
  const professionalId = url.searchParams.get("professional_id") ? uuid(url.searchParams.get("professional_id")) : null;
  const from = new Date(String(url.searchParams.get("from") || ""));
  const to = new Date(String(url.searchParams.get("to") || ""));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 30);
  if (!serviceId || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return json(400, { error: "Selecciona un servicio y un periodo válidos." });
  }
  if (url.searchParams.get("branch_id") && !branchId) return json(400, { error: "Sucursal no válida." });
  if (url.searchParams.get("professional_id") && !professionalId) return json(400, { error: "Profesional no válido." });
  const { data, error } = await admin.rpc("smyl_inbox_available_slots", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_service_id: serviceId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_branch_id: branchId,
    p_professional_id: professionalId,
    p_limit: limit,
  });
  if (error) {
    console.error("[lana-inbox] availability", error.message);
    const forbidden = error.code === "42501";
    return json(forbidden ? 403 : 400, { error: forbidden ? "Tu rol no permite consultar disponibilidad." : "No se pudo calcular la disponibilidad solicitada." });
  }
  return json(200, { ok: true, slots: data || [], generated_at: new Date().toISOString(), holds_created: false });
}

async function appointmentContext(actor: Actor, tenantId: string, conversationId: string, requestsOnly = false): Promise<Response> {
  const {data, error} = await admin.rpc("smyl_chat_request_context", {
    p_tenant:tenantId, p_actor:actor.id, p_conversation:conversationId, p_limit:requestsOnly ? 20 : 10,
  });
  if (error?.code === "42501") return forbiddenConversation();
  if (error || !data || !Array.isArray(data.items)) return json(500, {error:"No se pudo consultar la continuidad de Agenda."});
  if (requestsOnly) {
    const requests = data.items.map(({service, branch, professional, appointment, ...request}: Record<string,unknown>) => request);
    return json(200, {ok:true, requests});
  }
  return json(200, {ok:true, ...data});
}

async function createAppointmentRequest(actor: Actor, tenantId: string, conversationId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Response> {
  const serviceId = uuid(body.service_id); const branchId = uuid(body.branch_id); const professionalId = uuid(body.professional_id);
  const startsAt = new Date(String(body.starts_at || ""));
  if (!serviceId || !branchId || !professionalId || !Number.isFinite(startsAt.getTime())) return json(400, { error: "La elección de horario está incompleta." });
  const { data, error } = await admin.rpc("smyl_inbox_create_appointment_request", {
    p_tenant_id: tenantId, p_actor_id: actor.id, p_conversation_id: conversationId,
    p_service_id: serviceId, p_branch_id: branchId, p_professional_id: professionalId,
    p_starts_at: startsAt.toISOString(), p_external_key: idempotencyKey,
  });
  if (error) {
    console.error("[lana-inbox] appointment request", error.message);
    return json(error.code === "42501" ? 403 : 409, { error: error.message || "No se pudo registrar la elección." });
  }
  return json(200, { ok: true, request_id: data, status: "pending", appointment_created: false, message_sent: false });
}

async function confirmAppointmentRequest(actor: Actor, tenantId: string, conversationId: string, requestId: string, appointmentId: string): Promise<Response> {
  const { data, error } = await admin.rpc("smyl_chat_confirm_request", {
    p_tenant:tenantId, p_actor:actor.id, p_conversation:conversationId, p_request:requestId, p_appointment:appointmentId,
  });
  if (error) {
    console.error("[lana-inbox] appointment confirm", error.message);
    return json(error.code === "42501" ? 403 : 409, { error: error.message || "No se pudo confirmar la cita." });
  }
  return json(200, { ok: true, appointment_id: data, status: "confirmed", message_sent: false });
}

function actorHeaders(actor: Actor, idempotencyKey?: string | null): Headers {
  const headers = new Headers({
    "X-SMYL-Actor-Id": actor.id,
    "X-SMYL-Actor-Role": actor.role,
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(actor.name),
  });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return headers;
}

// Resumen de conversación guardado (tabla smyl_conversation_summaries, sin acceso desde el navegador).
const SUMMARY_TABLE = "smyl_conversation_summaries";

function summaryList(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((item) => text(item, 300)).filter(Boolean).slice(0, 8);
}

function cleanSummary(body: Record<string, unknown>): Record<string, unknown> | null {
  const summary = text(body.summary, 4000);
  if (!summary) return null;
  return {
    summary,
    next_step: text(body.next_step, 600),
    open_questions: summaryList(body.open_questions),
    unconfirmed_facts: summaryList(body.unconfirmed_facts),
    requires_human: body.requires_human === true,
  };
}

function isoDate(value: unknown): string | null {
  const raw = text(value, 40);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Quien tiene clinical.read y alcance clínico sobre el paciente del chat puede ver el resumen hecho con contexto clínico.
async function clinicalSummaryAllowed(actor: Actor, tenantId: string, conversationId: string): Promise<boolean> {
  if (!can(actor, "clinical.read")) return false;
  const { data: handoff } = await admin.from("camila_lana_handoffs").select("patient_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  return Boolean(handoff?.patient_id && await accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical"));
}

async function storedSummary(actor: Actor, tenantId: string, conversationId: string): Promise<Record<string, unknown>> {
  const allowClinical = await clinicalSummaryAllowed(actor, tenantId, conversationId);
  let query = admin.from(SUMMARY_TABLE).select("summary,basis_at,generated_at,generated_by_name,includes_clinical")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId);
  if (!allowClinical) query = query.eq("includes_clinical", false);
  const { data, error } = await query.order("generated_at", { ascending: false }).limit(1);
  // Sin la migración aplicada la ficha sigue funcionando: simplemente no hay resumen guardado.
  if (error) return { ok: true, summary: null, storage: "unavailable" };
  const row = data && data[0];
  if (!row) return { ok: true, summary: null, storage: "ready" };
  return {
    ok: true, storage: "ready", summary: row.summary, basis_at: row.basis_at, generated_at: row.generated_at,
    generated_by_name: row.generated_by_name || "", includes_clinical: Boolean(row.includes_clinical),
  };
}

async function saveSummary(actor: Actor, tenantId: string, conversationId: string, summary: Record<string, unknown>, includesClinical: boolean, basisAt: string | null) {
  const generatedAt = new Date().toISOString();
  const { error } = await admin.from(SUMMARY_TABLE).upsert({
    tenant_id: tenantId, lana_conversation_id: conversationId, includes_clinical: includesClinical,
    summary, basis_at: basisAt, generated_by: actor.id, generated_by_name: text(actor.name, 120), generated_at: generatedAt,
  }, { onConflict: "tenant_id,lana_conversation_id,includes_clinical" });
  if (error) {
    console.warn("No se guardó el resumen de la conversación", error.code || error.message);
    return { stored: false };
  }
  return { stored: true, generated_at: generatedAt, generated_by_name: text(actor.name, 120), basis_at: basisAt };
}

type MedicalAlert = { kind: "alert" | "allergy"; label: string; detail: string; severity: string };

const ALLERGY_SEVERITY: Record<string, string> = { low: "Baja", moderate: "Moderada", high: "Alta" };
const HISTORY_STATUSES = ["yes", "no", "unknown", "pending"];

function historyText(value: unknown, max = 120): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Misma lógica que smyl-history-model.js: registros con detalle y, si no hay, las listas antiguas.
function historyAllergies(document: Record<string, unknown>): Array<{ substance: string; reaction: string; severity: string }> {
  const rows = Array.isArray(document.allergy_records)
    ? document.allergy_records.filter((row) => row && typeof row === "object").map((row) => {
      const record = row as Record<string, unknown>;
      return { substance: historyText(record.substance), reaction: historyText(record.reaction), severity: historyText(record.severity, 20) };
    }).filter((row) => row.substance || row.reaction)
    : [];
  if (rows.length) return rows;
  return (Array.isArray(document.allergies) ? document.allergies : [])
    .map((value) => ({ substance: historyText(value), reaction: "", severity: "" })).filter((row) => row.substance);
}

function historyReviewed(document: Record<string, unknown>, key: string, count: number): boolean {
  if (count) return true;
  const value = String(document[key] || "");
  const status = HISTORY_STATUSES.includes(value) ? value : "pending";
  return status === "no";
}

// Alertas médicas para la cabecera de la Ficha 360: etiquetas del alta del paciente + historia clínica vigente.
// Solo se arma después de comprobar el alcance clínico del rol (accessiblePatient … "clinical").
function medicalAlerts(patientTags: unknown, history: { document?: unknown; updated_at?: string | null } | null) {
  const document = history && history.document && typeof history.document === "object" ? history.document as Record<string, unknown> : {};
  const items: MedicalAlert[] = []; const seen = new Set<string>();
  const push = (item: MedicalAlert) => {
    const key = item.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!item.label || seen.has(key) || items.length >= 12) return;
    seen.add(key); items.push(item);
  };
  const allergies = historyAllergies(document);
  allergies.forEach((row) => push({
    kind: "allergy", label: row.substance || "Alergia sin sustancia", severity: row.severity in ALLERGY_SEVERITY ? row.severity : "",
    detail: [row.reaction ? `Reacción: ${row.reaction}` : "", ALLERGY_SEVERITY[row.severity] ? `Gravedad: ${ALLERGY_SEVERITY[row.severity]}` : ""].filter(Boolean).join(" · "),
  }));
  const historyAlerts = (Array.isArray(document.alerts) ? document.alerts : []).map((value) => historyText(value)).filter(Boolean);
  historyAlerts.forEach((label) => push({ kind: "alert", label, detail: "", severity: "" }));
  (Array.isArray(patientTags) ? patientTags : []).map((value) => historyText(value, 80)).filter(Boolean)
    .forEach((label) => push({ kind: "alert", label, detail: "", severity: "" }));
  items.sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high") || Number(b.kind === "allergy") - Number(a.kind === "allergy"));
  const reviewed = historyReviewed(document, "alerts_status", historyAlerts.length) && historyReviewed(document, "allergies_status", allergies.length);
  return { items, reviewed, has_history: Boolean(history), history_updated_at: history?.updated_at || null };
}

async function clinicalContext(actor: Actor, tenantId: string, conversationId: string): Promise<Response> {
  const { data: handoff, error } = await admin.from("camila_lana_handoffs")
    .select("id,patient_id,case_id,lana_channel,created_at")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (error) return json(500, { error: "No se pudo consultar la Ficha 360." });
  if (!handoff) return json(200, { ok: true, linked: false, patient: null, case: null, clinical_images: [] });
  if (!await accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical")) {
    return json(403, { error: "El expediente queda fuera del alcance clínico de tu rol.", code: "patient_scope_denied" });
  }
  const caseQuery = handoff.case_id
    ? admin.from("camila_casos").select("id,nombre_paciente,telefono,email,score,score_lbl,resumen,diagnostico,total_cotizacion,simulacion_url,fotos_count,lana_cita_id,created_at")
      .eq("tenant_id", tenantId).eq("id", handoff.case_id).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const linksQuery = handoff.case_id
    ? admin.from("camila_lana_clinical_links").select("id,lana_message_id,media_type,status,label,created_at")
      .eq("tenant_id", tenantId).eq("case_id", handoff.case_id).order("created_at", { ascending: false }).limit(50)
    : Promise.resolve({ data: [], error: null });
  const [{ data: patient }, { data: caseRow }, { data: links }, { data: history }] = await Promise.all([
    admin.from("camila_pacientes").select("id,nombre,apellido,email,telefono,fecha_nacimiento,genero,notas,updated_at,consentimiento_whatsapp,alertas_medicas")
      .eq("tenant_id", tenantId).eq("id", handoff.patient_id).maybeSingle(),
    caseQuery,
    linksQuery,
    admin.from("smyl_patient_histories").select("document,updated_at")
      .eq("tenant_id", tenantId).eq("patient_id", handoff.patient_id).maybeSingle(),
  ]);
  return json(200, {
    ok: true,
    linked: true,
    handoff: { id: handoff.id, channel: handoff.lana_channel, created_at: handoff.created_at },
    patient: patient ? {
      id: patient.id, name: `${patient.nombre || ""} ${patient.apellido || ""}`.trim(),
      email: patient.email || "", phone: patient.telefono || "", birth_date: patient.fecha_nacimiento || null,
      gender: patient.genero || null, notes: patient.notas || "", updated_at: patient.updated_at || null,
      whatsapp_consent: typeof patient.consentimiento_whatsapp === "boolean" ? patient.consentimiento_whatsapp : null,
      medical_alerts: medicalAlerts(patient.alertas_medicas, history),
    } : null,
    case: caseRow ? {
      id: caseRow.id, name: caseRow.nombre_paciente || "", score: caseRow.score ?? null,
      score_label: caseRow.score_lbl || null, summary: caseRow.resumen || "", diagnosis: caseRow.diagnostico || "",
      quote_total: caseRow.total_cotizacion ?? null, simulation_url: caseRow.simulacion_url || null,
      photo_count: Number(caseRow.fotos_count) || 0, lana_appointment_id: caseRow.lana_cita_id || null,
      created_at: caseRow.created_at || null,
    } : null,
    clinical_images: links || [],
  });
}

type PatientLinkIdentity = {
  id: string;
  channel: string;
  name: string;
  email: string;
  phone: string;
  lana_url: string;
};

async function patientLinkIdentity(actor: Actor, tenantId: string, conversationId: string): Promise<{ identity?: PatientLinkIdentity; response?: Response }> {
  const remote = await lanaRequest(tenantId, `/conversations/${conversationId}`, {
    method: "GET", headers: actorHeaders(actor),
  }, 15000);
  if (remote.response.status === 404) return { response: json(404, { error: "La conversación ya no está disponible." }) };
  if (!remote.response.ok) return { response: json(502, { error: "No se pudo identificar al contacto de la conversación." }) };
  const conversation = remote.body.conversacion && typeof remote.body.conversacion === "object"
    ? remote.body.conversacion as Record<string, unknown> : null;
  if (!conversation) return { response: json(502, { error: "El canal devolvió una identidad incompleta." }) };
  const channel = text(conversation.canal, 20);
  if (!["whatsapp", "messenger", "instagram"].includes(channel)) {
    return { response: json(409, { error: "El canal de la conversación no permite vinculación con pacientes." }) };
  }
  return {
    identity: {
      id: conversationId,
      channel,
      name: text(conversation.nombre, 150) || "Paciente de redes sociales",
      email: text(conversation.email, 254),
      phone: text(conversation.telefono, 60),
      lana_url: text(conversation.lana_url, 500) || "https://app.get-lana.com/admin.html?tab=chats",
    },
  };
}

async function patientLinkPreview(actor: Actor, tenantId: string, conversationId: string): Promise<Response> {
  const resolved = await patientLinkIdentity(actor, tenantId, conversationId);
  if (resolved.response || !resolved.identity) return resolved.response || json(502, { error: "No se pudo identificar al contacto." });
  const identity = resolved.identity;
  const [existingResult, candidatesResult] = await Promise.all([
    admin.from("camila_lana_handoffs")
      .select("patient_id,case_id,lana_channel,link_kind,created_at")
      .eq("tenant_id", tenantId)
      .eq("lana_conversation_id", conversationId)
      .maybeSingle(),
    admin.rpc("smyl_lana_patient_candidates", {
      p_tenant_id: tenantId,
      p_email: identity.email,
      p_telefono: identity.phone,
    }),
  ]);
  if (existingResult.error || candidatesResult.error) {
    console.error("[lana-inbox] patient link preview", existingResult.error?.message || candidatesResult.error?.message);
    return json(500, { error: "No se pudo revisar la identidad del paciente." });
  }
  return json(200, {
    ok: true,
    conversation: identity,
    existing_link: existingResult.data || null,
    candidates: candidatesResult.data || [],
  });
}

async function confirmPatientLink(actor: Actor, tenantId: string, conversationId: string, body: Record<string, unknown>): Promise<Response> {
  const resolved = await patientLinkIdentity(actor, tenantId, conversationId);
  if (resolved.response || !resolved.identity) return resolved.response || json(502, { error: "No se pudo identificar al contacto." });
  const identity = resolved.identity;
  const selectedPatientId = body.patient_id ? uuid(body.patient_id) : null;
  if (body.patient_id && !selectedPatientId) return json(400, { error: "El expediente elegido no es válido." });
  const { data, error } = await admin.rpc("camila_confirmar_lana_handoff", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_lana_conversation_id: conversationId,
    p_lana_channel: identity.channel,
    p_nombre: identity.name,
    p_email: identity.email,
    p_telefono: identity.phone,
    p_patient_id: selectedPatientId,
  });
  if (error) {
    console.error("[lana-inbox] patient link confirmation", error.message);
    return json(error.code === "42501" ? 403 : 409, {
      error: error.code === "42501" ? "Tu rol no permite crear o vincular pacientes." : "No se pudo preparar el expediente desde esta conversación.",
    });
  }
  return json(200, { ok: true, conversation: identity, link: Array.isArray(data) ? data[0] : data });
}

async function autoLinkConversationPatient(actor: Actor, tenantId: string, conversationId: string): Promise<Response> {
  const resolved = await patientLinkIdentity(actor, tenantId, conversationId);
  if (resolved.response || !resolved.identity) return resolved.response || json(502, { error: "No se pudo identificar al contacto." });
  const conversation = resolved.identity;
  const { data, error } = await admin.rpc("smyl_auto_link_lana_conversation", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_lana_conversation_id: conversationId,
    p_lana_channel: conversation.channel,
    p_nombre: conversation.name,
    p_email: conversation.email,
    p_telefono: conversation.phone,
  });
  if (error) {
    console.error("[lana-inbox] automatic patient link", error.message);
    return json(error.code === "42501" ? 403 : 500, {
      error: error.code === "42501" ? "Tu rol no permite crear o vincular pacientes." : "No se pudo vincular el paciente automáticamente.",
      code: error.code === "42501" ? "permission_denied" : "automatic_patient_link_failed",
    });
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || ["ambiguous", "needs_identity"].includes(String(result.status || ""))) {
    const reason = result?.status === "needs_identity" ? "needs_identity" : "ambiguous";
    return json(200, { ok: true, linked: false, reason, needs_review: true });
  }
  const [{ data: patient }, { data: handoff }] = await Promise.all([
    admin.from("camila_pacientes")
      .select("id,nombre,apellido")
      .eq("tenant_id", tenantId)
      .eq("id", result.patient_id)
      .maybeSingle(),
    admin.from("camila_lana_handoffs")
      .select("link_kind")
      .eq("tenant_id", tenantId)
      .eq("lana_conversation_id", conversationId)
      .maybeSingle(),
  ]);
  return json(200, {
    ok: true,
    linked: true,
    status: result.status,
    existing_link: Boolean(result.existing_link),
    created_patient: Boolean(result.created_patient || handoff?.link_kind === "created_contact"),
    patient: patient ? { id: patient.id, name: `${patient.nombre || ""} ${patient.apellido || ""}`.trim() } : null,
    case_id: result.case_id,
  });
}

async function copilotClinicalSnapshot(actor: Actor, tenantId: string, conversationId: string): Promise<Record<string, unknown>> {
  const { data: handoff } = await admin.from("camila_lana_handoffs")
    .select("patient_id,case_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (!handoff) return {
    patient_confirmed: false, case_confirmed: false, photo_count: 0,
    simulation_exists: false, simulation_authorized: false,
    proposal_status: null, appointment_linked: false,
  };
  if (!await accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical")) return {
    patient_confirmed: false, case_confirmed: false, clinical_access: false,
    photo_count: 0, simulation_exists: false, simulation_authorized: false,
    proposal_status: null, appointment_linked: false,
  };
  const caseResult = handoff.case_id
    ? await admin.from("camila_casos")
      .select("id,score_lbl,simulacion_url,fotos_count,lana_cita_id,lana_webhook_estado")
      .eq("tenant_id", tenantId).eq("id", handoff.case_id).maybeSingle()
    : { data: null, error: null };
  const [{ data: caseRow }, proposalResult] = await Promise.all([
    Promise.resolve(caseResult),
    admin.from("smyl_proposals")
      .select("status")
      .eq("tenant_id", tenantId).eq("patient_id", handoff.patient_id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const proposal = proposalResult.error ? null : proposalResult.data;
  return {
    patient_confirmed: true,
    case_confirmed: Boolean(caseRow),
    photo_count: Math.max(0, Number(caseRow?.fotos_count) || 0),
    case_status: text(caseRow?.score_lbl, 120) || null,
    simulation_exists: Boolean(caseRow?.simulacion_url),
    // `lana_webhook_estado=enviado` sólo aparece después de la acción explícita
    // del profesional en lana-webhook; existir una imagen no autoriza compartirla.
    simulation_authorized: Boolean(caseRow?.simulacion_url) && caseRow?.lana_webhook_estado === "enviado",
    proposal_status: proposal?.status || null,
    appointment_linked: Boolean(caseRow?.lana_cita_id),
  };
}

async function linkClinicalImage(
  tenantId: string,
  actor: Actor,
  conversationId: string,
  channel: string,
  rawMessageId: unknown,
  label: unknown,
): Promise<Response> {
  const id = messageId(rawMessageId);
  if (!id) return json(400, { error: "Mensaje no válido." });
  const { data: handoff } = await admin.from("camila_lana_handoffs").select("patient_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (!handoff?.patient_id) return json(409, { error: "Primero identifica al paciente de esta conversación.", code: "handoff_required" });
  if (!await accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical")) {
    return json(403, { error: "El expediente queda fuera del alcance clínico de tu rol.", code: "patient_scope_denied" });
  }
  const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/messages/${id}`, {
    method: "GET", headers: actorHeaders(actor),
  }, 15000);
  if (!remote.response.ok) return json(remote.response.status, { error: String(remote.body.error || "No se pudo validar la fotografía en LANA.") });
  const message = remote.body.message as Record<string, unknown> | undefined;
  if (!message || message.media_type !== "image" || message.deleted === true) {
    return json(409, { error: "Solo una fotografía disponible puede enviarse a revisión clínica." });
  }
  const { data, error } = await admin.rpc("camila_vincular_lana_imagen", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_lana_conversation_id: conversationId,
    p_lana_message_id: id,
    p_lana_channel: channel,
    p_label: text(label, 180) || "Fotografía recibida por chat",
  });
  if (error) {
    if (String(error.message || "").includes("LANA_HANDOFF_REQUIRED")) {
      return json(409, { error: "Primero confirma el paciente y el caso en Preparar expediente.", code: "handoff_required" });
    }
    console.error("[lana-inbox clinical-link]", error.message);
    return json(500, { error: "No se pudo vincular la fotografía al expediente." });
  }
  return json(200, { ok: true, link: data });
}

// Constancia de situación fiscal enviada por el chat: se valida que el mensaje sea de la conversación del paciente,
// se descarga aquí (el navegador nunca ve la llave de LANA) y se entrega a fiscal-extract con la sesión de quien la pide,
// así aplican el mismo permiso (finance.manage), los topes y el consumo de créditos de IA. El archivo no se guarda.
async function fiscalDocumentFromChat(
  tenantId: string,
  actor: Actor,
  conversationId: string,
  rawPatientId: unknown,
  rawMessageId: unknown,
  authorization: string,
): Promise<Response> {
  const id = messageId(rawMessageId);
  const patientId = uuid(rawPatientId);
  if (!id || !patientId) return json(400, { error: "Elige un archivo del chat." });
  const { data: handoff } = await admin.from("camila_lana_handoffs").select("patient_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (!handoff?.patient_id || String(handoff.patient_id) !== patientId) {
    return json(409, { error: "Ese chat no está vinculado a este paciente.", code: "handoff_required" });
  }
  const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/messages/${id}`, {
    method: "GET", headers: actorHeaders(actor),
  }, 15000);
  if (!remote.response.ok) return json(remote.response.status, { error: String(remote.body.error || "No se pudo consultar el mensaje en LANA.") });
  const message = remote.body.message as Record<string, unknown> | undefined;
  if (!esArchivoFiscal(message) || !urlDescargable(message?.media_url)) {
    return json(409, { error: "Ese mensaje no tiene una foto o documento disponible." });
  }
  let bytes: Uint8Array;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const file = await fetch(String(message!.media_url), { signal: controller.signal, redirect: "follow" }).finally(() => clearTimeout(timer));
    if (!file.ok) return json(502, { error: "No se pudo descargar el archivo del chat. Pide al paciente que lo envíe de nuevo." });
    const declared = Number(file.headers.get("content-length") || 0);
    if (declared > MAX_CHAT_FILE_BYTES) return json(413, { error: "El archivo del chat pesa más de 4 MB. Pide la constancia en PDF." });
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    console.error("[lana-inbox fiscal-document]", (error as Error)?.name || "error");
    return json(502, { error: "No se pudo descargar el archivo del chat. Intenta de nuevo." });
  }
  if (bytes.length > MAX_CHAT_FILE_BYTES) return json(413, { error: "El archivo del chat pesa más de 4 MB. Pide la constancia en PDF." });
  const mediaType = tipoPorFirma(bytes);
  if (!mediaType) return json(415, { error: "Ese archivo no es PDF, JPG ni PNG. Elige la foto o el PDF de la constancia." });
  const extract = await fetch(`${SB_URL}/functions/v1/fiscal-extract`, {
    method: "POST",
    headers: { "Authorization": authorization, "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "", "Content-Type": "application/json", "Origin": "https://app.smyldesign.ai" },
    body: JSON.stringify({ file_base64: bytesABase64(bytes), media_type: mediaType }),
  });
  const result = await extract.json().catch(() => ({ error: "No se pudo leer la constancia. Captura los datos a mano." }));
  return json(extract.status, result as Record<string, unknown>);
}

const INBOX_PRIORITIES = ["low", "normal", "high", "urgent"];
const INBOX_AI_FILTERS = ["ai", "human"];
const INBOX_WINDOW_FILTERS = ["open", "expiring", "expired", "none"];
const AI_FEEDBACK_RATINGS = ["helpful", "needs_improvement", "unsafe"];

// Contrato 1.6: los filtros avanzados se validan aquí para no reenviar a LANA
// valores que ella rechazaría, y para responder con un mensaje claro.
function invalidInboxFilter(url: URL): string | null {
  const assignee = url.searchParams.get("assignee");
  if (assignee && !["me", "unassigned"].includes(assignee) && !uuid(assignee)) return "El responsable indicado no es válido.";
  const stage = url.searchParams.get("stage_id");
  if (stage && stage !== "none" && !APPOINTMENT_STAGES.has(stage) && !uuid(stage)) return "La etapa indicada no es válida.";
  const branch = url.searchParams.get("branch_id");
  if (branch && branch !== "none" && !uuid(branch)) return "La sucursal indicada no es válida.";
  const priority = url.searchParams.get("priority");
  if (priority && !INBOX_PRIORITIES.includes(priority)) return "La prioridad indicada no es válida.";
  const ai = url.searchParams.get("ai");
  if (ai && !INBOX_AI_FILTERS.includes(ai)) return "El filtro IA/humano no es válido.";
  const windowFilter = url.searchParams.get("window");
  if (windowFilter && !INBOX_WINDOW_FILTERS.includes(windowFilter)) return "El filtro de ventana de 24 h no es válido.";
  return null;
}

function queryPath(url: URL, action: string, conversationId: string | null): string | null {
  if (action === "operations") return "/inbox/operations";
  if (action === "ai_feedback") {
    const params = new URLSearchParams();
    for (const name of ["days", "limit", "rating"]) {
      const value = text(url.searchParams.get(name), 20);
      if (value) params.set(name, value);
    }
    return `/inbox/feedback${params.size ? `?${params}` : ""}`;
  }
  if (action === "stages") return "/inbox/stages";
  if (action === "quick_replies") return "/inbox/quick-replies";
  if (action === "templates") return "/inbox/whatsapp/templates";
  if (action === "scheduled" && conversationId) return `/inbox/conversations/${conversationId}/scheduled`;
  if (action === "sync") {
    const since = text(url.searchParams.get("since"), 60);
    return since ? `/inbox/sync?since=${encodeURIComponent(since)}` : null;
  }
  if (action === "messages" && conversationId) {
    const params = new URLSearchParams();
    for (const name of ["limit", "before", "since"]) {
      const value = text(url.searchParams.get(name), 80);
      if (value) params.set(name, value);
    }
    return `/inbox/conversations/${conversationId}/messages${params.size ? `?${params}` : ""}`;
  }
  if ((action === "search" || action === "shared") && conversationId) {
    const params = new URLSearchParams();
    for (const name of ["q", "limit", "before"]) {
      const value = text(url.searchParams.get(name), name === "q" ? 160 : 80);
      if (value) params.set(name, value);
    }
    return `/inbox/conversations/${conversationId}/${action}${params.size ? `?${params}` : ""}`;
  }
  if (action !== "list") return null;
  const params = new URLSearchParams();
  for (const name of ["filter", "channel", "limit", "offset", "q", "assignee", "stage_id", "branch_id", "priority", "ai", "window"]) {
    const value = text(url.searchParams.get(name), 40);
    if (value) params.set(name, value);
  }
  return `/inbox${params.size ? `?${params}` : ""}`;
}

async function handleInbox(req: Request): Promise<Response> {
  const CORS = inboxCors(req);
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const requirePermission = (actor: Actor, permission: string, message: string): Response | null =>
    can(actor, permission) ? null : json(403, { error: message, code: "permission_denied" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  try {
    const actor = await actorFor(auth.user, auth.tenantId);
    if (!actor) return json(403, { error: "Tu acceso al chat no está activo.", code:"chat_access_denied" });
    const url = new URL(req.url);
    if (req.method === "GET" && url.searchParams.get("action") === "access") return json(200, {actor});
    if (actor.chat_access === "none") return json(403, { error: "No tienes habilitado el chat.", code: "chat_access_denied" });
    if (req.method === "GET") {
      const action = text(url.searchParams.get("action"), 30) || "list";
      const denied = requirePermission(actor, "messages.read", "Tu rol no permite consultar las conversaciones de la clínica.");
      if (denied) return denied;

      if (action === "availability_catalog" || action === "availability") {
        const scheduleDenied = requirePermission(actor, "schedule.read", "Tu rol no permite consultar disponibilidad de Agenda.");
        if (scheduleDenied) return scheduleDenied;
        return action === "availability_catalog"
          ? await availabilityCatalog(auth.tenantId)
          : await availableSlots(actor, auth.tenantId, url);
      }
      const conversationId = url.searchParams.get("conversation_id") ? uuid(url.searchParams.get("conversation_id")) : null;
      if (url.searchParams.get("conversation_id") && !conversationId) return json(400, { error: "Conversación no válida." });
      if (conversationId && !await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
      if (action === "pipeline_updates") return await pipelineUpdates(actor, auth.tenantId, url);
      if (action === "team") return await listTeam(auth.tenantId, conversationId);
      if (action === "branches") {
        const [all, wide] = await Promise.all([
          activeBranches(auth.tenantId),
          admin.rpc("smyl_chat_clinic_wide", { p_tenant: auth.tenantId, p_user: actor.id }),
        ]);
        if (wide.error) throw new Error("No se pudo comprobar el acceso a las sucursales.");
        const mine = wide.data === true ? null : new Set(await memberBranchIds(actor, auth.tenantId));
        return json(200, { branches: mine ? all.filter(branch => mine.has(branch.id)) : all, actor });
      }
      if (["operations", "ai_feedback"].includes(action) && actor.scopes.messages !== "clinic") {
        return json(403, { error: "Los indicadores globales requieren alcance de toda la clínica.", code: "conversation_scope_denied" });
      }
      if (action === "appointment_requests" && conversationId) {
        const scheduleDenied = requirePermission(actor, "schedule.manage", "Tu rol no permite administrar solicitudes de Agenda.");
return scheduleDenied || await appointmentContext(actor, auth.tenantId, conversationId, true);
      }
      if (action === "appointment_context" && conversationId) {
        const scheduleDenied = requirePermission(actor, "schedule.read", "Tu rol no permite consultar la continuidad de Agenda.");
return scheduleDenied || await appointmentContext(actor, auth.tenantId, conversationId);
      }
      if (action === "conversation_summary" && conversationId) {
        return json(200, await storedSummary(actor, auth.tenantId, conversationId));
      }
      if (action === "clinical_context" && conversationId) {
        const clinicalDenied = requirePermission(actor, "clinical.read", "Tu rol no permite consultar el expediente clínico.");
        return clinicalDenied || await clinicalContext(actor, auth.tenantId, conversationId);
      }
      if (action === "message" && conversationId) {
        const id = messageId(url.searchParams.get("message_id"));
        if (!id) return json(400, { error: "Mensaje no válido." });
        const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/messages/${id}`, {
          method: "GET", headers: actorHeaders(actor),
        }, 15000);
        if (!await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
        return json(remote.response.status, { ...remote.body, actor });
      }
      if (action === "ai_feedback") {
        if (actor.role !== "owner") return json(403, { error: "Solo el dueño de la clínica puede revisar la calidad de las respuestas de IA.", code: "permission_denied" });
        const rating = url.searchParams.get("rating");
        if (rating && !AI_FEEDBACK_RATINGS.includes(rating)) return json(400, { error: "La evaluación indicada no es válida." });
      }
      if (action === "list") {
        const invalid = invalidInboxFilter(url);
        if (invalid) return json(400, { error: invalid });
        return await listScoped(actor, auth.tenantId, url);
      }
      const path = queryPath(url, action, conversationId);
      if (!path) return json(400, { error: "Consulta de Inbox no reconocida." });
      const headers = ["sync", "messages"].includes(action) ? connectorHeaders(auth.tenantId) : actorHeaders(actor);
      const remote = await lanaRequest(auth.tenantId, path, { method: "GET", headers }, 15000);
      if (!remote.response.ok) return json(remote.response.status, { error: "No se pudo consultar el chat." });
      if (action === "sync") {
        const scopedBody = await filterConversationPayload(actor, auth.tenantId, remote.body, url);
        await attachBranchChanges(actor, auth.tenantId, url, scopedBody, remote.body);
        return json(200, { ...scopedBody, actor });
      }
      if (action === "messages" && conversationId) {
        const conversation = remote.body.conversation as Record<string, unknown> | undefined;
        if (conversation?.id !== conversationId) return json(404, { error: "Conversación no disponible." });
        await attachThreadBranch(actor, auth.tenantId, remote.body);
        await projectConversation(actor, auth.tenantId, conversation, true);
      }
      if (conversationId && !await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
      return json(remote.response.status, { ...remote.body, actor });
    }

    if ((req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data")) {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite enviar archivos o mensajes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const incoming = await req.formData().catch(() => null);
      if (!incoming) return json(400, { error: "Adjunto no válido." });
      const conversationId = uuid(incoming.get("conversation_id"));
      const file = incoming.get("file");
      if (!conversationId || !(file instanceof File)) return json(400, { error: "Falta la conversación o el archivo." });
      if (!await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
      const forwarded = new FormData();
      forwarded.append("file", file, file.name);
      forwarded.append("kind", text(incoming.get("kind"), 20));
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/attachments`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: forwarded,
      }, 60000);
      return json(remote.response.status, { ...remote.body, actor });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = text(body.action, 30);
    if (["pilot", "stage_create", "stage_update", "stage_reorder", "stage_seed_dental"].includes(action) && actor.scopes.messages !== "clinic") return forbiddenConversation();
    if (action === "pilot") {
      if (actor.role !== "owner") return json(403, { error: "Solo el dueño de la clínica puede aprobar el piloto." });
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const pilotAction = text(body.pilot_action, 20);
      const forwarded: Record<string, unknown> = { action: pilotAction };
      if (pilotAction === "verify") {
        forwarded.scenario_id = text(body.scenario_id, 40);
        forwarded.evidence = text(body.evidence, 500);
      }
      const remote = await lanaRequest(auth.tenantId, "/inbox/pilot", {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify(forwarded),
      }, 20000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "stage_create" || action === "stage_update" || action === "stage_reorder" || action === "stage_seed_dental") {
      if (actor.role !== "owner") return json(403, { error: "Solo el dueño de la clínica puede configurar las etapas del Pipeline.", code: "permission_denied" });
      let path = "/inbox/stages";
      let method = "POST";
      let forwarded: Record<string, unknown> = {};
      if (action === "stage_create") {
        const name = text(body.name, 60);
        if (!name) return json(400, { error: "Escribe un nombre para la etapa." });
        forwarded = { name };
      } else if (action === "stage_update") {
        const stageId = uuid(body.stage_id);
        if (!stageId) return json(400, { error: "La etapa seleccionada no es válida." });
        if (body.name !== undefined) {
          const name = text(body.name, 60);
          if (!name) return json(400, { error: "Escribe un nombre para la etapa." });
          forwarded.name = name;
        }
        if (body.archived !== undefined) {
          if (typeof body.archived !== "boolean") return json(400, { error: "El estado archivado no es válido." });
          forwarded.archived = body.archived;
        }
        if (!Object.keys(forwarded).length) return json(400, { error: "No hay cambios que guardar." });
        path = `/inbox/stages/${stageId}`;
        method = "PUT";
      } else if (action === "stage_reorder") {
        const ids = Array.isArray(body.stage_ids) ? body.stage_ids.map((value) => uuid(value)) : [];
        if (!ids.length || ids.length > 24 || ids.some((value) => !value) || new Set(ids).size !== ids.length) {
          return json(400, { error: "El orden de etapas no es válido." });
        }
        forwarded = { stage_ids: ids };
        path = "/inbox/stages/order";
        method = "PUT";
      } else {
        path = "/inbox/stages/seed-dental";
      }
      const remote = await lanaRequest(auth.tenantId, path, {
        method, headers: actorHeaders(actor), body: JSON.stringify(forwarded),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    const conversationId = uuid(body.conversation_id);
    if (!conversationId) return json(400, { error: "Conversación no válida." });
    if (!await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
    if (action === "assign" || action === "release") return await transferChat(actor, auth.tenantId, conversationId, action, body);
    if (action === "patient_link_preview" || action === "patient_link_confirm") {
      const denied = requirePermission(actor, "patients.manage", "Tu rol no permite crear o vincular pacientes.");
      if (denied) return denied;
      if (action === "patient_link_preview") return await patientLinkPreview(actor, auth.tenantId, conversationId);
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      return await confirmPatientLink(actor, auth.tenantId, conversationId, body);
    }
    if (action === "auto_patient_link") {
      const denied = requirePermission(actor, "patients.manage", "Tu rol no permite crear o vincular pacientes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      return await autoLinkConversationPatient(actor, auth.tenantId, conversationId);
    }
    if (action === "appointment_request" || action === "appointment_confirm") {
      const scheduleDenied = requirePermission(actor, "schedule.manage", "Tu rol no permite administrar citas.");
      if (scheduleDenied) return scheduleDenied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      if (action === "appointment_request") return await createAppointmentRequest(actor, auth.tenantId, conversationId, body, idempotencyKey);
      const requestId = uuid(body.request_id);
      if (!requestId) return json(400, { error: "Solicitud no válida." });
      return await confirmAppointmentRequest(actor, auth.tenantId, conversationId, requestId, idempotencyKey);
    }
    if (action === "clinical_link") {
      const denied = requirePermission(actor, "clinical.write", "Tu rol no permite incorporar archivos al expediente clínico.");
      if (denied) return denied;
      const channel = text(body.channel, 20);
      if (!["whatsapp", "messenger", "instagram"].includes(channel)) return json(400, { error: "Canal no válido." });
      return await linkClinicalImage(auth.tenantId, actor, conversationId, channel, body.message_id, body.label);
    }
    if (action === "fiscal_document") {
      const denied = requirePermission(actor, "finance.manage", "Tu rol no permite editar los datos fiscales.");
      if (denied) return denied;
      return await fiscalDocumentFromChat(auth.tenantId, actor, conversationId, body.patient_id, body.message_id, req.headers.get("Authorization") || "");
    }
    if (action === "rewrite_message") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite preparar respuestas para pacientes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const sourceText = typeof body.source_text === "string" ? body.source_text.trim() : "";
      if (sourceText.length < 2 || sourceText.length > 4000) {
        return json(400, { error: "Escribe un mensaje de entre 2 y 4,000 caracteres para mejorarlo." });
      }
      if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
      if (CONSUMABLES_ENFORCED) {
        const { data: wallet } = await admin.from("smyl_wallets").select("balance_units")
          .eq("tenant_id", auth.tenantId).eq("resource", "ai_credits").maybeSingle();
        if (!wallet || Number(wallet.balance_units) < 1) {
          return json(402, { error: "No hay créditos de MILA suficientes para mejorar este mensaje." });
        }
      }
      try {
        const improved = await improveMessageWriting(sourceText);
        const { data: usage, error: usageError } = await admin.rpc("smyl_consume", {
          p_tenant_id: auth.tenantId,
          p_resource: "ai_credits",
          p_quantity_units: 1,
          p_idempotency_key: `message-rewrite:${idempotencyKey}`,
          p_source_type: "message_rewrite",
          p_source_id: conversationId,
          p_provider: "openai",
          p_provider_model: MESSAGE_REWRITE_MODEL,
          p_metadata: {
            context: "chat_composer",
            token_usage: improved.usage,
            consumables_enforced: CONSUMABLES_ENFORCED,
          },
          p_enforce: CONSUMABLES_ENFORCED,
        });
        if (usageError) throw new Error("No se pudo registrar el consumo de MILA.");
        const usageRow = Array.isArray(usage) ? usage[0] : usage;
        if (usageRow && usageRow.accepted === false) {
          return json(402, { error: "No hay créditos de MILA suficientes para mejorar este mensaje." });
        }
        return json(200, {
          mode: "rewrite",
          rewritten_text: improved.rewrittenText,
          token_usage: improved.usage,
          usage_recorded: true,
          actor,
        });
      } catch (error) {
        console.error("[lana-inbox:rewrite-message]", idempotencyKey, error instanceof Error ? error.message : error);
        return json(502, { error: "MILA no pudo mejorar la redacción. Tu texto original no cambió." });
      }
    }
    if (action === "copilot") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite preparar respuestas para pacientes.");
      if (denied) return denied;
      const mode = body.mode === "summary" ? "summary" : "draft";
      const clinical = can(actor, "clinical.read")
        ? await copilotClinicalSnapshot(actor, auth.tenantId, conversationId)
        : { patient_confirmed: false, case_confirmed: false, clinical_access: false };
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/copilot`, {
        method: "POST", headers: actorHeaders(actor),
        body: JSON.stringify({ mode, clinical_context: clinical }),
      }, 30000);
      if (mode === "summary" && remote.response.ok && remote.body && typeof remote.body === "object") {
        const summary = cleanSummary(remote.body as Record<string, unknown>);
        if (summary) {
          const includesClinical = clinical.patient_confirmed === true && clinical.clinical_access !== false;
          const saved = await saveSummary(actor, auth.tenantId, conversationId, summary, includesClinical, isoDate(body.basis_at));
          return json(remote.response.status, { ...remote.body, ...saved, actor });
        }
      }
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "feedback") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite evaluar respuestas del asistente.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      const id = messageId(body.message_id);
      const rating = text(body.rating, 30);
      if (!idempotencyKey || !id || !["helpful", "needs_improvement", "unsafe"].includes(rating)) {
        return json(400, { error: "Evaluación o Idempotency-Key no válidos." });
      }
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/copilot/feedback`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey),
        body: JSON.stringify({
          message_id: id, rating,
          comment: text(body.comment, 1000), ideal_response: text(body.ideal_response, 4000),
        }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "set_branch" || action === "branch") {
      const denied = requirePermission(actor, "messages.manage", "Tu rol no permite asignar conversaciones a una sucursal.");
      if (denied) return denied;
      const target = body.branch_id === null || body.branch_id === "" ? null : uuid(body.branch_id);
      if (target === null && body.branch_id !== null && body.branch_id !== "") return json(400, { error: "La sucursal indicada no es válida." });
      const allowed = await admin.rpc("smyl_chat_route_allowed", { p_tenant: auth.tenantId, p_user: actor.id, p_branch: target });
      if (allowed.error) throw new Error("No se pudo comprobar el acceso a la sucursal.");
      if (allowed.data !== true) return json(403, { error: target ? "Esa sucursal está fuera de tu alcance." : "Solo quien ve toda la clínica puede devolver una conversación a «Sin asignar».", code: "conversation_scope_denied" });
      const branch = target ? (await activeBranches(auth.tenantId)).find(item => item.id === target) : null;
      if (target && !branch) return json(404, { error: "La sucursal no existe o está inactiva." });
      const check = await lanaRequest(auth.tenantId, "/inbox/conversations/" + conversationId + "/messages?limit=1",
        {method:"GET", headers:connectorHeaders(auth.tenantId)}, 10000);
      if (!check.response.ok || (check.body.conversation as {id?:string} | undefined)?.id !== conversationId) return json(check.response.ok ? 404 : check.response.status, { error: "No se pudo verificar la conversación." });
      const saved = await admin.rpc("smyl_chat_set_branch", { p_tenant: auth.tenantId, p_actor: actor.id, p_conversation: conversationId, p_branch: target });
      if (saved.error?.code === "42501") return forbiddenConversation();
      if (saved.error || saved.data !== true) throw new Error("No se pudo cambiar la sucursal.");
      const result = { ok:true, conversation_id:conversationId, branch:branch ? {id:branch.id, name:branch.name, source:"manual"} : null, actor };
      if (action === "branch") {
        const mirror = await lanaRequest(auth.tenantId, "/inbox/conversations/" + conversationId + "/branch", {
          method:"POST", headers:actorHeaders(actor, uuid(req.headers.get("Idempotency-Key")) || crypto.randomUUID()),
          body:JSON.stringify({branch_id:target, branch_name:branch?.name || null}),
        }, 10000).catch(() => null);
        return json(200, {...result, provider_sync:mirror?.response.ok ? "synced" : "pending"});
      }
      return json(200, result);
    }
    if (action === "resume_with_context") {
      const denied = requirePermission(actor, "messages.manage", "Tu rol no permite reactivar el asistente.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      const summary = text(body.summary, 2000);
      if (!idempotencyKey || !summary) return json(400, { error: "Revisa el resumen y vuelve a intentarlo." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/resume-context`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify({ summary }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "configure_automation") {
      const denied = requirePermission(actor, "messages.manage", "Tu rol no permite cambiar las reglas automáticas del chat.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const hours = body.auto_reactivate_hours === null ? null : Number(body.auto_reactivate_hours);
      if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 168)) return json(400, { error: "Plazo de reactivación no válido." });
      const windowReactivation = body.window_reactivation === null
        ? null : body.window_reactivation === true ? true : body.window_reactivation === false ? false : undefined;
      if (windowReactivation === undefined) return json(400, { error: "Regla de ventana no válida." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/automation`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey),
        body: JSON.stringify({ auto_reactivate_hours: hours, window_reactivation: windowReactivation }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "schedule") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite programar mensajes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const type = body.type === "template" ? "template" : "text";
      const forwarded: Record<string, unknown> = { type, send_at: text(body.send_at, 60) };
      if (type === "template") {
        const templateId = uuid(body.template_id);
        if (!templateId) return json(400, { error: "Plantilla no válida." });
        forwarded.template_id = templateId;
        forwarded.template_variables = Array.isArray(body.template_variables)
          ? body.template_variables.slice(0, 20).map((value) => text(value, 1000)) : [];
      } else forwarded.content = text(body.content, 4000);
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify(forwarded),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "cancel_scheduled") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite cancelar mensajes programados.");
      if (denied) return denied;
      const scheduledId = messageId(body.scheduled_id);
      if (!scheduledId) return json(400, { error: "Mensaje programado no válido." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled/${scheduledId}/cancel`, {
        method: "POST", headers: actorHeaders(actor, uuid(req.headers.get("Idempotency-Key"))), body: "{}",
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "retry_scheduled") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite reintentar mensajes programados.");
      if (denied) return denied;
      const scheduledId = messageId(body.scheduled_id);
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!scheduledId || !idempotencyKey) return json(400, { error: "Mensaje programado o Idempotency-Key no válido." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled/${scheduledId}/retry`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: "{}",
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (!["send", "read", "pause", "resume", "resolve", "pin", "unpin", "stage", "priority", "star", "unstar", "delete"].includes(action)) {
      return json(400, { error: "Acción de Inbox no reconocida." });
    }
    const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
    if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });

    if (action === "stage") return await movePipelineStage(actor, auth.tenantId, conversationId, body);
    const permission = ["send", "read", "star", "unstar"].includes(action) ? "messages.respond" : "messages.manage";
    const denied = requirePermission(actor, permission, permission === "messages.respond"
      ? "Tu rol no permite responder conversaciones."
      : "Tu rol no permite organizar ni controlar conversaciones.");
    if (denied) return denied;

    const forwarded: Record<string, unknown> = {};
    if (action === "send") {
      const type = text(body.type, 30) || "text";
      forwarded.type = type;
      if (type === "text") {
        forwarded.content = text(body.content, 4000);
        const replyId = body.reply_to_message_id ? messageId(body.reply_to_message_id) : null;
        if (body.reply_to_message_id && !replyId) return json(400, { error: "Mensaje citado no válido." });
        if (replyId) forwarded.reply_to_message_id = replyId;
      } else if (type === "template") {
        const templateId = uuid(body.template_id);
        if (!templateId) return json(400, { error: "Plantilla no válida." });
        forwarded.template_id = templateId;
        forwarded.template_variables = Array.isArray(body.template_variables)
          ? body.template_variables.slice(0, 20).map((value) => text(value, 1000)) : [];
      } else if (type === "location") {
        forwarded.latitude = Number(body.latitude); forwarded.longitude = Number(body.longitude);
        forwarded.name = text(body.name, 160); forwarded.address = text(body.address, 300);
      } else if (type === "forward") {
        const sourceConversationId = uuid(body.source_conversation_id);
        const sourceMessageId = messageId(body.source_message_id);
        if (!sourceConversationId || !sourceMessageId) return json(400, { error: "Mensaje de origen no válido." });
        if (!await canAccessConversation(actor, auth.tenantId, sourceConversationId)) return forbiddenConversation();
        forwarded.source_conversation_id = sourceConversationId;
        forwarded.source_message_id = sourceMessageId;
      } else return json(400, { error: "Tipo de mensaje no reconocido." });
    }



    if (action === "priority") {
      const priority = text(body.priority, 20);
      if (!INBOX_PRIORITIES.includes(priority)) return json(400, { error: "La prioridad indicada no es válida." });
      forwarded.priority = priority;
    }


    const targetMessageId = ["star", "unstar", "delete"].includes(action) ? messageId(body.message_id) : null;
    if (["star", "unstar", "delete"].includes(action) && !targetMessageId) return json(400, { error: "Mensaje no válido." });
    const path = action === "send"
      ? `/inbox/conversations/${conversationId}/messages`
      : targetMessageId
      ? `/inbox/conversations/${conversationId}/messages/${targetMessageId}/${action}`
      : `/inbox/conversations/${conversationId}/${action}`;
    const headers = actorHeaders(actor, idempotencyKey);
    const remote = await lanaRequest(auth.tenantId, path, {
      method: "POST",
      headers,
      body: JSON.stringify(forwarded),
    }, action === "send" ? 30000 : 15000);
    if (remote.response.ok && remote.body.conversation && typeof remote.body.conversation === "object") {
      await projectConversation(actor, auth.tenantId, remote.body.conversation as Record<string,unknown>);
    }
    if (remote.response.ok && Object.hasOwn(remote.body, "stage_id")) {
      const context = (await pipelineContext(auth.tenantId, actor, [conversationId])).get(conversationId);
      if (!context) return forbiddenConversation();
      projectPipeline(remote.body, context);
    }
    return json(remote.response.status, { ...remote.body, actor });
  } catch (error) {
    console.error("[lana-inbox]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo sincronizar el Inbox con LANA." });
  }
}

function inboxCors(req: Request): Record<string, string> {
  return { ...makeCors(req, "GET, POST, OPTIONS"), "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key" };
}

Deno.serve(async (req: Request) => {
  const response = await handleInbox(req);
  const missing = Object.entries(inboxCors(req)).filter(([name]) => !response.headers.has(name));
  if (!missing.length) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of missing) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
