-- SMYL · Finanzas: saldos por paciente calculados en el SERVIDOR (auditoría 2026-11-26, bloque 2).
--
-- Hasta hoy el navegador descargaba cargos, pagos, aplicaciones y reembolsos (hasta 10,000 filas por tabla) y calculaba ahí los saldos de cada
-- paciente. Al rebasar ese tope los saldos quedaban incompletos. Estas funciones dan la MISMA cuenta desde la base, por páginas:
--   smyl_finance_account_summaries(filtro, búsqueda, límite, desplazamiento, hoy)  →  una fila por paciente con sus saldos ya calculados
--   smyl_finance_account_counts(hoy)                                              →  totales de la clínica y cuántas cuentas hay en cada vista
-- Reglas idénticas a las de la pantalla (centavos enteros): pagado de un cargo = aplicaciones − reembolsos aplicados; saldo = máx(0, total − pagado);
-- cargo anulado no cuenta; vencido = con saldo y vencimiento anterior a hoy; saldo a favor = máx(0, recibido − reembolsado − aplicado).
-- SECURITY INVOKER: las políticas de Finanzas (finance.read y alcance por sucursal) se aplican solas; cada quien ve solo lo suyo.
-- Aditiva y repetible.

begin;

create or replace function public.smyl_finance_accounts_base(p_today date default current_date)
returns table (
  patient_id uuid, charges_count integer, open_count integer, overdue_count integer,
  due_cents bigint, overdue_cents bigint, open_total_cents bigint, credit_cents bigint,
  overdue_since date, next_due_on date, last_payment_at timestamptz
)
language sql stable security invoker set search_path = pg_catalog, public as $$
  with paid as (
    select a.charge_id, sum(round(a.amount * 100))::bigint as cents from public.smyl_finance_payment_allocations a group by a.charge_id
  ), refunded as (
    select ra.charge_id, sum(round(ra.amount * 100))::bigint as cents from public.smyl_finance_refund_allocations ra group by ra.charge_id
  ), charge_rows as (
    select c.patient_id, c.due_on, round(c.total_amount * 100)::bigint as total_c,
           greatest(0, round(c.total_amount * 100)::bigint - (coalesce(p.cents, 0) - coalesce(r.cents, 0))) as balance_c
      from public.smyl_finance_charges c
      left join paid p on p.charge_id = c.id
      left join refunded r on r.charge_id = c.id
     where c.status <> 'voided'
  ), by_charge as (
    select patient_id,
           count(*)::integer as charges_count,
           count(*) filter (where balance_c > 0)::integer as open_count,
           count(*) filter (where balance_c > 0 and due_on is not null and due_on < p_today)::integer as overdue_count,
           coalesce(sum(balance_c), 0)::bigint as due_cents,
           coalesce(sum(balance_c) filter (where balance_c > 0 and due_on is not null and due_on < p_today), 0)::bigint as overdue_cents,
           coalesce(sum(total_c) filter (where balance_c > 0), 0)::bigint as open_total_cents,
           min(due_on) filter (where balance_c > 0 and due_on is not null and due_on < p_today) as overdue_since,
           min(due_on) filter (where balance_c > 0 and due_on is not null) as next_due_on
      from charge_rows group by patient_id
  ), pay_rows as (
    select pay.patient_id, sum(round(pay.amount * 100))::bigint as received_c, max(pay.paid_at) as last_payment_at
      from public.smyl_finance_payments pay group by pay.patient_id
  ), ref_rows as (
    select pay.patient_id, sum(round(r.amount * 100))::bigint as refunded_c
      from public.smyl_finance_refunds r join public.smyl_finance_payments pay on pay.tenant_id = r.tenant_id and pay.id = r.payment_id group by pay.patient_id
  ), app_rows as (
    select pay.patient_id, sum(round(a.amount * 100))::bigint as applied_c
      from public.smyl_finance_payment_allocations a join public.smyl_finance_payments pay on pay.tenant_id = a.tenant_id and pay.id = a.payment_id group by pay.patient_id
  ), ids as (
    select patient_id from by_charge union select patient_id from pay_rows
  )
  select i.patient_id,
         coalesce(bc.charges_count, 0), coalesce(bc.open_count, 0), coalesce(bc.overdue_count, 0),
         coalesce(bc.due_cents, 0), coalesce(bc.overdue_cents, 0), coalesce(bc.open_total_cents, 0),
         greatest(0, coalesce(pr.received_c, 0) - coalesce(rr.refunded_c, 0) - coalesce(ar.applied_c, 0))::bigint,
         bc.overdue_since, bc.next_due_on, pr.last_payment_at
    from ids i
    left join by_charge bc on bc.patient_id = i.patient_id
    left join pay_rows pr on pr.patient_id = i.patient_id
    left join ref_rows rr on rr.patient_id = i.patient_id
    left join app_rows ar on ar.patient_id = i.patient_id;
$$;
revoke all on function public.smyl_finance_accounts_base(date) from public, anon;
grant execute on function public.smyl_finance_accounts_base(date) to authenticated, service_role;

-- Una página de cuentas, en el mismo orden que la pantalla: vencidas (más días y más monto primero), con saldo (mayor primero),
-- con saldo a favor (mayor primero), solo con movimientos (último pago primero) y por nombre. Con búsqueda recorre TODOS los pacientes.
create or replace function public.smyl_finance_account_summaries(
  p_filter text default 'open', p_search text default '', p_limit integer default 50, p_offset integer default 0, p_today date default current_date
)
returns table (
  patient_id uuid, nombre text, apellido text, charges_count integer, open_count integer, overdue_count integer,
  due_cents bigint, overdue_cents bigint, open_total_cents bigint, credit_cents bigint,
  overdue_since date, next_due_on date, last_payment_at timestamptz, total_count bigint
)
language sql stable security invoker set search_path = pg_catalog, public as $$
  with norm as (
    select translate(lower(btrim(coalesce(p_search, ''))), 'áéíóúüñ', 'aeiouun') as q
  ), rows as (
    select p.id as patient_id, p.nombre, p.apellido,
           coalesce(b.charges_count, 0) as charges_count, coalesce(b.open_count, 0) as open_count, coalesce(b.overdue_count, 0) as overdue_count,
           coalesce(b.due_cents, 0) as due_cents, coalesce(b.overdue_cents, 0) as overdue_cents, coalesce(b.open_total_cents, 0) as open_total_cents,
           coalesce(b.credit_cents, 0) as credit_cents, b.overdue_since, b.next_due_on, b.last_payment_at,
           translate(lower(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, '')), 'áéíóúüñ', 'aeiouun') as folded,
           translate(lower(btrim(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, ''))), 'áéíóúüñ', 'aeiouun') as sort_name
      from public.camila_pacientes p
      left join public.smyl_finance_accounts_base(p_today) b on b.patient_id = p.id
  ), picked as (
    select r.*, case when r.overdue_count > 0 then 0 when r.due_cents > 0 then 1 when r.credit_cents > 0 then 2 when r.charges_count > 0 then 3 else 4 end as rank
      from rows r, norm n
     where case when n.q <> '' then position(n.q in r.folded) > 0
                when p_filter = 'overdue' then r.overdue_count > 0
                when p_filter = 'open' then r.due_cents > 0
                when p_filter = 'credit' then r.credit_cents > 0
                else (r.charges_count > 0 or r.credit_cents > 0) end
  )
  select pk.patient_id, pk.nombre, pk.apellido, pk.charges_count, pk.open_count, pk.overdue_count, pk.due_cents, pk.overdue_cents, pk.open_total_cents,
         pk.credit_cents, pk.overdue_since, pk.next_due_on, pk.last_payment_at, count(*) over ()::bigint as total_count
    from picked pk
   order by pk.rank,
            case when pk.rank = 0 then pk.overdue_since end asc nulls last,
            case when pk.rank = 0 then pk.overdue_cents end desc nulls last,
            case when pk.rank = 1 then pk.due_cents end desc nulls last,
            case when pk.rank = 2 then pk.credit_cents end desc nulls last,
            case when pk.rank = 3 then pk.last_payment_at end desc nulls last,
            pk.sort_name asc, pk.patient_id
   limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.smyl_finance_account_summaries(text, text, integer, integer, date) from public, anon;
grant execute on function public.smyl_finance_account_summaries(text, text, integer, integer, date) to authenticated, service_role;

-- Totales de la clínica (los que ve quien tiene este alcance) y cuántas cuentas hay en cada vista.
create or replace function public.smyl_finance_account_counts(p_today date default current_date)
returns table (due_cents bigint, overdue_cents bigint, credit_cents bigint, debtors bigint, open_count bigint, overdue_count bigint, credit_count bigint, all_count bigint)
language sql stable security invoker set search_path = pg_catalog, public as $$
  select coalesce(sum(b.due_cents), 0)::bigint, coalesce(sum(b.overdue_cents), 0)::bigint, coalesce(sum(b.credit_cents), 0)::bigint,
         count(*) filter (where b.due_cents > 0), count(*) filter (where b.due_cents > 0), count(*) filter (where b.overdue_count > 0),
         count(*) filter (where b.credit_cents > 0), count(*) filter (where b.charges_count > 0 or b.credit_cents > 0)
    from public.smyl_finance_accounts_base(p_today) b;
$$;
revoke all on function public.smyl_finance_account_counts(date) from public, anon;
grant execute on function public.smyl_finance_account_counts(date) to authenticated, service_role;

commit;
