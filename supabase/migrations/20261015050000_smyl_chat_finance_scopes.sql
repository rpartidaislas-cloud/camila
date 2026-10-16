-- SMYL: enforcement de alcances configurables en Finanzas y CFDI.
begin;

create or replace function public.smyl_can_access_finance_branch(p_tenant uuid,p_branch uuid) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_scope text:=public.smyl_effective_scope(p_tenant,'finance'); v_professional uuid:=public.smyl_current_professional_id(p_tenant);
begin
  if p_tenant is null or p_branch is null then return false; end if;
  if v_scope='clinic' then return true; end if;
  if v_scope='branches' then
    return exists(select 1 from public.smyl_member_branches mb where mb.tenant_id=p_tenant and mb.user_id=auth.uid() and mb.branch_id=p_branch);
  end if;
  return v_professional is not null and exists(
    select 1 from public.smyl_professional_branches pb
    where pb.tenant_id=p_tenant and pb.professional_id=v_professional and pb.branch_id=p_branch
  );
end $$;

create or replace function public.smyl_can_access_finance_patient(p_tenant uuid,p_patient uuid,p_branch uuid default null) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_scope text:=public.smyl_effective_scope(p_tenant,'finance');
begin
  if p_tenant is null or p_patient is null then return false; end if;
  if v_scope='clinic' then return true; end if;
  if v_scope='branches' then
    if p_branch is not null and public.smyl_can_access_finance_branch(p_tenant,p_branch) then return true; end if;
    return exists(
      select 1 from public.smyl_appointments a
      join public.smyl_member_branches mb on mb.tenant_id=a.tenant_id and mb.branch_id=a.branch_id and mb.user_id=auth.uid()
      where a.tenant_id=p_tenant and a.patient_id=p_patient
    );
  end if;
  return public.smyl_can_access_patient(p_tenant,p_patient,'finance');
end $$;

drop policy if exists smyl_finance_sequences_read on public.smyl_finance_sequences;
create policy smyl_finance_sequences_read on public.smyl_finance_sequences for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_effective_scope(tenant_id,'finance')='clinic');

drop policy if exists smyl_finance_charges_read on public.smyl_finance_charges;
create policy smyl_finance_charges_read on public.smyl_finance_charges for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_can_access_finance_patient(tenant_id,patient_id,branch_id));
drop policy if exists smyl_finance_payments_read on public.smyl_finance_payments;
create policy smyl_finance_payments_read on public.smyl_finance_payments for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_can_access_finance_patient(tenant_id,patient_id,branch_id));
drop policy if exists smyl_patient_fiscal_profiles_read on public.smyl_patient_fiscal_profiles;
create policy smyl_patient_fiscal_profiles_read on public.smyl_patient_fiscal_profiles for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_can_access_finance_patient(tenant_id,patient_id,null));
drop policy if exists smyl_cfdi_drafts_read on public.smyl_cfdi_drafts;
create policy smyl_cfdi_drafts_read on public.smyl_cfdi_drafts for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_can_access_finance_patient(tenant_id,patient_id,null));
drop policy if exists smyl_cash_sessions_read on public.smyl_cash_sessions;
create policy smyl_cash_sessions_read on public.smyl_cash_sessions for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_can_access_finance_branch(tenant_id,branch_id));

drop policy if exists smyl_finance_payment_allocations_read on public.smyl_finance_payment_allocations;
create policy smyl_finance_payment_allocations_read on public.smyl_finance_payment_allocations for select to authenticated using(
  public.smyl_has_permission(tenant_id,'finance.read') and exists(
    select 1 from public.smyl_finance_payments p where p.tenant_id=smyl_finance_payment_allocations.tenant_id and p.id=smyl_finance_payment_allocations.payment_id
      and public.smyl_can_access_finance_patient(p.tenant_id,p.patient_id,p.branch_id)
  )
);
drop policy if exists smyl_finance_refunds_read on public.smyl_finance_refunds;
create policy smyl_finance_refunds_read on public.smyl_finance_refunds for select to authenticated using(
  public.smyl_has_permission(tenant_id,'finance.read') and exists(
    select 1 from public.smyl_finance_payments p where p.tenant_id=smyl_finance_refunds.tenant_id and p.id=smyl_finance_refunds.payment_id
      and public.smyl_can_access_finance_patient(p.tenant_id,p.patient_id,p.branch_id)
  )
);
drop policy if exists smyl_finance_refund_allocations_read on public.smyl_finance_refund_allocations;
create policy smyl_finance_refund_allocations_read on public.smyl_finance_refund_allocations for select to authenticated using(
  public.smyl_has_permission(tenant_id,'finance.read') and exists(
    select 1 from public.smyl_finance_charges c where c.tenant_id=smyl_finance_refund_allocations.tenant_id and c.id=smyl_finance_refund_allocations.charge_id
      and public.smyl_can_access_finance_patient(c.tenant_id,c.patient_id,c.branch_id)
  )
);
drop policy if exists smyl_cash_adjustments_read on public.smyl_cash_adjustments;
create policy smyl_cash_adjustments_read on public.smyl_cash_adjustments for select to authenticated using(
  public.smyl_has_permission(tenant_id,'finance.read') and exists(
    select 1 from public.smyl_cash_sessions s where s.tenant_id=smyl_cash_adjustments.tenant_id and s.id=smyl_cash_adjustments.cash_session_id
      and public.smyl_can_access_finance_branch(s.tenant_id,s.branch_id)
  )
);
drop policy if exists smyl_finance_receipts_read on public.smyl_finance_receipts;
create policy smyl_finance_receipts_read on public.smyl_finance_receipts for select to authenticated using(
  public.smyl_has_permission(tenant_id,'finance.read') and exists(
    select 1 from public.smyl_finance_payments p where p.tenant_id=smyl_finance_receipts.tenant_id and p.id=smyl_finance_receipts.payment_id
      and public.smyl_can_access_finance_patient(p.tenant_id,p.patient_id,p.branch_id)
  )
);

drop policy if exists smyl_proposal_charge_batches_read on public.smyl_proposal_charge_batches;
create policy smyl_proposal_charge_batches_read on public.smyl_proposal_charge_batches for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_can_access_finance_patient(tenant_id,patient_id,branch_id));
drop policy if exists smyl_issuer_fiscal_profiles_read on public.smyl_issuer_fiscal_profiles;
create policy smyl_issuer_fiscal_profiles_read on public.smyl_issuer_fiscal_profiles for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_effective_scope(tenant_id,'finance')='clinic');
drop policy if exists smyl_cfdi_pac_readiness_read on public.smyl_cfdi_pac_readiness;
create policy smyl_cfdi_pac_readiness_read on public.smyl_cfdi_pac_readiness for select to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.read') and public.smyl_effective_scope(tenant_id,'finance')='clinic');
drop policy if exists smyl_cfdi_cancellation_plans_read on public.smyl_cfdi_cancellation_plans;
create policy smyl_cfdi_cancellation_plans_read on public.smyl_cfdi_cancellation_plans for select to authenticated using(
  public.smyl_has_permission(tenant_id,'finance.read') and exists(
    select 1 from public.smyl_cfdi_drafts d where d.tenant_id=smyl_cfdi_cancellation_plans.tenant_id and d.id=smyl_cfdi_cancellation_plans.draft_id
      and public.smyl_can_access_finance_patient(d.tenant_id,d.patient_id,null)
  )
);

drop policy if exists smyl_patient_fiscal_profiles_manage on public.smyl_patient_fiscal_profiles;
create policy smyl_patient_fiscal_profiles_manage on public.smyl_patient_fiscal_profiles for all to authenticated
  using(public.smyl_has_permission(tenant_id,'finance.manage') and public.smyl_can_access_finance_patient(tenant_id,patient_id,null))
  with check(tenant_id=public.smyl_current_tenant() and public.smyl_has_permission(tenant_id,'finance.manage') and public.smyl_can_access_finance_patient(tenant_id,patient_id,null));

create or replace function public.smyl_guard_finance_scope_write() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_patient uuid; v_branch uuid;
begin
  if auth.role()='service_role' then return new; end if;
  if tg_table_name in ('smyl_finance_charges','smyl_finance_payments','smyl_proposal_charge_batches') then
    v_patient:=new.patient_id; v_branch:=new.branch_id;
  elsif tg_table_name in ('smyl_patient_fiscal_profiles','smyl_cfdi_drafts') then
    v_patient:=new.patient_id;
  elsif tg_table_name='smyl_cash_sessions' then
    v_branch:=new.branch_id;
  elsif tg_table_name in ('smyl_finance_payment_allocations','smyl_finance_refunds','smyl_finance_receipts') then
    select p.patient_id,p.branch_id into v_patient,v_branch from public.smyl_finance_payments p
    where p.tenant_id=new.tenant_id and p.id=new.payment_id;
  elsif tg_table_name='smyl_finance_refund_allocations' then
    select c.patient_id,c.branch_id into v_patient,v_branch from public.smyl_finance_charges c
    where c.tenant_id=new.tenant_id and c.id=new.charge_id;
  elsif tg_table_name='smyl_cash_adjustments' then
    select s.branch_id into v_branch from public.smyl_cash_sessions s
    where s.tenant_id=new.tenant_id and s.id=new.cash_session_id;
  elsif tg_table_name='smyl_cfdi_cancellation_plans' then
    select d.patient_id into v_patient from public.smyl_cfdi_drafts d
    where d.tenant_id=new.tenant_id and d.id=new.draft_id;
  elsif tg_table_name in ('smyl_finance_sequences','smyl_issuer_fiscal_profiles','smyl_cfdi_pac_readiness') then
    if public.smyl_effective_scope(new.tenant_id,'finance')<>'clinic' then
      raise exception using errcode='42501',message='La configuración financiera global requiere alcance de toda la clínica.';
    end if;
  end if;
  if v_patient is not null and not public.smyl_can_access_finance_patient(new.tenant_id,v_patient,v_branch) then
    raise exception using errcode='42501',message='El movimiento queda fuera del alcance financiero de tu rol.';
  end if;
  if v_patient is null and v_branch is not null and not public.smyl_can_access_finance_branch(new.tenant_id,v_branch) then
    raise exception using errcode='42501',message='La caja queda fuera del alcance financiero de tu rol.';
  end if;
  return new;
end $$;

create trigger smyl_finance_charges_scope_guard before insert or update on public.smyl_finance_charges for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_finance_payments_scope_guard before insert or update on public.smyl_finance_payments for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_patient_fiscal_profiles_scope_guard before insert or update on public.smyl_patient_fiscal_profiles for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_cfdi_drafts_scope_guard before insert or update on public.smyl_cfdi_drafts for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_cash_sessions_scope_guard before insert or update on public.smyl_cash_sessions for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_proposal_charge_batches_scope_guard before insert or update on public.smyl_proposal_charge_batches for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_finance_sequences_scope_guard before insert or update on public.smyl_finance_sequences for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_finance_payment_allocations_scope_guard before insert or update on public.smyl_finance_payment_allocations for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_finance_refunds_scope_guard before insert or update on public.smyl_finance_refunds for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_finance_refund_allocations_scope_guard before insert or update on public.smyl_finance_refund_allocations for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_cash_adjustments_scope_guard before insert or update on public.smyl_cash_adjustments for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_finance_receipts_scope_guard before insert or update on public.smyl_finance_receipts for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_issuer_fiscal_profiles_scope_guard before insert or update on public.smyl_issuer_fiscal_profiles for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_cfdi_pac_readiness_scope_guard before insert or update on public.smyl_cfdi_pac_readiness for each row execute function public.smyl_guard_finance_scope_write();
create trigger smyl_cfdi_cancellation_plans_scope_guard before insert or update on public.smyl_cfdi_cancellation_plans for each row execute function public.smyl_guard_finance_scope_write();

commit;
