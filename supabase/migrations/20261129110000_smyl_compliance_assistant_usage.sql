-- SMYL · MILA prepara borradores administrativos de cumplimiento; nunca certifica ni guarda sin revisión humana.
-- Registra el consumo real de tokens sin almacenar el texto ni documentos de la clínica.
begin;
alter table public.smyl_ai_usage_log drop constraint if exists smyl_ai_usage_log_feature_check;
alter table public.smyl_ai_usage_log add constraint smyl_ai_usage_log_feature_check
  check (feature in ('radiograph_analysis', 'radiograph_toothmap', 'clinical_photo_analysis',
                     'mila_history_interview', 'mila_exam_dictation', 'cloud_classify', 'fiscal_extract',
                     'compliance_assistant'));
commit;
