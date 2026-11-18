-- SMYL · Varios consultorios (sucursales) administrados de forma independiente — Fase 1: modelo de acceso.
--
-- Hoy los permisos son por clínica completa: quien puede «cobrar» puede cobrar en todas las sedes. Esta migración agrega el
-- ALCANCE (en cuáles consultorios) sin tocar todavía las políticas de las tablas operativas (eso es la Fase 3):
--   * permiso `branches.all` = administrador global: ve y administra todos los consultorios y la vista Global. Lo reciben el
--     propietario y el administrador (roles de sistema); se puede asignar a cualquier otro rol desde Equipo. El dueño de la
--     cuenta ya cumple todos los permisos por definición de smyl_has_permission.
--   * smyl_member_branches (ya existía) pasa a ser el alcance: quien no tiene `branches.all` solo accede a las sedes donde esté.
--   * smyl_branch_access(tenant, sede): ¿puede esta sesión operar esa sede?
--   * smyl_my_branches(): los consultorios que esta sesión puede elegir en el selector de la barra lateral.
-- Aditiva e idempotente. Una clínica con una sola sede no cambia.
begin;

-- 1. Permiso nuevo ------------------------------------------------------------------------------------------------------
alter table public.smyl_role_permissions drop constraint if exists smyl_role_permissions_permission_key_check;
alter table public.smyl_role_permissions add constraint smyl_role_permissions_permission_key_check check (permission_key in (
  'clinic.read', 'clinic.manage',
  'team.read', 'team.manage', 'audit.read',
  'schedule.read', 'schedule.manage',
  'patients.read', 'patients.manage',
  'clinical.read', 'clinical.write', 'clinical.approve',
  'proposal.read', 'proposal.write', 'proposal.approve', 'proposal.followup',
  'messages.read', 'messages.respond', 'messages.manage',
  'inventory.read', 'inventory.manage', 'inventory.consume', 'inventory.adjust', 'inventory.purchase',
  'finance.read', 'finance.manage', 'finance.cash', 'finance.cash.supervise', 'finance.invoice', 'finance.refund',
  'catalog.manage', 'catalog.prices',
  'settings.manage',
  'cloud.read', 'cloud.upload', 'cloud.manage', 'cloud.share',
  'branches.all'
));

insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'branches.all'
from public.smyl_roles r
where r.system_role and r.code in ('propietario', 'administrador')
on conflict do nothing;

create or replace function public.smyl_seed_branches_all_permission()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.system_role and new.code in ('propietario', 'administrador') then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values (new.tenant_id, new.id, 'branches.all') on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.smyl_seed_branches_all_permission() from public, anon, authenticated;
drop trigger if exists smyl_roles_seed_branches_all_permission on public.smyl_roles;
create trigger smyl_roles_seed_branches_all_permission after insert on public.smyl_roles
for each row execute function public.smyl_seed_branches_all_permission();

-- 2. Alcance de cada persona ---------------------------------------------------------------------------------------------
-- Quien ya trabaja en la clínica pero no figura en ninguna sede queda en la sede predeterminada (o la más antigua), para no
-- dejarlo sin acceso cuando la Fase 3 empiece a exigir la sede. Quien tiene `branches.all` no depende de estas filas.
insert into public.smyl_member_branches (tenant_id, user_id, branch_id, is_primary)
select cu.tenant_id, cu.id,
       (select b.id from public.smyl_branches b where b.tenant_id = cu.tenant_id and b.active
        order by b.is_default desc, b.created_at, b.id limit 1),
       true
from public.camila_usuarios cu
where cu.activo
  and not exists (select 1 from public.smyl_member_branches mb where mb.tenant_id = cu.tenant_id and mb.user_id = cu.id)
  and exists (select 1 from public.smyl_branches b where b.tenant_id = cu.tenant_id and b.active)
on conflict do nothing;

-- 3. Funciones de consulta -----------------------------------------------------------------------------------------------
create or replace function public.smyl_branch_access(p_tenant_id uuid, p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
           select 1 from public.smyl_branches b
           where b.tenant_id = p_tenant_id and b.id = p_branch_id and b.active
         )
     and (
           public.smyl_has_permission(p_tenant_id, 'branches.all')
        or exists (
             select 1 from public.smyl_member_branches mb
             join public.camila_usuarios cu on cu.tenant_id = mb.tenant_id and cu.id = mb.user_id
             where mb.tenant_id = p_tenant_id and mb.branch_id = p_branch_id
               and mb.user_id = auth.uid() and cu.activo
           )
         );
$$;

-- Consultorios que esta sesión puede elegir. `can_all` indica si además puede ver la vista Global.
create or replace function public.smyl_my_branches()
returns table (branch_id uuid, name text, is_default boolean, is_primary boolean, can_all boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with ctx as (
    select public.smyl_current_tenant() as tenant_id
  ), perm as (
    select ctx.tenant_id, coalesce(public.smyl_has_permission(ctx.tenant_id, 'branches.all'), false) as can_all from ctx
  )
  select b.id, b.name, b.is_default, coalesce(mb.is_primary, false), perm.can_all
  from perm
  join public.smyl_branches b on b.tenant_id = perm.tenant_id and b.active
  left join public.smyl_member_branches mb on mb.tenant_id = b.tenant_id and mb.branch_id = b.id and mb.user_id = auth.uid()
  where perm.tenant_id is not null and (perm.can_all or mb.user_id is not null)
  order by b.is_default desc, b.name;
$$;

revoke all on function public.smyl_branch_access(uuid, uuid) from public, anon;
revoke all on function public.smyl_my_branches() from public, anon;
grant execute on function public.smyl_branch_access(uuid, uuid) to authenticated;
grant execute on function public.smyl_my_branches() to authenticated;

commit;
