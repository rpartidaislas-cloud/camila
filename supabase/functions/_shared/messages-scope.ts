// Las asignaciones y el alcance del coordinador los verifica la misma política que protege la bandeja.
interface ChatRpc {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function messageAccess(admin: ChatRpc, tenantId: string, userId: string) {
  const { data, error } = await admin.rpc("smyl_chat_mode", { p_tenant: tenantId, p_user: userId });
  if (error) throw new Error("No se pudo verificar el perfil del chat.");
  return { userId, canRead: data === "agent" || data === "coordinator" };
}

export async function visibleConversationIds(admin: ChatRpc, tenantId: string, access: { userId: string; canRead: boolean }, conversationIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (!access.canRead || !ids.length) return new Set();
  const { data, error } = await admin.rpc("smyl_chat_visible_ids", { p_tenant: tenantId, p_actor: access.userId, p_conversations: ids });
  if (error || !Array.isArray(data)) throw new Error("No se pudo verificar el acceso a las conversaciones.");
  return new Set(ids.filter(id => data.includes(id)));
}
