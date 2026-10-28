-- SMYL — corrección de smyl_patient_timeline (20261027130000).
-- La primera rama del UNION no nombraba sus columnas, así que `timeline.event_at` no existía y la
-- función fallaba al ejecutarse en PostgreSQL 16 (verificado con una réplica del esquema).
-- Aquí se re-crea EXACTAMENTE la cronología original, sólo con los alias añadidos; no agrega eventos
-- nuevos. Es independiente de la radiografía asistida: se puede aplicar (y revertir) por separado.
-- Requiere 20261027130000 y las tablas de la Ficha 360 que esa migración consulta.
begin;

create or replace function public.smyl_patient_timeline(p_patient_id uuid,p_limit integer default 100)
returns table(event_at timestamptz,event_type text,title text,status text,reference_id uuid,metadata jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),250));
  v_schedule boolean:=false;
  v_proposal boolean:=false;
  v_finance boolean:=false;
  v_messages boolean:=false;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.read') then
    raise exception using errcode='42501',message='No tienes permiso para consultar la ficha clínica.';
  end if;
  if not exists(
    select 1 from public.camila_pacientes patient
    where patient.tenant_id=v_tenant and patient.id=p_patient_id
      and public.smyl_can_access_patient(patient.tenant_id,patient.id,'clinical')
  ) then
    raise exception using errcode='42501',message='El paciente no está disponible para tu rol.';
  end if;

  v_schedule:=public.smyl_has_permission(v_tenant,'schedule.read');
  v_proposal:=public.smyl_has_permission(v_tenant,'proposal.read');
  v_finance:=public.smyl_has_permission(v_tenant,'finance.read');
  v_messages:=public.smyl_has_permission(v_tenant,'messages.read')
    and public.smyl_can_access_patient(v_tenant,p_patient_id,'messages');

  return query
  select timeline.event_at,timeline.event_type,timeline.title,timeline.status,timeline.reference_id,timeline.metadata
  from (
    -- La primera rama nombra las columnas de la subconsulta: sin estos alias `timeline.event_at` no existe.
    select appointment.starts_at as event_at,'appointment'::text as event_type,'Cita registrada'::text as title,
      appointment.status::text as status,appointment.id as reference_id,'{}'::jsonb as metadata
    from public.smyl_appointments appointment
    where appointment.tenant_id=v_tenant and appointment.patient_id=p_patient_id and v_schedule
      and public.smyl_can_access_schedule_row(appointment.tenant_id,appointment.branch_id,appointment.professional_id,appointment.patient_id)

    union all
    select note.created_at,'clinical_note','Evolución clínica',note.status,note.id,
      jsonb_build_object('revision',note.revision)
    from public.smyl_clinical_notes note
    where note.tenant_id=v_tenant and note.patient_id=p_patient_id

    union all
    select patient_file.created_at,'file','Archivo clínico registrado',patient_file.status,patient_file.id,'{}'::jsonb
    from public.smyl_patient_files patient_file
    where patient_file.tenant_id=v_tenant and patient_file.patient_id=p_patient_id

    union all
    select dental.updated_at,'dental_record','Odontograma actualizado','documented',dental.patient_id,
      jsonb_build_object('revision',dental.revision)
    from public.smyl_dental_versions dental
    where dental.tenant_id=v_tenant and dental.patient_id=p_patient_id

    union all
    select photo.updated_at,'photo_review','Revisión fotográfica actualizada','reviewed',photo.case_id,
      jsonb_build_object('revision',photo.revision)
    from public.smyl_photo_reviews photo
    where photo.tenant_id=v_tenant and photo.patient_id=p_patient_id

    union all
    select radiograph.updated_at,'radiograph_review','Revisión radiográfica actualizada','reviewed',radiograph.study_id,
      jsonb_build_object('revision',radiograph.revision)
    from public.smyl_radiograph_reviews radiograph
    where radiograph.tenant_id=v_tenant and radiograph.patient_id=p_patient_id

    union all
    select plan.updated_at,'clinical_plan',
      case when plan.status='reviewed' then 'Plan de tratamiento revisado' else 'Plan de tratamiento actualizado' end,
      plan.status,plan.patient_id,jsonb_build_object('revision',plan.revision)
    from public.smyl_clinical_versions plan
    where plan.tenant_id=v_tenant and plan.patient_id=p_patient_id

    union all
    select proposal.updated_at,'proposal','Cotización actualizada',proposal.status,proposal.id,
      jsonb_build_object('revision',proposal.revision)
    from public.smyl_proposals proposal
    where proposal.tenant_id=v_tenant and proposal.patient_id=p_patient_id and v_proposal

    union all
    select proposal_event.occurred_at,'proposal_event',
      case proposal_event.event_type when 'presented' then 'Cotización presentada'
        when 'accepted' then 'Cotización aceptada' when 'declined' then 'Cotización no aceptada'
        else 'Cambios solicitados en cotización' end,
      proposal_event.event_type,proposal_event.id,
      jsonb_build_object('revision',proposal_event.proposal_revision,'channel',proposal_event.channel)
    from public.smyl_proposal_events proposal_event
    join public.smyl_proposals proposal on proposal.tenant_id=proposal_event.tenant_id and proposal.id=proposal_event.proposal_id
    where proposal.tenant_id=v_tenant and proposal.patient_id=p_patient_id and v_proposal

    union all
    select charge.created_at,'finance_charge','Cargo registrado',charge.status,charge.id,'{}'::jsonb
    from public.smyl_finance_charges charge
    where charge.tenant_id=v_tenant and charge.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(charge.tenant_id,charge.patient_id,charge.branch_id)

    union all
    select charge.voided_at,'finance_charge_voided','Cargo cancelado','voided',charge.id,'{}'::jsonb
    from public.smyl_finance_charges charge
    where charge.tenant_id=v_tenant and charge.patient_id=p_patient_id and charge.status='voided'
      and charge.voided_at is not null and v_finance
      and public.smyl_can_access_finance_patient(charge.tenant_id,charge.patient_id,charge.branch_id)

    union all
    select payment.paid_at,'finance_payment','Pago registrado','paid',payment.id,'{}'::jsonb
    from public.smyl_finance_payments payment
    where payment.tenant_id=v_tenant and payment.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(payment.tenant_id,payment.patient_id,payment.branch_id)

    union all
    select refund.refunded_at,'finance_refund','Reembolso registrado','refunded',refund.id,'{}'::jsonb
    from public.smyl_finance_refunds refund
    join public.smyl_finance_payments payment on payment.tenant_id=refund.tenant_id and payment.id=refund.payment_id
    where payment.tenant_id=v_tenant and payment.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(payment.tenant_id,payment.patient_id,payment.branch_id)

    union all
    select receipt.issued_at,'finance_receipt','Recibo emitido','issued',receipt.id,'{}'::jsonb
    from public.smyl_finance_receipts receipt
    join public.smyl_finance_payments payment on payment.tenant_id=receipt.tenant_id and payment.id=receipt.payment_id
    where payment.tenant_id=v_tenant and payment.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(payment.tenant_id,payment.patient_id,payment.branch_id)

    union all
    select draft.created_at,'cfdi','CFDI preparado',draft.status,draft.id,'{}'::jsonb
    from public.smyl_cfdi_drafts draft
    where draft.tenant_id=v_tenant and draft.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(draft.tenant_id,draft.patient_id,null)

    union all
    select handoff.created_at,'conversation_link','Conversación vinculada','linked',handoff.id,
      jsonb_build_object('channel',handoff.lana_channel)
    from public.camila_lana_handoffs handoff
    where handoff.tenant_id=v_tenant and handoff.patient_id=p_patient_id and v_messages

    union all
    select clinical_link.created_at,'conversation_file','Archivo de conversación vinculado',clinical_link.status,
      clinical_link.id,jsonb_build_object('channel',clinical_link.lana_channel)
    from public.camila_lana_clinical_links clinical_link
    where clinical_link.tenant_id=v_tenant and clinical_link.patient_id=p_patient_id and v_messages
  ) timeline
  order by timeline.event_at desc,timeline.event_type,timeline.reference_id,timeline.metadata::text
  limit v_limit;
end $$;
revoke all on function public.smyl_patient_timeline(uuid,integer) from public,anon,authenticated;
grant execute on function public.smyl_patient_timeline(uuid,integer) to authenticated;
comment on function public.smyl_patient_timeline(uuid,integer) is
  'Cronología longitudinal autorizada por tenant, paciente, permiso y alcance. Nunca devuelve cuerpos clínicos, mensajes, importes, datos fiscales ni documentos radiográficos.';

commit;
