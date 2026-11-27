-- SMYL · Corte de caja: los cobros en línea recibidos CON LA CAJA CERRADA entran al siguiente corte.
--
-- Problema: smyl_cash_online_report solo tomaba los cobros Openpay desde la APERTURA de la caja. Un pago que entraba entre un cierre y la
-- siguiente apertura (por ejemplo, un SPEI o un pago en tienda que el paciente hizo de noche, o un enlace pagado con la caja cerrada) quedaba
-- fuera de TODOS los cortes: el dinero entró pero ningún corte lo mostraba.
-- Ahora el reporte empieza en el cierre de la caja anterior de la misma sucursal (o en la apertura, si no hay una anterior). Sigue sin
-- contarse dos veces: se excluyen los pagos que ya están en el reporte de otro corte. Aditiva y repetible; no cambia firmas.

begin;

create or replace function public.smyl_cash_online_report(p_tenant uuid, p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_s public.smyl_cash_sessions; v_out jsonb; v_from timestamptz;
begin
  select * into v_s from public.smyl_cash_sessions where tenant_id = p_tenant and id = p_session_id;
  if not found then return null; end if;
  -- Desde el cierre anterior de esta sucursal (cubre el tiempo con la caja cerrada); sin cierre previo, desde la apertura.
  select coalesce(max(o.closed_at), v_s.opened_at) into v_from
    from public.smyl_cash_sessions o
   where o.tenant_id = p_tenant and o.branch_id is not distinct from v_s.branch_id and o.id <> p_session_id
     and o.status = 'closed' and o.closed_at is not null and o.closed_at <= v_s.opened_at;
  v_from := least(v_from, v_s.opened_at);
  with rows as (
    select p.id as payment_id, r.folio, p.method,
           p.amount - coalesce((select sum(x.amount) from public.smyl_finance_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id), 0) as amount,
           p.paid_at, coalesce(p.reference, '') as reference
      from public.smyl_finance_payments p
      join public.smyl_finance_receipts r on r.tenant_id = p.tenant_id and r.payment_id = p.id
     where p.tenant_id = p_tenant and p.branch_id is not distinct from v_s.branch_id
       and p.paid_at >= v_from and p.paid_at <= now()
       and r.snapshot->>'provider' = 'openpay'
       and not exists (
         select 1 from public.smyl_cash_sessions o, jsonb_array_elements(coalesce(o.close_reconciliation->'online'->'items', '[]'::jsonb)) it
          where o.tenant_id = p_tenant and o.id <> p_session_id and it->>'payment_id' = p.id::text)
  ), by_method as (
    select coalesce(jsonb_object_agg(method, s), '{}'::jsonb) as j from (select method, round(sum(amount), 2) as s from rows group by method) m
  ), listed as (
    select coalesce(jsonb_agg(jsonb_build_object('payment_id', payment_id, 'folio', folio, 'method', method, 'amount', round(amount, 2), 'paid_at', paid_at, 'reference', reference) order by paid_at), '[]'::jsonb) as j
      from (select * from rows order by paid_at limit 200) t
  )
  select jsonb_build_object('provider', 'openpay', 'count', (select count(*) from rows), 'total', round(coalesce((select sum(amount) from rows), 0), 2), 'by_method', (select j from by_method), 'items', (select j from listed), 'truncated', (select count(*) from rows) > 200)
    into v_out;
  return v_out;
end $$;
revoke all on function public.smyl_cash_online_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.smyl_cash_online_report(uuid, uuid) to service_role;

commit;
