/* Stage 8: clinic-wide treatment milestones, aggregated and free of patient identifiers. */
begin;

alter table public.smyl_appointments drop constraint if exists smyl_appointments_source_check;
alter table public.smyl_appointments add constraint smyl_appointments_source_check
  check (source in ('manual','assistant_request','inbox','patient_portal','accepted_proposal'));

create or replace function public.smyl_treatment_operations(p_from date,p_to date)
returns jsonb language plpgsql security definer stable set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_proposal boolean; v_finance boolean; v_schedule boolean; v_clinical boolean;
  v_accepted bigint:=0; v_charge_batches bigint:=0; v_scheduled bigint:=0;
  v_completed bigint:=0; v_documented bigint:=0;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinic.read') then
    raise exception using errcode='42501',message='Sin permiso para consultar el recorrido de tratamientos.';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then
    raise exception using errcode='22023',message='El periodo debe ser válido y no mayor a 366 días.';
  end if;
  v_proposal:=public.smyl_has_permission(v_tenant,'proposal.read');
  v_finance:=public.smyl_has_permission(v_tenant,'finance.read');
  v_schedule:=public.smyl_has_permission(v_tenant,'schedule.read');
  v_clinical:=public.smyl_has_permission(v_tenant,'clinical.read');

  if v_proposal then
    select count(*) into v_accepted from public.smyl_proposal_events
    where tenant_id=v_tenant and event_type='accepted'
      and occurred_at>=p_from::timestamptz and occurred_at<(p_to+1)::timestamptz;
  end if;
  if v_finance then
    select count(*) into v_charge_batches from public.smyl_proposal_charge_batches
    where tenant_id=v_tenant and created_at>=p_from::timestamptz and created_at<(p_to+1)::timestamptz;
  end if;
  if v_schedule then
    select count(*) into v_scheduled from public.smyl_appointments
    where tenant_id=v_tenant and source='accepted_proposal'
      and created_at>=p_from::timestamptz and created_at<(p_to+1)::timestamptz;
    select count(distinct e.appointment_id) into v_completed
    from public.smyl_appointment_events e
    join public.smyl_appointments a on a.tenant_id=e.tenant_id and a.id=e.appointment_id
    where e.tenant_id=v_tenant and a.source='accepted_proposal' and e.to_status='completed'
      and e.created_at>=p_from::timestamptz and e.created_at<(p_to+1)::timestamptz;
  end if;
  if v_clinical then
    select count(distinct n.appointment_id) into v_documented
    from public.smyl_clinical_notes n
    join public.smyl_appointments a on a.tenant_id=n.tenant_id and a.id=n.appointment_id
    where n.tenant_id=v_tenant and a.source='accepted_proposal' and n.status='signed'
      and n.signed_at>=p_from::timestamptz and n.signed_at<(p_to+1)::timestamptz;
  end if;

  return jsonb_build_object(
    'scope','milestones_in_period','period',jsonb_build_object('from',p_from,'to',p_to),
    'capabilities',jsonb_build_object('proposal',v_proposal,'finance',v_finance,'schedule',v_schedule,'clinical',v_clinical),
    'accepted',case when v_proposal then v_accepted else null end,
    'charge_batches',case when v_finance then v_charge_batches else null end,
    'scheduled',case when v_schedule then v_scheduled else null end,
    'completed',case when v_schedule then v_completed else null end,
    'documented',case when v_clinical then v_documented else null end,
    'generated_at',now()
  );
end $$;

revoke all on function public.smyl_treatment_operations(date,date) from public,anon;
grant execute on function public.smyl_treatment_operations(date,date) to authenticated;

comment on function public.smyl_treatment_operations(date,date) is
  'Clinic-wide milestone activity for a period; contains no patient identifiers and is not a cohort conversion funnel.';

commit;
