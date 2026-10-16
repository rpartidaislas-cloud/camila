-- SMYL: roles editables por funciones, sin perfiles rígidos.
-- La interfaz nunca escribe permisos directamente: estas funciones evitan
-- autoescalamiento y protegen el rol propietario.
begin;

create or replace function public.smyl_save_role(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_active boolean,
  p_permissions text[]
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_role public.smyl_roles;
  v_role_id uuid;
  v_owner boolean;
  v_code text;
  v_permission text;
begin
  select exists(
    select 1 from public.camila_usuarios u
    where u.id = auth.uid() and u.tenant_id = v_tenant and u.activo and u.rol = 'dueño'
  ) into v_owner;

  if v_tenant is null or (not v_owner and not public.smyl_has_permission(v_tenant, 'team.manage')) then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar roles.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'El nombre del rol debe tener entre 2 y 80 caracteres.';
  end if;
  if char_length(coalesce(p_description, '')) > 240 then
    raise exception using errcode = '22023', message = 'La descripción es demasiado larga.';
  end if;

  foreach v_permission in array coalesce(p_permissions, array[]::text[]) loop
    if not v_owner and not public.smyl_has_permission(v_tenant, v_permission) then
      raise exception using errcode = '42501', message = 'No puedes conceder una función que no tienes.';
    end if;
  end loop;

  if p_role_id is not null then
    select * into v_role from public.smyl_roles
    where id = p_role_id and tenant_id = v_tenant for update;
    if not found then raise exception using errcode = 'P0002', message = 'El rol no existe.'; end if;
    if v_role.code = 'propietario' then
      raise exception using errcode = '42501', message = 'El rol Propietario está protegido.';
    end if;
    update public.smyl_roles
      set name = btrim(p_name), description = btrim(coalesce(p_description, '')),
          active = coalesce(p_active, true)
      where id = v_role.id and tenant_id = v_tenant;
    v_role_id := v_role.id;
  else
    v_code := 'personalizado_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    insert into public.smyl_roles(tenant_id, code, name, description, system_role, active)
    values(v_tenant, v_code, btrim(p_name), btrim(coalesce(p_description, '')), false, coalesce(p_active, true))
    returning id into v_role_id;
  end if;

  delete from public.smyl_role_permissions
  where tenant_id = v_tenant and role_id = v_role_id;

  insert into public.smyl_role_permissions(tenant_id, role_id, permission_key)
  select v_tenant, v_role_id, permission_key
  from unnest(coalesce(p_permissions, array[]::text[])) permission_key
  where permission_key is not null
  group by permission_key;

  return v_role_id;
end;
$$;

revoke all on function public.smyl_save_role(uuid,text,text,boolean,text[]) from public, anon;
grant execute on function public.smyl_save_role(uuid,text,text,boolean,text[]) to authenticated;

create or replace function public.smyl_set_member_role(p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.smyl_current_tenant();
  v_legacy_role text;
  v_role_code text;
  v_owner boolean;
  v_missing_permission boolean;
begin
  select exists(
    select 1 from public.camila_usuarios u
    where u.id = auth.uid() and u.tenant_id = v_tenant_id and u.activo and u.rol = 'dueño'
  ) into v_owner;
  if v_tenant_id is null or (not v_owner and not public.smyl_has_permission(v_tenant_id, 'team.manage')) then
    raise exception using errcode = '42501', message = 'No tienes permiso para asignar roles.';
  end if;

  select cu.rol into v_legacy_role from public.camila_usuarios cu
  where cu.id = p_user_id and cu.tenant_id = v_tenant_id and cu.activo;
  if not found then raise exception using errcode = 'P0002', message = 'El integrante no existe o está inactivo.'; end if;

  select r.code into v_role_code from public.smyl_roles r
  where r.id = p_role_id and r.tenant_id = v_tenant_id and r.active;
  if not found then raise exception using errcode = 'P0002', message = 'El rol no existe o está inactivo.'; end if;
  if v_legacy_role = 'dueño' or v_role_code = 'propietario' then
    raise exception using errcode = '42501', message = 'El rol Propietario está protegido.';
  end if;

  if not v_owner then
    select exists(
      select 1 from public.smyl_role_permissions rp
      where rp.tenant_id = v_tenant_id and rp.role_id = p_role_id
        and not public.smyl_has_permission(v_tenant_id, rp.permission_key)
    ) into v_missing_permission;
    if v_missing_permission then
      raise exception using errcode = '42501', message = 'Ese rol contiene funciones que no puedes conceder.';
    end if;
  end if;

  delete from public.smyl_member_roles where tenant_id = v_tenant_id and user_id = p_user_id;
  insert into public.smyl_member_roles(tenant_id, user_id, role_id, assigned_by)
  values(v_tenant_id, p_user_id, p_role_id, auth.uid());
end;
$$;

revoke all on function public.smyl_set_member_role(uuid,uuid) from public, anon;
grant execute on function public.smyl_set_member_role(uuid,uuid) to authenticated;

comment on function public.smyl_save_role(uuid,text,text,boolean,text[])
  is 'Crea o actualiza un rol configurable y reemplaza sus funciones sin permitir autoescalamiento.';

commit;
