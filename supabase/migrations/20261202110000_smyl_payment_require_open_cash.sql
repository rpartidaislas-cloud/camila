-- SMYL · Cobros: ya no se cobra nada con la caja cerrada, y se quita la forma de pago «Otro».
--
-- Antes solo el efectivo exigía una caja abierta: tarjeta, transferencia y cheque (y «Otro») se registraban sin caja y no entraban a
-- ningún corte. Ahora TODO cobro nuevo exige que quien cobra tenga una caja abierta en la sucursal, y las formas de pago nuevas son
-- efectivo, tarjeta, transferencia y cheque. «Otro» se rechaza en cobros nuevos; los pagos históricos con «Otro» no cambian.
-- Un reintento del MISMO cobro (misma llave de idempotencia) sigue devolviendo el pago ya registrado aunque la caja ya se haya cerrado.
-- Aditiva y repetible: reemplaza la función sin cambiar su firma.

begin;

create or replace function public.smyl_post_payment(p_id uuid,p_idempotency_key uuid,p_patient_id uuid,p_branch_id uuid,p_cash_session_id uuid,p_amount numeric,p_method text,p_reference text,p_paid_at timestamptz,p_allocations jsonb)
returns public.smyl_finance_payments language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_finance_payments; v_item jsonb; v_sum numeric:=0; v_open numeric; v_folio bigint;
begin
  if not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para cobrar.'; end if;
  select * into v_row from public.smyl_finance_payments where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then return v_row; end if;
  if p_amount<=0 or p_method not in ('cash','card','transfer','check') or jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' then raise exception using errcode='22023',message='Datos de pago inválidos.'; end if;
  if not exists(select 1 from public.smyl_cash_sessions where tenant_id=v_tenant and branch_id=p_branch_id and status='open' and opened_by=auth.uid()) then raise exception using errcode='23514',message='Abre una caja para esta sucursal antes de cobrar.'; end if;
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

revoke all on function public.smyl_post_payment(uuid,uuid,uuid,uuid,uuid,numeric,text,text,timestamptz,jsonb) from public, anon;
grant execute on function public.smyl_post_payment(uuid,uuid,uuid,uuid,uuid,numeric,text,text,timestamptz,jsonb) to authenticated;

commit;
