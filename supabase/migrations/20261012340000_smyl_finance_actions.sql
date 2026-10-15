-- SMYL · Etapa 5: acciones financieras transaccionales e idempotentes.
begin;

create or replace function public.smyl_post_charge(p_id uuid,p_idempotency_key uuid,p_patient_id uuid,p_branch_id uuid,p_appointment_id uuid,p_service_id uuid,p_proposal_id uuid,p_concept text,p_quantity numeric,p_unit_price numeric,p_discount_amount numeric default 0,p_tax_amount numeric default 0,p_due_on date default null)
returns public.smyl_finance_charges language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_finance_charges; v_total numeric(12,2);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para registrar cargos.'; end if;
  select * into v_row from public.smyl_finance_charges where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then return v_row; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='23503',message='Paciente no disponible.'; end if;
  if p_appointment_id is not null and not exists(select 1 from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id and patient_id=p_patient_id) then raise exception using errcode='23514',message='La cita no pertenece al paciente.'; end if;
  v_total:=round(p_quantity*p_unit_price-coalesce(p_discount_amount,0)+coalesce(p_tax_amount,0),2);
  if p_quantity<=0 or p_unit_price<0 or coalesce(p_discount_amount,0)<0 or coalesce(p_tax_amount,0)<0 or v_total<=0 then raise exception using errcode='22003',message='Importes inválidos.'; end if;
  insert into public.smyl_finance_charges(id,tenant_id,patient_id,branch_id,appointment_id,service_id,proposal_id,idempotency_key,concept,quantity,unit_price,discount_amount,tax_amount,total_amount,due_on,created_by)
  values(p_id,v_tenant,p_patient_id,p_branch_id,p_appointment_id,p_service_id,p_proposal_id,p_idempotency_key,btrim(p_concept),p_quantity,p_unit_price,coalesce(p_discount_amount,0),coalesce(p_tax_amount,0),v_total,p_due_on,auth.uid()) returning * into v_row;
  return v_row;
end $$;

create or replace function public.smyl_void_charge(p_charge_id uuid,p_reason text)
returns public.smyl_finance_charges language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_finance_charges;
begin
  if not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso.'; end if;
  select * into v_row from public.smyl_finance_charges where tenant_id=v_tenant and id=p_charge_id for update;
  if not found then raise exception using errcode='P0002',message='Cargo no encontrado.'; end if;
  if v_row.status='voided' then return v_row; end if;
  if exists(select 1 from public.smyl_finance_payment_allocations where tenant_id=v_tenant and charge_id=p_charge_id) then raise exception using errcode='23514',message='El cargo tiene pagos; primero registra el reembolso correspondiente.'; end if;
  update public.smyl_finance_charges set status='voided',void_reason=btrim(p_reason),voided_by=auth.uid(),voided_at=now() where tenant_id=v_tenant and id=p_charge_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.smyl_open_cash_session(p_id uuid,p_branch_id uuid,p_opening_cash numeric)
returns public.smyl_cash_sessions language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_cash_sessions;
begin
  if not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso.'; end if;
  if p_opening_cash<0 then raise exception using errcode='22003',message='Fondo inicial inválido.'; end if;
  insert into public.smyl_cash_sessions(id,tenant_id,branch_id,opened_by,opening_cash) values(p_id,v_tenant,p_branch_id,auth.uid(),p_opening_cash) returning * into v_row;
  return v_row;
exception when unique_violation then raise exception using errcode='23505',message='Ya tienes una caja abierta en esta sucursal.';
end $$;

create or replace function public.smyl_post_payment(p_id uuid,p_idempotency_key uuid,p_patient_id uuid,p_branch_id uuid,p_cash_session_id uuid,p_amount numeric,p_method text,p_reference text,p_paid_at timestamptz,p_allocations jsonb)
returns public.smyl_finance_payments language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_finance_payments; v_item jsonb; v_sum numeric:=0; v_open numeric; v_folio bigint;
begin
  if not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para cobrar.'; end if;
  select * into v_row from public.smyl_finance_payments where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then return v_row; end if;
  if p_amount<=0 or p_method not in ('cash','card','transfer','check','other') or jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' then raise exception using errcode='22023',message='Datos de pago inválidos.'; end if;
  if p_method='cash' and not exists(select 1 from public.smyl_cash_sessions where tenant_id=v_tenant and id=p_cash_session_id and branch_id=p_branch_id and status='open') then raise exception using errcode='23514',message='Abre una caja en esta sucursal antes de cobrar efectivo.'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) loop
    if (v_item->>'amount')::numeric<=0 then raise exception using errcode='22003',message='Aplicación inválida.'; end if;
    select c.total_amount-coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id=v_tenant and a.charge_id=c.id),0)+coalesce((select sum(ra.amount) from public.smyl_finance_refund_allocations ra where ra.tenant_id=v_tenant and ra.charge_id=c.id),0) into v_open
    from public.smyl_finance_charges c where c.tenant_id=v_tenant and c.id=(v_item->>'charge_id')::uuid and c.patient_id=p_patient_id and c.status='open' for update;
    if not found or (v_item->>'amount')::numeric>v_open then raise exception using errcode='23514',message='La aplicación supera el saldo del cargo.'; end if;
    v_sum:=v_sum+(v_item->>'amount')::numeric;
  end loop;
  if v_sum>p_amount then raise exception using errcode='23514',message='Las aplicaciones superan el pago.'; end if;
  insert into public.smyl_finance_payments(id,tenant_id,patient_id,branch_id,cash_session_id,idempotency_key,amount,method,reference,paid_at,created_by)
  values(p_id,v_tenant,p_patient_id,p_branch_id,case when p_method='cash' then p_cash_session_id else null end,p_idempotency_key,p_amount,p_method,coalesce(p_reference,''),coalesce(p_paid_at,now()),auth.uid()) returning * into v_row;
  for v_item in select value from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) loop
    insert into public.smyl_finance_payment_allocations(tenant_id,payment_id,charge_id,amount) values(v_tenant,p_id,(v_item->>'charge_id')::uuid,(v_item->>'amount')::numeric);
  end loop;
  insert into public.smyl_finance_sequences(tenant_id,next_receipt) values(v_tenant,2) on conflict(tenant_id) do update set next_receipt=public.smyl_finance_sequences.next_receipt+1 returning next_receipt-1 into v_folio;
  insert into public.smyl_finance_receipts(tenant_id,payment_id,folio,snapshot,issued_by) values(v_tenant,p_id,v_folio,jsonb_build_object('patient_id',p_patient_id,'amount',p_amount,'method',p_method,'reference',coalesce(p_reference,''),'paid_at',coalesce(p_paid_at,now()),'allocations',coalesce(p_allocations,'[]'::jsonb),'document_type','internal_receipt'),auth.uid());
  return v_row;
end $$;

create or replace function public.smyl_refund_payment(p_id uuid,p_idempotency_key uuid,p_payment_id uuid,p_amount numeric,p_reason text)
returns public.smyl_finance_refunds language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_payment public.smyl_finance_payments; v_row public.smyl_finance_refunds; v_left numeric; v_available numeric; v_alloc record;
begin
  if not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso.'; end if;
  select * into v_row from public.smyl_finance_refunds where tenant_id=v_tenant and idempotency_key=p_idempotency_key; if found then return v_row; end if;
  select * into v_payment from public.smyl_finance_payments where tenant_id=v_tenant and id=p_payment_id for update;
  if not found then raise exception using errcode='P0002',message='Pago no encontrado.'; end if;
  select v_payment.amount-coalesce(sum(amount),0) into v_available from public.smyl_finance_refunds where tenant_id=v_tenant and payment_id=p_payment_id;
  if p_amount<=0 or p_amount>v_available then raise exception using errcode='23514',message='El reembolso supera el importe disponible.'; end if;
  insert into public.smyl_finance_refunds(id,tenant_id,payment_id,idempotency_key,amount,reason,created_by) values(p_id,v_tenant,p_payment_id,p_idempotency_key,p_amount,btrim(p_reason),auth.uid()) returning * into v_row;
  v_left:=p_amount;
  for v_alloc in select a.charge_id,a.amount-coalesce((select sum(ra.amount) from public.smyl_finance_refund_allocations ra join public.smyl_finance_refunds r on r.tenant_id=ra.tenant_id and r.id=ra.refund_id where ra.tenant_id=v_tenant and r.payment_id=p_payment_id and ra.charge_id=a.charge_id),0) available from public.smyl_finance_payment_allocations a where a.tenant_id=v_tenant and a.payment_id=p_payment_id order by a.charge_id loop
    exit when v_left<=0; v_available:=least(v_left,v_alloc.available);
    if v_available>0 then insert into public.smyl_finance_refund_allocations(tenant_id,refund_id,charge_id,amount) values(v_tenant,p_id,v_alloc.charge_id,v_available); v_left:=v_left-v_available; end if;
  end loop;
  return v_row;
end $$;

create or replace function public.smyl_post_cash_adjustment(p_id uuid,p_idempotency_key uuid,p_cash_session_id uuid,p_direction text,p_amount numeric,p_reason text)
returns public.smyl_cash_adjustments language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_cash_adjustments;
begin
  if not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso.'; end if;
  select * into v_row from public.smyl_cash_adjustments where tenant_id=v_tenant and idempotency_key=p_idempotency_key; if found then return v_row; end if;
  if not exists(select 1 from public.smyl_cash_sessions where tenant_id=v_tenant and id=p_cash_session_id and status='open') then raise exception using errcode='23514',message='La caja no está abierta.'; end if;
  insert into public.smyl_cash_adjustments(id,tenant_id,cash_session_id,idempotency_key,direction,amount,reason,created_by) values(p_id,v_tenant,p_cash_session_id,p_idempotency_key,p_direction,p_amount,btrim(p_reason),auth.uid()) returning * into v_row; return v_row;
end $$;

create or replace function public.smyl_close_cash_session(p_session_id uuid,p_expected_revision integer,p_counted_cash numeric,p_notes text default '')
returns public.smyl_cash_sessions language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_cash_sessions; v_expected numeric;
begin
  if not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso.'; end if;
  select * into v_row from public.smyl_cash_sessions where tenant_id=v_tenant and id=p_session_id for update;
  if not found or v_row.status<>'open' then raise exception using errcode='23514',message='La caja ya no está abierta.'; end if;
  if v_row.revision<>p_expected_revision then raise exception using errcode='40001',message='La caja cambió en otra sesión.'; end if;
  select v_row.opening_cash+coalesce((select sum(amount) from public.smyl_finance_payments where tenant_id=v_tenant and cash_session_id=p_session_id and method='cash'),0)-coalesce((select sum(r.amount) from public.smyl_finance_refunds r join public.smyl_finance_payments p on p.tenant_id=r.tenant_id and p.id=r.payment_id where r.tenant_id=v_tenant and p.cash_session_id=p_session_id and p.method='cash'),0)+coalesce((select sum(case when direction='in' then amount else -amount end) from public.smyl_cash_adjustments where tenant_id=v_tenant and cash_session_id=p_session_id),0) into v_expected;
  update public.smyl_cash_sessions set status='closed',expected_cash=v_expected,counted_cash=p_counted_cash,variance=p_counted_cash-v_expected,close_notes=coalesce(p_notes,''),closed_by=auth.uid(),closed_at=now(),revision=revision+1 where tenant_id=v_tenant and id=p_session_id returning * into v_row; return v_row;
end $$;

create or replace function public.smyl_prepare_cfdi_draft(p_id uuid,p_idempotency_key uuid,p_payment_id uuid)
returns public.smyl_cfdi_drafts language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_payment public.smyl_finance_payments; v_profile public.smyl_patient_fiscal_profiles; v_row public.smyl_cfdi_drafts;
begin
  if not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso.'; end if;
  select * into v_row from public.smyl_cfdi_drafts where tenant_id=v_tenant and idempotency_key=p_idempotency_key; if found then return v_row; end if;
  select * into v_payment from public.smyl_finance_payments where tenant_id=v_tenant and id=p_payment_id;
  if not found then raise exception using errcode='P0002',message='Pago no encontrado.'; end if;
  select * into v_profile from public.smyl_patient_fiscal_profiles where tenant_id=v_tenant and patient_id=v_payment.patient_id;
  if not found then raise exception using errcode='23514',message='Completa los datos fiscales del paciente.'; end if;
  insert into public.smyl_cfdi_drafts(id,tenant_id,patient_id,payment_id,idempotency_key,fiscal_snapshot,created_by)
  values(p_id,v_tenant,v_payment.patient_id,p_payment_id,p_idempotency_key,jsonb_build_object('legal_name',v_profile.legal_name,'rfc',v_profile.rfc,'fiscal_regime',v_profile.fiscal_regime,'tax_postal_code',v_profile.tax_postal_code,'cfdi_use',v_profile.cfdi_use,'email',v_profile.email,'amount',v_payment.amount,'payment_method',v_payment.method),auth.uid()) returning * into v_row; return v_row;
end $$;

revoke all on function public.smyl_post_charge(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,date),public.smyl_void_charge(uuid,text),public.smyl_open_cash_session(uuid,uuid,numeric),public.smyl_post_payment(uuid,uuid,uuid,uuid,uuid,numeric,text,text,timestamptz,jsonb),public.smyl_refund_payment(uuid,uuid,uuid,numeric,text),public.smyl_post_cash_adjustment(uuid,uuid,uuid,text,numeric,text),public.smyl_close_cash_session(uuid,integer,numeric,text),public.smyl_prepare_cfdi_draft(uuid,uuid,uuid) from public,anon;
grant execute on function public.smyl_post_charge(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,date),public.smyl_void_charge(uuid,text),public.smyl_open_cash_session(uuid,uuid,numeric),public.smyl_post_payment(uuid,uuid,uuid,uuid,uuid,numeric,text,text,timestamptz,jsonb),public.smyl_refund_payment(uuid,uuid,uuid,numeric,text),public.smyl_post_cash_adjustment(uuid,uuid,uuid,text,numeric,text),public.smyl_close_cash_session(uuid,integer,numeric,text),public.smyl_prepare_cfdi_draft(uuid,uuid,uuid) to authenticated;

commit;
