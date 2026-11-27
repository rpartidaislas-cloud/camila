-- SMYL · Corte de caja: reporte de cobros en línea (Openpay).
--
-- Los cobros por enlace de pago (Openpay) se validan solos: el proveedor confirma el pago y SMYL lo asienta, sin terminal ni comprobante que
-- el cajero tenga que contar. Antes entraban a «Tarjetas / Transferencias · debe haber» del corte y obligaban a explicar diferencias que no
-- eran suyas. Ahora el corte los separa y GUARDA su reporte dentro de close_reconciliation->'online':
--   {provider:'openpay', count, total, by_method:{card, transfer, …}, items:[{payment_id, folio, method, amount, paid_at, reference}], truncated}
-- Lo arma SIEMPRE el servidor (no el navegador): cobros de la sucursal de la caja, desde su apertura hasta el cierre, que no estén ya
-- en el reporte de otro corte, netos de reembolsos. Aditiva y repetible; no cambia firmas.

begin;

create or replace function public.smyl_cash_online_report(p_tenant uuid, p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_s public.smyl_cash_sessions; v_out jsonb;
begin
  select * into v_s from public.smyl_cash_sessions where tenant_id = p_tenant and id = p_session_id;
  if not found then return null; end if;
  with rows as (
    select p.id as payment_id, r.folio, p.method,
           p.amount - coalesce((select sum(x.amount) from public.smyl_finance_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id), 0) as amount,
           p.paid_at, coalesce(p.reference, '') as reference
      from public.smyl_finance_payments p
      join public.smyl_finance_receipts r on r.tenant_id = p.tenant_id and r.payment_id = p.id
     where p.tenant_id = p_tenant and p.branch_id is not distinct from v_s.branch_id
       and p.paid_at >= v_s.opened_at and p.paid_at <= now()
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
  select jsonb_build_object('provider', 'openpay', 'count', (select count(*) from rows), 'total', round(coalesce((select sum(amount) from rows), 0), 2),
                            'by_method', (select j from by_method), 'items', (select j from listed), 'truncated', (select count(*) from rows) > 200)
    into v_out;
  return v_out;
end $$;
revoke all on function public.smyl_cash_online_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.smyl_cash_online_report(uuid, uuid) to service_role;

-- Cierre: igual que antes + el reporte en línea dentro de la conciliación (solo si el cierre trae conciliación estructurada).
create or replace function public.smyl_close_cash_session(
  p_session_id uuid, p_expected_revision integer, p_counted_cash numeric, p_notes text default '', p_reconciliation jsonb default null
)
returns public.smyl_cash_sessions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_cash_sessions; v_expected numeric; v_recon jsonb; v_online jsonb;
begin
  if not public.smyl_has_permission(v_tenant, 'finance.manage') then raise exception using errcode = '42501', message = 'Sin permiso.'; end if;
  select * into v_row from public.smyl_cash_sessions where tenant_id = v_tenant and id = p_session_id for update;
  if not found or v_row.status <> 'open' then raise exception using errcode = '23514', message = 'La caja ya no está abierta.'; end if;
  if v_row.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'La caja cambió en otra sesión.'; end if;
  v_expected := public.smyl_cash_expected(v_tenant, p_session_id);
  v_recon := public.smyl_normalize_cash_reconciliation(p_reconciliation, v_expected, p_counted_cash);
  if v_recon is not null then
    v_online := public.smyl_cash_online_report(v_tenant, p_session_id);
    if v_online is not null and (v_online->>'count')::int > 0 then v_recon := v_recon || jsonb_build_object('online', v_online); end if;
  end if;
  update public.smyl_cash_sessions
     set status = 'closed', expected_cash = v_expected, counted_cash = p_counted_cash, variance = p_counted_cash - v_expected,
         close_notes = coalesce(p_notes, ''), close_reconciliation = v_recon, closed_by = auth.uid(), closed_at = now(), revision = revision + 1
   where tenant_id = v_tenant and id = p_session_id returning * into v_row;
  return v_row;
end $$;
revoke all on function public.smyl_close_cash_session(uuid, integer, numeric, text, jsonb) from public, anon;
grant execute on function public.smyl_close_cash_session(uuid, integer, numeric, text, jsonb) to authenticated, service_role;

commit;
