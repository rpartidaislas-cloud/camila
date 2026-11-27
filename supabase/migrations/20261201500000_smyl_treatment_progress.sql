-- Avance del tratamiento: qué conceptos cotizados ya se realizaron, cuáles están programados y cuánto se ha cobrado.
--  * smyl_treatment_progress(paciente, tratamiento?)  · solo lectura. Parte de los conceptos que ya tienen cargo (smyl_finance_charges con
--    proposal_item_id) y cuenta las citas ligadas a cada uno (smyl_appointment_quote_links): «realizada» = cita completada; «programada» =
--    cita ligada que aún no se completa. Los importes solo se devuelven con finance.read.
-- Para quien puede leer propuestas y acceder al paciente. Aditiva e idempotente; no modifica tablas.

create or replace function public.smyl_treatment_progress(p_patient_id uuid, p_treatment_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_fin boolean;
  v_result jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'proposal.read')
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    return null;
  end if;
  v_fin := public.smyl_has_permission(v_tenant, 'finance.read');

  with r as (
    select c.proposal_id as pid, c.proposal_item_id as iid, max(c.concept) as label, sum(c.quantity) as qty, sum(c.total_amount) as amount,
           sum(coalesce((select sum(x.amount) from public.smyl_finance_payment_allocations x where x.tenant_id = c.tenant_id and x.charge_id = c.id), 0)
             - coalesce((select sum(rf.amount) from public.smyl_finance_refund_allocations rf where rf.tenant_id = c.tenant_id and rf.charge_id = c.id), 0)) as paid,
           (select count(*) from public.smyl_appointment_quote_links l join public.smyl_appointments a on a.id = l.appointment_id and a.tenant_id = l.tenant_id
             where l.tenant_id = v_tenant and l.proposal_id = c.proposal_id and l.proposal_item_id = c.proposal_item_id and a.status = 'completed')::integer as done,
           (select count(*) from public.smyl_appointment_quote_links l join public.smyl_appointments a on a.id = l.appointment_id and a.tenant_id = l.tenant_id
             where l.tenant_id = v_tenant and l.proposal_id = c.proposal_id and l.proposal_item_id = c.proposal_item_id and a.status not in ('completed', 'cancelled', 'no_show'))::integer as scheduled
      from public.smyl_finance_charges c
      join public.smyl_proposals p on p.tenant_id = c.tenant_id and p.id = c.proposal_id
     where c.tenant_id = v_tenant and c.patient_id = p_patient_id and c.status <> 'voided' and c.proposal_item_id is not null
       and (p_treatment_id is null or (to_jsonb(p)->>'treatment_id') = p_treatment_id::text)
     group by c.proposal_id, c.proposal_item_id
  )
  select jsonb_build_object(
    'concepts', coalesce((select jsonb_agg(jsonb_build_object(
        'proposal_id', pid, 'item_id', iid, 'label', label, 'quantity', qty, 'done', least(done, qty), 'scheduled', scheduled,
        'amount', case when v_fin then amount end, 'paid', case when v_fin then paid end) order by label) from r), '[]'::jsonb),
    'totals', jsonb_build_object(
      'units', coalesce((select sum(qty) from r), 0),
      'done', coalesce((select sum(least(done, qty)) from r), 0),
      'charged', case when v_fin then coalesce((select sum(amount) from r), 0) end,
      'paid', case when v_fin then coalesce((select sum(paid) from r), 0) end,
      'due', case when v_fin then greatest(coalesce((select sum(amount) from r), 0) - coalesce((select sum(paid) from r), 0), 0) end,
      'realized_value', case when v_fin then round(coalesce((select sum(case when qty > 0 then amount * least(done, qty) / qty else 0 end) from r), 0), 2) end))
  into v_result;
  return v_result;
end;
$function$;

revoke all on function public.smyl_treatment_progress(uuid, uuid) from public, anon;
grant execute on function public.smyl_treatment_progress(uuid, uuid) to authenticated;
