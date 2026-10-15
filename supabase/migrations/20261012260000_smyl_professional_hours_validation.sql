-- SMYL · Etapa 2: la disponibilidad profesional debe caber en la jornada clínica.
begin;

create or replace function public.smyl_prevent_professional_hour_overlap()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not new.active then return new; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.tenant_id::text || ':' || new.professional_id::text || ':' || new.branch_id::text || ':' || new.weekday::text, 0)
  );

  if not exists (
    select 1 from public.smyl_clinic_hours h
    where h.tenant_id = new.tenant_id and h.branch_id = new.branch_id
      and h.weekday = new.weekday and h.active
      and new.starts_at >= h.starts_at and new.ends_at <= h.ends_at
  ) then
    raise exception using errcode = '23514',
      message = 'La disponibilidad debe quedar dentro del horario activo de la clínica.';
  end if;

  if exists (
    select 1 from public.smyl_professional_hours h
    where h.tenant_id = new.tenant_id and h.professional_id = new.professional_id
      and h.branch_id = new.branch_id and h.weekday = new.weekday and h.active
      and h.id <> new.id and new.starts_at < h.ends_at and new.ends_at > h.starts_at
  ) then
    raise exception using errcode = '23P01',
      message = 'La disponibilidad se traslapa con otro bloque activo.';
  end if;

  return new;
end; $$;

commit;
