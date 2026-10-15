-- SMYL · Etapa 1: acciones atómicas del núcleo de clínica.

begin;

-- Toda clínica activa conserva una sede predeterminada. Al ser diferido,
-- permite cambiar de sede dentro de una misma transacción sin violar el
-- índice único parcial de smyl_branches.
create or replace function public.smyl_require_default_branch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  if exists (
    select 1 from public.camila_tenants ct
    where ct.id = v_tenant_id and ct.activo
  ) and not exists (
    select 1 from public.smyl_branches b
    where b.tenant_id = v_tenant_id and b.active and b.is_default
  ) then
    raise exception using
      errcode = '23514',
      message = 'La clínica debe conservar una sucursal predeterminada activa.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_branches_require_default on public.smyl_branches;
create constraint trigger smyl_branches_require_default
  after insert or update or delete on public.smyl_branches
  deferrable initially deferred
  for each row execute function public.smyl_require_default_branch();

create or replace function public.smyl_set_default_branch(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.smyl_current_tenant();
begin
  if v_tenant_id is null
     or not public.smyl_has_permission(v_tenant_id, 'clinic.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar sucursales.';
  end if;

  if not exists (
    select 1 from public.smyl_branches b
    where b.id = p_branch_id and b.tenant_id = v_tenant_id and b.active
  ) then
    raise exception using errcode = 'P0002', message = 'La sucursal no existe o está inactiva.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text || ':default-branch', 0));

  update public.smyl_branches
  set is_default = false
  where tenant_id = v_tenant_id and is_default and id <> p_branch_id;

  update public.smyl_branches
  set is_default = true, active = true
  where tenant_id = v_tenant_id and id = p_branch_id;
end;
$$;

create or replace function public.smyl_set_member_role(
  p_user_id uuid,
  p_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.smyl_current_tenant();
  v_legacy_role text;
  v_role_code text;
begin
  if v_tenant_id is null or not public.camila_es_dueno(v_tenant_id) then
    raise exception using errcode = '42501', message = 'Solo el propietario puede asignar roles.';
  end if;

  select cu.rol into v_legacy_role
  from public.camila_usuarios cu
  where cu.id = p_user_id and cu.tenant_id = v_tenant_id and cu.activo
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'El integrante no existe o está inactivo.';
  end if;

  select r.code into v_role_code
  from public.smyl_roles r
  where r.id = p_role_id and r.tenant_id = v_tenant_id and r.active;

  if not found then
    raise exception using errcode = 'P0002', message = 'El rol no existe o está inactivo.';
  end if;

  if v_legacy_role = 'dueño' and v_role_code <> 'propietario' then
    raise exception using errcode = '23514', message = 'El propietario conserva el rol Propietario.';
  end if;

  if v_legacy_role <> 'dueño' and v_role_code = 'propietario' then
    raise exception using errcode = '23514', message = 'El rol Propietario no puede asignarse a personal.';
  end if;

  delete from public.smyl_member_roles
  where tenant_id = v_tenant_id and user_id = p_user_id;

  insert into public.smyl_member_roles (tenant_id, user_id, role_id, assigned_by)
  values (v_tenant_id, p_user_id, p_role_id, auth.uid());
end;
$$;

create or replace function public.smyl_set_member_primary_branch(
  p_user_id uuid,
  p_branch_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.smyl_current_tenant();
begin
  if v_tenant_id is null
     or not public.smyl_has_permission(v_tenant_id, 'clinic.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para asignar sedes.';
  end if;

  if not exists (
    select 1 from public.camila_usuarios cu
    where cu.id = p_user_id and cu.tenant_id = v_tenant_id and cu.activo
  ) then
    raise exception using errcode = 'P0002', message = 'El integrante no existe o está inactivo.';
  end if;

  if not exists (
    select 1 from public.smyl_branches b
    where b.id = p_branch_id and b.tenant_id = v_tenant_id and b.active
  ) then
    raise exception using errcode = 'P0002', message = 'La sucursal no existe o está inactiva.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || p_user_id::text || ':primary-branch', 0)
  );

  update public.smyl_member_branches
  set is_primary = false
  where tenant_id = v_tenant_id and user_id = p_user_id and is_primary;

  insert into public.smyl_member_branches (
    tenant_id, user_id, branch_id, is_primary, assigned_by
  ) values (
    v_tenant_id, p_user_id, p_branch_id, true, auth.uid()
  )
  on conflict (tenant_id, user_id, branch_id)
  do update set is_primary = true, assigned_by = excluded.assigned_by, assigned_at = now();
end;
$$;

revoke all on function public.smyl_require_default_branch() from public, anon, authenticated;
revoke all on function public.smyl_set_default_branch(uuid) from public, anon;
revoke all on function public.smyl_set_member_role(uuid, uuid) from public, anon;
revoke all on function public.smyl_set_member_primary_branch(uuid, uuid) from public, anon;

grant execute on function public.smyl_set_default_branch(uuid) to authenticated;
grant execute on function public.smyl_set_member_role(uuid, uuid) to authenticated;
grant execute on function public.smyl_set_member_primary_branch(uuid, uuid) to authenticated;

comment on function public.smyl_set_member_role(uuid, uuid)
  is 'Asigna un único rol operativo de SMYL sin permitir autoescalamiento.';
comment on function public.smyl_set_member_primary_branch(uuid, uuid)
  is 'Cambia la sede principal de un integrante dentro de una sola transacción.';

commit;
