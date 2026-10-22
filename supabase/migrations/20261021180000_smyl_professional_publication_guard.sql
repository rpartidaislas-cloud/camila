-- Endurecimiento append-only del directorio profesional público.
-- La publicación y la verificación son estados distintos: una ficha heredada
-- puede seguir visible, pero sólo obtiene la insignia y capta solicitudes si
-- está completa y fue verificada documentalmente.

begin;

create or replace function public.smyl_reset_profile_verification_on_cv()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.cv_storage_path is distinct from new.cv_storage_path then
    new.verification_status := 'unverified';
    new.verification_requested_at := null;
    new.verified_at := null;
    new.verified_by := null;
    new.verification_note := null;
    if old.status = 'published' then
      new.status := 'review';
      new.published_at := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.smyl_reset_profile_verification_on_license()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.license_number is distinct from new.license_number then
    update public.smyl_professional_profiles
    set verification_status = 'unverified',
        verification_requested_at = null,
        verified_at = null,
        verified_by = null,
        verification_note = null,
        status = case when status = 'published' then 'review' else status end,
        published_at = case when status = 'published' then null else published_at end,
        updated_by = auth.uid()
    where tenant_id = new.tenant_id and professional_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.smyl_guard_professional_profile_publication()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_specialty text;
  v_license text;
  v_professional_active boolean;
begin
  if new.status <> 'published' or new.verification_status <> 'verified' then
    return new;
  end if;

  select specialty, license_number, active
  into v_specialty, v_license, v_professional_active
  from public.smyl_professionals
  where tenant_id = new.tenant_id and id = new.professional_id;

  if not found or not coalesce(v_professional_active, false)
     or nullif(btrim(coalesce(new.photo_path, '')), '') is null
     or char_length(btrim(coalesce(new.headline, ''))) < 12
     or char_length(btrim(coalesce(new.bio, ''))) < 80
     or nullif(btrim(coalesce(v_specialty, '')), '') is null
     or nullif(btrim(coalesce(v_license, '')), '') is null
     or not exists (
       select 1
       from public.smyl_professional_branches assignment
       join public.smyl_branches branch
         on branch.tenant_id = assignment.tenant_id
        and branch.id = assignment.branch_id
        and branch.active
       where assignment.tenant_id = new.tenant_id
         and assignment.professional_id = new.professional_id
     )
     or not exists (
       select 1
       from public.smyl_professional_services assignment
       join public.smyl_services service
         on service.tenant_id = assignment.tenant_id
        and service.id = assignment.service_id
        and service.active
       where assignment.tenant_id = new.tenant_id
         and assignment.professional_id = new.professional_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'Para mostrar la ficha como verificada debe completar foto, especialidad, cédula, presentación, biografía, sede y servicio.';
  end if;
  return new;
end;
$$;

revoke all on function public.smyl_guard_professional_profile_publication()
  from public, anon, authenticated;

drop trigger if exists smyl_professional_profiles_z_publication_guard
  on public.smyl_professional_profiles;
create trigger smyl_professional_profiles_z_publication_guard
  before insert or update of status, verification_status, photo_path, headline, bio
  on public.smyl_professional_profiles
  for each row execute function public.smyl_guard_professional_profile_publication();

create or replace view public.smyl_professional_directory
with (security_barrier = true)
as
select
  profile.slug,
  profile.tenant_id,
  professional.display_name,
  professional.specialty,
  professional.license_number,
  profile.headline,
  profile.bio,
  profile.years_experience,
  profile.languages,
  profile.treatment_focus,
  profile.education,
  profile.memberships,
  profile.public_phone,
  profile.photo_path,
  profile.accepts_new_patients,
  profile.published_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', branch.id,
      'name', branch.name,
      'city', branch.city,
      'state', branch.state,
      'address', branch.address_line
    ) order by branch.is_default desc, branch.name)
    from public.smyl_professional_branches assignment
    join public.smyl_branches branch
      on branch.tenant_id = assignment.tenant_id
     and branch.id = assignment.branch_id
    where assignment.tenant_id = profile.tenant_id
      and assignment.professional_id = profile.professional_id
      and branch.active
  ), '[]'::jsonb) as locations,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', service.id,
      'name', service.name,
      'duration_minutes', service.duration_minutes
    ) order by service.name)
    from public.smyl_professional_services assignment
    join public.smyl_services service
      on service.tenant_id = assignment.tenant_id
     and service.id = assignment.service_id
    where assignment.tenant_id = profile.tenant_id
      and assignment.professional_id = profile.professional_id
      and service.active
  ), '[]'::jsonb) as services,
  (
    profile.verification_status = 'verified'
    and nullif(btrim(coalesce(profile.photo_path, '')), '') is not null
    and char_length(btrim(coalesce(profile.headline, ''))) >= 12
    and char_length(btrim(coalesce(profile.bio, ''))) >= 80
    and nullif(btrim(coalesce(professional.specialty, '')), '') is not null
    and nullif(btrim(coalesce(professional.license_number, '')), '') is not null
  ) as verified_profile,
  profile.verified_at
from public.smyl_professional_profiles profile
join public.smyl_professionals professional
  on professional.tenant_id = profile.tenant_id
 and professional.id = profile.professional_id
 and professional.active
where profile.status = 'published'
  and exists (
    select 1 from public.smyl_professional_branches assignment
    join public.smyl_branches branch
      on branch.tenant_id = assignment.tenant_id
     and branch.id = assignment.branch_id and branch.active
    where assignment.tenant_id = profile.tenant_id
      and assignment.professional_id = profile.professional_id
  )
  and exists (
    select 1 from public.smyl_professional_services assignment
    join public.smyl_services service
      on service.tenant_id = assignment.tenant_id
     and service.id = assignment.service_id and service.active
    where assignment.tenant_id = profile.tenant_id
      and assignment.professional_id = profile.professional_id
  );

revoke all on public.smyl_professional_directory from public;
grant select on public.smyl_professional_directory to anon, authenticated;

-- Sustituye la RPC creada en 20261021170000 sin cambiar su firma pública.
-- El perfil se vuelve a validar dentro de la misma transacción, aunque la Edge
-- Function ya lo haya consultado antes.
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
    select 1
    from public.smyl_professional_profiles profile
    join public.smyl_professionals professional
      on professional.tenant_id = profile.tenant_id
     and professional.id = profile.professional_id
     and professional.active
    where profile.tenant_id = p_tenant_id
      and profile.professional_id = p_professional_id
      and profile.slug = lower(trim(p_profile_slug))
      and profile.status = 'published'
      and profile.verification_status = 'verified'
      and profile.accepts_new_patients
      and nullif(btrim(coalesce(profile.photo_path, '')), '') is not null
      and char_length(btrim(coalesce(profile.headline, ''))) >= 12
      and char_length(btrim(coalesce(profile.bio, ''))) >= 80
      and nullif(btrim(coalesce(professional.specialty, '')), '') is not null
      and nullif(btrim(coalesce(professional.license_number, '')), '') is not null
  ) then
    raise exception using errcode = 'P0002', message = 'El perfil no acepta solicitudes nuevas.';
  end if;
  if not exists (
    select 1 from public.smyl_professional_services assignment
    join public.smyl_services service
      on service.tenant_id = assignment.tenant_id
     and service.id = assignment.service_id and service.active
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
     and branch.id = assignment.branch_id and branch.active
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

comment on function public.smyl_guard_professional_profile_publication() is
  'Impide marcar como verificada una ficha sin foto, contenido mínimo, especialidad, cédula, sede y servicio activos.';
comment on view public.smyl_professional_directory is
  'Directorio público de fichas publicadas; verified_profile sólo es true con verificación interna y contenido completo.';

commit;
