-- SMYL · Borra los pacientes y citas de PRUEBA creados con pacientes-y-citas-de-prueba.sql.
--
-- Solo toca, EN LA CLÍNICA QUE INDIQUES, lo que tiene identificador que empieza con 7e57:
--   · las citas ficticias (con sus eventos y recordatorios),
--   · los bloqueos de prueba (vacaciones, junta, mantenimiento),
--   · los pacientes ficticios.
-- No borra los dentistas ni las sucursales de prueba: para eso usa equipo-de-prueba-limpiar.sql (córrelo DESPUÉS de este).
--
-- Si un paciente de prueba ya tiene historia propia (cobros, notas clínicas, casos, cotizaciones…), NO se borra: se
-- deja y el resultado lo avisa, para no perder ningún registro financiero o clínico.
--
-- Supabase → SQL Editor → New query → pega esto → Run. Se puede correr varias veces.

-- ► ÚNICA LÍNEA QUE DEBES EDITAR: el mismo id de clínica que usaste en pacientes-y-citas-de-prueba.sql.
select set_config('smyl.clinica', 'PEGA-AQUI-EL-ID-DE-LA-CLINICA', false);

do $$
declare
  v_tenant uuid;
  r record;
  v_citas int := 0; v_bloqueos int := 0; v_borrados int := 0; v_conservados int := 0;
begin
  if current_setting('smyl.clinica') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Falta el id de la clínica: reemplaza PEGA-AQUI-EL-ID-DE-LA-CLINICA por el id real (select id, nombre from public.camila_tenants).';
  end if;
  v_tenant := current_setting('smyl.clinica')::uuid;

  -- 1. Citas de los pacientes de prueba (los eventos y recordatorios se borran con la cita).
  with borradas as (
    delete from public.smyl_appointments
    where tenant_id = v_tenant and (id::text like '7e570000-%' or patient_id::text like '7e570000-%')
    returning 1
  ) select count(*) into v_citas from borradas;

  -- 2. Bloqueos de prueba.
  with borrados as (
    delete from public.smyl_schedule_blocks where tenant_id = v_tenant and id::text like '7e570000-%'
    returning 1
  ) select count(*) into v_bloqueos from borrados;

  -- 3. Pacientes: se borran; si ya tienen historia, se conservan.
  for r in select id from public.camila_pacientes where tenant_id = v_tenant and id::text like '7e570000-%' loop
    begin
      delete from public.camila_pacientes where tenant_id = v_tenant and id = r.id;
      v_borrados := v_borrados + 1;
    exception when others then
      v_conservados := v_conservados + 1;
    end;
  end loop;

  raise notice 'Citas borradas: %. Bloqueos: %. Pacientes borrados: %. Pacientes conservados (tenían historia): %.',
    v_citas, v_bloqueos, v_borrados, v_conservados;
end;
$$;

select
  (select count(*) from public.camila_pacientes  where tenant_id = current_setting('smyl.clinica')::uuid and id::text like '7e570000-%') as pacientes_de_prueba_que_quedan,
  (select count(*) from public.smyl_appointments where tenant_id = current_setting('smyl.clinica')::uuid and id::text like '7e570000-%') as citas_de_prueba_que_quedan;
