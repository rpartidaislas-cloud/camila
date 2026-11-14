-- SMYL · Roles: quién puede reembolsar pagos y cancelar cargos.
-- Aditiva y sin pérdida de acceso: los roles que hoy gestionan cobros (`finance.manage`) reciben la función nueva,
-- así que nadie queda bloqueado al aplicarla. A partir de aquí la clínica puede quitarla (p. ej. a Recepción) desde
-- Mi clínica > Equipo > Editar rol.
--   finance.refund  Reembolsar y cancelar cargos: devolver dinero de un pago y anular un cargo.
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
    'finance.read', 'finance.manage', 'finance.refund',
    'catalog.manage', 'catalog.prices',
    'settings.manage'
  ));

-- 2. Sin pérdida de acceso: cada rol que hoy tiene `finance.manage` recibe la función nueva.
insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
select rp.tenant_id, rp.role_id, 'finance.refund'
from public.smyl_role_permissions rp
where rp.permission_key = 'finance.manage'
on conflict do nothing;

-- 3. Clínicas nuevas: Propietario y Administrador nacen con la función (se suma al disparador de catálogo).
create or replace function public.smyl_seed_catalog_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.system_role and new.code in ('propietario', 'administrador') then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values (new.tenant_id, new.id, 'catalog.manage'), (new.tenant_id, new.id, 'catalog.prices'),
           (new.tenant_id, new.id, 'finance.refund')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.smyl_seed_catalog_permissions() from public, anon, authenticated;

-- 4. Reembolsar y cancelar cargos exigen `finance.refund`. Las funciones de cobro (smyl_refund_payment y
--    smyl_void_charge) se mantienen; estos disparadores añaden la regla sin reescribirlas. Sin sesión de usuario
--    (consola SQL, funciones de servicio y migraciones) no se bloquea.
create or replace function public.smyl_finance_refund_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not public.smyl_has_permission(new.tenant_id, 'finance.refund') then
    raise exception using errcode = '42501', message = 'No tienes permiso para reembolsar pagos.';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_finance_refund_guard on public.smyl_finance_refunds;
create trigger smyl_finance_refund_guard
  before insert on public.smyl_finance_refunds
  for each row execute function public.smyl_finance_refund_guard();

create or replace function public.smyl_finance_void_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.status = 'voided' and old.status is distinct from 'voided'
     and not public.smyl_has_permission(new.tenant_id, 'finance.refund') then
    raise exception using errcode = '42501', message = 'No tienes permiso para cancelar cargos.';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_finance_void_guard on public.smyl_finance_charges;
create trigger smyl_finance_void_guard
  before update on public.smyl_finance_charges
  for each row execute function public.smyl_finance_void_guard();

commit;
