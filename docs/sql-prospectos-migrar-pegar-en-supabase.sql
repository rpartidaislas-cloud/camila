-- SMYL · prospectos: reclasificar contactos provisionales que nunca han sido atendidos.
-- Requiere la migración 20261203100000_smyl_prospect_lifecycle.sql ya aplicada (columna ciclo_vida).
--
-- Regla (conservadora): pasan a PROSPECTO solo las personas «por registrar» (se agendaron solo con teléfono y
-- aún no tienen nombre completo) que NO tienen ninguna cita que ya haya llegado, NINGÚN antecedente clínico
-- registrado y NINGÚN caso/simulación. Todo lo demás se queda como paciente.
--
-- PASO 1 — Vista previa (no cambia nada). Pega y ejecuta SOLO este bloque primero.
with candidatos as (
  select p.id, p.tenant_id
  from public.camila_pacientes p
  where p.ciclo_vida = 'paciente'
    and p.registro_estado = 'pendiente'
    and not exists (select 1 from public.smyl_appointments a
                    where a.tenant_id = p.tenant_id and a.patient_id = p.id
                      and a.status in ('arrived', 'in_progress', 'completed'))
    and not exists (select 1 from public.smyl_clinical_retention_guards g
                    where g.tenant_id = p.tenant_id and g.patient_id = p.id)
    and not exists (select 1 from public.smyl_patient_case_archive c
                    where c.tenant_id = p.tenant_id and c.patient_id = p.id)
)
select
  (select count(*) from public.camila_pacientes) as total_registros,
  (select count(*) from public.camila_pacientes where ciclo_vida = 'prospecto') as ya_prospectos,
  (select count(*) from candidatos) as pasarian_a_prospecto,
  (select count(*) from public.camila_pacientes where registro_estado = 'pendiente') as por_registrar_en_total;

-- PASO 2 — Aplicar. Ejecuta este bloque solo si los números del paso 1 te parecen razonables.
-- (Está comentado a propósito: quita los «-- » del inicio de cada línea para correrlo.)
--
-- update public.camila_pacientes p
--    set ciclo_vida = 'prospecto'
--  where p.ciclo_vida = 'paciente'
--    and p.registro_estado = 'pendiente'
--    and not exists (select 1 from public.smyl_appointments a
--                    where a.tenant_id = p.tenant_id and a.patient_id = p.id
--                      and a.status in ('arrived', 'in_progress', 'completed'))
--    and not exists (select 1 from public.smyl_clinical_retention_guards g
--                    where g.tenant_id = p.tenant_id and g.patient_id = p.id)
--    and not exists (select 1 from public.smyl_patient_case_archive c
--                    where c.tenant_id = p.tenant_id and c.patient_id = p.id);
--
-- Para deshacerlo (solo si algo no te gustó):
-- update public.camila_pacientes set ciclo_vida = 'paciente' where ciclo_vida = 'prospecto' and convertido_at is null;
