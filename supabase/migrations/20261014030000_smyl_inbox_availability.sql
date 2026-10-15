-- SMYL · Agenda conversacional, etapa 2: consulta privada de espacios reales.
-- Sólo lectura; no crea solicitudes ni citas y no depende de LANA.
begin;

create or replace function public.smyl_inbox_available_slots(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_service_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid default null,
  p_professional_id uuid default null,
  p_limit integer default 12
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  branch_id uuid,
  branch_name text,
  timezone text,
  professional_id uuid,
  professional_name text,
  specialty text,
  service_id uuid,
  service_name text,
  duration_minutes integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,12),1),30);
begin
  if p_tenant_id is null or p_actor_id is null or p_service_id is null
     or p_from is null or p_to is null or p_from >= p_to
     or p_to - p_from > interval '31 days' then
    raise exception using errcode='22023', message='El periodo de disponibilidad no es válido.';
  end if;

  if not (
    exists(select 1 from public.camila_tenants t where t.id=p_tenant_id and t.id=p_actor_id and t.activo)
    or exists(
      select 1
      from public.camila_usuarios u
      join public.smyl_member_roles mr on mr.tenant_id=u.tenant_id and mr.user_id=u.id
      join public.smyl_roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id and r.active
      join public.smyl_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id
      where u.id=p_actor_id and u.tenant_id=p_tenant_id and u.activo
        and rp.permission_key='schedule.read'
    )
  ) then
    raise exception using errcode='42501', message='No tienes permiso para consultar disponibilidad.';
  end if;

  return query
  with service as (
    select s.id,s.name,s.duration_minutes,s.buffer_before_minutes,s.buffer_after_minutes
    from public.smyl_services s
    where s.tenant_id=p_tenant_id and s.id=p_service_id and s.active
  ), candidates as (
    select slot as starts_at,
           slot + make_interval(mins=>s.duration_minutes) as ends_at,
           b.id as branch_id,b.name as branch_name,b.timezone,
           p.id as professional_id,p.display_name as professional_name,p.specialty,
           s.id as service_id,s.name as service_name,s.duration_minutes,
           s.buffer_before_minutes,s.buffer_after_minutes
    from service s
    join public.smyl_professional_services ps
      on ps.tenant_id=p_tenant_id and ps.service_id=s.id
    join public.smyl_professionals p
      on p.tenant_id=ps.tenant_id and p.id=ps.professional_id and p.active
    join public.smyl_professional_hours ph
      on ph.tenant_id=p.tenant_id and ph.professional_id=p.id and ph.active
    join public.smyl_branches b
      on b.tenant_id=ph.tenant_id and b.id=ph.branch_id and b.active
    cross join lateral generate_series(p_from,p_to,interval '15 minutes') slot
    where (p_branch_id is null or b.id=p_branch_id)
      and (p_professional_id is null or p.id=p_professional_id)
      and extract(dow from slot at time zone b.timezone)::integer=ph.weekday
      and (slot at time zone b.timezone)::time>=ph.starts_at
      and ((slot + make_interval(mins=>s.duration_minutes)) at time zone b.timezone)::date=(slot at time zone b.timezone)::date
      and ((slot + make_interval(mins=>s.duration_minutes)) at time zone b.timezone)::time<=ph.ends_at
      and exists(
        select 1 from public.smyl_clinic_hours ch
        where ch.tenant_id=p_tenant_id and ch.branch_id=b.id and ch.weekday=ph.weekday and ch.active
          and (slot at time zone b.timezone)::time>=ch.starts_at
          and ((slot + make_interval(mins=>s.duration_minutes)) at time zone b.timezone)::time<=ch.ends_at
      )
  )
  select c.starts_at,c.ends_at,c.branch_id,c.branch_name,c.timezone,
         c.professional_id,c.professional_name,c.specialty,
         c.service_id,c.service_name,c.duration_minutes
  from candidates c
  where c.starts_at>=greatest(p_from,clock_timestamp())
    and c.ends_at<=p_to
    and not exists(
      select 1 from public.smyl_appointments a
      where a.tenant_id=p_tenant_id and a.professional_id=c.professional_id
        and a.status in ('confirmed','arrived','in_progress')
        and c.starts_at-make_interval(mins=>c.buffer_before_minutes)<a.ends_at
        and c.ends_at+make_interval(mins=>c.buffer_after_minutes)>a.starts_at
    )
    and not exists(
      select 1 from public.smyl_schedule_blocks bl
      where bl.tenant_id=p_tenant_id and bl.active and bl.branch_id=c.branch_id
        and bl.professional_id=c.professional_id
        and c.starts_at-make_interval(mins=>c.buffer_before_minutes)<bl.ends_at
        and c.ends_at+make_interval(mins=>c.buffer_after_minutes)>bl.starts_at
    )
  order by c.starts_at,c.professional_name,c.branch_name
  limit v_limit;
end;
$$;

comment on function public.smyl_inbox_available_slots(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer)
is 'Read-only verified dental availability for the SMYL Inbox. It never creates or holds an appointment.';

revoke all on function public.smyl_inbox_available_slots(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.smyl_inbox_available_slots(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer) to service_role;

commit;
