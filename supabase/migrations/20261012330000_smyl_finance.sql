-- SMYL · Etapa 5: caja, cuentas de pacientes y preparación fiscal.
-- Es un libro clínico-financiero independiente de Stripe (suscripción SaaS).
begin;

create table public.smyl_finance_sequences (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  next_receipt bigint not null default 1 check(next_receipt > 0)
);

create table public.smyl_finance_charges (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  branch_id uuid,
  appointment_id uuid,
  service_id uuid,
  proposal_id uuid,
  idempotency_key uuid not null,
  concept text not null check(char_length(btrim(concept)) between 2 and 240),
  quantity numeric(10,3) not null default 1 check(quantity > 0),
  unit_price numeric(12,2) not null check(unit_price >= 0),
  discount_amount numeric(12,2) not null default 0 check(discount_amount >= 0),
  tax_amount numeric(12,2) not null default 0 check(tax_amount >= 0),
  total_amount numeric(12,2) not null check(total_amount > 0),
  due_on date,
  status text not null default 'open' check(status in ('open','voided')),
  void_reason text not null default '' check(char_length(void_reason) <= 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  unique(tenant_id,id), unique(tenant_id,idempotency_key),
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete restrict,
  foreign key(tenant_id,branch_id) references public.smyl_branches(tenant_id,id) on delete restrict,
  foreign key(tenant_id,appointment_id) references public.smyl_appointments(tenant_id,id) on delete restrict,
  foreign key(tenant_id,service_id) references public.smyl_services(tenant_id,id) on delete restrict,
  check(total_amount = round(quantity * unit_price - discount_amount + tax_amount,2)),
  check((status='voided' and voided_by is not null and voided_at is not null and char_length(btrim(void_reason)) >= 2) or status='open')
);
create index smyl_finance_charges_patient_idx on public.smyl_finance_charges(tenant_id,patient_id,created_at desc);

create table public.smyl_cash_sessions (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid not null,
  opened_by uuid not null references auth.users(id),
  opening_cash numeric(12,2) not null default 0 check(opening_cash >= 0),
  opened_at timestamptz not null default now(),
  status text not null default 'open' check(status in ('open','closed')),
  expected_cash numeric(12,2), counted_cash numeric(12,2), variance numeric(12,2),
  close_notes text not null default '' check(char_length(close_notes) <= 1000),
  closed_by uuid references auth.users(id), closed_at timestamptz,
  revision integer not null default 1 check(revision > 0),
  unique(tenant_id,id),
  foreign key(tenant_id,branch_id) references public.smyl_branches(tenant_id,id) on delete restrict,
  check((status='closed' and counted_cash is not null and expected_cash is not null and variance is not null and closed_by is not null and closed_at is not null) or status='open')
);
create unique index smyl_cash_one_open_idx on public.smyl_cash_sessions(tenant_id,branch_id,opened_by) where status='open';

create table public.smyl_finance_payments (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  branch_id uuid not null,
  cash_session_id uuid,
  idempotency_key uuid not null,
  amount numeric(12,2) not null check(amount > 0),
  method text not null check(method in ('cash','card','transfer','check','other')),
  reference text not null default '' check(char_length(reference) <= 180),
  paid_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,idempotency_key),
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete restrict,
  foreign key(tenant_id,branch_id) references public.smyl_branches(tenant_id,id) on delete restrict,
  foreign key(tenant_id,cash_session_id) references public.smyl_cash_sessions(tenant_id,id) on delete restrict,
  check((method='cash' and cash_session_id is not null) or method<>'cash')
);
create index smyl_finance_payments_patient_idx on public.smyl_finance_payments(tenant_id,patient_id,paid_at desc);

create table public.smyl_finance_payment_allocations (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  payment_id uuid not null, charge_id uuid not null,
  amount numeric(12,2) not null check(amount > 0),
  primary key(tenant_id,payment_id,charge_id),
  foreign key(tenant_id,payment_id) references public.smyl_finance_payments(tenant_id,id) on delete restrict,
  foreign key(tenant_id,charge_id) references public.smyl_finance_charges(tenant_id,id) on delete restrict
);

create table public.smyl_finance_refunds (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  payment_id uuid not null,
  idempotency_key uuid not null,
  amount numeric(12,2) not null check(amount > 0),
  reason text not null check(char_length(btrim(reason)) between 2 and 500),
  refunded_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,idempotency_key),
  foreign key(tenant_id,payment_id) references public.smyl_finance_payments(tenant_id,id) on delete restrict
);

create table public.smyl_finance_refund_allocations (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  refund_id uuid not null, charge_id uuid not null,
  amount numeric(12,2) not null check(amount > 0),
  primary key(tenant_id,refund_id,charge_id),
  foreign key(tenant_id,refund_id) references public.smyl_finance_refunds(tenant_id,id) on delete restrict,
  foreign key(tenant_id,charge_id) references public.smyl_finance_charges(tenant_id,id) on delete restrict
);

create table public.smyl_cash_adjustments (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  cash_session_id uuid not null,
  idempotency_key uuid not null,
  direction text not null check(direction in ('in','out')),
  amount numeric(12,2) not null check(amount > 0),
  reason text not null check(char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,idempotency_key),
  foreign key(tenant_id,cash_session_id) references public.smyl_cash_sessions(tenant_id,id) on delete restrict
);

create table public.smyl_finance_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  payment_id uuid not null,
  folio bigint not null check(folio > 0),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  issued_by uuid not null references auth.users(id), issued_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,payment_id), unique(tenant_id,folio),
  foreign key(tenant_id,payment_id) references public.smyl_finance_payments(tenant_id,id) on delete restrict
);

create table public.smyl_patient_fiscal_profiles (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  legal_name text not null check(char_length(btrim(legal_name)) between 2 and 240),
  rfc text not null check(rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  fiscal_regime text not null check(char_length(fiscal_regime) between 3 and 3),
  tax_postal_code text not null check(tax_postal_code ~ '^[0-9]{5}$'),
  cfdi_use text not null check(char_length(cfdi_use) between 3 and 5),
  email text not null default '' check(char_length(email) <= 254),
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
  primary key(tenant_id,patient_id),
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete cascade
);

create table public.smyl_cfdi_drafts (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  payment_id uuid not null,
  idempotency_key uuid not null,
  status text not null default 'draft' check(status in ('draft','submitted','issued','rejected','cancelled')),
  fiscal_snapshot jsonb not null check(jsonb_typeof(fiscal_snapshot)='object'),
  provider text, external_uuid uuid, provider_message text not null default '' check(char_length(provider_message) <= 1000),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,payment_id), unique(tenant_id,idempotency_key),
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete restrict,
  foreign key(tenant_id,payment_id) references public.smyl_finance_payments(tenant_id,id) on delete restrict,
  check((status in ('submitted','issued') and provider is not null) or status in ('draft','rejected','cancelled'))
);

do $$ declare t text;
begin
  foreach t in array array['smyl_finance_sequences','smyl_finance_charges','smyl_cash_sessions','smyl_finance_payments','smyl_finance_payment_allocations','smyl_finance_refunds','smyl_finance_refund_allocations','smyl_cash_adjustments','smyl_finance_receipts','smyl_patient_fiscal_profiles','smyl_cfdi_drafts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.smyl_has_permission(tenant_id,''finance.read''))',t||'_read',t);
  end loop;
end $$;

create policy smyl_patient_fiscal_profiles_manage on public.smyl_patient_fiscal_profiles for all to authenticated
 using(public.smyl_has_permission(tenant_id,'finance.manage'))
 with check(tenant_id=public.smyl_current_tenant() and public.smyl_has_permission(tenant_id,'finance.manage'));

do $$ declare t text;
begin
  foreach t in array array['smyl_finance_charges','smyl_cash_sessions','smyl_finance_payments','smyl_finance_refunds','smyl_cash_adjustments','smyl_finance_receipts','smyl_patient_fiscal_profiles','smyl_cfdi_drafts'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.smyl_audit_row()',t||'_audit',t);
  end loop;
end $$;
create trigger smyl_patient_fiscal_profiles_touch before update on public.smyl_patient_fiscal_profiles for each row execute function public.smyl_touch_updated_at();

revoke all on table public.smyl_finance_sequences,public.smyl_finance_charges,public.smyl_cash_sessions,public.smyl_finance_payments,public.smyl_finance_payment_allocations,public.smyl_finance_refunds,public.smyl_finance_refund_allocations,public.smyl_cash_adjustments,public.smyl_finance_receipts,public.smyl_patient_fiscal_profiles,public.smyl_cfdi_drafts from anon,authenticated;
grant select on table public.smyl_finance_charges,public.smyl_cash_sessions,public.smyl_finance_payments,public.smyl_finance_payment_allocations,public.smyl_finance_refunds,public.smyl_finance_refund_allocations,public.smyl_cash_adjustments,public.smyl_finance_receipts,public.smyl_patient_fiscal_profiles,public.smyl_cfdi_drafts to authenticated;
grant insert,update on table public.smyl_patient_fiscal_profiles to authenticated;

commit;
