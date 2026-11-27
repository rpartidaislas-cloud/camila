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
  '20261027120000': { reapply: true }, // sólo create or replace function (idempotente, según su propia cabecera)
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
  '20261108100000': { sentinel: `select (to_regclass('public.smyl_collection_reminders') is not null and to_regclass('public.smyl_collection_prefs') is not null and ${proc('smyl_log_collection_reminder')} and ${proc('smyl_set_collection_pref')}) as ok` },
  '20261108110000': { sentinel: "select exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'smyl_post_charge' and p.prosrc like '%v_snapshot%') as ok" },
  '20261116190000': { sentinel: `select (exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'smyl_proposals' and column_name = 'branch_id') and ${proc('smyl_save_proposal_v3')}) as ok` },
  '20261116160000': { sentinel: `select (to_regclass('public.smyl_service_branch_prices') is not null and ${proc('smyl_set_service_branch_price')}) as ok` },
  '20261116100000': { sentinel: "select (to_regclass('public.smyl_conversation_branches') is not null) as ok" },
  '20261114150000': { sentinel: `select ${proc('smyl_inventory_last_movements')} as ok` },
  '20261114140000': { sentinel: `select ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'smyl_inventory_items' and column_name in ('reference_cost','package_label','package_quantity','preferred_supplier_id')) = 4 and ${proc('smyl_register_initial_stock')} and ${proc('smyl_inventory_consumption_report')} and ${proc('smyl_inventory_consumption_totals')}) as ok` },
  '20261114130000': { sentinel: `select (to_regclass('public.smyl_proposal_followups') is not null and ${proc('smyl_log_proposal_followup')}) as ok` },
  '20261106140000': { sentinel: `select (to_regclass('public.smyl_client_errors') is not null and ${proc('smyl_report_client_error')}) as ok` },
  '20261117150000': { sentinel: "select (to_regclass('public.smyl_cfdi_stamp_events') is not null and exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'smyl_cfdi_drafts' and column_name = 'provider_invoice_id')) as ok" },
  '20261117170000': { sentinel: "select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'smyl_cfdi_drafts' and column_name = 'cancellation_status') as ok" },
  '20261118120000': { sentinel: "select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'smyl_professionals' and column_name = 'phone') as ok" },
  '20261118130000': { sentinel: `select (to_regclass('public.smyl_schedule_rules') is not null and ${proc('smyl_set_professional_travel_margin')} and ${proc('smyl_professional_travel_conflicts')}) as ok` },
  '20261118100000': { sentinel: "select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'smyl_cfdi_drafts' and column_name = 'last_emailed_at') as ok" },
  '20261122090000': { reapply: true }, // solo create index if not exists (idempotente por diseño)
  '20261123100000': { sentinel: "select (to_regclass('public.smyl_data_rights_requests') is not null and to_regclass('public.smyl_patient_privacy_events') is not null and exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'smyl_export_patient_data')) as ok" },
  '20261124100000': { sentinel: "select (to_regclass('public.smyl_consent_links') is not null and exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'smyl_consent_link_sign')) as ok" },
  '20261124200000': { sentinel: "select (to_regclass('public.smyl_privacy_settings') is not null and to_regclass('public.smyl_consent_dispatches') is not null and exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'smyl_privacy_dispatch_claim')) as ok" },
  '20261126211000': { sentinel: `select (exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'smyl_informed_consents' and column_name = 'revoked_auth_method') and ${proc('smyl_issue_prescription_core_20261125')} and ${proc('smyl_void_prescription_core_20261125')} and exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'smyl_revoke_informed_consent' and p.prosrc like '%smyl_recent_auth_method%')) as ok` },
  '20261126220000': { sentinel: `select (to_regclass('public.smyl_orthodontic_cases') is not null and to_regclass('public.smyl_orthodontic_case_versions') is not null and to_regclass('public.smyl_orthodontic_controls') is not null and ${proc('smyl_get_orthodontic_case')} and ${proc('smyl_create_orthodontic_control')} and ${proc('smyl_transition_orthodontic_phase')} and ${proc('smyl_activate_orthodontic_case')}) as ok` },
  '20261128140000': { sentinel: `select (exists(select 1 from information_schema.columns where table_schema='public' and table_name='smyl_proposals' and column_name='treatment_id' and udt_name='uuid') and to_regclass('public.smyl_proposal_decisions') is not null and to_regclass('public.smyl_proposal_decision_items') is not null and to_regclass('public.smyl_treatment_plan_carries') is not null and to_regclass('public.smyl_treatment_transition_requests') is not null and ${proc('smyl_save_clinical_plan_v3')} and ${proc('smyl_save_proposal_v4')} and ${proc('smyl_record_proposal_decision_v1')} and ${proc('smyl_post_proposal_decision_charges_v1')} and ${proc('smyl_transition_treatment_v1')}) as ok` },
  '20261128150000': { sentinel: `select (to_regclass('public.smyl_procedure_executions') is not null and ${proc('smyl_sync_procedure_executions_v1')} and ${proc('smyl_create_procedure_note_v1')} and ${proc('smyl_set_procedure_execution_status_v1')} and ${proc('smyl_link_procedure_evidence_v1')}) as ok` },
  '20261202110000': { reapply: true }, // solo create or replace de una función (idempotente por diseño)
  '20261202100000': { reapply: true }, // solo create or replace de una función (idempotente por diseño)
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
