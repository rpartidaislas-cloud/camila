-- SMYL radiografía asistida — Etapa 6: historia longitudinal.
-- Emparejamiento de fuentes comparables (mismo paciente, mismo tipo efectivo, QC completado y no
-- inutilizable), vínculo decidido por el profesional y eventos resumidos en la cronología de la
-- Ficha 360. Sin mediciones óseas (método no validado). Detrás de la bandera radiograph.longitudinal_v1.
-- Idempotente y aditivo; no se aplica sin autorización.
begin;

-- Tipo de estudio vigente: la última corrección profesional o, si no hay, el declarado.
create or replace function public.smyl_radiograph_effective_study_type(p_tenant uuid, p_source_id uuid)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(
    (select c.value from public.smyl_radiograph_source_corrections c
     where c.tenant_id = p_tenant and c.source_id = p_source_id and c.field = 'study_type'
     order by c.created_at desc limit 1),
    (select s.study_type_declared from public.smyl_radiograph_sources s where s.tenant_id = p_tenant and s.id = p_source_id));
$$;
revoke all on function public.smyl_radiograph_effective_study_type(uuid, uuid) from public, anon, authenticated;

-- Estado del último QC completado de una fuente ('usable','limited','unusable') o null.
create or replace function public.smyl_radiograph_qc_status(p_tenant uuid, p_source_id uuid)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select r.output->'quality'->>'status' from public.smyl_radiograph_ai_runs r
  where r.tenant_id = p_tenant and r.source_id = p_source_id and r.kind = 'qc' and r.status = 'completed'
  order by r.completed_at desc limit 1;
$$;
revoke all on function public.smyl_radiograph_qc_status(uuid, uuid) from public, anon, authenticated;

-- Otras fuentes del mismo paciente con veredicto explícito: nunca se comparan en silencio.
create or replace function public.smyl_radiograph_comparable_sources(p_source_id uuid)
returns table (source_id uuid, study_id uuid, study_type text, captured_at timestamptz, created_at timestamptz,
               qc_status text, verdict text, reason text, link_kind text, link_reason text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_source public.smyl_radiograph_sources; v_tenant uuid; v_type text; v_qc text;
begin
  select * into v_source from public.smyl_radiograph_sources s where s.id = p_source_id and s.tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_source.patient_id, 'clinical.read');
  if not public.smyl_radiograph_flag_enabled('radiograph.longitudinal_v1', v_tenant) then
    raise exception using errcode = '42501', message = 'La historia longitudinal no está habilitada para esta clínica.'; end if;
  v_type := public.smyl_radiograph_effective_study_type(v_tenant, p_source_id);
  v_qc := public.smyl_radiograph_qc_status(v_tenant, p_source_id);
  return query
  select o.id, o.study_id, public.smyl_radiograph_effective_study_type(v_tenant, o.id), o.captured_at, o.created_at,
    public.smyl_radiograph_qc_status(v_tenant, o.id),
    case
      when public.smyl_radiograph_effective_study_type(v_tenant, o.id) is distinct from v_type then 'incompatible'
      when v_qc is null or public.smyl_radiograph_qc_status(v_tenant, o.id) is null then 'incompatible'
      when v_qc = 'unusable' or public.smyl_radiograph_qc_status(v_tenant, o.id) = 'unusable' then 'incompatible'
      else 'comparable' end,
    case
      when public.smyl_radiograph_effective_study_type(v_tenant, o.id) is distinct from v_type then 'different_study_type'
      when v_qc is null or public.smyl_radiograph_qc_status(v_tenant, o.id) is null then 'missing_qc'
      when v_qc = 'unusable' or public.smyl_radiograph_qc_status(v_tenant, o.id) = 'unusable' then 'unusable_quality'
      else '' end,
    l.link_kind, l.reason
  from public.smyl_radiograph_sources o
  left join public.smyl_radiograph_study_links l on l.tenant_id = o.tenant_id and l.revoked_at is null
    and l.source_a = least(o.id, p_source_id) and l.source_b = greatest(o.id, p_source_id)
  where o.tenant_id = v_tenant and o.patient_id = v_source.patient_id and o.id <> p_source_id
  order by coalesce(o.captured_at, o.created_at) desc;
end;
$$;
revoke all on function public.smyl_radiograph_comparable_sources(uuid) from public, anon;
grant execute on function public.smyl_radiograph_comparable_sources(uuid) to authenticated;

-- Decisión profesional sobre el par: comparable o no comparable, con motivo. Idempotente; cambiar
-- de opinión revoca el vínculo anterior y conserva el historial. Audita 'compare'.
create or replace function public.smyl_radiograph_link_studies(p_source_a uuid, p_source_b uuid, p_link_kind text, p_reason text)
returns public.smyl_radiograph_study_links
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_a uuid := least(p_source_a, p_source_b); v_b uuid := greatest(p_source_a, p_source_b); v_sa public.smyl_radiograph_sources; v_sb public.smyl_radiograph_sources; v_tenant uuid; v_row public.smyl_radiograph_study_links;
begin
  if p_link_kind not in ('comparable','incompatible') then raise exception using errcode = '22023', message = 'Tipo de vínculo no válido.'; end if;
  if v_a = v_b then raise exception using errcode = '22023', message = 'Un estudio no se compara consigo mismo.'; end if;
  select * into v_sa from public.smyl_radiograph_sources s where s.id = v_a and s.tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  select * into v_sb from public.smyl_radiograph_sources s where s.id = v_b and s.tenant_id = v_sa.tenant_id;
  if not found or v_sb.patient_id <> v_sa.patient_id then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_sa.patient_id, 'clinical.write');
  if not public.smyl_radiograph_flag_enabled('radiograph.longitudinal_v1', v_tenant) then
    raise exception using errcode = '42501', message = 'La historia longitudinal no está habilitada para esta clínica.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('radiograph-link:' || v_a::text || v_b::text, 31));
  select * into v_row from public.smyl_radiograph_study_links l where l.tenant_id = v_tenant and l.source_a = v_a and l.source_b = v_b and l.revoked_at is null;
  if found then
    if v_row.link_kind = p_link_kind then return v_row; end if;
    update public.smyl_radiograph_study_links set revoked_at = clock_timestamp(), revoked_by = auth.uid() where id = v_row.id;
  end if;
  insert into public.smyl_radiograph_study_links(tenant_id, patient_id, source_a, source_b, link_kind, reason, created_by)
  values (v_tenant, v_sa.patient_id, v_a, v_b, p_link_kind, p_reason, auth.uid()) returning * into v_row;
  perform public.smyl_radiograph_log_event(v_tenant, v_sa.patient_id, v_a, 'compare', v_b);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_link_studies(uuid, uuid, text, text) from public, anon;
grant execute on function public.smyl_radiograph_link_studies(uuid, uuid, text, text) to authenticated;

-- Cronología de la Ficha 360: se añaden fuentes radiográficas v2 e informes como eventos resumidos
-- (tipo de estudio, estado, revisión). Nunca el documento, rutas de Storage ni texto clínico.
-- Mismo contrato de seis columnas y mismas puertas por permiso/alcance que 20261027130000.
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
    -- La primera rama nombra las columnas de la subconsulta: sin estos alias `timeline.event_at` no existe
    -- (así está en 20261027130000; aquí se corrige al re-crear la función).
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
    select source.created_at,'radiograph_source','Radiografía registrada para revisión asistida','registered',source.id,
      jsonb_build_object('studyType',public.smyl_radiograph_effective_study_type(v_tenant,source.id),'studyId',source.study_id)
    from public.smyl_radiograph_sources source
    where source.tenant_id=v_tenant and source.patient_id=p_patient_id

    union all
    select coalesce(report.signed_at,report.updated_at),'radiograph_report',
      case when report.status='signed' then 'Informe radiográfico firmado' else 'Informe radiográfico en borrador' end,
      report.status,report.id,jsonb_build_object('revision',report.revision,'sourceId',report.source_id)
    from public.smyl_radiograph_reports report
    where report.tenant_id=v_tenant and report.patient_id=p_patient_id

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

comment on function public.smyl_radiograph_comparable_sources(uuid) is 'Fuentes del mismo paciente con veredicto comparable/incompatible y motivo. Nunca compara en silencio.';
commit;
