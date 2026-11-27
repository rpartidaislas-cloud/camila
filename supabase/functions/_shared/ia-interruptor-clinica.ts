// Lectura/escritura del interruptor de la IA de una clínica contra LANA (task-id smyl-ia-interruptor).
import { lanaRequest, smylAdmin } from "./lana-linked.ts";
import { decidirAsistentePublico, rolParaInterruptor } from "./ia-interruptor-clinica.mjs";

export { decidirAsistentePublico, rolParaInterruptor };

/** Rol de la persona en la clínica para el interruptor: "owner" | "admin" | null (solo puede consultar). */
export async function rolInterruptorDe(userId: string, tenantId: string): Promise<"owner" | "admin" | null> {
  if (userId === tenantId) return "owner";
  const { data: miembro } = await smylAdmin.from("camila_usuarios").select("rol,activo").eq("id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (!miembro || miembro.activo === false) return null;
  if (miembro.rol === "dueño") return "owner";
  const { data: asignaciones } = await smylAdmin.from("smyl_member_roles").select("role_id").eq("tenant_id", tenantId).eq("user_id", userId);
  const ids = (asignaciones || []).map((a: Record<string, unknown>) => String(a.role_id || "")).filter(Boolean);
  if (!ids.length) return null;
  const { data: roles } = await smylAdmin.from("smyl_roles").select("code,system_role,active").eq("tenant_id", tenantId).in("id", ids).eq("active", true);
  const codigos = (roles || []).filter((r: Record<string, unknown>) => r.system_role === true).map((r: Record<string, unknown>) => String(r.code || ""));
  return rolParaInterruptor({ esDueno: false, codigosDeRol: codigos });
}

// Caché corta: el asistente público recibe tráfico anónimo y no debe consultar a LANA en cada mensaje.
const CACHE_MS = 20_000;
const cache = new Map<string, { hasta: number; apagada: boolean }>();

/** ¿Debe callar el asistente público de esta clínica? Falla cerrado salvo clínica sin LANA o ruta aún inexistente. */
export async function asistentePublicoApagado(tenantId: string): Promise<boolean> {
  const previo = cache.get(tenantId);
  if (previo && previo.hasta > Date.now()) return previo.apagada;
  let lectura: { vinculada?: boolean; status?: number; body?: Record<string, unknown> };
  try {
    const r = await lanaRequest(tenantId, "/ia/interruptor", { method: "GET" }, 6000);
    lectura = { vinculada: true, status: r.response.status, body: r.body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    lectura = msg.startsWith("LANA todavía no está conectada") ? { vinculada: false } : { vinculada: true, status: 0 };
  }
  const apagada = decidirAsistentePublico(lectura).apagada;
  cache.set(tenantId, { hasta: Date.now() + (lectura.status === 0 ? 3_000 : CACHE_MS), apagada });
  return apagada;
}
