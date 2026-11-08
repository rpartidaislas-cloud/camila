-- Agenda · etiqueta de cobro en cada cita: Por cobrar / Saldo $X / Cobrada / Sin cargo.
--   * smyl_appointment_billing(p_appointment_ids): estado de cobro de las citas pedidas (máx. 300), sólo para quien tiene
--     finance.read en su clínica; sin ese permiso no devuelve nada (la agenda simplemente no muestra etiqueta).
--   * Sólo lectura: no crea ni cambia cargos, pagos ni citas. Sólo citas en las que el paciente ya llegó (arrived / in_progress / completed).
--   * Precedencia: con cargo vigente manda el cargo (due = hay saldo, paid = liquidado); si no, la decisión «sin cargo»;
--     si no, un servicio de precio $0 es «free» (sin etiqueta); si no, «pending» (falta decidir el cobro).
-- Requiere 20261108120000_smyl_appointment_no_charge.sql. Idempotente.

create or replace function public.smyl_appointment_billing(p_appointment_ids uuid[])
returns table (appointment_id uuid, billing_state text, charged_amount numeric, due_amount numeric)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'finance.read') then
    return;
  end if;
  if coalesce(array_length(p_appointment_ids, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_appointment_ids, 1) > 300 then
    raise exception using errcode = '22023', message = 'Demasiadas citas en una sola consulta.';
  end if;
  return query
  with charges as (
    select c.appointment_id as aid,
           sum(c.total_amount) as total,
           sum(greatest(c.total_amount
                 - (coalesce((select sum(x.amount) from public.smyl_finance_payment_allocations x where x.tenant_id = c.tenant_id and x.charge_id = c.id), 0)
                  - coalesce((select sum(r.amount) from public.smyl_finance_refund_allocations r where r.tenant_id = c.tenant_id and r.charge_id = c.id), 0)), 0)) as due
      from public.smyl_finance_charges c
     where c.tenant_id = v_tenant and c.appointment_id = any (p_appointment_ids) and c.status <> 'voided'
     group by c.appointment_id
  )
  select a.id,
         case when ch.aid is not null then case when ch.due > 0 then 'due' else 'paid' end
              when n.appointment_id is not null then 'no_charge'
              when s.reference_price is not null and s.reference_price = 0 then 'free'
              else 'pending' end,
         coalesce(ch.total, 0)::numeric,
         coalesce(ch.due, 0)::numeric
    from public.smyl_appointments a
    left join charges ch on ch.aid = a.id
    left join public.smyl_appointment_no_charge n on n.tenant_id = a.tenant_id and n.appointment_id = a.id
    left join public.smyl_services s on s.tenant_id = a.tenant_id and s.id = a.service_id
   where a.tenant_id = v_tenant
     and a.id = any (p_appointment_ids)
     and a.status in ('arrived', 'in_progress', 'completed');
end;
$function$;

revoke all on function public.smyl_appointment_billing(uuid[]) from public, anon;
grant execute on function public.smyl_appointment_billing(uuid[]) to authenticated;
