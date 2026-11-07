// Cómo comprobar que una migración YA está aplicada en producción aunque no figure en supabase_migrations.schema_migrations
// (se aplicó con el SQL Editor o con un workflow cuyo registro final falló). Sólo se registran las que se comprueban.
//   sentinel: consulta SQL que devuelve una fila con { ok: boolean }.
//   reapply : la migración sólo redefine funciones con CREATE OR REPLACE (o es idempotente por diseño): es seguro volver a
//             aplicarla y así garantizar su estado final antes de registrarla.
const proc = (name) => `exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '${name}')`;

export const SENTINELAS = {
  '20261022130000': { reapply: true },
  '20261022140000': { sentinel: "select to_regclass('public.smyl_public_assistant_conversations') is not null as ok" },
  '20261024090000': { sentinel: "select to_regclass('public.smyl_checkout_sessions') is not null as ok" },
  '20261027120000': { sentinel: `select ${proc('smyl_schedule_free_slots')} as ok` },
  '20261030100000': { reapply: true },
  '20261030110000': { sentinel: "select not exists(select 1 from pg_policies where schemaname = 'public' and policyname in ('camila_conv_select_miembros','camila_conv_update_miembros','camila_msg_select_miembros','camila_lana_handoffs_read','camila_lana_clinical_links_read','mila_sessions_select_miembros','mila_recordings_select_miembros','mila_transcripts_select_miembros','mila_notes_select_miembros','mila_confirmations_select_miembros','mila_tool_calls_select_miembros') and coalesce(qual, '') like '%camila_es_miembro%') as ok" },
  '20261031120000': { sentinel: `select (to_regclass('public.smyl_ai_usage_log') is not null and ${proc('smyl_ai_usage_summary')}) as ok` },
  '20261031130000': { reapply: true },
  '20261031140000': { reapply: true },
  '20261101120000': { sentinel: "select coalesce((select pg_get_constraintdef(c.oid) like '%radiograph_toothmap%' from pg_constraint c where c.conname = 'smyl_ai_usage_log_feature_check' and c.conrelid = to_regclass('public.smyl_ai_usage_log')), false) as ok" },
  '20261106100000': { sentinel: "select exists(select 1 from pg_trigger t where t.tgrelid = 'public.smyl_roles'::regclass and t.tgname = 'smyl_seed_role_scopes_after_role' and not t.tgisinternal) as ok" },
  '20261106110000': { sentinel: "select exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'camila_pacientes' and policyname = 'pacientes_read' and qual like '%smyl_tenants_with_permission%') as ok" },
  '20261106120000': { sentinel: `select ${proc('smyl_compact_audit_events')} as ok` },
  '20261106130000': { sentinel: "select (exists(select 1 from pg_constraint where conname = 'smyl_appointments_no_professional_overlap') and exists(select 1 from pg_constraint where conname = 'smyl_appointments_no_room_overlap')) as ok" },
  '20261106140000': { sentinel: `select (to_regclass('public.smyl_client_errors') is not null and ${proc('smyl_report_client_error')}) as ok` },
};

// Decide qué hacer con cada versión pendiente. `resultadoSentinela(version)` devuelve true/false (ya consultado).
export function planificar(pendientes, resultadoSentinela) {
  const acciones = [];
  for (const v of pendientes) {
    const regla = SENTINELAS[v];
    if (!regla) acciones.push({ version: v, accion: 'desconocida' });
    else if (regla.reapply) acciones.push({ version: v, accion: 'reaplicar_y_registrar' });
    else acciones.push({ version: v, accion: resultadoSentinela(v) ? 'registrar' : 'no_aplicada' });
  }
  return acciones;
}
