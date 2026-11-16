-- Cobro en línea de saldos de pacientes (OpenPay vía LANA).
-- SMYL es dueño de la deuda y del recibo; LANA solo cobra (la cuenta OpenPay es de la clínica).
-- smyl_payment_links: un enlace de pago por saldo. El navegador del paciente solo conoce un token opaco; aquí vive su SHA-256.
-- Tabla y funciones SOLO para service_role (Edge Function smyl-pay): guarda callback_secret, que nunca debe leerse desde el navegador.
begin;

create table if not exists public.smyl_payment_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  branch_id uuid not null,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  callback_secret text not null check (char_length(callback_secret) between 32 and 200),
  amount numeric(12,2) not null check (amount >= 10 and amount <= 500000),
  allocations jsonb not null check (jsonb_typeof(allocations) = 'array'),
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  expires_at timestamptz not null,
  lana_request_id uuid,
  lana_charge_id text,
  method text check (method in ('card','transfer')),
  payment_id uuid,
  paid_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smyl_payment_links_token_uk unique (token_hash),
  constraint smyl_payment_links_tenant_id_uk unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete restrict
);
create index if not exists smyl_payment_links_patient_idx on public.smyl_payment_links (tenant_id, patient_id, created_at desc);
create index if not exists smyl_payment_links_pending_idx on public.smyl_payment_links (tenant_id, status) where status = 'pending';

alter table public.smyl_payment_links enable row level security;
revoke all on public.smyl_payment_links from public, anon, authenticated;
grant all on public.smyl_payment_links to service_role;

-- Saldo abierto de cada cargo del paciente (mismo cálculo que smyl_post_payment). Orden: vencimiento y antigüedad.
create or replace function public.smyl_open_charges_for_link(p_tenant uuid, p_patient uuid, p_charge_ids uuid[] default null)
returns table(charge_id uuid, concept text, open_amount numeric, branch_id uuid, due_on date)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.concept,
         c.total_amount
           - coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id = c.tenant_id and a.charge_id = c.id), 0)
           + coalesce((select sum(ra.amount) from public.smyl_finance_refund_allocations ra where ra.tenant_id = c.tenant_id and ra.charge_id = c.id), 0) as open_amount,
         c.branch_id, c.due_on
  from public.smyl_finance_charges c
  where c.tenant_id = p_tenant and c.patient_id = p_patient and c.status = 'open'
    and (p_charge_ids is null or c.id = any(p_charge_ids))
  order by c.due_on nulls last, c.created_at, c.id;
$$;

-- Registra el pago confirmado por LANA/OpenPay UNA sola vez y emite el recibo. Equivale a smyl_post_payment pero sin sesión de
-- usuario: quien lo "cobra" es quien generó el enlace. Idempotente por enlace (la llave de idempotencia es el id del enlace).
-- Si el dinero ya entró pero los cargos cambiaron (anulados o cubiertos por otra vía), el sobrante queda como saldo a favor.
create or replace function public.smyl_post_online_payment(p_link_id uuid, p_lana_charge_id text, p_method text, p_paid_at timestamptz default now())
returns public.smyl_payment_links
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_link public.smyl_payment_links; v_item jsonb; v_open numeric; v_apply numeric; v_left numeric;
  v_alloc jsonb := '[]'::jsonb; v_folio bigint; v_payment public.smyl_finance_payments;
begin
  if p_method not in ('card','transfer') then raise exception using errcode='22023', message='Método de pago en línea inválido.'; end if;
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
  values (gen_random_uuid(), v_link.tenant_id, v_link.patient_id, v_link.branch_id, null, v_link.id, v_link.amount, p_method,
          left('OpenPay ' || coalesce(p_lana_charge_id, ''), 180), coalesce(p_paid_at, now()), v_link.created_by)
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

revoke all on function public.smyl_open_charges_for_link(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.smyl_post_online_payment(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.smyl_open_charges_for_link(uuid, uuid, uuid[]) to service_role;
grant execute on function public.smyl_post_online_payment(uuid, text, text, timestamptz) to service_role;

commit;
