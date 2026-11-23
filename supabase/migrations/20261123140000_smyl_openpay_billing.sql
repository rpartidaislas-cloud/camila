-- SMYL · Suscripciones de la plataforma con Openpay (reemplaza a Stripe).
--
-- Qué agrega (aditivo; no toca camila_tenants salvo lo que ya existía: plan, activo, vence_en, limite_diagnosticos):
--   1. smyl_billing_plans: qué plan_id de Openpay corresponde a cada plan + periodo, por ambiente (sandbox | production).
--      El navegador NUNCA manda plan_id ni precio: la Edge Function lo resuelve aquí.
--   2. smyl_billing_customers: el cliente de Openpay de cada clínica y la tarjeta vigente (solo marca y últimos 4 dígitos).
--   3. smyl_billing_subscriptions: la suscripción vigente de cada clínica (una por ambiente).
--   4. smyl_billing_events: registro de avisos (webhooks) ya procesados, para no repetirlos.
--   5. smyl_billing_summary(): lo que ve el DUEÑO en Plan y suscripción. Sin datos de tarjeta completos.
-- Todo se escribe solo con el rol de servicio (las Edge Functions); las clínicas no leen estas tablas directo.

begin;

create table if not exists public.smyl_billing_plans (
  plan_key text not null check (plan_key in ('esencial', 'profesional', 'premium')),
  periodo text not null check (periodo in ('mensual', 'anual')),
  environment text not null check (environment in ('sandbox', 'production')),
  openpay_plan_id text not null check (char_length(openpay_plan_id) between 3 and 80),
  created_at timestamptz not null default now(),
  primary key (plan_key, periodo, environment)
);

create table if not exists public.smyl_billing_customers (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  openpay_customer_id text not null check (char_length(openpay_customer_id) between 3 and 80),
  card_id text check (card_id is null or char_length(card_id) <= 80),
  card_brand text check (card_brand is null or char_length(card_brand) <= 30),
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, environment),
  unique (environment, openpay_customer_id)
);

create table if not exists public.smyl_billing_subscriptions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  openpay_subscription_id text not null check (char_length(openpay_subscription_id) between 3 and 80),
  plan_key text check (plan_key in ('esencial', 'profesional', 'premium')),
  periodo text check (periodo in ('mensual', 'anual')),
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled', 'unknown')),
  cancel_at_period_end boolean not null default false,
  next_charge_date date,
  period_end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, environment),
  unique (environment, openpay_subscription_id)
);

create table if not exists public.smyl_billing_events (
  event_key text not null check (char_length(event_key) between 1 and 200),
  environment text not null check (environment in ('sandbox', 'production')),
  event_type text not null check (char_length(event_type) <= 80),
  tenant_id uuid references public.camila_tenants(id) on delete set null,
  received_at timestamptz not null default now(),
  primary key (event_key, environment)
);
create index if not exists smyl_billing_events_received_idx on public.smyl_billing_events(received_at desc);

alter table public.smyl_billing_plans enable row level security;
alter table public.smyl_billing_customers enable row level security;
alter table public.smyl_billing_subscriptions enable row level security;
alter table public.smyl_billing_events enable row level security;
revoke all on public.smyl_billing_plans, public.smyl_billing_customers, public.smyl_billing_subscriptions, public.smyl_billing_events from public, anon, authenticated;
grant select, insert, update, delete on public.smyl_billing_plans, public.smyl_billing_customers, public.smyl_billing_subscriptions, public.smyl_billing_events to service_role;

-- Resumen para el dueño de la clínica (ambiente = el que tenga la suscripción más reciente de ese tenant).
create or replace function public.smyl_billing_summary()
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := auth.uid();
  v_sub public.smyl_billing_subscriptions%rowtype;
  v_card public.smyl_billing_customers%rowtype;
begin
  -- Solo el dueño (su id es el de la clínica) ve la facturación.
  if v_tenant is null or not exists (select 1 from public.camila_tenants t where t.id = v_tenant) then
    return jsonb_build_object('has_subscription', false);
  end if;
  select * into v_sub from public.smyl_billing_subscriptions where tenant_id = v_tenant order by updated_at desc limit 1;
  if not found then return jsonb_build_object('has_subscription', false); end if;
  select * into v_card from public.smyl_billing_customers where tenant_id = v_tenant and environment = v_sub.environment;
  return jsonb_build_object(
    'has_subscription', true, 'plan_key', v_sub.plan_key, 'periodo', v_sub.periodo, 'status', v_sub.status,
    'cancel_at_period_end', v_sub.cancel_at_period_end, 'next_charge_date', v_sub.next_charge_date,
    'card_brand', v_card.card_brand, 'card_last4', v_card.card_last4);
end;
$$;
revoke all on function public.smyl_billing_summary() from public, anon;
grant execute on function public.smyl_billing_summary() to authenticated, service_role;

-- Planes de SANDBOX ya creados en Openpay (los de producción se registran con scripts/openpay-create-plans.mjs).
insert into public.smyl_billing_plans(plan_key, periodo, environment, openpay_plan_id) values
  ('esencial', 'mensual', 'sandbox', 'pks5ftjdmzxyssr4z2ll'),
  ('esencial', 'anual', 'sandbox', 'psz9ondrrkkpz3rdukqj'),
  ('profesional', 'mensual', 'sandbox', 'p6sbor5zw2ygbmbtotzi'),
  ('profesional', 'anual', 'sandbox', 'pyjg6qosdm8sna8liagt'),
  ('premium', 'mensual', 'sandbox', 'ppmokoccriomtmzc9ie5'),
  ('premium', 'anual', 'sandbox', 'pgijn4i3rxtdj7wm7a7v')
on conflict (plan_key, periodo, environment) do nothing;

commit;
