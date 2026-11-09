-- SMYL · Roles: quién gestiona los servicios y quién puede cambiar precios.
-- Aditiva y sin pérdida de acceso: los roles que hoy administran la configuración (`settings.manage`)
-- reciben ambas funciones nuevas, así que nadie queda bloqueado al aplicarla. A partir de aquí la clínica
-- puede quitar «Cambiar precios» a cualquier rol desde Mi clínica > Equipo > Editar rol.
--   catalog.manage  Gestionar servicios: crear, activar/desactivar y editar nombre, duración, especialidad y claves.
--   catalog.prices  Cambiar precios: definir o modificar el precio de referencia de un servicio.
begin;

-- 1. Claves de permiso permitidas.
alter table public.smyl_role_permissions
  drop constraint if exists smyl_role_permissions_permission_key_check;
alter table public.smyl_role_permissions
  add constraint smyl_role_permissions_permission_key_check check (permission_key in (
    'clinic.read', 'clinic.manage',
    'team.read', 'team.manage', 'audit.read',
    'schedule.read', 'schedule.manage',
    'patients.read', 'patients.manage',
    'clinical.read', 'clinical.write', 'clinical.approve',
    'proposal.read', 'proposal.write', 'proposal.approve', 'proposal.followup',
    'messages.read', 'messages.respond', 'messages.manage',
    'inventory.read', 'inventory.manage',
    'finance.read', 'finance.manage',
    'catalog.manage', 'catalog.prices',
    'settings.manage'
  ));

-- 2. Sin pérdida de acceso: cada rol que hoy tiene `settings.manage` recibe las dos funciones nuevas.
insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
select rp.tenant_id, rp.role_id, k.permission_key
from public.smyl_role_permissions rp
cross join (values ('catalog.manage'), ('catalog.prices')) as k(permission_key)
where rp.permission_key = 'settings.manage'
on conflict do nothing;

-- 3. Clínicas nuevas: Propietario y Administrador nacen con las dos funciones (el alta de roles del sistema
--    la hace `smyl_bootstrap_clinic`; este disparador las completa sin tocar esa función).
create or replace function public.smyl_seed_catalog_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.system_role and new.code in ('propietario', 'administrador') then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values (new.tenant_id, new.id, 'catalog.manage'), (new.tenant_id, new.id, 'catalog.prices')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_roles_seed_catalog_permissions on public.smyl_roles;
create trigger smyl_roles_seed_catalog_permissions
  after insert on public.smyl_roles
  for each row execute function public.smyl_seed_catalog_permissions();

revoke all on function public.smyl_seed_catalog_permissions() from public, anon, authenticated;

-- 4. Políticas: gestionar servicios ya no exige la administración completa de la configuración.
drop policy if exists smyl_services_read on public.smyl_services;
drop policy if exists smyl_services_manage on public.smyl_services;
create policy smyl_services_read on public.smyl_services for select to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'schedule.read')
    or public.smyl_has_permission(tenant_id, 'settings.manage')
    or public.smyl_has_permission(tenant_id, 'catalog.manage')
  );
create policy smyl_services_manage on public.smyl_services for all to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'settings.manage')
    or public.smyl_has_permission(tenant_id, 'catalog.manage')
  )
  with check (
    tenant_id = public.smyl_current_tenant()
    and (
      public.smyl_has_permission(tenant_id, 'settings.manage')
      or public.smyl_has_permission(tenant_id, 'catalog.manage')
    )
  );

drop policy if exists smyl_service_versions_read on public.smyl_service_versions;
create policy smyl_service_versions_read on public.smyl_service_versions for select to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'schedule.read')
    or public.smyl_has_permission(tenant_id, 'settings.manage')
    or public.smyl_has_permission(tenant_id, 'catalog.manage')
  );

-- 5. El precio solo lo cambia quien tiene `catalog.prices` (una política de filas no puede limitar una columna,
--    por eso se guarda con un disparador). Sin sesión de usuario (consola SQL, funciones de servicio y migraciones)
--    no se bloquea.
create or replace function public.smyl_services_price_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.reference_price is not null
       and not public.smyl_has_permission(new.tenant_id, 'catalog.prices') then
      raise exception using errcode = '42501', message = 'No tienes permiso para definir precios.';
    end if;
  elsif new.reference_price is distinct from old.reference_price
        and not public.smyl_has_permission(new.tenant_id, 'catalog.prices') then
    raise exception using errcode = '42501', message = 'No tienes permiso para cambiar precios.';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_services_price_guard on public.smyl_services;
create trigger smyl_services_price_guard
  before insert or update on public.smyl_services
  for each row execute function public.smyl_services_price_guard();

commit;
