-- SMYL · Índices que faltaban para accesos reales (revisión de robustez 2026-11-19).
-- Solo agrega índices; no cambia datos, políticas ni funciones. Idempotente. Son tablas pequeñas hoy, así que se crean sin bloqueo apreciable.
--   * smyl_radiograph_report_addenda: se consulta por report_id y la FK (con borrado en cascada) no tenía índice.
--   * mila_recordings.retention_until: la purga de retención filtra por esa fecha y recorría toda la tabla.
--   * mila_tool_calls.session_id: la FK (on delete set null) obliga a buscar por sesión al borrar una.
--   * mila_clinical_notes (tenant_id, paciente_id): la FK compuesta hacia pacientes y la consulta de notas por paciente.
begin;

create index if not exists smyl_radiograph_report_addenda_report_idx
  on public.smyl_radiograph_report_addenda (tenant_id, report_id, created_at);

create index if not exists mila_recordings_retention_idx
  on public.mila_recordings (retention_until);

create index if not exists mila_tool_calls_session_idx
  on public.mila_tool_calls (session_id)
  where session_id is not null;

create index if not exists mila_clinical_notes_patient_idx
  on public.mila_clinical_notes (tenant_id, paciente_id)
  where paciente_id is not null;

commit;
