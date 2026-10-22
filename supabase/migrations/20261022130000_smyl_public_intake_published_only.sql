-- SMYL · Captación pública: basta con que la ficha esté publicada.
--
-- La versión anterior de smyl_create_public_appointment_intake exigía además
-- verification_status = 'verified'. Desde hoy el dueño puede publicar su ficha
-- sin pasar por la verificación interna (v10), así que esa condición dejaba a
-- toda ficha publicada-sin-verificar visible pero incapaz de recibir
-- solicitudes ("El perfil no acepta solicitudes nuevas"). La verificación
-- sigue existiendo como insignia pública (verified_profile en la vista); ya no
-- condiciona la captación. El resto de requisitos (foto, presentación,
-- biografía, especialidad, cédula, acepta pacientes) se conserva.

begin;

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

commit;
