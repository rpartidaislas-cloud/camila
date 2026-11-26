-- SMYL · Agenda con IA: «La IA puede ofrecerlo» pasa a ser una marca de cada servicio (se edita en Servicios y tarifas, uno o varios a la vez).
-- Usa la misma tabla smyl_ai_scheduling_services que ya lee el asistente: lo que la clínica ya había marcado se conserva sin migrar nada.
-- Aditiva e idempotente: no cambia tablas ni funciones existentes.
begin;

-- Marca o quita un servicio. Si quita el último servicio con la IA encendida, la apaga (sin servicios no habría nada que ofrecer).
create or replace function public.smyl_set_ai_services(p_service_ids uuid[], p_allowed boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_valid integer;
  v_left integer;
  v_level text;
  v_turned_off boolean := false;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para configurar la agenda con IA.';
  end if;
  if p_allowed is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 100 then
    raise exception using errcode = '22023', message = 'Elige entre 1 y 100 servicios.';
  end if;
  if p_allowed then
    select count(*) into v_valid from public.smyl_services s where s.tenant_id = v_tenant and s.active and s.id = any (v_ids);
    if v_valid <> (select count(distinct x) from unnest(v_ids) x) then
      raise exception using errcode = '22023', message = 'Algún servicio no existe o está desactivado.';
    end if;
    insert into public.smyl_ai_scheduling_services(tenant_id, service_id)
    select v_tenant, x from (select distinct unnest(v_ids) as x) q
    on conflict do nothing;
  else
    delete from public.smyl_ai_scheduling_services where tenant_id = v_tenant and service_id = any (v_ids);
    select count(*) into v_left from public.smyl_ai_scheduling_services where tenant_id = v_tenant;
    select level into v_level from public.smyl_ai_scheduling_settings where tenant_id = v_tenant;
    if v_left = 0 and v_level is not null and v_level <> 'off' then
      update public.smyl_ai_scheduling_settings set level = 'off', updated_by = auth.uid() where tenant_id = v_tenant;
      v_turned_off := true;
    end if;
  end if;
  return jsonb_build_object('allowed', p_allowed, 'count', cardinality(v_ids), 'turned_off', v_turned_off);
end;
$$;
revoke all on function public.smyl_set_ai_services(uuid[], boolean) from public, anon;
grant execute on function public.smyl_set_ai_services(uuid[], boolean) to authenticated;

-- Opciones de la IA sin tocar los servicios: nivel, anticipación mínima y horizonte. Para encender necesita al menos un servicio marcado.
create or replace function public.smyl_set_ai_scheduling_options(p_level text, p_min_lead_hours integer, p_horizon_days integer, p_book_cap integer default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_count integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para configurar la agenda con IA.';
  end if;
  if p_level not in ('off', 'suggest', 'request', 'book') or p_min_lead_hours not between 1 and 72 or p_horizon_days not between 1 and 60
     or (p_book_cap is not null and p_book_cap not between 1 and 50) then
    raise exception using errcode = '22023', message = 'Configuración no válida.';
  end if;
  select count(*) into v_count from public.smyl_ai_scheduling_services a
    join public.smyl_services s on s.tenant_id = a.tenant_id and s.id = a.service_id and s.active
    where a.tenant_id = v_tenant;
  if p_level <> 'off' and v_count = 0 then
    raise exception using errcode = '22023', message = 'Marca primero al menos un servicio con «La IA puede ofrecerlo» en Servicios y tarifas.';
  end if;
  insert into public.smyl_ai_scheduling_settings(tenant_id, level, min_lead_hours, horizon_days, book_daily_cap, updated_by)
  values (v_tenant, p_level, p_min_lead_hours, p_horizon_days, coalesce(p_book_cap, 10), auth.uid())
  on conflict (tenant_id) do update set level = excluded.level, min_lead_hours = excluded.min_lead_hours, horizon_days = excluded.horizon_days,
    book_daily_cap = coalesce(p_book_cap, public.smyl_ai_scheduling_settings.book_daily_cap), updated_by = auth.uid();
  return jsonb_build_object('level', p_level, 'min_lead_hours', p_min_lead_hours, 'horizon_days', p_horizon_days, 'service_count', v_count);
end;
$$;
revoke all on function public.smyl_set_ai_scheduling_options(text, integer, integer, integer) from public, anon;
grant execute on function public.smyl_set_ai_scheduling_options(text, integer, integer, integer) to authenticated;

commit;
