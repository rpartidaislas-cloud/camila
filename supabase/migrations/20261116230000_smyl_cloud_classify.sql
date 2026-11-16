-- SMYL · La Nube, PR 3: la sugerencia de tipo con IA (función cloud-classify) queda medida en el registro de consumo de IA.
-- Solo amplía la lista de funciones permitidas; no cambia datos ni permisos.
begin;
alter table public.smyl_ai_usage_log drop constraint if exists smyl_ai_usage_log_feature_check;
alter table public.smyl_ai_usage_log add constraint smyl_ai_usage_log_feature_check
  check (feature in ('radiograph_analysis', 'radiograph_toothmap', 'clinical_photo_analysis',
                     'mila_history_interview', 'mila_exam_dictation', 'cloud_classify'));
commit;
