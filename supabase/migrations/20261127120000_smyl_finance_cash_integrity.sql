-- SMYL · Finanzas: integridad de caja (auditoría 2026-11-26, P0 «reembolsos en efectivo» y P1 «carrera entre cobro y cierre»).
--
-- Qué corrige:
--   1. El reembolso ahora guarda DE DÓNDE SALIÓ el dinero: método real, caja (sesión) y sucursal de salida, y referencia.
--      Antes se restaba a la caja donde se había RECIBIDO el pago: un reembolso en efectivo del viernes de un pago del lunes
--      alteraba la caja del lunes (ya cerrada) y no la del viernes, que es la que entregó el dinero.
--   2. Reembolso en EFECTIVO exige una caja abierta (que se bloquea); con tarjeta, transferencia o cheque exige referencia.
--   3. Una caja cerrada queda congelada: un disparador bloquea la fila de la sesión y vuelve a comprobar que siga abierta antes de aceptar
--      un cobro en efectivo, un ajuste (entrada/salida) o un reembolso en efectivo. Así un cobro simultáneo al cierre o entra
--      en el corte o se rechaza; nunca queda fuera del corte.
--   4. El corte de caja se calcula con una sola función (smyl_cash_expected) que usan el cierre y cualquier lectura.
--
-- Compatibilidad: los reembolsos ya existentes (refund_method NULL = «histórico») se siguen atribuyendo a la caja del pago original,
-- así que NINGÚN corte ya cerrado cambia. Aditiva y repetible.

begin;

-- 1. Dónde salió el dinero de cada reembolso.
alter table public.smyl_finance_refunds
  add column if not exists refund_method text,
  add column if not exists refund_cash_session_id uuid,
  add column if not exists refund_branch_id uuid,
  add column if not exists reference text not null default '';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_finance_refunds_method_check') then
    alter table public.smyl_finance_refunds
      add constraint smyl_finance_refunds_method_check check (refund_method is null or refund_method in ('cash', 'card', 'transfer', 'check', 'other')),
      add constraint smyl_finance_refunds_cash_session_check check (refund_method is distinct from 'cash' or refund_cash_session_id is not null),
      add constraint smyl_finance_refunds_reference_len_check check (char_length(reference) <= 200),
      add constraint smyl_finance_refunds_cash_session_fk foreign key (tenant_id, refund_cash_session_id) references public.smyl_cash_sessions (tenant_id, id) on delete restrict;
  end if;
end $$;
create index if not exists smyl_finance_refunds_cash_session_idx on public.smyl_finance_refunds (tenant_id, refund_cash_session_id) where refund_cash_session_id is not null;
comment on column public.smyl_finance_refunds.refund_method is 'Cómo salió el dinero. NULL = reembolso histórico (anterior a esta migración): se atribuye a la caja del pago original.';

-- 2. Efectivo esperado de una caja. Fuente única del corte.
create or replace function public.smyl_cash_expected(p_tenant uuid, p_session uuid)
returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.opening_cash
    + coalesce((select sum(p.amount) from public.smyl_finance_payments p
                 where p.tenant_id = p_tenant and p.cash_session_id = p_session and p.method = 'cash'), 0)
    - coalesce((select sum(r.amount) from public.smyl_finance_refunds r
                 left join public.smyl_finance_payments p on p.tenant_id = r.tenant_id and p.id = r.payment_id
                 where r.tenant_id = p_tenant
                   and (   (r.refund_method = 'cash' and r.refund_cash_session_id = p_session)
                        or (r.refund_method is null and p.cash_session_id = p_session and p.method = 'cash'))), 0)
    + coalesce((select sum(case when d.direction = 'in' then d.amount else -d.amount end) from public.smyl_cash_adjustments d
                 where d.tenant_id = p_tenant and d.cash_session_id = p_session), 0)
  from public.smyl_cash_sessions s where s.tenant_id = p_tenant and s.id = p_session;
$$;
revoke all on function public.smyl_cash_expected(uuid, uuid) from public, anon, authenticated;
grant execute on function public.smyl_cash_expected(uuid, uuid) to service_role;

-- Lectura para la pantalla: el mismo cálculo, pero solo de cajas de MI clínica y de sucursales que puedo ver en Finanzas.
create or replace function public.smyl_cash_session_expected(p_session_id uuid)
returns numeric
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_branch uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'finance.read') then raise exception using errcode = '42501', message = 'Sin permiso.'; end if;
  select branch_id into v_branch from public.smyl_cash_sessions where tenant_id = v_tenant and id = p_session_id;
  if not found then return null; end if;
  if not public.smyl_can_access_finance_branch(v_tenant, v_branch) then raise exception using errcode = '42501', message = 'Esa caja es de una sucursal fuera de tu alcance.'; end if;
  return public.smyl_cash_expected(v_tenant, p_session_id);
end $$;
revoke all on function public.smyl_cash_session_expected(uuid) from public, anon;
grant execute on function public.smyl_cash_session_expected(uuid) to authenticated, service_role;

-- 3. Cierre con la fuente única (misma regla de bloqueo y revisión que antes).
create or replace function public.smyl_close_cash_session(p_session_id uuid, p_expected_revision integer, p_counted_cash numeric, p_notes text default '')
returns public.smyl_cash_sessions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_cash_sessions; v_expected numeric;
begin
  if not public.smyl_has_permission(v_tenant, 'finance.manage') then raise exception using errcode = '42501', message = 'Sin permiso.'; end if;
  select * into v_row from public.smyl_cash_sessions where tenant_id = v_tenant and id = p_session_id for update;
  if not found or v_row.status <> 'open' then raise exception using errcode = '23514', message = 'La caja ya no está abierta.'; end if;
  if v_row.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'La caja cambió en otra sesión.'; end if;
  v_expected := public.smyl_cash_expected(v_tenant, p_session_id);
  update public.smyl_cash_sessions
     set status = 'closed', expected_cash = v_expected, counted_cash = p_counted_cash, variance = p_counted_cash - v_expected,
         close_notes = coalesce(p_notes, ''), closed_by = auth.uid(), closed_at = now(), revision = revision + 1
   where tenant_id = v_tenant and id = p_session_id returning * into v_row;
  return v_row;
end $$;

-- 4. Una caja cerrada no recibe movimientos: se bloquea la sesión y se vuelve a comprobar que siga abierta.
create or replace function public.smyl_lock_open_cash_session()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_session uuid; v_status text;
begin
  if tg_table_name = 'smyl_finance_payments' then
    if new.method is distinct from 'cash' then return new; end if;
    v_session := new.cash_session_id;
  elsif tg_table_name = 'smyl_cash_adjustments' then
    v_session := new.cash_session_id;
  else -- smyl_finance_refunds
    if new.refund_method is distinct from 'cash' then return new; end if;
    v_session := new.refund_cash_session_id;
  end if;
  if v_session is null then return new; end if;
  select status into v_status from public.smyl_cash_sessions where tenant_id = new.tenant_id and id = v_session for update;
  if not found or v_status <> 'open' then
    raise exception using errcode = '23514', message = 'La caja ya fue cerrada: abre o elige una caja abierta para registrar este movimiento.';
  end if;
  return new;
end $$;
revoke all on function public.smyl_lock_open_cash_session() from public, anon, authenticated;

drop trigger if exists smyl_payments_lock_cash_session on public.smyl_finance_payments;
create trigger smyl_payments_lock_cash_session before insert on public.smyl_finance_payments
  for each row execute function public.smyl_lock_open_cash_session();
drop trigger if exists smyl_adjustments_lock_cash_session on public.smyl_cash_adjustments;
create trigger smyl_adjustments_lock_cash_session before insert on public.smyl_cash_adjustments
  for each row execute function public.smyl_lock_open_cash_session();
drop trigger if exists smyl_refunds_lock_cash_session on public.smyl_finance_refunds;
create trigger smyl_refunds_lock_cash_session before insert on public.smyl_finance_refunds
  for each row execute function public.smyl_lock_open_cash_session();

-- 5. Reembolso: método real, caja de salida y referencia. Sustituye a la versión de 5 parámetros.
drop function if exists public.smyl_refund_payment(uuid, uuid, uuid, numeric, text);
create or replace function public.smyl_refund_payment(
  p_id uuid, p_idempotency_key uuid, p_payment_id uuid, p_amount numeric, p_reason text,
  p_method text default null, p_cash_session_id uuid default null, p_reference text default ''
)
returns public.smyl_finance_refunds
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant(); v_payment public.smyl_finance_payments; v_row public.smyl_finance_refunds;
  v_left numeric; v_available numeric; v_alloc record; v_method text; v_branch uuid; v_session public.smyl_cash_sessions; v_ref text := btrim(coalesce(p_reference, ''));
begin
  if not public.smyl_has_permission(v_tenant, 'finance.manage') then raise exception using errcode = '42501', message = 'Sin permiso.'; end if;
  select * into v_row from public.smyl_finance_refunds where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
  if found then return v_row; end if;
  select * into v_payment from public.smyl_finance_payments where tenant_id = v_tenant and id = p_payment_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Pago no encontrado.'; end if;

  v_method := coalesce(p_method, v_payment.method);
  if v_method not in ('cash', 'card', 'transfer', 'check', 'other') then raise exception using errcode = '22023', message = 'Método de devolución inválido.'; end if;
  v_branch := v_payment.branch_id;
  if v_method = 'cash' then
    if p_cash_session_id is null then raise exception using errcode = '23514', message = 'Para devolver efectivo elige una caja abierta: el dinero sale de esa caja.'; end if;
    select * into v_session from public.smyl_cash_sessions where tenant_id = v_tenant and id = p_cash_session_id for update;
    if not found or v_session.status <> 'open' then raise exception using errcode = '23514', message = 'La caja elegida no está abierta. Abre una caja para devolver efectivo.'; end if;
    v_branch := v_session.branch_id;
  elsif v_method in ('card', 'transfer', 'check') and char_length(v_ref) < 2 then
    raise exception using errcode = '23514', message = 'Escribe la referencia de la devolución (folio, últimos dígitos o número de operación).';
  end if;

  select v_payment.amount - coalesce(sum(amount), 0) into v_available from public.smyl_finance_refunds where tenant_id = v_tenant and payment_id = p_payment_id;
  if p_amount <= 0 or p_amount > v_available then raise exception using errcode = '23514', message = 'El reembolso supera el importe disponible.'; end if;
  insert into public.smyl_finance_refunds(id, tenant_id, payment_id, idempotency_key, amount, reason, created_by, refund_method, refund_cash_session_id, refund_branch_id, reference)
  values (p_id, v_tenant, p_payment_id, p_idempotency_key, p_amount, btrim(p_reason), auth.uid(), v_method, case when v_method = 'cash' then p_cash_session_id else null end, v_branch, left(v_ref, 200))
  returning * into v_row;
  v_left := p_amount;
  for v_alloc in
    select a.charge_id,
           a.amount - coalesce((select sum(ra.amount) from public.smyl_finance_refund_allocations ra
                                 join public.smyl_finance_refunds r on r.tenant_id = ra.tenant_id and r.id = ra.refund_id
                                where ra.tenant_id = v_tenant and r.payment_id = p_payment_id and ra.charge_id = a.charge_id), 0) as available
      from public.smyl_finance_payment_allocations a where a.tenant_id = v_tenant and a.payment_id = p_payment_id order by a.charge_id
  loop
    exit when v_left <= 0;
    v_available := least(v_left, v_alloc.available);
    if v_available > 0 then
      insert into public.smyl_finance_refund_allocations(tenant_id, refund_id, charge_id, amount) values (v_tenant, p_id, v_alloc.charge_id, v_available);
      v_left := v_left - v_available;
    end if;
  end loop;
  return v_row;
end $$;
revoke all on function public.smyl_refund_payment(uuid, uuid, uuid, numeric, text, text, uuid, text) from public, anon;
grant execute on function public.smyl_refund_payment(uuid, uuid, uuid, numeric, text, text, uuid, text) to authenticated, service_role;

commit;
