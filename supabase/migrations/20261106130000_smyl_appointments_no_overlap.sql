-- Auditoría del panel admin (2026-11-06): el candado de agenda usa p_starts_at::date (fecha UTC de la sesión) y la validación
-- de empalmes es de aplicación; dos reservas simultáneas cerca de la medianoche UTC (en México, desde las ~18:00 locales)
-- podían tomar candados distintos y quedar empalmadas. Esta migración agrega la garantía en la base de datos:
-- un profesional (y un sillón) no puede tener dos citas activas que se empalmen. Es complementaria a la validación existente
-- (que además respeta los tiempos de preparación/limpieza del servicio): aquí sólo se impide el empalme literal.
-- Si ya existen empalmes en los datos, NO falla: avisa y no crea la restricción (resuélvelos y vuelve a aplicarla).
-- Idempotente.

create extension if not exists btree_gist with schema extensions;

do $$
declare
  v_prof_overlaps bigint;
  v_room_overlaps bigint;
begin
  select count(*) into v_prof_overlaps
  from public.smyl_appointments a
  join public.smyl_appointments b
    on a.tenant_id = b.tenant_id and a.professional_id = b.professional_id and a.id < b.id
   and a.status in ('confirmed','arrived','in_progress') and b.status in ('confirmed','arrived','in_progress')
   and a.starts_at < b.ends_at and a.ends_at > b.starts_at;
  select count(*) into v_room_overlaps
  from public.smyl_appointments a
  join public.smyl_appointments b
    on a.tenant_id = b.tenant_id and a.room_id = b.room_id and a.id < b.id
   and a.room_id is not null
   and a.status in ('confirmed','arrived','in_progress') and b.status in ('confirmed','arrived','in_progress')
   and a.starts_at < b.ends_at and a.ends_at > b.starts_at;

  if v_prof_overlaps > 0 then
    raise notice 'Hay % empalmes de profesional en citas activas: la restricción smyl_appointments_no_professional_overlap NO se creó. Resuélvelos y vuelve a aplicar.', v_prof_overlaps;
  elsif not exists (select 1 from pg_constraint where conname = 'smyl_appointments_no_professional_overlap') then
    alter table public.smyl_appointments
      add constraint smyl_appointments_no_professional_overlap
      exclude using gist (tenant_id with =, professional_id with =, tstzrange(starts_at, ends_at) with &&)
      where (status in ('confirmed','arrived','in_progress'));
  end if;

  if v_room_overlaps > 0 then
    raise notice 'Hay % empalmes de sillón en citas activas: la restricción smyl_appointments_no_room_overlap NO se creó. Resuélvelos y vuelve a aplicar.', v_room_overlaps;
  elsif not exists (select 1 from pg_constraint where conname = 'smyl_appointments_no_room_overlap') then
    alter table public.smyl_appointments
      add constraint smyl_appointments_no_room_overlap
      exclude using gist (tenant_id with =, room_id with =, tstzrange(starts_at, ends_at) with &&)
      where (room_id is not null and status in ('confirmed','arrived','in_progress'));
  end if;
end;
$$;
