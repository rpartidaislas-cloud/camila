-- Vinculación automática y segura entre una conversación accesible de LANA
-- y la identidad del paciente/prospecto en SMYL.
--
-- Abrir el chat puede crear o reutilizar el contacto, pero nunca abre un caso
-- clínico. El caso sólo se materializa después de una acción clínica explícita.

begin;

alter table public.camila_lana_handoffs
  alter column case_id drop not null;

comment on column public.camila_lana_handoffs.case_id is
  'Caso clínico opcional. La vinculación automática sólo enlaza conversación y paciente; una acción clínica explícita crea el caso.';

create or replace function public.smyl_normalize_contact_phone(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when length(regexp_replace(coalesce(p_value, ''), '\D', '', 'g')) = 10
      then regexp_replace(coalesce(p_value, ''), '\D', '', 'g')
    when length(regexp_replace(coalesce(p_value, ''), '\D', '', 'g')) = 12
      and left(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), 2) = '52'
      then right(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), 10)
    when length(regexp_replace(coalesce(p_value, ''), '\D', '', 'g')) = 13
      and left(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), 3) = '521'
      then right(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), 10)
    when length(regexp_replace(coalesce(p_value, ''), '\D', '', 'g')) between 8 and 15
      then regexp_replace(coalesce(p_value, ''), '\D', '', 'g')
    else ''
  end
$$;

revoke all on function public.smyl_normalize_contact_phone(text) from public, anon, authenticated;
grant execute on function public.smyl_normalize_contact_phone(text) to service_role;

create or replace function public.smyl_lana_patient_candidates(
  p_tenant_id uuid,
  p_email text default '',
  p_telefono text default ''
)
returns table (id uuid, name text, email text, phone text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with identity as (
    select
      lower(trim(coalesce(p_email, ''))) as email_key,
      public.smyl_normalize_contact_phone(p_telefono) as phone_key
  )
  select
    p.id,
    trim(concat_ws(' ', p.nombre, p.apellido)) as name,
    p.email,
    p.telefono as phone
  from public.camila_pacientes p
  cross join identity i
  where p.tenant_id = p_tenant_id
    and (
      (i.email_key <> '' and lower(trim(coalesce(p.email, ''))) = i.email_key)
      or (i.phone_key <> '' and public.smyl_normalize_contact_phone(p.telefono) = i.phone_key)
    )
  order by p.updated_at desc, p.id
  limit 6
$$;

revoke all on function public.smyl_lana_patient_candidates(uuid, text, text) from public, anon, authenticated;
grant execute on function public.smyl_lana_patient_candidates(uuid, text, text) to service_role;

create or replace function public.smyl_auto_link_lana_conversation(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_lana_conversation_id uuid,
  p_lana_channel text,
  p_nombre text,
  p_email text default '',
  p_telefono text default ''
)
returns table (
  patient_id uuid,
  case_id uuid,
  status text,
  existing_link boolean,
  created_patient boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_link public.camila_lana_handoffs%rowtype;
  v_patient_id uuid;
  v_match_count integer := 0;
  v_name text := left(trim(coalesce(p_nombre, '')), 150);
  v_email text := left(lower(trim(coalesce(p_email, ''))), 254);
  v_phone text := left(trim(coalesce(p_telefono, '')), 60);
  v_phone_key text := public.smyl_normalize_contact_phone(p_telefono);
begin
  if p_lana_channel not in ('whatsapp', 'messenger', 'instagram') then
    raise exception 'INVALID_LANA_CHANNEL' using errcode = '22023';
  end if;
  if not public.smyl_actor_has_permission_explicit(p_actor_id, p_tenant_id, 'messages.read')
    or not public.smyl_actor_has_permission_explicit(p_actor_id, p_tenant_id, 'patients.manage') then
    raise exception 'PATIENT_LINK_ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_name = '' then v_name := 'Paciente de redes sociales'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'smyl-lana-conversation:' || p_tenant_id::text || ':' || p_lana_conversation_id::text, 0
  ));

  select h.* into v_link
  from public.camila_lana_handoffs h
  where h.tenant_id = p_tenant_id
    and h.lana_conversation_id = p_lana_conversation_id;
  if found then
    return query select v_link.patient_id, v_link.case_id, 'already_linked'::text, true, false;
    return;
  end if;

  -- Sin correo ni teléfono verificable no existe una identidad estable que
  -- podamos crear automáticamente a partir de un nombre de red social.
  if v_email = '' and v_phone_key = '' then
    return query select null::uuid, null::uuid, 'needs_identity'::text, false, false;
    return;
  end if;

  -- Serializa identidades equivalentes incluso si llegan al mismo tiempo
  -- desde dos canales distintos.
  if v_email <> '' then
    perform pg_advisory_xact_lock(hashtextextended(
      'smyl-patient-email:' || p_tenant_id::text || ':' || v_email, 0
    ));
  end if;
  if v_phone_key <> '' then
    perform pg_advisory_xact_lock(hashtextextended(
      'smyl-patient-phone:' || p_tenant_id::text || ':' || v_phone_key, 0
    ));
  end if;

  select count(distinct p.id)::integer
  into v_match_count
  from public.camila_pacientes p
  where p.tenant_id = p_tenant_id
    and (
      (v_email <> '' and lower(trim(coalesce(p.email, ''))) = v_email)
      or (v_phone_key <> '' and public.smyl_normalize_contact_phone(p.telefono) = v_phone_key)
    );

  if v_match_count > 1 then
    return query select null::uuid, null::uuid, 'ambiguous'::text, false, false;
    return;
  end if;

  if v_match_count = 1 then
    select p.id into v_patient_id
    from public.camila_pacientes p
    where p.tenant_id = p_tenant_id
      and (
        (v_email <> '' and lower(trim(coalesce(p.email, ''))) = v_email)
        or (v_phone_key <> '' and public.smyl_normalize_contact_phone(p.telefono) = v_phone_key)
      )
    limit 1;
  else
    insert into public.camila_pacientes (tenant_id, nombre, apellido, email, telefono, notas)
    values (
      p_tenant_id,
      v_name,
      '',
      v_email,
      v_phone,
      'Contacto provisional creado desde una conversación. Requiere validación antes de registrar información clínica.'
    )
    returning id into v_patient_id;
  end if;

  insert into public.camila_lana_handoffs (
    tenant_id,
    lana_conversation_id,
    lana_channel,
    patient_id,
    case_id,
    created_by
  ) values (
    p_tenant_id,
    p_lana_conversation_id,
    p_lana_channel,
    v_patient_id,
    null,
    p_actor_id
  )
  returning * into v_link;

  return query select
    v_link.patient_id,
    v_link.case_id,
    case when v_match_count = 0 then 'created_contact'::text else 'matched'::text end,
    false,
    v_match_count = 0;
end;
$$;

revoke all on function public.smyl_auto_link_lana_conversation(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.smyl_auto_link_lana_conversation(uuid, uuid, uuid, text, text, text, text)
  to service_role;

-- El flujo manual deja de escoger de forma silenciosa el expediente más
-- reciente. El navegador debe enviar una elección concreta o pedir de manera
-- explícita la creación de un paciente nuevo.
create or replace function public.camila_confirmar_lana_handoff(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_lana_conversation_id uuid,
  p_lana_channel text,
  p_nombre text,
  p_email text default '',
  p_telefono text default '',
  p_patient_id uuid default null
)
returns table (patient_id uuid, case_id uuid, reused_patient boolean, existing_link boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.camila_lana_handoffs%rowtype;
  v_patient_id uuid;
  v_case_id uuid;
  v_name text := left(trim(coalesce(p_nombre, '')), 150);
  v_email text := left(lower(trim(coalesce(p_email, ''))), 254);
  v_phone text := left(trim(coalesce(p_telefono, '')), 60);
  v_reused boolean := false;
begin
  if p_lana_channel not in ('whatsapp', 'messenger', 'instagram') then
    raise exception 'INVALID_LANA_CHANNEL';
  end if;
  if not public.smyl_actor_has_permission_explicit(p_actor_id, p_tenant_id, 'patients.manage') then
    raise exception 'PATIENT_LINK_ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_name = '' then v_name := 'Paciente de redes sociales'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_lana_conversation_id::text, 0
  ));

  select * into v_link
  from public.camila_lana_handoffs h
  where h.tenant_id = p_tenant_id
    and h.lana_conversation_id = p_lana_conversation_id;

  if found then
    if v_link.case_id is null then
      insert into public.camila_casos (
        tenant_id, nombre_paciente, telefono, email, notas_doctor, es_prospecto
      )
      select
        p_tenant_id::text,
        trim(concat_ws(' ', p.nombre, p.apellido)),
        p.telefono,
        p.email,
        'Caso iniciado por una acción explícita desde el chat. El historial de mensajes no se copió.',
        true
      from public.camila_pacientes p
      where p.tenant_id = p_tenant_id and p.id = v_link.patient_id
      returning id into v_case_id;

      update public.camila_lana_handoffs
      set case_id = v_case_id, updated_at = now()
      where id = v_link.id;
      v_link.case_id := v_case_id;
    end if;
    return query select v_link.patient_id, v_link.case_id, true, true;
    return;
  end if;

  if p_patient_id is not null then
    select p.id into v_patient_id
    from public.camila_pacientes p
    where p.tenant_id = p_tenant_id and p.id = p_patient_id;
    if v_patient_id is null then raise exception 'PATIENT_NOT_IN_TENANT'; end if;
    v_reused := true;
  else
    insert into public.camila_pacientes (tenant_id, nombre, apellido, email, telefono, notas)
    values (
      p_tenant_id, v_name, '', v_email, v_phone,
      'Paciente creado después de una confirmación explícita desde el chat.'
    )
    returning id into v_patient_id;
  end if;

  insert into public.camila_casos (
    tenant_id, nombre_paciente, telefono, email, notas_doctor, es_prospecto
  )
  select
    p_tenant_id::text,
    trim(concat_ws(' ', p.nombre, p.apellido)),
    p.telefono,
    p.email,
    'Caso iniciado por una acción explícita desde el chat. El historial de mensajes no se copió.',
    true
  from public.camila_pacientes p
  where p.tenant_id = p_tenant_id and p.id = v_patient_id
  returning id into v_case_id;

  insert into public.camila_lana_handoffs (
    tenant_id, lana_conversation_id, lana_channel, patient_id, case_id, created_by
  ) values (
    p_tenant_id, p_lana_conversation_id, p_lana_channel, v_patient_id, v_case_id, p_actor_id
  );

  return query select v_patient_id, v_case_id, v_reused, false;
end;
$$;

revoke all on function public.camila_confirmar_lana_handoff(uuid, uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.camila_confirmar_lana_handoff(uuid, uuid, uuid, text, text, text, text, uuid)
  to service_role;

-- Incorporar una fotografía al expediente sí es una acción clínica explícita.
-- Si el chat sólo tenía el contacto vinculado, aquí se crea el caso necesario
-- antes de registrar la referencia clínica.
create or replace function public.camila_vincular_lana_imagen(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_lana_conversation_id uuid,
  p_lana_message_id bigint,
  p_lana_channel text,
  p_label text default 'Fotografía recibida por chat'
)
returns public.camila_lana_clinical_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handoff public.camila_lana_handoffs%rowtype;
  v_link public.camila_lana_clinical_links%rowtype;
begin
  if p_lana_message_id is null or p_lana_message_id <= 0
     or p_lana_channel not in ('whatsapp', 'messenger', 'instagram') then
    raise exception 'INVALID_LANA_CLINICAL_LINK';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_lana_conversation_id::text || ':' || p_lana_message_id::text, 0
  ));
  select * into v_handoff from public.camila_lana_handoffs h
  where h.tenant_id = p_tenant_id and h.lana_conversation_id = p_lana_conversation_id;
  if not found then raise exception 'LANA_HANDOFF_REQUIRED'; end if;
  if v_handoff.lana_channel <> p_lana_channel then raise exception 'LANA_CHANNEL_MISMATCH'; end if;

  if v_handoff.case_id is null then
    insert into public.camila_casos (
      tenant_id, nombre_paciente, telefono, email, notas_doctor, es_prospecto
    )
    select
      p_tenant_id::text,
      trim(concat_ws(' ', p.nombre, p.apellido)),
      p.telefono,
      p.email,
      'Caso iniciado al incorporar contenido clínico desde el chat. El historial de mensajes no se copió.',
      true
    from public.camila_pacientes p
    where p.tenant_id = p_tenant_id and p.id = v_handoff.patient_id
    returning id into v_handoff.case_id;

    update public.camila_lana_handoffs
    set case_id = v_handoff.case_id, updated_at = now()
    where id = v_handoff.id;
  end if;

  insert into public.camila_lana_clinical_links(
    tenant_id, handoff_id, lana_conversation_id, lana_message_id,
    lana_channel, patient_id, case_id, media_type, label, created_by
  ) values (
    p_tenant_id, v_handoff.id, p_lana_conversation_id, p_lana_message_id,
    p_lana_channel, v_handoff.patient_id, v_handoff.case_id, 'image',
    left(coalesce(nullif(trim(p_label), ''), 'Fotografía recibida por chat'), 180), p_actor_id
  )
  on conflict (tenant_id, lana_conversation_id, lana_message_id)
  do update set updated_at = camila_lana_clinical_links.updated_at
  returning * into v_link;
  return v_link;
end;
$$;

revoke all on function public.camila_vincular_lana_imagen(uuid, uuid, uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.camila_vincular_lana_imagen(uuid, uuid, uuid, bigint, text, text)
  to service_role;

commit;
