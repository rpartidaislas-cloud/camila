-- SOLO LECTURA: no cambia nada. Ejecútala ANTES de activar (para ver qué falta) y DESPUÉS (para confirmar).
-- Cada columna debe quedar en true después de activar.
select
  to_regprocedure('public.smyl_validate_radiograph_review(jsonb,jsonb)') is not null                         as prerequisito_revisiones,
  to_regclass('public.smyl_ai_usage_log') is not null                                                         as paso1_tabla_consumo,
  coalesce(position('claude-opus-5-5' in pg_get_functiondef(to_regprocedure('public.smyl_validate_radiograph_review(jsonb,jsonb)'))) > 0, false)
                                                                                                              as paso2_modelo_opus,
  coalesce(position('0.6' in pg_get_functiondef(to_regprocedure('public.smyl_validate_radiograph_review(jsonb,jsonb)'))) > 0, false)
                                                                                                              as paso3_cuadros_en_senales,
  coalesce((select pg_get_constraintdef(c.oid) like '%radiograph_toothmap%'
              from pg_constraint c where c.conname = 'smyl_ai_usage_log_feature_check' limit 1), false)         as paso4_mapa_de_piezas;
