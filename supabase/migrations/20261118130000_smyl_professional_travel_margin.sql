-- Equipo · regla de traslado entre sedes.
-- Un doctor puede trabajar en varias sedes de la misma clínica, pero no estar en dos a la vez: entre el horario de una sede
-- y el de otra, el mismo día, debe haber al menos N minutos de traslado (45 por omisión, ajustable por clínica de 0 a 240).
--   * smyl_schedule_rules: reglas de agenda de la clínica. Hoy sólo professional_travel_margin_minutes. Sin fila = 45.
--     Lectura para los miembros de la clínica; escritura sólo por smyl_set_professional_travel_margin (clinic.manage, auditada).
--   * smyl_prevent_professional_branch_conflict: trigger sobre smyl_professional_hours. Rechaza guardar un bloque activo que
--     quede a menos del margen de otro bloque activo del mismo doctor y día en una sede DISTINTA. En la misma sede sigue
--     valiendo la regla de no traslape que ya existía (smyl_prevent_professional_hour_overlap).
--   * smyl_professional_travel_conflicts: lista de lectura de los choques que ya existen (horarios guardados antes de esta regla),
--     para que el administrador los corrija (requiere schedule.read, como la lectura de los horarios). No cambia ni borra ningún horario.
-- El trigger sólo revisa lo que se guarda desde ahora: no toca horarios existentes. Idempotente.

create table if not exists public.smyl_schedule_rules (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  professional_travel_margin_minutes smallint not null default 45
    check (professional_travel_margin_minutes between 0 and 240),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.smyl_schedule_rules enable row level security;
revoke all on public.smyl_schedule_rules from public, anon, authenticated;
grant select on public.smyl_schedule_rules to authenticated;

drop policy if exists smyl_schedule_rules_read on public.smyl_schedule_rules;
create policy smyl_schedule_rules_read on public.smyl_schedule_rules for select to authenticated
  using (public.camila_es_miembro(tenant_id));

create or replace function public.smyl_set_professional_travel_margin(p_minutes integer)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_before integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinic.manage') then
    raise exception using errcode = '42501', message = 'Sin permiso para cambiar el margen de traslado.';
  end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 240 then
    raise exception using errcode = '22003', message = 'El margen debe estar entre 0 y 240 minutos.';
  end if;
  select r.professional_travel_margin_minutes into v_before from public.smyl_schedule_rules r where r.tenant_id = v_tenant;
  insert into public.smyl_schedule_rules (tenant_id, professional_travel_margin_minutes, updated_by, updated_at)
  values (v_tenant, p_minutes, auth.uid(), now())
  on conflict (tenant_id) do update
    set professional_travel_margin_minutes = excluded.professional_travel_margin_minutes,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values (v_tenant, auth.uid(), case when v_before is null then 'insert' else 'update' end, 'professional_travel_margin', v_tenant::text,
          case when v_before is null then null else jsonb_build_object('minutes', v_before) end, jsonb_build_object('minutes', p_minutes));
  return p_minutes;
end;
$function$;

create or replace function public.smyl_prevent_professional_branch_conflict()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_margin integer;
  v_start integer;
  v_end integer;
begin
  if not new.active then return new; end if;
  select coalesce((select r.professional_travel_margin_minutes from public.smyl_schedule_rules r where r.tenant_id = new.tenant_id), 45)
    into v_margin;
  -- Minutos desde la medianoche: sumar un margen a un «time» daría la vuelta a las 24 h.
  v_start := (extract(epoch from new.starts_at) / 60)::integer;
  v_end := (extract(epoch from new.ends_at) / 60)::integer;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.professional_id::text || ':' || new.weekday::text || ':traslado', 0));
  if exists (
    select 1 from public.smyl_professional_hours h
    where h.tenant_id = new.tenant_id and h.professional_id = new.professional_id
      and h.weekday = new.weekday and h.active
      and h.branch_id <> new.branch_id and h.id <> new.id
      and v_start < (extract(epoch from h.ends_at) / 60)::integer + v_margin
      and v_end + v_margin > (extract(epoch from h.starts_at) / 60)::integer
  ) then
    raise exception using errcode = '23P01',
      message = format('El doctor ya tiene horario en otra sede muy cerca de este. Entre sedes se necesitan al menos %s minutos de traslado.', v_margin);
  end if;
  return new;
end;
$function$;

drop trigger if exists smyl_professional_hours_travel_margin on public.smyl_professional_hours;
create trigger smyl_professional_hours_travel_margin
  before insert or update on public.smyl_professional_hours
  for each row execute function public.smyl_prevent_professional_branch_conflict();

create or replace function public.smyl_professional_travel_conflicts()
returns table (
  professional_id uuid, weekday smallint,
  branch_a uuid, starts_a time, ends_a time,
  branch_b uuid, starts_b time, ends_b time,
  gap_minutes integer, required_minutes integer
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_margin integer;
begin
  -- Mismo permiso que la lectura de smyl_professional_hours: la lista no debe mostrar horarios a quien no puede verlos.
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.read') then
    raise exception using errcode = '42501', message = 'Sin permiso para consultar los horarios.';
  end if;
  select coalesce((select r.professional_travel_margin_minutes from public.smyl_schedule_rules r where r.tenant_id = v_tenant), 45)
    into v_margin;
  return query
    select a.professional_id, a.weekday,
           a.branch_id, a.starts_at, a.ends_at,
           b.branch_id, b.starts_at, b.ends_at,
           -- Separación en minutos entre el final de uno y el inicio del otro (negativa si se traslapan).
           greatest((extract(epoch from b.starts_at) / 60)::integer - (extract(epoch from a.ends_at) / 60)::integer,
                    (extract(epoch from a.starts_at) / 60)::integer - (extract(epoch from b.ends_at) / 60)::integer),
           v_margin
    from public.smyl_professional_hours a
    join public.smyl_professional_hours b
      on b.tenant_id = a.tenant_id and b.professional_id = a.professional_id and b.weekday = a.weekday
     and b.active and b.branch_id <> a.branch_id and a.id < b.id
    where a.tenant_id = v_tenant and a.active
      and (extract(epoch from a.starts_at) / 60)::integer < (extract(epoch from b.ends_at) / 60)::integer + v_margin
      and (extract(epoch from a.ends_at) / 60)::integer + v_margin > (extract(epoch from b.starts_at) / 60)::integer
    order by a.professional_id, a.weekday, a.starts_at;
end;
$function$;

revoke all on function public.smyl_set_professional_travel_margin(integer) from public, anon;
revoke all on function public.smyl_prevent_professional_branch_conflict() from public, anon, authenticated;
revoke all on function public.smyl_professional_travel_conflicts() from public, anon;
grant execute on function public.smyl_set_professional_travel_margin(integer) to authenticated;
grant execute on function public.smyl_professional_travel_conflicts() to authenticated;
