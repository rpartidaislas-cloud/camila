-- SMYL · Etapa 1: núcleo de clínica independiente.
--
-- Este esquema vive exclusivamente en el proyecto Supabase de SMYL. Reutiliza
-- patrones revisados de LANA (tenant, RLS, permisos y auditoría), pero no
-- comparte tablas ni bases de datos con LANA.

begin;

create extension if not exists pgcrypto;

-- La relación compuesta permite que todas las referencias validen tenant y
-- usuario en la misma FK; evita enlazar por error un miembro de otra clínica.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'camila_usuarios_tenant_id_id_key'
      and conrelid = 'public.camila_usuarios'::regclass
  ) then
    alter table public.camila_usuarios
      add constraint camila_usuarios_tenant_id_id_key unique (tenant_id, id);
  end if;
end;
$$;

create table if not exists public.smyl_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{2,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '',
  system_role boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create table if not exists public.smyl_role_permissions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  role_id uuid not null,
  permission_key text not null check (permission_key in (
    'clinic.read', 'clinic.manage',
    'team.read', 'team.manage', 'audit.read',
    'schedule.read', 'schedule.manage',
    'patients.read', 'patients.manage',
    'clinical.read', 'clinical.write', 'clinical.approve',
    'messages.read', 'messages.respond', 'messages.manage',
    'inventory.read', 'inventory.manage',
    'finance.read', 'finance.manage',
    'settings.manage'
  )),
  created_at timestamptz not null default now(),
  primary key (tenant_id, role_id, permission_key),
  foreign key (tenant_id, role_id)
    references public.smyl_roles(tenant_id, id) on delete cascade
);

create table if not exists public.smyl_member_roles (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null,
  role_id uuid not null,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (tenant_id, user_id, role_id),
  foreign key (tenant_id, user_id)
    references public.camila_usuarios(tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id)
    references public.smyl_roles(tenant_id, id) on delete cascade
);

create table if not exists public.smyl_branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  address_line text not null default '',
  city text not null default '',
  state text not null default '',
  postal_code text not null default '',
  phone text not null default '',
  timezone text not null default 'America/Mexico_City',
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create unique index if not exists smyl_branches_one_default_idx
  on public.smyl_branches(tenant_id) where is_default and active;
create unique index if not exists smyl_branches_name_idx
  on public.smyl_branches(tenant_id, lower(name)) where active;

create table if not exists public.smyl_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  room_type text not null default 'sillon' check (room_type in (
    'consultorio', 'sillon', 'quirofano', 'rayos_x', 'esterilizacion', 'otro'
  )),
  exclusive_use boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)
    references public.smyl_branches(tenant_id, id) on delete restrict
);

create unique index if not exists smyl_rooms_name_idx
  on public.smyl_rooms(tenant_id, branch_id, lower(name)) where active;

-- Un día puede tener varios bloques; por ejemplo 09:00–14:00 y 16:00–20:00.
create table if not exists public.smyl_clinic_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, branch_id, weekday, starts_at, ends_at),
  foreign key (tenant_id, branch_id)
    references public.smyl_branches(tenant_id, id) on delete restrict
);

create index if not exists smyl_clinic_hours_lookup_idx
  on public.smyl_clinic_hours(tenant_id, branch_id, weekday)
  where active;

-- Miembros operativos por sede. Una persona puede trabajar en más de una.
create table if not exists public.smyl_member_branches (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null,
  branch_id uuid not null,
  is_primary boolean not null default false,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (tenant_id, user_id, branch_id),
  foreign key (tenant_id, user_id)
    references public.camila_usuarios(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id)
    references public.smyl_branches(tenant_id, id) on delete cascade
);

create unique index if not exists smyl_member_branches_one_primary_idx
  on public.smyl_member_branches(tenant_id, user_id) where is_primary;

-- Un profesional puede existir sin cuenta de acceso (por ejemplo un especialista
-- externo). Si tiene usuario, la FK compuesta garantiza que sea del mismo tenant.
create table if not exists public.smyl_professionals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  specialty text not null default '',
  license_number text not null default '',
  color_token text not null default 'teal' check (color_token in (
    'navy', 'teal', 'blue', 'green', 'amber', 'coral', 'violet', 'slate'
  )),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, user_id)
    references public.camila_usuarios(tenant_id, id) on delete set null (user_id)
);

create unique index if not exists smyl_professionals_user_idx
  on public.smyl_professionals(tenant_id, user_id)
  where user_id is not null and active;

create table if not exists public.smyl_professional_branches (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, professional_id, branch_id),
  foreign key (tenant_id, professional_id)
    references public.smyl_professionals(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id)
    references public.smyl_branches(tenant_id, id) on delete cascade
);

create table if not exists public.smyl_audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity_type text not null,
  entity_id text not null default '',
  before_data jsonb,
  after_data jsonb,
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists smyl_audit_events_tenant_created_idx
  on public.smyl_audit_events(tenant_id, created_at desc);

-- Helpers de autorización. Son SECURITY DEFINER para evitar recursión de RLS;
-- tenant y actor siempre se resuelven desde auth.uid(), no desde el navegador.
create or replace function public.smyl_current_tenant()
returns uuid
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select cu.tenant_id
     from public.camila_usuarios cu
     where cu.id = auth.uid() and cu.activo
     limit 1),
    (select ct.id
     from public.camila_tenants ct
     where ct.id = auth.uid() and ct.activo
     limit 1)
  );
$$;

create or replace function public.smyl_has_permission(
  p_tenant_id uuid,
  p_permission text
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    exists (
      select 1
      from public.camila_tenants ct
      where ct.id = p_tenant_id
        and ct.id = auth.uid()
        and ct.activo
    )
    or exists (
      select 1
      from public.camila_usuarios cu
      join public.smyl_member_roles mr
        on mr.tenant_id = cu.tenant_id and mr.user_id = cu.id
      join public.smyl_roles r
        on r.tenant_id = mr.tenant_id and r.id = mr.role_id and r.active
      join public.smyl_role_permissions rp
        on rp.tenant_id = r.tenant_id and rp.role_id = r.id
      where cu.id = auth.uid()
        and cu.tenant_id = p_tenant_id
        and cu.activo
        and rp.permission_key = p_permission
    );
$$;

revoke all on function public.smyl_current_tenant() from public, anon;
revoke all on function public.smyl_has_permission(uuid, text) from public, anon;
grant execute on function public.smyl_current_tenant() to authenticated;
grant execute on function public.smyl_has_permission(uuid, text) to authenticated;

create or replace function public.smyl_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.smyl_audit_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
begin
  v_before := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row := coalesce(v_after, v_before, '{}'::jsonb);

  insert into public.smyl_audit_events (
    tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    (v_row->>'tenant_id')::uuid,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row->>'id', v_row->>'user_id', v_row->>'role_id', v_row->>'branch_id', ''),
    v_before,
    v_after
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

-- Serializa la validación por sucursal/día para impedir que dos altas
-- concurrentes creen bloques activos que se traslapen.
create or replace function public.smyl_prevent_clinic_hour_overlap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.active then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      new.tenant_id::text || ':' || new.branch_id::text || ':' || new.weekday::text,
      0
    )
  );

  if exists (
    select 1
    from public.smyl_clinic_hours h
    where h.tenant_id = new.tenant_id
      and h.branch_id = new.branch_id
      and h.weekday = new.weekday
      and h.active
      and h.id <> new.id
      and new.starts_at < h.ends_at
      and new.ends_at > h.starts_at
  ) then
    raise exception using
      errcode = '23P01',
      message = 'El horario se traslapa con otro bloque activo de la sucursal.';
  end if;

  return new;
end;
$$;

-- Idempotente: crea roles base y asigna al equipo actual sin quitar permisos
-- personalizados. El dueño conserva bypass explícito en smyl_has_permission.
create or replace function public.smyl_bootstrap_clinic(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_default_branch uuid;
begin
  insert into public.smyl_roles (tenant_id, code, name, description, system_role)
  values
    (p_tenant_id, 'propietario', 'Propietario', 'Control total de la clínica.', true),
    (p_tenant_id, 'administrador', 'Administrador', 'Operación general sin gestión de suscripción.', true),
    (p_tenant_id, 'odontologo', 'Odontólogo', 'Atención clínica, pacientes y agenda.', true),
    (p_tenant_id, 'recepcion', 'Recepción', 'Pacientes, agenda y mensajes.', true),
    (p_tenant_id, 'asistente', 'Asistente clínico', 'Apoyo clínico y operativo.', true),
    (p_tenant_id, 'inventario', 'Inventario', 'Compras, existencias y consumos.', true),
    (p_tenant_id, 'finanzas', 'Finanzas', 'Caja, cobros y reportes financieros.', true)
  on conflict (tenant_id, code) do nothing;

  insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
  select p_tenant_id, r.id, p.permission_key
  from public.smyl_roles r
  join (values
    ('propietario','clinic.read'), ('propietario','clinic.manage'),
    ('propietario','team.read'), ('propietario','team.manage'), ('propietario','audit.read'),
    ('propietario','schedule.read'), ('propietario','schedule.manage'),
    ('propietario','patients.read'), ('propietario','patients.manage'),
    ('propietario','clinical.read'), ('propietario','clinical.write'), ('propietario','clinical.approve'),
    ('propietario','messages.read'), ('propietario','messages.respond'), ('propietario','messages.manage'),
    ('propietario','inventory.read'), ('propietario','inventory.manage'),
    ('propietario','finance.read'), ('propietario','finance.manage'), ('propietario','settings.manage'),
    ('administrador','clinic.read'), ('administrador','clinic.manage'),
    ('administrador','team.read'), ('administrador','team.manage'), ('administrador','audit.read'),
    ('administrador','schedule.read'), ('administrador','schedule.manage'),
    ('administrador','patients.read'), ('administrador','patients.manage'),
    ('administrador','clinical.read'), ('administrador','clinical.write'), ('administrador','clinical.approve'),
    ('administrador','messages.read'), ('administrador','messages.respond'), ('administrador','messages.manage'),
    ('administrador','inventory.read'), ('administrador','inventory.manage'),
    ('administrador','finance.read'), ('administrador','finance.manage'), ('administrador','settings.manage'),
    ('odontologo','clinic.read'), ('odontologo','team.read'),
    ('odontologo','schedule.read'), ('odontologo','schedule.manage'),
    ('odontologo','patients.read'), ('odontologo','patients.manage'),
    ('odontologo','clinical.read'), ('odontologo','clinical.write'), ('odontologo','clinical.approve'),
    ('odontologo','messages.read'), ('odontologo','messages.respond'), ('odontologo','inventory.read'),
    ('recepcion','clinic.read'), ('recepcion','team.read'),
    ('recepcion','schedule.read'), ('recepcion','schedule.manage'),
    ('recepcion','patients.read'), ('recepcion','patients.manage'),
    ('recepcion','messages.read'), ('recepcion','messages.respond'),
    ('asistente','clinic.read'), ('asistente','team.read'), ('asistente','schedule.read'),
    ('asistente','patients.read'), ('asistente','patients.manage'),
    ('asistente','clinical.read'), ('asistente','clinical.write'), ('asistente','inventory.read'),
    ('inventario','clinic.read'), ('inventario','team.read'),
    ('inventario','inventory.read'), ('inventario','inventory.manage'),
    ('finanzas','clinic.read'), ('finanzas','team.read'), ('finanzas','patients.read'),
    ('finanzas','finance.read'), ('finanzas','finance.manage')
  ) as p(role_code, permission_key)
    on p.role_code = r.code
  where r.tenant_id = p_tenant_id
  on conflict do nothing;

  insert into public.smyl_branches (tenant_id, name, is_default)
  values (p_tenant_id, 'Clínica principal', true)
  on conflict do nothing;

  select b.id into v_default_branch
  from public.smyl_branches b
  where b.tenant_id = p_tenant_id and b.is_default and b.active
  order by b.created_at
  limit 1;

  insert into public.smyl_member_roles (tenant_id, user_id, role_id)
  select cu.tenant_id, cu.id, r.id
  from public.camila_usuarios cu
  join public.smyl_roles r
    on r.tenant_id = cu.tenant_id
   and r.code = case when cu.rol = 'dueño' then 'propietario' else 'recepcion' end
  where cu.tenant_id = p_tenant_id and cu.activo
  on conflict do nothing;

  if v_default_branch is not null then
    insert into public.smyl_member_branches (tenant_id, user_id, branch_id, is_primary)
    select cu.tenant_id, cu.id, v_default_branch, true
    from public.camila_usuarios cu
    where cu.tenant_id = p_tenant_id and cu.activo
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.smyl_bootstrap_clinic_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.smyl_bootstrap_clinic(new.id);
  return new;
end;
$$;

-- El tenant se crea antes que su fila de camila_usuarios durante el alta.
-- Este segundo trigger completa rol y sede cuando aparece cada miembro.
create or replace function public.smyl_bootstrap_member_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.smyl_bootstrap_clinic(new.tenant_id);
  return new;
end;
$$;

drop trigger if exists smyl_bootstrap_clinic_after_tenant on public.camila_tenants;
create trigger smyl_bootstrap_clinic_after_tenant
  after insert on public.camila_tenants
  for each row execute function public.smyl_bootstrap_clinic_trigger();

drop trigger if exists smyl_bootstrap_clinic_after_member on public.camila_usuarios;
create trigger smyl_bootstrap_clinic_after_member
  after insert on public.camila_usuarios
  for each row execute function public.smyl_bootstrap_member_trigger();

-- Backfill idempotente para clínicas ya existentes.
select public.smyl_bootstrap_clinic(id) from public.camila_tenants;

-- RLS: lectura para miembros; administración según capacidades. La asignación
-- de roles queda reservada al dueño para impedir autoescalamiento de privilegios.
alter table public.smyl_roles enable row level security;
alter table public.smyl_role_permissions enable row level security;
alter table public.smyl_member_roles enable row level security;
alter table public.smyl_branches enable row level security;
alter table public.smyl_rooms enable row level security;
alter table public.smyl_clinic_hours enable row level security;
alter table public.smyl_member_branches enable row level security;
alter table public.smyl_professionals enable row level security;
alter table public.smyl_professional_branches enable row level security;
alter table public.smyl_audit_events enable row level security;

create policy smyl_roles_read on public.smyl_roles for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_roles_write_owner on public.smyl_roles for insert to authenticated
  with check (public.camila_es_dueno(tenant_id));
create policy smyl_roles_update_owner on public.smyl_roles for update to authenticated
  using (public.camila_es_dueno(tenant_id)) with check (public.camila_es_dueno(tenant_id));

create policy smyl_role_permissions_read on public.smyl_role_permissions for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_role_permissions_insert_owner on public.smyl_role_permissions for insert to authenticated
  with check (public.camila_es_dueno(tenant_id));
create policy smyl_role_permissions_delete_owner on public.smyl_role_permissions for delete to authenticated
  using (public.camila_es_dueno(tenant_id));

create policy smyl_member_roles_read on public.smyl_member_roles for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_member_roles_insert_owner on public.smyl_member_roles for insert to authenticated
  with check (public.camila_es_dueno(tenant_id));
create policy smyl_member_roles_delete_owner on public.smyl_member_roles for delete to authenticated
  using (public.camila_es_dueno(tenant_id));

create policy smyl_branches_read on public.smyl_branches for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_branches_insert on public.smyl_branches for insert to authenticated
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));
create policy smyl_branches_update on public.smyl_branches for update to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinic.manage'))
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));

create policy smyl_rooms_read on public.smyl_rooms for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_rooms_insert on public.smyl_rooms for insert to authenticated
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));
create policy smyl_rooms_update on public.smyl_rooms for update to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinic.manage'))
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));

create policy smyl_clinic_hours_read on public.smyl_clinic_hours for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_clinic_hours_insert on public.smyl_clinic_hours for insert to authenticated
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));
create policy smyl_clinic_hours_update on public.smyl_clinic_hours for update to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinic.manage'))
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));

create policy smyl_member_branches_read on public.smyl_member_branches for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_member_branches_insert on public.smyl_member_branches for insert to authenticated
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));
create policy smyl_member_branches_update on public.smyl_member_branches for update to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinic.manage'))
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));
create policy smyl_member_branches_delete on public.smyl_member_branches for delete to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinic.manage'));

create policy smyl_professionals_read on public.smyl_professionals for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_professionals_insert on public.smyl_professionals for insert to authenticated
  with check (public.smyl_has_permission(tenant_id, 'team.manage'));
create policy smyl_professionals_update on public.smyl_professionals for update to authenticated
  using (public.smyl_has_permission(tenant_id, 'team.manage'))
  with check (public.smyl_has_permission(tenant_id, 'team.manage'));

create policy smyl_professional_branches_read on public.smyl_professional_branches for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy smyl_professional_branches_insert on public.smyl_professional_branches for insert to authenticated
  with check (public.smyl_has_permission(tenant_id, 'clinic.manage'));
create policy smyl_professional_branches_delete on public.smyl_professional_branches for delete to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinic.manage'));

create policy smyl_audit_events_read on public.smyl_audit_events for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'audit.read'));

-- Grants explícitos: RLS decide qué filas puede operar cada actor.
grant select, insert, update on public.smyl_roles to authenticated;
grant select, insert, delete on public.smyl_role_permissions to authenticated;
grant select, insert, delete on public.smyl_member_roles to authenticated;
grant select, insert, update on public.smyl_branches to authenticated;
grant select, insert, update on public.smyl_rooms to authenticated;
grant select, insert, update on public.smyl_clinic_hours to authenticated;
grant select, insert, update, delete on public.smyl_member_branches to authenticated;
grant select, insert, update on public.smyl_professionals to authenticated;
grant select, insert, delete on public.smyl_professional_branches to authenticated;
grant select on public.smyl_audit_events to authenticated;

revoke insert, update, delete on public.smyl_audit_events from anon, authenticated;
revoke all on function public.smyl_bootstrap_clinic(uuid) from public, anon, authenticated;
revoke all on function public.smyl_bootstrap_clinic_trigger() from public, anon, authenticated;
revoke all on function public.smyl_bootstrap_member_trigger() from public, anon, authenticated;
revoke all on function public.smyl_touch_updated_at() from public, anon, authenticated;
revoke all on function public.smyl_audit_row() from public, anon, authenticated;
revoke all on function public.smyl_prevent_clinic_hour_overlap() from public, anon, authenticated;

-- Timestamps y auditoría se crean después del backfill para no llenar la
-- bitácora con el aprovisionamiento histórico de la propia migración.
create trigger smyl_roles_touch before update on public.smyl_roles
  for each row execute function public.smyl_touch_updated_at();
create trigger smyl_branches_touch before update on public.smyl_branches
  for each row execute function public.smyl_touch_updated_at();
create trigger smyl_rooms_touch before update on public.smyl_rooms
  for each row execute function public.smyl_touch_updated_at();
create trigger smyl_clinic_hours_touch before update on public.smyl_clinic_hours
  for each row execute function public.smyl_touch_updated_at();
create trigger smyl_professionals_touch before update on public.smyl_professionals
  for each row execute function public.smyl_touch_updated_at();

create trigger smyl_clinic_hours_no_overlap
  before insert or update of tenant_id, branch_id, weekday, starts_at, ends_at, active
  on public.smyl_clinic_hours
  for each row execute function public.smyl_prevent_clinic_hour_overlap();

create trigger smyl_roles_audit after insert or update or delete on public.smyl_roles
  for each row execute function public.smyl_audit_row();
create trigger smyl_role_permissions_audit after insert or update or delete on public.smyl_role_permissions
  for each row execute function public.smyl_audit_row();
create trigger smyl_member_roles_audit after insert or update or delete on public.smyl_member_roles
  for each row execute function public.smyl_audit_row();
create trigger smyl_branches_audit after insert or update or delete on public.smyl_branches
  for each row execute function public.smyl_audit_row();
create trigger smyl_rooms_audit after insert or update or delete on public.smyl_rooms
  for each row execute function public.smyl_audit_row();
create trigger smyl_clinic_hours_audit after insert or update or delete on public.smyl_clinic_hours
  for each row execute function public.smyl_audit_row();
create trigger smyl_member_branches_audit after insert or update or delete on public.smyl_member_branches
  for each row execute function public.smyl_audit_row();
create trigger smyl_professionals_audit after insert or update or delete on public.smyl_professionals
  for each row execute function public.smyl_audit_row();
create trigger smyl_professional_branches_audit after insert or update or delete on public.smyl_professional_branches
  for each row execute function public.smyl_audit_row();

comment on table public.smyl_branches is 'Sucursales propias de SMYL; no comparten datos con LANA.';
comment on table public.smyl_audit_events is 'Bitácora append-only del núcleo operativo de SMYL.';

commit;
