-- SMYL · Agenda con IA, paso 1 (solo lectura): política de la clínica y bitácora.
-- El asistente de LANA podrá consultar horarios libres reales de SMYL, pero SOLO si la clínica lo enciende aquí y SOLO para los servicios
-- que marque. Este paso no agenda nada. Aditiva e idempotente. APAGADO por defecto.
begin;

create table if not exists public.smyl_ai_scheduling_settings (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  -- off: apagado. suggest: el asistente sugiere horarios y una persona confirma. book: reservado para un paso posterior.
  level text not null default 'off' check (level in ('off', 'suggest', 'book')),
  min_lead_hours integer not null default 2 check (min_lead_hours between 1 and 72),
  horizon_days integer not null default 14 check (horizon_days between 1 and 60),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.smyl_ai_scheduling_services (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, service_id),
  foreign key (tenant_id, service_id) references public.smyl_services(tenant_id, id) on delete cascade
);

-- Bitácora de consultas del asistente. Sin texto de conversaciones ni datos de pacientes: solo qué se pidió y qué se respondió.
create table if not exists public.smyl_ai_scheduling_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  conversation_id uuid,
  action text not null check (action in ('context', 'suggest')),
  status text not null check (status in ('ok', 'few', 'none', 'denied', 'invalid', 'limited', 'error')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists smyl_ai_scheduling_events_tenant_idx on public.smyl_ai_scheduling_events (tenant_id, created_at desc);
create index if not exists smyl_ai_scheduling_events_conv_idx on public.smyl_ai_scheduling_events (tenant_id, conversation_id, created_at desc);

drop trigger if exists smyl_ai_scheduling_settings_touch on public.smyl_ai_scheduling_settings;
create trigger smyl_ai_scheduling_settings_touch before update on public.smyl_ai_scheduling_settings
  for each row execute function public.smyl_touch_updated_at();
drop trigger if exists smyl_ai_scheduling_settings_audit on public.smyl_ai_scheduling_settings;
create trigger smyl_ai_scheduling_settings_audit after insert or update or delete on public.smyl_ai_scheduling_settings
  for each row execute function public.smyl_audit_row();
drop trigger if exists smyl_ai_scheduling_services_audit on public.smyl_ai_scheduling_services;
create trigger smyl_ai_scheduling_services_audit after insert or update or delete on public.smyl_ai_scheduling_services
  for each row execute function public.smyl_audit_row();

alter table public.smyl_ai_scheduling_settings enable row level security;
alter table public.smyl_ai_scheduling_services enable row level security;
alter table public.smyl_ai_scheduling_events enable row level security;

drop policy if exists smyl_ai_scheduling_settings_read on public.smyl_ai_scheduling_settings;
create policy smyl_ai_scheduling_settings_read on public.smyl_ai_scheduling_settings
  for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
drop policy if exists smyl_ai_scheduling_services_read on public.smyl_ai_scheduling_services;
create policy smyl_ai_scheduling_services_read on public.smyl_ai_scheduling_services
  for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
drop policy if exists smyl_ai_scheduling_events_read on public.smyl_ai_scheduling_events;
create policy smyl_ai_scheduling_events_read on public.smyl_ai_scheduling_events
  for select to authenticated using (public.smyl_has_permission(tenant_id, 'settings.manage'));

revoke all on table public.smyl_ai_scheduling_settings, public.smyl_ai_scheduling_services, public.smyl_ai_scheduling_events from anon;
revoke insert, update, delete on table public.smyl_ai_scheduling_settings, public.smyl_ai_scheduling_services, public.smyl_ai_scheduling_events from authenticated;
grant select on public.smyl_ai_scheduling_settings, public.smyl_ai_scheduling_services, public.smyl_ai_scheduling_events to authenticated;

-- Guarda la política completa de una vez (nivel, anticipación, horizonte y servicios permitidos). Tenant y permiso salen de auth.uid().
create or replace function public.smyl_set_ai_scheduling(p_level text, p_min_lead_hours integer, p_horizon_days integer, p_service_ids uuid[])
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_valid integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para configurar la agenda con IA.';
  end if;
  -- El nivel «book» (agendar solo) todavía no se puede activar desde aquí.
  if p_level not in ('off', 'suggest') or p_min_lead_hours not between 1 and 72 or p_horizon_days not between 1 and 60 or cardinality(v_ids) > 50 then
    raise exception using errcode = '22023', message = 'Configuración no válida.';
  end if;
  select count(*) into v_valid from public.smyl_services s where s.tenant_id = v_tenant and s.active and s.id = any (v_ids);
  if v_valid <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception using errcode = '22023', message = 'Algún servicio no existe o está inactivo.';
  end if;
  if p_level = 'suggest' and cardinality(v_ids) = 0 then
    raise exception using errcode = '22023', message = 'Elige al menos un servicio que el asistente pueda sugerir.';
  end if;
  insert into public.smyl_ai_scheduling_settings(tenant_id, level, min_lead_hours, horizon_days, updated_by)
  values (v_tenant, p_level, p_min_lead_hours, p_horizon_days, auth.uid())
  on conflict (tenant_id) do update set level = excluded.level, min_lead_hours = excluded.min_lead_hours, horizon_days = excluded.horizon_days, updated_by = auth.uid();
  delete from public.smyl_ai_scheduling_services where tenant_id = v_tenant and not (service_id = any (v_ids));
  insert into public.smyl_ai_scheduling_services(tenant_id, service_id)
  select v_tenant, x from (select distinct unnest(v_ids) as x) q
  on conflict do nothing;
  return jsonb_build_object('level', p_level, 'min_lead_hours', p_min_lead_hours, 'horizon_days', p_horizon_days, 'service_count', cardinality(v_ids));
end;
$$;
revoke all on function public.smyl_set_ai_scheduling(text, integer, integer, uuid[]) from public, anon;
grant execute on function public.smyl_set_ai_scheduling(text, integer, integer, uuid[]) to authenticated;

comment on table public.smyl_ai_scheduling_settings is 'Política de la clínica para que el asistente de IA consulte horarios libres. Apagado por defecto.';
comment on table public.smyl_ai_scheduling_events is 'Bitácora de consultas del asistente (sin conversaciones ni datos de pacientes). La escribe la función lana-scheduling con service_role.';
commit;
