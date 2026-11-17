// Alcance de mensajes por rol: quién puede ver (y recibir avisos de) qué conversaciones.
//   clinic   → todas.
//   branches → solo las asignadas a una de sus sucursales; si aún no tienen sucursal, las de pacientes con cita en ellas.
//   own      → solo las de pacientes que atiende esa persona.
// Lo usan las funciones que devuelven avisos o conteos de conversaciones (lana-attention) para que cada sede reciba solo lo suyo.
export type MessageScope = "clinic" | "branches" | "own";
export interface MessageAccess { userId: string; isOwner: boolean; canRead: boolean; scope: MessageScope }

const RANK: Record<string, number> = { own: 0, branches: 1, clinic: 2 };
const str = (value: unknown, max = 80): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

// deno-lint-ignore no-explicit-any
type Db = any;

export async function messageAccess(admin: Db, tenantId: string, userId: string): Promise<MessageAccess | null> {
  const { data } = await admin.from("camila_usuarios").select("id,rol,activo").eq("id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (data && data.activo === false) return null;
  if (userId === tenantId || data?.rol === "dueño") return { userId, isOwner: true, canRead: true, scope: "clinic" };
  const { data: assignments } = await admin.from("smyl_member_roles").select("role_id").eq("tenant_id", tenantId).eq("user_id", userId);
  const roleIds = ((assignments || []) as Record<string, unknown>[]).map((row) => String(row.role_id || "")).filter(Boolean);
  if (!roleIds.length) return { userId, isOwner: false, canRead: false, scope: "own" };
  const [{ data: roles }, { data: grants }, { data: scopes }] = await Promise.all([
    admin.from("smyl_roles").select("id,active").eq("tenant_id", tenantId).in("id", roleIds).eq("active", true),
    admin.from("smyl_role_permissions").select("role_id,permission_key").eq("tenant_id", tenantId).in("role_id", roleIds),
    admin.from("smyl_role_scopes").select("role_id,domain,scope").eq("tenant_id", tenantId).in("role_id", roleIds),
  ]);
  const active = new Set(((roles || []) as Record<string, unknown>[]).map((row) => String(row.id || "")));
  if (!active.size) return { userId, isOwner: false, canRead: false, scope: "own" };
  const canRead = ((grants || []) as Record<string, unknown>[]).some((row) => active.has(String(row.role_id || "")) && str(row.permission_key) === "messages.read");
  let scope: MessageScope = "own";
  for (const row of (scopes || []) as Record<string, unknown>[]) {
    if (!active.has(String(row.role_id || "")) || str(row.domain, 30) !== "messages") continue;
    const candidate = str(row.scope, 20);
    if (candidate in RANK && RANK[candidate] > RANK[scope]) scope = candidate as MessageScope;
  }
  return { userId, isOwner: false, canRead, scope };
}

// Devuelve los ids de conversación que esta persona puede ver, entre los indicados.
export async function visibleConversationIds(admin: Db, tenantId: string, access: MessageAccess, conversationIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(conversationIds.filter(Boolean)));
  if (!access.canRead || !ids.length) return new Set();
  if (access.scope === "clinic") return new Set(ids);

  const [{ data: assigned }, { data: handoffs }] = await Promise.all([
    admin.from("smyl_conversation_branches").select("conversation_id,branch_id").eq("tenant_id", tenantId).in("conversation_id", ids),
    admin.from("camila_lana_handoffs").select("lana_conversation_id,patient_id").eq("tenant_id", tenantId).in("lana_conversation_id", ids),
  ]);
  const branchOf = new Map<string, string>(((assigned || []) as Record<string, unknown>[]).map((row) => [String(row.conversation_id), String(row.branch_id)]));
  const patientOf = new Map<string, string>(((handoffs || []) as Record<string, unknown>[]).filter((row) => row.patient_id).map((row) => [String(row.lana_conversation_id), String(row.patient_id)]));
  const patients = Array.from(new Set(patientOf.values()));
  const allowed = new Set<string>();

  if (access.scope === "branches") {
    const { data: mine } = await admin.from("smyl_member_branches").select("branch_id").eq("tenant_id", tenantId).eq("user_id", access.userId);
    const myBranches = new Set(((mine || []) as Record<string, unknown>[]).map((row) => String(row.branch_id || "")).filter(Boolean));
    if (!myBranches.size) return allowed;
    const withVisit = new Set<string>();
    if (patients.length) {
      const { data: visits } = await admin.from("smyl_appointments").select("patient_id,branch_id").eq("tenant_id", tenantId).in("patient_id", patients).in("branch_id", Array.from(myBranches));
      for (const row of (visits || []) as Record<string, unknown>[]) withVisit.add(String(row.patient_id));
    }
    for (const id of ids) {
      const branch = branchOf.get(id);
      // La sucursal asignada manda: si es de otra sede, no se avisa aquí aunque el paciente tenga citas en esta.
      if (branch) { if (myBranches.has(branch)) allowed.add(id); continue; }
      const patient = patientOf.get(id);
      if (patient && withVisit.has(patient)) allowed.add(id);
    }
    return allowed;
  }

  // own: solo pacientes de su equipo de atención o con citas con esa persona.
  const { data: professional } = await admin.from("smyl_professionals").select("id").eq("tenant_id", tenantId).eq("user_id", access.userId).eq("active", true).maybeSingle();
  if (!professional?.id || !patients.length) return allowed;
  const [{ data: team }, { data: visits }] = await Promise.all([
    admin.from("smyl_patient_care_team").select("patient_id").eq("tenant_id", tenantId).eq("professional_id", professional.id).eq("active", true).in("patient_id", patients),
    admin.from("smyl_appointments").select("patient_id").eq("tenant_id", tenantId).eq("professional_id", professional.id).in("patient_id", patients),
  ]);
  const mine = new Set<string>([...((team || []) as Record<string, unknown>[]), ...((visits || []) as Record<string, unknown>[])].map((row) => String(row.patient_id)));
  for (const id of ids) { const patient = patientOf.get(id); if (patient && mine.has(patient)) allowed.add(id); }
  return allowed;
}
