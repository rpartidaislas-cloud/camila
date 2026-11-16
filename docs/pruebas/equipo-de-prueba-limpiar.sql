-- SMYL · Borra el equipo de PRUEBA creado con equipo-de-prueba.sql.
--
-- Solo toca, EN LA CLÍNICA QUE INDIQUES, lo que tiene identificador que empieza con 7e57: las 3 sucursales de prueba (con sus horarios,
-- sillones y ubicación de inventario) y los 6 dentistas de prueba (con sus horarios y servicios asignados).
-- No borra los servicios dentales, los pacientes ni tu sucursal propia.
--
-- Si durante las pruebas se agendaron citas, solicitudes, propuestas o bloqueos con estos dentistas o
-- sucursales, TAMBIÉN se borran (están ligados a datos ficticios).
--
-- Si una sucursal o un dentista de prueba ya tiene historia de negocio (cobros, caja, notas clínicas, movimientos
-- de inventario…), NO se borra: se DESACTIVA y el resultado lo avisa. Así nunca se pierde un registro financiero.
--
-- Supabase → SQL Editor → New query → pega esto → Run. Se puede correr varias veces.

-- ► ÚNICA LÍNEA QUE DEBES EDITAR: el mismo id de clínica que usaste en equipo-de-prueba.sql.
select set_config('smyl.clinica', 'PEGA-AQUI-EL-ID-DE-LA-CLINICA', false);

do $$
declare
  v_tenant uuid;
  r record;
  v_citas int := 0; v_solicitudes int := 0; v_propuestas int := 0; v_bloqueos int := 0;
  v_borrados int := 0; v_desactivados int := 0;
begin
  if current_setting('smyl.clinica') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Falta el id de la clínica: reemplaza PEGA-AQUI-EL-ID-DE-LA-CLINICA por el id real (select id, nombre from public.camila_tenants).';
  end if;
  v_tenant := current_setting('smyl.clinica')::uuid;

  -- 1. Lo agendado con los dentistas o sucursales de prueba.
  with borradas as (
    delete from public.smyl_appointment_negotiation_proposals
    where tenant_id = v_tenant and (professional_id::text like '7e570000-%' or branch_id::text like '7e570000-%' or room_id::text like '7e570000-%')
    returning 1
  ) select count(*) into v_propuestas from borradas;

  with borradas as (
    delete from public.smyl_appointments
    where tenant_id = v_tenant and (professional_id::text like '7e570000-%' or branch_id::text like '7e570000-%' or room_id::text like '7e570000-%')
    returning 1
  ) select count(*) into v_citas from borradas;

  with borradas as (
    delete from public.smyl_appointment_requests
    where tenant_id = v_tenant and (preferred_professional_id::text like '7e570000-%' or preferred_branch_id::text like '7e570000-%' or preferred_room_id::text like '7e570000-%')
    returning 1
  ) select count(*) into v_solicitudes from borradas;

  with borradas as (
    delete from public.smyl_schedule_blocks
    where tenant_id = v_tenant and (professional_id::text like '7e570000-%' or branch_id::text like '7e570000-%' or room_id::text like '7e570000-%')
    returning 1
  ) select count(*) into v_bloqueos from borradas;

  -- 2. Dentistas: se borran con sus horarios y servicios; si ya tienen historia clínica o de inventario, se desactivan.
  for r in select id from public.smyl_professionals where tenant_id = v_tenant and id::text like '7e570000-%' loop
    begin
      delete from public.smyl_professionals where tenant_id = v_tenant and id = r.id;
      v_borrados := v_borrados + 1;
    exception when others then
      update public.smyl_professionals set active = false where tenant_id = v_tenant and id = r.id;
      v_desactivados := v_desactivados + 1;
    end;
  end loop;

  -- 3. Sucursales: se borran con su horario, sillones e inventario; si ya tienen caja, cobros o similares, se desactivan.
  for r in select id from public.smyl_branches where tenant_id = v_tenant and id::text like '7e570000-%' loop
    begin
      delete from public.smyl_inventory_locations where tenant_id = v_tenant and branch_id = r.id;
      delete from public.smyl_clinic_hours where tenant_id = v_tenant and branch_id = r.id;
      delete from public.smyl_rooms where tenant_id = v_tenant and branch_id = r.id;
      delete from public.smyl_branches where tenant_id = v_tenant and id = r.id;
      v_borrados := v_borrados + 1;
    exception when others then
      update public.smyl_branches set active = false where tenant_id = v_tenant and id = r.id and not is_default;
      update public.smyl_rooms set active = false where tenant_id = v_tenant and branch_id = r.id;
      v_desactivados := v_desactivados + 1;
    end;
  end loop;

  raise notice 'Borrados: %. Desactivados (tenían historia): %. Citas: %, solicitudes: %, propuestas: %, bloqueos: %.',
    v_borrados, v_desactivados, v_citas, v_solicitudes, v_propuestas, v_bloqueos;
end;
$$;

select
  (select count(*) from public.smyl_branches      where tenant_id = current_setting('smyl.clinica')::uuid and id::text like '7e570000-%')                as sucursales_de_prueba_que_quedan,
  (select count(*) from public.smyl_branches      where tenant_id = current_setting('smyl.clinica')::uuid and id::text like '7e570000-%' and not active) as sucursales_desactivadas,
  (select count(*) from public.smyl_professionals where tenant_id = current_setting('smyl.clinica')::uuid and id::text like '7e570000-%')                as dentistas_de_prueba_que_quedan,
  (select count(*) from public.smyl_professionals where tenant_id = current_setting('smyl.clinica')::uuid and id::text like '7e570000-%' and not active) as dentistas_desactivados;
