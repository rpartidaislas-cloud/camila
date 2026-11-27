-- Bitácora sanitaria operativa por sucursal.
--
-- La revisión diaria de SMYL es voluntaria como herramienta, pero cuando se usa
-- deja evidencia individual por área/equipo, responsable y hora. El estado nunca
-- se presupone: los elementos aparecen sin marcar y sólo se registran al guardar.

begin;

create table if not exists public.smyl_sanitation_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid not null,
  source_key text not null check (char_length(source_key) between 3 and 100),
  source_room_id uuid,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  category text not null default 'area' check (category in (
    'clinical_space', 'sterilization', 'common_area', 'equipment', 'waterline', 'other'
  )),
  default_task text not null default 'Limpieza y desinfección'
    check (char_length(btrim(default_task)) between 3 and 160),
  default_product text not null default '' check (char_length(default_product) <= 120),
  active boolean not null default true,
  sort_order smallint not null default 100 check (sort_order between 0 and 9999),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, source_key),
  foreign key (tenant_id, branch_id)
    references public.smyl_branches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_room_id)
    references public.smyl_rooms(tenant_id, id) on delete set null
);
create index if not exists smyl_sanitation_assets_branch_idx
  on public.smyl_sanitation_assets(tenant_id, branch_id, active, sort_order, name);

create table if not exists public.smyl_sanitation_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid not null,
  asset_id uuid not null,
  batch_id uuid not null,
  activity_date date not null,
  occurred_at timestamptz not null,
  shift_name text not null default '' check (char_length(shift_name) <= 40),
  asset_name text not null check (char_length(btrim(asset_name)) between 2 and 100),
  task_name text not null check (char_length(btrim(task_name)) between 3 and 160),
  status text not null check (status in ('done', 'incident', 'not_applicable')),
  product_method text not null default '' check (char_length(product_method) <= 120),
  notes text not null default '' check (char_length(notes) <= 500),
  responsible_user uuid not null default auth.uid(),
  responsible_name text not null default '' check (char_length(responsible_name) <= 120),
  captured_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id)
    references public.smyl_branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, asset_id)
    references public.smyl_sanitation_assets(tenant_id, id) on delete restrict,
  constraint smyl_sanitation_incident_notes
    check (status <> 'incident' or char_length(btrim(notes)) >= 3)
);
create index if not exists smyl_sanitation_logs_day_idx
  on public.smyl_sanitation_logs(tenant_id, branch_id, activity_date desc, captured_at desc);
create index if not exists smyl_sanitation_logs_asset_idx
  on public.smyl_sanitation_logs(tenant_id, asset_id, occurred_at desc);
create index if not exists smyl_sanitation_logs_batch_idx
  on public.smyl_sanitation_logs(tenant_id, batch_id);

alter table public.smyl_sanitation_assets enable row level security;
alter table public.smyl_sanitation_logs enable row level security;
revoke all on public.smyl_sanitation_assets from public, anon, authenticated;
revoke all on public.smyl_sanitation_logs from public, anon, authenticated;

drop trigger if exists smyl_sanitation_assets_touch on public.smyl_sanitation_assets;
create trigger smyl_sanitation_assets_touch before update on public.smyl_sanitation_assets
  for each row execute function public.smyl_touch_updated_at();
drop trigger if exists smyl_sanitation_assets_audit on public.smyl_sanitation_assets;
create trigger smyl_sanitation_assets_audit after insert or update or delete on public.smyl_sanitation_assets
  for each row execute function public.smyl_audit_row();
drop trigger if exists smyl_sanitation_logs_audit on public.smyl_sanitation_logs;
create trigger smyl_sanitation_logs_audit after insert on public.smyl_sanitation_logs
  for each row execute function public.smyl_audit_row();
drop trigger if exists smyl_sanitation_logs_guard on public.smyl_sanitation_logs;
create trigger smyl_sanitation_logs_guard before update or delete on public.smyl_sanitation_logs
  for each row execute function public.smyl_compliance_log_guard();

-- Mantiene una lista inicial corta: áreas comunes, esterilización y cada espacio
-- clínico que ya existe en Configuración. No marca ninguno como realizado.
create or replace function public.smyl_sync_sanitation_assets(p_tenant uuid, p_branch uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.smyl_sanitation_assets
    (tenant_id, branch_id, source_key, name, category, default_task, sort_order)
  values (p_tenant, p_branch, 'system:common', 'Áreas comunes y puntos de contacto', 'common_area', 'Limpieza y desinfección de superficies', 800)
  on conflict (tenant_id, branch_id, source_key) do nothing;

  insert into public.smyl_sanitation_assets
    (tenant_id, branch_id, source_key, name, category, default_task, active, sort_order)
  select p_tenant, p_branch, 'system:sterilization', 'Área de esterilización', 'sterilization',
         'Limpieza y desinfección del área',
         not exists (
           select 1 from public.smyl_rooms r where r.tenant_id=p_tenant and r.branch_id=p_branch
             and r.room_type='esterilizacion' and r.active
         ), 700
  on conflict (tenant_id, branch_id, source_key) do update
    set active = excluded.active;

  insert into public.smyl_sanitation_assets
    (tenant_id, branch_id, source_key, source_room_id, name, category, default_task, sort_order)
  select r.tenant_id, r.branch_id, 'room:' || r.id::text, r.id, r.name,
         case when r.room_type = 'esterilizacion' then 'sterilization' else 'clinical_space' end,
         'Limpieza y desinfección del espacio clínico', 100
    from public.smyl_rooms r
   where r.tenant_id = p_tenant and r.branch_id = p_branch and r.active
  on conflict (tenant_id, branch_id, source_key) do update
    set name = excluded.name, category = excluded.category, active = true;

  update public.smyl_sanitation_assets a
     set active = false
   where a.tenant_id = p_tenant and a.branch_id = p_branch and a.source_room_id is not null
     and not exists (
       select 1 from public.smyl_rooms r
        where r.tenant_id = a.tenant_id and r.id = a.source_room_id and r.branch_id = a.branch_id and r.active
     );
end;
$$;

create or replace function public.smyl_daily_sanitation_overview(p_branch_id uuid default null, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_branch public.smyl_branches;
  v_local_now timestamp;
  v_date date;
  v_actor text := '';
  v_shift text;
  v_items jsonb;
  v_history jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.read') then
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar la bitácora sanitaria.';
  end if;

  if p_branch_id is not null then
    select * into v_branch from public.smyl_branches
     where tenant_id = v_tenant and id = p_branch_id and active;
  else
    select * into v_branch from public.smyl_branches
     where tenant_id = v_tenant and active order by is_default desc, created_at limit 1;
  end if;
  if v_branch.id is null then
    raise exception using errcode = 'P0002', message = 'Selecciona una sucursal activa para llevar la bitácora.';
  end if;

  v_local_now := timezone(v_branch.timezone, now());
  v_date := coalesce(p_date, v_local_now::date);
  if v_date > v_local_now::date or v_date < v_local_now::date - 30 then
    raise exception using errcode = '22023', message = 'La bitácora sólo admite hoy o los últimos 30 días.';
  end if;
  v_shift := case when v_local_now::time < time '14:00' then 'Matutino'
                  when v_local_now::time < time '20:00' then 'Vespertino' else 'Cierre' end;

  select coalesce(nullif(btrim(cu.nombre), ''), nullif(btrim(cu.email), ''), '')
    into v_actor from public.camila_usuarios cu
   where cu.tenant_id = v_tenant and cu.id = auth.uid() and cu.activo limit 1;
  if coalesce(v_actor, '') = '' then
    select coalesce(nullif(btrim(ct.nombre), ''), 'Responsable de la clínica') into v_actor
      from public.camila_tenants ct where ct.id = v_tenant;
  end if;

  perform public.smyl_sync_sanitation_assets(v_tenant, v_branch.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.name, 'category', a.category,
           'default_task', a.default_task,
           'default_product', coalesce(nullif(a.default_product, ''), prev.product_method, ''),
           'source_key', a.source_key, 'editable', a.source_key like 'custom:%',
           'last_log', case when l.id is null then null else jsonb_build_object(
             'id', l.id, 'status', l.status, 'occurred_at', l.occurred_at,
             'shift', l.shift_name, 'product_method', l.product_method,
             'notes', l.notes, 'responsible_name', l.responsible_name,
             'captured_at', l.captured_at
           ) end
         ) order by a.sort_order, a.name), '[]'::jsonb)
    into v_items
    from public.smyl_sanitation_assets a
    left join lateral (
      select x.* from public.smyl_sanitation_logs x
       where x.tenant_id = a.tenant_id and x.branch_id = a.branch_id
         and x.asset_id = a.id and x.activity_date = v_date
       order by x.captured_at desc limit 1
    ) l on true
    left join lateral (
      select nullif(x.product_method, '') as product_method
        from public.smyl_sanitation_logs x
       where x.tenant_id = a.tenant_id and x.branch_id = a.branch_id
         and x.asset_id = a.id and nullif(x.product_method, '') is not null
       order by x.occurred_at desc limit 1
    ) prev on true
   where a.tenant_id = v_tenant and a.branch_id = v_branch.id and a.active;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.occurred_at desc), '[]'::jsonb)
    into v_history from (
      select id, batch_id, activity_date, occurred_at, shift_name, asset_name,
             task_name, status, product_method, notes, responsible_name, captured_at
        from public.smyl_sanitation_logs
       where tenant_id = v_tenant and branch_id = v_branch.id
         and activity_date >= v_date - 6 and activity_date <= v_date
       order by occurred_at desc limit 80
    ) h;

  return jsonb_build_object(
    'context', jsonb_build_object(
      'branch_id', v_branch.id, 'branch_name', v_branch.name, 'timezone', v_branch.timezone,
      'date', to_char(v_date, 'YYYY-MM-DD'), 'time', to_char(v_local_now, 'HH24:MI'),
      'shift', v_shift, 'responsible_name', v_actor,
      'can_write', public.smyl_has_permission(v_tenant, 'clinical.write'),
      'can_manage', public.smyl_has_permission(v_tenant, 'settings.manage')
    ),
    'items', v_items, 'history', v_history
  );
end;
$$;

create or replace function public.smyl_save_daily_sanitation(
  p_branch_id uuid, p_local_date date, p_local_time time, p_shift text, p_checks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_branch public.smyl_branches;
  v_local timestamp;
  v_occurred timestamptz;
  v_batch uuid := gen_random_uuid();
  v_actor text := '';
  v_check jsonb;
  v_asset public.smyl_sanitation_assets;
  v_status text;
  v_notes text;
  v_count int := 0;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar esta bitácora.';
  end if;
  select * into v_branch from public.smyl_branches
   where tenant_id = v_tenant and id = p_branch_id and active;
  if v_branch.id is null then
    raise exception using errcode = 'P0002', message = 'La sucursal no está disponible.';
  end if;
  if p_local_date is null or p_local_time is null then
    raise exception using errcode = '22023', message = 'Indica la fecha y la hora del registro.';
  end if;
  if coalesce(jsonb_typeof(p_checks), '') <> 'array' or jsonb_array_length(p_checks) < 1 or jsonb_array_length(p_checks) > 100 then
    raise exception using errcode = '22023', message = 'Selecciona entre 1 y 100 elementos para guardar.';
  end if;

  v_local := p_local_date + p_local_time;
  v_occurred := v_local at time zone v_branch.timezone;
  if v_occurred > now() + interval '5 minutes' or v_occurred < now() - interval '30 days' then
    raise exception using errcode = '22023', message = 'Revisa la fecha y la hora del registro.';
  end if;
  if char_length(btrim(coalesce(p_shift, ''))) > 40 then
    raise exception using errcode = '22023', message = 'El turno no es válido.';
  end if;

  select coalesce(nullif(btrim(cu.nombre), ''), nullif(btrim(cu.email), ''), '')
    into v_actor from public.camila_usuarios cu
   where cu.tenant_id = v_tenant and cu.id = auth.uid() and cu.activo limit 1;
  if coalesce(v_actor, '') = '' then
    select coalesce(nullif(btrim(ct.nombre), ''), 'Responsable de la clínica') into v_actor
      from public.camila_tenants ct where ct.id = v_tenant;
  end if;

  for v_check in select value from jsonb_array_elements(p_checks)
  loop
    select * into v_asset from public.smyl_sanitation_assets
     where tenant_id = v_tenant and branch_id = v_branch.id
       and id = nullif(v_check->>'asset_id', '')::uuid and active;
    if v_asset.id is null then
      raise exception using errcode = '22023', message = 'Uno de los equipos o áreas ya no está disponible.';
    end if;
    v_status := coalesce(nullif(v_check->>'status', ''), 'done');
    if v_status not in ('done', 'incident', 'not_applicable') then
      raise exception using errcode = '22023', message = 'El resultado de la revisión no es válido.';
    end if;
    v_notes := left(btrim(coalesce(v_check->>'notes', '')), 500);
    if v_status = 'incident' and char_length(v_notes) < 3 then
      raise exception using errcode = '22023', message = 'Describe brevemente la incidencia.';
    end if;
    insert into public.smyl_sanitation_logs (
      tenant_id, branch_id, asset_id, batch_id, activity_date, occurred_at, shift_name,
      asset_name, task_name, status, product_method, notes, responsible_user, responsible_name
    ) values (
      v_tenant, v_branch.id, v_asset.id, v_batch, p_local_date, v_occurred,
      left(btrim(coalesce(p_shift, '')), 40), v_asset.name, v_asset.default_task, v_status,
      left(btrim(coalesce(nullif(v_check->>'product_method', ''), v_asset.default_product, '')), 120),
      v_notes, auth.uid(), left(v_actor, 120)
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('batch_id', v_batch, 'count', v_count, 'captured_at', now());
end;
$$;

create or replace function public.smyl_configure_sanitation_asset(p_action text, p_values jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_id uuid;
  v_branch uuid;
  v_category text;
  v_name text;
  v_task text;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar equipos y áreas.';
  end if;
  if p_action = 'archive' then
    v_id := nullif(p_values->>'id', '')::uuid;
    update public.smyl_sanitation_assets set active = false
     where tenant_id = v_tenant and id = v_id and source_key like 'custom:%';
    if not found then raise exception using errcode = 'P0002', message = 'El elemento no se puede quitar desde aquí.'; end if;
    return v_id;
  end if;
  if p_action <> 'create' then
    raise exception using errcode = '22023', message = 'La acción no es válida.';
  end if;
  v_branch := nullif(p_values->>'branch_id', '')::uuid;
  if not exists(select 1 from public.smyl_branches where tenant_id=v_tenant and id=v_branch and active) then
    raise exception using errcode = 'P0002', message = 'La sucursal no está disponible.';
  end if;
  v_name := left(btrim(coalesce(p_values->>'name', '')), 100);
  v_task := left(btrim(coalesce(p_values->>'default_task', '')), 160);
  v_category := coalesce(nullif(p_values->>'category', ''), 'equipment');
  if char_length(v_name) < 2 or char_length(v_task) < 3 then
    raise exception using errcode = '22023', message = 'Escribe el nombre y la actividad predeterminada.';
  end if;
  if v_category not in ('clinical_space','sterilization','common_area','equipment','waterline','other') then
    raise exception using errcode = '22023', message = 'La categoría no es válida.';
  end if;
  v_id := gen_random_uuid();
  insert into public.smyl_sanitation_assets
    (id, tenant_id, branch_id, source_key, name, category, default_task, default_product, sort_order, created_by)
  values (
    v_id, v_tenant, v_branch, 'custom:' || v_id::text, v_name, v_category, v_task,
    left(btrim(coalesce(p_values->>'default_product', '')), 120), 500, auth.uid()
  );
  return v_id;
end;
$$;

revoke all on function public.smyl_sync_sanitation_assets(uuid, uuid) from public, anon, authenticated;
revoke all on function public.smyl_daily_sanitation_overview(uuid, date) from public, anon;
revoke all on function public.smyl_save_daily_sanitation(uuid, date, time, text, jsonb) from public, anon;
revoke all on function public.smyl_configure_sanitation_asset(text, jsonb) from public, anon;
grant execute on function public.smyl_daily_sanitation_overview(uuid, date) to authenticated;
grant execute on function public.smyl_save_daily_sanitation(uuid, date, time, text, jsonb) to authenticated;
grant execute on function public.smyl_configure_sanitation_asset(text, jsonb) to authenticated;

comment on table public.smyl_sanitation_assets is 'Equipos y áreas que la clínica decide incluir en su bitácora sanitaria opcional de SMYL.';
comment on table public.smyl_sanitation_logs is 'Registros append-only de limpieza y desinfección por elemento, hora y responsable.';

commit;
