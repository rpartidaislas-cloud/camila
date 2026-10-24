-- SMYL · Etapa 8: compras de paquetes consumibles (checkout + webhook).
--
-- Libro mayor comercial separado de la suscripción SaaS (camila_tenants /
-- stripe-webhook). Un pago acredita saldo únicamente cuando el webhook firmado
-- de Stripe llega a smyl_consumables_confirm_payment, que ejecuta en una sola
-- transacción: bloqueo de la sesión, verificación del snapshot, registro del
-- evento, crédito idempotente con smyl_credit y enlace del movimiento.
--
-- El navegador nunca escribe aquí: ambas tablas tienen RLS sin políticas para
-- authenticated/anon; la lectura de estado pasa por la RPC
-- smyl_consumables_checkout_status, que valida tenant y permiso comercial.
--
-- Reversible: ver bloque ROLLBACK al final.

begin;

-- ---------------------------------------------------------------------------
-- Permiso comercial: dueño/administrador (finance.manage o clinic.manage).
-- ---------------------------------------------------------------------------
create or replace function public.smyl_consumables_can_purchase(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select p_tenant_id is not null
     and p_tenant_id = public.smyl_current_tenant()
     and (
       public.smyl_has_permission(p_tenant_id, 'finance.manage')
       or public.smyl_has_permission(p_tenant_id, 'clinic.manage')
     );
$$;

revoke all on function public.smyl_consumables_can_purchase(uuid) from public, anon;
grant execute on function public.smyl_consumables_can_purchase(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sesiones de checkout (snapshot inmutable del producto al momento de comprar).
-- ---------------------------------------------------------------------------
create table if not exists public.smyl_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique check (public_ref ~ '^chk_[a-f0-9]{32}$'),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  product_id text not null references public.smyl_consumable_products(id),
  requested_by uuid not null references auth.users(id) on delete set null,
  idempotency_key uuid not null,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_checkout_id text check (provider_checkout_id is null or char_length(provider_checkout_id) <= 120),
  provider_payment_id text check (provider_payment_id is null or char_length(provider_payment_id) <= 120),
  resource text not null check (resource in ('mila_seconds', 'whatsapp_messages', 'ai_credits')),
  unit_amount bigint not null check (unit_amount > 0),
  price_minor integer not null check (price_minor > 0),
  currency text not null check (currency in ('MXN', 'USD')),
  status text not null default 'created'
    check (status in ('created', 'pending', 'completed', 'failed', 'expired', 'refunded')),
  ledger_entry_id uuid references public.smyl_usage_ledger(id),
  refund_ledger_entry_id uuid references public.smyl_usage_ledger(id),
  refunded_units bigint not null default 0 check (refunded_units >= 0),
  refund_shortfall_units bigint not null default 0 check (refund_shortfall_units >= 0),
  refund_amount_minor integer not null default 0 check (refund_amount_minor >= 0),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create unique index if not exists smyl_checkout_sessions_provider_idx
  on public.smyl_checkout_sessions (provider, provider_checkout_id)
  where provider_checkout_id is not null;
create index if not exists smyl_checkout_sessions_payment_idx
  on public.smyl_checkout_sessions (provider, provider_payment_id)
  where provider_payment_id is not null;
create index if not exists smyl_checkout_sessions_tenant_idx
  on public.smyl_checkout_sessions (tenant_id, created_at desc);

alter table public.smyl_checkout_sessions enable row level security;
revoke all on table public.smyl_checkout_sessions from public, anon, authenticated;

drop trigger if exists smyl_checkout_sessions_touch on public.smyl_checkout_sessions;
create trigger smyl_checkout_sessions_touch
  before update on public.smyl_checkout_sessions
  for each row execute function public.smyl_touch_updated_at();

-- Transiciones permitidas: created→pending→completed→refunded; created/pending→failed|expired.
-- Nada vuelve atrás y nada salta de un estado terminal a otro distinto de refunded.
create or replace function public.smyl_checkout_sessions_guard_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status = new.status then return new; end if;
  if old.status = 'created' and new.status in ('pending', 'completed', 'failed', 'expired') then return new; end if;
  if old.status = 'pending' and new.status in ('completed', 'failed', 'expired') then return new; end if;
  if old.status = 'completed' and new.status = 'refunded' then return new; end if;
  raise exception using errcode = '23514',
    message = format('Transición de checkout no permitida: %s → %s', old.status, new.status);
end;
$$;

drop trigger if exists smyl_checkout_sessions_z_transition on public.smyl_checkout_sessions;
create trigger smyl_checkout_sessions_z_transition
  before update of status on public.smyl_checkout_sessions
  for each row execute function public.smyl_checkout_sessions_guard_transition();

-- El snapshot comercial no se reescribe nunca.
create or replace function public.smyl_checkout_sessions_freeze_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.tenant_id <> old.tenant_id or new.product_id <> old.product_id
     or new.idempotency_key <> old.idempotency_key or new.resource <> old.resource
     or new.unit_amount <> old.unit_amount or new.price_minor <> old.price_minor
     or new.currency <> old.currency or new.public_ref <> old.public_ref then
    raise exception using errcode = '23514', message = 'El snapshot del checkout es inmutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_checkout_sessions_a_freeze on public.smyl_checkout_sessions;
create trigger smyl_checkout_sessions_a_freeze
  before update on public.smyl_checkout_sessions
  for each row execute function public.smyl_checkout_sessions_freeze_snapshot();

-- ---------------------------------------------------------------------------
-- Eventos de pago recibidos (uno por event_id de Stripe; sin cuerpo completo).
-- ---------------------------------------------------------------------------
create table if not exists public.smyl_payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_event_id text not null check (char_length(provider_event_id) <= 120),
  event_type text not null check (char_length(event_type) <= 80),
  checkout_id uuid references public.smyl_checkout_sessions(id) on delete set null,
  reconciliation_hash text check (reconciliation_hash is null or char_length(reconciliation_hash) <= 64),
  process_status text not null check (process_status in ('processed', 'duplicate', 'ignored', 'rejected', 'error')),
  attempt integer not null default 1 check (attempt >= 1),
  error_message text check (error_message is null or char_length(error_message) <= 300),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index if not exists smyl_payment_events_checkout_idx
  on public.smyl_payment_events (checkout_id, received_at desc);

alter table public.smyl_payment_events enable row level security;
revoke all on table public.smyl_payment_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Crear o recuperar la sesión interna (idempotente por tenant + clave).
-- ---------------------------------------------------------------------------
create or replace function public.smyl_consumables_checkout_begin(
  p_tenant_id uuid,
  p_requested_by uuid,
  p_product_id text,
  p_idempotency_key uuid,
  p_public_ref text
)
returns public.smyl_checkout_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.smyl_checkout_sessions;
  v_product public.smyl_consumable_products;
  v_row public.smyl_checkout_sessions;
begin
  if p_tenant_id is null or p_requested_by is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Solicitud de compra incompleta.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_idempotency_key::text, 0));

  select * into v_existing from public.smyl_checkout_sessions
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.product_id <> p_product_id then
      raise exception using errcode = '23505', message = 'La clave de compra ya se usó con otro paquete.';
    end if;
    return v_existing;
  end if;

  select * into v_product from public.smyl_consumable_products
  where id = p_product_id and active;
  if not found or v_product.price_minor is null or v_product.price_minor <= 0
     or v_product.unit_amount <= 0 or v_product.currency not in ('MXN', 'USD')
     or v_product.resource not in ('mila_seconds', 'whatsapp_messages', 'ai_credits') then
    raise exception using errcode = 'P0002', message = 'Este paquete no está disponible para compra.';
  end if;

  insert into public.smyl_checkout_sessions (
    public_ref, tenant_id, product_id, requested_by, idempotency_key,
    resource, unit_amount, price_minor, currency, status
  ) values (
    p_public_ref, p_tenant_id, p_product_id, p_requested_by, p_idempotency_key,
    v_product.resource, v_product.unit_amount, v_product.price_minor, v_product.currency, 'created'
  ) returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.smyl_consumables_checkout_begin(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.smyl_consumables_checkout_begin(uuid, uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Enlazar el checkout del proveedor (created → pending).
-- ---------------------------------------------------------------------------
create or replace function public.smyl_consumables_checkout_attach(
  p_checkout_id uuid,
  p_provider_checkout_id text,
  p_expires_at timestamptz
)
returns public.smyl_checkout_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.smyl_checkout_sessions;
begin
  select * into v_row from public.smyl_checkout_sessions where id = p_checkout_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checkout inexistente.';
  end if;
  if v_row.provider_checkout_id is not null and v_row.provider_checkout_id <> p_provider_checkout_id then
    raise exception using errcode = '23505', message = 'El checkout ya está enlazado a otra sesión del proveedor.';
  end if;
  if v_row.status = 'created' then
    update public.smyl_checkout_sessions
       set provider_checkout_id = p_provider_checkout_id, expires_at = p_expires_at, status = 'pending'
     where id = p_checkout_id
     returning * into v_row;
  elsif v_row.provider_checkout_id is null then
    update public.smyl_checkout_sessions
       set provider_checkout_id = p_provider_checkout_id, expires_at = coalesce(expires_at, p_expires_at)
     where id = p_checkout_id
     returning * into v_row;
  end if;
  return v_row;
end;
$$;

revoke all on function public.smyl_consumables_checkout_attach(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.smyl_consumables_checkout_attach(uuid, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Registro de evento (una fila por event_id; devuelve si ya existía).
-- ---------------------------------------------------------------------------
create or replace function public.smyl_payment_event_record(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_checkout_id uuid,
  p_hash text,
  p_status text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.smyl_payment_events (
    provider, provider_event_id, event_type, checkout_id, reconciliation_hash,
    process_status, error_message, processed_at
  ) values (
    p_provider, p_provider_event_id, p_event_type, p_checkout_id, p_hash,
    p_status, left(p_error, 300), now()
  );
  return true;
exception when unique_violation then
  update public.smyl_payment_events
     set attempt = attempt + 1
   where provider = p_provider and provider_event_id = p_provider_event_id;
  return false;
end;
$$;

revoke all on function public.smyl_payment_event_record(text, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.smyl_payment_event_record(text, text, text, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Confirmación atómica: bloquear, verificar snapshot, registrar evento,
--    acreditar con smyl_credit (clave determinista) y marcar completed.
-- ---------------------------------------------------------------------------
create or replace function public.smyl_consumables_confirm_payment(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_checkout_id text,
  p_provider_payment_id text,
  p_amount_minor bigint,
  p_currency text,
  p_metadata_checkout_id uuid,
  p_metadata_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.smyl_checkout_sessions;
  v_hash text;
  v_new_event boolean;
  v_balance bigint;
  v_ledger uuid;
  v_reason text;
begin
  if p_provider <> 'stripe' then
    raise exception using errcode = '22023', message = 'Proveedor no admitido.';
  end if;

  select * into v_row from public.smyl_checkout_sessions
  where provider = p_provider and provider_checkout_id = p_provider_checkout_id
  for update;

  v_hash := encode(sha256(convert_to(
    coalesce(p_provider_checkout_id, '') || '|' || coalesce(p_amount_minor::text, '') || '|' || lower(coalesce(p_currency, '')),
    'utf8')), 'hex');

  if not found then
    perform public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, null, v_hash,
      'rejected', 'checkout desconocido');
    return jsonb_build_object('outcome', 'rejected', 'reason', 'unknown_checkout');
  end if;

  -- Discordancias: se registran y NO acreditan.
  if p_metadata_checkout_id is distinct from v_row.id then v_reason := 'metadata_checkout_mismatch';
  elsif p_metadata_tenant_id is distinct from v_row.tenant_id then v_reason := 'metadata_tenant_mismatch';
  elsif p_amount_minor is distinct from v_row.price_minor::bigint then v_reason := 'amount_mismatch';
  elsif lower(coalesce(p_currency, '')) <> lower(v_row.currency) then v_reason := 'currency_mismatch';
  end if;
  if v_reason is not null then
    perform public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, v_row.id, v_hash,
      'rejected', v_reason);
    return jsonb_build_object('outcome', 'rejected', 'reason', v_reason, 'checkout_id', v_row.id);
  end if;

  v_new_event := public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, v_row.id, v_hash,
    'processed', null);

  if v_row.status in ('completed', 'refunded') then
    return jsonb_build_object('outcome', 'already_completed', 'checkout_id', v_row.id,
      'status', v_row.status, 'ledger_entry_id', v_row.ledger_entry_id, 'duplicate_event', not v_new_event);
  end if;

  -- Crédito idempotente por checkout: aunque Stripe repita el evento con otro id,
  -- la clave 'purchase:<checkout>' garantiza un solo movimiento.
  select c.balance_units, c.ledger_id into v_balance, v_ledger
  from public.smyl_credit(
    v_row.tenant_id, v_row.resource, v_row.unit_amount,
    'purchase:' || v_row.id::text, 'package_purchase', v_row.public_ref,
    jsonb_build_object('checkout_id', v_row.id, 'product_id', v_row.product_id,
      'price_minor', v_row.price_minor, 'currency', v_row.currency, 'provider', v_row.provider)
  ) c;

  update public.smyl_checkout_sessions
     set status = 'completed',
         completed_at = coalesce(completed_at, now()),
         provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
         ledger_entry_id = v_ledger
   where id = v_row.id;

  return jsonb_build_object('outcome', 'credited', 'checkout_id', v_row.id, 'status', 'completed',
    'ledger_entry_id', v_ledger, 'balance_units', v_balance, 'duplicate_event', not v_new_event);
end;
$$;

revoke all on function public.smyl_consumables_confirm_payment(text, text, text, text, text, bigint, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.smyl_consumables_confirm_payment(text, text, text, text, text, bigint, text, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4) Fallo asíncrono / expiración: sin movimiento. Un checkout ya completado
--    no retrocede (evento fuera de orden converge al estado correcto).
-- ---------------------------------------------------------------------------
create or replace function public.smyl_consumables_mark_closed(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_checkout_id text,
  p_new_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.smyl_checkout_sessions;
  v_new_event boolean;
begin
  if p_new_status not in ('failed', 'expired') then
    raise exception using errcode = '22023', message = 'Estado de cierre no válido.';
  end if;
  select * into v_row from public.smyl_checkout_sessions
  where provider = p_provider and provider_checkout_id = p_provider_checkout_id
  for update;
  if not found then
    perform public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, null, null, 'rejected', 'checkout desconocido');
    return jsonb_build_object('outcome', 'rejected', 'reason', 'unknown_checkout');
  end if;
  if v_row.status in ('completed', 'refunded', 'failed', 'expired') then
    perform public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, v_row.id, null, 'ignored', 'estado terminal: ' || v_row.status);
    return jsonb_build_object('outcome', 'ignored', 'checkout_id', v_row.id, 'status', v_row.status);
  end if;
  v_new_event := public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, v_row.id, null, 'processed', null);
  update public.smyl_checkout_sessions
     set status = p_new_status, failure_reason = left(p_reason, 200)
   where id = v_row.id;
  return jsonb_build_object('outcome', p_new_status, 'checkout_id', v_row.id, 'duplicate_event', not v_new_event);
end;
$$;

revoke all on function public.smyl_consumables_mark_closed(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.smyl_consumables_mark_closed(text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Reembolso: reverso append-only (adjustment) sin tocar el crédito original.
--    Reversa proporcional al importe devuelto; si la clínica ya consumió parte,
--    lo no reversible queda en refund_shortfall_units para conciliación manual.
-- ---------------------------------------------------------------------------
create or replace function public.smyl_consumables_refund(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_payment_id text,
  p_amount_refunded_minor bigint,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.smyl_checkout_sessions;
  v_new_event boolean;
  v_target_units bigint;
  v_pending_units bigint;
  v_wallet public.smyl_wallets%rowtype;
  v_reverse bigint;
  v_after bigint;
  v_ledger uuid;
  v_existing public.smyl_usage_ledger%rowtype;
  v_key text;
begin
  select * into v_row from public.smyl_checkout_sessions
  where provider = p_provider and provider_payment_id = p_provider_payment_id
  for update;
  if not found then
    perform public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, null, null, 'rejected', 'pago desconocido');
    return jsonb_build_object('outcome', 'rejected', 'reason', 'unknown_payment');
  end if;
  if lower(coalesce(p_currency, '')) <> lower(v_row.currency) then
    perform public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, v_row.id, null, 'rejected', 'currency_mismatch');
    return jsonb_build_object('outcome', 'rejected', 'reason', 'currency_mismatch', 'checkout_id', v_row.id);
  end if;
  if v_row.status not in ('completed', 'refunded') then
    perform public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, v_row.id, null, 'ignored', 'sin crédito previo: ' || v_row.status);
    return jsonb_build_object('outcome', 'ignored', 'checkout_id', v_row.id, 'status', v_row.status);
  end if;

  v_new_event := public.smyl_payment_event_record(p_provider, p_provider_event_id, p_event_type, v_row.id, null, 'processed', null);
  v_key := 'refund:' || v_row.id::text || ':' || p_provider_event_id;

  -- Mismo evento repetido: devolver el reverso ya registrado.
  select * into v_existing from public.smyl_usage_ledger
  where tenant_id = v_row.tenant_id and idempotency_key = v_key;
  if found then
    return jsonb_build_object('outcome', 'already_refunded', 'checkout_id', v_row.id,
      'ledger_entry_id', v_existing.id, 'duplicate_event', true);
  end if;

  -- Unidades objetivo acumuladas según el importe devuelto (cap: unidades del paquete).
  v_target_units := least(v_row.unit_amount,
    (v_row.unit_amount * least(coalesce(p_amount_refunded_minor, 0), v_row.price_minor::bigint)) / v_row.price_minor);
  v_pending_units := greatest(0, v_target_units - v_row.refunded_units - v_row.refund_shortfall_units);

  if v_pending_units > 0 then
    select * into v_wallet from public.smyl_wallets
    where tenant_id = v_row.tenant_id and resource = v_row.resource for update;
    v_reverse := least(coalesce(v_wallet.balance_units, 0), v_pending_units);
    if v_reverse > 0 then
      v_after := v_wallet.balance_units - v_reverse;
      update public.smyl_wallets set balance_units = v_after, updated_at = clock_timestamp() where id = v_wallet.id;
      insert into public.smyl_usage_ledger (
        tenant_id, resource, entry_type, quantity_units, balance_before, balance_after,
        source_type, source_id, idempotency_key, metadata
      ) values (
        v_row.tenant_id, v_row.resource, 'adjustment', v_reverse, v_wallet.balance_units, v_after,
        'package_refund', v_row.public_ref, v_key,
        jsonb_build_object('checkout_id', v_row.id, 'original_ledger_entry_id', v_row.ledger_entry_id,
          'provider_event_id', p_provider_event_id, 'amount_refunded_minor', p_amount_refunded_minor,
          'requested_units', v_pending_units, 'reversed_units', v_reverse)
      ) returning id into v_ledger;
    end if;
  else
    v_reverse := 0;
  end if;

  update public.smyl_checkout_sessions
     set status = case when status = 'completed' then 'refunded' else status end,
         refunded_at = coalesce(refunded_at, now()),
         refund_amount_minor = least(price_minor, greatest(refund_amount_minor, coalesce(p_amount_refunded_minor, 0)::integer)),
         refunded_units = refunded_units + coalesce(v_reverse, 0),
         refund_shortfall_units = refund_shortfall_units + greatest(0, v_pending_units - coalesce(v_reverse, 0)),
         refund_ledger_entry_id = coalesce(refund_ledger_entry_id, v_ledger)
   where id = v_row.id;

  return jsonb_build_object('outcome', 'refunded', 'checkout_id', v_row.id, 'ledger_entry_id', v_ledger,
    'reversed_units', coalesce(v_reverse, 0), 'shortfall_units', greatest(0, v_pending_units - coalesce(v_reverse, 0)),
    'duplicate_event', not v_new_event);
end;
$$;

revoke all on function public.smyl_consumables_refund(text, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.smyl_consumables_refund(text, text, text, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6) Estado seguro para el navegador: tenant de la sesión + permiso comercial.
--    Nunca devuelve ids de Stripe, precio, metadata ni otros tenants.
-- ---------------------------------------------------------------------------
create or replace function public.smyl_consumables_checkout_status(p_public_ref text)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'status', case when s.status = 'created' then 'pending' else s.status end,
    'credited_resource', case when s.status in ('completed', 'refunded') then s.resource end,
    'credited_units', case when s.status in ('completed', 'refunded') then s.unit_amount end,
    'confirmed_at', s.completed_at
  )
  from public.smyl_checkout_sessions s
  where s.public_ref = p_public_ref
    and s.tenant_id = public.smyl_current_tenant()
    and public.smyl_consumables_can_purchase(s.tenant_id);
$$;

revoke all on function public.smyl_consumables_checkout_status(text) from public, anon;
grant execute on function public.smyl_consumables_checkout_status(text) to authenticated, service_role;

comment on table public.smyl_checkout_sessions is
  'Compras de paquetes consumibles (snapshot inmutable). Solo service_role escribe; estado vía smyl_consumables_checkout_status.';
comment on table public.smyl_payment_events is
  'Eventos de pago recibidos del proveedor, uno por event_id. Sin cuerpo completo ni datos de tarjeta.';

commit;

/* ROLLBACK (ejecutar en orden si hay que revertir esta migración):
begin;
drop function if exists public.smyl_consumables_checkout_status(text);
drop function if exists public.smyl_consumables_refund(text, text, text, text, bigint, text);
drop function if exists public.smyl_consumables_mark_closed(text, text, text, text, text, text);
drop function if exists public.smyl_consumables_confirm_payment(text, text, text, text, text, bigint, text, uuid, uuid);
drop function if exists public.smyl_payment_event_record(text, text, text, uuid, text, text, text);
drop function if exists public.smyl_consumables_checkout_attach(uuid, text, timestamptz);
drop function if exists public.smyl_consumables_checkout_begin(uuid, uuid, text, uuid, text);
drop table if exists public.smyl_payment_events;
drop trigger if exists smyl_checkout_sessions_z_transition on public.smyl_checkout_sessions;
drop trigger if exists smyl_checkout_sessions_a_freeze on public.smyl_checkout_sessions;
drop trigger if exists smyl_checkout_sessions_touch on public.smyl_checkout_sessions;
drop function if exists public.smyl_checkout_sessions_guard_transition();
drop function if exists public.smyl_checkout_sessions_freeze_snapshot();
drop table if exists public.smyl_checkout_sessions;
drop function if exists public.smyl_consumables_can_purchase(uuid);
commit;
-- Los movimientos ya creados en smyl_usage_ledger (package_purchase / package_refund)
-- son append-only y se conservan a propósito.
*/
