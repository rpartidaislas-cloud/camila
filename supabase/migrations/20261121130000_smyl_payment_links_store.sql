-- Cobro en línea: pago en efectivo en tiendas (Paynet vía Openpay/LANA). Idempotente.
--  - smyl_payment_links.method acepta 'store' además de 'card' y 'transfer'.
--  - smyl_post_online_payment acepta 'store'. En Finanzas se registra como 'other' con la referencia «OpenPay Paynet …»,
--    para que NO cuente como efectivo de la caja de la clínica (el dinero llega a la cuenta Openpay, no al cajón).
--    El recibo conserva method='store' en su snapshot.
begin;

alter table public.smyl_payment_links drop constraint if exists smyl_payment_links_method_check;
alter table public.smyl_payment_links add constraint smyl_payment_links_method_check check (method in ('card','transfer','store'));

create or replace function public.smyl_post_online_payment(p_link_id uuid, p_lana_charge_id text, p_method text, p_paid_at timestamptz default now())
returns public.smyl_payment_links
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_link public.smyl_payment_links; v_item jsonb; v_open numeric; v_apply numeric; v_left numeric;
  v_alloc jsonb := '[]'::jsonb; v_folio bigint; v_payment public.smyl_finance_payments;
  v_finance_method text; v_reference text;
begin
  if p_method not in ('card','transfer','store') then raise exception using errcode='22023', message='Método de pago en línea inválido.'; end if;
  v_finance_method := case when p_method = 'store' then 'other' else p_method end;
  v_reference := left(case when p_method = 'store' then 'OpenPay Paynet ' else 'OpenPay ' end || coalesce(p_lana_charge_id, ''), 180);
  select * into v_link from public.smyl_payment_links where id = p_link_id for update;
  if not found then raise exception using errcode='P0002', message='Enlace de pago no encontrado.'; end if;
  if v_link.status = 'paid' then return v_link; end if;

  v_left := v_link.amount;
  for v_item in select value from jsonb_array_elements(v_link.allocations) loop
    exit when v_left <= 0;
    select c.total_amount
             - coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id = c.tenant_id and a.charge_id = c.id), 0)
             + coalesce((select sum(ra.amount) from public.smyl_finance_refund_allocations ra where ra.tenant_id = c.tenant_id and ra.charge_id = c.id), 0)
      into v_open
      from public.smyl_finance_charges c
     where c.tenant_id = v_link.tenant_id and c.id = (v_item->>'charge_id')::uuid and c.patient_id = v_link.patient_id and c.status = 'open'
     for update;
    if not found or v_open <= 0 then continue; end if;
    v_apply := least((v_item->>'amount')::numeric, v_open, v_left);
    if v_apply > 0 then
      v_alloc := v_alloc || jsonb_build_object('charge_id', v_item->>'charge_id', 'amount', v_apply);
      v_left := v_left - v_apply;
    end if;
  end loop;

  insert into public.smyl_finance_payments(id, tenant_id, patient_id, branch_id, cash_session_id, idempotency_key, amount, method, reference, paid_at, created_by)
  values (gen_random_uuid(), v_link.tenant_id, v_link.patient_id, v_link.branch_id, null, v_link.id, v_link.amount, v_finance_method,
          v_reference, coalesce(p_paid_at, now()), v_link.created_by)
  returning * into v_payment;
  for v_item in select value from jsonb_array_elements(v_alloc) loop
    insert into public.smyl_finance_payment_allocations(tenant_id, payment_id, charge_id, amount)
    values (v_link.tenant_id, v_payment.id, (v_item->>'charge_id')::uuid, (v_item->>'amount')::numeric);
  end loop;
  insert into public.smyl_finance_sequences(tenant_id, next_receipt) values (v_link.tenant_id, 2)
    on conflict (tenant_id) do update set next_receipt = public.smyl_finance_sequences.next_receipt + 1
    returning next_receipt - 1 into v_folio;
  insert into public.smyl_finance_receipts(tenant_id, payment_id, folio, snapshot, issued_by)
  values (v_link.tenant_id, v_payment.id, v_folio,
          jsonb_build_object('patient_id', v_link.patient_id, 'amount', v_link.amount, 'method', p_method,
                             'reference', v_payment.reference, 'paid_at', v_payment.paid_at, 'allocations', v_alloc,
                             'document_type', 'internal_receipt', 'channel', 'online', 'provider', 'openpay', 'payment_link_id', v_link.id),
          v_link.created_by);
  update public.smyl_payment_links
     set status = 'paid', paid_at = v_payment.paid_at, payment_id = v_payment.id, method = p_method,
         lana_charge_id = coalesce(p_lana_charge_id, lana_charge_id), updated_at = now()
   where id = v_link.id returning * into v_link;
  return v_link;
end $$;

revoke all on function public.smyl_post_online_payment(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.smyl_post_online_payment(uuid, text, text, timestamptz) to service_role;

commit;
