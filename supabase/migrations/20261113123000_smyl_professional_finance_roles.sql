-- SMYL · Finanzas profesionales: separación de cobros, caja y facturación.
-- Aditiva y compatible: los roles que ya gestionan cobros conservan acceso al recibir
-- los permisos especializados. Después, cada clínica puede retirarlos por rol.
begin;

-- 1. Capacidades independientes.
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
    'finance.read', 'finance.manage', 'finance.cash', 'finance.cash.supervise', 'finance.invoice', 'finance.refund',
    'catalog.manage', 'catalog.prices',
    'settings.manage'
  ));

insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
select rp.tenant_id, rp.role_id, permission.permission_key
from public.smyl_role_permissions rp
cross join (values ('finance.cash'), ('finance.cash.supervise'), ('finance.invoice')) permission(permission_key)
where rp.permission_key = 'finance.manage'
on conflict do nothing;

-- Los roles del sistema que se creen después nacen con una distribución profesional.
create or replace function public.smyl_seed_catalog_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.system_role and new.code in ('propietario', 'administrador') then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values
      (new.tenant_id, new.id, 'catalog.manage'),
      (new.tenant_id, new.id, 'catalog.prices'),
      (new.tenant_id, new.id, 'finance.refund'),
      (new.tenant_id, new.id, 'finance.cash'),
      (new.tenant_id, new.id, 'finance.cash.supervise'),
      (new.tenant_id, new.id, 'finance.invoice')
    on conflict do nothing;
  elsif new.system_role and new.code = 'finanzas' then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values
      (new.tenant_id, new.id, 'finance.refund'),
      (new.tenant_id, new.id, 'finance.cash'),
      (new.tenant_id, new.id, 'finance.cash.supervise'),
      (new.tenant_id, new.id, 'finance.invoice')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.smyl_seed_catalog_permissions() from public, anon, authenticated;

-- 2. Una caja siempre tiene responsable. El responsable opera la suya; la supervisión
-- puede cerrar o ajustar una caja ajena sin alterar la autoría original.
create or replace function public.smyl_cash_role_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;

  if tg_table_name = 'smyl_cash_sessions' then
    if tg_op = 'INSERT' then
      if new.opened_by is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'La caja debe abrirse a nombre del usuario actual.';
      end if;
      if not public.smyl_has_permission(new.tenant_id, 'finance.cash') then
        raise exception using errcode = '42501', message = 'No tienes permiso para abrir caja.';
      end if;
    else
      v_owner := old.opened_by;
      if v_owner = auth.uid() then
        if not public.smyl_has_permission(new.tenant_id, 'finance.cash') then
          raise exception using errcode = '42501', message = 'No tienes permiso para operar tu caja.';
        end if;
      elsif not public.smyl_has_permission(new.tenant_id, 'finance.cash.supervise') then
        raise exception using errcode = '42501', message = 'No tienes permiso para supervisar cajas del equipo.';
      end if;
    end if;
  elsif tg_table_name = 'smyl_cash_adjustments' then
    select s.opened_by into v_owner
    from public.smyl_cash_sessions s
    where s.tenant_id = new.tenant_id and s.id = new.cash_session_id and s.status = 'open';
    if v_owner is null then
      raise exception using errcode = '23514', message = 'La caja no está abierta.';
    end if;
    if v_owner = auth.uid() then
      if not public.smyl_has_permission(new.tenant_id, 'finance.cash') then
        raise exception using errcode = '42501', message = 'No tienes permiso para operar tu caja.';
      end if;
    elsif not public.smyl_has_permission(new.tenant_id, 'finance.cash.supervise') then
      raise exception using errcode = '42501', message = 'No tienes permiso para ajustar una caja ajena.';
    end if;
  elsif tg_table_name = 'smyl_finance_payments' and new.method = 'cash' then
    if not public.smyl_has_permission(new.tenant_id, 'finance.cash') then
      raise exception using errcode = '42501', message = 'No tienes permiso para recibir efectivo.';
    end if;
    select s.opened_by into v_owner
    from public.smyl_cash_sessions s
    where s.tenant_id = new.tenant_id and s.id = new.cash_session_id and s.status = 'open';
    if v_owner is null then
      raise exception using errcode = '23514', message = 'Abre tu caja antes de recibir efectivo.';
    end if;
    if v_owner <> auth.uid() and not public.smyl_has_permission(new.tenant_id, 'finance.cash.supervise') then
      raise exception using errcode = '42501', message = 'No puedes registrar efectivo en la caja de otra persona.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_cash_role_guard on public.smyl_cash_sessions;
create trigger smyl_cash_role_guard
  before insert or update on public.smyl_cash_sessions
  for each row execute function public.smyl_cash_role_guard();

drop trigger if exists smyl_cash_adjustment_role_guard on public.smyl_cash_adjustments;
create trigger smyl_cash_adjustment_role_guard
  before insert or update on public.smyl_cash_adjustments
  for each row execute function public.smyl_cash_role_guard();

drop trigger if exists smyl_cash_payment_role_guard on public.smyl_finance_payments;
create trigger smyl_cash_payment_role_guard
  before insert or update on public.smyl_finance_payments
  for each row execute function public.smyl_cash_role_guard();

-- 3. Facturación es una función distinta a cobrar. Cualquier alta o modificación fiscal
-- requiere permiso explícito, incluso si se ejecuta mediante una función transaccional.
create or replace function public.smyl_invoice_role_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;
  if not public.smyl_has_permission(new.tenant_id, 'finance.invoice') then
    raise exception using errcode = '42501', message = 'No tienes permiso para preparar facturas.';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_patient_fiscal_profiles_invoice_guard on public.smyl_patient_fiscal_profiles;
create trigger smyl_patient_fiscal_profiles_invoice_guard before insert or update on public.smyl_patient_fiscal_profiles
  for each row execute function public.smyl_invoice_role_guard();

drop trigger if exists smyl_issuer_fiscal_profiles_invoice_guard on public.smyl_issuer_fiscal_profiles;
create trigger smyl_issuer_fiscal_profiles_invoice_guard before insert or update on public.smyl_issuer_fiscal_profiles
  for each row execute function public.smyl_invoice_role_guard();

drop trigger if exists smyl_cfdi_pac_readiness_invoice_guard on public.smyl_cfdi_pac_readiness;
create trigger smyl_cfdi_pac_readiness_invoice_guard before insert or update on public.smyl_cfdi_pac_readiness
  for each row execute function public.smyl_invoice_role_guard();

drop trigger if exists smyl_cfdi_drafts_invoice_guard on public.smyl_cfdi_drafts;
create trigger smyl_cfdi_drafts_invoice_guard before insert or update on public.smyl_cfdi_drafts
  for each row execute function public.smyl_invoice_role_guard();

drop trigger if exists smyl_cfdi_cancellation_plans_invoice_guard on public.smyl_cfdi_cancellation_plans;
create trigger smyl_cfdi_cancellation_plans_invoice_guard before insert or update on public.smyl_cfdi_cancellation_plans
  for each row execute function public.smyl_invoice_role_guard();

commit;
