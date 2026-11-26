-- SMYL · Expediente regulatorio por clínica.
-- Registra metadatos y confirmaciones administrativas; nunca PHI ni archivos clínicos.
-- Este módulo organiza evidencia. No emite certificaciones ni sustituye a COFEPRIS.
begin;

create table public.smyl_regulatory_evidence (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  requirement_id text not null check (requirement_id in (
    'operation_notice','sanitary_responsible','professional_credentials','daily_registry',
    'clinical_record_policy','informed_consent_templates','tenant_privacy_notice',
    'xray_license','radiation_protection','rpbi_contract','advertising_notice'
  )),
  status text not null default 'pending' check (status in ('pending','in_review','verified','not_applicable')),
  reference text not null default '' check (char_length(reference) <= 240),
  issued_on date,
  expires_on date,
  notes text not null default '' check (char_length(notes) <= 1200),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, requirement_id),
  check (expires_on is null or issued_on is null or expires_on >= issued_on),
  check ((status = 'verified' and confirmed_by is not null and confirmed_at is not null) or status <> 'verified'),
  check (status <> 'not_applicable' or char_length(btrim(notes)) >= 8)
);

alter table public.smyl_regulatory_evidence enable row level security;
create policy smyl_regulatory_evidence_read on public.smyl_regulatory_evidence
  for select to authenticated
  using (public.smyl_has_permission(tenant_id,'settings.manage'));

grant select on public.smyl_regulatory_evidence to authenticated;
revoke insert,update,delete on public.smyl_regulatory_evidence from anon,authenticated;
revoke all on public.smyl_regulatory_evidence from anon;

create trigger smyl_regulatory_evidence_touch before update on public.smyl_regulatory_evidence
  for each row execute function public.smyl_touch_updated_at();
create trigger smyl_regulatory_evidence_audit after insert or update or delete on public.smyl_regulatory_evidence
  for each row execute function public.smyl_audit_row();

create or replace function public.smyl_regulatory_readiness_report()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_requirements jsonb;
  v_completed integer:=0;
  v_total integer:=0;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'settings.manage') then
    raise exception using errcode='42501',message='Solo administración puede consultar el expediente regulatorio.';
  end if;

  with definitions(id,section,label,description,allows_na,position) as (values
    ('operation_notice','Clínica','Aviso de funcionamiento','Aviso presentado para el establecimiento y domicilio que presta la atención.',false,10),
    ('sanitary_responsible','Clínica','Responsable sanitario','Nombramiento y datos vigentes cuando la modalidad del establecimiento lo requiera.',true,20),
    ('professional_credentials','Profesionales','Cédulas y especialidades','Documentos de cada profesional activo y especialidad anunciada.',false,30),
    ('daily_registry','Expediente','Registro diario de pacientes','Proceso documentado para conservar la relación diaria de atenciones.',false,40),
    ('clinical_record_policy','Expediente','Conservación del expediente','Política que prohíbe borrar el expediente antes del plazo legal aplicable.',false,50),
    ('informed_consent_templates','Expediente','Consentimientos informados','Formatos por procedimiento, con versión, riesgos, alternativas y firmas.',false,60),
    ('tenant_privacy_notice','Privacidad','Aviso de privacidad de la clínica','Texto propio de la clínica con domicilio, finalidades y medios ARCO.',false,70),
    ('xray_license','Radiología','Licencia o autorización de rayos X','Documento vigente para los equipos y la instalación, si la clínica opera rayos X.',true,80),
    ('radiation_protection','Radiología','Protección radiológica','Responsable, programa, dosimetría y controles aplicables, si se opera rayos X.',true,90),
    ('rpbi_contract','Operación','Manejo de RPBI','Contrato, recolecciones y bitácoras del manejo de residuos.',true,100),
    ('advertising_notice','Publicidad','Aviso o permiso de publicidad','Evidencia aplicable a los medios y campañas utilizados por la clínica.',true,110)
  ), rows as (
    select d.*,
      case when e.expires_on is not null and e.expires_on < current_date then 'expired'
           else coalesce(e.status,'pending') end as effective_status,
      coalesce(e.reference,'') as reference,e.issued_on,e.expires_on,coalesce(e.notes,'') as notes,
      e.confirmed_at,e.updated_at,
      case when e.expires_on is not null and e.expires_on < current_date then false
           when e.status='verified' then true
           when e.status='not_applicable' and d.allows_na then true
           else false end as passed
    from definitions d
    left join public.smyl_regulatory_evidence e
      on e.tenant_id=v_tenant and e.requirement_id=d.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'section',section,'label',label,'description',description,'allows_not_applicable',allows_na,
      'status',effective_status,'reference',reference,'issued_on',issued_on,'expires_on',expires_on,
      'notes',notes,'confirmed_at',confirmed_at,'updated_at',updated_at,'passed',passed
    ) order by position),'[]'::jsonb),count(*) filter(where passed),count(*)
    into v_requirements,v_completed,v_total from rows;

  return jsonb_build_object(
    'generated_at',now(),
    'contains_phi',false,
    'certifies_compliance',false,
    'scope','tenant_evidence',
    'status',case when v_total>0 and v_completed=v_total then 'evidence_complete' else 'incomplete' end,
    'completed',v_completed,
    'total',v_total,
    'requirements',v_requirements
  );
end;
$$;

create or replace function public.smyl_set_regulatory_evidence(
  p_requirement_id text,
  p_status text,
  p_reference text default '',
  p_issued_on date default null,
  p_expires_on date default null,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_allows_na boolean;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'settings.manage') then
    raise exception using errcode='42501',message='Solo administración puede actualizar el expediente regulatorio.';
  end if;
  if p_requirement_id not in (
    'operation_notice','sanitary_responsible','professional_credentials','daily_registry',
    'clinical_record_policy','informed_consent_templates','tenant_privacy_notice',
    'xray_license','radiation_protection','rpbi_contract','advertising_notice'
  ) then
    raise exception using errcode='22023',message='Requisito regulatorio no reconocido.';
  end if;
  if p_status not in ('pending','in_review','verified','not_applicable') then
    raise exception using errcode='22023',message='Estado regulatorio no reconocido.';
  end if;
  v_allows_na:=p_requirement_id in ('sanitary_responsible','xray_license','radiation_protection','rpbi_contract','advertising_notice');
  if p_status='not_applicable' and (not v_allows_na or char_length(btrim(coalesce(p_notes,'')))<8) then
    raise exception using errcode='22023',message='Documenta por qué este requisito no aplica a la clínica.';
  end if;
  if p_status='verified' and char_length(btrim(coalesce(p_reference,'')))<2 then
    raise exception using errcode='22023',message='Captura el folio, referencia o ubicación del comprobante.';
  end if;
  if p_expires_on is not null and p_issued_on is not null and p_expires_on<p_issued_on then
    raise exception using errcode='22023',message='La vigencia no puede terminar antes de la fecha de emisión.';
  end if;

  insert into public.smyl_regulatory_evidence(
    tenant_id,requirement_id,status,reference,issued_on,expires_on,notes,
    confirmed_by,confirmed_at,updated_by
  ) values (
    v_tenant,p_requirement_id,p_status,btrim(coalesce(p_reference,'')),p_issued_on,p_expires_on,btrim(coalesce(p_notes,'')),
    case when p_status='verified' then auth.uid() else null end,
    case when p_status='verified' then now() else null end,auth.uid()
  ) on conflict(tenant_id,requirement_id) do update set
    status=excluded.status,reference=excluded.reference,issued_on=excluded.issued_on,
    expires_on=excluded.expires_on,notes=excluded.notes,confirmed_by=excluded.confirmed_by,
    confirmed_at=excluded.confirmed_at,updated_by=auth.uid();

  return public.smyl_regulatory_readiness_report();
end;
$$;

revoke all on function public.smyl_regulatory_readiness_report() from public,anon;
revoke all on function public.smyl_set_regulatory_evidence(text,text,text,date,date,text) from public,anon;
grant execute on function public.smyl_regulatory_readiness_report() to authenticated;
grant execute on function public.smyl_set_regulatory_evidence(text,text,text,date,date,text) to authenticated;

comment on table public.smyl_regulatory_evidence is 'Metadatos administrativos del expediente regulatorio de cada clínica; no contiene PHI ni certifica cumplimiento.';
comment on function public.smyl_regulatory_readiness_report() is 'Organiza evidencia regulatoria del tenant sin afirmar validación o certificación de COFEPRIS.';
commit;
