-- Captación pública segura para el directorio profesional.
-- Los datos enviados por una persona anónima permanecen separados del
-- expediente clínico hasta que un integrante autorizado los revise y vincule.

begin;

create table public.smyl_public_appointment_intakes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  appointment_request_id uuid not null,
  profile_slug text not null
    check (profile_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(profile_slug) between 3 and 80),
  contact_name text not null
    check (char_length(trim(contact_name)) between 2 and 150),
  email text not null default '' check (char_length(email) <= 254),
  phone text not null default '' check (char_length(phone) <= 60),
  preferred_contact text not null default 'any'
    check (preferred_contact in ('any','phone','whatsapp','email')),
  requested_date date,
  requested_period text not null default 'any'
    check (requested_period in ('any','morning','afternoon')),
  patient_message text not null default '' check (char_length(patient_message) <= 600),
  privacy_consent boolean not null check (privacy_consent),
  privacy_consent_at timestamptz not null default clock_timestamp(),
  privacy_notice_version text not null
    check (privacy_notice_version ~ '^public-appointment-v[0-9]+$'),
  status text not null default 'pending'
    check (status in ('pending','linked','accepted','rejected','expired')),
  linked_patient_id uuid,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  retention_expires_at timestamptz not null default (clock_timestamp() + interval '90 days'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, appointment_request_id),
  foreign key (tenant_id, appointment_request_id)
    references public.smyl_appointment_requests(tenant_id, id) on delete cascade,
  foreign key (tenant_id, linked_patient_id)
    references public.camila_pacientes(tenant_id, id) on delete restrict,
  check (email <> '' or char_length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10),
  check (
    preferred_contact = 'any'
    or (preferred_contact in ('phone','whatsapp') and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10)
    or (preferred_contact = 'email' and email <> '')
  ),
  check (
    (status = 'pending' and linked_patient_id is null and reviewed_at is null)
    or (status in ('linked','accepted') and linked_patient_id is not null and reviewed_at is not null)
    or status in ('rejected','expired')
  )
);

create index smyl_public_appointment_intakes_pending_idx
  on public.smyl_public_appointment_intakes(tenant_id, created_at)
  where status = 'pending';
create index smyl_public_appointment_intakes_retention_idx
  on public.smyl_public_appointment_intakes(retention_expires_at)
  where status in ('accepted','rejected','expired');

alter table public.smyl_public_appointment_intakes enable row level security;
revoke all on public.smyl_public_appointment_intakes from public, anon, authenticated;
grant select on public.smyl_public_appointment_intakes to authenticated;

create policy smyl_public_appointment_intakes_read
  on public.smyl_public_appointment_intakes for select to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'schedule.read')
    and exists (
      select 1
      from public.smyl_appointment_requests request
      where request.tenant_id = smyl_public_appointment_intakes.tenant_id
        and request.id = smyl_public_appointment_intakes.appointment_request_id
        and public.smyl_can_access_schedule_row(
          request.tenant_id,
          request.preferred_branch_id,
          coalesce(request.preferred_professional_id, request.professional_id),
          request.patient_id
        )
    )
  );

create trigger smyl_public_appointment_intakes_touch
  before update on public.smyl_public_appointment_intakes
  for each row execute function public.smyl_touch_updated_at();

-- La bitácora registra el ciclo de revisión, pero no duplica nombre, contacto
-- ni mensaje en un historial de conservación indefinida.
create or replace function public.smyl_audit_public_appointment_intake()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
    v_id := old.id;
  else
    v_tenant := new.tenant_id;
    v_id := new.id;
  end if;
  v_before := case when tg_op = 'INSERT' then null else jsonb_build_object(
    'status', old.status,
    'appointment_request_id', old.appointment_request_id,
    'linked_patient_id', old.linked_patient_id,
    'privacy_consent_at', old.privacy_consent_at,
    'privacy_notice_version', old.privacy_notice_version,
    'reviewed_at', old.reviewed_at
  ) end;
  v_after := case when tg_op = 'DELETE' then null else jsonb_build_object(
    'status', new.status,
    'appointment_request_id', new.appointment_request_id,
    'linked_patient_id', new.linked_patient_id,
    'privacy_consent_at', new.privacy_consent_at,
    'privacy_notice_version', new.privacy_notice_version,
    'reviewed_at', new.reviewed_at
  ) end;
  insert into public.smyl_audit_events(
    tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    v_tenant, auth.uid(), lower(tg_op), tg_table_name, v_id::text,
    v_before, v_after
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.smyl_audit_public_appointment_intake()
  from public, anon, authenticated;
create trigger smyl_public_appointment_intakes_audit
  after insert or update or delete on public.smyl_public_appointment_intakes
  for each row execute function public.smyl_audit_public_appointment_intake();

-- Único punto de escritura anónima indirecta. Sólo service_role puede llamarlo;
-- valida nuevamente perfil, servicio y sede y crea ambas filas atómicamente.
create or replace function public.smyl_create_public_appointment_intake(
  p_request_id uuid,
  p_intake_id uuid,
  p_tenant_id uuid,
  p_profile_slug text,
  p_professional_id uuid,
  p_service_id uuid,
  p_branch_id uuid,
  p_requested_date date,
  p_requested_period text,
  p_contact_name text,
  p_email text default '',
  p_phone text default '',
  p_preferred_contact text default 'any',
  p_message text default '',
  p_privacy_consent boolean default false,
  p_privacy_notice_version text default ''
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text := trim(coalesce(p_contact_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := trim(coalesce(p_phone, ''));
  v_preferred_contact text := lower(trim(coalesce(p_preferred_contact, 'any')));
  v_requested_period text := lower(trim(coalesce(p_requested_period, 'any')));
  v_message text := trim(coalesce(p_message, ''));
  v_notice_version text := trim(coalesce(p_privacy_notice_version, ''));
begin
  if p_request_id is null or p_intake_id is null or p_tenant_id is null
     or p_professional_id is null or p_service_id is null or p_branch_id is null then
    raise exception using errcode = '22023', message = 'La solicitud pública está incompleta.';
  end if;
  if char_length(v_name) not between 2 and 150
     or char_length(v_email) > 254 or char_length(v_phone) > 60
     or char_length(v_message) > 600
     or (v_email = '' and char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10) then
    raise exception using errcode = '22023', message = 'Los datos de contacto no son válidos.';
  end if;
  if v_preferred_contact not in ('any','phone','whatsapp','email')
     or (v_preferred_contact in ('phone','whatsapp') and char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10)
     or (v_preferred_contact = 'email' and v_email = '') then
    raise exception using errcode = '22023', message = 'El medio de contacto no es válido.';
  end if;
  if v_requested_period not in ('any','morning','afternoon')
     or (p_requested_date is not null and p_requested_date < current_date) then
    raise exception using errcode = '22023', message = 'La preferencia de fecha u horario no es válida.';
  end if;
  if not coalesce(p_privacy_consent, false)
     or v_notice_version !~ '^public-appointment-v[0-9]+$' then
    raise exception using errcode = '22023', message = 'Falta autorizar el uso de los datos.';
  end if;
  if not exists (
    select 1 from public.smyl_professional_profiles profile
    join public.smyl_professionals professional
      on professional.tenant_id = profile.tenant_id
     and professional.id = profile.professional_id
     and professional.active
    where profile.tenant_id = p_tenant_id
      and profile.professional_id = p_professional_id
      and profile.slug = lower(trim(p_profile_slug))
      and profile.status = 'published'
  ) then
    raise exception using errcode = 'P0002', message = 'El perfil no está disponible.';
  end if;
  if not exists (
    select 1 from public.smyl_professional_services assignment
    join public.smyl_services service
      on service.tenant_id = assignment.tenant_id
     and service.id = assignment.service_id
     and service.active
    where assignment.tenant_id = p_tenant_id
      and assignment.professional_id = p_professional_id
      and assignment.service_id = p_service_id
  ) then
    raise exception using errcode = '23514', message = 'El tratamiento no pertenece a este perfil.';
  end if;
  if not exists (
    select 1 from public.smyl_professional_branches assignment
    join public.smyl_branches branch
      on branch.tenant_id = assignment.tenant_id
     and branch.id = assignment.branch_id
     and branch.active
    where assignment.tenant_id = p_tenant_id
      and assignment.professional_id = p_professional_id
      and assignment.branch_id = p_branch_id
  ) then
    raise exception using errcode = '23514', message = 'La ubicación no pertenece a este perfil.';
  end if;

  insert into public.smyl_appointment_requests(
    id, tenant_id, patient_id, service_id, professional_id,
    preferred_professional_id, preferred_branch_id, requested_start,
    source, external_request_key, patient_message, status
  ) values (
    p_request_id, p_tenant_id, null, p_service_id, p_professional_id,
    p_professional_id, p_branch_id, null,
    'patient_portal', 'public:' || p_intake_id::text,
    'Solicitud pública pendiente de validar contacto.', 'pending'
  );

  insert into public.smyl_public_appointment_intakes(
    id, tenant_id, appointment_request_id, profile_slug,
    contact_name, email, phone, preferred_contact,
    requested_date, requested_period, patient_message,
    privacy_consent, privacy_notice_version
  ) values (
    p_intake_id, p_tenant_id, p_request_id, lower(trim(p_profile_slug)),
    v_name, v_email, v_phone, v_preferred_contact,
    p_requested_date, v_requested_period, v_message,
    true, v_notice_version
  );

  return p_request_id;
end;
$$;

revoke all on function public.smyl_create_public_appointment_intake(
  uuid,uuid,uuid,text,uuid,uuid,uuid,date,text,text,text,text,text,text,boolean,text
) from public, anon, authenticated;
grant execute on function public.smyl_create_public_appointment_intake(
  uuid,uuid,uuid,text,uuid,uuid,uuid,date,text,text,text,text,text,text,boolean,text
) to service_role;

-- La revisión humana sólo vincula a un paciente ya existente y accesible. La
-- creación de pacientes sigue ocurriendo en el alta profesional, no aquí.
create or replace function public.smyl_link_public_appointment_intake(
  p_request_id uuid,
  p_patient_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_request public.smyl_appointment_requests;
begin
  if v_tenant is null
     or not public.smyl_has_permission(v_tenant, 'schedule.manage')
     or not public.smyl_has_permission(v_tenant, 'patients.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para vincular esta solicitud.';
  end if;

  select * into v_request
  from public.smyl_appointment_requests
  where tenant_id = v_tenant and id = p_request_id
  for update;

  if not found or v_request.status <> 'pending' or v_request.source <> 'patient_portal' then
    raise exception using errcode = '23514', message = 'La solicitud ya fue atendida o no existe.';
  end if;
  if not public.smyl_can_access_schedule_row(
    v_tenant,
    v_request.preferred_branch_id,
    coalesce(v_request.preferred_professional_id, v_request.professional_id),
    null
  ) then
    raise exception using errcode = '42501', message = 'La solicitud está fuera de tu alcance.';
  end if;
  if not exists (
    select 1 from public.camila_pacientes patient
    where patient.tenant_id = v_tenant
      and patient.id = p_patient_id
      and public.smyl_can_access_patient(v_tenant, patient.id, 'patients')
  ) then
    raise exception using errcode = 'P0002', message = 'El paciente no está disponible.';
  end if;

  update public.smyl_appointment_requests
  set patient_id = p_patient_id
  where tenant_id = v_tenant and id = p_request_id;

  update public.smyl_public_appointment_intakes
  set status = 'linked', linked_patient_id = p_patient_id,
      reviewed_by = auth.uid(), reviewed_at = clock_timestamp()
  where tenant_id = v_tenant and appointment_request_id = p_request_id and status = 'pending';

  if not found then
    raise exception using errcode = '23514', message = 'La captación pública ya fue revisada o no existe.';
  end if;
end;
$$;

revoke all on function public.smyl_link_public_appointment_intake(uuid,uuid)
  from public, anon;
grant execute on function public.smyl_link_public_appointment_intake(uuid,uuid)
  to authenticated;

create or replace function public.smyl_sync_public_appointment_intake_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'accepted' then
    update public.smyl_public_appointment_intakes
    set status = 'accepted', reviewed_by = coalesce(reviewed_by, new.decided_by),
        reviewed_at = coalesce(reviewed_at, new.decided_at, clock_timestamp())
    where tenant_id = new.tenant_id and appointment_request_id = new.id and status = 'linked';
  elsif new.status in ('rejected','expired') then
    update public.smyl_public_appointment_intakes
    set status = new.status, reviewed_by = coalesce(reviewed_by, new.decided_by),
        reviewed_at = coalesce(reviewed_at, new.decided_at, clock_timestamp())
    where tenant_id = new.tenant_id and appointment_request_id = new.id
      and status in ('pending','linked');
  end if;
  return new;
end;
$$;

revoke all on function public.smyl_sync_public_appointment_intake_status()
  from public, anon, authenticated;

create trigger smyl_public_appointment_intake_status_sync
  after update of status on public.smyl_appointment_requests
  for each row execute function public.smyl_sync_public_appointment_intake_status();

comment on table public.smyl_public_appointment_intakes is
  'Captación anónima separada del expediente. Requiere revisión humana antes de vincular patient_id.';
comment on column public.smyl_public_appointment_intakes.retention_expires_at is
  'Fecha máxima propuesta para depuración; la eliminación debe ejecutarse mediante mantenimiento auditado.';
comment on function public.smyl_link_public_appointment_intake(uuid,uuid) is
  'Vincula una captación pública a un paciente existente después de revisión humana; nunca crea pacientes.';

commit;
